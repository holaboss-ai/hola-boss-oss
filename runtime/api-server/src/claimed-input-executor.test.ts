import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { processClaimedInput } from "./claimed-input-executor.js";
import type { MemoryServiceLike } from "./memory.js";

const tempDirs: string[] = [];
const ORIGINAL_ENV = {
  SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE: process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE,
  SANDBOX_AGENT_RUN_TIMEOUT_S: process.env.SANDBOX_AGENT_RUN_TIMEOUT_S,
  SANDBOX_AGENT_RUN_IDLE_TIMEOUT_S: process.env.SANDBOX_AGENT_RUN_IDLE_TIMEOUT_S,
  HB_SANDBOX_ROOT: process.env.HB_SANDBOX_ROOT,
  HOLABOSS_RUNTIME_CONFIG_PATH: process.env.HOLABOSS_RUNTIME_CONFIG_PATH,
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (ORIGINAL_ENV.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE === undefined) {
    delete process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE;
  } else {
    process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE = ORIGINAL_ENV.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE;
  }
  if (ORIGINAL_ENV.SANDBOX_AGENT_RUN_TIMEOUT_S === undefined) {
    delete process.env.SANDBOX_AGENT_RUN_TIMEOUT_S;
  } else {
    process.env.SANDBOX_AGENT_RUN_TIMEOUT_S = ORIGINAL_ENV.SANDBOX_AGENT_RUN_TIMEOUT_S;
  }
  if (ORIGINAL_ENV.SANDBOX_AGENT_RUN_IDLE_TIMEOUT_S === undefined) {
    delete process.env.SANDBOX_AGENT_RUN_IDLE_TIMEOUT_S;
  } else {
    process.env.SANDBOX_AGENT_RUN_IDLE_TIMEOUT_S = ORIGINAL_ENV.SANDBOX_AGENT_RUN_IDLE_TIMEOUT_S;
  }
  if (ORIGINAL_ENV.HB_SANDBOX_ROOT === undefined) {
    delete process.env.HB_SANDBOX_ROOT;
  } else {
    process.env.HB_SANDBOX_ROOT = ORIGINAL_ENV.HB_SANDBOX_ROOT;
  }
  if (ORIGINAL_ENV.HOLABOSS_RUNTIME_CONFIG_PATH === undefined) {
    delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
  } else {
    process.env.HOLABOSS_RUNTIME_CONFIG_PATH = ORIGINAL_ENV.HOLABOSS_RUNTIME_CONFIG_PATH;
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
    workspaceRoot: path.join(root, "workspaces")
  });
}

function setNodeRunnerCommand(lines: string[]): void {
  const scriptBase64 = Buffer.from(lines.join("\n"), "utf8").toString("base64");
  process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE =
    `printf '%s' '${scriptBase64}' | base64 --decode | {runtime_node} - {request_base64}`;
}

test("claimed input marks missing workspace failed and runtime error", async () => {
  const store = makeStore("hb-claimed-input-missing-workspace-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello" }
  });
  store.deleteWorkspace(workspace.id);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300
  });

  assert.equal(claimed.length, 1);

  await processClaimedInput({
    store,
    record: claimed[0]
  });

  const updated = store.getInput(queued.inputId);
  const runtimeState = store.getRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });
  const events = store.listOutputEvents({
    sessionId: "session-main",
    inputId: queued.inputId
  });
  const turnResult = store.getTurnResult({ inputId: queued.inputId });

  assert.ok(updated);
  assert.equal(updated.status, "FAILED");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "ERROR");
  assert.deepEqual(runtimeState.lastError, { message: "workspace not found" });
  assert.deepEqual(events, []);
  assert.ok(turnResult);
  assert.equal(turnResult.status, "failed");
  assert.equal(turnResult.stopReason, "workspace_not_found");
  assert.equal(turnResult.assistantText, "");
  assert.deepEqual(turnResult.toolUsageSummary, {
    total_calls: 0,
    completed_calls: 0,
    failed_calls: 0,
    tool_names: [],
    tool_ids: []
  });

  store.close();
});

