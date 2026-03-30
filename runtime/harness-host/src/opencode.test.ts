import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

import {
  appendOpencodeDiagnosticLog,
  createOpencodeEventMapperState,
  mapOpencodeEvent,
  promptPartsForRequest,
  resolveOpencodeSessionId,
  sanitizeDiagnosticHeaders,
  shouldEmitOpencodeEvent,
} from "./opencode.js";
import type { OpencodeHarnessHostRequest } from "./contracts.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempWorkspaceDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function baseRequest(): OpencodeHarnessHostRequest {
  return {
    workspace_id: "workspace-1",
    workspace_dir: "/tmp/workspace-1",
    session_id: "session-1",
    input_id: "input-1",
    instruction: "Review the attachment",
    attachments: [],
    debug: false,
    harness_session_id: undefined,
    persisted_harness_session_id: undefined,
    provider_id: "openai",
    model_id: "gpt-5.1",
    mode: "code",
    opencode_base_url: "http://127.0.0.1:4096",
    timeout_seconds: 30,
    system_prompt: "system",
    tools: { read: true },
    workspace_tool_ids: [],
    workspace_skill_ids: [],
    mcp_servers: [],
    output_format: null,
    workspace_config_checksum: "checksum-1",
    run_started_payload: { phase: "booting" },
    model_client: {
      model_proxy_provider: "openai_compatible",
      api_key: "token",
      base_url: "https://runtime.example/api/v1/model-proxy/openai/v1",
      default_headers: null,
    },
  };
}

