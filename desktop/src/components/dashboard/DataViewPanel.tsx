import { useState } from "react";

import {
  type DataViewPanel as DataViewPanelSpec,
  type DataViewSpec,
  resolveInitialView,
} from "@/lib/dashboardSchema";

import { BoardView } from "./BoardView";
import { TableView } from "./TableView";

interface DataViewPanelProps {
  panel: DataViewPanelSpec;
  state: DataViewState;
}

export type DataViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "data"; columns: string[]; rows: unknown[][] };

const VIEW_LABELS: Record<DataViewSpec["type"], string> = {
  table: "Table",
  board: "Board",
};

// Wraps a single panel's data in a tab-bar header + active-view body.
// Selected view state is component-local: it survives re-renders within
// the session but isn't persisted to the .dashboard file. The tab bar
// only renders when the panel declares ≥ 2 views.
export function DataViewPanel({ panel, state }: DataViewPanelProps) {
  const [activeViewType, setActiveViewType] = useState<DataViewSpec["type"]>(
    () => resolveInitialView(panel).type,
  );
  const activeView =
    panel.views.find((v) => v.type === activeViewType) ?? panel.views[0];

  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="text-xs font-semibold tracking-wide text-foreground">
          {panel.title}
        </div>
        {panel.views.length > 1 ? (
          <div className="flex items-center gap-1 rounded-md border border-border bg-muted p-0.5">
            {panel.views.map((view) => {
              const active = view.type === activeViewType;
              return (
                <button
                  type="button"
                  key={view.type}
                  onClick={() => setActiveViewType(view.type)}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {VIEW_LABELS[view.type]}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="max-h-[480px] overflow-auto">
        {state.kind === "loading" ? (
          <div className="grid place-items-center px-5 py-12 text-xs text-muted-foreground">
            Running query…
          </div>
        ) : state.kind === "error" ? (
          <div className="px-5 py-6 text-xs text-destructive">{state.message}</div>
        ) : activeView.type === "table" ? (
          <TableView view={activeView} columns={state.columns} rows={state.rows} />
        ) : (
          <BoardView view={activeView} columns={state.columns} rows={state.rows} />
        )}
      </div>
    </div>
  );
}