test("claimed input persists runner events, assistant text, and idle state on success", async () => {
  const store = makeStore("hb-claimed-input-success-");
  let scheduledPostRunTasks = 0;
  let eventTypesAtSchedule: string[] = [];
  const memoryService: MemoryServiceLike = {
    async search() { return { results: [] }; },
    async get() { return { path: "", text: "" }; },
    async upsert(payload: Record<string, unknown>) {
      return { path: payload.path, text: payload.content };
    },
    async status() { return {}; },
    async sync() { return {}; },
    async capture() { return { files: {} }; },
  };
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello" }
  });
  setNodeRunnerCommand([
    "const request = process.argv.at(-1) ?? '';",
    "void request;",
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 1, event_type: 'run_started', payload: { instruction_preview: 'hello', prompt_section_ids: ['runtime_core', 'execution_policy', 'capability_policy'], capability_manifest_fingerprint: 'a'.repeat(64), request_snapshot_fingerprint: 'b'.repeat(64), prompt_cache_profile: { cacheable_section_ids: ['runtime_core', 'execution_policy'], volatile_section_ids: ['capability_policy'] } } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 2, event_type: 'tool_call', payload: { phase: 'started', tool_name: 'read_file', call_id: 'call-1', error: false } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 3, event_type: 'tool_call', payload: { phase: 'completed', tool_name: 'read_file', call_id: 'call-1', error: false } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 4, event_type: 'tool_call', payload: { phase: 'started', tool_name: 'skill', call_id: 'call-skill', tool_args: { name: 'customer_lookup' }, error: false } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 5, event_type: 'skill_invocation', payload: { phase: 'started', call_id: 'call-skill', requested_name: 'customer_lookup', skill_name: 'customer_lookup', skill_id: 'customer_lookup', error: false } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 6, event_type: 'tool_call', payload: { phase: 'completed', tool_name: 'skill', call_id: 'call-skill', tool_args: { name: 'customer_lookup' }, error: false } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 7, event_type: 'skill_invocation', payload: { phase: 'completed', call_id: 'call-skill', requested_name: 'customer_lookup', skill_name: 'customer_lookup', skill_id: 'customer_lookup', widening_scope: 'run', workspace_boundary_override: false, managed_tools: ['bash', 'deploy'], granted_tools: ['deploy'], active_granted_tools: ['deploy'], managed_commands: ['deploy-docs'], granted_commands: ['deploy-docs'], active_granted_commands: ['deploy-docs'], error: false } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 8, event_type: 'tool_call', payload: { phase: 'completed', tool_name: 'deploy', tool_id: 'workspace.deploy', call_id: 'call-2', error: true, message: 'permission denied by policy' } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 9, event_type: 'output_delta', payload: { delta: 'Hello from TS' } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 10, event_type: 'run_completed', payload: { status: 'ok', usage: { input_tokens: 12, output_tokens: 34 } } }) + '\\n');`
  ]);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300
  });

  await processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker",
    memoryService,
    runPostRunTasksFn: async (options) => {
      scheduledPostRunTasks += 1;
      eventTypesAtSchedule = store
        .listOutputEvents({
          sessionId: options.record.sessionId,
          inputId: options.record.inputId,
        })
        .map((event) => event.eventType);
    },
  });

  const updated = store.getInput(queued.inputId);
  const runtimeState = store.getRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });
  const events = store.listOutputEvents({
    sessionId: "session-main",
    inputId: queued.inputId
  });
  const messages = store.listSessionMessages({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });
  const turnResult = store.getTurnResult({ inputId: queued.inputId });

  assert.ok(updated);
  assert.equal(updated.status, "DONE");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "IDLE");
  assert.equal(runtimeState.currentInputId, null);
  assert.equal(runtimeState.currentWorkerId, null);
  assert.equal(runtimeState.lastError, null);
  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      "run_started",
      "tool_call",
      "tool_call",
      "tool_call",
      "skill_invocation",
      "tool_call",
      "skill_invocation",
      "tool_call",
      "output_delta",
      "run_completed",
    ]
  );
  assert.equal(scheduledPostRunTasks, 1);
  assert.deepEqual(eventTypesAtSchedule, [
    "run_started",
    "tool_call",
    "tool_call",
    "tool_call",
    "skill_invocation",
    "tool_call",
    "skill_invocation",
    "tool_call",
    "output_delta",
    "run_completed",
  ]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[0].text, "Hello from TS");
  assert.ok(turnResult);
  assert.equal(turnResult.status, "completed");
  assert.equal(turnResult.stopReason, "ok");
  assert.equal(turnResult.assistantText, "Hello from TS");
  assert.equal(turnResult.compactedSummary, null);
  assert.deepEqual(turnResult.promptSectionIds, [
    "runtime_core",
    "execution_policy",
    "capability_policy"
  ]);
  assert.equal(turnResult.capabilityManifestFingerprint, "a".repeat(64));
  assert.equal(turnResult.requestSnapshotFingerprint, "b".repeat(64));
  assert.deepEqual(turnResult.promptCacheProfile, {
    cacheable_section_ids: ["runtime_core", "execution_policy"],
    volatile_section_ids: ["capability_policy"],
  });
  assert.equal(turnResult.compactionBoundaryId, null);
  assert.deepEqual(turnResult.toolUsageSummary, {
    total_calls: 3,
    completed_calls: 2,
    failed_calls: 1,
    tool_names: ["deploy", "read_file", "skill"],
    tool_ids: ["workspace.deploy"],
    skill_invocations: {
      total_calls: 1,
      completed_calls: 1,
      failed_calls: 0,
      skill_names: ["customer_lookup"],
      skill_ids: ["customer_lookup"],
    },
    skill_policy_widening: {
      scope: "run",
      workspace_boundary_override: false,
      managed_tools: ["bash", "deploy"],
      granted_tools: ["deploy"],
      active_granted_tools: ["deploy"],
      managed_commands: ["deploy-docs"],
      granted_commands: ["deploy-docs"],
      active_granted_commands: ["deploy-docs"],
      activation_count: 1,
      denied_calls: 0,
      denied_tool_names: [],
    },
  });
  assert.deepEqual(turnResult.permissionDenials, [
    {
      tool_name: "deploy",
      tool_id: "workspace.deploy",
      reason: "permission denied by policy"
    }
  ]);
  assert.deepEqual(turnResult.tokenUsage, { input_tokens: 12, output_tokens: 34 });
  const snapshot = store.getTurnRequestSnapshot({ inputId: queued.inputId });
  assert.equal(snapshot, null);
  assert.equal(store.getCompactionBoundary({ boundaryId: `compaction:${queued.inputId}` }), null);

  store.close();
});

test("claimed input creates a completion notification for successful cronjob session runs", async () => {
  const store = makeStore("hb-claimed-input-cronjob-success-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const job = store.createCronjob({
    workspaceId: workspace.id,
    initiatedBy: "workspace_agent",
    name: "daily-sync",
    cron: "0 9 * * *",
    description: "Daily sync",
    instruction: "Sync the workspace.",
    delivery: { channel: "session_run" },
    metadata: {
      notification_title: "Daily Run",
      notification_priority: "high",
    },
  });
  store.ensureSession({
    workspaceId: workspace.id,
    sessionId: "session-cron",
    kind: "cronjob",
    title: "Daily sync",
    createdBy: "workspace_agent",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-cron",
    payload: {
      text: "Sync the workspace.",
      context: {
        source: "cronjob",
        cronjob_id: job.id,
      },
    },
  });
  setNodeRunnerCommand([
    "const request = process.argv.at(-1) ?? '';",
    "void request;",
    `process.stdout.write(JSON.stringify({ session_id: 'session-cron', input_id: '${queued.inputId}', sequence: 1, event_type: 'run_started', payload: { instruction_preview: 'Sync the workspace.' } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-cron', input_id: '${queued.inputId}', sequence: 2, event_type: 'output_delta', payload: { delta: 'Hello from cron' } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-cron', input_id: '${queued.inputId}', sequence: 3, event_type: 'run_completed', payload: { status: 'ok' } }) + '\\n');`,
  ]);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300,
  });

  await processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker",
  });

  const notifications = store.listRuntimeNotifications({ workspaceId: workspace.id });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.title, "Daily Run Completed");
  assert.equal(notifications[0]?.message, "Hello from cron");
  assert.equal(notifications[0]?.level, "success");
  assert.equal(notifications[0]?.priority, "high");
  assert.equal(notifications[0]?.cronjobId, job.id);
  assert.equal(notifications[0]?.metadata.session_id, "session-cron");
  assert.equal(notifications[0]?.metadata.input_id, queued.inputId);
  assert.equal(notifications[0]?.metadata.turn_status, "completed");
  assert.equal(notifications[0]?.metadata.stop_reason, "ok");

  store.close();
});

test("claimed input creates a completion notification for failed cronjob session runs", async () => {
  const store = makeStore("hb-claimed-input-cronjob-failure-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const job = store.createCronjob({
    workspaceId: workspace.id,
    initiatedBy: "workspace_agent",
    name: "daily-sync",
    cron: "0 9 * * *",
    description: "Daily sync",
    instruction: "Sync the workspace.",
    delivery: { channel: "session_run" },
    metadata: {
      notification_title: "Daily Run",
    },
  });
  store.ensureSession({
    workspaceId: workspace.id,
    sessionId: "session-cron",
    kind: "cronjob",
    title: "Daily sync",
    createdBy: "workspace_agent",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-cron",
    payload: {
      text: "Sync the workspace.",
      context: {
        source: "cronjob",
        cronjob_id: job.id,
      },
    },
  });
  setNodeRunnerCommand([
    "const request = process.argv.at(-1) ?? '';",
    "void request;",
    `process.stdout.write(JSON.stringify({ session_id: 'session-cron', input_id: '${queued.inputId}', sequence: 1, event_type: 'run_started', payload: { instruction_preview: 'Sync the workspace.' } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-cron', input_id: '${queued.inputId}', sequence: 2, event_type: 'run_failed', payload: { type: 'ProviderError', message: 'boom' } }) + '\\n');`,
  ]);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300,
  });

  await processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker",
  });

  const notifications = store.listRuntimeNotifications({ workspaceId: workspace.id });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.title, "Daily Run Failed");
  assert.equal(notifications[0]?.message, "Run failed: ProviderError.");
  assert.equal(notifications[0]?.level, "error");
  assert.equal(notifications[0]?.priority, "normal");
  assert.equal(notifications[0]?.cronjobId, job.id);
  assert.equal(notifications[0]?.metadata.session_id, "session-cron");
  assert.equal(notifications[0]?.metadata.input_id, queued.inputId);
  assert.equal(notifications[0]?.metadata.turn_status, "failed");
  assert.equal(notifications[0]?.metadata.stop_reason, "ProviderError");

  store.close();
});

