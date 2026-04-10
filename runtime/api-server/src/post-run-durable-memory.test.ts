import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { processClaimedInput } from "./claimed-input-executor.js";
import { FilesystemMemoryService } from "./memory.js";
import {
  enqueueDurableMemoryWritebackJob,
  processDurableMemoryWritebackJob,
} from "./post-run-durable-memory.js";
import { RuntimePostRunDurableMemoryWorker } from "./post-run-durable-memory-worker.js";
import { writeTurnContinuity } from "./turn-memory-writeback.js";

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

function makeRuntimeState(prefix: string): {
  store: RuntimeStateStore;
  memoryService: FilesystemMemoryService;
} {
  const root = makeTempDir(prefix);
  const workspaceRoot = path.join(root, "workspace");
  return {
    store: new RuntimeStateStore({
      dbPath: path.join(root, "runtime.db"),
      workspaceRoot,
    }),
    memoryService: new FilesystemMemoryService({ workspaceRoot }),
  };
}

function seedWorkspace(store: RuntimeStateStore): void {
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
}

test("queued durable memory writeback persists durable memories and refreshes indexes", async () => {
  const { store, memoryService } = makeRuntimeState("hb-post-run-durable-memory-");
  seedWorkspace(store);
  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    role: "user",
    text: [
      "Please keep your responses concise.",
      "",
      "For verification, use `npm run test`.",
      "",
      "Release procedure:",
      "1. Run `npm run test`.",
      "2. Run `npm run build`.",
      "3. Publish the bundle.",
    ].join("\n"),
    messageId: "user-1",
    createdAt: "2026-04-02T12:00:00.000Z",
  });

  const turnResult = store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    startedAt: "2026-04-02T12:00:00.000Z",
    completedAt: "2026-04-02T12:00:05.000Z",
    status: "completed",
    stopReason: "ok",
    assistantText: "Captured workspace-specific instructions for future runs.",
  });

  const updatedTurnResult = await writeTurnContinuity({
    store,
    memoryService,
    turnResult,
  });
  const queued = enqueueDurableMemoryWritebackJob({
    store,
    workspaceId: updatedTurnResult.workspaceId,
    sessionId: updatedTurnResult.sessionId,
    inputId: updatedTurnResult.inputId,
    instruction: "Remember the durable workspace rules from this turn.",
  });

  await processDurableMemoryWritebackJob({
    store,
    record: queued,
    memoryService,
  });

  const captured = await memoryService.capture({ workspace_id: "workspace-1" });
  const files = captured.files as Record<string, string>;
  const boundary = store.getCompactionBoundary({
    boundaryId: updatedTurnResult.compactionBoundaryId ?? `compaction:${updatedTurnResult.inputId}`,
  });
  const restorationContext = boundary?.restorationContext as Record<string, unknown> | null;
  const restoredMemoryPaths = Array.isArray(restorationContext?.restored_memory_paths)
    ? (restorationContext?.restored_memory_paths as string[])
    : [];

  assert.ok(files["workspace/workspace-1/knowledge/facts/verification-command.md"]);
  assert.ok(files["workspace/workspace-1/knowledge/procedures/release-procedure.md"]);
  assert.match(files["workspace/workspace-1/MEMORY.md"], /Verification command/);
  assert.match(files["workspace/workspace-1/MEMORY.md"], /Release procedure/);
  assert.ok(restoredMemoryPaths.includes("workspace/workspace-1/knowledge/facts/verification-command.md"));
  assert.ok(restoredMemoryPaths.includes("workspace/workspace-1/MEMORY.md"));

  store.close();
});

test("sample completed turn writes continuity immediately and durable memory through the queued worker", async () => {
  const { store, memoryService } = makeRuntimeState("hb-post-run-durable-e2e-");
  seedWorkspace(store);
  const queued = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: {
      text: [
        "Please keep your responses concise.",
        "",
        "For verification, use `npm run test`.",
        "",
        "Release procedure:",
        "1. Run `npm run test`.",
        "2. Run `npm run build`.",
        "3. Publish the bundle.",
      ].join("\n"),
    },
  });
  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    role: "user",
    text: String(queued.payload.text ?? ""),
    messageId: `user-${queued.inputId}`,
    createdAt: "2026-04-02T12:00:00.000Z",
  });
  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300,
  });
  const worker = new RuntimePostRunDurableMemoryWorker({
    store,
    memoryService,
  });

  await processClaimedInput({
    store,
    record: claimed[0],
    memoryService,
    wakeDurableMemoryWorker: worker.wake.bind(worker),
    executeRunnerRequestFn: async (payload, options = {}) => {
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 1,
        event_type: "run_started",
        payload: {},
      });
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 2,
        event_type: "output_delta",
        payload: { delta: "Captured workspace-specific instructions for future runs." },
      });
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 3,
        event_type: "run_completed",
        payload: { status: "ok" },
      });
      return {
        events: [],
        skippedLines: [],
        stderr: "",
        returnCode: 0,
        sawTerminal: true,
      };
    },
  });

  const immediateCapture = await memoryService.capture({ workspace_id: "workspace-1" });
  const immediateFiles = immediateCapture.files as Record<string, string>;
  const queuedJob = store.getPostRunJobByIdempotencyKey(`durable_memory_writeback:${queued.inputId}`);

  assert.ok(queuedJob);
  assert.equal(queuedJob.status, "QUEUED");
  assert.ok(immediateFiles["workspace/workspace-1/runtime/session-memory/session-main.md"]);
  assert.ok(!immediateFiles["workspace/workspace-1/knowledge/facts/verification-command.md"]);
  assert.ok(!immediateFiles["workspace/workspace-1/knowledge/procedures/release-procedure.md"]);

  const processed = await worker.processAvailableJobsOnce();
  const updatedJob = store.getPostRunJobByIdempotencyKey(`durable_memory_writeback:${queued.inputId}`);
  const finalCapture = await memoryService.capture({ workspace_id: "workspace-1" });
  const finalFiles = finalCapture.files as Record<string, string>;

  assert.equal(processed, 1);
  assert.ok(updatedJob);
  assert.equal(updatedJob.status, "DONE");
  assert.ok(finalFiles["workspace/workspace-1/knowledge/facts/verification-command.md"]);
  assert.ok(finalFiles["workspace/workspace-1/knowledge/procedures/release-procedure.md"]);
  assert.match(finalFiles["workspace/workspace-1/MEMORY.md"], /Verification command/);
  assert.match(finalFiles["workspace/workspace-1/MEMORY.md"], /Release procedure/);

  store.close();
});

