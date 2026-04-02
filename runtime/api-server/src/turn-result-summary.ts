import type { CompactionBoundaryRecord, SessionMessageRecord, TurnResultRecord } from "@holaboss/runtime-state-store";

import type { AgentRecentRuntimeContext, AgentSessionResumeContext } from "./agent-runtime-prompt.js";

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstNonEmptyLines(value: string, maxLines: number, maxChars: number): string[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line))
    .filter(Boolean);
  if (lines.length === 0) {
    return [];
  }
  const selected: string[] = [];
  let totalChars = 0;
  for (const line of lines) {
    if (selected.length >= maxLines || totalChars >= maxChars) {
      break;
    }
    const remaining = maxChars - totalChars;
    const next = line.length > remaining ? `${line.slice(0, Math.max(0, remaining - 1)).trimEnd()}...` : line;
    if (!next) {
      break;
    }
    selected.push(next);
    totalChars += next.length;
  }
  return selected;
}

function clippedText(value: string, maxChars: number): string {
  const normalized = compactWhitespace(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function compactTurnSummary(turnResult: TurnResultRecord): string | null {
  const assistantLines = firstNonEmptyLines(turnResult.assistantText, 3, 320);
  if (assistantLines.length > 0) {
    return assistantLines.join(" ");
  }
  if (turnResult.status === "waiting_user") {
    return "Run paused waiting for user input.";
  }
  if (turnResult.status === "failed") {
    const reason = compactWhitespace(turnResult.stopReason ?? "");
    return reason ? `Run failed: ${reason}.` : "Run failed.";
  }
  const stopReason = compactWhitespace(turnResult.stopReason ?? "");
  return stopReason ? `Run completed with stop reason ${stopReason}.` : null;
}

export function recentRuntimeContextFromTurnResult(turnResult: TurnResultRecord): AgentRecentRuntimeContext | null {
  const summary = turnResult.compactedSummary ?? compactTurnSummary(turnResult);
  const lastStopReason = compactWhitespace(turnResult.stopReason ?? "") || null;
  const waitingForUser = turnResult.status === "waiting_user" ? true : null;
  const lastError = turnResult.status === "failed" ? lastStopReason ?? summary ?? "run_failed" : null;
  if (!summary && !lastStopReason && waitingForUser !== true && !lastError) {
    return null;
  }
  return {
    summary,
    last_stop_reason: lastStopReason,
    last_error: lastError,
    waiting_for_user: waitingForUser,
  };
}

export function sessionResumeContextFromArtifacts(params: {
  turnResults: TurnResultRecord[];
  sessionMessages: SessionMessageRecord[];
  currentInputId: string;
  maxTurns?: number;
  maxUserMessages?: number;
}): AgentSessionResumeContext | null {
  const maxTurns = Math.max(1, params.maxTurns ?? 4);
  const maxUserMessages = Math.max(1, params.maxUserMessages ?? 3);
  const recentTurns = params.turnResults
    .filter((turnResult) => turnResult.inputId !== params.currentInputId)
    .slice(0, maxTurns)
    .map((turnResult) => ({
      input_id: turnResult.inputId,
      status: turnResult.status,
      stop_reason: compactWhitespace(turnResult.stopReason ?? "") || null,
      summary: turnResult.compactedSummary ?? compactTurnSummary(turnResult),
      completed_at: turnResult.completedAt ?? turnResult.updatedAt,
    }))
    .filter((turn) => turn.summary || turn.stop_reason || turn.status);

  const currentUserMessageId = `user-${params.currentInputId}`;
  const recentUserMessages = params.sessionMessages
    .filter((message) => message.role === "user" && message.id !== currentUserMessageId)
    .map((message) => clippedText(message.text, 220))
    .filter(Boolean)
    .slice(-maxUserMessages)
    .reverse();

  if (recentTurns.length === 0 && recentUserMessages.length === 0) {
    return null;
  }

  return {
    recent_turns: recentTurns,
    recent_user_messages: recentUserMessages,
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function buildCompactionBoundaryArtifacts(params: {
  turnResult: TurnResultRecord;
  recentTurns: TurnResultRecord[];
  sessionMessages: SessionMessageRecord[];
  restoredMemoryPaths?: string[];
}): {
  summary: string | null;
  recentRuntimeContext: AgentRecentRuntimeContext | null;
  restorationContext: Record<string, unknown>;
  preservedTurnInputIds: string[];
} {
  const sessionResumeContext = sessionResumeContextFromArtifacts({
    turnResults: params.recentTurns,
    sessionMessages: params.sessionMessages,
    currentInputId: "",
  });
  return {
    summary: params.turnResult.compactedSummary ?? compactTurnSummary(params.turnResult),
    recentRuntimeContext: recentRuntimeContextFromTurnResult(params.turnResult),
    restorationContext: {
      session_resume_context: sessionResumeContext,
      restored_memory_paths: params.restoredMemoryPaths ?? [],
    },
    preservedTurnInputIds: params.recentTurns.map((turnResult) => turnResult.inputId),
  };
}

export function recentRuntimeContextFromCompactionBoundary(
  boundary: CompactionBoundaryRecord | null | undefined
): AgentRecentRuntimeContext | null {
  if (!boundary) {
    return null;
  }
  const record = objectRecord(boundary.recentRuntimeContext);
  if (!record) {
    return null;
  }
  const summary = typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : null;
  const lastStopReason =
    typeof record.last_stop_reason === "string" && record.last_stop_reason.trim()
      ? record.last_stop_reason.trim()
      : null;
  const lastError =
    typeof record.last_error === "string" && record.last_error.trim() ? record.last_error.trim() : null;
  const waitingForUser = record.waiting_for_user === true ? true : null;
  if (!summary && !lastStopReason && !lastError && waitingForUser !== true) {
    return null;
  }
  return {
    summary,
    last_stop_reason: lastStopReason,
    last_error: lastError,
    waiting_for_user: waitingForUser,
  };
}

export function sessionResumeContextFromCompactionBoundary(
  boundary: CompactionBoundaryRecord | null | undefined
): AgentSessionResumeContext | null {
  if (!boundary) {
    return null;
  }
  const restorationContext = objectRecord(boundary.restorationContext);
  const sessionResumeContext = objectRecord(restorationContext?.session_resume_context);
  if (!sessionResumeContext) {
    return null;
  }
  return sessionResumeContext as AgentSessionResumeContext;
}
