import http from "node:http";
import https from "node:https";

import {
  consumeToolReplayBudget,
  type ToolReplayBudgetDecision,
  type ToolReplayBudgetLedgerLimits,
} from "./tool-replay-budget-ledger.js";

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

function summarizeCapabilityResult(value: unknown, maxChars = 240): string {
  const raw =
    typeof value === "string"
      ? value
      : isRecord(value)
        ? [
            value.summary,
            value.message,
            value.title,
            isRecord(value.state) ? value.state.title : null,
            value.status,
          ]
            .find((candidate) => typeof candidate === "string" && candidate.trim())
            ?.toString() ?? JSON.stringify(value)
        : JSON.stringify(value);
  const text = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
  if (!text) {
    return "";
  }
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function collectCapabilitySpilloverPaths(
  value: unknown,
  paths = new Set<string>(),
  depth = 0,
): string[] {
  if (depth > 4 || value == null) {
    return [...paths];
  }
  if (typeof value === "string") {
    return [...paths];
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectCapabilitySpilloverPaths(entry, paths, depth + 1);
    }
    return [...paths];
  }
  if (!isRecord(value)) {
    return [...paths];
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" &&
      entry.trim() &&
      (key.endsWith("_path") || key === "file_path")
    ) {
      paths.add(entry.trim());
      continue;
    }
    if (
      Array.isArray(entry) &&
      (key.endsWith("_paths") || key === "spillover_paths")
    ) {
      for (const item of entry) {
        if (typeof item === "string" && item.trim()) {
          paths.add(item.trim());
        }
      }
      continue;
    }
    collectCapabilitySpilloverPaths(entry, paths, depth + 1);
  }
  return [...paths];
}

function referenceOnlyCapabilityToolResult(params: {
  payload: unknown;
  toolId: string;
  decision: ToolReplayBudgetDecision;
}): string {
  const spilloverPaths = collectCapabilitySpilloverPaths(params.payload);
  return JSON.stringify(
    {
      tool_id: params.toolId,
      note: "Inline replay omitted because the per-turn replay budget was exhausted.",
      summary: summarizeCapabilityResult(params.payload),
      ...(spilloverPaths.length > 0 ? { spillover_paths: spilloverPaths } : {}),
      _replay_budget: {
        mode: params.decision.mode,
        trimmed: params.decision.trimmed,
        trim_reason: params.decision.trimReason,
        replay_chars: params.decision.replayChars,
        total_replay_chars: params.decision.totalReplayChars,
        max_replay_chars: params.decision.maxReplayChars,
        total_replay_items: params.decision.totalReplayItems,
        max_replay_items: params.decision.maxReplayItems,
      },
    },
    null,
    2,
  );
}

export function capabilityReplayBudgetKey(params: {
  workspaceId?: string | null;
  sessionId?: string | null;
  inputId?: string | null;
}): string | null {
  const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId.trim() : "";
  const sessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : "";
  const inputId = typeof params.inputId === "string" ? params.inputId.trim() : "";
  if (!inputId) {
    return null;
  }
  return [
    workspaceId || "-",
    sessionId || "-",
    inputId,
  ].join(":");
}

export function formatCapabilityToolResult(params: {
  payload: unknown;
  toolId: string;
  replayBudgetKey?: string | null;
  replayBudgetLimits?: ToolReplayBudgetLedgerLimits;
}): { text: string; replayBudgetDecision: ToolReplayBudgetDecision | null } {
  const serialized =
    typeof params.payload === "string"
      ? params.payload
      : JSON.stringify(params.payload, null, 2);
  const replayBudgetKey =
    typeof params.replayBudgetKey === "string" ? params.replayBudgetKey.trim() : "";
  if (replayBudgetKey) {
    const replayBudgetDecision = consumeToolReplayBudget({
      ledgerKey: replayBudgetKey,
      replayChars: serialized.length,
      limits: params.replayBudgetLimits,
    });
    if (replayBudgetDecision.trimmed) {
      return {
        text: referenceOnlyCapabilityToolResult({
          payload: params.payload,
          toolId: params.toolId,
          decision: replayBudgetDecision,
        }),
        replayBudgetDecision,
      };
    }
    if (serialized.length <= MAX_FORMATTED_CAPABILITY_RESULT_CHARS) {
      return {
        text: serialized,
        replayBudgetDecision,
      };
    }
    const clipped = serialized
      .slice(0, MAX_FORMATTED_CAPABILITY_RESULT_CHARS)
      .trimEnd();
    return {
      text: `${clipped}\n\n[output truncated for safety]`,
      replayBudgetDecision,
    };
  }
  if (serialized.length <= MAX_FORMATTED_CAPABILITY_RESULT_CHARS) {
    return { text: serialized, replayBudgetDecision: null };
  }
  const clipped = serialized
    .slice(0, MAX_FORMATTED_CAPABILITY_RESULT_CHARS)
    .trimEnd();
  return {
    text: `${clipped}\n\n[output truncated for safety]`,
    replayBudgetDecision: null,
  };
}
