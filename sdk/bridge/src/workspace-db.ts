import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { resolveWorkspaceDbPath } from "./env"

let cachedDb: Database.Database | null = null
let cachedPath: string | null = null

/**
 * Opens (or returns the cached handle to) the workspace's shared SQLite
 * database. All apps within a workspace share this file; tables should
 * be prefixed with the app id (e.g. `twitter_posts`). Convention is
 * permissive read across packs, single-writer per table.
 *
 * The path is read from `WORKSPACE_DB_PATH`, injected by the runtime
 * when the app process is spawned. The helper enables WAL mode and
 * foreign keys, and creates the parent directory if absent.
 *
 * `better-sqlite3` is declared as a peer dependency so the SDK itself
 * stays free of native bindings for callers that only use the
 * integration proxy. Apps invoking this helper must install
 * `better-sqlite3` themselves — the static import below is resolved by
 * the consumer's bundler at build time, which marks the native module
 * as external.
 */
export function getWorkspaceDb(): Database.Database {
  const dbPath = resolveWorkspaceDbPath()
  if (!dbPath) {
    throw new Error(
      "WORKSPACE_DB_PATH is not set. The runtime must inject it for workspace-scoped apps; " +
        "outside the runtime, set it explicitly before calling getWorkspaceDb().",
    )
  }

  if (cachedDb && cachedPath === dbPath) {
    return cachedDb
  }
  if (cachedDb && cachedPath !== dbPath) {
    cachedDb.close()
    cachedDb = null
  }

  mkdirSync(dirname(dbPath), { recursive: true })

  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")

  cachedDb = db
  cachedPath = dbPath
  return db
}

/** Resets the cached handle. Intended for tests; production code should
 *  let the cache live for the lifetime of the process. */
export function __resetWorkspaceDbForTesting(): void {
  if (cachedDb) {
    try {
      cachedDb.close()
    } catch {
      // ignore — tests may have closed the handle directly
    }
  }
  cachedDb = null
  cachedPath = null
}
