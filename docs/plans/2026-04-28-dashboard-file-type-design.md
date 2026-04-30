---
title: Dashboard File Type + Built-in Renderer
date: 2026-04-28
status: draft
---

# Dashboard File Type + Built-in Renderer

## 1. Goal

Let users ask the agent to "make me a dashboard" — and have a working dashboard show up in the workspace, without anyone shipping a domain-specific dashboard app.

Concretely: in the same chat where the user already publishes a tweet, they can also say *"build me a dashboard of all my published posts across Twitter, LinkedIn, Reddit this month"* and a viewable dashboard appears as a workspace file.

## 2. Why this shape

- **Pre-built dashboard apps don't scale.** Every domain (social analytics, sales pipeline, content performance, …) would need its own published app. Marketplace fragments fast.
- **Code-generation by agent is fragile.** Generating React + build steps + sandboxing inside a workspace is heavy and slow.
- **Notion-style is the proven pattern.** Structured spec + general renderer = the model behind Notion, Figma, Metabase, Grafana, Superset. Agent emits the spec, renderer interprets.
- **Aligns with agent-first product vision.** Agent creates artifacts (dashboards, drafts, reports), user views and edits. Marketplace stays narrow (integration apps only).

## 3. The core insight

Dashboard is a **file type**, not an app type.

- File: `*.dashboard` (YAML)
- Lives in: `workspace/<id>/files/dashboards/` (or anywhere under `files/`)
- Created by: agent (via tool) or user (hand-edit YAML)
- Rendered by: built-in desktop renderer
- Reads from: workspace shared SQLite

Marketplace has Integration Apps (twitter, linkedin, …). It does NOT have Dashboard Apps. Renderer is built into the product.

## 4. Architecture

### 4.1 Shared SQLite (data plane)

```
workspace/<id>/.holaboss/data.db    # single SQLite, WAL mode
```

- Every integration app writes its tables, name-prefixed by app id: `twitter_posts`, `linkedin_posts`, `reddit_posts`, …
- Convention: only the owning app writes its tables; any app/dashboard reads any table.
- Concurrent writes serialize via WAL; concurrent reads are free.
- File travels with workspace (Dropbox / git / export). Lockfile prevents concurrent open.

Apps reach the shared db via a new `@holaboss/bridge` helper:

```ts
import { getWorkspaceDb } from "@holaboss/bridge"
const db = getWorkspaceDb()  // resolves WORKSPACE_DB_PATH from env
```

Runtime injects `WORKSPACE_DB_PATH=/.../.holaboss/data.db` into every app process, replacing today's `DB_PATH=./data/module.db`.

### 4.2 `.dashboard` file format (v1)

Two panel kinds in v1:

- **`kpi`** — single number / single row, big card.
- **`data_view`** — one query, multiple **switchable views** (Notion-style). Renderer shows a tab bar across the top of the panel; clicking a tab swaps the view component over the same row set.

```yaml
# workspace/<id>/files/dashboards/social-overview.dashboard
title: Social Overview — April
description: Cross-platform publish summary

panels:
  - type: kpi
    title: Total Published
    query: |
      SELECT COUNT(*) AS value FROM (
        SELECT id FROM twitter_posts  WHERE status='published'
        UNION ALL SELECT id FROM linkedin_posts WHERE status='published'
        UNION ALL SELECT id FROM reddit_posts   WHERE status='published'
      )

  - type: data_view
    title: All Drafts
    query: |
      SELECT id, content, status, scheduled_at,
             'twitter'  AS platform FROM twitter_posts
      UNION ALL
      SELECT id, content, status, scheduled_at,
             'linkedin' AS platform FROM linkedin_posts
      UNION ALL
      SELECT id, content, status, scheduled_at,
             'reddit'   AS platform FROM reddit_posts
    views:
      - type: table
        columns: [platform, content, status, scheduled_at]
      - type: board                # Kanban
        group_by: status
        card_title: content
        card_subtitle: platform
    default_view: table

  - type: data_view
    title: Recent Failures
    query: |
      SELECT 'twitter'  AS platform, id, error_message, updated_at FROM twitter_posts  WHERE status='failed'
      UNION ALL
      SELECT 'linkedin', id, error_message, updated_at FROM linkedin_posts WHERE status='failed'
      UNION ALL
      SELECT 'reddit',   id, error_message, updated_at FROM reddit_posts   WHERE status='failed'
      ORDER BY updated_at DESC LIMIT 20
    views:
      - type: table
        columns: [platform, id, error_message, updated_at]
```

