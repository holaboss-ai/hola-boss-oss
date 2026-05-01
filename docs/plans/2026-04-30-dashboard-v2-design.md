---
title: Dashboard v2 — frozen design
date: 2026-04-30
status: decided
supersedes_open_questions_in:
  - 2026-04-30-dashboard-panels-v2.md
related:
  - 2026-04-28-dashboard-file-type-design.md
  - 2026-04-30-workspace-data-layer-tier2.md
---

# Dashboard v2 — frozen design

This document fixes the schema, renderer contracts, validator rules, agent tool shapes, and theming for the next iteration of `.dashboard` files. The earlier docs surveyed and proposed; this one decides. Anything not in this doc is out of scope for v2.

## 1. Scope of v2

In:
- New panel kinds: `chart`, `stat_grid`, `text`
- New views inside `data_view`: `calendar`, `timeline`, `gallery`, `list`
- Column-level enrichments on the `table` view: `format`, `colors`, `align`, `width`, `link`
- Panel-level: `description`, `empty_state`, `width`, `refresh_interval_s`
- KPI: `format`, `delta_query`, `target`
- New runtime tool: `update_dashboard` (overwrite an existing file)

Out (deferred to a future v3 — explicit list, do not negotiate during v2):
- Form / write-back / drag-drop on board
- Pivot table panel, funnel / heatmap / map panels
- Filter widgets (date range / dropdowns)
- Free-form drag-resize grid
- Detail-on-click that triggers MCP actions (read-only modal is in v2)
- Per-app dashboard catalogs (apps shipping default `.dashboard` files)

## 2. Frozen YAML grammar

### 2.1 File shape

```yaml
title: <string, required>
description: <string, optional, ≤ 280 chars>
panels: <array, ≥ 1 entry>
```

Files live at `workspace/<id>/files/dashboards/<name>.dashboard`. The renderer accepts the file extension `.dashboard` (YAML).

### 2.2 Panel kinds

Five panel kinds. The discriminator is `type`.

#### `kpi`

```yaml
- type: kpi
  title: <string, required>
  description: <string, optional>
  query: <SQL, required — must return ≥ 1 row with a column named `value`>
  format: integer | number | percent | currency | duration   # default: number
  currency: USD | EUR | CNY | ...                            # required if format=currency
  delta_query: <SQL, optional — same shape, returns prior-period value>
  target: <number, optional — for progress bar>
  empty_state: <string, optional>
  width: full | half | third                                  # default: full
  refresh_interval_s: <integer ≥ 30, optional>
```

#### `stat_grid`

```yaml
- type: stat_grid
  title: <string, required>
  description: <string, optional>
  columns: 2 | 3 | 4                                          # default: 4
  empty_state: <string, optional>
  width: full | half | third                                  # default: full
  refresh_interval_s: <integer ≥ 30, optional>
  stats:
    - label: <string, required>
      query: <SQL, required — returns 1 row with `value` column>
      format: integer | number | percent | currency | duration
      currency: <see kpi>
      delta_query: <SQL, optional>
```

#### `chart`

```yaml
- type: chart
  title: <string, required>
  description: <string, optional>
  query: <SQL, required>
  empty_state: <string, optional>
  width: full | half | third
  refresh_interval_s: <integer ≥ 30, optional>
  chart:
    kind: line | bar | area | pie | donut

    # line / bar / area:
    x: <column name, required>           # x-axis column
    y: [<column name>, ...]              # 1+ series; each becomes a line/bar/area
    stacked: false                       # bar/area only; default false
    x_format: date | datetime | text     # axis tick formatting (default: text)
    y_format: integer | number | percent | currency | duration
    legend: true                         # default true if y has > 1 entry

    # pie / donut:
    label: <column name, required>       # slice label
    value: <column name, required>       # slice size
    sort_desc: true                      # default true
    max_slices: <integer, optional>      # extras grouped under "Other"
```

#### `data_view`

