import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import yauzl from "yauzl";

import {
  type AgentSessionRecord,
  type AppBuildRecord,
  type CompactionBoundaryRecord,
  type CronjobRecord,
  type MemoryUpdateProposalRecord,
  type OutputFolderRecord,
  type OutputRecord,
  type RuntimeNotificationRecord,
  type SessionMessageRecord,
  type SessionRuntimeStateRecord,
  type TaskProposalRecord,
  type OutputEventRecord,
  type TurnRequestSnapshotRecord,
  type TurnResultRecord,
  type RuntimeUserProfileRecord,
  RuntimeStateStore,
  utcNowIso,
  type WorkspaceRecord
} from "@holaboss/runtime-state-store";

import {
  type QueueWorkerLike,
  RuntimeQueueWorker
} from "./queue-worker.js";
import {
  type CronWorkerLike,
  RuntimeCronWorker,
  cronjobNextRunAt
} from "./cron-worker.js";
import {
  type BridgeWorkerLike,
  RuntimeRemoteBridgeWorker,
  tsBridgeWorkerEnabled
} from "./bridge-worker.js";
import {
  AppLifecycleExecutorError,
  appBuildHasCompletedSetup,
  isAppHealthy,
  type AppLifecycleExecutorLike,
  RuntimeAppLifecycleExecutor
} from "./app-lifecycle-worker.js";
import {
  FilesystemMemoryService,
  MemoryServiceError,
  type MemoryServiceLike
} from "./memory.js";
import {
  FileRuntimeConfigService,
  RuntimeConfigServiceError,
  type RuntimeConfigServiceLike
} from "./runtime-config.js";
import {
  DesktopBrowserToolService,
  DesktopBrowserToolServiceError,
  type DesktopBrowserToolServiceLike
} from "./desktop-browser-tools.js";
import {
  IntegrationServiceError,
  RuntimeIntegrationService
} from "./integrations.js";
import { BrokerError, IntegrationBrokerService } from "./integration-broker.js";
import { OAuthService } from "./oauth-service.js";
import { ComposioService } from "./composio-service.js";
import {
  RuntimeAgentToolsService,
  RuntimeAgentToolsServiceError,
} from "./runtime-agent-tools.js";
import {
  appendWorkspaceApplication,
  listWorkspaceComposeShutdownTargets,
  listWorkspaceApplicationPorts,
  listWorkspaceApplications,
  parseInstalledAppRuntime,
  portsForAppIndex,
  releaseWorkspaceAppPorts,
  removeWorkspaceApplication,
  resolveWorkspaceApp,
  resolveWorkspaceAppRuntime,
  type ParsedInstalledApp
} from "./workspace-apps.js";
import {
  NativeRunnerExecutor,
  RunnerExecutorError,
  type RunnerExecutorLike,
} from "./runner-worker.js";
import { killChildProcess, spawnShellCommand } from "./runtime-shell.js";
import { startResolvedApplications } from "./resolved-app-bootstrap.js";
import { buildAppSetupEnv } from "./app-setup-env.js";
import { collectWorkspaceSnapshot } from "./workspace-snapshot.js";
import {
  compactionRestorationContextFromCompactionBoundary,
  recentRuntimeContextFromCompactionBoundary,
  recentRuntimeContextFromTurnResult,
  sessionResumeContextFromArtifacts,
  sessionResumeContextFromCompactionBoundary,
} from "./turn-result-summary.js";
import {
  buildMemoryUpdateProposalsFromUserInput,
  durableMemoryCandidateFromAcceptedProposal,
  runtimeUserProfileUpdateFromAcceptedProposal,
} from "./user-memory-proposals.js";
import {
  persistDurableMemoryCandidate,
  refreshMemoryIndexes,
} from "./turn-memory-writeback.js";
import { captureWorkspaceContext } from "./proactive-context.js";

const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_APP_SETUP_TIMEOUT_MS = 900_000;
const TERMINAL_EVENT_TYPES = new Set(["run_completed", "run_failed"]);
export interface BuildRuntimeApiServerOptions {
  logger?: boolean;
  store?: RuntimeStateStore;
  dbPath?: string;
  workspaceRoot?: string;
  queueWorker?: QueueWorkerLike | null;
  cronWorker?: CronWorkerLike | null;
  bridgeWorker?: BridgeWorkerLike | null;
  appLifecycleExecutor?: AppLifecycleExecutorLike;
  memoryService?: MemoryServiceLike;
  runtimeConfigService?: RuntimeConfigServiceLike;
  browserToolService?: DesktopBrowserToolServiceLike;
  runnerExecutor?: RunnerExecutorLike;
  enableAppHealthMonitor?: boolean;
  startAppsOnReady?: boolean;
}

function resolveQueueWorker(
  options: BuildRuntimeApiServerOptions,
  app: FastifyInstance,
  store: RuntimeStateStore,
  memoryService: MemoryServiceLike
): QueueWorkerLike | null {
  if (options.queueWorker !== undefined) {
    return options.queueWorker;
  }
  return new RuntimeQueueWorker({ store, logger: app.log, memoryService });
}

function resolveCronWorker(
  options: BuildRuntimeApiServerOptions,
  app: FastifyInstance,
  store: RuntimeStateStore,
  queueWorker: QueueWorkerLike | null
): CronWorkerLike | null {
  if (options.cronWorker !== undefined) {
    return options.cronWorker;
  }
  return new RuntimeCronWorker({ store, logger: app.log, queueWorker });
}

function resolveBridgeWorker(
  options: BuildRuntimeApiServerOptions,
  app: FastifyInstance,
  store: RuntimeStateStore,
  memoryService: MemoryServiceLike
): BridgeWorkerLike | null {
  if (options.bridgeWorker !== undefined) {
    return options.bridgeWorker;
  }
  if (!tsBridgeWorkerEnabled()) {
    return null;
  }
  try {
    return new RuntimeRemoteBridgeWorker({ logger: app.log, store, memoryService });
  } catch (error) {
    app.log.warn(
      {
        event: "runtime.proactive_bridge.disabled",
        reason: error instanceof Error ? error.message : String(error)
      },
      "Remote proactive bridge disabled during startup"
    );
    return null;
  }
}

type StringMap = Record<string, unknown>;

interface SessionInputAttachmentPayload {
  id: string;
  kind: "image" | "file";
  name: string;
  mime_type: string;
  size_bytes: number;
  workspace_path: string;
}

function defaultWorkspaceRoot(): string | undefined {
  const sandboxRoot = (process.env.HB_SANDBOX_ROOT ?? "").trim();
  if (!sandboxRoot) {
    return undefined;
  }
  return `${sandboxRoot.replace(/\/+$/, "")}/workspace`;
}

function isRecord(value: unknown): value is StringMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: StringMap, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

function optionalInteger(value: unknown, defaultValue: number): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

function appSetupTimeoutMs(): number {
  const rawValue = process.env.HB_APP_SETUP_TIMEOUT_MS ?? process.env.APP_SETUP_TIMEOUT_MS;
  if (typeof rawValue === "string" && rawValue.trim().length > 0) {
    const parsed = Number.parseInt(rawValue.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_APP_SETUP_TIMEOUT_MS;
}

function optionalDict(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function requiredDict(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value;
}

function capabilityWorkspaceId(params: {
  headers: Record<string, unknown>;
  query?: Record<string, unknown> | null;
  body?: Record<string, unknown> | null;
}): string {
  return (
    headerString(params.headers, "x-holaboss-workspace-id") ||
    optionalString(params.query?.workspace_id) ||
    optionalString(params.body?.workspace_id) ||
    ""
  );
}

function requiredCapabilityWorkspaceId(params: {
  headers: Record<string, unknown>;
  query?: Record<string, unknown> | null;
  body?: Record<string, unknown> | null;
}): string {
  const workspaceId = capabilityWorkspaceId(params);
  if (!workspaceId) {
    throw new Error("workspace_id is required");
  }
  return workspaceId;
}

function requiredCronjobDeliveryInput(value: unknown): {
  channel: string;
  mode?: string;
  to?: unknown;
} {
  const delivery = requiredDict(value, "delivery");
  return {
    channel: requiredString(delivery.channel, "delivery.channel"),
    mode: optionalString(delivery.mode),
    to: delivery.to
  };
}

function optionalCronjobDeliveryInput(value: unknown): {
  channel: string;
  mode?: string;
  to?: unknown;
} | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredCronjobDeliveryInput(value);
}

function optionalStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function headerString(headers: Record<string, unknown>, key: string): string {
  const raw = headers[key];
  if (Array.isArray(raw)) {
    return typeof raw[0] === "string" ? raw[0].trim() : "";
  }
  return typeof raw === "string" ? raw.trim() : "";
}

function parseSessionInputAttachment(value: unknown): SessionInputAttachmentPayload | null {
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

function requiredSessionInputAttachments(value: unknown, workspaceDir: string): SessionInputAttachmentPayload[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("attachments must be an array");
  }

  return value.map((item, index) => {
    const attachment = parseSessionInputAttachment(item);
    if (!attachment) {
      throw new Error(`attachments[${index}] is invalid`);
    }

    const fullPath = resolveWorkspaceFilePath(workspaceDir, attachment.workspace_path);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      throw new Error(`attachment file not found: ${attachment.workspace_path}`);
    }

    return attachment;
  });
}

function attachmentsFromInputPayload(value: unknown): SessionInputAttachmentPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseSessionInputAttachment(item)).filter((item): item is SessionInputAttachmentPayload => Boolean(item));
}

function workspaceRecordPayload(workspace: WorkspaceRecord): Record<string, unknown> {
  return {
    id: workspace.id,
    name: workspace.name,
    status: workspace.status,
    harness: workspace.harness,
    main_session_id: workspace.mainSessionId,
    error_message: workspace.errorMessage,
    onboarding_status: workspace.onboardingStatus,
    onboarding_session_id: workspace.onboardingSessionId,
    onboarding_completed_at: workspace.onboardingCompletedAt,
    onboarding_completion_summary: workspace.onboardingCompletionSummary,
    onboarding_requested_at: workspace.onboardingRequestedAt,
    onboarding_requested_by: workspace.onboardingRequestedBy,
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
    deleted_at_utc: workspace.deletedAtUtc
  };
}

function agentSessionPayload(record: AgentSessionRecord): Record<string, unknown> {
  return {
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    kind: record.kind,
    title: record.title,
    parent_session_id: record.parentSessionId,
    source_proposal_id: record.sourceProposalId,
    created_by: record.createdBy,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    archived_at: record.archivedAt
  };
}

function runtimeStatePayload(record: SessionRuntimeStateRecord): Record<string, unknown> {
  return {
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    status: record.status,
    current_input_id: record.currentInputId,
    current_worker_id: record.currentWorkerId,
    lease_until: record.leaseUntil,
    heartbeat_at: record.heartbeatAt,
    last_error: record.lastError,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

function sessionMessagePayload(record: SessionMessageRecord, metadata?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: record.id,
    role: record.role,
    text: record.text,
    created_at: record.createdAt,
    metadata: metadata ?? record.metadata
  };
}

function outputEventPayload(record: OutputEventRecord): Record<string, unknown> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    input_id: record.inputId,
    sequence: record.sequence,
    event_type: record.eventType,
    payload: record.payload,
    created_at: record.createdAt
  };
}

