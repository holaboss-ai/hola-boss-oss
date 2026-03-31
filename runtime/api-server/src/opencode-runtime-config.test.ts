import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
      agent: {
        id: "workspace.general",
        model: "gpt-5.2",
        prompt: "You are concise."
      }
    });

    assert.equal(result.provider_id, "hb_openai");
    assert.equal(result.model_id, "gpt-5.2");
    assert.match(result.system_prompt, /^Base runtime instructions:/);
    assert.match(result.system_prompt, /MUST ALWAYS BE FOLLOWED NO MATTER WHAT/);
    assert.match(result.system_prompt, /Tool and verification guidance:/);
    assert.match(result.system_prompt, /workspace skills, and connected MCP tools/i);
    assert.match(result.system_prompt, /consult them instead of improvising from scratch/i);
    assert.match(result.system_prompt, /call it directly instead of only describing what it would do/i);
    assert.match(result.system_prompt, /Workspace instructions from AGENTS\.md:/);
    assert.match(result.system_prompt, /Treat these workspace instructions as additional requirements/i);
    assert.match(result.system_prompt, /You are concise\./);
    assert.doesNotMatch(result.system_prompt, /OpenCode MCP tool naming:/);
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

test("projectOpencodeRuntimeConfig resolves anthropic provider for a single agent", () => {
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
      agent: {
        id: "workspace.general",
        model: "gpt-5.2",
        prompt: "You are concise."
      }
    });

    assert.equal(result.provider_id, "hb_anthropic");
    assert.equal(result.model_id, "claude-sonnet-4-5");
    assert.equal(result.model_client.model_proxy_provider, "anthropic_native");
    assert.equal(result.model_client.base_url, "https://runtime.example/api/v1/model-proxy/anthropic/v1");
    assert.match(result.system_prompt, /^Base runtime instructions:/);
    assert.match(result.system_prompt, /Tool and verification guidance:/);
    assert.match(result.system_prompt, /Respond without tool calls only when the request is purely conversational or explanatory/i);
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});

test("projectOpencodeRuntimeConfig emits the mandatory base prompt even without AGENTS.md content", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://runtime.example/api/v1/model-proxy";
  try {
    const result = projectOpencodeRuntimeConfig({
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
      default_tools: [],
      extra_tools: [],
      resolved_mcp_tool_refs: [],
      resolved_output_schemas: {},
      agent: {
        id: "workspace.general",
        model: "gpt-5.2",
        prompt: "   "
      }
    });

    assert.match(result.system_prompt, /^Base runtime instructions:/);
    assert.match(result.system_prompt, /MUST ALWAYS BE FOLLOWED NO MATTER WHAT/);
    assert.doesNotMatch(result.system_prompt, /Workspace instructions from AGENTS\.md:/);
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
      agent: {
        id: "workspace.general",
        model: "gpt-5.2",
        prompt: "You are concise."
      }
    });

    assert.equal(result.provider_id, "hb_openai");
    assert.equal(result.model_client.model_proxy_provider, "openai_compatible");
    assert.equal(result.model_client.api_key, "sk-openai");
    assert.equal(result.model_client.base_url, "https://api.openai.com/v1");
    assert.equal(result.model_client.default_headers ?? null, null);
  } finally {
    delete process.env.SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK;
    delete process.env.OPENAI_API_KEY;
  }
});

