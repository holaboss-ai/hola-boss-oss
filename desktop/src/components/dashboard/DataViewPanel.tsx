import { Columns3, type LucideIcon, Table2 } from "lucide-react";
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

const VIEW_META: Record<DataViewSpec["type"], { label: string; icon: LucideIcon }> = {
  table: { label: "Table", icon: Table2 },
  board: { label: "Board", icon: Columns3 },
};

// Wraps a single panel's data with a Notion-style header (title + view
// switcher as underlined text tabs) and the active view's content.
// Selected view state is component-local: it survives re-renders within
// the session but isn't persisted to the .dashboard file.
export function DataViewPanel({ panel, state }: DataViewPanelProps) {
  const [activeViewType, setActiveViewType] = useState<DataViewSpec["type"]>(
    () => resolveInitialView(panel).type,
  );
  const activeView =
    panel.views.find((v) => v.type === activeViewType) ?? panel.views[0];

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
        <div className="text-sm font-semibold tracking-tight text-foreground">
          {panel.title}
        </div>
        {panel.views.length > 1 ? (
          <div className="flex items-center gap-1">
            {panel.views.map((view) => {
              const active = view.type === activeViewType;
              const meta = VIEW_META[view.type];
              const Icon = meta.icon;
              return (
                <button
                  type="button"
                  key={view.type}
                  onClick={() => setActiveViewType(view.type)}
                  title={meta.label}
                  aria-label={`${meta.label} view`}
                  aria-pressed={active}
                  className={`grid size-7 place-items-center rounded-md transition-colors ${
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon size={14} strokeWidth={1.75} />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="max-h-[520px] overflow-auto">
        {state.kind === "loading" ? (
          <div className="grid place-items-center px-1 py-10 text-xs text-muted-foreground">
            Loading…
          </div>
        ) : state.kind === "error" ? (
          <div className="px-1 py-4 text-xs text-destructive">{state.message}</div>
        ) : activeView.type === "table" ? (
          <TableView view={activeView} columns={state.columns} rows={state.rows} />
        ) : (
          <BoardView view={activeView} columns={state.columns} rows={state.rows} />
        )}
      </div>
    </div>
  );
}
