import { Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  type Dashboard,
  type DashboardPanel,
  parseDashboard,
} from "@/lib/dashboardSchema";

import { deriveKpiLabel, type KpiCardState, KpiCard } from "./KpiCard";
import { type DataViewState, DataViewPanel } from "./DataViewPanel";

interface DashboardRendererProps {
  workspaceId: string;
  content: string;
}

type PanelState = KpiCardState | DataViewState;

// Reads a `.dashboard` YAML doc, runs each panel's query against the
// workspace's shared data.db (read-only IPC), and renders panels in
// document order. Notion-styled: no surrounding card chrome on the
// page, generous whitespace, and consecutive KPI panels grouped into
// a single horizontal row so a Total/Published pair reads as a stat
// strip instead of two stacked blocks.
export function DashboardRenderer({
  workspaceId,
  content,
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

  return <DashboardBody workspaceId={workspaceId} dashboard={parsed.dashboard} />;
}

function DashboardBody({
  workspaceId,
  dashboard,
}: {
  workspaceId: string;
  dashboard: Dashboard;
}) {
  const [panelStates, setPanelStates] = useState<PanelState[]>(() =>
    dashboard.panels.map(() => ({ kind: "loading" })),
  );
  const [refreshKey, setRefreshKey] = useState(0);
  // Notion-style page-width toggle. Persists across sessions per
  // browser profile so the user's preferred reading width sticks.
  const [isFullWidth, setIsFullWidth] = useState<boolean>(() => {
    try {
      return localStorage.getItem("dashboardRenderer:fullWidth") === "1";
    } catch {
      return false;
    }
  });
  const toggleFullWidth = useCallback(() => {
    setIsFullWidth((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("dashboardRenderer:fullWidth", next ? "1" : "0");
      } catch {
        // ignore — quota / private mode
      }
      return next;
    });
  }, []);

  // Run all queries when the dashboard changes (file edited, new mount,
  // or refresh). Each result writes into its own slot so a slow query
  // doesn't block earlier rendering.
  useEffect(() => {
    let cancelled = false;
    setPanelStates(dashboard.panels.map(() => ({ kind: "loading" })));
    dashboard.panels.forEach((panel, index) => {
      void window.electronAPI.workspace
        .runDashboardQuery({ workspaceId, sql: panel.query })
        .then((result) => {
          if (cancelled) return;
          setPanelStates((prev) => {
            const next = prev.slice();
            next[index] = panelStateFromResult(panel, result);
            return next;
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          setPanelStates((prev) => {
            const next = prev.slice();
            next[index] = panelErrorState(panel, message);
            return next;
          });
        });
    });
    return () => {
      cancelled = true;
    };
  }, [dashboard, workspaceId, refreshKey]);

  const onRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const groups = useMemo(() => groupPanels(dashboard.panels), [dashboard.panels]);

  const widthClass = isFullWidth ? "max-w-none" : "max-w-4xl";

  return (
    <div className="h-full overflow-auto bg-background">
      <div className={`mx-auto px-10 pt-10 pb-16 ${widthClass}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {dashboard.title}
            </h1>
            {dashboard.description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {dashboard.description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleFullWidth}
              title={isFullWidth ? "Switch to compact width" : "Switch to full width"}
              aria-pressed={isFullWidth}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              {isFullWidth ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              {isFullWidth ? "Compact" : "Full width"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              title="Re-run all queries"
              className="-mr-2 gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw size={13} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-10">
          {groups.map((group, gIdx) => {
            if (group.kind === "kpi-row") {
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: panel order is canonical
                  key={`g-${gIdx}`}
                  className="grid gap-x-8 gap-y-4"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(group.indices.length, 4)}, minmax(0, 1fr))`,
                  }}
                >
                  {group.indices.map((panelIdx) => {
                    const panel = dashboard.panels[panelIdx] as Extract<
                      DashboardPanel,
                      { type: "kpi" }
                    >;
                    return (
                      <KpiCard
                        key={panelIdx}
                        title={panel.title}
                        state={panelStates[panelIdx] as KpiCardState}
                      />
                    );
                  })}
                </div>
              );
            }
            const panel = dashboard.panels[group.index];
            const state = panelStates[group.index];
            return (
              <DataViewPanel
                key={group.index}
                panel={panel as Extract<DashboardPanel, { type: "data_view" }>}
                state={state as DataViewState}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

type PanelGroup =
  | { kind: "kpi-row"; indices: number[] }
  | { kind: "panel"; index: number };

// Folds consecutive kpi panels into a single row group so two or more
// KPIs render side-by-side rather than as stacked blocks. Any panel
// that isn't a kpi gets its own slot.
function groupPanels(panels: DashboardPanel[]): PanelGroup[] {
  const out: PanelGroup[] = [];
  let runStart = -1;
  panels.forEach((panel, i) => {
    if (panel.type === "kpi") {
      if (runStart < 0) runStart = i;
      const next = panels[i + 1];
      if (!next || next.type !== "kpi") {
        const indices: number[] = [];
        for (let j = runStart; j <= i; j += 1) indices.push(j);
        out.push({ kind: "kpi-row", indices });
        runStart = -1;
      }
    } else {
      out.push({ kind: "panel", index: i });
    }
  });
  return out;
}

function panelStateFromResult(
  panel: DashboardPanel,
  result: DashboardQueryResult,
): PanelState {
  if (!result.ok) {
    return panelErrorState(panel, result.error);
  }
  if (panel.type === "kpi") {
    return { kind: "value", label: deriveKpiLabel(result.columns, result.rows) };
  }
  return { kind: "data", columns: result.columns, rows: result.rows };
}

function panelErrorState(panel: DashboardPanel, message: string): PanelState {
  if (panel.type === "kpi") {
    return { kind: "error", message };
  }
  return { kind: "error", message };
}
