import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentCapabilityManifest } from "./agent-capability-registry.js";
import { composeBaseAgentPrompt } from "./agent-runtime-prompt.js";

test("composeBaseAgentPrompt returns ordered runtime prompt layers", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    defaultTools: ["read", "edit"],
    extraTools: [],
    workspaceSkillIds: ["skill-creator"],
    resolvedMcpToolRefs: [
      {
        tool_id: "workspace.lookup",
        server_id: "workspace",
        tool_name: "lookup",
      },
    ],
    toolServerIdMap: {
      workspace: "workspace__sandbox123",
    },
  });

  const prompt = composeBaseAgentPrompt("You are concise.", {
    defaultTools: ["read", "edit"],
    extraTools: [],
    workspaceSkillIds: ["skill-creator"],
    resolvedMcpToolRefs: [
      {
        tool_id: "workspace.lookup",
        server_id: "workspace",
        tool_name: "lookup",
      },
    ],
    sessionKind: "main",
    sessionMode: "code",
    harnessId: "pi",
    capabilityManifest,
  });

  assert.deepEqual(prompt.promptLayers.map((layer) => layer.id), [
    "runtime_core",
    "execution_policy",
    "session_policy",
    "capability_policy",
    "workspace_policy",
  ]);
  assert.deepEqual(prompt.promptSections.map((section) => section.id), [
    "runtime_core",
    "execution_policy",
    "session_policy",
    "capability_policy",
    "workspace_policy",
  ]);
  assert.deepEqual(prompt.promptSections.map((section) => section.channel), [
    "system_prompt",
    "system_prompt",
    "system_prompt",
    "system_prompt",
    "system_prompt",
  ]);
  assert.deepEqual(prompt.promptSections.map((section) => section.priority), [100, 200, 300, 400, 600]);
  assert.deepEqual(prompt.promptSections.map((section) => section.volatility), [
    "stable",
    "stable",
    "run",
    "run",
    "workspace",
  ]);
  assert.deepEqual(prompt.promptLayers.map((layer) => layer.apply_at), [
    "runtime_config",
    "runtime_config",
    "runtime_config",
    "runtime_config",
    "runtime_config",
  ]);
  assert.match(prompt.systemPrompt, /^Base runtime instructions:/);
  assert.match(prompt.systemPrompt, /Execution doctrine:/);
  assert.match(prompt.systemPrompt, /Session policy:/);
  assert.match(prompt.systemPrompt, /This is the main workspace session/i);
  assert.match(prompt.systemPrompt, /Capability policy for this run:/);
  assert.match(prompt.systemPrompt, /Workspace instructions from AGENTS\.md:/);
  assert.doesNotMatch(prompt.systemPrompt, /OpenCode MCP tool naming:/);
  assert.deepEqual(prompt.contextMessages, []);
  assert.deepEqual(prompt.promptCacheProfile.cacheable_section_ids, [
    "runtime_core",
    "execution_policy",
    "workspace_policy",
  ]);
  assert.deepEqual(prompt.promptCacheProfile.volatile_section_ids, [
    "session_policy",
    "capability_policy",
  ]);
  assert.match(prompt.promptCacheProfile.cacheable_fingerprint, /^[a-f0-9]{64}$/);
  assert.match(prompt.promptCacheProfile.full_system_prompt_fingerprint, /^[a-f0-9]{64}$/);
});

test("composeBaseAgentPrompt includes recent runtime context only when provided", () => {
  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    recentRuntimeContext: {
      summary: "Last run failed after editing config.",
      last_stop_reason: "runner_failed",
      last_error: "config parse error",
      waiting_for_user: true,
    },
  });

  assert.ok(prompt.promptSections.some((section) => section.id === "recent_runtime_context"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "recent_runtime_context")?.channel,
    "context_message"
  );
  assert.equal(prompt.promptLayers.some((layer) => layer.id === "recent_runtime_context"), false);
  assert.doesNotMatch(prompt.systemPrompt, /Recent runtime context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Recent runtime context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Last run failed after editing config\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Previous stop reason: runner_failed\./);
  assert.match(prompt.contextMessages.join("\n\n"), /waiting for user input/i);
  assert.match(prompt.contextMessages.join("\n\n"), /Previous runtime error: config parse error\./);
});

test("composeBaseAgentPrompt includes session resume context only when provided", () => {
  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    sessionResumeContext: {
      recent_turns: [
        {
          input_id: "input-1",
          status: "failed",
          stop_reason: "permission_denied",
          summary: "Deploy failed because policy denied the action.",
          completed_at: "2026-04-02T10:00:00.000Z",
        },
      ],
      recent_user_messages: [
        "Finish the deploy flow after fixing policy.",
      ],
    },
  });

  assert.ok(prompt.promptSections.some((section) => section.id === "resume_context"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "resume_context")?.channel,
    "context_message"
  );
  assert.equal(prompt.promptLayers.some((layer) => layer.id === "resume_context"), false);
  assert.doesNotMatch(prompt.systemPrompt, /Session resume context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Session resume context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /persisted turn results and selected prior session messages/i);
  assert.match(prompt.contextMessages.join("\n\n"), /Recent prior turns:/);
  assert.match(prompt.contextMessages.join("\n\n"), /input-1/);
  assert.match(prompt.contextMessages.join("\n\n"), /permission_denied/);
  assert.match(prompt.contextMessages.join("\n\n"), /Deploy failed because policy denied the action\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Recent prior user requests:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Finish the deploy flow after fixing policy\./);
});

test("composeBaseAgentPrompt includes recalled durable memory as context message", () => {
  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    recalledMemoryContext: {
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
        {
          scope: "workspace",
          memory_type: "blocker",
          title: "Deploy permission blocker",
          summary: "Deploy calls may be denied by workspace policy.",
          path: "workspace/workspace-1/knowledge/blockers/deploy.md",
          verification_policy: "check_before_use",
          staleness_policy: "workspace_sensitive",
          freshness_state: "fresh",
          freshness_note: "Verify this memory against the current workspace state before acting on it.",
        },
      ],
    },
  });

  assert.ok(prompt.promptSections.some((section) => section.id === "memory_recall"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "memory_recall")?.channel,
    "context_message"
  );
  assert.equal(prompt.promptLayers.some((layer) => layer.id === "memory_recall"), false);
  assert.doesNotMatch(prompt.systemPrompt, /Recalled durable memory:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Recalled durable memory:/);
  assert.match(prompt.contextMessages.join("\n\n"), /User response style/);
  assert.match(prompt.contextMessages.join("\n\n"), /Deploy permission blocker/);
  assert.match(prompt.contextMessages.join("\n\n"), /check_before_use/);
  assert.match(prompt.contextMessages.join("\n\n"), /Freshness: `stable` \(`stable`\)/);
  assert.match(prompt.contextMessages.join("\n\n"), /Freshness: `fresh` \(`workspace_sensitive`\)/);
});

test("composeBaseAgentPrompt includes cronjob delivery routing guidance when cronjob tools are available", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    defaultTools: ["read"],
    extraTools: ["holaboss_cronjobs_create"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "main",
    harnessId: "pi",
  });

  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: ["holaboss_cronjobs_create"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "main",
    sessionMode: "code",
    harnessId: "pi",
    capabilityManifest,
  });

  assert.match(prompt.systemPrompt, /Cronjob delivery routing:/);
  assert.match(prompt.systemPrompt, /use `session_run` for recurring agent work/i);
  assert.match(prompt.systemPrompt, /Use `system_notification` only for lightweight reminders or notifications/i);
});