function turnResultPayload(record: TurnResultRecord): Record<string, unknown> {
  return {
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    input_id: record.inputId,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    status: record.status,
    stop_reason: record.stopReason,
    assistant_text: record.assistantText,
    tool_usage_summary: record.toolUsageSummary,
    permission_denials: record.permissionDenials,
    prompt_section_ids: record.promptSectionIds,
    capability_manifest_fingerprint: record.capabilityManifestFingerprint,
    request_snapshot_fingerprint: record.requestSnapshotFingerprint,
    prompt_cache_profile: record.promptCacheProfile,
    compacted_summary: record.compactedSummary,
    compaction_boundary_id: record.compactionBoundaryId,
    token_usage: record.tokenUsage,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function turnRequestSnapshotPayload(record: TurnRequestSnapshotRecord): Record<string, unknown> {
  return {
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    input_id: record.inputId,
    snapshot_kind: record.snapshotKind,
    fingerprint: record.fingerprint,
    payload: record.payload,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function compactionBoundaryPayload(record: CompactionBoundaryRecord): Record<string, unknown> {
  return {
    boundary_id: record.boundaryId,
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    input_id: record.inputId,
    boundary_type: record.boundaryType,
    previous_boundary_id: record.previousBoundaryId,
    summary: record.summary,
    recent_runtime_context: record.recentRuntimeContext,
    restoration_context: record.restorationContext,
    compaction_restoration_context: compactionRestorationContextFromCompactionBoundary(record),
    preserved_turn_input_ids: record.preservedTurnInputIds,
    request_snapshot_fingerprint: record.requestSnapshotFingerprint,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function runtimeUserProfilePayload(record: RuntimeUserProfileRecord | null, profileId = "default"): Record<string, unknown> {
  return {
    profile_id: record?.profileId ?? profileId,
    name: record?.name ?? null,
    name_source: record?.nameSource ?? null,
    created_at: record?.createdAt ?? null,
    updated_at: record?.updatedAt ?? null,
  };
}

function artifactTypeFromOutputRecord(record: OutputRecord): string {
  const metadataArtifactType =
    typeof record.metadata.artifact_type === "string" ? record.metadata.artifact_type.trim() : "";
  if (metadataArtifactType) {
    return metadataArtifactType;
  }
  if (record.outputType === "post") {
    return "draft";
  }
  if (record.outputType === "html") {
    return "html";
  }
  const category = typeof record.metadata.category === "string" ? record.metadata.category.trim() : "";
  if (category === "image") {
    return "image";
  }
  return "document";
}

function externalIdFromOutputRecord(record: OutputRecord): string {
  const metadataExternalId =
    typeof record.metadata.external_id === "string" ? record.metadata.external_id.trim() : "";
  if (metadataExternalId) {
    return metadataExternalId;
  }
  return record.moduleResourceId ?? record.filePath ?? record.artifactId ?? record.id;
}

function sessionArtifactPayload(record: OutputRecord): Record<string, unknown> {
  return {
    id: record.artifactId ?? record.id,
    session_id: record.sessionId,
    workspace_id: record.workspaceId,
    input_id: record.inputId,
    artifact_type: artifactTypeFromOutputRecord(record),
    external_id: externalIdFromOutputRecord(record),
    platform: record.platform,
    title: record.title || null,
    metadata: record.metadata,
    created_at: record.createdAt
  };
}

function outputFolderPayload(record: OutputFolderRecord): Record<string, unknown> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    name: record.name,
    position: record.position,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

function outputPayload(record: OutputRecord): Record<string, unknown> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    output_type: record.outputType,
    title: record.title,
    status: record.status,
    module_id: record.moduleId,
    module_resource_id: record.moduleResourceId,
    file_path: record.filePath,
    html_content: record.htmlContent,
    session_id: record.sessionId,
    input_id: record.inputId,
    artifact_id: record.artifactId,
    folder_id: record.folderId,
    platform: record.platform,
    metadata: record.metadata,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

function cronjobPayload(record: CronjobRecord): Record<string, unknown> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    initiated_by: record.initiatedBy,
    name: record.name,
    cron: record.cron,
    description: record.description,
    enabled: record.enabled,
    delivery: record.delivery,
    metadata: record.metadata,
    last_run_at: record.lastRunAt,
    next_run_at: record.nextRunAt,
    run_count: record.runCount,
    last_status: record.lastStatus,
    last_error: record.lastError,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

function runtimeNotificationPayload(record: RuntimeNotificationRecord): Record<string, unknown> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    cronjob_id: record.cronjobId,
    source_type: record.sourceType,
    source_label: record.sourceLabel,
    title: record.title,
    message: record.message,
    level: record.level,
    state: record.state,
    metadata: record.metadata,
    read_at: record.readAt,
    dismissed_at: record.dismissedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

function taskProposalPayload(record: TaskProposalRecord): Record<string, unknown> {
  return {
    proposal_id: record.proposalId,
    workspace_id: record.workspaceId,
    task_name: record.taskName,
    task_prompt: record.taskPrompt,
    task_generation_rationale: record.taskGenerationRationale,
    source_event_ids: record.sourceEventIds,
    created_at: record.createdAt,
    state: record.state,
    accepted_session_id: record.acceptedSessionId,
    accepted_input_id: record.acceptedInputId,
    accepted_at: record.acceptedAt
  };
}

function memoryUpdateProposalPayload(record: MemoryUpdateProposalRecord): Record<string, unknown> {
  return {
    proposal_id: record.proposalId,
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    input_id: record.inputId,
    proposal_kind: record.proposalKind,
    target_key: record.targetKey,
    title: record.title,
    summary: record.summary,
    payload: record.payload,
    evidence: record.evidence,
    confidence: record.confidence,
    source_message_id: record.sourceMessageId,
    state: record.state,
    persisted_memory_id: record.persistedMemoryId,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    accepted_at: record.acceptedAt,
    dismissed_at: record.dismissedAt,
  };
}

function resolvedWorkspaceHarness(workspace: WorkspaceRecord): string {
  const harness = (workspace.harness ?? process.env.SANDBOX_AGENT_HARNESS ?? "pi").trim();
  return harness || "pi";
}

function inferredSessionKind(workspace: WorkspaceRecord, sessionId: string): string {
  const trimmedSessionId = sessionId.trim();
  const onboardingSessionId = (workspace.onboardingSessionId ?? "").trim();
  const onboardingStatus = (workspace.onboardingStatus ?? "").trim().toLowerCase();
  if (onboardingSessionId && onboardingSessionId === trimmedSessionId && ["pending", "awaiting_confirmation", "in_progress"].includes(onboardingStatus)) {
    return "onboarding";
  }
  const mainSessionId = (workspace.mainSessionId ?? "").trim();
  if (mainSessionId && mainSessionId === trimmedSessionId) {
    return "main";
  }
  return "workspace_session";
}

function outputTypeForArtifact(artifactType: string): string {
  switch (artifactType) {
    case "draft":
      return "post";
    case "image":
      return "file";
    case "html":
      return "html";
    case "document":
    default:
      return "document";
  }
}

function resolveOutputInputId(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  sessionId: string;
  inputId?: string | null;
}): string | null {
  const requestedInputId = (params.inputId ?? "").trim();
  if (requestedInputId) {
    return requestedInputId;
  }
  const runtimeState = params.store.getRuntimeState({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
  });
  return runtimeState?.currentInputId?.trim() || null;
}

function resolveQueueSessionId(requestedSessionId: string | undefined, workspace: WorkspaceRecord): string {
  if (requestedSessionId && requestedSessionId.trim()) {
    return requestedSessionId.trim();
  }
  const onboardingStatus = (workspace.onboardingStatus ?? "").trim().toLowerCase();
  if (
    ["pending", "awaiting_confirmation"].includes(onboardingStatus) &&
    workspace.onboardingSessionId &&
    workspace.onboardingSessionId.trim()
  ) {
    return workspace.onboardingSessionId;
  }
  if (workspace.mainSessionId && workspace.mainSessionId.trim()) {
    return workspace.mainSessionId;
  }
  throw new Error("workspace main_session_id is not configured");
}

function activeUserPreferenceMemoryMatchesProposal(params: {
  entry: ReturnType<RuntimeStateStore["listMemoryEntries"]>[number];
  proposal: ReturnType<typeof buildMemoryUpdateProposalsFromUserInput>[number];
}): boolean {
  if (params.entry.scope !== "user" || params.entry.memoryType !== "preference") {
    return false;
  }
  if (params.entry.subjectKey !== params.proposal.targetKey) {
    return false;
  }
  if (params.proposal.targetKey === "response-style") {
    const style = optionalString(params.proposal.payload.style)?.toLowerCase();
    if (!style) {
      return params.entry.summary === params.proposal.summary;
    }
    return (
      params.entry.tags.some((tag) => tag.toLowerCase() === style) ||
      params.entry.summary.toLowerCase().includes(style)
    );
  }
  if (params.proposal.targetKey === "file-delivery") {
    return (
      params.entry.tags.some((tag) => ["individual-files", "no-zip"].includes(tag.toLowerCase())) ||
      params.entry.summary.toLowerCase().includes("deliver") ||
      params.entry.summary.toLowerCase().includes("zip")
    );
  }
  return params.entry.summary === params.proposal.summary;
}

function existingMemoryUpdateProposalMatches(params: {
  existing: MemoryUpdateProposalRecord;
  proposal: ReturnType<typeof buildMemoryUpdateProposalsFromUserInput>[number];
}): boolean {
  if (params.existing.proposalKind !== params.proposal.proposalKind) {
    return false;
  }
  if (params.existing.targetKey !== params.proposal.targetKey) {
    return false;
  }
  if (params.existing.summary === params.proposal.summary) {
    return true;
  }
  if (params.proposal.targetKey === "response-style") {
    return optionalString(params.existing.payload.style) === optionalString(params.proposal.payload.style);
  }
  if (params.proposal.targetKey === "file-delivery") {
    return true;
  }
  return false;
}

function createInputMemoryUpdateProposals(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  sessionId: string;
  inputId: string;
  sourceMessageId: string;
  text: string;
}): MemoryUpdateProposalRecord[] {
  if (!params.text.trim()) {
    return [];
  }
  const detected = buildMemoryUpdateProposalsFromUserInput(params.text);
  if (detected.length === 0) {
    return [];
  }
  const activeMemoryEntries = params.store.listMemoryEntries({
    status: "active",
    limit: 500,
    offset: 0,
  });
  const existingProposals = params.store.listMemoryUpdateProposals({
    workspaceId: params.workspaceId,
    limit: 500,
    offset: 0,
  });
  const createdAt = utcNowIso();
  const created: MemoryUpdateProposalRecord[] = [];
  for (const proposal of detected) {
    const alreadyPersisted = activeMemoryEntries.some((entry) =>
      activeUserPreferenceMemoryMatchesProposal({ entry, proposal })
    );
    if (alreadyPersisted) {
      continue;
    }
    const alreadyProposed = existingProposals.some((existing) =>
      existingMemoryUpdateProposalMatches({ existing, proposal })
    );
    if (alreadyProposed) {
      continue;
    }
    created.push(
      params.store.createMemoryUpdateProposal({
        proposalId: randomUUID(),
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
        inputId: params.inputId,
        proposalKind: proposal.proposalKind,
        targetKey: proposal.targetKey,
        title: proposal.title,
        summary: proposal.summary,
        payload: proposal.payload,
        evidence: proposal.evidence,
        confidence: proposal.confidence,
        sourceMessageId: params.sourceMessageId,
        createdAt,
        updatedAt: createdAt,
      })
    );
  }
  return created;
}

function effectiveSessionState(
  runtimeState: SessionRuntimeStateRecord | null,
  hasQueued: boolean
): {
  effective_state: string;
  runtime_status: string | null;
  current_input_id: string | null;
  heartbeat_at: string | null;
  lease_until: string | null;
} {
  const runtimeStatus = runtimeState?.status ?? null;
  let effectiveState = "IDLE";
  if (runtimeStatus && ["BUSY", "WAITING_USER", "ERROR"].includes(runtimeStatus)) {
    effectiveState = runtimeStatus;
  } else if (hasQueued) {
    effectiveState = "QUEUED";
  } else if (runtimeStatus) {
    effectiveState = runtimeStatus;
  }

  return {
    effective_state: effectiveState,
    runtime_status: runtimeStatus,
    current_input_id: runtimeState?.currentInputId ?? null,
    heartbeat_at: runtimeState?.heartbeatAt ?? null,
    lease_until: runtimeState?.leaseUntil ?? null
  };
}

function runnerOutputEventPayload(record: OutputEventRecord): Record<string, unknown> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    input_id: record.inputId,
    sequence: record.sequence,
    event_type: record.eventType,
    created_at: record.createdAt,
    timestamp: record.createdAt,
    payload: record.payload
  };
}

function sseComment(text: string): string {
  return `: ${text}\n\n`;
}

function sseEvent(record: OutputEventRecord): string {
  const event = runnerOutputEventPayload(record);
  return [
    `event: ${record.eventType}`,
    `id: ${record.inputId}:${record.sequence}`,
    `data: ${JSON.stringify(event)}`
  ].join("\n") + "\n\n";
}

function sendError(reply: FastifyReply, statusCode: number, detail: string) {
  return reply.code(statusCode).send({ detail });
}

function resolveWorkspaceFilePath(workspaceDir: string, relativePath: string): string {
  if (!relativePath || relativePath.split("/").includes("..")) {
    throw new Error("path traversal not allowed");
  }
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  const fullPath = path.resolve(resolvedWorkspaceDir, relativePath);
  if (fullPath !== resolvedWorkspaceDir && !fullPath.startsWith(`${resolvedWorkspaceDir}${path.sep}`)) {
    throw new Error("path traversal not allowed");
  }
  return fullPath;
}

class InvalidTemplateArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTemplateArchiveError";
  }
}

function invalidTemplateArchiveMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  if (error instanceof InvalidTemplateArchiveError) {
    return error.message;
  }
  if (
    error.message === "path traversal not allowed" ||
    /invalid relative path|absolute path|invalid characters/i.test(error.message)
  ) {
    return error.message;
  }
  return null;
}

function openZipFile(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error) {
        reject(error);
        return;
      }
      if (!zipFile) {
        reject(new Error("template extract failed"));
        return;
      }
      resolve(zipFile);
    });
  });
}

function openZipEntryReadStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      if (!stream) {
        reject(new Error(`missing zip stream for entry: ${entry.fileName}`));
        return;
      }
      resolve(stream);
    });
  });
}

async function extractTemplateZipArchive(zipPath: string, workspaceDir: string): Promise<number> {
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  const zipFile = await openZipFile(zipPath);
  let filesWritten = 0;

  return await new Promise<number>((resolve, reject) => {
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      zipFile.close();
      fn();
    };

    zipFile.on("error", (error) => {
      const message = invalidTemplateArchiveMessage(error);
      finish(() => reject(message ? new InvalidTemplateArchiveError(message) : error));
    });

    zipFile.on("entry", (entry) => {
      void (async () => {
        const validationError = yauzl.validateFileName(entry.fileName);
        if (validationError) {
          throw new InvalidTemplateArchiveError(validationError);
        }

        const normalizedPath = entry.fileName.replace(/\/+$/, "");
        if (!normalizedPath) {
          zipFile.readEntry();
          return;
        }

        const targetPath = resolveWorkspaceFilePath(resolvedWorkspaceDir, normalizedPath);
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(targetPath, { recursive: true });
          zipFile.readEntry();
          return;
        }

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        const source = await openZipEntryReadStream(zipFile, entry);
        const destination = fs.createWriteStream(targetPath, { mode: 0o644 });
        await pipeline(source, destination);

        const mode = (entry.externalFileAttributes >> 16) & 0o777;
        if (mode) {
          fs.chmodSync(targetPath, mode);
        }
        filesWritten += 1;
        zipFile.readEntry();
      })().catch((error) => {
        finish(() => reject(error));
      });
    });

    zipFile.on("end", () => {
      finish(() => resolve(filesWritten));
    });

    zipFile.readEntry();
  });
}

function sanitizeAppId(appId: string): string {
  const value = appId.trim();
  if (!value) {
    throw new Error("app_id is required");
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new Error("app_id must not contain path separators");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error("app_id contains invalid characters");
  }
  return value;
}

function collectSystemStatus(workspaceRoot: string, store: RuntimeStateStore): Record<string, unknown> {
  return {
    cpu: getCpuInfo(),
    memory: getMemoryInfo(),
    disk: getDiskInfo(),
    workspaces: getWorkspaceDiskInfo(workspaceRoot, store),
    uptime_seconds: os.uptime(),
  };
}

function getCpuInfo(): Record<string, unknown> {
  const numCores = os.cpus().length || 1;
  const loadAvg = os.loadavg()[0] ?? 0;
  const usagePercent = Math.round(Math.min((loadAvg / numCores) * 100, 100) * 10) / 10;
  return { usage_percent: usagePercent, num_cores: numCores };
}

function getMemoryInfo(): Record<string, unknown> {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const percent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;

  // Try cgroup v2 for container-aware limits
  try {
    const cgroupCurrent = "/sys/fs/cgroup/memory.current";
    const cgroupMax = "/sys/fs/cgroup/memory.max";
    if (fs.existsSync(cgroupCurrent) && fs.existsSync(cgroupMax)) {
      const used = Number.parseInt(fs.readFileSync(cgroupCurrent, "utf8").trim(), 10);
      const maxRaw = fs.readFileSync(cgroupMax, "utf8").trim();
      const total = maxRaw === "max" ? totalBytes : Number.parseInt(maxRaw, 10);
      const pct = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
      return { used_bytes: used, total_bytes: total, percent: pct };
    }
  } catch {
    // fall through to os-level stats
  }

  return { used_bytes: usedBytes, total_bytes: totalBytes, percent };
}

function getDiskInfo(): Record<string, unknown> {
  try {
    const result = spawnSync("df", ["-B1", "--output=size,used,avail", "/"], { timeout: 5000 });
    if (result.status === 0) {
      const lines = result.stdout.toString().trim().split("\n");
      if (lines.length >= 2) {
        const parts = (lines[1] ?? "").trim().split(/\s+/);
        const total = Number.parseInt(parts[0] ?? "0", 10);
        const used = Number.parseInt(parts[1] ?? "0", 10);
        const percent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
        return { used_bytes: used, total_bytes: total, percent };
      }
    }
  } catch {
    // fall through
  }
  return { used_bytes: 0, total_bytes: 0, percent: 0 };
}

function getWorkspaceDiskInfo(workspaceRoot: string, store: RuntimeStateStore): Record<string, unknown> {
  const byWorkspace: Record<string, number> = {};
  try {
    const workspaces = store.listWorkspaces({ includeDeleted: false });
    for (const ws of workspaces) {
      const wsDir = store.workspaceDir(ws.id);
      if (fs.existsSync(wsDir)) {
        byWorkspace[ws.id] = dirSize(wsDir);
      }
    }
  } catch {
    // best-effort
  }
  const totalBytes = Object.values(byWorkspace).reduce((sum, size) => sum + size, 0);
  return { count: Object.keys(byWorkspace).length, total_bytes: totalBytes, by_workspace: byWorkspace };
}

function dirSize(dirPath: string): number {
  let total = 0;
  try {
    const stack = [dirPath];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile() && !entry.isSymbolicLink()) {
          try {
            total += fs.statSync(fullPath).size;
          } catch {
            // skip inaccessible files
          }
        }
      }
    }
  } catch {
    // skip inaccessible dirs
  }
  return total;
}

