import { useMemo, type ReactNode } from "react";
import { Bell, Check, ChevronRight, Clock3, Loader2, Sparkles, X } from "lucide-react";
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

export interface OperationsRunningEntry {
  sessionId: string;
  title: string;
  detail: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

interface OperationsDrawerProps {
  activeTab: OperationsDrawerTab;
  onTabChange: (tab: OperationsDrawerTab) => void;
  proposals: TaskProposalRecordPayload[];
  proactiveStatus: ProactiveAgentStatusPayload | null;
  isLoadingProposals: boolean;
  isTriggeringProposal: boolean;
  proposalStatusMessage: string;
  proposalAction: {
    proposalId: string;
    action: "accept" | "dismiss";
  } | null;
  runningEntries: OperationsRunningEntry[];
  isLoadingRunningEntries: boolean;
  outputs: OperationsOutputEntry[];
  installedApps: WorkspaceInstalledAppDefinition[];
  selectedOutputId: string | null;
  onSelectOutput: (outputId: string) => void;
  onOpenRunningSession: (sessionId: string) => void;
  onOpenOutput: (entry: OperationsOutputEntry) => void;
  onTriggerProposal: () => void;
  onAcceptProposal: (proposal: TaskProposalRecordPayload) => void;
  onDismissProposal: (proposal: TaskProposalRecordPayload) => void;
  hasWorkspace: boolean;
}

export function OperationsDrawer({
  activeTab,
  onTabChange,
  proposals,
  proactiveStatus,
  isLoadingProposals,
  isTriggeringProposal,
  proposalStatusMessage,
  proposalAction,
  runningEntries,
  isLoadingRunningEntries,
  outputs,
  installedApps,
  selectedOutputId,
  onSelectOutput,
  onOpenRunningSession,
  onOpenOutput,
  onTriggerProposal,
  onAcceptProposal,
  onDismissProposal,
  hasWorkspace
}: OperationsDrawerProps) {
  const selectedOutput = useMemo(() => {
    if (!outputs.length) {
      return null;
    }
    return outputs.find((entry) => entry.id === selectedOutputId) ?? outputs[0];
  }, [outputs, selectedOutputId]);

  return (
    <aside className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-[280px] max-w-[312px] flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <header className="theme-header-surface flex shrink-0 items-center justify-between gap-3 border-b border-neon-green/15 px-4 py-3">
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
            proactiveStatus={proactiveStatus}
            isLoadingProposals={isLoadingProposals}
            isTriggeringProposal={isTriggeringProposal}
            proposalStatusMessage={proposalStatusMessage}
            proposalAction={proposalAction}
            hasWorkspace={hasWorkspace}
            onTriggerProposal={onTriggerProposal}
            onAcceptProposal={onAcceptProposal}
            onDismissProposal={onDismissProposal}
          />
        ) : null}

