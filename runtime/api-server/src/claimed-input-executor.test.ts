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

test("claimed input persists runner events, assistant text, and waiting_user state on success", async () => {
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
  process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE = `python - <<'PY'
import json
print(json.dumps(dict(session_id="session-main", input_id="${queued.inputId}", sequence=1, event_type="run_started", payload=dict(instruction_preview="hello"))))
print(json.dumps(dict(session_id="session-main", input_id="${queued.inputId}", sequence=2, event_type="output_delta", payload=dict(delta="Hello from TS"))))
print(json.dumps(dict(session_id="session-main", input_id="${queued.inputId}", sequence=3, event_type="run_completed", payload=dict(status="ok"))))
PY`;

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
  assert.equal(runtimeState.status, "WAITING_USER");
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
  process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE = `python - <<'PY'
import json
print(json.dumps(dict(session_id="session-main", input_id="${queued.inputId}", sequence=1, event_type="run_started", payload=dict(instruction_preview="hello"))))
PY`;

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
  process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE = `python -c "import base64, json, sys; payload=json.loads(base64.b64decode(sys.argv[1])); ctx=payload['context']['_sandbox_runtime_exec_v1']; print(json.dumps(dict(session_id=payload['session_id'], input_id=payload['input_id'], sequence=1, event_type='run_started', payload=dict(runtime_exec_context=ctx)))); print(json.dumps(dict(session_id=payload['session_id'], input_id=payload['input_id'], sequence=2, event_type='run_completed', payload=dict(status='ok'))))" {request_base64}`;

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
  process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE = `python - <<'PY'
import json
print(json.dumps(dict(session_id="session-main", input_id="${queued.inputId}", sequence=1, event_type="run_started", payload=dict(status="started"))))
print(json.dumps(dict(session_id="session-main", input_id="${queued.inputId}", sequence=2, event_type="run_completed", payload=dict(status="ok", harness_session_id="replacement-session"))))
PY`;

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