```yaml
- type: data_view
  title: <string, required>
  description: <string, optional>
  query: <SQL, required>
  empty_state: <string, optional>
  width: full | half | third
  refresh_interval_s: <integer ≥ 30, optional>
  default_view: <view type, optional — falls back to first view>
  views: <array, ≥ 1>
    - { type: table, ...}
    - { type: board, ...}
    - { type: calendar, ...}
    - { type: timeline, ...}
    - { type: gallery, ...}
    - { type: list, ...}
```

Six view kinds (see §2.3). The renderer shows a tab bar across the top of the panel when `views.length ≥ 2`; with one view, no tab bar.

#### `text`

```yaml
- type: text
  body: <markdown string, required>
  width: full | half | third                                  # default: full
```

Renderer supports the CommonMark subset already used elsewhere in the desktop (headings, lists, links, code, bold, italic, blockquote, hr). No SQL.

### 2.3 View kinds (inside `data_view`)

#### `table`

```yaml
- type: table
  columns:
    - <plain column name string>                              # shorthand
    - name: <column name, required>
      label: <string, optional — header override>
      format: integer | number | percent | currency | date | datetime | duration | url | tag | image_url
      currency: <ISO code, required if format=currency>
      align: left | center | right                            # default: format-driven
      width: <integer px, optional>
      colors: { value1: green, value2: red, ... }              # optional; per-cell badge color
      link: <URL template using {{column}}, optional>
```

`colors` keys are exact value matches against the cell's stringified value. Color values must be one of `green | yellow | red | blue | gray | purple | orange` — these map to OKLch tokens (§5.1), not free-form hex.

`link` makes the cell text clickable. Template substitution: `{{column_name}}` resolves to the row's value for that column. Example: `link: "{{meeting_url}}"` makes the cell open that URL.

`columns` empty / missing → all projected columns shown in projection order, with format auto-derived from data_schema visibility annotations when available, otherwise plain text.

#### `board`

```yaml
- type: board
  group_by: <column name, required>            # column whose distinct values become columns
  card_title: <column name, required>
  card_subtitle: <column name, optional>
  card_meta: <column name, optional>           # right-aligned trailing label per card
  group_order: [v1, v2, v3]                    # optional explicit order; rest tail-appended
  group_colors: { v1: green, v2: red, ... }    # column header chip colors
```

Read-only — no drag-drop. (v3 work.)

#### `calendar`

```yaml
- type: calendar
  date: <column name, required — TEXT or DATETIME>
  title: <column name, required>
  color_by: <column name, optional>            # event chip color uses §5.1 palette via hash-of-value if no explicit colors map
  colors: { v1: green, v2: red, ... }          # optional explicit color map
```

Renders a month grid. Events on the same day stack; overflow shows "+N more" link that opens a popover listing all events for that day.

#### `timeline`

```yaml
- type: timeline
  start: <column name, required>
  end: <column name, optional — falls back to point marker if missing/null>
  label: <column name, required>
  group_by: <column name, optional>            # creates swim-lanes
  colors: { ... }                              # optional, applied to label or group_by value
```

Horizontal time axis. Auto-scales to the row set's min/max. Pan + zoom in v2 if cheap; otherwise a fixed window. (Renderer team can decide; not blocking the spec.)

#### `gallery`

```yaml
- type: gallery
  cover: <column name, optional — column with image URL or null>
  title: <column name, required>
  subtitle: <column name, optional>
  meta: <column name, optional>                # caption-line tag e.g. status
  card_size: small | medium | large            # default: medium
```

Cards laid out in a responsive grid. Missing cover → placeholder with title initial.

#### `list`

```yaml
- type: list
  primary: <column name, required>
  secondary: <column name, optional>
  meta: <column name, optional>                # right-aligned trailing
```

Denser than table — no header row, two text lines + trailing meta per row. The default for "stream of recent things".

### 2.4 Column type inference (when `format` is omitted)

When the renderer would otherwise fall back to "plain text", consult the workspace's manifest registry (Tier 2): if the projected column maps to a manifested column whose name suggests a format, infer it. Heuristics, applied in order:

