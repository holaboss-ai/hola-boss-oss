---
title: Dashboard panels v2 — what to add (Lark / Notion / Airtable comparison)
date: 2026-04-30
status: draft
related:
  - 2026-04-28-dashboard-file-type-design.md
  - 2026-04-28-post-metrics-convention.md
---

# Dashboard panels v2

## 1. Why this exists

The v1 dashboard format ships two panel kinds (`kpi`, `data_view`) and two view types (`table`, `board`). The deferred-to-Phase-5 list called out chart panels and gallery / calendar / timeline / list views without specifying shape or priority.

Now that data_schema manifests are landing per app (twitter pilot + 10 follow-ups), the agent has reliable column metadata to drive richer panels. This doc surveys how Lark Base, Notion, Airtable, Coda, Metabase, and Linear structure their dashboard / multi-view systems, picks the panel/view set that's worth adding, and is explicit about what to defer and why.

## 2. What others ship — concrete view/panel cross-tab

I went through the live products (not just docs); below are the visualization primitives each ships as **first-class types** (not "you can fake it with X"). Marked ✓ when a built-in option exists, ⚠ when only as a partial / paid-tier feature.

| Capability                | Notion DBs | Lark Base | Airtable | Coda     | Metabase | Linear   |
| ------------------------- | ---------- | --------- | -------- | -------- | -------- | -------- |
| Table / Grid              | ✓          | ✓         | ✓        | ✓        | ✓        | ✓        |
| Board (Kanban)            | ✓          | ✓         | ✓        | ✓ (Card) | —        | ✓        |
| Calendar                  | ✓          | ✓         | ✓        | ✓        | —        | —        |
| Timeline / Gantt          | ✓          | ✓         | ✓        | ✓        | —        | —        |
| Gallery (cover cards)     | ✓          | ✓         | ✓        | ✓        | —        | —        |
| List (compact)            | ✓          | —         | —        | ✓ (Detail) | —      | ✓        |
| Form (write-back)         | ✓          | ✓         | ✓        | ✓        | —        | —        |
| KPI / stat card           | —          | ✓         | ⚠ (Interface) | ✓ | ✓       | —        |
| Line / bar / area / pie   | —          | ✓         | ⚠ (Interface) | ✓ | ✓       | —        |
| Pivot table               | —          | ✓         | ✓        | —        | ✓        | —        |
| Funnel                    | —          | ✓         | —        | ✓        | ✓        | —        |
| Heatmap                   | —          | ✓         | —        | ✓        | ✓        | —        |
| Map                       | —          | ✓         | ✓        | ✓        | ✓        | —        |
| Filter widgets (date range, dropdown — apply across panels) | per-view | ✓ dashboard-level | ✓ Interface | ✓ | ✓ | per-view |

**Patterns that show up everywhere:**
1. **Notion-style "views over one row set"** is the right factoring for table / board / calendar / timeline / gallery / list — same query, different layout. Charts are *not* in this list because charts consume aggregated rows, not raw rows.
2. **Charts are a separate panel kind** in BI tools (Lark, Coda, Metabase) — agent emits a different SQL (`SELECT day, SUM(...) GROUP BY day`) for each chart.
3. **KPI gets number-formatting + delta** in tools that take KPI seriously (Lark, Coda, Metabase). Notion / Airtable rely on per-column rollups inside the table.
4. **Conditional coloring** for status-style columns is in every product — green/red/yellow chips, not free-form CSS.
5. **Click-into-row** opens a detail surface that shows full record. We don't have a record-page concept; the closest is a side panel or modal showing all columns from the source row.

## 3. Filtering through the lens of "agent composes SQL"

Notion / Airtable / Linear let the *user* configure filters per view. Lark and Metabase add *dashboard-level* filter widgets that apply to all panels.

**For us, filters live in SQL.** When the user asks "now show me April only", the agent emits a new dashboard with `WHERE published_at >= '2026-04-01'` baked into each panel's query. We don't ship filter widgets in v2.

The cost: the user can't tweak filters without going back to the agent. The benefit: zero UI for the agent to misuse, dashboards are pure functions of their YAML, no hidden state in localStorage. This is consistent with "the agent regenerates the artifact" rather than "the user mutates the artifact".

## 4. Recommendation — what v2 adds

### 4.1 New panel kinds

**`chart`** — split out from `data_view` because the underlying query shape differs (aggregated rows vs. row-per-record). Subtypes: `line`, `bar`, `area`, `pie`, `donut`. No funnel / scatter / heatmap in v2 — funnel is a niche shape, and SQL CTEs already deliver everything stacked-bar can.

