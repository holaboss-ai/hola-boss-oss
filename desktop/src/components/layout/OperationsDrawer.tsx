import { useMemo, type ReactNode } from "react";
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
  hasWorkspace
}: OperationsDrawerProps) {
  const selectedOutput = useMemo(() => {
    if (!outputs.length) {
      return null;
    }
    return outputs.find((entry) => entry.id === selectedOutputId) ?? outputs[0];
  }, [outputs, selectedOutputId]);

  return (
    <aside className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-[360px] max-w-[420px] flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
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

        {activeTab === "running" ? <RunningPanel /> : null}

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
      <div className="shrink-0 border-b border-panel-border/35 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] text-neon-green/76">Remote proposals</div>
            <div className="mt-1 text-[12px] leading-6 text-text-main/88">
              Review backend-delivered task ideas and either queue them immediately or dismiss them at the source.
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onRefreshProposals}
              disabled={!hasWorkspace || isLoadingProposals}
              className="inline-flex h-8 items-center justify-center gap-2 rounded-[14px] border border-panel-border/45 px-3 text-[11px] text-text-muted transition hover:border-neon-green/35 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingProposals ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onTriggerProposal}
              disabled={!hasWorkspace || isTriggeringProposal}
              className="inline-flex h-8 items-center justify-center gap-2 rounded-[14px] border border-neon-green/40 bg-neon-green/10 px-3 text-[11px] text-neon-green transition hover:bg-neon-green/14 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isTriggeringProposal ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              <span>Trigger</span>
            </button>
          </div>
        </div>

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

function RunningPanel() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="theme-subtle-surface max-w-[260px] rounded-[20px] border border-panel-border/35 px-5 py-5 text-center">
        <div className="text-[11px] uppercase tracking-[0.16em] text-neon-green/76">Running</div>
        <div className="mt-2 text-[15px] font-medium text-text-main">Execution stream coming next</div>
        <div className="mt-2 text-[12px] leading-6 text-text-muted/82">
          This panel is reserved for active runs. For now it stays as a placeholder while Inbox and Outputs take over the right rail.
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
