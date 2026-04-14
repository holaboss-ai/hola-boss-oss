import { bindHarnessHostPlugin, type HarnessDefinition } from "./types.js";

function instructionWithContextMessages(instruction: string, contextMessages: string[] | undefined): string {
  const messages = Array.isArray(contextMessages)
    ? contextMessages.map((message) => message.trim()).filter(Boolean)
    : [];
  if (messages.length === 0) {
    return instruction;
  }
  const contextBlock = messages
    .map((message, index) => [`[Runtime Context ${index + 1}]`, message, `[/Runtime Context ${index + 1}]`].join("\n"))
    .join("\n\n");
  return [contextBlock, instruction].filter(Boolean).join("\n\n").trim();
}

export const piHarnessDefinition: HarnessDefinition = {
  id: "pi",
  hostCommand: "run-pi",
  runtimeAdapter: {
    id: "pi",
    hostCommand: "run-pi",
    capabilities: {
      requiresBackend: false,
      supportsStructuredOutput: false,
      supportsWaitingUser: true,
      supportsSkills: true,
      supportsMcpTools: true,
    },
    buildRunnerPrepPlan() {
      return {
        stageWorkspaceSkills: false,
        stageWorkspaceCommands: false,
        prepareMcpTooling: true,
        startWorkspaceMcpSidecar: true,
        bootstrapResolvedApplications: true,
      };
    },
    buildHarnessHostRequest(params) {
      return {
        workspace_id: params.request.workspace_id,
        workspace_dir: params.bootstrap.workspaceDir,
        session_id: params.request.session_id,
        browser_tools_enabled: String(params.request.session_kind ?? "").trim().toLowerCase() === "workspace_session",
        input_id: params.request.input_id,
        instruction: instructionWithContextMessages(
          params.request.instruction,
          params.runtimeConfig.context_messages
        ),
        attachments: params.request.attachments ?? [],
        thinking_value: params.request.thinking_value ?? null,
        debug: Boolean(params.request.debug),
        harness_session_id: params.bootstrap.requestedHarnessSessionId,
        persisted_harness_session_id: params.bootstrap.persistedHarnessSessionId,
        provider_id: params.runtimeConfig.provider_id,
        model_id: params.runtimeConfig.model_id,
        timeout_seconds: params.timeoutSeconds,
        runtime_api_base_url: params.runtimeApiBaseUrl ?? null,
        system_prompt: params.runtimeConfig.system_prompt,
        workspace_skill_dirs: params.workspaceSkills.map((skill) => skill.source_dir),
        mcp_servers: params.mcpServers.map((server) => ({
          name: server.name,
          config: { ...server.config },
          ...(server._holaboss_force_refresh ? { _holaboss_force_refresh: true } : {}),
        })),
        mcp_tool_refs: params.mcpToolRefs.map((toolRef) => ({ ...toolRef })),
        workspace_config_checksum: params.runtimeConfig.workspace_config_checksum,
        run_started_payload: params.runStartedPayload,
        model_client: {
          model_proxy_provider: params.runtimeConfig.model_client.model_proxy_provider,
          api_key: params.runtimeConfig.model_client.api_key,
          base_url: params.runtimeConfig.model_client.base_url,
          default_headers: params.runtimeConfig.model_client.default_headers,
        },
      };
    },
    async describeRuntimeStatus() {
      return { ready: true, state: "ready" };
    },
  },
  bindHostPlugin(implementation) {
    return bindHarnessHostPlugin(piHarnessDefinition, implementation);
  },
};
