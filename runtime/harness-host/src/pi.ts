import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as Sentry from "@sentry/node";
import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  createFindTool,
  createGrepTool,
  createLsTool,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { Api, ImageContent, Model, TextContent } from "@mariozechner/pi-ai";
import { APIError as OpenAIApiError } from "openai";
import { createCallResult, createRuntime, type Runtime as McporterRuntime, type ServerDefinition, type ServerToolInfo } from "mcporter";
import { MODELS } from "../node_modules/@mariozechner/pi-ai/dist/models.generated.js";

import type {
  HarnessHostPiMcpToolRef,
  HarnessHostPiRequest,
  HarnessHostWorkspaceSkillPayload,
  JsonObject,
  JsonValue,
  RunnerEventType,
  RunnerOutputEventPayload,
} from "./contracts.js";
import {
  applyHarnessGenAiUsageMetrics,
  harnessGenAiSpanAttributes,
  type HarnessGenAiUsageMetrics,
} from "./harness-ai-monitoring.js";
import { buildAttachmentPromptContent } from "./attachment-prompt-content.js";
import { resolvePiDesktopBrowserToolDefinitions } from "./pi-browser-tools.js";
import { resolvePiRuntimeToolDefinitions } from "./pi-runtime-tools.js";
import { RuntimeTodoCoordinator } from "./runtime-todo-coordinator.js";
import {
  createWorkspaceBoundaryPolicy,
  workspaceBoundaryOverrideRequested,
  workspaceBoundaryViolationForToolCall,
  type WorkspaceBoundaryPolicy,
} from "./workspace-boundary.js";

const require = createRequire(import.meta.url);

export type PiMappedEvent = {
  event_type: RunnerEventType;
  payload: JsonObject;
};

export interface PiCompactionCommandResult {
  compacted: boolean;
  session_file: string;
  result?: JsonObject | null;
  reason?: string | null;
  diagnostics?: JsonObject | null;
  error?: JsonObject | null;
}

export type PiEventMapperState = {
  toolArgsByCallId: Map<string, JsonValue>;
  mcpToolMetadata: ReadonlyMap<string, PiMcpToolMetadata>;
  skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata>;
  terminalState: "completed" | "failed" | null;
  waitingForUser: boolean;
};

export interface PiSessionHandle {
  session: AgentSession;
  sessionFile: string;
  mcpToolMetadata: Map<string, PiMcpToolMetadata>;
  skillMetadataByAlias: Map<string, PiSkillMetadata>;
  dispose: () => Promise<void>;
}

export interface PiDeps {
  createSession: (request: HarnessHostPiRequest) => Promise<PiSessionHandle>;
}

type PiInternalCompactionSession = {
  _checkCompaction?: (assistantMessage: unknown, skipAbortedCheck?: boolean) => Promise<void>;
};

type PiCompactionDiagnosticsSession = {
  sessionManager?: {
    getBranch?: () => unknown[];
    getLeafId?: () => string | null;
  };
  settingsManager?: {
    getCompactionSettings?: () => unknown;
  };
  model?: {
    provider?: unknown;
    id?: unknown;
    contextWindow?: unknown;
  };
  getContextUsage?: () => unknown;
  subscribe?: (listener: (event: AgentSessionEvent) => void) => (() => void) | void;
};

type PiSnapshotPostRunCompactionSession = PiCompactionDiagnosticsSession &
  PiInternalCompactionSession & {
    agent?: {
      continue?: () => Promise<void>;
      hasQueuedMessages?: () => boolean;
    };
    messages?: unknown[];
  };

type PiPrepareCompactionResult = {
  firstKeptEntryId?: unknown;
  messagesToSummarize?: unknown;
  turnPrefixMessages?: unknown;
  isSplitTurn?: unknown;
  tokensBefore?: unknown;
  previousSummary?: unknown;
  settings?: unknown;
} | null;

type PiThinkingLevel =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
type PiRequestedThinkingLevel = PiThinkingLevel | "off";
type PiThinkingBudgetLevel = Exclude<PiThinkingLevel, "xhigh">;

interface PiThinkingSelection {
  rawValue: string | null;
  level: PiRequestedThinkingLevel | null;
  thinkingBudgets?: Partial<Record<PiThinkingBudgetLevel, number>>;
}

const PI_AGENT_STATE_DIR = ".holaboss/pi-agent";
const PI_SESSION_DIR = ".holaboss/pi-sessions";
const PI_HARNESS_CLIENT_NAME = "holaboss-pi-harness";
const PI_HARNESS_CLIENT_VERSION = "0.1.0";
const PI_MCP_DISCOVERY_RETRY_INTERVAL_MS = 250;
const PI_FALLBACK_CONTEXT_WINDOW = 65_536;
const PI_FALLBACK_MAX_TOKENS = 8_192;

type PiModelBudget = {
  contextWindow: number;
  maxTokens: number;
};

type PiModelCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

type PiCatalogModelEntry = {
  contextWindow?: unknown;
  maxTokens?: unknown;
  cost?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
  };
};

const PI_MODEL_CATALOG = MODELS as Record<
  string,
  Record<string, PiCatalogModelEntry>
>;
const PI_MCP_DISCOVERY_MAX_WAIT_MS = 10000;
let cachedPrepareCompactionFnPromise:
  | Promise<((entries: unknown[], settings: unknown) => PiPrepareCompactionResult) | null>
  | null = null;

export interface PiMcpToolMetadata {
  piToolName: string;
  serverId: string;
  toolId: string;
  toolName: string;
}

export interface PiSkillMetadata {
  skillId: string;
  skillName: string;
  filePath: string;
  baseDir: string;
  grantedTools: string[];
  grantedCommands: string[];
}

export interface PiSkillWideningState {
  scope: "run";
  managedToolNames: Set<string>;
  grantedToolNames: Set<string>;
  skillIdsByManagedTool: ReadonlyMap<string, ReadonlySet<string>>;
  managedCommandIds: Set<string>;
  grantedCommandIds: Set<string>;
  skillIdsByManagedCommand: ReadonlyMap<string, ReadonlySet<string>>;
}

type PiWorkspaceBoundaryPolicy = WorkspaceBoundaryPolicy;

export type PiMcpServerBinding = {
  serverId: string;
  timeoutMs: number;
  definition: ServerDefinition;
};

export type PiMcpToolset = {
  runtime: McporterRuntime | null;
  customTools: ToolDefinition[];
  mcpToolMetadata: Map<string, PiMcpToolMetadata>;
};

export interface PiPromptPayload {
  text: string;
  images: ImageContent[];
}

function runtimeContextMessagesBlock(request: HarnessHostPiRequest): string {
  const messages = Array.isArray(request.context_messages)
    ? request.context_messages.map((message) => message.trim()).filter(Boolean)
    : [];
  if (messages.length === 0) {
    return "";
  }
  return [
    "Runtime context:",
    ...messages.map((message, index) =>
      [`[Runtime Context ${index + 1}]`, message, `[/Runtime Context ${index + 1}]`].join("\n")
    ),
  ].join("\n\n");
}

export async function buildPiPromptPayload(request: HarnessHostPiRequest): Promise<PiPromptPayload> {
  const sections: string[] = [];
  const quotedSkillBlocks = Array.isArray(request.quoted_skill_blocks)
    ? request.quoted_skill_blocks.map((block) => block.trim()).filter(Boolean)
    : [];
  const missingQuotedSkillIds = Array.isArray(request.missing_quoted_skill_ids)
    ? request.missing_quoted_skill_ids.map((skillId) => skillId.trim()).filter(Boolean)
    : [];
  if (quotedSkillBlocks.length > 0) {
    sections.push(["Quoted workspace skills:", ...quotedSkillBlocks].join("\n\n"));
  }
  if (missingQuotedSkillIds.length > 0) {
    sections.push(
      `Quoted workspace skills not found in this workspace: ${missingQuotedSkillIds.join(", ")}`
    );
  }

  const instruction = request.instruction.trim();
  if (instruction) {
    sections.push(instruction);
  }

  const runtimeContextBlock = runtimeContextMessagesBlock(request);
  if (runtimeContextBlock) {
    sections.push(runtimeContextBlock);
  }

  const attachmentPromptContent = await buildAttachmentPromptContent({
    workspaceDir: request.workspace_dir,
    attachments: request.attachments,
  });
  sections.push(...attachmentPromptContent.sections);

  const text = sections.join("\n\n").trim() || "Review the attached files.";
  return { text, images: attachmentPromptContent.images };
}

export async function promptTextForRequest(request: HarnessHostPiRequest): Promise<string> {
  return (await buildPiPromptPayload(request)).text;
}

export async function promptImagesForRequest(request: HarnessHostPiRequest): Promise<ImageContent[]> {
  return (await buildPiPromptPayload(request)).images;
}

export async function promptContentForRequest(request: HarnessHostPiRequest): Promise<Array<TextContent | ImageContent>> {
  const prompt = await buildPiPromptPayload(request);
  return [{ type: "text", text: prompt.text }, ...prompt.images];
}

function emitRunnerEvent(
  request: HarnessHostPiRequest,
  sequence: number,
  eventType: RunnerEventType,
  payload: JsonObject
): void {
  const event: RunnerOutputEventPayload = {
    session_id: request.session_id,
    input_id: request.input_id,
    sequence,
    event_type: eventType,
    payload,
  };
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOpenAiCompatErrorResponse(errorResponse: unknown): Object | undefined {
  if (isRecord(errorResponse)) {
    return errorResponse;
  }
  if (!Array.isArray(errorResponse)) {
    return undefined;
  }
  for (const item of errorResponse) {
    if (isRecord(item) && isRecord(item.error)) {
      return item;
    }
  }
  return undefined;
}

let openAiApiErrorGeneratePatched = false;

function patchOpenAiApiErrorGenerate(): void {
  if (openAiApiErrorGeneratePatched) {
    return;
  }
  const originalGenerate = OpenAIApiError.generate.bind(OpenAIApiError);
  OpenAIApiError.generate = ((status, errorResponse, message, headers) =>
    originalGenerate(status, normalizeOpenAiCompatErrorResponse(errorResponse), message, headers)) as typeof OpenAIApiError.generate;
  openAiApiErrorGeneratePatched = true;
}

patchOpenAiApiErrorGenerate();

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonValue(item));
  }
  if (value && typeof value === "object") {
    try {
      return JSON.parse(JSON.stringify(value)) as JsonValue;
    } catch {
      return String(value);
    }
  }
  return value === undefined ? null : String(value);
}

function jsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumFiniteNumbers(...values: Array<number | null | undefined>): number | null {
  const present = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (present.length === 0) {
    return null;
  }
  return present.reduce((total, value) => total + value, 0);
}

function piUsageMetricsFromAssistantMessage(
  message: unknown,
): HarnessGenAiUsageMetrics | null {
  if (!isRecord(message) || message.role !== "assistant" || !isRecord(message.usage)) {
    return null;
  }
  const usage = message.usage;
  const uncachedInputTokens = finiteNumberOrNull(usage.input) ?? 0;
  const cachedInputTokens = finiteNumberOrNull(usage.cacheRead) ?? 0;
  const cacheWriteInputTokens = finiteNumberOrNull(usage.cacheWrite) ?? 0;
  const outputTokens = finiteNumberOrNull(usage.output) ?? 0;
  const inputCostUsd =
    isRecord(usage.cost) ? finiteNumberOrNull(usage.cost.input) : null;
  const outputCostUsd =
    isRecord(usage.cost) ? finiteNumberOrNull(usage.cost.output) : null;
  const totalCostUsd =
    (isRecord(usage.cost) ? finiteNumberOrNull(usage.cost.total) : null) ??
    sumFiniteNumbers(
      inputCostUsd,
      outputCostUsd,
      isRecord(usage.cost) ? finiteNumberOrNull(usage.cost.cacheRead) : null,
      isRecord(usage.cost) ? finiteNumberOrNull(usage.cost.cacheWrite) : null,
    );
  return {
    inputTokens: uncachedInputTokens + cachedInputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    totalTokens:
      finiteNumberOrNull(usage.totalTokens) ??
      uncachedInputTokens +
        cachedInputTokens +
        cacheWriteInputTokens +
        outputTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd,
  };
}