test("queued durable memory writeback skips empty index generation when no durable memories are found", async () => {
  const { store, memoryService } = makeRuntimeState("hb-post-run-durable-noop-");
  seedWorkspace(store);
  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    role: "user",
    text: "Please keep your responses concise.",
    messageId: "user-1",
    createdAt: "2026-04-02T12:00:00.000Z",
  });

  const turnResult = store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    startedAt: "2026-04-02T12:00:00.000Z",
    completedAt: "2026-04-02T12:00:05.000Z",
    status: "completed",
    stopReason: "ok",
    assistantText: "Done.",
  });

  const updatedTurnResult = await writeTurnContinuity({
    store,
    memoryService,
    turnResult,
  });
  const queued = enqueueDurableMemoryWritebackJob({
    store,
    workspaceId: updatedTurnResult.workspaceId,
    sessionId: updatedTurnResult.sessionId,
    inputId: updatedTurnResult.inputId,
    instruction: "Remember the durable workspace rules from this turn.",
  });

  await processDurableMemoryWritebackJob({
    store,
    record: queued,
    memoryService,
  });

  const captured = await memoryService.capture({ workspace_id: "workspace-1" });
  const files = captured.files as Record<string, string>;

  assert.equal(files["workspace/workspace-1/MEMORY.md"], undefined);
  assert.equal(files["identity/MEMORY.md"], undefined);
  assert.equal(files["preference/MEMORY.md"], undefined);
  assert.equal(files["MEMORY.md"], undefined);
  assert.deepEqual(store.listMemoryEntries({ status: "active" }), []);

  store.close();
});

test("post-run durable memory worker marks claimed jobs done after successful execution", async () => {
  const { store, memoryService } = makeRuntimeState("hb-post-run-durable-worker-");
  const queued = store.enqueuePostRunJob({
    jobType: "durable_memory_writeback",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    payload: {},
  });

  const seen: string[] = [];
  const worker = new RuntimePostRunDurableMemoryWorker({
    store,
    memoryService,
    executeClaimedJob: async (record) => {
      seen.push(record.jobId);
    },
  });

  const processed = await worker.processAvailableJobsOnce();
  const updated = store.getPostRunJob(queued.jobId);

  assert.equal(processed, 1);
  assert.deepEqual(seen, [queued.jobId]);
  assert.ok(updated);
  assert.equal(updated.status, "DONE");
  assert.equal(updated.claimedBy, null);
  assert.equal(updated.claimedUntil, null);

  store.close();
});

test("post-run durable memory worker retries once and then marks persistent failures failed", async () => {
  const { store, memoryService } = makeRuntimeState("hb-post-run-durable-worker-retry-");
  const queued = store.enqueuePostRunJob({
    jobType: "durable_memory_writeback",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    payload: {},
  });

  const worker = new RuntimePostRunDurableMemoryWorker({
    store,
    memoryService,
    maxAttempts: 2,
    retryDelayMs: 0,
    executeClaimedJob: async () => {
      throw new Error("boom");
    },
  });

  const firstProcessed = await worker.processAvailableJobsOnce();
  const firstUpdated = store.getPostRunJob(queued.jobId);
  const secondProcessed = await worker.processAvailableJobsOnce();
  const secondUpdated = store.getPostRunJob(queued.jobId);

  assert.equal(firstProcessed, 1);
  assert.ok(firstUpdated);
  assert.equal(firstUpdated.status, "QUEUED");
  assert.equal(firstUpdated.attempt, 1);
  assert.deepEqual(firstUpdated.lastError, { message: "boom" });

  assert.equal(secondProcessed, 1);
  assert.ok(secondUpdated);
  assert.equal(secondUpdated.status, "FAILED");
  assert.equal(secondUpdated.attempt, 2);
  assert.deepEqual(secondUpdated.lastError, { message: "boom" });

  store.close();
});
