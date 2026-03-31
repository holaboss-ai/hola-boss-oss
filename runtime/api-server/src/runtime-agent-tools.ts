import { utcNowIso, type CronjobRecord, type RuntimeStateStore, type WorkspaceRecord } from "@holaboss/runtime-state-store";

import { RUNTIME_AGENT_TOOL_DEFINITIONS as RUNTIME_AGENT_TOOL_BASE_DEFINITIONS } from "../../harnesses/src/runtime-agent-tools.js";
import { cronjobNextRunAt } from "./cron-worker.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export interface RuntimeAgentToolDefinition {
  id: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  description: string;
}

export interface RuntimeAgentToolCapabilityPayload {
  available: true;
  workspace_id: string | null;
  tools: RuntimeAgentToolDefinition[];
}

export interface RuntimeAgentToolsCreateCronjobParams {
  workspaceId: string;
  initiatedBy?: string | null;
  name?: string | null;
  cron: string;
  description: string;
  enabled?: boolean;
  delivery?: {
    channel: string;
    mode?: string | null;
    to?: unknown;
  };
  metadata?: Record<string, unknown> | null;
  holabossUserId?: string | null;
}

export interface RuntimeAgentToolsUpdateCronjobParams {
  jobId: string;
  workspaceId?: string | null;
  name?: string | null;
  cron?: string | null;
  description?: string | null;
  enabled?: boolean | null;
  delivery?:
    | {
        channel: string;
        mode?: string | null;
        to?: unknown;
      }
    | null;
  metadata?: Record<string, unknown> | null;
}

export const ALLOWED_DELIVERY_MODES = new Set(["none", "announce"]);
export const ALLOWED_DELIVERY_CHANNELS = new Set(["system_notification", "session_run"]);

export const RUNTIME_AGENT_TOOL_DEFINITIONS: RuntimeAgentToolDefinition[] = [
  {
    id: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[0].id,
    method: "GET",
    path: "/api/v1/capabilities/runtime-tools/onboarding/status",
    description: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[0].description
  },
  {
    id: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[1].id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/onboarding/complete",
    description: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[1].description
  },
  {
    id: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[2].id,
    method: "GET",
    path: "/api/v1/capabilities/runtime-tools/cronjobs",
    description: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[2].description
  },
  {
    id: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[3].id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/cronjobs",
    description: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[3].description
  },
  {
    id: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[4].id,
    method: "GET",
    path: "/api/v1/capabilities/runtime-tools/cronjobs/:jobId",
    description: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[4].description
  },
  {
    id: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[5].id,
    method: "PATCH",
    path: "/api/v1/capabilities/runtime-tools/cronjobs/:jobId",
    description: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[5].description
  },
  {
    id: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[6].id,
    method: "DELETE",
    path: "/api/v1/capabilities/runtime-tools/cronjobs/:jobId",
    description: RUNTIME_AGENT_TOOL_BASE_DEFINITIONS[6].description
  }
];

export class RuntimeAgentToolsServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "RuntimeAgentToolsServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function metadataWithHolabossUserId(
  metadata: Record<string, unknown> | null | undefined,
  holabossUserId: string | null | undefined
): JsonObject {
  const nextMetadata: JsonObject = { ...((metadata ?? {}) as JsonObject) };
  const userId = normalizedString(holabossUserId);
  if (userId && typeof nextMetadata.holaboss_user_id !== "string") {
    nextMetadata.holaboss_user_id = userId;
  }
  return nextMetadata;
}

export function normalizeDelivery(params: {
  channel: string;
  mode?: string | null;
  to?: unknown;
}): JsonObject {
  const normalizedMode = normalizedString(params.mode ?? "announce") || "announce";
  const normalizedChannel = normalizedString(params.channel);
  if (!ALLOWED_DELIVERY_MODES.has(normalizedMode)) {
    throw new RuntimeAgentToolsServiceError(
      400,
      "cronjob_delivery_mode_invalid",
      `delivery mode must be one of ${JSON.stringify([...ALLOWED_DELIVERY_MODES].sort())}`
    );
  }
  if (!ALLOWED_DELIVERY_CHANNELS.has(normalizedChannel)) {
    throw new RuntimeAgentToolsServiceError(
      400,
      "cronjob_delivery_channel_invalid",
      `delivery channel must be one of ${JSON.stringify([...ALLOWED_DELIVERY_CHANNELS].sort())}`
    );
  }
  return {
    mode: normalizedMode,
    channel: normalizedChannel,
    to: typeof params.to === "string" ? params.to : params.to == null ? null : String(params.to)
  };
}

export function onboardingPayload(workspace: WorkspaceRecord): JsonObject {
  return {
    workspace_id: workspace.id,
    onboarding_status: workspace.onboardingStatus,
    onboarding_session_id: workspace.onboardingSessionId,
    onboarding_completed_at: workspace.onboardingCompletedAt,
    onboarding_completion_summary: workspace.onboardingCompletionSummary,
    onboarding_requested_at: workspace.onboardingRequestedAt,
    onboarding_requested_by: workspace.onboardingRequestedBy
  };
}

