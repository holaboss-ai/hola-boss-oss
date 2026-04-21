import http from "node:http";
import https from "node:https";

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import {
  RUNTIME_AGENT_TOOL_DEFINITIONS,
  RUNTIME_AGENT_TOOL_IDS,
  type RuntimeAgentToolId,
} from "../../harnesses/src/runtime-agent-tools.js";

const RUNTIME_TOOLS_CAPABILITY_STATUS_PATH = "/api/v1/capabilities/runtime-tools";
const RUNTIME_TOOLS_ONBOARDING_STATUS_PATH = "/api/v1/capabilities/runtime-tools/onboarding/status";
const RUNTIME_TOOLS_ONBOARDING_COMPLETE_PATH = "/api/v1/capabilities/runtime-tools/onboarding/complete";
const RUNTIME_TOOLS_CRONJOBS_PATH = "/api/v1/capabilities/runtime-tools/cronjobs";
const RUNTIME_TOOLS_IMAGE_GENERATE_PATH = "/api/v1/capabilities/runtime-tools/images/generate";
const RUNTIME_TOOLS_DOWNLOADS_PATH = "/api/v1/capabilities/runtime-tools/downloads";
const RUNTIME_TOOLS_REPORTS_PATH = "/api/v1/capabilities/runtime-tools/reports";
const RUNTIME_TOOLS_TERMINAL_SESSIONS_PATH = "/api/v1/capabilities/runtime-tools/terminal-sessions";
const DEFAULT_RUNTIME_TOOL_TIMEOUT_MS = 30000;
const IMAGE_GENERATE_RUNTIME_TOOL_TIMEOUT_MS = 180000;
const DOWNLOAD_URL_RUNTIME_TOOL_TIMEOUT_MS = 120000;
const TERMINAL_WAIT_RUNTIME_TOOL_TIMEOUT_MS = 65000;
const CRONJOB_DELIVERY_CHANNELS = ["system_notification", "session_run"] as const;
const CRONJOB_DELIVERY_MODES = ["announce", "none"] as const;

function cronjobDeliveryChannelSchema() {
  return Type.Union(
    CRONJOB_DELIVERY_CHANNELS.map((value) => Type.Literal(value)),
    {
      description:
        "Delivery channel. Use `session_run` for recurring agent work such as running instructions, tasks, analysis, browsing, or writing. Use `system_notification` only for lightweight reminder/notification messages."
    }
  );
}

function cronjobDeliveryModeSchema() {
  return Type.Union(
    CRONJOB_DELIVERY_MODES.map((value) => Type.Literal(value)),
    {
      description: "Delivery mode. Allowed values: `announce` or `none`."
    }
  );
}

