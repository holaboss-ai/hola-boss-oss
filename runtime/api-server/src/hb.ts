import { pathToFileURL } from "node:url";

import { FilesystemMemoryService, type MemoryServiceLike } from "./memory.js";
import { resolveProductRuntimeConfig, type ProductRuntimeConfig } from "./runtime-config.js";

const HB_SANDBOX_ROOT_ENV = "HB_SANDBOX_ROOT";
const SANDBOX_AGENT_BASE_URL_ENV = "SANDBOX_AGENT_BASE_URL";
const WORKFLOW_BACKEND_ENV = "HOLABOSS_RUNTIME_WORKFLOW_BACKEND";
const WORKFLOW_BACKEND_REMOTE_API = "remote_api";
const WORKFLOW_BACKEND_LOCAL_SQLITE = "local_sqlite";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type ParsedOptions = Record<string, string | boolean>;
type ProductConfigResolver = (params?: {
  requireAuth?: boolean;
  requireUser?: boolean;
  requireBaseUrl?: boolean;
  includeDefaultBaseUrl?: boolean;
}) => ProductRuntimeConfig;

export const ALLOWED_DELIVERY_MODES = new Set(["none", "announce"]);
export const ALLOWED_DELIVERY_CHANNELS = new Set(["system_notification", "session_run"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseOptions(tokens: string[]): ParsedOptions {
  const options: ParsedOptions = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (!name) {
      throw new Error("option name is required");
    }
    const next = tokens[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[name] = true;
      continue;
    }
    options[name] = next;
    index += 1;
  }
  return options;
}

function hasOption(options: ParsedOptions, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, name);
}