function mergeHarnessUsageMetrics(
  current: HarnessGenAiUsageMetrics | null,
  next: HarnessGenAiUsageMetrics | null,
): HarnessGenAiUsageMetrics | null {
  if (!next) {
    return current;
  }
  if (!current) {
    return { ...next };
  }
  return {
    inputTokens: (current.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (current.outputTokens ?? 0) + (next.outputTokens ?? 0),
    cachedInputTokens:
      (current.cachedInputTokens ?? 0) + (next.cachedInputTokens ?? 0),
    cacheWriteInputTokens:
      (current.cacheWriteInputTokens ?? 0) +
      (next.cacheWriteInputTokens ?? 0),
    totalTokens: (current.totalTokens ?? 0) + (next.totalTokens ?? 0),
    inputCostUsd: sumFiniteNumbers(current.inputCostUsd, next.inputCostUsd),
    outputCostUsd: sumFiniteNumbers(
      current.outputCostUsd,
      next.outputCostUsd,
    ),
    totalCostUsd: sumFiniteNumbers(current.totalCostUsd, next.totalCostUsd),
  };
}

function tokenUsagePayloadFromHarnessUsage(
  usage: HarnessGenAiUsageMetrics | null,
): JsonObject | null {
  if (!usage) {
    return null;
  }
  const inputTokens = usage.inputTokens ?? 0;
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const cacheWriteInputTokens = usage.cacheWriteInputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens =
    usage.totalTokens ??
    inputTokens + cacheWriteInputTokens + outputTokens;
  const payload: Record<string, JsonValue> = {
    input_tokens: inputTokens,
    uncached_input_tokens: Math.max(0, inputTokens - cachedInputTokens),
    output_tokens: outputTokens,
    cached_input_tokens: cachedInputTokens,
    cache_write_input_tokens: cacheWriteInputTokens,
    total_tokens: totalTokens,
  };
  if (usage.inputCostUsd !== null && usage.inputCostUsd !== undefined) {
    payload.cost_input_usd = usage.inputCostUsd;
  }
  if (usage.outputCostUsd !== null && usage.outputCostUsd !== undefined) {
    payload.cost_output_usd = usage.outputCostUsd;
  }
  if (usage.totalCostUsd !== null && usage.totalCostUsd !== undefined) {
    payload.estimated_cost_usd = usage.totalCostUsd;
  }
  return jsonObject(payload);
}

function requestDefaultHeaderValue(
  request: Pick<HarnessHostPiRequest, "model_client">,
  headerName: string,
): string | null {
  if (!isRecord(request.model_client.default_headers)) {
    return null;
  }
  const expected = headerName.trim().toLowerCase();
  for (const [key, value] of Object.entries(request.model_client.default_headers)) {
    if (key.trim().toLowerCase() === expected && typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || null;
    }
  }
  return null;
}

function summarizeCompactionBranchEntry(entry: unknown): JsonObject | null {
  if (!isRecord(entry)) {
    return null;
  }
  const message = isRecord(entry.message) ? entry.message : null;
  return {
    id: optionalTrimmedString(entry.id),
    parent_id: optionalTrimmedString(entry.parentId),
    type: optionalTrimmedString(entry.type),
    timestamp: optionalTrimmedString(entry.timestamp),
    role: optionalTrimmedString(message?.role),
    custom_type: optionalTrimmedString(entry.customType),
    first_kept_entry_id: optionalTrimmedString(entry.firstKeptEntryId),
  };
}

function latestCompactionBranchEntry(branch: unknown[]): Record<string, unknown> | null {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (isRecord(entry) && entry.type === "compaction") {
      return entry;
    }
  }
  return null;
}

async function loadPrepareCompactionFn():
  Promise<((entries: unknown[], settings: unknown) => PiPrepareCompactionResult) | null> {
  if (cachedPrepareCompactionFnPromise) {
    return cachedPrepareCompactionFnPromise;
  }
  cachedPrepareCompactionFnPromise = (async () => {
    try {
      const packageEntry = require.resolve("@mariozechner/pi-coding-agent");
      const modulePath = path.join(
        path.dirname(packageEntry),
        "core",
        "compaction",
        "compaction.js",
      );
      const module = (await import(pathToFileURL(modulePath).href)) as {
        prepareCompaction?: (entries: unknown[], settings: unknown) => PiPrepareCompactionResult;
      };
      return typeof module.prepareCompaction === "function"
        ? module.prepareCompaction
        : null;
    } catch {
      return null;
    }
  })();
  return cachedPrepareCompactionFnPromise;
}

function summarizeCompactionPreparation(
  preparation: PiPrepareCompactionResult,
  branch: unknown[],
): JsonObject {
  if (!preparation || !isRecord(preparation)) {
    return {
      status: "none",
    };
  }
  const firstKeptEntryId = optionalTrimmedString(preparation.firstKeptEntryId);
  const firstKeptEntryIndex = firstKeptEntryId
    ? branch.findIndex(
        (entry) => isRecord(entry) && optionalTrimmedString(entry.id) === firstKeptEntryId,
      )
    : -1;
  const firstKeptEntry =
    firstKeptEntryIndex >= 0 ? summarizeCompactionBranchEntry(branch[firstKeptEntryIndex]) : null;
  const previousEntry =
    firstKeptEntryIndex > 0
      ? summarizeCompactionBranchEntry(branch[firstKeptEntryIndex - 1])
      : null;
  return {
    status: "ready",
    first_kept_entry_id: firstKeptEntryId,
    first_kept_entry_index: firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : null,
    first_kept_entry: firstKeptEntry,
    previous_entry: previousEntry,
    is_split_turn:
      typeof preparation.isSplitTurn === "boolean" ? preparation.isSplitTurn : null,
    tokens_before: finiteNumberOrNull(preparation.tokensBefore),
    messages_to_summarize_count: Array.isArray(preparation.messagesToSummarize)
      ? preparation.messagesToSummarize.length
      : null,
    turn_prefix_message_count: Array.isArray(preparation.turnPrefixMessages)
      ? preparation.turnPrefixMessages.length
      : null,
    previous_summary_length:
      typeof preparation.previousSummary === "string"
        ? preparation.previousSummary.length
        : null,
    settings: isRecord(preparation.settings)
      ? jsonObject(preparation.settings)
      : null,
  };
}

async function collectPiCompactionDiagnostics(
  session: PiCompactionDiagnosticsSession,
): Promise<JsonObject | null> {
  const branch = session.sessionManager?.getBranch?.();
  if (!Array.isArray(branch)) {
    return null;
  }
  const latestCompaction = latestCompactionBranchEntry(branch);
  const diagnostics: Record<string, unknown> = {
    branch_entry_count: branch.length,
    leaf_id: session.sessionManager?.getLeafId?.() ?? null,
    branch_tail: branch.slice(-6).map((entry) => summarizeCompactionBranchEntry(entry)),
    latest_compaction: latestCompaction
      ? {
          id: optionalTrimmedString(latestCompaction.id),
          first_kept_entry_id: optionalTrimmedString(latestCompaction.firstKeptEntryId),
          timestamp: optionalTrimmedString(latestCompaction.timestamp),
        }
      : null,
    model: session.model
      ? {
          provider: optionalTrimmedString(session.model.provider),
          id: optionalTrimmedString(session.model.id),
          context_window: finiteNumberOrNull(session.model.contextWindow),
        }
      : null,
    context_usage: jsonValue(session.getContextUsage?.() ?? null),
  };

  const settings = session.settingsManager?.getCompactionSettings?.();
  if (isRecord(settings)) {
    diagnostics.compaction_settings = jsonObject(settings);
  }

  const prepareCompaction = await loadPrepareCompactionFn();
  if (!prepareCompaction || !settings) {
    diagnostics.preparation = {
      status: prepareCompaction ? "unavailable_settings" : "unavailable_helper",
    };
    return jsonObject(diagnostics);
  }

  try {
    diagnostics.preparation = summarizeCompactionPreparation(
      prepareCompaction(branch, settings),
      branch,
    );
  } catch (error) {
    diagnostics.preparation = {
      status: "error",
      message: sdkErrorMessage(error, "Failed to compute compaction preparation"),
    };
  }
  return jsonObject(diagnostics);
}

function summarizeCompactionEventResult(value: unknown): JsonObject | null {
  if (!isRecord(value)) {
    return null;
  }
  const summary = optionalTrimmedString(value.summary);
  return {
    first_kept_entry_id: optionalTrimmedString(value.firstKeptEntryId),
    tokens_before: finiteNumberOrNull(value.tokensBefore),
    summary_length: summary ? summary.length : null,
    details: isRecord(value.details) ? jsonObject(value.details) : jsonValue(value.details),
  };
}

function summarizeCompactionEvent(event: AgentSessionEvent): JsonObject | null {
  if (event.type === "compaction_start") {
    return {
      type: "compaction_start",
      reason: optionalTrimmedString(event.reason),
    };
  }
  if (event.type === "compaction_end") {
    return {
      type: "compaction_end",
      reason: optionalTrimmedString(event.reason),
      aborted: typeof event.aborted === "boolean" ? event.aborted : null,
      will_retry: typeof event.willRetry === "boolean" ? event.willRetry : null,
      error_message: optionalTrimmedString(event.errorMessage),
      result: summarizeCompactionEventResult(event.result),
    };
  }
  return null;
}

function withCompactionEventDiagnostics(
  diagnostics: JsonObject | null,
  compactionStart: JsonObject | null,
  compactionEnd: JsonObject | null,
): JsonObject | null {
  if (!diagnostics && !compactionStart && !compactionEnd) {
    return null;
  }
  const next: Record<string, unknown> = diagnostics ? { ...diagnostics } : {};
  if (compactionStart) {
    next.compaction_start = compactionStart;
  }
  if (compactionEnd) {
    next.compaction_end = compactionEnd;
  }
  return jsonObject(next);
}

function summarizePiCompactionError(
  error: unknown,
  compactionEnd: JsonObject | null,
): JsonObject {
  const record = isRecord(error) ? error : null;
  return {
    name:
      (error instanceof Error && error.name.trim()) ||
      optionalTrimmedString(record?.name) ||
      "Error",
    message: sdkErrorMessage(error, "Pi compaction failed"),
    provider_message:
      extractProviderErrorMessage(record?.error ?? record?.body ?? record?.cause ?? error) ??
      sdkErrorMessage(error, "Pi compaction failed"),
    status_code:
      finiteNumberOrNull(record?.status) ?? finiteNumberOrNull(record?.statusCode),
    code:
      optionalTrimmedString(record?.code) ??
      optionalTrimmedString(record?.error && isRecord(record.error) ? record.error.code : null),
    type:
      optionalTrimmedString(record?.type) ??
      optionalTrimmedString(record?.error && isRecord(record.error) ? record.error.type : null),
    param:
      optionalTrimmedString(record?.param) ??
      optionalTrimmedString(record?.error && isRecord(record.error) ? record.error.param : null),
    request_id:
      optionalTrimmedString(record?.request_id) ??
      optionalTrimmedString(record?.requestId),
    headers: isRecord(record?.headers) ? jsonObject(stringRecord(record.headers)) : null,
    error: isRecord(record?.error) ? jsonObject(record.error) : jsonValue(record?.error),
    body: isRecord(record?.body) ? jsonObject(record.body) : jsonValue(record?.body),
    cause: isRecord(record?.cause) ? jsonObject(record.cause) : jsonValue(record?.cause),
    stack_preview:
      error instanceof Error && typeof error.stack === "string"
        ? error.stack.split("\n").slice(0, 8).join("\n")
        : null,
    compaction_end: compactionEnd,
  };
}

function latestCompactionId(session: PiCompactionDiagnosticsSession): string | null {
  const branch = session.sessionManager?.getBranch?.();
  if (!Array.isArray(branch)) {
    return null;
  }
  return optionalTrimmedString(latestCompactionBranchEntry(branch)?.id);
}

function compactionResultFromBranchEntry(entry: Record<string, unknown> | null): JsonObject | null {
  if (!entry) {
    return null;
  }
  const summary = optionalTrimmedString(entry.summary);
  const firstKeptEntryId = optionalTrimmedString(entry.firstKeptEntryId);
  const tokensBefore = finiteNumberOrNull(entry.tokensBefore);
  if (!summary || !firstKeptEntryId || tokensBefore === null) {
    return null;
  }
  return {
    summary,
    firstKeptEntryId,
    tokensBefore,
    details: isRecord(entry.details) ? jsonObject(entry.details) : jsonValue(entry.details),
  };
}

function findLastAssistantMessage(session: PiSnapshotPostRunCompactionSession): unknown | null {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isRecord(message) && message.role === "assistant") {
      return message;
    }
  }
  return null;
}

