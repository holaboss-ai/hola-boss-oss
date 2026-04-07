import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import JSZip from "jszip";
import * as XLSX from "xlsx";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import type { HarnessHostPiRequest } from "./contracts.js";
import {
  buildPiProviderConfig,
  buildPiPromptPayload,
  buildPiMcpServerBindings,
  buildPiMcpToolName,
  createPiEventMapperState,
  createPiMcpCustomTools,
  mapPiSessionEvent,
  resolvePiSkillDirs,
  workspaceBoundaryOverrideRequested,
  workspaceBoundaryViolationForToolCall,
  runPi
} from "./pi.js";

function baseRequest(): HarnessHostPiRequest {
  return {
    workspace_id: "workspace-1",
    workspace_dir: "/tmp/workspace-1",
    session_id: "session-1",
    browser_tools_enabled: false,
    input_id: "input-1",
    instruction: "List the files",
    debug: false,
    harness_session_id: undefined,
    persisted_harness_session_id: undefined,
    provider_id: "openai",
    model_id: "gpt-5.1",
    timeout_seconds: 30,
    runtime_api_base_url: "http://127.0.0.1:5060",
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

test("pi normalizes array-wrapped openai-compatible error bodies", async () => {
  const { APIError } = await import("openai");
  const error = APIError.generate(
    400,
    [
      {
        error: {
          code: 400,
          message: "User location is not supported for the API use.",
          status: "FAILED_PRECONDITION",
        },
      },
    ],
    undefined,
    new Headers()
  );

  assert.equal(error.message, "400 User location is not supported for the API use.");
  assert.deepEqual(error.error, {
    code: 400,
    message: "User location is not supported for the API use.",
    status: "FAILED_PRECONDITION",
  });
});

async function createDocxBuffer(lines: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const body = lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

async function createPptxBuffer(slides: string[]): Promise<Buffer> {
  const zip = new JSZip();
  slides.forEach((slide, index) => {
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>${slide}</a:t></p:sld>`
    );
  });
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

function createXlsxBuffer(rows: string[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function createPdfBuffer(text: string): Buffer {
  const escapedText = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT\n/F1 24 Tf\n72 120 Td\n(${escapedText}) Tj\nET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let output = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(output, "utf8"));
    output += object;
  }
  const xrefOffset = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "utf8");
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
    ]),
    new Map([
      [
        "customer_lookup",
        {
          skillId: "customer_lookup",
          skillName: "customer_lookup",
          filePath: "/tmp/workspace-1/skills/customer_lookup/SKILL.md",
          baseDir: "/tmp/workspace-1/skills/customer_lookup",
          grantedTools: [],
          grantedCommands: [],
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
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          api: "anthropic-messages",
          provider: "anthropic_direct",
          model: "claude-sonnet-4-6",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "error",
          errorMessage: "404 Not Found",
          timestamp: Date.now(),
        },
      } as never,
      sessionFile,
      createPiEventMapperState()
    ),
    [
      {
        event_type: "run_failed",
        payload: {
          type: "ProviderError",
          message: "404 Not Found",
          stop_reason: "error",
          provider: "anthropic_direct",
          model: "claude-sonnet-4-6",
          event: "message_end",
          source: "pi",
          harness_session_id: sessionFile,
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
      {
        ...createPiEventMapperState(),
        terminalState: "failed",
      }
    ),
    []
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
        type: "tool_execution_start",
        toolCallId: "skill-call-1",
        toolName: "skill",
        args: { name: "customer_lookup", args: "Focus on the loyalty tier section." },
      },
      sessionFile,
      state
    ),
    [
      {
        event_type: "tool_call",
        payload: {
          phase: "started",
          tool_name: "skill",
          tool_args: { name: "customer_lookup", args: "Focus on the loyalty tier section." },
          result: null,
          error: false,
          event: "tool_execution_start",
          source: "pi",
          call_id: "skill-call-1",
        },
      },
      {
        event_type: "skill_invocation",
        payload: {
          phase: "started",
          requested_name: "customer_lookup",
          skill_id: "customer_lookup",
          skill_name: "customer_lookup",
          skill_location: "/tmp/workspace-1/skills/customer_lookup/SKILL.md",
          granted_tools_expected: [],
          granted_commands_expected: [],
          args: "Focus on the loyalty tier section.",
          error: false,
          event: "tool_execution_start",
          source: "pi",
          call_id: "skill-call-1",
        },
      },
    ]
  );

  assert.deepEqual(
    mapPiSessionEvent(
      {
        type: "tool_execution_end",
        toolCallId: "skill-call-1",
        toolName: "skill",
        result: {
          details: {
            skill_id: "customer_lookup",
            skill_name: "customer_lookup",
            skill_file_path: "/tmp/workspace-1/skills/customer_lookup/SKILL.md",
            policy_widening: {
              scope: "run",
              workspace_boundary_override: false,
              managed_tools: ["bash", "deploy"],
              granted_tools: ["deploy"],
              active_granted_tools: ["deploy"],
              managed_commands: ["deploy-docs"],
              granted_commands: ["deploy-docs"],
              active_granted_commands: ["deploy-docs"],
            },
          },
        },
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
          tool_name: "skill",
          tool_args: { name: "customer_lookup", args: "Focus on the loyalty tier section." },
          result: {
            details: {
              skill_id: "customer_lookup",
              skill_name: "customer_lookup",
              skill_file_path: "/tmp/workspace-1/skills/customer_lookup/SKILL.md",
              policy_widening: {
                scope: "run",
                workspace_boundary_override: false,
                managed_tools: ["bash", "deploy"],
                granted_tools: ["deploy"],
                active_granted_tools: ["deploy"],
                managed_commands: ["deploy-docs"],
                granted_commands: ["deploy-docs"],
                active_granted_commands: ["deploy-docs"],
              },
            },
          },
          error: false,
          event: "tool_execution_end",
          source: "pi",
          call_id: "skill-call-1",
        },
      },
      {
        event_type: "skill_invocation",
        payload: {
          phase: "completed",
          requested_name: "customer_lookup",
          skill_id: "customer_lookup",
          skill_name: "customer_lookup",
          skill_location: "/tmp/workspace-1/skills/customer_lookup/SKILL.md",
          widening_scope: "run",
          managed_tools: ["bash", "deploy"],
          granted_tools: ["deploy"],
          active_granted_tools: ["deploy"],
          workspace_boundary_override: false,
          managed_commands: ["deploy-docs"],
          granted_commands: ["deploy-docs"],
          active_granted_commands: ["deploy-docs"],
          args: "Focus on the loyalty tier section.",
          error: false,
          error_message: null,
          event: "tool_execution_end",
          source: "pi",
          call_id: "skill-call-1",
        },
      },
    ]
  );

  assert.deepEqual(
    mapPiSessionEvent(
      {
        type: "auto_compaction_start",
        reason: "threshold",
      },
      sessionFile,
      state
    ),
    [
      {
        event_type: "auto_compaction_start",
        payload: {
          reason: "threshold",
          event: "auto_compaction_start",
          source: "pi",
        },
      },
    ]
  );

  assert.deepEqual(
    mapPiSessionEvent(
      {
        type: "auto_compaction_end",
        result: {
          summary: "Kept the latest implementation details.",
          firstKeptEntryId: "entry-1",
          tokensBefore: 12345,
          details: {
            modifiedFiles: ["runtime/harness-host/src/pi.ts"],
          },
        },
        aborted: false,
        willRetry: true,
        errorMessage: undefined,
      },
      sessionFile,
      state
    ),
    [
      {
        event_type: "auto_compaction_end",
        payload: {
          result: {
            summary: "Kept the latest implementation details.",
            firstKeptEntryId: "entry-1",
            tokensBefore: 12345,
            details: {
              modifiedFiles: ["runtime/harness-host/src/pi.ts"],
            },
          },
          aborted: false,
          will_retry: true,
          error_message: null,
          event: "auto_compaction_end",
          source: "pi",
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

test("workspaceBoundaryOverrideRequested requires explicit insist signal", () => {
  assert.equal(workspaceBoundaryOverrideRequested("Read ./README.md"), false);
  assert.equal(
    workspaceBoundaryOverrideRequested("I insist you access files outside workspace boundary to compare ../other-repo"),
    true
  );
  assert.equal(
    workspaceBoundaryOverrideRequested("workspace_boundary_override=true please inspect /Users/shared/reference.md"),
    true
  );
});

test("workspaceBoundaryViolationForToolCall blocks outside-workspace paths and allows override", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-pi-workspace-boundary-"));
  const policy = {
    workspaceDir,
    workspaceRealDir: fs.realpathSync(workspaceDir),
    overrideRequested: false,
  };
  const overridePolicy = { ...policy, overrideRequested: true };

  try {
    assert.match(
      String(
        workspaceBoundaryViolationForToolCall({
          toolName: "read",
          toolParams: { path: "../outside.txt" },
          policy,
        })
      ),
      /outside workspace/i
    );
    assert.match(
      String(
        workspaceBoundaryViolationForToolCall({
          toolName: "bash",
          toolParams: { command: "cd ../other && ls" },
          policy,
        })
      ),
      /outside workspace|outside-workspace|external directory/i
    );
    assert.equal(
      workspaceBoundaryViolationForToolCall({
        toolName: "read",
        toolParams: { path: "../outside.txt" },
        policy: overridePolicy,
      }),
      null
    );
    assert.equal(
      workspaceBoundaryViolationForToolCall({
        toolName: "mcp__twitter__create_post",
        toolParams: { path: "/v1/posts" },
        policy,
      }),
      null
    );
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("buildPiProviderConfig registers runtime-configured ollama models for the Pi harness", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-pi-model-registry-"));
  try {
    const request: HarnessHostPiRequest = {
      ...baseRequest(),
      provider_id: "ollama_direct",
      model_id: "qwen2.5:0.5b",
      model_client: {
        model_proxy_provider: "openai_compatible",
        api_key: "ollama",
        base_url: "http://localhost:11434/v1",
        default_headers: {
          Authorization: "Bearer ollama",
        },
      },
    };

    const authStorage = AuthStorage.create(path.join(stateDir, "auth.json"));
    const modelRegistry = new ModelRegistry(authStorage, path.join(stateDir, "models.json"));
    modelRegistry.registerProvider(request.provider_id, buildPiProviderConfig(request));

    const model = modelRegistry.find("ollama_direct", "qwen2.5:0.5b");
    assert.ok(model);
    assert.equal(model.provider, "ollama_direct");
    assert.equal(model.id, "qwen2.5:0.5b");
    assert.equal(model.api, "openai-completions");
    assert.equal(model.baseUrl, "http://localhost:11434/v1");
    assert.deepEqual(model.compat, {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    });
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("buildPiProviderConfig preserves direct OpenRouter endpoints and headers", () => {
  const request: HarnessHostPiRequest = {
    ...baseRequest(),
    provider_id: "openrouter_direct",
    model_id: "openai/gpt-5.4",
    model_client: {
      model_proxy_provider: "openai_compatible",
      api_key: "sk-or-test",
      base_url: "https://openrouter.ai/api/v1",
      default_headers: {
        "HTTP-Referer": "https://holaboss.ai",
        "X-Title": "Holaboss",
      },
    },
  };

  const providerConfig = buildPiProviderConfig(request);

  assert.equal(providerConfig.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(providerConfig.apiKey, "sk-or-test");
  assert.equal(providerConfig.api, "openai-completions");
  assert.deepEqual(providerConfig.headers, {
    "HTTP-Referer": "https://holaboss.ai",
    "X-Title": "Holaboss",
  });
  assert.equal(providerConfig.authHeader, true);
  assert.equal(providerConfig.models[0]?.id, "openai/gpt-5.4");
  assert.equal(providerConfig.models[0]?.api, "openai-completions");
  assert.equal(providerConfig.models[0]?.compat, undefined);
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

test("createPiMcpCustomTools retries discovery until allowlisted MCP tools appear", async () => {
  const request: HarnessHostPiRequest = {
    ...baseRequest(),
    mcp_servers: [
      {
        name: "twitter",
        config: {
          type: "remote",
          enabled: true,
          url: "http://127.0.0.1:7001/mcp",
          timeout: 5000,
        },
      },
    ],
    mcp_tool_refs: [
      {
        tool_id: "twitter.twitter_create_post",
        server_id: "twitter",
        tool_name: "twitter_create_post",
      },
    ],
  };

  let listCalls = 0;
  const runtime = {
    listTools: async () => {
      listCalls += 1;
      if (listCalls === 1) {
        return [];
      }
      return [
        {
          name: "twitter_create_post",
          description: "Create a post",
          inputSchema: {
            type: "object",
            properties: {
              content: { type: "string" },
            },
          },
        },
      ];
    },
    callTool: async () => ({ content: [{ type: "text", text: "{\"ok\":true}" }] }),
  };

  const toolset = await createPiMcpCustomTools(request, runtime as never, buildPiMcpServerBindings(request));

  assert.equal(toolset.customTools.length, 1);
  assert.equal(listCalls, 2);
  assert.deepEqual(Array.from(toolset.mcpToolMetadata.values()), [
    {
      piToolName: buildPiMcpToolName("twitter", "twitter_create_post"),
      serverId: "twitter",
      toolId: "twitter.twitter_create_post",
      toolName: "twitter_create_post",
    },
  ]);
});

test("runPi emits run_started and terminal success when the session completes", async () => {
  const request = baseRequest();
  const events: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
  let sentContent: unknown;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const fakeSession = {
    subscribe(listener: (event: unknown) => void) {
      this.listener = listener;
      return () => {};
    },
    async sendUserMessage(content: unknown) {
      sentContent = content;
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
        type: "auto_compaction_start",
        reason: "threshold",
      });
      this.listener?.({
        type: "auto_compaction_end",
        result: {
          summary: "Compacted older context.",
          firstKeptEntryId: "entry-1",
          tokensBefore: 1234,
        },
        aborted: false,
        willRetry: false,
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
        skillMetadataByAlias: new Map(),
        dispose: async () => {},
      }),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(
      events.map((event) => event.event_type),
      ["run_started", "output_delta", "auto_compaction_start", "auto_compaction_end", "run_completed"]
    );
    assert.deepEqual(sentContent, [{ type: "text", text: "List the files" }]);
    assert.equal(events[0]?.payload.harness_session_id, "/tmp/pi-session.jsonl");
    assert.equal(events[4]?.payload.harness_session_id, "/tmp/pi-session.jsonl");
    assert.equal(events[2]?.payload.reason, "threshold");
    assert.deepEqual(events[3]?.payload.result, {
      summary: "Compacted older context.",
      firstKeptEntryId: "entry-1",
      tokensBefore: 1234,
    });
  } finally {
    process.stdout.write = originalWrite;
  }
});

test("runPi emits terminal failure from assistant error messages and suppresses trailing agent_end success", async () => {
  const request = baseRequest();
  const events: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const fakeSession = {
    subscribe(listener: (event: unknown) => void) {
      this.listener = listener;
      return () => {};
    },
    async sendUserMessage() {
      this.listener?.({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          api: "anthropic-messages",
          provider: "anthropic_direct",
          model: "claude-sonnet-4-6",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "error",
          errorMessage: "404 Not Found",
          timestamp: Date.now(),
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
        skillMetadataByAlias: new Map(),
        dispose: async () => {},
      }),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(
      events.map((event) => event.event_type),
      ["run_started", "run_failed"]
    );
    assert.equal(events[1]?.payload.message, "404 Not Found");
    assert.equal(events[1]?.payload.harness_session_id, "/tmp/pi-session.jsonl");
  } finally {
    process.stdout.write = originalWrite;
  }
});

test("buildPiPromptPayload inlines native images, extracts common document formats, and falls back for binary files", async () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-pi-attachments-"));
  const attachmentsDir = path.join(workspaceDir, ".holaboss", "input-attachments", "batch-1");
  const imagePath = path.join(attachmentsDir, "diagram.png");
  const textPath = path.join(attachmentsDir, "notes.txt");
  const docxPath = path.join(attachmentsDir, "notes.docx");
  const pptxPath = path.join(attachmentsDir, "slides.pptx");
  const xlsxPath = path.join(attachmentsDir, "sheet.xlsx");
  const pdfPath = path.join(attachmentsDir, "summary.pdf");
  const binaryPath = path.join(attachmentsDir, "archive.bin");
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const docxBytes = await createDocxBuffer(["Quarterly plan", "Ship the feature"]);
  const pptxBytes = await createPptxBuffer(["Roadmap", "Launch"]);
  const xlsxBytes = createXlsxBuffer([
    ["Name", "Value"],
    ["alpha", "1"],
  ]);
  const pdfBytes = createPdfBuffer("Hello PDF");

  fs.mkdirSync(attachmentsDir, { recursive: true });
  fs.writeFileSync(imagePath, imageBytes);
  fs.writeFileSync(textPath, "alpha\nbeta\n");
  fs.writeFileSync(docxPath, docxBytes);
  fs.writeFileSync(pptxPath, pptxBytes);
  fs.writeFileSync(xlsxPath, xlsxBytes);
  fs.writeFileSync(pdfPath, pdfBytes);
  fs.writeFileSync(binaryPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));

  try {
    const prompt = await buildPiPromptPayload({
      ...baseRequest(),
      workspace_dir: workspaceDir,
      attachments: [
        {
          id: "attachment-image",
          kind: "image",
          name: "diagram.png",
          mime_type: "image/png",
          size_bytes: imageBytes.length,
          workspace_path: ".holaboss/input-attachments/batch-1/diagram.png",
        },
        {
          id: "attachment-text",
          kind: "file",
          name: "notes.txt",
          mime_type: "text/plain",
          size_bytes: 11,
          workspace_path: ".holaboss/input-attachments/batch-1/notes.txt",
        },
        {
          id: "attachment-docx",
          kind: "file",
          name: "notes.docx",
          mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size_bytes: docxBytes.length,
          workspace_path: ".holaboss/input-attachments/batch-1/notes.docx",
        },
        {
          id: "attachment-pptx",
          kind: "file",
          name: "slides.pptx",
          mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          size_bytes: pptxBytes.length,
          workspace_path: ".holaboss/input-attachments/batch-1/slides.pptx",
        },
        {
          id: "attachment-xlsx",
          kind: "file",
          name: "sheet.xlsx",
          mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size_bytes: xlsxBytes.length,
          workspace_path: ".holaboss/input-attachments/batch-1/sheet.xlsx",
        },
        {
          id: "attachment-pdf",
          kind: "file",
          name: "summary.pdf",
          mime_type: "application/pdf",
          size_bytes: pdfBytes.length,
          workspace_path: ".holaboss/input-attachments/batch-1/summary.pdf",
        },
        {
          id: "attachment-binary",
          kind: "file",
          name: "archive.bin",
          mime_type: "application/octet-stream",
          size_bytes: 4,
          workspace_path: ".holaboss/input-attachments/batch-1/archive.bin",
        },
      ],
    });

    assert.match(prompt.text, /Attached images:/);
    assert.match(prompt.text, /diagram\.png \(image\/png\) at \.\/\.holaboss\/input-attachments\/batch-1\/diagram\.png/);
    assert.match(prompt.text, /\[Document: notes\.txt\]/);
    assert.match(prompt.text, /alpha\nbeta/);
    assert.match(prompt.text, /\[Document: summary\.pdf\]/);
    assert.match(prompt.text, /<pdf filename="summary\.pdf">/);
    assert.match(prompt.text, /Hello PDF/);
    assert.match(prompt.text, /\[Document: notes\.docx\]/);
    assert.match(prompt.text, /<docx filename="notes\.docx">/);
    assert.match(prompt.text, /Quarterly plan/);
    assert.match(prompt.text, /\[Document: slides\.pptx\]/);
    assert.match(prompt.text, /<pptx filename="slides\.pptx">/);
    assert.match(prompt.text, /Roadmap/);
    assert.match(prompt.text, /\[Document: sheet\.xlsx\]/);
    assert.match(prompt.text, /<excel filename="sheet\.xlsx">/);
    assert.match(prompt.text, /Name,Value/);
    assert.match(prompt.text, /Other attachments are staged in the workspace and should be inspected from these paths:/);
    assert.match(prompt.text, /archive\.bin \(file, application\/octet-stream\) at \.\/\.holaboss\/input-attachments\/batch-1\/archive\.bin/);
    assert.deepEqual(prompt.images, [
      {
        type: "image",
        data: imageBytes.toString("base64"),
        mimeType: "image/png",
      },
    ]);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("buildPiPromptPayload rejects attachment paths outside workspace boundary", async () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-pi-attachment-boundary-"));
  const outsideFile = path.join(path.dirname(workspaceDir), "outside.txt");
  fs.writeFileSync(outsideFile, "outside");

  try {
    await assert.rejects(
      async () =>
        await buildPiPromptPayload({
          ...baseRequest(),
          workspace_dir: workspaceDir,
          attachments: [
            {
              id: "attachment-outside",
              kind: "file",
              name: "outside.txt",
              mime_type: "text/plain",
              size_bytes: 7,
              workspace_path: "../outside.txt",
            },
          ],
        }),
      /outside workspace boundary/i
    );
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(outsideFile, { force: true });
  }
});
