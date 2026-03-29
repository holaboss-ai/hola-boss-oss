import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { processClaimedInput } from "./claimed-input-executor.js";

const tempDirs: string[] = [];
const ORIGINAL_ENV = {
  SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE: process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE,
  SANDBOX_AGENT_RUN_TIMEOUT_S: process.env.SANDBOX_AGENT_RUN_TIMEOUT_S,
  SANDBOX_AGENT_RUN_IDLE_TIMEOUT_S: process.env.SANDBOX_AGENT_RUN_IDLE_TIMEOUT_S,
  HB_SANDBOX_ROOT: process.env.HB_SANDBOX_ROOT
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
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
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

  assert.ok(updated);
  assert.equal(updated.status, "FAILED");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "ERROR");
  assert.deepEqual(runtimeState.lastError, { message: "workspace not found" });
  assert.deepEqual(events, []);

  store.close();
});

test("claimed input persists runner events, assistant text, and idle state on success", async () => {
  const store = makeStore("hb-claimed-input-success-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
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
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 2, event_type: 'output_delta', payload: { delta: 'Hello from TS' } }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ session_id: 'session-main', input_id: '${queued.inputId}', sequence: 3, event_type: 'run_completed', payload: { status: 'ok' } }) + '\\n');`
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
  const messages = store.listSessionMessages({
    workspaceId: workspace.id,
    sessionId: "session-main"
  });

  assert.ok(updated);
  assert.equal(updated.status, "DONE");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "IDLE");
  assert.equal(runtimeState.currentInputId, null);
  assert.equal(runtimeState.currentWorkerId, null);
  assert.equal(runtimeState.lastError, null);
  assert.deepEqual(
    events.map((event) => event.eventType),
    ["run_started", "output_delta", "run_completed"]
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[0].text, "Hello from TS");

  store.close();
});

test("claimed input preserves waiting_user state when terminal payload requests it", async () => {
  const store = makeStore("hb-claimed-input-waiting-user-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
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

  assert.ok(updated);
  assert.equal(updated.status, "DONE");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "WAITING_USER");

  store.close();
});

test("claimed input ignores waiting_user terminal status for harnesses that do not support it", async () => {
  const store = makeStore("hb-claimed-input-pi-waiting-user-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
    mainSessionId: "session-main"
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

  assert.ok(updated);
  assert.equal(updated.status, "DONE");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "IDLE");

  store.close();
});

test("claimed input synthesizes run_failed when runner exits without terminal event", async () => {
  const store = makeStore("hb-claimed-input-failure-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
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

  assert.ok(updated);
  assert.equal(updated.status, "FAILED");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "ERROR");
  assert.equal(events.length, 2);
  assert.equal(events[0].eventType, "run_started");
  assert.equal(events[1].eventType, "run_failed");
  assert.match(String(events[1].payload.message), /runner ended before terminal event/);

  store.close();
});

test("claimed input succeeds when runner emits terminal event but keeps the process alive", async () => {
  const store = makeStore("hb-claimed-input-terminal-kill-");
  process.env.SANDBOX_AGENT_RUN_TIMEOUT_S = "1";
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
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

  assert.ok(updated);
  assert.equal(updated.status, "DONE");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "IDLE");
  assert.deepEqual(
    events.map((event) => event.eventType),
    ["run_started", "run_completed"]
  );

  store.close();
});

test("claimed input fails when runner becomes idle after run_started", async () => {
  const store = makeStore("hb-claimed-input-idle-timeout-");
  process.env.SANDBOX_AGENT_RUN_TIMEOUT_S = "10";
  process.env.SANDBOX_AGENT_RUN_IDLE_TIMEOUT_S = "1";
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
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

  assert.ok(updated);
  assert.equal(updated.status, "FAILED");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "ERROR");
  assert.equal(events.length, 2);
  assert.equal(events[0].eventType, "run_started");
  assert.equal(events[1].eventType, "run_failed");
  assert.match(String(events[1].payload.message), /idle/i);

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
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
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
  assert.equal(runtimeExecContext.harness, "opencode");
  assert.equal(runtimeExecContext.harness_session_id, "session-main");

  store.close();
});

test("claimed input persists replacement harness session id from terminal runner event", async () => {
  const store = makeStore("hb-claimed-input-harness-session-");
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
  });
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "opencode",
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
