import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { buildRuntimeApiServer } from "./app.js";
import {
  RuntimeCronWorker,
  cronjobCheckIntervalMs,
  cronjobInstruction,
  cronjobIsDue,
  cronjobNextRunAt
} from "./cron-worker.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

test("cronjob helpers preserve legacy scheduling behavior", () => {
  const dueJob = {
    enabled: true,
    cron: "0 9 * * *",
    lastRunAt: null
  };
  assert.equal(cronjobIsDue(dueJob as never, new Date("2025-01-01T09:30:00Z")), true);
  assert.ok(cronjobNextRunAt("0 9 * * *", new Date("2025-01-01T09:30:00Z")));
  assert.equal(cronjobNextRunAt("not a cron", new Date("2025-01-01T09:30:00Z")), null);
  assert.equal(
    cronjobInstruction("Daily check", { priority: 1, team: "growth" }),
    'Daily check\n\n[Cronjob Metadata]\n{"team":"growth"}'
  );

  const previous = process.env.CRONJOB_RUNNER_CHECK_INTERVAL_SECONDS;
  process.env.CRONJOB_RUNNER_CHECK_INTERVAL_SECONDS = "2";
  assert.equal(cronjobCheckIntervalMs(), 5000);
  if (previous === undefined) {
    delete process.env.CRONJOB_RUNNER_CHECK_INTERVAL_SECONDS;
  } else {
    process.env.CRONJOB_RUNNER_CHECK_INTERVAL_SECONDS = previous;
  }
});

test("runtime cron worker queues due session_run cronjobs and updates bookkeeping", async () => {
  const root = makeTempDir("hb-runtime-cron-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
  });
  const job = store.createCronjob({
    workspaceId: workspace.id,
    initiatedBy: "workspace_agent",
    name: "Daily",
    cron: "0 9 * * *",
    description: "Daily check",
    delivery: { channel: "session_run" },
    metadata: {
      session_id: "session-cron",
      model: "gpt-5",
      priority: 3,
      idempotency_key: "cron-idempotency",
      team: "growth"
    }
  });

  let wakeCalls = 0;
  const worker = new RuntimeCronWorker({
    store,
    queueWorker: {
      async start() {},
      wake() {
        wakeCalls += 1;
      },
      async close() {}
    }
  });

  const processed = await worker.processDueCronjobsOnce(new Date("2025-01-01T09:30:00Z"));
  const updated = store.getCronjob(job.id);
  const runtimeState = store.getRuntimeState({ workspaceId: workspace.id, sessionId: "session-cron" });
  const queued = store.claimInputs({ limit: 10, claimedBy: "test", leaseSeconds: 300 });
  const history = store.listSessionMessages({ workspaceId: workspace.id, sessionId: "session-cron" });

  assert.equal(processed, 1);
  assert.equal(wakeCalls, 1);
  assert.ok(updated);
  assert.equal(updated.lastStatus, "success");
  assert.equal(updated.runCount, 1);
  assert.ok(updated.lastRunAt);
  assert.ok(updated.nextRunAt);
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "QUEUED");
  assert.equal(history.length, 1);
  assert.match(history[0].id, /^cronjob-/);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].payload.model, "gpt-5");
  assert.deepEqual(queued[0].payload.context, { source: "cronjob", cronjob_id: job.id });
  assert.match(String(queued[0].payload.text), /\[Cronjob Metadata\]/);

  store.close();
});

test("runtime cron worker records failures for unsupported delivery channels", async () => {
  const root = makeTempDir("hb-runtime-cron-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
  });
  const job = store.createCronjob({
    workspaceId: "workspace-1",
    initiatedBy: "workspace_agent",
    name: "Broken",
    cron: "0 9 * * *",
    description: "Broken",
    delivery: { channel: "email" }
  });

  const worker = new RuntimeCronWorker({ store });
  const processed = await worker.processDueCronjobsOnce(new Date("2025-01-01T09:30:00Z"));
  const updated = store.getCronjob(job.id);

  assert.equal(processed, 1);
  assert.ok(updated);
  assert.equal(updated.lastStatus, "failed");
  assert.equal(updated.runCount, 0);
  assert.match(updated.lastError ?? "", /unsupported cronjob delivery channel/);

  store.close();
});

test("cronjob routes compute next_run_at and cron worker lifecycle hooks run", async () => {
  const root = makeTempDir("hb-runtime-cron-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
  });

  let startCalls = 0;
  let closeCalls = 0;
  const app = buildRuntimeApiServer({
    store,
    queueWorker: null,
    bridgeWorker: null,
    cronWorker: {
      async start() {
        startCalls += 1;
      },
      async close() {
        closeCalls += 1;
      }
    }
  });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/cronjobs",
    payload: {
      workspace_id: workspace.id,
      initiated_by: "workspace_agent",
      cron: "0 9 * * *",
      description: "Daily check",
      delivery: { channel: "session_run" }
    }
  });
  const body = created.json() as { id: string; next_run_at: string | null };
  const updated = await app.inject({
    method: "PATCH",
    url: `/api/v1/cronjobs/${body.id}`,
    payload: {
      cron: "0 10 * * *"
    }
  });

  assert.equal(startCalls, 1);
  assert.equal(created.statusCode, 200);
  assert.ok(body.next_run_at);
  assert.equal(updated.statusCode, 200);
  assert.ok(updated.json().next_run_at);

  await app.close();
  assert.equal(closeCalls, 1);
  store.close();
});
