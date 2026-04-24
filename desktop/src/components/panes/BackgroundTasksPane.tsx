import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Check,
  Clock3,
  Loader2,
  Pause,
  X,
} from "lucide-react";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

const BACKGROUND_TASKS_POLL_INTERVAL_MS = 1000;

interface BackgroundTasksPaneProps {
  workspaceId?: string | null;
  emptyWorkspaceMessage?: string;
  variant?: "full" | "inline";
  onOpenTaskSession?: (task: BackgroundTaskRecordPayload) => void;
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function formatRelativeTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  const diffMs = Date.now() - parsed;
  const diffMin = Math.round(diffMs / 60_000);
  if (Math.abs(diffMin) < 1) {
    return "just now";
  }
  if (Math.abs(diffMin) < 60) {
    return `${diffMin > 0 ? `${diffMin}m ago` : `in ${-diffMin}m`}`;
  }
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) {
    return `${diffHr > 0 ? `${diffHr}h ago` : `in ${-diffHr}h`}`;
  }
  const date = new Date(parsed);
  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart}, ${timePart}`;
}

function backgroundTaskStatusLabel(status: string): string {
  switch (status.trim().toLowerCase()) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "waiting_on_user":
      return "Waiting on you";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Background task";
  }
}

function backgroundTaskStatusIndicator(status: string): {
  className: string;
  icon: ReactNode;
} {
  switch (status.trim().toLowerCase()) {
    case "queued":
      return {
        className: "text-info",
        icon: <Clock3 size={14} />,
      };
    case "running":
      return {
        className: "text-primary",
        icon: <Loader2 size={14} className="animate-spin" />,
      };
    case "waiting_on_user":
      return {
        className: "text-warning",
        icon: <Pause size={14} />,
      };
    case "completed":
      return {
        className: "text-success",
        icon: <Check size={14} />,
      };
    case "failed":
      return {
        className: "text-destructive",
        icon: <X size={14} />,
      };
    case "cancelled":
      return {
        className: "text-muted-foreground",
        icon: <Pause size={14} />,
      };
    default:
      return {
        className: "text-muted-foreground",
        icon: <Clock3 size={14} />,
      };
  }
}

function backgroundTaskSourceLabel(task: BackgroundTaskRecordPayload): string {
  if ((task.source_type ?? "").trim().toLowerCase() === "cronjob") {
    return "Automation";
  }
  return "Delegated";
}

function backgroundTaskDetail(task: BackgroundTaskRecordPayload): string {
  const blockingQuestion =
    typeof task.blocking_payload?.blocking_question === "string" &&
    task.blocking_payload.blocking_question.trim()
      ? task.blocking_payload.blocking_question.trim()
      : "";
  if (blockingQuestion) {
    return blockingQuestion;
  }
  const summary = task.summary?.trim() ?? "";
  if (summary) {
    return summary;
  }
  return task.goal.trim() || "No summary yet.";
}

function backgroundTaskPriority(status: string): number {
  switch (status.trim().toLowerCase()) {
    case "waiting_on_user":
      return 0;
    case "running":
      return 1;
    case "queued":
      return 2;
    case "failed":
      return 3;
    case "completed":
      return 4;
    case "cancelled":
      return 5;
    default:
      return 6;
  }
}

function sortBackgroundTasks(tasks: BackgroundTaskRecordPayload[]) {
  return [...tasks].sort((left, right) => {
    const priorityDiff =
      backgroundTaskPriority(left.status) - backgroundTaskPriority(right.status);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return (
      Date.parse(right.updated_at || "") - Date.parse(left.updated_at || "") ||
      left.subagent_id.localeCompare(right.subagent_id)
    );
  });
}

function summarizeInlineBackgroundTasks(tasks: BackgroundTaskRecordPayload[]) {
  const waitingCount = tasks.filter(
    (task) => task.status.trim().toLowerCase() === "waiting_on_user",
  ).length;
  if (waitingCount > 0) {
    return waitingCount === 1
      ? "1 background task waiting on you"
      : `${waitingCount} background tasks waiting on you`;
  }
  const activeCount = tasks.filter((task) => {
    const status = task.status.trim().toLowerCase();
    return status === "queued" || status === "running";
  }).length;
  if (activeCount > 0) {
    return activeCount === 1
      ? "1 background task in progress"
      : `${activeCount} background tasks in progress`;
  }
  const failedCount = tasks.filter(
    (task) => task.status.trim().toLowerCase() === "failed",
  ).length;
  if (failedCount > 0) {
    return failedCount === 1
      ? "1 background task failed"
      : `${failedCount} background tasks failed`;
  }
  return tasks.length === 1
    ? "1 recent background task"
    : `${tasks.length} recent background tasks`;
}

function inlineBackgroundIndicator(tasks: BackgroundTaskRecordPayload[]) {
  const sortedTasks = sortBackgroundTasks(tasks);
  const focusTask = sortedTasks[0] ?? null;
  return backgroundTaskStatusIndicator(focusTask?.status ?? "");
}

export function BackgroundTasksPane({
  workspaceId,
  emptyWorkspaceMessage = "Choose a workspace from the top bar to view background tasks.",
  variant = "full",
  onOpenTaskSession,
}: BackgroundTasksPaneProps) {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const activeWorkspaceId = workspaceId ?? selectedWorkspaceId;
  const [tasks, setTasks] = useState<BackgroundTaskRecordPayload[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [inlineExpanded, setInlineExpanded] = useState(false);

  const refreshTasks = useCallback(
    async (options?: { showLoading?: boolean }) => {
      if (!activeWorkspaceId) {
        setTasks([]);
        setErrorMessage("");
        return;
      }
      if (options?.showLoading) {
        setIsLoading(true);
      }
      try {
        const response = await window.electronAPI.workspace.listBackgroundTasks({
          workspaceId: activeWorkspaceId,
          limit: 200,
        });
        setTasks(response.tasks ?? []);
        setErrorMessage("");
      } catch (error) {
        setErrorMessage(normalizeErrorMessage(error));
      } finally {
        if (options?.showLoading) {
          setIsLoading(false);
        }
      }
    },
    [activeWorkspaceId],
  );

  useEffect(() => {
    if (!activeWorkspaceId) {
      setTasks([]);
      setErrorMessage("");
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let requestInFlight = false;

    const loadTasks = async (options?: { showLoading?: boolean }) => {
      if (requestInFlight) {
        return;
      }
      requestInFlight = true;
      try {
        await refreshTasks(options);
      } finally {
        requestInFlight = false;
      }
    };

    const refreshVisibleTasks = () => {
      if (document.visibilityState !== "visible" || cancelled) {
        return;
      }
      void loadTasks();
    };

    void loadTasks({ showLoading: true });
    const intervalId = window.setInterval(() => {
      refreshVisibleTasks();
    }, BACKGROUND_TASKS_POLL_INTERVAL_MS);
    window.addEventListener("focus", refreshVisibleTasks);
    document.addEventListener("visibilitychange", refreshVisibleTasks);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshVisibleTasks);
      document.removeEventListener("visibilitychange", refreshVisibleTasks);
    };
  }, [activeWorkspaceId, refreshTasks]);

  const sortedTasks = sortBackgroundTasks(tasks);

  if (variant === "inline") {
    if (!activeWorkspaceId) {
      return null;
    }

    if (!isLoading && tasks.length === 0 && !errorMessage) {
      return null;
    }

    const indicator = inlineBackgroundIndicator(sortedTasks);
    const focusTask = sortedTasks[0] ?? null;
    const summaryLabel = summarizeInlineBackgroundTasks(sortedTasks);
    const detailLabel = focusTask ? backgroundTaskDetail(focusTask) : "";

    return (
      <div className="shrink-0 px-4 pt-3 sm:px-5">
        <div className="overflow-hidden rounded-lg border border-border bg-background/80 shadow-subtle-sm backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setInlineExpanded((value) => !value)}
            aria-expanded={inlineExpanded}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-muted/60"
          >
            <span
              className={`inline-flex size-4 shrink-0 items-center justify-center ${indicator.className}`}
            >
              {isLoading && tasks.length === 0 ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                indicator.icon
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-foreground">
                {summaryLabel}
              </div>
              {detailLabel ? (
                <div className="truncate text-[11px] text-muted-foreground">
                  {detailLabel}
                </div>
              ) : null}
            </div>
            <div className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
              {sortedTasks.length}
            </div>
            <ChevronDown
              className={`size-3.5 shrink-0 text-muted-foreground transition ${inlineExpanded ? "rotate-0" : "-rotate-90"}`}
            />
          </button>

          {inlineExpanded ? (
            <div className="max-h-[320px] overflow-y-auto border-t border-border px-3 py-3">
              {errorMessage ? (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle size={14} />
                  <span>{errorMessage}</span>
                </div>
              ) : null}
              <div className={`${errorMessage ? "mt-3 " : ""}space-y-2`}>
                {sortedTasks.map((task) => {
                  const taskIndicator = backgroundTaskStatusIndicator(
                    task.status,
                  );
                  const canOpenTaskSession =
                    typeof onOpenTaskSession === "function" &&
                    Boolean(task.child_session_id.trim());
                  const taskBody = (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`grid size-4 shrink-0 place-items-center ${taskIndicator.className}`}
                            >
                              {taskIndicator.icon}
                            </span>
                            <div className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                              {task.title.trim() ||
                                "Untitled background task"}
                            </div>
                          </div>
                          <div className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                            {backgroundTaskDetail(task)}
                          </div>
                        </div>
                        <div className="shrink-0 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          {backgroundTaskStatusLabel(task.status)}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{backgroundTaskSourceLabel(task)}</span>
                        <span>
                          Updated {formatRelativeTimestamp(task.updated_at)}
                        </span>
                        {task.effective_model?.trim() ? (
                          <span>{task.effective_model.trim()}</span>
                        ) : null}
                        {canOpenTaskSession ? (
                          <span className="font-medium text-primary">
                            Inspect run
                          </span>
                        ) : null}
                      </div>
                    </>
                  );
                  return canOpenTaskSession ? (
                    <button
                      key={task.subagent_id}
                      type="button"
                      onClick={() => onOpenTaskSession(task)}
                      className="w-full rounded-xl border border-border bg-muted px-3 py-3 text-left transition hover:border-primary/40 hover:bg-primary/[0.04]"
                    >
                      {taskBody}
                    </button>
                  ) : (
                    <div
                      key={task.subagent_id}
                      className="rounded-xl border border-border bg-muted px-3 py-3"
                    >
                      {taskBody}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (!activeWorkspaceId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {emptyWorkspaceMessage}
      </div>
    );
  }

  if (isLoading && tasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 px-6 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        <span>Loading background tasks…</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/60 px-4 py-3 sm:px-5">
        <div className="rounded-xl border border-border/60 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
          Read-only view for workspace background work. Use the main session to
          cancel, retry, or answer blockers.
        </div>
        {errorMessage ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle size={14} />
            <span>{errorMessage}</span>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 text-center text-sm text-muted-foreground">
            No background tasks yet.
          </div>
        ) : (
          <div className="space-y-3">
            {sortedTasks.map((task) => {
              const indicator = backgroundTaskStatusIndicator(task.status);
              const canOpenTaskSession =
                typeof onOpenTaskSession === "function" &&
                Boolean(task.child_session_id.trim());
              const taskBody = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`grid size-4 shrink-0 place-items-center ${indicator.className}`}
                        >
                          {indicator.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">
                            {task.title.trim() || "Untitled background task"}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                        {backgroundTaskDetail(task)}
                      </div>
                    </div>
                    <div className="shrink-0 rounded-full border border-border/70 bg-muted/35 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      {backgroundTaskSourceLabel(task)}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{backgroundTaskStatusLabel(task.status)}</span>
                    <span>Updated {formatRelativeTimestamp(task.updated_at)}</span>
                    {task.effective_model?.trim() ? (
                      <span>{task.effective_model.trim()}</span>
                    ) : null}
                    {canOpenTaskSession ? (
                      <span className="font-medium text-primary">
                        Inspect run
                      </span>
                    ) : null}
                  </div>
                </>
              );
              return canOpenTaskSession ? (
                <button
                  key={task.subagent_id}
                  type="button"
                  onClick={() => onOpenTaskSession(task)}
                  className="w-full rounded-2xl border border-border/70 bg-card/95 px-4 py-3 text-left shadow-subtle-xs transition hover:border-primary/40 hover:bg-primary/[0.03]"
                >
                  {taskBody}
                </button>
              ) : (
                <div
                  key={task.subagent_id}
                  className="rounded-2xl border border-border/70 bg-card/95 px-4 py-3 shadow-subtle-xs"
                >
                  {taskBody}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
