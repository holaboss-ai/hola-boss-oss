import assert from "node:assert/strict";
import test from "node:test";

import { piHarnessDefinition } from "./pi.js";

test("pi harness enables browser tools only for workspace sessions", () => {
  const buildHarnessHostRequest = piHarnessDefinition.runtimeAdapter.buildHarnessHostRequest;
  const baseParams = {
    request: {
      workspace_id: "workspace-1",
      session_id: "session-1",
      input_id: "input-1",
      instruction: "Inspect the project",
      debug: false,
    },
    bootstrap: {
      workspaceRoot: "/tmp",
      workspaceDir: "/tmp/workspace-1",
      requestedHarnessSessionId: null,
      persistedHarnessSessionId: null,
    },
    runtimeConfig: {
      provider_id: "openai",
      model_id: "gpt-5.4",
      mode: "code",
      system_prompt: "You are concise.",
      workspace_config_checksum: "checksum-1",
      context_messages: [],
      model_client: {
        model_proxy_provider: "openai_compatible",
        api_key: "token",
        base_url: "http://127.0.0.1:4000/openai/v1",
        default_headers: { "X-Test": "1" },
      },
      tools: { read: true },
      workspace_tool_ids: [],
      workspace_skill_ids: [],
    },
    runtimeApiBaseUrl: "http://127.0.0.1:5060",
    workspaceSkills: [],
    mcpServers: [],
    mcpToolRefs: [],
    runStartedPayload: {},
    backendBaseUrl: "",
    timeoutSeconds: 60,
  };

  const workspaceRequest = buildHarnessHostRequest({
    ...baseParams,
    browserSpace: "user",
    request: {
      ...baseParams.request,
      session_kind: "workspace_session",
    },
  });
  const onboardingRequest = buildHarnessHostRequest({
    ...baseParams,
    request: {
      ...baseParams.request,
      session_kind: "onboarding",
    },
  });

  assert.equal(workspaceRequest.browser_tools_enabled, true);
  assert.equal(workspaceRequest.browser_space, "user");
  assert.equal(onboardingRequest.browser_tools_enabled, false);
  assert.equal(onboardingRequest.browser_space, null);
  assert.deepEqual(workspaceRequest.quoted_skill_blocks, []);
  assert.deepEqual(workspaceRequest.missing_quoted_skill_ids, []);
  assert.deepEqual(workspaceRequest.context_messages, []);
  assert.deepEqual(onboardingRequest.context_messages, []);
  assert.deepEqual(workspaceRequest.workspace_skills, []);
  assert.deepEqual(onboardingRequest.workspace_skills, []);
});

test("pi harness request forwards prepared quoted skill payloads", () => {
  const buildHarnessHostRequest = piHarnessDefinition.runtimeAdapter.buildHarnessHostRequest;
  const baseParams = {
    request: {
      workspace_id: "workspace-1",
      session_id: "session-1",
      input_id: "input-1",
      instruction: "Inspect the project",
      debug: false,
    },
    bootstrap: {
      workspaceRoot: "/tmp",
      workspaceDir: "/tmp/workspace-1",
      requestedHarnessSessionId: null,
      persistedHarnessSessionId: null,
    },
    runtimeConfig: {
      provider_id: "openai",
      model_id: "gpt-5.4",
      mode: "code",
      system_prompt: "You are concise.",
      workspace_config_checksum: "checksum-1",
      context_messages: [],
      model_client: {
        model_proxy_provider: "openai_compatible",
        api_key: "token",
        base_url: "http://127.0.0.1:4000/openai/v1",
        default_headers: { "X-Test": "1" },
      },
      tools: { read: true },
      workspace_tool_ids: [],
      workspace_skill_ids: [],
    },
    runtimeApiBaseUrl: "http://127.0.0.1:5060",
    workspaceSkills: [],
    mcpServers: [],
    mcpToolRefs: [],
    runStartedPayload: {},
    backendBaseUrl: "",
    timeoutSeconds: 60,
  };
  const request = buildHarnessHostRequest({
    ...baseParams,
    prepared_instruction: {
      body: "Draft the follow-up email.",
      quoted_skill_blocks: ['<skill name="customer_lookup" location="/tmp/workspace-1/skills/customer_lookup/SKILL.md">\nBody\n</skill>'],
      missing_quoted_skill_ids: ["missing-skill"],
    },
  });

  assert.equal(request.instruction, "Draft the follow-up email.");
  assert.deepEqual(request.quoted_skill_blocks, [
    '<skill name="customer_lookup" location="/tmp/workspace-1/skills/customer_lookup/SKILL.md">\nBody\n</skill>',
  ]);
  assert.deepEqual(request.missing_quoted_skill_ids, ["missing-skill"]);
});

test("pi harness request forwards resolved workspace skill metadata", () => {
  const buildHarnessHostRequest = piHarnessDefinition.runtimeAdapter.buildHarnessHostRequest;
  const request = buildHarnessHostRequest({
    request: {
      workspace_id: "workspace-1",
      session_id: "session-1",
      input_id: "input-1",
      instruction: "Inspect the project",
      debug: false,
    },
    bootstrap: {
      workspaceRoot: "/tmp",
      workspaceDir: "/tmp/workspace-1",
      requestedHarnessSessionId: null,
      persistedHarnessSessionId: null,
    },
    runtimeConfig: {
      provider_id: "openai",
      model_id: "gpt-5.4",
      mode: "code",
      system_prompt: "You are concise.",
      workspace_config_checksum: "checksum-1",
      context_messages: [],
      model_client: {
        model_proxy_provider: "openai_compatible",
        api_key: "token",
        base_url: "http://127.0.0.1:4000/openai/v1",
        default_headers: { "X-Test": "1" },
      },
      tools: { read: true, skill: true },
      workspace_tool_ids: [],
      workspace_skill_ids: ["customer_lookup"],
    },
    runtimeApiBaseUrl: "http://127.0.0.1:5060",
    workspaceSkills: [
      {
        skill_id: "customer_lookup",
        skill_name: "customer_lookup",
        source_dir: "/tmp/workspace-1/skills/customer_lookup",
        file_path: "/tmp/workspace-1/skills/customer_lookup/SKILL.md",
        origin: "workspace",
        granted_tools: ["bash"],
        granted_commands: ["deploy-docs"],
      },
    ],
    mcpServers: [],
    mcpToolRefs: [],
    runStartedPayload: {},
    backendBaseUrl: "",
    timeoutSeconds: 60,
  });

  assert.deepEqual(request.workspace_skills, [
    {
      skill_id: "customer_lookup",
      skill_name: "customer_lookup",
      source_dir: "/tmp/workspace-1/skills/customer_lookup",
      file_path: "/tmp/workspace-1/skills/customer_lookup/SKILL.md",
      origin: "workspace",
      granted_tools: ["bash"],
      granted_commands: ["deploy-docs"],
    },
  ]);
});
