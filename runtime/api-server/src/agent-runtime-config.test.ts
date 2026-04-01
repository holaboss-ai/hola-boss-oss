import assert from "node:assert/strict";
import test from "node:test";

import { projectAgentRuntimeConfig } from "./agent-runtime-config.js";

function renderedRuntimeConfigPrompt(
  promptLayers: Array<{ apply_at: string; content: string }>
): string {
  return promptLayers
    .filter((layer) => layer.apply_at === "runtime_config")
    .map((layer) => layer.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

test("projectAgentRuntimeConfig returns ordered prompt layers and renders system prompt from runtime_config layers", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://runtime.example/api/v1/model-proxy";
  try {
    const result = projectAgentRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      session_kind: "task_proposal",
      harness_id: "pi",
      browser_tools_available: false,
      browser_tool_ids: [],
      runtime_tool_ids: [],
      workspace_command_ids: [],
      runtime_exec_model_proxy_api_key: "hbrt.v1.token",
      runtime_exec_sandbox_id: "sandbox-1",
      runtime_exec_run_id: "run-1",
      selected_model: null,
      default_provider_id: "openai",
      session_mode: "code",
      workspace_config_checksum: "checksum-1",
      workspace_skill_ids: ["skill-creator"],
      default_tools: ["read", "edit"],
      extra_tools: ["browser_get_state", "custom_tool"],
      resolved_mcp_tool_refs: [
        { tool_id: "workspace.lookup", server_id: "workspace", tool_name: "lookup" }
      ],
      resolved_output_schemas: {},
      agent: {
        id: "workspace.general",
        model: "gpt-5.2",
        prompt: "You are concise."
      }
    });

    assert.ok(result.prompt_layers);
    assert.deepEqual(
      result.prompt_layers?.map((layer) => layer.id),
      ["runtime_core", "execution_policy", "session_policy", "capability_policy", "workspace_policy"]
    );
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "harness_quirks"), false);
    assert.equal(result.system_prompt, renderedRuntimeConfigPrompt(result.prompt_layers ?? []));
    assert.match(result.system_prompt, /Session policy:/);
    assert.match(result.system_prompt, /task proposal session/i);
    assert.doesNotMatch(result.system_prompt, /OpenCode MCP tool naming:/);
    assert.doesNotMatch(result.system_prompt, /MCP callable tool names for this run:/);
    assert.match(result.system_prompt, /Connected MCP tools available now:/);
    assert.deepEqual(result.workspace_skill_ids, ["skill-creator"]);
    assert.equal(result.tools.browser_get_state, undefined);
    assert.equal(result.tools.skill, true);
    assert.equal(result.tools.workspace_lookup, true);
    assert.ok(result.capability_manifest);
    assert.deepEqual(result.capability_manifest?.context, {
      harness_id: "pi",
      session_kind: "task_proposal",
      browser_tools_available: false,
      browser_tool_ids: [],
      runtime_tool_ids: [],
      workspace_command_ids: [],
      workspace_commands_available: false,
      workspace_skills_available: true,
      mcp_tools_available: true,
    });
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});

test("projectAgentRuntimeConfig omits workspace and recent-runtime layers when not provided", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://runtime.example/api/v1/model-proxy";
  try {
    const result = projectAgentRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      session_kind: "main",
      harness_id: "pi",
      browser_tools_available: false,
      browser_tool_ids: [],
      runtime_tool_ids: [],
      workspace_command_ids: [],
      runtime_exec_model_proxy_api_key: "hbrt.v1.token",
      runtime_exec_sandbox_id: "sandbox-1",
      runtime_exec_run_id: null,
      selected_model: null,
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
        prompt: "   "
      }
    });

    assert.ok(result.prompt_layers);
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "workspace_policy"), false);
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "recent_runtime_context"), false);
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "harness_quirks"), false);
    assert.match(result.system_prompt, /This is the main workspace session/i);
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});
