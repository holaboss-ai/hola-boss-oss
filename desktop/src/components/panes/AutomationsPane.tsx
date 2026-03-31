import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Loader2, RefreshCw, Sparkles, Trash2, TriangleAlert, Workflow } from "lucide-react";
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
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(parsed));
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDeliverySummary(job: CronjobRecordPayload): string {
  const parts = [job.delivery.channel, job.delivery.mode, job.delivery.to].filter((value): value is string => Boolean(value?.trim()));
  return parts.length ? parts.join(" / ") : "Workspace delivery";
}

function formatStatusLabel(status: string | null): string {
  if (!status) {
    return "No recent status";
  }
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function AutomationsPane() {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const [cronjobs, setCronjobs] = useState<CronjobRecordPayload[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">("info");

  const sortedCronjobs = useMemo(() => {
    return [...cronjobs].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  }, [cronjobs]);

  const selectedJob = useMemo(
    () => sortedCronjobs.find((job) => job.id === selectedJobId) ?? null,
    [selectedJobId, sortedCronjobs]
  );

  async function refreshCronjobs() {
    if (!selectedWorkspaceId) {
      setCronjobs([]);
      setSelectedJobId("");
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
    if (!selectedWorkspaceId) {
      setCronjobs([]);
      setSelectedJobId("");
      setStatusMessage("");
      return;
    }
    void refreshCronjobs();
  }, [selectedWorkspaceId]);

  useEffect(() => {
    setSelectedJobId((current) => {
      if (current && sortedCronjobs.some((job) => job.id === current)) {
        return current;
      }
      return sortedCronjobs[0]?.id ?? "";
    });
  }, [sortedCronjobs]);

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
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.03),transparent_24%)]" />

      <div className="relative min-h-0 flex-1 p-4">
        {!selectedWorkspaceId ? (
          <EmptyState title="No workspace selected" detail="Select a workspace to review its scheduled automations." />
        ) : isLoading && sortedCronjobs.length === 0 ? (
          <LoadingState label="Loading workspace automations..." />
        ) : statusTone === "error" && sortedCronjobs.length === 0 && statusMessage ? (
          <EmptyState title="Automations failed to load" detail={statusMessage} tone="error" />
        ) : sortedCronjobs.length === 0 ? (
          <EmptyState
            title="No automations yet"
            detail="This workspace does not have any cronjobs configured yet."
          />
        ) : (
          <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="theme-subtle-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-panel-border/35 shadow-card">
              <div className="border-b border-panel-border/35 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">Schedule</div>
                    <div className="mt-1 text-[14px] font-medium text-text-main">Workspace automations</div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshCronjobs()}
                    disabled={isLoading}
                    className="theme-control-surface inline-flex h-9 items-center gap-2 rounded-[14px] border border-panel-border/45 px-3 text-[11px] text-text-muted transition hover:border-[rgba(247,90,84,0.24)] hover:text-text-main disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
                    <span>Refresh</span>
                  </button>
                </div>

                {statusMessage ? (
                  <div
                    className={`mt-4 rounded-[16px] border px-3 py-2 text-[11px] leading-5 ${
                      statusTone === "success"
                        ? "border-[rgba(247,90,84,0.22)] bg-[rgba(247,90,84,0.08)] text-text-main/88"
                        : statusTone === "error"
                          ? "border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.08)] text-[rgba(255,212,189,0.92)]"
                          : "border-panel-border/35 bg-black/10 text-text-muted"
                    }`}
                  >
                    {statusMessage}
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                <div className="grid gap-2">
                  {sortedCronjobs.map((job) => {
                    const active = job.id === selectedJobId;
                    return (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => setSelectedJobId(job.id)}
                        className={`group relative overflow-hidden rounded-[20px] border px-4 py-4 text-left transition-all duration-200 ${
                          active
                            ? "border-[rgba(247,90,84,0.3)] bg-[linear-gradient(145deg,rgba(247,90,84,0.08),rgba(255,255,255,0.02))] shadow-card"
                            : "border-panel-border/35 bg-panel-bg/18 hover:border-[rgba(247,90,84,0.24)] hover:bg-[var(--theme-hover-bg)]"
                        }`}
                      >
                        <div
                          className={`absolute inset-y-4 left-0 w-1 rounded-r-full transition-all duration-200 ${
                            active ? "bg-[rgba(247,90,84,0.82)]" : "bg-transparent group-hover:bg-[rgba(247,90,84,0.35)]"
                          }`}
                        />
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium text-text-main">{job.name || job.description}</div>
                            <div className="mt-1 truncate text-[11px] uppercase tracking-[0.14em] text-text-dim/72">
                              {job.cron}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                              job.enabled
                                ? "border-[rgba(247,90,84,0.24)] bg-[rgba(247,90,84,0.08)] text-[rgba(206,92,84,0.92)]"
                                : "border-panel-border/35 bg-black/10 text-text-dim/74"
                            }`}
                          >
                            {job.enabled ? "Enabled" : "Paused"}
                          </span>
                        </div>
                        <div
                          className="mt-2 text-[12px] leading-6 text-text-muted/82"
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden"
                          }}
                        >
                          {job.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>

            <div className="theme-subtle-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-panel-border/35 shadow-card">
              {selectedJob ? (
                <>
                  <div className="relative overflow-hidden border-b border-panel-border/35 px-5 py-5">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(247,90,84,0.08),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.04),transparent_32%)]" />
                    <div className="relative">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-2 rounded-full border border-panel-border/35 bg-black/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-text-dim/76">
                            <Workflow size={12} className="text-text-dim/78" />
                            <span>{selectedJob.cron}</span>
                          </div>
                          <div className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-text-main">
                            {selectedJob.name || selectedJob.description}
                          </div>
                          <div className="mt-2 max-w-[760px] text-[13px] leading-7 text-text-muted/84">
                            {selectedJob.description}
                          </div>
                        </div>
                        <div
                          className={`rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] ${
                            selectedJob.enabled
                              ? "border-[rgba(247,90,84,0.24)] bg-[rgba(247,90,84,0.08)] text-[rgba(206,92,84,0.92)]"
                              : "border-panel-border/35 bg-black/10 text-text-dim/74"
                          }`}
                        >
                          {selectedJob.enabled ? "Enabled" : "Paused"}
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        <MetadataRow label="Delivery" value={formatDeliverySummary(selectedJob)} />
                        <MetadataRow label="Last status" value={formatStatusLabel(selectedJob.last_status)} />
                        <MetadataRow label="Next run" value={formatTimestamp(selectedJob.next_run_at)} />
                        <MetadataRow label="Last run" value={formatTimestamp(selectedJob.last_run_at)} />
                      </div>
                    </div>
                  </div>

                  <div className="grid min-h-0 flex-1 gap-4 p-4">
                    <div className="rounded-[24px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] p-4">
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-text-dim/76">
                        <Clock3 size={13} className="text-[rgba(247,138,132,0.86)]" />
                        <span>Run summary</span>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <MetadataRow label="Runs" value={formatCount(selectedJob.run_count)} />
                        <MetadataRow label="Initiated by" value={selectedJob.initiated_by || "Unknown"} />
                      </div>

                      {selectedJob.last_error ? (
                        <div className="mt-4 rounded-[16px] border border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.08)] px-4 py-3 text-[12px] leading-6 text-[rgba(255,212,189,0.92)]">
                          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em]">
                            <TriangleAlert size={12} />
                            <span>Last error</span>
                          </div>
                          <div className="mt-2">{selectedJob.last_error}</div>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-auto flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleToggleEnabled(selectedJob)}
                        disabled={busyJobId === selectedJob.id}
                        className="theme-control-surface inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-panel-border/45 px-4 text-[11px] text-text-muted transition hover:border-[rgba(247,90,84,0.24)] hover:text-text-main disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyJobId === selectedJob.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        <span>{selectedJob.enabled ? "Disable" : "Enable"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(selectedJob)}
                        disabled={busyJobId === selectedJob.id}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-[rgba(255,153,102,0.24)] px-4 text-[11px] text-[rgba(255,212,189,0.92)] transition hover:bg-[rgba(255,153,102,0.08)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyJobId === selectedJob.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState title="No automation selected" detail="Choose an automation from the list to inspect it." />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MetadataRow({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-[16px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-3 py-2 ${className}`.trim()}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-dim/72">{label}</div>
      <div className="mt-1 break-all text-[12px] text-text-main/86">{value}</div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-6 py-8">
      <div className="inline-flex items-center gap-2 text-[12px] text-text-muted">
        <Loader2 size={14} className="animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  detail,
  tone = "neutral"
}: {
  title: string;
  detail: string;
  tone?: "neutral" | "error";
}) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-6 py-8">
      <div
        className={`w-full max-w-[420px] rounded-[24px] border px-8 py-9 text-center shadow-card ${
          tone === "error"
            ? "border-[rgba(255,153,102,0.24)] bg-[linear-gradient(180deg,rgba(255,153,102,0.08),rgba(255,255,255,0.38))]"
            : "border-panel-border/30 bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(255,255,255,0.42))]"
        }`}
      >
        <div
          className={`mx-auto grid h-10 w-10 place-items-center rounded-full border ${
            tone === "error"
              ? "border-[rgba(255,153,102,0.24)] text-[rgba(255,153,102,0.92)]"
              : "border-[rgba(247,90,84,0.18)] text-[rgba(247,90,84,0.84)]"
          }`}
        >
          {tone === "error" ? <TriangleAlert size={18} /> : <Sparkles size={18} />}
        </div>
        <div className="mt-3 text-[16px] font-medium text-text-main">{title}</div>
        <div className="mt-2 text-[12px] leading-6 text-text-muted/82">{detail}</div>
      </div>
    </div>
  );
}