test("claimed input persists waiting_user terminal status for harnesses that support it", async () => {
  const store = makeStore("hb-claimed-input-pi-waiting-user-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello" }
  });
  setNodeRunnerCommand([
    "const request = process.argv.at(-1) ?? '';",
    "void request;",
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 1, event_type: 'run_started', payload: { instruction_preview: 'hello' } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 2, event_type: 'run_completed', payload: { status: 'waiting_user' } }) + '\\n');`
  ]);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300
  });

  await processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker"
  });

  const updated = store.getInput(queued.inputId);
  const runtimeState = store.getRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });
  const turnResult = store.getTurnResult({ inputId: queued.inputId });

  assert.ok(updated);
  assert.equal(updated.status, "DONE");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "WAITING_USER");
  assert.ok(turnResult);
  assert.equal(turnResult.status, "waiting_user");
  assert.equal(turnResult.stopReason, "waiting_user");

  store.close();
});

test("claimed input persists a paused turn when the run is aborted mid-execution", async () => {
  const store = makeStore("hb-claimed-input-paused-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "pause this run" }
  });
  setNodeRunnerCommand([
    "const request = process.argv.at(-1) ?? '';",
    "void request;",
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 1, event_type: 'run_started', payload: { instruction_preview: 'pause this run' } }) + '\\n');`,
    "setInterval(() => {}, 1000);"
  ]);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300
  });
  const controller = new AbortController();
  let postRunCalls = 0;
  const execution = processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker",
    abortSignal: controller.signal,
    runPostRunTasksFn: async () => {
      postRunCalls += 1;
    },
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (
      store.listOutputEvents({
        sessionId: "session-main",
        inputId: queued.inputId,
      }).length > 0
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  controller.abort("user_requested_pause");
  await execution;

  const updated = store.getInput(queued.inputId);
  const runtimeState = store.getRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });
  const events = store.listOutputEvents({
    sessionId: "session-main",
    inputId: queued.inputId
  });
  const turnResult = store.getTurnResult({ inputId: queued.inputId });

  assert.equal(postRunCalls, 1);
  assert.ok(updated);
  assert.equal(updated.status, "PAUSED");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "PAUSED");
  assert.equal(runtimeState.currentInputId, null);
  assert.equal(runtimeState.lastError, null);
  assert.deepEqual(
    events.map((event) => event.eventType),
    ["run_started", "run_completed"]
  );
  assert.deepEqual(events[1]?.payload, {
    status: "paused",
    stop_reason: "paused",
    message: "Run paused by user request",
  });
  assert.ok(turnResult);
  assert.equal(turnResult.status, "paused");
  assert.equal(turnResult.stopReason, "paused");

  store.close();
});

