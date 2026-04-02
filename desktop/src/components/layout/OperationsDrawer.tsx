import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, Check, ChevronRight, Clock3, Loader2, RefreshCcw, Sparkles, X } from "lucide-react";
import { getWorkspaceAppDefinition, type WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";

export type OperationsDrawerTab = "inbox" | "running" | "outputs";

export type OperationsOutputRenderer =
  | {
      type: "app";
      appId: string;
      resourceId?: string | null;
      view?: string | null;
    }
  | {
      type: "internal";
      surface: "document" | "preview" | "file" | "event";
      resourceId?: string | null;
      htmlContent?: string | null;
    };

export interface OperationsOutputEntry {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
  tone: "info" | "success" | "error";
  sessionId?: string | null;
  renderer: OperationsOutputRenderer;
}

interface OperationsDrawerProps {
  activeTab: OperationsDrawerTab;
  onTabChange: (tab: OperationsDrawerTab) => void;
  proposals: TaskProposalRecordPayload[];
  isLoadingProposals: boolean;
  isTriggeringProposal: boolean;
  proposalStatusMessage: string;
  proposalAction: {
    proposalId: string;
    action: "accept" | "dismiss";
  } | null;
  outputs: OperationsOutputEntry[];
  installedApps: WorkspaceInstalledAppDefinition[];
  selectedOutputId: string | null;
  onSelectOutput: (outputId: string) => void;
  onOpenOutput: (entry: OperationsOutputEntry) => void;
  onRefreshProposals: () => void;
  onTriggerProposal: () => void;
  onAcceptProposal: (proposal: TaskProposalRecordPayload) => void;
  onDismissProposal: (proposal: TaskProposalRecordPayload) => void;
  hasWorkspace: boolean;
  selectedWorkspaceId: string | null;
}

interface RunningSessionEntry {
  sessionId: string;
  status: string;
  title: string;
  kind: string;
  updatedAt: string;
  lastError: string | null;
}

export function OperationsDrawer({
  activeTab,
  onTabChange,
  proposals,
  isLoadingProposals,
  isTriggeringProposal,
  proposalStatusMessage,
  proposalAction,
  outputs,
  installedApps,
  selectedOutputId,
  onSelectOutput,
  onOpenOutput,
  onRefreshProposals,
  onTriggerProposal,
  onAcceptProposal,
  onDismissProposal,
  hasWorkspace,
  selectedWorkspaceId
}: OperationsDrawerProps) {
  const selectedOutput = useMemo(() => {
    if (!outputs.length) {
      return null;
    }
    return outputs.find((entry) => entry.id === selectedOutputId) ?? outputs[0];
  }, [outputs, selectedOutputId]);
  const [runningSessions, setRunningSessions] = useState<RunningSessionEntry[]>([]);
  const [isLoadingRunningSessions, setIsLoadingRunningSessions] = useState(false);
  const [runningSessionsError, setRunningSessionsError] = useState("");

  useEffect(() => {
    if (activeTab !== "running") {
      return;
    }
    if (!selectedWorkspaceId) {
      setRunningSessions([]);
      setRunningSessionsError("");
      return;
    }

    let cancelled = false;

    const loadRunningSessions = async () => {
      setIsLoadingRunningSessions(true);
      try {
        const [runtimeStatesResponse, sessionsResponse] = await Promise.all([
          window.electronAPI.workspace.listRuntimeStates(selectedWorkspaceId),
          window.electronAPI.workspace.listAgentSessions(selectedWorkspaceId)
        ]);
        if (cancelled) {
          return;
        }

        const sessionById = new Map(
          sessionsResponse.items.map((session) => [session.session_id, session])
        );
        const nextEntries = runtimeStatesResponse.items
          .filter((state) => state.status !== "IDLE")
          .map((state) => {
            const session = sessionById.get(state.session_id);
            return {
              sessionId: state.session_id,
              status: state.status,
              title: session?.title?.trim() || defaultSessionTitle(session?.kind, state.session_id),
              kind: session?.kind?.trim() || "session",
              updatedAt: state.updated_at,
              lastError: runtimeStateErrorMessage(state.last_error)
            };
          })
          .sort(compareRunningSessionEntries);

        setRunningSessions(nextEntries);
        setRunningSessionsError("");
      } catch (error) {
        if (!cancelled) {
          setRunningSessionsError(normalizeOperationError(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRunningSessions(false);
        }
      }
    };

    void loadRunningSessions();
    const intervalId = window.setInterval(() => {
      void loadRunningSessions();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeTab, selectedWorkspaceId]);

  return (
    <aside className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-[360px] max-w-[420px] flex-col overflow-hidden rounded-[var(--radius-xl)] shadow-lg">
      <header className="theme-header-surface flex shrink-0 items-center justify-between gap-3 border-b border-primary/15 px-4 py-3">
        <div className="flex items-center gap-2">
          <DrawerTabButton active={activeTab === "inbox"} icon={<Bell size={14} />} label="Inbox" onClick={() => onTabChange("inbox")} />
          <DrawerTabButton
            active={activeTab === "running"}
            icon={<Clock3 size={14} />}
            label="Running"
            onClick={() => onTabChange("running")}
          />
          <DrawerTabButton
            active={activeTab === "outputs"}
            icon={<ChevronRight size={14} />}
            label="Outputs"
            onClick={() => onTabChange("outputs")}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "inbox" ? (
          <InboxPanel
            proposals={proposals}
            isLoadingProposals={isLoadingProposals}
            isTriggeringProposal={isTriggeringProposal}
            proposalStatusMessage={proposalStatusMessage}
            proposalAction={proposalAction}
            hasWorkspace={hasWorkspace}
            onRefreshProposals={onRefreshProposals}
            onTriggerProposal={onTriggerProposal}
            onAcceptProposal={onAcceptProposal}
            onDismissProposal={onDismissProposal}
          />
        ) : null}

        {activeTab === "running" ? (
          <RunningPanel
            hasWorkspace={hasWorkspace}
            isLoading={isLoadingRunningSessions}
            sessions={runningSessions}
            errorMessage={runningSessionsError}
          />
        ) : null}

        {activeTab === "outputs" ? (
          <OutputsPanel
            outputs={outputs}
            installedApps={installedApps}
            selectedOutput={selectedOutput}
            onSelectOutput={onSelectOutput}
            onOpenOutput={onOpenOutput}
          />
        ) : null}
      </div>
    </aside>
  );
}

function normalizeOperationError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

function runtimeStateErrorMessage(value: Record<string, unknown> | null): string | null {
  if (!value) {
    return null;
  }
  const message = typeof value.message === "string" && value.message.trim() ? value.message.trim() : "";
  if (message) {
    return message;
  }
  const rawMessage = typeof value.raw_message === "string" && value.raw_message.trim() ? value.raw_message.trim() : "";
  return rawMessage || null;
}

function defaultSessionTitle(kind: string | null | undefined, sessionId: string): string {
  if (kind === "cronjob") {
    return "Cronjob run";
  }
  if (kind === "task_proposal") {
    return "Task proposal run";
  }
  if (kind === "main") {
    return "Main session";
  }
  return `Session ${sessionId.slice(0, 8)}`;
}

function runningSessionStatusRank(status: string): number {
  switch (status) {
    case "BUSY":
      return 0;
    case "QUEUED":
      return 1;
    case "WAITING_USER":
      return 2;
    case "ERROR":
      return 3;
    default:
      return 4;
  }
}

function compareRunningSessionEntries(left: RunningSessionEntry, right: RunningSessionEntry): number {
  const statusDiff = runningSessionStatusRank(left.status) - runningSessionStatusRank(right.status);
  if (statusDiff !== 0) {
    return statusDiff;
  }
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function runningStatusClasses(status: string): string {
  switch (status) {
    case "BUSY":
      return "border-primary/45 bg-primary/10 text-primary";
    case "QUEUED":
      return "border-primary/35 bg-primary/8 text-primary";
    case "WAITING_USER":
      return "border-border/45 bg-muted text-foreground/82";
    case "ERROR":
      return "border-destructive/35 bg-destructive/10 text-destructive";
    default:
      return "border-border/45 bg-muted text-muted-foreground";
  }
}

function DrawerTabButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-10 items-center gap-2 rounded-[16px] border px-3 text-[12px] transition ${
        active
          ? "border-primary/45 bg-primary/10 text-primary"
          : "border-border/45 text-muted-foreground hover:border-primary/35 hover:text-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function InboxPanel({
  proposals,
  isLoadingProposals,
  isTriggeringProposal,
  proposalStatusMessage,
  proposalAction,
  hasWorkspace,
  onRefreshProposals,
  onTriggerProposal,
  onAcceptProposal,
  onDismissProposal
}: {
  proposals: TaskProposalRecordPayload[];
  isLoadingProposals: boolean;
  isTriggeringProposal: boolean;
  proposalStatusMessage: string;
  proposalAction: {
    proposalId: string;
    action: "accept" | "dismiss";
  } | null;
  hasWorkspace: boolean;
  onRefreshProposals: () => void;
  onTriggerProposal: () => void;
  onAcceptProposal: (proposal: TaskProposalRecordPayload) => void;
  onDismissProposal: (proposal: TaskProposalRecordPayload) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/35 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] text-primary/76">Remote proposals</div>
            <div className="mt-1 text-[12px] leading-6 text-foreground/88">
              Review backend-delivered task ideas and either queue them immediately or dismiss them at the source.
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onRefreshProposals}
              disabled={!hasWorkspace || isLoadingProposals}
              className="inline-flex h-8 items-center justify-center gap-2 rounded-[14px] border border-border/45 px-3 text-[11px] text-muted-foreground transition hover:border-primary/35 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingProposals ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onTriggerProposal}
              disabled={!hasWorkspace || isTriggeringProposal}
              className="inline-flex h-8 items-center justify-center gap-2 rounded-[14px] border border-primary/40 bg-primary/10 px-3 text-[11px] text-primary transition hover:bg-primary/14 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isTriggeringProposal ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              <span>Trigger</span>
            </button>
          </div>
        </div>

        {proposalStatusMessage ? (
          <div className="theme-subtle-surface mt-3 rounded-[14px] border border-border/35 px-3 py-2 text-[11px] text-muted-foreground">
            {proposalStatusMessage}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!hasWorkspace ? (
          <EmptyNotice message="Select a workspace to review incoming task proposals." />
        ) : proposals.length === 0 ? (
          <EmptyNotice message={isLoadingProposals ? "Loading task proposals..." : "No unreviewed proposals for this workspace yet."} />
        ) : (
          <div className="grid gap-3">
            {proposals.map((proposal) => {
              const isActing = proposalAction?.proposalId === proposal.proposal_id;
              return (
                <article key={proposal.proposal_id} className="theme-subtle-surface rounded-[18px] border border-border/35 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-foreground">{proposal.task_name}</div>
                      <div className="mt-2 whitespace-pre-wrap text-[11px] leading-6 text-muted-foreground">{proposal.task_prompt}</div>
                    </div>
                    <div className="shrink-0 rounded-full border border-border/45 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      {proposal.state}
                    </div>
                  </div>

                  <div className="mt-3 text-[10px] text-muted-foreground/78">{formatTimestamp(proposal.created_at)}</div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onAcceptProposal(proposal)}
                      disabled={isActing}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-primary/40 bg-primary/10 px-3 text-[11px] text-primary transition hover:bg-primary/14 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isActing && proposalAction?.action === "accept" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      <span>Accept</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismissProposal(proposal)}
                      disabled={isActing}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-border/45 px-3 text-[11px] text-muted-foreground transition hover:border-[rgba(255,153,102,0.3)] hover:text-[rgba(255,212,189,0.92)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isActing && proposalAction?.action === "dismiss" ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                      <span>Dismiss</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RunningPanel({
  hasWorkspace,
  isLoading,
  sessions,
  errorMessage
}: {
  hasWorkspace: boolean;
  isLoading: boolean;
  sessions: RunningSessionEntry[];
  errorMessage: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/35 px-4 py-4">
        <div className="text-[10px] uppercase tracking-[0.16em] text-primary/76">Running</div>
        <div className="mt-1 text-[12px] leading-6 text-foreground/88">
          Active and failed runtime sessions for the current workspace, including cronjob runs.
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!hasWorkspace ? (
          <CenteredNotice message="Choose a workspace to inspect active runtime sessions." />
        ) : errorMessage ? (
          <CenteredNotice message={errorMessage} tone="error" />
        ) : isLoading && sessions.length === 0 ? (
          <CenteredNotice message="Loading runtime sessions..." />
        ) : sessions.length === 0 ? (
          <CenteredNotice message="No active or failed runtime sessions right now." />
        ) : (
          <div className="grid gap-3">
            {sessions.map((session) => (
              <article key={session.sessionId} className="theme-subtle-surface rounded-[18px] border border-border/35 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-foreground">{session.title}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/76">
                      {session.kind.replace(/_/g, " ")}
                    </div>
                  </div>
                  <div className={`shrink-0 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${runningStatusClasses(session.status)}`}>
                    {session.status}
                  </div>
                </div>

                <div className="mt-3 text-[11px] text-muted-foreground/82">
                  Updated {formatTimestamp(session.updatedAt)}
                </div>

                {session.lastError ? (
                  <div className="mt-3 rounded-[14px] border border-destructive/25 bg-destructive/8 px-3 py-2 text-[11px] leading-5 text-destructive">
                    {session.lastError}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OutputsPanel({
  outputs,
  installedApps,
  selectedOutput,
  onSelectOutput,
  onOpenOutput
}: {
  outputs: OperationsOutputEntry[];
  installedApps: WorkspaceInstalledAppDefinition[];
  selectedOutput: OperationsOutputEntry | null;
  onSelectOutput: (outputId: string) => void;
  onOpenOutput: (entry: OperationsOutputEntry) => void;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="shrink-0 border-b border-border/35 px-4 py-4">
        <div className="text-[10px] uppercase tracking-[0.16em] text-primary/76">Outputs</div>
        <div className="mt-1 text-[12px] leading-6 text-foreground/88">
          Latest operator-side events from the desktop surface, including proposal actions and workflow handoffs.
        </div>
      </div>

      {outputs.length === 0 ? (
        <div className="flex items-center justify-center p-6">
          <EmptyNotice message="No output events yet. Accept or dismiss a proposal to start building this activity trail." />
        </div>
      ) : (
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <div className="shrink-0 border-b border-border/35 px-3 py-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {outputs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelectOutput(entry.id)}
                  className={`min-w-[120px] rounded-[14px] border px-3 py-2 text-left transition ${
                    selectedOutput?.id === entry.id
                      ? outputToneClasses(entry.tone, true)
                      : "theme-subtle-surface border-border/35 text-foreground/86 hover:border-primary/30"
                  }`}
                >
                  <div className="truncate text-[11px] font-medium">{entry.title}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground/78">{formatTimestamp(entry.createdAt)}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-4">
            {selectedOutput ? (
              <article className={`rounded-[20px] border px-4 py-4 ${outputToneClasses(selectedOutput.tone, false)}`}>
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/75">
                  {selectedOutput.renderer.type === "app" ? "Workspace app output" : "Internal output"}
                </div>
                <div className="mt-2 text-[16px] font-medium text-foreground">{selectedOutput.title}</div>
                <div className="mt-2 whitespace-pre-wrap text-[12px] leading-6 text-foreground/86">{selectedOutput.detail}</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenOutput(selectedOutput)}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-primary/40 bg-primary/10 px-3 text-[11px] text-primary transition hover:bg-primary/14"
                  >
                    <ChevronRight size={12} />
                    <span>{openOutputLabel(selectedOutput, installedApps)}</span>
                  </button>
                </div>
                <div className="mt-4 text-[10px] text-muted-foreground/78">{formatTimestamp(selectedOutput.createdAt)}</div>
              </article>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function CenteredNotice({
  message,
  tone = "default"
}: {
  message: string;
  tone?: "default" | "error";
}) {
  return (
    <div className="flex items-center justify-center p-6">
      <div
        className={`theme-subtle-surface max-w-[280px] rounded-[20px] border px-5 py-5 text-center ${
          tone === "error" ? "border-destructive/25 text-destructive" : "border-border/35"
        }`}
      >
        <div className="text-[12px] leading-6">{message}</div>
      </div>
    </div>
  );
}

function openOutputLabel(entry: OperationsOutputEntry, installedApps: WorkspaceInstalledAppDefinition[]): string {
  if (entry.renderer.type === "app") {
    const app = getWorkspaceAppDefinition(entry.renderer.appId, installedApps);
    return `Open in ${app?.label ?? entry.renderer.appId}`;
  }

  if (entry.renderer.surface === "document") {
    return "Open document";
  }
  if (entry.renderer.surface === "preview") {
    return "Open preview";
  }
  if (entry.renderer.surface === "file") {
    return "Open file view";
  }
  return "Open detail";
}

function EmptyNotice({ message }: { message: string }) {
  return (
    <div className="theme-subtle-surface rounded-[18px] border border-border/35 px-4 py-5 text-[12px] leading-6 text-muted-foreground/78">
      {message}
    </div>
  );
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString();
}

function outputToneClasses(tone: OperationsOutputEntry["tone"], compact: boolean): string {
  if (tone === "success") {
    return compact
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-primary/30 bg-primary/10";
  }
  if (tone === "error") {
    return compact
      ? "border-[rgba(255,153,102,0.28)] bg-[rgba(255,153,102,0.08)] text-[rgba(255,212,189,0.96)]"
      : "border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.08)]";
  }
  return compact
    ? "border-border/45 bg-muted text-foreground/88"
    : "border-border/35 bg-muted";
}