**Schema (v1):**
- `title` (string, required)
- `description` (string, optional)
- `panels`: list of panels
- Panel kinds:
  - `kpi`: `{ type: 'kpi', title, query }` — query returns one row with at least a `value` column.
  - `data_view`: `{ type: 'data_view', title, query, views: View[], default_view? }` — query returns rows; each view renders the same rows differently.
- View kinds (v1):
  - `table`: `{ type: 'table', columns: string[] }` — column whitelist (order = display order). Empty / missing → all columns.
  - `board`: `{ type: 'board', group_by: string, card_title: string, card_subtitle?: string }` — Kanban columns by `group_by` distinct values; cards show `card_title` + optional subtitle.
- View rules:
  - `views` array MUST contain ≥ 1 view.
  - With 1 view, no tab bar is shown.
  - With ≥ 2 views, tab bar appears; selected view is in-memory (session-scoped) state in v1.
  - `default_view` is a view `type` matching one of the entries; falls back to first view if absent or invalid.
- `query`: single SQL statement returning rows the panel/views consume.
- Layout: panels stack vertically in order. No grid/columns in v1.

**Deferred to Phase 5:** `gallery`, `calendar`, `timeline`, `list` views; chart panels (`line`/`bar`/`pie`); drag-drop on board (would require write-back to source tables — out of scope for v1).

### 4.3 Renderer (built into desktop)

- New TanStack Router route in desktop: `/files/dashboard/$path` (path = file path inside workspace).
- File extension binding: Files panel double-click on `*.dashboard` → opens this route.
- Render flow:
  1. Read `.dashboard` YAML via filesystem (Electron main → IPC → renderer)
  2. For each panel, run its query against shared `data.db` via better-sqlite3 in main process — once per panel, cached for the panel's lifetime
  3. Stream rows back to renderer; render panel shell with view tab bar (if `data_view` and ≥ 2 views)
  4. Selected view component consumes the same row set
- Components (v1):
  - `<KpiCard>` — single panel for `type: kpi`
  - `<DataViewPanel>` — wrapper that owns view-tab state and dispatches to:
    - `<TableView>` (shadcn DataTable, column whitelist + order)
    - `<BoardView>` (CSS grid columns by distinct `group_by` value, cards = `card_title` + optional subtitle, **read-only — no drag**)
- Refresh: a "↻ Refresh" button re-runs all queries on the current dashboard. No live subscriptions in v1.
- Error rendering: SQL errors / missing tables / missing `group_by` columns show inline per-panel-or-view, don't crash the whole dashboard.

### 4.4 Agent integration

Two new system-level MCP tools (not provided by any app — provided by the runtime itself):

**`list_data_tables`** — let the agent discover what's queryable.
```
input: {}
output: [
  { name: "twitter_posts",
    columns: [{name, type}, ...],
    row_count: number },
  { name: "linkedin_posts", ... },
  ...
]
```
Implementation: introspects shared `data.db` via `sqlite_master` + `PRAGMA table_info`. No app-side declaration needed.

**`create_dashboard`** — write a new `.dashboard` file.
```
input: {
  name: string,            // file name without extension
  title: string,
  description?: string,
  panels: [
    | { type: 'kpi',       title, query }
    | { type: 'data_view', title, query,
        views: [
          | { type: 'table', columns?: string[] }
          | { type: 'board', group_by: string, card_title: string, card_subtitle?: string }
        ],
        default_view?: 'table' | 'board' }
  ]
}
side effects:
  - Validates each query parses + runs on data.db (read-only, EXPLAIN or LIMIT 0)
  - Validates view configs reference real columns from the query's projection
  - Writes YAML to workspace/<id>/files/dashboards/<name>.dashboard
  - Returns file path
```

**Agent prompt addition (small):** one line in system prompt — *"Use `list_data_tables` to discover queryable data, and `create_dashboard` to make dashboards. For `data_view` panels, prefer adding a `board` view (grouped by status / category / stage) when the row set has a low-cardinality enum-like column."*

The agent now has the loop: discover → compose SQL → create file → user opens it.

## 5. Phased delivery

### Phase 1 — Shared SQLite plumbing
Goal: one app (Twitter) writes to shared db. Existing functionality preserved.

- [ ] Add `getWorkspaceDb()` to `@holaboss/bridge`
- [ ] Add `WORKSPACE_DB_PATH` to runtime env injection in `holaOS/runtime/api-server`
- [ ] Migrate Twitter app:
  - Switch `src/server/db.ts` to `getWorkspaceDb()`
  - Rename tables: `posts` → `twitter_posts`, `jobs` → `twitter_jobs`
  - One-time migration: on first launch, if `./data/module.db` exists, copy rows into shared db with new names, then move old file to `./data/module.db.bak`
