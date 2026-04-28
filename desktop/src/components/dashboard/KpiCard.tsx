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
    <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-xs">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="mt-1.5 min-h-[2rem]">
        {state.kind === "loading" ? (
          <div className="h-6 w-24 animate-pulse rounded bg-muted-foreground/15" />
        ) : state.kind === "error" ? (
          <div className="text-xs text-destructive">{state.message}</div>
        ) : (
          <div className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {state.label}
          </div>
        )}
      </div>
    </div>
  );
}
