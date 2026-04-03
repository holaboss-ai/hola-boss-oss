import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import {
  RuntimeAppLifecycleExecutor,
  type AppLifecycleExecutorLike
} from "./app-lifecycle-worker.js";
import { bootstrapResolvedApplications } from "./resolved-app-bootstrap.js";
import {
  effectiveMcpServerPayloads,
  encodeWorkspaceMcpCatalog,
  mergePreparedMcpServerPayloads,
  mcpServerIdMap,
  mcpServerMappingMetadata,
  workspaceMcpCatalogFingerprint,
  type PreparedMcpServerPayload,
  type RunningWorkspaceMcpSidecar
} from "./runner-prep.js";
import { compileWorkspaceRuntimePlanFromWorkspace } from "./runner-prep.js";
import {
  projectAgentRuntimeConfig,
  type AgentRuntimeConfigCliRequest,
  type AgentRuntimeConfigCliResponse
} from "./agent-runtime-config.js";
import type {
  AgentCurrentUserContext,
  AgentPendingUserMemoryContext,
  AgentRecalledMemoryContext,
  AgentRecentRuntimeContext,
  AgentSessionResumeContext
} from "./agent-runtime-prompt.js";
import {
  decodeTsRunnerRequestPayload,
  fallbackEventIdentity,
  type JsonObject,
  type TsRunnerEvent,
  type TsRunnerRequest,
  validateTsRunnerRequest
} from "./ts-runner-contracts.js";
import {
  buildTsRunnerEvent,
  buildTsRunnerFailureEvent,
  closePushEventClient,
  createPushEventClient,
  emitTsRunnerEventWithPush
} from "./ts-runner-events.js";
import {
  clearWorkspaceMainSessionId,
  persistWorkspaceMainSessionId,
  readWorkspaceMainSessionId,
  workspaceDirForId
} from "./ts-runner-session-state.js";
import { resolveWorkspaceSkills } from "./workspace-skills.js";
import { resolveProductRuntimeConfig } from "./runtime-config.js";
import {
  normalizeHarnessId,
  requireRuntimeHarnessAdapter,
  requireRuntimeHarnessPlugin,
  type RuntimeHarnessPlugin
} from "./harness-registry.js";
import { buildRunnerEnv } from "./runner-worker.js";
import { startWorkspaceMcpSidecar, type WorkspaceMcpSidecarCliRequest } from "./workspace-mcp-sidecar.js";
import type { CompiledWorkspaceRuntimePlan } from "./workspace-runtime-plan.js";
import {
  recentRuntimeContextFromCompactionBoundary,
  recentRuntimeContextFromTurnResult,
  sessionResumeContextFromArtifacts,
  sessionResumeContextFromCompactionBoundary,
} from "./turn-result-summary.js";
import { recalledMemoryContextFromManifest } from "./memory-recall-manifest.js";
import type { MemoryModelClientConfig } from "./memory-model-client.js";
import { pendingUserMemoryContextFromProposals } from "./user-memory-proposals.js";
import { NATIVE_WEB_SEARCH_TOOL_IDS } from "../../harnesses/src/native-web-search-tools.js";

type LoggerLike = Pick<typeof console, "warn">;

const TERMINAL_EVENT_TYPES = new Set<TsRunnerEvent["event_type"]>(["run_completed", "run_failed"]);
const HARNESS_HOST_NOT_IMPLEMENTED_EXIT_CODE = 86;
const RUNTIME_EXEC_CONTEXT_KEY = "_sandbox_runtime_exec_v1";
const DEFAULT_SESSION_MODE = "code";
const DEFAULT_PROVIDER_ID = "openai";
const WORKSPACE_MCP_READY_TIMEOUT_S = 10;
const RECALL_SCOPE_ENTRY_LIMIT = 200;
const DEFAULT_TOOLS = [
  "read",
  "edit",
  "bash",
  "grep",
  "glob",
  "list",
  "question",
  "todowrite",
  "todoread",
  "skill"
];

type BootstrapStageTimingMap = Record<string, number>;

type RuntimeExecContext = Record<string, unknown>;

export interface TsRunnerBootstrapState {
  harness: string;
  workspaceRoot: string;
  workspaceDir: string;
  runtimeExecContext: RuntimeExecContext | null;
  requestedHarnessSessionId: string | null;
  persistedHarnessSessionId: string | null;
}

export interface TsRunnerHarnessRelayResult {
  exitCode: number;
  stderr: string;
  sawEvent: boolean;
  terminalEmitted: boolean;
  lastSequence: number;
  missingEntryPath?: string | null;
  spawnError?: string | null;
}

