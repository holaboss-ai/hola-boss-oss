import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";

import { RuntimeStateStore, utcNowIso } from "@holaboss/runtime-state-store";

import { RuntimeAgentToolsService } from "./runtime-agent-tools.js";

test("continueSubagent queues a new input onto the same completed child session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hb-runtime-agent-tools-continue-"));
  const workspaceRoot = path.join(root, "workspace");
  const dbPath = path.join(root, "runtime.db");
  const workspaceId = "workspace-1";
  const mainSessionId = "main-1";
  const childSessionId = "subagent-child-1";
  const subagentId = "subagent-run-1";
  const completedAt = utcNowIso();

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
      archivedAt: completedAt,
    });
    const firstInput = store.enqueueInput({
      workspaceId,
      sessionId: childSessionId,
      payload: { text: "search the web for AI" },
    });
    store.updateInput(firstInput.inputId, { status: "DONE" });
    store.upsertTurnResult({
      workspaceId,
      sessionId: childSessionId,
      inputId: firstInput.inputId,
      startedAt: completedAt,
      completedAt,
      status: "completed",
      stopReason: "success",
      assistantText: "Top AI results: item 1, item 2, item 3.",
    });
    store.createSubagentRun({
      subagentId,
      workspaceId,
      parentSessionId: mainSessionId,
      parentInputId: "parent-input-1",
      originMainSessionId: mainSessionId,
      ownerMainSessionId: mainSessionId,
      childSessionId,
      initialChildInputId: firstInput.inputId,
      currentChildInputId: null,
      latestChildInputId: firstInput.inputId,
      title: "Web search for AI",
      goal: "Search the web for AI.",
      sourceType: "delegate_task",
      status: "completed",
      summary: "Top AI results.",
      resultPayload: { assistant_text: "Top AI results: item 1, item 2, item 3." },
      completedAt,
    });

    let wakeCalls = 0;
    const service = new RuntimeAgentToolsService(store, {
      workspaceRoot,
      queueWorker: {
        start: async () => {},
        wake: () => {
          wakeCalls += 1;
        },
        close: async () => {},
      },
    });

    const result = service.continueSubagent({
      workspaceId,
      sessionId: mainSessionId,
      inputId: "parent-input-2",
      subagentId,
      instruction: "Create a concise report from those AI results.",
      title: "AI report from search results",
      model: "gpt-test",
    }) as Record<string, unknown>;

    assert.equal(wakeCalls, 1);
    assert.equal(result.subagent_id, subagentId);
    assert.equal(result.child_session_id, childSessionId);
    assert.equal(result.status, "queued");
    assert.equal(result.current_child_input_id, result.latest_child_input_id);
    assert.equal(result.result_payload, null);
    assert.equal(result.completed_at, null);
    assert.equal(result.cancelled_at, null);
    assert.equal(result.effective_model, "gpt-test");
    const session = store.getSession({ workspaceId, sessionId: childSessionId });
    assert.equal(session?.archivedAt, null);
    const nextInputId = String(result.latest_child_input_id);
    const nextInput = store.getInput(nextInputId);
    assert.ok(nextInput);
    assert.equal(nextInput?.sessionId, childSessionId);
    const nextInputText = String(nextInput?.payload.text ?? "");
    assert.match(nextInputText, /Create a concise report from those AI results\./);
    assert.match(nextInputText, /Continue from your previous result in this same child session\./);
    assert.deepEqual(nextInput?.payload.context, {
      source: "subagent_continue",
      subagent_id: subagentId,
      origin_main_session_id: mainSessionId,
      owner_main_session_id: mainSessionId,
      parent_session_id: mainSessionId,
      parent_input_id: "parent-input-2",
      continued_from_input_id: firstInput.inputId,
      continued_from_status: "completed",
    });
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("background task sync preserves persisted waiting-on-user blockers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hb-runtime-agent-tools-waiting-sync-"));
  const workspaceRoot = path.join(root, "workspace");
  const dbPath = path.join(root, "runtime.db");
  const workspaceId = "workspace-1";
  const mainSessionId = "main-1";
  const childSessionId = "subagent-child-1";
  const subagentId = "subagent-run-1";
  const completedAt = utcNowIso();

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
    const input = store.enqueueInput({
      workspaceId,
      sessionId: childSessionId,
      payload: { text: "check account stats" },
    });
    store.updateInput(input.inputId, { status: "DONE" });
    store.upsertTurnResult({
      workspaceId,
      sessionId: childSessionId,
      inputId: input.inputId,
      startedAt: completedAt,
      completedAt,
      status: "completed",
      stopReason: "success",
      assistantText: "The page is logged out, so I cannot inspect the account stats.",
    });
    store.createSubagentRun({
      subagentId,
      workspaceId,
      parentSessionId: mainSessionId,
      parentInputId: "parent-input-1",
      originMainSessionId: mainSessionId,
      ownerMainSessionId: mainSessionId,
      childSessionId,
      initialChildInputId: input.inputId,
      currentChildInputId: input.inputId,
      latestChildInputId: input.inputId,
      title: "Check account stats",
      goal: "Inspect the account stats in the browser.",
      sourceType: "delegate_task",
      status: "completed",
      summary: "Blocked by login.",
      blockingPayload: {
        status: "waiting_on_user",
        blocking_question:
          "Please log in or complete the required access step, then tell me to continue.",
      },
      resultPayload: { assistant_text: "The page is logged out." },
      completedAt,
    });

    const service = new RuntimeAgentToolsService(store, { workspaceRoot });
    const result = service.listBackgroundTasks({
      workspaceId,
      sessionId: mainSessionId,
      ownerMainSessionId: mainSessionId,
      statuses: ["waiting_on_user"],
    }) as Record<string, unknown>;
    const tasks = result.tasks as Array<Record<string, unknown>>;
    const updatedRun = store.getSubagentRun({ subagentId });

    assert.equal(result.count, 1);
    assert.equal(tasks[0]?.status, "waiting_on_user");
    assert.equal(updatedRun?.status, "waiting_on_user");
    assert.equal(updatedRun?.completedAt, null);
    assert.equal(updatedRun?.resultPayload, null);
    assert.equal(
      updatedRun?.blockingPayload?.blocking_question,
      "Please log in or complete the required access step, then tell me to continue.",
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

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
