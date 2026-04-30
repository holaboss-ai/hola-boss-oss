/**
 * Registered migrations, applied in `id` order. Each migration MUST:
 *   - Have a unique, strictly-increasing `id` (use natural numbers, not gaps)
 *   - Be idempotent on a transaction-rollback (no side effects outside `up`)
 *   - Not begin/commit transactions itself — the runner wraps each migration
 *
 * Adding a new migration:
 *   1. Create `runtime/state-store/src/migrations/NNN-short-name.ts`
 *   2. `export const migration: Migration = { id: NNN, name: "...", up: ... }`
 *   3. Append `import { migration as mNNN } from "./NNN-short-name.js"` here
 *   4. Append `mNNN` to the array below
 *   5. Bump `LATEST_SEED_VERSION` only if the migration touches a table that
 *      `ensureRuntimeDbSchema` also tries to create (i.e. legacy DBs already
 *      have it)
 *
 * `LATEST_SEED_VERSION` represents the highest id whose schema overlaps with
 * the legacy `ensureRuntimeDbSchema` baseline. Migrations above this id are
 * applied to legacy DBs; migrations at or below are assumed already applied.
 *
 * Today: 0 migrations. The legacy ensure-helpers ARE the baseline. Future
 * schema changes start at id=1.
 */
import type { Migration, MigrationId } from "../migrations.js";

export const RUNTIME_DB_MIGRATIONS: ReadonlyArray<Migration> = [];

export const LATEST_SEED_VERSION: MigrationId = 0;