test("projectOpencodeRuntimeConfig supports direct OpenAI config from runtime settings", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://api.openai.com/v1";
  process.env.HOLABOSS_SANDBOX_AUTH_TOKEN = "sk-configured";
  try {
    const result = projectOpencodeRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      runtime_exec_model_proxy_api_key: null,
      runtime_exec_sandbox_id: null,
      runtime_exec_run_id: null,
      selected_model: "openai/gpt-5.2",
      default_provider_id: "openai",
      session_mode: "code",
      workspace_config_checksum: "checksum-5",
      workspace_skill_ids: [],
      default_tools: ["read"],
      extra_tools: [],
      resolved_mcp_tool_refs: [],
      resolved_output_schemas: {},
      agent: {
        id: "workspace.general",
        model: "gpt-5.2",
        prompt: "You are concise."
      }
    });

    assert.equal(result.provider_id, "hb_openai");
    assert.equal(result.model_client.model_proxy_provider, "openai_compatible");
    assert.equal(result.model_client.api_key, "sk-configured");
    assert.equal(result.model_client.base_url, "https://api.openai.com/v1");
    assert.equal(result.model_client.default_headers ?? null, null);
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
    delete process.env.HOLABOSS_SANDBOX_AUTH_TOKEN;
  }
});

test("projectOpencodeRuntimeConfig treats non-provider roots as proxy roots", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://proxy.example/custom-root";
  process.env.HOLABOSS_SANDBOX_AUTH_TOKEN = "proxy-token";
  try {
    const result = projectOpencodeRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      runtime_exec_model_proxy_api_key: null,
      runtime_exec_sandbox_id: null,
      runtime_exec_run_id: null,
      selected_model: "openai/gpt-5.2",
      default_provider_id: "openai",
      session_mode: "code",
      workspace_config_checksum: "checksum-6",
      workspace_skill_ids: [],
      default_tools: ["read"],
      extra_tools: [],
      resolved_mcp_tool_refs: [],
      resolved_output_schemas: {},
      agent: {
        id: "workspace.general",
        model: "gpt-5.2",
        prompt: "You are concise."
      }
    });

    assert.equal(result.provider_id, "hb_openai");
    assert.equal(result.model_client.model_proxy_provider, "openai_compatible");
    assert.equal(result.model_client.api_key, "proxy-token");
    assert.equal(result.model_client.base_url, "https://proxy.example/custom-root/openai/v1");
    assert.equal(result.model_client.default_headers ?? null, null);
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
    delete process.env.HOLABOSS_SANDBOX_AUTH_TOKEN;
  }
});

test("projectOpencodeRuntimeConfig accepts direct OpenAI host without explicit /v1", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://api.openai.com";
  process.env.HOLABOSS_SANDBOX_AUTH_TOKEN = "sk-configured";
  try {
    const result = projectOpencodeRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      runtime_exec_model_proxy_api_key: null,
      runtime_exec_sandbox_id: null,
      runtime_exec_run_id: null,
      selected_model: "openai/gpt-5.2",
      default_provider_id: "openai",
      session_mode: "code",
      workspace_config_checksum: "checksum-7",
      workspace_skill_ids: [],
      default_tools: ["read"],
      extra_tools: [],
      resolved_mcp_tool_refs: [],
      resolved_output_schemas: {},
      agent: {
        id: "workspace.general",
        model: "gpt-5.2",
        prompt: "You are concise."
      }
    });

    assert.equal(result.provider_id, "hb_openai");
    assert.equal(result.model_client.model_proxy_provider, "openai_compatible");
    assert.equal(result.model_client.api_key, "sk-configured");
    assert.equal(result.model_client.base_url, "https://api.openai.com/v1");
    assert.equal(result.model_client.default_headers ?? null, null);
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
    delete process.env.HOLABOSS_SANDBOX_AUTH_TOKEN;
  }
});

