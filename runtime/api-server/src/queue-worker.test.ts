import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { buildRuntimeApiServer } from "./app.js";
import { RuntimeQueueWorker } from "./queue-worker.js";

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

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
    harness: "pi",
    status: "active",
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

test("runtime queue worker executes different sessions concurrently while preserving one active input per session", async () => {
  const root = makeTempDir("hb-runtime-queue-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-a",
    priority: 5,
    payload: { text: "a-1" }
  });
  store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-a",
    priority: 4,
    payload: { text: "a-2" }
  });
  store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-b",
    priority: 3,
    payload: { text: "b-1" }
  });

  let active = 0;
  let maxActive = 0;
  const seenSessions: string[] = [];
  const worker = new RuntimeQueueWorker({
    store,
    maxConcurrency: 2,
    executeClaimedInput: async (record) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seenSessions.push(record.sessionId);
      await new Promise((resolve) => setTimeout(resolve, 40));
      active -= 1;
    }
  });

  const processed = await worker.processAvailableInputsOnce();

  assert.equal(processed, 2);
  assert.equal(maxActive, 2);
  assert.deepEqual(seenSessions.sort(), ["session-a", "session-b"]);
  await worker.close();
  store.close();
});

test("runtime queue worker claims later queued work from another session while one session is already active", async () => {
  const root = makeTempDir("hb-runtime-queue-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-a",
    priority: 5,
    payload: { text: "a-1" }
  });
  const sessionASecond = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-a",
    priority: 4,
    payload: { text: "a-2" }
  });

  const release = deferred<void>();
  const aStarted = deferred<void>();
  const bStarted = deferred<void>();
  const seenSessions: string[] = [];
  const worker = new RuntimeQueueWorker({
    store,
    maxConcurrency: 2,
    executeClaimedInput: async (record) => {
      seenSessions.push(record.sessionId);
      if (record.sessionId === "session-a") {
        aStarted.resolve();
      }
      if (record.sessionId === "session-b") {
        bStarted.resolve();
      }
      await release.promise;
    }
  });

  const firstProcessed = await worker.processAvailableInputsOnce();
  assert.equal(firstProcessed, 1);
  await aStarted.promise;

  const sessionBFirst = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-b",
    priority: 3,
    payload: { text: "b-1" }
  });

  const secondProcessed = await worker.processAvailableInputsOnce();
  assert.equal(secondProcessed, 1);
  await bStarted.promise;

  assert.deepEqual(seenSessions.sort(), ["session-a", "session-b"]);
  assert.equal(store.getInput(sessionASecond.inputId)?.status, "QUEUED");
  assert.equal(store.getInput(sessionBFirst.inputId)?.status, "CLAIMED");

  release.resolve();
  await worker.close();
  store.close();
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
    harness: "pi",
    status: "active",
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

test("runtime queue worker can pause a queued session input before it is claimed", async () => {
  const root = makeTempDir("hb-runtime-queue-worker-pause-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: { text: "pause this" }
  });
  store.updateRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    status: "QUEUED",
    currentInputId: queued.inputId,
    currentWorkerId: null,
    leaseUntil: null,
    heartbeatAt: null,
    lastError: null,
  });

  const worker = new RuntimeQueueWorker({ store });
  const paused = await worker.pauseSessionRun({
    workspaceId: "workspace-1",
    sessionId: "session-main",
  });
  const updated = store.getInput(queued.inputId);
  const runtimeState = store.getRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main",
  });
  const events = store.listOutputEvents({
    sessionId: "session-main",
    inputId: queued.inputId,
  });
  const turnResult = store.getTurnResult({ inputId: queued.inputId });

  assert.deepEqual(paused, {
    inputId: queued.inputId,
    sessionId: "session-main",
    status: "PAUSED",
  });
  assert.ok(updated);
  assert.equal(updated.status, "PAUSED");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "PAUSED");
  assert.equal(runtimeState.currentInputId, null);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, "run_completed");
  assert.deepEqual(events[0]?.payload, {
    status: "paused",
    stop_reason: "paused",
    message: "Run paused by user request",
  });
  assert.ok(turnResult);
  assert.equal(turnResult.status, "paused");
  assert.equal(turnResult.stopReason, "paused");

  store.close();
});

