import http from "node:http";
import https from "node:https";

import { Type } from "@sinclair/typebox";
import type { ExtensionFactory, ToolDefinition } from "@mariozechner/pi-coding-agent";

import {
  DESKTOP_BROWSER_TOOL_DEFINITIONS,
  type DesktopBrowserToolDefinition,
  type DesktopBrowserToolId,
} from "../../harnesses/src/desktop-browser-tools.js";

const BROWSER_CAPABILITY_STATUS_PATH = "/api/v1/capabilities/browser";
const BROWSER_CAPABILITY_TOOL_PATH = "/api/v1/capabilities/browser/tools";
const DEFAULT_BROWSER_TOOL_TIMEOUT_MS = 30000;

export interface PiDesktopBrowserExtensionOptions {
  runtimeApiBaseUrl: string;
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRuntimeApiBaseUrl(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

function browserCapabilityStatusUrl(runtimeApiBaseUrl: string): string {
  return `${runtimeApiBaseUrl}${BROWSER_CAPABILITY_STATUS_PATH}`;
}

function browserCapabilityToolUrl(runtimeApiBaseUrl: string, toolId: DesktopBrowserToolId): string {
  return `${runtimeApiBaseUrl}${BROWSER_CAPABILITY_TOOL_PATH}/${toolId}`;
}

function toolRequestSignal(signal: AbortSignal | undefined, timeoutMs = DEFAULT_BROWSER_TOOL_TIMEOUT_MS): AbortSignal {
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
  method: "GET" | "POST";
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

function formatBrowserToolResult(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  return JSON.stringify(payload, null, 2);
}

function browserToolLabel(toolId: DesktopBrowserToolId): string {
  return toolId
    .split("_")
    .map((part) => (part === "browser" ? "Browser" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function browserToolParameters(toolId: DesktopBrowserToolId) {
  switch (toolId) {
    case "browser_navigate":
      return Type.Object(
        {
          url: Type.String({ description: "The URL to open in the in-app browser.", minLength: 1 }),
        },
        { additionalProperties: false }
      );
    case "browser_get_state":
      return Type.Object(
        {
          include_screenshot: Type.Optional(Type.Boolean({ description: "Include a page screenshot in the response." })),
        },
        { additionalProperties: false }
      );
    case "browser_click":
      return Type.Object(
        {
          index: Type.Integer({ description: "Interactive element index from browser_get_state.", minimum: 1 }),
        },
        { additionalProperties: false }
      );
    case "browser_type":
      return Type.Object(
        {
          index: Type.Integer({ description: "Interactive element index from browser_get_state.", minimum: 1 }),
          text: Type.String({ description: "Text to enter into the target element." }),
          clear: Type.Optional(Type.Boolean({ description: "Clear the target element before typing." })),
          submit: Type.Optional(Type.Boolean({ description: "Submit after typing, typically by pressing Enter." })),
        },
        { additionalProperties: false }
      );
    case "browser_press":
      return Type.Object(
        {
          key: Type.String({ description: "Keyboard key to press.", minLength: 1 }),
        },
        { additionalProperties: false }
      );
    case "browser_scroll":
      return Type.Object(
        {
          direction: Type.Optional(
            Type.Union([Type.Literal("up"), Type.Literal("down")], {
              description: "Scroll direction when delta_y is not provided.",
            })
          ),
          amount: Type.Optional(Type.Integer({ description: "Positive scroll amount.", minimum: 1 })),
          delta_y: Type.Optional(Type.Integer({ description: "Raw vertical scroll delta." })),
        },
        { additionalProperties: false }
      );
    case "browser_screenshot":
      return Type.Object(
        {
          format: Type.Optional(
            Type.Union([Type.Literal("png"), Type.Literal("jpeg")], {
              description: "Screenshot image format.",
            })
          ),
          quality: Type.Optional(Type.Integer({ description: "JPEG quality from 0-100.", minimum: 0, maximum: 100 })),
        },
        { additionalProperties: false }
      );
    case "browser_back":
    case "browser_forward":
    case "browser_reload":
    case "browser_list_tabs":
      return Type.Object({}, { additionalProperties: false });
  }
}

async function executeBrowserTool(params: {
  toolId: DesktopBrowserToolId;
  toolParams: unknown;
  runtimeApiBaseUrl: string;
  fetchImpl?: typeof fetch;
  signal: AbortSignal | undefined;
}) {
  const body = JSON.stringify(isRecord(params.toolParams) ? params.toolParams : {});
  const signal = toolRequestSignal(params.signal);
  const fetchImpl = params.fetchImpl;
  const response = fetchImpl
    ? await (async () => {
        const raw = await fetchImpl(browserCapabilityToolUrl(params.runtimeApiBaseUrl, params.toolId), {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          body,
          signal,
        });
        return {
          ok: raw.ok,
          status: raw.status,
          payload: await readJsonResponse(raw),
        };
      })()
    : await nodeRequestJson({
        url: browserCapabilityToolUrl(params.runtimeApiBaseUrl, params.toolId),
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body,
        signal,
      });
  if (!response.ok) {
    const message = isRecord(response.payload)
      ? String(response.payload.detail ?? response.payload.error ?? `Holaboss browser tool '${params.toolId}' failed.`)
      : `Holaboss browser tool '${params.toolId}' failed.`;
    throw new Error(message);
  }
  return {
    content: [{ type: "text" as const, text: formatBrowserToolResult(response.payload) }],
    details: {
      tool_id: params.toolId,
    },
  };
}

export function createPiDesktopBrowserToolDefinition(
  definition: DesktopBrowserToolDefinition,
  options: PiDesktopBrowserExtensionOptions
): ToolDefinition {
  const fetchImpl = options.fetchImpl;

  return {
    name: definition.id,
    label: browserToolLabel(definition.id),
    description: definition.description,
    promptSnippet: `${definition.id}: ${definition.description}`,
    parameters: browserToolParameters(definition.id),
    execute: async (_toolCallId, toolParams, signal) =>
      await executeBrowserTool({
        toolId: definition.id,
        toolParams,
        runtimeApiBaseUrl: options.runtimeApiBaseUrl,
        fetchImpl,
        signal,
      }),
  };
}

export function createPiDesktopBrowserExtensionFactory(
  options: PiDesktopBrowserExtensionOptions
): ExtensionFactory {
  return (pi) => {
    for (const definition of DESKTOP_BROWSER_TOOL_DEFINITIONS) {
      pi.registerTool(createPiDesktopBrowserToolDefinition(definition, options));
    }
  };
}

export async function resolvePiDesktopBrowserExtensionFactory(
  options: {
    runtimeApiBaseUrl?: string | null;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<ExtensionFactory | null> {
  const runtimeApiBaseUrl = normalizeRuntimeApiBaseUrl(options.runtimeApiBaseUrl ?? process.env.SANDBOX_RUNTIME_API_URL);
  if (!runtimeApiBaseUrl) {
    return null;
  }

  const fetchImpl = options.fetchImpl;
  try {
    const response = fetchImpl
      ? await (async () => {
          const raw = await fetchImpl(browserCapabilityStatusUrl(runtimeApiBaseUrl), {
            method: "GET",
            signal: AbortSignal.timeout(2000),
          });
          return {
            ok: raw.ok,
            status: raw.status,
            payload: await readJsonResponse(raw),
          };
        })()
      : await nodeRequestJson({
          url: browserCapabilityStatusUrl(runtimeApiBaseUrl),
          method: "GET",
          signal: AbortSignal.timeout(2000),
        });
    if (!response.ok || !isRecord(response.payload) || response.payload.available !== true) {
      return null;
    }
  } catch {
    return null;
  }

  return createPiDesktopBrowserExtensionFactory({
    runtimeApiBaseUrl,
    fetchImpl,
  });
}