test("claimed input captures file outputs and persists an assistant turn for output-only runs", async () => {
  const store = makeStore("hb-claimed-input-file-output-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "create a report file" }
  });

  await processClaimedInput({
    store,
    record: queued,
    executeRunnerRequestFn: async (payload, options = {}) => {
      const workspaceDir = store.workspaceDir(workspace.id);
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, "report.md"), "# Report\n");
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 1,
        event_type: "run_started",
        payload: {}
      });
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 2,
        event_type: "run_completed",
        payload: { status: "ok" }
      });
      return {
        events: [],
        skippedLines: [],
        stderr: "",
        returnCode: 0,
        sawTerminal: true
      };
    }
  });

  const outputs = store.listOutputs({
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: queued.inputId,
    limit: 20,
    offset: 0
  });
  const messages = store.listSessionMessages({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });

  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].title, "report.md");
  assert.equal(outputs[0].filePath, "report.md");
  assert.equal(outputs[0].status, "completed");
  assert.equal(outputs[0].metadata.origin_type, "file");
  assert.equal(outputs[0].metadata.change_type, "created");
  assert.equal(outputs[0].metadata.category, "document");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, `assistant-${queued.inputId}`);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[0].text, "");

  store.close();
});

test("claimed input records skill-policy denial audit in tool usage summary", async () => {
  const store = makeStore("hb-claimed-input-skill-policy-denial-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello" }
  });

  await processClaimedInput({
    store,
    record: queued,
    executeRunnerRequestFn: async (payload, options = {}) => {
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 1,
        event_type: "run_started",
        payload: {}
      });
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 2,
        event_type: "tool_call",
        payload: {
          phase: "completed",
          tool_name: "bash",
          call_id: "call-denied",
          error: true,
          message: "permission denied by skill policy: tool \"bash\" is gated and must be widened"
        }
      });
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 3,
        event_type: "run_completed",
        payload: { status: "ok" }
      });
      return {
        events: [],
        skippedLines: [],
        stderr: "",
        returnCode: 0,
        sawTerminal: true
      };
    }
  });

  const turnResult = store.getTurnResult({ inputId: queued.inputId });
  assert.ok(turnResult);
  assert.deepEqual(turnResult.toolUsageSummary, {
    total_calls: 1,
    completed_calls: 0,
    failed_calls: 1,
    tool_names: ["bash"],
    tool_ids: [],
    skill_policy_widening: {
      scope: null,
      workspace_boundary_override: null,
      managed_tools: [],
      granted_tools: [],
      active_granted_tools: [],
      managed_commands: [],
      granted_commands: [],
      active_granted_commands: [],
      activation_count: 0,
      denied_calls: 1,
      denied_tool_names: ["bash"],
    }
  });

  store.close();
});

