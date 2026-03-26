import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpencodeEventMapperState,
  mapOpencodeEvent,
  shouldEmitOpencodeEvent,
} from "./opencode.js";

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