function requiredStringOption(options: ParsedOptions, name: string): string {
  const value = options[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function optionalStringOption(options: ParsedOptions, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

function optionalFlag(options: ParsedOptions, name: string): boolean {
  return options[name] === true;
}

function parseBool(value: string): boolean {
  const token = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(token)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(token)) {
    return false;
  }
  throw new Error("expected boolean value (true|false)");
}

function parseJsonObject(raw: string, fieldName: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON object`, { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new TypeError(`${fieldName} must be JSON object`);
  }
  return parsed as JsonObject;
}

function normalizeDelivery(params: {
  channel: string;
  mode?: string;
  to?: unknown;
}): JsonObject {
  const normalizedMode = String(params.mode ?? "announce").trim();
  const normalizedChannel = String(params.channel).trim();
  if (!ALLOWED_DELIVERY_MODES.has(normalizedMode)) {
    throw new Error(`delivery mode must be one of ${JSON.stringify([...ALLOWED_DELIVERY_MODES].sort())}`);
  }
  if (!ALLOWED_DELIVERY_CHANNELS.has(normalizedChannel)) {
    throw new Error(`delivery channel must be one of ${JSON.stringify([...ALLOWED_DELIVERY_CHANNELS].sort())}`);
  }
  return {
    mode: normalizedMode,
    channel: normalizedChannel,
    to: typeof params.to === "string" ? params.to : params.to == null ? null : String(params.to)
  };
}

export function workflowBackend(): string {
  const raw = (process.env[WORKFLOW_BACKEND_ENV] ?? WORKFLOW_BACKEND_REMOTE_API).trim().toLowerCase();
  if ([WORKFLOW_BACKEND_REMOTE_API, WORKFLOW_BACKEND_LOCAL_SQLITE].includes(raw)) {
    return raw;
  }
  return WORKFLOW_BACKEND_REMOTE_API;
}

function workspaceRootPath(): string {
  const sandboxRoot = (process.env[HB_SANDBOX_ROOT_ENV] ?? "/holaboss").trim() || "/holaboss";
  return `${sandboxRoot.replace(/\/+$/, "")}/workspace`;
}

export function cronjobsBaseUrl(): string {
  const baseUrl = (process.env[SANDBOX_AGENT_BASE_URL_ENV] ?? "http://127.0.0.1:8080").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error(`${SANDBOX_AGENT_BASE_URL_ENV} is required`);
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`${SANDBOX_AGENT_BASE_URL_ENV} must be an absolute http(s) URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.host) {
    throw new Error(`${SANDBOX_AGENT_BASE_URL_ENV} must be an absolute http(s) URL`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${SANDBOX_AGENT_BASE_URL_ENV} must not include query or fragment`);
  }
  if (baseUrl.endsWith("/api/v1/cronjobs")) {
    return baseUrl;
  }
  return `${baseUrl}/api/v1/cronjobs`;
}

function configHeaders(resolveConfig: ProductConfigResolver = resolveProductRuntimeConfig): Record<string, string> {
  const config = resolveConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false
  });
  const headers: Record<string, string> = {};
  if (config.authToken) {
    headers["X-API-Key"] = config.authToken;
  }
  if (config.userId) {
    headers["X-Holaboss-User-Id"] = config.userId;
  }
  if (config.sandboxId) {
    headers["X-Holaboss-Sandbox-Id"] = config.sandboxId;
  }
  return headers;
}

export function onboardingBaseUrl(resolveConfig: ProductConfigResolver = resolveProductRuntimeConfig): string {
  const config = resolveConfig({
    requireAuth: false,
    requireUser: false
  });
  const suffix = "/api/v1/model-proxy";
  if (!config.modelProxyBaseUrl.endsWith(suffix)) {
    throw new Error(`HOLABOSS_MODEL_PROXY_BASE_URL must end with ${suffix}`);
  }
  return `${config.modelProxyBaseUrl.slice(0, -suffix.length)}/api/v1/sandbox/onboarding/workspaces`;
}

async function parseJsonResponse(response: Response, invalidResponseMessage: string): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return { success: true };
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(invalidResponseMessage, { cause: error });
  }
}

async function extractErrorDetail(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) {
    return "";
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && typeof parsed.detail === "string") {
      return parsed.detail;
    }
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

async function requestJson(params: {
  fetchImpl: typeof fetch;
  method: string;
  url: string;
  headers?: Record<string, string>;
  payload?: JsonObject;
  query?: Record<string, string | boolean | undefined>;
  allow404?: boolean;
  invalidResponseMessage: string;
  errorPrefix: string;
}): Promise<unknown> {
  const url = new URL(params.url);
  for (const [key, value] of Object.entries(params.query ?? {})) {
    if (value === undefined) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await params.fetchImpl(url, {
      method: params.method,
      headers: params.payload
        ? {
            "content-type": "application/json",
            ...(params.headers ?? {})
          }
        : (params.headers ?? {}),
      body: params.payload ? JSON.stringify(params.payload) : undefined
    });
  } catch (error) {
    throw new Error(`${params.errorPrefix} request failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }

  if (params.allow404 && response.status === 404) {
    return null;
  }
  if (response.status >= 400) {
    const detail = await extractErrorDetail(response);
    throw new Error(`${params.errorPrefix} error status=${response.status} detail=${detail}`);
  }
  if (response.status === 204) {
    return { success: true };
  }
  return await parseJsonResponse(response, params.invalidResponseMessage);
}

async function cronjobsRequest(
  method: string,
  path: string,
  options: {
    fetchImpl: typeof fetch;
    payload?: JsonObject;
    query?: Record<string, string | boolean | undefined>;
    allow404?: boolean;
  }
): Promise<unknown> {
  return await requestJson({
    fetchImpl: options.fetchImpl,
    method,
    url: `${cronjobsBaseUrl()}${path}`,
    payload: options.payload,
    query: options.query,
    allow404: options.allow404,
    invalidResponseMessage: "cronjobs API returned non-JSON response",
    errorPrefix: "cronjobs API"
  });
}

async function onboardingRequest(
  method: string,
  path: string,
  options: {
    fetchImpl: typeof fetch;
    payload?: JsonObject;
    resolveConfig?: ProductConfigResolver;
  }
): Promise<unknown> {
  return await requestJson({
    fetchImpl: options.fetchImpl,
    method,
    url: `${onboardingBaseUrl(options.resolveConfig)}${path}`,
    headers: configHeaders(options.resolveConfig),
    payload: options.payload,
    invalidResponseMessage: "onboarding API returned non-JSON response",
    errorPrefix: "onboarding API"
  });
}

async function runRuntimeInfo(resolveConfig: ProductConfigResolver): Promise<JsonObject> {
  const config = resolveConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false
  });
  return {
    runtime_mode: config.runtimeMode,
    holaboss_features_enabled: config.holabossEnabled,
    default_harness: "opencode",
    workflow_backend: workflowBackend(),
    runtime_config_path: config.configPath,
    runtime_config_loaded: config.loadedFromFile
  };
}

