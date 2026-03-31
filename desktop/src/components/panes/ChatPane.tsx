import { type ChangeEvent, type DragEvent, FormEvent, KeyboardEvent, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AlertTriangle, ArrowUp, Bot, Cable, Check, ChevronDown, Clock3, FileText, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";
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

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: ChatAttachment[];
  thinkingText?: string;
  traceSteps?: ChatTraceStep[];
}

type ChatTraceStepStatus = "running" | "completed" | "error" | "waiting";

interface ChatTraceStep {
  id: string;
  kind: "phase" | "tool";
  title: string;
  status: ChatTraceStepStatus;
  details: string[];
  order: number;
}

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

const STREAM_ATTACH_PENDING = "__stream_attach_pending__";
const STREAM_TELEMETRY_LIMIT = 240;
const TOOL_TRACE_TERMINAL_PHASES = new Set(["completed", "failed", "error"]);
const CHAT_AUTO_SCROLL_THRESHOLD_PX = 72;
const CHAT_SCROLLBAR_MIN_THUMB_HEIGHT_PX = 40;
const CHAT_MODEL_STORAGE_KEY = "holaboss-chat-model-v1";
const CHAT_MODEL_USE_RUNTIME_DEFAULT = "__runtime_default__";
const LEGACY_UNAVAILABLE_CHAT_MODELS = new Set(["openai/gpt-5.2-mini"]);
const CHAT_MODEL_PRESETS = [
  "openai/gpt-5.1",
  "openai/gpt-5",
  "openai/gpt-5.2",
  "claude-sonnet-4-5"
] as const;

function sessionUserId(session: { user?: { id?: string | null } | null } | null | undefined): string {
  return session?.user?.id?.trim() || "";
}

