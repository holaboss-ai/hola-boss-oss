import { useEffect, useMemo, useState } from "react";

import {
  type Dashboard,
  type DashboardPanel,
  type KpiPanel as KpiPanelSpec,
  type StatGridPanel as StatGridPanelSpec,
  type Width,
  parseDashboard,
} from "@/lib/dashboardSchema";

import { ChartPanel } from "./ChartPanel";
import { type DataViewState, DataViewPanel } from "./DataViewPanel";
import { type KpiCardState, type KpiDelta, KpiCard, deriveKpiValue } from "./KpiCard";
import { type StatGridState, StatGridPanel } from "./StatGridPanel";
import { TextPanel } from "./TextPanel";

interface DashboardRendererProps {
  workspaceId: string;
  content: string;
  /** Toggled by the host pane (InternalSurfacePane). When true, the
   *  centered max-width is dropped and the renderer fills its container. */
  fullWidth?: boolean;
  /** Bumped by the host pane to force a full re-fetch of every panel. */
  refreshKey?: number;
}

interface DashboardQueryResult {
  ok: boolean;
  rows?: unknown[][];
  columns?: string[];
  error?: string;
}

type PanelState =
  | { kind: "kpi"; main: KpiCardState; delta: KpiDelta }
  | { kind: "stat_grid"; state: StatGridState | { kind: "loading" } | { kind: "error"; message: string } }
  | { kind: "data_view"; state: DataViewState }
  | { kind: "text" }
  | { kind: "chart"; state: DataViewState };

// Reads a `.dashboard` YAML doc, runs each panel's query against the
// workspace's shared data.db (read-only IPC), and renders panels in
// document order with a width-flow layout (full / half / third).
export function DashboardRenderer({
  workspaceId,
  content,
  fullWidth = false,
  refreshKey = 0,
}: DashboardRendererProps) {
  const parsed = useMemo(() => parseDashboard(content), [content]);

  if (!parsed.ok || !parsed.dashboard) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-xl rounded-md border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          <div className="font-medium">Dashboard could not be parsed.</div>
          <div className="mt-1 font-mono text-[11px]">{parsed.error ?? "Unknown error."}</div>
        </div>
      </div>
    );
  }

  return (
    <DashboardBody
      workspaceId={workspaceId}
      dashboard={parsed.dashboard}
      fullWidth={fullWidth}
      refreshKey={refreshKey}
    />
  );
}

