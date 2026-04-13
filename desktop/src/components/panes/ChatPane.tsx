import {
  type ChangeEvent,
  type CompositionEvent,
  type DragEvent,
  FormEvent,
  KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  Cable,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  FileText,
  Image as ImageIcon,
  Inbox,
  Lightbulb,
  Loader2,
  Paperclip,
  PencilLine,
  Plus,
  Search,
  Square,
  Waypoints,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaneCard } from "@/components/ui/PaneCard";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SimpleMarkdown } from "@/components/marketplace/SimpleMarkdown";
import {
  EXPLORER_ATTACHMENT_DRAG_TYPE,
  type ExplorerAttachmentDragPayload,
  inferDraggedAttachmentKind,
  parseExplorerAttachmentDragPayload,
} from "@/lib/attachmentDrag";
import {
  DEFAULT_RUNTIME_MODEL,
  useDesktopAuthSession,
} from "@/lib/auth/authClient";
import { useDesktopBilling } from "@/lib/billing/useDesktopBilling";
import { preferredSessionId } from "@/lib/sessionRouting";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

type ChatAttachment = SessionInputAttachmentPayload;
type ChatPaneVariant = "default" | "onboarding";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
  attachments?: ChatAttachment[];
  thinkingText?: string;
  traceSteps?: ChatTraceStep[];
  outputs?: WorkspaceOutputRecordPayload[];
  memoryProposals?: MemoryUpdateProposalRecordPayload[];
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

type ChatTodoStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "completed"
  | "abandoned";

interface ChatTodoTask {
  id: string;
  content: string;
  status: ChatTodoStatus;
  notes?: string;
  details?: string;
}

interface ChatTodoPhase {
  id: string;
  name: string;
  tasks: ChatTodoTask[];
}

interface ChatTodoPlan {
  sessionId: string;
  updatedAt: string | null;
  phases: ChatTodoPhase[];
}

interface ChatScrollbarDragState {
  pointerId: number;
  thumbPointerOffset: number;
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

type PendingAttachment =
  | PendingLocalAttachmentFile
  | PendingExplorerAttachmentFile;

interface ChatModelOption {
  value: string;
  label: string;
  selectedLabel?: string;
  searchText?: string;
  disabled?: boolean;
  statusLabel?: string;
}

interface ChatModelOptionGroup {
  label: string;
  options: ChatModelOption[];
}

interface ChatSessionOption {
  sessionId: string;
  title: string;
  statusLabel: string;
  updatedAt: string;
  updatedLabel: string;
  searchText: string;
}

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

type ArtifactBrowserFilter =
  | "all"
  | "documents"
  | "images"
  | "code"
  | "links"
  | "apps";

const STREAM_ATTACH_PENDING = "__stream_attach_pending__";
const STREAM_TELEMETRY_LIMIT = 240;
const TOOL_TRACE_TERMINAL_PHASES = new Set(["completed", "failed", "error"]);
const CHAT_AUTO_SCROLL_THRESHOLD_PX = 72;
const CHAT_SCROLLBAR_MIN_THUMB_HEIGHT_PX = 40;
const CHAT_MODEL_STORAGE_KEY = "holaboss-chat-model-v1";
const CHAT_MODEL_USE_RUNTIME_DEFAULT = "__runtime_default__";
const LEGACY_UNAVAILABLE_CHAT_MODELS = new Set(["openai/gpt-5.2-mini"]);
const DEPRECATED_CHAT_MODELS = new Set([
  "openai/gpt-5.1",
  "openai/gpt-5.1-codex",
  "openai/gpt-5.1-codex-mini",
  "openai/gpt-5.1-codex-max",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex-max",
]);
const CHAT_MODEL_PRESETS = [
  "openai/gpt-5.1",
  "openai/gpt-5",
  "openai/gpt-5.2",
] as const;
const RUNTIME_MODEL_CAPABILITY_ALIASES: Record<string, string> = {
  chat: "chat",
  text: "chat",
  completion: "chat",
  completions: "chat",
  responses: "chat",
  image: "image_generation",
  images: "image_generation",
  image_generation: "image_generation",
  image_gen: "image_generation",
};

function sessionUserId(
  session: { user?: { id?: string | null } | null } | null | undefined,
): string {
  return session?.user?.id?.trim() || "";
}

function isHolabossProxyModel(model: string) {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("openai/") ||
    normalized.startsWith("google/") ||
    normalized.startsWith("anthropic/") ||
    normalized.startsWith("gpt-") ||
    normalized.startsWith("claude-") ||
    normalized.startsWith("gemini-")
  );
}

function isClaudeChatModel(model: string) {
  const normalized = model.trim().toLowerCase();
  return /^((openai|anthropic|holaboss|holaboss_model_proxy)\/)*claude-/.test(
    normalized,
  );
}

function isHolabossProviderId(providerId: string) {
  const normalized = providerId.trim().toLowerCase();
  return (
    normalized === "holaboss_model_proxy" ||
    normalized === "holaboss" ||
    normalized.includes("holaboss")
  );
}

function isUnsupportedHolabossProxyModel(providerId: string, model: string) {
  return isHolabossProviderId(providerId) && isClaudeChatModel(model);
}

function isDeprecatedChatModel(model: string) {
  return DEPRECATED_CHAT_MODELS.has(model.trim().toLowerCase());
}

function normalizeRuntimeModelCapability(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!normalized) {
    return "";
  }
  return RUNTIME_MODEL_CAPABILITY_ALIASES[normalized] ?? normalized;
}

function runtimeModelCapabilities(model: RuntimeProviderModelPayload) {
  if (!Array.isArray(model.capabilities)) {
    return [];
  }
  const seen = new Set<string>();
  const capabilities: string[] = [];
  for (const value of model.capabilities) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = normalizeRuntimeModelCapability(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    capabilities.push(normalized);
  }
  return capabilities;
}