async function runMemory(
  action: string,
  options: ParsedOptions,
  memoryService: MemoryServiceLike
): Promise<Record<string, unknown>> {
  if (action === "search") {
    return await memoryService.search({
      workspace_id: requiredStringOption(options, "workspace-id"),
      query: requiredStringOption(options, "query"),
      max_results: hasOption(options, "max-results") ? Number(requiredStringOption(options, "max-results")) : undefined,
      min_score: hasOption(options, "min-score") ? Number(requiredStringOption(options, "min-score")) : undefined
    });
  }

  if (action === "get") {
    return await memoryService.get({
      workspace_id: requiredStringOption(options, "workspace-id"),
      path: requiredStringOption(options, "path"),
      from_line: hasOption(options, "from-line") ? Number(requiredStringOption(options, "from-line")) : undefined,
      lines: hasOption(options, "lines") ? Number(requiredStringOption(options, "lines")) : undefined
    });
  }

  if (action === "upsert") {
    return await memoryService.upsert({
      workspace_id: requiredStringOption(options, "workspace-id"),
      path: requiredStringOption(options, "path"),
      content: requiredStringOption(options, "content"),
      append: optionalFlag(options, "append")
    });
  }

  if (action === "status") {
    return await memoryService.status({
      workspace_id: requiredStringOption(options, "workspace-id")
    });
  }

  if (action === "sync") {
    return await memoryService.sync({
      workspace_id: requiredStringOption(options, "workspace-id"),
      reason: optionalStringOption(options, "reason") ?? "manual",
      force: optionalFlag(options, "force")
    });
  }

  throw new Error(`unsupported memory action: ${action}`);
}

async function runCronjobs(
  action: string,
  options: ParsedOptions,
  deps: { fetchImpl: typeof fetch; resolveConfig: ProductConfigResolver }
): Promise<unknown> {
  if (action === "create") {
    const metadata = parseJsonObject(optionalStringOption(options, "metadata-json") ?? "{}", "metadata_json");
    const config = deps.resolveConfig({
      requireAuth: false,
      requireBaseUrl: false,
      requireUser: false
    });
    if (config.userId && typeof metadata.holaboss_user_id !== "string") {
      metadata.holaboss_user_id = config.userId;
    }
    const created = await cronjobsRequest("POST", "", {
      fetchImpl: deps.fetchImpl,
      payload: {
        workspace_id: requiredStringOption(options, "workspace-id"),
        initiated_by: optionalStringOption(options, "initiated-by") ?? "workspace_agent",
        cron: requiredStringOption(options, "cron"),
        description: requiredStringOption(options, "description"),
        enabled: parseBool(optionalStringOption(options, "enabled") ?? "true"),
        delivery: normalizeDelivery({
          channel: optionalStringOption(options, "delivery-channel") ?? "session_run",
          mode: optionalStringOption(options, "delivery-mode") ?? "announce",
          to: optionalStringOption(options, "delivery-to")
        }),
        metadata
      }
    });
    return isRecord(created) ? created : { result: created as JsonValue };
  }

  if (action === "list") {
    const listed = await cronjobsRequest("GET", "", {
      fetchImpl: deps.fetchImpl,
      query: {
        workspace_id: requiredStringOption(options, "workspace-id"),
        enabled_only: optionalFlag(options, "enabled-only")
      }
    });
    if (isRecord(listed)) {
      return listed;
    }
    if (Array.isArray(listed)) {
      return { jobs: listed as JsonValue[], count: listed.length };
    }
    return { jobs: [], count: 0 };
  }

  if (action === "get") {
    const result = await cronjobsRequest("GET", `/${requiredStringOption(options, "job-id")}`, {
      fetchImpl: deps.fetchImpl,
      allow404: true
    });
    if (result == null) {
      return null;
    }
    if (!isRecord(result)) {
      return { result: result as JsonValue };
    }
    const workspaceId = optionalStringOption(options, "workspace-id");
    if (workspaceId && result.workspace_id !== workspaceId) {
      throw new Error("requested cronjob does not belong to this workspace");
    }
    return result;
  }

  if (action === "update") {
    const jobId = requiredStringOption(options, "job-id");
    const existing = await cronjobsRequest("GET", `/${jobId}`, {
      fetchImpl: deps.fetchImpl,
      allow404: true
    });
    if (existing == null) {
      throw new Error("cronjob not found");
    }
    if (!isRecord(existing)) {
      throw new TypeError("invalid cronjob response while loading existing job");
    }
    const workspaceId = optionalStringOption(options, "workspace-id");
    if (workspaceId && existing.workspace_id !== workspaceId) {
      throw new Error("requested cronjob does not belong to this workspace");
    }
    const existingDelivery = isRecord(existing.delivery) ? existing.delivery : {};
    const updatePayload: JsonObject = {
      delivery: normalizeDelivery({
        channel: optionalStringOption(options, "delivery-channel") ?? String(existingDelivery.channel ?? "session_run"),
        mode: optionalStringOption(options, "delivery-mode") ?? String(existingDelivery.mode ?? "announce"),
        to: hasOption(options, "delivery-to") ? optionalStringOption(options, "delivery-to") : existingDelivery.to
      })
    };
    if (hasOption(options, "cron")) {
      updatePayload.cron = requiredStringOption(options, "cron");
    }
    if (hasOption(options, "description")) {
      updatePayload.description = requiredStringOption(options, "description");
    }
    if (hasOption(options, "enabled")) {
      updatePayload.enabled = parseBool(requiredStringOption(options, "enabled"));
    }
    if (hasOption(options, "metadata-json")) {
      updatePayload.metadata = parseJsonObject(requiredStringOption(options, "metadata-json"), "metadata_json");
    }
    const updated = await cronjobsRequest("PATCH", `/${jobId}`, {
      fetchImpl: deps.fetchImpl,
      payload: updatePayload
    });
    return isRecord(updated) ? updated : { result: updated as JsonValue };
  }

  if (action === "delete") {
    const jobId = requiredStringOption(options, "job-id");
    const existing = await cronjobsRequest("GET", `/${jobId}`, {
      fetchImpl: deps.fetchImpl,
      allow404: true
    });
    if (existing == null) {
      return { success: false };
    }
    if (isRecord(existing)) {
      const workspaceId = optionalStringOption(options, "workspace-id");
      if (workspaceId && existing.workspace_id !== workspaceId) {
        throw new Error("requested cronjob does not belong to this workspace");
      }
    }
    const deleted = await cronjobsRequest("DELETE", `/${jobId}`, {
      fetchImpl: deps.fetchImpl
    });
    return isRecord(deleted) ? deleted : { success: Boolean(deleted) };
  }

  throw new Error(`unsupported cronjobs action: ${action}`);
}

