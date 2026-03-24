import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { NativeRunnerExecutor, RunnerExecutorError } from "./runner-worker.js";

const ORIGINAL_ENV = {
  SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE: process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE,
  SANDBOX_AGENT_RUN_TIMEOUT_S: process.env.SANDBOX_AGENT_RUN_TIMEOUT_S
};

afterEach(() => {
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
});

function payload(): Record<string, unknown> {
  return {
    workspace_id: "workspace-1",
    session_id: "session-1",
    input_id: "input-1",
    instruction: "hello",
    context: {}
  };
}

test("native runner executor returns parsed runner events", async () => {
  process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE = `python - <<'PY'
import json
print(json.dumps(dict(session_id="session-1", input_id="input-1", sequence=1, event_type="run_started", payload=dict(instruction_preview="hello"))))
print(json.dumps(dict(session_id="session-1", input_id="input-1", sequence=2, event_type="run_completed", payload=dict(status="success"))))
PY`;

  const executor = new NativeRunnerExecutor();
  const response = await executor.run(payload());

  assert.deepEqual(response, {
    session_id: "session-1",
    input_id: "input-1",
    events: [
      {
        session_id: "session-1",
        input_id: "input-1",
        sequence: 1,
        event_type: "run_started",
        payload: { instruction_preview: "hello" }
      },
      {
        session_id: "session-1",
        input_id: "input-1",
        sequence: 2,
        event_type: "run_completed",
        payload: { status: "success" }
      }
    ]
  });
});

test("native runner executor synthesizes failed stream terminal event", async () => {
  process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE = `python - <<'PY'
import json
print(json.dumps(dict(session_id="session-1", input_id="input-1", sequence=1, event_type="run_started", payload=dict(instruction_preview="hello"))))
PY`;

  const executor = new NativeRunnerExecutor();
  const stream = await executor.stream(payload());
  let body = "";
  for await (const chunk of stream) {
    body += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
  }

  assert.match(body, /event: run_started/);
  assert.match(body, /event: run_failed/);
  assert.match(body, /runner stream ended before terminal event/);
});

test("native runner executor reports invalid command templates", async () => {
  process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE = "echo {missing}";

  const executor = new NativeRunnerExecutor();
  await assert.rejects(() => executor.run(payload()), (error: unknown) => {
    assert.ok(error instanceof RunnerExecutorError);
    assert.equal(error.statusCode, 500);
    assert.match(error.message, /invalid SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE/);
    return true;
  });
});
