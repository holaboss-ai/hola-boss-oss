import type { TurnResultRecord } from "@holaboss/runtime-state-store";

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
    const next =
      line.length > remaining
        ? `${line.slice(0, Math.max(0, remaining - 1)).trimEnd()}...`
        : line;
    if (!next) {
      break;
    }
    selected.push(next);
    totalChars += next.length;
  }
  return selected;
}

export function compactTurnSummary(turnResult: TurnResultRecord): string | null {
  const assistantLines = firstNonEmptyLines(turnResult.assistantText, 3, 320);
  if (assistantLines.length > 0) {
    return assistantLines.join(" ");
  }
  if (turnResult.status === "waiting_user") {
    return "Run paused waiting for user input.";
  }
  if (turnResult.status === "paused") {
    return "Run was paused by the user before completion.";
  }
  if (turnResult.status === "failed") {
    const reason = compactWhitespace(turnResult.stopReason ?? "");
    return reason ? `Run failed: ${reason}.` : "Run failed.";
  }
  const stopReason = compactWhitespace(turnResult.stopReason ?? "");
  return stopReason ? `Run completed with stop reason ${stopReason}.` : null;
}