```yaml
- type: chart
  title: Engagement over time
  query: |
    SELECT day, SUM(likes) AS likes, SUM(comments) AS comments
    FROM twitter_post_metrics_daily
    WHERE day >= date('now', '-30 days')
    GROUP BY day ORDER BY day
  chart:
    kind: line              # line | bar | area | pie | donut
    x: day                  # x-axis column
    y: [likes, comments]    # one or many series
    stacked: false          # bar/area only
```

```yaml
- type: chart
  title: Posts by status
  query: |
    SELECT status, COUNT(*) AS count FROM twitter_posts GROUP BY status
  chart:
    kind: pie
    label: status           # slice label column
    value: count            # slice size column
```

**`stat_grid`** — multiple KPIs in one panel. Cheaper for the agent to compose than four `kpi` panels, and visually clearer (single bordered group).

```yaml
- type: stat_grid
  title: At a glance
  columns: 4                # 1 | 2 | 3 | 4
  stats:
    - { label: Posts,            query: "SELECT COUNT(*) AS value FROM twitter_posts WHERE status='published'", format: integer }
    - { label: Likes,            query: "SELECT SUM(likes) AS value FROM twitter_post_metrics_daily", format: integer }
    - { label: Engagement rate,  query: "SELECT 1.0 * SUM(likes) / NULLIF(SUM(impressions),0) AS value FROM ...", format: percent }
```

**`text`** — markdown headers / paragraphs between panels. Notion-style page composition. Lets the agent annotate ("section break: April recap") without abusing KPI titles.

```yaml
- type: text
  body: |
    ## April recap
    Engagement rebounded after the policy change on April 12...
```

### 4.2 New views inside `data_view`

These all consume the same row set as their parent `query`. The renderer adds a tab to the existing tab bar.

**`calendar`** — date-anchored rows on a month grid. Works for `calcom_bookings`, scheduled posts, gmail threads, anything with a single timestamp column.

```yaml
- type: data_view
  title: Upcoming meetings
  query: SELECT uid, title, start_time, status FROM calcom_bookings WHERE status='accepted'
  views:
    - type: calendar
      date: start_time      # column with a date / datetime
      title: title
      color_by: status      # optional, drives the per-event chip color
```

**`timeline`** — horizontal time axis. For rows with a duration (`start` + optional `end`).

```yaml
- type: data_view
  title: Publishing schedule
  query: SELECT id, content, scheduled_at, published_at FROM twitter_posts
  views:
    - type: timeline
      start: scheduled_at
      end: published_at     # optional; falls back to a single-point marker
      label: content
      group_by: status      # optional swim-lane
```

**`gallery`** — cards-with-cover. The data_schema column annotation `format: image_url` (proposed below) lets the renderer pick a cover automatically; otherwise placeholder + title only. Mostly useful for content-with-media tables.

```yaml
- type: gallery
  cover: media_url          # column whose value is an image URL; optional
  title: content
  subtitle: status
```

**`list`** — denser than table, no column header row, primary + secondary + meta lines. Good default for "stream of recent things".

```yaml
- type: list
  primary: content          # main line per row
  secondary: platform       # smaller line below
  meta: published_at        # right-aligned trailing text
```

### 4.3 Column-level enrichments for `table` view

These add visual quality without changing the query model. All optional.

```yaml
- type: table
  columns:
    - { name: status,       colors: { published: green, failed: red, scheduled: blue } }
    - { name: likes,        format: integer,  align: right }
    - { name: published_at, format: datetime, width: 180 }
    - { name: meeting_url,  format: url,      label: Join }
    - { name: amount,       format: currency, currency_column: value_currency, align: right }
```

Formats: `integer` | `number` | `percent` | `currency` | `date` | `datetime` | `duration` | `url` | `tag` | `image_url`. The renderer falls back to plain text for unknown formats.

### 4.4 Panel-level conveniences

```yaml
- type: data_view | chart | kpi | stat_grid
  title: ...
  description: One-line context shown under the title       # NEW
  empty_state: No posts in this period yet.                  # NEW
  width: full | half | third                                 # NEW (layout hint)
  refresh_interval_s: 60                                     # NEW (auto-refresh)
```

Layout: when 2-3 adjacent panels declare `width: half` (or 3 × `width: third`), the renderer flows them into a row. Anything `width: full` (default) breaks to a new row. Mirrors Notion's column blocks, no drag-resize complexity.

### 4.5 KPI enrichments

```yaml
- type: kpi
  title: Total Likes
  query: "SELECT SUM(likes) AS value FROM twitter_post_metrics_daily"
  format: integer
  delta_query: "SELECT SUM(likes) AS value FROM ... WHERE day < date('now', '-7 days')"
  target: 5000              # optional progress toward
```

`delta_query`: when present, KPI shows current value plus `Δ +12%` vs. the delta value. Same shape (one row, `value` column). Lark / Metabase both ship this.

`target`: when present, KPI shows a thin progress bar `current / target`.

