import type { TableViewSpec } from "@/lib/dashboardSchema";

import { isStatusColumn, StatusBadge } from "./StatusBadge";

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
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          {visible.map((c) => (
            <col
              key={c.name}
              className={c.isStatus ? "w-[140px]" : undefined}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {visible.map((c) => (
              <th
                key={c.name}
                className="border-b border-border/70 px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground first:pl-1 last:pr-1"
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
                <Cell key={c.name} column={c} value={row[c.index]} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > displayRows.length ? (
        <div className="pt-3 text-xs text-muted-foreground">
          Showing {displayRows.length} of {rows.length} rows.
        </div>
      ) : null}
    </div>
  );
}

interface VisibleColumn {
  name: string;
  index: number;
  isStatus: boolean;
}

function pickColumns(view: TableViewSpec, columns: string[]): VisibleColumn[] {
  if (!view.columns || view.columns.length === 0) {
    return columns.map((name, index) => ({
      name,
      index,
      isStatus: isStatusColumn(name),
    }));
  }
  return view.columns
    .map((name) => ({ name, index: columns.indexOf(name), isStatus: isStatusColumn(name) }))
    .filter((c) => c.index >= 0);
}

function Cell({ column, value }: { column: VisibleColumn; value: unknown }) {
  if (column.isStatus) {
    return (
      <td className="px-3 py-2 align-top first:pl-1 last:pr-1">
        <StatusBadge value={formatCell(value)} />
      </td>
    );
  }
  const text = formatCell(value);
  // Long text gets a 2-line clamp + native title tooltip so the table
  // doesn't blow up vertically. Short text falls through to a single
  // line of relaxed leading.
  const isLong = text.length > 80;
  return (
    <td
      className="px-3 py-2.5 align-top text-foreground first:pl-1 last:pr-1"
    >
      {isLong ? (
        <span
          className="line-clamp-2 leading-snug"
          title={text}
        >
          {text}
        </span>
      ) : (
        <span className="leading-relaxed">{text}</span>
      )}
    </td>
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
