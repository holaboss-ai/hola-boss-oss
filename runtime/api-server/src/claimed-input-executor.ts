import fs from "node:fs";
import path from "node:path";

import type { RuntimeStateStore, SessionInputRecord, TurnResultRecord, WorkspaceRecord } from "@holaboss/runtime-state-store";

import {
  buildRunCompletedEvent,
  buildRunFailedEvent,
  executeRunnerRequest,
  type RunnerEvent,
} from "./runner-worker.js";
import { resolveProductRuntimeConfig } from "./runtime-config.js";
import { normalizeHarnessId, resolveRuntimeHarnessAdapter } from "./harness-registry.js";
import type { MemoryServiceLike } from "./memory.js";
import { createBackgroundTaskMemoryModelClient } from "./background-task-model.js";
import type { TurnMemoryWritebackModelContext } from "./turn-memory-writeback.js";
import { runEvolveTasks } from "./evolve-tasks.js";
import { promoteAcceptedSkillCandidate } from "./evolve-skill-review.js";
import { collectWorkspaceFileManifest, detectWorkspaceFileOutputs, type WorkspaceFileManifest } from "./turn-output-capture.js";
import { compactTurnSummary } from "./turn-result-summary.js";

const ONBOARD_PROMPT_HEADER = "[Holaboss Workspace Onboarding v1]";
const RUNTIME_EXEC_CONTEXT_KEY = "_sandbox_runtime_exec_v1";
const RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY = "model_proxy_api_key";
const RUNTIME_EXEC_SANDBOX_ID_KEY = "sandbox_id";
const DEFAULT_CLAIM_LEASE_SECONDS = 300;
const TERMINAL_OUTPUT_EVENT_TYPES = new Set(["run_completed", "run_failed"]);

interface SessionInputAttachment {
  id: string;
  kind: "image" | "file";
  name: string;
  mime_type: string;
  size_bytes: number;
  workspace_path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSessionInputAttachment(value: unknown): SessionInputAttachment | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const mimeType = typeof value.mime_type === "string" ? value.mime_type.trim() : "";
  const workspacePath = typeof value.workspace_path === "string" ? value.workspace_path.trim() : "";
  const sizeBytes = typeof value.size_bytes === "number" && Number.isFinite(value.size_bytes) ? value.size_bytes : 0;
  const kind = value.kind === "image" ? "image" : value.kind === "file" ? "file" : mimeType.startsWith("image/") ? "image" : "file";
  if (!id || !name || !mimeType || !workspacePath) {
    return null;
  }
  return {
    id,
    kind,
    name,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    workspace_path: workspacePath
  };
}

function sessionInputAttachments(value: unknown): SessionInputAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseSessionInputAttachment(item)).filter((item): item is SessionInputAttachment => Boolean(item));
}

function defaultInstructionForAttachments(attachments: SessionInputAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }
  if (attachments.length === 1) {
    return attachments[0].kind === "image" ? "Review the attached image." : "Review the attached file.";
  }
  return attachments.some((attachment) => attachment.kind === "image")
    ? "Review the attached files and images."
    : "Review the attached files.";
}

function selectedHarness(): string {
  return normalizeHarnessId(process.env.SANDBOX_AGENT_HARNESS);
}

function writebackModelContext(params: {
  workspaceId: string;
  sessionId: string;
  inputId: string;
  instruction: string;
  model: unknown;
  runtimeBinding: {
    authToken: string;
    userId: string;
    sandboxId: string;
    modelProxyBaseUrl: string;
    defaultModel: string;
    defaultProvider: string;
  };
  runtimeExecContext: Record<string, unknown>;
}): TurnMemoryWritebackModelContext | null {
  const modelClient = createBackgroundTaskMemoryModelClient({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    inputId: params.inputId,
    selectedModel: typeof params.model === "string" ? params.model : params.runtimeBinding.defaultModel,
    defaultProviderId: params.runtimeBinding.defaultProvider,
    runtimeExecModelProxyApiKey:
      typeof params.runtimeExecContext[RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY] === "string"
        ? params.runtimeExecContext[RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY]
        : params.runtimeBinding.authToken,
    runtimeExecSandboxId:
      typeof params.runtimeExecContext[RUNTIME_EXEC_SANDBOX_ID_KEY] === "string"
        ? params.runtimeExecContext[RUNTIME_EXEC_SANDBOX_ID_KEY]
        : params.runtimeBinding.sandboxId,
  });
  if (!modelClient) {
    return null;
  }
  return {
    modelClient,
    instruction: params.instruction,
  };
}

function ensureLocalBinding(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  sessionId: string;
  harness: string;
}): string {
  const existing = params.store.getBinding({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId
  });
  if (existing && existing.harnessSessionId.trim()) {
    return existing.harnessSessionId;
  }
  const binding = params.store.upsertBinding({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    harness: params.harness,
    harnessSessionId: params.sessionId
  });
  return binding.harnessSessionId;
}

