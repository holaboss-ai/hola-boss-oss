---
title: Workspace Data Layer — Tier 2 (declarative schema ownership)
date: 2026-04-30
status: draft
phase: foundation
related:
  - 2026-04-28-post-metrics-convention.md
  - 2026-04-28-dashboard-file-type-design.md
---

# Workspace Data Layer — Tier 2

## 1. Why this exists

Tier 1 (commit `aa1d7a0` in `holaOS`) moved `data.db` *file* lifecycle from "first app to call `getDb()`" to the runtime. That fixes the immediate bug where `list_data_tables` and `create_dashboard` returned "data.db doesn't exist" on healthy workspaces.

It does not fix the deeper issue: **schema authority is still scattered across module-app processes.** Every app's `db.ts` ships `CREATE TABLE IF NOT EXISTS …` blocks that run on every `getDb()` call, plus legacy migration code (`migrateLegacyPrivateDb`, `renameLegacyTablesIfNeeded`). Symptoms today:

- Multiple processes race to apply schema on cold start.
- An app must boot once before its tables exist — `list_data_tables` is empty until then, even if the agent only wants to *read* the (yet-uncreated) shape.
- Schema upgrades are coupled to deploy timing (which `start-services.cjs` runs first wins the migration).
- The legacy-rename code has known bugs (e.g. early-return-skips-rename in twitter's M0 migration).
- `create_dashboard` cannot validate column references unless the relevant app has actually written rows.

Tier 2 makes the runtime the **schema authority**. Apps declare their tables in `app.runtime.yaml`; the runtime applies them at install/upgrade time; app processes just `new Database(WORKSPACE_DB_PATH)` and use the schema that's already there.

## 2. Goals (Tier 2 scope)

1. Apps declare every table they read or write in a `data_schema:` block of `app.runtime.yaml`.
2. Runtime applies that schema during the app's existing install lifecycle step (after archive extract, before `lifecycle.setup`), idempotently.
3. Each app's `db.ts` shrinks to: `getDb()` opens `WORKSPACE_DB_PATH`. No `ensureSchema`, no `migrateLegacy*`.
4. `list_data_tables` answers from registered manifests first (so it works before any app process has booted), with DB introspection as a sanity check / row-count source.
5. `create_dashboard` can validate panel SQL against manifest-declared columns even when the underlying tables are still empty.
6. A `_app_schema_versions` table in `data.db` tracks which app shipped which schema version — feeds future export / diagnostics tooling.

## 3. Non-goals (deferred to Tier 3 or later)

- Replacing `import Database from "better-sqlite3"` in apps with a typed client. Apps still own their queries.
- Cross-app foreign keys or referential integrity.
- Connection pooling, lock arbitration, or backup-aware checkpointing.
- Switching the storage engine to anything other than SQLite.
- Auto-generated TypeScript types from manifests. (Could come later, low priority.)

## 4. The manifest shape

```yaml
# app.runtime.yaml (excerpt)
app_id: "twitter"
slug: "twitter"

data_schema:
  version: 4   # bumped on every schema-changing release
  tables:
    twitter_posts:
      visibility: user_facing
      columns:
        id:                { type: TEXT, primary_key: true }
        content:           { type: TEXT, not_null: true }
        status:            { type: TEXT, not_null: true, default: "'draft'" }
        scheduled_at:      { type: TEXT }
        external_post_id:  { type: TEXT }
        published_at:      { type: TEXT }
        deleted_at:        { type: TEXT }
        created_at:        { type: TEXT, not_null: true, default: "datetime('now')" }
        updated_at:        { type: TEXT, not_null: true, default: "datetime('now')" }
      indexes:
        - { name: idx_twitter_posts_status,    columns: [status] }
        - { name: idx_twitter_posts_published, columns: [published_at] }
    twitter_jobs:
      visibility: app_internal   # hidden from list_data_tables by default
      columns: { … }
    twitter_post_metrics:
      visibility: user_facing
      columns: { … }
      primary_key: [post_id, captured_at]
```

Three visibility tiers (Tier 1 introduced two, this formalizes a third):

| Visibility | Default `list_data_tables` | `includeSystem=true` | Purpose |
|---|---|---|---|
| `user_facing` | shown | shown | dashboards, agent reasoning |
| `app_internal` | hidden | shown | queues, scheduler logs, settings |
| `runtime_internal` | hidden | hidden | `_workspace_meta`, `_app_schema_versions` |

Suffix-based `isSystemTable()` and prefix-based `isRuntimeInternalTable()` from Tier 1 become fallbacks for unmanifested tables; manifest declarations win when present.

## 5. Apply algorithm

When the runtime is about to start an app (or as a discrete step before `lifecycle.setup` on first install / upgrade):

```
read manifest.data_schema from <appDir>/app.runtime.yaml
read recorded version from _app_schema_versions WHERE app_id = ?

if recorded == manifest.version: no-op
else if recorded == null (first install):
   for each table in manifest.tables:
     CREATE TABLE IF NOT EXISTS … (full DDL from manifest)
     CREATE INDEX IF NOT EXISTS … for each declared index
   INSERT INTO _app_schema_versions (app_id, version, applied_at)
else (upgrade):
   if manifest provides explicit migration script for recorded → manifest.version:
       run that script in a transaction
   else:
       diff manifest vs live schema (PRAGMA table_info), additive-only:
         - new tables → CREATE
         - new columns → ALTER TABLE … ADD COLUMN (only if nullable / has default)
         - new indexes → CREATE INDEX
   UPDATE _app_schema_versions SET version = manifest.version
```

Destructive changes (drop/rename column, drop table, type change) require an explicit migration block; the auto-diff is intentionally additive-only to avoid silent data loss.

## 6. `_app_schema_versions` shape

```sql
CREATE TABLE _app_schema_versions (
  app_id      TEXT PRIMARY KEY,
  version     INTEGER NOT NULL,
  applied_at  TEXT NOT NULL,
  manifest_sha TEXT NOT NULL    -- guards against tampered yaml between runs
);
```

`runtime_internal` table (always hidden).

## 7. Implementation breakdown

### 7.1 Runtime (`holaOS/runtime/api-server`)

1. **`data-schema.ts`** (new) — parse + validate the `data_schema:` block from a yaml manifest, produce a normalized in-memory shape, build CREATE/ALTER DDL strings.
2. **`apply-app-schema.ts`** (new) — `applyAppSchema(workspaceDir, appId, manifest): SchemaApplyResult` — opens `data.db`, reads `_app_schema_versions`, runs the apply algorithm above. Pure function over (file, manifest) for testability.
3. **`workspace-apps.ts`** — extend `ResolvedApplicationRuntime` to carry `dataSchema`. Call `applyAppSchema` in the install / setup path, after archive extract, before lifecycle.setup. Same call also on every start as a no-op safety net.
4. **`runtime-agent-tools.ts`** — `listDataTables` consults a registered-schema cache (built from all installed apps' manifests for the workspace) before falling back to DB introspection. Manifest entries provide column metadata even when row count is 0.
5. **Tests** — unit tests for parser + DDL builder + apply (idempotency, additive-upgrade, version mismatch detection, manifest-sha tamper detection).

### 7.2 Module apps (`hola-boss-apps`)

For each of the 12 shippable apps:

1. Add `data_schema:` to `app.runtime.yaml`. Initial version = 1.
2. Strip schema-creation DDL out of `src/server/db.ts`. Keep `getDb()` (now ~10 lines: open `WORKSPACE_DB_PATH`, set pragmas, return).
3. Strip `migrateLegacyPrivateDb` / `renameLegacyTablesIfNeeded`. Provide a one-shot CLI `pnpm migrate-legacy` (kept around for one release cycle for users who never reinstalled post-M0; can delete after).
4. Bump archive, ship.

This is mechanical work — high line-count, low risk, can be done one app at a time.

### 7.3 Backwards compatibility

- Workspaces installed pre-Tier 2 may have tables that exist in DB but no `_app_schema_versions` row. On first Tier-2 start, the runtime detects the table-without-version state and **adopts** the live schema as version 1, recording it in `_app_schema_versions`. No DDL runs; no data is touched.
- Apps that ship pre-Tier 2 (no `data_schema:` block) continue to manage their own schema in code. The runtime no-ops manifest application for them. This means Tier 2 can be rolled out app-by-app, no flag day required.

## 8. Migration sequencing

The riskiest moment is the first time an app upgrades from "self-managed schema" to "manifest-managed schema". Recommended phasing:

1. **Pilot on one app.** Twitter first (most schema, has the metrics convention to exercise). Land runtime + twitter manifest in one PR. Test on a fresh workspace + an existing M0 workspace.
2. **Rollout per-app over ~5 PRs.** Reddit, LinkedIn, Calcom, Attio/Hubspot, Apollo/Instantly, Gmail, then read-throughs (github/sheets/zoominfo, which have only the audit-actions table).
3. **Delete the migration helpers** once all apps are on Tier 2 and one full release cycle has passed.

## 9. Open questions

- **Where does the manifest live for already-installed apps?** Apps install via tar archives that include `app.runtime.yaml`. The runtime reads from `<appDir>/app.runtime.yaml` at start. So manifests are always available locally — no central registry needed.
- **What if two apps declare the same table name?** The convention is app-id-prefixed table names (`twitter_posts`, not `posts`). Runtime should reject manifests whose tables aren't prefixed with the app id, both for namespace hygiene and to make `_app_schema_versions` ownership unambiguous. (`_workspace_meta` is reserved.)
- **How are columns referenced from `.dashboard` files validated?** Out of scope for Tier 2 but enabled by it: the dashboard renderer can ask `runtime.dataSchemaForWorkspace(id)` and statically validate column refs in panel SQL.
- **Connection pooling** — multiple processes still open the same `data.db` file. Tier 2 doesn't address this; SQLite WAL handles it acceptably for the foreseeable load. Tier 3 territory.

## 10. Estimated work

- Runtime parser + applier + tests: ~1 day
- Twitter pilot end-to-end + verifying both fresh and M0-upgrade workspaces: ~0.5 day
- Per-app rollout: ~30 min each × 11 apps = ~6 hours
- Documentation + migration notes: ~1 hour

Total: ~2–3 days of focused work, splittable across PRs.
