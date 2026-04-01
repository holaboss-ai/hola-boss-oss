import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentCapabilityManifest,
  buildEnabledToolMapFromManifest,
  renderCapabilityPolicyPromptSection,
} from "./agent-capability-registry.js";

test("buildAgentCapabilityManifest classifies tools, skills, and MCP aliases", () => {
  const manifest = buildAgentCapabilityManifest({
    harnessId: "pi",
    sessionKind: "main",
    browserToolsAvailable: true,
    browserToolIds: ["browser_get_state"],
    runtimeToolIds: ["holaboss_onboarding_complete"],
    workspaceCommandIds: ["hello"],
    defaultTools: ["read", "edit", "question"],
    extraTools: ["browser_get_state", "holaboss_onboarding_complete"],
    workspaceSkillIds: ["skill-creator"],
    resolvedMcpToolRefs: [
      {
        tool_id: "workspace.lookup",
        server_id: "workspace",
        tool_name: "lookup",
      },
    ],
  });

  assert.deepEqual(manifest.context, {
    harness_id: "pi",
    session_kind: "main",
    browser_tools_available: true,
    browser_tool_ids: ["browser_get_state"],
    runtime_tool_ids: ["holaboss_onboarding_complete"],
    workspace_command_ids: ["hello"],
    workspace_commands_available: true,
    workspace_skills_available: true,
    mcp_tools_available: true,
  });
  assert.deepEqual(manifest.workspace_commands, ["hello"]);
  assert.deepEqual(manifest.workspace_skills, ["skill-creator"]);
  assert.deepEqual(manifest.browser_tools.map((capability) => capability.callable_name), ["browser_get_state"]);
  assert.deepEqual(
    manifest.runtime_tools.map((capability) => capability.callable_name),
    ["holaboss_onboarding_complete"]
  );
  assert.ok(manifest.inspect.some((capability) => capability.callable_name === "read"));
  assert.ok(manifest.inspect.some((capability) => capability.callable_name === "browser_get_state"));
  assert.ok(manifest.inspect.some((capability) => capability.callable_name === "workspace_lookup"));
  assert.ok(manifest.mutate.some((capability) => capability.callable_name === "edit"));
  assert.ok(
    manifest.mutate.some((capability) => capability.callable_name === "holaboss_onboarding_complete")
  );
  assert.ok(manifest.coordinate.some((capability) => capability.callable_name === "question"));
  assert.ok(manifest.coordinate.some((capability) => capability.callable_name === "skill"));
  assert.ok(manifest.capabilities.some((capability) => capability.kind === "skill" && capability.id === "skill-creator"));

  const toolMap = buildEnabledToolMapFromManifest(manifest);
  assert.equal(toolMap.read, true);
  assert.equal(toolMap.edit, true);
  assert.equal(toolMap.question, true);
  assert.equal(toolMap.browser_get_state, true);
  assert.equal(toolMap.workspace_lookup, true);
  assert.equal(toolMap.skill, true);
});

test("buildAgentCapabilityManifest applies tool server id mappings to MCP callable names", () => {
  const manifest = buildAgentCapabilityManifest({
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
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

  assert.deepEqual(manifest.mcp_tool_aliases, [
    {
      tool_id: "workspace.lookup",
      server_id: "workspace__sandbox123",
      tool_name: "lookup",
      callable_name: "workspace__sandbox123_lookup",
    },
  ]);
  assert.equal(buildEnabledToolMapFromManifest(manifest).workspace__sandbox123_lookup, true);
});

test("buildAgentCapabilityManifest filters browser tools when policy context does not allow them", () => {
  const manifest = buildAgentCapabilityManifest({
    harnessId: "pi",
    sessionKind: "task_proposal",
    browserToolsAvailable: false,
    browserToolIds: [],
    runtimeToolIds: ["holaboss_onboarding_complete"],
    defaultTools: ["read"],
    extraTools: ["browser_get_state", "holaboss_onboarding_complete"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
  });

  assert.deepEqual(manifest.context, {
    harness_id: "pi",
    session_kind: "task_proposal",
    browser_tools_available: false,
    browser_tool_ids: [],
    runtime_tool_ids: ["holaboss_onboarding_complete"],
    workspace_command_ids: [],
    workspace_commands_available: false,
    workspace_skills_available: false,
    mcp_tools_available: false,
  });
  assert.equal(manifest.inspect.some((capability) => capability.callable_name === "browser_get_state"), false);
  assert.equal(manifest.mutate.some((capability) => capability.callable_name === "holaboss_onboarding_complete"), true);
  assert.equal(buildEnabledToolMapFromManifest(manifest).browser_get_state, undefined);
});

test("renderCapabilityPolicyPromptSection summarizes grouped capabilities", () => {
  const manifest = buildAgentCapabilityManifest({
    harnessId: "pi",
    sessionKind: "main",
    browserToolsAvailable: false,
    runtimeToolIds: ["holaboss_onboarding_complete"],
    workspaceCommandIds: ["hello"],
    defaultTools: ["read", "edit", "question"],
    extraTools: ["browser_get_state", "holaboss_onboarding_complete"],
    workspaceSkillIds: ["skill-creator"],
    resolvedMcpToolRefs: [
      {
        tool_id: "workspace.lookup",
        server_id: "workspace",
        tool_name: "lookup",
      },
    ],
  });

  const section = renderCapabilityPolicyPromptSection(manifest);
  assert.match(section, /Capability policy for this run:/);
  assert.match(section, /Harness for this run: pi\./);
  assert.match(section, /Session kind for this run: main\./);
  assert.match(section, /Inspect capabilities available now:/);
  assert.match(section, /Mutating capabilities available now:/);
  assert.match(section, /Coordination capabilities available now:/);
  assert.match(section, /Runtime capabilities available now:/);
  assert.match(section, /Workspace commands available now: hello/);
  assert.match(section, /Workspace skills available now: skill-creator/);
  assert.match(section, /Browser tools are not available in this run\./);
  assert.match(section, /Connected MCP tools available now:/);
  assert.doesNotMatch(section, /MCP callable tool names for this run:/);
});