function runtimeModelHasChatCapability(model: RuntimeProviderModelPayload) {
  const capabilities = runtimeModelCapabilities(model);
  return capabilities.length === 0 || capabilities.includes("chat");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function openExternalUrl(url: string | null | undefined) {
  const normalizedUrl = (url ?? "").trim();
  if (!normalizedUrl) {
    return;
  }
  void window.electronAPI.ui.openExternalUrl(normalizedUrl);
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
    return normalizeStoredChatModelPreference(
      localStorage.getItem(CHAT_MODEL_STORAGE_KEY),
    );
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
  const sonnetModelMatch = withoutProvider.match(
    /^claude-sonnet-(\d+)-(\d+)$/i,
  );
  if (sonnetModelMatch) {
    return `Claude Sonnet ${sonnetModelMatch[1]}.${sonnetModelMatch[2]}`;
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
    .map((part) =>
      /^\d+(\.\d+)?$/.test(part)
        ? part
        : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`,
    )
    .join(" ");
}

function normalizeChatAttachment(value: unknown): ChatAttachment | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const mimeType =
    typeof value.mime_type === "string" ? value.mime_type.trim() : "";
  const workspacePath =
    typeof value.workspace_path === "string" ? value.workspace_path.trim() : "";
  const sizeBytes =
    typeof value.size_bytes === "number" && Number.isFinite(value.size_bytes)
      ? value.size_bytes
      : 0;
  const kind =
    value.kind === "image"
      ? "image"
      : value.kind === "file"
        ? "file"
        : mimeType.startsWith("image/")
          ? "image"
          : "file";

  if (!id || !name || !mimeType || !workspacePath) {
    return null;
  }

  return {
    id,
    kind,
    name,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    workspace_path: workspacePath,
  };
}

function attachmentsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): ChatAttachment[] {
  const raw = metadata?.attachments;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => normalizeChatAttachment(item))
    .filter((item): item is ChatAttachment => Boolean(item));
}

function hasRenderableMessageContent(
  text: string,
  attachments: ChatAttachment[],
) {
  return Boolean(text.trim()) || attachments.length > 0;
}

function hasRenderableAssistantTurn(message: ChatMessage) {
  return (
    hasRenderableMessageContent(message.text, message.attachments ?? []) ||
    Boolean(message.thinkingText) ||
    (message.traceSteps?.length ?? 0) > 0 ||
    (message.outputs?.length ?? 0) > 0 ||
    (message.memoryProposals?.length ?? 0) > 0
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

function outputMetadataString(
  output: WorkspaceOutputRecordPayload,
  key: string,
) {
  const value = output.metadata[key];
  return typeof value === "string" ? value.trim() : "";
}

function outputMetadataNumber(
  output: WorkspaceOutputRecordPayload,
  key: string,
) {
  const value = output.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function outputBrowserFilterForOutput(
  output: WorkspaceOutputRecordPayload,
): ArtifactBrowserFilter {
  if (
    outputMetadataString(output, "origin_type") === "app" ||
    output.module_id
  ) {
    return "apps";
  }
  const category = outputMetadataString(output, "category");
  if (category === "image") {
    return "images";
  }
  if (category === "code") {
    return "code";
  }
  if (category === "link") {
    return "links";
  }
  return "documents";
}

function outputKindLabel(output: WorkspaceOutputRecordPayload) {
  if (
    outputMetadataString(output, "origin_type") === "app" ||
    output.module_id
  ) {
    const artifactType = outputMetadataString(output, "artifact_type");
    if (artifactType) {
      return artifactType.charAt(0).toUpperCase() + artifactType.slice(1);
    }
    return "Artifact";
  }
  const category = outputMetadataString(output, "category");
  if (category === "image") {
    return "Image";
  }
  if (category === "code") {
    return "Code file";
  }
  if (category === "link") {
    return "Link";
  }
  if (category === "spreadsheet") {
    return "Spreadsheet";
  }
  if (category === "document") {
    return "Document";
  }
  return output.output_type === "document" ? "Document" : "File";
}

function outputChangeLabel(output: WorkspaceOutputRecordPayload) {
  const changeType = outputMetadataString(output, "change_type");
  if (changeType === "created") {
    return "Created";
  }
  if (changeType === "modified") {
    return "Updated";
  }
  return "";
}

function outputSecondaryLabel(output: WorkspaceOutputRecordPayload) {
  const parts = [outputKindLabel(output)];
  const sizeLabel = formatAttachmentSize(
    outputMetadataNumber(output, "size_bytes") ?? 0,
  );
  if (sizeLabel) {
    parts.push(sizeLabel);
  }
  const timeLabel = chatMessageTimeLabel(output.created_at);
  if (timeLabel) {
    parts.push(timeLabel);
  }
  return parts.join(" · ");
}

function sortOutputs(outputs: WorkspaceOutputRecordPayload[]) {
  return [...outputs].sort((left, right) => {
    const leftTime = Date.parse(left.created_at || "") || 0;
    const rightTime = Date.parse(right.created_at || "") || 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.title.localeCompare(right.title);
  });
}

function sortOutputsLatestFirst(outputs: WorkspaceOutputRecordPayload[]) {
  return [...outputs].sort((left, right) => {
    const leftTime = Date.parse(left.created_at || "") || 0;
    const rightTime = Date.parse(right.created_at || "") || 0;
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return left.title.localeCompare(right.title);
  });
}

function sortMemoryUpdateProposals(
  proposals: MemoryUpdateProposalRecordPayload[],
) {
  return [...proposals].sort((left, right) => {
    const leftTime = Date.parse(left.created_at || "") || 0;
    const rightTime = Date.parse(right.created_at || "") || 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.title.localeCompare(right.title);
  });
}

function attachmentButtonLabel(attachment: {
  name: string;
  size_bytes: number;
}) {
  const sizeLabel = formatAttachmentSize(attachment.size_bytes);
  return sizeLabel ? `${attachment.name} (${sizeLabel})` : attachment.name;
}

function attachmentUploadPayload(
  file: File,
): Promise<StageSessionAttachmentFilePayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      resolve({
        name: file.name,
        mime_type: file.type || null,
        content_base64: separator >= 0 ? result.slice(separator + 1) : result,
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

function normalizeSessionTurnStatus(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function defaultWorkspaceSessionTitle(
  kind: string | null | undefined,
  sessionId: string,
): string {
  const normalizedKind = (kind || "").trim().toLowerCase();
  if (normalizedKind === "cronjob") {
    return "Cronjob run";
  }
  if (normalizedKind === "task_proposal") {
    return "Task proposal run";
  }
  return `Session ${sessionId.slice(0, 8)}`;
}

function chatSessionStatusLabel(
  runtimeState:
    | Pick<SessionRuntimeRecordPayload, "status" | "last_turn_status">
    | null
    | undefined,
): string {
  const status = runtimeStateStatus(runtimeState?.status);
  if (status === "BUSY") {
    return "Running";
  }
  if (status === "QUEUED") {
    return "Queued";
  }
  if (status === "WAITING_USER") {
    return "Waiting";
  }
  if (status === "PAUSED") {
    return "Paused";
  }
  if (status === "ERROR") {
    return "Error";
  }

  const turnStatus = normalizeSessionTurnStatus(runtimeState?.last_turn_status);
  if (turnStatus === "completed") {
    return "Completed";
  }
  if (turnStatus === "waiting_user") {
    return "Waiting";
  }
  if (turnStatus === "error" || turnStatus === "failed") {
    return "Error";
  }
  return "Idle";
}

function formatSessionUpdatedLabel(value: string | null | undefined): string {
  if (!value) {
    return "Updated recently";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "Updated recently";
  }
  return timestamp.toLocaleString();
}

function compareChatSessionOptions(
  left: ChatSessionOption,
  right: ChatSessionOption,
): number {
  const leftUpdatedAt = Date.parse(left.updatedAt);
  const rightUpdatedAt = Date.parse(right.updatedAt);
  if (!Number.isNaN(leftUpdatedAt) || !Number.isNaN(rightUpdatedAt)) {
    const normalizedLeft = Number.isNaN(leftUpdatedAt) ? 0 : leftUpdatedAt;
    const normalizedRight = Number.isNaN(rightUpdatedAt) ? 0 : rightUpdatedAt;
    if (normalizedLeft !== normalizedRight) {
      return normalizedRight - normalizedLeft;
    }
  }
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.title.localeCompare(right.title)
  );
}

function sessionStatusIndicator(statusLabel: string) {
  const normalized = statusLabel.trim().toLowerCase();
  if (normalized === "running") {
    return {
      className: "text-primary",
      icon: <Loader2 size={12} className="animate-spin" />,
    };
  }
  if (normalized === "queued") {
    return {
      className: "text-sky-600",
      icon: <Clock3 size={12} />,
    };
  }
  if (normalized === "waiting") {
    return {
      className: "text-amber-600",
      icon: <Clock3 size={12} />,
    };
  }
  if (normalized === "paused") {
    return {
      className: "text-orange-600",
      icon: <Square size={9} className="fill-current" />,
    };
  }
  if (normalized === "error") {
    return {
      className: "text-destructive",
      icon: <AlertTriangle size={12} />,
    };
  }
  if (normalized === "completed") {
    return {
      className: "text-emerald-600",
      icon: <Check size={12} />,
    };
  }
  return {
    className: "text-muted-foreground",
    icon: <Clock3 size={12} />,
  };
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
    return "border-primary/30 bg-primary/10 text-primary";
  }
  if (normalized === "completed") {
    return "border-[rgba(92,180,120,0.22)] bg-[rgba(92,180,120,0.08)] text-[rgba(118,196,144,0.94)]";
  }
  return "border-[rgba(247,90,84,0.22)] bg-[rgba(247,90,84,0.08)] text-[rgba(206,92,84,0.94)]";
}

function startCase(value: string) {
  const normalized = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
}

function summarizeUnknown(value: unknown, maxLength = 140): string {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > maxLength
      ? `${normalized.slice(0, maxLength - 3).trimEnd()}...`
      : normalized;
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
      .map(
        ([key, entryValue]) =>
          `${startCase(key)}: ${summarizeUnknown(entryValue, 36)}`,
      )
      .join(" | ");
    return Object.keys(value).length > 4 ? `${rendered} | ...` : rendered;
  }
  if (value == null) {
    return "";
  }
  return String(value);
}

function normalizeChatTodoStatus(value: unknown): ChatTodoStatus | null {
  const normalized =
    typeof value === "string"
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
      : "";
  switch (normalized) {
    case "pending":
    case "in_progress":
    case "blocked":
    case "completed":
    case "abandoned":
      return normalized;
    default:
      return null;
  }
}

function normalizeChatTodoTask(value: unknown): ChatTodoTask | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const content = typeof value.content === "string" ? value.content.trim() : "";
  const status = normalizeChatTodoStatus(value.status);
  if (!id || !content || !status) {
    return null;
  }
  const notes = typeof value.notes === "string" ? value.notes.trim() : "";
  const details = typeof value.details === "string" ? value.details.trim() : "";
  return {
    id,
    content,
    status,
    ...(notes ? { notes } : {}),
    ...(details ? { details } : {}),
  };
}

function normalizeChatTodoPhase(value: unknown): ChatTodoPhase | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const tasks = Array.isArray(value.tasks)
    ? value.tasks
        .map((task) => normalizeChatTodoTask(task))
        .filter((task): task is ChatTodoTask => Boolean(task))
    : [];
  if (!id || !name) {
    return null;
  }
  return { id, name, tasks };
}

function todoTaskCount(phases: ChatTodoPhase[]) {
  return phases.reduce((total, phase) => total + phase.tasks.length, 0);
}

function todoRemainingTaskCount(phases: ChatTodoPhase[]) {
  return phases.reduce(
    (total, phase) =>
      total +
      phase.tasks.filter(
        (task) =>
          task.status === "pending" ||
          task.status === "in_progress" ||
          task.status === "blocked",
      ).length,
    0,
  );
}

function currentTodoEntry(phases: ChatTodoPhase[]) {
  for (const phase of phases) {
    const inProgressTask = phase.tasks.find(
      (task) => task.status === "in_progress",
    );
    if (inProgressTask) {
      return { phase, task: inProgressTask };
    }
  }
  for (const phase of phases) {
    const blockedTask = phase.tasks.find((task) => task.status === "blocked");
    if (blockedTask) {
      return { phase, task: blockedTask };
    }
  }
  for (const phase of phases) {
    const pendingTask = phase.tasks.find((task) => task.status === "pending");
    if (pendingTask) {
      return { phase, task: pendingTask };
    }
  }
  return null;
}

function currentTodoPosition(phases: ChatTodoPhase[]) {
  let position = 0;

  for (const phase of phases) {
    for (const task of phase.tasks) {
      position += 1;
      if (
        task.status === "in_progress" ||
        task.status === "blocked" ||
        task.status === "pending"
      ) {
        return position;
      }
    }
  }

  return position;
}

function latestCompletedTodoEntry(phases: ChatTodoPhase[]) {
  for (let phaseIndex = phases.length - 1; phaseIndex >= 0; phaseIndex -= 1) {
    const phase = phases[phaseIndex];
    for (
      let taskIndex = phase.tasks.length - 1;
      taskIndex >= 0;
      taskIndex -= 1
    ) {
      const task = phase.tasks[taskIndex];
      if (task.status === "completed") {
        return { phase, task };
      }
    }
  }

  for (let phaseIndex = phases.length - 1; phaseIndex >= 0; phaseIndex -= 1) {
    const phase = phases[phaseIndex];
    for (
      let taskIndex = phase.tasks.length - 1;
      taskIndex >= 0;
      taskIndex -= 1
    ) {
      const task = phase.tasks[taskIndex];
      if (task.status === "abandoned") {
        return { phase, task };
      }
    }
  }

  return null;
}

function phaseHasRemainingTodoTasks(phase: ChatTodoPhase) {
  return phase.tasks.some(
    (task) =>
      task.status === "pending" ||
      task.status === "in_progress" ||
      task.status === "blocked",
  );
}

function visibleTodoPhases(phases: ChatTodoPhase[]) {
  const activePhases = phases.filter((phase) => phaseHasRemainingTodoTasks(phase));
  if (activePhases.length > 0) {
    return activePhases;
  }

  const latestCompletedEntry = latestCompletedTodoEntry(phases);
  if (!latestCompletedEntry) {
    return phases;
  }

  const latestCompletedPhaseIndex = phases.findIndex(
    (phase) => phase.id === latestCompletedEntry.phase.id,
  );
  return latestCompletedPhaseIndex < 0
    ? phases
    : phases.slice(latestCompletedPhaseIndex, latestCompletedPhaseIndex + 1);
}

function todoPlanFromToolResult(
  result: unknown,
): ChatTodoPlan | null | undefined {
  if (!isRecord(result)) {
    return undefined;
  }
  const details = isRecord(result.details) ? result.details : null;
  if (!details || !Array.isArray(details.phases)) {
    return undefined;
  }

  const sessionId =
    typeof details.session_id === "string" ? details.session_id.trim() : "";
  const updatedAt =
    typeof details.updated_at === "string" && details.updated_at.trim()
      ? details.updated_at.trim()
      : null;
  const phases = details.phases
    .map((phase) => normalizeChatTodoPhase(phase))
    .filter((phase): phase is ChatTodoPhase => Boolean(phase));

  return todoTaskCount(phases) > 0
    ? {
        sessionId,
        updatedAt,
        phases,
      }
    : null;
}

function todoPlanFromToolPayload(
  payload: Record<string, unknown>,
): ChatTodoPlan | null | undefined {
  const toolName =
    typeof payload.tool_name === "string"
      ? payload.tool_name.trim().toLowerCase()
      : "";
  const phase =
    typeof payload.phase === "string" ? payload.phase.trim().toLowerCase() : "";
  if (
    (toolName !== "todoread" && toolName !== "todowrite") ||
    phase !== "completed" ||
    payload.error === true
  ) {
    return undefined;
  }
  return todoPlanFromToolResult(payload.result);
}

function todoPlanFromOutputEvents(outputEvents: SessionOutputEventPayload[]) {
  const orderedEvents = [...outputEvents].sort(
    (left, right) =>
      Date.parse(left.created_at || "") - Date.parse(right.created_at || "") ||
      left.id - right.id,
  );
  let latestTodoPlan: ChatTodoPlan | null = null;

  for (const event of orderedEvents) {
    if (event.event_type !== "tool_call" || !isRecord(event.payload)) {
      continue;
    }
    const nextTodoPlan = todoPlanFromToolPayload(event.payload);
    if (nextTodoPlan !== undefined) {
      latestTodoPlan = nextTodoPlan;
    }
  }

  return latestTodoPlan;
}

function todoStatusLabel(status: ChatTodoStatus) {
  switch (status) {
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Blocked";
    case "completed":
      return "Completed";
    case "abandoned":
      return "Abandoned";
    default:
      return "Pending";
  }
}

function todoStatusTone(status: ChatTodoStatus) {
  switch (status) {
    case "in_progress":
      return "text-primary";
    case "blocked":
      return "text-amber-700";
    case "completed":
      return "text-emerald-600";
    case "abandoned":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function TodoStatusIcon({ status }: { status: ChatTodoStatus }) {
  const label = todoStatusLabel(status);
  const icon =
    status === "in_progress" ? (
      <Loader2 size={12} className="animate-spin" />
    ) : status === "blocked" ? (
      <AlertTriangle size={12} />
    ) : status === "completed" ? (
      <Check size={12} />
    ) : status === "abandoned" ? (
      <X size={12} />
    ) : (
      <Clock3 size={12} />
    );

  return (
    <span
      aria-label={label}
      title={label}
      className={`inline-flex size-5 shrink-0 items-center justify-center ${todoStatusTone(
        status,
      )}`}
    >
      {icon}
    </span>
  );
}

function runFailedContextLabel(payload: Record<string, unknown>): string {
  const provider =
    typeof payload.provider === "string" ? payload.provider.trim() : "";
  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  if (provider && model) {
    return `${provider}/${model}`;
  }
  return provider || model;
}

function runFailedDetail(payload: Record<string, unknown>): string {
  const detail =
    typeof payload.error === "string"
      ? payload.error.trim()
      : typeof payload.message === "string"
        ? payload.message.trim()
        : "";
  const contextLabel = runFailedContextLabel(payload);
  if (!contextLabel) {
    return detail || "The run failed.";
  }
  if (!detail) {
    return `${contextLabel} failed.`;
  }
  return detail.startsWith(contextLabel)
    ? detail
    : `${contextLabel}: ${detail}`;
}

function assistantMetaLabel(
  harness: string | null | undefined,
  model: string | null | undefined,
) {
  const harnessLabel = harness ? startCase(harness) : "";
  if (harnessLabel) {
    return harnessLabel;
  }

  const modelLabel = (model || "").trim();
  return modelLabel || "Local runtime";
}

function toolTraceStepId(payload: Record<string, unknown>) {
  const callId =
    typeof payload.call_id === "string" ? payload.call_id.trim() : "";
  const toolId =
    typeof payload.tool_id === "string" ? payload.tool_id.trim() : "";
  const toolName =
    typeof payload.tool_name === "string" ? payload.tool_name.trim() : "";
  return callId || toolId || toolName
    ? `tool:${callId || toolId || toolName}`
    : "";
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
    if (
      isRecord(part) &&
      part.type === "text" &&
      typeof part.text === "string"
    ) {
      const text = part.text.trim();
      if (text) {
        return text.length > 200 ? `${text.slice(0, 197).trimEnd()}...` : text;
      }
    }
  }
  return "";
}

function extractToolResultText(result: unknown, maxLength = 200): string {
  if (!isRecord(result)) {
    return "";
  }
  const content = Array.isArray(result.content) ? result.content : [];
  for (const part of content) {
    if (
      isRecord(part) &&
      part.type === "text" &&
      typeof part.text === "string"
    ) {
      const text = part.text.trim();
      if (text) {
        return summarizeUnknown(text, maxLength);
      }
    }
  }
  return "";
}

function extractToolErrorText(payload: Record<string, unknown>): string {
  const mcpErrorText = extractMcpErrorText(payload.result);
  if (mcpErrorText) {
    return mcpErrorText;
  }

  const resultText = extractToolResultText(payload.result);
  if (resultText) {
    return resultText;
  }

  if (typeof payload.error === "string") {
    const text = payload.error.trim();
    if (text) {
      return summarizeUnknown(text, 200);
    }
  }

  const resultSummary = summarizeUnknown(payload.result, 200);
  if (resultSummary && resultSummary !== "true" && resultSummary !== "false") {
    return resultSummary;
  }

  return "";
}

function isIntegrationError(
  text: string,
): { provider: string; action: string } | null {
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
      return {
        provider: resolved,
        action: `Connect ${resolved} in the Integrations tab`,
      };
    }
  }
  return null;
}

function toolTraceStepFromPayload(
  payload: Record<string, unknown>,
  order: number,
): ChatTraceStep | null {
  const stepId = toolTraceStepId(payload);
  const toolName =
    typeof payload.tool_name === "string" ? payload.tool_name.trim() : "";
  const toolId =
    typeof payload.tool_id === "string" ? payload.tool_id.trim() : "";
  const phase =
    typeof payload.phase === "string" ? payload.phase.trim().toLowerCase() : "";
  const label = startCase(toolName || toolId);
  if (!stepId || !label) {
    return null;
  }

  const isError = payload.error === true || phase === "error";
  const details: string[] = [];
  const argsSummary = summarizeUnknown(payload.tool_args);
  const resultSummary = summarizeUnknown(payload.result);
  const errorSummary = summarizeUnknown(payload.error);
  const toolErrorText = extractToolErrorText(payload);

  if (phase === "started") {
    if (argsSummary) {
      details.push(argsSummary);
    }
  } else if (TOOL_TRACE_TERMINAL_PHASES.has(phase)) {
    if (isError && toolErrorText) {
      details.push(toolErrorText);
    } else if (isError) {
      if (errorSummary && errorSummary !== "true" && errorSummary !== "false") {
        details.push(errorSummary);
      } else {
        details.push("Error");
      }
    } else if (argsSummary) {
      details.push(argsSummary);
    }
    if (!isError && resultSummary) {
      details.push(resultSummary);
    }
  } else if (argsSummary) {
    details.push(argsSummary);
  }

  return {
    id: stepId,
    kind: "tool",
    title: label,
    status: isError
      ? "error"
      : TOOL_TRACE_TERMINAL_PHASES.has(phase)
        ? "completed"
        : "running",
    details,
    order,
  };
}

function toolTraceStepFromEvent(
  eventType: string,
  payload: Record<string, unknown>,
  order: number,
): ChatTraceStep | null {
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
              : eventType === "tool_call_started" ||
                  eventType === "tool_started"
                ? "started"
                : payload.phase,
        },
    order,
  );
}

function phaseTraceStepFromEvent(
  eventType: string,
  payload: Record<string, unknown>,
  order: number,
): ChatTraceStep | null {
  const phase = typeof payload.phase === "string" ? payload.phase.trim() : "";
  const instructionPreview =
    typeof payload.instruction_preview === "string"
      ? payload.instruction_preview.trim()
      : "";
  const details: string[] = [];

  if (eventType === "auto_compaction_start") {
    const reason =
      typeof payload.reason === "string" ? payload.reason.trim() : "";
    if (reason) {
      details.push(`Reason: ${reason}`);
    }
    return {
      id: "phase:auto-compaction",
      kind: "phase",
      title: "Compacting context",
      status: "running",
      details:
        details.length > 0
          ? details
          : ["The agent is compacting older context to continue the run."],
      order,
    };
  }

  if (eventType === "auto_compaction_end") {
    const result = isRecord(payload.result) ? payload.result : null;
    const summary =
      result && typeof result.summary === "string" ? result.summary.trim() : "";
    const tokensBefore =
      result && typeof result.tokensBefore === "number"
        ? result.tokensBefore
        : null;
    const errorMessage =
      typeof payload.error_message === "string"
        ? payload.error_message.trim()
        : "";
    const aborted = payload.aborted === true;
    const willRetry = payload.will_retry === true;
    if (summary) {
      details.push(`Summary: ${summarizeUnknown(summary, 160)}`);
    }
    if (tokensBefore !== null) {
      details.push(`Tokens before compaction: ${tokensBefore}`);
    }
    if (aborted) {
      details.push("Compaction was aborted.");
    } else {
      details.push("Compaction completed.");
    }
    if (willRetry) {
      details.push("The agent will retry after compaction.");
    }
    if (errorMessage) {
      details.push(`Error: ${summarizeUnknown(errorMessage, 120)}`);
    }
    return {
      id: "phase:auto-compaction",
      kind: "phase",
      title: aborted ? "Context compaction interrupted" : "Context compacted",
      status: aborted || errorMessage ? "error" : "completed",
      details,
      order,
    };
  }

  if (eventType === "compaction_start") {
    const source =
      typeof payload.source === "string" ? payload.source.trim() : "";
    if (source) {
      details.push(`Source: ${source}`);
    }
    return {
      id: "phase:post-turn-compaction",
      kind: "phase",
      title: "Finalizing run context",
      status: "running",
      details:
        details.length > 0
          ? details
          : ["Persisting post-turn continuity and memory artifacts."],
      order,
    };
  }

  if (eventType === "compaction_boundary_written") {
    const boundaryId =
      typeof payload.boundary_id === "string" ? payload.boundary_id.trim() : "";
    const boundaryType =
      typeof payload.boundary_type === "string"
        ? payload.boundary_type.trim()
        : "";
    const restoredMemoryPathCount =
      typeof payload.restored_memory_path_count === "number"
        ? payload.restored_memory_path_count
        : null;
    if (boundaryId) {
      details.push(`Boundary: ${boundaryId}`);
    }
    if (boundaryType) {
      details.push(`Boundary type: ${boundaryType}`);
    }
    if (restoredMemoryPathCount !== null) {
      details.push(`Restored memory paths: ${restoredMemoryPathCount}`);
    }
    return {
      id: "phase:post-turn-compaction",
      kind: "phase",
      title: "Compaction boundary saved",
      status: "running",
      details: details.length > 0 ? details : ["Compaction boundary written."],
      order,
    };
  }

  if (eventType === "compaction_end") {
    const status =
      typeof payload.status === "string"
        ? payload.status.trim().toLowerCase()
        : "";
    const durationMs =
      typeof payload.duration_ms === "number" ? payload.duration_ms : null;
    const boundaryId =
      typeof payload.boundary_id === "string" ? payload.boundary_id.trim() : "";
    const errorMessage =
      typeof payload.error_message === "string"
        ? payload.error_message.trim()
        : "";
    if (boundaryId) {
      details.push(`Boundary: ${boundaryId}`);
    }
    if (durationMs !== null) {
      details.push(`Duration: ${durationMs} ms`);
    }
    if (errorMessage) {
      details.push(`Error: ${summarizeUnknown(errorMessage, 120)}`);
    }
    return {
      id: "phase:post-turn-compaction",
      kind: "phase",
      title:
        status === "failed" ? "Compaction failed" : "Run context finalized",
      status: status === "failed" ? "error" : "completed",
      details,
      order,
    };
  }

  if (eventType === "run_waiting_user" || eventType === "awaiting_user_input") {
    return {
      id: "phase:awaiting-user",
      kind: "phase",
      title: "Waiting for your input",
      status: "waiting",
      details: ["The agent needs a follow-up answer before it can continue."],
      order,
    };
  }

  if (eventType === "run_completed") {
    const status =
      typeof payload.status === "string"
        ? payload.status.trim().toLowerCase()
        : "";
    if (status === "waiting_user") {
      return {
        id: "phase:awaiting-user",
        kind: "phase",
        title: "Waiting for your input",
        status: "waiting",
        details: ["The agent needs a follow-up answer before it can continue."],
        order,
      };
    }
    if (status === "paused") {
      return {
        id: "phase:user-paused",
        kind: "phase",
        title: "Run paused",
        status: "waiting",
        details: [
          "The run was paused before completion and can be continued in a later turn.",
        ],
        order,
      };
    }
  }

  if (eventType === "run_failed") {
    const errorText = runFailedDetail(payload);
    if (errorText) {
      details.push(`Error: ${summarizeUnknown(errorText, 120)}`);
    }
    return {
      id: "phase:run-failed",
      kind: "phase",
      title: "Run failed",
      status: "error",
      details,
      order,
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
            details: step.details.length > 0 ? step.details : entry.details,
          }
        : entry,
    )
    .sort((left, right) => left.order - right.order);
}

function finalizeTraceSteps(
  previous: ChatTraceStep[],
  status: Extract<ChatTraceStepStatus, "completed" | "error" | "waiting">,
) {
  return previous.map((step) =>
    step.status === "running"
      ? {
          ...step,
          status,
        }
      : step,
  );
}

function assistantHistoryStateFromOutputEvents(
  outputEvents: SessionOutputEventPayload[],
) {
  const orderedEvents = [...outputEvents].sort(
    (left, right) => left.sequence - right.sequence || left.id - right.id,
  );
  let thinkingText = "";
  let traceSteps: ChatTraceStep[] = [];

  for (const event of orderedEvents) {
    const eventPayload = isRecord(event.payload) ? event.payload : {};

    if (event.event_type === "thinking_delta") {
      const delta =
        typeof eventPayload.delta === "string" ? eventPayload.delta : "";
      if (delta) {
        thinkingText = `${thinkingText}${delta}`;
      }
    }

    const phaseStep = phaseTraceStepFromEvent(
      event.event_type,
      eventPayload,
      event.sequence,
    );
    if (phaseStep) {
      traceSteps = upsertTraceStep(traceSteps, phaseStep);
    }

    const toolStep = toolTraceStepFromEvent(
      event.event_type,
      eventPayload,
      event.sequence,
    );
    if (toolStep) {
      traceSteps = upsertTraceStep(traceSteps, toolStep);
    }

    if (event.event_type === "run_completed") {
      const completedStatus =
        typeof eventPayload.status === "string"
          ? eventPayload.status.trim().toLowerCase()
          : "";
      traceSteps = finalizeTraceSteps(
        traceSteps,
        completedStatus === "paused" || completedStatus === "waiting_user"
          ? "waiting"
          : "completed",
      );
    } else if (event.event_type === "run_failed") {
      traceSteps = finalizeTraceSteps(traceSteps, "error");
    }
  }

  return {
    thinkingText: thinkingText || undefined,
    traceSteps: traceSteps.length > 0 ? traceSteps : undefined,
  };
}

function isNearChatBottom(container: HTMLDivElement) {
  const remaining =
    container.scrollHeight - container.scrollTop - container.clientHeight;
  return remaining <= CHAT_AUTO_SCROLL_THRESHOLD_PX;
}

function chatMessageTimeLabel(value: string | null | undefined): string {
  const timestamp = Date.parse(value || "");
  if (Number.isNaN(timestamp)) {
    return "";
  }
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }
}

function hasActiveChatSelection(container: HTMLDivElement | null) {
  if (!container || typeof window === "undefined") {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return false;
  }

  return (
    container.contains(selection.anchorNode) ||
    container.contains(selection.focusNode)
  );
}

interface ChatPaneSessionOpenRequest {
  sessionId: string;
  requestKey: number;
  mode?: "session" | "draft";
  parentSessionId?: string | null;
}

interface ChatPaneComposerPrefillRequest {
  text: string;
  requestKey: number;
}

interface ChatPaneProps {
  onOpenOutput?: (output: WorkspaceOutputRecordPayload) => void;
  focusRequestKey?: number;
  variant?: ChatPaneVariant;
  onOpenLinkInBrowser?: (url: string) => void;
  sessionJumpSessionId?: string | null;
  sessionJumpRequestKey?: number;
  sessionOpenRequest?: ChatPaneSessionOpenRequest | null;
  onSessionOpenRequestConsumed?: (requestKey: number) => void;
  composerPrefillRequest?: ChatPaneComposerPrefillRequest | null;
  onComposerPrefillConsumed?: (requestKey: number) => void;
  onActiveSessionIdChange?: (sessionId: string | null) => void;
  onOpenInbox?: () => void;
  inboxUnreadCount?: number;
  onRequestCreateSession?: () => void;
}

export function ChatPane({
  onOpenOutput,
  focusRequestKey = 0,
  variant = "default",
  onOpenLinkInBrowser,
  sessionJumpSessionId = null,
  sessionJumpRequestKey = 0,
  sessionOpenRequest = null,
  onSessionOpenRequestConsumed,
  composerPrefillRequest = null,
  onComposerPrefillConsumed,
  onActiveSessionIdChange,
  onOpenInbox,
  inboxUnreadCount = 0,
  onRequestCreateSession,
}: ChatPaneProps) {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const authSessionState = useDesktopAuthSession();
  const {
    hasHostedBillingAccount,
    isLowBalance,
    isOutOfCredits,
    links: billingLinks,
    refresh: refreshBillingState,
  } = useDesktopBilling();
  const {
    runtimeConfig,
    selectedWorkspace,
    isLoadingBootstrap,
    isActivatingWorkspace,
    workspaceAppsReady,
    workspaceBlockingReason,
    refreshWorkspaceData,
  } = useWorkspaceDesktop();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionOutputs, setSessionOutputs] = useState<
    WorkspaceOutputRecordPayload[]
  >([]);
  const [liveAssistantText, setLiveAssistantText] = useState("");
  const [liveThinkingText, setLiveThinkingText] = useState("");
  const [liveThinkingExpanded, setLiveThinkingExpanded] = useState(false);
  const [liveAgentStatus, setLiveAgentStatus] = useState("");
  const [liveTraceSteps, setLiveTraceSteps] = useState<ChatTraceStep[]>([]);
  const [collapsedThinkingByMessageId, setCollapsedThinkingByMessageId] =
    useState<Record<string, boolean>>({});
  const [collapsedTraceByStepId, setCollapsedTraceByStepId] = useState<
    Record<string, boolean>
  >({});
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [isPausePending, setIsPausePending] = useState(false);
  const [chatErrorMessage, setChatErrorMessage] = useState("");
  const [verboseTelemetryEnabled, setVerboseTelemetryEnabled] = useState(false);
  const [composerBlockHeight, setComposerBlockHeight] = useState(0);
  const [chatModelPreference, setChatModelPreference] = useState(
    loadStoredChatModelPreference,
  );
  const [isHistoryViewportPending, setIsHistoryViewportPending] =
    useState(false);
  const [
    historyViewportRestoreGeneration,
    setHistoryViewportRestoreGeneration,
  ] = useState(0);
  const [chatScrollMetrics, setChatScrollMetrics] = useState({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  });
  const [streamTelemetry, setStreamTelemetry] = useState<
    StreamTelemetryEntry[]
  >([]);
  const [artifactBrowserOpen, setArtifactBrowserOpen] = useState(false);
  const [artifactBrowserFilter, setArtifactBrowserFilter] =
    useState<ArtifactBrowserFilter>("all");
  const [memoryProposalAction, setMemoryProposalAction] = useState<{
    proposalId: string;
    action: "accept" | "dismiss";
  } | null>(null);
  const [currentTodoPlan, setCurrentTodoPlan] = useState<ChatTodoPlan | null>(
    null,
  );
  const [todoPanelExpanded, setTodoPanelExpanded] = useState(false);
  const [editingMemoryProposalId, setEditingMemoryProposalId] = useState<
    string | null
  >(null);
  const [memoryProposalDrafts, setMemoryProposalDrafts] = useState<
    Record<string, string>
  >({});
  const [availableSessions, setAvailableSessions] = useState<
    ChatSessionOption[]
  >([]);
  const [isLoadingAvailableSessions, setIsLoadingAvailableSessions] =
    useState(false);
  const [availableSessionsError, setAvailableSessionsError] = useState("");
  const [localSessionOpenRequest, setLocalSessionOpenRequest] =
    useState<ChatPaneSessionOpenRequest | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const chatScrollbarThumbRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerBlockRef = useRef<HTMLDivElement>(null);
  const composerIsComposingRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const lastChatScrollTopRef = useRef(0);
  const chatScrollbarDragStateRef = useRef<ChatScrollbarDragState | null>(null);
  const chatScrollbarBodyUserSelectRef = useRef<string | null>(null);
  const chatScrollbarBodyCursorRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const pendingInputIdRef = useRef<string | null>(null);
  const seenMainDebugKeysRef = useRef<Set<string>>(new Set());
  const selectedWorkspaceRef = useRef<WorkspaceRecordPayload | null>(null);
  const isOnboardingVariant = variant === "onboarding";
  const pendingFocusRequestKeyRef = useRef<number | null>(focusRequestKey);
  const lastHandledSessionJumpRequestKeyRef = useRef(0);
  const lastHandledExternalSessionOpenRequestKeyRef = useRef(0);
  const lastHandledLocalSessionOpenRequestKeyRef = useRef(0);
  const lastHandledComposerPrefillRequestKeyRef = useRef(0);
  const draftParentSessionIdRef = useRef<string | null>(null);
  const liveAssistantTextRef = useRef("");
  const liveThinkingTextRef = useRef("");
  const liveThinkingExpandedRef = useRef(false);
  const liveTraceStepsRef = useRef<ChatTraceStep[]>([]);
  const historyViewportGenerationRef = useRef(0);
  const [activeSessionId, setActiveSessionId] = useState("");
  const effectiveSessionOpenRequest =
    sessionOpenRequest ?? localSessionOpenRequest;
  const isExternalSessionOpenRequest = sessionOpenRequest !== null;

  function appendStreamTelemetry(
    entry: Omit<StreamTelemetryEntry, "id" | "at">,
  ) {
    if (!verboseTelemetryEnabled) {
      return;
    }
    const at = new Date().toISOString().slice(11, 23);
    const next: StreamTelemetryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at,
      ...entry,
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
      detail: reason,
    });
    await window.electronAPI.workspace.closeSessionOutputStream(
      streamId,
      reason,
    );
  }

  function setActiveSession(sessionId: string | null) {
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId ?? "");
    onActiveSessionIdChange?.(sessionId);
  }

  function beginHistoryViewportRestore() {
    historyViewportGenerationRef.current += 1;
    shouldAutoScrollRef.current = true;
    setIsHistoryViewportPending(true);
  }

  function requestHistoryViewportRestore() {
    setHistoryViewportRestoreGeneration(historyViewportGenerationRef.current);
  }

  function cancelHistoryViewportRestore() {
    historyViewportGenerationRef.current += 1;
    setIsHistoryViewportPending(false);
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

  function clearSessionView() {
    setMessages([]);
    setSessionOutputs([]);
    setCurrentTodoPlan(null);
    setArtifactBrowserOpen(false);
    setArtifactBrowserFilter("all");
    setMemoryProposalAction(null);
    setEditingMemoryProposalId(null);
    setMemoryProposalDrafts({});
    resetLiveTurn();
    setCollapsedThinkingByMessageId({});
    setCollapsedTraceByStepId({});
    shouldAutoScrollRef.current = true;
  }

  function historyMessagesFromSessionState(
    historyMessages: SessionHistoryMessagePayload[],
    outputEvents: SessionOutputEventPayload[],
    outputs: WorkspaceOutputRecordPayload[],
    memoryProposals: MemoryUpdateProposalRecordPayload[],
  ): ChatMessage[] {
    const outputEventsByInputId = new Map<
      string,
      SessionOutputEventPayload[]
    >();
    const outputsByInputId = new Map<string, WorkspaceOutputRecordPayload[]>();
    const memoryProposalsByInputId = new Map<
      string,
      MemoryUpdateProposalRecordPayload[]
    >();
    for (const event of outputEvents) {
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
    for (const output of outputs) {
      const inputId = (output.input_id || "").trim();
      if (!inputId) {
        continue;
      }
      const existing = outputsByInputId.get(inputId);
      if (existing) {
        existing.push(output);
      } else {
        outputsByInputId.set(inputId, [output]);
      }
    }
    for (const proposal of memoryProposals) {
      const inputId = proposal.input_id.trim();
      if (!inputId) {
        continue;
      }
      const existing = memoryProposalsByInputId.get(inputId);
      if (existing) {
        existing.push(proposal);
      } else {
        memoryProposalsByInputId.set(inputId, [proposal]);
      }
    }

    return historyMessages
      .map((message) => {
        const attachments = attachmentsFromMetadata(message.metadata);
        const nextMessage: ChatMessage = {
          id:
            message.id ||
            `history-${message.created_at ?? crypto.randomUUID()}`,
          role: message.role as ChatMessage["role"],
          text: message.text,
          createdAt: message.created_at || undefined,
          attachments,
        };

        if (nextMessage.role === "assistant") {
          const inputId = inputIdFromMessageId(nextMessage.id, "assistant");
          if (inputId) {
            const restoredAssistantState =
              assistantHistoryStateFromOutputEvents(
                outputEventsByInputId.get(inputId) ?? [],
              );
            const turnOutputs = sortOutputs(
              outputsByInputId.get(inputId) ?? [],
            );
            const turnMemoryProposals = sortMemoryUpdateProposals(
              memoryProposalsByInputId.get(inputId) ?? [],
            );
            if (restoredAssistantState.thinkingText) {
              nextMessage.thinkingText = restoredAssistantState.thinkingText;
            }
            if (restoredAssistantState.traceSteps) {
              nextMessage.traceSteps = restoredAssistantState.traceSteps;
            }
            if (turnMemoryProposals.length > 0) {
              nextMessage.memoryProposals = turnMemoryProposals;
            }
            if (turnOutputs.length > 0) {
              nextMessage.outputs = turnOutputs;
            }
          }
        }

        return nextMessage;
      })
      .filter(
        (message) =>
          (message.role === "user" || message.role === "assistant") &&
          (message.role === "assistant"
            ? hasRenderableAssistantTurn(message)
            : hasRenderableMessageContent(
                message.text,
                message.attachments ?? [],
              )),
      );
  }

  async function loadSessionConversation(
    nextSessionId: string | null,
    workspaceId: string,
    runtimeStates: SessionRuntimeRecordPayload[],
    options?: {
      cancelled?: () => boolean;
    },
  ) {
    const cancelled = options?.cancelled ?? (() => false);

    if (activeSessionIdRef.current !== nextSessionId) {
      clearSessionView();
    }
    setActiveSession(nextSessionId);
    if (!nextSessionId) {
      requestHistoryViewportRestore();
      return;
    }

    const [history, outputEventHistory, outputList, memoryProposalList] =
      await Promise.all([
        window.electronAPI.workspace.getSessionHistory({
          sessionId: nextSessionId,
          workspaceId,
        }),
        window.electronAPI.workspace.getSessionOutputEvents({
          sessionId: nextSessionId,
        }),
        window.electronAPI.workspace.listOutputs({
          workspaceId,
          sessionId: nextSessionId,
          limit: 200,
        }),
        window.electronAPI.workspace.listMemoryUpdateProposals({
          workspaceId,
          sessionId: nextSessionId,
          limit: 200,
        }),
      ]);
    if (cancelled()) {
      return;
    }

    const nextOutputs = sortOutputs(outputList.items);
    const nextMessages = historyMessagesFromSessionState(
      history.messages,
      outputEventHistory.items,
      nextOutputs,
      memoryProposalList.proposals,
    );
    setSessionOutputs(nextOutputs);
    setCurrentTodoPlan(todoPlanFromOutputEvents(outputEventHistory.items));
    setMessages(nextMessages);
    resetLiveTurn();
    requestHistoryViewportRestore();

    const onboardingSessionId = (
      selectedWorkspaceRef.current?.onboarding_session_id || ""
    ).trim();
    const currentRuntimeState = runtimeStates.find(
      (item) => item.session_id === nextSessionId,
    );
    const currentRuntimeStatus = runtimeStateStatus(
      currentRuntimeState?.status,
    );
    const currentRuntimeInputId = (
      currentRuntimeState?.current_input_id || ""
    ).trim();
    const hasAssistantMessage = nextMessages.some(
      (message) => message.role === "assistant",
    );
    const shouldAttachLiveRunStream =
      !activeStreamIdRef.current &&
      !pendingInputIdRef.current &&
      ["BUSY", "QUEUED"].includes(currentRuntimeStatus);
    const shouldAttachOnboardingBootstrapStream =
      shouldAttachLiveRunStream &&
      isOnboardingVariant &&
      nextSessionId === onboardingSessionId &&
      !hasAssistantMessage &&
      currentRuntimeStatus === "BUSY";

    if (shouldAttachLiveRunStream) {
      setIsResponding(true);
      setLiveAgentStatus(
        shouldAttachOnboardingBootstrapStream
          ? "Preparing first question"
          : currentRuntimeStatus === "QUEUED"
            ? "Queued"
            : "Working",
      );
      setChatErrorMessage("");
      const stream = await window.electronAPI.workspace.openSessionOutputStream(
        {
          sessionId: nextSessionId,
          workspaceId,
          inputId: currentRuntimeInputId || undefined,
          includeHistory: Boolean(currentRuntimeInputId),
          stopOnTerminal: true,
        },
      );
      if (cancelled()) {
        await closeStreamWithReason(
          stream.streamId,
          "load_history_cancelled",
        ).catch(() => undefined);
        return;
      }
      activeStreamIdRef.current = stream.streamId;
      appendStreamTelemetry({
        streamId: stream.streamId,
        transportType: "client",
        eventName: "openSessionOutputStream",
        eventType: shouldAttachOnboardingBootstrapStream
          ? "stream_open_onboarding_bootstrap"
          : "stream_open_existing_run",
        inputId: "",
        sessionId: nextSessionId,
        action: shouldAttachOnboardingBootstrapStream
          ? "stream_requested_onboarding_bootstrap"
          : "stream_requested_existing_run",
        detail: shouldAttachOnboardingBootstrapStream
          ? `attached to in-flight onboarding opener input=${currentRuntimeInputId || "latest"}`
          : `attached to in-flight session run input=${currentRuntimeInputId || "latest"}`,
      });
    } else if (!activeStreamIdRef.current && !pendingInputIdRef.current) {
      setIsResponding(false);
    }
  }

  async function createWorkspaceSession(
    workspaceId: string,
    parentSessionId?: string | null,
  ): Promise<string | null> {
    const created = await window.electronAPI.workspace.createAgentSession({
      workspace_id: workspaceId,
      kind: "workspace_session",
      parent_session_id: parentSessionId?.trim() || null,
      created_by: "workspace_user",
    });
    const sessionId = created.session.session_id.trim();
    return sessionId || null;
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
    const messageId =
      activeAssistantMessageIdRef.current ?? `assistant-${Date.now()}`;
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
        traceSteps: traceSteps.length > 0 ? traceSteps : undefined,
      },
    ]);
    setCollapsedThinkingByMessageId((prev) => ({
      ...prev,
      [messageId]: true,
    }));
    resetLiveTurn();
  }

  function scheduleConversationRefresh(
    sessionId: string | null,
    workspaceId: string | null | undefined,
  ) {
    const normalizedSessionId = (sessionId || "").trim();
    const normalizedWorkspaceId = (workspaceId || "").trim();
    if (!normalizedSessionId || !normalizedWorkspaceId) {
      return;
    }

    const delays = [150, 500];
    for (const delayMs of delays) {
      window.setTimeout(() => {
        if (
          activeSessionIdRef.current !== normalizedSessionId ||
          selectedWorkspaceId !== normalizedWorkspaceId
        ) {
          return;
        }
        void window.electronAPI.workspace
          .listRuntimeStates(normalizedWorkspaceId)
          .then((runtimeStates) =>
            loadSessionConversation(
              normalizedSessionId,
              normalizedWorkspaceId,
              runtimeStates.items,
              {
                cancelled: () =>
                  activeSessionIdRef.current !== normalizedSessionId ||
                  selectedWorkspaceId !== normalizedWorkspaceId,
              },
            ),
          )
          .catch(() => undefined);
      }, delayMs);
    }
  }

  function updateMemoryProposalDraft(proposalId: string, value: string) {
    setMemoryProposalDrafts((prev) => ({
      ...prev,
      [proposalId]: value,
    }));
  }

  async function handleAcceptMemoryProposal(
    proposal: MemoryUpdateProposalRecordPayload,
  ) {
    if (!selectedWorkspaceId) {
      return;
    }
    const nextSummary = (
      memoryProposalDrafts[proposal.proposal_id] ?? proposal.summary
    ).trim();
    if (!nextSummary) {
      setChatErrorMessage("Memory proposal summary cannot be empty.");
      return;
    }
    setMemoryProposalAction({
      proposalId: proposal.proposal_id,
      action: "accept",
    });
    try {
      await window.electronAPI.workspace.acceptMemoryUpdateProposal({
        proposalId: proposal.proposal_id,
        summary: nextSummary,
      });
      setEditingMemoryProposalId((current) =>
        current === proposal.proposal_id ? null : current,
      );
      scheduleConversationRefresh(proposal.session_id, selectedWorkspaceId);
    } catch (error) {
      setChatErrorMessage(normalizeErrorMessage(error));
    } finally {
      setMemoryProposalAction((current) =>
        current?.proposalId === proposal.proposal_id ? null : current,
      );
    }
  }

  async function handleDismissMemoryProposal(
    proposal: MemoryUpdateProposalRecordPayload,
  ) {
    if (!selectedWorkspaceId) {
      return;
    }
    setMemoryProposalAction({
      proposalId: proposal.proposal_id,
      action: "dismiss",
    });
    try {
      await window.electronAPI.workspace.dismissMemoryUpdateProposal(
        proposal.proposal_id,
      );
      setEditingMemoryProposalId((current) =>
        current === proposal.proposal_id ? null : current,
      );
      scheduleConversationRefresh(proposal.session_id, selectedWorkspaceId);
    } catch (error) {
      setChatErrorMessage(normalizeErrorMessage(error));
    } finally {
      setMemoryProposalAction((current) =>
        current?.proposalId === proposal.proposal_id ? null : current,
      );
    }
  }

  function toggleThinkingPanel(messageId: string) {
    setCollapsedThinkingByMessageId((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  }

  function toggleTraceStep(stepId: string) {
    setCollapsedTraceByStepId((prev) => ({
      ...prev,
      [stepId]: !(prev[stepId] ?? true),
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

    lastChatScrollTopRef.current = target.scrollTop;

    setChatScrollMetrics((previous) => {
      const next = {
        scrollTop: target.scrollTop,
        scrollHeight: target.scrollHeight,
        clientHeight: target.clientHeight,
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

  function clearChatScrollbarDragState() {
    chatScrollbarDragStateRef.current = null;
    if (typeof document === "undefined") {
      return;
    }
    if (chatScrollbarBodyUserSelectRef.current !== null) {
      document.body.style.userSelect = chatScrollbarBodyUserSelectRef.current;
      chatScrollbarBodyUserSelectRef.current = null;
    }
    if (chatScrollbarBodyCursorRef.current !== null) {
      document.body.style.cursor = chatScrollbarBodyCursorRef.current;
      chatScrollbarBodyCursorRef.current = null;
    }
  }

  function updateChatScrollFromScrollbarPointer(
    railElement: HTMLDivElement,
    clientY: number,
    thumbPointerOffset: number,
  ) {
    const container = messagesRef.current;
    if (!container || !showCustomChatScrollbar || chatScrollRange <= 0) {
      return;
    }

    const railRect = railElement.getBoundingClientRect();
    const unclampedThumbOffset = clientY - railRect.top - thumbPointerOffset;
    const nextThumbOffset = Math.min(
      Math.max(0, unclampedThumbOffset),
      chatScrollbarThumbTravel,
    );
    const nextScrollTop =
      chatScrollbarThumbTravel > 0
        ? (nextThumbOffset / chatScrollbarThumbTravel) * chatScrollRange
        : 0;

    shouldAutoScrollRef.current = false;
    container.scrollTop = nextScrollTop;
    syncChatScrollMetrics(container);
  }

  function handleChatScrollbarPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0 || !showCustomChatScrollbar) {
      return;
    }

    let thumbPointerOffset = chatScrollbarThumbHeight / 2;
    if (
      event.target instanceof Node &&
      chatScrollbarThumbRef.current?.contains(event.target)
    ) {
      const thumbRect = chatScrollbarThumbRef.current.getBoundingClientRect();
      thumbPointerOffset = Math.min(
        Math.max(0, event.clientY - thumbRect.top),
        chatScrollbarThumbHeight,
      );
    }

    chatScrollbarDragStateRef.current = {
      pointerId: event.pointerId,
      thumbPointerOffset,
    };

    if (typeof document !== "undefined") {
      if (chatScrollbarBodyUserSelectRef.current === null) {
        chatScrollbarBodyUserSelectRef.current = document.body.style.userSelect;
      }
      if (chatScrollbarBodyCursorRef.current === null) {
        chatScrollbarBodyCursorRef.current = document.body.style.cursor;
      }
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    updateChatScrollFromScrollbarPointer(
      event.currentTarget,
      event.clientY,
      thumbPointerOffset,
    );
    event.preventDefault();
  }

  function handleChatScrollbarPointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const dragState = chatScrollbarDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    updateChatScrollFromScrollbarPointer(
      event.currentTarget,
      event.clientY,
      dragState.thumbPointerOffset,
    );
    event.preventDefault();
  }

  function handleChatScrollbarPointerUp(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const dragState = chatScrollbarDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearChatScrollbarDragState();
  }

  function upsertLiveTraceStep(step: ChatTraceStep) {
    const next = upsertTraceStep(liveTraceStepsRef.current, step);
    setLiveTraceStepsState(next);
  }

  function finalizeLiveTraceSteps(
    status: Extract<ChatTraceStepStatus, "completed" | "error" | "waiting">,
  ) {
    const next = finalizeTraceSteps(liveTraceStepsRef.current, status);
    setLiveTraceStepsState(next);
  }

  useEffect(() => {
    const container = messagesRef.current;
    if (
      !container ||
      !shouldAutoScrollRef.current ||
      hasActiveChatSelection(container)
    ) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: isResponding || isHistoryViewportPending ? "auto" : "smooth",
    });
  }, [
    isHistoryViewportPending,
    isResponding,
    liveAssistantText,
    liveThinkingText,
    liveTraceSteps,
    messages,
  ]);

  useLayoutEffect(() => {
    if (!isHistoryViewportPending || historyViewportRestoreGeneration <= 0) {
      return;
    }

    const container = messagesRef.current;
    if (!container) {
      return;
    }

    const restoreGeneration = historyViewportRestoreGeneration;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
    syncChatScrollMetrics(container);

    const frameId = window.requestAnimationFrame(() => {
      if (historyViewportGenerationRef.current !== restoreGeneration) {
        return;
      }
      setIsHistoryViewportPending(false);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [historyViewportRestoreGeneration, isHistoryViewportPending]);

  useEffect(() => {
    selectedWorkspaceRef.current = selectedWorkspace;
  }, [selectedWorkspace]);

  useEffect(() => clearChatScrollbarDragState, []);

  useEffect(() => {
    if (!isResponding) {
      setIsPausePending(false);
    }
  }, [isResponding]);

  useEffect(() => {
    setPendingAttachments([]);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    const requestKey = composerPrefillRequest?.requestKey ?? 0;
    if (
      requestKey <= 0 ||
      requestKey === lastHandledComposerPrefillRequestKeyRef.current
    ) {
      return;
    }

    lastHandledComposerPrefillRequestKeyRef.current = requestKey;
    setInput(composerPrefillRequest?.text ?? "");
    setPendingAttachments([]);
    onComposerPrefillConsumed?.(requestKey);
  }, [
    composerPrefillRequest?.requestKey,
    composerPrefillRequest?.text,
    onComposerPrefillConsumed,
  ]);

  useEffect(() => {
    const normalizedPreference =
      normalizeStoredChatModelPreference(chatModelPreference);
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
  }, [
    focusRequestKey,
    isLoadingBootstrap,
    isLoadingHistory,
    selectedWorkspace,
    selectedWorkspaceId,
  ]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      cancelHistoryViewportRestore();
      clearSessionView();
      setPendingAttachments([]);
      setActiveSession(null);
      pendingInputIdRef.current = null;
      lastHandledSessionJumpRequestKeyRef.current = 0;
      lastHandledExternalSessionOpenRequestKeyRef.current = 0;
      lastHandledLocalSessionOpenRequestKeyRef.current = 0;
      draftParentSessionIdRef.current = null;
      return;
    }

    let cancelled = false;

    async function loadHistory() {
      let historyLoaded = false;
      beginHistoryViewportRestore();
      setIsLoadingHistory(true);
      setChatErrorMessage("");

      try {
        const requestedSessionId = (sessionJumpSessionId || "").trim();
        const hasSessionJumpRequest =
          Boolean(requestedSessionId) &&
          sessionJumpRequestKey > 0 &&
          sessionJumpRequestKey !== lastHandledSessionJumpRequestKeyRef.current;
        if (hasSessionJumpRequest) {
          lastHandledSessionJumpRequestKeyRef.current = sessionJumpRequestKey;
          pendingInputIdRef.current = null;
          activeAssistantMessageIdRef.current = null;
          setIsResponding(false);
          resetLiveTurn();

          const activeStreamId = activeStreamIdRef.current;
          activeStreamIdRef.current = null;
          if (activeStreamId) {
            await closeStreamWithReason(
              activeStreamId,
              "chatpane_session_jump_requested",
            ).catch(() => undefined);
          }
        }

        const [runtimeStates, sessionsResponse] = await Promise.all([
          window.electronAPI.workspace.listRuntimeStates(selectedWorkspaceId),
          window.electronAPI.workspace.listAgentSessions(selectedWorkspaceId),
        ]);
        if (cancelled) {
          return;
        }

        const nextSessionId =
          (hasSessionJumpRequest && requestedSessionId
            ? requestedSessionId
            : null) ||
          preferredSessionId(
            selectedWorkspaceRef.current,
            runtimeStates.items,
            sessionsResponse.items,
          );
        const resolvedSessionId = nextSessionId || null;
        draftParentSessionIdRef.current = null;
        await loadSessionConversation(
          resolvedSessionId,
          selectedWorkspaceId,
          runtimeStates.items,
          {
            cancelled: () => cancelled,
          },
        );
        historyLoaded = true;
      } catch (error) {
        if (!cancelled) {
          setChatErrorMessage(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          if (!historyLoaded) {
            cancelHistoryViewportRestore();
          }
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
    sessionJumpRequestKey,
    sessionJumpSessionId,
    selectedWorkspaceId,
    selectedWorkspace?.onboarding_session_id,
    selectedWorkspace?.onboarding_status,
  ]);

  useEffect(() => {
    const requestedSessionId = (
      effectiveSessionOpenRequest?.sessionId || ""
    ).trim();
    const requestKey = effectiveSessionOpenRequest?.requestKey ?? 0;
    const requestMode = effectiveSessionOpenRequest?.mode ?? "session";
    const requestedParentSessionId =
      effectiveSessionOpenRequest?.parentSessionId?.trim() || null;
    const lastHandledSessionOpenRequestKeyRef = isExternalSessionOpenRequest
      ? lastHandledExternalSessionOpenRequestKeyRef
      : lastHandledLocalSessionOpenRequestKeyRef;
    if (
      !selectedWorkspaceId ||
      requestKey <= 0 ||
      requestKey === lastHandledSessionOpenRequestKeyRef.current
    ) {
      return;
    }

    let cancelled = false;

    async function openRequestedSession() {
      lastHandledSessionOpenRequestKeyRef.current = requestKey;

      let historyLoaded = false;
      beginHistoryViewportRestore();
      setIsLoadingHistory(true);
      setChatErrorMessage("");
      pendingInputIdRef.current = null;
      activeAssistantMessageIdRef.current = null;
      setIsResponding(false);

      const activeStreamId = activeStreamIdRef.current;
      activeStreamIdRef.current = null;
      if (activeStreamId) {
        await closeStreamWithReason(
          activeStreamId,
          "chatpane_open_requested_session",
        ).catch(() => undefined);
      }

      try {
        if (requestMode === "draft") {
          draftParentSessionIdRef.current = requestedParentSessionId;
          clearSessionView();
          setActiveSession(null);
          requestHistoryViewportRestore();
          historyLoaded = true;
          return;
        }

        if (!requestedSessionId) {
          historyLoaded = true;
          return;
        }

        draftParentSessionIdRef.current = null;
        if (activeSessionIdRef.current === requestedSessionId) {
          requestHistoryViewportRestore();
          historyLoaded = true;
          return;
        }

        const runtimeStates =
          await window.electronAPI.workspace.listRuntimeStates(
            selectedWorkspaceId,
          );
        await loadSessionConversation(
          requestedSessionId,
          selectedWorkspaceId,
          runtimeStates.items,
          {
            cancelled: () => cancelled,
          },
        );
        historyLoaded = true;
      } catch (error) {
        if (!cancelled) {
          setChatErrorMessage(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled && !historyLoaded) {
          cancelHistoryViewportRestore();
        }
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
        if (isExternalSessionOpenRequest) {
          onSessionOpenRequestConsumed?.(requestKey);
        } else {
          setLocalSessionOpenRequest((current) =>
            current?.requestKey === requestKey ? null : current,
          );
        }
      }
    }

    void openRequestedSession();
    return () => {
      cancelled = true;
    };
  }, [
    onSessionOpenRequestConsumed,
    isExternalSessionOpenRequest,
    selectedWorkspaceId,
    effectiveSessionOpenRequest?.requestKey,
    effectiveSessionOpenRequest?.sessionId,
    effectiveSessionOpenRequest?.mode,
    effectiveSessionOpenRequest?.parentSessionId,
    sessionOpenRequest?.requestKey,
  ]);

  useEffect(() => {
    setTodoPanelExpanded(false);
  }, [activeSessionId]);

  useEffect(() => {
    if (isOnboardingVariant) {
      setAvailableSessions([]);
      setAvailableSessionsError("");
      setIsLoadingAvailableSessions(false);
      return;
    }
    if (!selectedWorkspaceId) {
      setAvailableSessions([]);
      setAvailableSessionsError("");
      setIsLoadingAvailableSessions(false);
      return;
    }

    let cancelled = false;
    let requestInFlight = false;

    const loadAvailableSessions = async (options?: {
      showLoading?: boolean;
    }) => {
      if (requestInFlight) {
        return;
      }
      requestInFlight = true;
      if (options?.showLoading) {
        setIsLoadingAvailableSessions(true);
      }

      try {
        const [runtimeStates, sessionsResponse] = await Promise.all([
          window.electronAPI.workspace.listRuntimeStates(selectedWorkspaceId),
          window.electronAPI.workspace.listAgentSessions(selectedWorkspaceId),
        ]);
        if (cancelled) {
          return;
        }

        const runtimeStateBySessionId = new Map(
          runtimeStates.items.map((item) => [item.session_id, item]),
        );
        const nextOptions = sessionsResponse.items
          .map((session) => {
            const sessionId = session.session_id.trim();
            if (!sessionId) {
              return null;
            }
            const runtimeState = runtimeStateBySessionId.get(sessionId);
            const title =
              session.title?.trim() ||
              defaultWorkspaceSessionTitle(session.kind, sessionId);
            const updatedAt =
              runtimeState?.updated_at?.trim() ||
              session.updated_at?.trim() ||
              "";
            return {
              sessionId,
              title,
              statusLabel: chatSessionStatusLabel(runtimeState),
              updatedAt,
              updatedLabel: formatSessionUpdatedLabel(updatedAt),
              searchText: `${title} ${session.kind || ""} ${sessionId}`.trim(),
            } satisfies ChatSessionOption;
          })
          .filter((item): item is ChatSessionOption => Boolean(item))
          .sort(compareChatSessionOptions);

        setAvailableSessions(nextOptions);
        setAvailableSessionsError("");
      } catch (error) {
        if (!cancelled) {
          setAvailableSessionsError(normalizeErrorMessage(error));
        }
      } finally {
        requestInFlight = false;
        if (!cancelled && options?.showLoading) {
          setIsLoadingAvailableSessions(false);
        }
      }
    };

    const refreshVisibleSessions = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void loadAvailableSessions();
    };

    void loadAvailableSessions({ showLoading: true });
    const intervalId = window.setInterval(() => {
      refreshVisibleSessions();
    }, 4000);
    window.addEventListener("focus", refreshVisibleSessions);
    document.addEventListener("visibilitychange", refreshVisibleSessions);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshVisibleSessions);
      document.removeEventListener("visibilitychange", refreshVisibleSessions);
    };
  }, [activeSessionId, isOnboardingVariant, selectedWorkspaceId]);

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
              detail: entry.detail,
            });
          }
          if (seenMainDebugKeysRef.current.size > 4000) {
            const trimmed = new Set(
              Array.from(seenMainDebugKeysRef.current).slice(-2000),
            );
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
    const unsubscribe = window.electronAPI.workspace.onSessionStreamEvent(
      (payload) => {
        const currentStreamId = activeStreamIdRef.current;
        const pendingInputId = pendingInputIdRef.current || "";
        const hasPendingStreamAttach = Boolean(pendingInputId);
        const rawEventData =
          payload.type === "event" ? payload.event?.data : null;
        const typedEvent =
          rawEventData &&
          typeof rawEventData === "object" &&
          !Array.isArray(rawEventData)
            ? (rawEventData as {
                event_type?: string;
                payload?: Record<string, unknown>;
                input_id?: string;
                session_id?: string;
                sequence?: number;
              })
            : null;
        const eventName =
          payload.type === "event"
            ? (payload.event?.event ?? "message")
            : payload.type;
        const eventType = typedEvent?.event_type ?? eventName;
        const eventPayload = typedEvent?.payload ?? {};
        const eventInputId =
          typeof typedEvent?.input_id === "string" ? typedEvent.input_id : "";
        const eventSessionId =
          typeof typedEvent?.session_id === "string"
            ? typedEvent.session_id
            : "";
        const eventSequence =
          typeof typedEvent?.sequence === "number" &&
          Number.isFinite(typedEvent.sequence)
            ? typedEvent.sequence
            : Number.MAX_SAFE_INTEGER;

        appendStreamTelemetry({
          streamId: payload.streamId,
          transportType: payload.type,
          eventName,
          eventType,
          inputId: eventInputId,
          sessionId: eventSessionId,
          action: "received",
          detail: `active=${currentStreamId || "-"} pending=${pendingInputId || "-"}`,
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
                detail: "pending_attach=true",
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
                detail: "no pending attach",
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
              detail: `active_now=${activeStreamIdRef.current || "-"}`,
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
            detail: payload.error || "stream error",
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
                detail: "pending_attach=true",
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
                detail: "no pending attach",
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
              detail: `active_now=${activeStreamIdRef.current || "-"}`,
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
            detail: "stream done",
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
            detail: `data_type=${typeof eventData}`,
          });
          return;
        }

        const streamMatches = Boolean(
          currentStreamId && payload.streamId === currentStreamId,
        );
        const inputMatchesPending = Boolean(
          pendingInputId && eventInputId && eventInputId === pendingInputId,
        );
        const canAdoptStream = !streamMatches && inputMatchesPending;

        if (!streamMatches && !canAdoptStream) {
          appendStreamTelemetry({
            streamId: payload.streamId,
            transportType: payload.type,
            eventName,
            eventType,
            inputId: eventInputId,
            sessionId: eventSessionId,
            action: "drop_unmatched_event",
            detail: `active=${currentStreamId || "-"} pending=${pendingInputId || "-"} input_match=${String(inputMatchesPending)}`,
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
            detail: `pending_input=${pendingInputId}`,
          });
        }

        if (
          eventType === "run_claimed" ||
          eventType === "compaction_restored" ||
          eventType === "run_started"
        ) {
          setLiveAgentStatus("Checking workspace context");
        }

        const phaseStep = phaseTraceStepFromEvent(
          eventType,
          eventPayload,
          eventSequence,
        );
        if (phaseStep) {
          upsertLiveTraceStep(phaseStep);
        }

        const toolStep = toolTraceStepFromEvent(
          eventType,
          eventPayload,
          eventSequence,
        );
        if (toolStep) {
          upsertLiveTraceStep(toolStep);
        }

        const nextTodoPlan = todoPlanFromToolPayload(eventPayload);
        if (nextTodoPlan !== undefined) {
          setCurrentTodoPlan(nextTodoPlan);
        }

        if (eventType === "output_delta") {
          const delta =
            typeof eventPayload.delta === "string" ? eventPayload.delta : "";
          if (!delta) {
            appendStreamTelemetry({
              streamId: payload.streamId,
              transportType: payload.type,
              eventName,
              eventType,
              inputId: eventInputId,
              sessionId: eventSessionId,
              action: "skip_empty_delta",
              detail: "delta missing/empty",
            });
            return;
          }

          const assistantMessageId =
            activeAssistantMessageIdRef.current ??
            (eventInputId
              ? `assistant-${eventInputId}`
              : `assistant-${Date.now()}`);
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
            detail: `delta_len=${delta.length}`,
          });
          return;
        }

        if (eventType === "thinking_delta") {
          const delta =
            typeof eventPayload.delta === "string" ? eventPayload.delta : "";
          if (!delta) {
            appendStreamTelemetry({
              streamId: payload.streamId,
              transportType: payload.type,
              eventName,
              eventType,
              inputId: eventInputId,
              sessionId: eventSessionId,
              action: "skip_empty_thinking_delta",
              detail: "delta missing/empty",
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
            detail: `delta_len=${delta.length}`,
          });
          return;
        }

        if (eventType === "run_failed") {
          const detail = runFailedDetail(eventPayload);
          setChatErrorMessage(detail);
          finalizeLiveTraceSteps("error");
          if (
            liveAssistantTextRef.current ||
            liveThinkingTextRef.current ||
            liveTraceStepsRef.current.length > 0
          ) {
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
            detail,
          });
          scheduleConversationRefresh(eventSessionId, selectedWorkspaceId);
          return;
        }

        if (eventType === "run_completed") {
          const completedStatus =
            typeof eventPayload.status === "string"
              ? eventPayload.status.trim().toLowerCase()
              : "";
          finalizeLiveTraceSteps(
            completedStatus === "paused" ? "waiting" : "completed",
          );
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
            detail: "run completed",
          });
          scheduleConversationRefresh(eventSessionId, selectedWorkspaceId);
          void refreshWorkspaceData().catch(() => undefined);
        }
      },
    );

    return () => {
      unsubscribe();
    };
  }, [refreshWorkspaceData, selectedWorkspaceId]);

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
        const response =
          await window.electronAPI.workspace.listRuntimeStates(
            selectedWorkspaceId,
          );
        if (cancelled) {
          return;
        }
        if (activeStreamIdRef.current || pendingInputIdRef.current) {
          // Stream remains the source of truth while an output stream is open.
          // Polling is only a fallback when the stream is unavailable and no stream attach is pending.
          return;
        }
        const currentSessionId = activeSessionIdRef.current;
        const currentState = response.items.find(
          (item) => item.session_id === currentSessionId,
        );
        if (!currentState) {
          return;
        }
        const status = runtimeStateStatus(currentState.status);
        if (status === "BUSY" || status === "QUEUED") {
          return;
        }

        const activeStreamId = activeStreamIdRef.current;
        if (activeStreamId) {
          await closeStreamWithReason(
            activeStreamId,
            "runtime_poll_terminal_state",
          );
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
    if (usesHostedManagedCredits) {
      if (isOutOfCredits) {
        setChatErrorMessage("You're out of credits for managed usage.");
        return;
      }
      void refreshBillingState().catch(() => undefined);
    }
    if (!selectedWorkspace) {
      setChatErrorMessage("Create or select a workspace first.");
      return;
    }
    if (!isOnboardingVariant && !workspaceAppsReady) {
      setChatErrorMessage(
        workspaceBlockingReason || "Workspace apps are still starting.",
      );
      return;
    }
    if (!isOnboardingVariant && !resolvedChatModel) {
      setChatErrorMessage(
        modelSelectionUnavailableReason || "No models available.",
      );
      return;
    }
    let targetSessionId = activeSessionIdRef.current;
    if (!targetSessionId && selectedWorkspace) {
      targetSessionId = await createWorkspaceSession(
        selectedWorkspace.id,
        draftParentSessionIdRef.current,
      );
      if (targetSessionId) {
        draftParentSessionIdRef.current = null;
        setActiveSession(targetSessionId);
      }
    }
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
      detail: `workspace=${selectedWorkspace.id}`,
    });
    const currentStreamId = activeStreamIdRef.current;
    if (currentStreamId) {
      await closeStreamWithReason(
        currentStreamId,
        "send_new_message_close_previous_stream",
      );
      activeStreamIdRef.current = null;
      appendStreamTelemetry({
        streamId: currentStreamId,
        transportType: "client",
        eventName: "sendMessage",
        eventType: "close_prev_stream",
        inputId: "",
        sessionId: targetSessionId || "",
        action: "closed_previous_stream",
        detail: "before new send",
      });
    }

    try {
      const attachmentEntries = [...pendingAttachments];
      const localFiles = attachmentEntries.filter(
        (entry): entry is PendingLocalAttachmentFile =>
          entry.source === "local-file",
      );
      const explorerFiles = attachmentEntries.filter(
        (entry): entry is PendingExplorerAttachmentFile =>
          entry.source === "explorer-path",
      );

      const [stagedLocalAttachments, stagedExplorerAttachments] =
        await Promise.all([
          localFiles.length > 0
            ? window.electronAPI.workspace.stageSessionAttachments({
                workspace_id: selectedWorkspace.id,
                files: await Promise.all(
                  localFiles.map((entry) =>
                    attachmentUploadPayload(entry.file),
                  ),
                ),
              })
            : Promise.resolve({ attachments: [] }),
          explorerFiles.length > 0
            ? window.electronAPI.workspace.stageSessionAttachmentPaths({
                workspace_id: selectedWorkspace.id,
                files: explorerFiles.map((entry) => ({
                  absolute_path: entry.absolutePath,
                  name: entry.name,
                  mime_type: entry.mime_type ?? null,
                })),
              })
            : Promise.resolve({ attachments: [] }),
        ]);

      let localAttachmentIndex = 0;
      let explorerAttachmentIndex = 0;
      const stagedAttachments = attachmentEntries.map((entry) => {
        if (entry.source === "local-file") {
          const attachment =
            stagedLocalAttachments.attachments[localAttachmentIndex];
          localAttachmentIndex += 1;
          if (!attachment) {
            throw new Error("Failed to stage a dropped file attachment.");
          }
          return attachment;
        }

        const attachment =
          stagedExplorerAttachments.attachments[explorerAttachmentIndex];
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
        createdAt: new Date().toISOString(),
        attachments: stagedAttachments,
      };

      shouldAutoScrollRef.current = true;
      setMessages((prev) => [...prev, userMessage]);
      resetLiveTurn();
      setInput("");
      setPendingAttachments([]);
      setIsResponding(true);
      setLiveAgentStatus("Thinking");
      setChatErrorMessage("");
      activeAssistantMessageIdRef.current = null;
      pendingInputIdRef.current = STREAM_ATTACH_PENDING;

      const preOpenedStream =
        await window.electronAPI.workspace.openSessionOutputStream({
          sessionId: targetSessionId,
          workspaceId: selectedWorkspace.id,
          includeHistory: false,
          stopOnTerminal: true,
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
        detail: "session tail stream opened before queue",
      });

      const queued = await window.electronAPI.workspace.queueSessionInput({
        text: trimmed,
        workspace_id: selectedWorkspace.id,
        image_urls: null,
        attachments: stagedAttachments,
        session_id: targetSessionId,
        priority: 0,
        model: resolvedChatModel || null,
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
        detail: "queue response received",
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
            detail: `queue_session=${queued.session_id}`,
          });
        }
        const retargeted =
          await window.electronAPI.workspace.openSessionOutputStream({
            sessionId: queued.session_id,
            workspaceId: selectedWorkspace.id,
            inputId: queued.input_id,
            includeHistory: true,
            stopOnTerminal: true,
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
          detail: "session changed after queue",
        });
      }
    } catch (error) {
      const activeStreamId = activeStreamIdRef.current;
      if (activeStreamId) {
        await closeStreamWithReason(activeStreamId, "send_message_error").catch(
          () => undefined,
        );
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
        detail: normalizeErrorMessage(error),
      });
    }
  }

  async function pauseCurrentRun() {
    const sessionId = activeSessionIdRef.current || activeSessionId;
    if (!selectedWorkspaceId || !sessionId || isPausePending) {
      return;
    }

    const previousStatus = liveAgentStatus;
    setChatErrorMessage("");
    setLiveAgentStatus("Pausing");
    setIsPausePending(true);

    try {
      await window.electronAPI.workspace.pauseSessionRun({
        workspace_id: selectedWorkspaceId,
        session_id: sessionId,
      });
    } catch (error) {
      setIsPausePending(false);
      setLiveAgentStatus(previousStatus || "Working");
      setChatErrorMessage(normalizeErrorMessage(error));
    }
  }

  function appendPendingLocalFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    setPendingAttachments((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: pendingAttachmentId(
          `${file.name}-${file.size}-${file.lastModified}`,
        ),
        source: "local-file" as const,
        file,
      })),
    ]);
  }

  function appendPendingExplorerAttachments(
    files: ExplorerAttachmentDragPayload[],
  ) {
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
        kind: inferDraggedAttachmentKind(file.name, file.mimeType),
      })),
    ]);
  }

  function onAttachmentInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    appendPendingLocalFiles(files);
    event.target.value = "";
  }

  function removePendingAttachment(attachmentId: string) {
    setPendingAttachments((prev) =>
      prev.filter((item) => item.id !== attachmentId),
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent =
      event.nativeEvent as KeyboardEvent<HTMLTextAreaElement>["nativeEvent"] & {
        isComposing?: boolean;
        keyCode?: number;
      };
    if (
      composerIsComposingRef.current ||
      nativeEvent.isComposing === true ||
      nativeEvent.keyCode === 229
    ) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  const onComposerCompositionStart = (
    _event: CompositionEvent<HTMLTextAreaElement>,
  ) => {
    composerIsComposingRef.current = true;
  };

  const onComposerCompositionEnd = (
    _event: CompositionEvent<HTMLTextAreaElement>,
  ) => {
    composerIsComposingRef.current = false;
  };

  const assistantLabel = selectedWorkspace?.name || "Assistant";
  const assistantMode = isOnboardingVariant
    ? "workspace setup"
    : assistantMetaLabel(
        selectedWorkspace?.harness,
        runtimeConfig?.defaultModel,
      );
  const showLiveAssistantTurn =
    isResponding ||
    Boolean(liveAssistantText) ||
    Boolean(liveThinkingText) ||
    liveTraceSteps.length > 0;
  const hasMessages = messages.length > 0 || showLiveAssistantTurn;
  const streamTelemetryTail = useMemo(
    () => streamTelemetry.slice(-80).reverse(),
    [streamTelemetry],
  );
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
        name:
          attachment.source === "local-file"
            ? attachment.file.name
            : attachment.name,
        size_bytes:
          attachment.source === "local-file"
            ? attachment.file.size
            : attachment.size_bytes,
      })),
    [pendingAttachments],
  );
  const activeSessionOption = useMemo(
    () =>
      availableSessions.find(
        (session) => session.sessionId === activeSessionId,
      ) ?? null,
    [activeSessionId, availableSessions],
  );
  const activeSessionTitle =
    activeSessionOption?.title ||
    (activeSessionId
      ? defaultWorkspaceSessionTitle("workspace_session", activeSessionId)
      : "New session");
  const activeSessionDetail = activeSessionOption
    ? `${activeSessionOption.statusLabel} · ${activeSessionOption.updatedLabel}`
    : activeSessionId
      ? "Current session"
      : "Draft conversation";
  const readinessMessage =
    !selectedWorkspace || isOnboardingVariant || workspaceAppsReady
      ? ""
      : workspaceBlockingReason ||
        (isActivatingWorkspace
          ? "Preparing workspace apps..."
          : "Workspace apps are still starting.");
  const baseComposerDisabledReason = !selectedWorkspace
    ? "Select a workspace to start chatting."
    : isLoadingBootstrap || isLoadingHistory
      ? "Loading workspace context..."
      : !isOnboardingVariant && !workspaceAppsReady
        ? readinessMessage || "Workspace apps are still starting."
        : "";
  const isSignedIn = Boolean(sessionUserId(authSessionState.data));
  const holabossProxyModelsAvailable =
    isSignedIn &&
    Boolean(runtimeConfig?.authTokenPresent) &&
    Boolean((runtimeConfig?.modelProxyBaseUrl || "").trim());
  const configuredProviderModelGroups =
    runtimeConfig?.providerModelGroups ?? [];
  const visibleConfiguredProviderModelGroups = configuredProviderModelGroups
    .filter(
      (providerGroup) =>
        isSignedIn || !isHolabossProviderId(providerGroup.providerId),
    )
    .map((providerGroup) => ({
      ...providerGroup,
      pending:
        isSignedIn &&
        isHolabossProviderId(providerGroup.providerId) &&
        !holabossProxyModelsAvailable,
      models: providerGroup.models.filter((model) => {
        const normalizedToken = model.token.trim();
        if (!normalizedToken || isDeprecatedChatModel(normalizedToken)) {
          return false;
        }
        if (!runtimeModelHasChatCapability(model)) {
          return false;
        }
        if (
          isUnsupportedHolabossProxyModel(
            providerGroup.providerId,
            model.modelId || normalizedToken,
          )
        ) {
          return false;
        }
        return true;
      }),
    }))
    .filter((providerGroup) => providerGroup.models.length > 0);
  const hasConfiguredProviderCatalog =
    visibleConfiguredProviderModelGroups.length > 0;
  const hasPendingConfiguredProviderCatalog =
    visibleConfiguredProviderModelGroups.some(
      (providerGroup) => providerGroup.pending,
    );
  const providerModelLabelCounts = new Map<string, number>();
  for (const providerGroup of visibleConfiguredProviderModelGroups) {
    for (const model of providerGroup.models) {
      const modelLabel = displayModelLabel(model.modelId || model.token);
      providerModelLabelCounts.set(
        modelLabel,
        (providerModelLabelCounts.get(modelLabel) ?? 0) + 1,
      );
    }
  }
  const runtimeDefaultModel =
    runtimeConfig?.defaultModel?.trim() || DEFAULT_RUNTIME_MODEL;
  const requiresModelProviderSetup =
    !hasConfiguredProviderCatalog && !holabossProxyModelsAvailable;
  const runtimeDefaultModelAvailable =
    !requiresModelProviderSetup &&
    !hasConfiguredProviderCatalog &&
    !isClaudeChatModel(runtimeDefaultModel) &&
    (holabossProxyModelsAvailable ||
      !isHolabossProxyModel(runtimeDefaultModel));
  const availableChatModelOptionGroups: ChatModelOptionGroup[] =
    hasConfiguredProviderCatalog
      ? visibleConfiguredProviderModelGroups.map((providerGroup) => ({
          label: providerGroup.providerLabel,
          options: providerGroup.models.map((model) => {
            const modelLabel = displayModelLabel(model.modelId || model.token);
            const needsProviderPrefix =
              visibleConfiguredProviderModelGroups.length > 1 &&
              (providerModelLabelCounts.get(modelLabel) ?? 0) > 1;
            return {
              value: model.token,
              label: modelLabel,
              selectedLabel: needsProviderPrefix
                ? `${providerGroup.providerLabel} · ${modelLabel}`
                : modelLabel,
              searchText: `${providerGroup.providerLabel} ${modelLabel} ${model.token}`,
              disabled: providerGroup.pending,
              statusLabel: providerGroup.pending ? "Pending" : undefined,
            };
          }),
        }))
      : [];
  const availableChatModelOptions = hasConfiguredProviderCatalog
    ? availableChatModelOptionGroups.flatMap((group) =>
        group.options.filter((option) => !option.disabled),
      )
    : requiresModelProviderSetup
      ? []
      : Array.from(
          new Set([
            runtimeDefaultModel,
            DEFAULT_RUNTIME_MODEL,
            ...(chatModelPreference !== CHAT_MODEL_USE_RUNTIME_DEFAULT
              ? [chatModelPreference]
              : []),
            ...CHAT_MODEL_PRESETS,
          ]),
        )
          .filter(Boolean)
          .filter((model) => !isDeprecatedChatModel(model))
          .filter(
            (model) =>
              !isClaudeChatModel(model) &&
              (holabossProxyModelsAvailable || !isHolabossProxyModel(model)),
          )
          .map((model) => ({
            value: model,
            label: displayModelLabel(model),
          }));
  const normalizedModelPreference = chatModelPreference.trim();
  const modelPreferenceAvailable = hasConfiguredProviderCatalog
    ? normalizedModelPreference.length > 0 &&
      availableChatModelOptions.some(
        (option) => option.value === normalizedModelPreference,
      )
    : chatModelPreference === CHAT_MODEL_USE_RUNTIME_DEFAULT
      ? runtimeDefaultModelAvailable
      : availableChatModelOptions.some(
          (option) => option.value === normalizedModelPreference,
        );
  const effectiveChatModelPreference = hasConfiguredProviderCatalog
    ? modelPreferenceAvailable
      ? normalizedModelPreference
      : availableChatModelOptions[0]?.value || ""
    : modelPreferenceAvailable
      ? chatModelPreference
      : runtimeDefaultModelAvailable
        ? CHAT_MODEL_USE_RUNTIME_DEFAULT
        : availableChatModelOptions[0]?.value || CHAT_MODEL_USE_RUNTIME_DEFAULT;
  const resolvedChatModel = hasConfiguredProviderCatalog
    ? effectiveChatModelPreference
    : effectiveChatModelPreference === CHAT_MODEL_USE_RUNTIME_DEFAULT
      ? runtimeDefaultModelAvailable
        ? runtimeDefaultModel
        : ""
      : effectiveChatModelPreference.trim() ||
        (runtimeDefaultModelAvailable ? runtimeDefaultModel : "");
  const selectedManagedProviderGroup =
    visibleConfiguredProviderModelGroups.find((providerGroup) =>
      providerGroup.models.some((model) => model.token === resolvedChatModel),
    );
  const usesHostedManagedCredits =
    hasHostedBillingAccount &&
    (hasConfiguredProviderCatalog
      ? selectedManagedProviderGroup?.kind === "holaboss_proxy"
      : holabossProxyModelsAvailable && Boolean(resolvedChatModel));
  const modelSelectionUnavailableReason =
    availableChatModelOptions.length > 0
      ? ""
      : hasPendingConfiguredProviderCatalog
        ? "Managed models are finishing setup. Refresh runtime binding or use another provider."
        : "No models available. Configure a provider to start chatting.";
  const composerBaseDisabledReason =
    baseComposerDisabledReason ||
    (usesHostedManagedCredits && isOutOfCredits
      ? "You're out of credits for managed usage."
      : "") ||
    (!isOnboardingVariant && !resolvedChatModel
      ? modelSelectionUnavailableReason
      : "");
  const composerDisabledReason =
    composerBaseDisabledReason ||
    (isResponding ? "Current run is still in progress." : "");
  const composerDisabled = Boolean(composerDisabledReason);
  const showLowBalanceWarning =
    usesHostedManagedCredits && isLowBalance && !isOutOfCredits;
  const showOutOfCreditsWarning = usesHostedManagedCredits && isOutOfCredits;

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
  const showHistoryRestoreScreen = isLoadingHistory || isHistoryViewportPending;
  const chatScrollRange = Math.max(
    0,
    chatScrollMetrics.scrollHeight - chatScrollMetrics.clientHeight,
  );
  const showCustomChatScrollbar =
    !showHistoryRestoreScreen &&
    hasMessages &&
    chatScrollMetrics.clientHeight > 0 &&
    chatScrollRange > 1;
  const chatScrollbarRailInset =
    composerBlockHeight > 0 ? composerBlockHeight / 2 : 0;
  const chatScrollbarRailHeight = chatScrollMetrics.clientHeight;
  const chatScrollbarThumbHeight = showCustomChatScrollbar
    ? Math.max(
        CHAT_SCROLLBAR_MIN_THUMB_HEIGHT_PX,
        Math.min(
          chatScrollbarRailHeight,
          (chatScrollMetrics.clientHeight / chatScrollMetrics.scrollHeight) *
            chatScrollbarRailHeight,
        ),
      )
    : 0;
  const chatScrollbarThumbTravel = Math.max(
    0,
    chatScrollbarRailHeight - chatScrollbarThumbHeight,
  );
  const chatScrollbarThumbOffset = showCustomChatScrollbar
    ? chatScrollRange > 0
      ? (chatScrollMetrics.scrollTop / chatScrollRange) *
        chatScrollbarThumbTravel
      : 0
    : 0;

  useEffect(() => {
    if (showCustomChatScrollbar) {
      return;
    }
    clearChatScrollbarDragState();
  }, [showCustomChatScrollbar]);

  useEffect(() => {
    if (!hasMessages) {
      setChatScrollMetrics({
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
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
  }, [
    composerBlockHeight,
    hasMessages,
    liveAssistantText,
    liveThinkingText,
    liveTraceSteps,
    messages,
  ]);

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
      setComposerBlockHeight(
        Math.round(composerBlock.getBoundingClientRect().height),
      );
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

  const openSessionFromPicker = (sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (
      !normalizedSessionId ||
      normalizedSessionId === activeSessionIdRef.current
    ) {
      return;
    }
    setLocalSessionOpenRequest({
      sessionId: normalizedSessionId,
      requestKey: Date.now(),
    });
  };

  const requestDraftSessionFromPicker = () => {
    if (onRequestCreateSession) {
      onRequestCreateSession();
      return;
    }
    setLocalSessionOpenRequest({
      sessionId: "",
      mode: "draft",
      parentSessionId: null,
      requestKey: Date.now(),
    });
  };

  return (
    <PaneCard
      className={
        isOnboardingVariant
          ? "w-full shadow-md border-[rgba(247,90,84,0.2)]"
          : "w-full shadow-md"
      }
    >
      <div className="relative flex h-full min-h-0 min-w-0 flex-col">
        <div className="theme-chat-composer-glow pointer-events-none absolute inset-x-8 bottom-0 h-44 rounded-full blur-2xl" />

        {isOnboardingVariant && selectedWorkspace ? (
          <div className="shrink-0 px-4 pt-4 sm:px-5">
            <div className="bg-muted overflow-hidden rounded-[22px] border border-[rgba(247,90,84,0.2)] shadow-[0_24px_60px_rgba(233,117,109,0.08)]">
              <div className="bg-[radial-gradient(circle_at_top_left,rgba(247,90,84,0.12),transparent_42%),radial-gradient(circle_at_92%_12%,rgba(247,170,126,0.12),transparent_36%)] px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(206,92,84,0.88)]">
                      Workspace onboarding
                    </div>
                    <div className="mt-2 text-[22px] font-semibold tracking-[-0.04em] text-foreground">
                      {selectedWorkspace.name.trim() || "Workspace setup"}
                    </div>
                  </div>

                  <div
                    className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${onboardingStatusTone(
                      selectedWorkspace.onboarding_status,
                    )}`}
                  >
                    {onboardingStatusLabel(selectedWorkspace.onboarding_status)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {!isOnboardingVariant ? (
          <div className="shrink-0 border-b border-border/45 px-4 py-2.5 sm:px-5">
            <SessionSelector
              activeSessionId={activeSessionId}
              activeTitle={activeSessionTitle}
              activeDetail={activeSessionDetail}
              sessions={availableSessions}
              isLoading={isLoadingAvailableSessions}
              errorMessage={availableSessionsError}
              onSelectSession={openSessionFromPicker}
              onOpenInbox={onOpenInbox}
              inboxUnreadCount={inboxUnreadCount}
              onCreateSession={requestDraftSessionFromPicker}
            />
          </div>
        ) : null}

        {showLowBalanceWarning || showOutOfCreditsWarning ? (
          <div className="shrink-0 px-4 pt-3 sm:px-5">
            <div className="bg-muted/72 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border/55 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Hosted credits
                </div>
                <div className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  {showOutOfCreditsWarning
                    ? "You're out of credits for managed usage."
                    : "Credits are running low. Add more on web to avoid interruptions."}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openExternalUrl(billingLinks?.addCreditsUrl)}
                  className="rounded-full border-primary/35 bg-primary/10 text-primary hover:bg-primary/16"
                >
                  Add credits
                </Button>
                {showOutOfCreditsWarning ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      openExternalUrl(billingLinks?.billingPageUrl)
                    }
                    className="rounded-full"
                  >
                    Manage on web
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {chatErrorMessage || verboseTelemetryEnabled ? (
          <div className="shrink-0 px-4 pt-3 sm:px-5">
            {chatErrorMessage ? (
              <div className="theme-chat-system-bubble rounded-[14px] border px-3 py-2 text-[11px]">
                {chatErrorMessage}
              </div>
            ) : null}

            {verboseTelemetryEnabled ? (
              <div className="bg-muted mt-3 rounded-[14px] border border-border/45 px-3 py-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] tracking-[0.12em] text-muted-foreground">
                    Stream telemetry ({streamTelemetry.length})
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setStreamTelemetry([])}
                    className="text-[10px]"
                  >
                    Clear
                  </Button>
                </div>
                <div className="bg-muted max-h-36 overflow-y-auto rounded border border-border/35 p-2 font-mono text-[10px] text-muted-foreground">
                  {streamTelemetryTail.length === 0 ? (
                    <div className="text-muted-foreground">
                      No stream events yet.
                    </div>
                  ) : (
                    streamTelemetryTail.map((entry) => (
                      <div
                        key={entry.id}
                        className="whitespace-pre-wrap break-all"
                      >
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
              onWheelCapture={(event) => {
                if (event.deltaY < 0) {
                  shouldAutoScrollRef.current = false;
                }
              }}
              onScroll={(event) => {
                const { currentTarget } = event;
                const scrolledUp =
                  currentTarget.scrollTop < lastChatScrollTopRef.current;
                const nearBottom = isNearChatBottom(currentTarget);
                shouldAutoScrollRef.current = scrolledUp ? false : nearBottom;
                syncChatScrollMetrics(currentTarget);
              }}
              className={`chat-scrollbar-hidden h-full min-h-0 overflow-x-hidden overflow-y-auto ${hasMessages ? "" : "flex items-center justify-center"}`}
            >
              {hasMessages ? (
                <div
                  ref={messagesContentRef}
                  className={`flex min-w-0 w-full flex-col gap-7 px-6 pb-3 pt-5 ${
                    showHistoryRestoreScreen ? "invisible" : ""
                  }`}
                >
                  {messages.map((message) =>
                    message.role === "user" ? (
                      <UserTurn
                        key={message.id}
                        text={message.text}
                        createdAt={message.createdAt}
                        attachments={message.attachments ?? []}
                        onLinkClick={onOpenLinkInBrowser}
                      />
                    ) : (
                      <AssistantTurn
                        key={message.id}
                        label={assistantLabel}
                        mode={assistantMode}
                        text={message.text}
                        thinkingText={message.thinkingText}
                        thinkingCollapsed={
                          collapsedThinkingByMessageId[message.id] ?? true
                        }
                        onToggleThinking={() => toggleThinkingPanel(message.id)}
                        traceSteps={message.traceSteps ?? []}
                        memoryProposals={message.memoryProposals ?? []}
                        outputs={message.outputs ?? []}
                        sessionOutputs={sessionOutputs}
                        memoryProposalAction={memoryProposalAction}
                        editingMemoryProposalId={editingMemoryProposalId}
                        memoryProposalDrafts={memoryProposalDrafts}
                        onEditMemoryProposal={(proposalId) => {
                          setEditingMemoryProposalId((current) => {
                            const next =
                              current === proposalId ? null : proposalId;
                            if (next === proposalId) {
                              const proposal = (
                                message.memoryProposals ?? []
                              ).find((item) => item.proposal_id === proposalId);
                              if (proposal) {
                                setMemoryProposalDrafts((prev) => ({
                                  ...prev,
                                  [proposalId]:
                                    prev[proposalId] ?? proposal.summary,
                                }));
                              }
                            }
                            return next;
                          });
                        }}
                        onMemoryProposalDraftChange={updateMemoryProposalDraft}
                        onAcceptMemoryProposal={handleAcceptMemoryProposal}
                        onDismissMemoryProposal={handleDismissMemoryProposal}
                        onOpenOutput={onOpenOutput}
                        onOpenAllArtifacts={() => {
                          setArtifactBrowserFilter("all");
                          setArtifactBrowserOpen(true);
                        }}
                        collapsedTraceByStepId={collapsedTraceByStepId}
                        onToggleTraceStep={toggleTraceStep}
                        onLinkClick={onOpenLinkInBrowser}
                      />
                    ),
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
                      memoryProposals={[]}
                      outputs={[]}
                      sessionOutputs={sessionOutputs}
                      memoryProposalAction={memoryProposalAction}
                      editingMemoryProposalId={editingMemoryProposalId}
                      memoryProposalDrafts={memoryProposalDrafts}
                      onEditMemoryProposal={() => undefined}
                      onMemoryProposalDraftChange={updateMemoryProposalDraft}
                      onAcceptMemoryProposal={handleAcceptMemoryProposal}
                      onDismissMemoryProposal={handleDismissMemoryProposal}
                      onOpenOutput={onOpenOutput}
                      onOpenAllArtifacts={() => {
                        setArtifactBrowserFilter("all");
                        setArtifactBrowserOpen(true);
                      }}
                      collapsedTraceByStepId={collapsedTraceByStepId}
                      onToggleTraceStep={toggleTraceStep}
                      onLinkClick={onOpenLinkInBrowser}
                      live
                      status={
                        liveAgentStatus || (isResponding ? "Working" : "")
                      }
                    />
                  ) : null}
                </div>
              ) : (
                <div
                  className={`w-full px-4 pb-10 pt-10 sm:px-5 ${
                    showHistoryRestoreScreen ? "invisible" : ""
                  }`}
                >
                  <div className="mx-auto mb-6 max-w-[560px] text-center">
                    <div className="text-xl font-medium text-foreground">
                      {isLoadingBootstrap || isLoadingHistory
                        ? "Loading workspace context"
                        : isOnboardingVariant
                          ? "Complete workspace onboarding"
                          : "Ask the workspace agent"}
                    </div>
                    <div className="mt-3 text-[13px] leading-7 text-muted-foreground/68">
                      {selectedWorkspace
                        ? readinessMessage ||
                          (isOnboardingVariant
                            ? "Follow the setup conversation here. The agent will use the workspace guide to ask only onboarding questions and capture durable setup facts."
                            : "Messages are queued into the local runtime workspace flow, then streamed back from the live session output feed.")
                        : "Pick a template, create a workspace, and then send the first instruction."}
                    </div>
                  </div>
                  <form onSubmit={onSubmit} className="w-full">
                    <div className="space-y-3">
                      {currentTodoPlan ? (
                        <CurrentTodoPanel
                          todoPlan={currentTodoPlan}
                          expanded={todoPanelExpanded}
                          onToggle={() =>
                            setTodoPanelExpanded((value) => !value)
                          }
                        />
                      ) : null}
                      <Composer
                        input={input}
                        attachments={pendingAttachmentItems}
                        isResponding={isResponding}
                        pausePending={isPausePending}
                        pauseDisabled={
                          pendingInputIdRef.current === STREAM_ATTACH_PENDING
                        }
                        disabled={composerDisabled}
                        disabledReason={composerDisabledReason}
                        selectedModel={effectiveChatModelPreference}
                        resolvedModelLabel={
                          resolvedChatModel || modelSelectionUnavailableReason
                        }
                        runtimeDefaultModelLabel={runtimeDefaultModel}
                        modelOptions={availableChatModelOptions}
                        modelOptionGroups={availableChatModelOptionGroups}
                        runtimeDefaultModelAvailable={
                          runtimeDefaultModelAvailable
                        }
                        modelSelectionUnavailableReason={
                          modelSelectionUnavailableReason
                        }
                        placeholder={textareaPlaceholder}
                        showModelSelector={!isOnboardingVariant}
                        onModelChange={setChatModelPreference}
                        onOpenModelProviders={() =>
                          void window.electronAPI.ui.openSettingsPane(
                            "providers",
                          )
                        }
                        textareaRef={textareaRef}
                        fileInputRef={fileInputRef}
                        onChange={setInput}
                        onKeyDown={onComposerKeyDown}
                        onCompositionStart={onComposerCompositionStart}
                        onCompositionEnd={onComposerCompositionEnd}
                        onAttachmentInputChange={onAttachmentInputChange}
                        onPause={pauseCurrentRun}
                        onAddDroppedFiles={appendPendingLocalFiles}
                        onAddExplorerAttachments={
                          appendPendingExplorerAttachments
                        }
                        onRemoveAttachment={removePendingAttachment}
                      />
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>

          {showCustomChatScrollbar ? (
            <div className="pointer-events-none absolute inset-y-0 right-1 z-20 w-4">
              <div
                className="pointer-events-auto absolute inset-x-0 touch-none"
                style={{
                  top: `${chatScrollbarRailInset}px`,
                  height: `${chatScrollbarRailHeight}px`,
                }}
                onPointerDown={handleChatScrollbarPointerDown}
                onPointerMove={handleChatScrollbarPointerMove}
                onPointerUp={handleChatScrollbarPointerUp}
                onPointerCancel={handleChatScrollbarPointerUp}
                onLostPointerCapture={() => {
                  clearChatScrollbarDragState();
                }}
              >
                <div
                  className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 rounded-full"
                  style={{
                    background:
                      "color-mix(in oklch, var(--foreground) 10%, transparent)",
                  }}
                />
                <div
                  ref={chatScrollbarThumbRef}
                  data-chat-scrollbar-thumb="true"
                  className="absolute left-1/2 w-4 -translate-x-1/2 rounded-full cursor-grab active:cursor-grabbing"
                  style={{
                    top: `${chatScrollbarThumbOffset}px`,
                    height: `${chatScrollbarThumbHeight}px`,
                  }}
                >
                  <div
                    className="absolute left-1/2 top-0 h-full w-[3px] -translate-x-1/2 rounded-full"
                    style={{
                      background:
                        "color-mix(in oklch, var(--primary) 28%, transparent)",
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {hasMessages ? (
            <div
              ref={composerBlockRef}
              className={`shrink-0 px-6 pb-5 pt-3 ${
                showHistoryRestoreScreen ? "invisible" : ""
              }`}
            >
              <form onSubmit={onSubmit} className="w-full">
                <div className="space-y-3">
                  {currentTodoPlan ? (
                    <CurrentTodoPanel
                      todoPlan={currentTodoPlan}
                      expanded={todoPanelExpanded}
                      onToggle={() => setTodoPanelExpanded((value) => !value)}
                    />
                  ) : null}
                  <Composer
                    input={input}
                    attachments={pendingAttachmentItems}
                    isResponding={isResponding}
                    pausePending={isPausePending}
                    pauseDisabled={
                      pendingInputIdRef.current === STREAM_ATTACH_PENDING
                    }
                    disabled={composerDisabled}
                    disabledReason={composerDisabledReason}
                    selectedModel={effectiveChatModelPreference}
                    resolvedModelLabel={
                      resolvedChatModel || modelSelectionUnavailableReason
                    }
                    runtimeDefaultModelLabel={runtimeDefaultModel}
                    modelOptions={availableChatModelOptions}
                    modelOptionGroups={availableChatModelOptionGroups}
                    runtimeDefaultModelAvailable={runtimeDefaultModelAvailable}
                    modelSelectionUnavailableReason={
                      modelSelectionUnavailableReason
                    }
                    placeholder={textareaPlaceholder}
                    showModelSelector={!isOnboardingVariant}
                    onModelChange={setChatModelPreference}
                    onOpenModelProviders={() =>
                      void window.electronAPI.ui.openSettingsPane("providers")
                    }
                    textareaRef={textareaRef}
                    fileInputRef={fileInputRef}
                    onChange={setInput}
                    onKeyDown={onComposerKeyDown}
                    onCompositionStart={onComposerCompositionStart}
                    onCompositionEnd={onComposerCompositionEnd}
                    onAttachmentInputChange={onAttachmentInputChange}
                    onPause={pauseCurrentRun}
                    onAddDroppedFiles={appendPendingLocalFiles}
                    onAddExplorerAttachments={appendPendingExplorerAttachments}
                    onRemoveAttachment={removePendingAttachment}
                  />
                </div>
              </form>
            </div>
          ) : null}

          {showHistoryRestoreScreen ? <HistoryRestoreSkeleton /> : null}

          <ArtifactBrowserModal
            open={artifactBrowserOpen}
            filter={artifactBrowserFilter}
            outputs={sessionOutputs}
            onClose={() => setArtifactBrowserOpen(false)}
            onFilterChange={setArtifactBrowserFilter}
            onOpenOutput={onOpenOutput}
          />
        </div>
      </div>
    </PaneCard>
  );
}

interface SessionSelectorProps {
  activeSessionId: string;
  activeTitle: string;
  activeDetail: string;
  sessions: ChatSessionOption[];
  isLoading: boolean;
  errorMessage: string;
  onSelectSession: (sessionId: string) => void;
  onOpenInbox?: () => void;
  inboxUnreadCount: number;
  onCreateSession: () => void;
}

function SessionSelector({
  activeSessionId,
  activeTitle,
  activeDetail,
  sessions,
  isLoading,
  errorMessage,
  onSelectSession,
  onOpenInbox,
  inboxUnreadCount,
  onCreateSession,
}: SessionSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const activeSession =
    sessions.find((session) => session.sessionId === activeSessionId) ?? null;
  const activeIndicator = activeSession
    ? sessionStatusIndicator(activeSession.statusLabel)
    : {
        className: "text-muted-foreground",
        icon: <PencilLine size={12} />,
      };
  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return sessions;
    }
    return sessions.filter((session) =>
      session.searchText.toLowerCase().includes(normalizedQuery),
    );
  }, [query, sessions]);

  return (
    <div className="flex items-center justify-between gap-2">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setQuery("");
          }
        }}
      >
        <div className="min-w-0 flex-1">
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className="w-full min-w-0 justify-start"
                aria-label="Select agent session"
                title={`${activeTitle} · ${activeDetail}`}
              />
            }
          >
            <span
              className={`grid size-4 shrink-0 place-items-center ${activeIndicator.className}`}
            >
              {activeIndicator.icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-start font-medium text-foreground">
              {activeTitle}
            </span>
            <ChevronDown
              size={12}
              className={`shrink-0 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </PopoverTrigger>
        </div>
        <PopoverContent align="start" className="w-[300px] p-0">
          <div className="border-b border-border/40 p-2">
            <div className="relative flex items-center rounded-[10px] border border-border/40 bg-muted/35 px-2.5 transition-colors focus-within:border-border/55 focus-within:bg-background/70">
              <Search size={13} className="shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search sessions..."
                className="embedded-input h-8 w-full bg-transparent pl-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-[320px] overflow-y-auto p-1.5">
            {isLoading ? (
              <div className="px-3 py-3 text-[12px] text-muted-foreground">
                Loading sessions...
              </div>
            ) : errorMessage ? (
              <div className="px-3 py-3 text-[12px] text-destructive">
                {errorMessage}
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-muted-foreground">
                {query.trim()
                  ? "No matching sessions."
                  : "No saved sessions yet."}
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isActive = session.sessionId === activeSessionId;
                const indicator = sessionStatusIndicator(session.statusLabel);
                return (
                  <button
                    key={session.sessionId}
                    type="button"
                    onClick={() => {
                      onSelectSession(session.sessionId);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    }`}
                    title={`${session.title} · ${session.statusLabel} · ${session.updatedLabel}`}
                  >
                    <span
                      className={`grid size-4 shrink-0 place-items-center ${indicator.className}`}
                    >
                      {indicator.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-current">
                        {session.title}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {session.statusLabel}
                      </div>
                    </div>
                    {isActive ? (
                      <Check size={13} className="shrink-0 text-primary" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex shrink-0 items-center gap-1">
        {onOpenInbox ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setOpen(false);
              setQuery("");
              onOpenInbox();
            }}
            aria-label="Show inbox"
            className="relative rounded-lg text-muted-foreground hover:text-foreground"
          >
            <Inbox size={15} />
            {inboxUnreadCount > 0 ? (
              <span className="absolute right-1.5 top-1.5 size-2 rounded-full border border-card bg-destructive" />
            ) : null}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            setOpen(false);
            setQuery("");
            onCreateSession();
          }}
          aria-label="Create new session"
          className="rounded-lg text-muted-foreground hover:text-foreground"
        >
          <Plus size={15} />
        </Button>
      </div>
    </div>
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
  pausePending: boolean;
  pauseDisabled: boolean;
  disabled: boolean;
  disabledReason?: string;
  selectedModel: string;
  resolvedModelLabel: string;
  runtimeDefaultModelLabel: string;
  modelOptions: ChatModelOption[];
  modelOptionGroups: ChatModelOptionGroup[];
  runtimeDefaultModelAvailable: boolean;
  modelSelectionUnavailableReason: string;
  placeholder: string;
  showModelSelector: boolean;
  onModelChange: (value: string) => void;
  onOpenModelProviders: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  onAttachmentInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPause: () => void;
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
  createdAt,
  attachments,
  onLinkClick,
}: {
  text: string;
  createdAt?: string;
  attachments: ChatAttachment[];
  onLinkClick?: (url: string) => void;
}) {
  const [copyFeedbackVisible, setCopyFeedbackVisible] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);
  const timeLabel = chatMessageTimeLabel(createdAt);
  const canCopy = text.trim().length > 0;

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (!canCopy) {
      return;
    }

    try {
      await copyTextToClipboard(text);
    } catch {
      return;
    }
    setCopyFeedbackVisible(true);
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyFeedbackVisible(false);
      copyResetTimerRef.current = null;
    }, 1600);
  };

  return (
    <div className="group/user-turn flex min-w-0 justify-end">
      <div className="flex min-w-0 max-w-[420px] flex-col items-end gap-2 sm:max-w-[560px] lg:max-w-[680px]">
        {text ? (
          <div className="theme-chat-user-bubble inline-flex min-w-0 max-w-full rounded-[18px] border px-4 py-3 text-foreground/95">
            <SimpleMarkdown
              className="chat-markdown chat-user-markdown max-w-full"
              onLinkClick={onLinkClick}
            >
              {text}
            </SimpleMarkdown>
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <AttachmentList attachments={attachments} className="justify-end" />
        ) : null}
        {canCopy || timeLabel ? (
          <div className="flex min-h-6 items-center justify-end gap-2 pr-1 text-[11px] text-muted-foreground/72 opacity-0 pointer-events-none transition duration-150 group-hover/user-turn:opacity-100 group-hover/user-turn:pointer-events-auto group-focus-within/user-turn:opacity-100 group-focus-within/user-turn:pointer-events-auto">
            {canCopy ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={
                  copyFeedbackVisible
                    ? "Copied user message"
                    : "Copy user message"
                }
                onClick={() => {
                  void handleCopy();
                }}
                className="size-6 rounded-[10px] text-muted-foreground/72 hover:bg-foreground/6 hover:text-foreground"
              >
                {copyFeedbackVisible ? (
                  <Check size={13} strokeWidth={1.9} />
                ) : (
                  <Copy size={13} strokeWidth={1.9} />
                )}
              </Button>
            ) : null}
            {timeLabel ? (
              <span className="select-none tabular-nums">{timeLabel}</span>
            ) : null}
          </div>
        ) : null}
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
  memoryProposals,
  outputs,
  sessionOutputs,
  memoryProposalAction,
  editingMemoryProposalId,
  memoryProposalDrafts,
  onEditMemoryProposal,
  onMemoryProposalDraftChange,
  onAcceptMemoryProposal,
  onDismissMemoryProposal,
  onOpenOutput,
  onOpenAllArtifacts,
  collapsedTraceByStepId,
  onToggleTraceStep,
  onLinkClick,
  status = "",
  live = false,
}: {
  label: string;
  mode: string;
  text: string;
  thinkingText?: string;
  thinkingCollapsed: boolean;
  onToggleThinking: () => void;
  traceSteps: ChatTraceStep[];
  memoryProposals: MemoryUpdateProposalRecordPayload[];
  outputs: WorkspaceOutputRecordPayload[];
  sessionOutputs: WorkspaceOutputRecordPayload[];
  memoryProposalAction: {
    proposalId: string;
    action: "accept" | "dismiss";
  } | null;
  editingMemoryProposalId: string | null;
  memoryProposalDrafts: Record<string, string>;
  onEditMemoryProposal: (proposalId: string) => void;
  onMemoryProposalDraftChange: (proposalId: string, value: string) => void;
  onAcceptMemoryProposal: (proposal: MemoryUpdateProposalRecordPayload) => void;
  onDismissMemoryProposal: (
    proposal: MemoryUpdateProposalRecordPayload,
  ) => void;
  onOpenOutput?: (output: WorkspaceOutputRecordPayload) => void;
  onOpenAllArtifacts: () => void;
  collapsedTraceByStepId: Record<string, boolean>;
  onToggleTraceStep: (stepId: string) => void;
  onLinkClick?: (url: string) => void;
  status?: string;
  live?: boolean;
}) {
  const normalizedStatus = status.replace(/\.+$/, "").trim();
  const showStatusPlaceholder =
    Boolean(normalizedStatus) &&
    !text &&
    traceSteps.length === 0 &&
    !thinkingText;

  return (
    <div className="flex min-w-0 justify-start">
      <article className="min-w-0 flex-1">
        {showStatusPlaceholder ? (
          <div
            aria-live="polite"
            className="inline-flex items-baseline gap-0.5 text-[12px] leading-6 text-muted-foreground/72"
          >
            <span>{normalizedStatus}</span>
            <LiveStatusEllipsis />
          </div>
        ) : null}

        {traceSteps.length > 0 ? (
          <TraceStepGroup
            steps={traceSteps}
            collapsedByStepId={collapsedTraceByStepId}
            onToggleStep={onToggleTraceStep}
            live={live}
            liveOutputStarted={live && Boolean(text)}
          />
        ) : null}

        {thinkingText ? (
          <ThinkingPanel
            text={thinkingText}
            collapsed={thinkingCollapsed}
            onToggle={onToggleThinking}
            live={live}
          />
        ) : null}

        {text ? (
          <SimpleMarkdown
            className="chat-markdown chat-assistant-markdown mt-2 max-w-full text-foreground"
            onLinkClick={onLinkClick}
          >
            {text}
          </SimpleMarkdown>
        ) : null}

        {memoryProposals.length > 0 ? (
          <AssistantTurnMemoryProposals
            proposals={memoryProposals}
            proposalAction={memoryProposalAction}
            editingProposalId={editingMemoryProposalId}
            drafts={memoryProposalDrafts}
            onEditProposal={onEditMemoryProposal}
            onDraftChange={onMemoryProposalDraftChange}
            onAcceptProposal={onAcceptMemoryProposal}
            onDismissProposal={onDismissMemoryProposal}
          />
        ) : null}

        {outputs.length > 0 ? (
          <AssistantTurnOutputs
            outputs={outputs}
            sessionOutputs={sessionOutputs}
            onOpenOutput={onOpenOutput}
            onOpenAllArtifacts={onOpenAllArtifacts}
          />
        ) : null}
      </article>
    </div>
  );
}

function OutputArtifactIcon({
  output,
}: {
  output: WorkspaceOutputRecordPayload;
}) {
  const filter = outputBrowserFilterForOutput(output);
  if (filter === "images") {
    return <ImageIcon size={16} className="shrink-0 text-primary/72" />;
  }
  if (filter === "apps") {
    return <Waypoints size={16} className="shrink-0 text-primary/72" />;
  }
  return <FileText size={16} className="shrink-0 text-primary/72" />;
}

function HistoryRestoreSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading conversation"
      className="absolute inset-0 z-30 overflow-hidden px-6 pb-5 pt-5"
    >
      <div className="flex h-full flex-col">
        <div className="animate-pulse space-y-6">
          <div className="flex items-start justify-between gap-6">
            <div className="h-5 w-28 rounded-md bg-muted/70" />
            <div className="h-11 w-52 rounded-2xl bg-muted/70" />
          </div>
          <div className="space-y-3 px-3">
            <div className="flex items-center gap-2">
              <div className="h-5 w-6 rounded-md bg-muted/70" />
              <div className="h-5 w-14 rounded-md bg-muted/70" />
            </div>
            <div className="h-5 w-full rounded-md bg-muted/70" />
            <div className="h-5 w-full rounded-md bg-muted/70" />
            <div className="h-5 w-[42%] rounded-md bg-muted/70" />
          </div>
        </div>

        <div className="mt-auto">
          <div className="rounded-[22px] border border-border/35 bg-muted/50 p-4">
            <div className="animate-pulse space-y-3">
              <div className="h-6 w-full rounded-lg bg-muted/80" />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-full bg-muted/80" />
                  <div className="size-8 rounded-full bg-muted/80" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-full bg-muted/80" />
                  <div className="size-8 rounded-full bg-muted/80" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssistantTurnOutputs({
  outputs,
  sessionOutputs,
  onOpenOutput,
  onOpenAllArtifacts,
}: {
  outputs: WorkspaceOutputRecordPayload[];
  sessionOutputs: WorkspaceOutputRecordPayload[];
  onOpenOutput?: (output: WorkspaceOutputRecordPayload) => void;
  onOpenAllArtifacts: () => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {outputs.map((output) => (
        <button
          key={output.id}
          type="button"
          onClick={() => onOpenOutput?.(output)}
          className="flex max-w-[360px] items-center gap-3 rounded-xl border border-border/50 bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-card"
          disabled={!onOpenOutput}
        >
          <OutputArtifactIcon output={output} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-foreground">
              {output.title || "Untitled artifact"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {outputSecondaryLabel(output)}
            </div>
          </div>
        </button>
      ))}

      {sessionOutputs.length > 1 ? (
        <button
          type="button"
          onClick={onOpenAllArtifacts}
          className="flex max-w-[360px] items-center gap-3 rounded-xl border border-border/50 px-3.5 py-2.5 text-left text-muted-foreground transition-colors hover:bg-accent"
        >
          <FileText size={15} className="shrink-0" />
          <span className="text-[13px]">
            View all artifacts ({sessionOutputs.length})
          </span>
        </button>
      ) : null}
    </div>
  );
}

function CurrentTodoPanel({
  todoPlan,
  expanded,
  onToggle,
}: {
  todoPlan: ChatTodoPlan;
  expanded: boolean;
  onToggle: () => void;
}) {
  const visiblePhases = visibleTodoPhases(todoPlan.phases);
  const totalTaskCount = todoTaskCount(visiblePhases);
  const remainingTaskCount = todoRemainingTaskCount(todoPlan.phases);
  const activeEntry = currentTodoEntry(todoPlan.phases);
  const latestCompletedEntry = latestCompletedTodoEntry(todoPlan.phases);
  const currentTaskPosition = currentTodoPosition(visiblePhases);
  const summaryLabel = activeEntry
    ? activeEntry.task.content
    : latestCompletedEntry?.task.content ||
      "All tracked todo items are complete.";
  const progressLabel =
    totalTaskCount > 0 ? `${currentTaskPosition}/${totalTaskCount}` : "0/0";

  return (
    <div className="overflow-hidden rounded-[18px] border border-border/35 bg-muted/50">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-background/30"
      >
        <div
          className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full ${
            remainingTaskCount > 0
              ? "text-muted-foreground"
              : "text-emerald-500"
          }`}
        >
          {remainingTaskCount > 0 ? (
            <Clock3 size={13} className="shrink-0" />
          ) : (
            <Check size={13} className="shrink-0" />
          )}
        </div>
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {summaryLabel}
        </div>
        <div className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
          {progressLabel}
        </div>
        <ChevronDown
          size={14}
          className={`shrink-0 text-muted-foreground transition ${expanded ? "rotate-0" : "-rotate-90"}`}
        />
      </button>

      {expanded ? (
        <div className="border-t border-border/20 px-3 py-3">
          <div className="space-y-3">
            {visiblePhases.map((phase) => {
              const phaseCompletedCount = phase.tasks.filter(
                (task) =>
                  task.status === "completed" || task.status === "abandoned",
              ).length;
              return (
                <div
                  key={phase.id}
                  className="rounded-[16px] border border-border/25 bg-muted/50 px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-medium text-foreground">
                      {phase.name}
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      {phaseCompletedCount}/{phase.tasks.length} complete
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {phase.tasks.map((task) => {
                      const isActiveTask = activeEntry?.task.id === task.id;
                      const hasVisibleDetails =
                        isActiveTask && Boolean(task.details);
                      return (
                        <div
                          key={task.id}
                          className={`flex gap-3 text-[12px] leading-5 ${hasVisibleDetails ? "items-start" : "items-center"}`}
                        >
                          <TodoStatusIcon status={task.status} />
                          <div className="min-w-0 flex-1">
                            <div className="text-foreground">
                              {task.content}
                            </div>
                            {hasVisibleDetails ? (
                              <div className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">
                                {task.details}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function memoryProposalStateLabel(state: MemoryUpdateProposalState) {
  switch (state) {
    case "accepted":
      return "Saved";
    case "dismissed":
      return "Dismissed";
    default:
      return "Review";
  }
}

function AssistantTurnMemoryProposals({
  proposals,
  proposalAction,
  editingProposalId,
  drafts,
  onEditProposal,
  onDraftChange,
  onAcceptProposal,
  onDismissProposal,
}: {
  proposals: MemoryUpdateProposalRecordPayload[];
  proposalAction: { proposalId: string; action: "accept" | "dismiss" } | null;
  editingProposalId: string | null;
  drafts: Record<string, string>;
  onEditProposal: (proposalId: string) => void;
  onDraftChange: (proposalId: string, value: string) => void;
  onAcceptProposal: (proposal: MemoryUpdateProposalRecordPayload) => void;
  onDismissProposal: (proposal: MemoryUpdateProposalRecordPayload) => void;
}) {
  return (
    <div className="mt-4 grid gap-3">
      {proposals.map((proposal) => {
        const isPending = proposal.state === "pending";
        const isEditing = editingProposalId === proposal.proposal_id;
        const isActing = proposalAction?.proposalId === proposal.proposal_id;
        const draftValue = drafts[proposal.proposal_id] ?? proposal.summary;

        return (
          <article
            key={proposal.proposal_id}
            className="bg-card rounded-[22px] border border-border/35 px-4 py-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Lightbulb size={15} className="shrink-0 text-primary/72" />
                  <span>{proposal.title}</span>
                </div>
                {isEditing ? (
                  <textarea
                    value={draftValue}
                    onChange={(event) =>
                      onDraftChange(proposal.proposal_id, event.target.value)
                    }
                    className="bg-muted mt-3 min-h-[86px] w-full rounded-[16px] border border-border/45 px-3 py-2 text-sm leading-6 text-foreground outline-none transition focus:border-primary/40"
                  />
                ) : (
                  <div className="mt-3 text-sm leading-6 text-muted-foreground">
                    {proposal.summary}
                  </div>
                )}
                {proposal.evidence ? (
                  <div className="mt-3 text-[12px] leading-5 text-muted-foreground/82">
                    {proposal.evidence}
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 items-start gap-2">
                <Badge variant="outline" className="uppercase">
                  {memoryProposalStateLabel(proposal.state)}
                </Badge>
                {isPending ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => onEditProposal(proposal.proposal_id)}
                    className="rounded-[14px]"
                    aria-label="Edit memory proposal"
                  >
                    <PencilLine size={14} />
                  </Button>
                ) : null}
              </div>
            </div>

            {isPending ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => onDismissProposal(proposal)}
                  disabled={isActing}
                  className="rounded-2xl"
                >
                  {isActing && proposalAction?.action === "dismiss" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <X size={12} />
                  )}
                  <span>Dismiss</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => onAcceptProposal(proposal)}
                  disabled={isActing}
                  className="rounded-2xl border-primary/40 bg-primary/10 text-primary hover:bg-primary/14"
                >
                  {isActing && proposalAction?.action === "accept" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Check size={12} />
                  )}
                  <span>Accept</span>
                </Button>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function ArtifactBrowserModal({
  open,
  filter,
  outputs,
  onClose,
  onFilterChange,
  onOpenOutput,
}: {
  open: boolean;
  filter: ArtifactBrowserFilter;
  outputs: WorkspaceOutputRecordPayload[];
  onClose: () => void;
  onFilterChange: (nextFilter: ArtifactBrowserFilter) => void;
  onOpenOutput?: (output: WorkspaceOutputRecordPayload) => void;
}) {
  if (!open) {
    return null;
  }

  const filterLabels: Array<{ id: ArtifactBrowserFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "documents", label: "Documents" },
    { id: "images", label: "Images" },
    { id: "code", label: "Code files" },
    { id: "links", label: "Links" },
    { id: "apps", label: "Apps" },
  ];
  const filteredOutputs = sortOutputsLatestFirst(
    filter === "all"
      ? outputs
      : outputs.filter(
          (output) => outputBrowserFilterForOutput(output) === filter,
        ),
  );

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 px-6 py-8 backdrop-blur-[2px]">
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border/50 bg-background shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/30 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Artifacts
            </div>
            <div className="text-xs text-muted-foreground">
              {outputs.length} item{outputs.length === 1 ? "" : "s"} in this
              session
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </Button>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border/20 px-4 py-2.5">
          {filterLabels.map((item) => {
            const active = filter === item.id;
            return (
              <Button
                key={item.id}
                variant={active ? "secondary" : "ghost"}
                size="xs"
                onClick={() => onFilterChange(item.id)}
              >
                {item.label}
              </Button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {filteredOutputs.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              No artifacts match this filter.
            </div>
          ) : (
            <div className="grid gap-1">
              {filteredOutputs.map((output) => (
                <Button
                  key={output.id}
                  variant="ghost"
                  onClick={() => {
                    onClose();
                    onOpenOutput?.(output);
                  }}
                  disabled={!onOpenOutput}
                  className="h-auto w-full min-w-0 justify-start gap-3 overflow-hidden px-3 py-2.5 text-left"
                >
                  <OutputArtifactIcon output={output} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {output.title || "Untitled artifact"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {outputSecondaryLabel(output)}
                    </div>
                  </div>
                  {outputChangeLabel(output) ? (
                    <Badge variant="outline" className="shrink-0 uppercase">
                      {outputChangeLabel(output)}
                    </Badge>
                  ) : null}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
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

function isTraceStepCollapsed(
  step: ChatTraceStep,
  collapsedTraceByStepId: Record<string, boolean>,
) {
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

function LiveStatusEllipsis() {
  return (
    <>
      <style>{`
        @keyframes status-dot-wave {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-3px); }
        }
      `}</style>
      <span aria-hidden="true" className="inline-flex items-baseline">
        {Array.from({ length: 3 }).map((_, index) => (
          <span
            key={`status-dot-${index}`}
            className="inline-block"
            style={{
              animation: "status-dot-wave 1200ms ease-in-out infinite",
              animationDelay: `${index * 120}ms`,
            }}
          >
            .
          </span>
        ))}
      </span>
    </>
  );
}

function TraceStepGroup({
  steps,
  collapsedByStepId,
  onToggleStep,
  live = false,
  liveOutputStarted = false,
}: {
  steps: ChatTraceStep[];
  collapsedByStepId: Record<string, boolean>;
  onToggleStep: (stepId: string) => void;
  live?: boolean;
  liveOutputStarted?: boolean;
}) {
  const [groupExpanded, setGroupExpanded] = useState(
    live && !liveOutputStarted,
  );
  const previousLiveRef = useRef(live);
  const previousLiveOutputStartedRef = useRef(liveOutputStarted);

  useEffect(() => {
    if (live && !previousLiveRef.current) {
      setGroupExpanded(!liveOutputStarted);
    }
    if (live && liveOutputStarted && !previousLiveOutputStartedRef.current) {
      setGroupExpanded(false);
    }
    previousLiveRef.current = live;
    previousLiveOutputStartedRef.current = liveOutputStarted;
  }, [live, liveOutputStarted]);
  const runningCount = steps.filter((s) => s.status === "running").length;
  const terminalErrorCount = steps.filter(
    (step) => step.kind === "phase" && step.status === "error",
  ).length;
  const groupHasTerminalError = terminalErrorCount > 0;
  const groupIsLive = live && !groupHasTerminalError;
  const stepCount = steps.length;
  const stepLabel = `${stepCount} step${stepCount === 1 ? "" : "s"}`;
  const activeStep =
    [...steps]
      .reverse()
      .find((step) => step.status === "running" || step.status === "waiting") ??
    null;
  const latestStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const summaryStep = activeStep ?? (groupIsLive ? latestStep : null);
  const summarySuffix = groupHasTerminalError
    ? ` (${terminalErrorCount} failed)`
    : "";

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setGroupExpanded((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 -ml-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60"
      >
        {groupHasTerminalError ? (
          <AlertTriangle size={13} className="text-destructive" />
        ) : groupIsLive || runningCount > 0 ? (
          <Loader2 size={13} className="animate-spin text-muted-foreground" />
        ) : (
          <Check size={13} className="text-emerald-500" />
        )}
        <span>
          {summaryStep
            ? summaryStep === activeStep || summaryStep.status === "waiting"
              ? `${traceStatusLabel(summaryStep.status)}: ${summaryStep.title}`
              : groupIsLive
                ? summaryStep.title
                : `${traceStatusLabel(summaryStep.status)}: ${summaryStep.title}`
            : groupIsLive
              ? `Working through ${stepLabel}...`
              : runningCount > 0
                ? `Running ${stepLabel}...`
                : `Used ${stepLabel}`}
          {summarySuffix}
        </span>
        <ChevronDown
          size={12}
          className={`transition-transform ${groupExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {groupExpanded ? (
        <div className="mt-1 ml-1 space-y-0.5">
          {steps.map((step) => {
            const expanded = !(collapsedByStepId[step.id] ?? true);
            return (
              <div key={step.id}>
                <button
                  type="button"
                  onClick={() =>
                    step.details.length > 0 && onToggleStep(step.id)
                  }
                  className={`flex w-full items-start gap-2 rounded-md px-2.5 -ml-2.5 py-1 text-left text-xs transition-colors ${step.details.length > 0 ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"}`}
                >
                  <span className="mt-0.5 shrink-0">
                    {step.status === "completed" ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : step.status === "error" ? (
                      <AlertTriangle size={12} className="text-destructive" />
                    ) : step.status === "running" ? (
                      <Loader2
                        size={12}
                        className="animate-spin text-muted-foreground"
                      />
                    ) : (
                      <Clock3 size={12} className="text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-foreground/80">
                      {step.title}
                    </span>
                    {step.details.length > 0 ? (
                      <span className="ml-1.5 text-muted-foreground/70">
                        {step.details[0]}
                      </span>
                    ) : null}
                  </span>
                  {step.details.length > 1 ? (
                    <ChevronDown
                      size={12}
                      className={`mt-0.5 shrink-0 text-muted-foreground/50 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  ) : null}
                </button>
                {expanded && step.details.length > 1 ? (
                  <div className="ml-6 mt-0.5 mb-1 rounded-md border border-border/30 bg-muted/30 px-3 py-2 text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap">
                    {step.details.slice(1).join("\n")}
                  </div>
                ) : null}
                {step.status === "error" ? (
                  <IntegrationErrorBanner details={step.details} />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function summarizeThinking(text: string) {
  const firstContentLine =
    text
      .split("\n")
      .map((line) => line.replace(/[*_`#>-]/g, "").trim())
      .find(Boolean) || "Reasoning available";

  return firstContentLine.length > 88
    ? `${firstContentLine.slice(0, 85).trimEnd()}...`
    : firstContentLine;
}

function ThinkingPanel({
  text,
  collapsed,
  onToggle,
  live = false,
}: ThinkingPanelProps) {
  const summary = summarizeThinking(text);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="bg-muted flex w-full items-center justify-between gap-3 rounded-[18px] border border-border/35 px-3.5 py-3 text-left transition hover:border-border/55"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {live ? "Thinking" : "Reasoning"}
            </span>
            {live ? (
              <span className="rounded-full border border-[rgba(247,90,84,0.18)] bg-[rgba(247,90,84,0.08)] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[rgba(206,92,84,0.92)]">
                LIVE
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-[12px] text-muted-foreground/76">
            {collapsed ? summary : "Expanded reasoning trace"}
          </div>
        </div>
        <ChevronDown
          size={14}
          className={`shrink-0 text-muted-foreground transition ${collapsed ? "" : "rotate-180"}`}
        />
      </button>
      {!collapsed ? (
        <div className="theme-chat-thinking-inner mt-2 whitespace-pre-wrap rounded-[18px] border border-border/30 px-4 py-3 text-[12px] leading-6 text-muted-foreground/86">
          {text}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentList({
  attachments,
  onRemove,
  className = "",
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
          className="bg-muted inline-flex max-w-full items-center gap-2 rounded-full border border-border/35 px-3 py-1.5 text-[11px] text-foreground/84"
        >
          {attachment.kind === "image" ? (
            <ImageIcon size={12} className="shrink-0 text-primary/72" />
          ) : (
            <FileText size={12} className="shrink-0 text-primary/72" />
          )}
          <span className="truncate">{attachmentButtonLabel(attachment)}</span>
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground transition hover:text-foreground"
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

function ModelCombobox({
  selectedModel,
  selectedModelLabel,
  runtimeDefaultModelLabel,
  runtimeDefaultModelAvailable,
  modelOptions,
  modelOptionGroups,
  disabled,
  onModelChange,
}: {
  selectedModel: string;
  selectedModelLabel: string;
  runtimeDefaultModelLabel: string;
  runtimeDefaultModelAvailable: boolean;
  modelOptions: ChatModelOption[];
  modelOptionGroups: ChatModelOptionGroup[];
  disabled: boolean;
  onModelChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const autoOption = useMemo(
    () =>
      runtimeDefaultModelAvailable
        ? ({
            value: CHAT_MODEL_USE_RUNTIME_DEFAULT,
            label: `Auto (${runtimeDefaultModelLabel})`,
          } satisfies ChatModelOption)
        : null,
    [runtimeDefaultModelAvailable, runtimeDefaultModelLabel],
  );

  const filteredAutoOption = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!autoOption) {
      return null;
    }
    if (!q) {
      return autoOption;
    }
    return autoOption.label.toLowerCase().includes(q) ||
      autoOption.value.toLowerCase().includes(q)
      ? autoOption
      : null;
  }, [autoOption, query]);

  const filteredOptionGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sourceGroups =
      modelOptionGroups.length > 0
        ? modelOptionGroups
        : [{ label: "", options: modelOptions }];
    return sourceGroups
      .map((group) => ({
        ...group,
        options: q
          ? group.options.filter((option) => {
              const haystack = [
                option.label,
                option.selectedLabel,
                option.searchText,
                option.value,
                group.label,
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              return haystack.includes(q);
            })
          : group.options,
      }))
      .filter((group) => group.options.length > 0);
  }, [modelOptionGroups, modelOptions, query]);

  const displayLabel =
    selectedModel === CHAT_MODEL_USE_RUNTIME_DEFAULT
      ? `Auto (${runtimeDefaultModelLabel})`
      : selectedModelLabel || "Select model";

  const hasFilteredOptions =
    Boolean(filteredAutoOption) ||
    filteredOptionGroups.some((group) => group.options.length > 0);

  const renderOption = (option: ChatModelOption) => {
    const active = option.value === selectedModel;
    const optionDisabled = Boolean(option.disabled);
    return (
      <button
        key={option.value}
        type="button"
        disabled={optionDisabled}
        onClick={() => {
          if (optionDisabled) {
            return;
          }
          onModelChange(option.value);
          setOpen(false);
          setQuery("");
        }}
        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
          active
            ? "bg-accent text-accent-foreground"
            : optionDisabled
              ? "cursor-not-allowed text-muted-foreground/70"
              : "text-foreground hover:bg-accent/50"
        }`}
      >
        <span className="truncate">{option.label}</span>
        {active ? (
          <Check size={13} className="shrink-0 text-primary" />
        ) : option.statusLabel ? (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
            {option.statusLabel}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="outline"
            size="lg"
            className="w-full justify-between text-xs font-medium"
          >
            <span className="truncate">{displayLabel}</span>
            <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-[280px] p-0"
      >
        <div className="border-b border-border/40 p-2">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models..."
              className="h-8 pl-8 text-xs"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-[240px] overflow-y-auto py-1">
          {!hasFilteredOptions ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No models found
            </div>
          ) : (
            <>
              {filteredAutoOption ? (
                <div className="pb-1">{renderOption(filteredAutoOption)}</div>
              ) : null}
              {filteredOptionGroups.map((group) => (
                <div key={group.label || "models"} className="py-1">
                  {group.label ? (
                    <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                      {group.label}
                    </div>
                  ) : null}
                  {group.options.map((option) => renderOption(option))}
                </div>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Composer({
  input,
  attachments,
  isResponding,
  pausePending,
  pauseDisabled,
  disabled,
  disabledReason = "",
  selectedModel,
  resolvedModelLabel,
  runtimeDefaultModelLabel,
  modelOptions,
  modelOptionGroups,
  runtimeDefaultModelAvailable,
  modelSelectionUnavailableReason,
  placeholder,
  showModelSelector,
  onModelChange,
  onOpenModelProviders,
  textareaRef,
  fileInputRef,
  onChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  onAttachmentInputChange,
  onPause,
  onAddDroppedFiles,
  onAddExplorerAttachments,
  onRemoveAttachment,
}: ComposerProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const noAvailableModels =
    !runtimeDefaultModelAvailable &&
    modelOptions.length === 0 &&
    modelOptionGroups.length === 0;
  const inputDisabled = disabled || isResponding;
  const visibleModelOptions = modelOptionGroups.flatMap(
    (group) => group.options,
  );
  const selectedModelOptionLabel =
    visibleModelOptions.find((option) => option.value === selectedModel)
      ?.selectedLabel ??
    visibleModelOptions.find((option) => option.value === selectedModel)
      ?.label ??
    modelOptions.find((option) => option.value === selectedModel)
      ?.selectedLabel ??
    modelOptions.find((option) => option.value === selectedModel)?.label ??
    resolvedModelLabel;

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

    return Array.from(dataTransfer.items ?? []).some(
      (item) => item.kind === "file",
    );
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
    const rawExplorerPayload = event.dataTransfer.getData(
      EXPLORER_ATTACHMENT_DRAG_TYPE,
    );
    const parsedExplorerPayload =
      parseExplorerAttachmentDragPayload(rawExplorerPayload);
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
      className={`overflow-hidden rounded-xl border border-border bg-muted/50 transition-colors focus-within:border-ring ${
        isDragActive
          ? "border-primary/45 bg-primary/[0.04]"
          : "border-border/35"
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onAttachmentInputChange}
      />
      {attachments.length > 0 ? (
        <div className="border-b border-border/20 px-4 py-3">
          <AttachmentList
            attachments={attachments}
            onRemove={onRemoveAttachment}
          />
        </div>
      ) : null}
      <div className="px-4 pb-2 pt-4">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          rows={1}
          disabled={inputDisabled}
          placeholder={
            inputDisabled
              ? disabledReason || "Chat unavailable right now"
              : placeholder
          }
          className="composer-input block max-h-[220px] min-h-[40px] w-full resize-none overflow-y-auto bg-transparent text-[14px] leading-7 text-foreground outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-55"
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/20 px-3 py-3 text-muted-foreground">
        {showModelSelector ? (
          <div
            className={
              noAvailableModels
                ? "min-w-0 flex flex-1 items-center gap-3"
                : "w-[172px] shrink-0 sm:w-[208px]"
            }
          >
            {noAvailableModels ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={onOpenModelProviders}
                  className="shrink-0 justify-between rounded-[11px] bg-card text-[12px] font-semibold hover:border-primary/35 hover:bg-card/92"
                  aria-label="Configure model providers"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Waypoints
                      size={13}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="truncate">Set up providers</span>
                  </span>
                  <ArrowRight
                    size={14}
                    className="shrink-0 text-muted-foreground"
                  />
                </Button>
                <div className="min-w-0 text-[10px] leading-5 text-muted-foreground">
                  Open provider settings to connect a model.
                </div>
              </>
            ) : (
              <ModelCombobox
                selectedModel={selectedModel}
                selectedModelLabel={selectedModelOptionLabel}
                runtimeDefaultModelLabel={runtimeDefaultModelLabel}
                runtimeDefaultModelAvailable={runtimeDefaultModelAvailable}
                modelOptions={modelOptions}
                modelOptionGroups={modelOptionGroups}
                disabled={isResponding}
                onModelChange={onModelChange}
              />
            )}
          </div>
        ) : (
          <div className="text-[11px] leading-6 text-muted-foreground">
            Responses here stay in the workspace onboarding thread.
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            disabled={isResponding || disabled}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            className="rounded-full"
          >
            <Paperclip size={15} />
          </Button>
          {isResponding ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pausePending || pauseDisabled}
              onClick={onPause}
              className="rounded-full px-3"
            >
              {pausePending ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Square size={12} className="mr-1.5 fill-current" />
              )}
              Pause
            </Button>
          ) : (
            <Button
              size="icon"
              disabled={(!input.trim() && attachments.length === 0) || disabled}
              render={<button type="submit" />}
              className="rounded-full"
            >
              <ArrowUp size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
