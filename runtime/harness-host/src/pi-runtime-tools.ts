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
const DEFAULT_RUNTIME_TOOL_TIMEOUT_MS = 30000;

export interface PiRuntimeToolOptions {
  runtimeApiBaseUrl: string;
  workspaceId?: string | null;
  sessionId?: string | null;
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
          delivery_channel: Type.Optional(
            Type.String({
              description:
                "Delivery channel. Use `session_run` for recurring agent work such as running instructions, tasks, analysis, browsing, or writing. Use `system_notification` only for lightweight reminder/notification messages."
            })
          ),
          delivery_mode: Type.Optional(Type.String({ description: "Delivery mode." })),
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
          delivery_channel: Type.Optional(
            Type.String({
              description:
                "Delivery channel. Use `session_run` for recurring agent work such as running instructions, tasks, analysis, browsing, or writing. Use `system_notification` only for lightweight reminder/notification messages."
            })
          ),
          delivery_mode: Type.Optional(Type.String({ description: "Delivery mode." })),
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

async function executeRuntimeTool(params: {
  toolId: RuntimeAgentToolId;
  toolParams: unknown;
  runtimeApiBaseUrl: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  selectedModel?: string | null;
  fetchImpl?: typeof fetch;
  signal: AbortSignal | undefined;
}) {
  const signal = toolRequestSignal(params.signal);
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
    parameters: runtimeToolParameters(toolId),
    execute: async (_toolCallId, toolParams, signal) =>
      await executeRuntimeTool({
        toolId,
        toolParams,
        runtimeApiBaseUrl: options.runtimeApiBaseUrl,
        workspaceId: options.workspaceId,
        sessionId: options.sessionId,
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
      selectedModel: options.selectedModel,
      fetchImpl,
    })
  );
}

export { RUNTIME_AGENT_TOOL_IDS };
