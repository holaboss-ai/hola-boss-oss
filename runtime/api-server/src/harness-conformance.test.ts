import assert from "node:assert/strict";
import test from "node:test";

import { HARNESS_DEFINITIONS } from "../../harnesses/src/index.js";

function baseBuildParams() {
  return {
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
      requestedHarnessSessionId: "requested-session-1",
      persistedHarnessSessionId: "persisted-session-1",
    },
    runtimeConfig: {
      provider_id: "hb_openai",
      model_id: "gpt-5.4",
      mode: "code",
      system_prompt: "You are concise.",
      model_client: {
        model_proxy_provider: "openai_compatible",
        api_key: "token",
        base_url: "http://127.0.0.1:4000/openai/v1",
        default_headers: { "X-Test": "1" },
      },
      tools: { read: true, skill: true },
      workspace_tool_ids: ["workspace.lookup"],
      workspace_skill_ids: ["skill-creator"],
      output_schema_member_id: "main",
      output_format: { type: "json_schema", schema: { type: "object" } },
      workspace_config_checksum: "checksum-1",
    },
    workspaceSkills: [
      {
        skill_id: "skill-creator",
        source_dir: "/tmp/workspace-1/skills/skill-creator",
      },
    ],
    mcpServers: [
      {
        name: "workspace",
        config: {
          type: "remote" as const,
          enabled: true,
          url: "http://127.0.0.1:5000/mcp",
          headers: {},
          timeout: 30000,
        },
      },
    ],
    mcpToolRefs: [{ tool_id: "workspace.lookup", server_id: "workspace", tool_name: "lookup" }],
    runStartedPayload: { phase: "booting" },
    backendBaseUrl: "http://127.0.0.1:4096",
    timeoutSeconds: 30,
  };
}

test("shared harness definitions expose stable ids, commands, and capabilities", () => {
  assert.deepEqual(
    HARNESS_DEFINITIONS.map((definition) => ({
      id: definition.id,
      hostCommand: definition.hostCommand,
      capabilities: definition.runtimeAdapter.capabilities,
      prepPlan: definition.runtimeAdapter.buildRunnerPrepPlan({
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
      }),
    })),
    [
      {
        id: "opencode",
        hostCommand: "run-opencode",
        capabilities: {
          requiresBackend: true,
          supportsStructuredOutput: true,
          supportsWaitingUser: true,
          supportsSkills: true,
          supportsMcpTools: true,
        },
        prepPlan: {
          stageWorkspaceSkills: true,
          stageWorkspaceCommands: true,
          prepareMcpTooling: true,
          startWorkspaceMcpSidecar: true,
          bootstrapResolvedApplications: true,
        },
      },
      {
        id: "pi",
        hostCommand: "run-pi",
        capabilities: {
          requiresBackend: false,
          supportsStructuredOutput: false,
          supportsWaitingUser: false,
          supportsSkills: true,
          supportsMcpTools: true,
        },
        prepPlan: {
          stageWorkspaceSkills: false,
          stageWorkspaceCommands: false,
          prepareMcpTooling: true,
          startWorkspaceMcpSidecar: true,
          bootstrapResolvedApplications: true,
        },
      },
    ]
  );
});

test("shared harness definitions build harness-specific request shapes", () => {
  const [opencodeDefinition, piDefinition] = HARNESS_DEFINITIONS;
  const opencodeRequest = opencodeDefinition.runtimeAdapter.buildHarnessHostRequest(baseBuildParams());
  const piRequest = piDefinition.runtimeAdapter.buildHarnessHostRequest(baseBuildParams());
  const opencodeRunStartedPayload = opencodeRequest.run_started_payload as Record<string, unknown>;

  assert.equal(opencodeRequest.opencode_base_url, "http://127.0.0.1:4096");
  assert.deepEqual(opencodeRequest.workspace_skill_ids, ["skill-creator"]);
  assert.deepEqual(opencodeRequest.output_format, { type: "json_schema", schema: { type: "object" } });
  assert.equal(opencodeRunStartedPayload.provider_id, "hb_openai");
  assert.match(String(opencodeRequest.system_prompt), /OpenCode MCP tool naming:/);
  assert.match(String(opencodeRequest.system_prompt), /workspace\.lookup -> workspace_lookup/);
  assert.equal("mcp_tool_refs" in opencodeRequest, false);

  assert.equal("opencode_base_url" in piRequest, false);
  assert.equal(piRequest.system_prompt, "You are concise.");
  assert.deepEqual(piRequest.workspace_skill_dirs, ["/tmp/workspace-1/skills/skill-creator"]);
  assert.deepEqual(piRequest.mcp_tool_refs, [{ tool_id: "workspace.lookup", server_id: "workspace", tool_name: "lookup" }]);
  assert.equal("output_format" in piRequest, false);
});

test("opencode harness aliases legacy openai/anthropic provider ids to hb_*", () => {
  const [opencodeDefinition] = HARNESS_DEFINITIONS;

  const openaiRequest = opencodeDefinition.runtimeAdapter.buildHarnessHostRequest({
    ...baseBuildParams(),
    runtimeConfig: {
      ...baseBuildParams().runtimeConfig,
      provider_id: "openai",
      model_client: {
        ...baseBuildParams().runtimeConfig.model_client,
        model_proxy_provider: "openai_compatible",
      },
    },
  });
  assert.equal(openaiRequest.provider_id, "hb_openai");

  const anthropicRequest = opencodeDefinition.runtimeAdapter.buildHarnessHostRequest({
    ...baseBuildParams(),
    runtimeConfig: {
      ...baseBuildParams().runtimeConfig,
      provider_id: "anthropic",
      model_client: {
        ...baseBuildParams().runtimeConfig.model_client,
        model_proxy_provider: "anthropic_native",
      },
    },
  });
  assert.equal(anthropicRequest.provider_id, "hb_anthropic");

  const holabossRequest = opencodeDefinition.runtimeAdapter.buildHarnessHostRequest({
    ...baseBuildParams(),
    runtimeConfig: {
      ...baseBuildParams().runtimeConfig,
      provider_id: "holaboss_model_proxy",
      model_client: {
        ...baseBuildParams().runtimeConfig.model_client,
        model_proxy_provider: "anthropic_native",
      },
    },
  });
  assert.equal(holabossRequest.provider_id, "hb_anthropic");
});

test("opencode harness uses aliased provider id when syncing model config", async () => {
  const [opencodeDefinition] = HARNESS_DEFINITIONS;
  const params = baseBuildParams();
  let syncedProviderId = "";
  let restartCalls = 0;

  await opencodeDefinition.runtimeAdapter.prepareRun?.({
    request: params.request,
    bootstrap: params.bootstrap,
    runtimeConfig: {
      ...params.runtimeConfig,
      provider_id: "openai",
      model_client: {
        ...params.runtimeConfig.model_client,
        model_proxy_provider: "openai_compatible",
      },
    },
    stagedSkillsChanged: false,
    syncModelConfig: (request) => {
      syncedProviderId = request.provider_id;
      return {
        path: "/tmp/opencode.json",
        backend_config_changed: false,
        model_selection_changed: false,
      };
    },
    restartBackend: async () => {
      restartCalls += 1;
    },
    backendBaseUrl: params.backendBaseUrl,
    backendHost: "127.0.0.1",
    backendPort: 4096,
    backendReadyTimeoutSeconds: 30,
    buildBackendFingerprint: () => "fingerprint",
  });

  assert.equal(syncedProviderId, "hb_openai");
  assert.equal(restartCalls, 0);
});
