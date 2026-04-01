import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Loader2, Trash2 } from "lucide-react";
import { PaneCard } from "@/components/ui/PaneCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not scheduled";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString();
}

type AutomationSectionKey = "system_notification" | "session_run" | "other";

const AUTOMATION_SECTIONS: Array<{
  key: AutomationSectionKey;
  title: string;
  description: string;
  emptyMessage: string;
}> = [
  {
    key: "system_notification",
    title: "System Notifications",
    description: "Reminder-style automations. They do not create agent sessions or appear in Running.",
    emptyMessage: "No system notification automations in this workspace."
  },
  {
    key: "session_run",
    title: "Agent Tasks",
    description: "Queued work that runs in an agent session and can appear in Running.",
    emptyMessage: "No agent task automations in this workspace."
  },
  {
    key: "other",
    title: "Other Delivery",
    description: "Automations using an unrecognized delivery channel.",
    emptyMessage: "No automations with other delivery channels."
  }
];

function automationSectionKey(job: CronjobRecordPayload): AutomationSectionKey {
  const channel = job.delivery?.channel?.trim();
  if (channel === "system_notification") {
    return "system_notification";
  }
  if (channel === "session_run") {
    return "session_run";
  }
  return "other";
}

function deliveryLabel(job: CronjobRecordPayload): string {
  switch (automationSectionKey(job)) {
    case "system_notification":
      return "System Notification";
    case "session_run":
      return "Agent Task";
    default:
      return job.delivery?.channel?.trim() || "Unknown Delivery";
  }
}

function notificationMessage(job: CronjobRecordPayload): string | null {
  const value = job.metadata?.message;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function AutomationsPane() {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const [cronjobs, setCronjobs] = useState<CronjobRecordPayload[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">("info");

  const cronjobsBySection = useMemo(() => {
    const grouped: Record<AutomationSectionKey, CronjobRecordPayload[]> = {
      system_notification: [],
      session_run: [],
      other: []
    };
    const sorted = [...cronjobs].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
    for (const job of sorted) {
      grouped[automationSectionKey(job)].push(job);
    }
    return grouped;
  }, [cronjobs]);

  async function refreshCronjobs() {
    if (!selectedWorkspaceId) {
      setCronjobs([]);
      return;
    }
    setIsLoading(true);
    try {
      const response = await window.electronAPI.workspace.listCronjobs(selectedWorkspaceId);
      setCronjobs(response.jobs);
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(normalizeErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshCronjobs();
  }, [selectedWorkspaceId]);

  const handleDelete = async (job: CronjobRecordPayload) => {
    setBusyJobId(job.id);
    setStatusMessage("");
    try {
      await window.electronAPI.workspace.deleteCronjob(job.id);
      setStatusTone("success");
      setStatusMessage(`Deleted cronjob "${job.name || job.description}".`);
      await refreshCronjobs();
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
        enabled: !job.enabled
      });
      setStatusTone("success");
      setStatusMessage(`${updated.enabled ? "Enabled" : "Disabled"} "${updated.name || updated.description}".`);
      await refreshCronjobs();
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(normalizeErrorMessage(error));
    } finally {
      setBusyJobId(null);
    }
  };

  return (
    <PaneCard className="shadow-md">
      <div className="mx-auto flex h-full min-h-0 max-w-5xl flex-col">
        {statusMessage ? (
          <div className="shrink-0 border-b border-border px-4 py-3">
            <div
              className={`rounded-xl border px-3 py-2 text-xs ${
                statusTone === "success"
                  ? "border-primary/25 bg-primary/5 text-foreground"
                  : statusTone === "error"
                    ? "border-destructive/25 bg-destructive/5 text-destructive"
                    : "border-border bg-muted text-muted-foreground"
              }`}
            >
              {statusMessage}
            </div>
          </div>
        ) : null}

        <div
          className={
            !selectedWorkspaceId || cronjobs.length === 0
              ? "min-h-0 flex flex-1 items-center justify-center p-4"
              : "min-h-0 flex-1 overflow-y-auto p-4"
          }
        >
          {!selectedWorkspaceId ? (
            <EmptyState message="Choose a workspace from the top bar to view and manage cronjobs." />
          ) : cronjobs.length === 0 ? (
            <EmptyState message={isLoading ? "Loading cronjobs..." : "No cronjobs found for this workspace."} />
          ) : (
            <div className="grid gap-3">
              {AUTOMATION_SECTIONS.filter((section) => section.key !== "other" || cronjobsBySection.other.length > 0).map((section) => (
                <section key={section.key} className="rounded-2xl border border-border bg-card/60 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground">{section.title}</div>
                      <div className="mt-0.5 max-w-2xl text-[11px] leading-4 text-muted-foreground">{section.description}</div>
                    </div>
                    <Badge variant="outline">{cronjobsBySection[section.key].length}</Badge>
                  </div>

                  {cronjobsBySection[section.key].length === 0 ? (
                    <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
                      {section.emptyMessage}
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-2.5">
                      {cronjobsBySection[section.key].map((job) => {
                        const isBusy = busyJobId === job.id;
                        const message = notificationMessage(job);
                        return (
                          <div key={job.id} className="rounded-xl border border-border bg-muted px-3 py-3 sm:px-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-foreground">{job.name || job.description}</div>
                                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{job.cron}</div>
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                <Badge variant="outline">{deliveryLabel(job)}</Badge>
                                <Badge variant={job.enabled ? "default" : "secondary"}>
                                  {job.enabled ? "Enabled" : "Disabled"}
                                </Badge>
                              </div>
                            </div>

                            <div className="mt-2 grid gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
                              <div>Next run: {formatTimestamp(job.next_run_at)}</div>
                              <div>Last run: {formatTimestamp(job.last_run_at)}</div>
                              <div>Runs: {job.run_count}</div>
                              {message ? <div className="sm:col-span-2 xl:col-span-3">Message: {message}</div> : null}
                              {job.last_status ? <div>Status: {job.last_status}</div> : null}
                              {job.last_error ? <div className="sm:col-span-2 xl:col-span-3">Last error: {job.last_error}</div> : null}
                            </div>

                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleToggleEnabled(job)}
                                disabled={isBusy}
                              >
                                {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                                <span>{job.enabled ? "Disable" : "Enable"}</span>
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => void handleDelete(job)}
                                disabled={isBusy}
                              >
                                {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                                <span>Delete</span>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>

      </div>
    </PaneCard>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6 text-center">
      <div className="max-w-xs">
        <Clock3 size={20} className="mx-auto text-muted-foreground" />
        <div className="mt-3 text-sm font-medium text-foreground">No automations yet</div>
        <div className="mt-1 text-xs text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}
