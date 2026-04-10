import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Clock,
  FolderOpen,
  Inbox as InboxIcon,
  Loader2,
  LogIn,
  Pause,
  X,
  Clock3,
} from "lucide-react";
import { useDesktopAuthSession } from "@/lib/auth/authClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProactiveLifecyclePanel } from "@/components/layout/ProactiveStatusCard";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type OperationsDrawerTab = "inbox" | "running";

interface OperationsDrawerProps {
  activeTab: OperationsDrawerTab;
  onTabChange: (tab: OperationsDrawerTab) => void;
  proposals: TaskProposalRecordPayload[];
  unreadProposalCount: number;
  proactiveStatus: ProactiveAgentStatusPayload | null;
  isLoadingProactiveStatus: boolean;
  proactiveWorkspaceEnabled: boolean;
  isLoadingProactiveWorkspaceEnabled: boolean;
  isUpdatingProactiveWorkspaceEnabled: boolean;
  proactiveHeartbeatCron: string;
  isLoadingProactiveHeartbeatConfig: boolean;
  isUpdatingProactiveHeartbeatConfig: boolean;
  proactiveTaskProposalsError: string;
  proactiveHeartbeatError: string;
  isLoadingProposals: boolean;
  isTriggeringProposal: boolean;
  proposalStatusMessage: string;
  proposalAction: {
    proposalId: string;
    action: "accept" | "dismiss";
  } | null;
  onTriggerProposal: () => void;
  onProactiveWorkspaceEnabledChange: (enabled: boolean) => void;
  onProactiveHeartbeatCronChange: (cron: string) => void;
  onAcceptProposal: (proposal: TaskProposalRecordPayload) => void;
  onDismissProposal: (proposal: TaskProposalRecordPayload) => void;
  onOpenRunningSession: (sessionId: string) => void;
  onCreateSession: () => void;
  activeRunningSessionId: string | null;
  hasWorkspace: boolean;
  selectedWorkspaceId: string | null;
  selectedWorkspaceName: string | null;
}

interface RunningSessionEntry {
  sessionId: string;
  status: string;
  stateLabel: string;
  stateTimestamp: string;
  stateDetail: string;
  title: string;
  kind: string;
  updatedAt: string;
  lastError: string | null;
}

const RUNNING_SESSIONS_POLL_INTERVAL_MS = 1000;

