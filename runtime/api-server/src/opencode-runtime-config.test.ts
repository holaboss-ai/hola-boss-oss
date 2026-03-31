import assert from "node:assert/strict";
import { test } from "node:test";

import { projectOpencodeRuntimeConfig, runOpencodeRuntimeConfigCli } from "./opencode-runtime-config.js";

test("projectOpencodeRuntimeConfig maps builtin tools, workspace tools, and skills for single mode", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://runtime.example/api/v1/model-proxy";
  try {
    const result = projectOpencodeRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      runtime_exec_model_proxy_api_key: "hbrt.v1.token",
      runtime_exec_sandbox_id: "sandbox-1",
      runtime_exec_run_id: "run-1",
      selected_model: null,
      default_provider_id: "openai",
      session_mode: "code",
      workspace_config_checksum: "checksum-1",
      workspace_skill_ids: ["skill-creator"],
      default_tools: ["read", "edit", "bash"],
      extra_tools: ["custom_tool"],
      resolved_mcp_tool_refs: [
        { tool_id: "workspace.read_file", server_id: "workspace", tool_name: "read_file" },
        { tool_id: "remote.lookup", server_id: "remote", tool_name: "lookup" }
      ],
      resolved_output_schemas: {
        "workspace.general": {
          type: "object",
          properties: {
            checks: { type: "array", items: { type: "string" } }
          }
        }
      },
      general_type: "single",
      single_agent: {
        id: "workspace.general",
        model: "gpt-5.2",
        prompt: "You are concise."
      },
      coordinator: null,
      members: []
    });

    assert.equal(result.provider_id, "hb_openai");
    assert.equal(result.model_id, "gpt-5.2");
    assert.match(result.system_prompt, /^You are concise\./);
    assert.match(result.system_prompt, /Tool execution guidance:/);
    assert.match(result.system_prompt, /use them instead of answering only with raw text/i);
    assert.match(result.system_prompt, /invoke it directly instead of describing what it would do or return/i);
    assert.match(result.system_prompt, /MCP tool naming:/);
    assert.match(result.system_prompt, /workspace\.read_file -> workspace_read_file/);
    assert.match(result.system_prompt, /remote\.lookup -> remote_lookup/);
    assert.equal(result.model_client.model_proxy_provider, "openai_compatible");
    assert.equal(result.model_client.api_key, "hbrt.v1.token");
    assert.equal(result.model_client.base_url, "https://runtime.example/api/v1/model-proxy/openai/v1");
    assert.equal(result.model_client.default_headers?.["X-Holaboss-Sandbox-Id"], "sandbox-1");
    assert.equal(result.model_client.default_headers?.["X-Holaboss-Run-Id"], "run-1");
    assert.deepEqual(result.workspace_tool_ids, ["workspace.read_file", "remote.lookup"]);
    assert.deepEqual(result.workspace_skill_ids, ["skill-creator"]);
    assert.equal(result.tools.read, true);
    assert.equal(result.tools.skill, true);
    assert.equal(result.tools.workspace_read_file, true);
    assert.equal(result.tools.remote_lookup, true);
    assert.equal(result.tools.custom_tool, true);
    assert.equal(result.output_schema_member_id, "workspace.general");
    assert.equal(result.output_format?.type, "json_schema");
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});

test("projectOpencodeRuntimeConfig composes team prompt and resolves anthropic provider", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://runtime.example/api/v1/model-proxy";
  try {
    const result = projectOpencodeRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      runtime_exec_model_proxy_api_key: "hbrt.v1.token",
      runtime_exec_sandbox_id: "sandbox-1",
      runtime_exec_run_id: null,
      selected_model: "claude-sonnet-4-5",
      default_provider_id: "openai",
      session_mode: "code",
      workspace_config_checksum: "checksum-2",
      workspace_skill_ids: [],
      default_tools: ["read"],
      extra_tools: [],
      resolved_mcp_tool_refs: [],
      resolved_output_schemas: {},
      general_type: "team",
      single_agent: null,
      coordinator: {
        id: "workspace.coordinator",
        model: "gpt-5.2",
        prompt: "Coordinate the workspace."
      },
      members: [
        { id: "writer", model: "gpt-5.2-mini", prompt: "Write copy.", role: "writer" },
        { id: "reviewer", model: "gpt-5.2-mini", prompt: "Review output.", role: "reviewer" }
      ]
    });

    assert.equal(result.provider_id, "hb_anthropic");
    assert.equal(result.model_id, "claude-sonnet-4-5");
    assert.equal(result.model_client.model_proxy_provider, "anthropic_native");
    assert.equal(result.model_client.base_url, "https://runtime.example/api/v1/model-proxy/anthropic/v1");
    assert.match(result.system_prompt, /Tool execution guidance:/);
    assert.match(result.system_prompt, /Coordinator instructions:/);
    assert.match(result.system_prompt, /Member guidance:/);
    assert.match(result.system_prompt, /writer \(writer\):/);
    assert.match(result.system_prompt, /reviewer \(reviewer\):/);
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});

