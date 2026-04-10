import fs from "node:fs";
import path from "node:path";

import type { OutputRecord, RuntimeStateStore, WorkspaceRecord } from "@holaboss/runtime-state-store";
import yaml from "js-yaml";

import type { MemoryServiceLike } from "./memory.js";
import { buildCapturedMemoryViews } from "./memory-capture-views.js";
import { compileWorkspaceRuntimePlanFromWorkspace } from "./runner-prep.js";
import { resolveProductRuntimeConfig } from "./runtime-config.js";
import { collectWorkspaceSnapshot } from "./workspace-snapshot.js";

function stringList(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function cronjobDeliveryChannels(cronjobs: Array<Record<string, unknown>>): string[] {
  return stringList(
    cronjobs.map((cronjob) => {
      const delivery = cronjob.delivery;
      if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
        return "";
      }
      const deliveryRecord = delivery as Record<string, unknown>;
      return typeof deliveryRecord.channel === "string" ? deliveryRecord.channel.trim() : "";
    })
  );
}

function taskProposalCountByState(taskProposals: Array<Record<string, unknown>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const proposal of taskProposals) {
    const state = typeof proposal.state === "string" ? proposal.state : "unknown";
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return counts;
}

function artifactTypeFromOutputRecord(record: OutputRecord): string {
  const metadataArtifactType =
    typeof record.metadata.artifact_type === "string" ? record.metadata.artifact_type.trim() : "";
  if (metadataArtifactType) {
    return metadataArtifactType;
  }
  if (record.outputType === "post") {
    return "draft";
  }
  if (record.outputType === "html") {
    return "html";
  }
  const category = typeof record.metadata.category === "string" ? record.metadata.category.trim() : "";
  if (category === "image") {
    return "image";
  }
  return "document";
}

function externalIdFromOutputRecord(record: OutputRecord): string {
  const metadataExternalId =
    typeof record.metadata.external_id === "string" ? record.metadata.external_id.trim() : "";
  if (metadataExternalId) {
    return metadataExternalId;
  }
  return record.moduleResourceId ?? record.filePath ?? record.artifactId ?? record.id;
}