async function runOnboarding(
  action: string,
  options: ParsedOptions,
  deps: { fetchImpl: typeof fetch; resolveConfig: ProductConfigResolver }
): Promise<unknown> {
  if (action === "status") {
    const payload = await onboardingRequest("GET", `/${requiredStringOption(options, "workspace-id")}/status`, {
      fetchImpl: deps.fetchImpl,
      resolveConfig: deps.resolveConfig
    });
    return isRecord(payload) ? payload : { result: payload as JsonValue };
  }

  if (action === "request-complete") {
    const payload = await onboardingRequest(
      "POST",
      `/${requiredStringOption(options, "workspace-id")}/request-complete`,
      {
        fetchImpl: deps.fetchImpl,
        resolveConfig: deps.resolveConfig,
        payload: {
          summary: requiredStringOption(options, "summary"),
          requested_by: optionalStringOption(options, "requested-by") ?? "workspace_agent"
        }
      }
    );
    return isRecord(payload) ? payload : { result: payload as JsonValue };
  }

  throw new Error(`unsupported onboarding action: ${action}`);
}

export async function runHb(
  argv: string[],
  options: {
    fetchImpl?: typeof fetch;
    resolveConfig?: ProductConfigResolver;
    memoryService?: MemoryServiceLike;
  } = {}
): Promise<unknown> {
  if (argv.length < 2) {
    throw new Error("usage: hb <group> <action> [options]");
  }
  const [group, action, ...rest] = argv;
  const parsedOptions = parseOptions(rest);
  const deps = {
    fetchImpl: options.fetchImpl ?? fetch,
    resolveConfig: options.resolveConfig ?? resolveProductRuntimeConfig,
    memoryService: options.memoryService ?? new FilesystemMemoryService({ workspaceRoot: workspaceRootPath() })
  };

  if (group === "runtime") {
    if (action === "info") {
      return await runRuntimeInfo(deps.resolveConfig);
    }
    throw new Error(`unsupported runtime action: ${action}`);
  }

  if (group === "cronjobs") {
    return await runCronjobs(action, parsedOptions, deps);
  }

  if (group === "onboarding") {
    return await runOnboarding(action, parsedOptions, deps);
  }

  if (group === "memory") {
    return await runMemory(action, parsedOptions, deps.memoryService);
  }

  throw new Error(`unsupported command group: ${group}`);
}

function emitJson(payload: unknown, stream: NodeJS.WritableStream): void {
  stream.write(`${JSON.stringify(payload)}\n`);
}

export async function main(
  argv: string[] = process.argv.slice(2),
  options: {
    io?: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
    fetchImpl?: typeof fetch;
    resolveConfig?: ProductConfigResolver;
    memoryService?: MemoryServiceLike;
  } = {}
): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  try {
    const payload = await runHb(argv, {
      fetchImpl: options.fetchImpl,
      resolveConfig: options.resolveConfig,
      memoryService: options.memoryService
    });
    emitJson(payload, io.stdout);
    return 0;
  } catch (error) {
    emitJson(
      {
        error: error instanceof Error ? error.constructor.name : "Error",
        message: error instanceof Error ? error.message : String(error)
      },
      io.stderr
    );
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
