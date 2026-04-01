import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpencodeEventMapperState,
  mapOpencodeEvent,
  promptPartsForRequest,
  resolveOpencodeSessionId,
  runOpencode,
  shouldEmitOpencodeEvent,
} from "./opencode.js";
import type { OpencodeHarnessHostRequest } from "./contracts.js";

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

test("mapOpencodeEvent ignores raw text updates that would duplicate later output deltas", () => {
  const state = createOpencodeEventMapperState();

  const updatedEvents = mapOpencodeEvent(
    {
      type: "message.part.updated",
      properties: {
        sessionID: "opencode-session-1",
        delta: "hi",
        part: {
          type: "text",
          id: "text-part-1",
        },
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(updatedEvents, []);

  const deltaEvents = mapOpencodeEvent(
    {
      type: "message.part.delta",
      properties: {
        sessionID: "opencode-session-1",
        delta: "Hi",
        part: {
          type: "text",
          id: "text-part-1",
        },
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(deltaEvents, [
    {
      event_type: "output_delta",
      payload: {
        delta: "Hi",
        event: "message.part.delta",
        source: "opencode",
        part_id: "text-part-1",
        part_type: "text",
        delta_kind: "output",
      },
    },
  ]);
});

test("mapOpencodeEvent drops buffered user text updates once the parent message role resolves", () => {
  const state = createOpencodeEventMapperState();

  const earlyUserUpdate = mapOpencodeEvent(
    {
      type: "message.part.updated",
      properties: {
        sessionID: "opencode-session-1",
        part: {
          id: "user-text-1",
          sessionID: "opencode-session-1",
          messageID: "user-message-1",
          type: "text",
          text: "Good morning",
        },
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(earlyUserUpdate, []);

  const userMessageUpdated = mapOpencodeEvent(
    {
      type: "message.updated",
      properties: {
        sessionID: "opencode-session-1",
        info: {
          id: "user-message-1",
          sessionID: "opencode-session-1",
          role: "user",
          time: { created: 0 },
          agent: "build",
          model: {
            providerID: "openai",
            modelID: "gpt-5.1",
          },
          parts: [
            {
              id: "user-text-1",
              sessionID: "opencode-session-1",
              messageID: "user-message-1",
              type: "text",
              text: "Good morning",
            },
          ],
        },
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(userMessageUpdated, []);

  const assistantDelta = mapOpencodeEvent(
    {
      type: "message.part.delta",
      properties: {
        sessionID: "opencode-session-1",
        messageID: "assistant-message-1",
        delta: "Hello",
        part: {
          id: "assistant-text-1",
          sessionID: "opencode-session-1",
          messageID: "assistant-message-1",
          type: "text",
        },
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(assistantDelta, [
    {
      event_type: "output_delta",
      payload: {
        delta: "Hello",
        event: "message.part.delta",
        source: "opencode",
        part_id: "assistant-text-1",
        part_type: "text",
        delta_kind: "output",
      },
    },
  ]);
});

test("mapOpencodeEvent releases buffered assistant text updates after the parent message role resolves", () => {
  const state = createOpencodeEventMapperState();

  const earlyAssistantUpdate = mapOpencodeEvent(
    {
      type: "message.part.updated",
      properties: {
        sessionID: "opencode-session-1",
        part: {
          id: "assistant-text-1",
          sessionID: "opencode-session-1",
          messageID: "assistant-message-1",
          type: "text",
          text: "Hello",
        },
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(earlyAssistantUpdate, []);

  const assistantMessageUpdated = mapOpencodeEvent(
    {
      type: "message.updated",
      properties: {
        sessionID: "opencode-session-1",
        info: {
          id: "assistant-message-1",
          sessionID: "opencode-session-1",
          role: "assistant",
          time: { created: 0 },
          parentID: "user-message-1",
          modelID: "gpt-5.1",
          providerID: "openai",
          mode: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          parts: [
            {
              id: "assistant-text-1",
              sessionID: "opencode-session-1",
              messageID: "assistant-message-1",
              type: "text",
              text: "Hello",
            },
          ],
        },
      },
    },
    "opencode-session-1",
    state
  );

  assert.deepEqual(assistantMessageUpdated, [
    {
      event_type: "output_delta",
      payload: {
        delta: "Hello",
        event: "message.part.updated",
        source: "opencode",
        part_id: "assistant-text-1",
        part_type: "text",
        delta_kind: "output",
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

test("shouldEmitOpencodeEvent filters step markers only", () => {
  assert.equal(
    shouldEmitOpencodeEvent("thinking_delta", { delta: "step-start", source: "opencode" }, "hello"),
    false
  );
  assert.equal(
    shouldEmitOpencodeEvent("thinking_delta", { delta: "step-finish", source: "opencode" }, "hello"),
    false
  );
  assert.equal(shouldEmitOpencodeEvent("output_delta", { delta: "hello", source: "opencode" }, "hello"), true);
  assert.equal(shouldEmitOpencodeEvent("output_delta", { delta: "hello world", source: "opencode" }, "hello"), true);
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

test("runOpencode primes the event stream before prompt submission", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  let nextCalled = false;
  let eventDelivered = false;

  const iterator: AsyncIterator<unknown> = {
    next: async () => {
      nextCalled = true;
      if (eventDelivered) {
        return { done: true, value: undefined };
      }
      eventDelivered = true;
      return {
        done: false,
        value: {
          type: "session.status",
          properties: {
            sessionID: "created-session-1",
            status: { type: "idle" },
          },
        },
      };
    },
  };

  const fakeClient = {
    mcp: {
      status: async () => ({ data: {} }),
      add: async () => ({ data: {} }),
      connect: async () => ({ data: {} }),
    },
    session: {
      get: async () => ({ data: undefined }),
      create: async () => ({ data: { id: "created-session-1" } }),
      promptAsync: async () => {
        assert.equal(nextCalled, true);
        return { data: { accepted: true } };
      },
    },
    event: {
      subscribe: async () => ({
        stream: {
          [Symbol.asyncIterator]() {
            return iterator;
          },
        },
      }),
    },
  };

  try {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    const exitCode = await runOpencode(baseRequest(), {
      createClient: () => fakeClient as never,
    });

    assert.equal(exitCode, 0);
    assert.equal(nextCalled, true);
    assert.match(writes.join(""), /"event_type":"run_completed"/);
  } finally {
    process.stdout.write = originalWrite;
  }
});