test("projectOpencodeRuntimeConfig resolves configured holaboss, openai-compatible, anthropic-compatible, and openrouter providers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-runtime-config-"));
  const configPath = path.join(tempRoot, "runtime-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        runtime: {
          default_provider: "holaboss",
          default_model: "holaboss/gpt-5.2"
        },
        providers: {
          holaboss: {
            kind: "holaboss_proxy",
            base_url: "https://proxy.example/api/v1/model-proxy",
            api_key: "proxy-token"
          },
          openai_direct: {
            kind: "openai_compatible",
            base_url: "https://api.openai.com",
            api_key: "sk-openai-direct"
          },
          anthropic_direct: {
            kind: "anthropic_native",
            base_url: "https://api.anthropic.com",
            api_key: "sk-ant-direct"
          },
          openrouter_proxy: {
            kind: "openrouter",
            base_url: "https://openrouter.ai/api/v1",
            api_key: "sk-openrouter-direct"
          }
        },
        models: {
          "holaboss/gpt-5.2": { provider: "holaboss", model: "gpt-5.2" },
          "openai_direct/gpt-5.2": { provider: "openai_direct", model: "gpt-5.2" },
          "anthropic_direct/claude-sonnet-4-5": { provider: "anthropic_direct", model: "claude-sonnet-4-5" },
          "openrouter_proxy/deepseek/deepseek-chat-v3-0324": {
            provider: "openrouter_proxy",
            model: "deepseek/deepseek-chat-v3-0324"
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = configPath;
  try {
    const baseRequest = {
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      runtime_exec_model_proxy_api_key: null,
      runtime_exec_sandbox_id: null,
      runtime_exec_run_id: null,
      default_provider_id: "holaboss",
      session_mode: "code",
      workspace_config_checksum: "checksum-configured",
      workspace_skill_ids: [],
      default_tools: ["read"],
      extra_tools: [],
      resolved_mcp_tool_refs: [],
      resolved_output_schemas: {},
      agent: {
        id: "workspace.general",
        model: "holaboss/gpt-5.2",
        prompt: "You are concise."
      }
    };

    const holabossResult = projectOpencodeRuntimeConfig({
      ...baseRequest,
      selected_model: "holaboss/claude-sonnet-4-5"
    });
    assert.equal(holabossResult.provider_id, "hb_anthropic");
    assert.equal(holabossResult.model_id, "claude-sonnet-4-5");
    assert.equal(holabossResult.model_client.model_proxy_provider, "anthropic_native");
    assert.equal(holabossResult.model_client.api_key, "proxy-token");
    assert.equal(holabossResult.model_client.base_url, "https://proxy.example/api/v1/model-proxy/anthropic/v1");

    const openaiResult = projectOpencodeRuntimeConfig({
      ...baseRequest,
      selected_model: "openai_direct/gpt-5.2"
    });
    assert.equal(openaiResult.provider_id, "openai_direct");
    assert.equal(openaiResult.model_id, "gpt-5.2");
    assert.equal(openaiResult.model_client.model_proxy_provider, "openai_compatible");
    assert.equal(openaiResult.model_client.api_key, "sk-openai-direct");
    assert.equal(openaiResult.model_client.base_url, "https://api.openai.com/v1");

    const anthropicResult = projectOpencodeRuntimeConfig({
      ...baseRequest,
      selected_model: "anthropic_direct/claude-sonnet-4-5"
    });
    assert.equal(anthropicResult.provider_id, "anthropic_direct");
    assert.equal(anthropicResult.model_id, "claude-sonnet-4-5");
    assert.equal(anthropicResult.model_client.model_proxy_provider, "anthropic_native");
    assert.equal(anthropicResult.model_client.api_key, "sk-ant-direct");
    assert.equal(anthropicResult.model_client.base_url, "https://api.anthropic.com/v1");

    const openrouterResult = projectOpencodeRuntimeConfig({
      ...baseRequest,
      selected_model: "openrouter_proxy/deepseek/deepseek-chat-v3-0324"
    });
    assert.equal(openrouterResult.provider_id, "openrouter_proxy");
    assert.equal(openrouterResult.model_id, "deepseek/deepseek-chat-v3-0324");
    assert.equal(openrouterResult.model_client.model_proxy_provider, "openai_compatible");
    assert.equal(openrouterResult.model_client.api_key, "sk-openrouter-direct");
    assert.equal(openrouterResult.model_client.base_url, "https://openrouter.ai/api/v1");
  } finally {
    delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
    fs.rmSync(tempRoot, { recursive: true, force: true });
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
    agent: {
      id: "workspace.general",
      model: "gpt-5.2",
      prompt: "You are concise."
    }
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