test("claimed input synthesizes run_failed when runner exits without terminal event", async () => {
  const store = makeStore("hb-claimed-input-failure-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello" }
  });
  setNodeRunnerCommand([
    "const request = process.argv.at(-1) ?? '';",
    "void request;",
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 1, event_type: 'run_started', payload: { instruction_preview: 'hello' } }) + '\\n');`
  ]);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300
  });

  await processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker"
  });

  const updated = store.getInput(queued.inputId);
  const runtimeState = store.getRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });
  const events = store.listOutputEvents({
    sessionId: "session-main",
    inputId: queued.inputId
  });
  const turnResult = store.getTurnResult({ inputId: queued.inputId });

  assert.ok(updated);
  assert.equal(updated.status, "FAILED");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "ERROR");
  assert.equal(events.length, 2);
  assert.equal(events[0].eventType, "run_started");
  assert.equal(events[1].eventType, "run_failed");
  assert.match(String(events[1].payload.message), /runner ended before terminal event/);
  assert.ok(turnResult);
  assert.equal(turnResult.status, "failed");
  assert.equal(turnResult.stopReason, "RuntimeError");
  assert.equal(turnResult.assistantText, "");

  store.close();
});

test("claimed input succeeds when runner emits terminal event but keeps the process alive", async () => {
  const store = makeStore("hb-claimed-input-terminal-kill-");
  process.env.SANDBOX_AGENT_RUN_TIMEOUT_S = "1";
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello" }
  });
  setNodeRunnerCommand([
    "const request = process.argv.at(-1) ?? '';",
    "void request;",
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 1, event_type: 'run_started', payload: { instruction_preview: 'hello' } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 2, event_type: 'run_completed', payload: { status: 'ok' } }) + '\\n');`,
    "setInterval(() => {}, 1000);"
  ]);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300
  });

  await processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker"
  });

  const updated = store.getInput(queued.inputId);
  const runtimeState = store.getRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });
  const events = store.listOutputEvents({
    sessionId: "session-main",
    inputId: queued.inputId
  });
  const turnResult = store.getTurnResult({ inputId: queued.inputId });

  assert.ok(updated);
  assert.equal(updated.status, "DONE");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "IDLE");
  assert.deepEqual(
    events.map((event) => event.eventType),
    ["run_started", "run_completed"]
  );
  assert.ok(turnResult);
  assert.equal(turnResult.status, "completed");
  assert.equal(turnResult.stopReason, "ok");

  store.close();
});

