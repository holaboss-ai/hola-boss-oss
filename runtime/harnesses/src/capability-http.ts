import http from "node:http";
import https from "node:https";

export type CapabilityHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export const TOOL_RESULT_MODE_HEADER = "x-holaboss-tool-result-mode";
export const TOOL_RESULT_MODE_PREVIEW = "preview";
const MAX_FORMATTED_CAPABILITY_RESULT_CHARS = 20_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeRuntimeApiBaseUrl(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

export function toolRequestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

function parseJsonText(text: string): unknown {
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  return parseJsonText(text);
}

export async function nodeRequestJson(params: {
  url: string;
  method: CapabilityHttpMethod;
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
      },
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
          { once: true },
        );
      }
    }

    if (params.body) {
      request.write(params.body);
    }
    request.end();
  });
}

export async function requestCapabilityJson(params: {
  url: string;
  method: CapabilityHttpMethod;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; status: number; payload: unknown }> {
  if (!params.fetchImpl) {
    return await nodeRequestJson(params);
  }
  const raw = await params.fetchImpl(params.url, {
    method: params.method,
    headers: params.headers,
    ...(params.body ? { body: params.body } : {}),
    signal: params.signal,
  });
  return {
    ok: raw.ok,
    status: raw.status,
    payload: await readJsonResponse(raw),
  };
}

export function withPreviewResultModeHeader(
  headers: Record<string, string>,
): Record<string, string> {
  return {
    ...headers,
    [TOOL_RESULT_MODE_HEADER]: TOOL_RESULT_MODE_PREVIEW,
  };
}

export function formatCapabilityToolResult(payload: unknown): string {
  const serialized =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  if (serialized.length <= MAX_FORMATTED_CAPABILITY_RESULT_CHARS) {
    return serialized;
  }
  const clipped = serialized
    .slice(0, MAX_FORMATTED_CAPABILITY_RESULT_CHARS)
    .trimEnd();
  return `${clipped}\n\n[output truncated for safety]`;
}