test("runtime queue worker recovers expired claimed input before processing fresh queue work", async () => {
  const root = makeTempDir("hb-runtime-queue-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const stale = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: { text: "stale" }
  });
  const fresh = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: { text: "fresh" }
  });
  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "worker-old",
    leaseSeconds: 60
  });
  assert.equal(claimed[0]?.inputId, stale.inputId);
  store.updateInput(stale.inputId, {
    claimedUntil: "2000-01-01T00:00:00.000Z"
  });
  store.updateRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    status: "BUSY",
    currentInputId: stale.inputId,
    currentWorkerId: "worker-old",
    leaseUntil: "2000-01-01T00:00:00.000Z",
    heartbeatAt: "2000-01-01T00:00:00.000Z",
    lastError: null
  });
  const seen: string[] = [];
  const worker = new RuntimeQueueWorker({
    store,
    executeClaimedInput: async (record) => {
      seen.push(record.inputId);
      store.updateInput(record.inputId, {
        status: "DONE",
        claimedBy: null,
        claimedUntil: null
      });
      store.updateRuntimeState({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        status: "IDLE",
        currentInputId: null,
        currentWorkerId: null,
        leaseUntil: null,
        heartbeatAt: null,
        lastError: null
      });
    }
  });

  const processed = await worker.processAvailableInputsOnce();
  const staleUpdated = store.getInput(stale.inputId);
  const freshUpdated = store.getInput(fresh.inputId);
  const runtimeState = store.getRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main"
  });
  const staleEvents = store.listOutputEvents({
    sessionId: "session-main",
    inputId: stale.inputId
  });

  assert.equal(processed, 2);
  assert.ok(staleUpdated);
  assert.equal(staleUpdated.status, "FAILED");
  assert.ok(freshUpdated);
  assert.equal(freshUpdated.status, "DONE");
  assert.deepEqual(seen, [fresh.inputId]);
  assert.equal(staleEvents.at(-1)?.eventType, "run_failed");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "IDLE");

  store.close();
});

test("runtime queue worker aborts an active run when recovering an expired claim", async () => {
  const root = makeTempDir("hb-runtime-queue-worker-expired-abort-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: { text: "stale" }
  });
  const started = deferred<void>();
  let abortReason: unknown = null;
  const worker = new RuntimeQueueWorker({
    store,
    executeClaimedInput: async (_record, options = {}) => {
      started.resolve();
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) {
          abortReason = options.signal.reason;
          resolve();
          return;
        }
        options.signal?.addEventListener(
          "abort",
          () => {
            abortReason = options.signal?.reason;
            resolve();
          },
          { once: true },
        );
      });
    }
  });

  const firstProcessed = await worker.processAvailableInputsOnce();
  assert.equal(firstProcessed, 1);
  await started.promise;

  store.updateInput(queued.inputId, {
    claimedUntil: "2000-01-01T00:00:00.000Z"
  });
  store.updateRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    status: "BUSY",
    currentInputId: queued.inputId,
    currentWorkerId: "sandbox-agent-ts-worker",
    leaseUntil: "2000-01-01T00:00:00.000Z",
    heartbeatAt: "2000-01-01T00:00:00.000Z",
    lastError: null
  });

  const secondProcessed = await worker.processAvailableInputsOnce();
  await worker.close();

  const updated = store.getInput(queued.inputId);
  const runtimeState = store.getRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main"
  });
  const events = store.listOutputEvents({
    sessionId: "session-main",
    inputId: queued.inputId
  });

  assert.equal(secondProcessed, 1);
  assert.equal(abortReason, "claim_expired");
  assert.ok(updated);
  assert.equal(updated.status, "FAILED");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "ERROR");
  assert.equal(events.at(-1)?.eventType, "run_failed");

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
    harness: "pi",
    status: "active",
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

test("app lifecycle starts and closes configured durable memory worker", async () => {
  const root = makeTempDir("hb-runtime-queue-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  let startCalls = 0;
  let closeCalls = 0;
  const app = buildRuntimeApiServer({
    store,
    queueWorker: null,
    durableMemoryWorker: {
      async start() {
        startCalls += 1;
      },
      wake() {},
      async close() {
        closeCalls += 1;
      },
    },
    cronWorker: null,
    bridgeWorker: null,
  });

  const response = await app.inject({ method: "GET", url: "/healthz" });

  assert.equal(response.statusCode, 200);
  assert.equal(startCalls, 1);

  await app.close();
  assert.equal(closeCalls, 1);
  store.close();
});
