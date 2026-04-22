import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Clock3,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaneCard } from "@/components/ui/PaneCard";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  workspaceId?: string | null;
  showHeader?: boolean;
  emptyWorkspaceMessage?: string;
  toolbarLeading?: ReactNode;
  onOpenRunSession?: (sessionId: string) => void;
  onCreateSchedule?: () => void;
  onEditSchedule?: (job: CronjobRecordPayload) => void;
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
    return "border-warning/40 bg-warning/10 text-warning";
  }
  if (channel === "session_run") {
    return "border-primary bg-primary/10 text-primary";
  }
  return "border-border bg-muted text-muted-foreground";
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
  return "border-primary bg-primary/10 text-primary";
}

export function AutomationsPane({
  workspaceId,
  showHeader = true,
  emptyWorkspaceMessage = "Choose a workspace from the top bar to view and manage automations.",
  toolbarLeading,
  onOpenRunSession,
  onCreateSchedule,
  onEditSchedule,
}: AutomationsPaneProps) {
  const [activeTab, setActiveTab] = useState<"scheduled" | "completed">(
    "scheduled",
  );
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const activeWorkspaceId = workspaceId ?? selectedWorkspaceId;
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
      ? "border-primary bg-primary/5 text-foreground"
      : statusTone === "error"
        ? "border-destructive/25 bg-destructive/5 text-destructive"
        : "border-border bg-muted text-muted-foreground";

  const setInfoMessage = (message: string) => {
    setStatusTone("info");
    setStatusMessage(message);
  };

  const refreshData = useCallback(
    async (options?: RefreshDataOptions) => {
      const preserveStatusMessage = options?.preserveStatusMessage ?? false;
      const suppressErrors = options?.suppressErrors ?? false;

      if (!activeWorkspaceId) {
        setCronjobs([]);
        setCompletedRuns([]);
        return;
      }

      setIsLoading(true);
      try {
        const [cronjobsResponse, sessionsResponse, runtimeStatesResponse] =
          await Promise.all([
            window.electronAPI.workspace.listCronjobs(activeWorkspaceId),
            window.electronAPI.workspace.listAgentSessions(activeWorkspaceId),
            window.electronAPI.workspace.listRuntimeStates(activeWorkspaceId),
          ]);

        setCronjobs(cronjobsResponse.jobs);

        const runtimeStateBySessionId = new Map(
          runtimeStatesResponse.items.map((item) => [item.session_id, item]),
        );

        const nextCompletedRuns = sessionsResponse.items
          .filter((session) => session.kind.trim().toLowerCase() === "cronjob")
          .map((session) => {
            const runtimeState = runtimeStateBySessionId.get(
              session.session_id,
            );
            const status = (runtimeState?.status || "IDLE")
              .trim()
              .toUpperCase();
            const completedAt =
              runtimeState?.updated_at ||
              session.updated_at ||
              session.created_at;
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
    },
    [activeWorkspaceId],
  );

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

  const handleEdit = (job: CronjobRecordPayload) => {
    if (onEditSchedule) {
      onEditSchedule(job);
      return;
    }
    setInfoMessage(
      "Editing isn't wired in this pane yet. Open the schedule in chat to update it.",
    );
  };

  const content = (
    <>
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              {showHeader ? (
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-foreground">
                    Automations
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Manage recurring schedules and review completed automation
                    runs.
                  </p>
                </div>
              ) : toolbarLeading ? (
                toolbarLeading
              ) : null}
            </div>

            <Button
              type="button"
              size="default"
              onClick={handleNewSchedule}
              className="rounded-full px-4"
            >
              <Plus size={14} />
              New schedule
            </Button>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "scheduled" | "completed")}
            className="mt-5"
          >
            <TabsList>
              <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
            </TabsList>
          </Tabs>

          {statusMessage ? (
            <div className="mt-4">
              <div
                className={`rounded-xl border px-3 py-2 text-sm ${statusClassName}`}
              >
                {statusMessage}
              </div>
            </div>
          ) : null}

          <div className="mt-5 min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-background/70">
            {!activeWorkspaceId ? (
              <EmptyState message={emptyWorkspaceMessage} />
            ) : isLoading &&
              scheduledJobs.length === 0 &&
              completedRuns.length === 0 ? (
              <div
                role="status"
                aria-busy="true"
                aria-label="Loading automations"
                className="flex h-full min-h-0 flex-col"
              >
                <div className="shrink-0 border-b border-border px-4 py-4 sm:px-5">
                  <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_120px_64px] items-center gap-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <span>Title</span>
                    <span>Schedule at</span>
                    <span>Status</span>
                    <span />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {[
                    { titleW: "w-36", scheduleW: "w-28" },
                    { titleW: "w-48", scheduleW: "w-32" },
                    { titleW: "w-40", scheduleW: "w-24" },
                    { titleW: "w-44", scheduleW: "w-36" },
                  ].map((row, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_120px_64px] items-center gap-4 border-b border-border px-4 py-4 sm:px-5"
                    >
                      <div className="flex flex-col gap-1.5 pr-2">
                        <span
                          className={`h-4 ${row.titleW} animate-pulse rounded bg-muted-foreground/20`}
                        />
                        <span className="h-2.5 w-16 animate-pulse rounded bg-muted" />
                      </div>
                      <span
                        className={`h-4 ${row.scheduleW} animate-pulse rounded bg-muted-foreground/20`}
                      />
                      <span className="h-5 w-9 animate-pulse rounded-full bg-muted-foreground/20" />
                      <div className="flex justify-end">
                        <span className="size-7 animate-pulse rounded-md bg-muted-foreground/20" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : activeTab === "scheduled" ? (
              scheduledJobs.length === 0 ? (
                <EmptyState message="No scheduled tasks in this workspace." />
              ) : (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="shrink-0 border-b border-border px-4 py-4 sm:px-5">
                    <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_120px_64px] items-center gap-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      <span>Title</span>
                      <span>Schedule at</span>
                      <span>Status</span>
                      <span />
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {scheduledJobs.map((job) => {
                      const isBusy = busyJobId === job.id;
                      return (
                        <div
                          key={job.id}
                          className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_120px_64px] items-center gap-4 border-b border-border px-4 py-4 transition-colors hover:bg-accent sm:px-5"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="truncate text-sm font-medium text-foreground">
                              {jobTitle(job)}
                            </div>
                            {jobKindLabel(job) !== "Automation" ? (
                              <div className="mt-1">
                                <Badge
                                  variant="outline"
                                  className={`uppercase tracking-[0.12em] ${jobKindClassName(job)}`}
                                >
                                  {jobKindLabel(job)}
                                </Badge>
                              </div>
                            ) : null}
                            {job.last_error ? (
                              <div className="mt-1 truncate text-xs text-destructive">
                                {job.last_error}
                              </div>
                            ) : null}
                          </div>

                          <div className="truncate text-sm text-muted-foreground">
                            {scheduleAtLabel(job)}
                          </div>

                          <div>
                            <Switch
                              checked={job.enabled}
                              onCheckedChange={() =>
                                void handleToggleEnabled(job)
                              }
                              disabled={isBusy}
                              aria-label={
                                job.enabled
                                  ? "Disable schedule"
                                  : "Enable schedule"
                              }
                            />
                          </div>

                          <div className="flex justify-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Actions for ${jobTitle(job)}`}
                                  />
                                }
                              >
                                <MoreHorizontal size={16} />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                sideOffset={8}
                                className="w-48"
                              >
                                <DropdownMenuItem
                                  onClick={() => void handleRunNow(job)}
                                  disabled={isBusy}
                                >
                                  <Play size={16} />
                                  Run now
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleEdit(job)}
                                  disabled={isBusy}
                                >
                                  <Pencil size={16} />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => void handleDelete(job)}
                                  disabled={isBusy}
                                  variant="destructive"
                                >
                                  <Trash2 size={16} />
                                  Delete
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
                <div className="shrink-0 border-b border-border px-4 py-4 sm:px-5">
                  <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1.25fr)_120px] items-center gap-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
                      className="grid w-full grid-cols-[minmax(0,1.05fr)_minmax(0,1.25fr)_120px] items-center gap-4 border-b border-border px-4 py-4 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent sm:px-5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {run.title}
                        </div>
                        {run.errorDetail ? (
                          <div className="mt-0.5 truncate text-xs text-destructive">
                            {run.errorDetail}
                          </div>
                        ) : null}
                      </div>

                      <div className="truncate text-sm text-muted-foreground">
                        {formatAbsoluteTimestamp(run.completedAt)}
                      </div>

                      <div>
                        <Badge
                          variant="outline"
                          className={completedStatusClassName(run.status)}
                        >
                          {completedStatusLabel(run.status)}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  if (!showHeader) {
    return content;
  }

  return <PaneCard className="shadow-subtle-xs">{content}</PaneCard>;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6 text-center">
      <div className="max-w-lg">
        <Clock3 size={20} className="mx-auto text-muted-foreground" />
        <div className="mt-3 text-sm font-medium text-foreground">
          No tasks to show
        </div>
        <div className="mt-1 text-sm text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}