export interface TsRunnerExecutionDeps {
  bootstrapApplications: (params: {
    request: TsRunnerRequest;
    workspaceDir: string;
    resolvedApplications: unknown[];
  }) => Promise<PreparedMcpServerPayload[]>;
  compilePlan: (params: { workspaceId: string; workspaceDir: string }) => CompiledWorkspaceRuntimePlan;
  projectAgentRuntimeConfig: (request: AgentRuntimeConfigCliRequest) => AgentRuntimeConfigCliResponse;
  resolveHarnessPlugin: (harness: string) => RuntimeHarnessPlugin;
  runHarnessHost: (params: {
    harness: string;
    requestPayload: Record<string, unknown>;
    workspaceDir: string;
    emitEvent: (event: TsRunnerEvent) => Promise<void>;
    logger?: LoggerLike;
  }) => Promise<TsRunnerHarnessRelayResult>;
  startWorkspaceMcpSidecar: (request: WorkspaceMcpSidecarCliRequest) => Promise<RunningWorkspaceMcpSidecar | null>;
  loadRecalledMemoryContext: (params: {
    workspaceRoot: string;
    workspaceId: string;
    sessionId: string;
    inputId: string;
    request: TsRunnerRequest;
    instruction: string;
    logger?: LoggerLike;
  }) => Promise<AgentRecalledMemoryContext | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorTypeFor(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return "Error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function jsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function fingerprintJsonValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isSensitiveSnapshotKey(key: string): boolean {
  return /(?:api[_-]?key|auth(?:orization)?|token|secret|password)/i.test(key);
}

function sanitizeSnapshotValue(value: unknown, parentKey?: string): unknown {
  if (parentKey === "request_snapshot_fingerprint") {
    return "[self]";
  }
  if (parentKey && isSensitiveSnapshotKey(parentKey)) {
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSnapshotValue(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  const sanitizedEntries = Object.entries(value).map(([key, item]) => [
    key,
    sanitizeSnapshotValue(item, key),
  ]);
  return Object.fromEntries(sanitizedEntries);
}

function turnRequestSnapshotFingerprint(payload: Record<string, unknown>): string {
  return fingerprintJsonValue(sanitizeSnapshotValue(payload));
}

function persistTurnRequestSnapshot(params: {
  workspaceRoot: string;
  workspaceId: string;
  sessionId: string;
  inputId: string;
  snapshotKind: string;
  payload: Record<string, unknown>;
  logger?: LoggerLike;
}): string | null {
  const sanitizedPayload = sanitizeSnapshotValue(params.payload) as Record<string, unknown>;
  const fingerprint = fingerprintJsonValue(sanitizedPayload);
  const sandboxRoot = path.dirname(params.workspaceRoot);
  const dbPath = path.join(sandboxRoot, "state", "runtime.db");
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch (error) {
    params.logger?.warn?.(
      `Failed to create turn request snapshot state directory workspace_id=${params.workspaceId} session_id=${params.sessionId} input_id=${params.inputId}: ${errorMessage(error)}`
    );
    return null;
  }
  const store = new RuntimeStateStore({
    workspaceRoot: params.workspaceRoot,
    sandboxRoot,
    dbPath,
  });
  try {
    store.upsertTurnRequestSnapshot({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      inputId: params.inputId,
      snapshotKind: params.snapshotKind,
      fingerprint,
      payload: sanitizedPayload,
    });
    return fingerprint;
  } catch (error) {
    params.logger?.warn?.(
      `Failed to persist turn request snapshot workspace_id=${params.workspaceId} session_id=${params.sessionId} input_id=${params.inputId}: ${errorMessage(error)}`
    );
    return null;
  } finally {
    store.close();
  }
}

function turnRequestSnapshotPayload(params: {
  request: TsRunnerRequest;
  bootstrap: TsRunnerBootstrapState;
  runtimeConfig: AgentRuntimeConfigCliResponse;
  harnessRequestPayload: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    snapshot_kind: "harness_host_request",
    workspace_id: params.request.workspace_id,
    session_id: params.request.session_id,
    input_id: params.request.input_id,
    harness_id: params.bootstrap.harness,
    raw_instruction: params.request.instruction,
    attachments: params.request.attachments ?? [],
    runtime_config: {
      provider_id: params.runtimeConfig.provider_id,
      model_id: params.runtimeConfig.model_id,
      mode: params.runtimeConfig.mode,
      system_prompt: params.runtimeConfig.system_prompt,
      context_messages: params.runtimeConfig.context_messages ?? [],
      prompt_sections: params.runtimeConfig.prompt_sections ?? [],
      prompt_layers: params.runtimeConfig.prompt_layers ?? [],
      prompt_cache_profile: params.runtimeConfig.prompt_cache_profile ?? null,
      tools: params.runtimeConfig.tools,
      workspace_tool_ids: params.runtimeConfig.workspace_tool_ids,
      workspace_skill_ids: params.runtimeConfig.workspace_skill_ids,
      output_schema_member_id: params.runtimeConfig.output_schema_member_id ?? null,
      output_format: params.runtimeConfig.output_format ?? null,
      workspace_config_checksum: params.runtimeConfig.workspace_config_checksum,
      capability_manifest: params.runtimeConfig.capability_manifest ?? null,
      model_client: {
        model_proxy_provider: params.runtimeConfig.model_client.model_proxy_provider,
        base_url: params.runtimeConfig.model_client.base_url ?? null,
        default_headers: params.runtimeConfig.model_client.default_headers ?? null,
      },
    },
    harness_request: params.harnessRequestPayload,
  };
}

function elapsedMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

function measureBootstrapStage<T>(timings: BootstrapStageTimingMap, stage: string, operation: () => T): T {
  const startedAtMs = Date.now();
  try {
    return operation();
  } finally {
    timings[stage] = elapsedMs(startedAtMs);
  }
}

async function measureBootstrapStageAsync<T>(
  timings: BootstrapStageTimingMap,
  stage: string,
  operation: () => Promise<T>
): Promise<T> {
  const startedAtMs = Date.now();
  try {
    return await operation();
  } finally {
    timings[stage] = elapsedMs(startedAtMs);
  }
}

function runtimeExecContextString(request: TsRunnerRequest, key: string): string | null {
  const value = request.context[RUNTIME_EXEC_CONTEXT_KEY];
  if (!isRecord(value)) {
    return null;
  }
  return firstNonEmptyString(value[key]);
}

function selectedHarness(request: TsRunnerRequest): string {
  const runtimeHarness = isRecord(request.context[RUNTIME_EXEC_CONTEXT_KEY])
    ? request.context[RUNTIME_EXEC_CONTEXT_KEY].harness
    : undefined;
  return normalizeHarnessId(runtimeHarness ?? process.env.SANDBOX_AGENT_HARNESS);
}

function runtimeRootDir(): string {
  const configured = (process.env.HOLABOSS_RUNTIME_ROOT ?? "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function loadRecentRuntimeContext(params: {
  workspaceRoot: string;
  workspaceId: string;
  sessionId: string;
  inputId: string;
  logger?: LoggerLike;
}): AgentRecentRuntimeContext | null {
  const sandboxRoot = path.dirname(params.workspaceRoot);
  const dbPath = path.join(sandboxRoot, "state", "runtime.db");
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  const store = new RuntimeStateStore({
    workspaceRoot: params.workspaceRoot,
    sandboxRoot,
    dbPath,
  });
  try {
    const latestBoundary = store.listCompactionBoundaries({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      limit: 5,
      offset: 0,
    }).find((boundary) => boundary.inputId !== params.inputId) ?? null;
    const boundaryContext = recentRuntimeContextFromCompactionBoundary(latestBoundary);
    if (boundaryContext) {
      return boundaryContext;
    }
    const priorTurn = store
      .listTurnResults({
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
        limit: 10,
      })
      .find((turnResult) => turnResult.inputId !== params.inputId);
    return priorTurn ? recentRuntimeContextFromTurnResult(priorTurn) : null;
  } catch (error) {
    params.logger?.warn?.(
      `Failed to load recent runtime context workspace_id=${params.workspaceId} session_id=${params.sessionId}: ${errorMessage(error)}`
    );
    return null;
  } finally {
    store.close();
  }
}

function resolveMemoryRootDir(workspaceRoot: string): string {
  const configured = (process.env.MEMORY_ROOT_DIR ?? "").trim();
  if (!configured) {
    return path.join(workspaceRoot, "memory");
  }
  if (path.isAbsolute(configured)) {
    return path.resolve(configured);
  }
  return path.resolve(path.join(workspaceRoot, configured));
}

function sessionMemoryPath(workspaceId: string, sessionId: string): string {
  const sanitizedSessionId = sessionId.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
  return `workspace/${workspaceId}/runtime/session-memory/${sanitizedSessionId}.md`;
}

function sessionMemoryExcerpt(raw: string, maxChars = 320): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function loadSessionMemoryExcerpt(params: {
  workspaceRoot: string;
  workspaceId: string;
  sessionId: string;
}): { path: string; excerpt: string } | null {
  const relPath = sessionMemoryPath(params.workspaceId, params.sessionId);
  const memoryRoot = resolveMemoryRootDir(params.workspaceRoot);
  const targetPath = path.join(memoryRoot, relPath);
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath, { throwIfNoEntry: false })?.isFile()) {
    return null;
  }
  try {
    const text = fs.readFileSync(targetPath, "utf8");
    const excerpt = sessionMemoryExcerpt(text);
    if (!excerpt) {
      return null;
    }
    return {
      path: relPath,
      excerpt,
    };
  } catch {
    return null;
  }
}

function loadSessionResumeContext(params: {
  workspaceRoot: string;
  workspaceId: string;
  sessionId: string;
  inputId: string;
  logger?: LoggerLike;
}): AgentSessionResumeContext | null {
  const sessionMemory = loadSessionMemoryExcerpt({
    workspaceRoot: params.workspaceRoot,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
  });
  const sandboxRoot = path.dirname(params.workspaceRoot);
  const dbPath = path.join(sandboxRoot, "state", "runtime.db");
  if (!fs.existsSync(dbPath)) {
    if (!sessionMemory) {
      return null;
    }
    return {
      session_memory_path: sessionMemory.path,
      session_memory_excerpt: sessionMemory.excerpt,
    };
  }
  const store = new RuntimeStateStore({
    workspaceRoot: params.workspaceRoot,
    sandboxRoot,
    dbPath,
  });
  try {
    const latestBoundary = store.listCompactionBoundaries({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      limit: 5,
      offset: 0,
    }).find((boundary) => boundary.inputId !== params.inputId) ?? null;
    const boundaryContext = sessionResumeContextFromCompactionBoundary(latestBoundary);
    if (boundaryContext) {
      if (!sessionMemory) {
        return boundaryContext;
      }
      return {
        ...boundaryContext,
        session_memory_path: sessionMemory.path,
        session_memory_excerpt: sessionMemory.excerpt,
      };
    }
    const turnResults = store.listTurnResults({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      limit: 8,
    });
    const sessionMessages = store.listSessionMessages({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
    });
    const artifactContext = sessionResumeContextFromArtifacts({
      turnResults,
      sessionMessages,
      currentInputId: params.inputId,
    });
    if (!artifactContext && !sessionMemory) {
      return null;
    }
    if (!sessionMemory) {
      return artifactContext ?? null;
    }
    return {
      ...(artifactContext ?? {}),
      session_memory_path: sessionMemory.path,
      session_memory_excerpt: sessionMemory.excerpt,
    };
  } catch (error) {
    params.logger?.warn?.(
      `Failed to load session resume context workspace_id=${params.workspaceId} session_id=${params.sessionId}: ${errorMessage(error)}`
    );
    if (!sessionMemory) {
      return null;
    }
    return {
      session_memory_path: sessionMemory.path,
      session_memory_excerpt: sessionMemory.excerpt,
    };
  } finally {
    store.close();
  }
}

async function loadRecalledMemoryContext(params: {
  workspaceRoot: string;
  workspaceId: string;
  sessionId: string;
  inputId: string;
  request: TsRunnerRequest;
  instruction: string;
  logger?: LoggerLike;
}): Promise<AgentRecalledMemoryContext | null> {
  const sandboxRoot = path.dirname(params.workspaceRoot);
  const dbPath = path.join(sandboxRoot, "state", "runtime.db");
  const store = fs.existsSync(dbPath)
    ? new RuntimeStateStore({
        workspaceRoot: params.workspaceRoot,
        sandboxRoot,
        dbPath,
      })
    : null;
  try {
    const workspaceEntries = store
      ? store.listMemoryEntries({
          workspaceId: params.workspaceId,
          status: "active",
          limit: RECALL_SCOPE_ENTRY_LIMIT,
          offset: 0,
        })
      : [];
    const userEntries = store
      ? store.listMemoryEntries({
          scope: "user",
          status: "active",
          limit: RECALL_SCOPE_ENTRY_LIMIT,
          offset: 0,
        })
      : [];
    const byMemoryId = new Map<string, (typeof workspaceEntries)[number]>();
    for (const entry of [...workspaceEntries, ...userEntries]) {
      const existing = byMemoryId.get(entry.memoryId);
      if (!existing) {
        byMemoryId.set(entry.memoryId, entry);
        continue;
      }
      const existingTime = Date.parse(existing.updatedAt);
      const nextTime = Date.parse(entry.updatedAt);
      if (Number.isFinite(nextTime) && (!Number.isFinite(existingTime) || nextTime > existingTime)) {
        byMemoryId.set(entry.memoryId, entry);
      }
    }
    const entries = [...byMemoryId.values()].sort((left, right) => {
      const updatedDiff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (updatedDiff !== 0 && Number.isFinite(updatedDiff)) {
        return updatedDiff;
      }
      const createdDiff = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (createdDiff !== 0 && Number.isFinite(createdDiff)) {
        return createdDiff;
      }
      return left.memoryId.localeCompare(right.memoryId);
    });
    return await recalledMemoryContextFromManifest({
      query: params.instruction,
      workspaceRoot: params.workspaceRoot,
      workspaceId: params.workspaceId,
      entries,
      maxEntries: 5,
      modelClient: selectorModelClientFromRequest({
        request: params.request,
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
        inputId: params.inputId,
      }),
    });
  } catch (error) {
    params.logger?.warn?.(
      `Failed to load recalled memory context workspace_id=${params.workspaceId}: ${errorMessage(error)}`
    );
    return null;
  } finally {
    store?.close();
  }
}

interface RecalledMemoryPrefetchHandle {
  promise: Promise<AgentRecalledMemoryContext | null>;
  settledAt: number | null;
}

function startRecalledMemoryContextPrefetch(params: {
  load: () => Promise<AgentRecalledMemoryContext | null>;
  logger?: LoggerLike;
}): RecalledMemoryPrefetchHandle {
  const handle: RecalledMemoryPrefetchHandle = {
    promise: Promise.resolve(null),
    settledAt: null,
  };
  handle.promise = params
    .load()
    .catch((error) => {
      params.logger?.warn?.(`Failed in recalled memory prefetch: ${errorMessage(error)}`);
      return null;
    })
    .finally(() => {
      handle.settledAt = Date.now();
    });
  return handle;
}

async function consumeRecalledMemoryContextPrefetch(
  prefetch: RecalledMemoryPrefetchHandle,
  maxWaitMs = 25
): Promise<AgentRecalledMemoryContext | null> {
  if (prefetch.settledAt !== null) {
    return await prefetch.promise;
  }
  const boundedWaitMs = Math.max(0, Math.trunc(maxWaitMs));
  if (boundedWaitMs === 0) {
    return null;
  }
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    const result = await Promise.race([
      prefetch.promise.then((value) => ({ ready: true as const, value })),
      new Promise<{ ready: false }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ ready: false }), boundedWaitMs);
      }),
    ]);
    return result.ready ? result.value : null;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function loadCurrentUserContext(params: {
  workspaceRoot: string;
  logger?: LoggerLike;
}): AgentCurrentUserContext | null {
  const sandboxRoot = path.dirname(params.workspaceRoot);
  const dbPath = path.join(sandboxRoot, "state", "runtime.db");
  const defaultContext: AgentCurrentUserContext = {
    profile_id: "default",
    name: null,
    name_source: null,
  };
  if (!fs.existsSync(dbPath)) {
    return defaultContext;
  }
  const store = new RuntimeStateStore({
    workspaceRoot: params.workspaceRoot,
    sandboxRoot,
    dbPath,
  });
  try {
    const profile = store.getRuntimeUserProfile({ profileId: "default" });
    if (!profile) {
      return defaultContext;
    }
    return {
      profile_id: profile.profileId,
      name: profile.name,
      name_source: profile.nameSource,
    };
  } catch (error) {
    params.logger?.warn?.(`Failed to load current user context: ${errorMessage(error)}`);
    return defaultContext;
  } finally {
    store.close();
  }
}

