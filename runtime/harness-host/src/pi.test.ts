import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { HarnessHostPiRequest } from "./contracts.js";
import { buildPiMcpServerBindings, buildPiMcpToolName, createPiEventMapperState, createPiMcpCustomTools, mapPiSessionEvent, resolvePiSkillDirs, runPi } from "./pi.js";

function baseRequest(): HarnessHostPiRequest {
  return {
    workspace_id: "workspace-1",
    workspace_dir: "/tmp/workspace-1",
    session_id: "session-1",
    input_id: "input-1",
    instruction: "List the files",
    debug: false,
    harness_session_id: undefined,
    persisted_harness_session_id: undefined,
    provider_id: "openai",
    model_id: "gpt-5.1",
    timeout_seconds: 30,
    system_prompt: "You are concise.",
    workspace_skill_dirs: [],
    mcp_servers: [],
    mcp_tool_refs: [],
    workspace_config_checksum: "checksum-1",
    run_started_payload: { phase: "booting" },
    model_client: {
      model_proxy_provider: "openai_compatible",
      api_key: "token",
      base_url: "https://runtime.example/api/v1/model-proxy/openai/v1",
      default_headers: {
        "X-API-Key": "token",
      },
    },
  };
}

test("mapPiSessionEvent maps text, thinking, tool, and completion events", () => {
  const state = createPiEventMapperState(
    new Map([
      [
        buildPiMcpToolName("workspace", "lookup"),
        {
          piToolName: buildPiMcpToolName("workspace", "lookup"),
          serverId: "workspace",
          toolId: "workspace.lookup",
          toolName: "lookup",
        },
      ],
    ])
  );
  const sessionFile = "/tmp/pi-session.jsonl";

  assert.deepEqual(
    mapPiSessionEvent(
      {
        type: "message_update",
        message: {} as never,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "Hello",
          partial: {} as never,
        },
      },
      sessionFile,
      state
    ),
    [
      {
        event_type: "output_delta",
        payload: {
          delta: "Hello",
          event: "message_update",
          source: "pi",
          content_index: 0,
          delta_kind: "output",
        },
      },
    ]
  );

  assert.deepEqual(
    mapPiSessionEvent(
      {
        type: "message_update",
        message: {} as never,
        assistantMessageEvent: {
          type: "thinking_delta",
          contentIndex: 1,
          delta: "Need to inspect files",
          partial: {} as never,
        },
      },
      sessionFile,
      state
    ),
    [
      {
        event_type: "thinking_delta",
        payload: {
          delta: "Need to inspect files",
          event: "message_update",
          source: "pi",
          content_index: 1,
          delta_kind: "thinking",
        },
      },
    ]
  );

  assert.deepEqual(
    mapPiSessionEvent(
      {
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: buildPiMcpToolName("workspace", "lookup"),
        args: { query: "hello" },
      },
      sessionFile,
      state
    ),
    [
      {
        event_type: "tool_call",
        payload: {
          phase: "started",
          tool_name: "lookup",
          tool_args: { query: "hello" },
          result: null,
          error: false,
          event: "tool_execution_start",
          source: "pi",
          call_id: "call-1",
          pi_tool_name: buildPiMcpToolName("workspace", "lookup"),
          mcp_server_id: "workspace",
          tool_id: "workspace.lookup",
        },
      },
    ]
  );

  assert.deepEqual(
    mapPiSessionEvent(
      {
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: buildPiMcpToolName("workspace", "lookup"),
        result: { ok: true },
        isError: false,
      },
      sessionFile,
      state
    ),
    [
      {
        event_type: "tool_call",
        payload: {
          phase: "completed",
          tool_name: "lookup",
          tool_args: { query: "hello" },
          result: { ok: true },
          error: false,
          event: "tool_execution_end",
          source: "pi",
          call_id: "call-1",
          pi_tool_name: buildPiMcpToolName("workspace", "lookup"),
          mcp_server_id: "workspace",
          tool_id: "workspace.lookup",
        },
      },
    ]
  );

  assert.deepEqual(
    mapPiSessionEvent(
      {
        type: "agent_end",
        messages: [],
      },
      sessionFile,
      state
    ),
    [
      {
        event_type: "run_completed",
        payload: {
          status: "success",
          event: "agent_end",
          source: "pi",
          harness_session_id: sessionFile,
        },
      },
    ]
  );
});

