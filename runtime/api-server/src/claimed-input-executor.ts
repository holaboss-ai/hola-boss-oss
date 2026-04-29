import fs from "node:fs";
import path from "node:path";

import type {
  RuntimeStateStore,
  SessionInputRecord,
  TurnResultRecord,
  WorkspaceRecord,
} from "@holaboss/runtime-state-store";

import {
  buildRunCompletedEvent,
  buildRunFailedEvent,
  executeRunnerRequest,
  type RunnerEvent,
} from "./runner-worker.js";
import type {
  BackendAgentRunEventRequest,
  BackendAgentRunEventType,
  BackendAgentRunStartRequest,
} from "./backend-agent-runs-contract.js";
import { resolveProductRuntimeConfig } from "./runtime-config.js";
import {
  normalizeHarnessId,
  resolveRuntimeHarnessAdapter,
  resolveRuntimeHarnessPlugin,
} from "./harness-registry.js";
import {
  captureRuntimeException,
  extractRuntimeFetchErrorDiagnostics,
  redactRuntimeSentryText,
  redactRuntimeSentryValue,
} from "./runtime-sentry.js";
import type { MemoryServiceLike } from "./memory.js";
import { createBackgroundTaskMemoryModelClient } from "./background-task-model.js";
import {
  enqueueSessionCheckpointJob,
  normalizePiContextUsage,
  shouldQueueSessionCheckpoint,
  waitForSessionCheckpointCompletion,
  type PiContextUsage,
} from "./session-checkpoint.js";
import type { TurnMemoryWritebackModelContext } from "./turn-memory-writeback.js";
import { runEvolveTasks } from "./evolve-tasks.js";
import { promoteAcceptedSkillCandidate } from "./evolve-skill-review.js";
import {
  collectWorkspaceFileManifest,
  detectWorkspaceFileOutputs,
  type WorkspaceFileManifest,
} from "./turn-output-capture.js";
import { compactTurnSummary } from "./turn-result-summary.js";

const ONBOARD_PROMPT_HEADER = "[Holaboss Workspace Onboarding v1]";
const RUNTIME_EXEC_CONTEXT_KEY = "_sandbox_runtime_exec_v1";
const RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY = "model_proxy_api_key";
const RUNTIME_EXEC_SANDBOX_ID_KEY = "sandbox_id";
const RUNTIME_EXEC_RUN_ID_KEY = "run_id";
const DEFAULT_CLAIM_LEASE_SECONDS = 300;
const TERMINAL_OUTPUT_EVENT_TYPES = new Set(["run_completed", "run_failed"]);
const CLAIMED_INPUT_SENTRY_TEXT_LIMIT = 1200;
const CLAIMED_INPUT_SENTRY_EVENT_PREVIEW_LIMIT = 400;
const CLAIMED_INPUT_SENTRY_ARRAY_LIMIT = 10;
const CLAIMED_INPUT_SENTRY_OBJECT_LIMIT = 20;
const CLAIMED_INPUT_SENTRY_RECENT_EVENT_LIMIT = 8;
const CLAIMED_INPUT_SENTRY_PERMISSION_DENIAL_LIMIT = 10;
const BACKEND_OUTPUT_DELTA_RELAY_FLUSH_CHARS = 1200;
const CONTEXT_BUDGET_OBSERVABILITY_SCHEMA_VERSION = 1;
const CONTEXT_BUDGET_COMPACTION_EVENT_TYPES = new Set([
  "auto_compaction_start",
  "auto_compaction_end",
  "compaction_start",
  "compaction_boundary_written",
  "compaction_end",
  "compaction_restored",
]);

interface SessionInputAttachment {
  id: string;
  kind: "image" | "file" | "folder";
  name: string;
  mime_type: string;
  size_bytes: number;
  workspace_path: string;
}

interface RuntimeBindingSentryContextInput {
  authToken: string;
  userId: string;
  sandboxId: string;
  modelProxyBaseUrl: string;
  defaultModel?: string;
  defaultProvider?: string;
}

interface TurnContextBudgetTelemetry {
  modelTurns: number;
  compactionEvents: number;
  largestToolPayloadBytes: number;
  browserSnapshotBytes: number;
  screenshotBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSessionInputAttachment(
  value: unknown,
): SessionInputAttachment | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const mimeType =
    typeof value.mime_type === "string" ? value.mime_type.trim() : "";
  const workspacePath =
    typeof value.workspace_path === "string" ? value.workspace_path.trim() : "";
  const sizeBytes =
    typeof value.size_bytes === "number" && Number.isFinite(value.size_bytes)
      ? value.size_bytes
      : 0;
  const kind =
    value.kind === "image"
      ? "image"
      : value.kind === "folder"
        ? "folder"
        : value.kind === "file"
          ? "file"
          : mimeType.startsWith("image/")
            ? "image"
            : mimeType === "inode/directory"
              ? "folder"
              : "file";
  if (!id || !name || !mimeType || !workspacePath) {
    return null;
  }
  return {
    id,
    kind,
    name,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    workspace_path: workspacePath,
  };
}

function sessionInputAttachments(value: unknown): SessionInputAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => parseSessionInputAttachment(item))
    .filter((item): item is SessionInputAttachment => Boolean(item));
}

function defaultInstructionForAttachments(
  attachments: SessionInputAttachment[],
): string {
  if (attachments.length === 0) {
    return "";
  }
  if (attachments.length === 1) {
    return attachments[0].kind === "image"
      ? "Review the attached image."
      : attachments[0].kind === "folder"
        ? "Review the attached folder."
        : "Review the attached file.";
  }
  if (attachments.some((attachment) => attachment.kind === "image")) {
    return "Review the attached files, folders, and images.";
  }
  if (attachments.some((attachment) => attachment.kind === "folder")) {
    return "Review the attached files and folders.";
  }
  return "Review the attached files.";
}

function selectedHarness(): string {
  return normalizeHarnessId(process.env.SANDBOX_AGENT_HARNESS);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function claimedInputRunId(params: {
  workspaceId: string;
  sessionId: string;
  inputId: string;
}): string {
  return `${params.workspaceId}:${params.sessionId}:${params.inputId}`;
}

function canMergeOutputDeltaRelayPayload(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  const existingKeys = Object.keys(existing)
    .filter((key) => key !== "delta")
    .sort();
  const nextKeys = Object.keys(next)
    .filter((key) => key !== "delta")
    .sort();
  if (existingKeys.length !== nextKeys.length) {
    return false;
  }
  for (let index = 0; index < existingKeys.length; index += 1) {
    const existingKey = existingKeys[index];
    const nextKey = nextKeys[index];
    if (existingKey !== nextKey) {
      return false;
    }
    if (JSON.stringify(existing[existingKey]) !== JSON.stringify(next[nextKey])) {
      return false;
    }
  }
  return true;
}

function mergeOutputDeltaRelayPayload(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...existing,
    delta: `${typeof existing.delta === "string" ? existing.delta : ""}${typeof next.delta === "string" ? next.delta : ""}`,
  };
}

function runtimeBindingSentryContext(params: {
  runtimeBinding: RuntimeBindingSentryContextInput;
  runtimeExecContext?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    user_id: nonEmptyString(params.runtimeBinding.userId),
    sandbox_id: nonEmptyString(params.runtimeBinding.sandboxId),
    model_proxy_base_url: nonEmptyString(
      params.runtimeBinding.modelProxyBaseUrl,
    ),
    default_model: nonEmptyString(params.runtimeBinding.defaultModel),
    default_provider: nonEmptyString(params.runtimeBinding.defaultProvider),
    has_auth_token: Boolean(params.runtimeBinding.authToken.trim()),
    exec_sandbox_id: params.runtimeExecContext
      ? nonEmptyString(params.runtimeExecContext[RUNTIME_EXEC_SANDBOX_ID_KEY])
      : null,
    exec_run_id: params.runtimeExecContext
      ? nonEmptyString(params.runtimeExecContext[RUNTIME_EXEC_RUN_ID_KEY])
      : null,
    has_exec_model_proxy_api_key: params.runtimeExecContext
      ? Boolean(
          nonEmptyString(
            params.runtimeExecContext[RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY],
          ),
        )
      : false,
  };
}

function backendAgentRunsEndpoint(params: {
  workspaceId: string;
  modelProxyBaseUrl: string;
  pathSuffix: "start" | "events";
}): string | null {
  const modelProxyBaseUrl = params.modelProxyBaseUrl.trim();
  if (!modelProxyBaseUrl) {
    return null;
  }
  try {
    const baseUrl = new URL(
      modelProxyBaseUrl.endsWith("/")
        ? modelProxyBaseUrl
        : `${modelProxyBaseUrl}/`,
    );
    const normalizedBasePath = baseUrl.pathname.replace(/\/+$/, "");
    const controlPlaneBasePath = normalizedBasePath.endsWith(
      "/api/v1/model-proxy",
    )
      ? normalizedBasePath.slice(0, -"/api/v1/model-proxy".length)
      : normalizedBasePath;
    baseUrl.pathname = `${controlPlaneBasePath}/api/v1/sandbox/workspaces/${encodeURIComponent(params.workspaceId)}/agent-runs/${params.pathSuffix}`;
    baseUrl.search = "";
    baseUrl.hash = "";
    return baseUrl.toString();
  } catch (error) {
    console.warn(
      `Failed to build backend agent-runs ${params.pathSuffix} endpoint URL`,
      error,
    );
    return null;
  }
}

