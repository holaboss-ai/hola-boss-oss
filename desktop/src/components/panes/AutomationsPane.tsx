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
    <PaneCard className="shadow-glow">
      <div className="flex h-full min-h-0 flex-col">
        {statusMessage ? (
          <div className="shrink-0 border-b border-panel-border/35 px-4 py-3">
            <div
              className={`rounded-[14px] border px-3 py-2 text-[11px] ${
                statusTone === "success"
                  ? "border-neon-green/30 bg-neon-green/10 text-text-main/92"
                  : statusTone === "error"
                    ? "border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.08)] text-[rgba(255,212,189,0.92)]"
                    : "border-panel-border/35 bg-black/10 text-text-muted"
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
                  <div key={job.id} className="rounded-[16px] border border-panel-border/35 bg-black/10 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-text-main">{job.name || job.description}</div>
                        <div className="mt-1 truncate text-[11px] text-text-muted">{job.cron}</div>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${
                          job.enabled
                            ? "border-neon-green/35 bg-neon-green/10 text-neon-green"
                            : "border-panel-border/45 text-text-dim"
                        }`}
                      >
                        {job.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-1 text-[10px] text-text-dim/78">
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
                        className="inline-flex h-8 items-center justify-center gap-2 rounded-[12px] border border-panel-border/45 px-3 text-[10px] text-text-muted transition hover:border-neon-green/35 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                        <span>{job.enabled ? "Disable" : "Enable"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(job)}
                        disabled={isBusy}
                        className="inline-flex h-8 items-center justify-center gap-2 rounded-[12px] border border-[rgba(255,153,102,0.24)] px-3 text-[10px] text-[rgba(255,212,189,0.92)] transition hover:bg-[rgba(255,153,102,0.08)] disabled:cursor-not-allowed disabled:opacity-50"
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
    <div className="flex h-full min-h-full w-full items-center justify-center px-6 py-8">
      <div className="w-full max-w-[420px] rounded-[24px] border border-panel-border/30 bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(255,255,255,0.42))] px-8 py-9 text-center shadow-card">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-[rgba(247,90,84,0.18)] text-[rgba(247,90,84,0.84)]">
          <Clock3 size={18} />
        </div>
        <div className="mt-3 text-[15px] font-medium text-text-main">No automations yet</div>
        <div className="mt-2 text-[12px] leading-6 text-text-muted/82">{message}</div>
      </div>
    </div>
  );
}