test("buildPiMcpServerBindings converts remote and local MCP payloads into mcporter definitions", () => {
  const request: HarnessHostPiRequest = {
    ...baseRequest(),
    mcp_servers: [
      {
        name: "remote-server",
        config: {
          type: "remote",
          enabled: true,
          url: "http://127.0.0.1:8765/mcp",
          headers: { Authorization: "Bearer token" },
          timeout: 15000,
        },
      },
      {
        name: "local-server",
        config: {
          type: "local",
          enabled: true,
          command: ["node", "server.js", "--stdio"],
          environment: { API_KEY: "token-1" },
          timeout: 9000,
        },
      },
    ],
  };

  const bindings = buildPiMcpServerBindings(request);

  assert.deepEqual(bindings, [
    {
      serverId: "remote-server",
      timeoutMs: 15000,
      definition: {
        name: "remote-server",
        description: "Holaboss MCP server remote-server",
        command: {
          kind: "http",
          url: new URL("http://127.0.0.1:8765/mcp"),
          headers: { Authorization: "Bearer token" },
        },
      },
    },
    {
      serverId: "local-server",
      timeoutMs: 9000,
      definition: {
        name: "local-server",
        description: "Holaboss MCP server local-server",
        command: {
          kind: "stdio",
          command: "node",
          args: ["server.js", "--stdio"],
          cwd: "/tmp/workspace-1",
        },
        env: { API_KEY: "token-1" },
      },
    },
  ]);
});

test("resolvePiSkillDirs returns existing source skill directories in order", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-pi-skills-workspace-"));
  const skillAlphaDir = path.join(workspaceDir, "skills", "alpha");
  const skillBetaDir = path.join(workspaceDir, "skills", "beta");
  fs.mkdirSync(skillAlphaDir, { recursive: true });
  fs.mkdirSync(skillBetaDir, { recursive: true });
  const request: HarnessHostPiRequest = {
    ...baseRequest(),
    workspace_dir: workspaceDir,
    workspace_skill_dirs: [
      skillAlphaDir,
      skillAlphaDir,
      path.join(workspaceDir, "skills", "missing"),
      skillBetaDir,
    ],
  };

  try {
    assert.deepEqual(resolvePiSkillDirs(request), [skillAlphaDir, skillBetaDir]);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("createPiMcpCustomTools filters discovery to allowlisted tools and forwards calls via mcporter", async () => {
  const request: HarnessHostPiRequest = {
    ...baseRequest(),
    mcp_servers: [
      {
        name: "workspace",
        config: {
          type: "remote",
          enabled: true,
          url: "http://127.0.0.1:7000/mcp",
          timeout: 12000,
        },
      },
    ],
    mcp_tool_refs: [
      {
        tool_id: "workspace.lookup",
        server_id: "workspace",
        tool_name: "lookup",
      },
    ],
  };
  const calls: Array<{ server: string; toolName: string; args: Record<string, unknown> | undefined }> = [];
  const runtime = {
    listTools: async () => [
      {
        name: "lookup",
        description: "Look something up",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      },
      {
        name: "write_back",
        description: "Should not be exposed",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
    callTool: async (server: string, toolName: string, options?: { args?: Record<string, unknown> }) => {
      calls.push({ server, toolName, args: options?.args });
      return {
        structuredContent: {
          ok: true,
          echo: options?.args,
        },
      };
    },
  };

  const bindings = buildPiMcpServerBindings(request);
  const toolset = await createPiMcpCustomTools(request, runtime as never, bindings);

  assert.equal(toolset.customTools.length, 1);
  assert.equal(toolset.customTools[0]?.name, buildPiMcpToolName("workspace", "lookup"));
  assert.deepEqual(Array.from(toolset.mcpToolMetadata.values()), [
    {
      piToolName: buildPiMcpToolName("workspace", "lookup"),
      serverId: "workspace",
      toolId: "workspace.lookup",
      toolName: "lookup",
    },
  ]);

  const result = await toolset.customTools[0]!.execute(
    "call-1",
    { query: "hello" } as never,
    undefined,
    undefined,
    {} as never
  );

  assert.deepEqual(calls, [
    {
      server: "workspace",
      toolName: "lookup",
      args: { query: "hello" },
    },
  ]);
  assert.equal(result.content[0]?.type, "text");
  assert.match(String((result.content[0] as { text: string }).text), /"ok": true/);
});

test("runPi emits run_started and terminal success when the session completes", async () => {
  const request = baseRequest();
  const events: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const fakeSession = {
    subscribe(listener: (event: unknown) => void) {
      this.listener = listener;
      return () => {};
    },
    async prompt() {
      this.listener?.({
        type: "message_update",
        message: {},
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "Done",
          partial: {},
        },
      });
      this.listener?.({
        type: "agent_end",
        messages: [],
      });
    },
    async abort() {},
    dispose() {},
    listener: undefined as ((event: unknown) => void) | undefined,
  };

  process.stdout.write = ((chunk: string | Uint8Array) => {
    const lines = String(chunk)
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event_type: string; payload: Record<string, unknown> });
    events.push(...lines);
    return true;
  }) as typeof process.stdout.write;

  try {
    const exitCode = await runPi(request, {
      createSession: async () => ({
        session: fakeSession as never,
        sessionFile: "/tmp/pi-session.jsonl",
        mcpToolMetadata: new Map(),
        dispose: async () => {},
      }),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(
      events.map((event) => event.event_type),
      ["run_started", "output_delta", "run_completed"]
    );
    assert.equal(events[0]?.payload.harness_session_id, "/tmp/pi-session.jsonl");
    assert.equal(events[2]?.payload.harness_session_id, "/tmp/pi-session.jsonl");
  } finally {
    process.stdout.write = originalWrite;
  }
});