test("claimed input fails when runner becomes idle after run_started", async () => {
  const store = makeStore("hb-claimed-input-idle-timeout-");
  process.env.SANDBOX_AGENT_RUN_TIMEOUT_S = "10";
  process.env.SANDBOX_AGENT_RUN_IDLE_TIMEOUT_S = "1";
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello" }
  });
  setNodeRunnerCommand([
    "const request = process.argv.at(-1) ?? '';",
    "void request;",
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 1, event_type: 'run_started', payload: { instruction_preview: 'hello' } }) + '\\n');`,
    "setInterval(() => {}, 1000);"
  ]);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300
  });

  await processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker"
  });

  const updated = store.getInput(queued.inputId);
  const runtimeState = store.getRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });
  const events = store.listOutputEvents({
    sessionId: "session-main",
    inputId: queued.inputId
  });
  const turnResult = store.getTurnResult({ inputId: queued.inputId });

  assert.ok(updated);
  assert.equal(updated.status, "FAILED");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "ERROR");
  assert.equal(events.length, 2);
  assert.equal(events[0].eventType, "run_started");
  assert.equal(events[1].eventType, "run_failed");
  assert.match(String(events[1].payload.message), /idle/i);
  assert.ok(turnResult);
  assert.equal(turnResult.status, "failed");
  assert.equal(turnResult.stopReason, "RunnerCommandError");

  store.close();
});

test("claimed input hydrates runtime exec context from runtime config", async () => {
  const store = makeStore("hb-claimed-input-runtime-context-");
  const sandboxRoot = makeTempDir("hb-runtime-config-root-");
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  fs.mkdirSync(path.join(sandboxRoot, "state"), { recursive: true });
  fs.writeFileSync(
    path.join(sandboxRoot, "state", "runtime-config.json"),
    `${JSON.stringify({ auth_token: "token-1", sandbox_id: "sandbox-1" }, null, 2)}\n`,
    "utf8"
  );

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello", context: {} }
  });
  setNodeRunnerCommand([
    "const encoded = process.argv.at(-1) ?? '';",
    "const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));",
    "const ctx = payload.context._sandbox_runtime_exec_v1;",
    "process.stdout.write(JSON.stringify({ session_id: payload.session_id, input_id: payload.input_id, sequence: 1, event_type: 'run_started', payload: { runtime_exec_context: ctx } }) + '\\n');",
    "process.stdout.write(JSON.stringify({ session_id: payload.session_id, input_id: payload.input_id, sequence: 2, event_type: 'run_completed', payload: { status: 'ok' } }) + '\\n');"
  ]);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300
  });

  await processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker"
  });

  const events = store.listOutputEvents({
    sessionId: "session-main",
    inputId: queued.inputId
  });
  assert.equal(events.length, 2);
  const runtimeExecContext = events[0].payload.runtime_exec_context as Record<string, unknown>;
  assert.equal(runtimeExecContext.model_proxy_api_key, "token-1");
  assert.equal(runtimeExecContext.sandbox_id, "sandbox-1");
  assert.equal(runtimeExecContext.harness, "pi");
  assert.equal(runtimeExecContext.harness_session_id, "session-main");

  store.close();
});

test("claimed input resolves post-run model context from the provider background tasks model", async () => {
  const store = makeStore("hb-claimed-input-background-model-");
  const sandboxRoot = makeTempDir("hb-claimed-input-background-root-");
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = path.join(sandboxRoot, "state", "runtime-config.json");
  fs.mkdirSync(path.join(sandboxRoot, "state"), { recursive: true });
  fs.writeFileSync(
    process.env.HOLABOSS_RUNTIME_CONFIG_PATH,
    `${JSON.stringify(
      {
        runtime: {
          background_tasks: {
            provider: "anthropic_direct",
            model: "claude-sonnet-4-6",
          },
        },
        providers: {
          anthropic_direct: {
            kind: "anthropic_native",
            base_url: "https://api.anthropic.com",
            api_key: "sk-ant-test",
          },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const memoryService: MemoryServiceLike = {
    async search() { return { results: [] }; },
    async get() { return { path: "", text: "" }; },
    async upsert(payload: Record<string, unknown>) {
      return { path: payload.path, text: payload.content };
    },
    async status() { return {}; },
    async sync() { return {}; },
    async capture() { return { files: {} }; },
  };
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello", model: "anthropic_direct/claude-opus-4-6" }
  });

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300
  });

  let capturedModelContext: Record<string, unknown> | null = null;
  await processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker",
    memoryService,
    executeRunnerRequestFn: async (payload, options = {}) => {
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 1,
        event_type: "run_started",
        payload: {}
      });
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 2,
        event_type: "run_completed",
        payload: { status: "ok" }
      });
      return {
        events: [],
        skippedLines: [],
        stderr: "",
        returnCode: 0,
        sawTerminal: true
      };
    },
    runPostRunTasksFn: async (options) => {
      capturedModelContext = options.modelContext as unknown as Record<string, unknown>;
    },
  });

  assert.ok(capturedModelContext);
  const modelContext = capturedModelContext as { modelClient: unknown };
  assert.deepEqual(modelContext.modelClient, {
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant-test",
    defaultHeaders: null,
    modelId: "claude-sonnet-4-6",
    apiStyle: "anthropic_native",
  });

  store.close();
});

