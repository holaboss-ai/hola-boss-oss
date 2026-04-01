import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Loader2, Trash2 } from "lucide-react";
import { PaneCard } from "@/components/ui/PaneCard";
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

export function AutomationsPane() {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const [cronjobs, setCronjobs] = useState<CronjobRecordPayload[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">("info");

  const sortedCronjobs = useMemo(() => {
    return [...cronjobs].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
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
              className={`rounded-xl border px-3 py-2 text-[11px] ${
                statusTone === "success"
                  ? "border-primary/30 bg-primary/10 text-foreground/92"
                  : statusTone === "error"
                    ? "border-destructive/25 bg-[rgba(255,153,102,0.08)] text-destructive"
                    : "border-border bg-muted text-muted-foreground"
              }`}
            >
              {statusMessage}
            </div>
          </div>
        ) : null}

        <div
          className={
            !selectedWorkspaceId || sortedCronjobs.length === 0
              ? "min-h-0 flex flex-1 items-center justify-center p-4"
              : "min-h-0 flex-1 overflow-y-auto p-4"
          }
        >
          {!selectedWorkspaceId ? (
            <EmptyState message="Choose a workspace from the top bar to view and manage cronjobs." />
          ) : sortedCronjobs.length === 0 ? (
            <EmptyState message={isLoading ? "Loading cronjobs..." : "No cronjobs found for this workspace."} />
          ) : (
            <div className="grid gap-3">
              {sortedCronjobs.map((job) => {
                const isBusy = busyJobId === job.id;
                return (
                  <div key={job.id} className="rounded-xl border border-border bg-muted px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-foreground">{job.name || job.description}</div>
                        <div className="mt-1 truncate text-[11px] text-muted-foreground">{job.cron}</div>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${
                          job.enabled
                            ? "border-primary/35 bg-primary/10 text-primary"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {job.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-1 text-[10px] text-muted-foreground">
                      <div>Next run: {formatTimestamp(job.next_run_at)}</div>
                      <div>Last run: {formatTimestamp(job.last_run_at)}</div>
                      <div>Runs: {job.run_count}</div>
                      {job.last_status ? <div>Status: {job.last_status}</div> : null}
                      {job.last_error ? <div>Last error: {job.last_error}</div> : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleToggleEnabled(job)}
                        disabled={isBusy}
                        className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-border px-3 text-[10px] text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                        <span>{job.enabled ? "Disable" : "Enable"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(job)}
                        disabled={isBusy}
                        className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-destructive/25 px-3 text-[10px] text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
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
