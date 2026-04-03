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

function renderedPromptSections(
  promptSections: Array<{ channel: string; content: string }>
): string {
  return promptSections
    .filter((section) => section.channel === "system_prompt")
    .map((section) => section.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function promptChannelContents(
  promptSections: Array<{ channel: string; content: string }>
): Record<string, string[]> {
  return promptSections.reduce<Record<string, string[]>>((result, section) => {
    result[section.channel] ??= [];
    result[section.channel]?.push(section.content.trim());
    return result;
  }, {});
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
    assert.ok(result.prompt_sections);
    assert.deepEqual(
      result.prompt_layers?.map((layer) => layer.id),
      ["runtime_core", "execution_policy", "session_policy", "capability_policy", "workspace_policy"]
    );
    assert.deepEqual(
      result.prompt_sections?.map((section) => section.id),
      ["runtime_core", "execution_policy", "session_policy", "capability_policy", "workspace_policy"]
    );
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "harness_quirks"), false);
    assert.equal(result.system_prompt, renderedRuntimeConfigPrompt(result.prompt_layers ?? []));
    assert.equal(result.system_prompt, renderedPromptSections(result.prompt_sections ?? []));
    assert.deepEqual(result.context_messages, []);
    assert.deepEqual(result.prompt_channel_contents, promptChannelContents(result.prompt_sections ?? []));
    assert.ok(result.prompt_cache_profile);
    assert.deepEqual(result.prompt_cache_profile?.cacheable_section_ids, [
      "runtime_core",
      "execution_policy",
      "workspace_policy",
    ]);
    assert.deepEqual(result.prompt_cache_profile?.volatile_section_ids, [
      "session_policy",
      "capability_policy",
    ]);
    assert.deepEqual(result.prompt_cache_profile?.compatibility_context_ids, []);
    assert.deepEqual(result.prompt_cache_profile?.resume_context_ids, []);
    assert.deepEqual(result.prompt_cache_profile?.attachment_ids, []);
    assert.deepEqual(result.prompt_cache_profile?.delta_section_ids, []);
    assert.deepEqual(result.prompt_cache_profile?.channel_section_ids, {
      system_prompt: [
        "runtime_core",
        "execution_policy",
        "session_policy",
        "capability_policy",
        "workspace_policy",
      ],
    });
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
    assert.deepEqual(result.capability_manifest?.refresh_semantics, {
      evaluation_scope: "per_run",
      skills_resolved_at: "run_start",
      commands_resolved_at: "run_start",
      supports_live_deltas: false,
    });
    assert.deepEqual(
      result.capability_manifest?.reserved_surfaces.map((surface) => surface.kind),
      ["mcp_resource", "mcp_prompt", "mcp_command", "plugin_capability", "local_capability"]
    );
    assert.match(result.capability_manifest?.fingerprint ?? "", /^[a-f0-9]{64}$/);
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});

