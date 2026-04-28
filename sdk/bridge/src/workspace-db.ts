import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname } from "node:path"

import { resolveWorkspaceDbPath } from "./env"

const require = createRequire(import.meta.url)

type BetterSqliteDatabase = {
  pragma: (statement: string) => unknown
  exec: (sql: string) => void
  prepare: (sql: string) => unknown
  close: () => void
}

type BetterSqliteConstructor = new (
  filename: string,
  options?: Record<string, unknown>,
) => BetterSqliteDatabase

let cachedDb: BetterSqliteDatabase | null = null
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
 * Better-sqlite3 is declared as a peer dependency rather than a direct
 * dep so the SDK stays free of native bindings for callers that only
 * use the integration proxy. Apps invoking this helper must have
 * `better-sqlite3` installed themselves.
 */
export function getWorkspaceDb(): BetterSqliteDatabase {
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

  const Database = loadBetterSqliteSync()
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

function loadBetterSqliteSync(): BetterSqliteConstructor {
  let required: unknown
  try {
    required = require("better-sqlite3")
  } catch (cause) {
    throw new Error(
      "Failed to load better-sqlite3. Apps invoking getWorkspaceDb() must add better-sqlite3 ^12 as a dependency.",
      { cause: cause instanceof Error ? cause : undefined },
    )
  }
  if (typeof required === "function") {
    return required as BetterSqliteConstructor
  }
  if (required && typeof required === "object" && "default" in required) {
    return (required as { default: BetterSqliteConstructor }).default
  }
  throw new Error(
    "better-sqlite3 module shape unexpected: neither function nor default export.",
  )
}
