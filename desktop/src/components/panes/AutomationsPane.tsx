import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, Clock3, Loader2, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import { PaneCard } from "@/components/ui/PaneCard";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

const DELIVERY_CHANNEL_OPTIONS = [
  { value: "session_run", label: "Session run" },
  { value: "system_notification", label: "System notification" }
];

const DELIVERY_MODE_OPTIONS = [
  { value: "announce", label: "Announce" },
  { value: "none", label: "None" }
];

interface CronjobFormState {
  name: string;
  cron: string;
  description: string;
  enabled: boolean;
  deliveryChannel: string;
  deliveryMode: string;
  deliveryTo: string;
  metadataJson: string;
}

function defaultFormState(): CronjobFormState {
  return {
    name: "",
    cron: "0 9 * * *",
    description: "",
    enabled: true,
    deliveryChannel: "session_run",
    deliveryMode: "announce",
    deliveryTo: "",
    metadataJson: "{}"
  };
}

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

function parseMetadata(raw: string): Record<string, unknown> {
  const trimmed = raw.trim() || "{}";
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Metadata must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function formStateFromCronjob(job: CronjobRecordPayload): CronjobFormState {
  return {
    name: job.name || "",
    cron: job.cron,
    description: job.description,
    enabled: job.enabled,
    deliveryChannel: job.delivery?.channel || "session_run",
    deliveryMode: job.delivery?.mode || "announce",
    deliveryTo: job.delivery?.to || "",
    metadataJson: JSON.stringify(job.metadata || {}, null, 2)
  };
}

export function AutomationsPane() {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const { selectedWorkspace } = useWorkspaceDesktop();
  const [cronjobs, setCronjobs] = useState<CronjobRecordPayload[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [formState, setFormState] = useState<CronjobFormState>(defaultFormState);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">("info");

  const sortedCronjobs = useMemo(() => {
    return [...cronjobs].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  }, [cronjobs]);

  const selectedCronjob = useMemo(
    () => sortedCronjobs.find((job) => job.id === selectedJobId) ?? null,
    [selectedJobId, sortedCronjobs]
  );

  async function refreshCronjobs() {
    if (!selectedWorkspaceId) {
      setCronjobs([]);
      setSelectedJobId(null);
      return;
    }
    setIsLoading(true);
    try {
      const response = await window.electronAPI.workspace.listCronjobs(selectedWorkspaceId);
      setCronjobs(response.jobs);
      setSelectedJobId((current) => {
        if (current && response.jobs.some((job) => job.id === current)) {
          return current;
        }
        return response.jobs[0]?.id ?? null;
      });
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

  useEffect(() => {
    if (selectedCronjob) {
      setFormState(formStateFromCronjob(selectedCronjob));
      return;
    }
    setFormState(defaultFormState());
  }, [selectedCronjob]);

  const startCreateFlow = () => {
    setSelectedJobId(null);
    setFormState(defaultFormState());
    setStatusMessage("");
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWorkspaceId) {
      setStatusTone("error");
      setStatusMessage("Select a workspace before managing cronjobs.");
      return;
    }

    setIsSaving(true);
    setStatusMessage("");
    try {
      const metadata = parseMetadata(formState.metadataJson);
      const payload = {
        name: formState.name.trim(),
        cron: formState.cron.trim(),
        description: formState.description.trim(),
        enabled: formState.enabled,
        delivery: {
          channel: formState.deliveryChannel,
          mode: formState.deliveryMode,
          to: formState.deliveryTo.trim() || null
        },
        metadata
      };

      if (selectedCronjob) {
        const updated = await window.electronAPI.workspace.updateCronjob(selectedCronjob.id, payload);
        setStatusTone("success");
        setStatusMessage(`Updated cronjob "${updated.name || updated.description}".`);
        await refreshCronjobs();
        setSelectedJobId(updated.id);
      } else {
        const created = await window.electronAPI.workspace.createCronjob({
          workspace_id: selectedWorkspaceId,
          initiated_by: "desktop_operator",
          ...payload
        });
        setStatusTone("success");
        setStatusMessage(`Created cronjob "${created.name || created.description}".`);
        await refreshCronjobs();
        setSelectedJobId(created.id);
      }
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(normalizeErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedCronjob) {
      return;
    }
    setBusyJobId(selectedCronjob.id);
    setStatusMessage("");
    try {
      await window.electronAPI.workspace.deleteCronjob(selectedCronjob.id);
      setStatusTone("success");
      setStatusMessage(`Deleted cronjob "${selectedCronjob.name || selectedCronjob.description}".`);
      setSelectedJobId(null);
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
      setSelectedJobId(updated.id);
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(normalizeErrorMessage(error));
    } finally {
      setBusyJobId(null);
    }
  };

  const actions = (
    <>
      <button
        type="button"
        onClick={() => void refreshCronjobs()}
        disabled={isLoading}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-panel-border/45 px-3 text-[11px] text-text-muted transition hover:border-neon-green/35 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
        <span>Refresh</span>
      </button>
      <button
        type="button"
        onClick={startCreateFlow}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-neon-green/40 bg-neon-green/10 px-3 text-[11px] text-neon-green transition hover:bg-neon-green/14"
      >
        <Plus size={12} />
        <span>New cronjob</span>
      </button>
    </>
  );

  return (
    <PaneCard title="Automations" actions={actions} className="shadow-glow">
      <div className="grid h-full min-h-0 gap-4 p-4 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
        <div className="flex min-h-0 flex-col rounded-[18px] border border-panel-border/35 bg-black/10">
          <div className="shrink-0 border-b border-panel-border/35 px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-neon-green/76">Workspace cronjobs</div>
            <div className="mt-1 text-[12px] text-text-main/88">
              {selectedWorkspace ? `Manage scheduled runs for ${selectedWorkspace.name}.` : "Select a workspace to manage cronjobs."}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {!selectedWorkspaceId ? (
              <EmptyState message="Choose a workspace from the top bar to view its cronjobs." />
            ) : sortedCronjobs.length === 0 ? (
              <EmptyState message={isLoading ? "Loading cronjobs..." : "No cronjobs yet. Create one to start scheduled automation."} />
            ) : (
              <div className="grid gap-3">
                {sortedCronjobs.map((job) => {
                  const isActive = job.id === selectedJobId;
                  const isBusy = busyJobId === job.id;
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => setSelectedJobId(job.id)}
                      className={`rounded-[16px] border px-4 py-4 text-left transition ${
                        isActive
                          ? "border-neon-green/40 bg-neon-green/10"
                          : "border-panel-border/35 bg-black/10 hover:border-neon-green/25"
                      }`}
                    >
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
                      </div>

                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleToggleEnabled(job);
                          }}
                          disabled={isBusy}
                          className="inline-flex h-8 items-center justify-center gap-2 rounded-[12px] border border-panel-border/45 px-3 text-[10px] text-text-muted transition hover:border-neon-green/35 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          <span>{job.enabled ? "Disable" : "Enable"}</span>
                        </button>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 rounded-[18px] border border-panel-border/35 bg-black/10">
          <form onSubmit={onSubmit} className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b border-panel-border/35 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-neon-green/76">
                {selectedCronjob ? "Edit cronjob" : "Create cronjob"}
              </div>
              <div className="mt-1 text-[12px] text-text-main/88">
                {selectedCronjob ? "Update schedule details, delivery, and runtime metadata." : "Define a new scheduled automation for this workspace."}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {!selectedWorkspaceId ? (
                <EmptyState message="Cronjob management becomes available after you select a workspace." />
              ) : (
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <label className="text-[11px] uppercase tracking-[0.12em] text-text-dim/74">Name</label>
                    <input
                      value={formState.name}
                      onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Morning release check"
                      className="theme-control-surface rounded-[16px] border border-panel-border/45 bg-transparent px-3 py-2 text-[12px] text-text-main outline-none placeholder:text-text-dim/40"
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-[11px] uppercase tracking-[0.12em] text-text-dim/74">Cron</label>
                    <input
                      value={formState.cron}
                      onChange={(event) => setFormState((current) => ({ ...current, cron: event.target.value }))}
                      placeholder="0 9 * * *"
                      className="theme-control-surface rounded-[16px] border border-panel-border/45 bg-transparent px-3 py-2 text-[12px] text-text-main outline-none placeholder:text-text-dim/40"
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-[11px] uppercase tracking-[0.12em] text-text-dim/74">Description</label>
                    <textarea
                      value={formState.description}
                      onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Check campaign metrics and produce an operator summary."
                      rows={5}
                      className="theme-control-surface min-h-[120px] rounded-[16px] border border-panel-border/45 bg-transparent px-3 py-3 text-[12px] text-text-main outline-none placeholder:text-text-dim/40"
                    />
                  </div>

                  <label className="flex items-center gap-3 rounded-[16px] border border-panel-border/35 px-3 py-3 text-[12px] text-text-main">
                    <input
                      type="checkbox"
                      checked={formState.enabled}
                      onChange={(event) => setFormState((current) => ({ ...current, enabled: event.target.checked }))}
                      className="h-4 w-4 rounded border-panel-border/50 bg-transparent"
                    />
                    <span>Enable this cronjob immediately after saving</span>
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <label className="text-[11px] uppercase tracking-[0.12em] text-text-dim/74">Delivery channel</label>
                      <select
                        value={formState.deliveryChannel}
                        onChange={(event) => setFormState((current) => ({ ...current, deliveryChannel: event.target.value }))}
                        className="theme-control-surface rounded-[16px] border border-panel-border/45 bg-transparent px-3 py-2 text-[12px] text-text-main outline-none"
                      >
                        {DELIVERY_CHANNEL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value} className="bg-obsidian text-text-main">
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <label className="text-[11px] uppercase tracking-[0.12em] text-text-dim/74">Delivery mode</label>
                      <select
                        value={formState.deliveryMode}
                        onChange={(event) => setFormState((current) => ({ ...current, deliveryMode: event.target.value }))}
                        className="theme-control-surface rounded-[16px] border border-panel-border/45 bg-transparent px-3 py-2 text-[12px] text-text-main outline-none"
                      >
                        {DELIVERY_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value} className="bg-obsidian text-text-main">
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-[11px] uppercase tracking-[0.12em] text-text-dim/74">Delivery target</label>
                    <input
                      value={formState.deliveryTo}
                      onChange={(event) => setFormState((current) => ({ ...current, deliveryTo: event.target.value }))}
                      placeholder="Optional target identifier"
                      className="theme-control-surface rounded-[16px] border border-panel-border/45 bg-transparent px-3 py-2 text-[12px] text-text-main outline-none placeholder:text-text-dim/40"
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-[11px] uppercase tracking-[0.12em] text-text-dim/74">Metadata JSON</label>
                    <textarea
                      value={formState.metadataJson}
                      onChange={(event) => setFormState((current) => ({ ...current, metadataJson: event.target.value }))}
                      rows={8}
                      className="theme-control-surface min-h-[180px] rounded-[16px] border border-panel-border/45 bg-transparent px-3 py-3 font-mono text-[11px] text-text-main outline-none"
                    />
                  </div>

                  {selectedCronjob ? (
                    <div className="grid gap-2 rounded-[16px] border border-panel-border/35 bg-black/10 px-4 py-3 text-[11px] text-text-muted">
                      <div className="flex items-center gap-2 text-text-main/88">
                        <Clock3 size={13} className="text-neon-green/80" />
                        <span className="font-medium">Runtime status</span>
                      </div>
                      <div>Next run: {formatTimestamp(selectedCronjob.next_run_at)}</div>
                      <div>Last run: {formatTimestamp(selectedCronjob.last_run_at)}</div>
                      <div>Run count: {selectedCronjob.run_count}</div>
                      {selectedCronjob.last_status ? <div>Last status: {selectedCronjob.last_status}</div> : null}
                      {selectedCronjob.last_error ? <div>Last error: {selectedCronjob.last_error}</div> : null}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-panel-border/35 px-4 py-3">
              {statusMessage ? (
                <div
                  className={`mb-3 rounded-[14px] border px-3 py-2 text-[11px] ${
                    statusTone === "success"
                      ? "border-neon-green/30 bg-neon-green/10 text-text-main/92"
                      : statusTone === "error"
                        ? "border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.08)] text-[rgba(255,212,189,0.92)]"
                        : "border-panel-border/35 bg-black/10 text-text-muted"
                  }`}
                >
                  {statusMessage}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-[0.12em] text-text-dim/70">
                  {selectedWorkspace ? `Workspace ${selectedWorkspace.name}` : "No workspace selected"}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedCronjob ? (
                    <button
                      type="button"
                      onClick={() => void handleDelete()}
                      disabled={isSaving || busyJobId === selectedCronjob.id}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-[rgba(255,153,102,0.24)] px-3 text-[11px] text-[rgba(255,212,189,0.92)] transition hover:bg-[rgba(255,153,102,0.08)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyJobId === selectedCronjob.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      <span>Delete</span>
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={!selectedWorkspaceId || isSaving}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-neon-green/40 bg-neon-green/10 px-3 text-[11px] text-neon-green transition hover:bg-neon-green/14 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    <span>{selectedCronjob ? "Save changes" : "Create cronjob"}</span>
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </PaneCard>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[16px] border border-panel-border/35 bg-black/10 px-4 py-5 text-[12px] leading-6 text-text-dim/78">
      {message}
    </div>
  );
}
