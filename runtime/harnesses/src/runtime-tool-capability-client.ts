import type { RuntimeAgentToolId } from "./runtime-agent-tools.js";
import {
  capabilityReplayBudgetKey,
  formatCapabilityToolResult,
  isRecord,
  normalizeRuntimeApiBaseUrl,
  requestCapabilityJson,
  toolRequestSignal,
  withPreviewResultModeHeader,
} from "./capability-http.js";

const RUNTIME_TOOLS_CAPABILITY_STATUS_PATH = "/api/v1/capabilities/runtime-tools";
const RUNTIME_TOOLS_ONBOARDING_STATUS_PATH = "/api/v1/capabilities/runtime-tools/onboarding/status";
const RUNTIME_TOOLS_ONBOARDING_COMPLETE_PATH = "/api/v1/capabilities/runtime-tools/onboarding/complete";
const RUNTIME_TOOLS_CRONJOBS_PATH = "/api/v1/capabilities/runtime-tools/cronjobs";
const RUNTIME_TOOLS_SUBAGENTS_PATH = "/api/v1/capabilities/runtime-tools/subagents";
const RUNTIME_TOOLS_BACKGROUND_TASKS_PATH = "/api/v1/capabilities/runtime-tools/background-tasks";
const RUNTIME_TOOLS_IMAGE_GENERATE_PATH = "/api/v1/capabilities/runtime-tools/images/generate";
const RUNTIME_TOOLS_DOWNLOADS_PATH = "/api/v1/capabilities/runtime-tools/downloads";
const RUNTIME_TOOLS_REPORTS_PATH = "/api/v1/capabilities/runtime-tools/reports";
const RUNTIME_TOOLS_WEB_SEARCH_PATH = "/api/v1/capabilities/runtime-tools/web-search";
const RUNTIME_TOOLS_TODO_PATH = "/api/v1/capabilities/runtime-tools/todo";
const RUNTIME_TOOLS_SCRATCHPAD_PATH = "/api/v1/capabilities/runtime-tools/scratchpad";
const RUNTIME_TOOLS_SKILL_PATH = "/api/v1/capabilities/runtime-tools/skill";
const RUNTIME_TOOLS_TERMINAL_SESSIONS_PATH = "/api/v1/capabilities/runtime-tools/terminal-sessions";
const DEFAULT_RUNTIME_TOOL_TIMEOUT_MS = 30000;
const IMAGE_GENERATE_RUNTIME_TOOL_TIMEOUT_MS = 180000;
const DOWNLOAD_URL_RUNTIME_TOOL_TIMEOUT_MS = 120000;
const TERMINAL_WAIT_RUNTIME_TOOL_TIMEOUT_MS = 65000;

export interface RuntimeToolCapabilityClientOptions {
  runtimeApiBaseUrl: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  inputId?: string | null;
  selectedModel?: string | null;
  fetchImpl?: typeof fetch;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseOptionalJsonObject(raw: unknown, fieldName: string): Record<string, unknown> | undefined {
  const value = optionalString(raw);
  if (!value) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${fieldName} must be valid JSON object`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${fieldName} must be valid JSON object`);
  }
  return parsed;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function buildDeliveryPayload(toolParams: unknown): Record<string, unknown> | undefined {
  const params = isRecord(toolParams) ? toolParams : {};
  const channel = optionalString(params.delivery_channel);
  const mode = optionalString(params.delivery_mode);
  const to = optionalString(params.delivery_to);
  if (!channel && !mode && to === undefined) {
    return undefined;
  }
  return {
    ...(channel ? { channel } : {}),
    ...(mode ? { mode } : {}),
    ...(to !== undefined ? { to } : {}),
  };
}

function subagentPath(subagentId: unknown): string {
  const value = optionalString(subagentId);
  if (!value) {
    throw new Error("subagent_id is required");
  }
  return `${RUNTIME_TOOLS_SUBAGENTS_PATH}/${encodeURIComponent(value)}`;
}

function cronjobPath(jobId: unknown): string {
  const value = optionalString(jobId);
  if (!value) {
    throw new Error("job_id is required");
  }
  return `${RUNTIME_TOOLS_CRONJOBS_PATH}/${encodeURIComponent(value)}`;
}

function cronjobsListPath(toolParams: unknown): string {
  const params = isRecord(toolParams) ? toolParams : {};
  const query = new URLSearchParams();
  if (params.enabled_only === true) {
    query.set("enabled_only", "true");
  }
  const suffix = query.toString();
  return suffix ? `${RUNTIME_TOOLS_CRONJOBS_PATH}?${suffix}` : RUNTIME_TOOLS_CRONJOBS_PATH;
}

function createCronjobBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  const delivery = buildDeliveryPayload(params);
  const metadata = parseOptionalJsonObject(params.metadata_json, "metadata_json");
  return {
    cron: String(params.cron ?? ""),
    description: String(params.description ?? ""),
    instruction: String(params.instruction ?? ""),
    ...(optionalString(params.initiated_by) ? { initiated_by: optionalString(params.initiated_by) } : {}),
    ...(optionalString(params.name) ? { name: optionalString(params.name) } : {}),
    ...(typeof params.enabled === "boolean" ? { enabled: params.enabled } : {}),
    ...(delivery ? { delivery } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function updateCronjobBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  const delivery = buildDeliveryPayload(params);
  const metadata = parseOptionalJsonObject(params.metadata_json, "metadata_json");
  return {
    ...(optionalString(params.name) ? { name: optionalString(params.name) } : {}),
    ...(optionalString(params.cron) ? { cron: optionalString(params.cron) } : {}),
    ...(optionalString(params.description) ? { description: optionalString(params.description) } : {}),
    ...(optionalString(params.instruction) ? { instruction: optionalString(params.instruction) } : {}),
    ...(typeof params.enabled === "boolean" ? { enabled: params.enabled } : {}),
    ...(delivery ? { delivery } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function createImageGenerationBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    prompt: String(params.prompt ?? ""),
    ...(optionalString(params.filename) ? { filename: optionalString(params.filename) } : {}),
    ...(optionalString(params.size) ? { size: optionalString(params.size) } : {}),
  };
}

function normalizeDelegateTask(taskParams: unknown): Record<string, unknown> {
  const params = isRecord(taskParams) ? taskParams : {};
  const goal = optionalString(params.goal);
  return {
    ...(optionalString(params.title) ? { title: optionalString(params.title) } : {}),
    ...(goal ? { goal } : {}),
    ...(optionalString(params.context) ? { context: optionalString(params.context) } : {}),
    ...(optionalStringArray(params.tools) ? { tools: optionalStringArray(params.tools) } : {}),
    ...(optionalString(params.model) ? { model: optionalString(params.model) } : {}),
    ...(typeof params.timeout_ms === "number" ? { timeout_ms: params.timeout_ms } : {}),
  };
}

function createDelegateTaskBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  const normalizedTasks = Array.isArray(params.tasks)
    ? params.tasks.map((task) => normalizeDelegateTask(task)).filter((task) => typeof task.goal === "string")
    : [];
  if (normalizedTasks.length > 0) {
    return { tasks: normalizedTasks };
  }
  return { tasks: [normalizeDelegateTask(params)] };
}

function getSubagentPath(toolParams: unknown): string {
  return subagentPath(isRecord(toolParams) ? toolParams.subagent_id : undefined);
}

function listBackgroundTasksPath(toolParams: unknown): string {
  const params = isRecord(toolParams) ? toolParams : {};
  const query = new URLSearchParams();
  for (const status of optionalStringArray(params.statuses) ?? []) {
    query.append("status", status);
  }
  const ownerMainSessionId = optionalString(params.owner_main_session_id);
  if (ownerMainSessionId) {
    query.set("owner_main_session_id", ownerMainSessionId);
  }
  if (typeof params.limit === "number" && Number.isFinite(params.limit)) {
    query.set("limit", String(Math.trunc(params.limit)));
  }
  const suffix = query.toString();
  return suffix
    ? `${RUNTIME_TOOLS_BACKGROUND_TASKS_PATH}?${suffix}`
    : RUNTIME_TOOLS_BACKGROUND_TASKS_PATH;
}

function createResumeSubagentBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    answer: String(params.answer ?? ""),
    ...(optionalString(params.model) ? { model: optionalString(params.model) } : {}),
  };
}

function createDownloadUrlBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    url: String(params.url ?? ""),
    ...(optionalString(params.output_path) ? { output_path: optionalString(params.output_path) } : {}),
    ...(optionalString(params.expected_mime_prefix)
      ? { expected_mime_prefix: optionalString(params.expected_mime_prefix) }
      : {}),
    ...(typeof params.overwrite === "boolean" ? { overwrite: params.overwrite } : {}),
  };
}

function createWriteReportBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    content: String(params.content ?? ""),
    ...(optionalString(params.title) ? { title: optionalString(params.title) } : {}),
    ...(optionalString(params.filename) ? { filename: optionalString(params.filename) } : {}),
    ...(optionalString(params.summary) ? { summary: optionalString(params.summary) } : {}),
  };
}

function createWebSearchBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    query: String(params.query ?? ""),
    ...(typeof params.num_results === "number" ? { num_results: params.num_results } : {}),
    ...(typeof params.max_results === "number" ? { max_results: params.max_results } : {}),
    ...(optionalString(params.livecrawl) ? { livecrawl: optionalString(params.livecrawl) } : {}),
    ...(optionalString(params.type) ? { type: optionalString(params.type) } : {}),
    ...(typeof params.context_max_characters === "number"
      ? { context_max_characters: params.context_max_characters }
      : {}),
    ...(typeof params.text_offset === "number" ? { text_offset: params.text_offset } : {}),
    ...(typeof params.text_limit === "number" ? { text_limit: params.text_limit } : {}),
  };
}

function createSkillBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    name: String(params.name ?? ""),
    ...(optionalString(params.args) ? { args: optionalString(params.args) } : {}),
  };
}

function createTodoWriteBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    ops: Array.isArray(params.ops) ? params.ops : [],
  };
}

function createScratchpadWriteBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    op: String(params.op ?? ""),
    ...(optionalString(params.content) ? { content: optionalString(params.content) } : {}),
  };
}

function terminalSessionPath(terminalId: unknown): string {
  const value = optionalString(terminalId);
  if (!value) {
    throw new Error("terminal_id is required");
  }
  return `${RUNTIME_TOOLS_TERMINAL_SESSIONS_PATH}/${encodeURIComponent(value)}`;
}

function createTerminalSessionBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    command: String(params.command ?? ""),
    ...(optionalString(params.title) ? { title: optionalString(params.title) } : {}),
    ...(optionalString(params.cwd) ? { cwd: optionalString(params.cwd) } : {}),
    ...(typeof params.cols === "number" ? { cols: params.cols } : {}),
    ...(typeof params.rows === "number" ? { rows: params.rows } : {}),
  };
}

function readTerminalSessionBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    ...(typeof params.after_sequence === "number" ? { after_sequence: params.after_sequence } : {}),
    ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
  };
}

function waitTerminalSessionBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    ...(typeof params.after_sequence === "number" ? { after_sequence: params.after_sequence } : {}),
    ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
    ...(typeof params.timeout_ms === "number" ? { timeout_ms: params.timeout_ms } : {}),
  };
}

function sendTerminalSessionInputBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    data: String(params.data ?? ""),
  };
}

function signalTerminalSessionBody(toolParams: unknown): Record<string, unknown> {
  const params = isRecord(toolParams) ? toolParams : {};
  return {
    ...(optionalString(params.signal) ? { signal: optionalString(params.signal) } : {}),
  };
}