function loadPendingUserMemoryContext(params: {
  workspaceRoot: string;
  workspaceId: string;
  sessionId: string;
  inputId: string;
  logger?: LoggerLike;
}): AgentPendingUserMemoryContext | null {
  const sandboxRoot = path.dirname(params.workspaceRoot);
  const dbPath = path.join(sandboxRoot, "state", "runtime.db");
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  const store = new RuntimeStateStore({
    workspaceRoot: params.workspaceRoot,
    sandboxRoot,
    dbPath,
  });
  try {
    const proposals = store.listMemoryUpdateProposals({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      inputId: params.inputId,
      state: "pending",
      limit: 50,
      offset: 0,
    });
    return pendingUserMemoryContextFromProposals(proposals);
  } catch (error) {
    params.logger?.warn?.(
      `Failed to load pending user memory context workspace_id=${params.workspaceId} session_id=${params.sessionId} input_id=${params.inputId}: ${errorMessage(error)}`
    );
    return null;
  } finally {
    store.close();
  }
}

function normalizeRuntimeApiHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "0.0.0.0" || trimmed === "::") {
    return "127.0.0.1";
  }
  return trimmed;
}

function currentRuntimeApiUrl(): string | null {
  const configured = (process.env.SANDBOX_RUNTIME_API_URL ?? "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const portValue = (process.env.SANDBOX_RUNTIME_API_PORT ?? process.env.SANDBOX_AGENT_BIND_PORT ?? "").trim();
  if (!portValue) {
    return null;
  }
  const port = Number.parseInt(portValue, 10);
  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }

  const host = normalizeRuntimeApiHost(
    process.env.SANDBOX_RUNTIME_API_HOST ?? process.env.SANDBOX_AGENT_BIND_HOST ?? "127.0.0.1"
  );
  return `http://${host}:${port}`;
}