function toolManifestFromCompiledPlan(compiledPlan: ReturnType<typeof compileWorkspaceRuntimePlanFromWorkspace>) {
  return {
    servers: compiledPlan.resolved_mcp_servers.map((server) => ({
      server_id: server.server_id,
      type: server.type,
      timeout_ms: server.timeout_ms,
      command: server.command,
      url: server.url ?? null
    })),
    tools: compiledPlan.resolved_mcp_tool_refs.map((tool) => ({
      tool_id: tool.tool_id,
      server_id: tool.server_id,
      tool_name: tool.tool_name,
      mode: "local_mcp"
    })),
    workspace_catalog: compiledPlan.workspace_mcp_catalog.map((entry) => ({
      tool_id: entry.tool_id,
      tool_name: entry.tool_name,
      module_path: entry.module_path,
      symbol_name: entry.symbol_name
    })),
    applications: compiledPlan.resolved_applications.map((application) => ({
      app_id: application.app_id,
      mcp: application.mcp,
      health_check: application.health_check,
      env_contract: application.env_contract,
      integrations: application.integrations ?? []
    })),
    allowlist: [...compiledPlan.mcp_tool_allowlist]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fallbackWorkspaceSignals(workspaceYaml: string): {
  applications: string[];
  mcpToolIds: string[];
} {
  let parsed: unknown;
  try {
    parsed = yaml.load(workspaceYaml);
  } catch {
    return { applications: [], mcpToolIds: [] };
  }
  if (!isRecord(parsed)) {
    return { applications: [], mcpToolIds: [] };
  }
  const applications = Array.isArray(parsed.applications)
    ? stringList(
        parsed.applications.map((item) =>
          isRecord(item) && typeof item.app_id === "string" ? item.app_id.trim() : ""
        )
      )
    : [];
  const mcpRegistry = isRecord(parsed.mcp_registry) ? parsed.mcp_registry : null;
  const allowlist = mcpRegistry && isRecord(mcpRegistry.allowlist) ? mcpRegistry.allowlist : null;
  const mcpToolIds = allowlist && Array.isArray(allowlist.tool_ids)
    ? stringList(allowlist.tool_ids.map((item) => (typeof item === "string" ? item.trim() : "")))
    : [];
  return { applications, mcpToolIds };
}

function workspacePayload(workspace: WorkspaceRecord, holabossUserId: string | null): Record<string, unknown> {
  return {
    id: workspace.id,
    name: workspace.name,
    status: workspace.status,
    harness: workspace.harness,
    error_message: workspace.errorMessage,
    onboarding_status: workspace.onboardingStatus,
    onboarding_session_id: workspace.onboardingSessionId,
    onboarding_completed_at: workspace.onboardingCompletedAt,
    onboarding_completion_summary: workspace.onboardingCompletionSummary,
    onboarding_requested_at: workspace.onboardingRequestedAt,
    onboarding_requested_by: workspace.onboardingRequestedBy,
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
    deleted_at_utc: workspace.deletedAtUtc,
    holaboss_user_id: holabossUserId
  };
}

export async function captureWorkspaceContext(params: {
  store: RuntimeStateStore;
  memoryService: MemoryServiceLike;
  workspaceId: string;
}): Promise<Record<string, unknown>> {
  const workspace = params.store.getWorkspace(params.workspaceId);
  if (!workspace || workspace.deletedAtUtc) {
    throw new Error(`Workspace '${params.workspaceId}' was not found`);
  }

  const workspaceDir = params.store.workspaceDir(params.workspaceId);
  const filesystemSnapshot = fs.existsSync(workspaceDir)
    ? collectWorkspaceSnapshot(workspaceDir)
    : {
        file_count: 0,
        total_size: 0,
        files: [],
        extension_counts: {},
        previews: {},
        git: {}
      };
  const runtimeConfig = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false
  });
  const cronjobs = params.store
    .listCronjobs({ workspaceId: params.workspaceId, enabledOnly: false })
    .map((job) => ({ ...job }));
  const taskProposals = params.store.listTaskProposals({ workspaceId: params.workspaceId }).map((proposal) => ({ ...proposal }));
  const outputs = params.store
    .listOutputs({ workspaceId: params.workspaceId, limit: 1000, offset: 0 })
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt ?? "") || 0;
      const rightTime = Date.parse(right.createdAt ?? "") || 0;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.id.localeCompare(right.id);
    });
  const artifactsBySession = new Map<string, Array<Record<string, unknown>>>();
  for (const output of outputs) {
    const sessionId = output.sessionId ?? "";
    if (!sessionId) {
      continue;
    }
    const existing = artifactsBySession.get(sessionId);
    const artifactPayload = {
      id: output.artifactId ?? output.id,
      session_id: sessionId,
      workspace_id: output.workspaceId,
      input_id: output.inputId,
      artifact_type: artifactTypeFromOutputRecord(output),
      external_id: externalIdFromOutputRecord(output),
      platform: output.platform,
      title: output.title || null,
      metadata: output.metadata,
      created_at: output.createdAt,
    };
    if (existing) {
      existing.push(artifactPayload);
    } else {
      artifactsBySession.set(sessionId, [artifactPayload]);
    }
  }
  const sessions = params.store
    .listRuntimeStates(params.workspaceId)
    .slice(0, 20)
    .map((state) => ({
      session_id: state.sessionId,
      status: state.status,
      created_at: state.createdAt,
      updated_at: state.updatedAt,
      artifacts: artifactsBySession.get(state.sessionId) ?? []
    }));
  const warnings: string[] = [];
  const workspaceYamlPath = path.join(workspaceDir, "workspace.yaml");

  let compiledPlan: ReturnType<typeof compileWorkspaceRuntimePlanFromWorkspace> | null = null;
  let workspaceYaml = "";
  if (!fs.existsSync(workspaceYamlPath)) {
    warnings.push("workspace_yaml_missing");
  } else {
    workspaceYaml = fs.readFileSync(workspaceYamlPath, "utf8");
    try {
      compiledPlan = compileWorkspaceRuntimePlanFromWorkspace({
        workspaceId: params.workspaceId,
        workspaceDir
      });
    } catch (error) {
      warnings.push(
        `workspace_runtime_plan_compile_failed:${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const fallbackSignals = workspaceYaml ? fallbackWorkspaceSignals(workspaceYaml) : { applications: [], mcpToolIds: [] };
  const applications = compiledPlan
    ? stringList(compiledPlan.resolved_applications.map((application) => application.app_id))
    : fallbackSignals.applications;
  const mcpToolIds = compiledPlan
    ? stringList(compiledPlan.resolved_mcp_tool_refs.map((tool) => tool.tool_id))
    : fallbackSignals.mcpToolIds;
  const deliveryChannels = cronjobDeliveryChannels(cronjobs);
  const executableCapabilities = stringList([
    ...applications.map((appId) => `app::${appId}`),
    ...mcpToolIds.map((toolId) => `tool::${toolId}`),
    ...deliveryChannels.map((channel) => `cron::${channel}`)
  ]);
  const memory = await params.memoryService.capture({ workspace_id: params.workspaceId });
  const memoryFiles = memory.files;
  const normalizedMemoryFiles =
    memoryFiles && typeof memoryFiles === "object" && !Array.isArray(memoryFiles) ? { ...memoryFiles } : {};
  const durableMemoryEntries = params.store.listMemoryEntries({
    status: "active",
    limit: 500,
    offset: 0,
  });
  const memoryViews = buildCapturedMemoryViews({
    workspaceId: params.workspaceId,
    files: normalizedMemoryFiles,
    memoryEntries: durableMemoryEntries,
  });

  return {
    workspace: workspacePayload(workspace, runtimeConfig.userId || null),
    snapshot: {
      workspace_id: params.workspaceId,
      applications,
      mcp_tool_ids: mcpToolIds,
      cronjob_delivery_channels: deliveryChannels,
      executable_capabilities: executableCapabilities,
      runtime_signals: {
        file_count: filesystemSnapshot.file_count,
        total_size: filesystemSnapshot.total_size,
        extension_counts: filesystemSnapshot.extension_counts,
        previews: filesystemSnapshot.previews,
        git: filesystemSnapshot.git,
        session_count: sessions.length,
        task_proposal_state_counts: taskProposalCountByState(taskProposals),
      },
      warnings,
      workspace_yaml: workspaceYaml || null,
      filesystem_snapshot: filesystemSnapshot,
    },
    memory: {
      ...memory,
      files: normalizedMemoryFiles,
      ...memoryViews,
      search_results: [],
      sessions,
    },
    cronjob_records: cronjobs,
    task_proposals: taskProposals,
    tool_manifest: compiledPlan ? toolManifestFromCompiledPlan(compiledPlan) : {
      servers: [],
      tools: mcpToolIds.map((toolId) => ({
        tool_id: toolId,
        server_id: toolId.includes(".") ? toolId.split(".")[0] : "workspace",
        tool_name: toolId.includes(".") ? toolId.split(".").slice(1).join(".") : toolId,
        mode: "local_mcp"
      })),
      workspace_catalog: [],
      applications: applications.map((appId) => ({ app_id: appId })),
      allowlist: [...mcpToolIds]
    },
    captured_at: new Date().toISOString(),
  };
}