test("projectAgentRuntimeConfig includes resume context sections when provided", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://runtime.example/api/v1/model-proxy";
  try {
    const result = projectAgentRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      session_kind: "workspace_session",
      harness_id: "pi",
      browser_tools_available: false,
      browser_tool_ids: [],
      runtime_tool_ids: [],
      workspace_command_ids: [],
      runtime_exec_model_proxy_api_key: "hbrt.v1.token",
      runtime_exec_sandbox_id: "sandbox-1",
      runtime_exec_run_id: "run-1",
      recent_runtime_context: {
        summary: "Previous run stopped for confirmation.",
        last_stop_reason: "waiting_user",
        last_error: null,
        waiting_for_user: true,
      },
      session_resume_context: {
        recent_turns: [
          {
            input_id: "input-0",
            status: "waiting_user",
            stop_reason: "waiting_user",
            summary: "Run paused waiting for confirmation before deploy.",
            completed_at: "2026-04-02T10:00:00.000Z",
          },
        ],
        recent_user_messages: [
          "Continue after confirmation once deploy policy is updated.",
        ],
        compaction_boundary_id: "compaction:input-0",
        compaction_boundary_summary: "Run paused waiting for confirmation before deploy.",
        restoration_order: [
          "boundary_summary",
          "recent_runtime_context",
          "session_resume_context",
          "preserved_turn_input_ids",
          "restored_memory_paths",
        ],
        preserved_turn_input_ids: ["input-0"],
        restored_memory_paths: [
          "workspace/workspace-1/runtime/latest-turn.md",
        ],
      },
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
    });

    assert.ok(result.prompt_sections?.some((section) => section.id === "resume_context"));
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "resume_context"), false);
    assert.equal(result.prompt_sections?.find((section) => section.id === "resume_context")?.channel, "resume_context");
    assert.equal(result.prompt_sections?.find((section) => section.id === "recent_runtime_context")?.channel, "context_message");
    assert.deepEqual(result.prompt_cache_profile?.resume_context_ids, ["resume_context"]);
    assert.deepEqual(result.prompt_cache_profile?.compatibility_context_ids, [
      "recent_runtime_context",
      "resume_context",
    ]);
    assert.deepEqual(result.context_messages, [
      [
        "Recent runtime context:",
        "Previous run stopped for confirmation.",
        "Previous stop reason: waiting_user.",
        "The previous run paused waiting for user input. Do not treat that state as completed work.",
      ].join("\n"),
      [
        "Session resume context:",
        "Use this as continuity context derived from persisted turn results and selected prior session messages. Verify current workspace state before acting on details that may have changed.",
        "This resume context was restored from compaction boundary `compaction:input-0`.",
        "Boundary summary: Run paused waiting for confirmation before deploy.",
        "Restoration order: `boundary_summary` -> `recent_runtime_context` -> `session_resume_context` -> `preserved_turn_input_ids` -> `restored_memory_paths`.",
        "Preserved turn ids: `input-0`.",
        "Restored memory paths:",
        "- `workspace/workspace-1/runtime/latest-turn.md`",
        "Recent prior turns:",
        "- `input-0` (status=`waiting_user`, stop=`waiting_user`, completed=2026-04-02T10:00:00.000Z): Run paused waiting for confirmation before deploy.",
        "Recent prior user requests:",
        "- Continue after confirmation once deploy policy is updated.",
      ].join("\n"),
    ]);
    assert.deepEqual(result.prompt_channel_contents, promptChannelContents(result.prompt_sections ?? []));
    assert.doesNotMatch(result.system_prompt, /Session resume context:/);
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});

test("projectAgentRuntimeConfig includes current user context as a context message", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://runtime.example/api/v1/model-proxy";
  try {
    const result = projectAgentRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      session_kind: "workspace_session",
      harness_id: "pi",
      browser_tools_available: false,
      browser_tool_ids: [],
      runtime_tool_ids: [],
      workspace_command_ids: [],
      runtime_exec_model_proxy_api_key: "hbrt.v1.token",
      runtime_exec_sandbox_id: "sandbox-1",
      runtime_exec_run_id: "run-1",
      current_user_context: {
        profile_id: "default",
        name: "Jeffrey",
        name_source: "manual",
      },
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
    });

    assert.ok(result.prompt_sections?.some((section) => section.id === "current_user_context"));
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "current_user_context"), false);
    assert.equal(result.prompt_sections?.find((section) => section.id === "current_user_context")?.channel, "context_message");
    assert.deepEqual(result.prompt_cache_profile?.context_message_ids, ["current_user_context"]);
    assert.deepEqual(result.prompt_cache_profile?.compatibility_context_ids, ["current_user_context"]);
    assert.deepEqual(result.prompt_channel_contents, promptChannelContents(result.prompt_sections ?? []));
    assert.match(result.context_messages?.join("\n\n") ?? "", /Current user context:/);
    assert.match(result.context_messages?.join("\n\n") ?? "", /The current operator name is `Jeffrey`\./);
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});

