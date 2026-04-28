import type { TableViewSpec } from "@/lib/dashboardSchema";

interface TableViewProps {
  view: TableViewSpec;
  columns: string[];
  rows: unknown[][];
}

// Renders a panel's rows as a plain table. The view's `columns` field, if
// set, scopes which columns are shown and in what order — missing columns
// are silently dropped, extra rows of the result are pruned to a hard cap
// to keep huge tables from freezing the renderer.
export function TableView({ view, columns, rows }: TableViewProps) {
  const visible = pickColumns(view, columns);
  const displayRows = rows.slice(0, 500);

  if (visible.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-xs text-muted-foreground">
        No columns to display. Check the view's <code className="font-mono">columns</code> filter.
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-xs text-muted-foreground">
        Query returned no rows.
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-muted text-muted-foreground">
          <tr>
            {visible.map((c) => (
              <th
                key={c.name}
                className="border-b border-border px-3 py-2 text-left font-medium"
              >
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, rIdx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: SQL row order is the natural key
            <tr key={rIdx} className="even:bg-muted/30">
              {visible.map((c) => (
                <td key={c.name} className="border-b border-border/50 px-3 py-2 align-top text-foreground">
                  {formatCell(row[c.index])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > displayRows.length ? (
        <div className="px-3 py-2 text-[11px] text-muted-foreground">
          Showing {displayRows.length} of {rows.length} rows.
        </div>
      ) : null}
    </div>
  );
}

interface VisibleColumn {
  name: string;
  index: number;
}

function pickColumns(view: TableViewSpec, columns: string[]): VisibleColumn[] {
  if (!view.columns || view.columns.length === 0) {
    return columns.map((name, index) => ({ name, index }));
  }
  return view.columns
    .map((name) => ({ name, index: columns.indexOf(name) }))
    .filter((c) => c.index >= 0);
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