test("claimed onboarding input instructs native onboarding tools directly", async () => {
  const store = makeStore("hb-claimed-input-onboarding-native-tools-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
    onboardingStatus: "pending",
    onboardingSessionId: "session-onboarding"
  });
  fs.writeFileSync(
    path.join(store.workspaceDir(workspace.id), "ONBOARD.md"),
    "# Workspace Onboarding\n\nAsk concise setup questions.\n",
    "utf8"
  );
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-onboarding",
    payload: { text: "yes" }
  });

  let capturedInstruction = "";
  await processClaimedInput({
    store,
    record: queued,
    executeRunnerRequestFn: async (payload, options = {}) => {
      capturedInstruction = String(payload.instruction ?? "");
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 1,
        event_type: "run_started",
        payload: { instruction_preview: capturedInstruction.slice(0, 120) }
      });
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 2,
        event_type: "run_completed",
        payload: { status: "ok" }
      });
      return {
        events: [],
        skippedLines: [],
        stderr: "",
        returnCode: 0,
        sawTerminal: true
      };
    }
  });

  assert.match(capturedInstruction, /holaboss_onboarding_status/);
  assert.match(capturedInstruction, /holaboss_onboarding_complete/);
  assert.doesNotMatch(capturedInstruction, /`hb`/);

  store.close();
});

