import type { TableViewSpec } from "@/lib/dashboardSchema";

interface TableViewProps {
  view: TableViewSpec;
  columns: string[];
  rows: unknown[][];
}

// Renders a panel's rows as a comfortable Notion-style table: roomy
// padding, larger row text, hairline borders, soft hover. The view's
// `columns` field, if set, scopes which columns are shown and in what
// order — missing columns are silently dropped.
export function TableView({ view, columns, rows }: TableViewProps) {
  const visible = pickColumns(view, columns);
  const displayRows = rows.slice(0, 500);

  if (visible.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-muted-foreground">
        No columns to display.
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-muted-foreground">
        No rows.
      </div>
    );
  }

  return (
    <div className="pt-1">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {visible.map((c) => (
              <th
                key={c.name}
                className="border-b border-border/70 px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground first:pl-1 last:pr-1"
              >
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, rIdx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: SQL row order is the natural key
            <tr
              key={rIdx}
              className="border-b border-border/40 transition-colors hover:bg-muted/70 last:border-b-0"
            >
              {visible.map((c) => (
                <td
                  key={c.name}
                  className="px-3 py-2.5 align-top leading-relaxed text-foreground first:pl-1 last:pr-1"
                >
                  {formatCell(row[c.index])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > displayRows.length ? (
        <div className="pt-3 text-[11px] text-muted-foreground">
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