export function OperationsDrawer({
  activeTab,
  onTabChange,
  proposals,
  unreadProposalCount,
  proactiveStatus,
  isLoadingProactiveStatus,
  proactiveWorkspaceEnabled,
  isLoadingProactiveWorkspaceEnabled,
  isUpdatingProactiveWorkspaceEnabled,
  proactiveHeartbeatCron,
  isLoadingProactiveHeartbeatConfig,
  isUpdatingProactiveHeartbeatConfig,
  proactiveTaskProposalsError,
  proactiveHeartbeatError,
  isLoadingProposals,
  isTriggeringProposal,
  proposalStatusMessage,
  proposalAction,
  onTriggerProposal,
  onProactiveWorkspaceEnabledChange,
  onProactiveHeartbeatCronChange,
  onAcceptProposal,
  onDismissProposal,
  onOpenRunningSession,
  onCreateSession,
  activeRunningSessionId,
  hasWorkspace,
  selectedWorkspaceId,
  selectedWorkspaceName,
}: OperationsDrawerProps) {
  const {
    data: authSession,
    isPending: isAuthPending,
    requestAuth,
  } = useDesktopAuthSession();
  const isSignedIn = Boolean(authSession?.user?.id);
  const onRequestSignIn = () => {
    void requestAuth();
  };

  const [runningSessions, setRunningSessions] = useState<RunningSessionEntry[]>(
    [],
  );
  const [isLoadingRunningSessions, setIsLoadingRunningSessions] =
    useState(false);
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
    let requestInFlight = false;

    const loadRunningSessions = async (options?: { showLoading?: boolean }) => {
      if (requestInFlight) {
        return;
      }
      requestInFlight = true;
      if (options?.showLoading) {
        setIsLoadingRunningSessions(true);
      }
      try {
        const [runtimeStatesResponse, sessionsResponse] = await Promise.all([
          window.electronAPI.workspace.listRuntimeStates(selectedWorkspaceId),
          window.electronAPI.workspace.listAgentSessions(selectedWorkspaceId),
        ]);
        if (cancelled) {
          return;
        }

        const sessionById = new Map(
          sessionsResponse.items.map((session) => [
            session.session_id,
            session,
          ]),
        );
        const nextEntries = runtimeStatesResponse.items
          .filter((state) => Boolean(state.session_id.trim()))
          .map((state) => {
            const session = sessionById.get(state.session_id);
            const stateLabel = runningSessionState(state);
            return {
              sessionId: state.session_id,
              status: stateLabel,
              stateLabel,
              stateTimestamp: runningSessionStateTimestamp(state),
              stateDetail: runningSessionStateDetail(stateLabel),
              title:
                session?.title?.trim() ||
                defaultSessionTitle(session?.kind, state.session_id),
              kind: session?.kind?.trim() || "session",
              updatedAt: state.updated_at,
              lastError: runtimeStateErrorMessage(state.last_error),
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
        requestInFlight = false;
        if (!cancelled && options?.showLoading) {
          setIsLoadingRunningSessions(false);
        }
      }
    };

    const refreshRunningSessions = () => {
      void loadRunningSessions();
    };
    const refreshVisibleRunningSessions = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      refreshRunningSessions();
    };

    void loadRunningSessions({ showLoading: true });
    const intervalId = window.setInterval(() => {
      refreshVisibleRunningSessions();
    }, RUNNING_SESSIONS_POLL_INTERVAL_MS);
    window.addEventListener("focus", refreshRunningSessions);
    document.addEventListener(
      "visibilitychange",
      refreshVisibleRunningSessions,
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshRunningSessions);
      document.removeEventListener(
        "visibilitychange",
        refreshVisibleRunningSessions,
      );
    };
  }, [activeTab, selectedWorkspaceId]);

  return (
    <aside className="theme-shell neon-border relative flex h-full min-h-0 min-w-[296px] max-w-[336px] flex-col overflow-hidden rounded-[var(--radius-xl)] shadow-lg">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <DrawerTabButton
            active={activeTab === "inbox"}
            icon={<InboxIcon size={14} />}
            label="Inbox"
            showIndicator={unreadProposalCount > 0}
            onClick={() => onTabChange("inbox")}
          />
          <DrawerTabButton
            active={activeTab === "running"}
            icon={<Clock3 size={14} />}
            label="Sessions"
            onClick={() => onTabChange("running")}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "inbox" ? (
          <InboxPanel
            isSignedIn={isSignedIn}
            onRequestSignIn={onRequestSignIn}
            isAuthPending={isAuthPending}
            proposals={proposals}
            proactiveStatus={proactiveStatus}
            isLoadingProactiveStatus={isLoadingProactiveStatus}
            proactiveTaskProposalsError={proactiveTaskProposalsError}
            proactiveHeartbeatError={proactiveHeartbeatError}
            isLoadingProposals={isLoadingProposals}
            proposalStatusMessage={proposalStatusMessage}
            proposalAction={proposalAction}
            hasWorkspace={hasWorkspace}
            selectedWorkspaceId={selectedWorkspaceId}
            selectedWorkspaceName={selectedWorkspaceName}
            proactiveWorkspaceEnabled={proactiveWorkspaceEnabled}
            isLoadingProactiveWorkspaceEnabled={
              isLoadingProactiveWorkspaceEnabled
            }
            isUpdatingProactiveWorkspaceEnabled={
              isUpdatingProactiveWorkspaceEnabled
            }
            proactiveHeartbeatCron={proactiveHeartbeatCron}
            isLoadingProactiveHeartbeatConfig={
              isLoadingProactiveHeartbeatConfig
            }
            isUpdatingProactiveHeartbeatConfig={
              isUpdatingProactiveHeartbeatConfig
            }
            isTriggeringProposal={isTriggeringProposal}
            onTriggerProposal={onTriggerProposal}
            onProactiveWorkspaceEnabledChange={
              onProactiveWorkspaceEnabledChange
            }
            onProactiveHeartbeatCronChange={
              onProactiveHeartbeatCronChange
            }
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
            onOpenSession={onOpenRunningSession}
            onCreateSession={onCreateSession}
            activeSessionId={activeRunningSessionId}
          />
        ) : null}
      </div>
    </aside>
  );
}

function normalizeOperationError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

