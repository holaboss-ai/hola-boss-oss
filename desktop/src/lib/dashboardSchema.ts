import { parse as parseYaml } from "yaml";

// `.dashboard` file format — see docs/plans/2026-04-30-dashboard-v2-design.md.
//
// v2 panel kinds: kpi, stat_grid, chart (renderer in a follow-up PR),
// data_view, text. Views inside data_view: table, board, list, gallery,
// calendar, timeline.

// ----- Shared formats and color tokens -----------------------------

export type ColumnFormat =
  | "integer"
  | "number"
  | "percent"
  | "currency"
  | "date"
  | "datetime"
  | "duration"
  | "url"
  | "tag"
  | "image_url";

export type ColorToken =
  | "green"
  | "yellow"
  | "red"
  | "blue"
  | "gray"
  | "purple"
  | "orange";

const COLOR_TOKENS: ReadonlySet<ColorToken> = new Set([
  "green",
  "yellow",
  "red",
  "blue",
  "gray",
  "purple",
  "orange",
]);

export type Width = "full" | "half" | "third";

const WIDTHS: ReadonlySet<Width> = new Set(["full", "half", "third"]);

// ----- Panel kinds --------------------------------------------------

export interface PanelBase {
  title?: string;
  description?: string;
  empty_state?: string;
  width?: Width;
  refresh_interval_s?: number;
}

export interface KpiPanel extends PanelBase {
  type: "kpi";
  title: string;
  query: string;
  format?: ColumnFormat;
  currency?: string;
  delta_query?: string;
  target?: number;
}

export interface StatSpec {
  label: string;
  query: string;
  format?: ColumnFormat;
  currency?: string;
  delta_query?: string;
}

export interface StatGridPanel extends PanelBase {
  type: "stat_grid";
  title: string;
  columns?: 2 | 3 | 4;
  stats: StatSpec[];
}

// chart subtypes — kept declared so the renderer can show a "coming
// soon" stub gracefully and the validator can already accept files
// authored against the v2 spec. Full ChartPanel renderer ships in PR2.
export interface ChartPanel extends PanelBase {
  type: "chart";
  title: string;
  query: string;
  chart: ChartSpec;
}

export type ChartSpec =
  | {
      kind: "line" | "bar" | "area";
      x: string;
      y: string[];
      stacked?: boolean;
      x_format?: "date" | "datetime" | "text";
      y_format?: "integer" | "number" | "percent" | "currency" | "duration";
      legend?: boolean;
    }
  | {
      kind: "pie" | "donut";
      label: string;
      value: string;
      sort_desc?: boolean;
      max_slices?: number;
    };

export interface TextPanel extends PanelBase {
  type: "text";
  body: string;
}

// ----- View specs ---------------------------------------------------

export interface TableColumnSpec {
  name: string;
  label?: string;
  format?: ColumnFormat;
  currency?: string;
  align?: "left" | "center" | "right";
  width?: number;
  colors?: Record<string, ColorToken>;
  // URL template — `{{column}}` substitutes the row value.
  link?: string;
}

export interface TableViewSpec {
  type: "table";
  columns?: Array<string | TableColumnSpec>;
}

export interface BoardViewSpec {
  type: "board";
  group_by: string;
  card_title: string;
  card_subtitle?: string;
  card_meta?: string;
  group_order?: string[];
  group_colors?: Record<string, ColorToken>;
}

export interface ListViewSpec {
  type: "list";
  primary: string;
  secondary?: string;
  meta?: string;
}

export interface GalleryViewSpec {
  type: "gallery";
  cover?: string;
  title: string;
  subtitle?: string;
  meta?: string;
  card_size?: "small" | "medium" | "large";
}

export interface CalendarViewSpec {
  type: "calendar";
  date: string;
  title: string;
  color_by?: string;
  colors?: Record<string, ColorToken>;
}

export interface TimelineViewSpec {
  type: "timeline";
  start: string;
  end?: string;
  label: string;
  group_by?: string;
  colors?: Record<string, ColorToken>;
}

export type DataViewSpec =
  | TableViewSpec
  | BoardViewSpec
  | ListViewSpec
  | GalleryViewSpec
  | CalendarViewSpec
  | TimelineViewSpec;

export interface DataViewPanel extends PanelBase {
  type: "data_view";
  title: string;
  query: string;
  views: DataViewSpec[];
  default_view?: DataViewSpec["type"];
}

export type DashboardPanel =
  | KpiPanel
  | StatGridPanel
  | ChartPanel
  | DataViewPanel
  | TextPanel;

export interface Dashboard {
  title: string;
  description?: string;
  panels: DashboardPanel[];
}

