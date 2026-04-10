import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Loader2, MoreHorizontal, Play, Plus, Trash2 } from "lucide-react";
import { PaneCard } from "@/components/ui/PaneCard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

interface CompletedAutomationRun {
  sessionId: string;
  title: string;
  completedAt: string;
  status: string;
  errorDetail: string;
}

interface AutomationsPaneProps {
  onOpenRunSession?: (sessionId: string) => void;
  onCreateSchedule?: () => void;
}

interface RefreshDataOptions {
  preserveStatusMessage?: boolean;
  suppressErrors?: boolean;
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function formatAbsoluteTimestamp(value: string | null): string {
  if (!value) {
    return "Not available";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  const date = new Date(parsed);
  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} at ${timePart}`;
}

function formatDailyCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) {
    return null;
  }
  const [minuteRaw, hourRaw, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth !== "*" || month !== "*" || dayOfWeek !== "*") {
    return null;
  }
  const minute = Number(minuteRaw);
  const hour = Number(hourRaw);
  if (
    !Number.isInteger(minute) ||
    !Number.isInteger(hour) ||
    minute < 0 ||
    minute > 59 ||
    hour < 0 ||
    hour > 23
  ) {
    return null;
  }
  return `Daily at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function scheduleAtLabel(job: CronjobRecordPayload): string {
  return formatDailyCron(job.cron) ?? formatAbsoluteTimestamp(job.next_run_at);
}

function jobTitle(job: CronjobRecordPayload): string {
  return job.name?.trim() || job.description?.trim() || "Untitled schedule";
}

function jobDeliveryChannel(job: CronjobRecordPayload): string {
  return job.delivery?.channel?.trim().toLowerCase() || "";
}

function jobKindLabel(job: CronjobRecordPayload): string {
  const channel = jobDeliveryChannel(job);
  if (channel === "system_notification") {
    return "Notification";
  }
  if (channel === "session_run") {
    return "Task run";
  }
  return "Automation";
}

function jobKindClassName(job: CronjobRecordPayload): string {
  const channel = jobDeliveryChannel(job);
  if (channel === "system_notification") {
    return "border-[rgba(192,158,93,0.32)] bg-[rgba(250,244,227,0.92)] text-[rgba(114,86,34,0.96)]";
  }
  if (channel === "session_run") {
    return "border-primary/25 bg-primary/10 text-primary";
  }
  return "border-border/50 bg-muted/65 text-muted-foreground";
}

function runtimeStateErrorMessage(
  value: Record<string, unknown> | null | undefined,
): string {
  if (!value) {
    return "";
  }

  const message =
    typeof value.message === "string" && value.message.trim()
      ? value.message.trim()
      : "";
  if (message) {
    return message;
  }

  const rawMessage =
    typeof value.raw_message === "string" && value.raw_message.trim()
      ? value.raw_message.trim()
      : "";
  return rawMessage;
}

function isTerminalRunStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return (
    normalized === "IDLE" ||
    normalized === "ERROR" ||
    normalized === "FAILED" ||
    normalized === "COMPLETED"
  );
}

function completedStatusLabel(status: string): string {
  const normalized = status.trim().toUpperCase();
  if (normalized === "ERROR" || normalized === "FAILED") {
    return "Failed";
  }
  return "Completed";
}

function completedStatusClassName(status: string): string {
  const normalized = status.trim().toUpperCase();
  if (normalized === "ERROR" || normalized === "FAILED") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  return "border-primary/30 bg-primary/10 text-primary";
}

export function AutomationsPane({
  onOpenRunSession,
  onCreateSchedule,
}: AutomationsPaneProps) {
  const [activeTab, setActiveTab] = useState<"scheduled" | "completed">(
    "scheduled",
  );
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const [cronjobs, setCronjobs] = useState<CronjobRecordPayload[]>([]);
  const [completedRuns, setCompletedRuns] = useState<CompletedAutomationRun[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">(
    "info",
  );

  const scheduledJobs = useMemo(
    () =>
      [...cronjobs].sort((left, right) => {
        const leftRaw = Date.parse(left.next_run_at ?? left.updated_at);
        const rightRaw = Date.parse(right.next_run_at ?? right.updated_at);
        const leftTs = Number.isNaN(leftRaw) ? 0 : leftRaw;
        const rightTs = Number.isNaN(rightRaw) ? 0 : rightRaw;
        return leftTs - rightTs;
      }),
    [cronjobs],
  );

  const statusClassName =
    statusTone === "success"
      ? "border-primary/25 bg-primary/5 text-foreground"
      : statusTone === "error"
        ? "border-destructive/25 bg-destructive/5 text-destructive"
        : "border-border/60 bg-muted/55 text-muted-foreground";

  const setInfoMessage = (message: string) => {
    setStatusTone("info");
    setStatusMessage(message);
  };

  const refreshData = useCallback(async (options?: RefreshDataOptions) => {
    const preserveStatusMessage = options?.preserveStatusMessage ?? false;
    const suppressErrors = options?.suppressErrors ?? false;

    if (!selectedWorkspaceId) {
      setCronjobs([]);
      setCompletedRuns([]);
      return;
    }

    setIsLoading(true);
    try {
      const [cronjobsResponse, sessionsResponse, runtimeStatesResponse] =
        await Promise.all([
          window.electronAPI.workspace.listCronjobs(selectedWorkspaceId),
          window.electronAPI.workspace.listAgentSessions(selectedWorkspaceId),
          window.electronAPI.workspace.listRuntimeStates(selectedWorkspaceId),
        ]);

      setCronjobs(cronjobsResponse.jobs);

      const runtimeStateBySessionId = new Map(
        runtimeStatesResponse.items.map((item) => [item.session_id, item]),
      );

      const nextCompletedRuns = sessionsResponse.items
        .filter((session) => session.kind.trim().toLowerCase() === "cronjob")
        .map((session) => {
          const runtimeState = runtimeStateBySessionId.get(session.session_id);
          const status = (runtimeState?.status || "IDLE").trim().toUpperCase();
          const completedAt =
            runtimeState?.updated_at || session.updated_at || session.created_at;
          return {
            sessionId: session.session_id,
            title: session.title?.trim() || "Cronjob run",
            completedAt,
            status,
            errorDetail: runtimeStateErrorMessage(runtimeState?.last_error),
          };
        })
        .filter((run) => isTerminalRunStatus(run.status))
        .sort((left, right) => {
          const leftRaw = Date.parse(left.completedAt);
          const rightRaw = Date.parse(right.completedAt);
          const leftTs = Number.isNaN(leftRaw) ? 0 : leftRaw;
          const rightTs = Number.isNaN(rightRaw) ? 0 : rightRaw;
          return rightTs - leftTs;
        });

      setCompletedRuns(nextCompletedRuns);
      if (!preserveStatusMessage) {
        setStatusMessage("");
      }
    } catch (error) {
      if (!suppressErrors) {
        setStatusTone("error");
        setStatusMessage(normalizeErrorMessage(error));
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedWorkspaceId]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const handleDelete = async (job: CronjobRecordPayload) => {
    setBusyJobId(job.id);
    setStatusMessage("");
    try {
      await window.electronAPI.workspace.deleteCronjob(job.id);
      setCronjobs((previous) => previous.filter((item) => item.id !== job.id));
      setStatusTone("success");
      setStatusMessage(`Deleted schedule "${jobTitle(job)}".`);
      void refreshData({
        preserveStatusMessage: true,
        suppressErrors: true,
      });
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(normalizeErrorMessage(error));
    } finally {
      setBusyJobId(null);
    }
  };

  const handleToggleEnabled = async (job: CronjobRecordPayload) => {
    setBusyJobId(job.id);
    setStatusMessage("");
    try {
      const updated = await window.electronAPI.workspace.updateCronjob(job.id, {
        enabled: !job.enabled,
      });
      setCronjobs((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
      setStatusTone("success");
      setStatusMessage(
        `${updated.enabled ? "Enabled" : "Disabled"} "${jobTitle(updated)}".`,
      );
      void refreshData({
        preserveStatusMessage: true,
        suppressErrors: true,
      });
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(normalizeErrorMessage(error));
    } finally {
      setBusyJobId(null);
    }
  };

  const handleRunNow = async (job: CronjobRecordPayload) => {
    setBusyJobId(job.id);
    setStatusMessage("");
    try {
      const response = await window.electronAPI.workspace.runCronjobNow(job.id);
      setCronjobs((previous) =>
        previous.map((item) =>
          item.id === response.cronjob.id ? response.cronjob : item,
        ),
      );
      setStatusTone("success");
      setStatusMessage(`Ran "${jobTitle(response.cronjob)}" now.`);
      void refreshData({
        preserveStatusMessage: true,
        suppressErrors: true,
      });
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(normalizeErrorMessage(error));
    } finally {
      setBusyJobId(null);
    }
  };

  const handleNewSchedule = () => {
    if (onCreateSchedule) {
      onCreateSchedule();
      return;
    }
    setInfoMessage(
      "Schedule creation is not wired in this pane yet. Use the cronjob API/runtime route for creation.",
    );
  };

  return (
    <PaneCard className="shadow-md">
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col px-6 py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Automations
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage recurring schedules and review completed automation runs.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={handleNewSchedule}
              className="h-9 rounded-xl px-4 text-sm font-semibold"
            >
              <Plus size={16} />
              New schedule
            </Button>
          </div>

          <div className="theme-subtle-surface mt-5 inline-flex items-center rounded-xl border border-border/45 p-1">
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("scheduled")}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === "scheduled"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Scheduled
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("completed")}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === "completed"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Completed
              </button>
            </div>
          </div>

          {statusMessage ? (
            <div className="mt-4">
              <div className={`rounded-xl border px-3 py-2 text-xs ${statusClassName}`}>
                {statusMessage}
              </div>
            </div>
          ) : null}

          <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-xl border border-border/45 bg-card/70">
            {!selectedWorkspaceId ? (
              <EmptyState message="Choose a workspace from the top bar to view and manage automations." />
            ) : isLoading && scheduledJobs.length === 0 && completedRuns.length === 0 ? (
              <EmptyState message="Loading automations..." />
            ) : activeTab === "scheduled" ? (
              scheduledJobs.length === 0 ? (
                <EmptyState message="No scheduled tasks in this workspace." />
              ) : (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="shrink-0 border-b border-border/35 bg-muted/35 px-4 py-2.5">
                    <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_120px_132px_48px] items-center gap-4 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/75">
                      <span>Title</span>
                      <span>Schedule at</span>
                      <span>Status</span>
                      <span>Run</span>
                      <span />
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {scheduledJobs.map((job) => {
                      const isBusy = busyJobId === job.id;
                      return (
                        <div
                          key={job.id}
                          className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_120px_132px_48px] items-center gap-4 border-b border-border/25 px-4 py-3 transition-colors hover:bg-accent/45"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">
                              {jobTitle(job)}
                            </div>
                            <div className="mt-1">
                              <span
                                className={`inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium uppercase tracking-[0.12em] ${jobKindClassName(job)}`}
                              >
                                {jobKindLabel(job)}
                              </span>
                            </div>
                          </div>

                          <div className="truncate text-sm text-muted-foreground">
                            {scheduleAtLabel(job)}
                          </div>

                          <div>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleToggleEnabled(job)}
                              aria-label={job.enabled ? "Disable schedule" : "Enable schedule"}
                              className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
                                job.enabled
                                  ? "border-[rgba(247,90,84,0.95)] bg-[rgba(247,90,84,0.9)]"
                                  : "border-border/60 bg-muted/70"
                              } disabled:cursor-not-allowed disabled:opacity-45`}
                            >
                              <span
                                className={`size-5 rounded-full bg-background shadow-sm transition-transform ${
                                  job.enabled
                                    ? "translate-x-6 ring-1 ring-[rgba(247,90,84,0.6)]"
                                    : "translate-x-1"
                                }`}
                              />
                              {isBusy ? (
                                <span className="absolute inset-0 grid place-items-center">
                                  <Loader2 size={11} className="animate-spin text-muted-foreground" />
                                </span>
                              ) : null}
                            </button>
                          </div>

                          <div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => void handleRunNow(job)}
                              className="h-8 rounded-lg px-3"
                            >
                              {isBusy ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Play size={14} />
                              )}
                              Run now
                            </Button>
                          </div>

                          <div className="flex justify-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                aria-label={`Actions for ${jobTitle(job)}`}
                                className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              >
                                <MoreHorizontal size={16} />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" sideOffset={6} className="w-40">
                                <DropdownMenuItem
                                  onClick={() => void handleDelete(job)}
                                  disabled={isBusy}
                                  variant="destructive"
                                >
                                  <Trash2 size={14} />
                                  Delete schedule
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            ) : completedRuns.length === 0 ? (
              <EmptyState message="No completed automation runs yet." />
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b border-border/35 bg-muted/35 px-4 py-2.5">
                  <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_120px] items-center gap-4 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/75">
                    <span>Title</span>
                    <span>Completed at</span>
                    <span>Status</span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {completedRuns.map((run) => (
                    <button
                      key={run.sessionId}
                      type="button"
                      disabled={!onOpenRunSession}
                      onClick={() => onOpenRunSession?.(run.sessionId)}
                      className="grid w-full grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_120px] items-center gap-4 border-b border-border/25 px-4 py-3 text-left transition-colors hover:bg-accent/45 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {run.title}
                        </div>
                        {run.errorDetail ? (
                          <div className="mt-0.5 truncate text-xs text-destructive/90">
                            {run.errorDetail}
                          </div>
                        ) : null}
                      </div>

                      <div className="truncate text-sm text-muted-foreground">
                        {formatAbsoluteTimestamp(run.completedAt)}
                      </div>

                      <div>
                        <span
                          className={`inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium ${completedStatusClassName(run.status)}`}
                        >
                          {completedStatusLabel(run.status)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PaneCard>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6 text-center">
      <div className="max-w-lg">
        <Clock3 size={20} className="mx-auto text-muted-foreground" />
        <div className="mt-3 text-sm font-medium text-foreground">No tasks to show</div>
        <div className="mt-1 text-xs text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}