async function postWorkspaceAgentRunRequest(params: {
  workspaceId: string;
  runtimeBinding: {
    authToken: string;
    userId: string;
    sandboxId: string;
    modelProxyBaseUrl: string;
  };
  pathSuffix: "start" | "events";
  body: object;
  fetchImpl?: typeof fetch;
  failureLabel: string;
  runId: string;
  captureRuntimeExceptionFn?: typeof captureRuntimeException;
}): Promise<void> {
  const authToken = params.runtimeBinding.authToken.trim();
  const userId = params.runtimeBinding.userId.trim();
  if (!authToken || !userId) {
    return;
  }

  const endpoint = backendAgentRunsEndpoint({
    workspaceId: params.workspaceId,
    modelProxyBaseUrl: params.runtimeBinding.modelProxyBaseUrl,
    pathSuffix: params.pathSuffix,
  });
  if (!endpoint) {
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": authToken,
    "X-Holaboss-User-Id": userId,
  };
  const sandboxId = params.runtimeBinding.sandboxId.trim();
  if (sandboxId) {
    headers["X-Holaboss-Sandbox-Id"] = sandboxId;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  const fetchImpl = params.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(params.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const responseBody = sanitizeRuntimeSentryValue(
        await response.text().catch(() => ""),
        "response_body",
        CLAIMED_INPUT_SENTRY_EVENT_PREVIEW_LIMIT,
      );
      (params.captureRuntimeExceptionFn ?? captureRuntimeException)({
        error: new Error(
          `${params.failureLabel} failed with status ${response.status} for run ${params.runId}`,
        ),
        level: "error",
        fingerprint: [
          "runtime",
          "claimed_input",
          `backend_run_${params.pathSuffix}_registration`,
          String(response.status),
        ],
        tags: {
          surface: "claimed_input_executor",
          failure_kind: `backend_run_${params.pathSuffix}_registration`,
          backend_path: params.pathSuffix,
          http_status: response.status,
        },
        contexts: {
          agent_run_registration: {
            workspace_id: params.workspaceId,
            run_id: params.runId,
            path_suffix: params.pathSuffix,
            endpoint,
          },
          runtime_binding: runtimeBindingSentryContext({
            runtimeBinding: params.runtimeBinding,
          }),
        },
        extras: {
          request_body: sanitizeRuntimeSentryValue(params.body),
          response_body: responseBody,
          timeout_ms: 2000,
        },
      });
      console.warn(
        `${params.failureLabel} failed with status ${response.status} for run ${params.runId}`,
      );
    }
  } catch (error) {
    const fetchError = extractRuntimeFetchErrorDiagnostics(error);
    (params.captureRuntimeExceptionFn ?? captureRuntimeException)({
      error,
      level: "error",
      fingerprint: [
        "runtime",
        "claimed_input",
        `backend_run_${params.pathSuffix}_registration`,
        "fetch_error",
      ],
      tags: {
        surface: "claimed_input_executor",
        failure_kind: `backend_run_${params.pathSuffix}_registration`,
        backend_path: params.pathSuffix,
      },
      contexts: {
        agent_run_registration: {
          workspace_id: params.workspaceId,
          run_id: params.runId,
          path_suffix: params.pathSuffix,
          endpoint,
        },
        runtime_binding: runtimeBindingSentryContext({
          runtimeBinding: params.runtimeBinding,
        }),
      },
      extras: {
        request_body: sanitizeRuntimeSentryValue(params.body),
        timeout_ms: 2000,
        ...(fetchError ? { fetch_error: sanitizeRuntimeSentryValue(fetchError) } : {}),
      },
    });
    console.warn(
      `${params.failureLabel} failed for run ${params.runId}`,
      error,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function registerWorkspaceAgentRunStarted(params: {
  workspaceId: string;
  sessionId: string;
  inputId: string;
  runId: string;
  selectedModel: string | null;
  runtimeBinding: {
    authToken: string;
    userId: string;
    sandboxId: string;
    modelProxyBaseUrl: string;
  };
  fetchImpl?: typeof fetch;
  captureRuntimeExceptionFn?: typeof captureRuntimeException;
}): Promise<void> {
  const requestBody: BackendAgentRunStartRequest = {
    session_id: params.sessionId,
    input_id: params.inputId,
    run_id: params.runId,
    model: params.selectedModel ?? undefined,
  };
  await postWorkspaceAgentRunRequest({
    workspaceId: params.workspaceId,
    runtimeBinding: params.runtimeBinding,
    pathSuffix: "start",
    body: requestBody,
    fetchImpl: params.fetchImpl,
    failureLabel: "Backend run-start registration",
    runId: params.runId,
    captureRuntimeExceptionFn: params.captureRuntimeExceptionFn,
  });
}

async function registerWorkspaceAgentRunEvent(params: {
  workspaceId: string;
  sessionId: string;
  inputId: string;
  runId: string;
  sequence: number;
  eventType: BackendAgentRunEventType;
  payload: Record<string, unknown>;
  timestamp: string;
  runtimeBinding: {
    authToken: string;
    userId: string;
    sandboxId: string;
    modelProxyBaseUrl: string;
  };
  fetchImpl?: typeof fetch;
  captureRuntimeExceptionFn?: typeof captureRuntimeException;
}): Promise<void> {
  const requestBody: BackendAgentRunEventRequest = {
    session_id: params.sessionId,
    input_id: params.inputId,
    run_id: params.runId,
    sequence: params.sequence,
    event_type: params.eventType,
    payload: params.payload,
    timestamp: params.timestamp,
  };
  await postWorkspaceAgentRunRequest({
    workspaceId: params.workspaceId,
    runtimeBinding: params.runtimeBinding,
    pathSuffix: "events",
    body: requestBody,
    fetchImpl: params.fetchImpl,
    failureLabel: "Backend run-event registration",
    runId: params.runId,
    captureRuntimeExceptionFn: params.captureRuntimeExceptionFn,
  });
}

export { registerWorkspaceAgentRunEvent, registerWorkspaceAgentRunStarted };

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
    selectedModel:
      typeof params.model === "string"
        ? params.model
        : params.runtimeBinding.defaultModel,
    defaultProviderId: params.runtimeBinding.defaultProvider,
    runtimeExecModelProxyApiKey:
      typeof params.runtimeExecContext[RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY] ===
      "string"
        ? params.runtimeExecContext[RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY]
        : params.runtimeBinding.authToken,
    runtimeExecSandboxId:
      typeof params.runtimeExecContext[RUNTIME_EXEC_SANDBOX_ID_KEY] === "string"
        ? params.runtimeExecContext[RUNTIME_EXEC_SANDBOX_ID_KEY]
        : params.runtimeBinding.sandboxId,
    runtimeExecRunId: nonEmptyString(
      params.runtimeExecContext[RUNTIME_EXEC_RUN_ID_KEY],
    ),
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
    sessionId: params.sessionId,
  });
  if (existing && existing.harnessSessionId.trim()) {
    return existing.harnessSessionId;
  }
  const binding = params.store.upsertBinding({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    harness: params.harness,
    harnessSessionId: params.sessionId,
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
  const trimmed =
    params.text.trim() || defaultInstructionForAttachments(params.attachments);
  if (!trimmed) {
    throw new Error("text or attachments are required");
  }
  const onboardingStatus = (params.workspace.onboardingStatus ?? "")
    .trim()
    .toLowerCase();
  const onboardingSessionId = (
    params.workspace.onboardingSessionId ?? ""
  ).trim();
  if (
    !["pending", "awaiting_confirmation"].includes(onboardingStatus) ||
    onboardingSessionId !== params.sessionId
  ) {
    return trimmed;
  }

  const onboardPath = path.join(
    params.workspaceRoot,
    params.workspaceId,
    "ONBOARD.md",
  );
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
    trimmed,
  ]
    .join("\n")
    .trim();
}

function createdAtForEvent(event: RunnerEvent): string | undefined {
  return typeof event.timestamp === "string" && event.timestamp.trim()
    ? event.timestamp
    : undefined;
}

function inferSessionKind(params: {
  workspace: WorkspaceRecord;
  sessionId: string;
  persistedKind?: string | null;
}): string {
  const persistedKind =
    typeof params.persistedKind === "string" ? params.persistedKind.trim() : "";
  if (persistedKind) {
    return persistedKind;
  }
  const sessionId = params.sessionId.trim();
  const onboardingSessionId = (
    params.workspace.onboardingSessionId ?? ""
  ).trim();
  const onboardingStatus = (params.workspace.onboardingStatus ?? "")
    .trim()
    .toLowerCase();
  if (
    sessionId &&
    sessionId === onboardingSessionId &&
    ["pending", "awaiting_confirmation", "in_progress"].includes(
      onboardingStatus,
    )
  ) {
    return "onboarding";
  }
  return "workspace_session";
}

function payloadForEvent(event: RunnerEvent): Record<string, unknown> {
  return isRecord(event.payload) ? event.payload : {};
}

function truncateRuntimeSentryText(text: string, limit: number): string {
  const redacted = redactRuntimeSentryText(text);
  if (redacted.length <= limit) {
    return redacted;
  }
  return `${redacted.slice(0, limit)}...[truncated ${redacted.length - limit} chars]`;
}

function sanitizeRuntimeSentryValue(
  value: unknown,
  keyName = "",
  textLimit = CLAIMED_INPUT_SENTRY_TEXT_LIMIT,
): unknown {
  const redacted = redactRuntimeSentryValue(value, keyName);
  if (typeof redacted === "string") {
    return truncateRuntimeSentryText(redacted, textLimit);
  }
  if (Array.isArray(redacted)) {
    const items = redacted
      .slice(0, CLAIMED_INPUT_SENTRY_ARRAY_LIMIT)
      .map((entry) => sanitizeRuntimeSentryValue(entry, "", textLimit));
    if (redacted.length > CLAIMED_INPUT_SENTRY_ARRAY_LIMIT) {
      items.push(
        `[truncated ${redacted.length - CLAIMED_INPUT_SENTRY_ARRAY_LIMIT} items]`,
      );
    }
    return items;
  }
  if (isRecord(redacted)) {
    const entries = Object.entries(redacted);
    const limitedEntries = entries
      .slice(0, CLAIMED_INPUT_SENTRY_OBJECT_LIMIT)
      .map(([key, entry]) => [
        key,
        sanitizeRuntimeSentryValue(entry, key, textLimit),
      ]);
    if (entries.length > CLAIMED_INPUT_SENTRY_OBJECT_LIMIT) {
      limitedEntries.push([
        "truncated_entries",
        entries.length - CLAIMED_INPUT_SENTRY_OBJECT_LIMIT,
      ]);
    }
    return Object.fromEntries(limitedEntries);
  }
  return redacted;
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

function orderedAssistantMessageTimestamp(
  turnStartedAt: string,
  completedAt: string | null,
): string {
  const startedAtMs = Date.parse(turnStartedAt);
  const completedAtMs = Date.parse(completedAt ?? "");
  if (Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)) {
    return new Date(Math.max(startedAtMs + 1, completedAtMs)).toISOString();
  }
  if (Number.isFinite(startedAtMs)) {
    return new Date(startedAtMs + 1).toISOString();
  }
  if (Number.isFinite(completedAtMs)) {
    return new Date(completedAtMs).toISOString();
  }
  return new Date().toISOString();
}

function tokenUsageFromPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const direct = jsonRecord(payload.token_usage);
  if (direct) {
    return direct;
  }
  return jsonRecord(payload.usage);
}