## 5. What to NOT add (and why)

| Skipped              | Reason |
| -------------------- | ------ |
| **Form view (write-back)** | Requires per-table write rules + auth + validation. Out of scope for "agent emits read-only dashboard". The agent already has `*_create_post` / `*_update_*` tools for writes. |
| **Pivot table panel** | SQL `GROUP BY` covers 95% of the use cases via a `chart` panel; the remaining 5% (cross-tab matrix UI) is rarely better than two charts side by side. |
| **Heatmap**          | Niche — rare in our app domains. If a need shows up later, it slots in as a `chart.kind: heatmap` subtype. |
| **Funnel**           | Specialized — only well-defined for a fixed-stage pipeline. Add when an app actually ships staged data (e.g. apollo / instantly campaigns). For now: stacked bar gets you there. |
| **Map**              | No geographic data in current apps. |
| **Gantt with dependencies** | Subset of `timeline` minus the dependency arrows. Add arrows later if a project-management app ships. |
| **Drag-drop on board** | Requires write-back to source table — same boundary as form view. |
| **Free-form drag-resize grid** | Adds positional state stored where? Either localStorage (lossy) or in the `.dashboard` file (then agent has to author x/y/w/h coordinates and gets it wrong). The `width: full | half | third` flow keeps layout authorable but expressive enough. |
| **Filter widgets (date range / dropdown)** | Agent regenerates the dashboard with WHERE clauses. UI-driven filters introduce hidden state contradicting "the YAML *is* the dashboard". |

## 6. Agent-facing tool shape

`create_dashboard`'s input schema gains the new panel/view types. The runtime applier keeps validating panel queries (`LIMIT 0` parse check) and now also validates:

- chart `x` / `y` / `label` / `value` columns appear in the query projection
- calendar `date` / timeline `start`+`end` / gallery `cover` / list `primary`+`secondary`+`meta` columns appear in projection
- stat_grid each stat's query returns a `value` column on `LIMIT 0`
- color_by / group_by columns exist in projection

Agent prompt addition (one paragraph):

> *Choose panel kinds by question shape: a single number → `kpi`; multiple related numbers → `stat_grid`; a trend over time → `chart` with `kind: line` (or `area` for stacked); composition → `chart` with `kind: pie` or `bar`; raw record list with column-level data → `data_view` with `table` + maybe `board` if there's a low-cardinality status column; date-anchored events → `data_view` with `calendar` view; long-duration items → `timeline`; image-heavy items → `gallery`; densest scan list → `list`. Use `text` panels to break dashboards into sections.*

## 7. Implementation slices

Each slice is independently shippable; the renderer falls back to "unsupported panel type" text gracefully when it sees a newer panel than the current build understands (forward-compat).

| Slice | What lands | Risk |
|-------|------------|------|
| **A** Column formats + colors on `table` view | format / colors / align / width | Low. Pure renderer; YAML grows backward-compatibly. |
| **B** `text` + `stat_grid` panels + `description` / `empty_state` panel-level fields | Two new panel kinds + a couple of optional fields | Low. |
| **C** `chart` panel (line / bar / area first; pie / donut second) | Recharts wrapper + 4 chart subtypes | Medium. Recharts dependency size; need to lock chart color tokens. |
| **D** `calendar` + `timeline` views inside `data_view` | Two new view components | Medium. Calendar grid layout, timeline scaling are non-trivial. |
| **E** `gallery` + `list` views | Two more view components | Low. |
| **F** KPI enrichments (`format`, `delta_query`, `target`) + `width` layout hints | Format + delta diff + flex row layout | Low. |
| **G** Auto-refresh (`refresh_interval_s`) | Per-panel timer + hook | Low. |

Recommended order: A → F → B → C → E → D → G. Charts are the highest-leverage feature for "make me a dashboard of trends" requests; calendar/timeline are visual polish that shows real value once enough rows exist; auto-refresh last because it interacts with future filter widgets and we shouldn't paint into a corner.

## 8. Open questions

- **Chart library.** Recharts is the obvious choice (React-native, well-maintained, MIT). Alternative: Visx (lower-level, more work). I'd start with Recharts and switch only if we hit a specific limit.
- **Detail-on-click for rows.** All comparison products open a record detail page. We don't have one — the closest is a side panel that renders all columns from the row, optionally calling out to an MCP tool that can take an action. Worth a separate doc.
- **Theming.** Charts and the badge colors in `colors:` need to map onto our OKLch tokens, including dark mode. Lock the palette early.
- **Per-app dashboard catalogs.** Should `data_schema:` in `app.runtime.yaml` also let an app ship default `.dashboard` files? E.g. `twitter` ships `dashboards/post-metrics.dashboard` that gets materialized on install. Probably yes — but Tier 2 schema work is a prerequisite, and it's a follow-up.