export interface DashboardParseResult {
  ok: boolean;
  dashboard?: Dashboard;
  error?: string;
}

// ----- Parser -------------------------------------------------------

export function parseDashboard(content: string): DashboardParseResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (err) {
    return {
      ok: false,
      error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "Dashboard root must be a mapping (key/value pairs)." };
  }
  const title = stringField(parsed, "title");
  if (!title) return { ok: false, error: "Missing required field: `title`." };
  const description = optionalStringField(parsed, "description");
  const rawPanels = parsed.panels;
  if (!Array.isArray(rawPanels) || rawPanels.length === 0) {
    return { ok: false, error: "Missing or empty `panels` list." };
  }
  const panels: DashboardPanel[] = [];
  for (let i = 0; i < rawPanels.length; i += 1) {
    const r = parsePanel(rawPanels[i], i);
    if (!r.ok || !r.panel) return { ok: false, error: r.error ?? `panel #${i + 1} is invalid.` };
    panels.push(r.panel);
  }
  return {
    ok: true,
    dashboard: {
      title,
      ...(description ? { description } : {}),
      panels,
    },
  };
}

function parsePanel(
  raw: unknown,
  index: number,
): { ok: boolean; panel?: DashboardPanel; error?: string } {
  if (!isRecord(raw)) return { ok: false, error: `panel #${index + 1} must be a mapping.` };

  const type = stringField(raw, "type");
  const base = parsePanelBase(raw);

  if (type === "kpi") {
    const title = stringField(raw, "title");
    const query = stringField(raw, "query");
    if (!title) return { ok: false, error: `panel #${index + 1}: kpi missing \`title\`.` };
    if (!query) return { ok: false, error: `panel #${index + 1}: kpi missing \`query\`.` };
    const format = parseFormat(raw.format);
    const currency = optionalStringField(raw, "currency");
    const deltaQuery = optionalStringField(raw, "delta_query");
    const target = parseNumberField(raw.target);
    return {
      ok: true,
      panel: {
        type: "kpi",
        title,
        query,
        ...(format ? { format } : {}),
        ...(currency ? { currency } : {}),
        ...(deltaQuery ? { delta_query: deltaQuery } : {}),
        ...(target !== null ? { target } : {}),
        ...base,
      },
    };
  }

  if (type === "stat_grid") {
    const title = stringField(raw, "title");
    if (!title) return { ok: false, error: `panel #${index + 1}: stat_grid missing \`title\`.` };
    const cols = raw.columns;
    const columns =
      cols === 2 || cols === 3 || cols === 4 ? (cols as 2 | 3 | 4) : undefined;
    const rawStats = raw.stats;
    if (!Array.isArray(rawStats) || rawStats.length === 0) {
      return {
        ok: false,
        error: `panel #${index + 1}: stat_grid requires at least one entry in \`stats\`.`,
      };
    }
    const stats: StatSpec[] = [];
    for (let s = 0; s < rawStats.length; s += 1) {
      const sr = rawStats[s];
      if (!isRecord(sr)) {
        return {
          ok: false,
          error: `panel #${index + 1}, stat #${s + 1}: must be a mapping.`,
        };
      }
      const label = stringField(sr, "label");
      const query = stringField(sr, "query");
      if (!label || !query) {
        return {
          ok: false,
          error: `panel #${index + 1}, stat #${s + 1}: missing \`label\` or \`query\`.`,
        };
      }
      const format = parseFormat(sr.format);
      const currency = optionalStringField(sr, "currency");
      const deltaQuery = optionalStringField(sr, "delta_query");
      stats.push({
        label,
        query,
        ...(format ? { format } : {}),
        ...(currency ? { currency } : {}),
        ...(deltaQuery ? { delta_query: deltaQuery } : {}),
      });
    }
    return {
      ok: true,
      panel: {
        type: "stat_grid",
        title,
        ...(columns ? { columns } : {}),
        stats,
        ...base,
      },
    };
  }

  if (type === "text") {
    const body = stringField(raw, "body");
    if (!body) return { ok: false, error: `panel #${index + 1}: text missing \`body\`.` };
    return { ok: true, panel: { type: "text", body, ...base } };
  }

  if (type === "chart") {
    const title = stringField(raw, "title");
    const query = stringField(raw, "query");
    if (!title) return { ok: false, error: `panel #${index + 1}: chart missing \`title\`.` };
    if (!query) return { ok: false, error: `panel #${index + 1}: chart missing \`query\`.` };
    const chartSpec = parseChartSpec(raw.chart);
    if (!chartSpec) {
      return {
        ok: false,
        error: `panel #${index + 1}: chart missing or invalid \`chart\` config.`,
      };
    }
    return { ok: true, panel: { type: "chart", title, query, chart: chartSpec, ...base } };
  }

  if (type === "data_view") {
    const title = stringField(raw, "title");
    const query = stringField(raw, "query");
    if (!title) return { ok: false, error: `panel #${index + 1}: data_view missing \`title\`.` };
    if (!query) return { ok: false, error: `panel #${index + 1}: data_view missing \`query\`.` };
    const rawViews = raw.views;
    if (!Array.isArray(rawViews) || rawViews.length === 0) {
      return {
        ok: false,
        error: `panel #${index + 1}: data_view requires at least one entry in \`views\`.`,
      };
    }
    const views: DataViewSpec[] = [];
    for (let v = 0; v < rawViews.length; v += 1) {
      const view = parseView(rawViews[v]);
      if (!view) {
        return {
          ok: false,
          error: `panel #${index + 1}, view #${v + 1}: invalid view definition.`,
        };
      }
      views.push(view);
    }
    const defaultView = optionalStringField(raw, "default_view") as
      | DataViewSpec["type"]
      | undefined;
    return {
      ok: true,
      panel: {
        type: "data_view",
        title,
        query,
        views,
        ...(defaultView ? { default_view: defaultView } : {}),
        ...base,
      },
    };
  }

  return {
    ok: false,
    error: `panel #${index + 1}: unknown \`type\` "${type ?? ""}". Expected kpi | stat_grid | chart | data_view | text.`,
  };
}