function contextUsageFromPayload(
  payload: Record<string, unknown>,
): PiContextUsage | null {
  return normalizePiContextUsage(payload.context_usage);
}

function createTurnContextBudgetTelemetry(): TurnContextBudgetTelemetry {
  return {
    modelTurns: 0,
    compactionEvents: 0,
    largestToolPayloadBytes: 0,
    browserSnapshotBytes: 0,
    screenshotBytes: 0,
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jsonByteLength(value: unknown): number {
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" ? Buffer.byteLength(text, "utf8") : 0;
  } catch {
    return 0;
  }
}

function nestedRecord(
  value: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  return value && isRecord(value[key])
    ? (value[key] as Record<string, unknown>)
    : null;
}

function firstFiniteUsageNumber(
  usage: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (!usage) {
    return null;
  }
  for (const key of keys) {
    const direct = finiteNumber(usage[key]);
    if (direct !== null) {
      return direct;
    }
  }
  return null;
}

function tokenDetailNumber(
  usage: Record<string, unknown> | null,
  detailKeys: string[],
  keys: string[],
): number | null {
  if (!usage) {
    return null;
  }
  for (const detailKey of detailKeys) {
    const detail = nestedRecord(usage, detailKey);
    const value = firstFiniteUsageNumber(detail, keys);
    if (value !== null) {
      return value;
    }
  }
  return firstFiniteUsageNumber(usage, keys);
}

function latencyMs(startedAt: string, completedAt: string | null): number | null {
  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt ?? "");
  if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs)) {
    return null;
  }
  return Math.max(0, completedMs - startedMs);
}

function contextUsagePayload(contextUsage: PiContextUsage | null): Record<string, unknown> | null {
  if (!contextUsage) {
    return null;
  }
  return {
    tokens: contextUsage.tokens,
    context_window: contextUsage.contextWindow,
    percent: contextUsage.percent,
  };
}

function promptCacheStableCandidate(promptCacheProfile: Record<string, unknown> | null): boolean {
  if (!promptCacheProfile) {
    return false;
  }
  if (typeof promptCacheProfile.cacheable_fingerprint === "string" && promptCacheProfile.cacheable_fingerprint) {
    return true;
  }
  return Array.isArray(promptCacheProfile.cacheable_section_ids) && promptCacheProfile.cacheable_section_ids.length > 0;
}

function turnResultStatusFromTerminalStatus(
  terminalStatus: "IDLE" | "WAITING_USER" | "PAUSED" | "ERROR",
): "completed" | "waiting_user" | "paused" | "failed" {
  if (terminalStatus === "ERROR") {
    return "failed";
  }
  if (terminalStatus === "WAITING_USER") {
    return "waiting_user";
  }
  if (terminalStatus === "PAUSED") {
    return "paused";
  }
  return "completed";
}

function updateTurnContextBudgetTelemetryFromEvent(
  telemetry: TurnContextBudgetTelemetry,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  if (eventType === "pi_native_event" && payload.native_type === "message_end") {
    telemetry.modelTurns += 1;
  }
  if (CONTEXT_BUDGET_COMPACTION_EVENT_TYPES.has(eventType)) {
    telemetry.compactionEvents += 1;
  }
  if (eventType !== "tool_call") {
    return;
  }

  const toolPayload =
    payload.result !== undefined && payload.result !== null
      ? payload.result
      : payload.tool_args !== undefined && payload.tool_args !== null
        ? payload.tool_args
        : payload;
  telemetry.largestToolPayloadBytes = Math.max(
    telemetry.largestToolPayloadBytes,
    jsonByteLength(toolPayload),
  );

  const toolName = optionalString(payload.tool_name)?.toLowerCase() ?? "";
  const result = payload.result;
  const resultRecord = jsonRecord(result);
  const screenshotPayload = resultRecord?.screenshot ?? (toolName === "browser_screenshot" ? result : null);
  if (screenshotPayload !== null && screenshotPayload !== undefined) {
    telemetry.screenshotBytes += jsonByteLength(screenshotPayload);
  }
  if (toolName === "browser_get_state") {
    if (resultRecord) {
      const { screenshot: _screenshot, ...snapshotWithoutScreenshot } = resultRecord;
      telemetry.browserSnapshotBytes += jsonByteLength(snapshotWithoutScreenshot);
    } else {
      telemetry.browserSnapshotBytes += jsonByteLength(result);
    }
  }
}

function buildContextBudgetObservabilityPayload(params: {
  startedAt: string;
  completedAt: string | null;
  terminalStatus: "IDLE" | "WAITING_USER" | "PAUSED" | "ERROR";
  stopReason: string | null;
  tokenUsage: Record<string, unknown> | null;
  contextUsage: PiContextUsage | null;
  promptCacheProfile: Record<string, unknown> | null;
  telemetry: TurnContextBudgetTelemetry;
  toolCallCount: number;
  checkpointQueued: boolean;
}): Record<string, unknown> {
  const inputTokens =
    firstFiniteUsageNumber(params.tokenUsage, ["input_tokens", "prompt_tokens"]);
  const outputTokens = firstFiniteUsageNumber(params.tokenUsage, [
    "output_tokens",
    "completion_tokens",
  ]);
  const totalTokens =
    firstFiniteUsageNumber(params.tokenUsage, ["total_tokens"]) ??
    (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  const cachedInputTokens = tokenDetailNumber(
    params.tokenUsage,
    ["input_tokens_details", "prompt_tokens_details"],
    ["cached_tokens"],
  ) ?? firstFiniteUsageNumber(params.tokenUsage, [
    "cache_read_input_tokens",
    "cached_input_tokens",
  ]);
  const cacheWriteInputTokens = tokenDetailNumber(
    params.tokenUsage,
    ["input_tokens_details", "prompt_tokens_details"],
    ["cache_creation_tokens", "cache_write_tokens", "cache_creation_input_tokens"],
  ) ?? firstFiniteUsageNumber(params.tokenUsage, [
    "cache_creation_input_tokens",
    "cache_write_input_tokens",
  ]);
  const uncachedInputTokens =
    inputTokens !== null && cachedInputTokens !== null
      ? Math.max(0, inputTokens - cachedInputTokens)
      : inputTokens;
  const status = turnResultStatusFromTerminalStatus(params.terminalStatus);
  const modelTurns =
    params.telemetry.modelTurns > 0 || !params.tokenUsage
      ? params.telemetry.modelTurns
      : 1;

  return {
    schema_version: CONTEXT_BUDGET_OBSERVABILITY_SCHEMA_VERSION,
    mode: "observability_only",
    pressure_stage: null,
    lane_decisions: [],
    checkpoint_recommended: shouldQueueSessionCheckpoint(params.contextUsage),
    checkpoint_queued: params.checkpointQueued,
    prompt_cache_stable_candidate: promptCacheStableCandidate(params.promptCacheProfile),
    tool_replay_trimmed: false,
    retrieval_clipped: false,
    reason_codes: [],
    context_usage: contextUsagePayload(params.contextUsage),
    model_context_window: params.contextUsage?.contextWindow ?? null,
    input_budget_total: null,
    metrics: {
      status,
      stop_reason: params.stopReason,
      task_success: status !== "failed",
      latency_ms: latencyMs(params.startedAt, params.completedAt),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      cached_input_tokens: cachedInputTokens,
      cache_write_input_tokens: cacheWriteInputTokens,
      uncached_input_tokens: uncachedInputTokens,
      model_turns: modelTurns,
      tool_calls: params.toolCallCount,
      largest_tool_payload_bytes: params.telemetry.largestToolPayloadBytes,
      browser_snapshot_bytes: params.telemetry.browserSnapshotBytes,
      screenshot_bytes: params.telemetry.screenshotBytes,
      compaction_events: params.telemetry.compactionEvents,
    },
  };
}

function claimLeaseUntilIso(
  leaseSeconds: number,
  nowIso = new Date().toISOString(),
): string {
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
    const status =
      typeof params.payload.status === "string"
        ? params.payload.status.trim().toLowerCase()
        : "";
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
    if (
      typeof params.payload.message === "string" &&
      params.payload.message.trim()
    ) {
      return params.payload.message.trim();
    }
    return "run_failed";
  }
  return null;
}

function permissionDenialFromEventPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  if (payload.error !== true) {
    return null;
  }

  const candidates = [
    typeof payload.message === "string" ? payload.message : null,
    typeof payload.result === "string" ? payload.result : null,
    typeof payload.error_message === "string" ? payload.error_message : null,
  ].filter((value): value is string => Boolean(value && value.trim()));
  const denialText = candidates.find((value) =>
    /permission|denied|not allowed/i.test(value),
  );
  if (!denialText) {
    return null;
  }

  return {
    tool_name:
      typeof payload.tool_name === "string" ? payload.tool_name : "unknown",
    tool_id: typeof payload.tool_id === "string" ? payload.tool_id : null,
    reason: denialText,
  };
}

function normalizedFailureKindSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

function terminalFailureKindFromPayload(
  payload: Record<string, unknown>,
): string {
  const errorType = optionalString(payload.type);
  if (errorType) {
    return `terminal_${normalizedFailureKindSegment(errorType)}`;
  }
  const stopReason = optionalString(payload.stop_reason);
  if (stopReason) {
    return `terminal_${normalizedFailureKindSegment(stopReason)}`;
  }
  return "terminal_run_failed";
}

function summarizeRunnerEventForSentry(params: {
  sequence: number;
  eventType: string;
  timestamp: string;
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    sequence: params.sequence,
    event_type: params.eventType,
    timestamp: params.timestamp,
  };
  if (params.eventType === "output_delta") {
    const delta = optionalString(params.payload.delta);
    summary.payload = {
      delta_chars: typeof delta === "string" ? delta.length : 0,
    };
    return summary;
  }

  const payloadSummary: Record<string, unknown> = {};
  for (const key of [
    "type",
    "status",
    "message",
    "error_message",
    "stop_reason",
    "source",
    "phase",
    "tool_name",
    "tool_id",
    "call_id",
    "harness_session_id",
  ]) {
    if (!(key in params.payload)) {
      continue;
    }
    payloadSummary[key] = sanitizeRuntimeSentryValue(
      params.payload[key],
      key,
      CLAIMED_INPUT_SENTRY_EVENT_PREVIEW_LIMIT,
    );
  }
  if (typeof params.payload.error === "boolean") {
    payloadSummary.error = params.payload.error;
  }
  if (Object.keys(payloadSummary).length === 0 && Object.keys(params.payload).length > 0) {
    payloadSummary.preview = truncateRuntimeSentryText(
      JSON.stringify(sanitizeRuntimeSentryValue(params.payload)) ?? "{}",
      CLAIMED_INPUT_SENTRY_EVENT_PREVIEW_LIMIT,
    );
  }
  if (Object.keys(payloadSummary).length > 0) {
    summary.payload = payloadSummary;
  }
  return summary;
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

function cronjobNotificationPriority(
  value: unknown,
): "low" | "normal" | "high" | "critical" {
  const normalized = optionalString(value)?.toLowerCase();
  if (
    normalized === "low" ||
    normalized === "high" ||
    normalized === "critical"
  ) {
    return normalized;
  }
  return "normal";
}

function cronjobNotificationBaseTitle(job: {
  name: string;
  metadata: Record<string, unknown>;
}): string {
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

function cronjobCompletionNotificationTitle(
  turnResult: TurnResultRecord,
  baseTitle: string,
): string {
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

function cronjobCompletionNotificationMessage(
  turnResult: TurnResultRecord,
): string {
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
  const context = isRecord(params.record.payload.context)
    ? params.record.payload.context
    : null;
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
  const context = isRecord(params.record.payload.context)
    ? params.record.payload.context
    : null;
  const source = optionalString(context?.source)?.toLowerCase();
  const proposalSource = optionalString(
    context?.proposal_source,
  )?.toLowerCase();
  const evolveCandidate = isRecord(context?.evolve_candidate)
    ? context?.evolve_candidate
    : null;
  const candidateId = optionalString(evolveCandidate?.candidate_id);
  if (
    source !== "task_proposal" ||
    proposalSource !== "evolve" ||
    !candidateId
  ) {
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

function summarizeSkillInvocations(
  skillInvocationsById: Map<string, SkillInvocationSummaryEntry>,
): Record<string, unknown> {
  const calls = [...skillInvocationsById.values()];
  return {
    total_calls: calls.length,
    completed_calls: calls.filter((call) => call.completed && !call.error)
      .length,
    failed_calls: calls.filter((call) => call.error).length,
    skill_names: [
      ...new Set(calls.map((call) => call.skillName).filter(Boolean)),
    ].sort((left, right) => left.localeCompare(right)),
    skill_ids: [
      ...new Set(
        calls
          .map((call) => call.skillId)
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort((left, right) => left.localeCompare(right)),
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

function skillWideningSummary(
  audit: SkillWideningAudit,
): Record<string, unknown> | null {
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
    managed_tools: [...audit.managedTools].sort((left, right) =>
      left.localeCompare(right),
    ),
    granted_tools: [...audit.grantedTools].sort((left, right) =>
      left.localeCompare(right),
    ),
    active_granted_tools: [...audit.activeGrantedTools].sort((left, right) =>
      left.localeCompare(right),
    ),
    managed_commands: [...audit.managedCommands].sort((left, right) =>
      left.localeCompare(right),
    ),
    granted_commands: [...audit.grantedCommands].sort((left, right) =>
      left.localeCompare(right),
    ),
    active_granted_commands: [...audit.activeGrantedCommands].sort(
      (left, right) => left.localeCompare(right),
    ),
    activation_count: audit.activationCount,
    denied_calls: audit.deniedCalls,
    denied_tool_names: [...audit.deniedToolNames].sort((left, right) =>
      left.localeCompare(right),
    ),
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
  return candidates.some((value) =>
    /permission denied by skill policy/i.test(value),
  );
}

function summarizeToolCalls(
  toolCallsById: Map<
    string,
    {
      toolName: string;
      toolId: string | null;
      completed: boolean;
      error: boolean;
    }
  >,
  skillInvocationsById: Map<string, SkillInvocationSummaryEntry> = new Map(),
  wideningAudit: SkillWideningAudit | null = null,
): Record<string, unknown> {
  const calls = [...toolCallsById.values()];
  const summary: Record<string, unknown> = {
    total_calls: calls.length,
    completed_calls: calls.filter((call) => call.completed && !call.error)
      .length,
    failed_calls: calls.filter((call) => call.error).length,
    tool_names: [
      ...new Set(calls.map((call) => call.toolName).filter(Boolean)),
    ].sort((left, right) => left.localeCompare(right)),
    tool_ids: [
      ...new Set(
        calls
          .map((call) => call.toolId)
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort((left, right) => left.localeCompare(right)),
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
  contextBudgetDecisions?: Record<string, unknown> | null;
}): TurnResultRecord {
  return params.store.upsertTurnResult({
    workspaceId: params.record.workspaceId,
    sessionId: params.record.sessionId,
    inputId: params.record.inputId,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    status: turnResultStatusFromTerminalStatus(params.terminalStatus),
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
    contextBudgetDecisions: params.contextBudgetDecisions ?? null,
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
  supportsWaitingUser: boolean,
): "IDLE" | "WAITING_USER" | "PAUSED" {
  const status =
    typeof payload.status === "string"
      ? payload.status.trim().toLowerCase()
      : "";
  if (status === "paused") {
    return "PAUSED";
  }
  return supportsWaitingUser && status === "waiting_user"
    ? "WAITING_USER"
    : "IDLE";
}

function backendRunStatePayload(params: {
  terminalEventType: "run_completed" | "run_failed";
  terminalStatus: "IDLE" | "WAITING_USER" | "PAUSED" | "ERROR";
  stopReason: string | null;
  payload: Record<string, unknown>;
}): Record<string, unknown> | null {
  if (
    params.terminalStatus !== "WAITING_USER" &&
    params.terminalStatus !== "PAUSED"
  ) {
    return null;
  }
  const status =
    params.terminalStatus === "WAITING_USER" ? "waiting_user" : "paused";
  const message =
    optionalString(params.payload.summary) ??
    optionalString(params.payload.message) ??
    (status === "waiting_user"
      ? "Run paused waiting for user input"
      : "Run paused by user request");
  const relayPayload: Record<string, unknown> = {
    status,
    stop_reason: params.stopReason ?? status,
    source: nonEmptyString(params.payload.source) ?? "runner",
    terminal_event_type: params.terminalEventType,
  };
  if (message) {
    relayPayload.message = message;
  }
  const harnessSessionId = nonEmptyString(params.payload.harness_session_id);
  if (harnessSessionId) {
    relayPayload.harness_session_id = harnessSessionId;
  }
  return relayPayload;
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
  const harnessSessionId = nonEmptyString(params.payload.harness_session_id);
  if (!harnessSessionId) {
    return;
  }
  params.store.upsertBinding({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    harness: params.harness,
    harnessSessionId,
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
  registerRunStartedFn?: typeof registerWorkspaceAgentRunStarted;
  relayRunEventFn?: typeof registerWorkspaceAgentRunEvent;
  enqueueSessionCheckpointJobFn?: typeof enqueueSessionCheckpointJob;
  waitForSessionCheckpointCompletionFn?: typeof waitForSessionCheckpointCompletion;
  captureRuntimeExceptionFn?: typeof captureRuntimeException;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { store, record } = params;
  const claimedBy =
    params.claimedBy ?? record.claimedBy ?? "sandbox-agent-ts-worker";
  const shouldTrackClaimOwnership = record.status === "CLAIMED";
  const leaseSeconds = params.leaseSeconds ?? DEFAULT_CLAIM_LEASE_SECONDS;
  const turnStartedAt = new Date().toISOString();
  const executionAbortController = new AbortController();
  const forwardAbortSignal = () => {
    if (executionAbortController.signal.aborted) {
      return;
    }
    const reason =
      typeof params.abortSignal?.reason === "string" &&
      params.abortSignal.reason.trim()
        ? params.abortSignal.reason.trim()
        : "aborted";
    executionAbortController.abort(reason);
  };
  if (params.abortSignal?.aborted) {
    forwardAbortSignal();
  } else {
    params.abortSignal?.addEventListener("abort", forwardAbortSignal, {
      once: true,
    });
  }
  const workspace = store.getWorkspace(record.workspaceId);
  if (!workspace) {
    store.updateInput(record.inputId, {
      status: "FAILED",
      claimedBy: null,
      claimedUntil: null,
    });
    store.updateRuntimeState({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      status: "ERROR",
      currentInputId: null,
      currentWorkerId: null,
      leaseUntil: null,
      heartbeatAt: null,
      lastError: { message: "workspace not found" },
    });
    const completedAt = new Date().toISOString();
    persistTurnResult({
      store,
      record,
      startedAt: turnStartedAt,
      completedAt,
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
      contextBudgetDecisions: buildContextBudgetObservabilityPayload({
        startedAt: turnStartedAt,
        completedAt,
        terminalStatus: "ERROR",
        stopReason: "workspace_not_found",
        tokenUsage: null,
        contextUsage: null,
        promptCacheProfile: null,
        telemetry: createTurnContextBudgetTelemetry(),
        toolCallCount: 0,
        checkpointQueued: false,
      }),
    });
    return;
  }

  const selectedModel = nonEmptyString(record.payload.model);
  const runId = claimedInputRunId({
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    inputId: record.inputId,
  });

  const executeClaimedInput = async (): Promise<void> => {
    const harness = normalizeHarnessId(workspace.harness ?? selectedHarness());
    const workspaceDir = store.workspaceDir(record.workspaceId);
    const session = store.getSession({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
    });
    const sessionKind = inferSessionKind({
      workspace,
      sessionId: record.sessionId,
      persistedKind: session?.kind,
    });
    const harnessSupportsWaitingUser =
      resolveRuntimeHarnessAdapter(harness)?.capabilities.supportsWaitingUser ??
      false;
    const harnessSessionId = ensureLocalBinding({
      store,
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      harness,
    });
    let checkpointHarnessSessionId = harnessSessionId;
    let activeLeaseUntil =
      record.claimedUntil ?? claimLeaseUntilIso(leaseSeconds);
    let lastClaimRenewalAtMs = 0;
    let claimOwnershipLost = false;
    const EVENT_CLAIM_RENEWAL_MIN_INTERVAL_MS = 250;
    const claimStillOwned = () => {
      if (!shouldTrackClaimOwnership) {
        return true;
      }
      const currentRecord = store.getInput(record.inputId);
      return (
        currentRecord?.status === "CLAIMED" &&
        currentRecord.claimedBy === claimedBy
      );
    };
    const markClaimOwnershipLost = (
      source: "checkpoint" | "heartbeat" | "event",
    ) => {
      if (!shouldTrackClaimOwnership || claimOwnershipLost) {
        return false;
      }
      claimOwnershipLost = true;
      if (!executionAbortController.signal.aborted) {
        executionAbortController.abort("claim_lost");
      }
      (params.captureRuntimeExceptionFn ?? captureRuntimeException)({
        error: new Error("claimed input lost ownership during execution"),
        level: "warning",
        fingerprint: ["runtime", "claimed_input", "claim_lost", harness],
        tags: {
          surface: "claimed_input_executor",
          failure_kind: "claim_lost",
          harness,
          session_kind: sessionKind,
        },
        contexts: {
          claimed_input: {
            workspace_id: record.workspaceId,
            session_id: record.sessionId,
            input_id: record.inputId,
            run_id: runId,
            harness_session_id: checkpointHarnessSessionId,
            selected_model: selectedModel,
          },
        },
        extras: {
          source,
          claimed_by: claimedBy,
          claimed_until: store.getInput(record.inputId)?.claimedUntil ?? null,
        },
      });
      return true;
    };
    const renewClaimLeaseOnly = (source: "checkpoint" | "heartbeat" | "event") => {
      const nowMs = Date.now();
      if (
        source === "event" &&
        nowMs - lastClaimRenewalAtMs < EVENT_CLAIM_RENEWAL_MIN_INTERVAL_MS
      ) {
        if (shouldTrackClaimOwnership && !claimStillOwned()) {
          markClaimOwnershipLost(source);
          return false;
        }
        return !claimOwnershipLost;
      }

      if (shouldTrackClaimOwnership) {
        const renewedClaim = store.renewInputClaim({
          inputId: record.inputId,
          claimedBy,
          leaseSeconds,
        });
        if (!renewedClaim?.claimedUntil) {
          markClaimOwnershipLost(source);
          return false;
        }
        activeLeaseUntil = renewedClaim.claimedUntil;
      }
      lastClaimRenewalAtMs = nowMs;
      return !claimOwnershipLost;
    };
    await (
      params.waitForSessionCheckpointCompletionFn ??
      waitForSessionCheckpointCompletion
    )({
      store,
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      wakeWorker: params.wakeDurableMemoryWorker ?? null,
      renewLease: () => {
        renewClaimLeaseOnly("checkpoint");
      },
      abortSignal: executionAbortController.signal,
    });
    if (claimOwnershipLost || !claimStillOwned()) {
      return;
    }
    const attachments = sessionInputAttachments(record.payload.attachments);

    const instruction = buildOnboardingInstruction({
      workspaceRoot: store.workspaceRoot,
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      text: String(record.payload.text ?? ""),
      attachments,
      workspace,
    });
    store.insertSessionMessage({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      role: "user",
      text: String(record.payload.text ?? ""),
      messageId: `user-${record.inputId}`,
      createdAt: turnStartedAt,
    });

    store.updateRuntimeState({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      status: "BUSY",
      currentInputId: record.inputId,
      currentWorkerId: claimedBy,
      leaseUntil: activeLeaseUntil,
      heartbeatAt: undefined,
      lastError: null,
    });

    const runtimeContext = isRecord(record.payload.context)
      ? { ...record.payload.context }
      : {};
    const priorExecContext = isRecord(runtimeContext[RUNTIME_EXEC_CONTEXT_KEY])
      ? { ...runtimeContext[RUNTIME_EXEC_CONTEXT_KEY] }
      : {};
    const resolveRuntimeConfig =
      params.resolveProductRuntimeConfigFn ?? resolveProductRuntimeConfig;
    const runtimeBinding = resolveRuntimeConfig({
      requireAuth: false,
      requireUser: false,
      requireBaseUrl: false,
    });
    if (
      typeof priorExecContext[RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY] !==
        "string" &&
      runtimeBinding.authToken
    ) {
      priorExecContext[RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY] =
        runtimeBinding.authToken;
    }
    if (
      typeof priorExecContext[RUNTIME_EXEC_SANDBOX_ID_KEY] !== "string" &&
      runtimeBinding.sandboxId
    ) {
      priorExecContext[RUNTIME_EXEC_SANDBOX_ID_KEY] = runtimeBinding.sandboxId;
    }
    if (!nonEmptyString(priorExecContext[RUNTIME_EXEC_RUN_ID_KEY])) {
      priorExecContext[RUNTIME_EXEC_RUN_ID_KEY] = runId;
    }
    priorExecContext.harness = harness;
    priorExecContext.harness_session_id = harnessSessionId;
    runtimeContext[RUNTIME_EXEC_CONTEXT_KEY] = priorExecContext;
    const registerRunStarted =
      params.registerRunStartedFn ?? registerWorkspaceAgentRunStarted;
    const relayRunEvent =
      params.relayRunEventFn ?? registerWorkspaceAgentRunEvent;
    const enqueueCheckpointJob =
      params.enqueueSessionCheckpointJobFn ?? enqueueSessionCheckpointJob;
    await registerRunStarted({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      inputId: record.inputId,
      runId,
      selectedModel,
      runtimeBinding,
      captureRuntimeExceptionFn: params.captureRuntimeExceptionFn,
    });

    const harnessTimeoutSeconds =
      resolveRuntimeHarnessPlugin(harness)?.timeoutSeconds({
        request: {
          workspace_id: record.workspaceId,
          session_id: record.sessionId,
          session_kind: sessionKind,
          input_id: record.inputId,
          instruction,
        },
      }) ?? null;
    const captureClaimedInputFailure = (
      failureKind: string,
      message: string,
      extra: Record<string, unknown> = {},
    ) => {
      const sanitizedExtra = sanitizeRuntimeSentryValue(extra);
      const sanitizedMessage = truncateRuntimeSentryText(
        message,
        CLAIMED_INPUT_SENTRY_EVENT_PREVIEW_LIMIT,
      );
      (
        params.captureRuntimeExceptionFn ?? captureRuntimeException
      )({
        error: new Error(sanitizedMessage),
        level: "error",
        fingerprint: ["runtime", "claimed_input", failureKind, harness],
        tags: {
          surface: "claimed_input_executor",
          failure_kind: failureKind,
          harness,
          session_kind: sessionKind,
        },
        contexts: {
          claimed_input: {
            workspace_id: record.workspaceId,
            session_id: record.sessionId,
            input_id: record.inputId,
            run_id: runId,
            harness_session_id: checkpointHarnessSessionId,
            selected_model: selectedModel,
          },
          runtime_binding: runtimeBindingSentryContext({
            runtimeBinding,
            runtimeExecContext: priorExecContext,
          }),
        },
        extras: {
          last_sequence: lastSequence,
          harness_timeout_seconds: harnessTimeoutSeconds,
          tool_usage_summary: sanitizeRuntimeSentryValue(
            summarizeToolCalls(toolCallsById, skillInvocationsById, wideningAudit),
          ),
          permission_denials: sanitizeRuntimeSentryValue(
            permissionDenials.slice(0, CLAIMED_INPUT_SENTRY_PERMISSION_DENIAL_LIMIT),
          ),
          prompt_section_ids: promptSectionIds,
          capability_manifest_fingerprint: capabilityManifestFingerprint,
          request_snapshot_fingerprint: requestSnapshotFingerprint,
          prompt_cache_profile: sanitizeRuntimeSentryValue(promptCacheProfile),
          assistant_excerpt: assistantParts.length
            ? truncateRuntimeSentryText(
                assistantParts.join("").trim(),
                CLAIMED_INPUT_SENTRY_TEXT_LIMIT,
              )
            : null,
          recent_runner_events: sanitizeRuntimeSentryValue(recentRunnerEvents),
          ...(isRecord(sanitizedExtra) ? sanitizedExtra : {}),
        },
      });
    };

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
      harness_timeout_seconds: harnessTimeoutSeconds,
      debug: false,
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
    let contextUsage: PiContextUsage | null = null;
    let promptSectionIds: string[] = [];
    let capabilityManifestFingerprint: string | null = null;
    let requestSnapshotFingerprint: string | null = null;
    let promptCacheProfile: Record<string, unknown> | null = null;
    const toolCallsById = new Map<
      string,
      {
        toolName: string;
        toolId: string | null;
        completed: boolean;
        error: boolean;
      }
    >();
    const skillInvocationsById = new Map<string, SkillInvocationSummaryEntry>();
    const wideningAudit = createSkillWideningAudit();
    const permissionDenials: Array<Record<string, unknown>> = [];
    const recentRunnerEvents: Array<Record<string, unknown>> = [];
    const contextBudgetTelemetry = createTurnContextBudgetTelemetry();
    let deferredTerminalEvent: {
      eventType: "run_completed" | "run_failed";
      payload: Record<string, unknown>;
      createdAt: string;
    } | null = null;
    let terminalFailureCaptured = false;
    let workspaceFileManifestBefore: WorkspaceFileManifest | null = null;
    let lastRelayedRunEventSequence = 0;
    let pendingOutputDeltaPayload: Record<string, unknown> | null = null;
    let pendingOutputDeltaSequence = 0;
    let pendingOutputDeltaTimestamp: string | null = null;

    const relayBackendRunEvent = async (relayParams: {
      eventType: BackendAgentRunEventType;
      payload: Record<string, unknown>;
      timestamp: string;
      preferredSequence: number;
    }): Promise<void> => {
      const relaySequence = Math.max(
        Math.max(0, relayParams.preferredSequence),
        lastRelayedRunEventSequence + 1,
        1,
      );
      lastRelayedRunEventSequence = relaySequence;
      await relayRunEvent({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        inputId: record.inputId,
        runId,
        sequence: relaySequence,
        eventType: relayParams.eventType,
        payload: relayParams.payload,
        timestamp: relayParams.timestamp,
        runtimeBinding,
        captureRuntimeExceptionFn: params.captureRuntimeExceptionFn,
      });
    };

    const flushPendingOutputDelta = async (): Promise<void> => {
      if (!pendingOutputDeltaPayload || !pendingOutputDeltaTimestamp) {
        pendingOutputDeltaPayload = null;
        pendingOutputDeltaSequence = 0;
        pendingOutputDeltaTimestamp = null;
        return;
      }
      await relayBackendRunEvent({
        eventType: "output_delta",
        payload: pendingOutputDeltaPayload,
        timestamp: pendingOutputDeltaTimestamp,
        preferredSequence: pendingOutputDeltaSequence,
      });
      pendingOutputDeltaPayload = null;
      pendingOutputDeltaSequence = 0;
      pendingOutputDeltaTimestamp = null;
    };

    try {
      workspaceFileManifestBefore = collectWorkspaceFileManifest(workspaceDir);
    } catch {
      workspaceFileManifestBefore = null;
    }

    const renewClaimLease = (source: "heartbeat" | "event") => {
      const nowMs = Date.now();
      if (
        source === "event" &&
        nowMs - lastClaimRenewalAtMs < EVENT_CLAIM_RENEWAL_MIN_INTERVAL_MS
      ) {
        if (shouldTrackClaimOwnership && !claimStillOwned()) {
          markClaimOwnershipLost(source);
          return false;
        }
        return !claimOwnershipLost;
      }

      if (shouldTrackClaimOwnership) {
        const renewedClaim = store.renewInputClaim({
          inputId: record.inputId,
          claimedBy,
          leaseSeconds,
        });
        if (!renewedClaim?.claimedUntil) {
          markClaimOwnershipLost(source);
          return false;
        }
        activeLeaseUntil = renewedClaim.claimedUntil;
      }
      lastClaimRenewalAtMs = nowMs;
      store.updateRuntimeState({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        status: "BUSY",
        currentInputId: record.inputId,
        currentWorkerId: claimedBy,
        leaseUntil: activeLeaseUntil,
        lastError: null,
      });
      return !claimOwnershipLost;
    };

    try {
      const executeRunner =
        params.executeRunnerRequestFn ?? executeRunnerRequest;
      const execution = await executeRunner(payload, {
        signal: executionAbortController.signal,
        onHeartbeat: () => {
          renewClaimLease("heartbeat");
        },
        onEvent: async (event) => {
          if (!renewClaimLease("event")) {
            return;
          }
          const sequence =
            typeof event.sequence === "number" ? event.sequence : 0;
          lastSequence = Math.max(lastSequence, sequence);
          const eventPayload = payloadForEvent(event);
          const eventTimestamp = eventTimestampOrNow(event);
          const eventType =
            typeof event.event_type === "string" ? event.event_type : "unknown";
          updateTurnContextBudgetTelemetryFromEvent(
            contextBudgetTelemetry,
            eventType,
            eventPayload,
          );
          recentRunnerEvents.push(
            summarizeRunnerEventForSentry({
              sequence,
              eventType,
              timestamp: eventTimestamp,
              payload: eventPayload,
            }),
          );
          if (recentRunnerEvents.length > CLAIMED_INPUT_SENTRY_RECENT_EVENT_LIMIT) {
            recentRunnerEvents.splice(
              0,
              recentRunnerEvents.length - CLAIMED_INPUT_SENTRY_RECENT_EVENT_LIMIT,
            );
          }
          const terminalHarnessSessionId = nonEmptyString(
            eventPayload.harness_session_id,
          );
          if (terminalHarnessSessionId) {
            checkpointHarnessSessionId = terminalHarnessSessionId;
          }
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
              createdAt: eventTimestamp,
            });
          }
          maybePersistHarnessSessionId({
            store,
            workspaceId: record.workspaceId,
            sessionId: record.sessionId,
            harness,
            eventType,
            payload: eventPayload,
          });
          if (
            event.event_type === "output_delta" &&
            typeof eventPayload.delta === "string"
          ) {
            assistantParts.push(eventPayload.delta);
            if (
              pendingOutputDeltaPayload &&
              canMergeOutputDeltaRelayPayload(
                pendingOutputDeltaPayload,
                eventPayload,
              ) &&
              String(pendingOutputDeltaPayload.delta ?? "").length +
                eventPayload.delta.length <=
                BACKEND_OUTPUT_DELTA_RELAY_FLUSH_CHARS
            ) {
              pendingOutputDeltaPayload = mergeOutputDeltaRelayPayload(
                pendingOutputDeltaPayload,
                eventPayload,
              );
            } else {
              await flushPendingOutputDelta();
              pendingOutputDeltaPayload = { ...eventPayload };
            }
            pendingOutputDeltaSequence = Math.max(sequence, 1);
            pendingOutputDeltaTimestamp = eventTimestamp;
          }
          if (event.event_type === "run_started") {
            promptSectionIds = stringList(eventPayload.prompt_section_ids);
            capabilityManifestFingerprint =
              typeof eventPayload.capability_manifest_fingerprint ===
                "string" && eventPayload.capability_manifest_fingerprint.trim()
                ? eventPayload.capability_manifest_fingerprint.trim()
                : capabilityManifestFingerprint;
            requestSnapshotFingerprint =
              typeof eventPayload.request_snapshot_fingerprint === "string" &&
              eventPayload.request_snapshot_fingerprint.trim()
                ? eventPayload.request_snapshot_fingerprint.trim()
                : requestSnapshotFingerprint;
            promptCacheProfile =
              jsonRecord(eventPayload.prompt_cache_profile) ??
              promptCacheProfile;
          }
          if (event.event_type === "tool_call") {
            const callId =
              typeof eventPayload.call_id === "string" &&
              eventPayload.call_id.trim()
                ? eventPayload.call_id.trim()
                : `sequence:${sequence}`;
            const existingCall = toolCallsById.get(callId);
            const toolName =
              typeof eventPayload.tool_name === "string" &&
              eventPayload.tool_name.trim()
                ? eventPayload.tool_name.trim()
                : (existingCall?.toolName ?? "unknown");
            const toolId =
              typeof eventPayload.tool_id === "string" &&
              eventPayload.tool_id.trim()
                ? eventPayload.tool_id.trim()
                : (existingCall?.toolId ?? null);
            const completed =
              eventPayload.phase === "completed" ||
              existingCall?.completed === true;
            const errored =
              eventPayload.error === true || existingCall?.error === true;
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
          if (
            event.event_type === "skill_invocation" ||
            event.event_type === "tool_call"
          ) {
            const callId =
              typeof eventPayload.call_id === "string" &&
              eventPayload.call_id.trim()
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
              const skillId =
                optionalString(eventPayload.skill_id) ??
                existingInvocation?.skillId ??
                null;
              const completed =
                eventPayload.phase === "completed" ||
                existingInvocation?.completed === true;
              const error =
                eventPayload.error === true ||
                existingInvocation?.error === true;
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
              wideningAudit.workspaceBoundaryOverride =
                eventPayload.workspace_boundary_override;
            }
            for (const toolName of stringList(eventPayload.managed_tools)) {
              wideningAudit.managedTools.add(toolName);
            }
            const grantedTools = stringList(eventPayload.granted_tools);
            for (const toolName of grantedTools) {
              wideningAudit.grantedTools.add(toolName);
            }
            for (const toolName of stringList(
              eventPayload.active_granted_tools,
            )) {
              wideningAudit.activeGrantedTools.add(toolName);
            }
            for (const commandId of stringList(eventPayload.managed_commands)) {
              wideningAudit.managedCommands.add(commandId);
            }
            const grantedCommands = stringList(eventPayload.granted_commands);
            for (const commandId of grantedCommands) {
              wideningAudit.grantedCommands.add(commandId);
            }
            for (const commandId of stringList(
              eventPayload.active_granted_commands,
            )) {
              wideningAudit.activeGrantedCommands.add(commandId);
            }
            if (
              eventPayload.phase === "completed" &&
              (grantedTools.length > 0 || grantedCommands.length > 0)
            ) {
              wideningAudit.activationCount += 1;
            }
          }
          if (
            event.event_type === "tool_call" &&
            isSkillPolicyDeniedPayload(eventPayload)
          ) {
            wideningAudit.deniedCalls += 1;
            const toolName = optionalString(eventPayload.tool_name);
            if (toolName) {
              wideningAudit.deniedToolNames.add(toolName);
            }
          }
          if (event.event_type === "run_completed") {
            terminalStatus = terminalStatusForCompletedPayload(
              eventPayload,
              harnessSupportsWaitingUser,
            );
            completedAt = eventTimestamp;
            stopReason = stopReasonForTerminalEvent({
              eventType: "run_completed",
              payload: eventPayload,
              terminalStatus,
            });
            tokenUsage = tokenUsageFromPayload(eventPayload) ?? tokenUsage;
            contextUsage = contextUsageFromPayload(eventPayload) ?? contextUsage;
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
            contextUsage = contextUsageFromPayload(eventPayload) ?? contextUsage;
            if (!terminalFailureCaptured) {
              terminalFailureCaptured = true;
              captureClaimedInputFailure(
                terminalFailureKindFromPayload(eventPayload),
                optionalString(eventPayload.message) ??
                  optionalString(eventPayload.type) ??
                  "runner emitted run_failed",
                {
                  failure_source: "terminal_event",
                  terminal_status: "ERROR",
                  terminal_stop_reason: stopReason,
                  terminal_payload: sanitizeRuntimeSentryValue(eventPayload),
                  event_sequence: sequence,
                  event_timestamp: eventTimestamp,
                },
              );
            }
          }
          if (event.event_type === "tool_call") {
            await flushPendingOutputDelta();
            await relayBackendRunEvent({
              eventType: "tool_call",
              payload: eventPayload,
              timestamp: eventTimestamp,
              preferredSequence: Math.max(sequence, 1),
            });
          }
          if (event.event_type === "skill_invocation") {
            await flushPendingOutputDelta();
            await relayBackendRunEvent({
              eventType: "skill_invocation",
              payload: eventPayload,
              timestamp: eventTimestamp,
              preferredSequence: Math.max(sequence, 1),
            });
          }
        },
      });
      if (claimOwnershipLost || !claimStillOwned()) {
        return;
      }
      await flushPendingOutputDelta();

      const persistedTerminalEvent = latestPersistedTerminalOutputEvent({
        store,
        sessionId: record.sessionId,
        inputId: record.inputId,
      });

      if (persistedTerminalEvent) {
        const persistedPayload = persistedTerminalEvent.payload;
        const terminalHarnessSessionId = nonEmptyString(
          persistedPayload.harness_session_id,
        );
        if (terminalHarnessSessionId) {
          checkpointHarnessSessionId = terminalHarnessSessionId;
        }
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
          contextUsage = contextUsageFromPayload(persistedPayload) ?? contextUsage;
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
          contextUsage = contextUsageFromPayload(persistedPayload) ?? contextUsage;
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
          lastSequence = Math.max(
            lastSequence,
            typeof completed.sequence === "number"
              ? completed.sequence
              : lastSequence + 1,
          );
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
            errorType: "RuntimeError",
          });
          const failurePayload = payloadForEvent(failure);
          lastSequence = Math.max(
            lastSequence,
            typeof failure.sequence === "number"
              ? failure.sequence
              : lastSequence + 1,
          );
          deferredTerminalEvent = {
            eventType: "run_failed",
            payload: failurePayload,
            createdAt: failedAt,
          };
          captureClaimedInputFailure(
            execution.abortReason === "claim_expired"
              ? "claim_expired"
              : "runner_aborted",
            String(failurePayload.message ?? "runner aborted before terminal event"),
            {
              failure_source: "synthetic_terminal_event",
              terminal_status: "ERROR",
              terminal_stop_reason: stopReasonForTerminalEvent({
                eventType: "run_failed",
                payload: failurePayload,
                terminalStatus: "ERROR",
              }),
              terminal_payload: sanitizeRuntimeSentryValue(failurePayload),
              abort_reason: execution.abortReason,
              return_code: execution.returnCode,
              stderr: execution.stderr,
              saw_terminal: execution.sawTerminal,
              skipped_lines: execution.skippedLines.slice(0, 5),
            },
          );
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
        const details =
          execution.skippedLines.length > 0
            ? execution.skippedLines.slice(0, 3).join("; ")
            : "";
        const suffix = details ? ` (skipped output: ${details})` : "";
        const failure = buildRunFailedEvent({
          sessionId: record.sessionId,
          inputId: record.inputId,
          sequence: lastSequence + 1,
          message:
            execution.returnCode !== 0
              ? execution.stderr.trim() ||
                `runner command failed with exit_code=${execution.returnCode}`
              : `runner ended before terminal event${suffix}`,
          errorType:
            execution.returnCode !== 0 ? "RunnerCommandError" : "RuntimeError",
        });
        const failurePayload = payloadForEvent(failure);
        lastSequence = Math.max(
          lastSequence,
          typeof failure.sequence === "number"
            ? failure.sequence
            : lastSequence + 1,
        );
        deferredTerminalEvent = {
          eventType: "run_failed",
          payload: failurePayload,
          createdAt: new Date().toISOString(),
        };
        captureClaimedInputFailure(
          execution.returnCode !== 0
            ? execution.stderr.trim() === "runner command timed out"
              ? "runner_timeout"
              : execution.stderr.includes("became idle")
                ? "runner_idle_timeout"
                : "runner_command_error"
            : "runner_missing_terminal",
          String(failurePayload.message ?? "runner ended before terminal event"),
          {
            failure_source: "synthetic_terminal_event",
            terminal_status: "ERROR",
            terminal_stop_reason: stopReasonForTerminalEvent({
              eventType: "run_failed",
              payload: failurePayload,
              terminalStatus: "ERROR",
            }),
            terminal_payload: sanitizeRuntimeSentryValue(failurePayload),
            return_code: execution.returnCode,
            stderr: execution.stderr,
            saw_terminal: execution.sawTerminal,
            skipped_lines: execution.skippedLines.slice(0, 5),
          },
        );
        terminalStatus = "ERROR";
        lastError = failurePayload;
        completedAt = new Date().toISOString();
        stopReason = stopReasonForTerminalEvent({
          eventType: "run_failed",
          payload: failurePayload,
          terminalStatus,
        });
      }

      let terminalEventToRelay = persistedTerminalEvent
        ? {
            eventType: persistedTerminalEvent.eventType,
            sequence: persistedTerminalEvent.sequence,
            payload: persistedTerminalEvent.payload,
            createdAt: persistedTerminalEvent.createdAt,
          }
        : deferredTerminalEvent
          ? {
              eventType: deferredTerminalEvent.eventType,
              sequence: lastSequence + 1,
              payload: deferredTerminalEvent.payload,
              createdAt: deferredTerminalEvent.createdAt,
            }
          : null;
      if (deferredTerminalEvent) {
        lastSequence = appendNextOutputEvent({
          store,
          record,
          lastSequence,
          eventType: deferredTerminalEvent.eventType,
          payload: deferredTerminalEvent.payload,
          createdAt: deferredTerminalEvent.createdAt,
        });
        terminalEventToRelay = {
          eventType: deferredTerminalEvent.eventType,
          sequence: lastSequence,
          payload: deferredTerminalEvent.payload,
          createdAt: deferredTerminalEvent.createdAt,
        };
        deferredTerminalEvent = null;
      }

      store.updateInput(record.inputId, {
        status:
          terminalStatus === "ERROR"
            ? "FAILED"
            : terminalStatus === "PAUSED"
              ? "PAUSED"
              : "DONE",
        claimedBy: null,
        claimedUntil: null,
      });
      store.updateRuntimeState({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        status: terminalStatus,
        currentInputId: null,
        currentWorkerId: null,
        leaseUntil: null,
        heartbeatAt: null,
        lastError,
      });

      if (workspaceFileManifestBefore) {
        try {
          const fileOutputs = detectWorkspaceFileOutputs({
            workspaceDir,
            before: workspaceFileManifestBefore,
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
              .filter(
                (filePath): filePath is string =>
                  typeof filePath === "string" && filePath.length > 0,
              ),
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
              metadata: output.metadata,
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
          offset: 0,
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
          messageId: `assistant-${record.inputId}`,
          createdAt: orderedAssistantMessageTimestamp(
            turnStartedAt,
            completedAt,
          ),
        });
      }
      const effectiveCompletedAt = completedAt ?? new Date().toISOString();
      let turnResult = persistTurnResult({
        store,
        record,
        startedAt: turnStartedAt,
        completedAt: effectiveCompletedAt,
        terminalStatus,
        stopReason,
        assistantText,
        toolUsageSummary: summarizeToolCalls(
          toolCallsById,
          skillInvocationsById,
          wideningAudit,
        ),
        permissionDenials,
        promptSectionIds,
        capabilityManifestFingerprint,
        requestSnapshotFingerprint,
        promptCacheProfile,
        tokenUsage,
        contextBudgetDecisions: buildContextBudgetObservabilityPayload({
          startedAt: turnStartedAt,
          completedAt: effectiveCompletedAt,
          terminalStatus,
          stopReason,
          tokenUsage,
          contextUsage,
          promptCacheProfile,
          telemetry: contextBudgetTelemetry,
          toolCallCount: toolCallsById.size,
          checkpointQueued: false,
        }),
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
      if (
        terminalEventToRelay &&
        (terminalEventToRelay.eventType === "run_completed" ||
          terminalEventToRelay.eventType === "run_failed")
      ) {
        const relayPayload: Record<string, unknown> = {
          ...terminalEventToRelay.payload,
        };
        if (assistantText) {
          relayPayload.final_output_text = assistantText;
        }
        if (!nonEmptyString(relayPayload.source)) {
          relayPayload.source = "runner";
        }
        const runStatePayload = backendRunStatePayload({
          terminalEventType: terminalEventToRelay.eventType,
          terminalStatus,
          stopReason,
          payload: relayPayload,
        });
        if (runStatePayload) {
          await relayBackendRunEvent({
            eventType: "run_state",
            payload: runStatePayload,
            timestamp: terminalEventToRelay.createdAt,
            preferredSequence: Math.max(terminalEventToRelay.sequence, 1),
          });
        }
        await relayBackendRunEvent({
          eventType: terminalEventToRelay.eventType,
          payload: relayPayload,
          timestamp: terminalEventToRelay.createdAt,
          preferredSequence:
            Math.max(terminalEventToRelay.sequence, 1) + (runStatePayload ? 1 : 0),
        });
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
      const checkpointHarness =
        store.getWorkspace(record.workspaceId)?.harness ??
        normalizeHarnessId(priorExecContext.harness) ??
        "pi";
      const checkpointJob = enqueueCheckpointJob({
        store,
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        inputId: record.inputId,
        harness: checkpointHarness,
        harnessSessionId:
          checkpointHarnessSessionId ||
          (store.getBinding({
            workspaceId: record.workspaceId,
            sessionId: record.sessionId,
          })?.harnessSessionId ??
            null),
        contextUsage,
        wakeWorker: params.wakeDurableMemoryWorker ?? null,
      });
      const updatedContextBudgetDecisions = buildContextBudgetObservabilityPayload({
        startedAt: turnStartedAt,
        completedAt: effectiveCompletedAt,
        terminalStatus,
        stopReason,
        tokenUsage,
        contextUsage,
        promptCacheProfile,
        telemetry: contextBudgetTelemetry,
        toolCallCount: toolCallsById.size,
        checkpointQueued: Boolean(checkpointJob),
      });
      const updatedTurnResult = store.updateTurnResultContextBudgetDecisions({
        inputId: record.inputId,
        contextBudgetDecisions: updatedContextBudgetDecisions,
      });
      if (updatedTurnResult) {
        turnResult = updatedTurnResult;
      }
      maybeCreateCronjobCompletionNotification({
        store,
        record,
        turnResult,
      });
    } catch (error) {
      if (
        claimOwnershipLost ||
        executionAbortController.signal.reason === "claim_lost" ||
        !claimStillOwned()
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      store.updateInput(record.inputId, {
        status: "FAILED",
        claimedBy: null,
        claimedUntil: null,
      });
      store.appendOutputEvent({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        inputId: record.inputId,
        sequence: Math.max(0, lastSequence) + 1,
        eventType: "run_failed",
        payload: { message },
      });
      store.updateRuntimeState({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        status: "ERROR",
        currentInputId: null,
        currentWorkerId: null,
        leaseUntil: null,
        heartbeatAt: null,
        lastError: { message },
      });
      const errorCompletedAt = new Date().toISOString();
      const turnResult = persistTurnResult({
        store,
        record,
        startedAt: turnStartedAt,
        completedAt: errorCompletedAt,
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
        contextBudgetDecisions: buildContextBudgetObservabilityPayload({
          startedAt: turnStartedAt,
          completedAt: errorCompletedAt,
          terminalStatus: "ERROR",
          stopReason: "executor_error",
          tokenUsage: null,
          contextUsage,
          promptCacheProfile,
          telemetry: contextBudgetTelemetry,
          toolCallCount: toolCallsById.size,
          checkpointQueued: false,
        }),
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
  };

  try {
    return await executeClaimedInput();
  } finally {
    params.abortSignal?.removeEventListener("abort", forwardAbortSignal);
  }
}
