import type { StatGridPanel as StatGridSpec } from "@/lib/dashboardSchema";

import { type KpiCardState, type KpiDelta, KpiCard } from "./KpiCard";

export interface StatGridState {
  kind: "stats";
  /** Per-stat resolved query state; aligns to the spec's `stats` order. */
  values: KpiCardState[];
  /** Per-stat delta state; aligns 1:1 with `values`. Slots may be
   *  `kind: "none"` when the spec didn't ship a `delta_query`. */
  deltas: KpiDelta[];
}

interface StatGridPanelProps {
  panel: StatGridSpec;
  state: StatGridState | { kind: "loading" } | { kind: "error"; message: string };
}

const COLUMN_CLASS: Record<2 | 3 | 4, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-2 md:grid-cols-4",
};

// Multiple related KPIs in one panel. Each stat shows the same
// affordances as a top-level kpi panel (format, delta, no target —
// stat_grid stats don't carry a target by spec; use a kpi panel for
// progress-bar headlines).
export function StatGridPanel({ panel, state }: StatGridPanelProps) {
  const cols = (panel.columns ?? Math.min(4, panel.stats.length)) as 2 | 3 | 4;
  const gridClass = COLUMN_CLASS[cols] ?? COLUMN_CLASS[4];

  return (
    <section className="min-w-0">
      <div className="mb-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {panel.title}
        </h2>
        {panel.description ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {panel.description}
          </p>
        ) : null}
      </div>
      <div
        className={`grid divide-x divide-border [&>*:first-child]:pl-0 ${gridClass}`}
      >
        {panel.stats.map((stat, i) => {
          const cardState =
            state.kind === "loading"
              ? ({ kind: "loading" } as KpiCardState)
              : state.kind === "error"
                ? ({ kind: "error", message: state.message } as KpiCardState)
                : (state.values[i] ?? ({ kind: "loading" } as KpiCardState));
          const delta =
            state.kind === "stats" ? state.deltas[i] : ({ kind: "none" } as KpiDelta);
          return (
            <KpiCard
              key={`${stat.label}-${i}`}
              title={stat.label}
              state={cardState}
              delta={delta}
              format={stat.format}
              currency={stat.currency}
              compact
            />
          );
        })}
      </div>
    </section>
  );
}
