import * as Sentry from "@sentry/node";

type RuntimeSentryLevel = "fatal" | "error" | "warning" | "log" | "info" | "debug";

export interface RuntimeSentryCaptureOptions {
  error: unknown;
  level?: RuntimeSentryLevel;
  tags?: Record<string, unknown>;
  extras?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown> | null | undefined>;
  fingerprint?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  }
  return value === undefined ? null : String(value);
}

function normalizeTagValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function normalizeError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  const message =
    typeof value === "string"
      ? value
      : JSON.stringify(jsonValue(value)) ?? "Unknown runtime error";
  return new Error(message);
}

export function captureRuntimeException(
  options: RuntimeSentryCaptureOptions,
): void {
  const error = normalizeError(options.error);
  Sentry.withScope((scope) => {
    if (options.level) {
      scope.setLevel(options.level);
    }
    if (Array.isArray(options.fingerprint) && options.fingerprint.length > 0) {
      scope.setFingerprint(options.fingerprint.filter((item) => item.trim()));
    }
    for (const [key, value] of Object.entries(options.tags ?? {})) {
      const normalized = normalizeTagValue(value);
      if (normalized) {
        scope.setTag(key, normalized);
      }
    }
    for (const [key, value] of Object.entries(options.extras ?? {})) {
      scope.setExtra(key, jsonValue(value));
    }
    for (const [key, value] of Object.entries(options.contexts ?? {})) {
      if (value && Object.keys(value).length > 0) {
        scope.setContext(key, jsonValue(value) as Record<string, unknown>);
      }
    }
    Sentry.captureException(error);
  });
}
