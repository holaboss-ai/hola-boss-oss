import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import Database from "better-sqlite3";
import { load as parseYaml } from "js-yaml";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { RuntimeAgentToolsService, RuntimeAgentToolsServiceError } from "./runtime-agent-tools.js";

interface Harness {
  service: RuntimeAgentToolsService;
  workspaceId: string;
  workspaceDir: string;
  dataDbPath: string;
  cleanup: () => void;
}

function makeHarness(): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hb-runtime-tools-"));
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = path.join(workspaceRoot, workspace.id);
  fs.mkdirSync(path.join(workspaceDir, ".holaboss"), { recursive: true });
  const dataDbPath = path.join(workspaceDir, ".holaboss", "data.db");

  const service = new RuntimeAgentToolsService(store, { workspaceRoot });
  return {
    service,
    workspaceId: workspace.id,
    workspaceDir,
    dataDbPath,
    cleanup: () => {
      try {
        store.close();
      } catch {
        /* ignore */
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function seedTwitterPosts(dbPath: string) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE twitter_posts (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_twitter_posts_status ON twitter_posts(status);
  `);
  const insert = db.prepare(
    "INSERT INTO twitter_posts (id, content, status, created_at) VALUES (?, ?, ?, ?)",
  );
  insert.run("p1", "First draft", "draft", "2026-04-28T00:00:00Z");
  insert.run("p2", "Second draft", "draft", "2026-04-28T00:00:01Z");
  insert.run("p3", "Published one", "published", "2026-04-28T00:00:02Z");
  db.close();
}

let harness: Harness;
beforeEach(() => {
  harness = makeHarness();
});
afterEach(() => {
  harness.cleanup();
});

test("listDataTables returns empty list when data.db is missing", () => {
  const result = harness.service.listDataTables({ workspaceId: harness.workspaceId });
  assert.deepEqual(result.tables, []);
  assert.match(String(result.note ?? ""), /data\.db does not exist/);
});

test("listDataTables introspects tables, columns, and row counts", () => {
  seedTwitterPosts(harness.dataDbPath);
  const result = harness.service.listDataTables({ workspaceId: harness.workspaceId });
  const tables = result.tables as Array<{
    name: string;
    columns: Array<{ name: string; type: string }>;
    row_count: number;
  }>;
  assert.equal(tables.length, 1);
  const posts = tables[0];
  assert.equal(posts.name, "twitter_posts");
  assert.equal(posts.row_count, 3);
  const colNames = posts.columns.map((c) => c.name);
  assert.deepEqual(colNames.slice(0, 4), ["id", "content", "status", "created_at"]);
});

test("listDataTables hides app-internal tables by default; includeSystem reveals them", () => {
  seedTwitterPosts(harness.dataDbPath);
  // Add the metrics-convention internal tables.
  const db = new Database(harness.dataDbPath);
  db.exec(`
    CREATE TABLE twitter_jobs (id TEXT PRIMARY KEY);
    CREATE TABLE twitter_metrics_runs (id INTEGER PRIMARY KEY, started_at TEXT);
    CREATE TABLE twitter_api_usage (date TEXT PRIMARY KEY);
    CREATE TABLE twitter_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE twitter_post_metrics (post_id TEXT, captured_at TEXT, PRIMARY KEY (post_id, captured_at));
  `);
  db.close();

  const filtered = harness.service.listDataTables({ workspaceId: harness.workspaceId });
  const filteredNames = (filtered.tables as Array<{ name: string }>).map((t) => t.name);
  assert.deepEqual(
    filteredNames.sort(),
    ["twitter_post_metrics", "twitter_posts"].sort(),
    "default response hides queues/runs/usage/settings",
  );
  assert.equal(filtered.hidden_system_count, 4);

  const all = harness.service.listDataTables({
    workspaceId: harness.workspaceId,
    includeSystem: true,
  });
  const allNames = (all.tables as Array<{ name: string }>).map((t) => t.name);
  assert.equal(allNames.length, 6);
  assert.equal(all.hidden_system_count, undefined);
});

test("createDashboard validates SQL and writes a YAML file", async () => {
  seedTwitterPosts(harness.dataDbPath);
  const result = await harness.service.createDashboard({
    workspaceId: harness.workspaceId,
    name: "social-overview",
    title: "Social Overview",
    description: "Drafts and publish status.",
    panels: [
      {
        type: "kpi",
        title: "Total Drafts",
        query: "SELECT COUNT(*) AS value FROM twitter_posts",
      },
      {
        type: "data_view",
        title: "All Posts",
        query: "SELECT id, content, status FROM twitter_posts",
        views: [
          { type: "table", columns: ["content", "status"] },
          { type: "board", group_by: "status", card_title: "content" },
        ],
        default_view: "board",
      },
    ],
  });

  assert.equal(result.panel_count, 2);
  assert.equal(result.file_path, "files/dashboards/social-overview.dashboard");
  const absolutePath = path.join(
    harness.workspaceDir,
    "files",
    "dashboards",
    "social-overview.dashboard",
  );
  assert.equal(fs.existsSync(absolutePath), true);

  const written = fs.readFileSync(absolutePath, "utf8");
  const parsed = parseYaml(written) as {
    title: string;
    description: string;
    panels: Array<{ type: string; views?: Array<{ type: string }> }>;
  };
  assert.equal(parsed.title, "Social Overview");
  assert.equal(parsed.description, "Drafts and publish status.");
  assert.equal(parsed.panels.length, 2);
  assert.equal(parsed.panels[0].type, "kpi");
  assert.equal(parsed.panels[1].type, "data_view");
  assert.deepEqual(
    parsed.panels[1].views?.map((v) => v.type),
    ["table", "board"],
  );
});

test("createDashboard rejects bad SQL with a 400 + named code", async () => {
  seedTwitterPosts(harness.dataDbPath);
  await assert.rejects(
    () =>
      harness.service.createDashboard({
        workspaceId: harness.workspaceId,
        name: "broken",
        title: "Broken",
        panels: [
          {
            type: "kpi",
            title: "Bad",
            query: "SELECT COUNT(*) AS value FROM nonexistent_table",
          },
        ],
      }),
    (err: unknown) => {
      assert.ok(err instanceof RuntimeAgentToolsServiceError);
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, "dashboard_panel_query_invalid");
      return true;
    },
  );
  // No file should have been written.
  const dashboardsDir = path.join(harness.workspaceDir, "files", "dashboards");
  if (fs.existsSync(dashboardsDir)) {
    assert.deepEqual(fs.readdirSync(dashboardsDir), []);
  }
});

test("createDashboard rejects an unsafe filename slug", async () => {
  seedTwitterPosts(harness.dataDbPath);
  await assert.rejects(
    () =>
      harness.service.createDashboard({
        workspaceId: harness.workspaceId,
        name: "../escape",
        title: "X",
        panels: [
          {
            type: "kpi",
            title: "T",
            query: "SELECT 1 AS value",
          },
        ],
      }),
    (err: unknown) => {
      assert.ok(err instanceof RuntimeAgentToolsServiceError);
      assert.equal(err.code, "dashboard_name_invalid");
      return true;
    },
  );
});
