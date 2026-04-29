import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";

import { RuntimeStateStore, utcNowIso } from "@holaboss/runtime-state-store";

import { RuntimeAgentToolsService } from "./runtime-agent-tools.js";

test("cancelSubagent waits for a claimed child runtime to settle before returning", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hb-runtime-agent-tools-"));
  const workspaceRoot = path.join(root, "workspace");
  const dbPath = path.join(root, "runtime.db");
  const workspaceId = "workspace-1";
  const mainSessionId = "main-1";
  const childSessionId = "subagent-child-1";
  const subagentId = "subagent-run-1";
  const startedAt = utcNowIso();

  const store = new RuntimeStateStore({ dbPath, workspaceRoot });
  try {
    store.createWorkspace({
      workspaceId,
      name: "Workspace 1",
      harness: "pi",
      status: "active",
    });
    store.ensureSession({
      workspaceId,
      sessionId: mainSessionId,
      kind: "workspace_session",
      createdBy: "workspace_user",
    });
    store.ensureSession({
      workspaceId,
      sessionId: childSessionId,
      kind: "subagent",
      parentSessionId: mainSessionId,
      createdBy: "workspace_agent",
    });

    const queued = store.enqueueInput({
      workspaceId,
      sessionId: childSessionId,
      payload: { text: "do work" },
    });
    store.updateInput(queued.inputId, {
      status: "CLAIMED",
      claimedBy: "worker-1",
      claimedUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    store.updateRuntimeState({
      workspaceId,
      sessionId: childSessionId,
      status: "BUSY",
      currentInputId: queued.inputId,
      currentWorkerId: "worker-1",
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
      heartbeatAt: utcNowIso(),
      lastError: null,
    });
    store.createSubagentRun({
      subagentId,
      workspaceId,
      parentSessionId: mainSessionId,
      originMainSessionId: mainSessionId,
      ownerMainSessionId: mainSessionId,
      childSessionId,
      initialChildInputId: queued.inputId,
      currentChildInputId: queued.inputId,
      latestChildInputId: queued.inputId,
      title: "Latest news on agent harnesses",
      goal: "Research the latest news on agent harnesses.",
      sourceType: "delegate_task",
      status: "running",
      startedAt,
    });

    let pauseCalls = 0;
    const service = new RuntimeAgentToolsService(store, {
      workspaceRoot,
      queueWorker: {
        start: async () => {},
        wake: () => {},
        close: async () => {},
        pauseSessionRun: async () => {
          pauseCalls += 1;
          setTimeout(() => {
            const pausedAt = utcNowIso();
            store.updateInput(queued.inputId, {
              status: "PAUSED",
              claimedBy: null,
              claimedUntil: null,
            });
            store.updateRuntimeState({
              workspaceId,
              sessionId: childSessionId,
              status: "PAUSED",
              currentInputId: null,
              currentWorkerId: null,
              leaseUntil: null,
              heartbeatAt: null,
              lastError: null,
            });
            store.upsertTurnResult({
              workspaceId,
              sessionId: childSessionId,
              inputId: queued.inputId,
              startedAt,
              completedAt: pausedAt,
              status: "paused",
              stopReason: "paused",
              assistantText: "Run paused by user request",
            });
          }, 25);
          return {
            inputId: queued.inputId,
            sessionId: childSessionId,
            status: "PAUSING" as const,
          };
        },
      },
    });

    const result = (await service.cancelSubagent({
      workspaceId,
      sessionId: mainSessionId,
      subagentId,
    })) as Record<string, unknown>;

    assert.equal(pauseCalls, 1);
    assert.equal(result.status, "cancelled");
    assert.equal(result.summary, "Cancelled by user.");
    assert.equal(result.completed_at !== null, true);
    assert.deepEqual(result.live_state, {
      runtime_status: "PAUSED",
      current_input_id: queued.inputId,
      current_input_status: "PAUSED",
      latest_input_id: queued.inputId,
      latest_input_status: "PAUSED",
      latest_turn_status: "paused",
      latest_turn_stop_reason: "paused",
    });
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