function buildOnboardingInstruction(params: {
  workspaceRoot: string;
  workspaceId: string;
  sessionId: string;
  text: string;
  attachments: SessionInputAttachment[];
  workspace: WorkspaceRecord;
}): string {
  const trimmed = params.text.trim() || defaultInstructionForAttachments(params.attachments);
  if (!trimmed) {
    throw new Error("text or attachments are required");
  }
  const onboardingStatus = (params.workspace.onboardingStatus ?? "").trim().toLowerCase();
  const onboardingSessionId = (params.workspace.onboardingSessionId ?? "").trim();
  if (!["pending", "awaiting_confirmation"].includes(onboardingStatus) || onboardingSessionId !== params.sessionId) {
    return trimmed;
  }

  const onboardPath = path.join(params.workspaceRoot, params.workspaceId, "ONBOARD.md");
  if (!fs.existsSync(onboardPath)) {
    return trimmed;
  }
  const rawOnboardPrompt = fs.readFileSync(onboardPath, "utf8").trim();
  if (!rawOnboardPrompt || trimmed.startsWith(ONBOARD_PROMPT_HEADER)) {
    return trimmed;
  }

  return [
    ONBOARD_PROMPT_HEADER,
    "- You are in onboarding mode for this workspace.",
    `- The workspace directory is ./${params.workspaceId} relative to the current working directory.`,
    `- The onboarding guide file is ./${params.workspaceId}/ONBOARD.md (absolute path: ${onboardPath}).`,
    "- Use that workspace-scoped ONBOARD.md to drive the conversation and gather required details.",
    "- ONBOARD.md content is already included below; do not re-read it unless needed.",
    `- If file reads are needed, use ./${params.workspaceId}/... paths rather than files directly under ${params.workspaceRoot}.`,
    "- Ask concise questions and collect durable facts/preferences.",
    "- Do not start regular execution work until onboarding is complete.",
    "- Relevant native onboarding tools:",
    "- `holaboss_onboarding_status` reads the local onboarding status for this workspace.",
    "- `holaboss_onboarding_complete` marks onboarding complete. Required argument: `summary`. Optional argument: `requested_by`.",
    "- When all onboarding requirements are satisfied and the user confirms, call `holaboss_onboarding_complete` with a concise durable summary.",
    "",
    "[ONBOARD.md]",
    rawOnboardPrompt,
    "[/ONBOARD.md]",
    "",
    trimmed
  ].join("\n").trim();
}

function createdAtForEvent(event: RunnerEvent): string | undefined {
  return typeof event.timestamp === "string" && event.timestamp.trim() ? event.timestamp : undefined;
}

function inferSessionKind(params: {
  workspace: WorkspaceRecord;
  sessionId: string;
  persistedKind?: string | null;
}): string {
  const persistedKind = typeof params.persistedKind === "string" ? params.persistedKind.trim() : "";
  if (persistedKind) {
    return persistedKind;
  }
  const sessionId = params.sessionId.trim();
  const onboardingSessionId = (params.workspace.onboardingSessionId ?? "").trim();
  const onboardingStatus = (params.workspace.onboardingStatus ?? "").trim().toLowerCase();
  if (sessionId && sessionId === onboardingSessionId && ["pending", "awaiting_confirmation", "in_progress"].includes(onboardingStatus)) {
    return "onboarding";
  }
  return "workspace_session";
}

function payloadForEvent(event: RunnerEvent): Record<string, unknown> {
  return isRecord(event.payload) ? event.payload : {};
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function eventTimestampOrNow(event: RunnerEvent): string {
  return createdAtForEvent(event) ?? new Date().toISOString();
}

function tokenUsageFromPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  const direct = jsonRecord(payload.token_usage);
  if (direct) {
    return direct;
  }
  return jsonRecord(payload.usage);
}

function claimLeaseUntilIso(leaseSeconds: number, nowIso = new Date().toISOString()): string {
  if (leaseSeconds <= 0) {
    return nowIso;
  }
  const now = new Date(nowIso);
  return new Date(now.getTime() + leaseSeconds * 1000).toISOString();
}

function latestPersistedTerminalOutputEvent(params: {
  store: RuntimeStateStore;
  sessionId: string;
  inputId: string;
}) {
  return params.store
    .listOutputEvents({
      sessionId: params.sessionId,
      inputId: params.inputId,
    })
    .filter((event) => TERMINAL_OUTPUT_EVENT_TYPES.has(event.eventType))
    .at(-1);
}

function stopReasonForTerminalEvent(params: {
  eventType: string;
  payload: Record<string, unknown>;
  terminalStatus: "IDLE" | "WAITING_USER" | "PAUSED" | "ERROR";
}): string | null {
  if (params.eventType === "run_completed") {
    const status = typeof params.payload.status === "string" ? params.payload.status.trim().toLowerCase() : "";
    if (status) {
      return status;
    }
    if (params.terminalStatus === "WAITING_USER") {
      return "waiting_user";
    }
    if (params.terminalStatus === "PAUSED") {
      return "paused";
    }
    return "completed";
  }
  if (params.eventType === "run_failed") {
    if (typeof params.payload.type === "string" && params.payload.type.trim()) {
      return params.payload.type.trim();
    }
    if (typeof params.payload.message === "string" && params.payload.message.trim()) {
      return params.payload.message.trim();
    }
    return "run_failed";
  }
  return null;
}

function permissionDenialFromEventPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  if (payload.error !== true) {
    return null;
  }

  const candidates = [
    typeof payload.message === "string" ? payload.message : null,
    typeof payload.result === "string" ? payload.result : null,
    typeof payload.error_message === "string" ? payload.error_message : null,
  ].filter((value): value is string => Boolean(value && value.trim()));
  const denialText = candidates.find((value) => /permission|denied|not allowed/i.test(value));
  if (!denialText) {
    return null;
  }

  return {
    tool_name: typeof payload.tool_name === "string" ? payload.tool_name : "unknown",
    tool_id: typeof payload.tool_id === "string" ? payload.tool_id : null,
    reason: denialText,
  };
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function titleCaseWords(value: string): string {
  return value.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function cronjobNotificationPriority(value: unknown): "low" | "normal" | "high" | "critical" {
  const normalized = optionalString(value)?.toLowerCase();
  if (normalized === "low" || normalized === "high" || normalized === "critical") {
    return normalized;
  }
  return "normal";
}

function cronjobNotificationBaseTitle(job: { name: string; metadata: Record<string, unknown> }): string {
  const explicitTitle = optionalString(job.metadata.notification_title);
  if (explicitTitle) {
    return explicitTitle;
  }
  const name = optionalString(job.name);
  if (name) {
    return titleCaseWords(name.replace(/[_-]+/g, " ").replace(/\s+/g, " "));
  }
  return "Cronjob Run";
}

function cronjobCompletionNotificationTitle(turnResult: TurnResultRecord, baseTitle: string): string {
  if (turnResult.status === "failed") {
    return `${baseTitle} Failed`;
  }
  if (turnResult.status === "waiting_user") {
    return `${baseTitle} Needs Input`;
  }
  if (turnResult.status === "paused") {
    return `${baseTitle} Paused`;
  }
  return `${baseTitle} Completed`;
}

function cronjobCompletionNotificationLevel(
  turnResult: TurnResultRecord,
): "info" | "success" | "warning" | "error" {
  if (turnResult.status === "failed") {
    return "error";
  }
  if (turnResult.status === "waiting_user" || turnResult.status === "paused") {
    return "warning";
  }
  return "success";
}

function cronjobCompletionNotificationMessage(turnResult: TurnResultRecord): string {
  const summary = compactTurnSummary(turnResult);
  if (summary) {
    return summary;
  }
  if (turnResult.status === "failed") {
    return "Cronjob run failed.";
  }
  if (turnResult.status === "waiting_user") {
    return "Cronjob run is waiting for user input.";
  }
  if (turnResult.status === "paused") {
    return "Cronjob run was paused.";
  }
  return "Cronjob run completed.";
}

function maybeCreateCronjobCompletionNotification(params: {
  store: RuntimeStateStore;
  record: SessionInputRecord;
  turnResult: TurnResultRecord;
}): void {
  const context = isRecord(params.record.payload.context) ? params.record.payload.context : null;
  const source = optionalString(context?.source)?.toLowerCase();
  const cronjobId = optionalString(context?.cronjob_id);
  if (source !== "cronjob" || !cronjobId) {
    return;
  }

  const session = params.store.getSession({
    workspaceId: params.record.workspaceId,
    sessionId: params.record.sessionId,
  });
  if (optionalString(session?.kind)?.toLowerCase() !== "cronjob") {
    return;
  }

  const job = params.store.getCronjob(cronjobId);
  const workspace = params.store.getWorkspace(params.record.workspaceId);
  if (!job || !workspace) {
    return;
  }

  const metadata = isRecord(job.metadata) ? job.metadata : {};
  const baseTitle = cronjobNotificationBaseTitle({ name: job.name, metadata });
  params.store.createRuntimeNotification({
    workspaceId: params.record.workspaceId,
    cronjobId: job.id,
    sourceType: "cronjob",
    sourceLabel: workspace.name.trim() || null,
    title: cronjobCompletionNotificationTitle(params.turnResult, baseTitle),
    message: cronjobCompletionNotificationMessage(params.turnResult),
    level: cronjobCompletionNotificationLevel(params.turnResult),
    priority: cronjobNotificationPriority(metadata.notification_priority),
    metadata: {
      cronjob_id: job.id,
      cronjob_name: job.name,
      cronjob_description: job.description,
      cronjob_instruction: job.instruction,
      session_id: params.record.sessionId,
      input_id: params.record.inputId,
      turn_status: params.turnResult.status,
      stop_reason: params.turnResult.stopReason,
      delivery: job.delivery,
      cronjob_metadata: metadata,
    },
  });
}

async function maybePromoteAcceptedEvolveSkillCandidate(params: {
  store: RuntimeStateStore;
  record: SessionInputRecord;
  turnResult: TurnResultRecord;
  memoryService?: MemoryServiceLike | null;
}): Promise<void> {
  if (!params.memoryService || params.turnResult.status !== "completed") {
    return;
  }
  const context = isRecord(params.record.payload.context) ? params.record.payload.context : null;
  const source = optionalString(context?.source)?.toLowerCase();
  const proposalSource = optionalString(context?.proposal_source)?.toLowerCase();
  const evolveCandidate = isRecord(context?.evolve_candidate) ? context?.evolve_candidate : null;
  const candidateId = optionalString(evolveCandidate?.candidate_id);
  if (source !== "task_proposal" || proposalSource !== "evolve" || !candidateId) {
    return;
  }
  await promoteAcceptedSkillCandidate({
    store: params.store,
    memoryService: params.memoryService,
    candidateId,
  });
}

type SkillInvocationSummaryEntry = {
  skillName: string;
  skillId: string | null;
  completed: boolean;
  error: boolean;
};

type SkillWideningAudit = {
  scope: string | null;
  workspaceBoundaryOverride: boolean | null;
  managedTools: Set<string>;
  grantedTools: Set<string>;
  activeGrantedTools: Set<string>;
  managedCommands: Set<string>;
  grantedCommands: Set<string>;
  activeGrantedCommands: Set<string>;
  activationCount: number;
  deniedCalls: number;
  deniedToolNames: Set<string>;
};

function summarizeSkillInvocations(skillInvocationsById: Map<string, SkillInvocationSummaryEntry>): Record<string, unknown> {
  const calls = [...skillInvocationsById.values()];
  return {
    total_calls: calls.length,
    completed_calls: calls.filter((call) => call.completed && !call.error).length,
    failed_calls: calls.filter((call) => call.error).length,
    skill_names: [...new Set(calls.map((call) => call.skillName).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right)
    ),
    skill_ids: [...new Set(calls.map((call) => call.skillId).filter((value): value is string => Boolean(value)))].sort(
      (left, right) => left.localeCompare(right)
    ),
  };
}

function createSkillWideningAudit(): SkillWideningAudit {
  return {
    scope: null,
    workspaceBoundaryOverride: null,
    managedTools: new Set<string>(),
    grantedTools: new Set<string>(),
    activeGrantedTools: new Set<string>(),
    managedCommands: new Set<string>(),
    grantedCommands: new Set<string>(),
    activeGrantedCommands: new Set<string>(),
    activationCount: 0,
    deniedCalls: 0,
    deniedToolNames: new Set<string>(),
  };
}

function skillWideningSummary(audit: SkillWideningAudit): Record<string, unknown> | null {
  if (
    audit.scope === null &&
    audit.workspaceBoundaryOverride === null &&
    audit.managedTools.size === 0 &&
    audit.grantedTools.size === 0 &&
    audit.activeGrantedTools.size === 0 &&
    audit.managedCommands.size === 0 &&
    audit.grantedCommands.size === 0 &&
    audit.activeGrantedCommands.size === 0 &&
    audit.activationCount === 0 &&
    audit.deniedCalls === 0
  ) {
    return null;
  }
  return {
    scope: audit.scope,
    workspace_boundary_override: audit.workspaceBoundaryOverride,
    managed_tools: [...audit.managedTools].sort((left, right) => left.localeCompare(right)),
    granted_tools: [...audit.grantedTools].sort((left, right) => left.localeCompare(right)),
    active_granted_tools: [...audit.activeGrantedTools].sort((left, right) => left.localeCompare(right)),
    managed_commands: [...audit.managedCommands].sort((left, right) => left.localeCompare(right)),
    granted_commands: [...audit.grantedCommands].sort((left, right) => left.localeCompare(right)),
    active_granted_commands: [...audit.activeGrantedCommands].sort((left, right) => left.localeCompare(right)),
    activation_count: audit.activationCount,
    denied_calls: audit.deniedCalls,
    denied_tool_names: [...audit.deniedToolNames].sort((left, right) => left.localeCompare(right)),
  };
}

function isSkillPolicyDeniedPayload(payload: Record<string, unknown>): boolean {
  if (payload.error !== true) {
    return false;
  }
  const candidates = [
    optionalString(payload.message),
    optionalString(payload.result),
    optionalString(payload.error_message),
  ].filter((value): value is string => Boolean(value));
  return candidates.some((value) => /permission denied by skill policy/i.test(value));
}

function summarizeToolCalls(
  toolCallsById: Map<string, { toolName: string; toolId: string | null; completed: boolean; error: boolean }>,
  skillInvocationsById: Map<string, SkillInvocationSummaryEntry> = new Map(),
  wideningAudit: SkillWideningAudit | null = null
): Record<string, unknown> {
  const calls = [...toolCallsById.values()];
  const summary: Record<string, unknown> = {
    total_calls: calls.length,
    completed_calls: calls.filter((call) => call.completed && !call.error).length,
    failed_calls: calls.filter((call) => call.error).length,
    tool_names: [...new Set(calls.map((call) => call.toolName).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right)
    ),
    tool_ids: [...new Set(calls.map((call) => call.toolId).filter((value): value is string => Boolean(value)))].sort(
      (left, right) => left.localeCompare(right)
    ),
  };
  if (skillInvocationsById.size > 0) {
    summary.skill_invocations = summarizeSkillInvocations(skillInvocationsById);
  }
  const widening = wideningAudit ? skillWideningSummary(wideningAudit) : null;
  if (widening) {
    summary.skill_policy_widening = widening;
  }
  return summary;
}

function persistTurnResult(params: {
  store: RuntimeStateStore;
  record: SessionInputRecord;
  startedAt: string;
  completedAt: string | null;
  terminalStatus: "IDLE" | "WAITING_USER" | "PAUSED" | "ERROR";
  stopReason: string | null;
  assistantText: string;
  toolUsageSummary: Record<string, unknown>;
  permissionDenials: Array<Record<string, unknown>>;
  promptSectionIds: string[];
  capabilityManifestFingerprint: string | null;
  requestSnapshotFingerprint: string | null;
  promptCacheProfile: Record<string, unknown> | null;
  tokenUsage: Record<string, unknown> | null;
}): TurnResultRecord {
  return params.store.upsertTurnResult({
    workspaceId: params.record.workspaceId,
    sessionId: params.record.sessionId,
    inputId: params.record.inputId,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    status:
      params.terminalStatus === "ERROR"
        ? "failed"
        : params.terminalStatus === "WAITING_USER"
        ? "waiting_user"
        : params.terminalStatus === "PAUSED"
        ? "paused"
        : "completed",
    stopReason: params.stopReason,
    assistantText: params.assistantText,
    toolUsageSummary: params.toolUsageSummary,
    permissionDenials: params.permissionDenials,
    promptSectionIds: params.promptSectionIds,
    capabilityManifestFingerprint: params.capabilityManifestFingerprint,
    requestSnapshotFingerprint: params.requestSnapshotFingerprint,
    promptCacheProfile: params.promptCacheProfile,
    compactedSummary: null,
    tokenUsage: params.tokenUsage,
  });
}

function appendNextOutputEvent(params: {
  store: RuntimeStateStore;
  record: SessionInputRecord;
  lastSequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}): number {
  const nextSequence = Math.max(0, params.lastSequence) + 1;
  params.store.appendOutputEvent({
    workspaceId: params.record.workspaceId,
    sessionId: params.record.sessionId,
    inputId: params.record.inputId,
    sequence: nextSequence,
    eventType: params.eventType,
    payload: params.payload,
    createdAt: params.createdAt,
  });
  return nextSequence;
}

function terminalStatusForCompletedPayload(
  payload: Record<string, unknown>,
  supportsWaitingUser: boolean
): "IDLE" | "WAITING_USER" | "PAUSED" {
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  if (status === "paused") {
    return "PAUSED";
  }
  return supportsWaitingUser && status === "waiting_user" ? "WAITING_USER" : "IDLE";
}

function maybePersistHarnessSessionId(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  sessionId: string;
  harness: string;
  eventType: string;
  payload: Record<string, unknown>;
}): void {
  if (!["run_completed", "run_failed"].includes(params.eventType)) {
    return;
  }
  if (params.eventType === "run_failed") {
    params.store.upsertBinding({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      harness: params.harness,
      harnessSessionId: params.sessionId
    });
    return;
  }
  const harnessSessionId = params.payload.harness_session_id;
  if (typeof harnessSessionId !== "string" || !harnessSessionId.trim()) {
    return;
  }
  params.store.upsertBinding({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    harness: params.harness,
    harnessSessionId: harnessSessionId.trim()
  });
}

