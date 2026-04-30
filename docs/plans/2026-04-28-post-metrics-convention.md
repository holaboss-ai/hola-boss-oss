---
title: Post Metrics Convention (cross-platform)
date: 2026-04-28
status: draft
phase: foundation for metrics-driven dashboards
---

# Post Metrics Convention

## 1. Goal

Capture engagement metrics (impressions / likes / comments / shares / …) for every post a workspace publishes — Twitter first, LinkedIn / Reddit / others later — and store them in a shape that dashboards can read across platforms with a single SQL query.

The user's chat experience after this lands: *"how did my last week of posts do?"* → agent runs `list_data_tables`, sees `twitter_post_metrics_daily` etc., composes a `create_dashboard` with KPIs + trend table → renders.

## 2. Scope of this doc

- The cross-app **schema convention** every platform pack will follow.
- The **refresh model** (Option C from the design discussion: app-internal scheduler).
- **Twitter** as the first concrete implementation. LinkedIn / Reddit replicate the same shape later.

This document does NOT propose:
- Time-series chart panels (`line` / `bar`) for `.dashboard` files. Those are Phase 5 of the dashboard plan and orthogonal to data ingestion.
- A workspace-level cron extension (`tool_invocation` cron type). Deferred until ≥ 3 apps need centralized scheduling.

## 3. The shape every platform pack follows

Three tables per platform, all in workspace-shared `data.db`, all app-namespaced.

### `<platform>_post_metrics` — raw snapshots

```sql
CREATE TABLE twitter_post_metrics (
  post_id      TEXT NOT NULL,
  captured_at  TEXT NOT NULL,    -- ISO 8601, truncated to minute
  impressions  INTEGER,
  likes        INTEGER,
  comments     INTEGER,
  shares       INTEGER,
  bookmarks    INTEGER,           -- platform-specific extension; null on others
  raw          TEXT,              -- JSON of the upstream payload, for debug + future fields
  PRIMARY KEY (post_id, captured_at)
);
CREATE INDEX idx_twitter_post_metrics_captured ON twitter_post_metrics(captured_at);
```

Rules:
- `captured_at` rounds to the minute — inserts during the same minute collide on the PK and use `INSERT OR REPLACE`. Defends against double-fire from overlapping cron ticks.
- Common columns (`impressions`, `likes`, `comments`, `shares`) appear on every platform with the same semantics. Each platform normalizes its native concept into these.
- Platform-specific columns are allowed (`bookmarks` for Twitter; `unique_views` for LinkedIn). Not in the common set.
- `raw` keeps the full upstream JSON so adding new derived columns later doesn't require a re-fetch.

### `<platform>_post_metrics_daily` — daily rollup

```sql
CREATE TABLE twitter_post_metrics_daily (
  post_id      TEXT NOT NULL,
  day          TEXT NOT NULL,    -- YYYY-MM-DD
  impressions  INTEGER,           -- MAX during the day
  likes        INTEGER,
  comments     INTEGER,
  shares       INTEGER,
  bookmarks    INTEGER,
  PRIMARY KEY (post_id, day)
);
```

Filled by the daily rollup job. Holds aggregated view for the full retention window (no truncation), so trend dashboards reading "last 90 days by day" don't have to scan thousands of raw snapshot rows.

### `<platform>_metrics_runs` — refresh activity log

```sql
CREATE TABLE twitter_metrics_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  posts_considered  INTEGER NOT NULL DEFAULT 0,
  posts_refreshed   INTEGER NOT NULL DEFAULT 0,
  posts_skipped     INTEGER NOT NULL DEFAULT 0,
  posts_deleted     INTEGER NOT NULL DEFAULT 0,
  errors_json       TEXT
);
```

One row per scheduled run. Lets a user / agent / dashboard answer *"is the metrics scheduler healthy?"* with a SQL query.

### `<platform>_api_usage` — daily call counts

```sql
CREATE TABLE twitter_api_usage (
  date              TEXT PRIMARY KEY,    -- YYYY-MM-DD
  calls_succeeded   INTEGER NOT NULL DEFAULT 0,
  calls_failed      INTEGER NOT NULL DEFAULT 0,
  calls_rate_limited INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL
);
```

Lightweight passive observability. No active quota gating — let real 429s drive backoff. This table lets the user see "did I burn through my Composio quota today?" without instrumenting upstream.

### Twitter-only schema bump

Add `deleted_at TEXT` to `twitter_posts`. Set when the platform returns 404 for an existing post (account deleted it server-side). Rows stay in the table — historical metrics still useful — but the metrics tier policy stops scheduling them for refresh.

## 4. Refresh model: app-internal scheduler (Option C)

### Why not workspace cron?

Workspace cronjobs route through the agent (LLM call per fire). 5-minute metrics fire would burn ~$10/day/workspace on cron-translation that produces zero new value. See design discussion for full reasoning.

### What runs where

**Twitter app's `start-services.ts`** — already running an interval-based publish queue worker — gains two new intervals:

1. `metricsRefreshInterval` — every 5 min, calls `refreshPostMetrics()` directly in-process.
2. `metricsRollupInterval` — every 24h, calls `rollupAndPrune()` directly in-process.

Both functions are pure module exports — no self-HTTP calls. The MCP tool (`twitter_refresh_post_metrics`) is a thin wrapper that calls the same function with caller-provided params. Agent-driven manual refresh and the in-process scheduler share one implementation.

### Tier policy (lives in code, not in cron config)

| Distance from `published_at` | Refresh interval |
|---|---|
| < 1 hour | 5 min |
| 1 – 24 hours | 30 min |
| 1 – 7 days | 6 h |
| 7 – 30 days | 1 day |
| > 30 days | frozen — never refreshed automatically |