        {activeTab === "running" ? (
          <RunningPanel
            hasWorkspace={hasWorkspace}
            entries={runningEntries}
            isLoading={isLoadingRunningEntries}
            onOpenSession={onOpenRunningSession}
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
          ? "border-neon-green/45 bg-neon-green/10 text-neon-green"
          : "border-panel-border/45 text-text-muted hover:border-neon-green/35 hover:text-text-main"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function proactiveStateLabel(state: string): string {
  switch (state) {
    case "healthy":
      return "Healthy";
    case "published":
      return "Published";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "pending":
      return "Pending";
    case "delivered":
      return "Delivered";
    case "analyzing":
      return "Analyzing";
    case "no_proposal":
      return "No proposal";
    case "blocked":
      return "Blocked";
    case "inactive":
      return "Inactive";
    case "error":
      return "Error";
    default:
      return "Checking";
  }
}

function proactiveStateClasses(state: string): string {
  if (["healthy", "published", "delivered"].includes(state)) {
    return "border-neon-green/40 bg-neon-green/10 text-neon-green";
  }
  if (["failed", "blocked", "error"].includes(state)) {
    return "border-[rgba(206,92,84,0.32)] bg-[rgba(206,92,84,0.12)] text-[rgba(255,172,164,0.96)]";
  }
  if (["inactive", "skipped"].includes(state)) {
    return "border-panel-border/45 bg-panel-border/10 text-text-muted";
  }
  return "border-panel-border/45 bg-panel-border/10 text-text-main/78";
}

function ProactiveStatusRow({
  label,
  snapshot
}: {
  label: string;
  snapshot: ProactiveStatusSnapshotPayload;
}) {
  return (
    <div className="rounded-[14px] border border-panel-border/35 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.12em] text-text-dim">{label}</div>
        <div className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${proactiveStateClasses(snapshot.state)}`}>
          {proactiveStateLabel(snapshot.state)}
        </div>
      </div>
      {snapshot.detail ? <div className="mt-2 text-[11px] leading-5 text-text-muted">{snapshot.detail}</div> : null}
      {snapshot.recorded_at ? <div className="mt-2 text-[10px] text-text-dim/78">{formatTimestamp(snapshot.recorded_at)}</div> : null}
    </div>
  );
}

function InboxPanel({
  proposals,
  proactiveStatus,
  isLoadingProposals,
  isTriggeringProposal,
  proposalStatusMessage,
  proposalAction,
  hasWorkspace,
  onTriggerProposal,
  onAcceptProposal,
  onDismissProposal
}: {
  proposals: TaskProposalRecordPayload[];
  proactiveStatus: ProactiveAgentStatusPayload | null;
  isLoadingProposals: boolean;
  isTriggeringProposal: boolean;
  proposalStatusMessage: string;
  proposalAction: {
    proposalId: string;
    action: "accept" | "dismiss";
  } | null;
  hasWorkspace: boolean;
  onTriggerProposal: () => void;
  onAcceptProposal: (proposal: TaskProposalRecordPayload) => void;
  onDismissProposal: (proposal: TaskProposalRecordPayload) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-panel-border/35 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] text-neon-green/76">Remote proposals</div>
            <div className="mt-1 text-[12px] leading-6 text-text-main/88">
              Review backend-delivered task ideas and either queue them immediately or dismiss them at the source.
            </div>
          </div>
          <button
            type="button"
            onClick={onTriggerProposal}
            disabled={!hasWorkspace || isTriggeringProposal}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-[14px] border border-neon-green/40 bg-neon-green/10 px-3 text-[11px] text-neon-green transition hover:bg-neon-green/14 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isTriggeringProposal ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            <span>Trigger</span>
          </button>
        </div>

        {hasWorkspace ? (
          <div className="theme-subtle-surface mt-3 rounded-[16px] border border-panel-border/35 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.14em] text-neon-green/76">Proactive agent</div>
                <div className="mt-1 text-[12px] leading-6 text-text-main/90">
                  {proactiveStatus?.delivery_summary || (isLoadingProposals ? "Checking proactive delivery status..." : "No proactive status available yet.")}
                </div>
                {proactiveStatus?.delivery_detail ? (
                  <div className="mt-2 text-[11px] leading-5 text-text-muted">{proactiveStatus.delivery_detail}</div>
                ) : null}
              </div>
              <div
                className={`shrink-0 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${
                  proactiveStateClasses(proactiveStatus?.delivery_state || "unknown")
                }`}
              >
                {proactiveStateLabel(proactiveStatus?.delivery_state || "unknown")}
              </div>
            </div>

            <div className="mt-3 grid gap-2">
              <ProactiveStatusRow
                label="Heartbeat"
                snapshot={
                  proactiveStatus?.heartbeat || {
                    state: isLoadingProposals ? "pending" : "unknown",
                    detail: null,
                    recorded_at: null
                  }
                }
              />
              <ProactiveStatusRow
                label="Bridge"
                snapshot={
                  proactiveStatus?.bridge || {
                    state: isLoadingProposals ? "pending" : "unknown",
                    detail: null,
                    recorded_at: null
                  }
                }
              />
            </div>
          </div>
        ) : null}

        {proposalStatusMessage ? (
          <div className="theme-subtle-surface mt-3 rounded-[14px] border border-panel-border/35 px-3 py-2 text-[11px] text-text-muted">
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
                <article key={proposal.proposal_id} className="theme-subtle-surface rounded-[18px] border border-panel-border/35 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-text-main">{proposal.task_name}</div>
                      <div className="mt-2 whitespace-pre-wrap text-[11px] leading-6 text-text-muted">{proposal.task_prompt}</div>
                    </div>
                    <div className="shrink-0 rounded-full border border-panel-border/45 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-text-dim">
                      {proposal.state}
                    </div>
                  </div>

                  <div className="mt-3 text-[10px] text-text-dim/78">{formatTimestamp(proposal.created_at)}</div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onAcceptProposal(proposal)}
                      disabled={isActing}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-neon-green/40 bg-neon-green/10 px-3 text-[11px] text-neon-green transition hover:bg-neon-green/14 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isActing && proposalAction?.action === "accept" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      <span>Accept</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismissProposal(proposal)}
                      disabled={isActing}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-panel-border/45 px-3 text-[11px] text-text-muted transition hover:border-[rgba(255,153,102,0.3)] hover:text-[rgba(255,212,189,0.92)] disabled:cursor-not-allowed disabled:opacity-50"
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
  entries,
  isLoading,
  onOpenSession
}: {
  hasWorkspace: boolean;
  entries: OperationsRunningEntry[];
  isLoading: boolean;
  onOpenSession: (sessionId: string) => void;
}) {
  if (!hasWorkspace) {
    return (
      <div className="flex items-center justify-center p-6">
        <EmptyNotice message="Select a workspace to inspect running child sessions." />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center p-6">
        <EmptyNotice message={isLoading ? "Loading running sessions..." : "No proposal child sessions yet. Accept a proposal to create one here."} />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="shrink-0 border-b border-panel-border/35 px-4 py-4">
        <div className="text-[10px] uppercase tracking-[0.16em] text-neon-green/76">Running sessions</div>
        <div className="mt-1 text-[12px] leading-6 text-text-main/88">
          Proposal-created child sessions live here. Open one to replace the current chat pane, then jump back to main when you are done.
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto px-4 py-4">
        <div className="grid gap-3">
          {entries.map((entry) => (
            <article
              key={entry.sessionId}
              className={`rounded-[18px] border px-4 py-4 ${
                entry.isActive
                  ? "border-neon-green/38 bg-neon-green/10"
                  : "theme-subtle-surface border-panel-border/35"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-text-main">{entry.title}</div>
                  <div className="mt-2 text-[11px] leading-6 text-text-muted">{entry.detail}</div>
                </div>
                <div className={`shrink-0 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${runningStatusClasses(entry.status)}`}>
                  {runningStatusLabel(entry.status)}
                </div>
              </div>

              <div className="mt-3 text-[10px] text-text-dim/78">Updated {formatTimestamp(entry.updatedAt)}</div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOpenSession(entry.sessionId)}
                  disabled={entry.isActive}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-neon-green/40 bg-neon-green/10 px-3 text-[11px] text-neon-green transition hover:bg-neon-green/14 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronRight size={12} />
                  <span>{entry.isActive ? "Currently open" : "Open session"}</span>
                </button>
              </div>
            </article>
          ))}
        </div>
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
      <div className="shrink-0 border-b border-panel-border/35 px-4 py-4">
        <div className="text-[10px] uppercase tracking-[0.16em] text-neon-green/76">Outputs</div>
        <div className="mt-1 text-[12px] leading-6 text-text-main/88">
          Latest operator-side events from the desktop surface, including proposal actions and workflow handoffs.
        </div>
      </div>

      {outputs.length === 0 ? (
        <div className="flex items-center justify-center p-6">
          <EmptyNotice message="No output events yet. Accept or dismiss a proposal to start building this activity trail." />
        </div>
      ) : (
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <div className="shrink-0 border-b border-panel-border/35 px-3 py-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {outputs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelectOutput(entry.id)}
                  className={`min-w-[120px] rounded-[14px] border px-3 py-2 text-left transition ${
                    selectedOutput?.id === entry.id
                      ? outputToneClasses(entry.tone, true)
                      : "theme-subtle-surface border-panel-border/35 text-text-main/86 hover:border-neon-green/30"
                  }`}
                >
                  <div className="truncate text-[11px] font-medium">{entry.title}</div>
                  <div className="mt-1 text-[10px] text-text-dim/78">{formatTimestamp(entry.createdAt)}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-4">
            {selectedOutput ? (
              <article className={`rounded-[20px] border px-4 py-4 ${outputToneClasses(selectedOutput.tone, false)}`}>
                <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/75">
                  {selectedOutput.renderer.type === "app" ? "Workspace app output" : "Internal output"}
                </div>
                <div className="mt-2 text-[16px] font-medium text-text-main">{selectedOutput.title}</div>
                <div className="mt-2 whitespace-pre-wrap text-[12px] leading-6 text-text-main/86">{selectedOutput.detail}</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenOutput(selectedOutput)}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-neon-green/40 bg-neon-green/10 px-3 text-[11px] text-neon-green transition hover:bg-neon-green/14"
                  >
                    <ChevronRight size={12} />
                    <span>{openOutputLabel(selectedOutput, installedApps)}</span>
                  </button>
                </div>
                <div className="mt-4 text-[10px] text-text-dim/78">{formatTimestamp(selectedOutput.createdAt)}</div>
              </article>
            ) : null}
          </div>
        </div>
      )}
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
    <div className="theme-subtle-surface rounded-[18px] border border-panel-border/35 px-4 py-5 text-[12px] leading-6 text-text-dim/78">
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
      ? "border-neon-green/40 bg-neon-green/10 text-neon-green"
      : "border-neon-green/30 bg-neon-green/10";
  }
  if (tone === "error") {
    return compact
      ? "border-[rgba(255,153,102,0.28)] bg-[rgba(255,153,102,0.08)] text-[rgba(255,212,189,0.96)]"
      : "border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.08)]";
  }
  return compact
    ? "border-panel-border/45 bg-[var(--theme-subtle-bg)] text-text-main/88"
    : "border-panel-border/35 bg-[var(--theme-subtle-bg)]";
}

