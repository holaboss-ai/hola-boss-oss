import { createHash } from "node:crypto";

export interface MemoryModelClientConfig {
  baseUrl: string;
  apiKey: string;
  defaultHeaders?: Record<string, string> | null;
  modelId: string;
  apiStyle?: "openai_compatible" | "anthropic_native" | "google_native" | "openrouter_image" | null;
}

export interface MemoryModelJsonQuery {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function looksLikeOpenAiCompatBaseUrl(baseUrl: string): boolean {
  const normalized = baseUrl.trim().toLowerCase().replace(/\/+$/, "");
  return normalized.endsWith("/openai/v1") || normalized.endsWith("/google/v1");
}

function looksLikeAnthropicBaseUrl(baseUrl: string): boolean {
  const normalized = baseUrl.trim().toLowerCase().replace(/\/+$/, "");
  if (!normalized) {
    return false;
  }
  if (normalized.endsWith("/anthropic/v1")) {
    return true;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.hostname.toLowerCase() === "api.anthropic.com";
  } catch {
    return false;
  }
}

function hasExplicitAuthHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => {
    const normalized = key.trim().toLowerCase();
    return normalized === "authorization" || normalized === "x-api-key";
  });
}

function parseJsonObjectCandidate(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // fall through
  }

  // Common fallback: model wraps JSON in fenced markdown.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (!fenced || typeof fenced[1] !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(fenced[1]);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function completionContent(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices.length > 0 && isRecord(choices[0]) ? choices[0] : null;
  const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null;
  if (!message) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  const content = Array.isArray(message.content) ? message.content : [];
  const firstTextPart = content.find((part) => isRecord(part) && typeof part.text === "string") as
    | { text: string }
    | undefined;
  return firstTextPart?.text ?? "";
}

function anthropicCompletionContent(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  const content = Array.isArray(payload.content) ? payload.content : [];
  const textParts = content
    .filter((part) => isRecord(part) && typeof part.text === "string")
    .map((part) => String((part as { text: string }).text));
  return textParts.join("\n").trim();
}

export function normalizeOpenAiModelId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex < 0) {
    return trimmed;
  }
  return trimmed.slice(slashIndex + 1).trim() || trimmed;
}

function anthropicMessagesEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  const lower = normalized.toLowerCase();
  if (lower.endsWith("/anthropic/v1") || lower.endsWith("/v1")) {
    return `${normalized}/messages`;
  }
  return `${normalized}/v1/messages`;
}

export function modelCallFingerprint(params: {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        model_id: params.modelId,
        system_prompt: params.systemPrompt,
        user_prompt: params.userPrompt,
      })
    )
    .digest("hex");
}

export async function queryMemoryModelJson(
  config: MemoryModelClientConfig,
  query: MemoryModelJsonQuery
): Promise<Record<string, unknown> | null> {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
  const modelId = normalizeOpenAiModelId(config.modelId);
  const apiStyle =
    config.apiStyle === "anthropic_native"
      ? "anthropic_native"
      : config.apiStyle === "openai_compatible"
        ? "openai_compatible"
        : looksLikeOpenAiCompatBaseUrl(baseUrl)
          ? "openai_compatible"
          : looksLikeAnthropicBaseUrl(baseUrl)
            ? "anthropic_native"
            : null;
  if (!baseUrl || !modelId || !apiStyle) {
    return null;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.defaultHeaders ?? {}),
  };

  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Math.min(query.timeoutMs ?? 7000, 20000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let endpoint = "";
    let body: Record<string, unknown> = {};
    if (apiStyle === "anthropic_native") {
      endpoint = anthropicMessagesEndpoint(baseUrl);
      if (!hasExplicitAuthHeader(headers) && config.apiKey.trim()) {
        headers["x-api-key"] = config.apiKey.trim();
      }
      if (!Object.keys(headers).some((key) => key.trim().toLowerCase() === "anthropic-version")) {
        headers["anthropic-version"] = "2023-06-01";
      }
      body = {
        model: modelId,
        temperature: 0,
        max_tokens: 1024,
        system: query.systemPrompt,
        messages: [
          {
            role: "user",
            content: query.userPrompt,
          },
        ],
      };
    } else {
      endpoint = `${baseUrl}/chat/completions`;
      if (!hasExplicitAuthHeader(headers) && config.apiKey.trim()) {
        headers.Authorization = `Bearer ${config.apiKey.trim()}`;
      }
      body = {
        model: modelId,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: query.systemPrompt,
          },
          {
            role: "user",
            content: query.userPrompt,
          },
        ],
      };
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json().catch(() => null);
    const text = apiStyle === "anthropic_native" ? anthropicCompletionContent(payload) : completionContent(payload);
    return parseJsonObjectCandidate(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const item of value) {
    const normalized = firstNonEmptyString(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}
