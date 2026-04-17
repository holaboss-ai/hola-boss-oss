import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  utcNowIso,
  type CronjobRecord,
  type RuntimeStateStore,
  type TerminalSessionEventRecord,
  type TerminalSessionRecord,
  type TerminalSessionStatus,
  type WorkspaceRecord,
} from "@holaboss/runtime-state-store";

import { RUNTIME_AGENT_TOOL_DEFINITIONS as RUNTIME_AGENT_TOOL_BASE_DEFINITIONS } from "../../harnesses/src/runtime-agent-tools.js";
import { cronjobNextRunAt } from "./cron-worker.js";
import { generateWorkspaceImage } from "./image-generation.js";
import type { TerminalSessionManagerLike } from "./terminal-session-manager.js";

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
  sessionId?: string | null;
  selectedModel?: string | null;
  name?: string | null;
  cron: string;
  description: string;
  instruction?: string | null;
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
  instruction?: string | null;
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

export interface RuntimeAgentToolsGenerateImageParams {
  workspaceId: string;
  sessionId?: string | null;
  selectedModel?: string | null;
  prompt: string;
  filename?: string | null;
  size?: string | null;
}

export interface RuntimeAgentToolsWriteReportParams {
  workspaceId: string;
  sessionId?: string | null;
  inputId?: string | null;
  selectedModel?: string | null;
  title?: string | null;
  filename?: string | null;
  summary?: string | null;
  content: string;
}

export interface RuntimeAgentToolsListTerminalSessionsParams {
  workspaceId: string;
  sessionId?: string | null;
  statuses?: TerminalSessionStatus[] | null;
}

export interface RuntimeAgentToolsStartTerminalSessionParams {
  workspaceId: string;
  sessionId?: string | null;
  inputId?: string | null;
  selectedModel?: string | null;
  title?: string | null;
  cwd?: string | null;
  command: string;
  cols?: number | null;
  rows?: number | null;
}

export interface RuntimeAgentToolsGetTerminalSessionParams {
  terminalId: string;
  workspaceId?: string | null;
}

export interface RuntimeAgentToolsReadTerminalSessionParams {
  terminalId: string;
  workspaceId?: string | null;
  afterSequence?: number | null;
  limit?: number | null;
}

export interface RuntimeAgentToolsWaitTerminalSessionParams extends RuntimeAgentToolsReadTerminalSessionParams {
  timeoutMs?: number | null;
}

export interface RuntimeAgentToolsSendTerminalSessionInputParams {
  terminalId: string;
  workspaceId?: string | null;
  data: string;
}

export interface RuntimeAgentToolsSignalTerminalSessionParams {
  terminalId: string;
  workspaceId?: string | null;
  signal?: string | null;
}

export interface RuntimeAgentToolsCloseTerminalSessionParams {
  terminalId: string;
  workspaceId?: string | null;
}

export const ALLOWED_DELIVERY_MODES = new Set(["none", "announce"]);
export const ALLOWED_DELIVERY_CHANNELS = new Set(["system_notification", "session_run"]);

function runtimeToolBaseDefinition(id: string) {
  const definition = RUNTIME_AGENT_TOOL_BASE_DEFINITIONS.find((tool) => tool.id === id);
  if (!definition) {
    throw new Error(`Unknown runtime agent tool base definition '${id}'`);
  }
  return definition;
}