test("mapOpencodeEvent flushes buffered deltas once part type is known", () => {
  const state = createOpencodeEventMapperState();

  const firstEvents = mapOpencodeEvent(
    {
      type: "message.part.delta",
      properties: {
        sessionID: "opencode-session-1",
        partID: "text-part-1",
        delta: "Hello ",
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(firstEvents, []);
  assert.deepEqual(state.pendingPartDeltas.get("text-part-1"), [["message.part.delta", "Hello "]]);

  state.partTypeSnapshots.set("text-part-1", "text");
  const secondEvents = mapOpencodeEvent(
    {
      type: "message.part.delta",
      properties: {
        sessionID: "opencode-session-1",
        partID: "text-part-1",
        delta: "world",
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(secondEvents, [
    {
      event_type: "output_delta",
      payload: {
        delta: "Hello ",
        event: "message.part.delta",
        source: "opencode",
        part_id: "text-part-1",
        part_type: "text",
        delta_kind: "output",
      },
    },
    {
      event_type: "output_delta",
      payload: {
        delta: "world",
        event: "message.part.delta",
        source: "opencode",
        part_id: "text-part-1",
        part_type: "text",
        delta_kind: "output",
      },
    },
  ]);
});

test("mapOpencodeEvent prefers part text snapshots over packed raw text deltas", () => {
  const state = createOpencodeEventMapperState();

  const events = mapOpencodeEvent(
    {
      type: "message.part.delta",
      properties: {
        sessionID: "opencode-session-1",
        delta: "Imheretowrite",
        part: {
          id: "text-part-1",
          type: "text",
          text: "I'm here to write",
        },
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(events, [
    {
      event_type: "output_delta",
      payload: {
        delta: "I'm here to write",
        event: "message.part.delta",
        source: "opencode",
        part_id: "text-part-1",
        part_type: "text",
        delta_kind: "output",
      },
    },
  ]);
});

test("mapOpencodeEvent maps question tool calls to waiting_user terminal events", () => {
  const state = createOpencodeEventMapperState();

  const events = mapOpencodeEvent(
    {
      type: "message.part.updated",
      properties: {
        session_id: "opencode-session-1",
        part: {
          type: "tool",
          id: "tool-part-1",
          tool: "question",
          call_id: "call-1",
          state: {
            status: "running",
            input: {
              questions: [
                {
                  question: "What are your top 1-3 outcomes?",
                  header: "Top Outcomes",
                },
              ],
            },
            output: null,
            error: null,
          },
        },
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(events, [
    {
      event_type: "tool_call",
      payload: {
        phase: "started",
        tool_name: "question",
        error: false,
        tool_args: {
          questions: [
            {
              question: "What are your top 1-3 outcomes?",
              header: "Top Outcomes",
            },
          ],
        },
        result: null,
        event: "message.part.updated",
        source: "opencode",
        call_id: "call-1",
      },
    },
    {
      event_type: "run_completed",
      payload: {
        status: "waiting_user",
        event: "message.part.updated",
        interaction_type: "question",
        tool_name: "question",
        question: {
          questions: [
            {
              question: "What are your top 1-3 outcomes?",
              header: "Top Outcomes",
            },
          ],
        },
        call_id: "call-1",
      },
    },
  ]);
});

test("mapOpencodeEvent maps idle session status to completion and flushes unresolved deltas", () => {
  const state = createOpencodeEventMapperState();
  state.pendingPartDeltas.set("text-part-1", [["message.part.delta", "Hello"]]);

  const events = mapOpencodeEvent(
    {
      type: "session.status",
      properties: {
        sessionID: "opencode-session-1",
        status: { type: "idle" },
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(events, [
    {
      event_type: "output_delta",
      payload: {
        delta: "Hello",
        event: "message.part.delta",
        source: "opencode",
        part_id: "text-part-1",
        part_type: null,
        delta_kind: "unknown",
        unresolved_part_type: true,
      },
    },
    {
      event_type: "run_completed",
      payload: {
        status: "success",
        event: "session.status",
        session_status: "idle",
      },
    },
  ]);
});

test("resolveOpencodeSessionId creates a fresh session when the requested session does not exist", async () => {
  const checks: string[] = [];
  let created = 0;

  const sessionID = await resolveOpencodeSessionId({
    requestedSessionId: "runtime-session-1",
    persistedSessionId: "persisted-session-1",
    sessionExists: async (candidate) => {
      checks.push(candidate);
      return candidate === "persisted-session-1";
    },
    createSession: async () => {
      created += 1;
      return "created-session-1";
    },
  });

  assert.equal(sessionID, "created-session-1");
  assert.deepEqual(checks, ["runtime-session-1"]);
  assert.equal(created, 1);
});

test("resolveOpencodeSessionId reuses the persisted session only when no requested session is provided", async () => {
  const checks: string[] = [];
  let created = 0;

  const sessionID = await resolveOpencodeSessionId({
    requestedSessionId: null,
    persistedSessionId: "persisted-session-1",
    sessionExists: async (candidate) => {
      checks.push(candidate);
      return candidate === "persisted-session-1";
    },
    createSession: async () => {
      created += 1;
      return "created-session-1";
    },
  });

  assert.equal(sessionID, "persisted-session-1");
  assert.deepEqual(checks, ["persisted-session-1"]);
  assert.equal(created, 0);
});

test("shouldEmitOpencodeEvent filters step markers and prompt echo", () => {
  assert.equal(
    shouldEmitOpencodeEvent("thinking_delta", { delta: "step-start", source: "opencode" }, "hello"),
    false
  );
  assert.equal(
    shouldEmitOpencodeEvent("thinking_delta", { delta: "step-finish", source: "opencode" }, "hello"),
    false
  );
  assert.equal(
    shouldEmitOpencodeEvent("output_delta", { delta: "hello", source: "opencode" }, "hello"),
    false
  );
  assert.equal(
    shouldEmitOpencodeEvent("output_delta", { delta: "hello world", source: "opencode" }, "hello"),
    true
  );
});

test("promptPartsForRequest adds staged attachments as file parts", () => {
  const parts = promptPartsForRequest({
    ...baseRequest(),
    attachments: [
      {
        id: "attachment-1",
        kind: "image",
        name: "diagram.png",
        mime_type: "image/png",
        size_bytes: 42,
        workspace_path: ".holaboss/input-attachments/batch-1/diagram.png",
      },
    ],
  });

  assert.deepEqual(parts, [
    { type: "text", text: "Review the attachment" },
    {
      type: "file",
      url: "file:///tmp/workspace-1/.holaboss/input-attachments/batch-1/diagram.png",
      mime: "image/png",
      filename: "diagram.png",
    },
  ]);
});

test("sanitizeDiagnosticHeaders redacts sensitive header values", () => {
  assert.deepEqual(
    sanitizeDiagnosticHeaders({
      "X-API-Key": "secret-token",
      Authorization: "Bearer secret-token",
      "X-Holaboss-Sandbox-Id": "sandbox-1",
    }),
    {
      "X-API-Key": "[redacted]",
      Authorization: "[redacted]",
      "X-Holaboss-Sandbox-Id": "sandbox-1",
    },
  );
});

test("appendOpencodeDiagnosticLog writes jsonl entries under .holaboss", () => {
  const workspaceDir = makeTempWorkspaceDir("hb-opencode-harness-log-");

  appendOpencodeDiagnosticLog(workspaceDir, "prompt_prepare", {
    provider_id: "openai",
    headers: sanitizeDiagnosticHeaders({
      "X-API-Key": "secret-token",
      "X-Holaboss-Sandbox-Id": "sandbox-1",
    }),
  });

  const logPath = path.join(workspaceDir, ".holaboss", "opencode-harness.log");
  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(entry.event, "prompt_prepare");
  assert.equal(typeof entry.at, "string");
  assert.deepEqual(entry.details, {
    provider_id: "openai",
    headers: {
      "X-API-Key": "[redacted]",
      "X-Holaboss-Sandbox-Id": "sandbox-1",
    },
  });
});

test("mapOpencodeEvent maps session.error into run_failed with provider details", () => {
  const state = createOpencodeEventMapperState();

  const events = mapOpencodeEvent(
    {
      type: "session.error",
      properties: {
        sessionID: "opencode-session-1",
        error: {
          name: "UnknownError",
          data: {
            message: "sdk.responses is not a function",
            providerID: "openai",
          },
        },
      },
    },
    "opencode-session-1",
    state,
  );

  assert.deepEqual(events, [
    {
      event_type: "run_failed",
      payload: {
        type: "OpenCodeSessionError",
        message: "UnknownError: sdk.responses is not a function (provider=openai)",
        event: "session.error",
        error_name: "UnknownError",
        provider_id: "openai",
      },
    },
  ]);
});