function runtimeNodeBin(): string {
  return firstNonEmptyString(process.env.HOLABOSS_RUNTIME_NODE_BIN, process.execPath) ?? process.execPath;
}

function workspaceMcpSandboxId(): string {
  const raw =
    process.env.SANDBOX_INSTANCE_ID ??
    process.env.SANDBOX_ID ??
    process.env.HOSTNAME ??
    os.hostname() ??
    "sandbox";
  const token = String(raw).trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return token || "sandbox";
}

function normalizeProviderId(value: string | null): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "anthropic" || normalized === "anthropic_native") {
    return "anthropic";
  }
  return normalized || DEFAULT_PROVIDER_ID;
}

function defaultProviderId(): string {
  try {
    const configured = resolveProductRuntimeConfig({
      requireAuth: false,
      requireUser: false,
      requireBaseUrl: false
    }).defaultProvider;
    return normalizeProviderId(configured);
  } catch {
    return normalizeProviderId(process.env.HOLABOSS_DEFAULT_PROVIDER_ID ?? DEFAULT_PROVIDER_ID);
  }
}

function defaultSessionMode(): string {
  return firstNonEmptyString(process.env.HOLABOSS_SESSION_MODE, DEFAULT_SESSION_MODE) ?? DEFAULT_SESSION_MODE;
}

function normalizeModelIdForSelector(model: string | null): string {
  const trimmed = (model ?? "").trim();
  if (!trimmed) {
    return "";
  }
  const slashIndex = trimmed.indexOf("/");
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1).trim() : trimmed;
}

function openAiBaseUrl(baseRoot: string): string {
  const normalized = baseRoot.trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  if (normalized.endsWith("/openai/v1")) {
    return normalized;
  }
  return `${normalized}/openai/v1`;
}

function selectorModelClientFromRequest(params: {
  request: TsRunnerRequest;
  workspaceId: string;
  sessionId: string;
  inputId: string;
}): MemoryModelClientConfig | null {
  const selectedModel = normalizeModelIdForSelector(
    firstNonEmptyString(typeof params.request.model === "string" ? params.request.model : "", null)
  );
  const runtimeConfig = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false,
    includeDefaultBaseUrl: false,
  });
  const baseUrl = openAiBaseUrl(runtimeConfig.modelProxyBaseUrl);
  if (!baseUrl) {
    return null;
  }
  const runtimeExecContext = isRecord(params.request.context[RUNTIME_EXEC_CONTEXT_KEY])
    ? (params.request.context[RUNTIME_EXEC_CONTEXT_KEY] as Record<string, unknown>)
    : {};
  const apiKey =
    firstNonEmptyString(runtimeExecContext.model_proxy_api_key, runtimeConfig.authToken) ||
    firstNonEmptyString(runtimeConfig.authToken);
  if (!apiKey) {
    return null;
  }
  const sandboxId = firstNonEmptyString(runtimeExecContext.sandbox_id, runtimeConfig.sandboxId);
  const defaultHeaders: Record<string, string> = {
    "X-API-Key": apiKey,
    "X-Holaboss-Session-Id": params.sessionId,
    "X-Holaboss-Workspace-Id": params.workspaceId,
    "X-Holaboss-Input-Id": params.inputId,
  };
  if (sandboxId) {
    defaultHeaders["X-Holaboss-Sandbox-Id"] = sandboxId;
  }
  if (runtimeConfig.userId) {
    defaultHeaders["X-Holaboss-User-Id"] = runtimeConfig.userId;
  }
  return {
    baseUrl,
    apiKey,
    defaultHeaders,
    modelId: selectedModel || normalizeModelIdForSelector(runtimeConfig.defaultModel),
  };
}