1. column name ends in `_at` and SQLite type is TEXT → `datetime`
2. column name ends in `_url` → `url`
3. column name ends in `_count`, `_total`, `_seen`, equals `count`, `id`, ends in `_id` → `integer`
4. column SQLite type is INTEGER → `integer`
5. column SQLite type is REAL → `number`
6. otherwise → plain text

The agent can always pin format explicitly in YAML; this only kicks in for unannotated table columns.

### 2.5 Layout

Default: every panel is `width: full` and stacks vertically.

When 2+ adjacent panels declare `width: half` (or 3 × `width: third`) consecutively, the renderer flows them into a single horizontal row. A `width: full` panel always breaks to a new row.

Examples:
```
[ kpi half ][ kpi half ]                 → one row, two columns
[ stat_grid third ][ chart third ][ kpi third ]  → one row, three columns
[ kpi half ][ chart full ][ data_view half ][ kpi half ]
                                          → row 1: [kpi][orphan filler]
                                            row 2: [chart full]
                                            row 3: [data_view][kpi]
```

If only one panel in a row declares `half` / `third` and the next panel is full, the half/third panel takes the full width with a layout warning logged (silent in production).

## 3. Renderer

### 3.1 Component tree

```
<DashboardRoute>                            # /files/dashboard/$path
  <DashboardHeader title description toolbar/>
  <PanelGrid>                               # implements width: full|half|third flow
    {panels.map(p => <Panel key={i} spec={p} />)}
  </PanelGrid>
</DashboardRoute>

<Panel> dispatches by type:
  kpi        → <KpiPanel>
  stat_grid  → <StatGridPanel>
  chart      → <ChartPanel>
  data_view  → <DataViewPanel>            # owns view-tab state; dispatches to view component
  text       → <TextPanel>

<DataViewPanel> dispatches the active view by type:
  table     → <TableView>
  board     → <BoardView>
  calendar  → <CalendarView>
  timeline  → <TimelineView>
  gallery   → <GalleryView>
  list      → <ListView>
```

File paths in desktop:
```
desktop/src/components/dashboard/
  DashboardRoute.tsx           # route handler
  PanelGrid.tsx                # width-flow layout
  Panel.tsx                    # type discriminator
  KpiPanel.tsx
  StatGridPanel.tsx
  ChartPanel.tsx               # uses Recharts
  TextPanel.tsx
  DataViewPanel.tsx
  views/
    TableView.tsx
    BoardView.tsx
    CalendarView.tsx
    TimelineView.tsx
    GalleryView.tsx
    ListView.tsx
  format/
    formatValue.ts             # integer/number/percent/currency/datetime/etc
    colorTokens.ts             # green|yellow|red|... → OKLch class names
  hooks/
    usePanelQuery.ts           # IPC wrapper + cache + refresh timer
```

### 3.2 Query execution

Every SQL execution goes through one IPC handler in main:

```ts
// main process
ipcMain.handle("dashboard.runQuery", async (_e, { workspaceId, sql }) => {
  const dbPath = ensureWorkspaceDataDb(workspaceDirForId(workspaceId))
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  db.pragma("query_only = ON")
  try {
    const stmt = db.prepare(sql)
    return { ok: true, rows: stmt.all(), columns: stmt.columns() }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    db.close()
  }
})
```

Notes:
- `query_only = ON` prevents anything that mutates state from running, even if the SQL was malicious. Belt-and-suspenders alongside `readonly: true`.
- Each panel's query is cached in renderer for the panel's lifetime; the dashboard "Refresh" button + per-panel `refresh_interval_s` invalidate the cache.
- No connection pool — each query opens, runs, closes. Acceptable at our scale (≤ 100 panels × ≤ 1 query/min).

### 3.3 Error states

Per-panel; never crashes the dashboard.

| Error                        | Display |
|------------------------------|---------|
| YAML parse error             | Whole-dashboard error page with line + message |
| Validator rejected at create | Should not happen at runtime (validator runs before write); if it does, panel-level error chip |
| SQL parse / run error        | Panel shows red banner with `error.message`, no rendering of row data |
| Query returns 0 rows         | Panel shows `empty_state` if defined, otherwise default `"No data."` |
| Column referenced in view config not in projection | Panel shows red banner naming missing column |
| Chart x/y/label/value reference missing column | Same |
| Image URL fails to load      | Gallery card falls back to placeholder cover |

