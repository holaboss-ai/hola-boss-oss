import { type ChangeEvent, type DragEvent, FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AlertTriangle, ArrowUp, Bot, Cable, Check, ChevronDown, Clock3, FileText, Image as ImageIcon, Loader2, Paperclip, Settings2, X } from "lucide-react";
import { PaneCard } from "@/components/ui/PaneCard";
import {
  EXPLORER_ATTACHMENT_DRAG_TYPE,
  type ExplorerAttachmentDragPayload,
  inferDraggedAttachmentKind,
  parseExplorerAttachmentDragPayload
} from "@/lib/attachmentDrag";
import { DEFAULT_RUNTIME_MODEL, useDesktopAuthSession } from "@/lib/auth/authClient";
import { preferredSessionId } from "@/lib/sessionRouting";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

type ChatAttachment = SessionInputAttachmentPayload;
type ChatPaneVariant = "default" | "onboarding";
type ChatPaneSessionRequest = {
  workspaceId: string;
  sessionId: string;
  key: number;
};

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: ChatAttachment[];
  traceSteps?: ChatTraceStep[];
  contentBlocks?: ChatTurnBlock[];
}

type ChatTraceStepStatus = "running" | "completed" | "error" | "waiting";

type ChatTurnBlock =
  | {
      id: string;
      kind: "text";
      text: string;
      order: number;
    }
  | {
      id: string;
      kind: "trace";
      stepId: string;
      order: number;
    };

export interface ChatTraceStep {
  id: string;
  kind: "phase" | "tool";
  title: string;
  status: ChatTraceStepStatus;
  details: string[];
  order: number;
}

export interface ManagedChatSessionRuntime {
  workspaceId: string;
  sessionId: string;
  runtimeStatus: string;
  currentInputId: string | null;
  errorMessage: string;
  events: SessionOutputEventPayload[];
  historyVersion: number;
  awaitingHistoryHydration: boolean;
}

export interface ManagedChatSessionObservedPayload {
  workspaceId: string;
  sessionId: string;
  runtimeStatus: string;
  currentInputId: string | null;
  currentInputEvents: SessionOutputEventPayload[];
}

export interface ManagedQueueSessionInputPayload {
  text: string;
  workspaceId: string;
  sessionId: string;
  attachments: SessionInputAttachmentPayload[];
  model: string | null;
}

type ManagedOptimisticLiveTurn = {
  workspaceId: string;
  sessionId: string;
  status: string;
};

interface PendingLocalAttachmentFile {
  id: string;
  source: "local-file";
  file: File;
}

interface PendingExplorerAttachmentFile {
  id: string;
  source: "explorer-path";
  absolutePath: string;
  name: string;
  mime_type?: string | null;
  size_bytes: number;
  kind: "image" | "file";
}

type PendingAttachment = PendingLocalAttachmentFile | PendingExplorerAttachmentFile;
type StartupPhaseTone = "loading" | "ready" | "error" | "waiting";

const STARTUP_OVERLAY_INITIAL_DELAY_MS = 320;
const STARTUP_OVERLAY_REPEAT_DELAY_MS = 1400;

interface StreamTelemetryEntry {
  id: string;
  at: string;
  streamId: string;
  transportType: string;
  eventName: string;
  eventType: string;
  inputId: string;
  sessionId: string;
  action: string;
  detail: string;
}

interface ChatModelOption {
  value: string;
  label: string;
}

interface ChatModelOptionGroup {
  providerId: string;
  providerLabel: string;
  options: ChatModelOption[];
}

const STREAM_ATTACH_PENDING = "__stream_attach_pending__";
const STREAM_TELEMETRY_LIMIT = 240;
const TOOL_TRACE_TERMINAL_PHASES = new Set(["completed", "failed", "error"]);
const THINKING_TRACE_STEP_ID = "phase:thinking";
const CHAT_AUTO_SCROLL_THRESHOLD_PX = 72;
const CHAT_SCROLLBAR_MIN_THUMB_HEIGHT_PX = 40;
const CHAT_INITIAL_ASSISTANT_SCROLL_TOP_OFFSET_PX = 20;
const CHAT_MODEL_STORAGE_KEY = "holaboss-chat-model-v1";
const CHAT_MODEL_RUNTIME_DEFAULT_LEGACY = "__runtime_default__";
const LEGACY_UNAVAILABLE_CHAT_MODELS = new Set(["openai/gpt-5.2-mini"]);
const DEPRECATED_CHAT_MODEL_IDS = new Set([
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex-max"
]);
const CHAT_MODEL_PRESETS = [
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.3-codex",
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-opus-4-1"
] as const;
const HOLABOSS_PROVIDER_IDS = new Set(["holaboss", "holaboss_model_proxy"]);

function sessionUserId(session: { user?: { id?: string | null } | null } | null | undefined): string {
  return session?.user?.id?.trim() || "";
}

function isHolabossProviderModel(providerId: string, model: string) {
  const normalizedProviderId = providerId.trim().toLowerCase();
  if (HOLABOSS_PROVIDER_IDS.has(normalizedProviderId)) {
    return true;
  }

  const normalizedModel = model.trim().toLowerCase();
  return normalizedModel.startsWith("holaboss/") || normalizedModel.startsWith("holaboss_model_proxy/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : "Request failed.";
  const normalized = message.trim().toLowerCase();
  if (normalized === "aborted" || normalized.includes("stream aborted") || normalized.includes("aborterror")) {
    return "App is still starting up. Try again in a moment.";
  }
  return message;
}

function normalizeLegacyChatModelToken(token: string): string {
  return token.trim();
}

function normalizeStoredChatModelPreference(value: string | null | undefined) {
  const stored = normalizeLegacyChatModelToken(value ?? "");
  if (!stored) {
    return "";
  }
  if (stored === CHAT_MODEL_RUNTIME_DEFAULT_LEGACY) {
    return "";
  }
  if (LEGACY_UNAVAILABLE_CHAT_MODELS.has(stored.toLowerCase())) {
    return "";
  }
  return stored;
}

function loadStoredChatModelPreference() {
  try {
    return normalizeStoredChatModelPreference(localStorage.getItem(CHAT_MODEL_STORAGE_KEY));
  } catch {
    return "";
  }
}

function displayModelLabel(model: string) {
  const trimmed = model.trim();
  if (!trimmed) {
    return "Unknown model";
  }

  const [prefix, ...rest] = trimmed.split("/");
  const normalizedPrefix = prefix.trim().toLowerCase();
  const withoutProvider =
    rest.length > 0 &&
    (
      normalizedPrefix.includes("openai") ||
      normalizedPrefix.includes("anthropic") ||
      normalizedPrefix.includes("holaboss") ||
      normalizedPrefix.includes("openrouter") ||
      normalizedPrefix.includes("gemini") ||
      normalizedPrefix.includes("google") ||
      normalizedPrefix.includes("ollama")
    )
      ? rest.join("/")
      : trimmed;
  const claudeFamilyMatch = withoutProvider.match(/^claude-(sonnet|opus|haiku)-(\d+)-(\d+)$/i);
  if (claudeFamilyMatch) {
    const family = `${claudeFamilyMatch[1][0]?.toUpperCase() ?? ""}${claudeFamilyMatch[1].slice(1).toLowerCase()}`;
    return `Claude ${family} ${claudeFamilyMatch[2]}.${claudeFamilyMatch[3]}`;
  }

  if (/^gpt-/i.test(withoutProvider)) {
    return withoutProvider
      .replace(/^gpt-/i, "GPT-")
      .replace(/-mini\b/gi, " Mini")
      .replace(/-nano\b/gi, " Nano")
      .replace(/-codex\b/gi, " Codex")
      .replace(/-max\b/gi, " Max")
      .replace(/-spark\b/gi, " Spark");
  }

  return withoutProvider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (/^\d+(\.\d+)?$/.test(part) ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`))
    .join(" ");
}

function inferProviderIdForModel(model: string) {
  const trimmed = model.trim();
  if (!trimmed) {
    return "openai";
  }
  if (trimmed.includes("/")) {
    const [provider] = trimmed.split("/");
    return provider.trim().toLowerCase() || "openai";
  }
  if (trimmed.toLowerCase().startsWith("claude")) {
    return "anthropic";
  }
  return "openai";
}

function isDeprecatedChatModel(model: string) {
  const normalized = model.trim();
  if (!normalized) {
    return false;
  }
  const [prefix, ...rest] = normalized.split("/");
  const normalizedPrefix = prefix.trim().toLowerCase();
  const modelId =
    rest.length > 0 &&
    (
      normalizedPrefix.includes("openai") ||
      normalizedPrefix.includes("anthropic") ||
      normalizedPrefix.includes("holaboss") ||
      normalizedPrefix.includes("openrouter") ||
      normalizedPrefix.includes("gemini") ||
      normalizedPrefix.includes("google") ||
      normalizedPrefix.includes("ollama")
    )
      ? rest.join("/").trim().toLowerCase()
      : normalized.toLowerCase();
  return DEPRECATED_CHAT_MODEL_IDS.has(modelId);
}

function displayProviderLabel(providerId: string) {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === "openai" || normalized.includes("openai")) {
    return "OpenAI";
  }
  if (normalized === "anthropic" || normalized.includes("anthropic")) {
    return "Anthropic";
  }
  if (normalized.includes("openrouter")) {
    return "OpenRouter";
  }
  if (normalized.includes("gemini") || normalized.includes("google")) {
    return "Gemini";
  }
  if (normalized.includes("ollama")) {
    return "Ollama";
  }
  if (normalized.includes("holaboss")) {
    return "Holaboss";
  }
  return providerId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeChatAttachment(value: unknown): ChatAttachment | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const mimeType = typeof value.mime_type === "string" ? value.mime_type.trim() : "";
  const workspacePath = typeof value.workspace_path === "string" ? value.workspace_path.trim() : "";
  const sizeBytes = typeof value.size_bytes === "number" && Number.isFinite(value.size_bytes) ? value.size_bytes : 0;
  const kind = value.kind === "image" ? "image" : value.kind === "file" ? "file" : mimeType.startsWith("image/") ? "image" : "file";

  if (!id || !name || !mimeType || !workspacePath) {
    return null;
  }

  return {
    id,
    kind,
    name,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    workspace_path: workspacePath
  };
}

function attachmentsFromMetadata(metadata: Record<string, unknown> | null | undefined): ChatAttachment[] {
  const raw = metadata?.attachments;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => normalizeChatAttachment(item)).filter((item): item is ChatAttachment => Boolean(item));
}

function hasRenderableMessageContent(text: string, attachments: ChatAttachment[]) {
  return Boolean(text.trim()) || attachments.length > 0;
}

function hasRenderableAssistantContent(message: ChatMessage) {
  return (
    hasRenderableMessageContent(message.text, message.attachments ?? []) ||
    (message.contentBlocks?.length ?? 0) > 0 ||
    (message.traceSteps?.length ?? 0) > 0
  );
}

function formatAttachmentSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "";
  }
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }
  return `${sizeBytes} B`;
}

function attachmentButtonLabel(attachment: { name: string; size_bytes: number }) {
  const sizeLabel = formatAttachmentSize(attachment.size_bytes);
  return sizeLabel ? `${attachment.name} (${sizeLabel})` : attachment.name;
}

function attachmentUploadPayload(file: File): Promise<StageSessionAttachmentFilePayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      resolve({
        name: file.name,
        mime_type: file.type || null,
        content_base64: separator >= 0 ? result.slice(separator + 1) : result
      });
    };
    reader.readAsDataURL(file);
  });
}

function pendingAttachmentId(seed: string) {
  return `${seed}-${crypto.randomUUID()}`;
}

function runtimeStateStatus(value: string | null | undefined): string {
  return (value || "").trim().toUpperCase();
}

function runtimeStateErrorDetail(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const payload = value as Record<string, unknown>;
    const message = payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
    const error = payload.error;
    if (typeof error === "string" && error.trim()) {
      return error;
    }
  }
  return "The run failed.";
}

function onboardingStatusLabel(value: string | null | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "awaiting_confirmation") {
    return "Awaiting confirmation";
  }
  if (normalized === "in_progress") {
    return "In progress";
  }
  if (normalized === "completed") {
    return "Completed";
  }
  return "Pending";
}

function onboardingStatusTone(value: string | null | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "awaiting_confirmation") {
    return "border-[rgba(247,170,126,0.22)] bg-[rgba(247,170,126,0.1)] text-[rgba(224,146,103,0.96)]";
  }
  if (normalized === "in_progress") {
    return "border-neon-green/30 bg-neon-green/10 text-neon-green";
  }
  if (normalized === "completed") {
    return "border-[rgba(92,180,120,0.22)] bg-[rgba(92,180,120,0.08)] text-[rgba(118,196,144,0.94)]";
  }
  return "border-[rgba(247,90,84,0.22)] bg-[rgba(247,90,84,0.08)] text-[rgba(206,92,84,0.94)]";
}

function startCase(value: string) {
  const normalized = value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
}

function summarizeUnknown(value: unknown, maxLength = 140): string {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trimEnd()}...` : normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const rendered = value
      .slice(0, 4)
      .map((item) => summarizeUnknown(item, 48))
      .filter(Boolean)
      .join(", ");
    return value.length > 4 ? `${rendered}, ...` : rendered;
  }
  if (isRecord(value)) {
    const rendered = Object.entries(value)
      .slice(0, 4)
      .map(([key, entryValue]) => `${startCase(key)}: ${summarizeUnknown(entryValue, 36)}`)
      .join(" | ");
    return Object.keys(value).length > 4 ? `${rendered} | ...` : rendered;
  }
  if (value == null) {
    return "";
  }
  return String(value);
}

function toolTraceStepId(payload: Record<string, unknown>) {
  const callId = typeof payload.call_id === "string" ? payload.call_id.trim() : "";
  const toolId = typeof payload.tool_id === "string" ? payload.tool_id.trim() : "";
  const toolName = typeof payload.tool_name === "string" ? payload.tool_name.trim() : "";
  return callId || toolId || toolName ? `tool:${callId || toolId || toolName}` : "";
}

function inputIdFromMessageId(messageId: string, role: "user" | "assistant") {
  const prefix = `${role}-`;
  return messageId.startsWith(prefix) ? messageId.slice(prefix.length) : "";
}

function extractMcpErrorText(result: unknown): string {
  if (!isRecord(result) || result.isError !== true) {
    return "";
  }
  const content = Array.isArray(result.content) ? result.content : [];
  for (const part of content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      const text = part.text.trim();
      if (text) {
        return text.length > 200 ? `${text.slice(0, 197).trimEnd()}...` : text;
      }
    }
  }
  return "";
}

