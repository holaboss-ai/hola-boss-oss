import type { ColorToken, ColumnFormat } from "@/lib/dashboardSchema";

// Single point-of-truth for value formatting used by every panel + view.
// Format names match the YAML grammar in dashboardSchema.ts.

export function formatValue(
  raw: unknown,
  format: ColumnFormat | undefined,
  options: { currency?: string; locale?: string } = {},
): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  const locale = options.locale ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
  switch (format) {
    case "integer": {
      const n = toNumber(raw);
      if (n === null) return String(raw);
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
    }
    case "number": {
      const n = toNumber(raw);
      if (n === null) return String(raw);
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
    }
    case "percent": {
      const n = toNumber(raw);
      if (n === null) return String(raw);
      // Convention: input is already 0-1. If it looks like a percentage
      // already (>1.5), assume the agent wrote it as a literal percentage.
      const value = n > 1.5 ? n / 100 : n;
      return new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    }
    case "currency": {
      const n = toNumber(raw);
      if (n === null) return String(raw);
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: options.currency ?? "USD",
        }).format(n);
      } catch {
        return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
      }
    }
    case "date": {
      const d = toDate(raw);
      if (!d) return String(raw);
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
    }
    case "datetime": {
      const d = toDate(raw);
      if (!d) return String(raw);
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(d);
    }
    case "duration": {
      const seconds = toNumber(raw);
      if (seconds === null) return String(raw);
      return formatDuration(seconds);
    }
    case "url":
    case "image_url":
    case "tag":
      return String(raw);
    default:
      return String(raw);
  }
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "bigint") return Number(raw);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Notion-style smart date: relative for recent, abbreviated absolute
// for older. Designed for tight chrome (board cards / list meta /
// chip-style stamps) where the full "Apr 30, 2026, 1:08 AM" is too
// long. Hover the rendered element for the full ISO via title.
//
//   < 1 minute  → "Just now"
//   < 1 hour    → "5m ago"
//   today       → "9:30 AM"
//   yesterday   → "Yesterday 9:30 AM"
//   < 7 days    → "Mon 9:30 AM"
//   same year   → "Apr 28"
//   older       → "Apr 28, 2024"
//   future +    → "in 5m" / "Tue 9:30 AM" / "Apr 28" mirror
export function formatSmartDate(
  raw: unknown,
  options: { locale?: string; now?: Date } = {},
): { text: string; full: string } | null {
  const d = toDate(raw);
  if (!d) return null;
  const locale = options.locale ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
  const now = options.now ?? new Date();

  const diffMs = now.getTime() - d.getTime();
  const future = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const min = Math.round(absMs / 60_000);
  const hour = Math.round(absMs / 3_600_000);
  const day = Math.round(absMs / 86_400_000);

  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
  const monthDay = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(d);
  const absolute = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
  const full = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);

  let text: string;
  if (future) {
    if (min < 1) text = "soon";
    else if (min < 60) text = `in ${min}m`;
    else if (hour < 24 && sameDay(d, now)) text = time;
    else if (sameDay(d, addDays(now, 1))) text = `Tomorrow ${time}`;
    else if (day < 7) text = `${weekday} ${time}`;
    else if (sameYear(d, now)) text = monthDay;
    else text = absolute;
  } else {
    if (min < 1) text = "Just now";
    else if (min < 60) text = `${min}m ago`;
    else if (hour < 24 && sameDay(d, now)) text = time;
    else if (sameDay(d, addDays(now, -1))) text = `Yesterday ${time}`;
    else if (day < 7) text = `${weekday} ${time}`;
    else if (sameYear(d, now)) text = monthDay;
    else text = absolute;
  }
  return { text, full };
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function sameYear(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear();
}
function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

// Auto-detect: returns true when a column name suggests a timestamp
// (ends in _at / _time / _date, or is one of the canonical ones).
// Used to apply formatSmartDate fallback in views that don't otherwise
// carry per-column format hints (board card_subtitle / list meta).
export function looksLikeDateColumn(name: string | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  if (n === "ts" || n === "at" || n === "when") return true;
  return /_(at|time|date)$/.test(n) || /^(updated|created|published|modified)$/.test(n);
}

function toDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;
  if (typeof raw === "number") {
    // Heuristic: 10-digit numbers are seconds, 13-digit are ms.
    const ms = raw > 1e11 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function formatDuration(seconds: number): string {
  if (seconds < 0) return "0s";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM === 0 ? `${h}h` : `${h}h ${remM}m`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH === 0 ? `${d}d` : `${d}d ${remH}h`;
}

// Right-align numerics by default; left-align text. Matches Notion / Lark
// table conventions.
export function defaultAlign(format: ColumnFormat | undefined): "left" | "right" | "center" {
  switch (format) {
    case "integer":
    case "number":
    case "percent":
    case "currency":
    case "duration":
      return "right";
    case "date":
    case "datetime":
      return "left";
    case "tag":
    case "url":
    case "image_url":
      return "left";
    default:
      return "left";
  }
}

// ----- Color token mapping ------------------------------------------

// Tailwind-class output keyed by token. Each token has an explicit
// light + dark mode pair so badges read clearly in both. When you add
// a new token here, also add it to dashboardSchema.ts COLOR_TOKENS.
const COLOR_CLASSES: Record<ColorToken, { badge: string; dot: string }> = {
  green: {
    badge: "bg-green-500/10 text-green-700 dark:bg-green-400/15 dark:text-green-300",
    dot: "bg-green-500/85 dark:bg-green-400/85",
  },
  yellow: {
    badge: "bg-yellow-500/10 text-yellow-800 dark:bg-yellow-400/15 dark:text-yellow-200",
    dot: "bg-yellow-500/85 dark:bg-yellow-400/85",
  },
  red: {
    badge: "bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300",
    dot: "bg-red-500/85 dark:bg-red-400/85",
  },
  blue: {
    badge: "bg-blue-500/10 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300",
    dot: "bg-blue-500/85 dark:bg-blue-400/85",
  },
  gray: {
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/70",
  },
  purple: {
    badge: "bg-purple-500/10 text-purple-700 dark:bg-purple-400/15 dark:text-purple-300",
    dot: "bg-purple-500/85 dark:bg-purple-400/85",
  },
  orange: {
    badge: "bg-orange-500/10 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300",
    dot: "bg-orange-500/85 dark:bg-orange-400/85",
  },
};

export function colorClasses(token: ColorToken | undefined): { badge: string; dot: string } {
  if (!token) return COLOR_CLASSES.gray;
  return COLOR_CLASSES[token] ?? COLOR_CLASSES.gray;
}

// Stable hash → palette pick. Used when no explicit colors map is
// provided but we still want consistent coloring (e.g. board column
// chips, calendar event dots) so repeat values across re-renders or
// across views read the same color.
export function hashToColor(value: string): ColorToken {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  const palette: ColorToken[] = ["blue", "green", "orange", "purple", "red", "yellow", "gray"];
  return palette[Math.abs(h) % palette.length];
}

// Substitutes `{{column}}` references in a URL template with the row's
// value. Missing columns become empty strings (link still renders, may
// 404 — agent's responsibility to author real templates).
export function resolveLinkTemplate(
  template: string,
  row: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_m, col) => {
    const v = row[col];
    if (v === null || v === undefined) return "";
    return encodeURI(String(v));
  });
}
