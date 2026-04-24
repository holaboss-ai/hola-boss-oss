import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test as nodeTest } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { RuntimeMainSessionEventWorker } from "./main-session-event-worker.js";

const tempDirs: string[] = [];

function test(
  name: string,
  fn: () => void | Promise<void>,
): ReturnType<typeof nodeTest> {
  return nodeTest(name, { concurrency: false }, fn);
}

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

function makeStore(prefix: string): RuntimeStateStore {
  const root = makeTempDir(prefix);
  return new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspaces"),
  });
}

function seedMainSession(store: RuntimeStateStore) {
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.ensureSession({
    workspaceId: workspace.id,
    sessionId: "session-main",
    kind: "workspace_session",
  });
  store.ensureRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main",
    status: "IDLE",
  });
  return workspace;
}

test("main-session event worker materializes waiting-user events into one queued main-session input", async () => {
  const store = makeStore("hb-main-session-event-worker-");
  const workspace = seedMainSession(store);
  let woke = 0;

  const first = store.enqueueMainSessionEvent({
    workspaceId: workspace.id,
    ownerMainSessionId: "session-main",
    originMainSessionId: "session-main",
    subagentId: "subagent-1",
    eventType: "waiting_on_user",
    deliveryBucket: "waiting_on_user",
    payload: {
      summary: "Need a repo name.",
      blocking_question: "Which repo should I inspect?",
    },
  });
  const second = store.enqueueMainSessionEvent({
    workspaceId: workspace.id,
    ownerMainSessionId: "session-main",
    originMainSessionId: "session-main",
    subagentId: "subagent-2",
    eventType: "waiting_on_user",
    deliveryBucket: "waiting_on_user",
    payload: {
      summary: "Need project confirmation.",
      blocking_question: "Should I create a new GCP project?",
    },
  });

  const worker = new RuntimeMainSessionEventWorker({
    store,
    queueWorker: {
      async start() {},
      wake() {
        woke += 1;
      },
      async close() {},
    },
  });

  const processed = await worker.processAvailableEventsOnce();
  const firstUpdated = store.getMainSessionEvent({ eventId: first.eventId });
  const secondUpdated = store.getMainSessionEvent({ eventId: second.eventId });
  const batchInput = firstUpdated?.materializedInputId
    ? store.getInput(firstUpdated.materializedInputId)
    : null;

  assert.equal(processed, 2);
  assert.equal(woke, 1);
  assert.ok(batchInput);
  assert.equal(batchInput?.sessionId, "session-main");
  assert.equal(batchInput?.priority, -100);
  const context = batchInput?.payload.context as Record<string, unknown>;
  assert.equal(context.source, "main_session_event_batch");
  assert.equal(context.delivery_bucket, "waiting_on_user");
  assert.deepEqual(
    [...(context.main_session_event_ids as string[])].sort(),
    [first.eventId, second.eventId].sort(),
  );
  assert.equal(typeof batchInput?.payload.text, "string");
  assert.match(String(batchInput?.payload.text), /numbered items/i);
  assert.ok(firstUpdated);
  assert.ok(secondUpdated);
  assert.equal(firstUpdated?.status, "materialized");
  assert.equal(secondUpdated?.status, "materialized");
  assert.equal(firstUpdated?.materializedInputId, batchInput?.inputId);
  assert.equal(secondUpdated?.materializedInputId, batchInput?.inputId);

  store.close();
});

test("main-session event worker does not materialize when the main session is busy", async () => {
  const store = makeStore("hb-main-session-event-worker-busy-");
  const workspace = seedMainSession(store);
  store.updateRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main",
    status: "BUSY",
    currentInputId: null,
    currentWorkerId: "worker-1",
    leaseUntil: null,
    heartbeatAt: null,
    lastError: null,
  });
  store.enqueueMainSessionEvent({
    workspaceId: workspace.id,
    ownerMainSessionId: "session-main",
    originMainSessionId: "session-main",
    subagentId: "subagent-1",
    eventType: "completed",
    deliveryBucket: "background_update",
    payload: { summary: "Done." },
  });

  const worker = new RuntimeMainSessionEventWorker({ store });
  const processed = await worker.processAvailableEventsOnce();

  assert.equal(processed, 0);
  assert.equal(
    store.listPendingMainSessionEvents({ ownerMainSessionId: "session-main" })
      .length,
    1,
  );

  store.close();
});