function defaultExtraTools(harnessId?: string | null): string[] {
  const configured = (process.env.HOLABOSS_EXTRA_TOOLS ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (normalizeHarnessId(harnessId) === "pi") {
    return [...NATIVE_WEB_SEARCH_TOOL_IDS, ...configured];
  }
  return configured;
}

function explicitHolabossUserId(request: TsRunnerRequest): string | undefined {
  return firstNonEmptyString(request.holaboss_user_id, request.context.holaboss_user_id) ?? undefined;
}

function bootstrapStartedPayload(params: {
  request: TsRunnerRequest;
  runtimeConfig: AgentRuntimeConfigCliResponse;
  requestSnapshotFingerprint: string | null;
  harnessSupportsStructuredOutput: boolean;
  mcpServerIdMap: Readonly<Record<string, string>>;
  mcpServers: PreparedMcpServerPayload[];
  sidecar: RunningWorkspaceMcpSidecar | null;
  bootstrapStartedAt: string;
  bootstrapReadyAt: string;
  bootstrapTotalMs: number;
  bootstrapStageTimingsMs: BootstrapStageTimingMap;
}): Record<string, unknown> {
  return {
    instruction_preview: params.request.instruction.slice(0, 120),
    provider_id: params.runtimeConfig.provider_id,
    model_id: params.runtimeConfig.model_id,
    workspace_tool_ids: [...params.runtimeConfig.workspace_tool_ids],
    workspace_skill_ids: [...params.runtimeConfig.workspace_skill_ids],
    workspace_command_ids: [...(params.runtimeConfig.capability_manifest?.workspace_commands ?? [])],
    context_message_count: params.runtimeConfig.context_messages?.length ?? 0,
    prompt_section_ids: [...(params.runtimeConfig.prompt_sections?.map((section) => section.id) ?? [])],
    prompt_cache_profile: params.runtimeConfig.prompt_cache_profile ?? null,
    capability_manifest_fingerprint: params.runtimeConfig.capability_manifest?.fingerprint ?? null,
    request_snapshot_fingerprint: params.requestSnapshotFingerprint,
    mcp_server_ids: params.mcpServers.map((server) => server.name),
    mcp_server_mappings: mcpServerMappingMetadata(params.mcpServerIdMap),
    workspace_mcp_sidecar_reused: Boolean(params.sidecar?.reused),
    structured_output_enabled: params.harnessSupportsStructuredOutput && Boolean(params.runtimeConfig.output_format),
    workspace_config_checksum: params.runtimeConfig.workspace_config_checksum,
    bootstrap_started_at: params.bootstrapStartedAt,
    bootstrap_ready_at: params.bootstrapReadyAt,
    bootstrap_total_ms: params.bootstrapTotalMs,
    bootstrap_stage_timings_ms: { ...params.bootstrapStageTimingsMs }
  };
}

function currentBrowserConfig(): {
  desktopBrowserEnabled: boolean;
  desktopBrowserUrl: string;
  desktopBrowserAuthToken: string;
} {
  try {
    const config = resolveProductRuntimeConfig({
      requireAuth: false,
      requireUser: false,
      requireBaseUrl: false
    });
    return {
      desktopBrowserEnabled: config.desktopBrowserEnabled,
      desktopBrowserUrl: config.desktopBrowserUrl,
      desktopBrowserAuthToken: config.desktopBrowserAuthToken
    };
  } catch {
    return {
      desktopBrowserEnabled: false,
      desktopBrowserUrl: "",
      desktopBrowserAuthToken: ""
    };
  }
}

function buildAgentRuntimeConfigRequest(params: {
  request: TsRunnerRequest;
  harnessId: string;
  browserToolsAvailable: boolean;
  browserToolIds: string[];
  runtimeToolIds: string[];
  compiledPlan: CompiledWorkspaceRuntimePlan;
  extraToolIds: string[];
  workspaceSkillIds: string[];
  workspaceCommandIds: string[];
  toolServerIdMap: Readonly<Record<string, string>>;
  resolvedMcpToolRefs: CompiledWorkspaceRuntimePlan["resolved_mcp_tool_refs"];
  recentRuntimeContext?: AgentRecentRuntimeContext | null;
  sessionResumeContext?: AgentSessionResumeContext | null;
  recalledMemoryContext?: AgentRecalledMemoryContext | null;
  currentUserContext?: AgentCurrentUserContext | null;
  pendingUserMemoryContext?: AgentPendingUserMemoryContext | null;
}): AgentRuntimeConfigCliRequest {
  const extraTools = Array.from(new Set([...defaultExtraTools(params.harnessId), ...params.extraToolIds]));
  const common = {
    session_id: params.request.session_id,
    workspace_id: params.request.workspace_id,
    input_id: params.request.input_id,
    session_kind: params.request.session_kind ?? null,
    harness_id: params.harnessId,
    browser_tools_available: params.browserToolsAvailable,
    browser_tool_ids: [...params.browserToolIds],
    runtime_tool_ids: [...params.runtimeToolIds],
    runtime_exec_model_proxy_api_key: runtimeExecContextString(params.request, "model_proxy_api_key") ?? undefined,
    runtime_exec_sandbox_id: runtimeExecContextString(params.request, "sandbox_id") ?? undefined,
    runtime_exec_run_id: runtimeExecContextString(params.request, "run_id") ?? undefined,
    recent_runtime_context: params.recentRuntimeContext ?? undefined,
    session_resume_context: params.sessionResumeContext ?? undefined,
    recalled_memory_context: params.recalledMemoryContext ?? undefined,
    current_user_context: params.currentUserContext ?? undefined,
    pending_user_memory_context: params.pendingUserMemoryContext ?? undefined,
    selected_model: firstNonEmptyString(params.request.model) ?? undefined,
    default_provider_id: defaultProviderId(),
    session_mode: defaultSessionMode(),
    workspace_config_checksum: params.compiledPlan.config_checksum,
    workspace_skill_ids: [...params.workspaceSkillIds],
    workspace_command_ids: [...params.workspaceCommandIds],
    default_tools: [...DEFAULT_TOOLS],
    extra_tools: extraTools,
    tool_server_id_map: { ...params.toolServerIdMap },
    resolved_mcp_tool_refs: params.resolvedMcpToolRefs.map((toolRef) => ({
      tool_id: toolRef.tool_id,
      server_id: toolRef.server_id,
      tool_name: toolRef.tool_name
    })),
    resolved_output_schemas: {}
  };
  return {
    ...common,
    agent: {
      id: params.compiledPlan.general_config.agent.id,
      model: params.compiledPlan.general_config.agent.model,
      prompt: params.compiledPlan.general_config.agent.prompt,
      role: params.compiledPlan.general_config.agent.role
    }
  };
}

function terminalHarnessSessionId(event: TsRunnerEvent): string | null {
  if (event.event_type !== "run_completed") {
    return null;
  }
  return firstNonEmptyString(event.payload.harness_session_id);
}

function parseHarnessHostRunnerEvent(
  line: string,
  options: { logger?: LoggerLike } = {}
): TsRunnerEvent | null {
  const stripped = line.trim();
  if (!stripped) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (error) {
    (options.logger ?? console).warn(
      `Ignoring invalid harness-host event line error=${error instanceof Error ? error.message : String(error)} line=${stripped.slice(0, 500)}`
    );
    return null;
  }

  if (!isRecord(parsed) || !isRecord(parsed.payload)) {
    (options.logger ?? console).warn(`Ignoring invalid harness-host event line line=${stripped.slice(0, 500)}`);
    return null;
  }
  if (
    typeof parsed.session_id !== "string" ||
    typeof parsed.input_id !== "string" ||
    !Number.isInteger(parsed.sequence) ||
    typeof parsed.event_type !== "string"
  ) {
    (options.logger ?? console).warn(`Ignoring invalid harness-host event line line=${stripped.slice(0, 500)}`);
    return null;
  }

  return {
    session_id: parsed.session_id,
    input_id: parsed.input_id,
    sequence: Number(parsed.sequence),
    event_type: parsed.event_type as TsRunnerEvent["event_type"],
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
    payload: jsonObject(parsed.payload)
  };
}

function harnessHostEntryPath(): { entryPath: string; argsPrefix: string[] } {
  const currentFile = fileURLToPath(import.meta.url);
  const runtimeRoot = runtimeRootDir();
  if (path.extname(currentFile) === ".ts") {
    return {
      entryPath: path.join(runtimeRoot, "harness-host", "src", "index.ts"),
      argsPrefix: ["--import", "tsx"]
    };
  }
  return {
    entryPath: path.join(runtimeRoot, "harness-host", "dist", "index.mjs"),
    argsPrefix: []
  };
}

async function defaultBootstrapApplications(params: {
  request: TsRunnerRequest;
  workspaceDir: string;
  resolvedApplications: unknown[];
}): Promise<PreparedMcpServerPayload[]> {
  if (params.resolvedApplications.length === 0) {
    return [];
  }
  const appLifecycleExecutor: AppLifecycleExecutorLike = new RuntimeAppLifecycleExecutor();
  const store = new RuntimeStateStore({
    workspaceRoot: path.dirname(path.resolve(params.workspaceDir))
  });
  try {
    const result = await bootstrapResolvedApplications({
      workspaceDir: params.workspaceDir,
      holabossUserId: explicitHolabossUserId(params.request),
      resolvedApplications: params.resolvedApplications,
      store,
      workspaceId: params.request.workspace_id,
      appLifecycleExecutor
    });

    return result.applications.map((application: { app_id: string; mcp_url: string; timeout_ms: number }) => ({
      name: application.app_id,
      config: {
        type: "remote" as const,
        enabled: true,
        url: application.mcp_url,
        headers: { "X-Workspace-Id": params.request.workspace_id },
        timeout: application.timeout_ms
      }
    }));
  } finally {
    store.close();
  }
}

async function defaultRunHarnessHost(params: {
  harness: string;
  requestPayload: Record<string, unknown>;
  workspaceDir: string;
  emitEvent: (event: TsRunnerEvent) => Promise<void>;
  logger?: LoggerLike;
}): Promise<TsRunnerHarnessRelayResult> {
  const { entryPath, argsPrefix } = harnessHostEntryPath();
  if (!fs.existsSync(entryPath)) {
    return {
      exitCode: 1,
      stderr: "",
      sawEvent: false,
      terminalEmitted: false,
      lastSequence: 0,
      missingEntryPath: entryPath
    };
  }
  const requestBase64 = Buffer.from(JSON.stringify(params.requestPayload), "utf8").toString("base64");

  let child;
  const harnessCommand = requireRuntimeHarnessAdapter(params.harness).hostCommand;
  try {
    child = spawn(
      runtimeNodeBin(),
      [...argsPrefix, entryPath, harnessCommand, "--request-base64", requestBase64],
      {
        cwd: runtimeRootDir(),
        env: buildRunnerEnv(),
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
  } catch (error) {
    return {
      exitCode: 1,
      stderr: "",
      sawEvent: false,
      terminalEmitted: false,
      lastSequence: 0,
      spawnError: errorMessage(error)
    };
  }

  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  let sawEvent = false;
  let terminalEmitted = false;
  let lastSequence = 0;
  const stdout = child.stdout;
  if (stdout) {
    stdout.setEncoding("utf8");
    const lines = createInterface({ input: stdout, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of lines) {
      const event = parseHarnessHostRunnerEvent(line, { logger: params.logger });
      if (!event) {
        continue;
      }
      sawEvent = true;
      lastSequence = Math.max(lastSequence, event.sequence);
      await params.emitEvent(event);
      if (TERMINAL_EVENT_TYPES.has(event.event_type)) {
        terminalEmitted = true;
      }
    }
  }

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 0));
  });

  return {
    exitCode,
    stderr: stderr.trim(),
    sawEvent,
    terminalEmitted,
    lastSequence
  };
}