function appBuildPayload(record: AppBuildRecord): Record<string, unknown> {
  return {
    workspace_id: record.workspaceId,
    app_id: record.appId,
    status: record.status,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    error: record.error,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

function fallbackAppBuildStatus(entry: Record<string, unknown>): string {
  const lifecycle = isRecord(entry.lifecycle) ? entry.lifecycle : null;
  return typeof lifecycle?.setup === "string" && lifecycle.setup.trim().length > 0 ? "pending" : "stopped";
}

function resolvedAppBuildStatus(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  appId: string;
  entry?: Record<string, unknown> | null;
}): string {
  const build = params.store.getAppBuild({
    workspaceId: params.workspaceId,
    appId: params.appId
  });
  if (build?.status) {
    return build.status;
  }
  return params.entry ? fallbackAppBuildStatus(params.entry) : "unknown";
}

function blockingWorkspaceApps(params: {
  store: RuntimeStateStore;
  workspaceId: string;
}): Array<{ appId: string; status: string }> {
  return listWorkspaceApplications(params.store.workspaceDir(params.workspaceId))
    .map((entry) => {
      const appId = typeof entry.app_id === "string" ? entry.app_id : "";
      return {
        appId,
        status: appId ? resolvedAppBuildStatus({ ...params, appId, entry }) : "unknown"
      };
    })
    .filter((entry) => entry.appId.length > 0 && entry.status !== "running");
}

function blockingWorkspaceAppsMessage(entries: Array<{ appId: string; status: string }>): string {
  if (entries.some((entry) => entry.status === "failed")) {
    return `workspace apps failed to start: ${entries.map((entry) => `${entry.appId} (${entry.status})`).join(", ")}`;
  }
  if (entries.some((entry) => entry.status === "building")) {
    return `workspace apps are still building: ${entries.map((entry) => `${entry.appId} (${entry.status})`).join(", ")}`;
  }
  return `workspace apps are still starting: ${entries.map((entry) => `${entry.appId} (${entry.status})`).join(", ")}`;
}

async function runAppSetup(params: {
  store: RuntimeStateStore;
  workspaceDir: string;
  workspaceId: string;
  appId: string;
  setupCommand: string;
}): Promise<void> {
  const appDir = path.join(params.workspaceDir, "apps", params.appId);
  params.store.upsertAppBuild({
    workspaceId: params.workspaceId,
    appId: params.appId,
    status: "building"
  });
  const setupTimeoutMs = appSetupTimeoutMs();

  try {
    const result = await new Promise<{ code: number | null; timedOut: boolean; stderr: string }>((resolve, reject) => {
      let stderr = "";
      let settled = false;
      const child = spawn(params.setupCommand, {
        cwd: appDir,
        env: buildAppSetupEnv(appDir),
        shell: true,
        stdio: ["ignore", "ignore", "pipe"]
      });
      const timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        killChildProcess(child, "SIGKILL");
        resolve({ code: null, timedOut: true, stderr });
      }, setupTimeoutMs);

      child.stderr?.on("data", (chunk: Buffer | string) => {
        if (stderr.length >= 2000) {
          return;
        }
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        stderr = `${stderr}${text}`.slice(0, 2000);
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        resolve({ code, timedOut: false, stderr });
      });
    });

    if (result.timedOut) {
      const timeoutSeconds = Math.max(1, Math.round(setupTimeoutMs / 1000));
      params.store.upsertAppBuild({
        workspaceId: params.workspaceId,
        appId: params.appId,
        status: "failed",
        error: `setup timed out after ${timeoutSeconds}s`
      });
      return;
    }
    if ((result.code ?? 0) !== 0) {
      params.store.upsertAppBuild({
        workspaceId: params.workspaceId,
        appId: params.appId,
        status: "failed",
        error: result.stderr
      });
      return;
    }
    params.store.upsertAppBuild({
      workspaceId: params.workspaceId,
      appId: params.appId,
      status: "completed"
    });
  } catch (error) {
    params.store.upsertAppBuild({
      workspaceId: params.workspaceId,
      appId: params.appId,
      status: "failed",
      error: (error instanceof Error ? error.message : String(error)).slice(0, 2000)
    });
  }
}

async function executeWorkspaceCommand(command: string, cwd: string, timeoutSeconds: number): Promise<{
  stdout: string;
  stderr: string;
  returncode: number;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawnShellCommand(spawn, command, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    if (!stdoutStream || !stderrStream) {
      reject(new Error("workspace exec subprocess streams were not initialized"));
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      killChildProcess(child, "SIGKILL");
      reject(new Error("workspace exec timed out"));
    }, Math.max(1, timeoutSeconds) * 1000);

    stdoutStream.setEncoding("utf8");
    stderrStream.setEncoding("utf8");
    stdoutStream.on("data", (chunk: string) => {
      stdout += chunk;
    });
    stderrStream.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      if (timedOut) {
        return;
      }
      resolve({
        stdout,
        stderr,
        returncode: code ?? 0
      });
    });
  });
}

