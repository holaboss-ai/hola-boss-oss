import type { DesktopBrowserToolId } from "./desktop-browser-tools.js";
import {
  formatCapabilityToolResultForModel,
  isRecord,
  normalizeRuntimeApiBaseUrl,
  requestCapabilityJson,
  toolRequestSignal,
} from "./capability-http.js";

const BROWSER_CAPABILITY_STATUS_PATH = "/api/v1/capabilities/browser";
const BROWSER_CAPABILITY_TOOL_PATH = "/api/v1/capabilities/browser/tools";
const DEFAULT_BROWSER_TOOL_TIMEOUT_MS = 30000;

export interface BrowserCapabilityClientOptions {
  runtimeApiBaseUrl: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  space?: "agent" | "user" | null;
  fetchImpl?: typeof fetch;
}

function capabilityStatusUrl(runtimeApiBaseUrl: string): string {
  return `${runtimeApiBaseUrl}${BROWSER_CAPABILITY_STATUS_PATH}`;
}

function capabilityToolUrl(runtimeApiBaseUrl: string, toolId: DesktopBrowserToolId): string {
  return `${runtimeApiBaseUrl}${BROWSER_CAPABILITY_TOOL_PATH}/${toolId}`;
}

export function browserCapabilityHeaders(
  workspaceId?: string | null,
  sessionId?: string | null,
  space?: "agent" | "user" | null,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const normalizedWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
  if (normalizedWorkspaceId) {
    headers["x-holaboss-workspace-id"] = normalizedWorkspaceId;
  }
  const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (normalizedSessionId) {
    headers["x-holaboss-session-id"] = normalizedSessionId;
  }
  if (space === "agent" || space === "user") {
    headers["x-holaboss-browser-space"] = space;
  }
  return headers;
}

export function resolveBrowserCapabilityBaseUrl(value: unknown): string {
  return normalizeRuntimeApiBaseUrl(value);
}

export async function browserCapabilityAvailable(
  options: BrowserCapabilityClientOptions,
): Promise<boolean> {
  try {
    const response = await requestCapabilityJson({
      url: capabilityStatusUrl(options.runtimeApiBaseUrl),
      method: "GET",
      headers: browserCapabilityHeaders(options.workspaceId, options.sessionId, options.space),
      signal: AbortSignal.timeout(2000),
      fetchImpl: options.fetchImpl,
    });
    return response.ok && isRecord(response.payload) && response.payload.available === true;
  } catch {
    return false;
  }
}

export async function executeBrowserCapabilityTool(params: BrowserCapabilityClientOptions & {
  toolId: DesktopBrowserToolId;
  toolParams: unknown;
  signal?: AbortSignal;
}): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: {
    tool_id: DesktopBrowserToolId;
    raw?: unknown;
    raw_result_bytes?: number;
    model_result_bytes?: number;
  };
}> {
  const response = await requestCapabilityJson({
    url: capabilityToolUrl(params.runtimeApiBaseUrl, params.toolId),
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...browserCapabilityHeaders(params.workspaceId, params.sessionId, params.space),
    },
    body: JSON.stringify(isRecord(params.toolParams) ? params.toolParams : {}),
    signal: toolRequestSignal(params.signal, DEFAULT_BROWSER_TOOL_TIMEOUT_MS),
    fetchImpl: params.fetchImpl,
  });
  if (!response.ok) {
    const message = isRecord(response.payload)
      ? String(response.payload.detail ?? response.payload.error ?? `Holaboss browser tool '${params.toolId}' failed.`)
      : `Holaboss browser tool '${params.toolId}' failed.`;
    throw new Error(message);
  }
  const formatted = formatCapabilityToolResultForModel(response.payload);
  return {
    content: [{ type: "text", text: formatted.text }],
    details: {
      tool_id: params.toolId,
      ...(formatted.compacted
        ? {
            raw: response.payload,
            raw_result_bytes: formatted.serializedBytes,
            model_result_bytes: formatted.modelTextBytes,
          }
        : {}),
    },
  };
}