function defaultExecutionDeps(): TsRunnerExecutionDeps {
  return {
    bootstrapApplications: defaultBootstrapApplications,
    compilePlan: ({ workspaceId, workspaceDir }) =>
      compileWorkspaceRuntimePlanFromWorkspace({
        workspaceId,
        workspaceDir
      }),
    projectAgentRuntimeConfig: (request) => projectAgentRuntimeConfig(request),
    resolveHarnessPlugin: (harness) => requireRuntimeHarnessPlugin(harness),
    runHarnessHost: defaultRunHarnessHost,
    loadRecalledMemoryContext,
    startWorkspaceMcpSidecar: async (request) => {
      const result = await startWorkspaceMcpSidecar(request);
      return {
        physical_server_id: request.physical_server_id,
        url: result.url,
        pid: result.pid,
        reused: result.reused,
        timeout_ms: request.timeout_ms
      };
    }
  };
}

function synthesizeHarnessHostFailureMessage(result: TsRunnerHarnessRelayResult): string {
  if (result.missingEntryPath) {
    return `TypeScript harness host entry not found at ${result.missingEntryPath}`;
  }
  if (result.spawnError) {
    return `Failed to start TypeScript harness host: ${result.spawnError}`;
  }
  if (!result.sawEvent && result.exitCode === HARNESS_HOST_NOT_IMPLEMENTED_EXIT_CODE) {
    return result.stderr
      ? `TypeScript harness host reported unimplemented adapter: ${result.stderr}`
      : "TypeScript harness host reported unimplemented adapter";
  }

  let message =
    result.exitCode !== 0 ? `TypeScript harness host failed with exit code ${result.exitCode}` : "TypeScript harness host ended before terminal event";
  if (result.stderr) {
    message = `${message}: ${result.stderr}`;
  }
  return message;
}

export function decodeTsRunnerRequest(encoded: string): TsRunnerRequest {
  return validateTsRunnerRequest(decodeTsRunnerRequestPayload(encoded));
}

export function resolveTsRunnerBootstrapState(
  request: TsRunnerRequest,
  options: { logger?: LoggerLike } = {}
): TsRunnerBootstrapState {
  const logger = options.logger ?? console;
  const runtimeExecContext = request.context[RUNTIME_EXEC_CONTEXT_KEY];
  if (runtimeExecContext !== undefined && !isRecord(runtimeExecContext)) {
    throw new Error("_sandbox_runtime_exec_v1 must be an object when provided");
  }

  const resolvedExecContext = isRecord(runtimeExecContext) ? runtimeExecContext : null;
  const requestedHarnessSessionId = firstNonEmptyString(resolvedExecContext?.harness_session_id);
  const harness = selectedHarness(request);
  requireRuntimeHarnessAdapter(harness);
  const workspaceDir = workspaceDirForId(request.workspace_id);
  const persistedHarnessSessionId = readWorkspaceMainSessionId({
    workspaceDir,
    harness,
    logger
  });

  return {
    harness,
    workspaceRoot: path.dirname(workspaceDir),
    workspaceDir,
    runtimeExecContext: resolvedExecContext,
    requestedHarnessSessionId,
    persistedHarnessSessionId
  };
}

export async function relayTsRunnerEvent(params: {
  emitEvent: (event: TsRunnerEvent) => Promise<void>;
  event: TsRunnerEvent;
  harness: string;
  workspaceDir: string;
  logger?: LoggerLike;
}): Promise<void> {
  await params.emitEvent(params.event);
  const sessionId = terminalHarnessSessionId(params.event);
  if (params.event.event_type === "run_failed") {
    clearWorkspaceMainSessionId({
      workspaceDir: params.workspaceDir,
      harness: params.harness,
      logger: params.logger
    });
    return;
  }
  if (!sessionId) {
    return;
  }
  persistWorkspaceMainSessionId({
    workspaceDir: params.workspaceDir,
    harness: params.harness,
    sessionId,
    logger: params.logger
  });
}

