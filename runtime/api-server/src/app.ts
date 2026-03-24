import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";

import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import yaml from "js-yaml";

import {
  type AppBuildRecord,
  type CronjobRecord,
  type OutputFolderRecord,
  type OutputRecord,
  type SessionArtifactRecord,
  type TaskProposalRecord,
  RuntimeStateStore,
  type OutputEventRecord,
  type SessionMessageRecord,
  type SessionRuntimeStateRecord,
  type WorkspaceRecord
} from "@holaboss/runtime-state-store";

import {
  type QueueWorkerLike,
  RuntimeQueueWorker,
  tsQueueWorkerEnabled
} from "./queue-worker.js";
import {
  type CronWorkerLike,
  RuntimeCronWorker,
  cronjobNextRunAt,
  tsCronWorkerEnabled
} from "./cron-worker.js";
import {
  type BridgeWorkerLike,
  RuntimeRemoteBridgeWorker,
  tsBridgeWorkerEnabled
} from "./bridge-worker.js";
import {
  AppLifecycleExecutorError,
  type AppLifecycleExecutorLike,
  PythonAppLifecycleExecutor
} from "./app-lifecycle-worker.js";
import {
  MemoryExecutorError,
  type MemoryExecutorLike,
  PythonMemoryExecutor
} from "./memory-worker.js";
import {
  FileRuntimeConfigService,
  RuntimeConfigServiceError,
  type RuntimeConfigServiceLike
} from "./runtime-config.js";
import {
  RunnerExecutorError,
  type RunnerExecutorLike,
  PythonRunnerExecutor
} from "./runner-worker.js";

const DEFAULT_POLL_INTERVAL_MS = 50;
const TERMINAL_EVENT_TYPES = new Set(["run_completed", "run_failed"]);
const APP_HTTP_PORT_BASE = 18080;
const APP_MCP_PORT_BASE = 13100;

export interface BuildRuntimeApiServerOptions {
  logger?: boolean;
  store?: RuntimeStateStore;
  dbPath?: string;
  workspaceRoot?: string;
  queueWorker?: QueueWorkerLike | null;
  cronWorker?: CronWorkerLike | null;
  bridgeWorker?: BridgeWorkerLike | null;
  appLifecycleExecutor?: AppLifecycleExecutorLike;
  memoryExecutor?: MemoryExecutorLike;
  runtimeConfigService?: RuntimeConfigServiceLike;
  runnerExecutor?: RunnerExecutorLike;
}

type StringMap = Record<string, unknown>;

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