function parsePanelBase(raw: Record<string, unknown>): PanelBase {
  const description = optionalStringField(raw, "description");
  const empty = optionalStringField(raw, "empty_state");
  const widthRaw = optionalStringField(raw, "width");
  const width = widthRaw && WIDTHS.has(widthRaw as Width) ? (widthRaw as Width) : undefined;
  const refresh = parseNumberField(raw.refresh_interval_s);
  return {
    ...(description ? { description } : {}),
    ...(empty ? { empty_state: empty } : {}),
    ...(width ? { width } : {}),
    ...(refresh !== null && refresh >= 30 ? { refresh_interval_s: refresh } : {}),
  };
}

function parseView(raw: unknown): DataViewSpec | null {
  if (!isRecord(raw)) return null;
  const type = stringField(raw, "type");
  if (type === "table") {
    const columns = parseTableColumns(raw.columns);
    return { type: "table", ...(columns && columns.length > 0 ? { columns } : {}) };
  }
  if (type === "board") {
    const groupBy = stringField(raw, "group_by");
    const cardTitle = stringField(raw, "card_title");
    if (!groupBy || !cardTitle) return null;
    const cardSubtitle = optionalStringField(raw, "card_subtitle");
    const cardMeta = optionalStringField(raw, "card_meta");
    const groupOrder = Array.isArray(raw.group_order)
      ? (raw.group_order.filter((s) => typeof s === "string") as string[])
      : undefined;
    const groupColors = parseColorMap(raw.group_colors);
    return {
      type: "board",
      group_by: groupBy,
      card_title: cardTitle,
      ...(cardSubtitle ? { card_subtitle: cardSubtitle } : {}),
      ...(cardMeta ? { card_meta: cardMeta } : {}),
      ...(groupOrder ? { group_order: groupOrder } : {}),
      ...(groupColors ? { group_colors: groupColors } : {}),
    };
  }
  if (type === "list") {
    const primary = stringField(raw, "primary");
    if (!primary) return null;
    return {
      type: "list",
      primary,
      ...(optionalStringField(raw, "secondary")
        ? { secondary: optionalStringField(raw, "secondary")! }
        : {}),
      ...(optionalStringField(raw, "meta")
        ? { meta: optionalStringField(raw, "meta")! }
        : {}),
    };
  }
  if (type === "gallery") {
    const title = stringField(raw, "title");
    if (!title) return null;
    const sizeRaw = optionalStringField(raw, "card_size");
    const cardSize =
      sizeRaw === "small" || sizeRaw === "medium" || sizeRaw === "large" ? sizeRaw : undefined;
    return {
      type: "gallery",
      title,
      ...(optionalStringField(raw, "cover")
        ? { cover: optionalStringField(raw, "cover")! }
        : {}),
      ...(optionalStringField(raw, "subtitle")
        ? { subtitle: optionalStringField(raw, "subtitle")! }
        : {}),
      ...(optionalStringField(raw, "meta") ? { meta: optionalStringField(raw, "meta")! } : {}),
      ...(cardSize ? { card_size: cardSize } : {}),
    };
  }
  if (type === "calendar") {
    const date = stringField(raw, "date");
    const title = stringField(raw, "title");
    if (!date || !title) return null;
    const colorBy = optionalStringField(raw, "color_by");
    const colors = parseColorMap(raw.colors);
    return {
      type: "calendar",
      date,
      title,
      ...(colorBy ? { color_by: colorBy } : {}),
      ...(colors ? { colors } : {}),
    };
  }
  if (type === "timeline") {
    const start = stringField(raw, "start");
    const label = stringField(raw, "label");
    if (!start || !label) return null;
    const end = optionalStringField(raw, "end");
    const groupBy = optionalStringField(raw, "group_by");
    const colors = parseColorMap(raw.colors);
    return {
      type: "timeline",
      start,
      label,
      ...(end ? { end } : {}),
      ...(groupBy ? { group_by: groupBy } : {}),
      ...(colors ? { colors } : {}),
    };
  }
  return null;
}

