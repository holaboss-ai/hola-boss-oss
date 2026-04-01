import {
  bindHarnessHostPlugin,
  type HarnessDefinition,
  type HarnessPrepareRunParams,
  type HarnessRuntimeConfigPayload,
  type HarnessRuntimeStatus,
  type HarnessRuntimeStatusContext,
} from "./types.js";
import { appendOpencodeMcpToolAliasGuidance } from "./opencode-prompt.js";

function opencodeProviderAliasForRuntimeConfig(runtimeConfig: HarnessRuntimeConfigPayload): string {
  const providerId = runtimeConfig.provider_id.trim();
  const normalizedProviderId = providerId.toLowerCase();
  const normalizedModelProxyProvider = runtimeConfig.model_client.model_proxy_provider.trim().toLowerCase();

  if (normalizedProviderId === "holaboss_model_proxy") {
    return normalizedModelProxyProvider === "anthropic_native" || normalizedModelProxyProvider === "anthropic"
      ? "hb_anthropic"
      : "hb_openai";
  }

  if (
    normalizedProviderId === "anthropic" ||
    normalizedProviderId === "anthropic_native" ||
    normalizedProviderId === "hb_anthropic"
  ) {
    return "hb_anthropic";
  }

  if (
    normalizedProviderId === "openai" ||
    normalizedProviderId === "openai_compatible" ||
    normalizedProviderId === "hb_openai"
  ) {
    return "hb_openai";
  }

  return providerId;
}

async function prepareOpencodeHarnessRun(params: HarnessPrepareRunParams): Promise<void> {
  const providerId = opencodeProviderAliasForRuntimeConfig(params.runtimeConfig);
  const configUpdate = params.syncModelConfig({
    workspace_root: params.bootstrap.workspaceDir,
    provider_id: providerId,
    model_id: params.runtimeConfig.model_id,
    model_client: params.runtimeConfig.model_client,
  });

  if (configUpdate.backend_config_changed || params.stagedSkillsChanged) {
    await params.restartBackend({
      workspace_root: params.bootstrap.workspaceDir,
      workspace_id: params.request.workspace_id,
      backend_fingerprint: params.buildBackendFingerprint(params.runtimeConfig, params.request.workspace_id),
      allow_reuse_existing: false,
      host: params.backendHost,
      port: params.backendPort,
      ready_timeout_s: params.backendReadyTimeoutSeconds,
    });
  }
}

async function describeOpencodeRuntimeStatus(params: HarnessRuntimeStatusContext): Promise<HarnessRuntimeStatus> {
  const readinessTarget = params.backendReadinessTarget?.trim() ?? "";
  const ready = readinessTarget ? await params.probeBackendReadiness(readinessTarget) : false;
  if (ready) {
    return { ready: true, state: "ready" };
  }
  if (params.backendConfigPresent) {
    return { ready: false, state: "configured" };
  }
  if (params.configLoaded) {
    return { ready: false, state: "config_loaded" };
  }
  return { ready: false, state: "pending_config" };
}

export const opencodeHarnessDefinition: HarnessDefinition = {
  id: "opencode",
  hostCommand: "run-opencode",
  runtimeAdapter: {
    id: "opencode",
    hostCommand: "run-opencode",
    capabilities: {
      requiresBackend: true,
      supportsStructuredOutput: true,
      supportsWaitingUser: true,
      supportsSkills: true,
      supportsMcpTools: true,
    },
    buildRunnerPrepPlan() {
      return {
        stageWorkspaceSkills: true,
        stageWorkspaceCommands: true,
        prepareMcpTooling: true,
        startWorkspaceMcpSidecar: true,
        bootstrapResolvedApplications: true,
      };
    },
    buildHarnessHostRequest(params) {
      const providerId = opencodeProviderAliasForRuntimeConfig(params.runtimeConfig);
      return {
        workspace_id: params.request.workspace_id,
        workspace_dir: params.bootstrap.workspaceDir,
        session_id: params.request.session_id,
        input_id: params.request.input_id,
        instruction: params.request.instruction,
        attachments: params.request.attachments ?? [],
        debug: Boolean(params.request.debug),
        harness_session_id: params.bootstrap.requestedHarnessSessionId,
        persisted_harness_session_id: params.bootstrap.persistedHarnessSessionId,
        provider_id: providerId,
        model_id: params.runtimeConfig.model_id,
        mode: params.runtimeConfig.mode,
        opencode_base_url: params.backendBaseUrl,
        timeout_seconds: params.timeoutSeconds,
        system_prompt: appendOpencodeMcpToolAliasGuidance(params.runtimeConfig.system_prompt, params.mcpToolRefs),
        tools: { ...params.runtimeConfig.tools },
        workspace_tool_ids: [...params.runtimeConfig.workspace_tool_ids],
        workspace_skill_ids: [...params.runtimeConfig.workspace_skill_ids],
        mcp_servers: params.mcpServers.map((server) => ({
          name: server.name,
          config: { ...server.config },
          ...(server._holaboss_force_refresh ? { _holaboss_force_refresh: true } : {}),
        })),
        output_format: params.runtimeConfig.output_format,
        workspace_config_checksum: params.runtimeConfig.workspace_config_checksum,
        run_started_payload: {
          ...params.runStartedPayload,
          provider_id: providerId,
        },
        model_client: {
          model_proxy_provider: params.runtimeConfig.model_client.model_proxy_provider,
          api_key: params.runtimeConfig.model_client.api_key,
          base_url: params.runtimeConfig.model_client.base_url,
          default_headers: params.runtimeConfig.model_client.default_headers,
        },
      };
    },
    prepareRun: prepareOpencodeHarnessRun,
    describeRuntimeStatus: describeOpencodeRuntimeStatus,
    async handleRuntimeConfigUpdated(params) {
      params.writeBootstrapConfigIfAvailable();
    },
    async ensureReady(params) {
      await params.ensureHarnessBackendReady();
    },
  },
  bindHostPlugin(implementation) {
    return bindHarnessHostPlugin(opencodeHarnessDefinition, implementation);
  },
};
