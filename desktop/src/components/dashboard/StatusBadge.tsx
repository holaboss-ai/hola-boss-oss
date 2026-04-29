interface StatusBadgeProps {
  value: string;
}

// Renders an enum-like value (status / state / stage) as a small pill.
// Color hint is name-based: known lifecycle words map to semantic
// tokens (success / destructive / warning / info). Anything else falls
// back to a muted neutral so unknown enums stay visually quiet rather
// than pretending to mean something they don't.
export function StatusBadge({ value }: StatusBadgeProps) {
  const className = badgeClassFor(value);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${className}`}
    >
      {value || "—"}
    </span>
  );
}

const SUCCESS_VALUES = new Set(["published", "active", "success", "completed", "done", "sent", "delivered"]);
const FAILURE_VALUES = new Set(["failed", "error", "cancelled", "canceled", "rejected"]);
const INFO_VALUES = new Set(["queued", "pending", "processing", "running", "in_progress", "active_run"]);
const WARNING_VALUES = new Set(["scheduled", "delayed", "waiting", "paused", "blocked"]);
const NEUTRAL_VALUES = new Set(["draft", "new", "idle", "open", "todo", "backlog"]);

function badgeClassFor(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (SUCCESS_VALUES.has(v)) {
    return "bg-success/10 text-success";
  }
  if (FAILURE_VALUES.has(v)) {
    return "bg-destructive/10 text-destructive";
  }
  if (INFO_VALUES.has(v)) {
    return "bg-info/10 text-info";
  }
  if (WARNING_VALUES.has(v)) {
    return "bg-warning/10 text-warning";
  }
  if (NEUTRAL_VALUES.has(v)) {
    return "bg-muted text-muted-foreground";
  }
  return "bg-muted text-muted-foreground";
}

// Heuristic: column with a name like "status" / "state" / "stage" /
// "phase" — treat its values as enum-like and badge-render them.
const STATUS_COLUMN_NAMES = new Set([
  "status",
  "state",
  "stage",
  "phase",
  "lifecycle",
]);

export function isStatusColumn(columnName: string): boolean {
  return STATUS_COLUMN_NAMES.has(columnName.trim().toLowerCase());
}
