import { RefreshCw } from "lucide-react";
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
// document order. Each panel reports its own loading/error state so a
// bad SQL in one panel doesn't blank the rest of the dashboard.
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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/30">
      <div className="shrink-0 border-b border-border bg-background/60 px-6 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight text-foreground">
              {dashboard.title}
            </div>
            {dashboard.description ? (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {dashboard.description}
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            title="Re-run all queries"
          >
            <RefreshCw size={13} />
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          {dashboard.panels.map((panel, index) => (
            <PanelSlot
              // biome-ignore lint/suspicious/noArrayIndexKey: panel order is canonical
              key={index}
              panel={panel}
              state={panelStates[index]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PanelSlot({ panel, state }: { panel: DashboardPanel; state: PanelState }) {
  if (panel.type === "kpi") {
    return <KpiCard title={panel.title} state={state as KpiCardState} />;
  }
  return <DataViewPanel panel={panel} state={state as DataViewState} />;
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