export async function processClaimedInput(params: {
  store: RuntimeStateStore;
  record: SessionInputRecord;
  claimedBy?: string;
  leaseSeconds?: number;
  memoryService?: MemoryServiceLike | null;
  runEvolveTasksFn?: typeof runEvolveTasks;
  wakeDurableMemoryWorker?: (() => void) | null;
  onEvolveTaskError?: (taskName: string, error: unknown) => void;
  executeRunnerRequestFn?: typeof executeRunnerRequest;
  resolveProductRuntimeConfigFn?: typeof resolveProductRuntimeConfig;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { store, record } = params;
  const claimedBy = params.claimedBy ?? record.claimedBy ?? "sandbox-agent-ts-worker";
  const leaseSeconds = params.leaseSeconds ?? DEFAULT_CLAIM_LEASE_SECONDS;
  const turnStartedAt = new Date().toISOString();
  const workspace = store.getWorkspace(record.workspaceId);
  if (!workspace) {
    store.updateInput(record.inputId, { status: "FAILED" });
    store.updateRuntimeState({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      status: "ERROR",
      currentInputId: null,
      currentWorkerId: null,
      leaseUntil: null,
      heartbeatAt: null,
      lastError: { message: "workspace not found" }
    });
    persistTurnResult({
      store,
      record,
      startedAt: turnStartedAt,
      completedAt: new Date().toISOString(),
      terminalStatus: "ERROR",
      stopReason: "workspace_not_found",
      assistantText: "",
      toolUsageSummary: summarizeToolCalls(new Map()),
      permissionDenials: [],
      promptSectionIds: [],
      capabilityManifestFingerprint: null,
      requestSnapshotFingerprint: null,
      promptCacheProfile: null,
      tokenUsage: null,
    });
    return;
  }

  const harness = normalizeHarnessId(workspace.harness ?? selectedHarness());
  const workspaceDir = store.workspaceDir(record.workspaceId);
  const session = store.getSession({
    workspaceId: record.workspaceId,
    sessionId: record.sessionId
  });
  const sessionKind = inferSessionKind({
    workspace,
    sessionId: record.sessionId,
    persistedKind: session?.kind
  });
  const harnessSupportsWaitingUser = resolveRuntimeHarnessAdapter(harness)?.capabilities.supportsWaitingUser ?? false;
  const harnessSessionId = ensureLocalBinding({
    store,
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    harness
  });
  const attachments = sessionInputAttachments(record.payload.attachments);

  const instruction = buildOnboardingInstruction({
    workspaceRoot: store.workspaceRoot,
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    text: String(record.payload.text ?? ""),
    attachments,
    workspace
  });

  store.updateRuntimeState({
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    status: "BUSY",
    currentInputId: record.inputId,
    currentWorkerId: claimedBy,
    leaseUntil: record.claimedUntil ?? claimLeaseUntilIso(leaseSeconds),
    heartbeatAt: undefined,
    lastError: null
  });

  const runtimeContext = isRecord(record.payload.context) ? { ...record.payload.context } : {};
  const priorExecContext = isRecord(runtimeContext[RUNTIME_EXEC_CONTEXT_KEY])
    ? { ...runtimeContext[RUNTIME_EXEC_CONTEXT_KEY] }
    : {};
  const resolveRuntimeConfig = params.resolveProductRuntimeConfigFn ?? resolveProductRuntimeConfig;
  const runtimeBinding = resolveRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false
  });
  if (
    typeof priorExecContext[RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY] !== "string" &&
    runtimeBinding.authToken
  ) {
    priorExecContext[RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY] = runtimeBinding.authToken;
  }
  if (typeof priorExecContext[RUNTIME_EXEC_SANDBOX_ID_KEY] !== "string" && runtimeBinding.sandboxId) {
    priorExecContext[RUNTIME_EXEC_SANDBOX_ID_KEY] = runtimeBinding.sandboxId;
  }
  priorExecContext.harness = harness;
  priorExecContext.harness_session_id = harnessSessionId;
  runtimeContext[RUNTIME_EXEC_CONTEXT_KEY] = priorExecContext;

  const payload: Record<string, unknown> = {
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    session_kind: sessionKind,
    input_id: record.inputId,
    instruction,
    attachments,
    context: runtimeContext,
    model: record.payload.model ?? null,
    thinking_value: record.payload.thinking_value ?? null,
    debug: false
  };
  const memoryWritebackModelContext = writebackModelContext({
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    inputId: record.inputId,
    instruction,
    model: record.payload.model ?? null,
    runtimeBinding,
    runtimeExecContext: priorExecContext,
  });

  const assistantParts: string[] = [];
  let terminalStatus: "IDLE" | "WAITING_USER" | "PAUSED" | "ERROR" = "IDLE";
  let lastError: Record<string, unknown> | null = null;
  let lastSequence = 0;
  let completedAt: string | null = null;
  let stopReason: string | null = null;
  let tokenUsage: Record<string, unknown> | null = null;
  let activeLeaseUntil = record.claimedUntil ?? claimLeaseUntilIso(leaseSeconds);
  let promptSectionIds: string[] = [];
  let capabilityManifestFingerprint: string | null = null;
  let requestSnapshotFingerprint: string | null = null;
  let promptCacheProfile: Record<string, unknown> | null = null;
  const toolCallsById = new Map<string, { toolName: string; toolId: string | null; completed: boolean; error: boolean }>();
  const skillInvocationsById = new Map<string, SkillInvocationSummaryEntry>();
  const wideningAudit = createSkillWideningAudit();
  const permissionDenials: Array<Record<string, unknown>> = [];
  let deferredTerminalEvent: {
    eventType: "run_completed" | "run_failed";
    payload: Record<string, unknown>;
    createdAt: string;
  } | null = null;
  let workspaceFileManifestBefore: WorkspaceFileManifest | null = null;

  try {
    workspaceFileManifestBefore = collectWorkspaceFileManifest(workspaceDir);
  } catch {
    workspaceFileManifestBefore = null;
  }

  try {
    const executeRunner = params.executeRunnerRequestFn ?? executeRunnerRequest;
    const execution = await executeRunner(payload, {
      signal: params.abortSignal,
      onHeartbeat: () => {
        const renewedClaim = store.renewInputClaim({
          inputId: record.inputId,
          claimedBy,
          leaseSeconds,
        });
        if (renewedClaim?.claimedUntil) {
          activeLeaseUntil = renewedClaim.claimedUntil;
        }
        store.updateRuntimeState({
          workspaceId: record.workspaceId,
          sessionId: record.sessionId,
          status: "BUSY",
          currentInputId: record.inputId,
          currentWorkerId: claimedBy,
          leaseUntil: activeLeaseUntil,
          lastError: null
        });
      },
      onEvent: async (event) => {
        const sequence = typeof event.sequence === "number" ? event.sequence : 0;
        lastSequence = Math.max(lastSequence, sequence);
        const eventPayload = payloadForEvent(event);
        const eventTimestamp = eventTimestampOrNow(event);
        const eventType = typeof event.event_type === "string" ? event.event_type : "unknown";
        if (eventType === "run_completed" || eventType === "run_failed") {
          deferredTerminalEvent = {
            eventType,
            payload: eventPayload,
            createdAt: eventTimestamp,
          };
        } else {
          store.appendOutputEvent({
            workspaceId: record.workspaceId,
            sessionId: record.sessionId,
            inputId: record.inputId,
            sequence,
            eventType,
            payload: eventPayload,
            createdAt: eventTimestamp
          });
        }
        maybePersistHarnessSessionId({
          store,
          workspaceId: record.workspaceId,
          sessionId: record.sessionId,
          harness,
          eventType,
          payload: eventPayload
        });
        if (event.event_type === "output_delta" && typeof eventPayload.delta === "string") {
          assistantParts.push(eventPayload.delta);
        }
        if (event.event_type === "run_started") {
          promptSectionIds = stringList(eventPayload.prompt_section_ids);
          capabilityManifestFingerprint =
            typeof eventPayload.capability_manifest_fingerprint === "string" &&
            eventPayload.capability_manifest_fingerprint.trim()
              ? eventPayload.capability_manifest_fingerprint.trim()
              : capabilityManifestFingerprint;
          requestSnapshotFingerprint =
            typeof eventPayload.request_snapshot_fingerprint === "string" &&
            eventPayload.request_snapshot_fingerprint.trim()
              ? eventPayload.request_snapshot_fingerprint.trim()
              : requestSnapshotFingerprint;
          promptCacheProfile = jsonRecord(eventPayload.prompt_cache_profile) ?? promptCacheProfile;
        }
        if (event.event_type === "tool_call") {
          const callId =
            typeof eventPayload.call_id === "string" && eventPayload.call_id.trim()
              ? eventPayload.call_id.trim()
              : `sequence:${sequence}`;
          const existingCall = toolCallsById.get(callId);
          const toolName =
            typeof eventPayload.tool_name === "string" && eventPayload.tool_name.trim()
              ? eventPayload.tool_name.trim()
              : existingCall?.toolName ?? "unknown";
          const toolId =
            typeof eventPayload.tool_id === "string" && eventPayload.tool_id.trim()
              ? eventPayload.tool_id.trim()
              : existingCall?.toolId ?? null;
          const completed = eventPayload.phase === "completed" || existingCall?.completed === true;
          const errored = eventPayload.error === true || existingCall?.error === true;
          toolCallsById.set(callId, {
            toolName,
            toolId,
            completed,
            error: errored,
          });
          const denial = permissionDenialFromEventPayload(eventPayload);
          if (denial) {
            permissionDenials.push(denial);
          }
        }
        if (event.event_type === "skill_invocation" || event.event_type === "tool_call") {
          const callId =
            typeof eventPayload.call_id === "string" && eventPayload.call_id.trim()
              ? eventPayload.call_id.trim()
              : `sequence:${sequence}`;
          const toolName = optionalString(eventPayload.tool_name);
          const isSkillInvocation =
            event.event_type === "skill_invocation" ||
            (toolName !== null && toolName.toLowerCase() === "skill");
          if (isSkillInvocation) {
            const existingInvocation = skillInvocationsById.get(callId);
            const toolArgs = jsonRecord(eventPayload.tool_args);
            const skillName =
              optionalString(eventPayload.skill_name) ??
              optionalString(eventPayload.requested_name) ??
              optionalString(toolArgs?.name) ??
              existingInvocation?.skillName ??
              "unknown";
            const skillId = optionalString(eventPayload.skill_id) ?? existingInvocation?.skillId ?? null;
            const completed = eventPayload.phase === "completed" || existingInvocation?.completed === true;
            const error = eventPayload.error === true || existingInvocation?.error === true;
            skillInvocationsById.set(callId, {
              skillName,
              skillId,
              completed,
              error,
            });
          }
        }
        if (event.event_type === "skill_invocation") {
          const scope = optionalString(eventPayload.widening_scope);
          if (scope) {
            wideningAudit.scope = scope;
          }
          if (typeof eventPayload.workspace_boundary_override === "boolean") {
            wideningAudit.workspaceBoundaryOverride = eventPayload.workspace_boundary_override;
          }
          for (const toolName of stringList(eventPayload.managed_tools)) {
            wideningAudit.managedTools.add(toolName);
          }
          const grantedTools = stringList(eventPayload.granted_tools);
          for (const toolName of grantedTools) {
            wideningAudit.grantedTools.add(toolName);
          }
          for (const toolName of stringList(eventPayload.active_granted_tools)) {
            wideningAudit.activeGrantedTools.add(toolName);
          }
          for (const commandId of stringList(eventPayload.managed_commands)) {
            wideningAudit.managedCommands.add(commandId);
          }
          const grantedCommands = stringList(eventPayload.granted_commands);
          for (const commandId of grantedCommands) {
            wideningAudit.grantedCommands.add(commandId);
          }
          for (const commandId of stringList(eventPayload.active_granted_commands)) {
            wideningAudit.activeGrantedCommands.add(commandId);
          }
          if (eventPayload.phase === "completed" && (grantedTools.length > 0 || grantedCommands.length > 0)) {
            wideningAudit.activationCount += 1;
          }
        }
        if (event.event_type === "tool_call" && isSkillPolicyDeniedPayload(eventPayload)) {
          wideningAudit.deniedCalls += 1;
          const toolName = optionalString(eventPayload.tool_name);
          if (toolName) {
            wideningAudit.deniedToolNames.add(toolName);
          }
        }
        if (event.event_type === "run_completed") {
          terminalStatus = terminalStatusForCompletedPayload(eventPayload, harnessSupportsWaitingUser);
          completedAt = eventTimestamp;
          stopReason = stopReasonForTerminalEvent({
            eventType: "run_completed",
            payload: eventPayload,
            terminalStatus,
          });
          tokenUsage = tokenUsageFromPayload(eventPayload) ?? tokenUsage;
        }
        if (event.event_type === "run_failed") {
          terminalStatus = "ERROR";
          lastError = eventPayload;
          completedAt = eventTimestamp;
          stopReason = stopReasonForTerminalEvent({
            eventType: "run_failed",
            payload: eventPayload,
            terminalStatus,
          });
          tokenUsage = tokenUsageFromPayload(eventPayload) ?? tokenUsage;
        }
      }
    });

    const persistedTerminalEvent = latestPersistedTerminalOutputEvent({
      store,
      sessionId: record.sessionId,
      inputId: record.inputId,
    });

    if (persistedTerminalEvent) {
      const persistedPayload = persistedTerminalEvent.payload;
      deferredTerminalEvent = null;
      if (persistedTerminalEvent.eventType === "run_completed") {
        terminalStatus = terminalStatusForCompletedPayload(
          persistedPayload,
          harnessSupportsWaitingUser,
        );
        lastError = null;
        completedAt = persistedTerminalEvent.createdAt;
        stopReason = stopReasonForTerminalEvent({
          eventType: "run_completed",
          payload: persistedPayload,
          terminalStatus,
        });
        tokenUsage = tokenUsageFromPayload(persistedPayload) ?? tokenUsage;
      } else {
        terminalStatus = "ERROR";
        lastError = persistedPayload;
        completedAt = persistedTerminalEvent.createdAt;
        stopReason = stopReasonForTerminalEvent({
          eventType: "run_failed",
          payload: persistedPayload,
          terminalStatus,
        });
        tokenUsage = tokenUsageFromPayload(persistedPayload) ?? tokenUsage;
      }
    } else if (execution.aborted && !execution.sawTerminal) {
      if (execution.abortReason === "user_requested_pause") {
        const pausedAt = new Date().toISOString();
        const completed = buildRunCompletedEvent({
          sessionId: record.sessionId,
          inputId: record.inputId,
          sequence: lastSequence + 1,
          payload: {
            status: "paused",
            stop_reason: "paused",
            message: "Run paused by user request",
          },
        });
        const completedPayload = payloadForEvent(completed);
        lastSequence = Math.max(lastSequence, typeof completed.sequence === "number" ? completed.sequence : lastSequence + 1);
        deferredTerminalEvent = {
          eventType: "run_completed",
          payload: completedPayload,
          createdAt: pausedAt,
        };
        terminalStatus = "PAUSED";
        lastError = null;
        completedAt = pausedAt;
        stopReason = stopReasonForTerminalEvent({
          eventType: "run_completed",
          payload: completedPayload,
          terminalStatus,
        });
      } else {
        const failedAt = new Date().toISOString();
        const failure = buildRunFailedEvent({
          sessionId: record.sessionId,
          inputId: record.inputId,
          sequence: lastSequence + 1,
          message:
            execution.abortReason === "claim_expired"
              ? "claimed input lease expired before the runner emitted a terminal event"
              : execution.stderr.trim() ||
                (execution.abortReason
                  ? `runner aborted before terminal event: ${execution.abortReason}`
                  : "runner aborted before terminal event"),
          errorType: "RuntimeError"
        });
        const failurePayload = payloadForEvent(failure);
        lastSequence = Math.max(lastSequence, typeof failure.sequence === "number" ? failure.sequence : lastSequence + 1);
        deferredTerminalEvent = {
          eventType: "run_failed",
          payload: failurePayload,
          createdAt: failedAt,
        };
        terminalStatus = "ERROR";
        lastError = failurePayload;
        completedAt = failedAt;
        stopReason = stopReasonForTerminalEvent({
          eventType: "run_failed",
          payload: failurePayload,
          terminalStatus,
        });
      }
    } else if (!execution.sawTerminal) {
      const details = execution.skippedLines.length > 0 ? execution.skippedLines.slice(0, 3).join("; ") : "";
      const suffix = details ? ` (skipped output: ${details})` : "";
      const failure = buildRunFailedEvent({
        sessionId: record.sessionId,
        inputId: record.inputId,
        sequence: lastSequence + 1,
        message:
          execution.returnCode !== 0
            ? execution.stderr.trim() || `runner command failed with exit_code=${execution.returnCode}`
            : `runner ended before terminal event${suffix}`,
        errorType: execution.returnCode !== 0 ? "RunnerCommandError" : "RuntimeError"
      });
      const failurePayload = payloadForEvent(failure);
      lastSequence = Math.max(lastSequence, typeof failure.sequence === "number" ? failure.sequence : lastSequence + 1);
      deferredTerminalEvent = {
        eventType: "run_failed",
        payload: failurePayload,
        createdAt: new Date().toISOString(),
      };
      terminalStatus = "ERROR";
      lastError = failurePayload;
      completedAt = new Date().toISOString();
      stopReason = stopReasonForTerminalEvent({
        eventType: "run_failed",
        payload: failurePayload,
        terminalStatus,
      });
    }

    store.updateInput(record.inputId, {
      status: terminalStatus === "ERROR" ? "FAILED" : terminalStatus === "PAUSED" ? "PAUSED" : "DONE",
      claimedUntil: null
    });
    store.updateRuntimeState({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      status: terminalStatus,
      currentInputId: null,
      currentWorkerId: null,
      leaseUntil: null,
      heartbeatAt: null,
      lastError
    });

    if (workspaceFileManifestBefore) {
      try {
        const fileOutputs = detectWorkspaceFileOutputs({
          workspaceDir,
          before: workspaceFileManifestBefore
        });
        const existingOutputPaths = new Set(
          store
            .listOutputs({
              workspaceId: record.workspaceId,
              sessionId: record.sessionId,
              inputId: record.inputId,
              limit: 1000,
              offset: 0,
            })
            .map((output) => output.filePath)
            .filter((filePath): filePath is string => typeof filePath === "string" && filePath.length > 0),
        );
        for (const output of fileOutputs) {
          if (existingOutputPaths.has(output.filePath)) {
            continue;
          }
          store.createOutput({
            workspaceId: record.workspaceId,
            outputType: output.outputType,
            title: output.title,
            status: "completed",
            filePath: output.filePath,
            sessionId: record.sessionId,
            inputId: record.inputId,
            metadata: output.metadata
          });
          existingOutputPaths.add(output.filePath);
        }
      } catch {
        // Output capture is best-effort and should not fail the turn.
      }
    }

    const assistantText = assistantParts.join("").trim();
    const hasPersistedOutputs =
      store.listOutputs({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        inputId: record.inputId,
        limit: 1,
        offset: 0
      }).length > 0;
    const hasPersistedMemoryProposals =
      store.listMemoryUpdateProposals({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        inputId: record.inputId,
        limit: 1,
        offset: 0,
      }).length > 0;
    if (assistantText || hasPersistedOutputs || hasPersistedMemoryProposals) {
      store.insertSessionMessage({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        role: "assistant",
        text: assistantText,
        messageId: `assistant-${record.inputId}`
      });
    }
    const turnResult = persistTurnResult({
      store,
      record,
      startedAt: turnStartedAt,
      completedAt: completedAt ?? new Date().toISOString(),
      terminalStatus,
      stopReason,
      assistantText,
      toolUsageSummary: summarizeToolCalls(toolCallsById, skillInvocationsById, wideningAudit),
      permissionDenials,
      promptSectionIds,
      capabilityManifestFingerprint,
      requestSnapshotFingerprint,
      promptCacheProfile,
      tokenUsage,
    });
    try {
      await maybePromoteAcceptedEvolveSkillCandidate({
        store,
        record,
        turnResult,
        memoryService: params.memoryService,
      });
    } catch {
      // Skill promotion is best-effort and should not fail the completed turn.
    }
    if (deferredTerminalEvent) {
      lastSequence = appendNextOutputEvent({
        store,
        record,
        lastSequence,
        eventType: deferredTerminalEvent.eventType,
        payload: deferredTerminalEvent.payload,
        createdAt: deferredTerminalEvent.createdAt,
      });
      deferredTerminalEvent = null;
    }
    await (params.runEvolveTasksFn ?? runEvolveTasks)({
      store,
      record,
      turnResult,
      memoryService: params.memoryService,
      modelContext: memoryWritebackModelContext,
      wakeDurableMemoryWorker: params.wakeDurableMemoryWorker ?? null,
      onTaskError: params.onEvolveTaskError,
    });
    maybeCreateCronjobCompletionNotification({
      store,
      record,
      turnResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateInput(record.inputId, {
      status: "FAILED",
      claimedUntil: null
    });
    store.appendOutputEvent({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      inputId: record.inputId,
      sequence: Math.max(0, lastSequence) + 1,
      eventType: "run_failed",
      payload: { message }
    });
    store.updateRuntimeState({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      status: "ERROR",
      currentInputId: null,
      currentWorkerId: null,
      leaseUntil: null,
      heartbeatAt: null,
      lastError: { message }
    });
    const turnResult = persistTurnResult({
      store,
      record,
      startedAt: turnStartedAt,
      completedAt: new Date().toISOString(),
      terminalStatus: "ERROR",
      stopReason: "executor_error",
      assistantText: "",
      toolUsageSummary: summarizeToolCalls(new Map()),
      permissionDenials: [],
      promptSectionIds: [],
      capabilityManifestFingerprint: null,
      requestSnapshotFingerprint: null,
      promptCacheProfile: null,
      tokenUsage: null,
    });
    await (params.runEvolveTasksFn ?? runEvolveTasks)({
      store,
      record,
      turnResult,
      memoryService: params.memoryService,
      modelContext: memoryWritebackModelContext,
      wakeDurableMemoryWorker: params.wakeDurableMemoryWorker ?? null,
      onTaskError: params.onEvolveTaskError,
    });
    maybeCreateCronjobCompletionNotification({
      store,
      record,
      turnResult,
    });
  }
}
