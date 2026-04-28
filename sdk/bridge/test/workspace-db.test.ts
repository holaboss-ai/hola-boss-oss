import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  __resetWorkspaceDbForTesting,
  getWorkspaceDb,
  resolveWorkspaceDbPath,
} from "../src/index"

// End-to-end exercise of getWorkspaceDb against a real better-sqlite3 file
// lives in the consuming module-app suites (e.g. twitter/test) — the
// native binding doesn't load under bun:test. The bridge package only
// validates env resolution and the missing-env guard here.

const originalEnv = { ...process.env }

describe("resolveWorkspaceDbPath", () => {
  beforeEach(() => {
    delete process.env.WORKSPACE_DB_PATH
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    __resetWorkspaceDbForTesting()
  })

  test("returns empty string when env unset", () => {
    expect(resolveWorkspaceDbPath()).toBe("")
  })

  test("returns the env value when set", () => {
    process.env.WORKSPACE_DB_PATH = "/tmp/custom/data.db"
    expect(resolveWorkspaceDbPath()).toBe("/tmp/custom/data.db")
  })
})

describe("getWorkspaceDb", () => {
  beforeEach(() => {
    delete process.env.WORKSPACE_DB_PATH
    __resetWorkspaceDbForTesting()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    __resetWorkspaceDbForTesting()
  })

  test("throws when WORKSPACE_DB_PATH is unset", () => {
    expect(() => getWorkspaceDb()).toThrow(/WORKSPACE_DB_PATH is not set/)
  })
})