test("claimed onboarding input includes ONBOARD.md verbatim", async () => {
  const store = makeStore("hb-claimed-input-onboarding-verbatim-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
    onboardingStatus: "pending",
    onboardingSessionId: "session-onboarding"
  });
  fs.writeFileSync(
    path.join(store.workspaceDir(workspace.id), "ONBOARD.md"),
    "opening_sentence: What is the primary goal for this workspace?\n\n# Workspace Onboarding\n\nAsk concise setup questions.\n",
    "utf8"
  );
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-onboarding",
    payload: { text: "yes" }
  });

  let capturedInstruction = "";
  await processClaimedInput({
    store,
    record: queued,
    executeRunnerRequestFn: async (payload, options = {}) => {
      capturedInstruction = String(payload.instruction ?? "");
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 1,
        event_type: "run_started",
        payload: { instruction_preview: capturedInstruction.slice(0, 120) }
      });
      await options.onEvent?.({
        session_id: payload.session_id,
        input_id: payload.input_id,
        sequence: 2,
        event_type: "run_completed",
        payload: { status: "ok" }
      });
      return {
        events: [],
        skippedLines: [],
        stderr: "",
        returnCode: 0,
        sawTerminal: true
      };
    }
  });

  assert.match(capturedInstruction, /opening_sentence: What is the primary goal for this workspace\?/);
  assert.doesNotMatch(capturedInstruction, /opening_sentence may already be visible/);

  store.close();
});

test("claimed input persists replacement harness session id from terminal runner event", async () => {
  const store = makeStore("hb-claimed-input-harness-session-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "pi",
    harnessSessionId: "existing-session"
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello" }
  });
  setNodeRunnerCommand([
    "const request = process.argv.at(-1) ?? '';",
    "void request;",
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 1, event_type: 'run_started', payload: { status: 'started' } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 2, event_type: 'run_completed', payload: { status: 'ok', harness_session_id: 'replacement-session' } }) + '\\n');`
  ]);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300
  });

  await processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker"
  });

  const binding = store.getBinding({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });

  assert.ok(binding);
  assert.equal(binding.harnessSessionId, "replacement-session");

  store.close();
});

test("claimed input passes persisted child session kind into the runner payload", async () => {
  const store = makeStore("hb-claimed-input-session-kind-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.ensureSession({
    workspaceId: workspace.id,
    sessionId: "proposal-session-1",
    kind: "task_proposal",
    parentSessionId: "session-main"
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "proposal-session-1",
    payload: { text: "hello" }
  });

  let capturedSessionKind = "";
  await processClaimedInput({
    store,
    record: queued,
    executeRunnerRequestFn: async (payload, options = {}) => {
      capturedSessionKind = String(payload.session_kind ?? "");
      await options.onEvent?.({
        session_id: String(payload.session_id),
        input_id: String(payload.input_id),
        sequence: 1,
        event_type: "run_started",
        payload: {}
      });
      await options.onEvent?.({
        session_id: String(payload.session_id),
        input_id: String(payload.input_id),
        sequence: 2,
        event_type: "run_completed",
        payload: { status: "ok" }
      });
      return {
        events: [],
        skippedLines: [],
        stderr: "",
        returnCode: 0,
        sawTerminal: true
      };
    }
  });

  assert.equal(capturedSessionKind, "task_proposal");
  store.close();
});

test("claimed input resets harness session binding to the local session after run_failed", async () => {
  const store = makeStore("hb-claimed-input-harness-session-reset-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "pi",
    harnessSessionId: "stale-pi-session"
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello" }
  });
  setNodeRunnerCommand([
    "const request = process.argv.at(-1) ?? '';",
    "void request;",
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 1, event_type: 'run_started', payload: { status: 'started' } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 2, event_type: 'run_failed', payload: { type: 'OpenCodeSessionError', message: 'boom', harness_session_id: 'failed-session' } }) + '\\n');`
  ]);

  const claimed = store.claimInputs({
    limit: 1,
    claimedBy: "sandbox-agent-ts-worker",
    leaseSeconds: 300
  });

  await processClaimedInput({
    store,
    record: claimed[0],
    claimedBy: "sandbox-agent-ts-worker"
  });

  const binding = store.getBinding({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });

  assert.ok(binding);
  assert.equal(binding.harnessSessionId, "session-main");
  store.close();
});