### 3.4 Auto-refresh

`refresh_interval_s` is per-panel. Hook implementation:

```ts
function usePanelQuery(spec) {
  const [state, setState] = useState({ status: "loading" })
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const r = await window.electronAPI.dashboard.runQuery(spec.query)
      if (!cancelled) setState(r.ok ? {status:"ok", ...r} : {status:"error", error:r.error})
    }
    run()
    if (spec.refresh_interval_s) {
      const t = setInterval(run, spec.refresh_interval_s * 1000)
      return () => { cancelled = true; clearInterval(t) }
    }
    return () => { cancelled = true }
  }, [spec.query, spec.refresh_interval_s])
  return state
}
```

Minimum interval enforced as 30s in the validator to avoid agents accidentally writing 1s polling loops.

## 4. Validator (runtime side)

The validator runs inside `create_dashboard` / `update_dashboard` before the YAML is written. Two layers:

### 4.1 Static schema check (Zod)

Lives at `holaOS/runtime/api-server/src/dashboard-schema.ts`. Mirrors §2 grammar exactly. Rejections produce `{ code: "dashboard_invalid", path: "panels[2].chart.kind", message: "..." }`.

### 4.2 SQL + projection check

For each panel that has a `query`:
1. Parse SQL → run `LIMIT 0` against shared data.db to verify it parses + all referenced tables/columns exist
2. Capture the projected column list from `stmt.columns()`
3. Cross-validate spec references:
   - `kpi`: projection must contain a `value` column
   - `chart` line/bar/area: `x` and every `y[i]` must be in projection; `x` column type should be TEXT/INTEGER/REAL
   - `chart` pie/donut: `label` and `value` in projection
   - `data_view` `table.columns[*].name`: each must be in projection
   - `data_view` `board.group_by` / `card_title` / `card_subtitle` / `card_meta`: in projection
   - `data_view` `calendar.date` / `title` / `color_by`: in projection
   - `data_view` `timeline.start` / `end` / `label` / `group_by`: in projection
   - `data_view` `gallery.cover` / `title` / `subtitle` / `meta`: in projection
   - `data_view` `list.primary` / `secondary` / `meta`: in projection

For `stat_grid`: each stat's query is validated separately and must return a `value` column.

`text` panels skip SQL validation entirely.

## 5. Theming

### 5.1 Color tokens

The 7 named colors used by `colors:` / `group_colors:` map to existing app tokens, with a fixed light/dark pair per name:

| Name    | Light bg / fg               | Dark bg / fg                |
|---------|-----------------------------|-----------------------------|
| green   | `oklch(95% 0.05 145)` / `oklch(38% 0.13 145)` | `oklch(28% 0.06 145)` / `oklch(82% 0.14 145)` |
| yellow  | `oklch(96% 0.07 95)`  / `oklch(40% 0.12 95)`  | `oklch(30% 0.07 95)`  / `oklch(85% 0.14 95)`  |
| red     | `oklch(95% 0.05 25)`  / `oklch(42% 0.16 25)`  | `oklch(28% 0.07 25)`  / `oklch(80% 0.16 25)`  |
| blue    | `oklch(95% 0.04 245)` / `oklch(40% 0.14 245)` | `oklch(28% 0.06 245)` / `oklch(82% 0.14 245)` |
| gray    | `oklch(96% 0 0)`      / `oklch(35% 0 0)`      | `oklch(25% 0 0)`      / `oklch(80% 0 0)`      |
| purple  | `oklch(95% 0.05 290)` / `oklch(40% 0.16 290)` | `oklch(28% 0.07 290)` / `oklch(82% 0.16 290)` |
| orange  | `oklch(95% 0.06 50)`  / `oklch(45% 0.18 50)`  | `oklch(30% 0.08 50)`  / `oklch(85% 0.18 50)`  |

Implemented as Tailwind utility classes generated from CSS variables in `desktop/src/styles/dashboard-tokens.css`.

