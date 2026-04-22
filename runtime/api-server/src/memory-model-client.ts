import { createHash } from "node:crypto";

import * as Sentry from "@sentry/node";

import {
  anthropicUsageMetrics,
  applyGenAiUsageMetrics,
  genAiSpanAttributes,
  openAiCompatibleUsageMetrics,
} from "./runtime-ai-monitoring.js";
import {
  captureRuntimeException,
  redactRuntimeSentryText,
  redactRuntimeSentryValue,
  type RuntimeSentryCaptureOptions,
} from "./runtime-sentry.js";

const MEMORY_MODEL_EMBEDDING_INPUT_PREVIEW_CHARS = 8_192;
const MEMORY_MODEL_EMBEDDING_RESPONSE_PREVIEW_CHARS = 4_096;
const MEMORY_MODEL_SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "x-api-key",
]);

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

export interface MemoryModelEmbeddingQuery {
  input: string;
  timeoutMs?: number;
}

interface QueryMemoryModelEmbeddingOptions {
  captureException?: (options: RuntimeSentryCaptureOptions) => void;
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

function parseJsonValueCandidate(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
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

function textFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function headerValue(
  headers: Record<string, string>,
  headerName: string,
): string {
  const normalizedHeaderName = headerName.trim().toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.trim().toLowerCase() === normalizedHeaderName) {
      return value.trim();
    }
  }
  return "";
}

function sentrySafeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => {
        if (!value.trim()) {
          return false;
        }
        return !MEMORY_MODEL_SENSITIVE_HEADER_NAMES.has(
          key.trim().toLowerCase(),
        );
      })
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
  );
}

