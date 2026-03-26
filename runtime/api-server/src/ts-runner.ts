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
import { bootstrapResolvedApplications } from "./opencode-bootstrap-shared.js";
import {
  effectiveMcpServerPayloads,
  encodeWorkspaceMcpCatalog,
  mcpServerIdMap,
  mcpServerMappingMetadata,
  workspaceMcpCatalogFingerprint,
  type PreparedMcpServerPayload,
  type RunningWorkspaceMcpSidecar
} from "./opencode-runner-prep.js";
import { compileWorkspaceRuntimePlanFromWorkspace } from "./opencode-runner-prep.js";
import { stageWorkspaceCommands } from "./opencode-commands.js";
import { type OpencodeConfigCliRequest, updateOpencodeConfig } from "./opencode-config.js";
import {
  projectOpencodeRuntimeConfig,
  type OpencodeRuntimeConfigCliRequest,
  type OpencodeRuntimeConfigCliResponse
} from "./opencode-runtime-config.js";
import { restartOpencodeSidecar, type OpencodeSidecarCliRequest } from "./opencode-sidecar.js";
import { stageOpencodeSkills } from "./opencode-skills.js";
import { stageOpencodeDesktopBrowserPlugin } from "./opencode-browser-tools.js";
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
  persistWorkspaceMainSessionId,
  readWorkspaceMainSessionId,
  workspaceDirForId
} from "./ts-runner-session-state.js";
import { resolveProductRuntimeConfig } from "./runtime-config.js";
import { startWorkspaceMcpSidecar, type WorkspaceMcpSidecarCliRequest } from "./workspace-mcp-sidecar.js";
import type { CompiledWorkspaceRuntimePlan } from "./workspace-runtime-plan.js";

type LoggerLike = Pick<typeof console, "warn">;