### 5.2 Chart palette

Charts use a fixed series palette derived from the 7 above, in this order: `blue → green → orange → purple → red → yellow → gray`. Series colors loop after 7. The first series gets `blue` because it's the most neutral and matches the brand-adjacent default.

Background, gridlines, axis labels: existing `--muted` / `--muted-foreground` tokens.

### 5.3 Number / date formats

`formatValue.ts` exports one function:

```ts
export function formatValue(
  raw: unknown,
  format: ColumnFormat,
  options: { currency?: string; locale?: string } = {},
): string
```

Format → behavior:
- `integer` → `Intl.NumberFormat(locale, { maximumFractionDigits: 0 })`
- `number` → `Intl.NumberFormat(locale, { maximumFractionDigits: 2 })`
- `percent` → multiplies by 100, suffix `%`
- `currency` → `Intl.NumberFormat(locale, { style: "currency", currency })`
- `date` → `Intl.DateTimeFormat(locale, { dateStyle: "medium" })`
- `datetime` → `dateStyle: medium, timeStyle: short`
- `duration` → input expected as seconds; output `"3h 12m"` / `"45s"` / etc.
- `url` → as-is, rendered as `<a>`
- `tag` → as-is, rendered as a chip
- `image_url` → renders an `<img>` (only meaningful in gallery; in table, falls back to plain text URL)

Locale resolves from desktop user preference (`navigator.language` fallback). No date timezone manipulation in v2 — values rendered in user's local timezone.

## 6. Agent integration

### 6.1 Tool input schema

`create_dashboard` (existing) — input grammar grows to match §2 exactly. Zod schema lives in `dashboard-schema.ts` and is re-exported as the tool's input schema.

`update_dashboard` (NEW) — same input shape, but `name` resolves to an existing file. Returns the file path. Atomic write: writes to `<name>.dashboard.tmp`, fsyncs, renames.

```
input: {
  name: string,           // file basename without .dashboard
  ...rest: <full dashboard spec, same as create_dashboard>
}
```

Why a separate tool: the agent semantically distinguishes "make me a new dashboard" from "tweak the dashboard I just made". Same tool with `overwrite: true` would muddle the prompt.

### 6.2 System prompt addition (≤ 4 lines)

> *Compose dashboards from these panel kinds: `kpi` (one number), `stat_grid` (a few related numbers), `chart` for trends (`line`/`area` over time, `bar` for category comparison, `pie`/`donut` for composition), `data_view` for raw record lists with switchable layouts (`table` / `board` / `calendar` / `timeline` / `gallery` / `list`), `text` for section headers and prose. Pick `chart` when the user wants "how did X change", `kpi`/`stat_grid` for "what's the current value", `data_view` for "show me the items". Use `width: half` to put two panels side-by-side. For status-style columns, set `colors:` so values render as colored chips.*

### 6.3 `list_data_tables` integration

No changes to `list_data_tables`'s output shape. The agent reads it the same way; the new column-format inference just reads richer data.

## 7. Backwards compatibility

- v1 `.dashboard` files remain valid: `kpi`, `data_view` with `table` and `board` views are unchanged. No migration needed.
- A file written by v1 agent (no `width`, no `format`, no new view types) renders identically to before.
- A v2-only file opened by an older renderer build: the renderer falls back to "Unsupported panel type" placeholder and continues rendering remaining panels. Forward-compatible because the unknown-type case is handled in the dispatch switch's default arm.

## 8. Implementation slices

Concrete tasks, file paths, est. time, ordered by recommended ship order.