export const RUNTIME_AGENT_TOOL_DEFINITIONS: RuntimeAgentToolDefinition[] = [
  {
    id: runtimeToolBaseDefinition("holaboss_onboarding_status").id,
    method: "GET",
    path: "/api/v1/capabilities/runtime-tools/onboarding/status",
    description: runtimeToolBaseDefinition("holaboss_onboarding_status").description
  },
  {
    id: runtimeToolBaseDefinition("holaboss_onboarding_complete").id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/onboarding/complete",
    description: runtimeToolBaseDefinition("holaboss_onboarding_complete").description
  },
  {
    id: runtimeToolBaseDefinition("holaboss_cronjobs_list").id,
    method: "GET",
    path: "/api/v1/capabilities/runtime-tools/cronjobs",
    description: runtimeToolBaseDefinition("holaboss_cronjobs_list").description
  },
  {
    id: runtimeToolBaseDefinition("holaboss_cronjobs_create").id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/cronjobs",
    description: runtimeToolBaseDefinition("holaboss_cronjobs_create").description
  },
  {
    id: runtimeToolBaseDefinition("holaboss_cronjobs_get").id,
    method: "GET",
    path: "/api/v1/capabilities/runtime-tools/cronjobs/:jobId",
    description: runtimeToolBaseDefinition("holaboss_cronjobs_get").description
  },
  {
    id: runtimeToolBaseDefinition("holaboss_cronjobs_update").id,
    method: "PATCH",
    path: "/api/v1/capabilities/runtime-tools/cronjobs/:jobId",
    description: runtimeToolBaseDefinition("holaboss_cronjobs_update").description
  },
  {
    id: runtimeToolBaseDefinition("holaboss_cronjobs_delete").id,
    method: "DELETE",
    path: "/api/v1/capabilities/runtime-tools/cronjobs/:jobId",
    description: runtimeToolBaseDefinition("holaboss_cronjobs_delete").description
  },
  {
    id: runtimeToolBaseDefinition("image_generate").id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/images/generate",
    description: runtimeToolBaseDefinition("image_generate").description
  },
  {
    id: runtimeToolBaseDefinition("write_report").id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/reports",
    description: runtimeToolBaseDefinition("write_report").description
  },
  {
    id: runtimeToolBaseDefinition("terminal_sessions_list").id,
    method: "GET",
    path: "/api/v1/capabilities/runtime-tools/terminal-sessions",
    description: runtimeToolBaseDefinition("terminal_sessions_list").description
  },
  {
    id: runtimeToolBaseDefinition("terminal_session_start").id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/terminal-sessions",
    description: runtimeToolBaseDefinition("terminal_session_start").description
  },
  {
    id: runtimeToolBaseDefinition("terminal_session_get").id,
    method: "GET",
    path: "/api/v1/capabilities/runtime-tools/terminal-sessions/:terminalId",
    description: runtimeToolBaseDefinition("terminal_session_get").description
  },
  {
    id: runtimeToolBaseDefinition("terminal_session_read").id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/terminal-sessions/:terminalId/read",
    description: runtimeToolBaseDefinition("terminal_session_read").description
  },
  {
    id: runtimeToolBaseDefinition("terminal_session_wait").id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/terminal-sessions/:terminalId/wait",
    description: runtimeToolBaseDefinition("terminal_session_wait").description
  },
  {
    id: runtimeToolBaseDefinition("terminal_session_send_input").id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/terminal-sessions/:terminalId/input",
    description: runtimeToolBaseDefinition("terminal_session_send_input").description
  },
  {
    id: runtimeToolBaseDefinition("terminal_session_signal").id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/terminal-sessions/:terminalId/signal",
    description: runtimeToolBaseDefinition("terminal_session_signal").description
  },
  {
    id: runtimeToolBaseDefinition("terminal_session_close").id,
    method: "POST",
    path: "/api/v1/capabilities/runtime-tools/terminal-sessions/:terminalId/close",
    description: runtimeToolBaseDefinition("terminal_session_close").description
  },
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

function normalizedInteger(
  value: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function sanitizeReportFilenameStem(value: string): string {
  const stem = value
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[/\\]+/g, " ")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_. ]+|[-_. ]+$/g, "");
  return stem || "report";
}