function runningStatusLabel(status: string): string {
  const normalized = status.trim().toUpperCase();
  if (normalized === "BUSY") {
    return "Running";
  }
  if (normalized === "QUEUED") {
    return "Queued";
  }
  if (normalized === "WAITING_USER") {
    return "Waiting";
  }
  if (normalized === "ERROR") {
    return "Error";
  }
  return "Idle";
}

function runningStatusClasses(status: string): string {
  const normalized = status.trim().toUpperCase();
  if (normalized === "BUSY") {
    return "border-neon-green/35 bg-neon-green/10 text-neon-green";
  }
  if (normalized === "QUEUED") {
    return "border-[rgba(120,210,255,0.28)] bg-[rgba(120,210,255,0.08)] text-[rgba(181,235,255,0.96)]";
  }
  if (normalized === "WAITING_USER") {
    return "border-[rgba(255,210,120,0.28)] bg-[rgba(255,210,120,0.08)] text-[rgba(255,232,181,0.96)]";
  }
  if (normalized === "ERROR") {
    return "border-[rgba(255,153,102,0.28)] bg-[rgba(255,153,102,0.08)] text-[rgba(255,212,189,0.96)]";
  }
  return "border-panel-border/45 bg-[var(--theme-subtle-bg)] text-text-main/88";
}