function optionalDict(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function requiredDict(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value;
}

function optionalStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
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

function sessionMessagePayload(record: SessionMessageRecord): Record<string, unknown> {
  return {
    id: record.id,
    role: record.role,
    text: record.text,
    created_at: record.createdAt,
    metadata: record.metadata
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

function sessionArtifactPayload(record: SessionArtifactRecord): Record<string, unknown> {
  return {
    id: record.id,
    session_id: record.sessionId,
    workspace_id: record.workspaceId,
    artifact_type: record.artifactType,
    external_id: record.externalId,
    platform: record.platform,
    title: record.title,
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

function taskProposalPayload(record: TaskProposalRecord): Record<string, unknown> {
  return {
    proposal_id: record.proposalId,
    workspace_id: record.workspaceId,
    task_name: record.taskName,
    task_prompt: record.taskPrompt,
    task_generation_rationale: record.taskGenerationRationale,
    source_event_ids: record.sourceEventIds,
    created_at: record.createdAt,
    state: record.state
  };
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
    session_id: record.sessionId,
    input_id: record.inputId,
    sequence: record.sequence,
    event_type: record.eventType,
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

function portsForAppIndex(index: number): { http: number; mcp: number } {
  return {
    http: APP_HTTP_PORT_BASE + index,
    mcp: APP_MCP_PORT_BASE + index
  };
}

function collectWorkspaceSnapshot(workspaceDir: string) {
  const files: Array<Record<string, unknown>> = [];
  const extensionCounts: Record<string, number> = {};
  let totalSize = 0;
  const maxFiles = 5000;
  const skipDirectories = new Set([".git", "node_modules", "__pycache__", ".venv", "dist", "build"]);
  const stack: string[] = [workspaceDir];

  while (stack.length > 0 && files.length < maxFiles) {
    const currentDir = stack.pop() as string;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(workspaceDir, fullPath);
      if (!relativePath) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!skipDirectories.has(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stat = fs.statSync(fullPath);
      totalSize += stat.size;
      const extension = path.extname(entry.name).toLowerCase() || "(none)";
      extensionCounts[extension] = (extensionCounts[extension] ?? 0) + 1;
      files.push({
        path: relativePath.split(path.sep).join("/"),
        size: stat.size,
        modified: new Date(stat.mtimeMs).toISOString()
      });
      if (files.length >= maxFiles) {
        break;
      }
    }
  }

  const previews: Record<string, string> = {};
  for (const keyFile of ["workspace.yaml", "README.md", "AGENTS.md", "package.json"]) {
    const fullPath = path.join(workspaceDir, keyFile);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }
    previews[keyFile] = fs.readFileSync(fullPath).subarray(0, 1000).toString("utf8");
  }

  const git: Record<string, unknown> = {};
  if (fs.existsSync(path.join(workspaceDir, ".git"))) {
    try {
      const branchResult = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: workspaceDir,
        encoding: "utf8",
        timeout: 5000
      });
      if (branchResult.status === 0) {
        git.branch = branchResult.stdout.trim();
      }
      const statusResult = spawnSync("git", ["status", "--porcelain"], {
        cwd: workspaceDir,
        encoding: "utf8",
        timeout: 5000
      });
      git.dirty = Boolean(statusResult.stdout.trim());
    } catch {
      // Ignore git inspection failures.
    }
  }

  return {
    file_count: files.length,
    total_size: totalSize,
    files,
    extension_counts: extensionCounts,
    previews,
    git
  };
}

type ParsedInstalledApp = {
  appId: string;
  configPath: string;
  lifecycle: {
    setup: string;
    start: string;
    stop: string;
  };
};

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

function readWorkspaceYamlDocument(workspaceDir: string): Record<string, unknown> {
  const workspaceYamlPath = path.join(workspaceDir, "workspace.yaml");
  if (!fs.existsSync(workspaceYamlPath)) {
    return {};
  }
  const loaded = yaml.load(fs.readFileSync(workspaceYamlPath, "utf8"));
  return isRecord(loaded) ? loaded : {};
}

function writeWorkspaceYamlDocument(workspaceDir: string, document: Record<string, unknown>): void {
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    yaml.dump(document, { sortKeys: false, noRefs: true }),
    "utf8"
  );
}

function updateWorkspaceApplications(
  workspaceDir: string,
  updater: (applications: Array<Record<string, unknown>>) => Array<Record<string, unknown>>
): void {
  const document = readWorkspaceYamlDocument(workspaceDir);
  const currentApplications = Array.isArray(document.applications) ? document.applications.filter(isRecord) : [];
  document.applications = updater([...currentApplications]);
  writeWorkspaceYamlDocument(workspaceDir, document);
}

function removeWorkspaceApplication(workspaceDir: string, appId: string): void {
  updateWorkspaceApplications(workspaceDir, (applications) =>
    applications.filter((entry) => entry.app_id !== appId)
  );
}

function listWorkspaceApplications(workspaceDir: string): Array<Record<string, unknown>> {
  const document = readWorkspaceYamlDocument(workspaceDir);
  return Array.isArray(document.applications) ? document.applications.filter(isRecord) : [];
}

function parseInstalledAppRuntime(rawYaml: string, declaredAppId: string, configPath: string): ParsedInstalledApp {
  let loaded: unknown;
  try {
    loaded = yaml.load(rawYaml);
  } catch (error) {
    throw new Error(`invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(loaded)) {
    throw new Error("app.runtime.yaml must be a mapping");
  }
  const yamlAppId = String(loaded.app_id ?? "");
  if (yamlAppId !== declaredAppId) {
    throw new Error(`app_id in yaml ('${yamlAppId}') does not match declared app_id ('${declaredAppId}')`);
  }
  const mcp = isRecord(loaded.mcp) ? loaded.mcp : null;
  if (mcp?.port === undefined || mcp.port === null || Number.isNaN(Number(mcp.port))) {
    throw new Error(`mcp.port is required (${configPath})`);
  }
  const lifecycle = isRecord(loaded.lifecycle) ? loaded.lifecycle : {};
  return {
    appId: declaredAppId,
    configPath,
    lifecycle: {
      setup: typeof lifecycle.setup === "string" ? lifecycle.setup : "",
      start: typeof lifecycle.start === "string" ? lifecycle.start : "",
      stop: typeof lifecycle.stop === "string" ? lifecycle.stop : ""
    }
  };
}

function appendWorkspaceApplication(
  workspaceDir: string,
  params: { appId: string; configPath: string; lifecycle?: Record<string, string> | null }
): void {
  updateWorkspaceApplications(workspaceDir, (applications) => {
    if (applications.some((entry) => entry.app_id === params.appId)) {
      return applications;
    }
    const nextEntry: Record<string, unknown> = {
      app_id: params.appId,
      config_path: params.configPath
    };
    if (params.lifecycle && Object.keys(params.lifecycle).length > 0) {
      nextEntry.lifecycle = params.lifecycle;
    }
    applications.push(nextEntry);
    return applications;
  });
}

async function runAppSetup(params: {
  store: RuntimeStateStore;
  workspaceDir: string;
  workspaceId: string;
  appId: string;
  setupCommand: string;
}): Promise<void> {
  params.store.upsertAppBuild({
    workspaceId: params.workspaceId,
    appId: params.appId,
    status: "building"
  });

  try {
    const result = await new Promise<{ code: number | null; timedOut: boolean; stderr: string }>((resolve, reject) => {
      let stderr = "";
      let settled = false;
      const child = spawn(params.setupCommand, {
        cwd: path.join(params.workspaceDir, "apps", params.appId),
        env: process.env,
        shell: true,
        stdio: ["ignore", "ignore", "pipe"]
      });
      const timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGKILL");
        resolve({ code: null, timedOut: true, stderr });
      }, 300_000);

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
      params.store.upsertAppBuild({
        workspaceId: params.workspaceId,
        appId: params.appId,
        status: "failed",
        error: "setup timed out after 300s"
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
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      reject(new Error("workspace exec timed out"));
    }, Math.max(1, timeoutSeconds) * 1000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
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

  const app = Fastify({ logger: options.logger ?? false });
  const backgroundTasks = new Set<Promise<void>>();
  const appLifecycleExecutor = options.appLifecycleExecutor ?? new PythonAppLifecycleExecutor();
  const memoryExecutor = options.memoryExecutor ?? new PythonMemoryExecutor();
  const runtimeConfigService = options.runtimeConfigService ?? new FileRuntimeConfigService();
  const runnerExecutor = options.runnerExecutor ?? new PythonRunnerExecutor();
  const queueWorker =
    options.queueWorker === undefined
      ? tsQueueWorkerEnabled()
        ? new RuntimeQueueWorker({ store, logger: app.log })
        : null
      : options.queueWorker;
  const cronWorker =
    options.cronWorker === undefined
      ? tsCronWorkerEnabled()
        ? new RuntimeCronWorker({ store, logger: app.log, queueWorker })
        : null
      : options.cronWorker;
  const bridgeWorker =
    options.bridgeWorker === undefined
      ? tsBridgeWorkerEnabled()
        ? new RuntimeRemoteBridgeWorker({ logger: app.log })
        : null
      : options.bridgeWorker;

  app.addHook("onClose", async () => {
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

  app.post("/api/v1/lifecycle/shutdown", async (request, reply) => {
    void request;
    try {
      return await appLifecycleExecutor.shutdownAll();
    } catch (error) {
      if (error instanceof AppLifecycleExecutorError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "lifecycle shutdown failed");
    }
  });

  app.post("/api/v1/memory/search", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    try {
      return await memoryExecutor.search(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof MemoryExecutorError) {
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
      return await memoryExecutor.get(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof MemoryExecutorError) {
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
      return await memoryExecutor.upsert(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof MemoryExecutorError) {
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
      return await memoryExecutor.status(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof MemoryExecutorError) {
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
      return await memoryExecutor.sync(requiredDict(request.body, "body"));
    } catch (error) {
      if (error instanceof MemoryExecutorError) {
        return sendError(reply, error.statusCode, error.message);
      }
      return sendError(reply, 500, error instanceof Error ? error.message : "memory sync failed");
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
      items = items.filter((item) => item.status === status);
    }

    const paged = items.slice(offset, offset + limit);
    return {
      items: paged.map((item) => workspaceRecordPayload(item)),
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
    try {
      const workspace = store.deleteWorkspace(params.workspaceId);
      return { workspace: workspaceRecordPayload(workspace) };
    } catch {
      return sendError(reply, 404, "workspace not found");
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

    const result: Record<string, { http: number; mcp: number }> = {};
    for (const [index, entry] of listWorkspaceApplications(workspaceDir).entries()) {
      const appId = typeof entry.app_id === "string" ? entry.app_id : "";
      if (!appId) {
        continue;
      }
      result[appId] = portsForAppIndex(index);
    }
    return result;
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
    try {
      return await appLifecycleExecutor.startApp({
        workspaceId: requiredString(request.body.workspace_id, "workspace_id"),
        appId
      });
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
    try {
      return await appLifecycleExecutor.stopApp({
        workspaceId: requiredString(request.body.workspace_id, "workspace_id"),
        appId
      });
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
    const record = store.getAppBuild({
      workspaceId,
      appId
    });
    return record ? appBuildPayload(record) : { status: "unknown" };
  });

  app.get("/api/v1/apps", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = requiredString(query.workspace_id, "workspace_id");
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
      return sendError(reply, 404, "workspace not found");
    }
    const apps = listWorkspaceApplications(store.workspaceDir(workspaceId)).map((entry) => {
      const appId = typeof entry.app_id === "string" ? entry.app_id : "";
      const build = appId
        ? store.getAppBuild({
            workspaceId,
            appId
          })
        : null;
      return {
        app_id: appId,
        config_path: typeof entry.config_path === "string" ? entry.config_path : "",
        lifecycle: isRecord(entry.lifecycle) ? entry.lifecycle : null,
        build_status: build?.status ?? "unknown"
      };
    });
    return {
      apps: apps.filter((entry) => entry.app_id.length > 0),
      count: apps.filter((entry) => entry.app_id.length > 0).length
    };
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

    if (parsed.lifecycle.setup) {
      startBackgroundTask(
        runAppSetup({
          store,
          workspaceDir,
          workspaceId,
          appId,
          setupCommand: parsed.lifecycle.setup
        })
      );
      return {
        app_id: appId,
        status: "setup_started",
        detail: `Files written, running setup: ${parsed.lifecycle.setup}`
      };
    }

    return {
      app_id: appId,
      status: "installed",
      detail: "Files written, no setup command defined"
    };
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

    startBackgroundTask(
      runAppSetup({
        store,
        workspaceDir,
        workspaceId,
        appId,
        setupCommand: parsed.lifecycle.setup
      })
    );
    return {
      app_id: appId,
      status: "setup_started",
      detail: `Running: ${parsed.lifecycle.setup}`,
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

    try {
      await appLifecycleExecutor.stopApp({ workspaceId, appId });
    } catch {
      app.log.debug({ workspaceId, appId }, "best-effort app stop failed during uninstall");
    }

    const workspaceDir = store.workspaceDir(workspaceId);
    fs.rmSync(path.join(workspaceDir, "apps", appId), { recursive: true, force: true });
    removeWorkspaceApplication(workspaceDir, appId);
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

    let resolvedSessionId: string;
    try {
      resolvedSessionId = resolveQueueSessionId(optionalString(request.body.session_id), workspace);
    } catch (error) {
      return sendError(reply, 409, error instanceof Error ? error.message : "workspace main_session_id is not configured");
    }

    const trimmedText = requiredString(request.body.text, "text").trim();
    if (!trimmedText) {
      return sendError(reply, 422, "text is required");
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
    const items = store.listRuntimeStates(params.workspaceId).map((item) => runtimeStatePayload(item));
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
    const messages = allMessages.slice(offset, offset + limit).map((message) => sessionMessagePayload(message));
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

  app.post("/api/v1/agent-sessions/:sessionId/artifacts", async (request, reply) => {
    if (!isRecord(request.body)) {
      return sendError(reply, 400, "request body must be an object");
    }
    const params = request.params as { sessionId: string };
    const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
    store.ensureRuntimeState({
      workspaceId,
      sessionId: params.sessionId,
      status: "IDLE"
    });
    const artifact = store.createSessionArtifact({
      sessionId: params.sessionId,
      workspaceId,
      artifactType: requiredString(request.body.artifact_type, "artifact_type"),
      externalId: requiredString(request.body.external_id, "external_id"),
      platform: nullableString(request.body.platform) ?? null,
      title: nullableString(request.body.title) ?? null,
      metadata: optionalDict(request.body.metadata) ?? {}
    });
    store.createOutput({
      workspaceId,
      outputType: outputTypeForArtifact(artifact.artifactType),
      title: artifact.title ?? "",
      sessionId: params.sessionId,
      artifactId: artifact.id,
      platform: artifact.platform,
      metadata: artifact.metadata
    });
    return reply.send({ artifact: sessionArtifactPayload(artifact) });
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
    const items = store
      .listSessionArtifacts({ sessionId: params.sessionId, workspaceId: resolvedWorkspaceId })
      .map((item) => sessionArtifactPayload(item));
    return { items, count: items.length };
  });

  app.get("/api/v1/agent-sessions/by-workspace/:workspaceId/with-artifacts", async (request) => {
    const params = request.params as { workspaceId: string };
    const query = isRecord(request.query) ? request.query : {};
    const limit = Math.max(1, Math.min(100, optionalInteger(query.limit, 20)));
    const offset = Math.max(0, optionalInteger(query.offset, 0));
    const items = store.listSessionsWithArtifacts({ workspaceId: params.workspaceId, limit, offset });
    return { items, count: items.length };
  });

  app.get("/api/v1/output-folders", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    return {
      items: store.listOutputFolders({ workspaceId }).map((item) => outputFolderPayload(item))
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
      limit: Math.max(1, Math.min(200, optionalInteger(query.limit, 50))),
      offset: Math.max(0, optionalInteger(query.offset, 0))
    });
    return { items: items.map((item) => outputPayload(item)) };
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
      moduleId: nullableString(request.body.module_id) ?? null,
      moduleResourceId: nullableString(request.body.module_resource_id) ?? null,
      filePath: nullableString(request.body.file_path) ?? null,
      htmlContent: nullableString(request.body.html_content) ?? null,
      sessionId: nullableString(request.body.session_id) ?? null,
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
      .map((item) => cronjobPayload(item));
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
    const proposals = store.listTaskProposals({ workspaceId }).map((item) => taskProposalPayload(item));
    return { proposals, count: proposals.length };
  });

  app.get("/api/v1/task-proposals/unreviewed", async (request, reply) => {
    const query = isRecord(request.query) ? request.query : {};
    const workspaceId = optionalString(query.workspace_id);
    if (!workspaceId) {
      return sendError(reply, 400, "workspace_id is required");
    }
    const proposals = store.listUnreviewedTaskProposals({ workspaceId }).map((item) => taskProposalPayload(item));
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
          store.listUnreviewedTaskProposals({ workspaceId }).map((item) => item.proposalId)
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
      .map((item) => outputEventPayload(item));
    return {
      items,
      count: items.length,
      last_event_id: items.reduce<number>((maxId, item) => Math.max(maxId, Number(item.id)), afterEventId)
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