function reportTitleFromContent(content: string): string {
  const headingMatch = content.match(/^\s*#\s+(.+?)\s*$/m);
  if (headingMatch?.[1]) {
    return headingMatch[1].trim();
  }
  const firstContentLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstContentLine ? firstContentLine.slice(0, 120) : "";
}

function defaultReportTitle(params: {
  title?: string | null;
  filename?: string | null;
  content: string;
}): string {
  return (
    normalizedString(params.title) ||
    reportTitleFromContent(params.content) ||
    normalizedString(params.filename).replace(/\.md$/i, "") ||
    `Report ${utcNowIso().slice(0, 10)}`
  );
}

async function reportOutputFilePath(params: {
  workspaceRoot: string;
  workspaceId: string;
  title: string;
  filename?: string | null;
}): Promise<{ absolutePath: string; relativePath: string }> {
  const preferredStem = sanitizeReportFilenameStem(
    normalizedString(params.filename) || params.title,
  );
  for (let index = 0; index < 1000; index += 1) {
    const fileName =
      index === 0 ? `${preferredStem}.md` : `${preferredStem}-${index + 1}.md`;
    const relativePath = path.posix.join("outputs", "reports", fileName);
    const absolutePath = path.join(
      params.workspaceRoot,
      params.workspaceId,
      relativePath,
    );
    try {
      await fs.access(absolutePath);
    } catch {
      return { absolutePath, relativePath };
    }
  }
  throw new RuntimeAgentToolsServiceError(
    500,
    "report_path_exhausted",
    "unable to allocate a report output path",
  );
}

function metadataWithCronjobDefaults(params: {
  metadata: Record<string, unknown> | null | undefined;
  holabossUserId: string | null | undefined;
  selectedModel?: string | null | undefined;
  sourceSessionId?: string | null | undefined;
}
): JsonObject {
  const nextMetadata: JsonObject = { ...((params.metadata ?? {}) as JsonObject) };
  const userId = normalizedString(params.holabossUserId);
  if (userId && typeof nextMetadata.holaboss_user_id !== "string") {
    nextMetadata.holaboss_user_id = userId;
  }
  const selectedModel = normalizedString(params.selectedModel);
  if (selectedModel && typeof nextMetadata.model !== "string") {
    nextMetadata.model = selectedModel;
  }
  const sourceSessionId = normalizedString(params.sourceSessionId);
  if (sourceSessionId && typeof nextMetadata.source_session_id !== "string") {
    nextMetadata.source_session_id = sourceSessionId;
  }
  return nextMetadata;
}

function resolvedInstructionForCronjobUpdate(params: {
  existing: CronjobRecord;
  description: string | null;
  instruction: string | null;
}): string | null | undefined {
  if (params.instruction !== null) {
    return params.instruction;
  }
  if (params.description !== null && params.existing.instruction.trim() === params.existing.description.trim()) {
    return params.description;
  }
  return undefined;
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
    instruction: record.instruction,
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

function terminalSessionPayload(record: TerminalSessionRecord): JsonObject {
  return {
    terminal_id: record.terminalId,
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    input_id: record.inputId,
    title: record.title,
    backend: record.backend,
    owner: record.owner,
    status: record.status,
    cwd: record.cwd,
    shell: record.shell,
    command: record.command,
    exit_code: record.exitCode,
    last_event_seq: record.lastEventSeq,
    created_by: record.createdBy,
    created_at: record.createdAt,
    started_at: record.startedAt,
    last_activity_at: record.lastActivityAt,
    ended_at: record.endedAt,
    metadata: record.metadata as JsonValue,
  };
}

function terminalSessionEventPayload(record: TerminalSessionEventRecord): JsonObject {
  return {
    id: record.id,
    terminal_id: record.terminalId,
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    sequence: record.sequence,
    event_type: record.eventType,
    payload: record.payload as JsonValue,
    created_at: record.createdAt,
  };
}

function terminalSessionReadPayload(params: {
  terminal: TerminalSessionRecord;
  events: TerminalSessionEventRecord[];
  timedOut?: boolean;
}): JsonObject {
  return {
    terminal: terminalSessionPayload(params.terminal),
    events: params.events.map((event) => terminalSessionEventPayload(event)),
    count: params.events.length,
    timed_out: params.timedOut === true,
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
  constructor(
    private readonly store: RuntimeStateStore,
    private readonly options: {
      workspaceRoot: string;
      terminalSessionManager?: TerminalSessionManagerLike | null;
    },
  ) {}

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
    const instruction = normalizedString(params.instruction ?? params.description);
    if (!cron) {
      throw new RuntimeAgentToolsServiceError(400, "cronjob_cron_required", "cron is required");
    }
    if (!description) {
      throw new RuntimeAgentToolsServiceError(400, "cronjob_description_required", "description is required");
    }
    if (!instruction) {
      throw new RuntimeAgentToolsServiceError(400, "cronjob_instruction_required", "instruction is required");
    }
    const created = this.store.createCronjob({
      workspaceId: params.workspaceId,
      initiatedBy: normalizedString(params.initiatedBy) || "workspace_agent",
      name: normalizedString(params.name),
      cron,
      description,
      instruction,
      enabled: params.enabled !== false,
      delivery: normalizeDelivery({
        channel: normalizedString(params.delivery?.channel ?? "session_run") || "session_run",
        mode: params.delivery?.mode ?? "announce",
        to: params.delivery?.to
      }),
      metadata: metadataWithCronjobDefaults({
        metadata: params.metadata,
        holabossUserId: params.holabossUserId,
        selectedModel: params.selectedModel,
        sourceSessionId: params.sessionId,
      }),
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
    const instruction = params.instruction == null ? null : normalizedString(params.instruction);
    if (params.description !== undefined && !description) {
      throw new RuntimeAgentToolsServiceError(400, "cronjob_description_required", "description is required");
    }
    if (params.instruction !== undefined && !instruction) {
      throw new RuntimeAgentToolsServiceError(400, "cronjob_instruction_required", "instruction is required");
    }
    const updated = this.store.updateCronjob({
      jobId: params.jobId,
      name: params.name === undefined ? undefined : normalizedString(params.name),
      cron,
      description,
      instruction: resolvedInstructionForCronjobUpdate({ existing, description, instruction }),
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

  async generateImage(params: RuntimeAgentToolsGenerateImageParams): Promise<JsonObject> {
    this.requireWorkspace(params.workspaceId);
    const sessionId = normalizedString(params.sessionId) || "session-main";
    const prompt = normalizedString(params.prompt);
    if (!prompt) {
      throw new RuntimeAgentToolsServiceError(400, "image_prompt_required", "prompt is required");
    }
    try {
      const generated = await generateWorkspaceImage({
        workspaceRoot: this.options.workspaceRoot,
        workspaceId: params.workspaceId,
        sessionId,
        inputId: "runtime-tool",
        selectedModel: params.selectedModel,
        prompt,
        filename: params.filename,
        size: params.size,
      });
      return {
        file_path: generated.filePath,
        mime_type: generated.mimeType,
        size_bytes: generated.sizeBytes,
        provider_id: generated.providerId,
        model_id: generated.modelId,
        revised_prompt: generated.revisedPrompt,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        /not configured|configure an image generation provider/i.test(error.message)
      ) {
        throw new RuntimeAgentToolsServiceError(409, "image_generation_not_configured", error.message);
      }
      throw new RuntimeAgentToolsServiceError(
        502,
        "image_generation_failed",
        error instanceof Error ? error.message : "image generation failed",
      );
    }
  }

  async writeReport(params: RuntimeAgentToolsWriteReportParams): Promise<JsonObject> {
    this.requireWorkspace(params.workspaceId);
    const sessionId = normalizedString(params.sessionId);
    const content = String(params.content ?? "");
    if (!content.trim()) {
      throw new RuntimeAgentToolsServiceError(400, "report_content_required", "content is required");
    }
    const title = defaultReportTitle({
      title: params.title,
      filename: params.filename,
      content,
    });
    const { absolutePath, relativePath } = await reportOutputFilePath({
      workspaceRoot: this.options.workspaceRoot,
      workspaceId: params.workspaceId,
      title,
      filename: params.filename,
    });
    const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, normalizedContent, "utf8");

    const sizeBytes = Buffer.byteLength(normalizedContent, "utf8");
    const output = this.store.createOutput({
      workspaceId: params.workspaceId,
      outputType: "document",
      title,
      status: "completed",
      filePath: relativePath,
      sessionId: sessionId || null,
      inputId: normalizedString(params.inputId) || null,
      artifactId: randomUUID(),
      metadata: {
        origin_type: "runtime_tool",
        change_type: "created",
        category: "document",
        artifact_type: "report",
        mime_type: "text/markdown",
        size_bytes: sizeBytes,
        tool_id: "write_report",
        ...(normalizedString(params.summary)
          ? { summary: normalizedString(params.summary) }
          : {}),
        ...(normalizedString(params.selectedModel)
          ? { model: normalizedString(params.selectedModel) }
          : {}),
        ...(sessionId ? { source_session_id: sessionId } : {}),
      },
    });

    return {
      output_id: output.id,
      artifact_id: output.artifactId,
      title: output.title,
      file_path: relativePath,
      mime_type: "text/markdown",
      size_bytes: sizeBytes,
      created_at: output.createdAt,
    };
  }

  listTerminalSessions(params: RuntimeAgentToolsListTerminalSessionsParams): JsonObject {
    this.requireWorkspace(params.workspaceId);
    const sessions = this.requireTerminalSessionManager()
      .listSessions({
        workspaceId: params.workspaceId,
        sessionId: normalizedString(params.sessionId) || undefined,
        statuses: Array.isArray(params.statuses) && params.statuses.length > 0 ? params.statuses : undefined,
      })
      .map((record) => terminalSessionPayload(record));
    return { sessions, count: sessions.length };
  }

  async startTerminalSession(params: RuntimeAgentToolsStartTerminalSessionParams): Promise<JsonObject> {
    this.requireWorkspace(params.workspaceId);
    const session = await this.requireTerminalSessionManager().createSession({
      workspaceId: params.workspaceId,
      sessionId: normalizedString(params.sessionId) || null,
      inputId: normalizedString(params.inputId) || null,
      title: normalizedString(params.title) || null,
      owner: "agent",
      cwd: normalizedString(params.cwd) || null,
      command: params.command,
      cols: typeof params.cols === "number" ? params.cols : undefined,
      rows: typeof params.rows === "number" ? params.rows : undefined,
      createdBy: "runtime_tool",
      metadata: {
        origin_type: "runtime_tool",
        tool_id: "terminal_session_start",
        ...(normalizedString(params.selectedModel)
          ? { model: normalizedString(params.selectedModel) }
          : {}),
      },
    });
    return terminalSessionPayload(session);
  }

  getTerminalSession(params: RuntimeAgentToolsGetTerminalSessionParams): JsonObject {
    return terminalSessionPayload(this.requireTerminalSession(params));
  }

  readTerminalSession(params: RuntimeAgentToolsReadTerminalSessionParams): JsonObject {
    const manager = this.requireTerminalSessionManager();
    const terminal = this.requireTerminalSession(params);
    const afterSequence = normalizedInteger(params.afterSequence, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = normalizedInteger(params.limit, 200, 1, 1000);
    const events = manager.listEvents({
      terminalId: terminal.terminalId,
      afterSequence,
      limit,
    });
    return terminalSessionReadPayload({ terminal, events });
  }

  async waitTerminalSession(params: RuntimeAgentToolsWaitTerminalSessionParams): Promise<JsonObject> {
    const manager = this.requireTerminalSessionManager();
    const initialTerminal = this.requireTerminalSession(params);
    const afterSequence = normalizedInteger(params.afterSequence, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = normalizedInteger(params.limit, 200, 1, 1000);
    const timeoutMs = normalizedInteger(params.timeoutMs, 15_000, 1, 60_000);
    const immediateEvents = manager.listEvents({
      terminalId: initialTerminal.terminalId,
      afterSequence,
      limit,
    });
    if (immediateEvents.length > 0 || !["starting", "running"].includes(initialTerminal.status)) {
      const terminal = this.requireTerminalSession(params);
      return terminalSessionReadPayload({ terminal, events: immediateEvents, timedOut: false });
    }

    return await new Promise<JsonObject>((resolve) => {
      let settled = false;
      let timeoutHandle: NodeJS.Timeout | null = null;
      const finish = (timedOut: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        unsubscribe();
        const terminal = this.requireTerminalSession(params);
        const events = manager.listEvents({
          terminalId: terminal.terminalId,
          afterSequence,
          limit,
        });
        resolve(terminalSessionReadPayload({ terminal, events, timedOut }));
      };
      const unsubscribe = manager.subscribe(initialTerminal.terminalId, (event) => {
        if (event.sequence > afterSequence) {
          finish(false);
        }
      });
      timeoutHandle = setTimeout(() => {
        finish(true);
      }, timeoutMs);
    });
  }

  async sendTerminalSessionInput(params: RuntimeAgentToolsSendTerminalSessionInputParams): Promise<JsonObject> {
    this.requireTerminalSession(params);
    const session = await this.requireTerminalSessionManager().sendInput({
      terminalId: normalizedString(params.terminalId),
      data: params.data,
    });
    return terminalSessionPayload(session);
  }

  async signalTerminalSession(params: RuntimeAgentToolsSignalTerminalSessionParams): Promise<JsonObject> {
    this.requireTerminalSession(params);
    const session = await this.requireTerminalSessionManager().signal({
      terminalId: normalizedString(params.terminalId),
      signal: normalizedString(params.signal) || null,
    });
    return terminalSessionPayload(session);
  }

  async closeTerminalSession(params: RuntimeAgentToolsCloseTerminalSessionParams): Promise<JsonObject> {
    this.requireTerminalSession(params);
    const session = await this.requireTerminalSessionManager().closeSession({
      terminalId: normalizedString(params.terminalId),
    });
    return terminalSessionPayload(session);
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

  private requireTerminalSessionManager(): TerminalSessionManagerLike {
    const manager = this.options.terminalSessionManager;
    if (!manager) {
      throw new RuntimeAgentToolsServiceError(
        409,
        "terminal_sessions_unavailable",
        "terminal sessions are not available in this runtime",
      );
    }
    return manager;
  }

  private requireTerminalSession(params: {
    terminalId: string;
    workspaceId?: string | null;
  }): TerminalSessionRecord {
    const terminalId = normalizedString(params.terminalId);
    if (!terminalId) {
      throw new RuntimeAgentToolsServiceError(400, "terminal_session_id_required", "terminal_id is required");
    }
    const terminal = this.requireTerminalSessionManager().getSession({
      terminalId,
      workspaceId: normalizedString(params.workspaceId) || undefined,
    });
    if (!terminal) {
      throw new RuntimeAgentToolsServiceError(404, "terminal_session_not_found", "terminal session not found");
    }
    return terminal;
  }
}