test("projectOpencodeRuntimeConfig rejects unsupported team output schemas", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://runtime.example/api/v1/model-proxy";
  try {
    assert.throws(
      () =>
        projectOpencodeRuntimeConfig({
          session_id: "session-1",
          workspace_id: "workspace-1",
          input_id: "input-1",
          runtime_exec_model_proxy_api_key: "hbrt.v1.token",
          runtime_exec_sandbox_id: "sandbox-1",
          runtime_exec_run_id: null,
          selected_model: null,
          default_provider_id: "openai",
          session_mode: "code",
          workspace_config_checksum: "checksum-3",
          workspace_skill_ids: [],
          default_tools: ["read"],
          extra_tools: [],
          resolved_mcp_tool_refs: [],
          resolved_output_schemas: {
            writer: { type: "object" }
          },
          general_type: "team",
          single_agent: null,
          coordinator: {
            id: "workspace.coordinator",
            model: "gpt-5.2",
            prompt: "Coordinate the workspace."
          },
          members: [{ id: "writer", model: "gpt-5.2-mini", prompt: "Write copy.", role: "writer" }]
        }),
      /unsupported schema members: writer/
    );
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});

test("projectOpencodeRuntimeConfig uses direct OpenAI fallback when enabled", () => {
  process.env.SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK = "1";
  process.env.OPENAI_API_KEY = "sk-openai";
  try {
    const result = projectOpencodeRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      runtime_exec_model_proxy_api_key: null,
      runtime_exec_sandbox_id: null,
      runtime_exec_run_id: null,
      selected_model: "gpt-5.2",
      default_provider_id: "openai",
      session_mode: "code",
      workspace_config_checksum: "checksum-4",
      workspace_skill_ids: [],
      default_tools: ["read"],
      extra_tools: [],
      resolved_mcp_tool_refs: [],
      resolved_output_schemas: {},
      general_type: "single",
      single_agent: {
        id: "workspace.general",
        model: "gpt-5.2",
        prompt: "You are concise."
      },
      coordinator: null,
      members: []
    });

    assert.equal(result.provider_id, "hb_openai");
    assert.equal(result.model_client.model_proxy_provider, "openai_compatible");
    assert.equal(result.model_client.api_key, "sk-openai");
    assert.equal(result.model_client.base_url ?? null, null);
    assert.equal(result.model_client.default_headers ?? null, null);
  } finally {
    delete process.env.SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK;
    delete process.env.OPENAI_API_KEY;
  }
});

test("runOpencodeRuntimeConfigCli writes JSON response for a valid request", async () => {
  const request = {
    session_id: "session-1",
    workspace_id: "workspace-1",
    input_id: "input-1",
    runtime_exec_model_proxy_api_key: "hbrt.v1.token",
    runtime_exec_sandbox_id: "sandbox-1",
    runtime_exec_run_id: null,
    selected_model: null,
    default_provider_id: "openai",
    session_mode: "code",
    workspace_config_checksum: "checksum-1",
    workspace_skill_ids: [],
    default_tools: ["read"],
    extra_tools: [],
    resolved_mcp_tool_refs: [],
    resolved_output_schemas: {},
    general_type: "single",
    single_agent: {
      id: "workspace.general",
      model: "gpt-5.2",
      prompt: "You are concise."
    },
    coordinator: null,
    members: []
  };
  let stdout = "";
  let stderr = "";
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://runtime.example/api/v1/model-proxy";

  try {
    const exitCode = await runOpencodeRuntimeConfigCli(
      ["--request-base64", Buffer.from(JSON.stringify(request), "utf8").toString("base64")],
      {
        io: {
          stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
          stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
        }
      }
    );

    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    assert.equal(JSON.parse(stdout).model_id, "gpt-5.2");
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});
