import { parse as parseYaml } from "yaml";

// `.dashboard` file format — see docs/plans/2026-04-28-dashboard-file-type-design.md.
// Two panel kinds in v1: kpi (single-value card) and data_view (one query
// rendered through one or more switchable views: table or board).

export interface KpiPanel {
  type: "kpi";
  title: string;
  query: string;
}

export interface TableViewSpec {
  type: "table";
  columns?: string[];
}

export interface BoardViewSpec {
  type: "board";
  group_by: string;
  card_title: string;
  card_subtitle?: string;
}

export type DataViewSpec = TableViewSpec | BoardViewSpec;

export interface DataViewPanel {
  type: "data_view";
  title: string;
  query: string;
  views: DataViewSpec[];
  default_view?: DataViewSpec["type"];
}

export type DashboardPanel = KpiPanel | DataViewPanel;

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

export function parseDashboard(content: string): DashboardParseResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (err) {
    return { ok: false, error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "Dashboard root must be a mapping (key/value pairs)." };
  }

  const title = stringField(parsed, "title");
  if (!title) {
    return { ok: false, error: "Missing required field: `title`." };
  }
  const description = optionalStringField(parsed, "description");

  const rawPanels = parsed.panels;
  if (!Array.isArray(rawPanels) || rawPanels.length === 0) {
    return { ok: false, error: "Missing or empty `panels` list." };
  }

  const panels: DashboardPanel[] = [];
  for (let i = 0; i < rawPanels.length; i += 1) {
    const result = parsePanel(rawPanels[i], i);
    if (!result.ok || !result.panel) {
      return { ok: false, error: result.error ?? `panel #${i + 1} is invalid.` };
    }
    panels.push(result.panel);
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
  if (!isRecord(raw)) {
    return { ok: false, error: `panel #${index + 1} must be a mapping.` };
  }
  const type = stringField(raw, "type");
  if (type === "kpi") {
    const title = stringField(raw, "title");
    const query = stringField(raw, "query");
    if (!title) return { ok: false, error: `panel #${index + 1}: kpi missing \`title\`.` };
    if (!query) return { ok: false, error: `panel #${index + 1}: kpi missing \`query\`.` };
    return { ok: true, panel: { type: "kpi", title, query } };
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
      },
    };
  }
  return {
    ok: false,
    error: `panel #${index + 1}: unknown \`type\` "${type ?? ""}". Expected "kpi" or "data_view".`,
  };
}

function parseView(raw: unknown): DataViewSpec | null {
  if (!isRecord(raw)) return null;
  const type = stringField(raw, "type");
  if (type === "table") {
    const columns = Array.isArray(raw.columns)
      ? (raw.columns.filter((c) => typeof c === "string") as string[])
      : undefined;
    return { type: "table", ...(columns && columns.length > 0 ? { columns } : {}) };
  }
  if (type === "board") {
    const groupBy = stringField(raw, "group_by");
    const cardTitle = stringField(raw, "card_title");
    if (!groupBy || !cardTitle) return null;
    const cardSubtitle = optionalStringField(raw, "card_subtitle");
    return {
      type: "board",
      group_by: groupBy,
      card_title: cardTitle,
      ...(cardSubtitle ? { card_subtitle: cardSubtitle } : {}),
    };
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
// `default_view`, falling back to the first view in the list. Used by
// DataViewPanel on first mount; subsequent picks are session-local
// component state.
export function resolveInitialView(panel: DataViewPanel): DataViewSpec {
  if (panel.default_view) {
    const match = panel.views.find((v) => v.type === panel.default_view);
    if (match) return match;
  }
  return panel.views[0];
}
