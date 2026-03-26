import { type ChangeEvent, type DragEvent, FormEvent, KeyboardEvent, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowUp, ChevronDown, FileText, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { PaneCard } from "@/components/ui/PaneCard";
import {
  EXPLORER_ATTACHMENT_DRAG_TYPE,
  type ExplorerAttachmentDragPayload,
  inferDraggedAttachmentKind,
  parseExplorerAttachmentDragPayload
} from "@/lib/attachmentDrag";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
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

function toolActivityLabel(eventType: string, payload: Record<string, unknown>): string | null {
  const toolId = typeof payload.tool_id === "string" ? payload.tool_id.trim() : "";
  const toolName = typeof payload.tool_name === "string" ? payload.tool_name.trim() : "";
  const label = toolName || toolId;
  if (!label) {
    return null;
  }

  if (eventType === "tool_call_started" || eventType === "tool_started") {
    return `Using ${label}`;
  }
  if (eventType === "tool_call_completed" || eventType === "tool_completed") {
    return `Finished ${label}`;
  }

  return null;
}

export function ChatPane({ onOutputsChanged }: { onOutputsChanged?: () => void }) {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const {
    runtimeConfig,
    selectedWorkspace,
    resolvedUserId,
    isLoadingBootstrap,
    refreshWorkspaceData
  } = useWorkspaceDesktop();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [liveAssistantText, setLiveAssistantText] = useState("");
  const [liveThinkingText, setLiveThinkingText] = useState("");
  const [liveThinkingExpanded, setLiveThinkingExpanded] = useState(false);
  const [liveAgentStatus, setLiveAgentStatus] = useState("");
  const [liveToolActivities, setLiveToolActivities] = useState<string[]>([]);
  const [collapsedThinkingByMessageId, setCollapsedThinkingByMessageId] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [chatErrorMessage, setChatErrorMessage] = useState("");
  const [verboseTelemetryEnabled, setVerboseTelemetryEnabled] = useState(false);
  const [streamTelemetry, setStreamTelemetry] = useState<StreamTelemetryEntry[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const pendingInputIdRef = useRef<string | null>(null);
  const seenMainDebugKeysRef = useRef<Set<string>>(new Set());
  const selectedWorkspaceRef = useRef<WorkspaceRecordPayload | null>(null);
  const liveAssistantTextRef = useRef("");
  const liveThinkingTextRef = useRef("");
  const liveThinkingExpandedRef = useRef(false);
  const liveToolActivitiesRef = useRef<string[]>([]);
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
    liveToolActivitiesRef.current = [];
    activeAssistantMessageIdRef.current = null;
    setLiveAssistantText("");
    setLiveThinkingText("");
    setLiveThinkingExpanded(false);
    setLiveAgentStatus("");
    setLiveToolActivities([]);
  }

  function pushLiveToolActivity(activity: string) {
    setLiveToolActivities((prev) => {
      const next = prev[prev.length - 1] === activity ? prev : [...prev, activity].slice(-3);
      liveToolActivitiesRef.current = next;
      return next;
    });
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
    if (!assistantText && !thinkingText) {
      resetLiveTurn();
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        role: "assistant",
        text: assistantText,
        thinkingText: thinkingText || undefined
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

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, liveThinkingText, liveAssistantText, isResponding]);

  useEffect(() => {
    selectedWorkspaceRef.current = selectedWorkspace;
  }, [selectedWorkspace]);

  useEffect(() => {
    setPendingAttachments([]);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [input]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setMessages([]);
      resetLiveTurn();
      setCollapsedThinkingByMessageId({});
      setPendingAttachments([]);
      setActiveSession(null);
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
        }
        setActiveSession(nextSessionId);
        if (!nextSessionId) {
          return;
        }

        const history = await window.electronAPI.workspace.getSessionHistory({
          sessionId: nextSessionId,
          workspaceId: selectedWorkspaceId
        });
        if (cancelled) {
          return;
        }

        setMessages(
          history.messages
            .map((message) => {
              const attachments = attachmentsFromMetadata(message.metadata);
              return {
                id: message.id || `history-${message.created_at ?? crypto.randomUUID()}`,
                role: message.role as ChatMessage["role"],
                text: message.text,
                attachments
              };
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
            })
          : null;
      const eventName = payload.type === "event" ? payload.event?.event ?? "message" : payload.type;
      const eventType = typedEvent?.event_type ?? eventName;
      const eventPayload = typedEvent?.payload ?? {};
      const eventInputId = typeof typedEvent?.input_id === "string" ? typedEvent.input_id : "";
      const eventSessionId = typeof typedEvent?.session_id === "string" ? typedEvent.session_id : "";

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

      const toolActivity = toolActivityLabel(eventType, eventPayload);
      if (toolActivity) {
        setLiveAgentStatus("Using tools...");
        pushLiveToolActivity(toolActivity);
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
        if (liveAssistantTextRef.current || liveThinkingTextRef.current) {
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
        model: runtimeConfig?.defaultModel ?? null
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

  const hasMessages = messages.length > 0 || Boolean(liveAssistantText) || Boolean(liveThinkingText);
  const showWorkingIndicator = isResponding && !liveAssistantText && !liveThinkingText;
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
  const composerDisabled = !selectedWorkspace || !resolvedUserId || isLoadingHistory || isLoadingBootstrap;

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

        <div
          ref={messagesRef}
          className={`min-h-0 flex-1 overflow-y-auto px-4 sm:px-5 ${
            hasMessages ? "pb-3 pt-5" : "flex items-center justify-center pb-10 pt-10"
          }`}
        >
          {hasMessages ? (
            <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[88%] whitespace-pre-wrap px-4 py-3 text-[13px] leading-7 ${
                      message.role === "user"
                        ? "theme-chat-user-bubble rounded-[24px] rounded-br-[10px] border border-neon-green/30 text-text-main/96"
                        : "theme-chat-assistant-bubble rounded-[24px] rounded-bl-[10px] border border-panel-border/60 text-text-main/90"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-text-dim/75">
                        Workspace agent
                      </div>
                    ) : null}
                    {message.role === "assistant" && message.thinkingText ? (
                      <ThinkingPanel
                        text={message.thinkingText}
                        collapsed={collapsedThinkingByMessageId[message.id] ?? true}
                        onToggle={() => toggleThinkingPanel(message.id)}
                      />
                    ) : null}
                    {message.attachments?.length ? <AttachmentList attachments={message.attachments} className="mb-3" /> : null}
                    {message.text ? <div className="whitespace-pre-wrap">{message.text}</div> : null}
                  </div>
                </div>
              ))}

              {showWorkingIndicator ? (
                <div className="flex justify-start">
                  <div className="theme-chat-assistant-bubble max-w-[88%] rounded-[24px] rounded-bl-[10px] border border-panel-border/60 px-4 py-3 text-[13px] text-text-main/90">
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-text-dim/75">
                      Workspace agent
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-neon-green/70 [animation-delay:0ms]" />
                        <span className="h-2 w-2 animate-pulse rounded-full bg-neon-green/60 [animation-delay:180ms]" />
                        <span className="h-2 w-2 animate-pulse rounded-full bg-neon-green/50 [animation-delay:360ms]" />
                      </div>
                      <span className="text-[12px] text-text-muted/82">{liveAgentStatus || "Working..."}</span>
                    </div>
                    {liveToolActivities.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {liveToolActivities.map((activity) => (
                          <span
                            key={activity}
                            className="rounded-full border border-panel-border/45 px-2 py-1 text-[10px] text-text-dim/80"
                          >
                            {activity}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {liveThinkingText || liveAssistantText ? (
                <div className="flex justify-start">
                  <div className="theme-chat-assistant-bubble max-w-[88%] rounded-[24px] rounded-bl-[10px] border border-panel-border/60 px-4 py-3 text-[13px] leading-7 text-text-main/90">
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-text-dim/75">
                      Workspace agent
                    </div>
                    {liveAgentStatus && !liveAssistantText ? (
                      <div className="mb-3 text-[12px] text-text-muted/82">{liveAgentStatus}</div>
                    ) : null}
                    {liveToolActivities.length ? (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {liveToolActivities.map((activity) => (
                          <span
                            key={activity}
                            className="rounded-full border border-panel-border/45 px-2 py-1 text-[10px] text-text-dim/80"
                          >
                            {activity}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {liveThinkingText ? (
                      <ThinkingPanel
                        text={liveThinkingText}
                        collapsed={!liveThinkingExpanded}
                        live
                        onToggle={() => {
                          const next = !liveThinkingExpandedRef.current;
                          liveThinkingExpandedRef.current = next;
                          setLiveThinkingExpanded(next);
                        }}
                      />
                    ) : null}
                    {liveAssistantText ? <div className="whitespace-pre-wrap">{liveAssistantText}</div> : null}
                  </div>
                </div>
              ) : null}

            </div>
          ) : (
            <div className="w-full px-2">
              <div className="mx-auto mb-6 max-w-[560px] text-center">
                <div className="text-[22px] font-semibold tracking-[-0.02em] text-text-main/90">
                  {isLoadingBootstrap || isLoadingHistory ? "Loading workspace context" : "Ask the workspace agent"}
                </div>
                <div className="mt-3 text-[13px] leading-7 text-text-muted/68">
                  {selectedWorkspace
                    ? "Messages are queued into the local runtime workspace flow, then streamed back from the live session output feed."
                    : "Pick a template, create a workspace, and then send the first instruction."}
                </div>
              </div>
              <form onSubmit={onSubmit} className="mx-auto max-w-[760px]">
                <Composer
                  input={input}
                  attachments={pendingAttachmentItems}
                  isResponding={isResponding}
                  disabled={composerDisabled}
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

        {hasMessages ? (
          <div className="shrink-0 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
            <form onSubmit={onSubmit} className="mx-auto max-w-[760px]">
              <Composer
                input={input}
                attachments={pendingAttachmentItems}
                isResponding={isResponding}
                disabled={composerDisabled}
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
    <div className="mb-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="theme-header-surface flex w-full items-center justify-between gap-3 rounded-[16px] border border-panel-border/45 px-3 py-2.5 text-left transition hover:border-neon-green/30"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium tracking-[0.12em] text-neon-green/78">{live ? "Thinking" : "Reasoning"}</span>
            {live ? (
              <span className="rounded-full border border-neon-green/18 px-2 py-0.5 text-[9px] tracking-[0.14em] text-neon-green/62">
                LIVE
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-[11px] text-text-muted/76">{collapsed ? summary : "Expanded reasoning trace"}</div>
        </div>
        <ChevronDown size={14} className={`shrink-0 text-text-muted/72 transition ${collapsed ? "" : "rotate-180"}`} />
      </button>
      {!collapsed ? (
        <div className="theme-chat-thinking-inner mt-2 whitespace-pre-wrap rounded-[16px] border border-panel-border/35 px-3 py-3 text-[12px] leading-6 text-text-muted/88">
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
          placeholder={disabled ? "Create/select a workspace and finish runtime setup first" : "Ask anything"}
          className="composer-input block max-h-[220px] min-h-[76px] w-full resize-none overflow-y-auto bg-transparent text-[14px] leading-7 text-text-main/92 outline-none placeholder:text-text-muted/42 disabled:cursor-not-allowed disabled:opacity-55"
        />
      </div>

      <div className="flex items-center gap-2 border-t border-panel-border/20 px-3 py-3 text-text-muted/72">
        <div className="min-w-0 flex-1 text-[11px] text-text-muted/74">
          {disabled
            ? "Select a ready workspace to start chatting."
            : "Attach files or images, then press Enter to send. Shift + Enter adds a new line."}
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