function parseTableColumns(raw: unknown): Array<string | TableColumnSpec> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<string | TableColumnSpec> = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed) out.push(trimmed);
      continue;
    }
    if (isRecord(entry)) {
      const name = stringField(entry, "name");
      if (!name) continue;
      const format = parseFormat(entry.format);
      const currency = optionalStringField(entry, "currency");
      const alignRaw = optionalStringField(entry, "align");
      const align =
        alignRaw === "left" || alignRaw === "center" || alignRaw === "right" ? alignRaw : undefined;
      const width = parseNumberField(entry.width);
      const colors = parseColorMap(entry.colors);
      const link = optionalStringField(entry, "link");
      const label = optionalStringField(entry, "label");
      out.push({
        name,
        ...(label ? { label } : {}),
        ...(format ? { format } : {}),
        ...(currency ? { currency } : {}),
        ...(align ? { align } : {}),
        ...(width !== null ? { width } : {}),
        ...(colors ? { colors } : {}),
        ...(link ? { link } : {}),
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function parseColorMap(raw: unknown): Record<string, ColorToken> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, ColorToken> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && COLOR_TOKENS.has(v as ColorToken)) {
      out[k] = v as ColorToken;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseFormat(raw: unknown): ColumnFormat | undefined {
  if (typeof raw !== "string") return undefined;
  const allowed: ColumnFormat[] = [
    "integer",
    "number",
    "percent",
    "currency",
    "date",
    "datetime",
    "duration",
    "url",
    "tag",
    "image_url",
  ];
  return (allowed as string[]).includes(raw) ? (raw as ColumnFormat) : undefined;
}

function parseChartSpec(raw: unknown): ChartSpec | null {
  if (!isRecord(raw)) return null;
  const kind = stringField(raw, "kind");
  if (kind === "line" || kind === "bar" || kind === "area") {
    const x = stringField(raw, "x");
    if (!x) return null;
    const yRaw = raw.y;
    let y: string[] | null = null;
    if (typeof yRaw === "string") y = [yRaw];
    else if (Array.isArray(yRaw)) y = yRaw.filter((v) => typeof v === "string") as string[];
    if (!y || y.length === 0) return null;
    const xFormatRaw = optionalStringField(raw, "x_format");
    const xFormat =
      xFormatRaw === "date" || xFormatRaw === "datetime" || xFormatRaw === "text"
        ? xFormatRaw
        : undefined;
    const yFormat = parseFormat(raw.y_format);
    return {
      kind,
      x,
      y,
      ...(raw.stacked === true ? { stacked: true } : {}),
      ...(xFormat ? { x_format: xFormat } : {}),
      ...(yFormat &&
      (yFormat === "integer" ||
        yFormat === "number" ||
        yFormat === "percent" ||
        yFormat === "currency" ||
        yFormat === "duration")
        ? { y_format: yFormat }
        : {}),
      ...(raw.legend === false ? { legend: false } : {}),
    };
  }
  if (kind === "pie" || kind === "donut") {
    const label = stringField(raw, "label");
    const value = stringField(raw, "value");
    if (!label || !value) return null;
    const maxSlices = parseNumberField(raw.max_slices);
    return {
      kind,
      label,
      value,
      ...(raw.sort_desc === false ? { sort_desc: false } : {}),
      ...(maxSlices !== null && maxSlices > 0 ? { max_slices: Math.floor(maxSlices) } : {}),
    };
  }
  return null;
}

function parseNumberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function optionalStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

// Picks the initial view to render: the first view whose `type` matches
// `default_view`, falling back to the first view in the list.
export function resolveInitialView(panel: DataViewPanel): DataViewSpec {
  if (panel.default_view) {
    const match = panel.views.find((v) => v.type === panel.default_view);
    if (match) return match;
  }
  return panel.views[0];
}