export async function executeTsRunnerRequest(
  request: TsRunnerRequest,
  options: {
    deps?: Partial<TsRunnerExecutionDeps>;
    emitEvent: (event: TsRunnerEvent) => Promise<void>;
    logger?: LoggerLike;
  }
): Promise<void> {
  const logger = options.logger ?? console;
  const deps = { ...defaultExecutionDeps(), ...options.deps };
  const bootstrap = resolveTsRunnerBootstrapState(request, { logger });
  const harnessPlugin = deps.resolveHarnessPlugin(bootstrap.harness);
  const harnessAdapter = harnessPlugin.adapter;
  const bootstrapStartedAtMs = Date.now();
  const bootstrapStartedAt = new Date(bootstrapStartedAtMs).toISOString();
  const bootstrapStageTimingsMs: BootstrapStageTimingMap = {};
  let syntheticSequence = 0;

  await relayTsRunnerEvent({
    emitEvent: options.emitEvent,
    harness: bootstrap.harness,
    workspaceDir: bootstrap.workspaceDir,
    logger,
    event: buildTsRunnerEvent({
      sessionId: request.session_id,
      inputId: request.input_id,
      sequence: ++syntheticSequence,
      eventType: "run_claimed",
      payload: {
        instruction_preview: request.instruction.slice(0, 120)
      }
    })
  });

  try {
    const runnerPrepPlan = harnessAdapter.buildRunnerPrepPlan({
      request,
      bootstrap
    });
    const stagedBrowserTools = measureBootstrapStage(bootstrapStageTimingsMs, "stage_browser_tools", () =>
      harnessPlugin.stageBrowserTools({
        workspaceDir: bootstrap.workspaceDir,
        sessionKind: request.session_kind,
        browserConfig: currentBrowserConfig()
      })
    );
    const stagedRuntimeTools = measureBootstrapStage(bootstrapStageTimingsMs, "stage_runtime_tools", () =>
      harnessPlugin.stageRuntimeTools({
        workspaceDir: bootstrap.workspaceDir
      })
    );
    const workspaceSkills = measureBootstrapStage(bootstrapStageTimingsMs, "resolve_workspace_skills", () =>
      resolveWorkspaceSkills(bootstrap.workspaceDir)
    );
    const stagedSkills = runnerPrepPlan.stageWorkspaceSkills
      ? measureBootstrapStage(bootstrapStageTimingsMs, "stage_workspace_skills", () =>
          harnessPlugin.stageSkills({
            workspaceDir: bootstrap.workspaceDir,
            runtimeRoot: runtimeRootDir()
          })
        )
      : { changed: false, skillIds: [] };
    const stagedCommands = runnerPrepPlan.stageWorkspaceCommands
      ? measureBootstrapStage(bootstrapStageTimingsMs, "stage_workspace_commands", () =>
          harnessPlugin.stageCommands({
            workspaceDir: bootstrap.workspaceDir
          })
        )
      : { changed: false, commandIds: [] };

    const compiledPlan = measureBootstrapStage(bootstrapStageTimingsMs, "compile_runtime_plan", () =>
      deps.compilePlan({
        workspaceId: request.workspace_id,
        workspaceDir: bootstrap.workspaceDir
      })
    );
    const recalledMemoryPrefetch = startRecalledMemoryContextPrefetch({
      load: () =>
        deps.loadRecalledMemoryContext({
          workspaceRoot: bootstrap.workspaceRoot,
          workspaceId: request.workspace_id,
          sessionId: request.session_id,
          inputId: request.input_id,
          request,
          instruction: request.instruction,
          logger,
        }),
      logger,
    });
    const serverIdMap = runnerPrepPlan.prepareMcpTooling
      ? mcpServerIdMap({
          workspaceId: request.workspace_id,
          sandboxId: workspaceMcpSandboxId(),
          compiledPlan
        })
      : {};
    const resolvedMcpToolRefs = runnerPrepPlan.prepareMcpTooling ? compiledPlan.resolved_mcp_tool_refs : [];
    const physicalWorkspaceServerId = serverIdMap.workspace ?? "workspace";

    let sidecar: RunningWorkspaceMcpSidecar | null = null;
    if (runnerPrepPlan.startWorkspaceMcpSidecar && compiledPlan.workspace_mcp_catalog.length > 0) {
      let timeoutMs = 10000;
      for (const server of compiledPlan.resolved_mcp_servers) {
        if (server.server_id === "workspace") {
          timeoutMs = server.timeout_ms;
          break;
        }
      }
      sidecar = await measureBootstrapStageAsync(bootstrapStageTimingsMs, "start_workspace_mcp_sidecar", async () =>
        await deps.startWorkspaceMcpSidecar({
          workspace_dir: bootstrap.workspaceDir,
          physical_server_id: physicalWorkspaceServerId,
          expected_fingerprint: workspaceMcpCatalogFingerprint(compiledPlan),
          timeout_ms: timeoutMs,
          readiness_timeout_s: WORKSPACE_MCP_READY_TIMEOUT_S,
          catalog_json_base64: encodeWorkspaceMcpCatalog(compiledPlan)
        })
      );
    }

    let effectiveMcpServers = runnerPrepPlan.prepareMcpTooling
      ? effectiveMcpServerPayloads({
          compiledPlan,
          sidecar,
          serverIdMap
        })
      : [];

    if (runnerPrepPlan.bootstrapResolvedApplications && compiledPlan.resolved_applications.length > 0) {
      effectiveMcpServers = mergePreparedMcpServerPayloads(
        effectiveMcpServers,
        await measureBootstrapStageAsync(bootstrapStageTimingsMs, "bootstrap_resolved_applications", async () =>
          await deps.bootstrapApplications({
            request,
            workspaceDir: bootstrap.workspaceDir,
            resolvedApplications: compiledPlan.resolved_applications
          })
        )
      );
    }

    const recentRuntimeContext = measureBootstrapStage(bootstrapStageTimingsMs, "load_recent_runtime_context", () =>
      loadRecentRuntimeContext({
        workspaceRoot: bootstrap.workspaceRoot,
        workspaceId: request.workspace_id,
        sessionId: request.session_id,
        inputId: request.input_id,
        logger,
      })
    );
    const sessionResumeContext = measureBootstrapStage(bootstrapStageTimingsMs, "load_session_resume_context", () =>
      loadSessionResumeContext({
        workspaceRoot: bootstrap.workspaceRoot,
        workspaceId: request.workspace_id,
        sessionId: request.session_id,
        inputId: request.input_id,
        logger,
      })
    );
    if (sessionResumeContext?.compaction_boundary_id) {
      await relayTsRunnerEvent({
        emitEvent: options.emitEvent,
        harness: bootstrap.harness,
        workspaceDir: bootstrap.workspaceDir,
        logger,
        event: buildTsRunnerEvent({
          sessionId: request.session_id,
          inputId: request.input_id,
          sequence: ++syntheticSequence,
          eventType: "compaction_restored",
          payload: {
            source: sessionResumeContext.compaction_source ?? "executor_post_turn",
            boundary_id: sessionResumeContext.compaction_boundary_id,
            restoration_order: sessionResumeContext.restoration_order ?? [],
            restored_memory_paths: sessionResumeContext.restored_memory_paths ?? [],
          },
        }),
      });
    }
    const recalledMemoryContext = await measureBootstrapStageAsync(
      bootstrapStageTimingsMs,
      "load_recalled_memory_context",
      async () => await consumeRecalledMemoryContextPrefetch(recalledMemoryPrefetch)
    );
    const currentUserContext = measureBootstrapStage(bootstrapStageTimingsMs, "load_current_user_context", () =>
      loadCurrentUserContext({
        workspaceRoot: bootstrap.workspaceRoot,
        logger,
      })
    );
    const pendingUserMemoryContext = measureBootstrapStage(
      bootstrapStageTimingsMs,
      "load_pending_user_memory_context",
      () =>
        loadPendingUserMemoryContext({
          workspaceRoot: bootstrap.workspaceRoot,
          workspaceId: request.workspace_id,
          sessionId: request.session_id,
          inputId: request.input_id,
          logger,
        })
    );

    const runtimeConfig = measureBootstrapStage(bootstrapStageTimingsMs, "project_runtime_config", () =>
      deps.projectAgentRuntimeConfig(
        buildAgentRuntimeConfigRequest({
          request,
          harnessId: bootstrap.harness,
          browserToolsAvailable: stagedBrowserTools.toolIds.length > 0,
          browserToolIds: [...stagedBrowserTools.toolIds],
          runtimeToolIds: [...stagedRuntimeTools.toolIds],
          compiledPlan,
          extraToolIds: [...stagedBrowserTools.toolIds, ...stagedRuntimeTools.toolIds],
          workspaceSkillIds: workspaceSkills.map((skill) => skill.skill_id),
          workspaceCommandIds: stagedCommands.commandIds,
          toolServerIdMap: serverIdMap,
          resolvedMcpToolRefs,
          recentRuntimeContext,
          sessionResumeContext,
          recalledMemoryContext,
          currentUserContext,
          pendingUserMemoryContext,
        })
      )
    );

    await measureBootstrapStageAsync(bootstrapStageTimingsMs, "prepare_harness_run", async () =>
      await harnessPlugin.prepareRun({
        request,
        bootstrap,
        runtimeConfig,
        stagedSkillsChanged: stagedSkills.changed || stagedBrowserTools.changed || stagedRuntimeTools.changed
      })
    );

    const backendBaseUrl = harnessPlugin.backendBaseUrl({
      workspaceId: request.workspace_id,
      workspaceDir: bootstrap.workspaceDir
    });
    if (harnessAdapter.capabilities.requiresBackend && !backendBaseUrl.trim()) {
      throw new Error(`backend base URL was not resolved for harness '${bootstrap.harness}'`);
    }

    const buildHarnessHostRequestStartedAtMs = Date.now();
    const provisionalRunStartedPayload = bootstrapStartedPayload({
      request,
      runtimeConfig,
      requestSnapshotFingerprint: null,
      harnessSupportsStructuredOutput: harnessAdapter.capabilities.supportsStructuredOutput,
      mcpServerIdMap: serverIdMap,
      mcpServers: effectiveMcpServers,
      sidecar,
      bootstrapStartedAt,
      bootstrapReadyAt: bootstrapStartedAt,
      bootstrapTotalMs: 0,
      bootstrapStageTimingsMs
    });
    const provisionalHarnessRequestPayload = harnessAdapter.buildHarnessHostRequest({
      request,
      bootstrap,
      runtimeConfig,
      runtimeApiBaseUrl: currentRuntimeApiUrl(),
      workspaceSkills,
      mcpServers: effectiveMcpServers,
      mcpToolRefs: resolvedMcpToolRefs.map((toolRef) => ({
        tool_id: toolRef.tool_id,
        server_id: serverIdMap[toolRef.server_id] ?? toolRef.server_id,
        tool_name: toolRef.tool_name
      })),
      runStartedPayload: provisionalRunStartedPayload,
      backendBaseUrl,
      timeoutSeconds: harnessPlugin.timeoutSeconds({ request })
    });
    const provisionalSnapshotPayload = turnRequestSnapshotPayload({
      request,
      bootstrap,
      runtimeConfig,
      harnessRequestPayload: provisionalHarnessRequestPayload,
    });
    const requestSnapshotFingerprint = turnRequestSnapshotFingerprint(provisionalSnapshotPayload);
    const runStartedPayload = bootstrapStartedPayload({
      request,
      runtimeConfig,
      requestSnapshotFingerprint,
      harnessSupportsStructuredOutput: harnessAdapter.capabilities.supportsStructuredOutput,
      mcpServerIdMap: serverIdMap,
      mcpServers: effectiveMcpServers,
      sidecar,
      bootstrapStartedAt,
      bootstrapReadyAt: bootstrapStartedAt,
      bootstrapTotalMs: 0,
      bootstrapStageTimingsMs
    });
    const harnessRequestPayload = harnessAdapter.buildHarnessHostRequest({
      request,
      bootstrap,
      runtimeConfig,
      runtimeApiBaseUrl: currentRuntimeApiUrl(),
      workspaceSkills,
      mcpServers: effectiveMcpServers,
      mcpToolRefs: resolvedMcpToolRefs.map((toolRef) => ({
        tool_id: toolRef.tool_id,
        server_id: serverIdMap[toolRef.server_id] ?? toolRef.server_id,
        tool_name: toolRef.tool_name
      })),
      runStartedPayload,
      backendBaseUrl,
      timeoutSeconds: harnessPlugin.timeoutSeconds({ request })
    });
    measureBootstrapStage(bootstrapStageTimingsMs, "persist_turn_request_snapshot", () =>
      persistTurnRequestSnapshot({
        workspaceRoot: bootstrap.workspaceRoot,
        workspaceId: request.workspace_id,
        sessionId: request.session_id,
        inputId: request.input_id,
        snapshotKind: "harness_host_request",
        payload: turnRequestSnapshotPayload({
          request,
          bootstrap,
          runtimeConfig,
          harnessRequestPayload,
        }),
        logger,
      })
    );
    bootstrapStageTimingsMs.build_harness_host_request = elapsedMs(buildHarnessHostRequestStartedAtMs);
    runStartedPayload.bootstrap_ready_at = new Date().toISOString();
    runStartedPayload.bootstrap_total_ms = elapsedMs(bootstrapStartedAtMs);
    runStartedPayload.bootstrap_stage_timings_ms = { ...bootstrapStageTimingsMs };
    const harnessResult = await measureBootstrapStageAsync(bootstrapStageTimingsMs, "launch_harness_host", async () =>
      await deps.runHarnessHost({
        harness: bootstrap.harness,
        requestPayload: harnessRequestPayload,
        workspaceDir: bootstrap.workspaceDir,
        logger,
        emitEvent: async (event) => {
          await relayTsRunnerEvent({
            emitEvent: options.emitEvent,
            event,
            harness: bootstrap.harness,
            workspaceDir: bootstrap.workspaceDir,
            logger
          });
        }
      })
    );

    if (harnessResult.terminalEmitted) {
      return;
    }

    await relayTsRunnerEvent({
      emitEvent: options.emitEvent,
      harness: bootstrap.harness,
      workspaceDir: bootstrap.workspaceDir,
      logger,
      event: buildTsRunnerFailureEvent({
        sessionId: request.session_id,
        inputId: request.input_id,
        sequence: harnessResult.sawEvent ? harnessResult.lastSequence + 1 : 1,
        errorType: "RuntimeError",
        message: synthesizeHarnessHostFailureMessage(harnessResult)
      })
    });
  } catch (error) {
    await relayTsRunnerEvent({
      emitEvent: options.emitEvent,
      harness: bootstrap.harness,
      workspaceDir: bootstrap.workspaceDir,
      logger,
      event: buildTsRunnerFailureEvent({
        sessionId: request.session_id,
        inputId: request.input_id,
        sequence: 2,
        errorType: errorTypeFor(error),
        message: `${bootstrap.harness} execution failed: ${errorMessage(error)}`
      })
    });
  }
}

