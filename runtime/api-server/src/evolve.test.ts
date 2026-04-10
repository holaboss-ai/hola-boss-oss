import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { processClaimedInput } from "./claimed-input-executor.js";
import { FilesystemMemoryService } from "./memory.js";
import {
  LEGACY_DURABLE_MEMORY_WRITEBACK_JOB_TYPE,
  EVOLVE_JOB_TYPE,
  createEvolveTaskProposal,
  enqueueEvolveJob,
  processEvolveJob,
} from "./evolve.js";
import { RuntimeEvolveWorker } from "./evolve-worker.js";
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

test("queued evolve memory writeback persists durable memories and refreshes indexes", async () => {
  const { store, memoryService } = makeRuntimeState("hb-evolve-memory-");
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
  const queued = enqueueEvolveJob({
    store,
    workspaceId: updatedTurnResult.workspaceId,
    sessionId: updatedTurnResult.sessionId,
    inputId: updatedTurnResult.inputId,
    instruction: "Remember the durable workspace rules from this turn.",
  });

  await processEvolveJob({
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

test("createEvolveTaskProposal tags task proposals with the evolve source", () => {
  const { store } = makeRuntimeState("hb-evolve-proposal-");
  seedWorkspace(store);

  const proposal = createEvolveTaskProposal({
    store,
    workspaceId: "workspace-1",
    taskName: "Review risky evolve patch",
    taskPrompt: "Inspect the candidate skill patch before promotion.",
    taskGenerationRationale: "Evolve detected a risky procedural change that needs review.",
    proposalId: "proposal-evolve-1",
    createdAt: "2026-04-10T00:00:00.000Z",
  });

  assert.equal(proposal.proposalSource, "evolve");
  assert.equal(store.getTaskProposal("proposal-evolve-1")?.proposalSource, "evolve");
  store.close();
});

test("sample completed turn writes continuity immediately and durable memory through the evolve worker", async () => {
  const { store, memoryService } = makeRuntimeState("hb-evolve-e2e-");
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
  const worker = new RuntimeEvolveWorker({
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
  const queuedJob = store.getPostRunJobByIdempotencyKey(`${EVOLVE_JOB_TYPE}:${queued.inputId}`);

  assert.ok(queuedJob);
  assert.equal(queuedJob.status, "QUEUED");
  assert.ok(immediateFiles["workspace/workspace-1/runtime/session-memory/session-main.md"]);
  assert.ok(!immediateFiles["workspace/workspace-1/knowledge/facts/verification-command.md"]);
  assert.ok(!immediateFiles["workspace/workspace-1/knowledge/procedures/release-procedure.md"]);

  const processed = await worker.processAvailableJobsOnce();
  const updatedJob = store.getPostRunJobByIdempotencyKey(`${EVOLVE_JOB_TYPE}:${queued.inputId}`);
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

test("queued evolve memory writeback skips empty index generation when no durable memories are found", async () => {
  const { store, memoryService } = makeRuntimeState("hb-evolve-noop-");
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
  const queued = enqueueEvolveJob({
    store,
    workspaceId: updatedTurnResult.workspaceId,
    sessionId: updatedTurnResult.sessionId,
    inputId: updatedTurnResult.inputId,
    instruction: "Remember the durable workspace rules from this turn.",
  });

  await processEvolveJob({
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

test("evolve memory worker marks claimed jobs done after successful execution", async () => {
  const { store, memoryService } = makeRuntimeState("hb-evolve-worker-");
  const queued = store.enqueuePostRunJob({
    jobType: EVOLVE_JOB_TYPE,
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    payload: {},
  });

  const seen: string[] = [];
  const worker = new RuntimeEvolveWorker({
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

test("evolve memory worker retries once and then marks persistent failures failed", async () => {
  const { store, memoryService } = makeRuntimeState("hb-evolve-worker-retry-");
  const queued = store.enqueuePostRunJob({
    jobType: EVOLVE_JOB_TYPE,
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    payload: {},
  });

  const worker = new RuntimeEvolveWorker({
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

test("evolve memory processor accepts legacy durable-memory job types", async () => {
  const { store, memoryService } = makeRuntimeState("hb-evolve-legacy-job-");
  seedWorkspace(store);
  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    role: "user",
    text: "For verification, use `npm run test`.",
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
  await writeTurnContinuity({
    store,
    memoryService,
    turnResult,
  });
  const legacyJob = store.enqueuePostRunJob({
    jobType: LEGACY_DURABLE_MEMORY_WRITEBACK_JOB_TYPE,
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    payload: { instruction: "Remember the durable workspace rules from this turn." },
    idempotencyKey: `${LEGACY_DURABLE_MEMORY_WRITEBACK_JOB_TYPE}:input-1`,
  });

  await processEvolveJob({
    store,
    record: legacyJob,
    memoryService,
  });

  const captured = await memoryService.capture({ workspace_id: "workspace-1" });
  const files = captured.files as Record<string, string>;

  assert.ok(files["workspace/workspace-1/knowledge/facts/verification-command.md"]);

  store.close();
});