function suppressSnapshotCompactionContinuation(session: PiSnapshotPostRunCompactionSession): void {
  if (!session.agent) {
    return;
  }
  session.agent.continue = async () => {};
  session.agent.hasQueuedMessages = () => false;
}

type SnapshotPostRunMaintenanceOutcome =
  | { kind: "unsupported" }
  | { kind: "compacted"; result: JsonObject }
  | { kind: "not_compacted"; reason: string | null }
  | { kind: "error"; error: unknown };

async function runSnapshotPostRunMaintenanceCompaction(
  session: PiSnapshotPostRunCompactionSession,
): Promise<SnapshotPostRunMaintenanceOutcome> {
  if (typeof session._checkCompaction !== "function") {
    return { kind: "unsupported" };
  }
  const lastAssistant = findLastAssistantMessage(session);
  if (!lastAssistant) {
    return { kind: "not_compacted", reason: "not_needed" };
  }
  const beforeCompactionId = latestCompactionId(session);
  suppressSnapshotCompactionContinuation(session);
  try {
    await session._checkCompaction.call(session, lastAssistant);
  } catch (error) {
    return { kind: "error", error };
  }
  const branch = session.sessionManager?.getBranch?.();
  const latestCompaction = Array.isArray(branch) ? latestCompactionBranchEntry(branch) : null;
  const afterCompactionId = optionalTrimmedString(latestCompaction?.id);
  if (!afterCompactionId || afterCompactionId === beforeCompactionId) {
    return { kind: "not_compacted", reason: "not_needed" };
  }
  const result = compactionResultFromBranchEntry(latestCompaction);
  if (!result) {
    return {
      kind: "error",
      error: new Error("Snapshot post-run compaction appended an invalid compaction entry"),
    };
  }
  return { kind: "compacted", result };
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function sdkErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function resolvePiStateDir(workspaceDir: string): string {
  return path.join(workspaceDir, PI_AGENT_STATE_DIR);
}

function resolvePiSessionDir(workspaceDir: string): string {
  return path.join(workspaceDir, PI_SESSION_DIR);
}

function normalizeSkillLookupToken(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function effectiveSystemPromptForRequest(request: HarnessHostPiRequest): string {
  return request.system_prompt.trim();
}

/*
function commandBoundaryViolation(command: string, policy: PiWorkspaceBoundaryPolicy): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }
  if (policy.overrideRequested) {
    return null;
  }

  const tokens = commandTokens(trimmed);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const normalized = token.toLowerCase();
    if (normalized === "cd") {
      const destination = tokens[index + 1] ?? "";
      if (commandPathLooksExternal(destination)) {
        return `command uses external directory '${destination}'`;
      }
      const resolved = resolvePathWithinWorkspace(policy, destination);
      if (destination.trim() && !resolved) {
        return `command changes directory outside workspace: '${destination}'`;
      }
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
  }
  return null;
}

function workspaceBoundaryViolationForCommand(command: string, policy: PiWorkspaceBoundaryPolicy): string | null {
  const trimmed = command.trim();
  if (!trimmed || policy.overrideRequested) {
    return null;
  }

  const baselineViolation = commandBoundaryViolation(trimmed, policy);
  if (baselineViolation) {
    return baselineViolation;
  }

  const tokens = commandTokens(trimmed);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const normalized = token.toLowerCase();

    if (normalized === "cd") {
      const destination = tokens[index + 1] ?? "";
      if (commandPathLooksExternal(destination)) {
        return `command uses external directory '${destination}'`;
      }
      const resolved = resolvePathWithinWorkspace(policy, destination);
      if (destination.trim() && !resolved) {
        return `command changes directory outside workspace: '${destination}'`;
      }
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      const repositoryRoot = tokens[index + 2] ?? "";
      if (!repositoryRoot.trim()) {
        continue;
      }
      if (commandPathLooksExternal(repositoryRoot)) {
        return `git command points outside workspace: '${repositoryRoot}'`;
      }
      if (!resolvePathWithinWorkspace(policy, repositoryRoot)) {
        return `git command points outside workspace: '${repositoryRoot}'`;
      }
      continue;
    }

    for (const candidate of pathCandidatesFromCommandToken(token)) {
      if (!candidate) {
        continue;
      }
      if (commandPathLooksExternal(candidate)) {
        return `command references outside-workspace path '${candidate}'`;
      }
      const hasPathSignal =
        path.isAbsolute(candidate) ||
        candidate.includes("/") ||
        candidate.includes("\\") ||
        candidate.startsWith(".");
      if (!hasPathSignal) {
        continue;
      }
      if (!resolvePathWithinWorkspace(policy, candidate)) {
        return `command references outside-workspace path '${candidate}'`;
      }
    }
  }
  return null;
}

function workspacePathViolationForValue(
  value: string,
  pathRef: string,
  policy: PiWorkspaceBoundaryPolicy
): string | null {
  const trimmed = value.trim();
  if (!trimmed || policy.overrideRequested) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return null;
  }
  if (commandPathLooksExternal(trimmed)) {
    return `${pathRef} points outside workspace: '${trimmed}'`;
  }
  if (!resolvePathWithinWorkspace(policy, trimmed)) {
    return `${pathRef} points outside workspace: '${trimmed}'`;
  }
  return null;
}

export function workspaceBoundaryViolationForToolCall(params: {
  toolName: string;
  toolParams: unknown;
  policy: PiWorkspaceBoundaryPolicy;
}): string | null {
  const normalizedToolName = params.toolName.trim().toLowerCase();
  if (!normalizedToolName) {
    return null;
  }
  if (!shouldEnforceWorkspaceBoundaryForTool(normalizedToolName)) {
    return null;
  }
  if (params.policy.overrideRequested) {
    return null;
  }
  if (!isRecord(params.toolParams)) {
    return null;
  }

  const queue: Array<{ value: unknown; ref: string }> = [{ value: params.toolParams, ref: "params" }];
  while (queue.length > 0) {
    const current = queue.shift() as { value: unknown; ref: string };
    if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) => queue.push({ value: entry, ref: `${current.ref}[${index}]` }));
      continue;
    }
    if (!isRecord(current.value)) {
      continue;
    }

    for (const [key, value] of Object.entries(current.value)) {
      const childRef = `${current.ref}.${key}`;
      if (typeof value === "string") {
        if (TOOL_COMMAND_KEY_PATTERN.test(key)) {
          const violation = workspaceBoundaryViolationForCommand(value, params.policy);
          if (violation) {
            return violation;
          }
        }
        if (WORKSPACE_PATH_KEY_PATTERN.test(key)) {
          const violation = workspacePathViolationForValue(value, childRef, params.policy);
          if (violation) {
            return violation;
          }
        }
      } else if (value && typeof value === "object") {
        queue.push({ value, ref: childRef });
      }
    }
  }

  return null;
}
*/

function normalizeWorkspaceCommandId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function workspaceCommandIdsFromRunStartedPayload(payload: JsonObject): string[] {
  const raw = Array.isArray(payload.workspace_command_ids) ? payload.workspace_command_ids : [];
  return [...new Set(raw.map((commandId) => normalizeWorkspaceCommandId(commandId)).filter((commandId): commandId is string => Boolean(commandId)))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function uniqueSkillMetadata(skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata>): PiSkillMetadata[] {
  const bySkillId = new Map<string, PiSkillMetadata>();
  for (const metadata of skillMetadataByAlias.values()) {
    if (!bySkillId.has(metadata.skillId)) {
      bySkillId.set(metadata.skillId, metadata);
    }
  }
  return [...bySkillId.values()].sort((left, right) => left.skillId.localeCompare(right.skillId));
}

function createPiSkillWideningState(
  skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata>,
  availableToolNames: string[],
  availableCommandIds: string[]
): PiSkillWideningState {
  const available = new Set(availableToolNames.map((toolName) => toolName.trim().toLowerCase()).filter(Boolean));
  const availableCommands = new Set(availableCommandIds.map((commandId) => commandId.trim().toLowerCase()).filter(Boolean));
  const skillIdsByManagedToolMutable = new Map<string, Set<string>>();
  const skillIdsByManagedCommandMutable = new Map<string, Set<string>>();
  for (const metadata of uniqueSkillMetadata(skillMetadataByAlias)) {
    for (const toolName of metadata.grantedTools) {
      if (!available.has(toolName) || toolName === "skill") {
        continue;
      }
      const skillIds = skillIdsByManagedToolMutable.get(toolName) ?? new Set<string>();
      skillIds.add(metadata.skillId);
      skillIdsByManagedToolMutable.set(toolName, skillIds);
    }
    for (const commandId of metadata.grantedCommands) {
      if (!availableCommands.has(commandId)) {
        continue;
      }
      const skillIds = skillIdsByManagedCommandMutable.get(commandId) ?? new Set<string>();
      skillIds.add(metadata.skillId);
      skillIdsByManagedCommandMutable.set(commandId, skillIds);
    }
  }
  const skillIdsByManagedTool = new Map<string, ReadonlySet<string>>(
    [...skillIdsByManagedToolMutable.entries()].map(([toolName, skillIds]) => [toolName, new Set(skillIds)])
  );
  const skillIdsByManagedCommand = new Map<string, ReadonlySet<string>>(
    [...skillIdsByManagedCommandMutable.entries()].map(([commandId, skillIds]) => [commandId, new Set(skillIds)])
  );
  return {
    scope: "run",
    managedToolNames: new Set(skillIdsByManagedTool.keys()),
    grantedToolNames: new Set(),
    skillIdsByManagedTool,
    managedCommandIds: new Set(skillIdsByManagedCommand.keys()),
    grantedCommandIds: new Set(),
    skillIdsByManagedCommand,
  };
}

function requiredSkillIdsForTool(state: PiSkillWideningState, toolName: string): string[] {
  return [...(state.skillIdsByManagedTool.get(toolName) ?? new Set<string>())].sort((left, right) =>
    left.localeCompare(right)
  );
}

function activeGrantedTools(state: PiSkillWideningState): string[] {
  return [...state.grantedToolNames].sort((left, right) => left.localeCompare(right));
}

function activeGrantedCommands(state: PiSkillWideningState): string[] {
  return [...state.grantedCommandIds].sort((left, right) => left.localeCompare(right));
}

function addSkillAlias(aliasMap: Map<string, PiSkillMetadata>, alias: unknown, metadata: PiSkillMetadata): void {
  const normalized = normalizeSkillLookupToken(alias);
  if (!normalized || aliasMap.has(normalized)) {
    return;
  }
  aliasMap.set(normalized, metadata);
}

function buildPiSkillMetadataByAlias(skills: HarnessHostWorkspaceSkillPayload[]): Map<string, PiSkillMetadata> {
  const aliasMap = new Map<string, PiSkillMetadata>();
  for (const skill of skills) {
    const metadata: PiSkillMetadata = {
      skillId: skill.skill_id,
      skillName: skill.skill_name,
      filePath: skill.file_path,
      baseDir: skill.source_dir,
      grantedTools: [...skill.granted_tools],
      grantedCommands: [...skill.granted_commands],
    };
    addSkillAlias(aliasMap, skill.skill_id, metadata);
    addSkillAlias(aliasMap, skill.skill_name, metadata);
  }
  return aliasMap;
}

function resolveSkillMetadata(
  skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata>,
  requestedName: unknown
): PiSkillMetadata | null {
  const normalizedName = normalizeSkillLookupToken(requestedName);
  if (!normalizedName) {
    return null;
  }
  return skillMetadataByAlias.get(normalizedName) ?? null;
}

function uniqueNormalizedStrings(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map((value) => normalizeSkillLookupToken(value)).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function applySkillWideningGrantsFromLists(
  skillWideningState: PiSkillWideningState,
  grantedTools: string[],
  grantedCommands: string[]
): { grantedTools: string[]; grantedCommands: string[] } {
  const newlyGrantedTools: string[] = [];
  const newlyGrantedCommands: string[] = [];
  for (const toolName of grantedTools) {
    if (!skillWideningState.managedToolNames.has(toolName)) {
      continue;
    }
    if (!skillWideningState.grantedToolNames.has(toolName)) {
      newlyGrantedTools.push(toolName);
    }
    skillWideningState.grantedToolNames.add(toolName);
  }
  for (const commandId of grantedCommands) {
    if (!skillWideningState.managedCommandIds.has(commandId)) {
      continue;
    }
    if (!skillWideningState.grantedCommandIds.has(commandId)) {
      newlyGrantedCommands.push(commandId);
    }
    skillWideningState.grantedCommandIds.add(commandId);
  }
  return {
    grantedTools: newlyGrantedTools.sort((left, right) => left.localeCompare(right)),
    grantedCommands: newlyGrantedCommands.sort((left, right) => left.localeCompare(right)),
  };
}

function wrapRuntimeSkillTool<TTool extends { name: string; execute: (...args: any[]) => Promise<any> }>(
  tool: TTool,
  skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata>,
  skillWideningState: PiSkillWideningState,
  workspaceBoundaryPolicy: PiWorkspaceBoundaryPolicy
): TTool {
  if (tool.name.trim().toLowerCase() !== "skill") {
    return tool;
  }

  const originalExecute = tool.execute.bind(tool);
  const wrapped: TTool = {
    ...tool,
    execute: (async (...args: any[]) => {
      const toolParams = isRecord(args[1]) ? args[1] : {};
      const requestedName = optionalTrimmedString(toolParams.name);
      const runtimeResult = await originalExecute(...args);
      const details = isRecord(runtimeResult?.details) ? runtimeResult.details : {};
      const resolvedSkill =
        resolveSkillMetadata(skillMetadataByAlias, details.skill_id) ??
        resolveSkillMetadata(skillMetadataByAlias, details.skill_name) ??
        resolveSkillMetadata(skillMetadataByAlias, requestedName);
      const grantedTools = uniqueNormalizedStrings(details.granted_tools ?? resolvedSkill?.grantedTools ?? []);
      const grantedCommands = uniqueNormalizedStrings(details.granted_commands ?? resolvedSkill?.grantedCommands ?? []);
      const wideningGrant = applySkillWideningGrantsFromLists(
        skillWideningState,
        grantedTools,
        grantedCommands
      );
      return {
        ...runtimeResult,
        details: {
          ...details,
          invocation_type: "skill",
          requested_name: requestedName ?? optionalTrimmedString(details.requested_name),
          skill_id: optionalTrimmedString(details.skill_id) ?? resolvedSkill?.skillId ?? null,
          skill_name: optionalTrimmedString(details.skill_name) ?? resolvedSkill?.skillName ?? requestedName ?? null,
          skill_file_path: optionalTrimmedString(details.skill_file_path) ?? resolvedSkill?.filePath ?? null,
          skill_base_dir: optionalTrimmedString(details.skill_base_dir) ?? resolvedSkill?.baseDir ?? null,
          args: optionalTrimmedString(details.args) ?? optionalTrimmedString(toolParams.args),
          granted_tools: grantedTools,
          granted_commands: grantedCommands,
          policy_widening: {
            scope: skillWideningState.scope,
            managed_tools: [...skillWideningState.managedToolNames].sort((left, right) => left.localeCompare(right)),
            granted_tools: wideningGrant.grantedTools,
            active_granted_tools: activeGrantedTools(skillWideningState),
            managed_commands: [...skillWideningState.managedCommandIds].sort((left, right) => left.localeCompare(right)),
            granted_commands: wideningGrant.grantedCommands,
            active_granted_commands: activeGrantedCommands(skillWideningState),
            workspace_boundary_override: workspaceBoundaryPolicy.overrideRequested,
          },
        },
      };
    }) as TTool["execute"],
  };
  return wrapped;
}

function wrapToolWithSkillWidening<TTool extends { name: string; execute: (...args: any[]) => Promise<any> }>(
  tool: TTool,
  state: PiSkillWideningState
): TTool {
  const normalizedName = tool.name.trim().toLowerCase();
  if (!state.managedToolNames.has(normalizedName)) {
    return tool;
  }

  const originalExecute = tool.execute.bind(tool);
  const wrapped: TTool = {
    ...tool,
    execute: (async (...args: any[]) => {
      if (!state.grantedToolNames.has(normalizedName)) {
        const requiredSkills = requiredSkillIdsForTool(state, normalizedName);
        const requiredSegment =
          requiredSkills.length > 0 ? ` by invoking one of: ${requiredSkills.join(", ")}` : "";
        throw new Error(
          `permission denied by skill policy: tool "${tool.name}" is gated and must be widened${requiredSegment}`
        );
      }
      return await originalExecute(...args);
    }) as TTool["execute"],
  };
  return wrapped;
}

function wrapToolWithWorkspaceBoundary<TTool extends { name: string; execute: (...args: any[]) => Promise<any> }>(
  tool: TTool,
  policy: PiWorkspaceBoundaryPolicy
): TTool {
  const originalExecute = tool.execute.bind(tool);
  const wrapped: TTool = {
    ...tool,
    execute: (async (...args: any[]) => {
      const toolParams = args[1];
      const violation = workspaceBoundaryViolationForToolCall({
        toolName: tool.name,
        toolParams,
        policy,
      });
      if (violation) {
        throw new Error(
          `permission denied by workspace boundary policy: ${violation}. Ask the user to explicitly insist if outside-workspace access is required.`
        );
      }
      return await originalExecute(...args);
    }) as TTool["execute"],
  };
  return wrapped;
}

function resolveRequestedSessionFile(request: HarnessHostPiRequest): string | null {
  const candidate = firstNonEmptyString(request.harness_session_id, request.persisted_harness_session_id);
  if (!candidate) {
    return null;
  }
  const resolved = path.resolve(candidate);
  return fs.existsSync(resolved) ? resolved : null;
}

function sanitizePiToolNameSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "tool";
}

export function buildPiMcpToolName(serverId: string, toolName: string): string {
  return `mcp__${sanitizePiToolNameSegment(serverId)}__${sanitizePiToolNameSegment(toolName)}`;
}

function uniquePiMcpToolName(serverId: string, toolName: string, usedNames: ReadonlySet<string>): string {
  const baseName = buildPiMcpToolName(serverId, toolName);
  if (!usedNames.has(baseName)) {
    return baseName;
  }
  let suffix = 2;
  while (usedNames.has(`${baseName}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}_${suffix}`;
}

function fallbackMcpToolParametersSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMcpToolParametersSchema(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) {
    return fallbackMcpToolParametersSchema();
  }
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function resolveMcpToolTextResult(raw: unknown): string {
  const callResult = createCallResult(raw);
  return (
    callResult.markdown() ??
    callResult.text() ??
    JSON.stringify(jsonValue(callResult.structuredContent() ?? raw), null, 2)
  );
}

function toPiMcpServerBinding(payload: JsonObject, workspaceDir: string): PiMcpServerBinding | null {
  const name = firstNonEmptyString(payload.name);
  const config = isRecord(payload.config) ? payload.config : null;
  if (!name || !config) {
    return null;
  }

  const enabled = typeof config.enabled === "boolean" ? config.enabled : true;
  if (!enabled) {
    return null;
  }

  const timeoutMs = typeof config.timeout === "number" && Number.isFinite(config.timeout) ? config.timeout : 30000;
  const description = `Holaboss MCP server ${name}`;
  if (config.type === "local") {
    const command = Array.isArray(config.command) ? config.command.filter((item): item is string => typeof item === "string") : [];
    const [executable, ...args] = command;
    if (!executable) {
      throw new Error(`Pi MCP server ${name} is missing a local command`);
    }
    return {
      serverId: name,
      timeoutMs,
      definition: {
        name,
        description,
        command: {
          kind: "stdio",
          command: executable,
          args,
          cwd: workspaceDir,
        },
        env: stringRecord(config.environment),
      },
    };
  }

  const url = firstNonEmptyString(config.url);
  if (!url) {
    throw new Error(`Pi MCP server ${name} is missing a remote url`);
  }
  return {
    serverId: name,
    timeoutMs,
    definition: {
      name,
      description,
      command: {
        kind: "http",
        url: new URL(url),
        headers: stringRecord(config.headers),
      },
    },
  };
}

export function buildPiMcpServerBindings(request: HarnessHostPiRequest): PiMcpServerBinding[] {
  return request.mcp_servers
    .map((server) => toPiMcpServerBinding(server, request.workspace_dir))
    .filter((binding): binding is PiMcpServerBinding => Boolean(binding));
}

function mcpToolAllowlist(request: HarnessHostPiRequest): Map<string, Map<string, HarnessHostPiMcpToolRef>> {
  const allowlist = new Map<string, Map<string, HarnessHostPiMcpToolRef>>();
  for (const toolRef of request.mcp_tool_refs) {
    const serverTools = allowlist.get(toolRef.server_id) ?? new Map<string, HarnessHostPiMcpToolRef>();
    serverTools.set(toolRef.tool_name, toolRef);
    allowlist.set(toolRef.server_id, serverTools);
  }
  return allowlist;
}

function createPiMcpToolDefinition(params: {
  runtime: McporterRuntime;
  binding: PiMcpServerBinding;
  tool: ServerToolInfo;
  metadata: PiMcpToolMetadata;
}): ToolDefinition {
  const description = [params.tool.description?.trim(), `MCP server: ${params.binding.serverId}`, `MCP tool: ${params.tool.name}`]
    .filter(Boolean)
    .join("\n");

  return {
    name: params.metadata.piToolName,
    label: `${params.binding.serverId}:${params.tool.name}`,
    description,
    parameters: normalizeMcpToolParametersSchema(params.tool.inputSchema) as never,
    execute: async (_toolCallId, toolParams, signal) => {
      if (signal?.aborted) {
        throw new Error(`MCP tool call aborted before execution: ${params.binding.serverId}.${params.tool.name}`);
      }
      const raw = await params.runtime.callTool(params.binding.serverId, params.tool.name, {
        args: isRecord(toolParams) ? toolParams : {},
        timeoutMs: params.binding.timeoutMs,
      });
      const text = resolveMcpToolTextResult(raw);
      return {
        content: [{ type: "text", text }],
        details: {
          server_id: params.binding.serverId,
          tool_id: params.metadata.toolId,
          tool_name: params.tool.name,
          raw: jsonValue(raw),
        },
      };
    },
  };
}

export async function createPiMcpToolset(request: HarnessHostPiRequest): Promise<PiMcpToolset> {
  const bindings = buildPiMcpServerBindings(request);
  if (bindings.length === 0) {
    return {
      runtime: null,
      customTools: [],
      mcpToolMetadata: new Map(),
    };
  }

  const runtime = await createRuntime({
    servers: bindings.map((binding) => binding.definition),
    rootDir: request.workspace_dir,
    clientInfo: {
      name: PI_HARNESS_CLIENT_NAME,
      version: PI_HARNESS_CLIENT_VERSION,
    },
  });
  try {
    const customTools = await createPiMcpCustomTools(request, runtime, bindings);
    return {
      runtime,
      customTools: customTools.customTools,
      mcpToolMetadata: customTools.mcpToolMetadata,
    };
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

export async function createPiMcpCustomTools(
  request: HarnessHostPiRequest,
  runtime: McporterRuntime,
  bindings: PiMcpServerBinding[] = buildPiMcpServerBindings(request)
): Promise<Omit<PiMcpToolset, "runtime">> {
  const allowlist = mcpToolAllowlist(request);
  const customTools: ToolDefinition[] = [];
  const mcpToolMetadata = new Map<string, PiMcpToolMetadata>();

  for (const binding of bindings) {
    const allowedTools = allowlist.get(binding.serverId);
    const discoveryDeadline = Date.now() + Math.max(
      PI_MCP_DISCOVERY_RETRY_INTERVAL_MS,
      Math.min(binding.timeoutMs, PI_MCP_DISCOVERY_MAX_WAIT_MS)
    );
    let discoveredTools: ServerToolInfo[] = [];
    let lastDiscoveryError: unknown = null;
    while (true) {
      try {
        discoveredTools = await runtime.listTools(binding.serverId, { includeSchema: true });
        lastDiscoveryError = null;
      } catch (error) {
        lastDiscoveryError = error;
        discoveredTools = [];
      }

      const missingAllowedTools = allowedTools
        ? [...allowedTools.keys()].filter((toolName) => !discoveredTools.some((tool) => tool.name === toolName))
        : [];
      if (missingAllowedTools.length === 0) {
        break;
      }
      if (Date.now() >= discoveryDeadline) {
        if (lastDiscoveryError) {
          throw lastDiscoveryError;
        }
        throw new Error(
          `Pi MCP tool ${binding.serverId}.${missingAllowedTools[0]} for tool_id=${allowedTools?.get(missingAllowedTools[0])?.tool_id ?? `${binding.serverId}.${missingAllowedTools[0]}`} was not discovered`
        );
      }
      await sleep(PI_MCP_DISCOVERY_RETRY_INTERVAL_MS);
    }
    const filteredTools = allowedTools
      ? discoveredTools.filter((tool) => allowedTools.has(tool.name))
      : discoveredTools;

    if (allowedTools) {
      for (const [toolName, toolRef] of allowedTools.entries()) {
        if (!discoveredTools.some((tool) => tool.name === toolName)) {
          throw new Error(`Pi MCP tool ${binding.serverId}.${toolName} for tool_id=${toolRef.tool_id} was not discovered`);
        }
      }
    }

    for (const tool of filteredTools) {
      const toolRef = allowedTools?.get(tool.name);
      const metadata: PiMcpToolMetadata = {
        piToolName: uniquePiMcpToolName(binding.serverId, tool.name, new Set(mcpToolMetadata.keys())),
        serverId: binding.serverId,
        toolId: toolRef?.tool_id ?? `${binding.serverId}.${tool.name}`,
        toolName: tool.name,
      };
      customTools.push(
        createPiMcpToolDefinition({
          runtime,
          binding,
          tool,
          metadata,
        })
      );
      mcpToolMetadata.set(metadata.piToolName, metadata);
    }
  }

  return {
    customTools,
    mcpToolMetadata,
  };
}

function resolvePiModel(request: HarnessHostPiRequest, modelRegistry: ModelRegistry) {
  const direct = modelRegistry.find(request.provider_id, request.model_id);
  if (direct) {
    return direct;
  }

  const prefixed = modelRegistry.find(request.provider_id, `${request.provider_id}/${request.model_id}`);
  if (prefixed) {
    return prefixed;
  }

  const fallback = modelRegistry
    .getAll()
    .find(
      (model) =>
        (model.provider === request.provider_id && model.id === request.model_id) ||
        (model.provider === request.provider_id && model.id === `${request.provider_id}/${request.model_id}`) ||
        `${model.provider}/${model.id}` === request.model_id
    );
  if (fallback) {
    return fallback;
  }

  throw new Error(`Pi model not found for provider=${request.provider_id} model=${request.model_id}`);
}

function piApiForRequest(request: HarnessHostPiRequest): Api {
  const normalizedProvider = request.model_client.model_proxy_provider.trim().toLowerCase();
  if (normalizedProvider === "anthropic_native") {
    return "anthropic-messages";
  }
  if (shouldUseNativeGoogleProvider(request)) {
    return "google-generative-ai";
  }
  if (shouldUseOpenAiCodexResponsesProvider(request)) {
    return "openai-codex-responses";
  }
  if (shouldUseOpenAiResponsesProvider(request)) {
    return "openai-responses";
  }
  return "openai-completions";
}

function shouldUseNativeGoogleProvider(request: HarnessHostPiRequest): boolean {
  const normalizedProvider = request.model_client.model_proxy_provider.trim().toLowerCase();
  const providerId = request.provider_id.trim().toLowerCase();
  return normalizedProvider === "google_compatible" && providerId === "gemini_direct";
}

function shouldUseOpenAiCodexResponsesProvider(request: HarnessHostPiRequest): boolean {
  const normalizedProvider = request.model_client.model_proxy_provider.trim().toLowerCase();
  const providerId = request.provider_id.trim().toLowerCase();
  return normalizedProvider === "openai_compatible" && providerId === "openai_codex";
}

function normalizedPiModelId(request: Pick<HarnessHostPiRequest, "model_id">): string {
  const normalizedModelId = request.model_id.trim().toLowerCase();
  if (!normalizedModelId) {
    return "";
  }
  if (normalizedModelId.startsWith("openai/")) {
    return normalizedModelId.slice("openai/".length);
  }
  if (normalizedModelId.startsWith("holaboss_model_proxy/")) {
    return normalizedModelId.slice("holaboss_model_proxy/".length);
  }
  return normalizedModelId;
}

function isOpenAiGpt5Model(modelId: string): boolean {
  return /^gpt-5(?:[.-]|$)/.test(modelId);
}

function shouldUseOpenAiResponsesProvider(request: HarnessHostPiRequest): boolean {
  const normalizedProvider = request.model_client.model_proxy_provider.trim().toLowerCase();
  const providerId = request.provider_id.trim().toLowerCase();
  if (normalizedProvider !== "openai_compatible") {
    return false;
  }
  if (
    providerId !== "openai_direct" &&
    providerId !== "openai" &&
    providerId !== "holaboss_model_proxy" &&
    providerId !== "holaboss"
  ) {
    return false;
  }
  return isOpenAiGpt5Model(normalizedPiModelId(request));
}

function configurePiPromptCacheRetention(request: HarnessHostPiRequest): () => void {
  if (!shouldUseOpenAiResponsesProvider(request)) {
    return () => {};
  }
  const previousValue = process.env.PI_CACHE_RETENTION;
  // Keep the override scoped to the harness session so PI's internal
  // compaction/summarization requests inherit long cache retention.
  process.env.PI_CACHE_RETENTION = "long";
  return () => {
    if (previousValue === undefined) {
      delete process.env.PI_CACHE_RETENTION;
      return;
    }
    process.env.PI_CACHE_RETENTION = previousValue;
  };
}

function piGoogleGenerativeAiBaseUrlForRequest(request: HarnessHostPiRequest): string {
  const baseUrl = firstNonEmptyString(request.model_client.base_url);
  const normalized = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
  if (!normalized) {
    return "https://generativelanguage.googleapis.com/v1beta";
  }
  return normalized.replace(/\/openai$/i, "") || "https://generativelanguage.googleapis.com/v1beta";
}

function piAnthropicBaseUrlForRequest(request: HarnessHostPiRequest): string {
  const baseUrl = firstNonEmptyString(request.model_client.base_url);
  const normalized = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\/v1$/i, "");
}

function piOpenAiCompatForRequest(request: HarnessHostPiRequest): Model<"openai-completions">["compat"] | undefined {
  const modelProxyProvider = request.model_client.model_proxy_provider.trim().toLowerCase();
  const providerId = request.provider_id.trim().toLowerCase();
  const baseUrl = firstNonEmptyString(request.model_client.base_url)?.toLowerCase() ?? "";
  if (providerId.includes("ollama") || baseUrl.includes("localhost:11434") || baseUrl.includes("ollama")) {
    return {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    };
  }
  if (
    modelProxyProvider === "google_compatible" ||
    providerId.includes("gemini") ||
    providerId.includes("google") ||
    baseUrl.includes("generativelanguage.googleapis.com")
  ) {
    return {
      supportsStore: false,
    };
  }
  return undefined;
}

function mergePiOpenAiCompat(
  base: Model<"openai-completions">["compat"] | undefined,
  extra: Model<"openai-completions">["compat"] | undefined,
): Model<"openai-completions">["compat"] | undefined {
  if (!base) {
    return extra;
  }
  if (!extra) {
    return base;
  }
  return {
    ...base,
    ...extra,
    ...(base.reasoningEffortMap || extra.reasoningEffortMap
      ? {
          reasoningEffortMap: {
            ...(base.reasoningEffortMap ?? {}),
            ...(extra.reasoningEffortMap ?? {}),
          },
        }
      : {}),
  };
}

function piInputModalitiesForRequest(
  request: HarnessHostPiRequest,
): Array<"text" | "image"> {
  const providerId = request.provider_id.trim().toLowerCase();
  const modelId = request.model_id.trim().toLowerCase();
  if (
    providerId.includes("ollama") ||
    providerId.includes("minimax") ||
    modelId.startsWith("llama") ||
    modelId.startsWith("qwen3:") ||
    modelId.startsWith("gpt-oss:")
  ) {
    return ["text"];
  }
  return ["text", "image"];
}

export function requestedPiThinkingLevel(
  request: Pick<HarnessHostPiRequest, "thinking_value">,
): PiRequestedThinkingLevel | null {
  return piThinkingSelectionForRequest(request).level;
}

function piNumericThinkingLevel(value: number): PiThinkingBudgetLevel | "off" {
  if (value === 0) {
    return "off";
  }
  if (value < 0) {
    return "high";
  }
  if (value <= 1024) {
    return "minimal";
  }
  if (value <= 4096) {
    return "low";
  }
  if (value <= 12288) {
    return "medium";
  }
  return "high";
}

function piThinkingSelectionForRequest(
  request: Pick<HarnessHostPiRequest, "thinking_value">,
): PiThinkingSelection {
  const rawValue = request.thinking_value?.trim() ?? "";
  const normalizedValue = rawValue.toLowerCase();
  if (!normalizedValue) {
    return {
      rawValue: null,
      level: null,
    };
  }
  if (
    normalizedValue === "off" ||
    normalizedValue === "none" ||
    normalizedValue === "false"
  ) {
    return {
      rawValue,
      level: "off",
    };
  }
  if (
    normalizedValue === "minimal" ||
    normalizedValue === "low" ||
    normalizedValue === "medium" ||
    normalizedValue === "high" ||
    normalizedValue === "xhigh"
  ) {
    return {
      rawValue,
      level: normalizedValue,
    };
  }
  if (normalizedValue === "max") {
    return {
      rawValue,
      level: "xhigh",
    };
  }
  if (normalizedValue === "default") {
    return {
      rawValue,
      level: "low",
    };
  }
  if (normalizedValue === "true" || normalizedValue === "enabled") {
    return {
      rawValue,
      level: "medium",
    };
  }
  const numericValue = Number(normalizedValue);
  if (!Number.isFinite(numericValue)) {
    return {
      rawValue,
      level: null,
    };
  }
  const level = piNumericThinkingLevel(numericValue);
  if (level === "off") {
    return {
      rawValue,
      level,
    };
  }
  return {
    rawValue,
    level,
    thinkingBudgets: {
      [level]: numericValue,
    },
  };
}

function piOpenAiCompatForThinkingSelection(
  selection: PiThinkingSelection,
): Model<"openai-completions">["compat"] | undefined {
  if (!selection.rawValue || !selection.level || selection.level === "off") {
    return undefined;
  }
  const normalizedLevel = selection.level.toLowerCase();
  const normalizedRawValue = selection.rawValue.trim().toLowerCase();
  if (
    normalizedRawValue === normalizedLevel ||
    Number.isFinite(Number(normalizedRawValue))
  ) {
    return undefined;
  }
  return {
    reasoningEffortMap: {
      [selection.level]: selection.rawValue,
    },
  };
}

export function requestedPiThinkingBudgets(
  request: Pick<HarnessHostPiRequest, "thinking_value">,
): Partial<Record<PiThinkingBudgetLevel, number>> | undefined {
  const selection = piThinkingSelectionForRequest(request);
  return selection.thinkingBudgets
    ? { ...selection.thinkingBudgets }
    : undefined;
}

function requestedPiOpenAiCompat(
  request: Pick<HarnessHostPiRequest, "thinking_value">,
): Model<"openai-completions">["compat"] | undefined {
  return piOpenAiCompatForThinkingSelection(
    piThinkingSelectionForRequest(request),
  );
}

export function requestedPiThinkingConfig(
  request: Pick<HarnessHostPiRequest, "thinking_value">,
): PiThinkingSelection {
  const selection = piThinkingSelectionForRequest(request);
  return {
    rawValue: selection.rawValue,
    level: selection.level,
    ...(selection.thinkingBudgets
      ? { thinkingBudgets: { ...selection.thinkingBudgets } }
      : {}),
  };
}

function knownPiModelBudgetOverride(
  request: Pick<HarnessHostPiRequest, "model_id">,
  api: Api,
): PiModelBudget | null {
  const normalizedModelId = normalizedPiModelId(request);
  if (api !== "openai-responses") {
    return null;
  }

  switch (normalizedModelId) {
    case "gpt-5.4":
    case "gpt-5.4-pro":
      return {
        contextWindow: 1_050_000,
        maxTokens: 128_000,
      };
    case "gpt-5.4-mini":
    case "gpt-5.4-nano":
      return {
        contextWindow: 400_000,
        maxTokens: 128_000,
      };
    default:
      return null;
  }
}

function piCatalogProviderCandidatesForRequest(
  request: HarnessHostPiRequest,
  api: Api,
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined) => {
    const normalized = value?.trim().toLowerCase() ?? "";
    if (!normalized || seen.has(normalized) || !(normalized in PI_MODEL_CATALOG)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  const providerId = request.provider_id.trim().toLowerCase();
  const modelProxyProvider = request.model_client.model_proxy_provider
    .trim()
    .toLowerCase();
  const baseUrl = firstNonEmptyString(request.model_client.base_url)?.toLowerCase() ?? "";

  push(providerId);
  if (providerId.endsWith("_direct")) {
    push(providerId.slice(0, -"_direct".length));
  }
  if (providerId === "gemini_direct") {
    push("google");
  }
  if (providerId === "openai_codex") {
    push("openai-codex");
  }
  if (providerId.includes("openrouter") || baseUrl.includes("openrouter.ai")) {
    push("openrouter");
  }

  if (api === "openai-responses") {
    push("openai");
  }
  if (api === "openai-codex-responses") {
    push("openai-codex");
  }
  if (modelProxyProvider === "anthropic_native") {
    push("anthropic");
  }
  if (modelProxyProvider === "google_compatible") {
    push("google");
  }

  return candidates;
}

function piCatalogModelIdCandidates(
  request: Pick<HarnessHostPiRequest, "model_id">,
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined) => {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  push(request.model_id);
  push(normalizedPiModelId(request));
  return candidates;
}

function piModelBudgetFromCatalogEntry(entry: {
  contextWindow?: unknown;
  maxTokens?: unknown;
} | null | undefined): PiModelBudget | null {
  if (
    typeof entry?.contextWindow !== "number" ||
    !Number.isFinite(entry.contextWindow) ||
    entry.contextWindow <= 0 ||
    typeof entry.maxTokens !== "number" ||
    !Number.isFinite(entry.maxTokens) ||
    entry.maxTokens <= 0
  ) {
    return null;
  }

  return {
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
  };
}

function piModelCostFromCatalogEntry(
  entry: PiCatalogModelEntry | null | undefined,
): PiModelCost | null {
  if (
    typeof entry?.cost?.input !== "number" ||
    !Number.isFinite(entry.cost.input) ||
    entry.cost.input < 0 ||
    typeof entry.cost.output !== "number" ||
    !Number.isFinite(entry.cost.output) ||
    entry.cost.output < 0 ||
    typeof entry.cost.cacheRead !== "number" ||
    !Number.isFinite(entry.cost.cacheRead) ||
    entry.cost.cacheRead < 0 ||
    typeof entry.cost.cacheWrite !== "number" ||
    !Number.isFinite(entry.cost.cacheWrite) ||
    entry.cost.cacheWrite < 0
  ) {
    return null;
  }

  return {
    input: entry.cost.input,
    output: entry.cost.output,
    cacheRead: entry.cost.cacheRead,
    cacheWrite: entry.cost.cacheWrite,
  };
}

function piCatalogModelBudgetForRequest(
  request: HarnessHostPiRequest,
  api: Api,
): PiModelBudget | null {
  const providerCandidates = piCatalogProviderCandidatesForRequest(request, api);
  const modelIdCandidates = piCatalogModelIdCandidates(request);

  for (const provider of providerCandidates) {
    for (const modelId of modelIdCandidates) {
      const matched = piModelBudgetFromCatalogEntry(
        PI_MODEL_CATALOG[provider]?.[modelId],
      );
      if (matched) {
        return matched;
      }
    }
  }

  const globalMatches = new Map<string, PiModelBudget>();
  for (const provider of Object.keys(PI_MODEL_CATALOG)) {
    for (const modelId of modelIdCandidates) {
      const matched = piModelBudgetFromCatalogEntry(
        PI_MODEL_CATALOG[provider]?.[modelId],
      );
      if (!matched) {
        continue;
      }
      globalMatches.set(`${matched.contextWindow}:${matched.maxTokens}`, matched);
    }
  }

  return globalMatches.size === 1
    ? Array.from(globalMatches.values())[0] ?? null
    : null;
}

function piCatalogModelCostForRequest(
  request: HarnessHostPiRequest,
  api: Api,
): PiModelCost | null {
  const providerCandidates = piCatalogProviderCandidatesForRequest(request, api);
  const modelIdCandidates = piCatalogModelIdCandidates(request);

  for (const provider of providerCandidates) {
    for (const modelId of modelIdCandidates) {
      const matched = piModelCostFromCatalogEntry(
        PI_MODEL_CATALOG[provider]?.[modelId],
      );
      if (matched) {
        return matched;
      }
    }
  }

  const globalMatches = new Map<string, PiModelCost>();
  for (const provider of Object.keys(PI_MODEL_CATALOG)) {
    for (const modelId of modelIdCandidates) {
      const matched = piModelCostFromCatalogEntry(
        PI_MODEL_CATALOG[provider]?.[modelId],
      );
      if (!matched) {
        continue;
      }
      globalMatches.set(
        `${matched.input}:${matched.output}:${matched.cacheRead}:${matched.cacheWrite}`,
        matched,
      );
    }
  }

  return globalMatches.size === 1
    ? Array.from(globalMatches.values())[0] ?? null
    : null;
}

function resolvedPiModelBudgetForRequest(
  request: HarnessHostPiRequest,
  api: Api,
): PiModelBudget {
  return (
    knownPiModelBudgetOverride(request, api) ??
    piCatalogModelBudgetForRequest(request, api) ?? {
      contextWindow: PI_FALLBACK_CONTEXT_WINDOW,
      maxTokens: PI_FALLBACK_MAX_TOKENS,
    }
  );
}

function resolvedPiModelCostForRequest(
  request: HarnessHostPiRequest,
  api: Api,
): PiModelCost {
  return (
    piCatalogModelCostForRequest(request, api) ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    }
  );
}

export function buildPiProviderConfig(request: HarnessHostPiRequest) {
  const providerHeaders = isRecord(request.model_client.default_headers)
    ? Object.fromEntries(
        Object.entries(request.model_client.default_headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    : undefined;
  const hasExplicitAuthHeader = Object.keys(providerHeaders ?? {}).some((headerName) => {
    const normalizedHeaderName = headerName.trim().toLowerCase();
    return normalizedHeaderName === "x-api-key" || normalizedHeaderName === "authorization";
  });
  const api = piApiForRequest(request);
  const baseUrl =
    api === "google-generative-ai"
      ? piGoogleGenerativeAiBaseUrlForRequest(request)
      : api === "anthropic-messages"
        ? piAnthropicBaseUrlForRequest(request)
      : firstNonEmptyString(request.model_client.base_url);
  if (!baseUrl) {
    throw new Error(`Pi provider ${request.provider_id} is missing a model client base URL`);
  }

  const compat =
    api === "openai-completions" ? piOpenAiCompatForRequest(request) : undefined;
  const requestedThinking = requestedPiThinkingLevel(request);
  const requestedCompat =
    api === "openai-completions" ? requestedPiOpenAiCompat(request) : undefined;
  const mergedCompat = mergePiOpenAiCompat(compat, requestedCompat);
  const modelBudget = resolvedPiModelBudgetForRequest(request, api);
  const modelCost = resolvedPiModelCostForRequest(request, api);

  return {
    baseUrl,
    apiKey: request.model_client.api_key,
    api,
    headers: providerHeaders,
    // Prefer runtime-managed auth headers when provided by the server, otherwise let Pi attach auth from api_key.
    authHeader: api !== "google-generative-ai" && !hasExplicitAuthHeader,
    models: [
      {
        id: request.model_id,
        name: request.model_id,
        api,
        reasoning: requestedThinking !== null,
        input: piInputModalitiesForRequest(request),
        cost: modelCost,
        contextWindow: modelBudget.contextWindow,
        maxTokens: modelBudget.maxTokens,
        ...(mergedCompat ? { compat: mergedCompat } : {}),
      },
    ],
  };
}

async function defaultCreateSession(request: HarnessHostPiRequest): Promise<PiSessionHandle> {
  const stateDir = resolvePiStateDir(request.workspace_dir);
  const sessionDir = resolvePiSessionDir(request.workspace_dir);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  const authStorage = AuthStorage.create(path.join(stateDir, "auth.json"));
  authStorage.setRuntimeApiKey(request.provider_id, request.model_client.api_key);

  const modelRegistry = ModelRegistry.create(
    authStorage,
    path.join(stateDir, "models.json"),
  );
  modelRegistry.registerProvider(request.provider_id, buildPiProviderConfig(request));

  const model = resolvePiModel(request, modelRegistry);
  const requestedThinking = requestedPiThinkingLevel(request) ?? "off";
  const requestedThinkingBudgets = requestedPiThinkingBudgets(request);
  const settingsManager = SettingsManager.inMemory({
    defaultProvider: request.provider_id,
    defaultModel: request.model_id,
    defaultThinkingLevel: requestedThinking,
    ...(requestedThinkingBudgets
      ? { thinkingBudgets: requestedThinkingBudgets }
      : {}),
  });
  const skillMetadataByAlias = buildPiSkillMetadataByAlias(request.workspace_skills ?? []);
  const browserTools = request.browser_tools_enabled
    ? await resolvePiDesktopBrowserToolDefinitions({
        runtimeApiBaseUrl: request.runtime_api_base_url,
        workspaceId: request.workspace_id,
        sessionId: request.session_id,
        space: request.browser_space ?? undefined,
      })
    : [];
  const resourceLoader = new DefaultResourceLoader({
    cwd: request.workspace_dir,
    agentDir: stateDir,
    settingsManager,
    extensionFactories: [],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPromptOverride: () => effectiveSystemPromptForRequest(request),
  });
  await resourceLoader.reload();

  const persistedSessionFile = resolveRequestedSessionFile(request);
  const sessionManager = persistedSessionFile
    ? SessionManager.open(persistedSessionFile)
    : SessionManager.create(request.workspace_dir, sessionDir);
  const mcpToolset = await createPiMcpToolset(request);
  const runtimeTools = await resolvePiRuntimeToolDefinitions({
    runtimeApiBaseUrl: request.runtime_api_base_url,
    workspaceId: request.workspace_id,
    sessionId: request.session_id,
    inputId: request.input_id,
    selectedModel: `${request.provider_id}/${request.model_id}`,
  });
  const baseTools = [
    ...createCodingTools(request.workspace_dir),
    createGrepTool(request.workspace_dir),
    createFindTool(request.workspace_dir),
    createLsTool(request.workspace_dir),
  ];
  const nonSkillCustomTools: ToolDefinition[] = [
    ...browserTools,
    ...runtimeTools,
    ...mcpToolset.customTools,
  ];
  const availableToolNames = [...baseTools, ...nonSkillCustomTools].map((tool) => tool.name);
  const availableCommandIds = workspaceCommandIdsFromRunStartedPayload(request.run_started_payload);
  const workspaceBoundaryPolicy = createWorkspaceBoundaryPolicy(
    request.workspace_dir,
    workspaceBoundaryOverrideRequested(request.instruction)
  );
  const skillWideningState = createPiSkillWideningState(
    skillMetadataByAlias,
    [...availableToolNames, "skill"],
    availableCommandIds
  );
  const tools = baseTools.map((tool) =>
    wrapToolWithWorkspaceBoundary(wrapToolWithSkillWidening(tool, skillWideningState), workspaceBoundaryPolicy)
  );
  const customTools = [
    ...nonSkillCustomTools.map((tool) =>
      wrapToolWithWorkspaceBoundary(
        wrapToolWithSkillWidening(
          wrapRuntimeSkillTool(tool, skillMetadataByAlias, skillWideningState, workspaceBoundaryPolicy),
          skillWideningState
        ),
        workspaceBoundaryPolicy
      )
    ),
  ];

  const restorePromptCacheRetention = configurePiPromptCacheRetention(request);
  let session: AgentSession;
  try {
    ({ session } = await createAgentSession({
      cwd: request.workspace_dir,
      agentDir: stateDir,
      authStorage,
      modelRegistry,
      model,
      resourceLoader,
      sessionManager,
      settingsManager,
      tools,
      customTools,
    }));
  } catch (error) {
    restorePromptCacheRetention();
    await mcpToolset.runtime?.close();
    throw error;
  }

  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) {
    try {
      session.dispose();
    } finally {
      try {
        await mcpToolset.runtime?.close();
      } finally {
        restorePromptCacheRetention();
      }
    }
    throw new Error("Pi session manager did not provide a persisted session file");
  }

  return {
    session,
    sessionFile,
    mcpToolMetadata: mcpToolset.mcpToolMetadata,
    skillMetadataByAlias,
    dispose: async () => {
      try {
        session.dispose();
      } finally {
        try {
          await mcpToolset.runtime?.close();
        } finally {
          restorePromptCacheRetention();
        }
      }
    },
  };
}

function toolCallId(event: AgentSessionEvent): string {
  if ("toolCallId" in event && typeof event.toolCallId === "string") {
    return event.toolCallId;
  }
  return "";
}

function isSkillToolName(toolName: unknown): boolean {
  return typeof toolName === "string" && toolName.trim().toLowerCase() === "skill";
}

function skillInvocationArgs(value: unknown): { requestedName: string | null; args: string | null } {
  if (!isRecord(value)) {
    return { requestedName: null, args: null };
  }
  return {
    requestedName: optionalTrimmedString(value.name),
    args: optionalTrimmedString(value.args),
  };
}

function skillInvocationResultDetails(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  return isRecord(value.details) ? value.details : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => optionalTrimmedString(item))
    .filter((item): item is string => Boolean(item));
}

function maybeMapSkillInvocationStart(event: AgentSessionEvent, state: PiEventMapperState): PiMappedEvent | null {
  if (event.type !== "tool_execution_start" || !isSkillToolName(event.toolName)) {
    return null;
  }
  const invocationArgs = skillInvocationArgs(event.args);
  const resolvedSkill = resolveSkillMetadata(state.skillMetadataByAlias, invocationArgs.requestedName);
  return {
    event_type: "skill_invocation",
    payload: {
      phase: "started",
      requested_name: invocationArgs.requestedName,
      skill_id: resolvedSkill?.skillId ?? null,
      skill_name: resolvedSkill?.skillName ?? invocationArgs.requestedName,
      skill_location: resolvedSkill?.filePath ?? null,
      granted_tools_expected: resolvedSkill?.grantedTools ?? [],
      granted_commands_expected: resolvedSkill?.grantedCommands ?? [],
      args: invocationArgs.args,
      error: false,
      event: "tool_execution_start",
      source: "pi",
      call_id: event.toolCallId,
    },
  };
}

function maybeMapSkillInvocationEnd(
  event: AgentSessionEvent,
  toolArgs: JsonValue | null,
  state: PiEventMapperState
): PiMappedEvent | null {
  if (event.type !== "tool_execution_end" || !isSkillToolName(event.toolName)) {
    return null;
  }
  const invocationArgs = skillInvocationArgs(toolArgs);
  const resolvedSkill = resolveSkillMetadata(state.skillMetadataByAlias, invocationArgs.requestedName);
  const details = skillInvocationResultDetails(event.result);
  const skillId = firstNonEmptyString(details?.skill_id, resolvedSkill?.skillId) ?? null;
  const skillName = firstNonEmptyString(details?.skill_name, resolvedSkill?.skillName, invocationArgs.requestedName) ?? null;
  const skillLocation = firstNonEmptyString(details?.skill_file_path, resolvedSkill?.filePath) ?? null;
  const policyWidening = isRecord(details?.policy_widening) ? details?.policy_widening : null;
  const wideningScope = optionalTrimmedString(policyWidening?.scope);
  const managedTools = stringList(policyWidening?.managed_tools);
  const grantedTools = stringList(policyWidening?.granted_tools);
  const activeGrantedToolsSnapshot = stringList(policyWidening?.active_granted_tools);
  const managedCommands = stringList(policyWidening?.managed_commands);
  const grantedCommands = stringList(policyWidening?.granted_commands);
  const activeGrantedCommandsSnapshot = stringList(policyWidening?.active_granted_commands);
  const workspaceBoundaryOverride =
    typeof policyWidening?.workspace_boundary_override === "boolean"
      ? policyWidening.workspace_boundary_override
      : null;
  const resultMessage = firstNonEmptyString(
    details?.message,
    details?.error_message,
    isRecord(event.result) ? event.result.message : undefined,
    isRecord(event.result) ? event.result.error : undefined,
    typeof event.result === "string" ? event.result : undefined
  );
  return {
    event_type: "skill_invocation",
    payload: {
      phase: "completed",
      requested_name: invocationArgs.requestedName,
      skill_id: skillId,
      skill_name: skillName,
      skill_location: skillLocation,
      widening_scope: wideningScope,
      managed_tools: managedTools,
      granted_tools: grantedTools,
      active_granted_tools: activeGrantedToolsSnapshot,
      managed_commands: managedCommands,
      granted_commands: grantedCommands,
      active_granted_commands: activeGrantedCommandsSnapshot,
      workspace_boundary_override: workspaceBoundaryOverride,
      args: invocationArgs.args,
      error: Boolean(event.isError),
      error_message: Boolean(event.isError) ? resultMessage ?? null : null,
      event: "tool_execution_end",
      source: "pi",
      call_id: toolCallId(event),
    },
  };
}

function assistantMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
        return "";
      }
      return block.text;
    })
    .join("")
    .trim();
}

function parseJsonIfPossible(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractProviderErrorMessage(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = parseJsonIfPossible(trimmed);
    if (parsed !== null) {
      const nested = extractProviderErrorMessage(parsed, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractProviderErrorMessage(item, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["error", "errors", "message", "detail", "details", "error_message", "body", "cause"] as const) {
    const nested = extractProviderErrorMessage(value[key], depth + 1);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function normalizeAssistantFailureMessage(errorMessage: unknown, content: unknown, stopReason: string): string {
  return (
    extractProviderErrorMessage(errorMessage) ??
    firstNonEmptyString(
      typeof errorMessage === "string" ? errorMessage : undefined,
      assistantMessageText(content),
      `Assistant message ended with stop reason ${stopReason}`
    ) ??
    `Assistant message ended with stop reason ${stopReason}`
  );
}

function maybeMapAssistantTerminalFailure(
  event: AgentSessionEvent,
  sessionFile: string,
  state: PiEventMapperState
): PiMappedEvent[] | null {
  if (event.type !== "message_end" && event.type !== "turn_end") {
    return null;
  }
  if (state.terminalState === "failed") {
    return [];
  }
  const message = isRecord(event.message) ? event.message : null;
  if (!message || message.role !== "assistant") {
    return [];
  }
  const stopReason = optionalTrimmedString(message.stopReason);
  if (stopReason !== "error" && stopReason !== "aborted") {
    return [];
  }
  state.terminalState = "failed";
  const failureMessage = normalizeAssistantFailureMessage(message.errorMessage, message.content, stopReason);
  return [
    {
      event_type: "run_failed",
      payload: {
        type: stopReason === "aborted" ? "AbortError" : "ProviderError",
        message: failureMessage,
        stop_reason: stopReason,
        provider: optionalTrimmedString(message.provider) ?? null,
        model: optionalTrimmedString(message.model) ?? null,
        event: event.type,
        source: "pi",
        harness_session_id: sessionFile,
      },
    },
  ];
}

function mapNativePiEvent(event: AgentSessionEvent, sessionFile: string): PiMappedEvent {
  const nativeEventPayload =
    event.type === "message_update"
      ? jsonValue({
          type: event.type,
          assistantMessageEvent: Object.fromEntries(
            Object.entries(isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : {}).filter(
              ([key]) => key !== "partial"
            )
          ),
        })
      : jsonValue(event);
  return {
    event_type: "pi_native_event",
    payload: {
      native_type: event.type,
      native_event: nativeEventPayload,
      event: event.type,
      source: "pi",
      harness_session_id: sessionFile,
    },
  };
}

function mapPiEvent(
  event: AgentSessionEvent,
  sessionFile: string,
  state: PiEventMapperState,
  options: {
    contextUsage?: JsonValue | null;
  } = {}
): PiMappedEvent[] {
  const nativeEvent = mapNativePiEvent(event, sessionFile);
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        return [
          nativeEvent,
          {
            event_type: "output_delta",
            payload: {
              delta: event.assistantMessageEvent.delta,
              event: "message_update",
              source: "pi",
              content_index: event.assistantMessageEvent.contentIndex,
              delta_kind: "output",
            },
          },
        ];
      }
      if (event.assistantMessageEvent.type === "thinking_delta") {
        return [
          nativeEvent,
          {
            event_type: "thinking_delta",
            payload: {
              delta: event.assistantMessageEvent.delta,
              event: "message_update",
              source: "pi",
              content_index: event.assistantMessageEvent.contentIndex,
              delta_kind: "thinking",
            },
          },
        ];
      }
      return [nativeEvent];
    case "message_end":
    case "turn_end": {
      const terminalFailure = maybeMapAssistantTerminalFailure(event, sessionFile, state);
      return terminalFailure == null ? [nativeEvent] : [nativeEvent, ...terminalFailure];
    }
    case "tool_execution_start": {
      state.toolArgsByCallId.set(event.toolCallId, jsonValue(event.args));
      const metadata = state.mcpToolMetadata.get(event.toolName);
      const mapped: PiMappedEvent[] = [
        nativeEvent,
        {
          event_type: "tool_call",
          payload: {
            phase: "started",
            tool_name: metadata?.toolName ?? event.toolName,
            tool_args: jsonValue(event.args),
            result: null,
            error: false,
            event: "tool_execution_start",
            source: "pi",
            call_id: event.toolCallId,
            ...(metadata
              ? {
                  pi_tool_name: metadata.piToolName,
                  mcp_server_id: metadata.serverId,
                  tool_id: metadata.toolId,
                }
              : {}),
          },
        },
      ];
      const skillMapped = maybeMapSkillInvocationStart(event, state);
      if (skillMapped) {
        mapped.push(skillMapped);
      }
      return mapped;
    }
    case "tool_execution_end": {
      const callId = toolCallId(event);
      const args = state.toolArgsByCallId.get(callId) ?? null;
      state.toolArgsByCallId.delete(callId);
      const metadata = state.mcpToolMetadata.get(event.toolName);
      const toolName = metadata?.toolName ?? event.toolName;
      const mapped: PiMappedEvent[] = [
        nativeEvent,
        {
          event_type: "tool_call",
          payload: {
            phase: "completed",
            tool_name: toolName,
            tool_args: args,
            result: jsonValue(event.result),
            error: Boolean(event.isError),
            event: "tool_execution_end",
            source: "pi",
            call_id: callId,
            ...(metadata
              ? {
                  pi_tool_name: metadata.piToolName,
                  mcp_server_id: metadata.serverId,
                  tool_id: metadata.toolId,
                }
              : {}),
          },
        },
      ];
      if (!event.isError && toolName.trim().toLowerCase() === "question") {
        state.waitingForUser = true;
      }
      const skillMapped = maybeMapSkillInvocationEnd(event, args, state);
      if (skillMapped) {
        mapped.push(skillMapped);
      }
      return mapped;
    }
    case "compaction_start":
      return [
        nativeEvent,
        {
          event_type: "auto_compaction_start",
          payload: {
            reason: event.reason,
            event: "auto_compaction_start",
            source: "pi",
          },
        },
      ];
    case "compaction_end":
      return [
        nativeEvent,
        {
          event_type: "auto_compaction_end",
          payload: {
            result: jsonValue(event.result ?? null),
            aborted: event.aborted,
            will_retry: event.willRetry,
            error_message: typeof event.errorMessage === "string" ? event.errorMessage : null,
            event: "auto_compaction_end",
            source: "pi",
          },
        },
      ];
    case "agent_end":
      if (state.terminalState === "failed") {
        return [nativeEvent];
      }
      state.terminalState = "completed";
      return [
        nativeEvent,
        {
          event_type: "run_completed",
          payload: {
            status: state.waitingForUser ? "waiting_user" : "success",
            event: "agent_end",
            source: "pi",
            harness_session_id: sessionFile,
            context_usage:
              isRecord(options.contextUsage) || options.contextUsage === null
                ? options.contextUsage
                : null,
          },
        },
      ];
    default:
      return [nativeEvent];
  }
}

export function createPiEventMapperState(
  mcpToolMetadata: ReadonlyMap<string, PiMcpToolMetadata> = new Map(),
  skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata> = new Map()
): PiEventMapperState {
  return {
    toolArgsByCallId: new Map(),
    mcpToolMetadata,
    skillMetadataByAlias,
    terminalState: null,
    waitingForUser: false,
  };
}

export function mapPiSessionEvent(event: AgentSessionEvent, sessionFile: string, state: PiEventMapperState): PiMappedEvent[] {
  return mapPiEvent(event, sessionFile, state);
}

function defaultPiDeps(): PiDeps {
  return {
    createSession: defaultCreateSession,
  };
}

function suppressPiPostRunAutoCompaction(session: AgentSession): void {
  const internalSession = session as unknown as PiInternalCompactionSession;
  const originalCheckCompaction = internalSession._checkCompaction;
  if (typeof originalCheckCompaction !== "function") {
    return;
  }

  internalSession._checkCompaction = async function (
    assistantMessage: unknown,
    skipAbortedCheck = true,
  ): Promise<void> {
    // PI uses `_checkCompaction(msg)` after `agent_end` and `_checkCompaction(msg, false)`
    // before the next prompt submission. We suppress only the post-run maintenance path and
    // keep the pre-prompt safety check intact so the next run can still recover if needed.
    if (skipAbortedCheck !== false) {
      return;
    }
    await originalCheckCompaction.call(this, assistantMessage, skipAbortedCheck);
  };
}

export async function runPi(request: HarnessHostPiRequest, deps: PiDeps = defaultPiDeps()): Promise<number> {
  let sequence = 0;
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };

  const todoCoordinator = new RuntimeTodoCoordinator({
    runtimeApiBaseUrl: request.runtime_api_base_url,
    workspaceId: request.workspace_id,
    sessionId: request.session_id,
  });
  await todoCoordinator.initialize();
  const handle = await deps.createSession(request);
  suppressPiPostRunAutoCompaction(handle.session);
  const requestedThinking = requestedPiThinkingLevel(request) ?? "off";
  (
    handle.session as AgentSession & {
      setThinkingLevel?: (level: PiThinkingLevel) => void;
    }
  ).setThinkingLevel?.(requestedThinking);
  const currentContextUsage = (): JsonValue | null =>
    jsonValue(
      (
        handle.session as AgentSession & {
          getContextUsage?: () => unknown;
        }
      ).getContextUsage?.() ?? null,
    );
  const state = createPiEventMapperState(handle.mcpToolMetadata, handle.skillMetadataByAlias);
  const shouldEmitWaitingUser = () => todoCoordinator.shouldEmitWaitingUser(state.waitingForUser);
  let terminalEmitted = false;
  let aggregatedUsage: HarnessGenAiUsageMetrics | null = null;
  const unsubscribe = handle.session.subscribe((event) => {
    if (event.type === "message_end") {
      aggregatedUsage = mergeHarnessUsageMetrics(
        aggregatedUsage,
        piUsageMetricsFromAssistantMessage(event.message),
      );
    }
    for (const mapped of mapPiEvent(event, handle.sessionFile, state, {
      contextUsage: event.type === "agent_end" ? currentContextUsage() : null,
    })) {
      if (mapped.event_type === "run_completed" || mapped.event_type === "run_failed") {
        const usagePayload = tokenUsagePayloadFromHarnessUsage(aggregatedUsage);
        if (usagePayload && !isRecord(mapped.payload.usage) && !isRecord(mapped.payload.token_usage)) {
          mapped.payload.usage = usagePayload;
        }
      }
      if (
        mapped.event_type === "run_completed" &&
        typeof mapped.payload.status === "string" &&
        mapped.payload.status.trim().toLowerCase() !== "waiting_user" &&
        shouldEmitWaitingUser()
      ) {
        mapped.payload.status = "waiting_user";
      }
      if (
        mapped.event_type === "tool_call" &&
        mapped.payload.phase === "completed" &&
        typeof mapped.payload.tool_name === "string"
      ) {
        todoCoordinator.noteToolCompletion({
          toolName: mapped.payload.tool_name,
          error: mapped.payload.error === true,
          toolArgs: (mapped.payload.tool_args as JsonValue | null) ?? null,
          result: mapped.payload.result,
        });
      }
      if (mapped.event_type === "run_completed" || mapped.event_type === "run_failed") {
        terminalEmitted = true;
      }
      emitRunnerEvent(request, nextSequence(), mapped.event_type, mapped.payload);
    }
  });

  emitRunnerEvent(request, nextSequence(), "run_started", {
    ...request.run_started_payload,
    harness_session_id: handle.sessionFile,
  });

  let timeoutHandle: NodeJS.Timeout | null = null;
  let timedOut = false;
  if (request.timeout_seconds > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      void handle.session.abort().catch(() => {});
    }, request.timeout_seconds * 1000);
  }

  return await Sentry.startSpan(
    {
      name: `invoke_agent ${normalizedPiModelId(request) || request.model_id}`,
      op: "gen_ai.invoke_agent",
      attributes: harnessGenAiSpanAttributes({
        operationName: "invoke_agent",
        model: normalizedPiModelId(request) || request.model_id,
        providerId: request.provider_id,
        workspaceId: request.workspace_id,
        sessionId: request.session_id,
        inputId: request.input_id,
        userId: requestDefaultHeaderValue(request, "x-holaboss-user-id"),
        sandboxId: requestDefaultHeaderValue(
          request,
          "x-holaboss-sandbox-id",
        ),
        agentName: "PI Agent",
        thinkingValue: request.thinking_value ?? null,
      }),
    },
    async (span) => {
      try {
        await handle.session.sendUserMessage(await promptContentForRequest(request));
        await todoCoordinator.waitForPendingUpdates();
        if (!terminalEmitted) {
          const usagePayload = tokenUsagePayloadFromHarnessUsage(aggregatedUsage);
          emitRunnerEvent(request, nextSequence(), "run_completed", {
            status: shouldEmitWaitingUser() ? "waiting_user" : "success",
            source: "pi",
            event: "send_user_message_resolved",
            harness_session_id: handle.sessionFile,
            context_usage: currentContextUsage(),
            ...(usagePayload ? { usage: usagePayload } : {}),
          });
        }
        applyHarnessGenAiUsageMetrics(span, aggregatedUsage);
        if (state.terminalState === "failed") {
          span.setAttribute("holaboss.run_status", "failed");
          span.setStatus({ code: 2, message: "internal_error" });
        } else {
          const runStatus = shouldEmitWaitingUser() ? "waiting_user" : "success";
          span.setAttribute("holaboss.run_status", runStatus);
          span.setStatus({ code: 1, message: "ok" });
        }
        return 0;
      } catch (error) {
        if (!terminalEmitted) {
          const message = timedOut
            ? `Pi session timed out after ${request.timeout_seconds} seconds`
            : sdkErrorMessage(error, "Pi session failed");
          const usagePayload = tokenUsagePayloadFromHarnessUsage(aggregatedUsage);
          emitRunnerEvent(request, nextSequence(), "run_failed", {
            type:
              timedOut
                ? "TimeoutError"
                : error instanceof Error && error.name
                  ? error.name
                  : "Error",
            message,
            source: "pi",
            harness_session_id: handle.sessionFile,
            ...(usagePayload ? { usage: usagePayload } : {}),
          });
        }
        applyHarnessGenAiUsageMetrics(span, aggregatedUsage);
        span.setAttribute("holaboss.run_status", "failed");
        span.setStatus({
          code: 2,
          message: timedOut
            ? "deadline_exceeded"
            : error instanceof Error && error.name
              ? error.name
              : "internal_error",
        });
        return 1;
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        await todoCoordinator.waitForPendingUpdates();
        unsubscribe();
        await handle.dispose();
      }
    },
  );
}

function compactionNoOpReason(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Nothing to compact")) {
    return "nothing_to_compact";
  }
  if (message.includes("Already compacted")) {
    return "already_compacted";
  }
  return null;
}

export async function compactPiSession(
  request: HarnessHostPiRequest,
  deps: PiDeps = defaultPiDeps(),
): Promise<PiCompactionCommandResult> {
  const handle = await deps.createSession(request);
  const session = handle.session as unknown as PiSnapshotPostRunCompactionSession;
  const diagnostics = await collectPiCompactionDiagnostics(session);
  let compactionStart: JsonObject | null = null;
  let compactionEnd: JsonObject | null = null;
  let aggregatedUsage: HarnessGenAiUsageMetrics | null = null;
  const unsubscribe = session.subscribe?.((event: AgentSessionEvent) => {
    if (event.type === "message_end") {
      aggregatedUsage = mergeHarnessUsageMetrics(
        aggregatedUsage,
        piUsageMetricsFromAssistantMessage(event.message),
      );
    }
    if (event.type === "compaction_start") {
      compactionStart = summarizeCompactionEvent(event);
      return;
    }
    if (event.type === "compaction_end") {
      compactionEnd = summarizeCompactionEvent(event);
    }
  });
  return await Sentry.startSpan(
    {
      name: `compaction ${normalizedPiModelId(request) || request.model_id}`,
      op: "gen_ai.request",
      attributes: harnessGenAiSpanAttributes({
        operationName: "compaction",
        model: normalizedPiModelId(request) || request.model_id,
        providerId: request.provider_id,
        workspaceId: request.workspace_id,
        sessionId: request.session_id,
        inputId: request.input_id,
        userId: requestDefaultHeaderValue(request, "x-holaboss-user-id"),
        sandboxId: requestDefaultHeaderValue(
          request,
          "x-holaboss-sandbox-id",
        ),
        agentName: "PI Compaction",
      }),
    },
    async (span) => {
      try {
        const maintenanceResult = await runSnapshotPostRunMaintenanceCompaction(session);
        applyHarnessGenAiUsageMetrics(span, aggregatedUsage);
        if (maintenanceResult.kind === "compacted") {
          span.setAttribute("holaboss.compaction_result", "compacted");
          span.setStatus({ code: 1, message: "ok" });
          return {
            compacted: true,
            session_file: handle.sessionFile,
            result: maintenanceResult.result,
            reason: null,
            diagnostics: withCompactionEventDiagnostics(
              diagnostics,
              compactionStart,
              compactionEnd,
            ),
            error: null,
          };
        }
        if (maintenanceResult.kind === "not_compacted") {
          const compactionErrorMessage = compactionEnd
            ? optionalTrimmedString(compactionEnd["error_message"])
            : null;
          if (compactionErrorMessage) {
            const error = new Error(compactionErrorMessage);
            error.name = "PiSnapshotCompactionError";
            span.setAttribute("holaboss.compaction_result", "error");
            span.setStatus({ code: 2, message: error.name });
            return {
              compacted: false,
              session_file: handle.sessionFile,
              result: null,
              reason: null,
              diagnostics: withCompactionEventDiagnostics(
                diagnostics,
                compactionStart,
                compactionEnd,
              ),
              error: summarizePiCompactionError(error, compactionEnd),
            };
          }
          span.setAttribute(
            "holaboss.compaction_result",
            maintenanceResult.reason ?? "not_compacted",
          );
          span.setStatus({ code: 1, message: "ok" });
          return {
            compacted: false,
            session_file: handle.sessionFile,
            result: null,
            reason: maintenanceResult.reason,
            diagnostics: withCompactionEventDiagnostics(
              diagnostics,
              compactionStart,
              compactionEnd,
            ),
            error: null,
          };
        }
        if (maintenanceResult.kind === "error") {
          span.setAttribute("holaboss.compaction_result", "error");
          span.setStatus({ code: 2, message: "internal_error" });
          return {
            compacted: false,
            session_file: handle.sessionFile,
            result: null,
            reason: null,
            diagnostics: withCompactionEventDiagnostics(
              diagnostics,
              compactionStart,
              compactionEnd,
            ),
            error: summarizePiCompactionError(maintenanceResult.error, compactionEnd),
          };
        }
        const result = await handle.session.compact();
        applyHarnessGenAiUsageMetrics(span, aggregatedUsage);
        span.setAttribute("holaboss.compaction_result", "compacted");
        span.setStatus({ code: 1, message: "ok" });
        return {
          compacted: true,
          session_file: handle.sessionFile,
          result: jsonObject(JSON.parse(JSON.stringify(result)) as Record<string, unknown>),
          reason: null,
          diagnostics: withCompactionEventDiagnostics(
            diagnostics,
            compactionStart,
            compactionEnd,
          ),
          error: null,
        };
      } catch (error) {
        applyHarnessGenAiUsageMetrics(span, aggregatedUsage);
        const reason = compactionNoOpReason(error);
        if (reason) {
          span.setAttribute("holaboss.compaction_result", reason);
          span.setStatus({ code: 1, message: "ok" });
          return {
            compacted: false,
            session_file: handle.sessionFile,
            result: null,
            reason,
            diagnostics: withCompactionEventDiagnostics(
              diagnostics,
              compactionStart,
              compactionEnd,
            ),
            error: null,
          };
        }
        span.setAttribute("holaboss.compaction_result", "error");
        span.setStatus({
          code: 2,
          message: error instanceof Error && error.name ? error.name : "internal_error",
        });
        return {
          compacted: false,
          session_file: handle.sessionFile,
          result: null,
          reason: null,
          diagnostics: withCompactionEventDiagnostics(
            diagnostics,
            compactionStart,
            compactionEnd,
          ),
          error: summarizePiCompactionError(error, compactionEnd),
        };
      } finally {
        unsubscribe?.();
        await handle.dispose();
      }
    },
  );
}
