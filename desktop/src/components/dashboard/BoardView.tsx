import type { BoardViewSpec } from "@/lib/dashboardSchema";

interface BoardViewProps {
  view: BoardViewSpec;
  columns: string[];
  rows: unknown[][];
}

// Read-only Kanban: rows are bucketed by distinct values of `group_by`,
// and each bucket renders its rows as cards using `card_title` (and the
// optional `card_subtitle`). Drag-to-update is intentionally out of
// scope for v1 — that would require write-back into the source app's
// table, which breaks the "dashboard is a read-only view" invariant.
export function BoardView({ view, columns, rows }: BoardViewProps) {
  const groupIdx = columns.indexOf(view.group_by);
  const titleIdx = columns.indexOf(view.card_title);
  const subtitleIdx = view.card_subtitle ? columns.indexOf(view.card_subtitle) : -1;

  if (groupIdx < 0) {
    return (
      <div className="px-5 py-6 text-xs text-destructive">
        Board: <code className="font-mono">group_by</code> column "{view.group_by}" not in query result.
      </div>
    );
  }
  if (titleIdx < 0) {
    return (
      <div className="px-5 py-6 text-xs text-destructive">
        Board: <code className="font-mono">card_title</code> column "{view.card_title}" not in query result.
      </div>
    );
  }

  const groups = new Map<string, unknown[][]>();
  for (const row of rows) {
    const raw = row[groupIdx];
    const key = raw === null || raw === undefined ? "—" : String(raw);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const ordered = Array.from(groups.entries());

  if (ordered.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-xs text-muted-foreground">
        Query returned no rows.
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto px-3 py-3">
      {ordered.map(([groupValue, groupRows]) => (
        <div
          key={groupValue}
          className="flex w-60 shrink-0 flex-col rounded-lg border border-border bg-muted/40"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {groupValue}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {groupRows.length}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 p-2">
            {groupRows.slice(0, 200).map((row, rIdx) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: SQL row order is the natural key
                key={rIdx}
                className="rounded-md border border-border bg-card px-2.5 py-2 text-xs shadow-xs"
              >
                <div className="line-clamp-3 text-foreground">{formatCell(row[titleIdx])}</div>
                {subtitleIdx >= 0 ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {formatCell(row[subtitleIdx])}
                  </div>
                ) : null}
              </div>
            ))}
            {groupRows.length > 200 ? (
              <div className="px-1 pt-0.5 text-[11px] text-muted-foreground">
                +{groupRows.length - 200} more
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
