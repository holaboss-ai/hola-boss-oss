import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import Database from "better-sqlite3";

import { runDebugCli } from "./debug-cli.js";
import { RuntimeStateStore } from "./store.js";

interface CliResult {
  exitCode: number;
  stdout: string;
  json: unknown;
}

async function runCli(argv: string[], dbPath: string): Promise<CliResult> {
  const lines: string[] = [];
  const exitCode = await runDebugCli({
    argv: ["--db-path", dbPath, ...argv],
    out: (line) => lines.push(line),
  });
  const stdout = lines.join("\n");
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = undefined;
  }
  return { exitCode, stdout, json };
}

function tmpDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `holaboss-cli-${name}-`));
  return path.join(dir, "runtime.db");
}

function seedStore(dbPath: string): RuntimeStateStore {
  const workspaceRoot = path.dirname(dbPath);
  const store = new RuntimeStateStore({ dbPath, workspaceRoot });
  store.createWorkspace({
    workspaceId: "ws-1",
    name: "First",
    harness: "pi",
    status: "active",
    onboardingStatus: "complete",
  });
  store.createWorkspace({
    workspaceId: "ws-2",
    name: "Second",
    harness: "pi",
    status: "provisioning",
    onboardingStatus: "pending",
  });
  return store;
}

test("help prints usage and exits 0", async () => {
  const dbPath = tmpDb("help");
  const result = await runCli(["help"], dbPath);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /holaboss-runtime/);
  assert.match(result.stdout, /Commands:/);
});

test("unknown command prints usage and exits 2", async () => {
  const dbPath = tmpDb("unknown");
  const result = await runCli(["does-not-exist"], dbPath);
  assert.equal(result.exitCode, 2);
  assert.match(result.stdout, /unknown command/);
});

test("migrations on a fresh DB shows current=0 and pending=[] (no migrations registered yet)", async () => {
  const dbPath = tmpDb("migrations");
  // Just open + close to create the DB
  seedStore(dbPath).close();

  const result = await runCli(["migrations"], dbPath);
  assert.equal(result.exitCode, 0);
  const json = result.json as {
    current: number;
    target: number;
    pending: unknown[];
    registered: unknown[];
  };
  // No migrations are registered today; legacy ensure-helpers ARE the baseline
  assert.equal(json.current, 0);
  assert.equal(json.target, 0);
  assert.deepEqual(json.pending, []);
  assert.deepEqual(json.registered, []);
});

test("tables lists known runtime tables with row counts", async () => {
  const dbPath = tmpDb("tables");
  seedStore(dbPath).close();

  const result = await runCli(["tables"], dbPath);
  assert.equal(result.exitCode, 0);
  const rows = result.json as Array<{ table: string; rows: number }>;
  const workspaces = rows.find((r) => r.table === "workspaces");
  assert.ok(workspaces, "workspaces table should be present");
  assert.equal(workspaces?.rows, 2);
});

test("dump <table> returns rows up to limit", async () => {
  const dbPath = tmpDb("dump");
  seedStore(dbPath).close();

  const result = await runCli(["dump", "workspaces"], dbPath);
  assert.equal(result.exitCode, 0);
  const rows = result.json as Array<{ id: string; name: string }>;
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    ["ws-1", "ws-2"],
  );
});

test("dump --limit N caps result count", async () => {
  const dbPath = tmpDb("dump-limit");
  seedStore(dbPath).close();

  const result = await runCli(["dump", "workspaces", "--limit", "1"], dbPath);
  assert.equal(result.exitCode, 0);
  const rows = result.json as unknown[];
  assert.equal(rows.length, 1);
});

test("dump --where col=val filters rows", async () => {
  const dbPath = tmpDb("dump-where");
  seedStore(dbPath).close();

  const result = await runCli(
    ["dump", "workspaces", "--where", "status=active"],
    dbPath,
  );
  assert.equal(result.exitCode, 0);
  const rows = result.json as Array<{ id: string; status: string }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, "active");
});

test("dump rejects unsafe table names", async () => {
  const dbPath = tmpDb("dump-unsafe");
  seedStore(dbPath).close();

  const result = await runCli(["dump", "workspaces; DROP TABLE workspaces"], dbPath);
  assert.equal(result.exitCode, 2);
  assert.match(result.stdout, /unsafe/);
});

test("dump rejects negative limit", async () => {
  const dbPath = tmpDb("dump-neg");
  seedStore(dbPath).close();

  const result = await runCli(
    ["dump", "workspaces", "--limit", "-5"],
    dbPath,
  );
  assert.equal(result.exitCode, 2);
});

test("workspaces lists all workspaces sorted by recency", async () => {
  const dbPath = tmpDb("ws");
  seedStore(dbPath).close();

  const result = await runCli(["workspaces"], dbPath);
  assert.equal(result.exitCode, 0);
  const rows = result.json as Array<{ id: string; status: string }>;
  assert.equal(rows.length, 2);
});

test("sessions <workspace> requires workspace id", async () => {
  const dbPath = tmpDb("sess-noarg");
  seedStore(dbPath).close();

  const result = await runCli(["sessions"], dbPath);
  assert.equal(result.exitCode, 2);
  assert.match(result.stdout, /usage:/);
});

test("sessions <workspace> returns rows for a workspace with no sessions", async () => {
  const dbPath = tmpDb("sess-empty");
  seedStore(dbPath).close();

  const result = await runCli(["sessions", "ws-1"], dbPath);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.json, []);
});

test("jobs returns aggregated counts across queue/cron/post-run/evolve", async () => {
  const dbPath = tmpDb("jobs");
  seedStore(dbPath).close();

  const result = await runCli(["jobs"], dbPath);
  assert.equal(result.exitCode, 0);
  const json = result.json as Record<string, unknown>;
  assert.ok("queue" in json);
  assert.ok("cron" in json);
  assert.ok("post_run" in json);
  assert.ok("evolve_candidates" in json);
});

test("health on a real DB returns ok=true", async () => {
  const dbPath = tmpDb("health-ok");
  seedStore(dbPath).close();

  const result = await runCli(["health"], dbPath);
  assert.equal(result.exitCode, 0);
  const json = result.json as { ok: boolean; tableCount: number };
  assert.equal(json.ok, true);
  assert.ok(json.tableCount > 0);
});

test("health on a non-existent DB returns ok=false and exits non-zero", async () => {
  const fakePath = path.join(
    os.tmpdir(),
    `holaboss-cli-${Date.now()}-missing.db`,
  );
  // Use a custom openDb that simulates failure (real `new Database(path, {readonly:true})`
  // on a missing file throws — the CLI catches and surfaces as ok=false).
  const lines: string[] = [];
  const exit = await runDebugCli({
    argv: ["--db-path", fakePath, "health"],
    out: (l) => lines.push(l),
    openDb: () => {
      throw new Error("SQLITE_CANTOPEN: unable to open database file");
    },
  });
  assert.equal(exit, 1);
  const json = JSON.parse(lines.join("\n")) as { ok: boolean; errors: string[] };
  assert.equal(json.ok, false);
  assert.ok(json.errors.length > 0);
});