test("projectAgentRuntimeConfig includes pending user memory context as a context message", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://runtime.example/api/v1/model-proxy";
  try {
    const result = projectAgentRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      session_kind: "workspace_session",
      harness_id: "pi",
      browser_tools_available: false,
      browser_tool_ids: [],
      runtime_tool_ids: [],
      workspace_command_ids: [],
      runtime_exec_model_proxy_api_key: "hbrt.v1.token",
      runtime_exec_sandbox_id: "sandbox-1",
      runtime_exec_run_id: "run-1",
      pending_user_memory_context: {
        entries: [
          {
            proposal_id: "proposal-1",
            proposal_kind: "preference",
            target_key: "file-delivery",
            title: "File delivery preference",
            summary: "Do not compress or zip multiple files; deliver them individually.",
            evidence: "Please do not zip the files. Send them individually.",
          },
        ],
      },
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
    });

    assert.ok(result.prompt_sections?.some((section) => section.id === "pending_user_memory"));
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "pending_user_memory"), false);
    assert.equal(result.prompt_sections?.find((section) => section.id === "pending_user_memory")?.channel, "context_message");
    assert.deepEqual(result.prompt_cache_profile?.context_message_ids, ["pending_user_memory"]);
    assert.deepEqual(result.prompt_cache_profile?.compatibility_context_ids, ["pending_user_memory"]);
    assert.match(result.context_messages?.join("\n\n") ?? "", /Current-turn inferred user memory:/);
    assert.match(result.context_messages?.join("\n\n") ?? "", /deliver them individually/);
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
    assert.ok(result.prompt_sections);
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "workspace_policy"), false);
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "recent_runtime_context"), false);
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "resume_context"), false);
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "harness_quirks"), false);
    assert.equal(result.prompt_sections?.some((section) => section.id === "workspace_policy"), false);
    assert.equal(result.prompt_sections?.some((section) => section.id === "recent_runtime_context"), false);
    assert.equal(result.prompt_sections?.some((section) => section.id === "resume_context"), false);
    assert.deepEqual(result.context_messages, []);
    assert.match(result.system_prompt, /This is the main workspace session/i);
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});

test("projectAgentRuntimeConfig includes recalled durable memory in context messages", () => {
  process.env.HOLABOSS_MODEL_PROXY_BASE_URL = "https://runtime.example/api/v1/model-proxy";
  try {
    const result = projectAgentRuntimeConfig({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      session_kind: "workspace_session",
      harness_id: "pi",
      browser_tools_available: false,
      browser_tool_ids: [],
      runtime_tool_ids: [],
      workspace_command_ids: [],
      runtime_exec_model_proxy_api_key: "hbrt.v1.token",
      runtime_exec_sandbox_id: "sandbox-1",
      runtime_exec_run_id: "run-1",
      recalled_memory_context: {
        entries: [
          {
            scope: "user",
            memory_type: "preference",
            title: "User response style",
            summary: "User prefers concise responses.",
            path: "preference/response-style.md",
            verification_policy: "none",
            staleness_policy: "stable",
            freshness_state: "stable",
            freshness_note: "This memory is treated as stable unless explicitly changed.",
          },
        ],
      },
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
    });

    assert.ok(result.prompt_sections?.some((section) => section.id === "memory_recall"));
    assert.equal(result.prompt_layers?.some((layer) => layer.id === "memory_recall"), false);
    assert.deepEqual(result.prompt_cache_profile?.context_message_ids, ["memory_recall"]);
    assert.deepEqual(result.prompt_cache_profile?.compatibility_context_ids, ["memory_recall"]);
    assert.deepEqual(result.prompt_channel_contents, promptChannelContents(result.prompt_sections ?? []));
    assert.match(result.context_messages?.join("\n\n") ?? "", /Recalled durable memory:/);
    assert.match(result.context_messages?.join("\n\n") ?? "", /User response style/);
    assert.match(result.context_messages?.join("\n\n") ?? "", /Freshness: `stable` \(`stable`\)/);
  } finally {
    delete process.env.HOLABOSS_MODEL_PROXY_BASE_URL;
  }
});