function sentryTextPreview(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxChars)}\n...[truncated]`,
    truncated: true,
  };
}

function responseTextForSentry(text: string): string {
  const parsed = parseJsonValueCandidate(text);
  if (parsed !== null) {
    return `${JSON.stringify(redactRuntimeSentryValue(parsed), null, 2)}\n`;
  }
  return redactRuntimeSentryText(text);
}

function spanIdentityAttributes(
  headers: Record<string, string>,
  params: {
    operationName: string;
    model: string;
    promptSystemChars?: number | null;
    promptUserChars?: number | null;
  },
) {
  return genAiSpanAttributes({
    operationName: params.operationName,
    model: params.model,
    workspaceId: headerValue(headers, "x-holaboss-workspace-id") || null,
    sessionId: headerValue(headers, "x-holaboss-session-id") || null,
    inputId: headerValue(headers, "x-holaboss-input-id") || null,
    userId: headerValue(headers, "x-holaboss-user-id") || null,
    sandboxId: headerValue(headers, "x-holaboss-sandbox-id") || null,
    promptSystemChars: params.promptSystemChars ?? null,
    promptUserChars: params.promptUserChars ?? null,
  });
}

function captureEmbeddingFailure(params: {
  captureException?: (options: RuntimeSentryCaptureOptions) => void;
  error: unknown;
  failureKind:
    | "request_exception"
    | "upstream_non_ok"
    | "invalid_json"
    | "invalid_payload";
  endpoint: string;
  headers: Record<string, string>;
  requestBody: {
    model: string;
    input: string;
    encoding_format: "float";
  };
  responseStatus?: number;
  responseContentType?: string;
  responseText?: string;
}): void {
  const inputPreview = sentryTextPreview(
    redactRuntimeSentryText(params.requestBody.input),
    MEMORY_MODEL_EMBEDDING_INPUT_PREVIEW_CHARS,
  );
  const safeHeaders = sentrySafeHeaders(params.headers);
  const normalizedResponseText = params.responseText ?? "";
  const formattedResponseText = normalizedResponseText
    ? responseTextForSentry(normalizedResponseText)
    : "";
  const responsePreview = formattedResponseText
    ? sentryTextPreview(
        formattedResponseText,
        MEMORY_MODEL_EMBEDDING_RESPONSE_PREVIEW_CHARS,
      )
    : null;
  const requestContext = {
    endpoint: params.endpoint,
    model: params.requestBody.model,
    encoding_format: params.requestBody.encoding_format,
    workspace_id:
      headerValue(params.headers, "x-holaboss-workspace-id") || null,
    session_id: headerValue(params.headers, "x-holaboss-session-id") || null,
    input_id: headerValue(params.headers, "x-holaboss-input-id") || null,
    sandbox_id: headerValue(params.headers, "x-holaboss-sandbox-id") || null,
    user_id: headerValue(params.headers, "x-holaboss-user-id") || null,
    input_length: params.requestBody.input.length,
    input_sha256: textFingerprint(params.requestBody.input),
    input_truncated: inputPreview.truncated,
  };
  const attachments: RuntimeSentryCaptureOptions["attachments"] = [
    {
      filename: "embedding-request.json",
      data: `${JSON.stringify(
        {
          endpoint: params.endpoint,
          headers: safeHeaders,
          body: {
            model: params.requestBody.model,
            input_preview: inputPreview.text,
            input_length: params.requestBody.input.length,
            input_sha256: textFingerprint(params.requestBody.input),
            input_truncated: inputPreview.truncated,
            encoding_format: params.requestBody.encoding_format,
          },
        },
        null,
        2,
      )}\n`,
      contentType: "application/json",
    },
  ];
  const responseContext =
    params.responseStatus !== undefined ||
    params.responseContentType ||
    normalizedResponseText
      ? {
          status: params.responseStatus ?? null,
          content_type: params.responseContentType || null,
          body_length: normalizedResponseText.length,
          body_sha256: normalizedResponseText
            ? textFingerprint(normalizedResponseText)
            : null,
          body_truncated: responsePreview?.truncated ?? false,
        }
      : null;
  if (responseContext) {
    attachments.push({
      filename: "embedding-response.json",
      data: `${JSON.stringify(
        {
          status: params.responseStatus ?? null,
          content_type: params.responseContentType || null,
          body_length: normalizedResponseText.length,
          body_sha256: normalizedResponseText
            ? textFingerprint(normalizedResponseText)
            : null,
          body_truncated: responsePreview?.truncated ?? false,
          body_preview: responsePreview?.text ?? "",
        },
        null,
        2,
      )}\n`,
      contentType: "application/json",
    });
  }
  (params.captureException ?? captureRuntimeException)({
    error: params.error,
    level: "error",
    tags: {
      surface: "memory_model_embedding",
      failure_kind: params.failureKind,
      embedding_model: params.requestBody.model,
      ...(params.responseStatus !== undefined
        ? { response_status: params.responseStatus }
        : {}),
    },
    contexts: {
      memory_model_embedding_request: requestContext,
      ...(responseContext
        ? { memory_model_embedding_response: responseContext }
        : {}),
    },
    fingerprint: [
      "memory-model-embedding",
      params.failureKind,
      params.responseStatus !== undefined
        ? String(params.responseStatus)
        : params.requestBody.model,
    ],
    attachments,
  });
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
  return await Sentry.startSpan(
    {
      name:
        apiStyle === "anthropic_native"
          ? `messages ${modelId}`
          : `chat ${modelId}`,
      op: "gen_ai.request",
      attributes: spanIdentityAttributes(headers, {
        operationName:
          apiStyle === "anthropic_native" ? "messages" : "chat_completions",
        model: modelId,
        promptSystemChars: query.systemPrompt.length,
        promptUserChars: query.userPrompt.length,
      }),
    },
    async (span) => {
      try {
        let endpoint = "";
        let body: Record<string, unknown> = {};
        if (apiStyle === "anthropic_native") {
          endpoint = anthropicMessagesEndpoint(baseUrl);
          if (!hasExplicitAuthHeader(headers) && config.apiKey.trim()) {
            headers["x-api-key"] = config.apiKey.trim();
          }
          if (
            !Object.keys(headers).some(
              (key) => key.trim().toLowerCase() === "anthropic-version",
            )
          ) {
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
        span.setAttribute("http.response.status_code", response.status);
        if (!response.ok) {
          span.setStatus({
            code: 2,
            message: `status_${response.status}`,
          });
          return null;
        }
        const payload = await response.json().catch(() => null);
        applyGenAiUsageMetrics(
          span,
          apiStyle === "anthropic_native"
            ? anthropicUsageMetrics(payload)
            : openAiCompatibleUsageMetrics(payload),
        );
        const text =
          apiStyle === "anthropic_native"
            ? anthropicCompletionContent(payload)
            : completionContent(payload);
        span.setStatus({ code: 1, message: "ok" });
        return parseJsonObjectCandidate(text);
      } catch (error) {
        span.setStatus({
          code: 2,
          message:
            error instanceof Error && error.name ? error.name : "request_exception",
        });
        return null;
      } finally {
        clearTimeout(timeout);
      }
    },
  );
}

export async function queryMemoryModelEmbedding(
  config: MemoryModelClientConfig,
  query: MemoryModelEmbeddingQuery,
  options: QueryMemoryModelEmbeddingOptions = {},
): Promise<Float32Array | null> {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
  const modelId = normalizeOpenAiModelId(config.modelId);
  const apiStyle =
    config.apiStyle === "openai_compatible"
      ? "openai_compatible"
      : config.apiStyle === "anthropic_native"
        ? "anthropic_native"
        : looksLikeOpenAiCompatBaseUrl(baseUrl)
          ? "openai_compatible"
          : looksLikeAnthropicBaseUrl(baseUrl)
            ? "anthropic_native"
            : null;
  if (!baseUrl || !modelId || apiStyle !== "openai_compatible") {
    return null;
  }
  const normalizedInput = query.input.trim();
  if (!normalizedInput) {
    return null;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.defaultHeaders ?? {}),
  };
  if (!hasExplicitAuthHeader(headers) && config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  }
  const endpoint = `${baseUrl}/embeddings`;
  const requestBody = {
    model: modelId,
    input: normalizedInput,
    encoding_format: "float" as const,
  };
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Math.min(query.timeoutMs ?? 7000, 20000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return await Sentry.startSpan(
    {
      name: `embeddings ${modelId}`,
      op: "gen_ai.request",
      attributes: spanIdentityAttributes(headers, {
        operationName: "embeddings",
        model: modelId,
        promptUserChars: normalizedInput.length,
      }),
    },
    async (span) => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify(requestBody),
        });
        const responseText = await response.text().catch(() => "");
        const responseContentType = firstNonEmptyString(
          response.headers.get("content-type"),
        );
        span.setAttribute("http.response.status_code", response.status);
        if (!response.ok) {
          span.setStatus({
            code: 2,
            message: `status_${response.status}`,
          });
          captureEmbeddingFailure({
            captureException: options.captureException,
            error: new Error(
              `Memory model embedding request failed with status ${response.status}`,
            ),
            failureKind: "upstream_non_ok",
            endpoint,
            headers,
            requestBody,
            responseStatus: response.status,
            responseContentType,
            responseText,
          });
          return null;
        }
        const payload = parseJsonValueCandidate(responseText);
        if (payload === null) {
          span.setStatus({ code: 2, message: "invalid_json" });
          captureEmbeddingFailure({
            captureException: options.captureException,
            error: new Error(
              "Memory model embedding response was not valid JSON",
            ),
            failureKind: "invalid_json",
            endpoint,
            headers,
            requestBody,
            responseStatus: response.status,
            responseContentType,
            responseText,
          });
          return null;
        }
        applyGenAiUsageMetrics(
          span,
          openAiCompatibleUsageMetrics(payload, { defaultOutputTokens: 0 }),
        );
        if (
          !isRecord(payload) ||
          !Array.isArray(payload.data) ||
          payload.data.length === 0 ||
          !isRecord(payload.data[0])
        ) {
          span.setStatus({ code: 2, message: "invalid_payload" });
          captureEmbeddingFailure({
            captureException: options.captureException,
            error: new Error(
              "Memory model embedding response did not contain a usable embedding payload",
            ),
            failureKind: "invalid_payload",
            endpoint,
            headers,
            requestBody,
            responseStatus: response.status,
            responseContentType,
            responseText,
          });
          return null;
        }
        const embedding = Array.isArray(payload.data[0].embedding)
          ? payload.data[0].embedding
          : [];
        const values = embedding
          .map((value) => (typeof value === "number" ? value : Number(value)))
          .filter((value) => Number.isFinite(value));
        if (values.length === 0) {
          span.setStatus({ code: 2, message: "invalid_payload" });
          captureEmbeddingFailure({
            captureException: options.captureException,
            error: new Error(
              "Memory model embedding response contained no numeric embedding values",
            ),
            failureKind: "invalid_payload",
            endpoint,
            headers,
            requestBody,
            responseStatus: response.status,
            responseContentType,
            responseText,
          });
          return null;
        }
        span.setStatus({ code: 1, message: "ok" });
        return new Float32Array(values);
      } catch (error) {
        span.setStatus({
          code: 2,
          message:
            error instanceof Error && error.name ? error.name : "request_exception",
        });
        captureEmbeddingFailure({
          captureException: options.captureException,
          error,
          failureKind: "request_exception",
          endpoint,
          headers,
          requestBody,
        });
        return null;
      } finally {
        clearTimeout(timeout);
      }
    },
  );
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