export function buildRuntimeApiServer(options: BuildRuntimeApiServerOptions = {}): FastifyInstance {
  const ownsStore = !options.store;
  const store =
    options.store ??
    new RuntimeStateStore({
      dbPath: options.dbPath,
      workspaceRoot: options.workspaceRoot ?? defaultWorkspaceRoot()
    });

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
  });
  const backgroundTasks = new Set<Promise<void>>();
  const appSetupTasks = new Map<string, Promise<void>>();
  const appEnsureRunningTasks = new Map<string, Promise<void>>();
  const appLifecycleExecutor = options.appLifecycleExecutor ?? new RuntimeAppLifecycleExecutor({ store });
  const memoryService = options.memoryService ?? new FilesystemMemoryService({ workspaceRoot: store.workspaceRoot });
  const runtimeConfigService = options.runtimeConfigService ?? new FileRuntimeConfigService();
  const browserToolService = options.browserToolService ?? new DesktopBrowserToolService();
  const integrationService = new RuntimeIntegrationService(store);
  const honoBaseUrl = process.env.HOLABOSS_AUTH_BASE_URL ?? "";
  const authCookie = process.env.HOLABOSS_AUTH_COOKIE ?? "";
  const composioService = honoBaseUrl && authCookie
    ? new ComposioService({ honoBaseUrl, authCookie })
    : null;
  const brokerService = new IntegrationBrokerService(store, composioService);
  const oauthService = new OAuthService(store);
  const runtimeAgentToolsService = new RuntimeAgentToolsService(store);
  const runnerExecutor = options.runnerExecutor ?? new NativeRunnerExecutor();
  const queueWorker = resolveQueueWorker(options, app, store, memoryService);
  const cronWorker = resolveCronWorker(options, app, store, queueWorker);
  const bridgeWorker = resolveBridgeWorker(options, app, store, memoryService);

  // ---------------------------------------------------------------------------
  // App liveness: ensure enabled apps are running + health monitoring
  // ---------------------------------------------------------------------------

  const HEALTH_MONITOR_INTERVAL_MS = 30_000;
  const MAX_AUTO_RESTART_ATTEMPTS = 5;
  const autoRestartAttempts = new Map<string, number>();
  let healthMonitorTimer: ReturnType<typeof setInterval> | null = null;

  async function ensureAppRunning(workspaceId: string, appId: string): Promise<void> {
    const taskKey = `${workspaceId}:${appId}`;
    const inFlight = appEnsureRunningTasks.get(taskKey);
    if (inFlight) {
      await inFlight;
      return;
    }

    const task = (async () => {
      const workspaceDir = store.workspaceDir(workspaceId);
      const resolved = resolveWorkspaceAppRuntime(workspaceDir, appId, {
        store,
        workspaceId,
        allocatePorts: true
      });

      // Already healthy — sync DB and return.
      if (
        await isAppHealthy({
          resolvedApp: resolved.resolvedApp,
          httpPort: resolved.ports.http,
          mcpPort: resolved.ports.mcp
        })
      ) {
        store.upsertAppBuild({ workspaceId, appId, status: "running" });
        return;
      }

      // Setup needed?
      const build = store.getAppBuild({ workspaceId, appId });
      if (
        !appBuildHasCompletedSetup(build?.status) &&
        resolved.resolvedApp.lifecycle.setup.trim().length > 0
      ) {
        await runAppSetup({
          store,
          workspaceDir,
          workspaceId,
          appId,
          setupCommand: resolved.resolvedApp.lifecycle.setup
        });
        const afterSetup = store.getAppBuild({ workspaceId, appId });
        if (afterSetup?.status === "failed") {
          throw new Error(afterSetup.error ?? "setup failed");
        }
      }

      // Start app process.
      const result = await appLifecycleExecutor.startApp({
        appId,
        appDir: resolved.appDir,
        httpPort: resolved.ports.http,
        mcpPort: resolved.ports.mcp,
        resolvedApp: resolved.resolvedApp,
        skipSetup: true
      });
      store.upsertAppBuild({
        workspaceId,
        appId,
        status: result.status === "started" ? "running" : result.status
      });
    })();

    appEnsureRunningTasks.set(taskKey, task);
    try {
      await task;
    } finally {
      if (appEnsureRunningTasks.get(taskKey) === task) {
        appEnsureRunningTasks.delete(taskKey);
      }
    }
  }

  async function ensureAllAppsRunning(
    workspaceId: string
  ): Promise<{ apps: Array<{ app_id: string; ready: boolean; error: string | null }> }> {
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return { apps: [] };
    }
    const workspaceDir = store.workspaceDir(workspaceId);
    const entries = listWorkspaceApplications(workspaceDir);
    const validEntries = entries.filter(
      (e) => typeof e.app_id === "string" && e.app_id.length > 0
    );

    const results = await Promise.allSettled(
      validEntries.map((entry) => ensureAppRunning(workspaceId, entry.app_id as string))
    );

    return {
      apps: results.map((r, i) => ({
        app_id: validEntries[i].app_id as string,
        ready: r.status === "fulfilled",
        error:
          r.status === "rejected"
            ? (r.reason instanceof Error ? r.reason.message : String(r.reason)).slice(0, 2000)
            : null
      }))
    };
  }

  function appUsesIntegration(resolvedApp: {
    integrations?: Array<{ key: string; provider: string }>;
  }, integrationKey: string): boolean {
    const normalizedIntegrationKey = integrationKey.trim().toLowerCase();
    if (!normalizedIntegrationKey) {
      return false;
    }
    return (resolvedApp.integrations ?? []).some((requirement) => {
      return (
        requirement.key.trim().toLowerCase() === normalizedIntegrationKey ||
        requirement.provider.trim().toLowerCase() === normalizedIntegrationKey
      );
    });
  }

  async function refreshAppsForIntegrationBinding(params: {
    workspaceId: string;
    integrationKey: string;
    targetType: "workspace" | "app" | "agent";
    targetId: string;
  }): Promise<void> {
    if (params.targetType === "agent") {
      return;
    }

    const workspace = store.getWorkspace(params.workspaceId);
    if (!workspace) {
      return;
    }

    const workspaceDir = store.workspaceDir(params.workspaceId);
    const entries = listWorkspaceApplications(workspaceDir);
    for (const entry of entries) {
      const appId = typeof entry.app_id === "string" ? entry.app_id : "";
      if (!appId) {
        continue;
      }

      if (params.targetType === "app" && appId !== params.targetId) {
        continue;
      }

      const build = store.getAppBuild({ workspaceId: params.workspaceId, appId });
      if (!appBuildHasCompletedSetup(build?.status)) {
        continue;
      }

      let resolved;
      try {
        resolved = resolveWorkspaceAppRuntime(workspaceDir, appId, {
          store,
          workspaceId: params.workspaceId,
          allocatePorts: true
        });
      } catch (error) {
        app.log.warn(
          { workspaceId: params.workspaceId, appId, error: error instanceof Error ? error.message : String(error) },
          "skipping app refresh after integration binding because app runtime could not be resolved"
        );
        continue;
      }

      if (!appUsesIntegration(resolved.resolvedApp, params.integrationKey)) {
        continue;
      }

      await appLifecycleExecutor.stopApp({
        appId,
        appDir: resolved.appDir,
        resolvedApp: resolved.resolvedApp
      });
      store.upsertAppBuild({ workspaceId: params.workspaceId, appId, status: "stopped" });
      await ensureAppRunning(params.workspaceId, appId);
    }
  }

  async function stopWorkspaceApplicationsForDeletion(params: {
    workspaceId: string;
    workspaceDir: string;
  }): Promise<void> {
    let entries: Array<Record<string, unknown>> = [];
    try {
      entries = listWorkspaceApplications(params.workspaceDir);
    } catch (error) {
      app.log.debug(
        {
          workspaceId: params.workspaceId,
          error: error instanceof Error ? error.message : String(error)
        },
        "best-effort app listing failed during workspace delete"
      );
    }

    for (const entry of entries) {
      const appId = typeof entry.app_id === "string" ? entry.app_id.trim() : "";
      if (!appId) {
        continue;
      }
      const configPath = typeof entry.config_path === "string" ? entry.config_path.trim() : "";
      const fallbackAppDir = path.join(
        params.workspaceDir,
        configPath ? path.dirname(configPath) : path.join("apps", appId)
      );

      try {
        const resolved = resolveWorkspaceAppRuntime(params.workspaceDir, appId, {
          store,
          workspaceId: params.workspaceId
        });
        await appLifecycleExecutor.stopApp({
          appId,
          appDir: resolved.appDir,
          resolvedApp: resolved.resolvedApp
        });
      } catch (error) {
        try {
          await appLifecycleExecutor.stopApp({
            appId,
            appDir: fallbackAppDir
          });
        } catch (fallbackError) {
          app.log.debug(
            {
              workspaceId: params.workspaceId,
              appId,
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              original_error: error instanceof Error ? error.message : String(error)
            },
            "best-effort app stop failed during workspace delete"
          );
        }
      } finally {
        releaseWorkspaceAppPorts({ store, workspaceId: params.workspaceId, appId });
        store.deleteAppBuild({ workspaceId: params.workspaceId, appId });
      }
    }

    for (const appPort of store.listAppPorts({ workspaceId: params.workspaceId })) {
      store.deleteAppPort({ workspaceId: params.workspaceId, appId: appPort.appId });
    }
  }

  function startHealthMonitor(): void {
    if (healthMonitorTimer) {
      return;
    }
    healthMonitorTimer = setInterval(() => {
      void runHealthMonitorCycle();
    }, HEALTH_MONITOR_INTERVAL_MS);
  }

  async function runHealthMonitorCycle(): Promise<void> {
    let workspaces: WorkspaceRecord[];
    try {
      workspaces = store.listWorkspaces({ includeDeleted: false });
    } catch {
      return;
    }
    for (const ws of workspaces) {
      if (ws.status !== "active") {
        continue;
      }
      let entries: Array<Record<string, unknown>>;
      try {
        entries = listWorkspaceApplications(store.workspaceDir(ws.id));
      } catch {
        continue;
      }
      for (const entry of entries) {
        const appId = typeof entry.app_id === "string" ? entry.app_id : "";
        if (!appId) {
          continue;
        }
        const build = store.getAppBuild({ workspaceId: ws.id, appId });
        if (!appBuildHasCompletedSetup(build?.status)) {
          continue;
        }

        let resolved;
        try {
          resolved = resolveWorkspaceAppRuntime(store.workspaceDir(ws.id), appId, {
            store,
            workspaceId: ws.id
          });
        } catch {
          continue;
        }

        let healthy = false;
        try {
          healthy = await isAppHealthy({
            resolvedApp: resolved.resolvedApp,
            httpPort: resolved.ports.http,
            mcpPort: resolved.ports.mcp
          });
        } catch {
          // treat as unhealthy
        }

        const key = `${ws.id}:${appId}`;
        if (healthy) {
          autoRestartAttempts.delete(key);
          if (build?.status !== "running") {
            store.upsertAppBuild({ workspaceId: ws.id, appId, status: "running" });
          }
          continue;
        }

        const attempts = (autoRestartAttempts.get(key) ?? 0) + 1;
        autoRestartAttempts.set(key, attempts);
        if (attempts <= MAX_AUTO_RESTART_ATTEMPTS) {
          app.log.info({ workspaceId: ws.id, appId, attempt: attempts }, "health monitor: restarting unhealthy app");
          void ensureAppRunning(ws.id, appId).catch((err) => {
            app.log.error({ workspaceId: ws.id, appId, err: err instanceof Error ? err.message : String(err) }, "health monitor: restart failed");
          });
        } else if (attempts === MAX_AUTO_RESTART_ATTEMPTS + 1) {
          app.log.error({ workspaceId: ws.id, appId, attempts: attempts - 1 }, "health monitor: max restart attempts exceeded");
          store.upsertAppBuild({
            workspaceId: ws.id,
            appId,
            status: "failed",
            error: `App crashed and failed to recover after ${MAX_AUTO_RESTART_ATTEMPTS} attempts`
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------

  app.addHook("onClose", async () => {
    if (healthMonitorTimer) {
      clearInterval(healthMonitorTimer);
      healthMonitorTimer = null;
    }
    await bridgeWorker?.close();
    await cronWorker?.close();
    await queueWorker?.close();
    if (ownsStore) {
      store.close();
    }
  });

  app.addHook("onReady", async () => {
    await queueWorker?.start();
    await cronWorker?.start();
    await bridgeWorker?.start();
    if (options.enableAppHealthMonitor !== false) {
      startHealthMonitor();
    }

    if (options.startAppsOnReady !== false) {
      // Auto-start all enabled apps for active workspaces.
      const workspaces = store.listWorkspaces({ includeDeleted: false });
      for (const ws of workspaces) {
        if (ws.status === "active") {
          void ensureAllAppsRunning(ws.id).catch((err) => {
            app.log.error({ workspaceId: ws.id, err: err instanceof Error ? err.message : String(err) }, "auto-start apps on ready failed");
          });
        }
      }
    }
  });


  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/v1/runtime/config", async (request, reply) => {
    void request;
    try {
      return await runtimeConfigService.getConfig();
    } catch (error) {
      if (error instanceof RuntimeConfigServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "runtime config failed");
    }
  });

  app.get("/api/v1/runtime/status", async (request, reply) => {
    void request;
    try {
      return await runtimeConfigService.getStatus();
    } catch (error) {
      if (error instanceof RuntimeConfigServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "runtime status failed");
    }
  });

  app.get("/api/v1/runtime/system-status", async () => {
    return collectSystemStatus(store.workspaceRoot, store);
  });

  app.put("/api/v1/runtime/config", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return await runtimeConfigService.updateConfig(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof RuntimeConfigServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "runtime config update failed");
    }
  });

  app.get("/api/v1/runtime/profile", async (request, reply) => {
    void reply;
    const query = request.query as Record<string, unknown>;
    const profileId = optionalString(query.profile_id)?.trim() || "default";
    return runtimeUserProfilePayload(store.getRuntimeUserProfile({ profileId }), profileId);
  });

  app.put("/api/v1/runtime/profile", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const body = requiredDict(request.body, "body");
    const profileId = optionalString(body.profile_id)?.trim() || "default";
    const name = nullableString(body.name);
    const nameSource = nullableString(body.name_source);
    if (nameSource != null && !["manual", "agent", "auth_fallback"].includes(nameSource)) {
      return sendError(reply, 400, "name_source must be one of manual, agent, or auth_fallback");
    }
    const record = store.upsertRuntimeUserProfile({
      profileId,
      name: name ?? null,
      nameSource: (nameSource ?? null) as "manual" | "agent" | "auth_fallback" | null,
    });
    return runtimeUserProfilePayload(record);
  });

  app.post("/api/v1/runtime/profile/auth-fallback", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const body = requiredDict(request.body, "body");
    const profileId = optionalString(body.profile_id)?.trim() || "default";
    const name = requiredString(body.name, "name").trim();
    const record = store.applyRuntimeUserProfileAuthFallback({
      profileId,
      name,
    });
    return runtimeUserProfilePayload(record, profileId);
  });

  app.get("/api/v1/capabilities/browser", async (request, reply) => {
    const workspaceId = headerString(request.headers as Record<string, unknown>, "x-holaboss-workspace-id");
    try {
      return await browserToolService.getStatus({ workspaceId });
    } catch (error) {
      if (error instanceof DesktopBrowserToolServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "browser capability status failed");
    }
  });

  app.post("/api/v1/capabilities/browser/tools/:toolId", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { toolId: string };
    const workspaceId = headerString(request.headers as Record<string, unknown>, "x-holaboss-workspace-id");
    try {
      return await browserToolService.execute(requiredString(params.toolId, "toolId"), request.body, { workspaceId });
    } catch (error) {
      if (error instanceof DesktopBrowserToolServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "browser tool execution failed");
    }
  });

  app.get("/api/v1/integrations/catalog", async () => {
    return integrationService.getCatalog();
  });

  app.get("/api/v1/integrations/connections", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    try {
      return integrationService.listConnections({
        providerId: optionalString(query.provider_id),
        ownerUserId: optionalString(query.owner_user_id)
      });
    } catch (error) {
      if (error instanceof IntegrationServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "integration connections failed");
    }
  });

  app.post("/api/v1/integrations/connections", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return integrationService.createConnection({
        providerId: typeof request.body.provider_id === "string" ? request.body.provider_id : "",
        ownerUserId: typeof request.body.owner_user_id === "string" ? request.body.owner_user_id : "",
        accountLabel: typeof request.body.account_label === "string" ? request.body.account_label : "",
        authMode: typeof request.body.auth_mode === "string" ? request.body.auth_mode : "manual_token",
        grantedScopes: Array.isArray(request.body.granted_scopes) ? request.body.granted_scopes : [],
        secretRef: typeof request.body.secret_ref === "string" ? request.body.secret_ref : undefined,
        accountExternalId: typeof request.body.account_external_id === "string" ? request.body.account_external_id : undefined
      });
    } catch (error) {
      if (error instanceof IntegrationServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "connection creation failed");
    }
  });

  app.patch("/api/v1/integrations/connections/:connectionId", async (request, reply) => {
    const params = request.params as { connectionId: string };
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return integrationService.updateConnection(params.connectionId, {
        status: typeof request.body.status === "string" ? request.body.status : undefined,
        secretRef: typeof request.body.secret_ref === "string" ? request.body.secret_ref : undefined,
        accountLabel: typeof request.body.account_label === "string" ? request.body.account_label : undefined,
        grantedScopes: Array.isArray(request.body.granted_scopes) ? request.body.granted_scopes : undefined
      });
    } catch (error) {
      if (error instanceof IntegrationServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "connection update failed");
    }
  });

  app.delete("/api/v1/integrations/connections/:connectionId", async (request, reply) => {
    const params = request.params as { connectionId: string };
    try {
      return integrationService.deleteConnection(params.connectionId);
    } catch (error) {
      if (error instanceof IntegrationServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "connection deletion failed");
    }
  });

  app.get("/api/v1/integrations/bindings", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    try {
      return integrationService.listBindings({
        workspaceId
      });
    } catch (error) {
      if (error instanceof IntegrationServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "integration bindings failed");
    }
  });

  app.put("/api/v1/integrations/bindings/:workspaceId/:targetType/:targetId/:integrationKey", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as {
      workspaceId: string;
      targetType: string;
      targetId: string;
      integrationKey: string;
    };
    const connectionId = optionalString((request.body as Record<string, unknown>).connection_id);
    if (!connectionId) {
      return sendError(reply, 400, "connection_id is required");
    }
    try {
      const binding = integrationService.upsertBinding({
        workspaceId: requiredString(params.workspaceId, "workspaceId"),
        targetType: requiredString(params.targetType, "targetType"),
        targetId: requiredString(params.targetId, "targetId"),
        integrationKey: requiredString(params.integrationKey, "integrationKey"),
        connectionId,
        isDefault: optionalBoolean((request.body as Record<string, unknown>).is_default, false)
      });
      await refreshAppsForIntegrationBinding({
        workspaceId: binding.workspace_id,
        integrationKey: binding.integration_key,
        targetType: binding.target_type,
        targetId: binding.target_id
      });
      return binding;
    } catch (error) {
      if (error instanceof IntegrationServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "integration binding save failed");
    }
  });

  app.delete("/api/v1/integrations/bindings/:bindingId", async (request, reply) => {
    const params = request.params as { bindingId: string };
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    const bindingId = optionalString(params.bindingId);
    if (!bindingId) {
      return sendError(reply, 400, "bindingId is required");
    }
    try {
      return integrationService.deleteBinding(bindingId, workspaceId);
    } catch (error) {
      if (error instanceof IntegrationServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "integration binding delete failed");
    }
  });

  app.get("/api/v1/integrations/readiness", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    const appId = optionalString(query.app_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    if (!appId) {
      return sendError(reply, 400, "app_id is required");
    }
    try {
      return integrationService.checkReadiness({ workspaceId, appId });
    } catch (error) {
      if (error instanceof IntegrationServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "integration readiness check failed");
    }
  });

  app.post("/api/v1/integrations/broker/token", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const grant = typeof request.body.grant === "string" ? request.body.grant : "";
    const provider = typeof request.body.provider === "string" ? request.body.provider : "";
    if (!grant || !provider) {
      return sendError(reply, 400, "grant and provider are required");
    }
    try {
      return await brokerService.exchangeToken({ grant, provider });
    } catch (error) {
      if (error instanceof BrokerError) {
        return reply.status(error.statusCode).send({ error: error.code, message: error.message });
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "broker token exchange failed");
    }
  });

  app.post("/api/v1/integrations/broker/proxy", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const grant = typeof request.body.grant === "string" ? request.body.grant : "";
    const provider = typeof request.body.provider === "string" ? request.body.provider : "";
    const req = isRecord(request.body.request) ? request.body.request : null;
    if (!grant || !provider || !req) {
      return sendError(reply, 400, "grant, provider, and request are required");
    }
    const method = typeof req.method === "string" ? req.method : "GET";
    const endpoint = typeof req.endpoint === "string" ? req.endpoint : "";
    if (!endpoint) {
      return sendError(reply, 400, "request.endpoint is required");
    }
    try {
      return await brokerService.proxyProviderRequest({
        grant,
        provider,
        request: {
          method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
          endpoint,
          body: req.body
        }
      });
    } catch (error) {
      if (error instanceof BrokerError) {
        return reply.status(error.statusCode).send({ error: error.code, message: error.message });
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "broker proxy failed");
    }
  });
  app.get("/api/v1/integrations/oauth/configs", async () => {
    return { configs: store.listOAuthAppConfigs().map((c) => ({
      provider_id: c.providerId, client_id: c.clientId,
      client_secret: "••••••••",
      authorize_url: c.authorizeUrl, token_url: c.tokenUrl,
      scopes: c.scopes, redirect_port: c.redirectPort,
      created_at: c.createdAt, updated_at: c.updatedAt
    })) };
  });

  app.put("/api/v1/integrations/oauth/configs/:providerId", async (request, reply) => {
    const params = request.params as { providerId: string };
    if (!isRecord(request.body)) return sendError(reply, 400, "body required");
    try {
      const record = store.upsertOAuthAppConfig({
        providerId: params.providerId,
        clientId: typeof request.body.client_id === "string" ? request.body.client_id : "",
        clientSecret: typeof request.body.client_secret === "string" ? request.body.client_secret : "",
        authorizeUrl: typeof request.body.authorize_url === "string" ? request.body.authorize_url : "",
        tokenUrl: typeof request.body.token_url === "string" ? request.body.token_url : "",
        scopes: Array.isArray(request.body.scopes) ? request.body.scopes : [],
        redirectPort: typeof request.body.redirect_port === "number" ? request.body.redirect_port : undefined
      });
      return {
        provider_id: record.providerId, client_id: record.clientId,
        client_secret: "••••••••",
        authorize_url: record.authorizeUrl, token_url: record.tokenUrl,
        scopes: record.scopes, redirect_port: record.redirectPort,
        created_at: record.createdAt, updated_at: record.updatedAt
      };
    } catch (error) {
      return sendError(reply, 500, error instanceof Error ? error.message : "config save failed");
    }
  });

  app.delete("/api/v1/integrations/oauth/configs/:providerId", async (request, reply) => {
    const params = request.params as { providerId: string };
    if (!store.deleteOAuthAppConfig(params.providerId)) return sendError(reply, 404, "config not found");
    return { deleted: true };
  });

  app.post("/api/v1/integrations/oauth/authorize", async (request, reply) => {
    if (!isRecord(request.body)) return sendError(reply, 400, "body required");
    const providerId = typeof request.body.provider === "string" ? request.body.provider : "";
    const ownerUserId = typeof request.body.owner_user_id === "string" ? request.body.owner_user_id : "local";
    if (!providerId) return sendError(reply, 400, "provider is required");
    try {
      return await oauthService.startFlow(providerId, ownerUserId);
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "OAuth flow failed");
    }
  });

  // ---- Composio local connection creation (connect + account status handled by Hono server) ----

  app.post("/api/v1/integrations/composio/finalize", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const connectedAccountId = typeof request.body.connected_account_id === "string" ? request.body.connected_account_id : "";
    const provider = typeof request.body.provider === "string" ? request.body.provider : "";
    const ownerUserId = typeof request.body.owner_user_id === "string" ? request.body.owner_user_id : "local";
    const accountLabel = typeof request.body.account_label === "string" ? request.body.account_label : "";
    if (!connectedAccountId || !provider) {
      return sendError(reply, 400, "connected_account_id and provider are required");
    }
    try {
      const label = accountLabel || `${provider} (Managed)`;
      const connection = integrationService.createConnection({
        providerId: provider,
        ownerUserId,
        accountLabel: label,
        authMode: "composio",
        grantedScopes: [],
        accountExternalId: connectedAccountId
      });
      return connection;
    } catch (error) {
      if (error instanceof IntegrationServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 502, error instanceof Error ? error.message : "composio finalize failed");
    }
  });
  // ---- Runtime Agent Tools (onboarding, cronjobs) ----

  app.get("/api/v1/capabilities/runtime-tools", async (request) => {
    const workspaceId = capabilityWorkspaceId({
      headers: request.headers as Record<string, unknown>,
      query: isRecord(request.query) ? request.query : null
    });
    return runtimeAgentToolsService.capabilityStatus({ workspaceId });
  });

  app.get("/api/v1/capabilities/runtime-tools/onboarding/status", async (request, reply) => {
    try {
      return runtimeAgentToolsService.onboardingStatus(
        requiredCapabilityWorkspaceId({
          headers: request.headers as Record<string, unknown>,
          query: isRecord(request.query) ? request.query : null
        })
      );
    } catch (error) {
      if (error instanceof RuntimeAgentToolsServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 400, error instanceof Error ? error.message : "runtime onboarding status failed");
    }
  });

  app.post("/api/v1/capabilities/runtime-tools/onboarding/complete", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return runtimeAgentToolsService.completeOnboarding({
        workspaceId: requiredCapabilityWorkspaceId({
          headers: request.headers as Record<string, unknown>,
          body: request.body
        }),
        summary: requiredString(request.body.summary, "summary"),
        requestedBy: optionalString(request.body.requested_by)
      });
    } catch (error) {
      if (error instanceof RuntimeAgentToolsServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 400, error instanceof Error ? error.message : "runtime onboarding completion failed");
    }
  });

  app.get("/api/v1/capabilities/runtime-tools/cronjobs", async (request, reply) => {
    try {
      return runtimeAgentToolsService.listCronjobs({
        workspaceId: requiredCapabilityWorkspaceId({
          headers: request.headers as Record<string, unknown>,
          query: isRecord(request.query) ? request.query : null
        }),
        enabledOnly: optionalBoolean(isRecord(request.query) ? request.query.enabled_only : undefined, false)
      });
    } catch (error) {
      if (error instanceof RuntimeAgentToolsServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 400, error instanceof Error ? error.message : "runtime cronjob list failed");
    }
  });

  app.post("/api/v1/capabilities/runtime-tools/cronjobs", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return runtimeAgentToolsService.createCronjob({
        workspaceId: requiredCapabilityWorkspaceId({
          headers: request.headers as Record<string, unknown>,
          body: request.body
        }),
        initiatedBy: optionalString(request.body.initiated_by),
        name: optionalString(request.body.name),
        cron: requiredString(request.body.cron, "cron"),
        description: requiredString(request.body.description, "description"),
        enabled: optionalBoolean(request.body.enabled, true),
        delivery: optionalCronjobDeliveryInput(request.body.delivery),
        metadata: optionalDict(request.body.metadata) ?? undefined
      });
    } catch (error) {
      if (error instanceof RuntimeAgentToolsServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 400, error instanceof Error ? error.message : "runtime cronjob create failed");
    }
  });

  app.get("/api/v1/capabilities/runtime-tools/cronjobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    try {
      const payload = runtimeAgentToolsService.getCronjob({
        jobId: requiredString(params.jobId, "jobId"),
        workspaceId: capabilityWorkspaceId({
          headers: request.headers as Record<string, unknown>,
          query: isRecord(request.query) ? request.query : null
        })
      });
      if (!payload) {
        return sendError(reply, 404, "cronjob not found");
      }
      return payload;
    } catch (error) {
      if (error instanceof RuntimeAgentToolsServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 400, error instanceof Error ? error.message : "runtime cronjob fetch failed");
    }
  });

  app.patch("/api/v1/capabilities/runtime-tools/cronjobs/:jobId", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { jobId: string };
    try {
      return runtimeAgentToolsService.updateCronjob({
        jobId: requiredString(params.jobId, "jobId"),
        workspaceId: capabilityWorkspaceId({
          headers: request.headers as Record<string, unknown>,
          query: isRecord(request.query) ? request.query : null,
          body: request.body
        }),
        name: hasOwn(request.body, "name") ? nullableString(request.body.name) : undefined,
        cron: hasOwn(request.body, "cron") ? nullableString(request.body.cron) : undefined,
        description: hasOwn(request.body, "description") ? nullableString(request.body.description) : undefined,
        enabled: hasOwn(request.body, "enabled") ? optionalBoolean(request.body.enabled, false) : undefined,
        delivery: hasOwn(request.body, "delivery") ? optionalCronjobDeliveryInput(request.body.delivery) ?? null : undefined,
        metadata: hasOwn(request.body, "metadata") ? (optionalDict(request.body.metadata) ?? {}) : undefined
      });
    } catch (error) {
      if (error instanceof RuntimeAgentToolsServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 400, error instanceof Error ? error.message : "runtime cronjob update failed");
    }
  });

  app.delete("/api/v1/capabilities/runtime-tools/cronjobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    try {
      return runtimeAgentToolsService.deleteCronjob({
        jobId: requiredString(params.jobId, "jobId"),
        workspaceId: capabilityWorkspaceId({
          headers: request.headers as Record<string, unknown>,
          query: isRecord(request.query) ? request.query : null
        })
      });
    } catch (error) {
      if (error instanceof RuntimeAgentToolsServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 400, error instanceof Error ? error.message : "runtime cronjob delete failed");
    }
  });

  app.post("/api/v1/lifecycle/shutdown", async (request, reply) => {
    void request;
    try {
      const targets = store
        .listWorkspaces()
        .flatMap((workspace: WorkspaceRecord) => listWorkspaceComposeShutdownTargets(store.workspaceDir(workspace.id)));
      return await appLifecycleExecutor.shutdownAll({ targets });
    } catch (error) {
      if (error instanceof AppLifecycleExecutorError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "lifecycle shutdown failed");
    }
  });

  app.post("/api/v1/internal/workspaces/:workspaceId/resolved-apps/start", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { workspaceId: string };
    try {
      return await startResolvedApplications({
        store,
        appLifecycleExecutor,
        workspaceId: requiredString(params.workspaceId, "workspaceId"),
        body: request.body
      });
    } catch (error) {
      if (error instanceof AppLifecycleExecutorError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "resolved app startup failed");
    }
  });

  app.post("/api/v1/memory/search", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return await memoryService.search(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof MemoryServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "memory search failed");
    }
  });

  app.post("/api/v1/memory/get", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return await memoryService.get(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof MemoryServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "memory get failed");
    }
  });

  app.post("/api/v1/memory/upsert", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return await memoryService.upsert(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof MemoryServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "memory upsert failed");
    }
  });

  app.post("/api/v1/memory/status", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return await memoryService.status(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof MemoryServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "memory status failed");
    }
  });

  app.post("/api/v1/memory/sync", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return await memoryService.sync(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof MemoryServiceError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "memory sync failed");
    }
  });

  app.post("/api/v1/proactive/context/capture", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    let workspaceId = "";
    try {
      workspaceId = requiredString(request.body.workspace_id, "workspace_id");
      return {
        context: await captureWorkspaceContext({
          store,
          memoryService,
          workspaceId,
        }),
      };
    } catch (error) {
      if (workspaceId) {
        const message = error instanceof Error ? error.message : "workspace context capture failed";
        const statusCode = /\bnot found\b/i.test(message) ? 404 : 500;
        return sendError(reply, statusCode, message);
      }
      return sendError(reply, 400, error instanceof Error ? error.message : "workspace_id is required");
    }
  });

  app.post("/api/v1/agent-runs", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return await runnerExecutor.run(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof RunnerExecutorError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "agent run failed");
    }
  });

  app.post("/api/v1/agent-runs/stream", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      const stream = await runnerExecutor.stream(requiredDict(request.body, "body"));
      reply.header("Cache-Control", "no-cache");
      reply.header("Connection", "keep-alive");
      reply.header("X-Accel-Buffering", "no");
      reply.type("text/event-stream");
      return reply.send(stream);
    } catch (error) {
      if (error instanceof RunnerExecutorError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "agent run stream failed");
    }
  });

  function startBackgroundTask(task: Promise<void>): void {
    backgroundTasks.add(task);
    void task.finally(() => {
      backgroundTasks.delete(task);
    });
  }

  function queueAppSetup(params: {
    workspaceDir: string;
    workspaceId: string;
    appId: string;
    setupCommand: string;
  }): { status: "setup_started"; detail: string } {
    const taskKey = `${params.workspaceId}:${params.appId}`;
    const existingTask = appSetupTasks.get(taskKey);
    if (existingTask) {
      return {
        status: "setup_started",
        detail: "Setup already in progress"
      };
    }

    const build = store.getAppBuild({
      workspaceId: params.workspaceId,
      appId: params.appId
    });
    if (build?.status === "completed") {
      return {
        status: "setup_started",
        detail: "Setup already completed"
      };
    }

    const task = runAppSetup({
      store,
      workspaceDir: params.workspaceDir,
      workspaceId: params.workspaceId,
      appId: params.appId,
      setupCommand: params.setupCommand
    }).finally(() => {
      appSetupTasks.delete(taskKey);
    });
    appSetupTasks.set(taskKey, task);
    startBackgroundTask(task);
    return {
      status: "setup_started",
      detail: `Running: ${params.setupCommand}`
    };
  }

  app.post("/api/v1/workspaces", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }

    try {
      const created = store.createWorkspace({
        workspaceId: optionalString(request.body.workspace_id),
        name: requiredString(request.body.name, "name"),
        harness: requiredString(request.body.harness, "harness"),
        status: optionalString(request.body.status) ?? "provisioning",
        mainSessionId: nullableString(request.body.main_session_id) ?? null,
        onboardingStatus: optionalString(request.body.onboarding_status) ?? "not_required",
        onboardingSessionId: nullableString(request.body.onboarding_session_id) ?? null,
        errorMessage: nullableString(request.body.error_message) ?? null
      });

      let workspace = created;
      if (
        hasOwn(request.body, "onboarding_completed_at") ||
        hasOwn(request.body, "onboarding_completion_summary") ||
        hasOwn(request.body, "onboarding_requested_at") ||
        hasOwn(request.body, "onboarding_requested_by")
      ) {
        const updateFields: Record<string, string | null | undefined> = {};
        if (hasOwn(request.body, "onboarding_completed_at")) {
          updateFields.onboardingCompletedAt = nullableString(request.body.onboarding_completed_at);
        }
        if (hasOwn(request.body, "onboarding_completion_summary")) {
          updateFields.onboardingCompletionSummary = nullableString(request.body.onboarding_completion_summary);
        }
        if (hasOwn(request.body, "onboarding_requested_at")) {
          updateFields.onboardingRequestedAt = nullableString(request.body.onboarding_requested_at);
        }
        if (hasOwn(request.body, "onboarding_requested_by")) {
          updateFields.onboardingRequestedBy = nullableString(request.body.onboarding_requested_by);
        }
        workspace = store.updateWorkspace(created.id, {
          ...updateFields
        });
      }

      return reply.send({ workspace: workspaceRecordPayload(workspace) });
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "failed to create workspace");
    }
  });

  app.get("/api/v1/workspaces", async (request) => {
    const query = isRecord(request.query) ? request.query : {};
    const status = optionalString(query.status);
    const includeDeleted = optionalBoolean(query.include_deleted, false);
    const limit = Math.max(1, optionalInteger(query.limit, 50));
    const offset = Math.max(0, optionalInteger(query.offset, 0));

    let items = store.listWorkspaces({ includeDeleted });
    if (status) {
      items = items.filter((item: WorkspaceRecord) => item.status === status);
    }

    const paged = items.slice(offset, offset + limit);
    return {
      items: paged.map((item: WorkspaceRecord) => workspaceRecordPayload(item)),
      total: items.length,
      limit,
      offset
    };
  });

  app.get("/api/v1/workspaces/:workspaceId", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const query = isRecord(request.query) ? request.query : {};
    const workspace = store.getWorkspace(params.workspaceId, {
      includeDeleted: optionalBoolean(query.include_deleted, false)
    });
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }
    return { workspace: workspaceRecordPayload(workspace) };
  });

  app.patch("/api/v1/workspaces/:workspaceId", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }

    const params = request.params as { workspaceId: string };
    try {
      const fields: Record<string, string | null | undefined> = {};
      if (hasOwn(request.body, "status")) {
        fields.status = nullableString(request.body.status);
      }
      if (hasOwn(request.body, "main_session_id")) {
        fields.mainSessionId = nullableString(request.body.main_session_id);
      }
      if (hasOwn(request.body, "error_message")) {
        fields.errorMessage = nullableString(request.body.error_message) ?? null;
      }
      if (hasOwn(request.body, "deleted_at_utc")) {
        fields.deletedAtUtc = nullableString(request.body.deleted_at_utc);
      }
      if (hasOwn(request.body, "onboarding_status")) {
        fields.onboardingStatus = nullableString(request.body.onboarding_status);
      }
      if (hasOwn(request.body, "onboarding_session_id")) {
        fields.onboardingSessionId = nullableString(request.body.onboarding_session_id);
      }
      if (hasOwn(request.body, "onboarding_completed_at")) {
        fields.onboardingCompletedAt = nullableString(request.body.onboarding_completed_at);
      }
      if (hasOwn(request.body, "onboarding_completion_summary")) {
        fields.onboardingCompletionSummary = nullableString(request.body.onboarding_completion_summary);
      }
      if (hasOwn(request.body, "onboarding_requested_at")) {
        fields.onboardingRequestedAt = nullableString(request.body.onboarding_requested_at);
      }
      if (hasOwn(request.body, "onboarding_requested_by")) {
        fields.onboardingRequestedBy = nullableString(request.body.onboarding_requested_by);
      }

      const workspace = store.updateWorkspace(params.workspaceId, fields);
      return { workspace: workspaceRecordPayload(workspace) };
    } catch (error) {
      return sendError(reply, 404, error instanceof Error ? error.message.replace(/^workspace .* not found$/, "workspace not found") : "workspace not found");
    }
  });

  app.delete("/api/v1/workspaces/:workspaceId", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const workspace = store.getWorkspace(params.workspaceId, { includeDeleted: true });
    if (!workspace || workspace.deletedAtUtc) {
      // Idempotent: workspace already gone or never existed — treat as success
      const workspaceDir = store.workspaceDir(params.workspaceId);
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      return {
        workspace: {
          id: params.workspaceId,
          name: workspace?.name ?? params.workspaceId,
          status: "deleted",
          harness: workspace?.harness ?? null,
          main_session_id: workspace?.mainSessionId ?? null,
          error_message: null,
          onboarding_status: workspace?.onboardingStatus ?? "not_required",
          onboarding_session_id: null,
          onboarding_completed_at: null,
          onboarding_completion_summary: null,
          onboarding_requested_at: null,
          onboarding_requested_by: null,
          created_at: workspace?.createdAt ?? null,
          updated_at: workspace?.updatedAt ?? null,
          deleted_at_utc: workspace?.deletedAtUtc ?? new Date().toISOString()
        }
      };
    }
    const workspaceDir = store.workspaceDir(params.workspaceId);
    try {
      await stopWorkspaceApplicationsForDeletion({
        workspaceId: params.workspaceId,
        workspaceDir
      });
      const deletedWorkspace = store.deleteWorkspace(params.workspaceId);
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      return { workspace: workspaceRecordPayload(deletedWorkspace) };
    } catch (error) {
      return sendError(reply, 500, error instanceof Error ? error.message : "workspace delete failed");
    }
  });

  app.post("/api/v1/sandbox/users/:holabossUserId/workspaces/:workspaceId/exec", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { holabossUserId: string; workspaceId: string };
    void params.holabossUserId;
    const workspace = store.getWorkspace(params.workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }

    const workspaceDir = store.workspaceDir(params.workspaceId);
    fs.mkdirSync(workspaceDir, { recursive: true });
    try {
      return await executeWorkspaceCommand(
        requiredString(request.body.command, "command"),
        workspaceDir,
        optionalInteger(request.body.timeout_s, 120)
      );
    } catch (error) {
      if (error instanceof Error && error.message === "workspace exec timed out") {
        return sendError(reply, 504, "workspace exec timed out");
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "workspace exec failed");
    }
  });

  app.post("/api/v1/workspaces/:workspaceId/apply-template", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { workspaceId: string };
    const files = Array.isArray(request.body.files) ? request.body.files : [];
    const replaceExisting = optionalBoolean(request.body.replace_existing, false);
    const workspaceDir = store.workspaceDir(params.workspaceId);

    fs.mkdirSync(workspaceDir, { recursive: true });
    if (replaceExisting) {
      for (const entry of fs.readdirSync(workspaceDir, { withFileTypes: true })) {
        if (entry.name === ".holaboss" || entry.name === "workspace.json") {
          continue;
        }
        fs.rmSync(path.join(workspaceDir, entry.name), { recursive: true, force: true });
      }
    }

    let filesWritten = 0;
    for (const item of files) {
      if (!isRecord(item)) {
        continue;
      }
      const relativePath = optionalString(item.path) ?? "";
      const contentBase64 = optionalString(item.content_base64) ?? "";
      if (!relativePath || !contentBase64) {
        continue;
      }
      let fullPath: string;
      try {
        fullPath = resolveWorkspaceFilePath(workspaceDir, relativePath);
      } catch (error) {
        return sendError(reply, 400, error instanceof Error ? error.message : "path traversal not allowed");
      }
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, Buffer.from(contentBase64, "base64"));
      if (optionalBoolean(item.executable, false)) {
        fs.chmodSync(fullPath, fs.statSync(fullPath).mode | 0o111);
      }
      filesWritten += 1;
    }

    return reply.send({ status: "applied", files_written: filesWritten });
  });

  app.post("/api/v1/workspaces/:workspaceId/apply-template-from-url", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { workspaceId: string };
    const url = requiredString(request.body.url, "url");
    const replaceExisting = optionalBoolean(request.body.replace_existing, false);
    const apiKey = optionalString(request.body.api_key);
    const workspaceDir = store.workspaceDir(params.workspaceId);

    fs.mkdirSync(workspaceDir, { recursive: true });
    if (replaceExisting) {
      for (const entry of fs.readdirSync(workspaceDir, { withFileTypes: true })) {
        if (entry.name === ".holaboss" || entry.name === "workspace.json") {
          continue;
        }
        fs.rmSync(path.join(workspaceDir, entry.name), { recursive: true, force: true });
      }
    }

    const zipPath = path.join(os.tmpdir(), `holaboss-template-${params.workspaceId}-${Date.now()}.zip`);
    try {
      const response = await fetch(url, {
        headers: apiKey ? { "X-API-Key": apiKey } : undefined
      });
      if (!response.ok) {
        return sendError(reply, 502, `template download failed with status ${response.status}`);
      }
      const archive = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(zipPath, archive);

      const filesWritten = await extractTemplateZipArchive(zipPath, workspaceDir);
      return reply.send({
        status: "applied",
        files_written: Number.isFinite(filesWritten) ? filesWritten : 0
      });
    } catch (error) {
      const invalidArchiveMessage = invalidTemplateArchiveMessage(error);
      if (invalidArchiveMessage) {
        return sendError(reply, 400, invalidArchiveMessage);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "template download failed");
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
  });

  app.get("/api/v1/workspaces/:workspaceId/files/*", async (request, reply) => {
    const params = request.params as { workspaceId: string; "*": string };
    const workspaceDir = store.workspaceDir(params.workspaceId);
    let fullPath: string;
    try {
      fullPath = resolveWorkspaceFilePath(workspaceDir, params["*"] ?? "");
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "path traversal not allowed");
    }
    if (!fs.existsSync(fullPath)) {
      return sendError(reply, 404, `file not found: ${params["*"]}`);
    }
    if (!fs.statSync(fullPath).isFile()) {
      return sendError(reply, 400, `not a file: ${params["*"]}`);
    }
    const raw = fs.readFileSync(fullPath);
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      return reply.send({
        path: params["*"],
        content,
        encoding: "utf-8"
      });
    } catch {
      return reply.send({
        path: params["*"],
        content: raw.toString("base64"),
        encoding: "base64"
      });
    }
  });

  app.put("/api/v1/workspaces/:workspaceId/files/*", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { workspaceId: string; "*": string };
    const workspaceDir = store.workspaceDir(params.workspaceId);
    let fullPath: string;
    try {
      fullPath = resolveWorkspaceFilePath(workspaceDir, params["*"] ?? "");
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "path traversal not allowed");
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from(requiredString(request.body.content_base64, "content_base64"), "base64"));
    if (optionalBoolean(request.body.executable, false)) {
      fs.chmodSync(fullPath, fs.statSync(fullPath).mode | 0o111);
    }
    return reply.send({ path: params["*"], status: "written" });
  });

  app.get("/api/v1/workspaces/:workspaceId/snapshot", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const workspaceDir = store.workspaceDir(params.workspaceId);
    if (!fs.existsSync(workspaceDir)) {
      return sendError(reply, 404, "workspace not found");
    }
    return reply.send({
      workspace_id: params.workspaceId,
      ...collectWorkspaceSnapshot(workspaceDir)
    });
  });

  app.get("/api/v1/workspaces/:workspaceId/export", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const workspaceDir = store.workspaceDir(params.workspaceId);
    if (!fs.existsSync(workspaceDir)) {
      return sendError(reply, 404, "workspace not found");
    }

    const tar = spawnSync(
      "tar",
      [
        "-czf",
        "-",
        "--exclude=node_modules",
        "--exclude=.git",
        "--exclude=dist",
        "--exclude=build",
        "--exclude=__pycache__",
        "--exclude=.venv",
        "--exclude=.hb_template_bootstrap_tmp",
        "--exclude=.hb_app_template_tmp",
        "."
      ],
      {
        cwd: workspaceDir,
        encoding: null,
        maxBuffer: 128 * 1024 * 1024
      }
    );
    if (tar.status !== 0) {
      return sendError(
        reply,
        500,
        tar.stderr instanceof Buffer ? tar.stderr.toString("utf8", 0, 2000) : "workspace export failed"
      );
    }
    reply.header("Content-Disposition", `attachment; filename=${params.workspaceId}.tar.gz`);
    return reply.type("application/gzip").send(tar.stdout);
  });

  app.get("/api/v1/apps/ports", async (request) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    let workspaceDir: string | null = null;
    if (workspaceId) {
      workspaceDir = path.join(store.workspaceRoot, workspaceId);
    } else if (fs.existsSync(store.workspaceRoot)) {
      for (const entry of fs.readdirSync(store.workspaceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const candidate = path.join(store.workspaceRoot, entry.name, "workspace.yaml");
        if (fs.existsSync(candidate)) {
          workspaceDir = path.dirname(candidate);
          break;
        }
      }
    }
    if (!workspaceDir || !fs.existsSync(path.join(workspaceDir, "workspace.yaml"))) {
      return {};
    }
    return listWorkspaceApplicationPorts(workspaceDir, {
      store,
      workspaceId: workspaceId ?? null,
      allocatePorts: true
    });
  });

  app.post("/api/v1/apps/:appId/start", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { appId: string };
    let appId: string;
    try {
      appId = sanitizeAppId(params.appId);
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "invalid app_id");
    }
    const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }
    const workspaceDir = store.workspaceDir(workspaceId);
    let resolvedApp;
    try {
      resolvedApp = resolveWorkspaceAppRuntime(workspaceDir, appId, {
        store,
        workspaceId,
        allocatePorts: true
      });
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error && typeof (error as { statusCode: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 400;
      return sendError(reply, statusCode, error instanceof Error ? error.message : "invalid app metadata");
    }
    try {
      const holabossUserId = optionalString(request.body.holaboss_user_id);
      const build = store.getAppBuild({ workspaceId, appId });
      const needsSetup =
        !appBuildHasCompletedSetup(build?.status) &&
        resolvedApp.resolvedApp.lifecycle.setup.trim().length > 0;

      if (needsSetup) {
        store.upsertAppBuild({
          workspaceId,
          appId,
          status: "building"
        });
        void appLifecycleExecutor
          .startApp({
            appId,
            appDir: resolvedApp.appDir,
            httpPort: resolvedApp.ports.http,
            mcpPort: resolvedApp.ports.mcp,
            holabossUserId,
            resolvedApp: resolvedApp.resolvedApp,
            skipSetup: false
          })
          .then((result) => {
            store.upsertAppBuild({
              workspaceId,
              appId,
              status: result.status === "started" ? "running" : result.status
            });
          })
          .catch((error) => {
            store.upsertAppBuild({
              workspaceId,
              appId,
              status: "failed",
              error: error instanceof Error ? error.message : String(error)
            });
            app.log.error(
              {
                workspaceId,
                appId,
                error: error instanceof Error ? error.message : String(error)
              },
              "background app start failed"
            );
          });
        return {
          app_id: appId,
          status: "building",
          detail: "App start queued in background",
          ports: { http: resolvedApp.ports.http, mcp: resolvedApp.ports.mcp }
        };
      }

      const result = await appLifecycleExecutor.startApp({
        appId,
        appDir: resolvedApp.appDir,
        httpPort: resolvedApp.ports.http,
        mcpPort: resolvedApp.ports.mcp,
        holabossUserId,
        resolvedApp: resolvedApp.resolvedApp,
        skipSetup: appBuildHasCompletedSetup(build?.status)
      });
      store.upsertAppBuild({
        workspaceId,
        appId,
        status: result.status === "started" ? "running" : result.status
      });
      return result;
    } catch (error) {
      if (error instanceof AppLifecycleExecutorError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "app lifecycle start failed");
    }
  });

  app.post("/api/v1/apps/:appId/stop", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { appId: string };
    let appId: string;
    try {
      appId = sanitizeAppId(params.appId);
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "invalid app_id");
    }
    const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }
    const workspaceDir = store.workspaceDir(workspaceId);
    let resolvedApp;
    try {
      resolvedApp = resolveWorkspaceAppRuntime(workspaceDir, appId, {
        store,
        workspaceId
      });
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error && typeof (error as { statusCode: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 400;
      return sendError(reply, statusCode, error instanceof Error ? error.message : "invalid app metadata");
    }
    try {
      const result = await appLifecycleExecutor.stopApp({
        appId,
        appDir: resolvedApp.appDir,
        resolvedApp: resolvedApp.resolvedApp
      });
      store.upsertAppBuild({
        workspaceId,
        appId,
        status: "stopped"
      });
      return result;
    } catch (error) {
      if (error instanceof AppLifecycleExecutorError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "app lifecycle stop failed");
    }
  });

  app.get("/api/v1/apps/:appId/build-status", async (request, reply) => {
    const params = request.params as { appId: string };
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = requiredString(query.workspace_id, "workspace_id");
    let appId: string;
    try {
      appId = sanitizeAppId(params.appId);
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "invalid app_id");
    }
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }
    const entry = listWorkspaceApplications(store.workspaceDir(workspaceId)).find((candidate) => candidate.app_id === appId) ?? null;
    const record = store.getAppBuild({ workspaceId, appId });
    return record ? appBuildPayload(record) : { status: entry ? fallbackAppBuildStatus(entry) : "unknown" };
  });

  app.get("/api/v1/apps", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = requiredString(query.workspace_id, "workspace_id");
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }
    const workspaceDir = store.workspaceDir(workspaceId);
    const apps = listWorkspaceApplications(workspaceDir).map((entry) => {
      const appId = typeof entry.app_id === "string" ? entry.app_id : "";
      const build = appId ? store.getAppBuild({ workspaceId, appId }) : null;
      const status = appId ? resolvedAppBuildStatus({ store, workspaceId, appId, entry }) : "unknown";
      return {
        app_id: appId,
        config_path: typeof entry.config_path === "string" ? entry.config_path : "",
        lifecycle: isRecord(entry.lifecycle) ? entry.lifecycle : null,
        build_status: status,
        ready: status === "running",
        error: build?.status === "failed" ? (build.error ?? "unknown error") : null
      };
    });
    return {
      apps: apps.filter((entry) => entry.app_id.length > 0),
      count: apps.filter((entry) => entry.app_id.length > 0).length
    };
  });

  app.post("/api/v1/apps/ensure-running", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }
    try {
      return await ensureAllAppsRunning(workspaceId);
    } catch (error) {
      return sendError(reply, 500, error instanceof Error ? error.message : "failed to ensure apps running");
    }
  });

  app.post("/api/v1/apps/install", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }

    let appId: string;
    try {
      appId = sanitizeAppId(requiredString(request.body.app_id, "app_id"));
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "invalid app_id");
    }
    const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }

    const workspaceDir = store.workspaceDir(workspaceId);
    const appDir = path.join(workspaceDir, "apps", appId);
    fs.mkdirSync(appDir, { recursive: true });

    const files = Array.isArray(request.body.files) ? request.body.files : [];
    for (const item of files) {
      if (!isRecord(item)) {
        continue;
      }
      const relativePath = requiredString(item.path, "path");
      const fullPath = resolveWorkspaceFilePath(appDir, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, Buffer.from(requiredString(item.content_base64, "content_base64"), "base64"));
      if (optionalBoolean(item.executable, false)) {
        fs.chmodSync(fullPath, 0o755);
      }
    }

    const appYamlPath = path.join(appDir, "app.runtime.yaml");
    if (!fs.existsSync(appYamlPath)) {
      return sendError(reply, 400, "app.runtime.yaml not found in uploaded files");
    }

    let parsed: ParsedInstalledApp;
    try {
      parsed = parseInstalledAppRuntime(
        fs.readFileSync(appYamlPath, "utf8"),
        appId,
        `apps/${appId}/app.runtime.yaml`
      );
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "invalid app.runtime.yaml");
    }

    const lifecycle: Record<string, string> = {};
    if (parsed.lifecycle.setup) {
      lifecycle.setup = parsed.lifecycle.setup;
    }
    if (parsed.lifecycle.start) {
      lifecycle.start = parsed.lifecycle.start;
    }
    if (parsed.lifecycle.stop) {
      lifecycle.stop = parsed.lifecycle.stop;
    }
    appendWorkspaceApplication(workspaceDir, {
      appId,
      configPath: parsed.configPath,
      lifecycle: Object.keys(lifecycle).length > 0 ? lifecycle : null
    });

    // Atomic enable: setup + start in one flow.
    try {
      await ensureAppRunning(workspaceId, appId);
      return {
        app_id: appId,
        status: "enabled",
        detail: "App installed and running",
        ready: true,
        error: null
      };
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
      return {
        app_id: appId,
        status: "enabled",
        detail: message,
        ready: false,
        error: message
      };
    }
  });

  app.post("/api/v1/apps/:appId/setup", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { appId: string };
    let appId: string;
    try {
      appId = sanitizeAppId(params.appId);
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "invalid app_id");
    }
    const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }
    const workspaceDir = store.workspaceDir(workspaceId);
    const appYamlPath = path.join(workspaceDir, "apps", appId, "app.runtime.yaml");
    if (!fs.existsSync(appYamlPath)) {
      return sendError(reply, 404, `app.runtime.yaml not found for ${appId}`);
    }

    let parsed: ParsedInstalledApp;
    try {
      parsed = parseInstalledAppRuntime(
        fs.readFileSync(appYamlPath, "utf8"),
        appId,
        `apps/${appId}/app.runtime.yaml`
      );
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "invalid app.runtime.yaml");
    }

    if (!parsed.lifecycle.setup) {
      return {
        app_id: appId,
        status: "no_setup_command",
        detail: "No lifecycle.setup defined",
        ports: {}
      };
    }

    const queued = queueAppSetup({
      workspaceDir,
      workspaceId,
      appId,
      setupCommand: parsed.lifecycle.setup
    });
    return {
      app_id: appId,
      status: queued.status,
      detail: queued.detail,
      ports: {}
    };
  });

  app.delete("/api/v1/apps/:appId", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { appId: string };
    let appId: string;
    try {
      appId = sanitizeAppId(params.appId);
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : "invalid app_id");
    }
    const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }
    const workspaceDir = store.workspaceDir(workspaceId);

    try {
      const resolvedApp = resolveWorkspaceAppRuntime(workspaceDir, appId, {
        store,
        workspaceId
      });
      await appLifecycleExecutor.stopApp({
        appId,
        appDir: resolvedApp.appDir,
        resolvedApp: resolvedApp.resolvedApp
      });
    } catch {
      app.log.debug({ workspaceId, appId }, "best-effort app stop failed during uninstall");
    }

    fs.rmSync(path.join(workspaceDir, "apps", appId), { recursive: true, force: true });
    removeWorkspaceApplication(workspaceDir, appId);
    releaseWorkspaceAppPorts({ store, workspaceId, appId });
    store.deleteAppBuild({ workspaceId, appId });
    return {
      app_id: appId,
      status: "uninstalled",
      detail: "App stopped, files removed, workspace.yaml updated",
      ports: {}
    };
  });

  app.post("/api/v1/agent-sessions/queue", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }
    const blockingApps = blockingWorkspaceApps({ store, workspaceId });
    if (blockingApps.length > 0) {
      return sendError(reply, 409, blockingWorkspaceAppsMessage(blockingApps));
    }

    let resolvedSessionId: string;
    try {
      resolvedSessionId = resolveQueueSessionId(optionalString(request.body.session_id), workspace);
    } catch (error) {
      return sendError(reply, 409, error instanceof Error ? error.message : "workspace main_session_id is not configured");
    }

    const workspaceDir = store.workspaceDir(workspaceId);
    const trimmedText = (optionalString(request.body.text) ?? "").trim();
    let attachments: SessionInputAttachmentPayload[];
    try {
      attachments = requiredSessionInputAttachments(request.body.attachments, workspaceDir);
    } catch (error) {
      return sendError(reply, 422, error instanceof Error ? error.message : "attachments are invalid");
    }
    if (!trimmedText && attachments.length === 0) {
      return sendError(reply, 422, "text or attachments are required");
    }

    store.ensureSession({
      workspaceId,
      sessionId: resolvedSessionId,
      kind: inferredSessionKind(workspace, resolvedSessionId),
      title:
        inferredSessionKind(workspace, resolvedSessionId) === "onboarding"
          ? "Onboarding"
          : inferredSessionKind(workspace, resolvedSessionId) === "main"
          ? "Main"
          : null
    });
    if (!store.getBinding({ workspaceId, sessionId: resolvedSessionId })) {
      store.upsertBinding({
        workspaceId,
        sessionId: resolvedSessionId,
        harness: resolvedWorkspaceHarness(workspace),
        harnessSessionId: resolvedSessionId
      });
    }
    store.ensureRuntimeState({
      workspaceId,
      sessionId: resolvedSessionId,
      status: "QUEUED"
    });
    const record = store.enqueueInput({
      workspaceId,
      sessionId: resolvedSessionId,
      priority: optionalInteger(request.body.priority, 0),
      idempotencyKey: nullableString(request.body.idempotency_key) ?? null,
      payload: {
        text: trimmedText,
        attachments,
        image_urls: Array.isArray(request.body.image_urls) ? request.body.image_urls : [],
        model: nullableString(request.body.model) ?? null,
        context: {}
      }
    });
    store.insertSessionMessage({
      workspaceId,
      sessionId: resolvedSessionId,
      role: "user",
      text: trimmedText,
      messageId: `user-${record.inputId}`
    });
    createInputMemoryUpdateProposals({
      store,
      workspaceId,
      sessionId: resolvedSessionId,
      inputId: record.inputId,
      sourceMessageId: `user-${record.inputId}`,
      text: trimmedText,
    });
    store.updateRuntimeState({
      workspaceId,
      sessionId: resolvedSessionId,
      status: "QUEUED",
      currentInputId: record.inputId,
      currentWorkerId: null,
      leaseUntil: null,
      heartbeatAt: null,
      lastError: null
    });
    queueWorker?.wake();
    return {
      input_id: record.inputId,
      session_id: record.sessionId,
      status: record.status
    };
  });

  app.get("/api/v1/agent-sessions", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }

    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }

    const items = store
      .listSessions({
        workspaceId,
        includeArchived: optionalBoolean(query.include_archived, false),
        limit: Math.max(1, Math.min(200, optionalInteger(query.limit, 100))),
        offset: Math.max(0, optionalInteger(query.offset, 0))
      })
      .map((item: AgentSessionRecord) => agentSessionPayload(item));
    return { items, count: items.length };
  });

  app.get("/api/v1/agent-sessions/:sessionId/state", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    const profileId = optionalString(query.profile_id);
    if (workspaceId && profileId && workspaceId !== profileId) {
      return sendError(reply, 422, "workspace_id and profile_id must match when both are provided");
    }
    const resolvedWorkspaceId = workspaceId ?? profileId;
    const runtimeState = store.getRuntimeState({
      sessionId: params.sessionId,
      workspaceId: resolvedWorkspaceId
    });
    const hasQueued = store.hasAvailableInputsForSession({
      sessionId: params.sessionId,
      workspaceId: resolvedWorkspaceId
    });
    return effectiveSessionState(runtimeState, hasQueued);
  });

  app.get("/api/v1/agent-sessions/by-workspace/:workspaceId/runtime-states", async (request) => {
    const params = request.params as { workspaceId: string };
    const items = store
      .listRuntimeStates(params.workspaceId)
      .map((item: SessionRuntimeStateRecord) => runtimeStatePayload(item));
    return { items, count: items.length };
  });

  app.get("/api/v1/agent-sessions/:sessionId/history", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }

    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }

    const binding = store.getBinding({ workspaceId, sessionId: params.sessionId });
    if (!binding) {
      return sendError(reply, 404, "session binding not found");
    }

    const limit = Math.max(1, Math.min(1000, optionalInteger(query.limit, 200)));
    const offset = Math.max(0, optionalInteger(query.offset, 0));
    const allMessages = store.listSessionMessages({ workspaceId, sessionId: params.sessionId });
    const messages = allMessages
      .slice(offset, offset + limit)
      .map((message: SessionMessageRecord) => {
        const inputId = message.role === "user" && message.id.startsWith("user-") ? message.id.slice(5) : "";
        const inputAttachments = inputId ? attachmentsFromInputPayload(store.getInput(inputId)?.payload.attachments) : [];
        const metadata = inputAttachments.length > 0 ? { ...message.metadata, attachments: inputAttachments } : message.metadata;
        return sessionMessagePayload(message, metadata);
      });
    return {
      workspace_id: workspaceId,
      session_id: params.sessionId,
      harness: binding.harness,
      harness_session_id: binding.harnessSessionId,
      source: "sandbox_local_storage",
      main_session_id: workspace.mainSessionId,
      is_main_session: workspace.mainSessionId === params.sessionId,
      messages,
      count: messages.length,
      total: allMessages.length,
      limit,
      offset,
      raw: null
    };
  });

  app.get("/api/v1/agent-sessions/:sessionId/turn-results", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }

    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }

    const inputId = optionalString(query.input_id);
    const limit = Math.max(1, Math.min(1000, optionalInteger(query.limit, 200)));
    const offset = Math.max(0, optionalInteger(query.offset, 0));
    const total = store.countTurnResults({
      workspaceId,
      sessionId: params.sessionId,
      inputId: inputId ?? undefined,
    });
    const items = store
      .listTurnResults({
        workspaceId,
        sessionId: params.sessionId,
        inputId: inputId ?? undefined,
        limit,
        offset,
      })
      .map((item: TurnResultRecord) => turnResultPayload(item));

    return {
      workspace_id: workspaceId,
      session_id: params.sessionId,
      items,
      count: items.length,
      total,
      limit,
      offset,
    };
  });

  app.get("/api/v1/agent-sessions/:sessionId/request-snapshots", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }

    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }

    const inputId = optionalString(query.input_id);
    const limit = Math.max(1, Math.min(1000, optionalInteger(query.limit, 200)));
    const offset = Math.max(0, optionalInteger(query.offset, 0));
    const items = store
      .listTurnRequestSnapshots({
        workspaceId,
        sessionId: params.sessionId,
        inputId: inputId ?? undefined,
        limit,
        offset,
      })
      .map((item: TurnRequestSnapshotRecord) => turnRequestSnapshotPayload(item));

    return {
      workspace_id: workspaceId,
      session_id: params.sessionId,
      items,
      count: items.length,
      limit,
      offset,
    };
  });

  app.get("/api/v1/agent-sessions/:sessionId/compaction-boundaries", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }

    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }

    const inputId = optionalString(query.input_id);
    const limit = Math.max(1, Math.min(1000, optionalInteger(query.limit, 200)));
    const offset = Math.max(0, optionalInteger(query.offset, 0));
    const items = store
      .listCompactionBoundaries({
        workspaceId,
        sessionId: params.sessionId,
        inputId: inputId ?? undefined,
        limit,
        offset,
      })
      .map((item: CompactionBoundaryRecord) => compactionBoundaryPayload(item));

    return {
      workspace_id: workspaceId,
      session_id: params.sessionId,
      items,
      count: items.length,
      limit,
      offset,
    };
  });

  app.get("/api/v1/agent-sessions/:sessionId/resume-context", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }

    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }

    const inputId = optionalString(query.input_id) ?? "";
    const latestBoundary = store
      .listCompactionBoundaries({
        workspaceId,
        sessionId: params.sessionId,
        limit: 8,
        offset: 0,
      })
      .find((boundary) => boundary.inputId !== inputId) ?? null;
    const turnResults = store.listTurnResults({
      workspaceId,
      sessionId: params.sessionId,
      limit: 8,
      offset: 0,
    });
    const recentTurn = turnResults.find((turnResult) => turnResult.inputId !== inputId) ?? null;
    const sessionMessages = latestBoundary
      ? []
      : store.listSessionMessages({
          workspaceId,
          sessionId: params.sessionId,
        });

    return {
      workspace_id: workspaceId,
      session_id: params.sessionId,
      input_id: inputId || null,
      compaction_restoration_context: compactionRestorationContextFromCompactionBoundary(latestBoundary),
      recent_runtime_context:
        recentRuntimeContextFromCompactionBoundary(latestBoundary) ??
        (recentTurn ? recentRuntimeContextFromTurnResult(recentTurn) : null),
      session_resume_context:
        sessionResumeContextFromCompactionBoundary(latestBoundary) ??
        sessionResumeContextFromArtifacts({
          turnResults,
          sessionMessages,
          currentInputId: inputId,
        }),
    };
  });

  app.post("/api/v1/agent-sessions/:sessionId/artifacts", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { sessionId: string };
    const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
    const inputId = resolveOutputInputId({
      store,
      workspaceId,
      sessionId: params.sessionId,
      inputId: nullableString(request.body.input_id),
    });
    const metadata = optionalDict(request.body.metadata) ?? {};
    const artifactId = nullableString(request.body.artifact_id) ?? randomUUID();
    store.ensureRuntimeState({
      workspaceId,
      sessionId: params.sessionId,
      status: "IDLE"
    });
    const output = store.createOutput({
      workspaceId,
      outputType: outputTypeForArtifact(requiredString(request.body.artifact_type, "artifact_type")),
      title: nullableString(request.body.title) ?? "",
      status: "completed",
      moduleId: nullableString(request.body.module_id) ?? null,
      moduleResourceId:
        nullableString(request.body.module_resource_id) ?? requiredString(request.body.external_id, "external_id"),
      sessionId: params.sessionId,
      inputId,
      artifactId,
      platform: nullableString(request.body.platform) ?? null,
      metadata: {
        ...metadata,
        origin_type: "app",
        change_type: optionalString(request.body.change_type) ?? "created",
        artifact_type: requiredString(request.body.artifact_type, "artifact_type"),
        external_id: requiredString(request.body.external_id, "external_id"),
      }
    });
    return reply.send({ artifact: sessionArtifactPayload(output) });
  });

  app.get("/api/v1/agent-sessions/:sessionId/artifacts", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    const profileId = optionalString(query.profile_id);
    if (workspaceId && profileId && workspaceId !== profileId) {
      return sendError(reply, 422, "workspace_id and profile_id must match when both are provided");
    }
    const resolvedWorkspaceId = workspaceId ?? profileId;
    const outputWorkspaceId = resolvedWorkspaceId ?? store.getRuntimeState({ sessionId: params.sessionId })?.workspaceId ?? null;
    if (!outputWorkspaceId) {
      return { items: [], count: 0 };
    }
    const items = store
      .listOutputs({
        workspaceId: outputWorkspaceId,
        sessionId: params.sessionId,
        limit: 500,
        offset: 0,
      })
      .filter((item) => item.sessionId === params.sessionId)
      .sort((left, right) => {
        const leftTime = Date.parse(left.createdAt ?? "") || 0;
        const rightTime = Date.parse(right.createdAt ?? "") || 0;
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return left.id.localeCompare(right.id);
      })
      .map((item: OutputRecord) => sessionArtifactPayload(item));
    return { items, count: items.length };
  });

  app.get("/api/v1/agent-sessions/by-workspace/:workspaceId/with-artifacts", async (request) => {
    const params = request.params as { workspaceId: string };
    const query = isRecord(request.query) ? request.query : {};
    const limit = Math.max(1, Math.min(100, optionalInteger(query.limit, 20)));
    const offset = Math.max(0, optionalInteger(query.offset, 0));
    const runtimeStates = store.listRuntimeStates(params.workspaceId).slice(offset, offset + limit);
    const outputs = store.listOutputs({
      workspaceId: params.workspaceId,
      limit: 1000,
      offset: 0,
    })
      .sort((left, right) => {
        const leftTime = Date.parse(left.createdAt ?? "") || 0;
        const rightTime = Date.parse(right.createdAt ?? "") || 0;
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return left.id.localeCompare(right.id);
      });
    const artifactsBySession = new Map<string, Array<Record<string, unknown>>>();
    for (const output of outputs) {
      const sessionId = output.sessionId ?? "";
      if (!sessionId) {
        continue;
      }
      const existing = artifactsBySession.get(sessionId);
      const payload = sessionArtifactPayload(output);
      if (existing) {
        existing.push(payload);
      } else {
        artifactsBySession.set(sessionId, [payload]);
      }
    }
    const items = runtimeStates.map((row) => ({
      session_id: row.sessionId,
      status: row.status,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      artifacts: artifactsBySession.get(row.sessionId) ?? [],
    }));
    return { items, count: items.length };
  });

  app.get("/api/v1/output-folders", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    return {
      items: store.listOutputFolders({ workspaceId }).map((item: OutputFolderRecord) => outputFolderPayload(item))
    };
  });

  app.post("/api/v1/output-folders", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const folder = store.createOutputFolder({
      workspaceId: requiredString(request.body.workspace_id, "workspace_id"),
      name: requiredString(request.body.name, "name")
    });
    return { folder: outputFolderPayload(folder) };
  });

  app.get("/api/v1/output-folders/:folderId", async (request, reply) => {
    const params = request.params as { folderId: string };
    const folder = store.getOutputFolder(params.folderId);
    if (!folder) {
      return sendError(reply, 404, "Folder not found");
    }
    return { folder: outputFolderPayload(folder) };
  });

  app.patch("/api/v1/output-folders/:folderId", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { folderId: string };
    const folder = store.updateOutputFolder({
      folderId: params.folderId,
      name: nullableString(request.body.name),
      position:
        request.body.position === undefined || request.body.position === null
          ? undefined
          : optionalInteger(request.body.position, 0)
    });
    if (!folder) {
      return sendError(reply, 404, "Folder not found");
    }
    return { folder: outputFolderPayload(folder) };
  });

  app.delete("/api/v1/output-folders/:folderId", async (request, reply) => {
    const params = request.params as { folderId: string };
    const deleted = store.deleteOutputFolder(params.folderId);
    if (!deleted) {
      return sendError(reply, 404, "Folder not found");
    }
    return { deleted: true };
  });

  app.get("/api/v1/outputs", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    const items = store.listOutputs({
      workspaceId,
      outputType: optionalString(query.output_type) ?? null,
      status: optionalString(query.status) ?? null,
      platform: optionalString(query.platform) ?? null,
      folderId: optionalString(query.folder_id) ?? null,
      sessionId: optionalString(query.session_id) ?? null,
      inputId: optionalString(query.input_id) ?? null,
      limit: Math.max(1, Math.min(200, optionalInteger(query.limit, 50))),
      offset: Math.max(0, optionalInteger(query.offset, 0))
    });
    return { items: items.map((item: OutputRecord) => outputPayload(item)) };
  });

  app.get("/api/v1/outputs/counts", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    return store.getOutputCounts({ workspaceId });
  });

  app.get("/api/v1/outputs/:outputId", async (request, reply) => {
    const params = request.params as { outputId: string };
    const output = store.getOutput(params.outputId);
    if (!output) {
      return sendError(reply, 404, "Output not found");
    }
    return { output: outputPayload(output) };
  });

  app.post("/api/v1/outputs", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const output = store.createOutput({
      workspaceId: requiredString(request.body.workspace_id, "workspace_id"),
      outputType: requiredString(request.body.output_type, "output_type"),
      title: optionalString(request.body.title) ?? "",
      status: optionalString(request.body.status) ?? "draft",
      moduleId: nullableString(request.body.module_id) ?? null,
      moduleResourceId: nullableString(request.body.module_resource_id) ?? null,
      filePath: nullableString(request.body.file_path) ?? null,
      htmlContent: nullableString(request.body.html_content) ?? null,
      sessionId: nullableString(request.body.session_id) ?? null,
      inputId: nullableString(request.body.input_id) ?? null,
      artifactId: nullableString(request.body.artifact_id) ?? null,
      folderId: nullableString(request.body.folder_id) ?? null,
      platform: nullableString(request.body.platform) ?? null,
      metadata: optionalDict(request.body.metadata) ?? {}
    });
    return { output: outputPayload(output) };
  });

  app.patch("/api/v1/outputs/:outputId", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { outputId: string };
    const output = store.updateOutput({
      outputId: params.outputId,
      title: nullableString(request.body.title),
      status: nullableString(request.body.status),
      moduleResourceId: nullableString(request.body.module_resource_id),
      filePath: nullableString(request.body.file_path),
      htmlContent: nullableString(request.body.html_content),
      metadata: hasOwn(request.body, "metadata") ? (optionalDict(request.body.metadata) ?? {}) : undefined,
      folderId: nullableString(request.body.folder_id)
    });
    if (!output) {
      return sendError(reply, 404, "Output not found");
    }
    return { output: outputPayload(output) };
  });

  app.delete("/api/v1/outputs/:outputId", async (request, reply) => {
    const params = request.params as { outputId: string };
    const deleted = store.deleteOutput(params.outputId);
    if (!deleted) {
      return sendError(reply, 404, "Output not found");
    }
    return { deleted: true };
  });

  app.get("/api/v1/notifications", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    const limit = optionalInteger(query.limit, 50);
    const items = store
      .listRuntimeNotifications({
        workspaceId: workspaceId ?? null,
        includeDismissed: optionalBoolean(query.include_dismissed, false),
        limit
      })
      .map((item) => runtimeNotificationPayload(item));
    return { items, count: items.length };
  });

  app.patch("/api/v1/notifications/:notificationId", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { notificationId: string };
    const updated = store.updateRuntimeNotification({
      notificationId: requiredString(params.notificationId, "notificationId"),
      state: nullableString(request.body.state) as "unread" | "read" | "dismissed" | null | undefined
    });
    if (!updated) {
      return sendError(reply, 404, "Notification not found");
    }
    return runtimeNotificationPayload(updated);
  });

  app.get("/api/v1/cronjobs", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    const jobs = store
      .listCronjobs({
        workspaceId,
        enabledOnly: optionalBoolean(query.enabled_only, false)
      })
      .map((item: CronjobRecord) => cronjobPayload(item));
    return { jobs, count: jobs.length };
  });

  app.post("/api/v1/cronjobs", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
    if (!store.getWorkspace(workspaceId)) {
      return sendError(reply, 404, "workspace not found");
    }
    const job = store.createCronjob({
      workspaceId,
      initiatedBy: requiredString(request.body.initiated_by, "initiated_by"),
      name: optionalString(request.body.name) ?? "",
      cron: requiredString(request.body.cron, "cron"),
      description: requiredString(request.body.description, "description"),
      enabled: optionalBoolean(request.body.enabled, true),
      delivery: requiredDict(request.body.delivery, "delivery"),
      metadata: optionalDict(request.body.metadata) ?? {},
      nextRunAt: cronjobNextRunAt(requiredString(request.body.cron, "cron"), new Date())
    });
    return cronjobPayload(job);
  });

  app.get("/api/v1/cronjobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = store.getCronjob(params.jobId);
    if (!job) {
      return sendError(reply, 404, "Cronjob not found");
    }
    return cronjobPayload(job);
  });

  app.patch("/api/v1/cronjobs/:jobId", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { jobId: string };
    const cron = nullableString(request.body.cron);
    const job = store.updateCronjob({
      jobId: params.jobId,
      name: nullableString(request.body.name),
      cron,
      description: nullableString(request.body.description),
      enabled: hasOwn(request.body, "enabled") ? optionalBoolean(request.body.enabled, false) : null,
      delivery: hasOwn(request.body, "delivery") ? (optionalDict(request.body.delivery) ?? {}) : undefined,
      metadata: hasOwn(request.body, "metadata") ? (optionalDict(request.body.metadata) ?? {}) : undefined,
      nextRunAt: cron == null ? cron : cronjobNextRunAt(cron, new Date())
    });
    if (!job) {
      return sendError(reply, 404, "Cronjob not found");
    }
    return cronjobPayload(job);
  });

  app.delete("/api/v1/cronjobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    const deleted = store.deleteCronjob(params.jobId);
    if (!deleted) {
      return sendError(reply, 404, "Cronjob not found");
    }
    return { success: true };
  });

  app.get("/api/v1/task-proposals", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    const proposals = store.listTaskProposals({ workspaceId }).map((item: TaskProposalRecord) => taskProposalPayload(item));
    return { proposals, count: proposals.length };
  });

  app.get("/api/v1/task-proposals/unreviewed", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    const proposals = store
      .listUnreviewedTaskProposals({ workspaceId })
      .map((item: TaskProposalRecord) => taskProposalPayload(item));
    return { proposals, count: proposals.length };
  });

  app.get("/api/v1/task-proposals/unreviewed/stream", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    reply.header("Cache-Control", "no-cache");
    reply.header("Connection", "keep-alive");
    reply.header("X-Accel-Buffering", "no");
    reply.type("text/event-stream");

    const stream = Readable.from(
      (async function* () {
        const seenProposalIds = new Set(
          store.listUnreviewedTaskProposals({ workspaceId }).map((item: TaskProposalRecord) => item.proposalId)
        );
        yield sseComment("connected");
        while (true) {
          const proposals = store.listUnreviewedTaskProposals({ workspaceId });
          for (const proposal of proposals) {
            if (seenProposalIds.has(proposal.proposalId)) {
              continue;
            }
            seenProposalIds.add(proposal.proposalId);
            yield [
              "event: insert",
              `id: ${proposal.proposalId}`,
              `data: ${JSON.stringify(taskProposalPayload(proposal))}`
            ].join("\n") + "\n\n";
          }
          yield sseComment("ping");
          await sleep(1000);
        }
      })()
    );
    return reply.send(stream);
  });

  app.post("/api/v1/task-proposals", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
    if (!store.getWorkspace(workspaceId)) {
      return sendError(reply, 404, "workspace not found");
    }
    const proposal = store.createTaskProposal({
      proposalId: requiredString(request.body.proposal_id, "proposal_id"),
      workspaceId,
      taskName: requiredString(request.body.task_name, "task_name"),
      taskPrompt: requiredString(request.body.task_prompt, "task_prompt"),
      taskGenerationRationale: requiredString(request.body.task_generation_rationale, "task_generation_rationale"),
      sourceEventIds: optionalStringList(request.body.source_event_ids),
      createdAt: requiredString(request.body.created_at, "created_at"),
      state: optionalString(request.body.state) ?? "not_reviewed"
    });
    return { proposal: taskProposalPayload(proposal) };
  });

  app.post("/api/v1/task-proposals/:proposalId/accept", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }

    const params = request.params as { proposalId: string };
    const proposal = store.getTaskProposal(params.proposalId);
    if (!proposal) {
      return sendError(reply, 404, "Task proposal not found");
    }

    const workspace = store.getWorkspace(proposal.workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }

    if (proposal.state === "dismissed") {
      return sendError(reply, 409, "Task proposal has already been dismissed");
    }
    if (proposal.state === "accepted" && proposal.acceptedSessionId && proposal.acceptedInputId) {
      return sendError(reply, 409, "Task proposal has already been accepted");
    }

    const blockingApps = blockingWorkspaceApps({ store, workspaceId: proposal.workspaceId });
    if (blockingApps.length > 0) {
      return sendError(reply, 409, blockingWorkspaceAppsMessage(blockingApps));
    }

    const taskName = requiredString(request.body.task_name ?? proposal.taskName, "task_name");
    const taskPrompt = requiredString(request.body.task_prompt ?? proposal.taskPrompt, "task_prompt");
    const sessionId = optionalString(request.body.session_id) ?? `proposal-${randomUUID()}`;
    const parentSessionId = nullableString(request.body.parent_session_id) ?? null;
    const priority = optionalInteger(request.body.priority, 0);
    const model = nullableString(request.body.model) ?? null;
    const createdBy = nullableString(request.body.created_by) ?? "workspace_user";

    if (store.getSession({ workspaceId: proposal.workspaceId, sessionId })) {
      return sendError(reply, 409, "session_id is already in use");
    }

    const session = store.ensureSession({
      workspaceId: proposal.workspaceId,
      sessionId,
      kind: "task_proposal",
      title: taskName,
      parentSessionId,
      sourceProposalId: proposal.proposalId,
      createdBy
    });
    if (!store.getBinding({ workspaceId: proposal.workspaceId, sessionId })) {
      store.upsertBinding({
        workspaceId: proposal.workspaceId,
        sessionId,
        harness: resolvedWorkspaceHarness(workspace),
        harnessSessionId: sessionId
      });
    }
    store.ensureRuntimeState({
      workspaceId: proposal.workspaceId,
      sessionId,
      status: "QUEUED"
    });

    const record = store.enqueueInput({
      workspaceId: proposal.workspaceId,
      sessionId,
      priority,
      payload: {
        text: taskPrompt,
        attachments: [],
        image_urls: [],
        model,
        context: {
          source: "task_proposal",
          proposal_id: proposal.proposalId,
          parent_session_id: parentSessionId
        }
      }
    });
    store.insertSessionMessage({
      workspaceId: proposal.workspaceId,
      sessionId,
      role: "user",
      text: taskPrompt,
      messageId: `user-${record.inputId}`
    });
    store.updateRuntimeState({
      workspaceId: proposal.workspaceId,
      sessionId,
      status: "QUEUED",
      currentInputId: record.inputId,
      currentWorkerId: null,
      leaseUntil: null,
      heartbeatAt: null,
      lastError: null
    });

    const updatedProposal = store.updateTaskProposal({
      proposalId: proposal.proposalId,
      fields: {
        taskName,
        taskPrompt,
        state: "accepted",
        acceptedSessionId: sessionId,
        acceptedInputId: record.inputId,
        acceptedAt: utcNowIso()
      }
    });
    queueWorker?.wake();

    return reply.send({
      proposal: taskProposalPayload(updatedProposal ?? proposal),
      session: agentSessionPayload(session),
      input: {
        input_id: record.inputId,
        session_id: record.sessionId,
        status: record.status
      }
    });
  });

  app.get("/api/v1/task-proposals/:proposalId", async (request, reply) => {
    const params = request.params as { proposalId: string };
    const proposal = store.getTaskProposal(params.proposalId);
    if (!proposal) {
      return sendError(reply, 404, "Task proposal not found");
    }
    return { proposal: taskProposalPayload(proposal) };
  });

  app.patch("/api/v1/task-proposals/:proposalId", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { proposalId: string };
    const proposal = store.updateTaskProposalState({
      proposalId: params.proposalId,
      state: requiredString(request.body.state, "state")
    });
    if (!proposal) {
      return sendError(reply, 404, "Task proposal not found");
    }
    return { proposal: taskProposalPayload(proposal) };
  });

  app.get("/api/v1/memory-update-proposals", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    const state = optionalString(query.state) as MemoryUpdateProposalRecord["state"] | null;
    const proposals = store.listMemoryUpdateProposals({
      workspaceId,
      sessionId: optionalString(query.session_id),
      inputId: optionalString(query.input_id),
      state,
      limit: optionalInteger(query.limit, 200),
      offset: optionalInteger(query.offset, 0),
    });
    return {
      proposals: proposals.map((item) => memoryUpdateProposalPayload(item)),
      count: proposals.length,
    };
  });

  app.post("/api/v1/memory-update-proposals/:proposalId/accept", async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {};
    const params = request.params as { proposalId: string };
    const proposal = store.getMemoryUpdateProposal(params.proposalId);
    if (!proposal) {
      return sendError(reply, 404, "Memory update proposal not found");
    }
    if (proposal.state === "dismissed") {
      return sendError(reply, 409, "Memory update proposal has already been dismissed");
    }
    if (proposal.state === "accepted") {
      return sendError(reply, 409, "Memory update proposal has already been accepted");
    }

    const acceptedAt = utcNowIso();
    const summary = requiredString(body.summary ?? proposal.summary, "summary");
    let persistedMemoryId: string | null = null;

    if (proposal.proposalKind === "preference") {
      const candidate = durableMemoryCandidateFromAcceptedProposal({
        proposal,
        summary,
        acceptedAt,
      });
      if (!candidate) {
        return sendError(reply, 422, "Unsupported preference proposal");
      }
      await persistDurableMemoryCandidate({
        store,
        memoryService,
        workspaceId: proposal.workspaceId,
        sessionId: proposal.sessionId,
        inputId: proposal.inputId,
        candidate,
      });
      await refreshMemoryIndexes({
        store,
        memoryService,
        workspaceId: proposal.workspaceId,
      });
      persistedMemoryId = candidate.memoryId;
    } else if (proposal.proposalKind === "profile") {
      const profileUpdate = runtimeUserProfileUpdateFromAcceptedProposal({ proposal });
      if (!profileUpdate) {
        return sendError(reply, 422, "Unsupported profile proposal");
      }
      const profile = store.upsertRuntimeUserProfile(profileUpdate);
      persistedMemoryId = `runtime-profile:${profile.profileId}`;
    } else {
      return sendError(reply, 422, "Unsupported memory proposal kind");
    }

    const updatedProposal = store.updateMemoryUpdateProposal({
      proposalId: proposal.proposalId,
      fields: {
        summary,
        state: "accepted",
        persistedMemoryId,
        acceptedAt,
        dismissedAt: null,
      },
    });
    return {
      proposal: memoryUpdateProposalPayload(updatedProposal ?? proposal),
    };
  });

  app.post("/api/v1/memory-update-proposals/:proposalId/dismiss", async (request, reply) => {
    const params = request.params as { proposalId: string };
    const proposal = store.getMemoryUpdateProposal(params.proposalId);
    if (!proposal) {
      return sendError(reply, 404, "Memory update proposal not found");
    }
    if (proposal.state === "accepted") {
      return sendError(reply, 409, "Memory update proposal has already been accepted");
    }
    if (proposal.state === "dismissed") {
      return sendError(reply, 409, "Memory update proposal has already been dismissed");
    }
    const updatedProposal = store.updateMemoryUpdateProposal({
      proposalId: proposal.proposalId,
      fields: {
        state: "dismissed",
        dismissedAt: utcNowIso(),
      },
    });
    return {
      proposal: memoryUpdateProposalPayload(updatedProposal ?? proposal),
    };
  });

  app.get("/api/v1/agent-sessions/:sessionId/outputs/events", async (request) => {
    const params = request.params as { sessionId: string };
    const query = isRecord(request.query) ? request.query : {};
    const inputId = optionalString(query.input_id);
    const includeHistory = optionalBoolean(query.include_history, true);
    let afterEventId = Math.max(0, optionalInteger(query.after_event_id, 0));
    if (!includeHistory && afterEventId <= 0) {
      afterEventId = store.latestOutputEventId({ sessionId: params.sessionId, inputId });
    }

    const items = store
      .listOutputEvents({
        sessionId: params.sessionId,
        inputId,
        includeHistory: true,
        afterEventId
      })
      .map((item: OutputEventRecord) => outputEventPayload(item));
    return {
      items,
      count: items.length,
      last_event_id: items.reduce<number>(
        (maxId: number, item: Record<string, unknown>) => Math.max(maxId, Number(item.id)),
        afterEventId
      )
    };
  });

  app.get("/api/v1/agent-sessions/:sessionId/outputs/stream", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const query = isRecord(request.query) ? request.query : {};
    const inputId = optionalString(query.input_id);
    const includeHistory = optionalBoolean(query.include_history, true);
    const stopOnTerminal = optionalBoolean(query.stop_on_terminal, true);

    reply.header("Cache-Control", "no-cache");
    reply.header("Connection", "keep-alive");
    reply.header("X-Accel-Buffering", "no");
    reply.type("text/event-stream");

    const stream = Readable.from(
      (async function* () {
        let lastEventId = includeHistory ? 0 : store.latestOutputEventId({ sessionId: params.sessionId, inputId });
        yield sseComment("connected");

        while (true) {
          const events = store.listOutputEvents({
            sessionId: params.sessionId,
            inputId,
            includeHistory: true,
            afterEventId: lastEventId
          });

          if (events.length > 0) {
            for (const event of events) {
              lastEventId = Math.max(lastEventId, event.id);
              yield sseEvent(event);
              if (stopOnTerminal && TERMINAL_EVENT_TYPES.has(event.eventType)) {
                return;
              }
            }
            continue;
          }

          await sleep(DEFAULT_POLL_INTERVAL_MS);
        }
      })()
    );

    return reply.send(stream);
  });

  return app;
}