The in-process scheduler ticks every 5 min. Each tick:
1. Loads all `twitter_posts` where `status = 'published' AND deleted_at IS NULL`.
2. For each post, computes its tier from `published_at` and looks up the most-recent `captured_at` from `twitter_post_metrics`.
3. Filters to "due now": posts where `(now - max(captured_at)) >= tier_interval`.
4. Hits Composio for the due batch. Failures handled per-post.
5. INSERT OR REPLACEs new snapshot rows.
6. Writes a row into `twitter_metrics_runs` summarizing the tick.
7. Bumps `twitter_api_usage` counters for today.

### First-launch backfill bound

When the scheduler starts in a workspace that has never had metrics:
- Posts with `published_at >= now - 7 days` enter normal scheduling immediately.
- Posts older than 7 days — even if `published_at` is recent — enter `frozen` tier. They never auto-refresh. The agent can force-refresh via `twitter_refresh_post_metrics({ post_ids: [...], force: true })` if needed.

This guards against an install-time API blast for an account with hundreds of historical posts.

### Pause / resume

Workspace `workspace.yaml` gains an optional flag:

```yaml
apps:
  twitter:
    metrics_refresh: enabled    # or `disabled`
```

Default: `enabled`. The scheduler reads this flag at the start of each tick — disabled means the tick exits immediately (still logs a `posts_considered: 0` run row so the user sees the scheduler is alive but paused).

Agent-facing toggle: a small MCP tool `twitter_set_metrics_refresh({ enabled: bool })` flips the flag. Lets the user say *"pause Twitter metrics for now"* without leaving chat.

## 5. Error handling

| Upstream condition | Action |
|---|---|
| 429 / rate limit | Skip remaining posts in this tick. Bump `calls_rate_limited`. Next tick retries. |
| 404 / not found | Set `twitter_posts.deleted_at = now`. Stop scheduling this post. Keep historical metrics. |
| 5xx | Log, retry next tick. After 5 consecutive failures for the same post, mute it for 24h. |
| Composio not configured | Skip the tick entirely with a clear `errors_json` entry; user fix is to connect the integration. |
| 200 with empty body | Treat as no-op; no snapshot row written. |

## 6. Daily rollup

Runs once per 24h (in-process interval, last-run timestamp persisted via a marker row in `twitter_metrics_runs` so a restart in the middle of a long off-period doesn't skip rollups).

For every day `D` where `D < today` and no row exists in `twitter_post_metrics_daily(post_id, D)`:
1. `INSERT INTO twitter_post_metrics_daily SELECT post_id, date(captured_at), MAX(impressions), MAX(likes), … FROM twitter_post_metrics WHERE date(captured_at) = D GROUP BY post_id`.
2. After all eligible days are rolled up: `DELETE FROM twitter_post_metrics WHERE captured_at < datetime(now, '-90 days')`.

The 90-day cliff is configurable later via workspace.yaml; for v1 it's a constant.

## 7. Cross-platform query examples

After Twitter is in, what becomes possible:

```sql
-- Top performers across all platforms (current values)
SELECT 'twitter' AS platform, post_id, MAX(impressions) AS impressions
FROM twitter_post_metrics GROUP BY post_id
UNION ALL
SELECT 'linkedin', post_id, MAX(impressions) FROM linkedin_post_metrics GROUP BY post_id
ORDER BY impressions DESC LIMIT 20;

-- Daily impression trend across platforms (last 30 days)
SELECT day, SUM(impressions) AS impressions
FROM (
  SELECT day, impressions FROM twitter_post_metrics_daily
  UNION ALL
  SELECT day, impressions FROM linkedin_post_metrics_daily
)
WHERE day >= date('now','-30 days')
GROUP BY day ORDER BY day;
```

Both fit cleanly into the existing dashboard `data_view` panel kind. Once the line chart panel lands (Phase 5 of dashboard plan), the trend query becomes a real chart.

## 8. Phased delivery (M1 → M5)

| Milestone | Content | Estimate |
|---|---|---|
| M1 | This plan doc + twitter app schema (4 new tables + `deleted_at` column) | 0.5 d |
| M2 | `refreshPostMetrics()` core + `twitter_refresh_post_metrics` MCP tool + tier logic + error handling + usage logging | 1 d |
| M3 | `setInterval` scheduler in `start-services.ts` + first-launch backfill bound + `metrics_refresh` workspace flag + `twitter_set_metrics_refresh` MCP tool | 0.5 d |
| M4 | `rollupAndPrune()` + 24h scheduler + 90-day retention | 0.5 d |
| M5 | Hand-written `twitter-metrics.dashboard` covering KPI / table / board / runs log | 0.5 d |

Total: ~3 days. After this, replicating to LinkedIn / Reddit follows the same shape (mostly copy-paste of M2-M4 with platform-specific Composio calls).

## 9. Non-goals

- Active quota check / scheduler-side rate limiting — backoff on 429 is sufficient for v1
- Webhooks / push from Twitter — desktop has no public ingress; pull is right
- Realtime engagement (sub-minute) — not a use case for the kind of dashboards we're targeting
- Time-series chart panels in `.dashboard` files — Phase 5 of the dashboard plan
- Workspace-cron `tool_invocation` type — defer to when ≥ 3 apps need centralized scheduling

## 10. Open follow-ups (not blockers for M1-M5)

- **Manual / agent-driven refresh UX** — agent can already call `twitter_refresh_post_metrics({ post_ids })`. UI button on a single post is convenient but adds chrome; deferred until users ask.
- **Per-post mute** — `twitter_posts` could grow a `metrics_paused INTEGER NOT NULL DEFAULT 0`. Nice-to-have, not v1.
- **Quota dashboard** — `twitter_api_usage` table sustains a dashboard panel showing call volume. Concrete file added in Phase 5 when there's a chart panel.