function DashboardBody({
  workspaceId,
  dashboard,
  fullWidth,
  refreshKey,
}: {
  workspaceId: string;
  dashboard: Dashboard;
  fullWidth: boolean;
  refreshKey: number;
}) {
  const [panelStates, setPanelStates] = useState<PanelState[]>(() =>
    dashboard.panels.map((p) => initialPanelState(p)),
  );

  // Run all queries when the dashboard changes (file edited, new mount,
  // or refresh). Per-panel queries write into their own slot so a slow
  // query doesn't block earlier rendering.
  useEffect(() => {
    let cancelled = false;
    setPanelStates(dashboard.panels.map((p) => initialPanelState(p)));

    const run = (
      panelIdx: number,
      sql: string,
      apply: (result: DashboardQueryResult) => void,
    ) => {
      void window.electronAPI.workspace
        .runDashboardQuery({ workspaceId, sql })
        .then((result: DashboardQueryResult) => {
          if (cancelled) return;
          apply(result);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          apply({ ok: false, error: err instanceof Error ? err.message : String(err) });
        });
    };

    dashboard.panels.forEach((panel, panelIdx) => {
      if (panel.type === "text") return;

      if (panel.type === "kpi") {
        run(panelIdx, panel.query, (result) => {
          setPanelStates((prev) => {
            const next = prev.slice();
            next[panelIdx] = mergeKpiResult(next[panelIdx], "main", kpiSlotFromResult(result));
            return next;
          });
        });
        if (panel.delta_query) {
          run(panelIdx, panel.delta_query, (result) => {
            setPanelStates((prev) => {
              const next = prev.slice();
              next[panelIdx] = mergeKpiResult(next[panelIdx], "delta", kpiDeltaFromResult(result));
              return next;
            });
          });
        }
        return;
      }

      if (panel.type === "stat_grid") {
        panel.stats.forEach((stat, statIdx) => {
          run(panelIdx, stat.query, (result) => {
            setPanelStates((prev) => {
              const next = prev.slice();
              next[panelIdx] = mergeStatResult(
                next[panelIdx],
                statIdx,
                "main",
                kpiSlotFromResult(result),
                panel.stats.length,
              );
              return next;
            });
          });
          if (stat.delta_query) {
            run(panelIdx, stat.delta_query, (result) => {
              setPanelStates((prev) => {
                const next = prev.slice();
                next[panelIdx] = mergeStatResult(
                  next[panelIdx],
                  statIdx,
                  "delta",
                  kpiDeltaFromResult(result),
                  panel.stats.length,
                );
                return next;
              });
            });
          }
        });
        return;
      }

      if (panel.type === "data_view") {
        run(panelIdx, panel.query, (result) => {
          setPanelStates((prev) => {
            const next = prev.slice();
            next[panelIdx] = {
              kind: "data_view",
              state: result.ok
                ? { kind: "data", columns: result.columns ?? [], rows: result.rows ?? [] }
                : { kind: "error", message: result.error ?? "Query failed." },
            };
            return next;
          });
        });
        return;
      }

      if (panel.type === "chart") {
        run(panelIdx, panel.query, (result) => {
          setPanelStates((prev) => {
            const next = prev.slice();
            next[panelIdx] = {
              kind: "chart",
              state: result.ok
                ? { kind: "data", columns: result.columns ?? [], rows: result.rows ?? [] }
                : { kind: "error", message: result.error ?? "Query failed." },
            };
            return next;
          });
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [dashboard, workspaceId, refreshKey]);

  // Width hints arrange panels into rows. `max-w-none` would animate
  // over a literal-billion-px change so we use a pixel value for full.
  const widthClass = fullWidth ? "max-w-[1600px]" : "max-w-4xl";

  const groups = useMemo(() => groupPanels(dashboard.panels), [dashboard.panels]);

  return (
    <div className="h-full overflow-auto bg-background">
      <div
        className={`mx-auto px-10 pt-10 pb-16 transition-[max-width] duration-200 ease-out ${widthClass}`}
      >
        <header className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {dashboard.title}
          </h1>
          {dashboard.description ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {dashboard.description}
            </p>
          ) : null}
        </header>

        <div className="mt-8 flex flex-col gap-8">
          {groups.map((group, gIdx) => (
            <RowGroup
              // biome-ignore lint/suspicious/noArrayIndexKey: panel order is canonical
              key={`g-${gIdx}`}
              group={group}
              panels={dashboard.panels}
              states={panelStates}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface RowGroup {
  /** One or more panel indices that flow into a single horizontal row. */
  indices: number[];
  /** Number of columns in this row — derived from the panels' widths. */
  columns: number;
}

// Walks panels in order, batching adjacent panels whose `width` hints
// can share a row. The rules:
//   - `width: full` always breaks a row (alone in its group)
//   - `width: half` pairs greedily with the next half / kpi-half
//   - `width: third` triples greedily with the next two thirds
//   - bare kpi (width unset) is treated as full unless followed by
//     consecutive bare kpis, in which case they form a 2-3-4 row —
//     this preserves the v1 behavior where consecutive KPIs share a
//     row implicitly.
function groupPanels(panels: DashboardPanel[]): RowGroup[] {
  const out: RowGroup[] = [];
  let i = 0;
  while (i < panels.length) {
    const panel = panels[i];
    const width = effectiveWidth(panel);

    if (width === "full") {
      out.push({ indices: [i], columns: 1 });
      i += 1;
      continue;
    }

    if (width === "half") {
      const partner = panels[i + 1];
      if (partner && effectiveWidth(partner) === "half") {
        out.push({ indices: [i, i + 1], columns: 2 });
        i += 2;
        continue;
      }
      out.push({ indices: [i], columns: 2 }); // orphan half — render in 2-col grid for layout consistency
      i += 1;
      continue;
    }

    if (width === "third") {
      const a = panels[i + 1];
      const b = panels[i + 2];
      if (
        a && b &&
        effectiveWidth(a) === "third" &&
        effectiveWidth(b) === "third"
      ) {
        out.push({ indices: [i, i + 1, i + 2], columns: 3 });
        i += 3;
        continue;
      }
      if (a && effectiveWidth(a) === "third") {
        out.push({ indices: [i, i + 1], columns: 3 });
        i += 2;
        continue;
      }
      out.push({ indices: [i], columns: 3 });
      i += 1;
      continue;
    }

    // Implicit-kpi run: width === undefined. Walk forward over
    // consecutive bare kpis; pack up to 4 in a row.
    if (panel.type === "kpi" && !panel.width) {
      const indices: number[] = [i];
      let j = i + 1;
      while (
        j < panels.length &&
        indices.length < 4 &&
        panels[j].type === "kpi" &&
        !(panels[j] as KpiPanelSpec).width
      ) {
        indices.push(j);
        j += 1;
      }
      out.push({ indices, columns: indices.length });
      i = j;
      continue;
    }

    out.push({ indices: [i], columns: 1 });
    i += 1;
  }
  return out;
}

function effectiveWidth(panel: DashboardPanel): Width | undefined {
  return panel.width;
}

function RowGroup({
  group,
  panels,
  states,
}: {
  group: RowGroup;
  panels: DashboardPanel[];
  states: PanelState[];
}) {
  const cols = group.columns;
  return (
    <div
      className="grid gap-x-6 gap-y-4"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      }}
    >
      {group.indices.map((panelIdx) => {
        const panel = panels[panelIdx];
        const state = states[panelIdx];
        return (
          <PanelDispatch key={panelIdx} panel={panel} state={state} />
        );
      })}
    </div>
  );
}

function PanelDispatch({ panel, state }: { panel: DashboardPanel; state: PanelState }) {
  if (panel.type === "kpi" && state.kind === "kpi") {
    const kpi = panel as KpiPanelSpec;
    return (
      <KpiCard
        title={kpi.title}
        description={kpi.description}
        state={state.main}
        delta={state.delta}
        format={kpi.format}
        currency={kpi.currency}
        target={kpi.target}
      />
    );
  }
  if (panel.type === "stat_grid" && state.kind === "stat_grid") {
    return <StatGridPanel panel={panel as StatGridPanelSpec} state={state.state} />;
  }
  if (panel.type === "data_view" && state.kind === "data_view") {
    return <DataViewPanel panel={panel} state={state.state} />;
  }
  if (panel.type === "text" && state.kind === "text") {
    return <TextPanel panel={panel} />;
  }
  if (panel.type === "chart" && state.kind === "chart") {
    return <ChartPanel panel={panel} state={state.state} />;
  }
  return (
    <div className="rounded-md border border-dashed border-border/70 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
      Unsupported panel state.
    </div>
  );
}

// ----- Result merging ----------------------------------------------

function initialPanelState(panel: DashboardPanel): PanelState {
  if (panel.type === "kpi") {
    return {
      kind: "kpi",
      main: { kind: "loading" },
      delta: panel.delta_query ? { kind: "loading" } : { kind: "none" },
    };
  }
  if (panel.type === "stat_grid") {
    return { kind: "stat_grid", state: { kind: "loading" } };
  }
  if (panel.type === "text") {
    return { kind: "text" };
  }
  if (panel.type === "chart") {
    return { kind: "chart", state: { kind: "loading" } };
  }
  return { kind: "data_view", state: { kind: "loading" } };
}

function kpiSlotFromResult(result: DashboardQueryResult): KpiCardState {
  if (!result.ok) return { kind: "error", message: result.error ?? "Query failed." };
  const cols = result.columns ?? [];
  const rows = result.rows ?? [];
  if (rows.length === 0) return { kind: "empty" };
  return { kind: "value", raw: deriveKpiValue(cols, rows) };
}

function kpiDeltaFromResult(result: DashboardQueryResult): KpiDelta {
  if (!result.ok) return { kind: "error" };
  const cols = result.columns ?? [];
  const rows = result.rows ?? [];
  if (rows.length === 0) return { kind: "none" };
  return { kind: "value", raw: deriveKpiValue(cols, rows) };
}

function mergeKpiResult(
  current: PanelState,
  slot: "main" | "delta",
  next: KpiCardState | KpiDelta,
): PanelState {
  if (current.kind !== "kpi") return current;
  if (slot === "main") {
    return { ...current, main: next as KpiCardState };
  }
  return { ...current, delta: next as KpiDelta };
}

function mergeStatResult(
  current: PanelState,
  statIdx: number,
  slot: "main" | "delta",
  next: KpiCardState | KpiDelta,
  total: number,
): PanelState {
  if (current.kind !== "stat_grid") return current;
  const prevState = current.state;
  let values: KpiCardState[];
  let deltas: KpiDelta[];
  if (prevState.kind === "stats") {
    values = prevState.values.slice();
    deltas = prevState.deltas.slice();
  } else {
    values = Array.from({ length: total }, () => ({ kind: "loading" } as KpiCardState));
    deltas = Array.from({ length: total }, () => ({ kind: "none" } as KpiDelta));
  }
  if (slot === "main") {
    values[statIdx] = next as KpiCardState;
  } else {
    deltas[statIdx] = next as KpiDelta;
  }
  return { kind: "stat_grid", state: { kind: "stats", values, deltas } };
}