export async function runTsRunnerCli(
  argv: string[],
  options: {
    deps?: Partial<TsRunnerExecutionDeps>;
    io?: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
    fetchImpl?: typeof fetch;
    logger?: LoggerLike;
  } = {}
): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const logger = options.logger ?? console;
  const requestBase64 = argv[0] === "--request-base64" ? argv[1] ?? "" : argv[0] ?? "";

  if (!requestBase64) {
    io.stderr.write("request_base64 is required\n");
    return 2;
  }

  let decodedPayload: unknown;
  let request: TsRunnerRequest;
  try {
    decodedPayload = decodeTsRunnerRequestPayload(requestBase64);
    request = validateTsRunnerRequest(decodedPayload);
  } catch (error) {
    const ids = fallbackEventIdentity(decodedPayload);
    await emitTsRunnerEventWithPush({
      io,
      event: buildTsRunnerFailureEvent({
        sessionId: ids.sessionId,
        inputId: ids.inputId,
        sequence: 1,
        errorType: errorTypeFor(error),
        message: `invalid runner request payload: ${errorMessage(error)}`
      }),
      pushClient: null,
      fetchImpl: options.fetchImpl
    });
    return 1;
  }

  const pushClient = createPushEventClient(request);
  try {
    await executeTsRunnerRequest(request, {
      deps: options.deps,
      logger,
      emitEvent: async (event) => {
        await emitTsRunnerEventWithPush({
          io,
          event,
          pushClient,
          fetchImpl: options.fetchImpl
        });
      }
    });
    return 0;
  } finally {
    await closePushEventClient(pushClient);
  }
}

async function main(): Promise<void> {
  process.exitCode = await runTsRunnerCli(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}

export { validateTsRunnerRequest };
