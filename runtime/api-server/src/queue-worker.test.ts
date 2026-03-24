import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { buildRuntimeApiServer } from "./app.js";
import { RuntimeQueueWorker, tsQueueWorkerEnabled } from "./queue-worker.js";

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

test("runtime queue worker claims queued inputs and executes them in claim order", async () => {
  const root = makeTempDir("hb-runtime-queue-worker-");
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
  const low = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    priority: 1,
    payload: { text: "low" }
  });
  const high = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    priority: 5,
    payload: { text: "high" }
  });

  const seen: string[] = [];
  const worker = new RuntimeQueueWorker({
    store,
    executeClaimedInput: async (record) => {
      seen.push(record.inputId);
    }
  });

  const firstCount = await worker.processAvailableInputsOnce();
  const secondCount = await worker.processAvailableInputsOnce();
  const thirdCount = await worker.processAvailableInputsOnce();

  assert.equal(firstCount, 1);
  assert.equal(secondCount, 1);
  assert.equal(thirdCount, 0);
  assert.deepEqual(seen, [high.inputId, low.inputId]);

  store.close();
});

test("ts queue worker is enabled by default and only disables on explicit opt-out", () => {
  const previous = process.env.HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER;
  delete process.env.HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER;
  assert.equal(tsQueueWorkerEnabled(), true);

  process.env.HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER = "0";
  assert.equal(tsQueueWorkerEnabled(), false);

  process.env.HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER = "false";
  assert.equal(tsQueueWorkerEnabled(), false);

  process.env.HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER = "1";
  assert.equal(tsQueueWorkerEnabled(), true);

  if (previous === undefined) {
    delete process.env.HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER;
  } else {
    process.env.HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER = previous;
  }
});

test("runtime queue worker marks claimed input failed when delegated execution raises", async () => {
  const root = makeTempDir("hb-runtime-queue-worker-");
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
  store.ensureRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    status: "QUEUED",
    currentInputId: "input-1"
  });
  const queued = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    priority: 1,
    payload: { text: "hello" }
  });

  const worker = new RuntimeQueueWorker({
    store,
    executeClaimedInput: async () => {
      throw new Error("delegated execution failed");
    }
  });

  const processed = await worker.processAvailableInputsOnce();
  const updated = store.getInput(queued.inputId);
  const runtimeState = store.getRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main"
  });

  assert.equal(processed, 1);
  assert.ok(updated);
  assert.equal(updated.status, "FAILED");
  assert.equal(updated.claimedBy, null);
  assert.equal(updated.claimedUntil, null);
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "ERROR");
  assert.deepEqual(runtimeState.lastError, { message: "delegated execution failed" });

  store.close();
});

test("queue route wakes configured queue worker", async () => {
  const root = makeTempDir("hb-runtime-queue-worker-");
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

  let wakeCalls = 0;
  let startCalls = 0;
  let closeCalls = 0;
  const app = buildRuntimeApiServer({
    store,
    queueWorker: {
      async start() {
        startCalls += 1;
      },
      wake() {
        wakeCalls += 1;
      },
      async close() {
        closeCalls += 1;
      }
    },
    cronWorker: null,
    bridgeWorker: null
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/agent-sessions/queue",
    payload: {
      workspace_id: workspace.id,
      session_id: "session-main",
      text: "hello world"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(startCalls, 1);
  assert.equal(wakeCalls, 1);

  await app.close();
  assert.equal(closeCalls, 1);
  store.close();
});
