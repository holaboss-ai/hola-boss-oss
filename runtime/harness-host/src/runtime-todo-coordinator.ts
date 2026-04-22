import type { JsonValue } from "./contracts.js";

export interface RuntimeTodoStatus {
  exists: boolean;
  blocked: boolean;
}

export interface RuntimeTodoCoordinatorScope {
  runtimeApiBaseUrl?: string | null;
  workspaceId: string;
  sessionId: string;
}

export interface RuntimeTodoToolCompletion {
  toolName: string;
  error: boolean;
  toolArgs: JsonValue | null;
  result: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeRuntimeApiBaseUrl(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

export async function fetchRuntimeTodoStatus(
  scope: RuntimeTodoCoordinatorScope,
  fetchImpl: typeof fetch = fetch
): Promise<RuntimeTodoStatus> {
  const runtimeApiBaseUrl = normalizeRuntimeApiBaseUrl(scope.runtimeApiBaseUrl);
  if (!runtimeApiBaseUrl) {
    return { exists: false, blocked: false };
  }
  try {
    const response = await fetchImpl(`${runtimeApiBaseUrl}/api/v1/capabilities/runtime-tools/todo/status`, {
      method: "GET",
      headers: {
        "x-holaboss-workspace-id": scope.workspaceId,
        "x-holaboss-session-id": scope.sessionId,
      },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return { exists: false, blocked: false };
    }
    const payload = await response.json();
    if (!isRecord(payload)) {
      return { exists: false, blocked: false };
    }
    return {
      exists: payload.exists === true,
      blocked: payload.blocked === true,
    };
  } catch {
    return { exists: false, blocked: false };
  }
}

export async function blockRuntimeTodoTask(
  scope: RuntimeTodoCoordinatorScope,
  detail: string,
  fetchImpl: typeof fetch = fetch
): Promise<RuntimeTodoStatus | null> {
  const runtimeApiBaseUrl = normalizeRuntimeApiBaseUrl(scope.runtimeApiBaseUrl);
  if (!runtimeApiBaseUrl) {
    return null;
  }
  try {
    const response = await fetchImpl(`${runtimeApiBaseUrl}/api/v1/capabilities/runtime-tools/todo/block`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-holaboss-workspace-id": scope.workspaceId,
        "x-holaboss-session-id": scope.sessionId,
      },
      body: JSON.stringify({ detail }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    if (!isRecord(payload)) {
      return null;
    }
    return {
      exists: payload.exists === true,
      blocked: payload.blocked === true,
    };
  } catch {
    return null;
  }
}

export function summarizeQuestionPrompt(args: JsonValue | null, result: unknown): string | null {
  const candidates: unknown[] = [];
  if (isRecord(args)) {
    candidates.push(args.question, args.prompt, args.message, args.text, args.content);
  }
  if (isRecord(result)) {
    candidates.push(result.question, result.prompt, result.message, result.text, result.content);
    if (isRecord(result.details)) {
      candidates.push(
        result.details.question,
        result.details.prompt,
        result.details.message,
        result.details.text,
        result.details.content
      );
    }
  }
  for (const candidate of candidates) {
    const normalized = optionalTrimmedString(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export class RuntimeTodoCoordinator {
  private status: RuntimeTodoStatus = { exists: false, blocked: false };
  private readonly pendingUpdates = new Set<Promise<void>>();

  constructor(
    private readonly scope: RuntimeTodoCoordinatorScope,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async initialize(): Promise<void> {
    this.status = await fetchRuntimeTodoStatus(this.scope, this.fetchImpl);
  }

  getStatus(): RuntimeTodoStatus {
    return { ...this.status };
  }

  shouldEmitWaitingUser(localWaitingForUser: boolean): boolean {
    return localWaitingForUser || this.status.blocked;
  }

  noteToolCompletion(params: RuntimeTodoToolCompletion): void {
    if (params.error) {
      return;
    }
    if (params.toolName.trim().toLowerCase() !== "question") {
      return;
    }
    const questionText = summarizeQuestionPrompt(params.toolArgs, params.result);
    const detail = questionText
      ? `Blocked waiting for user input: ${questionText}`
      : "Blocked waiting for user input.";
    let updatePromise: Promise<void> | null = null;
    updatePromise = blockRuntimeTodoTask(this.scope, detail, this.fetchImpl)
      .then((nextStatus) => {
        if (nextStatus) {
          this.status = nextStatus;
        }
      })
      .finally(() => {
        if (updatePromise) {
          this.pendingUpdates.delete(updatePromise);
        }
      });
    this.pendingUpdates.add(updatePromise);
  }

  async waitForPendingUpdates(): Promise<void> {
    if (this.pendingUpdates.size === 0) {
      return;
    }
    await Promise.allSettled([...this.pendingUpdates]);
  }
}