function isIntegrationError(text: string): { provider: string; action: string } | null {
  const patterns: Array<{ pattern: RegExp; provider: string }> = [
    { pattern: /no\s+google\s+token/i, provider: "Google" },
    { pattern: /no\s+github\s+token/i, provider: "GitHub" },
    { pattern: /no\s+reddit\s+token/i, provider: "Reddit" },
    { pattern: /no\s+twitter\s+token/i, provider: "Twitter" },
    { pattern: /no\s+linkedin\s+token/i, provider: "LinkedIn" },
    { pattern: /PLATFORM_INTEGRATION_TOKEN/i, provider: "" },
    { pattern: /integration.*not.*connected/i, provider: "" },
    { pattern: /integration.*not.*bound/i, provider: "" },
    { pattern: /connect\s+via\s+(settings|integrations)/i, provider: "" },
  ];
  for (const { pattern, provider } of patterns) {
    if (pattern.test(text)) {
      const resolved = provider || "this provider";
      return { provider: resolved, action: `Connect ${resolved} in the Integrations tab` };
    }
  }
  return null;
}

function toolTraceStepFromPayload(payload: Record<string, unknown>, order: number): ChatTraceStep | null {
  const stepId = toolTraceStepId(payload);
  const toolName = typeof payload.tool_name === "string" ? payload.tool_name.trim() : "";
  const toolId = typeof payload.tool_id === "string" ? payload.tool_id.trim() : "";
  const phase = typeof payload.phase === "string" ? payload.phase.trim().toLowerCase() : "";
  const label = startCase(toolName || toolId);
  if (!stepId || !label) {
    return null;
  }

  const isError = payload.error === true || phase === "error";
  const details: string[] = [];
  const argsSummary = summarizeUnknown(payload.tool_args);
  const resultSummary = summarizeUnknown(payload.result);
  const errorSummary = summarizeUnknown(payload.error);
  const mcpErrorText = extractMcpErrorText(payload.result);

  if (phase === "started") {
    details.push("Tool call started.");
    if (argsSummary) {
      details.push(`Inputs: ${argsSummary}`);
    }
  } else if (TOOL_TRACE_TERMINAL_PHASES.has(phase)) {
    if (isError && mcpErrorText) {
      details.push(mcpErrorText);
    } else if (isError) {
      details.push("Tool call returned an error.");
      if (errorSummary && errorSummary !== "true" && errorSummary !== "false") {
        details.push(`Error: ${errorSummary}`);
      }
    } else {
      details.push("Tool call completed.");
    }
    if (!isError && resultSummary) {
      details.push(`Result: ${resultSummary}`);
    }
  } else if (argsSummary) {
    details.push(`Inputs: ${argsSummary}`);
  }

  return {
    id: stepId,
    kind: "tool",
    title: label,
    status: isError ? "error" : TOOL_TRACE_TERMINAL_PHASES.has(phase) ? "completed" : "running",
    details,
    order
  };
}

function toolTraceStepFromEvent(eventType: string, payload: Record<string, unknown>, order: number): ChatTraceStep | null {
  if (
    eventType !== "tool_call" &&
    eventType !== "tool_call_started" &&
    eventType !== "tool_started" &&
    eventType !== "tool_completed"
  ) {
    return null;
  }

  return toolTraceStepFromPayload(
    eventType === "tool_call"
      ? payload
      : {
          ...payload,
          phase:
            eventType === "tool_completed"
              ? "completed"
              : eventType === "tool_call_started" || eventType === "tool_started"
                ? "started"
                : payload.phase
        },
    order
  );
}

function phaseTraceStepFromEvent(eventType: string, payload: Record<string, unknown>, order: number): ChatTraceStep | null {
  const phase = typeof payload.phase === "string" ? payload.phase.trim() : "";
  const instructionPreview = typeof payload.instruction_preview === "string" ? payload.instruction_preview.trim() : "";
  const details: string[] = [];

  if (eventType === "run_waiting_user" || eventType === "awaiting_user_input") {
    return {
      id: "phase:awaiting-user",
      kind: "phase",
      title: "Waiting for your input",
      status: "waiting",
      details: ["The agent needs a follow-up answer before it can continue."],
      order
    };
  }

  if (eventType === "run_failed") {
    const errorText =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : "";
    if (errorText) {
      details.push(`Error: ${summarizeUnknown(errorText, 120)}`);
    }
    return {
      id: "phase:run-failed",
      kind: "phase",
      title: "Run failed",
      status: "error",
      details,
      order
    };
  }

  return null;
}

function upsertTraceStep(previous: ChatTraceStep[], step: ChatTraceStep) {
  const existingIndex = previous.findIndex((entry) => entry.id === step.id);
  if (existingIndex < 0) {
    return [...previous, step].sort((left, right) => left.order - right.order);
  }

  return previous
    .map((entry, index) =>
      index === existingIndex
        ? {
            ...entry,
            ...step,
            order: Math.min(entry.order, step.order),
            details: step.details.length > 0 ? step.details : entry.details
          }
        : entry
    )
    .sort((left, right) => left.order - right.order);
}

function appendThinkingTraceStep(previous: ChatTraceStep[], delta: string, order: number) {
  if (!delta) {
    return previous;
  }

  const existing = previous.find((entry) => entry.id === THINKING_TRACE_STEP_ID);
  const nextText = `${existing?.details[0] || ""}${delta}`;
  return upsertTraceStep(previous, {
    id: THINKING_TRACE_STEP_ID,
    kind: "phase",
    title: "Thinking",
    status: "running",
    details: nextText ? [nextText] : [],
    order: existing ? Math.min(existing.order, order) : order
  });
}

function finalizeTraceSteps(
  previous: ChatTraceStep[],
  status: Extract<ChatTraceStepStatus, "completed" | "error">
) {
  return previous.map((step) =>
    step.status === "running"
      ? {
          ...step,
          status
        }
      : step
  );
}

function appendTextBlock(previous: ChatTurnBlock[], delta: string, order: number) {
  if (!delta) {
    return previous;
  }

  const lastBlock = previous[previous.length - 1];
  if (lastBlock?.kind === "text") {
    return [
      ...previous.slice(0, -1),
      {
        ...lastBlock,
        text: `${lastBlock.text}${delta}`
      }
    ] as ChatTurnBlock[];
  }

  return [
    ...previous,
    {
      id: `text:${order}`,
      kind: "text",
      text: delta,
      order
    }
  ] as ChatTurnBlock[];
}

function upsertTraceBlock(previous: ChatTurnBlock[], step: ChatTraceStep) {
  const existingIndex = previous.findIndex((block) => block.kind === "trace" && block.stepId === step.id);
  if (existingIndex >= 0) {
    return previous.map((block, index) =>
      index === existingIndex
        ? {
            ...block,
            order: Math.min(block.order, step.order)
          }
        : block
    );
  }

  return [...previous, { id: `trace:${step.id}`, kind: "trace", stepId: step.id, order: step.order }].sort(
    (left, right) => left.order - right.order
  ) as ChatTurnBlock[];
}

function assistantHistoryStateFromOutputEvents(outputEvents: SessionOutputEventPayload[]) {
  const orderedEvents = [...outputEvents].sort((left, right) => left.sequence - right.sequence || left.id - right.id);
  let outputText = "";
  let traceSteps: ChatTraceStep[] = [];
  let contentBlocks: ChatTurnBlock[] = [];
  let liveStatus = "";
  let lastEventId = 0;

  for (const event of orderedEvents) {
    lastEventId = Math.max(lastEventId, event.id);
    const eventPayload = isRecord(event.payload) ? event.payload : {};

    if (event.event_type === "run_claimed") {
      liveStatus = "Thinking...";
    } else if (event.event_type === "run_started") {
      liveStatus = "Checking workspace context...";
    } else if (event.event_type === "run_waiting_user" || event.event_type === "awaiting_user_input") {
      liveStatus = "Waiting for your input...";
    }

    if (event.event_type === "output_delta") {
      const delta = typeof eventPayload.delta === "string" ? eventPayload.delta : "";
      if (delta) {
        outputText = `${outputText}${delta}`;
        contentBlocks = appendTextBlock(contentBlocks, delta, event.sequence);
        liveStatus = "Writing response...";
      }
    }

    if (event.event_type === "thinking_delta") {
      const delta = typeof eventPayload.delta === "string" ? eventPayload.delta : "";
      if (delta) {
        traceSteps = appendThinkingTraceStep(traceSteps, delta, event.sequence);
        const thinkingStep = traceSteps.find((step) => step.id === THINKING_TRACE_STEP_ID);
        if (thinkingStep) {
          contentBlocks = upsertTraceBlock(contentBlocks, thinkingStep);
        }
        liveStatus = "Thinking...";
      }
    }

    const phaseStep = phaseTraceStepFromEvent(event.event_type, eventPayload, event.sequence);
    if (phaseStep) {
      traceSteps = upsertTraceStep(traceSteps, phaseStep);
      contentBlocks = upsertTraceBlock(contentBlocks, phaseStep);
    }

    const toolStep = toolTraceStepFromEvent(event.event_type, eventPayload, event.sequence);
    if (toolStep) {
      traceSteps = upsertTraceStep(traceSteps, toolStep);
      contentBlocks = upsertTraceBlock(contentBlocks, toolStep);
      liveStatus = toolStep.status === "completed" ? "Writing response..." : "Using tools...";
    }

    if (event.event_type === "run_completed") {
      traceSteps = finalizeTraceSteps(traceSteps, "completed");
      liveStatus = "";
    } else if (event.event_type === "run_failed") {
      traceSteps = finalizeTraceSteps(traceSteps, "error");
    }
  }

  return {
    outputText: outputText || undefined,
    traceSteps: traceSteps.length > 0 ? traceSteps : undefined,
    contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
    liveStatus: liveStatus || undefined,
    lastEventId
  };
}

function isNearChatBottom(container: HTMLDivElement) {
  const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
  return remaining <= CHAT_AUTO_SCROLL_THRESHOLD_PX;
}

