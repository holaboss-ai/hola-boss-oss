import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Clock,
  FolderOpen,
  Inbox as InboxIcon,
  Loader2,
  LogIn,
  RefreshCcw,
  Sparkles,
  X,
  Bell,
  Clock3,
} from "lucide-react";
import { useDesktopAuthSession } from "@/lib/auth/authClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  proactiveTaskProposalsEnabled: boolean;
  isUpdatingProactiveTaskProposalsEnabled: boolean;
  proactiveTaskProposalsError: string;
  isLoadingProposals: boolean;
  isTriggeringProposal: boolean;
  proposalStatusMessage: string;
  proposalAction: {
    proposalId: string;
    action: "accept" | "dismiss";
  } | null;
  onRefreshProposals: () => void;
  onTriggerProposal: () => void;
  onProactiveTaskProposalsEnabledChange: (enabled: boolean) => void;
  onAcceptProposal: (proposal: TaskProposalRecordPayload) => void;
  onDismissProposal: (proposal: TaskProposalRecordPayload) => void;
  onOpenRunningSession: (sessionId: string) => void;
  activeRunningSessionId: string | null;
  hasWorkspace: boolean;
  selectedWorkspaceId: string | null;
  mainSessionId: string | null;
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
  proactiveTaskProposalsEnabled,
  isUpdatingProactiveTaskProposalsEnabled,
  proactiveTaskProposalsError,
  isLoadingProposals,
  isTriggeringProposal,
  proposalStatusMessage,
  proposalAction,
  onRefreshProposals,
  onTriggerProposal,
  onProactiveTaskProposalsEnabledChange,
  onAcceptProposal,
  onDismissProposal,
  onOpenRunningSession,
  activeRunningSessionId,
  hasWorkspace,
  selectedWorkspaceId,
  mainSessionId,
}: OperationsDrawerProps) {
  const { data: authSession, isPending: isAuthPending, requestAuth } =
    useDesktopAuthSession();
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

    const loadRunningSessions = async () => {
      setIsLoadingRunningSessions(true);
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
        const normalizedMainSessionId = (mainSessionId || "").trim();
        const nextEntries = runtimeStatesResponse.items
          .filter((state) => {
            if (
              normalizedMainSessionId &&
              state.session_id === normalizedMainSessionId
            ) {
              return false;
            }
            const sessionKind = (
              sessionById.get(state.session_id)?.kind || ""
            )
              .trim()
              .toLowerCase();
            return sessionKind !== "main";
          })
          .map((state) => {
            const session = sessionById.get(state.session_id);
            return {
              sessionId: state.session_id,
              status: state.status,
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
  }, [activeTab, mainSessionId, selectedWorkspaceId]);

  return (
    <aside className="theme-shell neon-border relative flex h-full min-h-0 min-w-[360px] max-w-[420px] flex-col overflow-hidden rounded-[var(--radius-xl)] shadow-lg">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <DrawerTabButton
            active={activeTab === "inbox"}
            icon={<Bell size={14} />}
            label="Inbox"
            onClick={() => onTabChange("inbox")}
          />
          <DrawerTabButton
            active={activeTab === "running"}
            icon={<Clock3 size={14} />}
            label="Running"
            onClick={() => onTabChange("running")}
          />
        </div>
        {activeTab === "inbox" ? (
          <InboxHeaderActions
            isSignedIn={isSignedIn}
            isAuthPending={isAuthPending}
            hasWorkspace={hasWorkspace}
            proactiveTaskProposalsEnabled={proactiveTaskProposalsEnabled}
            isUpdatingProactiveTaskProposalsEnabled={isUpdatingProactiveTaskProposalsEnabled}
            isTriggeringProposal={isTriggeringProposal}
            isLoadingProposals={isLoadingProposals}
            onRequestSignIn={onRequestSignIn}
            onTriggerProposal={onTriggerProposal}
            onProactiveTaskProposalsEnabledChange={onProactiveTaskProposalsEnabledChange}
            onRefreshProposals={onRefreshProposals}
          />
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "inbox" ? (
          <InboxPanel
            isSignedIn={isSignedIn}
            onRequestSignIn={onRequestSignIn}
            proposals={proposals}
            proactiveTaskProposalsEnabled={proactiveTaskProposalsEnabled}
            isUpdatingProactiveTaskProposalsEnabled={
              isUpdatingProactiveTaskProposalsEnabled
            }
            proactiveTaskProposalsError={proactiveTaskProposalsError}
            isLoadingProposals={isLoadingProposals}
            isTriggeringProposal={isTriggeringProposal}
            proposalStatusMessage={proposalStatusMessage}
            proposalAction={proposalAction}
            hasWorkspace={hasWorkspace}
            onRefreshProposals={onRefreshProposals}
            onTriggerProposal={onTriggerProposal}
            onProactiveTaskProposalsEnabledChange={
              onProactiveTaskProposalsEnabledChange
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
    case "IDLE":
      return 4;
    default:
      return 5;
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
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
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
      {icon}
      <span>{label}</span>
    </Button>
  );
}

function InboxHeaderActions({
  isSignedIn,
  isAuthPending,
  hasWorkspace,
  proactiveTaskProposalsEnabled,
  isUpdatingProactiveTaskProposalsEnabled,
  isTriggeringProposal,
  isLoadingProposals,
  onRequestSignIn,
  onTriggerProposal,
  onProactiveTaskProposalsEnabledChange,
  onRefreshProposals,
}: {
  isSignedIn: boolean;
  isAuthPending: boolean;
  hasWorkspace: boolean;
  proactiveTaskProposalsEnabled: boolean;
  isUpdatingProactiveTaskProposalsEnabled: boolean;
  isTriggeringProposal: boolean;
  isLoadingProposals: boolean;
  onRequestSignIn: () => void;
  onTriggerProposal: () => void;
  onProactiveTaskProposalsEnabledChange: (enabled: boolean) => void;
  onRefreshProposals: () => void;
}) {
  if (!isSignedIn) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={onRequestSignIn}
        disabled={isAuthPending}
      >
        {isAuthPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <LogIn size={12} />
        )}
        <span>Sign in</span>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Badge
        variant="outline"
        className={`cursor-pointer select-none gap-1.5 transition-colors ${
          isUpdatingProactiveTaskProposalsEnabled
            ? "cursor-wait opacity-75"
            : "hover:bg-muted"
        }`}
        onClick={() =>
          !isUpdatingProactiveTaskProposalsEnabled &&
          onProactiveTaskProposalsEnabledChange(!proactiveTaskProposalsEnabled)
        }
      >
        {isUpdatingProactiveTaskProposalsEnabled ? (
          <Loader2 size={8} className="animate-spin" />
        ) : (
          <span
            className={`inline-block size-1.5 rounded-full ${
              proactiveTaskProposalsEnabled ? "bg-emerald-500" : "bg-amber-500"
            }`}
          />
        )}
        <span>{proactiveTaskProposalsEnabled ? "Enabled" : "Paused"}</span>
      </Badge>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Trigger proposal"
              onClick={onTriggerProposal}
              disabled={!hasWorkspace || isTriggeringProposal}
            />
          }
        >
          {isTriggeringProposal ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">Trigger proposal</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Refresh proposals"
              onClick={onRefreshProposals}
              disabled={!hasWorkspace || isLoadingProposals}
            />
          }
        >
          {isLoadingProposals ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCcw size={12} />
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">Refresh</TooltipContent>
      </Tooltip>
    </div>
  );
}

function InboxPanel({
  isSignedIn,
  onRequestSignIn,
  proposals,
  proactiveTaskProposalsEnabled,
  isUpdatingProactiveTaskProposalsEnabled,
  proactiveTaskProposalsError,
  isLoadingProposals,
  isTriggeringProposal,
  proposalStatusMessage,
  proposalAction,
  hasWorkspace,
  onRefreshProposals,
  onTriggerProposal,
  onProactiveTaskProposalsEnabledChange,
  onAcceptProposal,
  onDismissProposal,
}: {
  isSignedIn: boolean;
  onRequestSignIn: () => void;
  proposals: TaskProposalRecordPayload[];
  proactiveTaskProposalsEnabled: boolean;
  isUpdatingProactiveTaskProposalsEnabled: boolean;
  proactiveTaskProposalsError: string;
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
  onProactiveTaskProposalsEnabledChange: (enabled: boolean) => void;
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!isSignedIn ? (
          <SignedOutInboxNotice onRequestSignIn={onRequestSignIn} />
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
                  <div className="line-clamp-2 px-3 text-sm leading-relaxed text-muted-foreground">
                    {proposal.task_prompt}
                  </div>
                  <div className="px-3 text-xs text-muted-foreground/70">
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
}: {
  onRequestSignIn: () => void;
}) {
  return (
    <div className="rounded-[22px] border border-amber-500/20 bg-amber-500/10 px-4 py-5">
      <div className="flex flex-col gap-4">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-foreground">
            Sign in to review task proposals
          </div>
          <div className="text-sm leading-6 text-muted-foreground">
            Sign in to connect this desktop to your Holaboss account and review
            Inbox proposals.
          </div>
        </div>
        <div>
          <Button type="button" size="sm" onClick={onRequestSignIn}>
            <LogIn size={14} />
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
  activeSessionId,
}: {
  hasWorkspace: boolean;
  isLoading: boolean;
  sessions: RunningSessionEntry[];
  errorMessage: string;
  onOpenSession: (sessionId: string) => void;
  activeSessionId: string | null;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/35 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-widest text-primary/76">
            Running
          </div>
          <div className="rounded-full bg-muted/55 px-3 py-1 text-xs text-muted-foreground">
            Idle and cronjob sessions
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!hasWorkspace ? (
          <EmptyNotice
            icon={<FolderOpen size={24} strokeWidth={1.5} />}
            message="Choose a workspace to inspect sessions."
          />
        ) : errorMessage ? (
          <EmptyNotice
            icon={<X size={24} strokeWidth={1.5} className="text-destructive" />}
            message={errorMessage}
          />
        ) : isLoading && sessions.length === 0 ? (
          <EmptyNotice
            icon={<Loader2 size={24} strokeWidth={1.5} className="animate-spin" />}
            message="Loading sessions..."
          />
        ) : sessions.length === 0 ? (
          <EmptyNotice
            icon={<Clock size={24} strokeWidth={1.5} />}
            message="No background sessions."
          />
        ) : (
          <div className="grid gap-3">
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                type="button"
                onClick={() => onOpenSession(session.sessionId)}
                aria-label={`Open session ${session.title}`}
                className={`theme-subtle-surface w-full rounded-[18px] border px-4 py-4 text-left transition ${
                  activeSessionId === session.sessionId
                    ? "border-primary/45"
                    : "border-border/35 hover:border-primary/30"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {session.title}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground/76">
                      {session.kind.replace(/_/g, " ")}
                    </div>
                  </div>
                  <div
                    className={`shrink-0 rounded-full border px-2 py-1 text-xs uppercase tracking-widest ${runningStatusClasses(session.status)}`}
                  >
                    {session.status}
                  </div>
                </div>

                <div className="mt-3 text-xs text-muted-foreground/82">
                  Updated {relativeTime(session.updatedAt)}
                </div>

                {session.lastError ? (
                  <div className="mt-3 rounded-[14px] border border-destructive/25 bg-destructive/8 px-3 py-2 text-xs leading-5 text-destructive">
                    {session.lastError}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyNotice({
  icon,
  message,
}: {
  icon: ReactNode;
  message: string;
}) {
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