| # | Slice | Files | Hours | Risk |
|---|-------|-------|-------|------|
| A | Column formats + colors + align + width on `<TableView>` | desktop/src/components/dashboard/views/TableView.tsx, format/formatValue.ts, format/colorTokens.ts, styles/dashboard-tokens.css | 4 | Low |
| B | KPI enrichments (format, delta_query, target) + `<StatGridPanel>` | KpiPanel.tsx, StatGridPanel.tsx, hook for delta diff | 4 | Low |
| C | `<TextPanel>` + panel-level `description`, `empty_state`, `width` flow in `<PanelGrid>` | TextPanel.tsx, PanelGrid.tsx, Panel.tsx | 3 | Low |
| D | `<ChartPanel>` (line, bar, area, pie, donut) using Recharts | ChartPanel.tsx + Recharts dependency | 8 | Medium — chart sizing + dark mode + token mapping |
| E | `<GalleryView>` + `<ListView>` | views/GalleryView.tsx, views/ListView.tsx | 4 | Low |
| F | `<CalendarView>` | views/CalendarView.tsx | 6 | Medium — month grid + day overflow popover |
| G | `<TimelineView>` | views/TimelineView.tsx | 8 | Medium-high — axis scaling + swim lanes |
| H | Auto-refresh hook (`refresh_interval_s` ≥ 30) | hooks/usePanelQuery.ts | 2 | Low |
| I | Validator schema + SQL projection cross-check | runtime/api-server/src/dashboard-schema.ts, src/runtime-agent-tools.ts | 6 | Low |
| J | `update_dashboard` tool + agent prompt copy | runtime/api-server/src/runtime-agent-tools.ts, harnesses/src/runtime-agent-tools.ts | 3 | Low |
| K | Forward-compat unknown-type placeholder | Panel.tsx default arm + DataViewPanel.tsx default arm | 1 | Low |

Total: ~49 hours / ~6 working days, splittable across 3-4 PRs:
- PR 1 (A + B + C + I + J + K): ground up — schema, validator, table/kpi/stat_grid/text panels, agent tools. Ships visible value.
- PR 2 (D): chart panel. Highest impact.
- PR 3 (E + H): gallery / list / auto-refresh. Polish.
- PR 4 (F + G): calendar / timeline. Most complex.

Each PR is independently shippable; agent gets richer panel set incrementally.

## 9. Test plan

Per slice:
- **Validator (I)**: 1 unit test per Zod rule + 1 per SQL projection rule. Use the data-schema test harness pattern from `data-schema.test.ts`.
- **TableView (A)**: snapshot test per format type; one with all-format-types row; one with `colors:` map; one with `link:` template. Storybook stories for visual review.
- **KpiPanel (B)**: render with each format, with delta (positive / negative / zero), with target.
- **StatGridPanel (B)**: 2 / 3 / 4 column layouts.
- **ChartPanel (D)**: one snapshot per chart kind, plus dark-mode snapshot of each.
- **PanelGrid (C)**: layout test — full / half + half / third × 3 / mixed orphan.
- **CalendarView / TimelineView (F, G)**: shape test on synthetic row sets; visual review via Storybook.
- **End-to-end**: hand-author `apps/twitter/dashboards/twitter-metrics.dashboard` with one panel of each new kind, open in desktop, verify all render. Lock as a regression fixture.

CI gate: `pnpm validate:schemas` (already exists for `data_schema:`) gets a sibling `pnpm validate:dashboards` that walks any committed `.dashboard` file in `apps/*/dashboards/` and runs the static Zod check.

## 10. Decisions resolved (vs. previous open questions)

| Question (from v2 doc §8) | Decision |
|---------------------------|----------|
| Chart library | Recharts. ESM-friendly, MIT, decent bundle size, well-typed. |
| Detail-on-click for rows | v2 ships a read-only modal showing all columns from the source row. No MCP-tool dispatch. (v3.) |
| Theming token mapping | Explicit OKLch palette in §5.1; chart series order in §5.2; locked. |
| Per-app dashboard catalogs | Deferred to v3. Tier 2 schemas already make this trivial later; not needed for v2. |

## 11. Done criteria

v2 is "done" when:
1. All 11 implementation slices in §8 land
2. `pnpm validate:dashboards` passes on a hand-written fixture using every panel + view type
3. The agent can produce a working chart-heavy dashboard from a prompt like *"make me a dashboard of last month's twitter engagement"* without YAML edits required after
4. No v1 dashboard regresses (forward-compat invariant from §7)
5. Storybook stories exist for every new component, both light and dark mode
