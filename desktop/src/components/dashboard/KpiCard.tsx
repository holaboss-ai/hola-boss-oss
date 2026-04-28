interface KpiCardProps {
  title: string;
  state: KpiCardState;
}

export type KpiCardState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "value"; label: string };

// Pulls a single human-readable value from the panel's query result.
// Convention: prefer a column named `value` when present; otherwise fall
// back to the first column of the first row.
export function deriveKpiLabel(columns: string[], rows: unknown[][]): string {
  if (rows.length === 0) return "—";
  const valueIdx = columns.findIndex((c) => c.toLowerCase() === "value");
  const idx = valueIdx >= 0 ? valueIdx : 0;
  const cell = rows[0]?.[idx];
  if (cell === null || cell === undefined) return "—";
  if (typeof cell === "number") return Number.isInteger(cell) ? cell.toLocaleString() : String(cell);
  return String(cell);
}

export function KpiCard({ title, state }: KpiCardProps) {
  return (
    <div className="px-1 py-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="mt-1.5 min-h-[1.75rem]">
        {state.kind === "loading" ? (
          <div className="h-7 w-20 animate-pulse rounded bg-muted" />
        ) : state.kind === "error" ? (
          <div className="text-xs text-destructive">{state.message}</div>
        ) : (
          <div className="text-3xl font-medium tabular-nums tracking-tight text-foreground">
            {state.label}
          </div>
        )}
      </div>
    </div>
  );
}