function isHolabossProxyModel(model: string) {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("openai/") ||
    normalized.startsWith("anthropic/") ||
    normalized.startsWith("gpt-") ||
    normalized.startsWith("claude-")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function normalizeStoredChatModelPreference(value: string | null | undefined) {
  const stored = value?.trim();
  if (!stored) {
    return CHAT_MODEL_USE_RUNTIME_DEFAULT;
  }
  if (LEGACY_UNAVAILABLE_CHAT_MODELS.has(stored.toLowerCase())) {
    return CHAT_MODEL_USE_RUNTIME_DEFAULT;
  }
  return stored;
}

function loadStoredChatModelPreference() {
  try {
    return normalizeStoredChatModelPreference(localStorage.getItem(CHAT_MODEL_STORAGE_KEY));
  } catch {
    return CHAT_MODEL_USE_RUNTIME_DEFAULT;
  }
}

function displayModelLabel(model: string) {
  const trimmed = model.trim();
  if (!trimmed) {
    return "Unknown model";
  }

  const withoutProvider = trimmed.replace(/^(openai|anthropic)\//i, "");
  const claudeSonnetMatch = withoutProvider.match(/^claude-sonnet-(\d+)-(\d+)$/i);
  if (claudeSonnetMatch) {
    return `Claude Sonnet ${claudeSonnetMatch[1]}.${claudeSonnetMatch[2]}`;
  }

  if (/^gpt-/i.test(withoutProvider)) {
    return withoutProvider
      .replace(/^gpt-/i, "GPT-")
      .replace(/-mini\b/gi, " Mini")
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

function assistantMetaLabel(harness: string | null | undefined, model: string | null | undefined) {
  const harnessLabel = harness ? startCase(harness) : "";
  if (harnessLabel) {
    return harnessLabel;
  }

  const modelLabel = (model || "").trim();
  return modelLabel || "Local runtime";
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

function assistantHistoryStateFromOutputEvents(outputEvents: SessionOutputEventPayload[]) {
  const orderedEvents = [...outputEvents].sort((left, right) => left.sequence - right.sequence || left.id - right.id);
  let thinkingText = "";
  let traceSteps: ChatTraceStep[] = [];

  for (const event of orderedEvents) {
    const eventPayload = isRecord(event.payload) ? event.payload : {};

    if (event.event_type === "thinking_delta") {
      const delta = typeof eventPayload.delta === "string" ? eventPayload.delta : "";
      if (delta) {
        thinkingText = `${thinkingText}${delta}`;
      }
    }

    const phaseStep = phaseTraceStepFromEvent(event.event_type, eventPayload, event.sequence);
    if (phaseStep) {
      traceSteps = upsertTraceStep(traceSteps, phaseStep);
    }

    const toolStep = toolTraceStepFromEvent(event.event_type, eventPayload, event.sequence);
    if (toolStep) {
      traceSteps = upsertTraceStep(traceSteps, toolStep);
    }

    if (event.event_type === "run_completed") {
      traceSteps = finalizeTraceSteps(traceSteps, "completed");
    } else if (event.event_type === "run_failed") {
      traceSteps = finalizeTraceSteps(traceSteps, "error");
    }
  }

  return {
    thinkingText: thinkingText || undefined,
    traceSteps: traceSteps.length > 0 ? traceSteps : undefined
  };
}

function isNearChatBottom(container: HTMLDivElement) {
  const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
  return remaining <= CHAT_AUTO_SCROLL_THRESHOLD_PX;
}

export function ChatPane({
  onOutputsChanged,
  focusRequestKey = 0
}: {
  onOutputsChanged?: () => void;
  focusRequestKey?: number;
}) {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const authSessionState = useDesktopAuthSession();
  const {
    runtimeConfig,
    selectedWorkspace,
    resolvedUserId,
    isLoadingBootstrap,
    isActivatingWorkspace,
    workspaceAppsReady,
    workspaceBlockingReason,
    refreshWorkspaceData
  } = useWorkspaceDesktop();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [liveAssistantText, setLiveAssistantText] = useState("");
  const [liveThinkingText, setLiveThinkingText] = useState("");
  const [liveThinkingExpanded, setLiveThinkingExpanded] = useState(false);
  const [liveAgentStatus, setLiveAgentStatus] = useState("");
  const [liveTraceSteps, setLiveTraceSteps] = useState<ChatTraceStep[]>([]);
  const [collapsedThinkingByMessageId, setCollapsedThinkingByMessageId] = useState<Record<string, boolean>>({});
  const [collapsedTraceByStepId, setCollapsedTraceByStepId] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [chatErrorMessage, setChatErrorMessage] = useState("");
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerBlockRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const pendingInputIdRef = useRef<string | null>(null);
  const seenMainDebugKeysRef = useRef<Set<string>>(new Set());
  const selectedWorkspaceRef = useRef<WorkspaceRecordPayload | null>(null);
  const pendingFocusRequestKeyRef = useRef<number | null>(focusRequestKey);
  const liveAssistantTextRef = useRef("");
  const liveThinkingTextRef = useRef("");
  const liveThinkingExpandedRef = useRef(false);
  const liveTraceStepsRef = useRef<ChatTraceStep[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");

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
  }

  function resetLiveTurn() {
    liveAssistantTextRef.current = "";
    liveThinkingTextRef.current = "";
    liveThinkingExpandedRef.current = false;
    liveTraceStepsRef.current = [];
    activeAssistantMessageIdRef.current = null;
    setLiveAssistantText("");
    setLiveThinkingText("");
    setLiveThinkingExpanded(false);
    setLiveAgentStatus("");
    setLiveTraceSteps([]);
  }

  function appendLiveAssistantDelta(delta: string) {
    flushSync(() => {
      setLiveAssistantText((prev) => {
        const next = `${prev}${delta}`;
        liveAssistantTextRef.current = next;
        return next;
      });
    });
  }

  function appendLiveThinkingDelta(delta: string) {
    flushSync(() => {
      setLiveThinkingText((prev) => {
        const next = `${prev}${delta}`;
        liveThinkingTextRef.current = next;
        return next;
      });
      liveThinkingExpandedRef.current = true;
      setLiveThinkingExpanded(true);
    });
  }

  function commitLiveAssistantMessage() {
    const messageId = activeAssistantMessageIdRef.current ?? `assistant-${Date.now()}`;
    const assistantText = liveAssistantTextRef.current;
    const thinkingText = liveThinkingTextRef.current;
    const traceSteps = liveTraceStepsRef.current;
    if (!assistantText && !thinkingText && traceSteps.length === 0) {
      resetLiveTurn();
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        role: "assistant",
        text: assistantText,
        thinkingText: thinkingText || undefined,
        traceSteps: traceSteps.length > 0 ? traceSteps : undefined
      }
    ]);
    setCollapsedThinkingByMessageId((prev) => ({
      ...prev,
      [messageId]: true
    }));
    resetLiveTurn();
  }

  function toggleThinkingPanel(messageId: string) {
    setCollapsedThinkingByMessageId((prev) => ({
      ...prev,
      [messageId]: !prev[messageId]
    }));
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
      behavior: isResponding ? "auto" : "smooth"
    });
  }, [isResponding, liveAssistantText, liveThinkingText, liveTraceSteps, messages]);

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
      setMessages([]);
      resetLiveTurn();
      setCollapsedThinkingByMessageId({});
      setCollapsedTraceByStepId({});
      setPendingAttachments([]);
      setActiveSession(null);
      shouldAutoScrollRef.current = true;
      pendingInputIdRef.current = null;
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

        const nextSessionId = preferredSessionId(selectedWorkspaceRef.current, runtimeStates.items);
        if (activeSessionIdRef.current !== nextSessionId) {
          setMessages([]);
          resetLiveTurn();
          setCollapsedThinkingByMessageId({});
          setCollapsedTraceByStepId({});
          shouldAutoScrollRef.current = true;
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

        setMessages(
          history.messages
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
                  if (restoredAssistantState.thinkingText) {
                    nextMessage.thinkingText = restoredAssistantState.thinkingText;
                  }
                  if (restoredAssistantState.traceSteps) {
                    nextMessage.traceSteps = restoredAssistantState.traceSteps;
                  }
                }
              }

              return nextMessage;
            })
            .filter(
              (message) =>
                (message.role === "user" || message.role === "assistant") &&
                hasRenderableMessageContent(message.text, message.attachments ?? [])
            )
        );
        resetLiveTurn();
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
    selectedWorkspaceId,
    selectedWorkspace?.main_session_id,
    selectedWorkspace?.onboarding_session_id,
    selectedWorkspace?.onboarding_status
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
    const activeStreamId = activeStreamIdRef.current;
    if (!activeStreamId) {
      return;
    }

    activeStreamIdRef.current = null;
    activeAssistantMessageIdRef.current = null;
    setIsResponding(false);
    void closeStreamWithReason(activeStreamId, "selected_workspace_changed");
  }, [selectedWorkspaceId]);

  useEffect(() => {
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
        setChatErrorMessage(payload.error || "The agent stream failed.");
        setIsResponding(false);
        activeAssistantMessageIdRef.current = null;
        activeStreamIdRef.current = null;
        pendingInputIdRef.current = null;
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
        setLiveAgentStatus("Preparing workspace context...");
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
        appendLiveAssistantDelta(delta);
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
        appendLiveThinkingDelta(delta);
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
        if (liveAssistantTextRef.current || liveThinkingTextRef.current || liveTraceStepsRef.current.length > 0) {
          commitLiveAssistantMessage();
        }
        setIsResponding(false);
        activeStreamIdRef.current = null;
        pendingInputIdRef.current = null;
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
  }, [onOutputsChanged, refreshWorkspaceData]);

  useEffect(() => {
    if (!isResponding || !selectedWorkspaceId || !activeSessionId) {
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
  }, [isResponding, selectedWorkspaceId, activeSessionId]);

  useEffect(() => {
    return () => {
      const activeStreamId = activeStreamIdRef.current;
      if (activeStreamId) {
        void closeStreamWithReason(activeStreamId, "chatpane_unmount");
      }
    };
  }, []);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && pendingAttachments.length === 0) || isResponding) {
      return;
    }
    if (!selectedWorkspace) {
      setChatErrorMessage("Create or select a workspace first.");
      return;
    }
    if (!resolvedUserId) {
      setChatErrorMessage("Sign in or set a runtime user id first.");
      return;
    }
    if (!workspaceAppsReady) {
      setChatErrorMessage(workspaceBlockingReason || "Workspace apps are still starting.");
      return;
    }
    const targetSessionId = preferredSessionId(selectedWorkspace, []) || activeSessionIdRef.current;
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

    try {
      const attachmentEntries = [...pendingAttachments];
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

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        text: trimmed,
        attachments: stagedAttachments
      };

      shouldAutoScrollRef.current = true;
      setMessages((prev) => [...prev, userMessage]);
      resetLiveTurn();
      setInput("");
      setPendingAttachments([]);
      setIsResponding(true);
      setLiveAgentStatus("Thinking...");
      setChatErrorMessage("");
      activeAssistantMessageIdRef.current = null;
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

      const queued = await window.electronAPI.workspace.queueSessionInput({
        text: trimmed,
        workspace_id: selectedWorkspace.id,
        image_urls: null,
        attachments: stagedAttachments,
        session_id: targetSessionId,
        priority: 0,
        model: resolvedChatModel || null
      });
      setActiveSession(queued.session_id);
      pendingInputIdRef.current = queued.input_id;
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
      if (queued.session_id !== targetSessionId) {
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
      const activeStreamId = activeStreamIdRef.current;
      if (activeStreamId) {
        await closeStreamWithReason(activeStreamId, "send_message_error").catch(() => undefined);
      }
      setChatErrorMessage(normalizeErrorMessage(error));
      setIsResponding(false);
      activeAssistantMessageIdRef.current = null;
      activeStreamIdRef.current = null;
      pendingInputIdRef.current = null;
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

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  const assistantLabel = "Holaboss";
  const assistantMode = assistantMetaLabel(selectedWorkspace?.harness, runtimeConfig?.defaultModel);
  const hasMessages = messages.length > 0 || Boolean(liveAssistantText) || Boolean(liveThinkingText) || liveTraceSteps.length > 0;
  const showLiveAssistantTurn = isResponding || Boolean(liveAssistantText) || Boolean(liveThinkingText) || liveTraceSteps.length > 0;
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
  const readinessMessage =
    !selectedWorkspace || workspaceAppsReady
      ? ""
      : workspaceBlockingReason || (isActivatingWorkspace ? "Preparing workspace apps..." : "Workspace apps are still starting.");
  const composerDisabledReason = !selectedWorkspace
    ? "Select a workspace to start chatting."
    : !resolvedUserId
      ? "Sign in or set a runtime user id first."
    : isLoadingBootstrap || isLoadingHistory
      ? "Loading workspace context..."
      : !workspaceAppsReady
        ? readinessMessage || "Workspace apps are still starting."
        : "";
  const composerDisabled = Boolean(composerDisabledReason);
  const isSignedIn = Boolean(sessionUserId(authSessionState.data));
  const holabossProxyModelsAvailable =
    isSignedIn &&
    Boolean(runtimeConfig?.authTokenPresent) &&
    Boolean((runtimeConfig?.modelProxyBaseUrl || "").trim());
  const runtimeDefaultModel = runtimeConfig?.defaultModel?.trim() || DEFAULT_RUNTIME_MODEL;
  const runtimeDefaultModelAvailable = holabossProxyModelsAvailable || !isHolabossProxyModel(runtimeDefaultModel);
  const availableChatModelOptions = Array.from(
    new Set([
      runtimeDefaultModel,
      DEFAULT_RUNTIME_MODEL,
      ...(chatModelPreference !== CHAT_MODEL_USE_RUNTIME_DEFAULT ? [chatModelPreference] : []),
      ...CHAT_MODEL_PRESETS
    ])
  )
    .filter(Boolean)
    .filter((model) => holabossProxyModelsAvailable || !isHolabossProxyModel(model))
    .map((model) => ({
      value: model,
      label: displayModelLabel(model)
    }));
  const modelPreferenceAvailable =
    chatModelPreference === CHAT_MODEL_USE_RUNTIME_DEFAULT
      ? runtimeDefaultModelAvailable
      : availableChatModelOptions.some((option) => option.value === chatModelPreference);
  const effectiveChatModelPreference = modelPreferenceAvailable
    ? chatModelPreference
    : runtimeDefaultModelAvailable
      ? CHAT_MODEL_USE_RUNTIME_DEFAULT
      : availableChatModelOptions[0]?.value || CHAT_MODEL_USE_RUNTIME_DEFAULT;
  const resolvedChatModel =
    effectiveChatModelPreference === CHAT_MODEL_USE_RUNTIME_DEFAULT
      ? runtimeDefaultModelAvailable
        ? runtimeDefaultModel
        : ""
      : effectiveChatModelPreference.trim() || (runtimeDefaultModelAvailable ? runtimeDefaultModel : "");
  const modelSelectionUnavailableReason = holabossProxyModelsAvailable
    ? ""
    : "Sign in to use Holaboss models";
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
  }, [composerBlockHeight, hasMessages, liveAssistantText, liveThinkingText, liveTraceSteps, messages]);

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
    <PaneCard className="shadow-glow">
      <div className="relative flex h-full min-h-0 min-w-0 flex-col">
        <div className="theme-chat-composer-glow pointer-events-none absolute inset-x-8 bottom-0 h-44 rounded-[var(--theme-radius-pill)] blur-2xl" />

        {chatErrorMessage || verboseTelemetryEnabled ? (
          <div className="shrink-0 px-4 pt-3 sm:px-5">
            {chatErrorMessage ? (
              <div className="theme-chat-system-bubble rounded-[14px] border px-3 py-2 text-[11px]">
                {chatErrorMessage}
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
                        mode={assistantMode}
                        text={message.text}
                        thinkingText={message.thinkingText}
                        thinkingCollapsed={collapsedThinkingByMessageId[message.id] ?? true}
                        onToggleThinking={() => toggleThinkingPanel(message.id)}
                        traceSteps={message.traceSteps ?? []}
                        collapsedTraceByStepId={collapsedTraceByStepId}
                        onToggleTraceStep={toggleTraceStep}
                      />
                    )
                  )}

                  {showLiveAssistantTurn ? (
                    <AssistantTurn
                      label={assistantLabel}
                      mode={assistantMode}
                      text={liveAssistantText}
                      thinkingText={liveThinkingText}
                      thinkingCollapsed={!liveThinkingExpanded}
                      onToggleThinking={() => {
                        const next = !liveThinkingExpandedRef.current;
                        liveThinkingExpandedRef.current = next;
                        setLiveThinkingExpanded(next);
                      }}
                      traceSteps={liveTraceSteps}
                      collapsedTraceByStepId={collapsedTraceByStepId}
                      onToggleTraceStep={toggleTraceStep}
                      live
                      status={liveAgentStatus || (isResponding ? "Working..." : "")}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="w-full px-4 pb-10 pt-10 sm:px-5">
                  <div className="mx-auto mb-6 max-w-[560px] text-center">
                    <div className="text-[22px] font-semibold tracking-[-0.02em] text-text-main/90">
                      {isLoadingBootstrap || isLoadingHistory ? "Loading workspace context" : "Ask the workspace agent"}
                    </div>
                    <div className="mt-3 text-[13px] leading-7 text-text-muted/68">
                      {selectedWorkspace
                        ? readinessMessage || "Messages are queued into the local runtime workspace flow, then streamed back from the live session output feed."
                        : "Pick a template, create a workspace, and then send the first instruction."}
                    </div>
                  </div>
                  <form onSubmit={onSubmit} className="mx-auto max-w-[760px]">
                    {readinessMessage ? <div className="mb-3 text-[12px] text-text-muted/82">{readinessMessage}</div> : null}
                    <Composer
                      input={input}
                      attachments={pendingAttachmentItems}
                      isResponding={isResponding}
                      disabled={composerDisabled}
                      disabledReason={composerDisabledReason}
                      selectedModel={effectiveChatModelPreference}
                      resolvedModelLabel={resolvedChatModel || modelSelectionUnavailableReason}
                      runtimeDefaultModelLabel={runtimeDefaultModel}
                      modelOptions={availableChatModelOptions}
                      runtimeDefaultModelAvailable={runtimeDefaultModelAvailable}
                      modelSelectionUnavailableReason={modelSelectionUnavailableReason}
                      onModelChange={setChatModelPreference}
                      textareaRef={textareaRef}
                      fileInputRef={fileInputRef}
                      onChange={setInput}
                      onKeyDown={onComposerKeyDown}
                      onAttachmentInputChange={onAttachmentInputChange}
                      onAddDroppedFiles={appendPendingLocalFiles}
                      onAddExplorerAttachments={appendPendingExplorerAttachments}
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
                {readinessMessage ? <div className="mb-3 text-[12px] text-text-muted/82">{readinessMessage}</div> : null}
                <Composer
                  input={input}
                  attachments={pendingAttachmentItems}
                  isResponding={isResponding}
                  disabled={composerDisabled}
                  disabledReason={composerDisabledReason}
                  selectedModel={effectiveChatModelPreference}
                  resolvedModelLabel={resolvedChatModel || modelSelectionUnavailableReason}
                  runtimeDefaultModelLabel={runtimeDefaultModel}
                  modelOptions={availableChatModelOptions}
                  runtimeDefaultModelAvailable={runtimeDefaultModelAvailable}
                  modelSelectionUnavailableReason={modelSelectionUnavailableReason}
                  onModelChange={setChatModelPreference}
                  textareaRef={textareaRef}
                  fileInputRef={fileInputRef}
                  onChange={setInput}
                  onKeyDown={onComposerKeyDown}
                  onAttachmentInputChange={onAttachmentInputChange}
                  onAddDroppedFiles={appendPendingLocalFiles}
                  onAddExplorerAttachments={appendPendingExplorerAttachments}
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
  runtimeDefaultModelLabel: string;
  modelOptions: Array<{ value: string; label: string }>;
  runtimeDefaultModelAvailable: boolean;
  modelSelectionUnavailableReason: string;
  onModelChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onAttachmentInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAddDroppedFiles: (files: File[]) => void;
  onAddExplorerAttachments: (files: ExplorerAttachmentDragPayload[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}

interface ThinkingPanelProps {
  text: string;
  collapsed: boolean;
  onToggle: () => void;
  live?: boolean;
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
  mode,
  text,
  thinkingText,
  thinkingCollapsed,
  onToggleThinking,
  traceSteps,
  collapsedTraceByStepId,
  onToggleTraceStep,
  status = "",
  live = false
}: {
  label: string;
  mode: string;
  text: string;
  thinkingText?: string;
  thinkingCollapsed: boolean;
  onToggleThinking: () => void;
  traceSteps: ChatTraceStep[];
  collapsedTraceByStepId: Record<string, boolean>;
  onToggleTraceStep: (stepId: string) => void;
  status?: string;
  live?: boolean;
}) {
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
              <div className="rounded-full border border-panel-border/35 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-text-dim/76">
                {mode}
              </div>
              {live ? (
                <div className="rounded-full border border-[rgba(247,90,84,0.18)] bg-[rgba(247,90,84,0.08)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[rgba(206,92,84,0.92)]">
                  Live
                </div>
              ) : null}
            </div>

            {status && !text ? (
              <div className="mt-2 text-[13px] leading-7 text-text-muted/78">{status}</div>
            ) : null}

            {traceSteps.length > 0 ? (
              <div className="mt-4 grid gap-2.5 border-l border-panel-border/25 pl-4">
                {traceSteps.map((step) => (
                  <TraceStepCard
                    key={step.id}
                    step={step}
                    collapsed={isTraceStepCollapsed(step, collapsedTraceByStepId)}
                    onToggle={() => onToggleTraceStep(step.id)}
                  />
                ))}
              </div>
            ) : null}

            {thinkingText ? (
              <ThinkingPanel text={thinkingText} collapsed={thinkingCollapsed} onToggle={onToggleThinking} live={live} />
            ) : null}

            {text ? <div className="mt-4 whitespace-pre-wrap text-[15px] leading-8 text-text-main/92">{text}</div> : null}
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

function summarizeThinking(text: string) {
  const firstContentLine =
    text
      .split("\n")
      .map((line) => line.replace(/[*_`#>-]/g, "").trim())
      .find(Boolean) || "Reasoning available";

  return firstContentLine.length > 88 ? `${firstContentLine.slice(0, 85).trimEnd()}...` : firstContentLine;
}

function ThinkingPanel({ text, collapsed, onToggle, live = false }: ThinkingPanelProps) {
  const summary = summarizeThinking(text);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="theme-subtle-surface flex w-full items-center justify-between gap-3 rounded-[18px] border border-panel-border/35 px-3.5 py-3 text-left transition hover:border-panel-border/55"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-dim/72">{live ? "Thinking" : "Reasoning"}</span>
            {live ? (
              <span className="rounded-full border border-[rgba(247,90,84,0.18)] bg-[rgba(247,90,84,0.08)] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[rgba(206,92,84,0.92)]">
                LIVE
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-[12px] text-text-muted/76">{collapsed ? summary : "Expanded reasoning trace"}</div>
        </div>
        <ChevronDown size={14} className={`shrink-0 text-text-muted/72 transition ${collapsed ? "" : "rotate-180"}`} />
      </button>
      {!collapsed ? (
        <div className="theme-chat-thinking-inner mt-2 whitespace-pre-wrap rounded-[18px] border border-panel-border/30 px-4 py-3 text-[12px] leading-6 text-text-muted/86">
          {text}
        </div>
      ) : null}
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
  runtimeDefaultModelLabel,
  modelOptions,
  runtimeDefaultModelAvailable,
  modelSelectionUnavailableReason,
  onModelChange,
  textareaRef,
  fileInputRef,
  onChange,
  onKeyDown,
  onAttachmentInputChange,
  onAddDroppedFiles,
  onAddExplorerAttachments,
  onRemoveAttachment
}: ComposerProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const noAvailableModels = !runtimeDefaultModelAvailable && modelOptions.length === 0;

  const allowAttachmentDrop = (dataTransfer: DataTransfer | null) => {
    if (!dataTransfer || disabled || isResponding) {
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
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!allowAttachmentDrop(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragActive(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!allowAttachmentDrop(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    setIsDragActive(false);

    const explorerFiles: ExplorerAttachmentDragPayload[] = [];
    const rawExplorerPayload = event.dataTransfer.getData(EXPLORER_ATTACHMENT_DRAG_TYPE);
    const parsedExplorerPayload = parseExplorerAttachmentDragPayload(rawExplorerPayload);
    if (parsedExplorerPayload) {
      explorerFiles.push(parsedExplorerPayload);
    }

    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (explorerFiles.length > 0) {
      onAddExplorerAttachments(explorerFiles);
    }
    if (droppedFiles.length > 0) {
      onAddDroppedFiles(droppedFiles);
    }
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`glass-field overflow-hidden rounded-[calc(var(--theme-radius-card)+0.15rem)] border transition ${
        isDragActive ? "border-neon-green/45 bg-neon-green/[0.04]" : "border-panel-border/35"
      }`}
    >
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
          placeholder={disabled ? disabledReason || "Chat unavailable right now" : "Ask anything"}
          className="composer-input block max-h-[220px] min-h-[76px] w-full resize-none overflow-y-auto bg-transparent text-[14px] leading-7 text-text-main/92 outline-none placeholder:text-text-muted/42 disabled:cursor-not-allowed disabled:opacity-55"
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-panel-border/20 px-3 py-3 text-text-muted/72">
        <div className="relative w-[172px] shrink-0 sm:w-[208px]">
            <select
              value={selectedModel}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={isResponding || noAvailableModels}
              aria-label="Model selection"
              title={
                noAvailableModels
                  ? modelSelectionUnavailableReason
                  : selectedModel === CHAT_MODEL_USE_RUNTIME_DEFAULT
                    ? `Auto (${runtimeDefaultModelLabel})`
                    : resolvedModelLabel
              }
              className="composer-select theme-subtle-surface h-9 w-full appearance-none rounded-[11px] border border-panel-border/28 px-3 pr-9 text-[12px] font-medium text-text-main/90 transition hover:border-panel-border/48 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {noAvailableModels ? (
                <option value={CHAT_MODEL_USE_RUNTIME_DEFAULT}>{modelSelectionUnavailableReason}</option>
              ) : (
                <>
                  {runtimeDefaultModelAvailable ? <option value={CHAT_MODEL_USE_RUNTIME_DEFAULT}>Auto</option> : null}
                  {modelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </>
              )}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-dim/70"
            />
        </div>

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
