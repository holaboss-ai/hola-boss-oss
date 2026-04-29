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

// Wraps a single panel's data in a Notion-style card: thin border,
// solid card surface, header with title + connected segmented view
// switcher, body with the active view's content. Selected view state
// is component-local — survives within the session, isn't persisted.
export function DataViewPanel({ panel, state }: DataViewPanelProps) {
  const [activeViewType, setActiveViewType] = useState<DataViewSpec["type"]>(
    () => resolveInitialView(panel).type,
  );
  const activeView =
    panel.views.find((v) => v.type === activeViewType) ?? panel.views[0];

  const rowCount =
    state.kind === "data" ? state.rows.length : null;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">
            {panel.title}
          </span>
          {rowCount !== null ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {rowCount}
            </span>
          ) : null}
        </div>
        {panel.views.length > 1 ? (
          <div className="flex shrink-0 items-center rounded-md border border-border bg-muted/40 p-0.5">
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
                  className={`grid size-6 place-items-center rounded transition-colors ${
                    active
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon size={13} strokeWidth={1.75} />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="max-h-[520px] overflow-auto px-4 pb-3">
        {state.kind === "loading" ? (
          <div className="grid place-items-center py-10 text-xs text-muted-foreground">
            Loading…
          </div>
        ) : state.kind === "error" ? (
          <div className="py-4 text-xs text-destructive">{state.message}</div>
        ) : activeView.type === "table" ? (
          <TableView view={activeView} columns={state.columns} rows={state.rows} />
        ) : (
          <BoardView view={activeView} columns={state.columns} rows={state.rows} />
        )}
      </div>
    </div>
  );
}
