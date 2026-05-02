import {
  ArrowUpRight,
  Loader2,
  SendHorizontal,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PREVIEW_HISTORY_LIMIT = 18;
const PREVIEW_MESSAGE_LIMIT = 12;

type PreviewMessageRole = "assistant" | "system" | "user";

interface PreviewMessage {
  id: string;
  role: PreviewMessageRole;
  text: string;
  createdAt: string | null;
  optimistic?: boolean;
}

interface WorkspaceControlCenterProps {
  workspaces: WorkspaceRecordPayload[];
  selectedWorkspaceId: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onEnterWorkspace: (workspaceId: string) => void;
}

interface WorkspaceCardProps {
  workspace: WorkspaceRecordPayload;
  isSelected: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  onEnterWorkspace: (workspaceId: string) => void;
  onActivityAtChange: (workspaceId: string, activityAt: string | null) => void;
}

type RuntimeCardState = "idle" | "queued" | "working" | "waiting" | "error";

function runtimeStateStatus(value: string | null | undefined): string {
  return (value || "").trim().toUpperCase();
}

function runtimeStateEffectiveStatus(
  runtimeState:
    | Pick<SessionRuntimeRecordPayload, "status" | "effective_state">
    | null
    | undefined,
): string {
  return runtimeStateStatus(
    runtimeState?.effective_state ?? runtimeState?.status,
  );
}

function normalizedPreviewText(text: string) {
  return text.replace(/\r\n/g, "\n").trim();
}

function previewRoleForMessage(role: string): PreviewMessageRole | null {
  const normalizedRole = role.trim().toLowerCase();
  if (normalizedRole === "assistant") {
    return "assistant";
  }
  if (normalizedRole === "user") {
    return "user";
  }
  if (normalizedRole === "system") {
    return "system";
  }
  return null;
}

function historyMessagesToPreviewMessages(
  messages: SessionHistoryMessagePayload[],
): PreviewMessage[] {
  return messages
    .map((message) => {
      const role = previewRoleForMessage(message.role);
      const text = normalizedPreviewText(message.text || "");
      if (!role || !text) {
        return null;
      }
      return {
        id: message.id,
        role,
        text,
        createdAt: message.created_at ?? null,
      } satisfies PreviewMessage;
    })
    .filter((message): message is PreviewMessage => Boolean(message))
    .slice(-PREVIEW_MESSAGE_LIMIT);
}

function trimPreviewMessages(messages: PreviewMessage[]) {
  return messages.slice(-PREVIEW_MESSAGE_LIMIT);
}

function compareTimestampsDescending(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftValue = Date.parse(left || "") || 0;
  const rightValue = Date.parse(right || "") || 0;
  return rightValue - leftValue;
}

function fallbackWorkspaceActivityAt(workspace: WorkspaceRecordPayload) {
  return workspace.updated_at || workspace.created_at || null;
}

function lastActivityFromSnapshot(params: {
  fallbackActivityAt: string | null;
  mainSessionUpdatedAt: string | null;
  messages: PreviewMessage[];
}) {
  const lastMessageAt =
    [...params.messages]
      .reverse()
      .find((message) => Boolean(message.createdAt))?.createdAt ?? null;
  return (
    lastMessageAt ||
    params.mainSessionUpdatedAt ||
    params.fallbackActivityAt
  );
}

function previewStatusFromRuntimeState(
  runtimeState: SessionRuntimeRecordPayload | null,
): RuntimeCardState {
  const status = runtimeStateEffectiveStatus(runtimeState);
  if (status === "ERROR" || status === "FAILED") {
    return "error";
  }
  if (status === "BUSY") {
    return "working";
  }
  if (status === "QUEUED") {
    return "queued";
  }
  if (status === "WAITING_USER" || status === "PAUSED") {
    return "waiting";
  }
  return "idle";
}

function previewStatusLabel(state: RuntimeCardState) {
  switch (state) {
    case "error":
      return "Needs attention";
    case "queued":
      return "Queued";
    case "waiting":
      return "Waiting";
    case "working":
      return "Working";
    default:
      return "Ready";
  }
}

function previewStatusVariant(state: RuntimeCardState) {
  switch (state) {
    case "error":
      return "destructive";
    case "queued":
    case "waiting":
      return "secondary";
    case "working":
      return "default";
    default:
      return "outline";
  }
}

function statusAccentClassName(state: RuntimeCardState) {
  switch (state) {
    case "error":
      return "bg-destructive";
    case "queued":
    case "waiting":
      return "bg-amber-500";
    case "working":
      return "bg-primary";
    default:
      return "bg-emerald-500";
  }
}

function isNearBottom(container: HTMLDivElement) {
  const remaining =
    container.scrollHeight - container.scrollTop - container.clientHeight;
  return remaining <= 28;
}

function runFailedDetail(payload: Record<string, unknown>) {
  const directFields = [
    payload.error,
    payload.detail,
    payload.message,
    payload.reason,
  ];
  for (const value of directFields) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "The workspace run failed.";
}

function formatLastActivityLabel(value: string | null | undefined) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) {
    return "Waiting for first chat";
  }
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const WorkspaceControlCenterCard = memo(function WorkspaceControlCenterCard({
  workspace,
  isSelected,
  onSelectWorkspace,
  onEnterWorkspace,
  onActivityAtChange,
}: WorkspaceCardProps) {
  const workspaceId = workspace.id;
  const workspaceFallbackActivityAt = fallbackWorkspaceActivityAt(workspace);
  const [mainSession, setMainSession] = useState<AgentSessionRecordPayload | null>(
    null,
  );
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const [runtimeState, setRuntimeState] =
    useState<SessionRuntimeRecordPayload | null>(null);
  const [runtimeCardState, setRuntimeCardState] =
    useState<RuntimeCardState>("idle");
  const [composerText, setComposerText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const activeStreamIdRef = useRef<string | null>(null);
  const pendingInputIdRef = useRef<string>("");
  const disposedRef = useRef(false);
  const workspaceFallbackActivityAtRef = useRef(workspaceFallbackActivityAt);

  useEffect(() => {
    workspaceFallbackActivityAtRef.current = workspaceFallbackActivityAt;
  }, [workspaceFallbackActivityAt]);

  const workspaceUnavailable = workspace.folder_state === "missing";
  const lastActivityAt = useMemo(
    () =>
      lastActivityFromSnapshot({
        fallbackActivityAt: workspaceFallbackActivityAt,
        mainSessionUpdatedAt: mainSession?.updated_at ?? null,
        messages,
      }),
    [mainSession?.updated_at, messages, workspaceFallbackActivityAt],
  );

  const closeActiveStream = useCallback(async (reason: string) => {
    const streamId = activeStreamIdRef.current;
    activeStreamIdRef.current = null;
    pendingInputIdRef.current = "";
    if (!streamId) {
      return;
    }
    await window.electronAPI.workspace
      .closeSessionOutputStream(streamId, reason)
      .catch(() => undefined);
  }, []);

  const openLiveStream = useCallback(
    async (params: {
      sessionId: string;
      inputId?: string | null;
      includeHistory?: boolean;
    }) => {
      if (activeStreamIdRef.current) {
        await closeActiveStream("control_center_replace_stream");
      }
      const stream = await window.electronAPI.workspace.openSessionOutputStream(
        {
          sessionId: params.sessionId,
          workspaceId,
          inputId: params.inputId ?? undefined,
          includeHistory: params.includeHistory ?? Boolean(params.inputId),
          stopOnTerminal: true,
        },
      );
      if (disposedRef.current) {
        await window.electronAPI.workspace
          .closeSessionOutputStream(
            stream.streamId,
            "control_center_disposed_after_open",
          )
          .catch(() => undefined);
        return;
      }
      activeStreamIdRef.current = stream.streamId;
      pendingInputIdRef.current = (params.inputId || "").trim();
    },
    [closeActiveStream, workspaceId],
  );

  const refreshSnapshot = useCallback(
    async (options?: { attachStream?: boolean; showLoading?: boolean }) => {
      if (options?.showLoading) {
        setIsLoading(true);
      }
      const ensured = await window.electronAPI.workspace.ensureMainSession(
        workspaceId,
      );
      const session = ensured.session;
      const sessionId = session.session_id.trim();
      const [history, runtimeStates] = await Promise.all([
        window.electronAPI.workspace.getSessionHistory({
          workspaceId,
          sessionId,
          limit: PREVIEW_HISTORY_LIMIT,
          offset: 0,
          order: "asc",
        }),
        window.electronAPI.workspace.listRuntimeStates(workspaceId),
      ]);
      if (disposedRef.current) {
        return;
      }

      const nextMessages = historyMessagesToPreviewMessages(history.messages);
      const nextRuntimeState =
        runtimeStates.items.find((item) => item.session_id === sessionId) ??
        null;
      const nextRuntimeCardState = previewStatusFromRuntimeState(nextRuntimeState);

      setMainSession(session);
      setMessages(nextMessages);
      setRuntimeState(nextRuntimeState);
      setRuntimeCardState(nextRuntimeCardState);
      setIsResponding(
        nextRuntimeCardState === "queued" || nextRuntimeCardState === "working",
      );
      setErrorMessage("");

      const nextActivityAt = lastActivityFromSnapshot({
        fallbackActivityAt: workspaceFallbackActivityAtRef.current,
        mainSessionUpdatedAt: session.updated_at ?? null,
        messages: nextMessages,
      });
      onActivityAtChange(workspaceId, nextActivityAt);

      if (
        options?.attachStream !== false &&
        (nextRuntimeCardState === "queued" || nextRuntimeCardState === "working")
      ) {
        await openLiveStream({
          sessionId,
          inputId: nextRuntimeState?.current_input_id ?? undefined,
          includeHistory: Boolean(nextRuntimeState?.current_input_id),
        }).catch((error) => {
          if (disposedRef.current) {
            return;
          }
          setErrorMessage(
            error instanceof Error ? error.message : "Could not attach stream.",
          );
        });
      } else if (activeStreamIdRef.current) {
        await closeActiveStream("control_center_snapshot_idle");
      }

      setIsLoading(false);
    },
    [closeActiveStream, onActivityAtChange, openLiveStream, workspaceId],
  );

  useEffect(() => {
    disposedRef.current = false;
    void refreshSnapshot({ attachStream: true, showLoading: true }).catch(
      (error) => {
        if (disposedRef.current) {
          return;
        }
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Could not load workspace preview.",
        );
        setIsLoading(false);
      },
    );

    return () => {
      disposedRef.current = true;
      void closeActiveStream("control_center_card_unmounted");
    };
  }, [closeActiveStream, refreshSnapshot]);

  useEffect(() => {
    onActivityAtChange(workspaceId, lastActivityAt);
  }, [lastActivityAt, onActivityAtChange, workspaceId]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.workspace.onSessionStreamEvent(
      (payload) => {
        const currentStreamId = activeStreamIdRef.current;
        if (!currentStreamId || payload.streamId !== currentStreamId) {
          return;
        }

        if (payload.type === "error") {
          setErrorMessage(payload.error || "The workspace stream failed.");
          setIsResponding(false);
          setRuntimeCardState("error");
          activeStreamIdRef.current = null;
          pendingInputIdRef.current = "";
          return;
        }

        if (payload.type === "done") {
          activeStreamIdRef.current = null;
          pendingInputIdRef.current = "";
          setIsResponding(false);
          void refreshSnapshot({ attachStream: false }).catch(() => undefined);
          return;
        }

        const eventData = payload.event?.data;
        if (!eventData || typeof eventData !== "object" || Array.isArray(eventData)) {
          return;
        }

        const typedEvent = eventData as {
          event_type?: string;
          input_id?: string;
          payload?: Record<string, unknown>;
        };
        const eventType = (typedEvent.event_type || payload.event?.event || "")
          .trim()
          .toLowerCase();
        const inputId = (typedEvent.input_id || "").trim();
        const eventPayload = typedEvent.payload ?? {};

        if (
          eventType === "run_claimed" ||
          eventType === "run_started" ||
          eventType === "compaction_restored"
        ) {
          setIsResponding(true);
          setRuntimeCardState("working");
          return;
        }

        if (eventType === "output_delta") {
          const delta =
            typeof eventPayload.delta === "string" ? eventPayload.delta : "";
          if (!delta) {
            return;
          }
          const optimisticAssistantId = inputId
            ? `assistant-${inputId}`
            : `assistant-live-${payload.streamId}`;
          setIsResponding(true);
          setRuntimeCardState("working");
          setErrorMessage("");
          setMessages((current) => {
            const next = [...current];
            const existingIndex = next.findIndex(
              (message) => message.id === optimisticAssistantId,
            );
            if (existingIndex >= 0) {
              next[existingIndex] = {
                ...next[existingIndex],
                text: `${next[existingIndex]?.text || ""}${delta}`,
              };
            } else {
              next.push({
                id: optimisticAssistantId,
                role: "assistant",
                text: delta,
                createdAt: new Date().toISOString(),
              });
            }
            return trimPreviewMessages(next);
          });
          return;
        }

        if (eventType === "run_failed") {
          activeStreamIdRef.current = null;
          pendingInputIdRef.current = "";
          setIsResponding(false);
          setRuntimeCardState("error");
          setErrorMessage(runFailedDetail(eventPayload));
          void refreshSnapshot({ attachStream: false }).catch(() => undefined);
          return;
        }

        if (eventType === "run_completed") {
          activeStreamIdRef.current = null;
          pendingInputIdRef.current = "";
          setIsResponding(false);
          setRuntimeCardState("idle");
          void refreshSnapshot({ attachStream: false }).catch(() => undefined);
        }
      },
    );

    return () => {
      unsubscribe();
    };
  }, [refreshSnapshot]);

  useEffect(() => {
    if (!isResponding || !mainSession?.session_id) {
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const pollRuntimeState = async () => {
      if (cancelled || inFlight) {
        return;
      }
      inFlight = true;
      try {
        const response =
          await window.electronAPI.workspace.listRuntimeStates(workspaceId);
        if (cancelled || disposedRef.current) {
          return;
        }
        const nextRuntimeState =
          response.items.find(
            (item) => item.session_id === mainSession.session_id,
          ) ?? null;
        setRuntimeState(nextRuntimeState);
        const nextRuntimeCardState =
          previewStatusFromRuntimeState(nextRuntimeState);
        setRuntimeCardState(nextRuntimeCardState);
        if (
          nextRuntimeCardState === "queued" ||
          nextRuntimeCardState === "working"
        ) {
          return;
        }
        if (activeStreamIdRef.current) {
          await closeActiveStream("control_center_runtime_terminal");
        }
        setIsResponding(false);
        void refreshSnapshot({ attachStream: false }).catch(() => undefined);
      } catch {
        // Ignore poll failures; the stream remains the primary signal.
      } finally {
        inFlight = false;
      }
    };

    void pollRuntimeState();
    const timer = window.setInterval(() => {
      void pollRuntimeState();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [closeActiveStream, isResponding, mainSession, refreshSnapshot, workspaceId]);

  useEffect(() => {
    const scroller = previewScrollerRef.current;
    if (!scroller || !shouldStickToBottomRef.current) {
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
  }, [messages]);

  const handlePreviewScroll = () => {
    const scroller = previewScrollerRef.current;
    if (!scroller) {
      return;
    }
    shouldStickToBottomRef.current = isNearBottom(scroller);
  };

  const handleSubmit = async () => {
    const text = composerText.trim();
    const sessionId = mainSession?.session_id?.trim() || "";
    if (!text || !sessionId || isSubmitting || isResponding || workspaceUnavailable) {
      return;
    }

    const optimisticInputId = `user-preview-${crypto.randomUUID()}`;
    shouldStickToBottomRef.current = true;
    setErrorMessage("");
    setIsSubmitting(true);
    setComposerText("");
    onSelectWorkspace(workspaceId);
    setMessages((current) =>
      trimPreviewMessages([
        ...current,
        {
          id: optimisticInputId,
          role: "user",
          text,
          createdAt: new Date().toISOString(),
          optimistic: true,
        },
      ]),
    );

    try {
      const queued = await window.electronAPI.workspace.queueSessionInput({
        text,
        workspace_id: workspaceId,
        image_urls: null,
        attachments: null,
        session_id: sessionId,
        priority: 0,
      });
      if (disposedRef.current) {
        return;
      }
      pendingInputIdRef.current = queued.input_id;
      setMessages((current) =>
        current.map((message) =>
          message.id === optimisticInputId
            ? {
                ...message,
                id: `user-${queued.input_id}`,
                optimistic: false,
              }
            : message,
        ),
      );
      setIsResponding(true);
      setRuntimeCardState(
        queued.status.trim().toUpperCase() === "QUEUED" ? "queued" : "working",
      );
      await openLiveStream({
        sessionId: queued.session_id,
        inputId: queued.input_id,
        includeHistory: true,
      });
    } catch (error) {
      if (disposedRef.current) {
        return;
      }
      setComposerText(text);
      setMessages((current) =>
        current.filter((message) => message.id !== optimisticInputId),
      );
      setErrorMessage(
        error instanceof Error ? error.message : "Could not send message.",
      );
      setIsResponding(false);
    } finally {
      if (!disposedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void handleSubmit();
  };

  return (
    <Card
      className={cn(
        "h-[480px] min-h-0 border border-border/70 bg-card py-0 shadow-md transition-[transform,border-color,box-shadow] duration-200 ease-out",
        isSelected
          ? "border-primary/45 shadow-[0_16px_48px_-24px_color-mix(in_oklch,var(--primary)_32%,transparent)]"
          : "hover:-translate-y-0.5 hover:border-border hover:shadow-xl",
      )}
    >
      <CardHeader className="border-b border-border/70 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 flex-1 items-center gap-2 text-[0.95rem]">
            <span
              className={cn(
                "inline-flex h-2.5 w-2.5 shrink-0 rounded-full",
                statusAccentClassName(runtimeCardState),
              )}
            />
            <span className="truncate">{workspace.name}</span>
            {workspace.folder_state === "missing" ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-warning">
                <TriangleAlert className="size-3.5" />
                Missing folder
              </span>
            ) : null}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">
              {formatLastActivityLabel(lastActivityAt)}
            </span>
            <Badge
              variant={previewStatusVariant(runtimeCardState)}
              className="h-6 rounded-full px-2 text-[11px]"
            >
              {runtimeCardState === "working" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : runtimeCardState === "queued" ? (
                <Sparkles className="size-3" />
              ) : null}
              {previewStatusLabel(runtimeCardState)}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onSelectWorkspace(workspaceId);
                onEnterWorkspace(workspaceId);
              }}
              className="h-6 rounded-full px-2.5 text-[11px]"
            >
              Enter workspace
              <ArrowUpRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 px-2.5 pb-2.5 pt-2">
        <div
          ref={previewScrollerRef}
          onScroll={handlePreviewScroll}
          className="min-h-0 flex-1 overflow-y-auto rounded-[18px] border border-border/70 bg-muted/25 px-3 py-2"
        >
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="mr-2 size-3.5 animate-spin" />
              Loading main session
            </div>
          ) : messages.length > 0 ? (
            <div className="space-y-2.5">
              {messages.map((message) => {
                const isUser = message.role === "user";
                const isAssistant = message.role === "assistant";
                return (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      isUser ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[88%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-5 text-foreground",
                        isUser
                          ? "theme-chat-user-bubble"
                          : isAssistant
                            ? "theme-chat-assistant-bubble"
                            : "theme-chat-system-bubble border",
                        message.optimistic ? "opacity-80" : "",
                      )}
                    >
                      <div className="whitespace-pre-wrap break-words">
                        {message.text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
              Start the main session from here. Replies will stay inside this
              card until you enter the workspace.
            </div>
          )}
        </div>

        {errorMessage ? (
          <div className="theme-chat-system-bubble rounded-xl border px-3 py-2 text-xs">
            {errorMessage}
          </div>
        ) : null}

        <div className="rounded-[18px] border border-border/70 bg-background/82 p-1.5 shadow-sm">
          <div className="flex items-end gap-1.5">
            <textarea
              value={composerText}
              onChange={(event) => setComposerText(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              onFocus={() => onSelectWorkspace(workspaceId)}
              rows={1}
              disabled={isSubmitting || isResponding || workspaceUnavailable}
              placeholder={
                workspaceUnavailable
                  ? "Workspace folder is missing."
                  : isResponding
                    ? "Wait for the current run to finish."
                    : "Message this workspace directly..."
              }
              className="min-h-[40px] max-h-[84px] flex-1 resize-none rounded-[14px] border border-border/70 bg-transparent px-3 py-2 text-sm leading-5 outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={
                !composerText.trim() ||
                isSubmitting ||
                isResponding ||
                workspaceUnavailable
              }
              className="h-8 rounded-full px-3 shrink-0"
            >
              {isSubmitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <SendHorizontal className="size-3.5" />
              )}
              Send
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

export function WorkspaceControlCenter({
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  onEnterWorkspace,
}: WorkspaceControlCenterProps) {
  const [activityByWorkspaceId, setActivityByWorkspaceId] = useState<
    Record<string, string | null>
  >({});

  const handleActivityAtChange = useCallback(
    (workspaceId: string, activityAt: string | null) => {
      setActivityByWorkspaceId((current) => {
        if ((current[workspaceId] ?? null) === (activityAt ?? null)) {
          return current;
        }
        return {
          ...current,
          [workspaceId]: activityAt ?? null,
        };
      });
    },
    [],
  );

  const sortedWorkspaces = useMemo(() => {
    return [...workspaces].sort((left, right) => {
      const activityComparison = compareTimestampsDescending(
        activityByWorkspaceId[left.id] ?? fallbackWorkspaceActivityAt(left),
        activityByWorkspaceId[right.id] ?? fallbackWorkspaceActivityAt(right),
      );
      if (activityComparison !== 0) {
        return activityComparison;
      }
      return left.name.localeCompare(right.name);
    });
  }, [activityByWorkspaceId, workspaces]);

  return (
    <section className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(125,161,255,0.14),transparent_26%),radial-gradient(circle_at_82%_14%,rgba(251,191,36,0.1),transparent_22%),radial-gradient(circle_at_50%_100%,rgba(16,185,129,0.08),transparent_30%)]" />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1 sm:px-5">
          <div className="grid auto-rows-fr gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {sortedWorkspaces.map((workspace) => (
              <WorkspaceControlCenterCard
                key={workspace.id}
                workspace={workspace}
                isSelected={workspace.id === (selectedWorkspaceId || "").trim()}
                onSelectWorkspace={onSelectWorkspace}
                onEnterWorkspace={onEnterWorkspace}
                onActivityAtChange={handleActivityAtChange}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