export function cronjobPayload(record: CronjobRecord): JsonObject {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    initiated_by: record.initiatedBy,
    name: record.name,
    cron: record.cron,
    description: record.description,
    enabled: record.enabled,
    delivery: record.delivery as JsonValue,
    metadata: record.metadata as JsonValue,
    last_run_at: record.lastRunAt,
    next_run_at: record.nextRunAt,
    run_count: record.runCount,
    last_status: record.lastStatus,
    last_error: record.lastError,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

export function runtimeAgentToolCapabilityPayload(context?: {
  workspaceId?: string | null;
}): RuntimeAgentToolCapabilityPayload {
  const workspaceId = normalizedString(context?.workspaceId);
  return {
    available: true,
    workspace_id: workspaceId || null,
    tools: RUNTIME_AGENT_TOOL_DEFINITIONS.map((tool) => ({ ...tool }))
  };
}

export class RuntimeAgentToolsService {
  constructor(private readonly store: RuntimeStateStore) {}

  capabilityStatus(context?: { workspaceId?: string | null }): RuntimeAgentToolCapabilityPayload {
    return runtimeAgentToolCapabilityPayload(context);
  }

  onboardingStatus(workspaceId: string): JsonObject {
    return onboardingPayload(this.requireWorkspace(workspaceId));
  }

  completeOnboarding(params: {
    workspaceId: string;
    summary: string;
    requestedBy?: string | null;
  }): JsonObject {
    const workspace = this.requireWorkspace(params.workspaceId);
    const now = utcNowIso();
    const updated = this.store.updateWorkspace(workspace.id, {
      onboardingStatus: "completed",
      onboardingCompletedAt: now,
      onboardingCompletionSummary: params.summary,
      onboardingRequestedAt: now,
      onboardingRequestedBy: normalizedString(params.requestedBy) || "workspace_agent"
    });
    return onboardingPayload(updated);
  }

  listCronjobs(params: {
    workspaceId: string;
    enabledOnly?: boolean;
  }): JsonObject {
    const jobs = this.store
      .listCronjobs({
        workspaceId: params.workspaceId,
        enabledOnly: Boolean(params.enabledOnly)
      })
      .map((job) => cronjobPayload(job));
    return { jobs, count: jobs.length };
  }

  getCronjob(params: {
    jobId: string;
    workspaceId?: string | null;
  }): JsonObject | null {
    const job = this.store.getCronjob(params.jobId);
    if (!job) {
      return null;
    }
    this.assertCronjobBelongsToWorkspace(job, params.workspaceId);
    return cronjobPayload(job);
  }

  createCronjob(params: RuntimeAgentToolsCreateCronjobParams): JsonObject {
    this.requireWorkspace(params.workspaceId);
    const cron = normalizedString(params.cron);
    const description = normalizedString(params.description);
    if (!cron) {
      throw new RuntimeAgentToolsServiceError(400, "cronjob_cron_required", "cron is required");
    }
    if (!description) {
      throw new RuntimeAgentToolsServiceError(400, "cronjob_description_required", "description is required");
    }
    const created = this.store.createCronjob({
      workspaceId: params.workspaceId,
      initiatedBy: normalizedString(params.initiatedBy) || "workspace_agent",
      name: normalizedString(params.name),
      cron,
      description,
      enabled: params.enabled !== false,
      delivery: normalizeDelivery({
        channel: normalizedString(params.delivery?.channel ?? "session_run") || "session_run",
        mode: params.delivery?.mode ?? "announce",
        to: params.delivery?.to
      }),
      metadata: metadataWithHolabossUserId(params.metadata, params.holabossUserId),
      nextRunAt: cronjobNextRunAt(cron, new Date())
    });
    return cronjobPayload(created);
  }

  updateCronjob(params: RuntimeAgentToolsUpdateCronjobParams): JsonObject {
    const existing = this.requireCronjob(params.jobId);
    this.assertCronjobBelongsToWorkspace(existing, params.workspaceId);
    const cron = params.cron == null ? null : normalizedString(params.cron);
    if (params.cron !== undefined && !cron) {
      throw new RuntimeAgentToolsServiceError(400, "cronjob_cron_required", "cron is required");
    }
    const description = params.description == null ? null : normalizedString(params.description);
    if (params.description !== undefined && !description) {
      throw new RuntimeAgentToolsServiceError(400, "cronjob_description_required", "description is required");
    }
    const updated = this.store.updateCronjob({
      jobId: params.jobId,
      name: params.name === undefined ? undefined : normalizedString(params.name),
      cron,
      description,
      enabled: params.enabled === undefined ? undefined : params.enabled,
      delivery:
        params.delivery === undefined || params.delivery === null
          ? undefined
          : normalizeDelivery({
              channel: params.delivery.channel,
              mode: params.delivery.mode,
              to: params.delivery.to
            }),
      metadata: params.metadata === undefined ? undefined : params.metadata ?? {},
      nextRunAt: cron === null ? undefined : cronjobNextRunAt(cron, new Date())
    });
    if (!updated) {
      throw new RuntimeAgentToolsServiceError(404, "cronjob_not_found", "cronjob not found");
    }
    return cronjobPayload(updated);
  }

  deleteCronjob(params: {
    jobId: string;
    workspaceId?: string | null;
  }): JsonObject {
    const existing = this.store.getCronjob(params.jobId);
    if (!existing) {
      return { success: false };
    }
    this.assertCronjobBelongsToWorkspace(existing, params.workspaceId);
    return { success: this.store.deleteCronjob(params.jobId) };
  }

  private requireWorkspace(workspaceId: string): WorkspaceRecord {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new RuntimeAgentToolsServiceError(404, "workspace_not_found", "workspace not found");
    }
    return workspace;
  }

  private requireCronjob(jobId: string): CronjobRecord {
    const job = this.store.getCronjob(jobId);
    if (!job) {
      throw new RuntimeAgentToolsServiceError(404, "cronjob_not_found", "cronjob not found");
    }
    return job;
  }

  private assertCronjobBelongsToWorkspace(job: CronjobRecord, workspaceId?: string | null): void {
    const expectedWorkspaceId = normalizedString(workspaceId);
    if (expectedWorkspaceId && job.workspaceId !== expectedWorkspaceId) {
      throw new RuntimeAgentToolsServiceError(
        400,
        "cronjob_workspace_mismatch",
        "requested cronjob does not belong to this workspace"
      );
    }
  }
}