const TERMINAL_EVENT_TYPES = new Set<TsRunnerEvent["event_type"]>(["run_completed", "run_failed"]);
const HARNESS_HOST_NOT_IMPLEMENTED_EXIT_CODE = 86;
const RUNTIME_EXEC_CONTEXT_KEY = "_sandbox_runtime_exec_v1";
const DEFAULT_OPENCODE_HOST = "127.0.0.1";
const DEFAULT_OPENCODE_PORT = 4096;
const DEFAULT_OPENCODE_READY_TIMEOUT_S = 30;
const DEFAULT_OPENCODE_SESSION_MODE = "code";
const DEFAULT_OPENCODE_PROVIDER_ID = "openai";
const WORKSPACE_MCP_READY_TIMEOUT_S = 10;
const OPENCODE_DEFAULT_TOOLS = [
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

type RuntimeExecContext = Record<string, unknown>;

export interface TsRunnerBootstrapState {
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
  projectRuntimeConfig: (request: OpencodeRuntimeConfigCliRequest) => OpencodeRuntimeConfigCliResponse;
  restartOpencodeSidecar: (request: OpencodeSidecarCliRequest) => Promise<void>;
  runHarnessHost: (params: {
    requestPayload: Record<string, unknown>;
    workspaceDir: string;
    emitEvent: (event: TsRunnerEvent) => Promise<void>;
    logger?: LoggerLike;
  }) => Promise<TsRunnerHarnessRelayResult>;
  stageBrowserTools: (params: { workspaceDir: string }) => { changed: boolean; toolIds: string[] };
  stageCommands: (params: { workspaceDir: string }) => { changed: boolean };
  stageSkills: (params: { workspaceDir: string; runtimeRoot: string }) => { changed: boolean; skillIds: string[] };
  startWorkspaceMcpSidecar: (request: WorkspaceMcpSidecarCliRequest) => Promise<RunningWorkspaceMcpSidecar | null>;
  updateOpencodeConfig: (request: OpencodeConfigCliRequest) => {
    path: string;
    provider_config_changed: boolean;
    model_selection_changed: boolean;
  };
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

function runtimeExecContextString(request: TsRunnerRequest, key: string): string | null {
  const value = request.context[RUNTIME_EXEC_CONTEXT_KEY];
  if (!isRecord(value)) {
    return null;
  }
  return firstNonEmptyString(value[key]);
}

function runtimeRootDir(): string {
  const configured = (process.env.HOLABOSS_RUNTIME_ROOT ?? "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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

function opencodeServerHost(): string {
  return firstNonEmptyString(process.env.OPENCODE_SERVER_HOST, DEFAULT_OPENCODE_HOST) ?? DEFAULT_OPENCODE_HOST;
}

function opencodeServerPort(): number {
  const raw = firstNonEmptyString(process.env.OPENCODE_SERVER_PORT);
  const value = raw ? Number.parseInt(raw, 10) : DEFAULT_OPENCODE_PORT;
  if (!Number.isFinite(value)) {
    return DEFAULT_OPENCODE_PORT;
  }
  return Math.max(1, Math.min(value, 65535));
}

function opencodeBaseUrl(): string {
  const configured = firstNonEmptyString(process.env.OPENCODE_BASE_URL);
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return `http://${opencodeServerHost()}:${opencodeServerPort()}`;
}

function opencodeTimeoutSeconds(): number {
  const raw = firstNonEmptyString(process.env.OPENCODE_RUN_TIMEOUT_S);
  const value = raw ? Number.parseInt(raw, 10) : 1800;
  if (!Number.isFinite(value)) {
    return 1800;
  }
  return Math.max(1, Math.min(value, 7200));
}

function opencodeReadyTimeoutSeconds(): number {
  const raw = firstNonEmptyString(process.env.OPENCODE_READY_TIMEOUT_S);
  const value = raw ? Number.parseFloat(raw) : DEFAULT_OPENCODE_READY_TIMEOUT_S;
  if (!Number.isFinite(value)) {
    return DEFAULT_OPENCODE_READY_TIMEOUT_S;
  }
  return Math.max(1, value);
}

function normalizeProviderId(value: string | null): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "anthropic" || normalized === "anthropic_native") {
    return "anthropic";
  }
  return normalized || DEFAULT_OPENCODE_PROVIDER_ID;
}

function opencodeDefaultProviderId(): string {
  try {
    const configured = resolveProductRuntimeConfig({
      requireAuth: false,
      requireUser: false,
      requireBaseUrl: false
    }).defaultProvider;
    return normalizeProviderId(configured);
  } catch {
    return normalizeProviderId(process.env.OPENCODE_PROVIDER_ID ?? DEFAULT_OPENCODE_PROVIDER_ID);
  }
}

function opencodeSessionMode(): string {
  return firstNonEmptyString(process.env.OPENCODE_SESSION_MODE, DEFAULT_OPENCODE_SESSION_MODE) ?? DEFAULT_OPENCODE_SESSION_MODE;
}

function opencodeExtraTools(): string[] {
  return (process.env.OPENCODE_EXTRA_TOOLS ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function opencodeSidecarFingerprint(
  runtimeConfig: OpencodeRuntimeConfigCliResponse,
  workspaceId: string
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        workspace_id: workspaceId,
        provider_id: runtimeConfig.provider_id,
        model_id: runtimeConfig.model_id,
        mode: runtimeConfig.mode,
        workspace_skill_ids: runtimeConfig.workspace_skill_ids
      }),
      "utf8"
    )
    .digest("hex");
}

function explicitHolabossUserId(request: TsRunnerRequest): string | undefined {
  return firstNonEmptyString(request.holaboss_user_id, request.context.holaboss_user_id) ?? undefined;
}

function bootstrapStartedPayload(params: {
  request: TsRunnerRequest;
  runtimeConfig: OpencodeRuntimeConfigCliResponse;
  mcpServerIdMap: Readonly<Record<string, string>>;
  mcpServers: PreparedMcpServerPayload[];
  sidecar: RunningWorkspaceMcpSidecar | null;
}): Record<string, unknown> {
  return {
    instruction_preview: params.request.instruction.slice(0, 120),
    provider_id: params.runtimeConfig.provider_id,
    model_id: params.runtimeConfig.model_id,
    workspace_tool_ids: [...params.runtimeConfig.workspace_tool_ids],
    workspace_skill_ids: [...params.runtimeConfig.workspace_skill_ids],
    mcp_server_ids: params.mcpServers.map((server) => server.name),
    mcp_server_mappings: mcpServerMappingMetadata(params.mcpServerIdMap),
    workspace_mcp_sidecar_reused: Boolean(params.sidecar?.reused),
    structured_output_enabled: Boolean(params.runtimeConfig.output_format),
    workspace_config_checksum: params.runtimeConfig.workspace_config_checksum
  };
}

function buildOpencodeRuntimeConfigRequest(params: {
  request: TsRunnerRequest;
  compiledPlan: CompiledWorkspaceRuntimePlan;
  browserToolIds: string[];
  workspaceSkillIds: string[];
  toolServerIdMap: Readonly<Record<string, string>>;
}): OpencodeRuntimeConfigCliRequest {
  const extraTools = Array.from(new Set([...opencodeExtraTools(), ...params.browserToolIds]));
  const common = {
    session_id: params.request.session_id,
    workspace_id: params.request.workspace_id,
    input_id: params.request.input_id,
    runtime_exec_model_proxy_api_key: runtimeExecContextString(params.request, "model_proxy_api_key") ?? undefined,
    runtime_exec_sandbox_id: runtimeExecContextString(params.request, "sandbox_id") ?? undefined,
    runtime_exec_run_id: runtimeExecContextString(params.request, "run_id") ?? undefined,
    selected_model: firstNonEmptyString(params.request.model) ?? undefined,
    default_provider_id: opencodeDefaultProviderId(),
    session_mode: opencodeSessionMode(),
    workspace_config_checksum: params.compiledPlan.config_checksum,
    workspace_skill_ids: [...params.workspaceSkillIds],
    default_tools: [...OPENCODE_DEFAULT_TOOLS],
    extra_tools: extraTools,
    tool_server_id_map: { ...params.toolServerIdMap },
    resolved_mcp_tool_refs: params.compiledPlan.resolved_mcp_tool_refs.map((toolRef) => ({
      tool_id: toolRef.tool_id,
      server_id: toolRef.server_id,
      tool_name: toolRef.tool_name
    })),
    resolved_output_schemas: {}
  };

  if (params.compiledPlan.general_config.type === "single") {
    return {
      ...common,
      general_type: "single",
      single_agent: {
        id: params.compiledPlan.general_config.agent.id,
        model: params.compiledPlan.general_config.agent.model,
        prompt: params.compiledPlan.general_config.agent.prompt,
        role: params.compiledPlan.general_config.agent.role
      },
      coordinator: undefined,
      members: []
    };
  }

  return {
    ...common,
    general_type: "team",
    single_agent: undefined,
    coordinator: {
      id: params.compiledPlan.general_config.coordinator.id,
      model: params.compiledPlan.general_config.coordinator.model,
      prompt: params.compiledPlan.general_config.coordinator.prompt,
      role: params.compiledPlan.general_config.coordinator.role
    },
    members: params.compiledPlan.general_config.members.map((member) => ({
      id: member.id,
      model: member.model,
      prompt: member.prompt,
      role: member.role
    }))
  };
}

function buildHarnessHostRequest(params: {
  request: TsRunnerRequest;
  bootstrap: TsRunnerBootstrapState;
  runtimeConfig: OpencodeRuntimeConfigCliResponse;
  mcpServers: PreparedMcpServerPayload[];
  runStartedPayload: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    workspace_id: params.request.workspace_id,
    workspace_dir: params.bootstrap.workspaceDir,
    session_id: params.request.session_id,
    input_id: params.request.input_id,
    instruction: params.request.instruction,
    debug: Boolean(params.request.debug),
    harness_session_id: params.bootstrap.requestedHarnessSessionId,
    persisted_harness_session_id: params.bootstrap.persistedHarnessSessionId,
    provider_id: params.runtimeConfig.provider_id,
    model_id: params.runtimeConfig.model_id,
    mode: params.runtimeConfig.mode,
    opencode_base_url: opencodeBaseUrl(),
    timeout_seconds: opencodeTimeoutSeconds(),
    system_prompt: params.runtimeConfig.system_prompt,
    tools: { ...params.runtimeConfig.tools },
    workspace_tool_ids: [...params.runtimeConfig.workspace_tool_ids],
    workspace_skill_ids: [...params.runtimeConfig.workspace_skill_ids],
    mcp_servers: params.mcpServers.map((server) => ({
      name: server.name,
      config: { ...server.config },
      ...(server._holaboss_force_refresh ? { _holaboss_force_refresh: true } : {})
    })),
    output_format: params.runtimeConfig.output_format,
    workspace_config_checksum: params.runtimeConfig.workspace_config_checksum,
    run_started_payload: params.runStartedPayload,
    model_client: {
      model_proxy_provider: params.runtimeConfig.model_client.model_proxy_provider,
      api_key: params.runtimeConfig.model_client.api_key,
      base_url: params.runtimeConfig.model_client.base_url,
      default_headers: params.runtimeConfig.model_client.default_headers
    }
  };
}

function terminalHarnessSessionId(event: TsRunnerEvent): string | null {
  if (!TERMINAL_EVENT_TYPES.has(event.event_type)) {
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
  try {
    child = spawn(
      runtimeNodeBin(),
      [...argsPrefix, entryPath, "run-opencode", "--request-base64", requestBase64],
      {
        cwd: runtimeRootDir(),
        env: { ...process.env },
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
    projectRuntimeConfig: (request) => projectOpencodeRuntimeConfig(request),
    restartOpencodeSidecar: async (request) => {
      await restartOpencodeSidecar(request);
    },
    runHarnessHost: defaultRunHarnessHost,
    stageBrowserTools: ({ workspaceDir }) => {
      const result = stageOpencodeDesktopBrowserPlugin({
        workspace_dir: workspaceDir
      });
      return {
        changed: result.changed,
        toolIds: result.tool_ids
      };
    },
    stageCommands: ({ workspaceDir }) =>
      stageWorkspaceCommands({
        workspace_dir: workspaceDir
      }),
    stageSkills: ({ workspaceDir, runtimeRoot }) => {
      const result = stageOpencodeSkills({
        workspace_dir: workspaceDir,
        runtime_root: runtimeRoot
      });
      return {
        changed: result.changed,
        skillIds: result.skill_ids
      };
    },
    startWorkspaceMcpSidecar: async (request) => {
      const result = await startWorkspaceMcpSidecar(request);
      return {
        physical_server_id: request.physical_server_id,
        url: result.url,
        pid: result.pid,
        reused: result.reused,
        timeout_ms: request.timeout_ms
      };
    },
    updateOpencodeConfig: (request) => updateOpencodeConfig(request)
  };
}

function synthesizeHarnessHostFailureMessage(result: TsRunnerHarnessRelayResult): string {
  if (result.missingEntryPath) {
    return `TypeScript OpenCode harness host entry not found at ${result.missingEntryPath}`;
  }
  if (result.spawnError) {
    return `Failed to start TypeScript OpenCode harness host: ${result.spawnError}`;
  }
  if (!result.sawEvent && result.exitCode === HARNESS_HOST_NOT_IMPLEMENTED_EXIT_CODE) {
    return result.stderr
      ? `TypeScript OpenCode harness host reported unimplemented OpenCode adapter: ${result.stderr}`
      : "TypeScript OpenCode harness host reported unimplemented OpenCode adapter";
  }

  let message =
    result.exitCode !== 0
      ? `TypeScript OpenCode harness host failed with exit code ${result.exitCode}`
      : "TypeScript OpenCode harness host ended before terminal event";
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
  const workspaceDir = workspaceDirForId(request.workspace_id);
  const persistedHarnessSessionId = readWorkspaceMainSessionId({
    workspaceDir,
    harness: "opencode",
    logger
  });

  return {
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
  workspaceDir: string;
  logger?: LoggerLike;
}): Promise<void> {
  await params.emitEvent(params.event);
  const sessionId = terminalHarnessSessionId(params.event);
  if (!sessionId) {
    return;
  }
  persistWorkspaceMainSessionId({
    workspaceDir: params.workspaceDir,
    harness: "opencode",
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

  await relayTsRunnerEvent({
    emitEvent: options.emitEvent,
    workspaceDir: bootstrap.workspaceDir,
    logger,
    event: buildTsRunnerEvent({
      sessionId: request.session_id,
      inputId: request.input_id,
      sequence: 1,
      eventType: "run_claimed",
      payload: {
        instruction_preview: request.instruction.slice(0, 120)
      }
    })
  });

  try {
    const stagedBrowserTools = deps.stageBrowserTools({
      workspaceDir: bootstrap.workspaceDir
    });
    const stagedSkills = deps.stageSkills({
      workspaceDir: bootstrap.workspaceDir,
      runtimeRoot: runtimeRootDir()
    });
    deps.stageCommands({
      workspaceDir: bootstrap.workspaceDir
    });

    const compiledPlan = deps.compilePlan({
      workspaceId: request.workspace_id,
      workspaceDir: bootstrap.workspaceDir
    });
    const serverIdMap = mcpServerIdMap({
      workspaceId: request.workspace_id,
      sandboxId: workspaceMcpSandboxId(),
      compiledPlan
    });
    const physicalWorkspaceServerId = serverIdMap.workspace ?? "workspace";

    let sidecar: RunningWorkspaceMcpSidecar | null = null;
    if (compiledPlan.workspace_mcp_catalog.length > 0) {
      let timeoutMs = 10000;
      for (const server of compiledPlan.resolved_mcp_servers) {
        if (server.server_id === "workspace") {
          timeoutMs = server.timeout_ms;
          break;
        }
      }
      sidecar = await deps.startWorkspaceMcpSidecar({
        workspace_dir: bootstrap.workspaceDir,
        physical_server_id: physicalWorkspaceServerId,
        expected_fingerprint: workspaceMcpCatalogFingerprint(compiledPlan),
        timeout_ms: timeoutMs,
        readiness_timeout_s: WORKSPACE_MCP_READY_TIMEOUT_S,
        catalog_json_base64: encodeWorkspaceMcpCatalog(compiledPlan)
      });
    }

    let effectiveMcpServers = effectiveMcpServerPayloads({
      compiledPlan,
      sidecar,
      serverIdMap
    });

    if (compiledPlan.resolved_applications.length > 0) {
      effectiveMcpServers = effectiveMcpServers.concat(
        await deps.bootstrapApplications({
          request,
          workspaceDir: bootstrap.workspaceDir,
          resolvedApplications: compiledPlan.resolved_applications
        })
      );
    }

    const runtimeConfig = deps.projectRuntimeConfig(
      buildOpencodeRuntimeConfigRequest({
        request,
        compiledPlan,
        browserToolIds: stagedBrowserTools.toolIds,
        workspaceSkillIds: stagedSkills.skillIds,
        toolServerIdMap: serverIdMap
      })
    );

    const configUpdate = deps.updateOpencodeConfig({
      workspace_root: bootstrap.workspaceRoot,
      provider_id: runtimeConfig.provider_id,
      model_id: runtimeConfig.model_id,
      model_client: runtimeConfig.model_client
    });

    if (configUpdate.provider_config_changed || stagedSkills.changed || stagedBrowserTools.changed) {
      await deps.restartOpencodeSidecar({
        workspace_root: bootstrap.workspaceRoot,
        workspace_id: request.workspace_id,
        config_fingerprint: opencodeSidecarFingerprint(runtimeConfig, request.workspace_id),
        allow_reuse_existing: false,
        host: opencodeServerHost(),
        port: opencodeServerPort(),
        readiness_url: `${opencodeBaseUrl()}/mcp`,
        ready_timeout_s: opencodeReadyTimeoutSeconds()
      });
    }

    const harnessResult = await deps.runHarnessHost({
      requestPayload: buildHarnessHostRequest({
        request,
        bootstrap,
        runtimeConfig,
        mcpServers: effectiveMcpServers,
        runStartedPayload: bootstrapStartedPayload({
          request,
          runtimeConfig,
          mcpServerIdMap: serverIdMap,
          mcpServers: effectiveMcpServers,
          sidecar
        })
      }),
      workspaceDir: bootstrap.workspaceDir,
      logger,
      emitEvent: async (event) => {
        await relayTsRunnerEvent({
          emitEvent: options.emitEvent,
          event,
          workspaceDir: bootstrap.workspaceDir,
          logger
        });
      }
    });

    if (harnessResult.terminalEmitted) {
      return;
    }

    await relayTsRunnerEvent({
      emitEvent: options.emitEvent,
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
      workspaceDir: bootstrap.workspaceDir,
      logger,
      event: buildTsRunnerFailureEvent({
        sessionId: request.session_id,
        inputId: request.input_id,
        sequence: 2,
        errorType: errorTypeFor(error),
        message: `OpenCode execution failed: ${errorMessage(error)}`
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