- [ ] Lockfile at `workspace/<id>/.holaboss/data.db.lock` written on workspace open
- [ ] Verify: Twitter app still publishes / lists / queues posts as before, now via shared db

### Phase 2 — Dashboard renderer
Goal: hand-written `.dashboard` file renders in desktop, with table + board view switching.

- [ ] Define YAML schema (Zod) and parser — covers `kpi`, `data_view` with `table` / `board` views
- [ ] Desktop route `/files/dashboard/$path`
- [ ] IPC: `dashboard.run-query` (main runs SQL, returns rows)
- [ ] Components:
  - [ ] `<KpiCard>` — shadcn card with big numeric value + title
  - [ ] `<DataViewPanel>` — wrapper, holds selected-view state, renders tab bar when ≥ 2 views
  - [ ] `<TableView>` — shadcn DataTable with column whitelist + order
  - [ ] `<BoardView>` — read-only Kanban: distinct `group_by` values become columns, rows become cards (no drag)
- [ ] Files panel: register `.dashboard` → desktop renderer
- [ ] Smoke test: hand-craft `social-overview.dashboard` with one `kpi` + one `data_view` (table+board), double-click, see panels render and view tab works

### Phase 3 — Agent authoring
Goal: agent creates a `.dashboard` file via chat.

- [ ] Implement `list_data_tables` and `create_dashboard` as runtime-provided MCP tools
- [ ] Wire into agent's tool registry (system tools, not from any app)
- [ ] Add the one-line system prompt addition
- [ ] End-to-end test: chat "make me a dashboard of failed posts across all platforms" → file appears → opens → renders

### Phase 4 — Migrate LinkedIn + Reddit (parallel to Phase 3)
- [ ] Same migration as Phase 1's Twitter step

### Phase 5 (deferred) — chart panel types + UX polish
- `line` / `bar` / `pie` panels (Recharts or similar)
- Filters / parameters
- Drill-down / interactive linking
- Auto-refresh / live updates
- Visual editor (drag-drop) — agent-first, but power users may want this later

## 6. Decisions taken (carrying forward from prior discussion)

| # | Decision | Source |
|---|---|---|
| 1 | Db file = `workspace/<id>/.holaboss/data.db`, lockfile-protected | confirmed |
| 2 | Migration failure → quarantine offending pack/app | confirmed |
| 3 | Uninstall keeps data by default | confirmed |
| 4 | Schema versioning: simple integer, defer semver | confirmed |
| 5 | App ≠ Pack (terminology stays "App") | confirmed |
| 6 | No declarative-heavy manifest; introspect shared db for schema | confirmed |
| 7 | "Type 1/2/3" was a thinking aid — real model is **Integration App + dashboard files** | new |

## 7. Open questions to confirm before coding

1. **Renderer placement:** built into desktop (proposed) vs. a default-installed system app. Built-in is faster to ship but couples desktop to viz code. Acceptable?
2. **Panel kinds in v1:** `kpi` + `data_view` with `table` + `board` views (proposed). Gallery / line chart / bar chart deferred to Phase 5. Confirm scope?
3. **Board drag-to-update status:** v1 = read-only board, no drag (proposed). Drag would require write-back into the source app's table, which breaks the "dashboard is a read-only view" invariant. Confirm defer?
4. **Dashboard file location:** `files/dashboards/*.dashboard` (proposed; standard subfolder) vs. anywhere under `files/`. The former gives a discoverable home; the latter is more Notion-like.
5. **Migration strategy for existing apps' private dbs:** copy + rename + back up old file (proposed) vs. wipe and start fresh (acceptable for early users only).
6. **Schema awareness in agent context:** dedicated `list_data_tables` tool (proposed) vs. inject schema summary into every system prompt. Tool-based is cleaner; prompt-injection is faster for the agent.

## 8. Non-goals (v1)

- Cross-workspace data sharing
- Multi-user permissions
- Real-time / subscription panels
- Filters / parameters / drill-down
- Visual dashboard editor
- Cross-pack schema versioning protocol (declared `reads: twitter@1`)
- Public dashboard sharing / export

## 9. First commit target

Phase 1 only: Twitter app on shared db, with smoke test that publish + list still work.
Branch: `feat/workspace-shared-sqlite`.
