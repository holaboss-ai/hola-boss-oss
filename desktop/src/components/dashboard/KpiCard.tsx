import type { ColumnFormat } from "@/lib/dashboardSchema";

import { formatValue } from "./format";

export type KpiCardState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "value"; raw: unknown }
  | { kind: "empty" };

interface KpiCardProps {
  title: string;
  description?: string;
  state: KpiCardState;
  /** Resolved delta state — when the panel ships a `delta_query`, the
   *  caller runs that query separately and threads its result here. */
  delta?: KpiDelta;
  format?: ColumnFormat;
  currency?: string;
  /** Optional progress target. Renders a thin bar under the value. */
  target?: number;
  /** Tighter card chrome for stat_grid usage; default false uses the
   *  v1 inline layout that DashboardRenderer wraps in a kpi-row. */
  compact?: boolean;
}

export type KpiDelta =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "value"; raw: unknown }
  | { kind: "none" };

// Pulls the typed `value` cell from a query result.
export function deriveKpiValue(columns: string[], rows: unknown[][]): unknown {
  if (rows.length === 0) return null;
  const valueIdx = columns.findIndex((c) => c.toLowerCase() === "value");
  const idx = valueIdx >= 0 ? valueIdx : 0;
  return rows[0]?.[idx] ?? null;
}

export function KpiCard({
  title,
  description,
  state,
  delta,
  format,
  currency,
  target,
  compact = false,
}: KpiCardProps) {
  const valueText =
    state.kind === "value"
      ? formatValue(state.raw, format, { currency })
      : state.kind === "empty"
        ? "—"
        : null;

  const deltaInfo = computeDeltaInfo(state, delta, format, currency);
  const progress = computeProgress(state, target);

  return (
    <div className={compact ? "px-4 py-2" : "px-1 py-1"}>
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="mt-2 flex min-h-[2rem] items-baseline gap-2.5">
        {state.kind === "loading" ? (
          <div
            className={`animate-shimmer rounded-md bg-fg-6 ${
              compact ? "h-7 w-20" : "h-8 w-28"
            }`}
            aria-busy
            aria-label="Loading"
          />
        ) : state.kind === "error" ? (
          <div className="truncate text-xs text-destructive" title={state.message}>
            {state.message}
          </div>
        ) : (
          <>
            <span
              className={`font-mono tabular-nums tracking-tight text-foreground ${
                compact ? "text-2xl font-semibold" : "text-3xl font-semibold leading-none"
              }`}
            >
              {valueText}
            </span>
            {deltaInfo ? (
              <span
                className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${deltaInfo.classes}`}
                title={deltaInfo.title}
              >
                <span aria-hidden>{deltaInfo.arrow}</span>
                {deltaInfo.text}
              </span>
            ) : null}
          </>
        )}
      </div>
      {description ? (
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {description}
        </div>
      ) : null}
      {progress ? (
        <div className="mt-2.5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-foreground transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(0, Math.min(100, progress.pct))}%` }}
            />
          </div>
          <div className="mt-1 text-[10.5px] tabular-nums text-muted-foreground">
            {progress.label}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function computeDeltaInfo(
  state: KpiCardState,
  delta: KpiDelta | undefined,
  format: ColumnFormat | undefined,
  currency: string | undefined,
): { text: string; arrow: string; classes: string; title: string } | null {
  if (!delta || state.kind !== "value") return null;
  if (delta.kind !== "value") return null;
  const current = toFiniteNumber(state.raw);
  const prior = toFiniteNumber(delta.raw);
  if (current === null || prior === null) return null;
  if (prior === 0 && current === 0) return null;
  const absChange = current - prior;
  if (prior === 0) {
    // Can't compute % vs 0; show absolute delta instead.
    const arrow = absChange > 0 ? "↑" : absChange < 0 ? "↓" : "→";
    const text = formatValue(Math.abs(absChange), format, { currency });
    const classes =
      absChange > 0
        ? "bg-green-500/10 text-green-700 dark:bg-green-400/15 dark:text-green-300"
        : absChange < 0
          ? "bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300"
          : "bg-muted text-muted-foreground";
    return {
      text,
      arrow,
      classes,
      title: `vs prior ${formatValue(prior, format, { currency })}`,
    };
  }
  const ratio = absChange / Math.abs(prior);
  const arrow = ratio > 0 ? "↑" : ratio < 0 ? "↓" : "→";
  const pct = `${Math.abs(ratio * 100).toFixed(ratio === 0 ? 0 : 1)}%`;
  const classes =
    ratio > 0
      ? "bg-green-500/10 text-green-700 dark:bg-green-400/15 dark:text-green-300"
      : ratio < 0
        ? "bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300"
        : "bg-muted text-muted-foreground";
  return {
    text: pct,
    arrow,
    classes,
    title: `vs prior ${formatValue(prior, format, { currency })}`,
  };
}

function computeProgress(
  state: KpiCardState,
  target: number | undefined,
): { pct: number; label: string } | null {
  if (!target || target <= 0) return null;
  if (state.kind !== "value") return null;
  const current = toFiniteNumber(state.raw);
  if (current === null) return null;
  const pct = (current / target) * 100;
  const targetText = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(target);
  const currentText = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(current);
  return { pct, label: `${currentText} of ${targetText} target` };
}

function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "bigint") return Number(raw);
  if (typeof raw === "string") {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