export function runtimeToolHeaders(params: {
  workspaceId?: string | null;
  sessionId?: string | null;
  inputId?: string | null;
  selectedModel?: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  const normalizedWorkspaceId = typeof params.workspaceId === "string" ? params.workspaceId.trim() : "";
  if (normalizedWorkspaceId) {
    headers["x-holaboss-workspace-id"] = normalizedWorkspaceId;
  }
  const normalizedSessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : "";
  if (normalizedSessionId) {
    headers["x-holaboss-session-id"] = normalizedSessionId;
  }
  const normalizedInputId = typeof params.inputId === "string" ? params.inputId.trim() : "";
  if (normalizedInputId) {
    headers["x-holaboss-input-id"] = normalizedInputId;
  }
  const normalizedSelectedModel = typeof params.selectedModel === "string" ? params.selectedModel.trim() : "";
  if (normalizedSelectedModel) {
    headers["x-holaboss-selected-model"] = normalizedSelectedModel;
  }
  return headers;
}

export function resolveRuntimeToolCapabilityBaseUrl(value: unknown): string {
  return normalizeRuntimeApiBaseUrl(value);
}

export async function runtimeToolCapabilityAvailable(
  options: RuntimeToolCapabilityClientOptions,
): Promise<boolean> {
  try {
    const response = await requestCapabilityJson({
      url: `${options.runtimeApiBaseUrl}${RUNTIME_TOOLS_CAPABILITY_STATUS_PATH}`,
      method: "GET",
      headers: runtimeToolHeaders({
        workspaceId: options.workspaceId,
        sessionId: options.sessionId,
        inputId: options.inputId,
        selectedModel: options.selectedModel,
      }),
      signal: AbortSignal.timeout(2000),
      fetchImpl: options.fetchImpl,
    });
    return response.ok && isRecord(response.payload) && response.payload.available === true;
  } catch {
    return false;
  }
}

function runtimeToolTimeoutMs(toolId: RuntimeAgentToolId): number {
  if (toolId === "image_generate") {
    return IMAGE_GENERATE_RUNTIME_TOOL_TIMEOUT_MS;
  }
  if (toolId === "download_url") {
    return DOWNLOAD_URL_RUNTIME_TOOL_TIMEOUT_MS;
  }
  if (toolId === "terminal_session_wait") {
    return TERMINAL_WAIT_RUNTIME_TOOL_TIMEOUT_MS;
  }
  return DEFAULT_RUNTIME_TOOL_TIMEOUT_MS;
}

function requestPlan(
  toolId: RuntimeAgentToolId,
  toolParams: unknown,
): {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  requestPath: string;
  body?: Record<string, unknown>;
} {
  switch (toolId) {
    case "holaboss_onboarding_status":
      return { method: "GET", requestPath: RUNTIME_TOOLS_ONBOARDING_STATUS_PATH };
    case "holaboss_onboarding_complete": {
      const params = isRecord(toolParams) ? toolParams : {};
      return {
        method: "POST",
        requestPath: RUNTIME_TOOLS_ONBOARDING_COMPLETE_PATH,
        body: {
          summary: String(params.summary ?? ""),
          ...(optionalString(params.requested_by) ? { requested_by: optionalString(params.requested_by) } : {}),
        },
      };
    }
    case "holaboss_cronjobs_list":
      return { method: "GET", requestPath: cronjobsListPath(toolParams) };
    case "holaboss_cronjobs_create":
      return { method: "POST", requestPath: RUNTIME_TOOLS_CRONJOBS_PATH, body: createCronjobBody(toolParams) };
    case "holaboss_cronjobs_get":
      return {
        method: "GET",
        requestPath: cronjobPath(isRecord(toolParams) ? toolParams.job_id : undefined),
      };
    case "holaboss_cronjobs_update":
      return {
        method: "PATCH",
        requestPath: cronjobPath(isRecord(toolParams) ? toolParams.job_id : undefined),
        body: updateCronjobBody(toolParams),
      };
    case "holaboss_cronjobs_delete":
      return {
        method: "DELETE",
        requestPath: cronjobPath(isRecord(toolParams) ? toolParams.job_id : undefined),
      };
    case "holaboss_delegate_task":
      return {
        method: "POST",
        requestPath: RUNTIME_TOOLS_SUBAGENTS_PATH,
        body: createDelegateTaskBody(toolParams),
      };
    case "holaboss_get_subagent":
      return {
        method: "GET",
        requestPath: getSubagentPath(toolParams),
      };
    case "holaboss_list_background_tasks":
      return {
        method: "GET",
        requestPath: listBackgroundTasksPath(toolParams),
      };
    case "holaboss_cancel_subagent":
      return {
        method: "POST",
        requestPath: `${subagentPath(isRecord(toolParams) ? toolParams.subagent_id : undefined)}/cancel`,
        body: {},
      };
    case "holaboss_resume_subagent":
      return {
        method: "POST",
        requestPath: `${subagentPath(isRecord(toolParams) ? toolParams.subagent_id : undefined)}/resume`,
        body: createResumeSubagentBody(toolParams),
      };
    case "image_generate":
      return { method: "POST", requestPath: RUNTIME_TOOLS_IMAGE_GENERATE_PATH, body: createImageGenerationBody(toolParams) };
    case "download_url":
      return { method: "POST", requestPath: RUNTIME_TOOLS_DOWNLOADS_PATH, body: createDownloadUrlBody(toolParams) };
    case "write_report":
      return { method: "POST", requestPath: RUNTIME_TOOLS_REPORTS_PATH, body: createWriteReportBody(toolParams) };
    case "web_search":
      return { method: "POST", requestPath: RUNTIME_TOOLS_WEB_SEARCH_PATH, body: createWebSearchBody(toolParams) };
    case "skill":
      return { method: "POST", requestPath: RUNTIME_TOOLS_SKILL_PATH, body: createSkillBody(toolParams) };
    case "todoread":
      return { method: "GET", requestPath: RUNTIME_TOOLS_TODO_PATH };
    case "todowrite":
      return { method: "POST", requestPath: RUNTIME_TOOLS_TODO_PATH, body: createTodoWriteBody(toolParams) };
    case "holaboss_scratchpad_read":
      return { method: "GET", requestPath: RUNTIME_TOOLS_SCRATCHPAD_PATH };
    case "holaboss_scratchpad_write":
      return { method: "POST", requestPath: RUNTIME_TOOLS_SCRATCHPAD_PATH, body: createScratchpadWriteBody(toolParams) };
    case "terminal_sessions_list":
      return { method: "GET", requestPath: RUNTIME_TOOLS_TERMINAL_SESSIONS_PATH };
    case "terminal_session_start":
      return {
        method: "POST",
        requestPath: RUNTIME_TOOLS_TERMINAL_SESSIONS_PATH,
        body: createTerminalSessionBody(toolParams),
      };
    case "terminal_session_get":
      return {
        method: "GET",
        requestPath: terminalSessionPath(isRecord(toolParams) ? toolParams.terminal_id : undefined),
      };
    case "terminal_session_read":
      return {
        method: "POST",
        requestPath: `${terminalSessionPath(isRecord(toolParams) ? toolParams.terminal_id : undefined)}/read`,
        body: readTerminalSessionBody(toolParams),
      };
    case "terminal_session_wait":
      return {
        method: "POST",
        requestPath: `${terminalSessionPath(isRecord(toolParams) ? toolParams.terminal_id : undefined)}/wait`,
        body: waitTerminalSessionBody(toolParams),
      };
    case "terminal_session_send_input":
      return {
        method: "POST",
        requestPath: `${terminalSessionPath(isRecord(toolParams) ? toolParams.terminal_id : undefined)}/input`,
        body: sendTerminalSessionInputBody(toolParams),
      };
    case "terminal_session_signal":
      return {
        method: "POST",
        requestPath: `${terminalSessionPath(isRecord(toolParams) ? toolParams.terminal_id : undefined)}/signal`,
        body: signalTerminalSessionBody(toolParams),
      };
    case "terminal_session_close":
      return {
        method: "POST",
        requestPath: `${terminalSessionPath(isRecord(toolParams) ? toolParams.terminal_id : undefined)}/close`,
        body: {},
      };
  }
}

export async function executeRuntimeToolCapability(params: RuntimeToolCapabilityClientOptions & {
  toolId: RuntimeAgentToolId;
  toolParams: unknown;
  signal?: AbortSignal;
}): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: {
    tool_id: RuntimeAgentToolId;
    replay_budget?: Record<string, unknown>;
  };
}> {
  const plan = requestPlan(params.toolId, params.toolParams);
  const response = await requestCapabilityJson({
    url: `${params.runtimeApiBaseUrl}${plan.requestPath}`,
    method: plan.method,
    headers: withPreviewResultModeHeader({
      "content-type": "application/json; charset=utf-8",
      ...runtimeToolHeaders({
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
        inputId: params.inputId,
        selectedModel: params.selectedModel,
      }),
    }),
    ...(plan.body && plan.method !== "GET" && plan.method !== "DELETE"
      ? { body: JSON.stringify(plan.body) }
      : {}),
    signal: toolRequestSignal(params.signal, runtimeToolTimeoutMs(params.toolId)),
    fetchImpl: params.fetchImpl,
  });

  if (!response.ok) {
    const message = isRecord(response.payload)
      ? String(response.payload.detail ?? response.payload.error ?? `Holaboss runtime tool '${params.toolId}' failed.`)
      : `Holaboss runtime tool '${params.toolId}' failed.`;
    throw new Error(message);
  }
  const formatted = formatCapabilityToolResult({
    payload: response.payload,
    toolId: params.toolId,
    replayBudgetKey: capabilityReplayBudgetKey({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      inputId: params.inputId,
    }),
  });

  return {
    content: [{ type: "text", text: formatted.text }],
    details: formatted.replayBudgetDecision?.trimmed
      ? {
          tool_id: params.toolId,
          replay_budget: {
            mode: formatted.replayBudgetDecision.mode,
            trimmed: formatted.replayBudgetDecision.trimmed,
            trim_reason: formatted.replayBudgetDecision.trimReason,
            replay_chars: formatted.replayBudgetDecision.replayChars,
            total_replay_chars: formatted.replayBudgetDecision.totalReplayChars,
            max_replay_chars: formatted.replayBudgetDecision.maxReplayChars,
            total_replay_items: formatted.replayBudgetDecision.totalReplayItems,
            max_replay_items: formatted.replayBudgetDecision.maxReplayItems,
          },
        }
      : {
          tool_id: params.toolId,
        },
  };
}
