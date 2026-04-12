import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SpreadsheetEditorProps {
  sheets: FilePreviewTableSheetPayload[];
  activeSheetIndex: number;
  onActiveSheetIndexChange: (index: number) => void;
  editable?: boolean;
  readOnlyReason?: string | null;
  onChange?: (sheets: FilePreviewTableSheetPayload[]) => void;
}

export function cloneTablePreviewSheets(
  sheets: FilePreviewTableSheetPayload[] | null | undefined,
): FilePreviewTableSheetPayload[] {
  return Array.isArray(sheets)
    ? sheets.map((sheet) => ({
        ...sheet,
        columns: [...sheet.columns],
        rows: sheet.rows.map((row) => [...row]),
      }))
    : [];
}

export function areTablePreviewSheetsEqual(
  left: FilePreviewTableSheetPayload[] | null | undefined,
  right: FilePreviewTableSheetPayload[] | null | undefined,
): boolean {
  const normalizedLeft = cloneTablePreviewSheets(left);
  const normalizedRight = cloneTablePreviewSheets(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((sheet, sheetIndex) => {
    const candidate = normalizedRight[sheetIndex];
    if (!candidate) {
      return false;
    }
    if (
      sheet.name !== candidate.name ||
      sheet.index !== candidate.index ||
      sheet.totalRows !== candidate.totalRows ||
      sheet.totalColumns !== candidate.totalColumns ||
      sheet.truncated !== candidate.truncated ||
      sheet.hasHeaderRow !== candidate.hasHeaderRow ||
      sheet.columns.length !== candidate.columns.length ||
      sheet.rows.length !== candidate.rows.length
    ) {
      return false;
    }

    return (
      sheet.columns.every((column, columnIndex) => column === candidate.columns[columnIndex]) &&
      sheet.rows.every(
        (row, rowIndex) =>
          row.length === candidate.rows[rowIndex]?.length &&
          row.every((value, columnIndex) => value === candidate.rows[rowIndex]?.[columnIndex]),
      )
    );
  });
}

function nextSpreadsheetColumnName(columnCount: number) {
  return `Column ${columnCount + 1}`;
}

function updateSpreadsheetSheets(
  sheets: FilePreviewTableSheetPayload[],
  updateSheet: (
    sheet: FilePreviewTableSheetPayload,
  ) => FilePreviewTableSheetPayload,
  targetSheetIndex: number,
) {
  return sheets.map((sheet, sheetIndex) =>
    sheetIndex === targetSheetIndex ? updateSheet(sheet) : sheet,
  );
}

export function SpreadsheetEditor({
  sheets,
  activeSheetIndex,
  onActiveSheetIndexChange,
  editable = false,
  readOnlyReason = null,
  onChange,
}: SpreadsheetEditorProps) {
  const activeSheet =
    sheets[Math.min(activeSheetIndex, Math.max(sheets.length - 1, 0))] ?? null;

  const updateHeaderValue = (columnIndex: number, value: string) => {
    if (!editable || !onChange || !activeSheet) {
      return;
    }
    onChange(
      updateSpreadsheetSheets(
        sheets,
        (sheet) => {
          const nextColumns = [...sheet.columns];
          nextColumns[columnIndex] = value;
          return {
            ...sheet,
            columns: nextColumns,
          };
        },
        activeSheetIndex,
      ),
    );
  };

  const updateCellValue = (
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) => {
    if (!editable || !onChange || !activeSheet) {
      return;
    }
    onChange(
      updateSpreadsheetSheets(
        sheets,
        (sheet) => {
          const nextRows = sheet.rows.map((row) => [...row]);
          const nextRow = [...(nextRows[rowIndex] ?? [])];
          nextRow[columnIndex] = value;
          while (nextRow.length < sheet.columns.length) {
            nextRow.push("");
          }
          nextRows[rowIndex] = nextRow;
          return {
            ...sheet,
            rows: nextRows,
          };
        },
        activeSheetIndex,
      ),
    );
  };

  const addRow = () => {
    if (!editable || !onChange || !activeSheet) {
      return;
    }
    onChange(
      updateSpreadsheetSheets(
        sheets,
        (sheet) => ({
          ...sheet,
          rows: [
            ...sheet.rows,
            Array.from({ length: Math.max(sheet.columns.length, 1) }, () => ""),
          ],
          totalRows: Math.max(sheet.totalRows + 1, sheet.rows.length + 1),
        }),
        activeSheetIndex,
      ),
    );
  };

  const addColumn = () => {
    if (!editable || !onChange || !activeSheet) {
      return;
    }
    onChange(
      updateSpreadsheetSheets(
        sheets,
        (sheet) => {
          const nextColumns = [
            ...sheet.columns,
            nextSpreadsheetColumnName(sheet.columns.length),
          ];
          const nextRows = sheet.rows.map((row) => [...row, ""]);
          return {
            ...sheet,
            columns: nextColumns,
            rows: nextRows,
            totalColumns: Math.max(
              sheet.totalColumns + 1,
              sheet.columns.length + 1,
            ),
          };
        },
        activeSheetIndex,
      ),
    );
  };

  if (!activeSheet) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="text-xs text-muted-foreground">
          No sheet data is available for this preview.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-muted">
      {sheets.length > 1 ? (
        <div className="chat-scrollbar-hidden flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-2">
          {sheets.map((sheet, index) => {
            const isActive = index === activeSheetIndex;
            return (
              <button
                key={`${sheet.name}-${sheet.index}`}
                type="button"
                onClick={() => onActiveSheetIndexChange(index)}
                className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  isActive
                    ? "border-primary/35 bg-primary/12 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {sheet.name}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/70 px-3 py-2">
        <div className="text-[11px] text-muted-foreground">
          {activeSheet.rows.length} visible rows
          {" · "}
          {activeSheet.columns.length} visible columns
          {activeSheet.truncated ? " · Preview trimmed" : ""}
          {!editable && readOnlyReason ? ` · ${readOnlyReason}` : ""}
        </div>
        {editable ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={addColumn}
            >
              <Plus size={11} />
              Column
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={addRow}>
              <Plus size={11} />
              Row
            </Button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-background">
        <table className="w-max min-w-full border-collapse text-xs text-foreground">
          <thead className="sticky top-0 z-[1] bg-background/95 backdrop-blur-sm">
            <tr>
              <th className="sticky left-0 z-[2] border-b border-r border-border bg-background/95 px-2 py-1.5 text-left text-[11px] text-muted-foreground backdrop-blur-sm">
                #
              </th>
              {activeSheet.columns.map((column, columnIndex) => (
                <th
                  key={`${column}-${columnIndex}`}
                  className="min-w-[164px] border-b border-r border-border bg-background/95 px-0 py-0 text-left text-[11px] text-muted-foreground backdrop-blur-sm"
                >
                  {activeSheet.hasHeaderRow && editable ? (
                    <input
                      value={column}
                      onChange={(event) =>
                        updateHeaderValue(columnIndex, event.target.value)
                      }
                      aria-label={`Column ${columnIndex + 1}`}
                      className="embedded-input h-9 w-full border-0 bg-transparent px-3 text-[11px] font-medium text-foreground outline-none"
                    />
                  ) : (
                    <div className="px-3 py-2 font-medium text-foreground/88">
                      {column}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeSheet.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={activeSheet.columns.length + 1}
                  className="px-3 py-8 text-center text-xs text-muted-foreground"
                >
                  {editable
                    ? "No rows yet. Add a row to start editing."
                    : "No rows in this sheet."}
                </td>
              </tr>
            ) : (
              activeSheet.rows.map((row, rowIndex) => (
                <tr
                  key={`row-${rowIndex}`}
                  className="odd:bg-background even:bg-muted/10"
                >
                  <td className="sticky left-0 border-b border-r border-border bg-inherit px-2 py-1.5 align-top text-[11px] text-muted-foreground">
                    {rowIndex + 1}
                  </td>
                  {activeSheet.columns.map((_column, columnIndex) => {
                    const value = row[columnIndex] ?? "";
                    return (
                      <td
                        key={`cell-${rowIndex}-${columnIndex}`}
                        className="min-w-[164px] border-b border-r border-border px-0 py-0 align-top"
                      >
                        {editable ? (
                          <input
                            value={value}
                            onChange={(event) =>
                              updateCellValue(
                                rowIndex,
                                columnIndex,
                                event.target.value,
                              )
                            }
                            aria-label={`Row ${rowIndex + 1}, Column ${columnIndex + 1}`}
                            className="embedded-input h-9 w-full border-0 bg-transparent px-3 text-xs text-foreground outline-none"
                          />
                        ) : (
                          <div className="px-3 py-2 break-words whitespace-pre-wrap">
                            {value || "\u00a0"}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