export interface PiRuntimeToolOptions {
  runtimeApiBaseUrl: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  inputId?: string | null;
  selectedModel?: string | null;
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRuntimeApiBaseUrl(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

function runtimeToolHeaders(params: {
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
  const normalizedSelectedModel =
    typeof params.selectedModel === "string" ? params.selectedModel.trim() : "";
  if (normalizedSelectedModel) {
    headers["x-holaboss-selected-model"] = normalizedSelectedModel;
  }
  return headers;
}

function toolRequestSignal(signal: AbortSignal | undefined, timeoutMs = DEFAULT_RUNTIME_TOOL_TIMEOUT_MS): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
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

function parseJsonText(text: string): unknown {
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  return parseJsonText(text);
}

async function nodeRequestJson(params: {
  url: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const target = new URL(params.url);
  const client = target.protocol === "https:" ? https : http;

  return await new Promise((resolve, reject) => {
    const request = client.request(
      target,
      {
        method: params.method,
        headers: params.headers,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
              status: response.statusCode ?? 0,
              payload: parseJsonText(text),
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("error", reject);

    if (params.signal) {
      if (params.signal.aborted) {
        request.destroy(params.signal.reason instanceof Error ? params.signal.reason : new Error("Request aborted"));
      } else {
        params.signal.addEventListener(
          "abort",
          () => {
            request.destroy(params.signal?.reason instanceof Error ? params.signal.reason : new Error("Request aborted"));
          },
          { once: true }
        );
      }
    }

    if (params.body) {
      request.write(params.body);
    }
    request.end();
  });
}

function formatRuntimeToolResult(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  return JSON.stringify(payload, null, 2);
}

function runtimeToolLabel(toolId: RuntimeAgentToolId): string {
  return toolId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function runtimeToolParameters(toolId: RuntimeAgentToolId) {
  switch (toolId) {
    case "holaboss_onboarding_status":
      return Type.Object({}, { additionalProperties: false });
    case "holaboss_onboarding_complete":
      return Type.Object(
        {
          summary: Type.String({ description: "Summary of the onboarding outcome." }),
          requested_by: Type.Optional(Type.String({ description: "Actor requesting completion." })),
        },
        { additionalProperties: false }
      );
    case "holaboss_cronjobs_list":
      return Type.Object(
        {
          enabled_only: Type.Optional(Type.Boolean({ description: "Only return enabled cronjobs." })),
        },
        { additionalProperties: false }
      );
    case "holaboss_cronjobs_get":
    case "holaboss_cronjobs_delete":
      return Type.Object(
        {
          job_id: Type.String({ description: "Cronjob id." }),
        },
        { additionalProperties: false }
      );
    case "holaboss_cronjobs_create":
      return Type.Object(
        {
          cron: Type.String({ description: "Cron expression." }),
          description: Type.String({ description: "Short display description for the cronjob." }),
          instruction: Type.String({
            description:
              "The exact task to execute when the cronjob runs. Keep schedule wording out of this field."
          }),
          initiated_by: Type.Optional(Type.String({ description: "Actor creating the cronjob." })),
          name: Type.Optional(Type.String({ description: "Optional cronjob name." })),
          enabled: Type.Optional(Type.Boolean({ description: "Whether the cronjob is enabled." })),
          delivery_channel: Type.Optional(cronjobDeliveryChannelSchema()),
          delivery_mode: Type.Optional(cronjobDeliveryModeSchema()),
          delivery_to: Type.Optional(Type.String({ description: "Optional delivery target." })),
          metadata_json: Type.Optional(
            Type.String({
              description:
                "JSON object string for cronjob metadata. For `system_notification`, include a short `message`. For `session_run`, use metadata for execution context only; keep the actual task instruction in `instruction`."
            })
          ),
        },
        { additionalProperties: false }
      );
    case "holaboss_cronjobs_update":
      return Type.Object(
        {
          job_id: Type.String({ description: "Cronjob id." }),
          name: Type.Optional(Type.String({ description: "Optional cronjob name." })),
          cron: Type.Optional(Type.String({ description: "Cron expression." })),
          description: Type.Optional(Type.String({ description: "Short display description for the cronjob." })),
          instruction: Type.Optional(
            Type.String({
              description:
                "The exact task to execute when the cronjob runs. Keep schedule wording out of this field."
            })
          ),
          enabled: Type.Optional(Type.Boolean({ description: "Whether the cronjob is enabled." })),
          delivery_channel: Type.Optional(cronjobDeliveryChannelSchema()),
          delivery_mode: Type.Optional(cronjobDeliveryModeSchema()),
          delivery_to: Type.Optional(Type.String({ description: "Optional delivery target." })),
          metadata_json: Type.Optional(
            Type.String({
              description:
                "JSON object string for cronjob metadata. For `system_notification`, include a short `message`. For `session_run`, use metadata for execution context only; keep the actual task instruction in `instruction`."
            })
          ),
        },
        { additionalProperties: false }
      );
    case "image_generate":
      return Type.Object(
        {
          prompt: Type.String({ description: "Prompt describing the image to generate." }),
          filename: Type.Optional(
            Type.String({ description: "Optional output filename for the generated image." }),
          ),
          size: Type.Optional(
            Type.String({ description: "Optional provider-specific size hint such as `1024x1024`." }),
          ),
        },
        { additionalProperties: false },
      );
    case "download_url":
      return Type.Object(
        {
          url: Type.String({ description: "Direct http or https URL to download." }),
          output_path: Type.Optional(
            Type.String({
              description:
                "Optional workspace-relative destination path. If omitted, the runtime saves the file under Downloads/ with an inferred filename.",
            }),
          ),
          expected_mime_prefix: Type.Optional(
            Type.String({
              description:
                "Optional MIME prefix such as `image/` or `application/pdf` used to fail fast if the response type is not what you expect.",
            }),
          ),
          overwrite: Type.Optional(
            Type.Boolean({
              description:
                "Overwrite an existing file when output_path is provided. Ignored when output_path is omitted.",
            }),
          ),
        },
        { additionalProperties: false },
      );
    case "write_report":
      return Type.Object(
        {
          title: Type.Optional(
            Type.String({ description: "Optional report title shown in the artifact list." }),
          ),
          filename: Type.Optional(
            Type.String({ description: "Optional markdown filename stem for the saved report." }),
          ),
          summary: Type.Optional(
            Type.String({ description: "Optional short summary for artifact metadata and follow-up context." }),
          ),
          content: Type.String({
            description:
              "Full markdown report content to save as an artifact. Put the detailed research findings in this field instead of in chat.",
          }),
        },
        { additionalProperties: false },
      );
    case "terminal_sessions_list":
      return Type.Object({}, { additionalProperties: false });
    case "terminal_session_start":
      return Type.Object(
        {
          command: Type.String({
            description:
              "Shell command text to run in a background PTY session. This command is already executed through the workspace shell.",
          }),
          title: Type.Optional(Type.String({ description: "Optional display title for the terminal session." })),
          cwd: Type.Optional(
            Type.String({
              description: "Optional workspace-relative working directory. Defaults to the workspace root.",
            }),
          ),
          cols: Type.Optional(Type.Number({ description: "Optional terminal width in columns." })),
          rows: Type.Optional(Type.Number({ description: "Optional terminal height in rows." })),
        },
        { additionalProperties: false },
      );
    case "terminal_session_get":
    case "terminal_session_close":
      return Type.Object(
        {
          terminal_id: Type.String({ description: "Terminal session id." }),
        },
        { additionalProperties: false },
      );
    case "terminal_session_read":
    case "terminal_session_wait":
      return Type.Object(
        {
          terminal_id: Type.String({ description: "Terminal session id." }),
          after_sequence: Type.Optional(
            Type.Number({ description: "Only return events with sequence greater than this number." }),
          ),
          limit: Type.Optional(Type.Number({ description: "Maximum number of events to return." })),
          ...(toolId === "terminal_session_wait"
            ? {
                timeout_ms: Type.Optional(
                  Type.Number({
                    description:
                      "Maximum time to wait for new output or a status change before returning with timed_out=true.",
                  }),
                ),
              }
            : {}),
        },
        { additionalProperties: false },
      );
    case "terminal_session_send_input":
      return Type.Object(
        {
          terminal_id: Type.String({ description: "Terminal session id." }),
          data: Type.String({
            description:
              "Input to write to the terminal session. Include a trailing newline or carriage return when the command expects Enter.",
          }),
        },
        { additionalProperties: false },
      );
    case "terminal_session_signal":
      return Type.Object(
        {
          terminal_id: Type.String({ description: "Terminal session id." }),
          signal: Type.Optional(
            Type.String({ description: "Optional signal name such as SIGINT, SIGTERM, or SIGHUP." }),
          ),
        },
        { additionalProperties: false },
      );
  }
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
    ...(to !== undefined ? { to } : {})
  };
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
    ...(metadata ? { metadata } : {})
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
    ...(metadata ? { metadata } : {})
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

function runtimeToolPromptGuidelines(toolId: RuntimeAgentToolId): string[] {
  if (toolId === "download_url") {
    return [
      "Use `download_url` when you already have a direct asset URL and need the file saved into the workspace.",
      "Prefer `download_url` over browser-only downloads or ad hoc shell fetches for straightforward remote file saves.",
      "Omit `output_path` when the default workspace Downloads folder is fine; provide a workspace-relative path when the file must land in a specific location.",
      "Set `expected_mime_prefix` when the user asked for a specific file type such as an image or PDF, or when saving the wrong content would be risky.",
    ];
  }
  if (toolId === "write_report") {
    return [
      "Use `write_report` for research summaries, investigations, audits, plans, reviews, comparisons, timelines, and other long or evidence-heavy answers that should be saved as artifacts.",
      "Do not use `write_report` for a simple fact lookup, definition, brief clarification, current-page answer, or any other reply that is naturally short and self-contained.",
      "Prefer `write_report` when you are synthesizing multiple sources, summarizing current or latest developments, or producing findings the user may want to reference later.",
      "If the user explicitly asked for research, latest news, analysis, comparison, or a timeline and you gathered findings from multiple sources, call `write_report` before your final answer.",
      "A step like 'summarize findings for the user' still means: save the full findings with `write_report`, then keep the chat reply brief.",
      "After calling `write_report`, keep the chat reply short: mention the report title or path and give only the key takeaways.",
      "Write the full markdown report in `content` instead of pasting the full report inline in chat.",
    ];
  }
  if (
    toolId === "terminal_session_start" ||
    toolId === "terminal_session_read" ||
    toolId === "terminal_session_wait"
  ) {
    return [
      "Prefer `bash` for short one-shot commands that should complete within the current tool call.",
      "Prefer background terminal sessions for long-running commands, dev servers, watch processes, interactive prompts, or work you may need to revisit later in the run.",
      "After starting a terminal session, use `terminal_session_read` or `terminal_session_wait` to inspect output before claiming success.",
      "Use workspace-relative `cwd` values when you need a subdirectory; otherwise let the session start at the workspace root.",
      "When a background terminal is no longer needed, stop it with `terminal_session_signal` or `terminal_session_close` instead of leaving it running indefinitely.",
    ];
  }
  return [];
}

async function executeRuntimeTool(params: {
  toolId: RuntimeAgentToolId;
  toolParams: unknown;
  runtimeApiBaseUrl: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  inputId?: string | null;
  selectedModel?: string | null;
  fetchImpl?: typeof fetch;
  signal: AbortSignal | undefined;
}) {
  const signal = toolRequestSignal(params.signal, runtimeToolTimeoutMs(params.toolId));
  const fetchImpl = params.fetchImpl;
  let method: "GET" | "POST" | "PATCH" | "DELETE" = "GET";
  let requestPath = RUNTIME_TOOLS_CAPABILITY_STATUS_PATH;
  let body: Record<string, unknown> | undefined;

  switch (params.toolId) {
    case "holaboss_onboarding_status":
      requestPath = RUNTIME_TOOLS_ONBOARDING_STATUS_PATH;
      break;
    case "holaboss_onboarding_complete": {
      const toolParams = isRecord(params.toolParams) ? params.toolParams : {};
      method = "POST";
      requestPath = RUNTIME_TOOLS_ONBOARDING_COMPLETE_PATH;
      body = {
        summary: String(toolParams.summary ?? ""),
        ...(optionalString(toolParams.requested_by) ? { requested_by: optionalString(toolParams.requested_by) } : {})
      };
      break;
    }
    case "holaboss_cronjobs_list":
      requestPath = cronjobsListPath(params.toolParams);
      break;
    case "holaboss_cronjobs_create":
      method = "POST";
      requestPath = RUNTIME_TOOLS_CRONJOBS_PATH;
      body = createCronjobBody(params.toolParams);
      break;
    case "holaboss_cronjobs_get":
      requestPath = cronjobPath(isRecord(params.toolParams) ? params.toolParams.job_id : undefined);
      break;
    case "holaboss_cronjobs_update":
      method = "PATCH";
      requestPath = cronjobPath(isRecord(params.toolParams) ? params.toolParams.job_id : undefined);
      body = updateCronjobBody(params.toolParams);
      break;
    case "holaboss_cronjobs_delete":
      method = "DELETE";
      requestPath = cronjobPath(isRecord(params.toolParams) ? params.toolParams.job_id : undefined);
      break;
    case "image_generate":
      method = "POST";
      requestPath = RUNTIME_TOOLS_IMAGE_GENERATE_PATH;
      body = createImageGenerationBody(params.toolParams);
      break;
    case "download_url":
      method = "POST";
      requestPath = RUNTIME_TOOLS_DOWNLOADS_PATH;
      body = createDownloadUrlBody(params.toolParams);
      break;
    case "write_report":
      method = "POST";
      requestPath = RUNTIME_TOOLS_REPORTS_PATH;
      body = createWriteReportBody(params.toolParams);
      break;
    case "terminal_sessions_list":
      requestPath = RUNTIME_TOOLS_TERMINAL_SESSIONS_PATH;
      break;
    case "terminal_session_start":
      method = "POST";
      requestPath = RUNTIME_TOOLS_TERMINAL_SESSIONS_PATH;
      body = createTerminalSessionBody(params.toolParams);
      break;
    case "terminal_session_get":
      requestPath = terminalSessionPath(isRecord(params.toolParams) ? params.toolParams.terminal_id : undefined);
      break;
    case "terminal_session_read":
      method = "POST";
      requestPath = `${terminalSessionPath(isRecord(params.toolParams) ? params.toolParams.terminal_id : undefined)}/read`;
      body = readTerminalSessionBody(params.toolParams);
      break;
    case "terminal_session_wait":
      method = "POST";
      requestPath = `${terminalSessionPath(isRecord(params.toolParams) ? params.toolParams.terminal_id : undefined)}/wait`;
      body = waitTerminalSessionBody(params.toolParams);
      break;
    case "terminal_session_send_input":
      method = "POST";
      requestPath = `${terminalSessionPath(isRecord(params.toolParams) ? params.toolParams.terminal_id : undefined)}/input`;
      body = sendTerminalSessionInputBody(params.toolParams);
      break;
    case "terminal_session_signal":
      method = "POST";
      requestPath = `${terminalSessionPath(isRecord(params.toolParams) ? params.toolParams.terminal_id : undefined)}/signal`;
      body = signalTerminalSessionBody(params.toolParams);
      break;
    case "terminal_session_close":
      method = "POST";
      requestPath = `${terminalSessionPath(isRecord(params.toolParams) ? params.toolParams.terminal_id : undefined)}/close`;
      body = {};
      break;
  }

  const response = fetchImpl
    ? await (async () => {
        const raw = await fetchImpl(`${params.runtimeApiBaseUrl}${requestPath}`, {
            method,
            headers: {
              "content-type": "application/json; charset=utf-8",
              ...runtimeToolHeaders({
                workspaceId: params.workspaceId,
                sessionId: params.sessionId,
                inputId: params.inputId,
                selectedModel: params.selectedModel,
              }),
            },
            ...(body && method !== "GET" && method !== "DELETE" ? { body: JSON.stringify(body) } : {}),
          signal,
        });
        return {
          ok: raw.ok,
          status: raw.status,
          payload: await readJsonResponse(raw),
        };
      })()
    : await nodeRequestJson({
        url: `${params.runtimeApiBaseUrl}${requestPath}`,
        method,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...runtimeToolHeaders({
            workspaceId: params.workspaceId,
            sessionId: params.sessionId,
            inputId: params.inputId,
            selectedModel: params.selectedModel,
          }),
        },
        ...(body && method !== "GET" && method !== "DELETE" ? { body: JSON.stringify(body) } : {}),
        signal,
      });

  if (!response.ok) {
    const message = isRecord(response.payload)
      ? String(response.payload.detail ?? response.payload.error ?? `Holaboss runtime tool '${params.toolId}' failed.`)
      : `Holaboss runtime tool '${params.toolId}' failed.`;
    throw new Error(message);
  }
  return {
    content: [{ type: "text" as const, text: formatRuntimeToolResult(response.payload) }],
    details: {
      tool_id: params.toolId,
    },
  };
}

export function createPiRuntimeToolDefinition(
  toolId: RuntimeAgentToolId,
  description: string,
  options: PiRuntimeToolOptions
): ToolDefinition {
  const fetchImpl = options.fetchImpl;

  return {
    name: toolId,
    label: runtimeToolLabel(toolId),
    description,
    promptSnippet: `${toolId}: ${description}`,
    promptGuidelines: runtimeToolPromptGuidelines(toolId),
    parameters: runtimeToolParameters(toolId),
    execute: async (_toolCallId, toolParams, signal) =>
      await executeRuntimeTool({
        toolId,
        toolParams,
        runtimeApiBaseUrl: options.runtimeApiBaseUrl,
        workspaceId: options.workspaceId,
        sessionId: options.sessionId,
        inputId: options.inputId,
        selectedModel: options.selectedModel,
        fetchImpl,
        signal,
      }),
  };
}

export async function resolvePiRuntimeToolDefinitions(
  options: {
    runtimeApiBaseUrl?: string | null;
    workspaceId?: string | null;
    sessionId?: string | null;
    inputId?: string | null;
    selectedModel?: string | null;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<ToolDefinition[]> {
  const runtimeApiBaseUrl = normalizeRuntimeApiBaseUrl(options.runtimeApiBaseUrl ?? process.env.SANDBOX_RUNTIME_API_URL);
  if (!runtimeApiBaseUrl) {
    return [];
  }

  const fetchImpl = options.fetchImpl;
  try {
    const response = fetchImpl
      ? await (async () => {
          const raw = await fetchImpl(`${runtimeApiBaseUrl}${RUNTIME_TOOLS_CAPABILITY_STATUS_PATH}`, {
            method: "GET",
            headers: runtimeToolHeaders({
              workspaceId: options.workspaceId,
              sessionId: options.sessionId,
              inputId: options.inputId,
              selectedModel: options.selectedModel,
            }),
            signal: AbortSignal.timeout(2000),
          });
          return {
            ok: raw.ok,
            status: raw.status,
            payload: await readJsonResponse(raw),
          };
        })()
      : await nodeRequestJson({
          url: `${runtimeApiBaseUrl}${RUNTIME_TOOLS_CAPABILITY_STATUS_PATH}`,
          method: "GET",
          headers: runtimeToolHeaders({
            workspaceId: options.workspaceId,
            sessionId: options.sessionId,
            inputId: options.inputId,
            selectedModel: options.selectedModel,
          }),
          signal: AbortSignal.timeout(2000),
        });
    if (!response.ok || !isRecord(response.payload) || response.payload.available !== true) {
      return [];
    }
  } catch {
    return [];
  }

  return RUNTIME_AGENT_TOOL_DEFINITIONS.map((tool) =>
    createPiRuntimeToolDefinition(tool.id, tool.description, {
      runtimeApiBaseUrl,
      workspaceId: options.workspaceId,
      sessionId: options.sessionId,
      inputId: options.inputId,
      selectedModel: options.selectedModel,
      fetchImpl,
    })
  );
}

export { RUNTIME_AGENT_TOOL_IDS };