function runtimeStateErrorMessage(
  value: Record<string, unknown> | null,
): string | null {
  if (!value) {
    return null;
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
  return rawMessage || null;
}

function defaultSessionTitle(
  kind: string | null | undefined,
  sessionId: string,
): string {
  if (kind === "cronjob") {
    return "Cronjob run";
  }
  if (kind === "task_proposal") {
    return "Task proposal run";
  }
  return `Session ${sessionId.slice(0, 8)}`;
}

function normalizeTurnResultStatus(status: string | null | undefined): string {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function runningSessionState(entry: {
  status: string;
  last_turn_status: string | null;
}): string {
  if (entry.status === "BUSY") {
    return "RUNNING";
  }
  if (entry.status === "QUEUED") {
    return "QUEUED";
  }
  if (entry.status === "WAITING_USER") {
    return "WAITING";
  }
  if (entry.status === "PAUSED") {
    return "PAUSED";
  }
  if (entry.status === "ERROR") {
    return "ERROR";
  }

  const lastTurnStatus = normalizeTurnResultStatus(entry.last_turn_status);
  if (lastTurnStatus === "completed") {
    return "COMPLETED";
  }
  if (lastTurnStatus === "waiting_user") {
    return "WAITING";
  }
  if (lastTurnStatus === "paused") {
    return "PAUSED";
  }
  if (lastTurnStatus === "failed" || lastTurnStatus === "error") {
    return "ERROR";
  }
  return "IDLE";
}

function runningSessionStateTimestamp(
  entry: {
    status: string;
    updated_at: string;
    last_turn_completed_at: string | null;
  },
): string {
  if (
    entry.status === "BUSY" ||
    entry.status === "QUEUED" ||
    entry.status === "WAITING_USER" ||
    entry.status === "PAUSED" ||
    entry.status === "ERROR"
  ) {
    return entry.updated_at;
  }
  return entry.last_turn_completed_at?.trim() || entry.updated_at;
}

function runningSessionStateDetail(stateLabel: string): string {
  switch (stateLabel) {
    case "RUNNING":
      return "Active";
    case "QUEUED":
      return "Queued";
    case "WAITING":
      return "Waiting for input";
    case "PAUSED":
      return "Paused";
    case "ERROR":
      return "Failed";
    case "COMPLETED":
      return "Completed";
    default:
      return "Idle";
  }
}

function runningSessionStatusRank(status: string): number {
  switch (status) {
    case "RUNNING":
      return 0;
    case "QUEUED":
      return 1;
    case "WAITING":
      return 2;
    case "PAUSED":
      return 3;
    case "ERROR":
      return 4;
    case "COMPLETED":
      return 5;
    case "IDLE":
      return 6;
    default:
      return 7;
  }
}

function compareRunningSessionEntries(
  left: RunningSessionEntry,
  right: RunningSessionEntry,
): number {
  const statusDiff =
    runningSessionStatusRank(left.status) -
    runningSessionStatusRank(right.status);
  if (statusDiff !== 0) {
    return statusDiff;
  }
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function runningSessionStatusIndicator(
  status: string,
): { className: string; icon: ReactNode; label: string } {
  switch (status) {
    case "RUNNING":
      return {
        className: "text-primary",
        icon: <Loader2 size={14} className="animate-spin" />,
        label: "Running",
      };
    case "QUEUED":
      return {
        className: "text-sky-600",
        icon: <Clock3 size={14} />,
        label: "Queued",
      };
    case "WAITING":
      return {
        className: "text-amber-600",
        icon: <Clock size={14} />,
        label: "Waiting for input",
      };
    case "PAUSED":
      return {
        className: "text-orange-600",
        icon: <Pause size={14} />,
        label: "Paused",
      };
    case "ERROR":
      return {
        className: "text-destructive",
        icon: <X size={14} />,
        label: "Failed",
      };
    case "COMPLETED":
      return {
        className: "text-emerald-600",
        icon: <Check size={14} />,
        label: "Completed",
      };
    default:
      return {
        className: "text-muted-foreground",
        icon: <Clock3 size={14} />,
        label: "Idle",
      };
  }
}

function DrawerTabButton({
  active,
  icon,
  label,
  showIndicator = false,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  showIndicator?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      size="sm"
      variant={active ? "default" : "ghost"}
      className={`gap-2 rounded-2xl px-3 ${
        active
          ? "bg-primary/10 text-primary hover:bg-primary/14 hover:text-primary"
          : "bg-muted/55 text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <span className="relative">
        {icon}
        {showIndicator ? (
          <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card bg-destructive" />
        ) : null}
      </span>
      <span>{label}</span>
    </Button>
  );
}

function InboxPanel({
  isSignedIn,
  onRequestSignIn,
  isAuthPending,
  proposals,
  proactiveStatus,
  isLoadingProactiveStatus,
  proactiveTaskProposalsError,
  proactiveHeartbeatError,
  isLoadingProposals,
  proposalStatusMessage,
  proposalAction,
  hasWorkspace,
  selectedWorkspaceId,
  selectedWorkspaceName,
  proactiveWorkspaceEnabled,
  isLoadingProactiveWorkspaceEnabled,
  isUpdatingProactiveWorkspaceEnabled,
  proactiveHeartbeatCron,
  isLoadingProactiveHeartbeatConfig,
  isUpdatingProactiveHeartbeatConfig,
  isTriggeringProposal,
  onTriggerProposal,
  onProactiveWorkspaceEnabledChange,
  onProactiveHeartbeatCronChange,
  onAcceptProposal,
  onDismissProposal,
}: {
  isSignedIn: boolean;
  onRequestSignIn: () => void;
  isAuthPending: boolean;
  proposals: TaskProposalRecordPayload[];
  proactiveStatus: ProactiveAgentStatusPayload | null;
  isLoadingProactiveStatus: boolean;
  proactiveTaskProposalsError: string;
  proactiveHeartbeatError: string;
  isLoadingProposals: boolean;
  proposalStatusMessage: string;
  proposalAction: {
    proposalId: string;
    action: "accept" | "dismiss";
  } | null;
  hasWorkspace: boolean;
  selectedWorkspaceId: string | null;
  selectedWorkspaceName: string | null;
  proactiveWorkspaceEnabled: boolean;
  isLoadingProactiveWorkspaceEnabled: boolean;
  isUpdatingProactiveWorkspaceEnabled: boolean;
  proactiveHeartbeatCron: string;
  isLoadingProactiveHeartbeatConfig: boolean;
  isUpdatingProactiveHeartbeatConfig: boolean;
  isTriggeringProposal: boolean;
  onTriggerProposal: () => void;
  onProactiveWorkspaceEnabledChange: (enabled: boolean) => void;
  onProactiveHeartbeatCronChange: (cron: string) => void;
  onAcceptProposal: (proposal: TaskProposalRecordPayload) => void;
  onDismissProposal: (proposal: TaskProposalRecordPayload) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {proactiveTaskProposalsError ? (
        <div className="shrink-0 border-b border-destructive/20 px-3 py-2 text-xs text-destructive">
          {proactiveTaskProposalsError}
        </div>
      ) : null}
      {proactiveHeartbeatError ? (
        <div className="shrink-0 border-b border-destructive/20 px-3 py-2 text-xs text-destructive">
          {proactiveHeartbeatError}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {isSignedIn && proposalStatusMessage ? (
          <div className="mb-3 rounded-[18px] border border-border/45 bg-muted/35 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {proposalStatusMessage}
          </div>
        ) : null}
        {isSignedIn ? (
          <div className="mb-3">
            <ProactiveLifecyclePanel
              hasWorkspace={hasWorkspace}
              workspaceName={selectedWorkspaceName}
              workspaceId={selectedWorkspaceId}
              proactiveStatus={proactiveStatus}
              isLoading={isLoadingProactiveStatus}
              proactiveWorkspaceEnabled={proactiveWorkspaceEnabled}
              isLoadingProactiveWorkspaceEnabled={
                isLoadingProactiveWorkspaceEnabled
              }
              isUpdatingProactiveWorkspaceEnabled={
                isUpdatingProactiveWorkspaceEnabled
              }
              proactiveHeartbeatCron={proactiveHeartbeatCron}
              isLoadingProactiveHeartbeatConfig={
                isLoadingProactiveHeartbeatConfig
              }
              isUpdatingProactiveHeartbeatConfig={
                isUpdatingProactiveHeartbeatConfig
              }
              isTriggeringProposal={isTriggeringProposal}
              onTriggerProposal={onTriggerProposal}
              onProactiveWorkspaceEnabledChange={
                onProactiveWorkspaceEnabledChange
              }
              onProactiveHeartbeatCronChange={
                onProactiveHeartbeatCronChange
              }
              compact
            />
          </div>
        ) : null}
        {!isSignedIn ? (
          <SignedOutInboxNotice
            onRequestSignIn={onRequestSignIn}
            isAuthPending={isAuthPending}
          />
        ) : !hasWorkspace ? (
          <EmptyNotice
            icon={<FolderOpen size={24} strokeWidth={1.5} />}
            message="Select a workspace to review proposals."
          />
        ) : proposals.length === 0 ? (
          <EmptyNotice
            icon={
              isLoadingProposals ? (
                <Loader2 size={24} strokeWidth={1.5} className="animate-spin" />
              ) : (
                <InboxIcon size={24} strokeWidth={1.5} />
              )
            }
            message={
              isLoadingProposals ? "Loading proposals..." : "No proposals yet."
            }
          />
        ) : (
          <div className="grid gap-2">
            {proposals.map((proposal) => {
              const isActing =
                proposalAction?.proposalId === proposal.proposal_id;
              return (
                <Card
                  key={proposal.proposal_id}
                  size="sm"
                  className="gap-2 py-3 ring-border/40"
                >
                  <div className="flex items-start justify-between gap-2 px-3">
                    <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
                      {proposal.task_name}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Accept proposal"
                              onClick={() => onAcceptProposal(proposal)}
                              disabled={isActing}
                              className="text-muted-foreground hover:text-primary"
                            />
                          }
                        >
                          {isActing && proposalAction?.action === "accept" ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Check size={12} />
                          )}
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Accept</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Dismiss proposal"
                              onClick={() => onDismissProposal(proposal)}
                              disabled={isActing}
                              className="text-muted-foreground hover:text-foreground"
                            />
                          }
                        >
                          {isActing && proposalAction?.action === "dismiss" ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <X size={12} />
                          )}
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Dismiss</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="line-clamp-2 px-3 text-xs leading-relaxed text-muted-foreground">
                    {proposal.task_prompt}
                  </div>
                  <div className="px-3 text-xs text-muted-foreground">
                    {relativeTime(proposal.created_at)}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SignedOutInboxNotice({
  onRequestSignIn,
  isAuthPending,
}: {
  onRequestSignIn: () => void;
  isAuthPending: boolean;
}) {
  return (
    <div className="rounded-[22px] border border-amber-500/20 bg-amber-500/10 px-4 py-5">
      <div className="flex flex-col gap-4">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-foreground">
            Sign in to review task proposals
          </div>
          <div className="text-sm leading-6 text-muted-foreground">
            Sign in to review and manage Inbox proposals.
          </div>
        </div>
        <div>
          <Button
            type="button"
            size="sm"
            onClick={onRequestSignIn}
            disabled={isAuthPending}
          >
            {isAuthPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <LogIn size={14} />
            )}
            <span>Sign in</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function RunningPanel({
  hasWorkspace,
  isLoading,
  sessions,
  errorMessage,
  onOpenSession,
  onCreateSession,
  activeSessionId,
}: {
  hasWorkspace: boolean;
  isLoading: boolean;
  sessions: RunningSessionEntry[];
  errorMessage: string;
  onOpenSession: (sessionId: string) => void;
  onCreateSession: () => void;
  activeSessionId: string | null;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Sessions
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCreateSession}
          disabled={!hasWorkspace}
          className="rounded-full border border-border/55 px-3 text-xs"
        >
          <span>New Session</span>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!hasWorkspace ? (
          <EmptyNotice
            icon={<FolderOpen size={24} strokeWidth={1.5} />}
            message="Choose a workspace to inspect sessions."
          />
        ) : errorMessage ? (
          <EmptyNotice
            icon={
              <X size={24} strokeWidth={1.5} className="text-destructive" />
            }
            message={errorMessage}
          />
        ) : isLoading && sessions.length === 0 ? (
          <EmptyNotice
            icon={
              <Loader2 size={24} strokeWidth={1.5} className="animate-spin" />
            }
            message="Loading sessions..."
          />
        ) : sessions.length === 0 ? (
          <EmptyNotice
            icon={<Clock size={24} strokeWidth={1.5} />}
            message="No sessions yet."
          />
        ) : (
          <div className="divide-y divide-border/30">
            {sessions.map((session) => {
              const statusIndicator = runningSessionStatusIndicator(
                session.status,
              );
              return (
                <Button
                  key={session.sessionId}
                  variant="ghost"
                  onClick={() => onOpenSession(session.sessionId)}
                  aria-label={`Open session ${session.title}`}
                  className={`h-auto w-full cursor-pointer justify-start px-3 py-3 text-left first:rounded-t-lg last:rounded-b-lg ${
                    activeSessionId === session.sessionId
                      ? "border-l-2 border-l-primary bg-muted/30"
                      : ""
                  }`}
                >
                  <div className="flex w-full items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {session.title}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {session.stateDetail} {relativeTime(session.stateTimestamp)}
                      </div>
                      {session.lastError ? (
                        <div className="mt-1.5 truncate text-xs text-destructive">
                          {session.lastError}
                        </div>
                      ) : null}
                    </div>
                    <div
                      role="img"
                      aria-label={`${statusIndicator.label} status`}
                      title={statusIndicator.label}
                      className={`shrink-0 self-center ${statusIndicator.className}`}
                    >
                      {statusIndicator.icon}
                    </div>
                  </div>
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyNotice({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
      {icon}
      <span className="text-sm">{message}</span>
    </div>
  );
}

function relativeTime(value: string): string {
  const ms = Date.now() - Date.parse(value);
  if (Number.isNaN(ms)) {
    return value;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