export function ChatPane({
  onOutputsChanged,
  focusRequestKey = 0,
  sessionRequest = null,
  onActiveSessionChange,
  managedSessionRuntime = null,
  onManagedSessionObserved,
  onManagedHistoryHydrated,
  onManagedQueueSessionInput,
  variant = "default"
}: {
  onOutputsChanged?: () => void;
  focusRequestKey?: number;
  sessionRequest?: ChatPaneSessionRequest | null;
  onActiveSessionChange?: (sessionId: string | null) => void;
  managedSessionRuntime?: ManagedChatSessionRuntime | null;
  onManagedSessionObserved?: (payload: ManagedChatSessionObservedPayload) => void;
  onManagedHistoryHydrated?: (payload: { workspaceId: string; sessionId: string; historyVersion: number }) => void;
  onManagedQueueSessionInput?: (payload: ManagedQueueSessionInputPayload) => Promise<EnqueueSessionInputResponsePayload>;
  variant?: ChatPaneVariant;
}) {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const authSessionState = useDesktopAuthSession();
  const {
    runtimeConfig,
    runtimeStatus,
    selectedWorkspace,
    isLoadingBootstrap,
    isActivatingWorkspace,
    workspaceAppsReady,
    workspaceBlockingReason,
    refreshWorkspaceData
  } = useWorkspaceDesktop();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [liveAssistantText, setLiveAssistantText] = useState("");
  const [liveAgentStatus, setLiveAgentStatus] = useState("");
  const [liveTraceSteps, setLiveTraceSteps] = useState<ChatTraceStep[]>([]);
  const [liveContentBlocks, setLiveContentBlocks] = useState<ChatTurnBlock[]>([]);
  const [managedOptimisticLiveTurn, setManagedOptimisticLiveTurn] = useState<ManagedOptimisticLiveTurn | null>(null);
  const [collapsedTraceByStepId, setCollapsedTraceByStepId] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [chatErrorMessage, setChatErrorMessage] = useState("");
  const [isPaneDragActive, setIsPaneDragActive] = useState(false);
  const [verboseTelemetryEnabled, setVerboseTelemetryEnabled] = useState(false);
  const [composerBlockHeight, setComposerBlockHeight] = useState(0);
  const [chatModelPreference, setChatModelPreference] = useState(loadStoredChatModelPreference);
  const [chatScrollMetrics, setChatScrollMetrics] = useState({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0
  });
  const [streamTelemetry, setStreamTelemetry] = useState<StreamTelemetryEntry[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const liveAssistantTurnRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerBlockRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const pendingInitialAssistantJumpRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const pendingInputIdRef = useRef<string | null>(null);
  const seenMainDebugKeysRef = useRef<Set<string>>(new Set());
  const selectedWorkspaceRef = useRef<WorkspaceRecordPayload | null>(null);
  const startupUnlockedWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const isOnboardingVariant = variant === "onboarding";
  const managedMode = !isOnboardingVariant && Boolean(onManagedSessionObserved && onManagedQueueSessionInput);
  const pendingFocusRequestKeyRef = useRef<number | null>(focusRequestKey);
  const liveAssistantTextRef = useRef("");
  const liveTraceStepsRef = useRef<ChatTraceStep[]>([]);
  const liveContentBlocksRef = useRef<ChatTurnBlock[]>([]);
  const hydratedStreamReplayRef = useRef<{
    sessionId: string;
    inputId: string;
    maxEventId: number;
  } | null>(null);
  const [activeSessionId, setActiveSessionId] = useState("");
  const managedSessionMatchesActive =
    managedMode &&
    Boolean(selectedWorkspaceId) &&
    managedSessionRuntime?.workspaceId === selectedWorkspaceId &&
    managedSessionRuntime?.sessionId === activeSessionId;
  const managedOptimisticMatchesActive =
    managedMode &&
    Boolean(selectedWorkspaceId) &&
    managedOptimisticLiveTurn?.workspaceId === selectedWorkspaceId &&
    managedOptimisticLiveTurn?.sessionId === activeSessionId;
  const managedLiveState = useMemo(
    () => (managedSessionMatchesActive && managedSessionRuntime ? assistantHistoryStateFromOutputEvents(managedSessionRuntime.events) : null),
    [managedSessionMatchesActive, managedSessionRuntime]
  );
  const managedRuntimeStatus = managedSessionMatchesActive ? runtimeStateStatus(managedSessionRuntime?.runtimeStatus) : "";
  const optimisticManagedStatus = managedOptimisticMatchesActive ? managedOptimisticLiveTurn?.status || "" : "";
  const effectiveLiveAssistantText = managedLiveState?.outputText || (!managedMode ? liveAssistantText : "");
  const effectiveLiveTraceSteps = managedLiveState?.traceSteps ?? (!managedMode ? liveTraceSteps : []);
  const effectiveLiveContentBlocks = managedLiveState?.contentBlocks ?? (!managedMode ? liveContentBlocks : []);
  const effectiveLiveAgentStatus =
    managedMode && (managedSessionMatchesActive || managedOptimisticMatchesActive)
      ? managedLiveState?.liveStatus ||
        (managedRuntimeStatus === "WAITING_USER"
          ? "Waiting for your input..."
          : managedRuntimeStatus === "QUEUED"
            ? "Thinking..."
            : managedRuntimeStatus === "BUSY"
              ? "Thinking..."
              : optimisticManagedStatus)
      : liveAgentStatus;
  const effectiveIsResponding =
    managedMode && (managedSessionMatchesActive || managedOptimisticMatchesActive)
      ? managedRuntimeStatus === "BUSY" || managedRuntimeStatus === "QUEUED" || managedOptimisticMatchesActive
      : isResponding;
  const effectiveChatErrorMessage =
    chatErrorMessage || (managedMode && managedSessionMatchesActive ? managedSessionRuntime?.errorMessage || "" : "");
  const shouldShowManagedLiveTurn =
    managedMode &&
    (managedSessionMatchesActive || managedOptimisticMatchesActive) &&
    Boolean(
      effectiveLiveAssistantText ||
        effectiveLiveTraceSteps.length > 0 ||
        effectiveChatErrorMessage ||
        effectiveIsResponding ||
        managedSessionRuntime?.awaitingHistoryHydration ||
        managedRuntimeStatus === "WAITING_USER"
    );

  function appendStreamTelemetry(entry: Omit<StreamTelemetryEntry, "id" | "at">) {
    if (!verboseTelemetryEnabled) {
      return;
    }
    const at = new Date().toISOString().slice(11, 23);
    const next: StreamTelemetryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at,
      ...entry
    };
    setStreamTelemetry((prev) => {
      const merged = [...prev, next];
      if (merged.length <= STREAM_TELEMETRY_LIMIT) {
        return merged;
      }
      return merged.slice(merged.length - STREAM_TELEMETRY_LIMIT);
    });
  }

  async function closeStreamWithReason(streamId: string, reason: string) {
    appendStreamTelemetry({
      streamId,
      transportType: "client",
      eventName: "closeSessionOutputStream",
      eventType: "close_request",
      inputId: pendingInputIdRef.current || "",
      sessionId: activeSessionIdRef.current || "",
      action: "close_requested",
      detail: reason
    });
    await window.electronAPI.workspace.closeSessionOutputStream(streamId, reason);
  }

  function setActiveSession(sessionId: string | null) {
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId ?? "");
    onActiveSessionChange?.(sessionId);
  }

  function resetLiveTurn() {
    liveAssistantTextRef.current = "";
    liveTraceStepsRef.current = [];
    liveContentBlocksRef.current = [];
    activeAssistantMessageIdRef.current = null;
    setLiveAssistantText("");
    setLiveAgentStatus("");
    setLiveTraceSteps([]);
    setLiveContentBlocks([]);
  }

  function scrollLiveAssistantTurnIntoView() {
    const container = messagesRef.current;
    const liveTurn = liveAssistantTurnRef.current;
    if (!container) {
      return;
    }
    if (!liveTurn) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const liveTurnRect = liveTurn.getBoundingClientRect();
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const targetScrollTop = Math.min(
      maxScrollTop,
      Math.max(
        0,
        container.scrollTop + (liveTurnRect.top - containerRect.top) - CHAT_INITIAL_ASSISTANT_SCROLL_TOP_OFFSET_PX
      )
    );
    if (Math.abs(container.scrollTop - targetScrollTop) < 2) {
      return;
    }
    container.scrollTo({
      top: targetScrollTop,
      behavior: "smooth"
    });
    syncChatScrollMetrics(container);
  }

  function restoreLiveTurnFromOutputEvents(outputEvents: SessionOutputEventPayload[], options?: {
    status?: string;
    currentInputId?: string;
  }) {
    const restored = assistantHistoryStateFromOutputEvents(outputEvents);
    const normalizedStatus = runtimeStateStatus(options?.status);

    liveAssistantTextRef.current = restored.outputText || "";
    liveTraceStepsRef.current = restored.traceSteps ?? [];
    liveContentBlocksRef.current = restored.contentBlocks ?? [];
    activeAssistantMessageIdRef.current = options?.currentInputId ? `assistant-${options.currentInputId}` : null;

    setLiveAssistantText(restored.outputText || "");
    setLiveTraceSteps(restored.traceSteps ?? []);
    setLiveContentBlocks(restored.contentBlocks ?? []);

    if (normalizedStatus === "WAITING_USER") {
      setLiveAgentStatus("Waiting for your input...");
      return restored;
    }
    if (normalizedStatus === "ERROR") {
      setLiveAgentStatus("");
      return restored;
    }
    if (normalizedStatus === "QUEUED" && !restored.liveStatus) {
      setLiveAgentStatus("Thinking...");
      return restored;
    }
    if (normalizedStatus === "BUSY" && !restored.liveStatus) {
      setLiveAgentStatus("Thinking...");
      return restored;
    }
    setLiveAgentStatus(restored.liveStatus || "");
    return restored;
  }

  async function attachExistingSessionStream(options: {
    workspaceId: string;
    sessionId: string;
    inputId: string;
    hydratedUpToEventId: number;
  }) {
    const currentStreamId = activeStreamIdRef.current;
    if (currentStreamId) {
      await closeStreamWithReason(currentStreamId, "reattach_existing_session_stream").catch(() => undefined);
      activeStreamIdRef.current = null;
    }
    hydratedStreamReplayRef.current = {
      sessionId: options.sessionId,
      inputId: options.inputId,
      maxEventId: options.hydratedUpToEventId
    };
    const stream = await window.electronAPI.workspace.openSessionOutputStream({
      sessionId: options.sessionId,
      workspaceId: options.workspaceId,
      inputId: options.inputId,
      includeHistory: true,
      stopOnTerminal: true
    });
    activeStreamIdRef.current = stream.streamId;
    appendStreamTelemetry({
      streamId: stream.streamId,
      transportType: "client",
      eventName: "openSessionOutputStream",
      eventType: "stream_open_existing_session",
      inputId: options.inputId,
      sessionId: options.sessionId,
      action: "stream_requested_existing_session",
      detail: `hydrated_up_to=${options.hydratedUpToEventId}`
    });
  }

  function appendLiveAssistantDelta(delta: string, order: number) {
    flushSync(() => {
      setLiveAssistantText((prev) => {
        const next = `${prev}${delta}`;
        liveAssistantTextRef.current = next;
        return next;
      });
      setLiveContentBlocks((prev) => {
        const next = appendTextBlock(prev, delta, order);
        liveContentBlocksRef.current = next;
        return next;
      });
    });
  }

  function appendLiveThinkingTraceDelta(delta: string, order: number) {
    flushSync(() => {
      const next = appendThinkingTraceStep(liveTraceStepsRef.current, delta, order);
      liveTraceStepsRef.current = next;
      setLiveTraceSteps(next);
      const thinkingStep = next.find((step) => step.id === THINKING_TRACE_STEP_ID);
      if (thinkingStep) {
        setLiveContentBlocks((prev) => {
          const nextBlocks = upsertTraceBlock(prev, thinkingStep);
          liveContentBlocksRef.current = nextBlocks;
          return nextBlocks;
        });
      }
    });
    setCollapsedTraceByStepId((prev) => ({
      ...prev,
      [THINKING_TRACE_STEP_ID]: false
    }));
  }

  function commitLiveAssistantMessage() {
    const messageId = activeAssistantMessageIdRef.current ?? `assistant-${Date.now()}`;
    const assistantText = liveAssistantTextRef.current;
    const traceSteps = liveTraceStepsRef.current;
    const contentBlocks = liveContentBlocksRef.current;
    if (!assistantText && traceSteps.length === 0 && contentBlocks.length === 0) {
      resetLiveTurn();
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        role: "assistant",
        text: assistantText,
        traceSteps: traceSteps.length > 0 ? traceSteps : undefined,
        contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined
      }
    ]);
    resetLiveTurn();
  }

  function toggleTraceStep(stepId: string) {
    setCollapsedTraceByStepId((prev) => ({
      ...prev,
      [stepId]: !prev[stepId]
    }));
  }

  function setLiveTraceStepsState(nextSteps: ChatTraceStep[]) {
    liveTraceStepsRef.current = nextSteps;
    setLiveTraceSteps(nextSteps);
  }

  function setLiveContentBlocksState(nextBlocks: ChatTurnBlock[]) {
    liveContentBlocksRef.current = nextBlocks;
    setLiveContentBlocks(nextBlocks);
  }

  function syncChatScrollMetrics(container?: HTMLDivElement | null) {
    const target = container ?? messagesRef.current;
    if (!target) {
      return;
    }

    setChatScrollMetrics((previous) => {
      const next = {
        scrollTop: target.scrollTop,
        scrollHeight: target.scrollHeight,
        clientHeight: target.clientHeight
      };

      if (
        previous.scrollTop === next.scrollTop &&
        previous.scrollHeight === next.scrollHeight &&
        previous.clientHeight === next.clientHeight
      ) {
        return previous;
      }

      return next;
    });
  }

  function upsertLiveTraceStep(step: ChatTraceStep, options?: { expand?: boolean }) {
    const next = upsertTraceStep(liveTraceStepsRef.current, step);
    setLiveTraceStepsState(next);
    setLiveContentBlocksState(upsertTraceBlock(liveContentBlocksRef.current, step));
    if (options?.expand) {
      setCollapsedTraceByStepId((prev) => (step.id in prev ? prev : { ...prev, [step.id]: false }));
    }
  }

  function finalizeLiveTraceSteps(status: Extract<ChatTraceStepStatus, "completed" | "error">) {
    const next = finalizeTraceSteps(liveTraceStepsRef.current, status);
    setLiveTraceStepsState(next);
  }

  useEffect(() => {
    const container = messagesRef.current;
    if (!container || !shouldAutoScrollRef.current) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth"
    });
  }, [messages]);

  useEffect(() => {
    selectedWorkspaceRef.current = selectedWorkspace;
  }, [selectedWorkspace]);

  useEffect(() => {
    setPendingAttachments([]);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    const normalizedPreference = normalizeStoredChatModelPreference(chatModelPreference);
    if (normalizedPreference !== chatModelPreference) {
      setChatModelPreference(normalizedPreference);
    }
  }, [chatModelPreference]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_MODEL_STORAGE_KEY, chatModelPreference);
    } catch {
      // ignore persistence failures
    }
  }, [chatModelPreference]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [input]);

  useEffect(() => {
    pendingFocusRequestKeyRef.current = focusRequestKey;
  }, [focusRequestKey]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }
    if (!selectedWorkspace || isLoadingBootstrap || isLoadingHistory) {
      return;
    }
    if (pendingFocusRequestKeyRef.current !== focusRequestKey) {
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea || textarea.disabled) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const activeTextarea = textareaRef.current;
      if (!activeTextarea || activeTextarea.disabled) {
        return;
      }
      activeTextarea.click();
      activeTextarea.focus({ preventScroll: true });
      const cursorPosition = activeTextarea.value.length;
      activeTextarea.setSelectionRange(cursorPosition, cursorPosition);
      pendingFocusRequestKeyRef.current = null;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [focusRequestKey, isLoadingBootstrap, isLoadingHistory, selectedWorkspace, selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      pendingInitialAssistantJumpRef.current = false;
      setMessages([]);
      resetLiveTurn();
      setManagedOptimisticLiveTurn(null);
      setCollapsedTraceByStepId({});
      setPendingAttachments([]);
      setActiveSession(null);
      shouldAutoScrollRef.current = true;
      pendingInputIdRef.current = null;
      hydratedStreamReplayRef.current = null;
      return;
    }

    let cancelled = false;

    async function loadHistory() {
      setIsLoadingHistory(true);
      setChatErrorMessage("");

      try {
        const runtimeStates = await window.electronAPI.workspace.listRuntimeStates(selectedWorkspaceId);
        if (cancelled) {
          return;
        }

        const requestedSessionId =
          sessionRequest?.workspaceId === selectedWorkspaceId ? sessionRequest.sessionId.trim() : "";
        const currentSessionId = (activeSessionIdRef.current || "").trim();
        const mainSessionId = (selectedWorkspaceRef.current?.main_session_id || "").trim();
        const onboardingSessionId = (selectedWorkspaceRef.current?.onboarding_session_id || "").trim();
        const currentSessionStillAvailable =
          Boolean(currentSessionId) &&
          (runtimeStates.items.some((item) => item.session_id === currentSessionId) ||
            currentSessionId === mainSessionId ||
            currentSessionId === onboardingSessionId);
        const nextSessionId =
          requestedSessionId ||
          (currentSessionStillAvailable ? currentSessionId : preferredSessionId(selectedWorkspaceRef.current, runtimeStates.items));
        if (activeSessionIdRef.current !== nextSessionId) {
          const activeStreamId = activeStreamIdRef.current;
          if (activeStreamId) {
            await closeStreamWithReason(activeStreamId, "session_switch_reload").catch(() => undefined);
            activeStreamIdRef.current = null;
          }
          pendingInputIdRef.current = null;
          setIsResponding(false);
          setMessages([]);
          resetLiveTurn();
          setManagedOptimisticLiveTurn(null);
          setCollapsedTraceByStepId({});
          pendingInitialAssistantJumpRef.current = false;
          shouldAutoScrollRef.current = true;
          hydratedStreamReplayRef.current = null;
        }
        setActiveSession(nextSessionId);
        if (!nextSessionId) {
          return;
        }

        const [history, outputEventHistory] = await Promise.all([
          window.electronAPI.workspace.getSessionHistory({
            sessionId: nextSessionId,
            workspaceId: selectedWorkspaceId
          }),
          window.electronAPI.workspace.getSessionOutputEvents({
            sessionId: nextSessionId
          })
        ]);
        if (cancelled) {
          return;
        }

        const outputEventsByInputId = new Map<string, SessionOutputEventPayload[]>();
        for (const event of outputEventHistory.items) {
          const inputId = event.input_id.trim();
          if (!inputId) {
            continue;
          }
          const existing = outputEventsByInputId.get(inputId);
          if (existing) {
            existing.push(event);
          } else {
            outputEventsByInputId.set(inputId, [event]);
          }
        }

        const nextMessages = history.messages
          .map((message) => {
            const attachments = attachmentsFromMetadata(message.metadata);
            const nextMessage: ChatMessage = {
              id: message.id || `history-${message.created_at ?? crypto.randomUUID()}`,
              role: message.role as ChatMessage["role"],
              text: message.text,
              attachments
            };

            if (nextMessage.role === "assistant") {
              const inputId = inputIdFromMessageId(nextMessage.id, "assistant");
              if (inputId) {
                const restoredAssistantState = assistantHistoryStateFromOutputEvents(outputEventsByInputId.get(inputId) ?? []);
                if (restoredAssistantState.traceSteps) {
                  nextMessage.traceSteps = restoredAssistantState.traceSteps;
                }
                if (restoredAssistantState.contentBlocks) {
                  nextMessage.contentBlocks = restoredAssistantState.contentBlocks;
                }
              }
            }

            return nextMessage;
          })
          .filter((message) =>
            message.role === "user"
              ? hasRenderableMessageContent(message.text, message.attachments ?? [])
              : message.role === "assistant"
                ? hasRenderableAssistantContent(message)
                : false
          );

        setMessages(nextMessages);
        resetLiveTurn();

        const runtimeState = runtimeStates.items.find((item) => item.session_id === nextSessionId) ?? null;
        const currentRuntimeStatus = runtimeStateStatus(runtimeState?.status);
        const currentInputId = (runtimeState?.current_input_id || "").trim();
        const currentInputEvents = currentInputId ? outputEventsByInputId.get(currentInputId) ?? [] : [];
        const hasAssistantMessage = nextMessages.some((message) => message.role === "assistant");

        if (managedMode && onManagedSessionObserved) {
          onManagedSessionObserved({
            workspaceId: selectedWorkspaceId,
            sessionId: nextSessionId,
            runtimeStatus: currentRuntimeStatus,
            currentInputId: currentInputId || null,
            currentInputEvents
          });
          if (
            managedSessionRuntime &&
            managedSessionRuntime.workspaceId === selectedWorkspaceId &&
            managedSessionRuntime.sessionId === nextSessionId &&
            managedSessionRuntime.awaitingHistoryHydration &&
            managedSessionRuntime.historyVersion > 0 &&
            onManagedHistoryHydrated
          ) {
            onManagedHistoryHydrated({
              workspaceId: selectedWorkspaceId,
              sessionId: nextSessionId,
              historyVersion: managedSessionRuntime.historyVersion
            });
          }
        } else {
          const shouldRestoreLiveTurn =
            Boolean(currentInputId) && ["BUSY", "QUEUED", "WAITING_USER", "ERROR"].includes(currentRuntimeStatus);
          const shouldAttachOnboardingBootstrapStream =
            isOnboardingVariant &&
            nextSessionId === onboardingSessionId &&
            !hasAssistantMessage &&
            !activeStreamIdRef.current &&
            !pendingInputIdRef.current &&
            ["BUSY", "QUEUED"].includes(currentRuntimeStatus);

          if (shouldRestoreLiveTurn) {
            const restored = restoreLiveTurnFromOutputEvents(currentInputEvents, {
              status: currentRuntimeStatus,
              currentInputId
            });
            pendingInputIdRef.current = currentInputId;
            setIsResponding(currentRuntimeStatus === "BUSY" || currentRuntimeStatus === "QUEUED");
            if (currentRuntimeStatus === "ERROR") {
              setChatErrorMessage(runtimeStateErrorDetail(runtimeState?.last_error));
            }
            if (!cancelled && (currentRuntimeStatus === "BUSY" || currentRuntimeStatus === "QUEUED")) {
              await attachExistingSessionStream({
                workspaceId: selectedWorkspaceId,
                sessionId: nextSessionId,
                inputId: currentInputId,
                hydratedUpToEventId: restored.lastEventId
              });
            }
          } else if (shouldAttachOnboardingBootstrapStream) {
            setIsResponding(true);
            setLiveAgentStatus("Preparing first question...");
            setChatErrorMessage("");
            const stream = await window.electronAPI.workspace.openSessionOutputStream({
              sessionId: nextSessionId,
              workspaceId: selectedWorkspaceId,
              includeHistory: true,
              stopOnTerminal: true
            });
            if (cancelled) {
              await closeStreamWithReason(stream.streamId, "load_history_cancelled").catch(() => undefined);
              return;
            }
            activeStreamIdRef.current = stream.streamId;
            appendStreamTelemetry({
              streamId: stream.streamId,
              transportType: "client",
              eventName: "openSessionOutputStream",
              eventType: "stream_open_onboarding_bootstrap",
              inputId: "",
              sessionId: nextSessionId,
              action: "stream_requested_onboarding_bootstrap",
              detail: "attached to in-flight onboarding opener"
            });
          } else {
            pendingInputIdRef.current = null;
            setIsResponding(false);
            if (currentRuntimeStatus === "ERROR") {
              setChatErrorMessage(runtimeStateErrorDetail(runtimeState?.last_error));
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          setChatErrorMessage(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [
    isOnboardingVariant,
    selectedWorkspaceId,
    selectedWorkspace?.main_session_id,
    selectedWorkspace?.onboarding_session_id,
    selectedWorkspace?.onboarding_status,
    managedMode,
    managedSessionRuntime?.awaitingHistoryHydration,
    managedSessionRuntime?.historyVersion,
    managedSessionRuntime?.sessionId,
    managedSessionRuntime?.workspaceId,
    onManagedHistoryHydrated,
    onManagedSessionObserved,
    sessionRequest?.key
  ]);

  useEffect(() => {
    if (!managedMode) {
      if (managedOptimisticLiveTurn) {
        setManagedOptimisticLiveTurn(null);
      }
      return;
    }
    if (!managedOptimisticLiveTurn) {
      return;
    }
    if (
      managedOptimisticLiveTurn.workspaceId !== selectedWorkspaceId ||
      managedOptimisticLiveTurn.sessionId !== activeSessionId
    ) {
      setManagedOptimisticLiveTurn(null);
      return;
    }
    if (
      managedSessionMatchesActive &&
      (
        Boolean(managedRuntimeStatus) ||
        Boolean(managedSessionRuntime?.currentInputId) ||
        (managedSessionRuntime?.events.length ?? 0) > 0 ||
        Boolean(managedSessionRuntime?.errorMessage)
      )
    ) {
      setManagedOptimisticLiveTurn(null);
    }
  }, [
    activeSessionId,
    managedMode,
    managedOptimisticLiveTurn,
    managedRuntimeStatus,
    managedSessionMatchesActive,
    managedSessionRuntime?.currentInputId,
    managedSessionRuntime?.errorMessage,
    managedSessionRuntime?.events.length,
    selectedWorkspaceId
  ]);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.workspace
      .isVerboseTelemetryEnabled()
      .then((enabled) => {
        if (!cancelled) {
          setVerboseTelemetryEnabled(enabled);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!verboseTelemetryEnabled) {
      setStreamTelemetry([]);
      seenMainDebugKeysRef.current = new Set();
      return;
    }
    setStreamTelemetry([]);
    seenMainDebugKeysRef.current = new Set();
  }, [selectedWorkspaceId, verboseTelemetryEnabled]);

  useEffect(() => {
    if (!verboseTelemetryEnabled) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      void window.electronAPI.workspace
        .getSessionStreamDebug()
        .then((entries) => {
          if (cancelled) {
            return;
          }
          for (const entry of entries) {
            const key = `${entry.at}|${entry.streamId}|${entry.phase}|${entry.detail}`;
            if (seenMainDebugKeysRef.current.has(key)) {
              continue;
            }
            seenMainDebugKeysRef.current.add(key);
            appendStreamTelemetry({
              streamId: entry.streamId,
              transportType: "main",
              eventName: entry.phase,
              eventType: entry.phase,
              inputId: "",
              sessionId: "",
              action: `main_${entry.phase}`,
              detail: entry.detail
            });
          }
          if (seenMainDebugKeysRef.current.size > 4000) {
            const trimmed = new Set(Array.from(seenMainDebugKeysRef.current).slice(-2000));
            seenMainDebugKeysRef.current = trimmed;
          }
        })
        .catch(() => undefined);
    }, 700);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [verboseTelemetryEnabled]);

  useEffect(() => {
    if (managedMode) {
      return;
    }
    const activeStreamId = activeStreamIdRef.current;
    if (!activeStreamId) {
      return;
    }

    activeStreamIdRef.current = null;
    activeAssistantMessageIdRef.current = null;
    setIsResponding(false);
    void closeStreamWithReason(activeStreamId, "selected_workspace_changed");
  }, [managedMode, selectedWorkspaceId]);

  useEffect(() => {
    if (managedMode) {
      return;
    }
    const unsubscribe = window.electronAPI.workspace.onSessionStreamEvent((payload) => {
      const currentStreamId = activeStreamIdRef.current;
      const pendingInputId = pendingInputIdRef.current || "";
      const hasPendingStreamAttach = Boolean(pendingInputId);
      const rawEventData = payload.type === "event" ? payload.event?.data : null;
      const typedEvent =
        rawEventData && typeof rawEventData === "object" && !Array.isArray(rawEventData)
          ? (rawEventData as {
              event_type?: string;
              payload?: Record<string, unknown>;
              input_id?: string;
              session_id?: string;
              sequence?: number;
            })
          : null;
      const eventName = payload.type === "event" ? payload.event?.event ?? "message" : payload.type;
      const eventType = typedEvent?.event_type ?? eventName;
      const eventPayload = typedEvent?.payload ?? {};
      const eventInputId = typeof typedEvent?.input_id === "string" ? typedEvent.input_id : "";
      const eventSessionId = typeof typedEvent?.session_id === "string" ? typedEvent.session_id : "";
      const eventSequence = typeof typedEvent?.sequence === "number" && Number.isFinite(typedEvent.sequence) ? typedEvent.sequence : Number.MAX_SAFE_INTEGER;
      const streamEventId =
        payload.type === "event" && typeof payload.event?.id === "string"
          ? Number.parseInt(payload.event.id, 10)
          : Number.NaN;

      appendStreamTelemetry({
        streamId: payload.streamId,
        transportType: payload.type,
        eventName,
        eventType,
        inputId: eventInputId,
        sessionId: eventSessionId,
        action: "received",
        detail: `active=${currentStreamId || "-"} pending=${pendingInputId || "-"}`
      });

      const replayHydration = hydratedStreamReplayRef.current;
      if (
        payload.type === "event" &&
        replayHydration &&
        eventSessionId === replayHydration.sessionId &&
        eventInputId === replayHydration.inputId
      ) {
        if (Number.isFinite(streamEventId) && streamEventId > 0 && streamEventId <= replayHydration.maxEventId) {
          appendStreamTelemetry({
            streamId: payload.streamId,
            transportType: payload.type,
            eventName,
            eventType,
            inputId: eventInputId,
            sessionId: eventSessionId,
            action: "drop_replayed_hydration_event",
            detail: `event_id=${streamEventId} hydrated_up_to=${replayHydration.maxEventId}`
          });
          return;
        }
        hydratedStreamReplayRef.current = null;
      }

      if (payload.type === "error") {
        if (!currentStreamId || payload.streamId !== currentStreamId) {
          if (hasPendingStreamAttach) {
            activeStreamIdRef.current = payload.streamId;
            appendStreamTelemetry({
              streamId: payload.streamId,
              transportType: payload.type,
              eventName,
              eventType,
              inputId: eventInputId,
              sessionId: eventSessionId,
              action: "adopt_stream_for_error",
              detail: "pending_attach=true"
            });
          } else {
            appendStreamTelemetry({
              streamId: payload.streamId,
              transportType: payload.type,
              eventName,
              eventType,
              inputId: eventInputId,
              sessionId: eventSessionId,
              action: "drop_error_unmatched_stream",
              detail: "no pending attach"
            });
            return;
          }
        }
        if (activeStreamIdRef.current !== payload.streamId) {
          appendStreamTelemetry({
            streamId: payload.streamId,
            transportType: payload.type,
            eventName,
            eventType,
            inputId: eventInputId,
            sessionId: eventSessionId,
            action: "drop_error_stream_mismatch",
            detail: `active_now=${activeStreamIdRef.current || "-"}`
          });
          return;
        }
        setChatErrorMessage(normalizeErrorMessage(payload.error || "The agent stream failed."));
        setIsResponding(false);
        activeAssistantMessageIdRef.current = null;
        activeStreamIdRef.current = null;
        pendingInputIdRef.current = null;
        hydratedStreamReplayRef.current = null;
        appendStreamTelemetry({
          streamId: payload.streamId,
          transportType: payload.type,
          eventName,
          eventType,
          inputId: eventInputId,
          sessionId: eventSessionId,
          action: "applied_error",
          detail: payload.error || "stream error"
        });
        return;
      }

      if (payload.type === "done") {
        if (!currentStreamId || payload.streamId !== currentStreamId) {
          if (hasPendingStreamAttach) {
            activeStreamIdRef.current = payload.streamId;
            appendStreamTelemetry({
              streamId: payload.streamId,
              transportType: payload.type,
              eventName,
              eventType,
              inputId: eventInputId,
              sessionId: eventSessionId,
              action: "adopt_stream_for_done",
              detail: "pending_attach=true"
            });
          } else {
            appendStreamTelemetry({
              streamId: payload.streamId,
              transportType: payload.type,
              eventName,
              eventType,
              inputId: eventInputId,
              sessionId: eventSessionId,
              action: "drop_done_unmatched_stream",
              detail: "no pending attach"
            });
            return;
          }
        }
        if (activeStreamIdRef.current !== payload.streamId) {
          appendStreamTelemetry({
            streamId: payload.streamId,
            transportType: payload.type,
            eventName,
            eventType,
            inputId: eventInputId,
            sessionId: eventSessionId,
            action: "drop_done_stream_mismatch",
            detail: `active_now=${activeStreamIdRef.current || "-"}`
          });
          return;
        }
        setIsResponding(false);
        activeAssistantMessageIdRef.current = null;
        activeStreamIdRef.current = null;
        pendingInputIdRef.current = null;
        hydratedStreamReplayRef.current = null;
        appendStreamTelemetry({
          streamId: payload.streamId,
          transportType: payload.type,
          eventName,
          eventType,
          inputId: eventInputId,
          sessionId: eventSessionId,
          action: "applied_done",
          detail: "stream done"
        });
        return;
      }

      const eventData = payload.event?.data;
      if (!eventData || typeof eventData !== "object") {
        appendStreamTelemetry({
          streamId: payload.streamId,
          transportType: payload.type,
          eventName,
          eventType,
          inputId: eventInputId,
          sessionId: eventSessionId,
          action: "drop_event_invalid_data",
          detail: `data_type=${typeof eventData}`
        });
        return;
      }

      const streamMatches = Boolean(currentStreamId && payload.streamId === currentStreamId);
      const inputMatchesPending = Boolean(pendingInputId && eventInputId && eventInputId === pendingInputId);
      const canAdoptStream =
        !streamMatches &&
        inputMatchesPending;

      if (!streamMatches && !canAdoptStream) {
        appendStreamTelemetry({
          streamId: payload.streamId,
          transportType: payload.type,
          eventName,
          eventType,
          inputId: eventInputId,
          sessionId: eventSessionId,
          action: "drop_unmatched_event",
          detail: `active=${currentStreamId || "-"} pending=${pendingInputId || "-"} input_match=${String(inputMatchesPending)}`
        });
        return;
      }
      if (canAdoptStream) {
        activeStreamIdRef.current = payload.streamId;
        appendStreamTelemetry({
          streamId: payload.streamId,
          transportType: payload.type,
          eventName,
          eventType,
          inputId: eventInputId,
          sessionId: eventSessionId,
          action: "adopt_stream_for_event",
          detail: `pending_input=${pendingInputId}`
        });
      }

      if (eventType === "run_claimed") {
        setLiveAgentStatus("Thinking...");
      } else if (eventType === "run_started") {
        setLiveAgentStatus("Checking workspace context...");
      } else if (eventType === "run_waiting_user" || eventType === "awaiting_user_input") {
        setLiveAgentStatus("Waiting for your input...");
      }

      const phaseStep = phaseTraceStepFromEvent(eventType, eventPayload, eventSequence);
      if (phaseStep) {
        upsertLiveTraceStep(phaseStep, { expand: phaseStep.status !== "completed" });
      }

      const toolStep = toolTraceStepFromEvent(eventType, eventPayload, eventSequence);
      if (toolStep) {
        setLiveAgentStatus(toolStep.status === "completed" ? "Writing response..." : "Using tools...");
        upsertLiveTraceStep(toolStep, { expand: toolStep.status !== "completed" });
      }

      if (eventType === "output_delta") {
        setLiveAgentStatus("Writing response...");
        const delta = typeof eventPayload.delta === "string" ? eventPayload.delta : "";
        if (!delta) {
          appendStreamTelemetry({
            streamId: payload.streamId,
            transportType: payload.type,
            eventName,
            eventType,
            inputId: eventInputId,
            sessionId: eventSessionId,
            action: "skip_empty_delta",
            detail: "delta missing/empty"
          });
          return;
        }

        const assistantMessageId = activeAssistantMessageIdRef.current ?? `assistant-${Date.now()}`;
        activeAssistantMessageIdRef.current = assistantMessageId;
        appendLiveAssistantDelta(delta, eventSequence);
        appendStreamTelemetry({
          streamId: payload.streamId,
          transportType: payload.type,
          eventName,
          eventType,
          inputId: eventInputId,
          sessionId: eventSessionId,
          action: "applied_output_delta",
          detail: `delta_len=${delta.length}`
        });
        return;
      }

      if (eventType === "thinking_delta") {
        setLiveAgentStatus("Thinking...");
        const delta = typeof eventPayload.delta === "string" ? eventPayload.delta : "";
        if (!delta) {
          appendStreamTelemetry({
            streamId: payload.streamId,
            transportType: payload.type,
            eventName,
            eventType,
            inputId: eventInputId,
            sessionId: eventSessionId,
            action: "skip_empty_thinking_delta",
            detail: "delta missing/empty"
          });
          return;
        }
        appendLiveThinkingTraceDelta(delta, eventSequence);
        appendStreamTelemetry({
          streamId: payload.streamId,
          transportType: payload.type,
          eventName,
          eventType,
          inputId: eventInputId,
          sessionId: eventSessionId,
          action: "applied_thinking_delta",
          detail: `delta_len=${delta.length}`
        });
        return;
      }

      if (eventType === "run_failed") {
        const detail =
          typeof eventPayload.error === "string"
            ? eventPayload.error
            : typeof eventPayload.message === "string"
              ? eventPayload.message
              : "The run failed.";
        setChatErrorMessage(detail);
        finalizeLiveTraceSteps("error");
        if (liveAssistantTextRef.current || liveTraceStepsRef.current.length > 0) {
          commitLiveAssistantMessage();
        }
        setIsResponding(false);
        activeStreamIdRef.current = null;
        pendingInputIdRef.current = null;
        hydratedStreamReplayRef.current = null;
        appendStreamTelemetry({
          streamId: payload.streamId,
          transportType: payload.type,
          eventName,
          eventType,
          inputId: eventInputId,
          sessionId: eventSessionId,
          action: "applied_run_failed",
          detail
        });
        return;
      }

      if (eventType === "run_completed") {
        finalizeLiveTraceSteps("completed");
        commitLiveAssistantMessage();
        setIsResponding(false);
        activeStreamIdRef.current = null;
        pendingInputIdRef.current = null;
        hydratedStreamReplayRef.current = null;
        appendStreamTelemetry({
          streamId: payload.streamId,
          transportType: payload.type,
          eventName,
          eventType,
          inputId: eventInputId,
          sessionId: eventSessionId,
          action: "applied_run_completed",
          detail: "run completed"
        });
        void refreshWorkspaceData().catch(() => undefined);
        onOutputsChanged?.();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [managedMode, onOutputsChanged, refreshWorkspaceData]);

  useEffect(() => {
    if (managedMode || !isResponding || !selectedWorkspaceId || !activeSessionId) {
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (cancelled || inFlight) {
        return;
      }
      inFlight = true;
      try {
        const response = await window.electronAPI.workspace.listRuntimeStates(selectedWorkspaceId);
        if (cancelled) {
          return;
        }
        if (activeStreamIdRef.current || pendingInputIdRef.current) {
          // Stream remains the source of truth while an output stream is open.
          // Polling is only a fallback when the stream is unavailable and no stream attach is pending.
          return;
        }
        const currentSessionId = activeSessionIdRef.current;
        const currentState = response.items.find((item) => item.session_id === currentSessionId);
        if (!currentState) {
          return;
        }
        const status = runtimeStateStatus(currentState.status);
        if (status === "BUSY" || status === "QUEUED") {
          return;
        }

        const activeStreamId = activeStreamIdRef.current;
        if (activeStreamId) {
          await closeStreamWithReason(activeStreamId, "runtime_poll_terminal_state");
          activeStreamIdRef.current = null;
        }
        setIsResponding(false);
        resetLiveTurn();

        if (status === "ERROR") {
          const detail = runtimeStateErrorDetail(currentState.last_error);
          setChatErrorMessage(detail);
        }
        pendingInputIdRef.current = null;
      } catch {
        // Ignore poll failures; stream events remain the primary signal.
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [managedMode, isResponding, selectedWorkspaceId, activeSessionId]);

  useEffect(() => {
    if (managedMode) {
      return;
    }
    return () => {
      const activeStreamId = activeStreamIdRef.current;
      if (activeStreamId) {
        void closeStreamWithReason(activeStreamId, "chatpane_unmount");
      }
    };
  }, [managedMode]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && pendingAttachments.length === 0) || effectiveIsResponding) {
      return;
    }
    if (!selectedWorkspace) {
      setChatErrorMessage("Create or select a workspace first.");
      return;
    }
    if ((runtimeStatus?.status || "").trim().toLowerCase() !== "running") {
      setChatErrorMessage("App is still starting up. Try again in a moment.");
      return;
    }
    if (!isOnboardingVariant && !workspaceAppsReady) {
      setChatErrorMessage(workspaceBlockingReason || "Workspace apps are still starting.");
      return;
    }
    const targetSessionId = activeSessionIdRef.current || preferredSessionId(selectedWorkspace, []);
    if (!targetSessionId) {
      setChatErrorMessage("No active session found for this workspace.");
      return;
    }

    appendStreamTelemetry({
      streamId: activeStreamIdRef.current || "-",
      transportType: "client",
      eventName: "sendMessage",
      eventType: "send_start",
      inputId: "",
      sessionId: targetSessionId,
      action: "queue_begin",
      detail: `workspace=${selectedWorkspace.id}`
    });
    try {
      const attachmentEntries = [...pendingAttachments];
      const optimisticAttachments = attachmentEntries.map((entry) => optimisticChatAttachment(entry));
      const optimisticUserMessageId = `user-${Date.now()}`;
      const queueViaManagedSession = managedMode && onManagedQueueSessionInput;

      flushSync(() => {
        if (activeSessionIdRef.current !== targetSessionId) {
          setActiveSession(targetSessionId);
        }
        shouldAutoScrollRef.current = false;
        pendingInitialAssistantJumpRef.current = true;
        setMessages((prev) => [
          ...prev,
          {
            id: optimisticUserMessageId,
            role: "user",
            text: trimmed,
            attachments: optimisticAttachments
          }
        ]);
        resetLiveTurn();
        setInput("");
        setPendingAttachments([]);
        setChatErrorMessage("");
        activeAssistantMessageIdRef.current = null;
      });

      flushSync(() => {
        if (queueViaManagedSession) {
          setManagedOptimisticLiveTurn({
            workspaceId: selectedWorkspace.id,
            sessionId: targetSessionId,
            status: "Thinking..."
          });
          return;
        }
        setIsResponding(true);
        setLiveAgentStatus("Thinking...");
      });

      const currentStreamId = activeStreamIdRef.current;
      if (currentStreamId) {
        await closeStreamWithReason(currentStreamId, "send_new_message_close_previous_stream");
        activeStreamIdRef.current = null;
        appendStreamTelemetry({
          streamId: currentStreamId,
          transportType: "client",
          eventName: "sendMessage",
          eventType: "close_prev_stream",
          inputId: "",
          sessionId: targetSessionId || "",
          action: "closed_previous_stream",
          detail: "before new send"
        });
      }

      const localFiles = attachmentEntries.filter(
        (entry): entry is PendingLocalAttachmentFile => entry.source === "local-file"
      );
      const explorerFiles = attachmentEntries.filter(
        (entry): entry is PendingExplorerAttachmentFile => entry.source === "explorer-path"
      );

      const [stagedLocalAttachments, stagedExplorerAttachments] = await Promise.all([
        localFiles.length > 0
          ? window.electronAPI.workspace.stageSessionAttachments({
              workspace_id: selectedWorkspace.id,
              files: await Promise.all(localFiles.map((entry) => attachmentUploadPayload(entry.file)))
            })
          : Promise.resolve({ attachments: [] }),
        explorerFiles.length > 0
          ? window.electronAPI.workspace.stageSessionAttachmentPaths({
              workspace_id: selectedWorkspace.id,
              files: explorerFiles.map((entry) => ({
                absolute_path: entry.absolutePath,
                name: entry.name,
                mime_type: entry.mime_type ?? null
              }))
            })
          : Promise.resolve({ attachments: [] })
      ]);

      let localAttachmentIndex = 0;
      let explorerAttachmentIndex = 0;
      const stagedAttachments = attachmentEntries.map((entry) => {
        if (entry.source === "local-file") {
          const attachment = stagedLocalAttachments.attachments[localAttachmentIndex];
          localAttachmentIndex += 1;
          if (!attachment) {
            throw new Error("Failed to stage a dropped file attachment.");
          }
          return attachment;
        }

        const attachment = stagedExplorerAttachments.attachments[explorerAttachmentIndex];
        explorerAttachmentIndex += 1;
        if (!attachment) {
          throw new Error("Failed to stage an explorer attachment.");
        }
        return attachment;
      });

      if (stagedAttachments.length > 0 || optimisticAttachments.length > 0) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === optimisticUserMessageId ? { ...message, attachments: stagedAttachments } : message
          )
        );
      }

      let queued: EnqueueSessionInputResponsePayload;
      if (queueViaManagedSession) {
        queued = await onManagedQueueSessionInput({
          text: trimmed,
          workspaceId: selectedWorkspace.id,
          sessionId: targetSessionId,
          attachments: stagedAttachments,
          model: resolvedChatModelToken || null
        });
      } else {
        pendingInputIdRef.current = STREAM_ATTACH_PENDING;

        const preOpenedStream = await window.electronAPI.workspace.openSessionOutputStream({
          sessionId: targetSessionId,
          workspaceId: selectedWorkspace.id,
          includeHistory: false,
          stopOnTerminal: true
        });
        activeStreamIdRef.current = preOpenedStream.streamId;
        appendStreamTelemetry({
          streamId: preOpenedStream.streamId,
          transportType: "client",
          eventName: "openSessionOutputStream",
          eventType: "stream_open_prequeue",
          inputId: "",
          sessionId: targetSessionId,
          action: "stream_requested_prequeue",
          detail: "session tail stream opened before queue"
        });

        queued = await window.electronAPI.workspace.queueSessionInput({
          text: trimmed,
          workspace_id: selectedWorkspace.id,
          image_urls: null,
          attachments: stagedAttachments,
          session_id: targetSessionId,
          priority: 0,
          model: resolvedChatModelToken || null
        });
      }
      setActiveSession(queued.session_id);
      appendStreamTelemetry({
        streamId: "-",
        transportType: "client",
        eventName: "queueSessionInput",
        eventType: "queued",
        inputId: queued.input_id,
        sessionId: queued.session_id,
        action: "queued_input",
        detail: "queue response received"
      });
      if (!managedMode && queued.session_id !== targetSessionId) {
        const staleStreamId = activeStreamIdRef.current;
        if (staleStreamId) {
          await closeStreamWithReason(staleStreamId, "queue_session_retarget");
          appendStreamTelemetry({
            streamId: staleStreamId,
            transportType: "client",
            eventName: "openSessionOutputStream",
            eventType: "close_stream_retarget",
            inputId: queued.input_id,
            sessionId: targetSessionId,
            action: "stream_retarget_close",
            detail: `queue_session=${queued.session_id}`
          });
        }
        const retargeted = await window.electronAPI.workspace.openSessionOutputStream({
          sessionId: queued.session_id,
          workspaceId: selectedWorkspace.id,
          inputId: queued.input_id,
          includeHistory: true,
          stopOnTerminal: true
        });
        activeStreamIdRef.current = retargeted.streamId;
        appendStreamTelemetry({
          streamId: retargeted.streamId,
          transportType: "client",
          eventName: "openSessionOutputStream",
          eventType: "stream_open_retarget",
          inputId: queued.input_id,
          sessionId: queued.session_id,
          action: "stream_requested_retarget",
            detail: "session changed after queue"
          });
      }
    } catch (error) {
      if (!managedMode) {
        const activeStreamId = activeStreamIdRef.current;
        if (activeStreamId) {
          await closeStreamWithReason(activeStreamId, "send_message_error").catch(() => undefined);
        }
      } else {
        setManagedOptimisticLiveTurn(null);
      }
      pendingInitialAssistantJumpRef.current = false;
      setChatErrorMessage(normalizeErrorMessage(error));
      if (!managedMode) {
        setIsResponding(false);
        activeAssistantMessageIdRef.current = null;
        activeStreamIdRef.current = null;
        pendingInputIdRef.current = null;
      }
      appendStreamTelemetry({
        streamId: "-",
        transportType: "client",
        eventName: "sendMessage",
        eventType: "send_error",
        inputId: "",
        sessionId: targetSessionId || "",
        action: "send_failed",
        detail: normalizeErrorMessage(error)
      });
    }
  }

  function appendPendingLocalFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    setPendingAttachments((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: pendingAttachmentId(`${file.name}-${file.size}-${file.lastModified}`),
        source: "local-file" as const,
        file
      }))
    ]);
  }

  function appendPendingExplorerAttachments(files: ExplorerAttachmentDragPayload[]) {
    if (files.length === 0) {
      return;
    }

    setPendingAttachments((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: pendingAttachmentId(`${file.absolutePath}-${file.size}`),
        source: "explorer-path" as const,
        absolutePath: file.absolutePath,
        name: file.name,
        mime_type: file.mimeType ?? null,
        size_bytes: file.size,
        kind: inferDraggedAttachmentKind(file.name, file.mimeType)
      }))
    ]);
  }

  function optimisticChatAttachment(entry: PendingAttachment): ChatAttachment {
    if (entry.source === "local-file") {
      return {
        id: entry.id,
        kind: entry.file.type.startsWith("image/") ? "image" : "file",
        name: entry.file.name,
        mime_type: entry.file.type || "application/octet-stream",
        size_bytes: entry.file.size,
        workspace_path: entry.file.name
      };
    }

    return {
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      mime_type: entry.mime_type || (entry.kind === "image" ? "image/*" : "application/octet-stream"),
      size_bytes: entry.size_bytes,
      workspace_path: entry.absolutePath
    };
  }

  function allowPaneAttachmentDrop(dataTransfer: DataTransfer | null) {
    if (!dataTransfer || composerDisabled || effectiveIsResponding) {
      return false;
    }

    const types = Array.from(dataTransfer.types ?? []);
    if (types.includes(EXPLORER_ATTACHMENT_DRAG_TYPE)) {
      return true;
    }

    if ((dataTransfer.files?.length ?? 0) > 0) {
      return true;
    }

    return Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file");
  }

  function onPaneDragOver(event: DragEvent<HTMLDivElement>) {
    if (!allowPaneAttachmentDrop(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isPaneDragActive) {
      setIsPaneDragActive(true);
    }
  }

  function onPaneDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsPaneDragActive(false);
  }

  function onPaneDrop(event: DragEvent<HTMLDivElement>) {
    if (!allowPaneAttachmentDrop(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    setIsPaneDragActive(false);

    const explorerFiles: ExplorerAttachmentDragPayload[] = [];
    const rawExplorerPayload = event.dataTransfer.getData(EXPLORER_ATTACHMENT_DRAG_TYPE);
    const parsedExplorerPayload = parseExplorerAttachmentDragPayload(rawExplorerPayload);
    if (parsedExplorerPayload) {
      explorerFiles.push(parsedExplorerPayload);
    }

    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (explorerFiles.length > 0) {
      appendPendingExplorerAttachments(explorerFiles);
    }
    if (droppedFiles.length > 0) {
      appendPendingLocalFiles(droppedFiles);
    }
  }

  function onAttachmentInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    appendPendingLocalFiles(files);
    event.target.value = "";
  }

  function removePendingAttachment(attachmentId: string) {
    setPendingAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  const assistantLabel = "Holaboss";
  const hasMessages =
    messages.length > 0 ||
    Boolean(effectiveLiveAssistantText) ||
    effectiveLiveTraceSteps.length > 0;
  const showLiveAssistantTurn = managedMode
    ? shouldShowManagedLiveTurn
    : effectiveIsResponding ||
        Boolean(effectiveLiveAssistantText) ||
        effectiveLiveTraceSteps.length > 0;
  useLayoutEffect(() => {
    if (!showLiveAssistantTurn || !pendingInitialAssistantJumpRef.current) {
      return;
    }
    pendingInitialAssistantJumpRef.current = false;
    scrollLiveAssistantTurnIntoView();
  }, [showLiveAssistantTurn]);
  const streamTelemetryTail = useMemo(() => streamTelemetry.slice(-80).reverse(), [streamTelemetry]);
  const pendingAttachmentItems = useMemo(
    () =>
      pendingAttachments.map((attachment) => ({
        id: attachment.id,
        kind:
          attachment.source === "local-file"
            ? attachment.file.type.startsWith("image/")
              ? ("image" as const)
              : ("file" as const)
            : attachment.kind,
        name: attachment.source === "local-file" ? attachment.file.name : attachment.name,
        size_bytes: attachment.source === "local-file" ? attachment.file.size : attachment.size_bytes
      })),
    [pendingAttachments]
  );
  const runtimeLifecycleStatus = (runtimeStatus?.status || "").trim().toLowerCase();
  const runtimeNotReadyReason =
    isLoadingBootstrap || isLoadingHistory
      ? "Loading workspace context..."
      : !runtimeLifecycleStatus || runtimeLifecycleStatus === "starting"
        ? "App is still starting up. Try again in a moment."
        : runtimeLifecycleStatus === "error"
          ? normalizeErrorMessage(runtimeStatus?.lastError || "Runtime failed to start.")
          : runtimeLifecycleStatus !== "running"
            ? "App is still starting up. Try again in a moment."
            : "";
  const readinessMessage =
    !selectedWorkspace
      ? ""
      : runtimeNotReadyReason
        ? runtimeNotReadyReason
        : isOnboardingVariant || workspaceAppsReady
          ? ""
          : workspaceBlockingReason || (isActivatingWorkspace ? "Preparing workspace apps..." : "Workspace apps are still starting.");
  const composerDisabledReason = !selectedWorkspace
    ? "Select a workspace to start chatting."
    : runtimeNotReadyReason
      ? runtimeNotReadyReason
      : !isOnboardingVariant && !workspaceAppsReady
        ? readinessMessage || "Workspace apps are still starting."
        : "";
  const composerDisabled = Boolean(composerDisabledReason);
  const runtimeStartupBlocked =
    isLoadingBootstrap ||
    !runtimeLifecycleStatus ||
    runtimeLifecycleStatus === "starting" ||
    runtimeLifecycleStatus === "error" ||
    runtimeLifecycleStatus === "stopping" ||
    runtimeLifecycleStatus === "stopped";
  const workspaceAppsStartupBlocked = !isOnboardingVariant && runtimeLifecycleStatus === "running" && !workspaceAppsReady;
  const rawShowStartupOverlay =
    !isOnboardingVariant &&
    Boolean(selectedWorkspace) &&
    (runtimeStartupBlocked || workspaceAppsStartupBlocked);
  const [showStartupOverlay, setShowStartupOverlay] = useState(false);
  const startupOverlayTone: StartupPhaseTone =
    runtimeLifecycleStatus === "error" ? "error" : showStartupOverlay ? "loading" : "ready";
  const startupOverlayTitle =
    runtimeLifecycleStatus === "error"
      ? "Runtime failed to start"
      : runtimeStartupBlocked
        ? "Starting local app"
        : isActivatingWorkspace
          ? "Preparing workspace apps"
          : "Starting workspace apps";
  const startupOverlayDescription =
    runtimeLifecycleStatus === "error"
      ? normalizeErrorMessage(runtimeStatus?.lastError || "Runtime failed to start.")
      : runtimeStartupBlocked
        ? "Holaboss is booting the local runtime and reconnecting the workspace tools."
        : workspaceBlockingReason || "This workspace is loading its apps and tools. Chat unlocks automatically when startup completes.";
  const runtimeStartupTone: StartupPhaseTone =
    runtimeLifecycleStatus === "error" ? "error" : runtimeLifecycleStatus === "running" ? "ready" : "loading";
  const workspaceAppsStartupTone: StartupPhaseTone =
    runtimeLifecycleStatus !== "running"
      ? "waiting"
      : workspaceAppsReady
        ? "ready"
        : "loading";
  const isSignedIn = Boolean(sessionUserId(authSessionState.data));
  const legacyHolabossProxyModelsAvailable =
    isSignedIn &&
    Boolean(runtimeConfig?.authTokenPresent) &&
    Boolean((runtimeConfig?.modelProxyBaseUrl || "").trim());
  const configuredProviderModelGroups = runtimeConfig?.providerModelGroups ?? [];
  const visibleConfiguredProviderModelGroups = configuredProviderModelGroups
    .map((providerGroup) => ({
      ...providerGroup,
      models: providerGroup.models.filter((model) => {
        const normalizedToken = model.token.trim();
        if (!normalizedToken || isDeprecatedChatModel(normalizedToken)) {
          return false;
        }
        if (legacyHolabossProxyModelsAvailable) {
          return true;
        }
        return !isHolabossProviderModel(providerGroup.providerId, normalizedToken);
      })
    }))
    .filter((providerGroup) => providerGroup.models.length > 0);
  const hasConfiguredProviderCatalog = visibleConfiguredProviderModelGroups.length > 0;
  const runtimeDefaultModel = runtimeConfig?.defaultModel?.trim() || DEFAULT_RUNTIME_MODEL;
  const modelOptionsByProvider = new Map<string, { providerLabel: string; options: Map<string, ChatModelOption> }>();
  const ensureProviderOptionGroup = (providerId: string, providerLabel: string) => {
    const normalizedProviderId = providerId.trim() || "openai";
    if (!modelOptionsByProvider.has(normalizedProviderId)) {
      modelOptionsByProvider.set(normalizedProviderId, {
        providerLabel: providerLabel.trim() || displayProviderLabel(normalizedProviderId),
        options: new Map<string, ChatModelOption>()
      });
    }
    return modelOptionsByProvider.get(normalizedProviderId)!;
  };
  const addModelOption = (providerId: string, providerLabel: string, value: string, label: string) => {
    const normalizedValue = value.trim();
    if (!normalizedValue || isDeprecatedChatModel(normalizedValue)) {
      return;
    }
    const group = ensureProviderOptionGroup(providerId, providerLabel);
    if (!group.options.has(normalizedValue)) {
      group.options.set(normalizedValue, {
        value: normalizedValue,
        label: label.trim() || displayModelLabel(normalizedValue)
      });
    }
  };

  if (hasConfiguredProviderCatalog) {
    for (const providerGroup of visibleConfiguredProviderModelGroups) {
      for (const model of providerGroup.models) {
        addModelOption(
          providerGroup.providerId,
          providerGroup.providerLabel,
          model.token,
          displayModelLabel(model.modelId || model.token)
        );
      }
    }
  } else if (legacyHolabossProxyModelsAvailable) {
    const fallbackModels = Array.from(
      new Set([
        chatModelPreference,
        runtimeDefaultModel,
        DEFAULT_RUNTIME_MODEL,
        ...CHAT_MODEL_PRESETS
      ])
    )
      .filter(Boolean)
      .filter((model) => !isDeprecatedChatModel(model));

    for (const model of fallbackModels) {
      const providerId = inferProviderIdForModel(model);
      addModelOption(providerId, displayProviderLabel(providerId), model, displayModelLabel(model));
    }
  }

  const availableChatModelOptionGroups: ChatModelOptionGroup[] = Array.from(modelOptionsByProvider.entries()).map(
    ([providerId, group]) => ({
      providerId,
      providerLabel: group.providerLabel,
      options: Array.from(group.options.values())
    })
  );
  const availableChatModelOptions = availableChatModelOptionGroups.flatMap((group) => group.options);
  const normalizedModelPreference = chatModelPreference.trim();
  const modelPreferenceAvailable =
    normalizedModelPreference.length > 0 &&
    availableChatModelOptions.some((option) => option.value === normalizedModelPreference);
  const effectiveChatModelPreference = modelPreferenceAvailable
    ? normalizedModelPreference
    : availableChatModelOptions[0]?.value || "";
  const resolvedChatModelToken = effectiveChatModelPreference;
  const resolvedChatModelLabel = resolvedChatModelToken
    ? (availableChatModelOptions.find((option) => option.value === resolvedChatModelToken)?.label ??
      displayModelLabel(resolvedChatModelToken))
    : "";
  const modelSelectionUnavailableReason =
    availableChatModelOptions.length > 0
      ? ""
      : "No models available. Sign in to use Holaboss or add a provider.";

  useEffect(() => {
    if (!effectiveChatModelPreference) {
      return;
    }
    if (chatModelPreference.trim() === effectiveChatModelPreference) {
      return;
    }
    setChatModelPreference(effectiveChatModelPreference);
  }, [chatModelPreference, effectiveChatModelPreference]);
  const textareaPlaceholder = isOnboardingVariant
    ? "Answer the onboarding prompt or share setup details"
    : "Ask anything";
  const chatScrollRange = Math.max(0, chatScrollMetrics.scrollHeight - chatScrollMetrics.clientHeight);
  const showCustomChatScrollbar = hasMessages && chatScrollMetrics.clientHeight > 0 && chatScrollRange > 1;
  const chatScrollbarRailInset = composerBlockHeight > 0 ? composerBlockHeight / 2 : 0;
  const chatScrollbarRailHeight = chatScrollMetrics.clientHeight;
  const chatScrollbarThumbHeight = showCustomChatScrollbar
    ? Math.max(
        CHAT_SCROLLBAR_MIN_THUMB_HEIGHT_PX,
        Math.min(chatScrollbarRailHeight, (chatScrollMetrics.clientHeight / chatScrollMetrics.scrollHeight) * chatScrollbarRailHeight)
      )
    : 0;
  const chatScrollbarThumbTravel = Math.max(0, chatScrollbarRailHeight - chatScrollbarThumbHeight);
  const chatScrollbarThumbOffset = showCustomChatScrollbar
    ? chatScrollRange > 0
      ? (chatScrollMetrics.scrollTop / chatScrollRange) * chatScrollbarThumbTravel
      : 0
    : 0;

  useEffect(() => {
    if (!selectedWorkspace?.id || isOnboardingVariant) {
      return;
    }
    if (!runtimeStartupBlocked && !workspaceAppsStartupBlocked) {
      startupUnlockedWorkspaceIdsRef.current.add(selectedWorkspace.id);
    }
  }, [isOnboardingVariant, runtimeStartupBlocked, selectedWorkspace?.id, workspaceAppsStartupBlocked]);

  useEffect(() => {
    if (!rawShowStartupOverlay) {
      setShowStartupOverlay(false);
      return;
    }

    if (runtimeLifecycleStatus === "error") {
      setShowStartupOverlay(true);
      return;
    }

    const workspaceId = selectedWorkspace?.id || "";
    const hasUnlockedWorkspace = workspaceId ? startupUnlockedWorkspaceIdsRef.current.has(workspaceId) : false;
    const delayMs = hasUnlockedWorkspace ? STARTUP_OVERLAY_REPEAT_DELAY_MS : STARTUP_OVERLAY_INITIAL_DELAY_MS;
    const timer = window.setTimeout(() => {
      setShowStartupOverlay(true);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [rawShowStartupOverlay, runtimeLifecycleStatus, selectedWorkspace?.id]);

  useEffect(() => {
    if (!hasMessages) {
      setChatScrollMetrics({
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0
      });
      return;
    }

    syncChatScrollMetrics();

    const container = messagesRef.current;
    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      syncChatScrollMetrics(container);
    });
    resizeObserver.observe(container);

    if (messagesContentRef.current) {
      resizeObserver.observe(messagesContentRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [composerBlockHeight, effectiveLiveAssistantText, effectiveLiveTraceSteps, hasMessages, messages]);

  useEffect(() => {
    if (!hasMessages) {
      setComposerBlockHeight(0);
      return;
    }

    const composerBlock = composerBlockRef.current;
    if (!composerBlock) {
      return;
    }

    const updateComposerBlockHeight = () => {
      setComposerBlockHeight(Math.round(composerBlock.getBoundingClientRect().height));
    };

    updateComposerBlockHeight();
    const resizeObserver = new ResizeObserver(() => {
      updateComposerBlockHeight();
    });
    resizeObserver.observe(composerBlock);
    return () => {
      resizeObserver.disconnect();
    };
  }, [hasMessages]);

  return (
    <PaneCard className={isOnboardingVariant ? "w-full shadow-glow border-[rgba(247,90,84,0.2)]" : "w-full shadow-glow"}>
      <div
        onDragOver={onPaneDragOver}
        onDragLeave={onPaneDragLeave}
        onDrop={onPaneDrop}
        className={`relative flex h-full min-h-0 min-w-0 flex-col transition ${
          isPaneDragActive ? "ring-2 ring-neon-green/40 ring-offset-0" : ""
        }`}
      >
        <div className="theme-chat-composer-glow pointer-events-none absolute inset-x-8 bottom-0 h-44 rounded-[var(--theme-radius-pill)] blur-2xl" />
        {isPaneDragActive ? (
          <div className="pointer-events-none absolute inset-0 z-30 bg-[rgba(245,255,245,0.34)] backdrop-blur-[2px]">
            <div className="flex h-full items-center justify-center p-6">
              <div className="theme-subtle-surface flex w-full max-w-[420px] flex-col items-center justify-center rounded-[28px] border-2 border-dashed border-neon-green/60 bg-[rgba(250,255,250,0.92)] px-8 py-10 text-center shadow-[0_28px_90px_rgba(120,190,120,0.18)]">
                <div className="mb-4 grid h-14 w-14 place-items-center rounded-full border border-neon-green/35 bg-neon-green/[0.14] text-neon-green">
                  <Paperclip size={20} />
                </div>
                <div className="text-[16px] font-semibold tracking-[-0.02em] text-text-main/95">
                  Drop files to attach
                </div>
                <div className="mt-2 max-w-[280px] text-[12px] leading-6 text-text-muted/82">
                  Release anywhere in this chat pane to add the files to your next message.
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {showStartupOverlay ? (
          <div className="absolute inset-0 z-40 bg-[rgba(252,248,244,0.82)] backdrop-blur-[8px]">
            <div className="flex h-full items-center justify-center p-5 sm:p-7">
              <div className="theme-subtle-surface w-full max-w-[620px] rounded-[30px] border border-[rgba(247,90,84,0.2)] bg-[radial-gradient(circle_at_top_left,rgba(247,90,84,0.14),transparent_42%),radial-gradient(circle_at_85%_14%,rgba(247,170,126,0.12),transparent_34%),rgba(255,251,247,0.96)] p-7 shadow-[0_36px_120px_rgba(120,92,76,0.16)] sm:p-8">
                <div className="flex items-start gap-4">
                  <div
                    className={`mt-0.5 grid h-12 w-12 shrink-0 place-items-center rounded-full border ${
                      startupOverlayTone === "error"
                        ? "border-[rgba(247,90,84,0.24)] bg-[rgba(247,90,84,0.08)] text-[rgba(206,92,84,0.94)]"
                        : "border-[rgba(247,170,126,0.22)] bg-[rgba(247,170,126,0.1)] text-[rgba(206,120,84,0.92)]"
                    }`}
                  >
                    {startupOverlayTone === "error" ? (
                      <AlertTriangle size={18} />
                    ) : (
                      <Loader2 size={18} className="animate-spin" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[rgba(206,92,84,0.88)]">
                        Workspace startup
                      </div>
                      {selectedWorkspace ? (
                        <div className="rounded-full border border-[rgba(247,90,84,0.14)] bg-[rgba(247,90,84,0.05)] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-text-dim/82">
                          {selectedWorkspace.name.trim() || "Workspace"}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-text-main">
                      {startupOverlayTitle}
                    </div>
                    <div className="mt-3 max-w-[480px] text-[14px] leading-7 text-text-muted/82">
                      {startupOverlayDescription}
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-3">
                  <StartupStatusRow
                    label="Local runtime"
                    tone={runtimeStartupTone}
                    detail={
                      runtimeLifecycleStatus === "running"
                        ? "Connected and ready"
                        : runtimeLifecycleStatus === "error"
                          ? "Startup failed"
                          : "Booting and reconnecting tools"
                    }
                  />
                  <StartupStatusRow
                    label="Workspace apps"
                    tone={workspaceAppsStartupTone}
                    detail={
                      workspaceAppsStartupTone === "ready"
                        ? "Apps and tools are ready"
                        : workspaceAppsStartupTone === "waiting"
                          ? "Waiting for the runtime to come online"
                          : workspaceBlockingReason || "Preparing workspace apps and capabilities"
                    }
                  />
                </div>

                <div className="mt-6 rounded-[20px] border border-panel-border/28 bg-[rgba(255,255,255,0.64)] px-4 py-3 text-[12px] leading-6 text-text-muted/78">
                  Chat unlocks automatically as soon as startup completes.
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isOnboardingVariant && selectedWorkspace ? (
          <div className="shrink-0 px-4 pt-4 sm:px-5">
            <div className="theme-subtle-surface overflow-hidden rounded-[22px] border border-[rgba(247,90,84,0.2)] shadow-[0_24px_60px_rgba(233,117,109,0.08)]">
              <div className="bg-[radial-gradient(circle_at_top_left,rgba(247,90,84,0.12),transparent_42%),radial-gradient(circle_at_92%_12%,rgba(247,170,126,0.12),transparent_36%)] px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(206,92,84,0.88)]">
                      Workspace onboarding
                    </div>
                    <div className="mt-2 text-[22px] font-semibold tracking-[-0.04em] text-text-main">
                      {selectedWorkspace.name.trim() || "Workspace setup"}
                    </div>
                  </div>

                  <div
                    className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${onboardingStatusTone(
                      selectedWorkspace.onboarding_status
                    )}`}
                  >
                    {onboardingStatusLabel(selectedWorkspace.onboarding_status)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {effectiveChatErrorMessage || verboseTelemetryEnabled ? (
          <div className="shrink-0 px-4 pt-3 sm:px-5">
            {effectiveChatErrorMessage ? (
              <div className="theme-chat-system-bubble rounded-[14px] border px-3 py-2 text-[11px]">
                {effectiveChatErrorMessage}
              </div>
            ) : null}

            {verboseTelemetryEnabled ? (
              <div className="theme-subtle-surface mt-3 rounded-[14px] border border-panel-border/45 px-3 py-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] tracking-[0.12em] text-text-dim">
                    Stream telemetry ({streamTelemetry.length})
                  </div>
                  <button
                    type="button"
                    onClick={() => setStreamTelemetry([])}
                    className="rounded border border-panel-border/50 px-2 py-1 text-[10px] text-text-muted transition hover:border-neon-green/35 hover:text-text-main"
                  >
                    Clear
                  </button>
                </div>
                <div className="theme-control-surface max-h-36 overflow-y-auto rounded border border-panel-border/35 p-2 font-mono text-[10px] text-text-muted">
                  {streamTelemetryTail.length === 0 ? (
                    <div className="text-text-dim">No stream events yet.</div>
                  ) : (
                    streamTelemetryTail.map((entry) => (
                      <div key={entry.id} className="whitespace-pre-wrap break-all">
                        {`${entry.at} ${entry.action} stream=${entry.streamId} transport=${entry.transportType} event=${entry.eventType || entry.eventName} input=${entry.inputId || "-"} session=${entry.sessionId || "-"} detail=${entry.detail || "-"}`}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">
            <div
              ref={messagesRef}
              onScroll={(event) => {
                shouldAutoScrollRef.current = isNearChatBottom(event.currentTarget);
                syncChatScrollMetrics(event.currentTarget);
              }}
              className={`chat-scrollbar-hidden h-full min-h-0 overflow-y-auto ${hasMessages ? "" : "flex items-center justify-center"}`}
            >
              {hasMessages ? (
                <div
                  ref={messagesContentRef}
                  className="mx-auto flex w-full max-w-[860px] flex-col gap-7 pb-3 pl-4 pr-10 pt-5 sm:pl-5 sm:pr-11"
                >
                  {messages.map((message) =>
                    message.role === "user" ? (
                      <UserTurn key={message.id} text={message.text} attachments={message.attachments ?? []} />
                    ) : (
                      <AssistantTurn
                        key={message.id}
                        label={assistantLabel}
                        text={message.text}
                        contentBlocks={message.contentBlocks ?? []}
                        traceSteps={message.traceSteps ?? []}
                        collapsedTraceByStepId={collapsedTraceByStepId}
                        onToggleTraceStep={toggleTraceStep}
                      />
                    )
                  )}

                  {showLiveAssistantTurn ? (
                    <div ref={liveAssistantTurnRef} className="scroll-mb-6">
                      <AssistantTurn
                        label={assistantLabel}
                        text={effectiveLiveAssistantText}
                        contentBlocks={effectiveLiveContentBlocks}
                        traceSteps={effectiveLiveTraceSteps}
                        collapsedTraceByStepId={collapsedTraceByStepId}
                        onToggleTraceStep={toggleTraceStep}
                        live
                        status={effectiveLiveAgentStatus || (effectiveIsResponding ? "Working..." : "")}
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="w-full px-4 pb-10 pt-10 sm:px-5">
                  <div className="mx-auto mb-6 max-w-[560px] text-center">
                    <div className="text-[22px] font-semibold tracking-[-0.02em] text-text-main/90">
                      {isLoadingBootstrap || isLoadingHistory
                        ? "Loading workspace context"
                        : isOnboardingVariant
                          ? "Complete workspace onboarding"
                          : "Ask the workspace agent"}
                    </div>
                    <div className="mt-3 text-[13px] leading-7 text-text-muted/68">
                      {selectedWorkspace
                        ? readinessMessage ||
                          (isOnboardingVariant
                            ? "Follow the setup conversation here. The agent will use the workspace guide to ask only onboarding questions and capture durable setup facts."
                            : "Messages are queued into the local runtime workspace flow, then streamed back from the live session output feed.")
                        : "Pick a template, create a workspace, and then send the first instruction."}
                    </div>
                  </div>
                  <form onSubmit={onSubmit} className="mx-auto max-w-[760px]">
                    {!showStartupOverlay && readinessMessage ? (
                      <div className="mb-3 text-[12px] text-text-muted/82">{readinessMessage}</div>
                    ) : null}
                    <Composer
                      input={input}
                      attachments={pendingAttachmentItems}
                      isResponding={effectiveIsResponding}
                      disabled={composerDisabled}
                      disabledReason={composerDisabledReason}
                      selectedModel={effectiveChatModelPreference}
                      resolvedModelLabel={resolvedChatModelLabel || modelSelectionUnavailableReason}
                      modelOptionGroups={availableChatModelOptionGroups}
                      modelSelectionUnavailableReason={modelSelectionUnavailableReason}
                      placeholder={textareaPlaceholder}
                      showModelSelector={!isOnboardingVariant}
                      onModelChange={setChatModelPreference}
                      onOpenModelSettings={() => void window.electronAPI.ui.openSettingsPane("models")}
                      textareaRef={textareaRef}
                      fileInputRef={fileInputRef}
                      onChange={setInput}
                      onKeyDown={onComposerKeyDown}
                      onAttachmentInputChange={onAttachmentInputChange}
                      onRemoveAttachment={removePendingAttachment}
                    />
                  </form>
                </div>
              )}
            </div>
          </div>

          {showCustomChatScrollbar ? (
            <div className="pointer-events-none absolute inset-y-0 right-1 z-20 w-4">
              <div
                className="absolute left-1/2 w-[3px] -translate-x-1/2 rounded-full"
                style={{
                  top: `${chatScrollbarRailInset + chatScrollbarThumbOffset}px`,
                  height: `${chatScrollbarThumbHeight}px`,
                  background: "linear-gradient(180deg, var(--theme-scroll-thumb-top), var(--theme-scroll-thumb-bottom))"
                }}
              />
            </div>
          ) : null}

          {hasMessages ? (
            <div ref={composerBlockRef} className="shrink-0 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
              <form onSubmit={onSubmit} className="mx-auto max-w-[760px]">
                {!showStartupOverlay && readinessMessage ? (
                  <div className="mb-3 text-[12px] text-text-muted/82">{readinessMessage}</div>
                ) : null}
                <Composer
                  input={input}
                  attachments={pendingAttachmentItems}
                  isResponding={effectiveIsResponding}
                  disabled={composerDisabled}
                  disabledReason={composerDisabledReason}
                  selectedModel={effectiveChatModelPreference}
                  resolvedModelLabel={resolvedChatModelLabel || modelSelectionUnavailableReason}
                  modelOptionGroups={availableChatModelOptionGroups}
                  modelSelectionUnavailableReason={modelSelectionUnavailableReason}
                  placeholder={textareaPlaceholder}
                  showModelSelector={!isOnboardingVariant}
                  onModelChange={setChatModelPreference}
                  onOpenModelSettings={() => void window.electronAPI.ui.openSettingsPane("models")}
                  textareaRef={textareaRef}
                  fileInputRef={fileInputRef}
                  onChange={setInput}
                  onKeyDown={onComposerKeyDown}
                  onAttachmentInputChange={onAttachmentInputChange}
                  onRemoveAttachment={removePendingAttachment}
                />
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </PaneCard>
  );
}

interface ComposerProps {
  input: string;
  attachments: Array<{
    id: string;
    kind: "image" | "file";
    name: string;
    size_bytes: number;
  }>;
  isResponding: boolean;
  disabled: boolean;
  disabledReason?: string;
  selectedModel: string;
  resolvedModelLabel: string;
  modelOptionGroups: ChatModelOptionGroup[];
  modelSelectionUnavailableReason: string;
  placeholder: string;
  showModelSelector: boolean;
  onModelChange: (value: string) => void;
  onOpenModelSettings: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onAttachmentInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}

function StartupStatusRow({
  label,
  tone,
  detail
}: {
  label: string;
  tone: StartupPhaseTone;
  detail: string;
}) {
  const toneClassName =
    tone === "ready"
      ? "border-[rgba(92,180,120,0.2)] bg-[rgba(92,180,120,0.08)] text-[rgba(118,196,144,0.92)]"
      : tone === "error"
        ? "border-[rgba(247,90,84,0.24)] bg-[rgba(247,90,84,0.08)] text-[rgba(206,92,84,0.94)]"
        : tone === "waiting"
          ? "border-panel-border/35 bg-panel-bg/24 text-text-dim/78"
          : "border-[rgba(247,170,126,0.2)] bg-[rgba(247,170,126,0.08)] text-[rgba(224,146,103,0.92)]";

  return (
    <div className="flex items-start gap-3 rounded-[20px] border border-panel-border/26 bg-[rgba(255,255,255,0.68)] px-4 py-3">
      <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border ${toneClassName}`}>
        {tone === "ready" ? (
          <Check size={14} />
        ) : tone === "error" ? (
          <AlertTriangle size={14} />
        ) : tone === "loading" ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Clock3 size={14} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-text-main/92">{label}</div>
        <div className="mt-1 text-[12px] leading-6 text-text-muted/78">{detail}</div>
      </div>
    </div>
  );
}

function UserTurn({
  text,
  attachments
}: {
  text: string;
  attachments: ChatAttachment[];
}) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[420px] flex-col items-end gap-2">
        {text ? (
          <div className="theme-chat-user-bubble inline-flex max-w-full rounded-[18px] border px-4 py-3 text-[13px] leading-7 text-text-main/95">
            <div className="whitespace-pre-wrap break-words">{text}</div>
          </div>
        ) : null}
        {attachments.length > 0 ? <AttachmentList attachments={attachments} className="justify-end" /> : null}
      </div>
    </div>
  );
}

function AssistantTurn({
  label,
  text,
  contentBlocks,
  traceSteps,
  collapsedTraceByStepId,
  onToggleTraceStep,
  status = "",
  live = false
}: {
  label: string;
  text: string;
  contentBlocks: ChatTurnBlock[];
  traceSteps: ChatTraceStep[];
  collapsedTraceByStepId: Record<string, boolean>;
  onToggleTraceStep: (stepId: string) => void;
  status?: string;
  live?: boolean;
}) {
  const traceStepsById = useMemo(() => new Map(traceSteps.map((step) => [step.id, step])), [traceSteps]);
  const normalizedContentBlocks =
    contentBlocks.length > 0
      ? contentBlocks
      : traceSteps.length > 0
        ? traceSteps.map((step) => ({
            id: `fallback:trace:${step.id}`,
            kind: "trace" as const,
            stepId: step.id,
            order: step.order
          })) as ChatTurnBlock[]
        : text
          ? [{ id: "fallback:text", kind: "text" as const, text, order: 0 }]
          : [];
  const hasRenderableBlocks = normalizedContentBlocks.length > 0;

  return (
    <div className="flex justify-start">
      <article className="max-w-[760px]">
        <div className="flex items-start gap-3">
          <div className="theme-subtle-surface mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-panel-border/35 text-text-main/84">
            <Bot size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[12px] font-medium text-text-main/94">{label}</div>
              {live ? (
                <div className="rounded-full border border-[rgba(247,90,84,0.18)] bg-[rgba(247,90,84,0.08)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[rgba(206,92,84,0.92)]">
                  Live
                </div>
              ) : null}
            </div>

            {status && !hasRenderableBlocks && traceSteps.length === 0 ? (
              <div className="mt-2 text-[13px] leading-7 text-text-muted/78">{status}</div>
            ) : null}

            {hasRenderableBlocks ? (
              <div className="mt-4 grid gap-4">
                {normalizedContentBlocks.map((block) => {
                  if (block.kind === "text") {
                    return (
                      <div key={block.id} className="whitespace-pre-wrap text-[15px] leading-8 text-text-main/92">
                        {block.text}
                      </div>
                    );
                  }

                  const step = traceStepsById.get(block.stepId);
                  if (!step) {
                    return null;
                  }

                  return (
                    <div key={block.id} className="border-l border-panel-border/25 pl-4">
                      <TraceStepCard
                        step={step}
                        collapsed={isTraceStepCollapsed(step, collapsedTraceByStepId)}
                        onToggle={() => onToggleTraceStep(step.id)}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}

function traceStatusLabel(status: ChatTraceStepStatus) {
  if (status === "completed") {
    return "Completed";
  }
  if (status === "error") {
    return "Error";
  }
  if (status === "waiting") {
    return "Waiting";
  }
  return "In progress";
}

function isTraceStepCollapsed(step: ChatTraceStep, collapsedTraceByStepId: Record<string, boolean>) {
  return collapsedTraceByStepId[step.id] ?? true;
}

function IntegrationErrorBanner({ details }: { details: string[] }) {
  const errorText = details.join(" ");
  const integrationError = isIntegrationError(errorText);
  if (!integrationError) return null;
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-[10px] border border-amber-400/20 bg-amber-400/6 px-2.5 py-1.5 text-[11px] text-amber-400/90">
      <Cable size={12} className="shrink-0" />
      <span>{integrationError.action}</span>
    </div>
  );
}

function TraceStepCard({
  step,
  collapsed,
  onToggle
}: {
  step: ChatTraceStep;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const statusTone =
    step.status === "completed"
      ? "border-[rgba(92,180,120,0.2)] bg-[rgba(92,180,120,0.08)] text-[rgba(118,196,144,0.92)]"
      : step.status === "error"
        ? "border-[rgba(247,90,84,0.24)] bg-[rgba(247,90,84,0.08)] text-[rgba(206,92,84,0.94)]"
        : step.status === "waiting"
          ? "border-panel-border/35 bg-panel-bg/24 text-text-dim/78"
          : "border-[rgba(247,170,126,0.18)] bg-[rgba(247,170,126,0.08)] text-[rgba(224,146,103,0.92)]";
  const buttonClassName = collapsed
    ? "flex w-full items-center gap-2.5 rounded-[14px] px-1 py-1 text-left transition hover:bg-panel-bg/18"
    : "theme-subtle-surface flex w-full items-start gap-3 rounded-[18px] border border-panel-border/35 px-3.5 py-3 text-left transition hover:border-panel-border/55";
  const iconClassName = collapsed
    ? `grid h-5 w-5 shrink-0 place-items-center rounded-full border ${statusTone}`
    : `mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border ${statusTone}`;
  const titleClassName = collapsed
    ? "truncate text-[12px] font-medium leading-5 text-text-main/88"
    : "text-[13px] font-medium leading-6 text-text-main/92";

  return (
    <div className="relative">
      <div className="absolute -left-[1.3125rem] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-panel-border/50 bg-panel-bg/90" />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className={buttonClassName}
      >
        <div className={iconClassName}>
          {step.status === "completed" ? (
            <Check size={collapsed ? 11 : 13} />
          ) : step.status === "error" ? (
            <AlertTriangle size={collapsed ? 11 : 13} />
          ) : (
            <Clock3 size={collapsed ? 11 : 13} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className={titleClassName}>{step.title}</div>
            {!collapsed ? (
              <div className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusTone}`}>
                {traceStatusLabel(step.status)}
              </div>
            ) : null}
          </div>

          {!collapsed && step.details.length > 0 ? (
            <div className="mt-1 text-[12px] leading-6 text-text-muted/78">
              {step.details.join("\n")}
            </div>
          ) : null}
          {step.status === "error" ? <IntegrationErrorBanner details={step.details} /> : null}
        </div>

        {step.details.length > 0 ? (
          <ChevronDown
            size={collapsed ? 13 : 14}
            className={`shrink-0 text-text-dim/70 transition ${collapsed ? "" : "mt-1 rotate-180"}`}
          />
        ) : null}
      </button>
    </div>
  );
}

function AttachmentList({
  attachments,
  onRemove,
  className = ""
}: {
  attachments: Array<{
    id: string;
    kind: "image" | "file";
    name: string;
    size_bytes: number;
  }>;
  onRemove?: (attachmentId: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="theme-control-surface inline-flex max-w-full items-center gap-2 rounded-full border border-panel-border/35 px-3 py-1.5 text-[11px] text-text-main/84"
        >
          {attachment.kind === "image" ? (
            <ImageIcon size={12} className="shrink-0 text-neon-green/72" />
          ) : (
            <FileText size={12} className="shrink-0 text-neon-green/72" />
          )}
          <span className="truncate">{attachmentButtonLabel(attachment)}</span>
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              className="grid h-4 w-4 place-items-center rounded-full text-text-muted transition hover:text-text-main"
              aria-label={`Remove ${attachment.name}`}
            >
              <X size={11} />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Composer({
  input,
  attachments,
  isResponding,
  disabled,
  disabledReason = "",
  selectedModel,
  resolvedModelLabel,
  modelOptionGroups,
  modelSelectionUnavailableReason,
  placeholder,
  showModelSelector,
  onModelChange,
  onOpenModelSettings,
  textareaRef,
  fileInputRef,
  onChange,
  onKeyDown,
  onAttachmentInputChange,
  onRemoveAttachment
}: ComposerProps) {
  const allModelOptions = modelOptionGroups.flatMap((group) => group.options);
  const noAvailableModels = allModelOptions.length === 0;
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const providerModelGroups = modelOptionGroups.filter((group) => group.options.length > 0);
  const showProviderSections = providerModelGroups.length > 1;

  useEffect(() => {
    if (!modelMenuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!modelMenuContainerRef.current?.contains(target)) {
        setModelMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModelMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (showModelSelector && !isResponding && !noAvailableModels) {
      return;
    }
    setModelMenuOpen(false);
  }, [isResponding, noAvailableModels, showModelSelector]);

  return (
    <div className="glass-field overflow-visible rounded-[calc(var(--theme-radius-card)+0.15rem)] border border-panel-border/35 transition">
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onAttachmentInputChange} />
      {attachments.length > 0 ? (
        <div className="border-b border-panel-border/20 px-4 py-3">
          <AttachmentList attachments={attachments} onRemove={onRemoveAttachment} />
        </div>
      ) : null}
      <div className="px-4 pb-2 pt-4">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          placeholder={disabled ? disabledReason || "Chat unavailable right now" : placeholder}
          className="composer-input block max-h-[220px] min-h-[76px] w-full resize-none overflow-y-auto bg-transparent text-[14px] leading-7 text-text-main/92 outline-none placeholder:text-text-muted/42 disabled:cursor-not-allowed disabled:opacity-55"
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-panel-border/20 px-3 py-3 text-text-muted/72">
        {showModelSelector ? (
          <div ref={modelMenuContainerRef} className="relative w-[172px] shrink-0 sm:w-[208px]">
            {noAvailableModels ? (
              <button
                type="button"
                onClick={onOpenModelSettings}
                className="composer-select theme-subtle-surface flex h-9 w-full items-center justify-between gap-3 rounded-[11px] border border-panel-border/28 px-3 text-left text-[12px] font-medium text-text-main/90 transition hover:border-panel-border/48 hover:bg-panel-bg/18"
                title={modelSelectionUnavailableReason}
              >
                <span className="truncate">Open model settings</span>
                <Settings2 size={13} className="shrink-0 text-text-dim/72" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setModelMenuOpen((current) => !current)}
                  disabled={isResponding}
                  aria-label="Model selection"
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                  className="block w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
                  title={resolvedModelLabel}
                >
                  <span className="composer-select theme-subtle-surface flex h-9 w-full items-center rounded-[11px] border border-panel-border/28 px-3 pr-9 text-[12px] font-medium text-text-main/90 transition hover:border-panel-border/48">
                    <span className="truncate">{resolvedModelLabel}</span>
                  </span>
                </button>
                <ChevronDown
                  size={14}
                  className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-dim/70 transition ${
                    modelMenuOpen ? "rotate-180" : ""
                  }`}
                />
                {modelMenuOpen ? (
                  <div
                    role="listbox"
                    className="theme-subtle-surface absolute bottom-[calc(100%+10px)] left-0 z-40 max-h-[320px] w-[min(360px,calc(100vw-2rem))] overflow-y-auto rounded-[16px] border border-panel-border/45 p-1.5 shadow-[0_22px_56px_rgba(16,24,40,0.28)] backdrop-blur"
                  >
                    {providerModelGroups.map((group, groupIndex) => (
                      <div key={`${group.providerId}:${group.providerLabel}`} className={groupIndex > 0 ? "mt-2" : "mt-1"}>
                        {showProviderSections ? (
                          <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-text-dim/72">
                            {group.providerLabel}
                          </div>
                        ) : null}
                        {group.options.map((option) => {
                          const isSelected = selectedModel === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              onClick={() => {
                                onModelChange(option.value);
                                setModelMenuOpen(false);
                              }}
                              className={`flex w-full items-center justify-between gap-3 rounded-[11px] px-3 py-2 text-left text-[12px] transition ${
                                isSelected ? "bg-neon-green/18 text-text-main" : "text-text-main/88 hover:bg-panel-bg/22"
                              }`}
                            >
                              <span className="truncate">{option.label}</span>
                              {isSelected ? <Check size={13} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className="text-[11px] leading-6 text-text-dim/72">
            Responses here stay in the workspace onboarding thread.
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={isResponding || disabled}
            onClick={() => fileInputRef.current?.click()}
            className="grid h-9 w-9 place-items-center rounded-[var(--theme-radius-pill)] border border-panel-border/40 text-text-muted transition hover:border-neon-green/35 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Attach files"
          >
            <Paperclip size={15} />
          </button>
          <button
            type="submit"
            disabled={(!input.trim() && attachments.length === 0) || isResponding || disabled}
            className="grid h-9 w-9 place-items-center rounded-[var(--theme-radius-pill)] bg-text-main text-[rgb(var(--color-obsidian))] transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {isResponding ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
