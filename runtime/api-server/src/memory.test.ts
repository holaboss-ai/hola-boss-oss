import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { FilesystemMemoryService as MemoryService } from "./memory.js";

const tempDirs: string[] = [];
const envNames = ["MEMORY_BACKEND", "MEMORY_ROOT_DIR"] as const;
const envSnapshot = new Map<string, string | undefined>();

for (const name of envNames) {
  envSnapshot.set(name, process.env[name]);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const name of envNames) {
    const value = envSnapshot.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

test("filesystem memory service preserves search/get/upsert/status/sync payload shape", async () => {
  const root = makeTempDir("hb-memory-");
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspaceRoot, "memory", "workspace", "workspace-1"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "memory", "preference"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, "memory", "workspace", "workspace-1", "notes.md"),
    "# Notes\ncoffee preference\nsecond line\n",
    "utf8"
  );
  fs.writeFileSync(path.join(workspaceRoot, "memory", "preference", "profile.md"), "coffee and tea\n", "utf8");

  const service = new MemoryService({ workspaceRoot });

  const searched = await service.search({
    workspace_id: "workspace-1",
    query: "coffee preference",
    max_results: 5,
    min_score: 0.1
  });
  const fetched = await service.get({
    workspace_id: "workspace-1",
    path: "workspace/workspace-1/notes.md"
  });
  const missing = await service.get({
    workspace_id: "workspace-1",
    path: "workspace/workspace-1/missing.md"
  });
  const upserted = await service.upsert({
    workspace_id: "workspace-1",
    path: "workspace/workspace-1/new.md",
    content: "hello",
    append: false
  });
  const status = await service.status({ workspace_id: "workspace-1" });
  const synced = await service.sync({ workspace_id: "workspace-1", reason: "manual", force: true });
  const rootIndex = await service.upsert({
    workspace_id: "workspace-1",
    path: "MEMORY.md",
    content: "# Memory Index\n",
    append: false
  });
  const fetchedRootIndex = await service.get({
    workspace_id: "workspace-1",
    path: "MEMORY.md"
  });

  assert.equal(Array.isArray(searched.results), true);
  assert.equal((searched.results as Array<Record<string, unknown>>).length >= 1, true);
  assert.equal((searched.status as Record<string, unknown>).provider, "filesystem");
  assert.deepEqual(fetched, {
    path: "workspace/workspace-1/notes.md",
    text: "# Notes\ncoffee preference\nsecond line\n"
  });
  assert.deepEqual(missing, {
    path: "workspace/workspace-1/missing.md",
    text: ""
  });
  assert.deepEqual(upserted, {
    path: "workspace/workspace-1/new.md",
    text: "hello"
  });
  assert.deepEqual(rootIndex, {
    path: "MEMORY.md",
    text: "# Memory Index\n"
  });
  assert.deepEqual(fetchedRootIndex, {
    path: "MEMORY.md",
    text: "# Memory Index\n"
  });
  assert.equal(status.backend, "builtin");
  assert.deepEqual(synced, {
    success: true,
    status
  });
});

test("filesystem memory service reports generic fallback metadata for unsupported backends", async () => {
  const root = makeTempDir("hb-memory-");
  process.env.MEMORY_BACKEND = "sqlite";
  const service = new MemoryService({ workspaceRoot: path.join(root, "workspace") });

  const status = await service.status({ workspace_id: "workspace-1" });

  assert.equal(status.backend, "builtin");
  assert.equal(status.requested_provider, "sqlite");
  assert.deepEqual(status.fallback, {
    from: "sqlite",
    reason: "ts runtime only supports the builtin filesystem memory backend"
  });
});
