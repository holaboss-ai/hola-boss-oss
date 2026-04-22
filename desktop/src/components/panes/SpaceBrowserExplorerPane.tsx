import { useMemo } from "react";
import { Bot, Globe, Pause, Plus, Star, User, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  browserSessionStatusLabel,
  browserSessionTitle,
  browserSurfaceStatusSummary,
  compareBrowserSessionOptions,
} from "@/components/panes/browserSessionUi";
import { useWorkspaceBrowser } from "@/components/panes/useWorkspaceBrowser";

interface SpaceBrowserExplorerPaneProps {
  browserSpace: BrowserSpaceId;
  onBrowserSpaceChange: (space: BrowserSpaceId) => void;
  onActivateDisplay: () => void;
  hasPendingAgentJump?: boolean;
}

type SessionStatusTone = "active" | "waiting" | "paused" | "error" | "idle";

function sessionStatusBadgeClasses(tone: SessionStatusTone): string {
  switch (tone) {
    case "active":
      return "border-success/30 bg-success/10 text-success";
    case "waiting":
      return "border-warning/30 bg-warning/10 text-warning";
    case "paused":
      return "border-info/30 bg-info/10 text-info";
    case "error":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function SpaceBrowserExplorerPane({
  browserSpace,
  onBrowserSpaceChange,
  onActivateDisplay,
  hasPendingAgentJump = false,
}: SpaceBrowserExplorerPaneProps) {
  const {
    selectedWorkspaceId,
    browserState,
    activeTab,
    bookmarks,
    agentSessions,
    runtimeStatesBySessionId,
    currentSession,
    currentRuntimeState,
  } = useWorkspaceBrowser(browserSpace, { includeSessions: true });

  const sortedAgentSessions = useMemo(
    () =>
      [...agentSessions].sort((left, right) =>
        compareBrowserSessionOptions(left, right, runtimeStatesBySessionId),
      ),
    [agentSessions, runtimeStatesBySessionId],
  );
  const hasAgentSessionBrowsers = sortedAgentSessions.length > 0;

  const sessionBrowserStatus = useMemo(
    () =>
      browserSurfaceStatusSummary({
        browserSpace,
        controlMode: browserState.controlMode,
        lifecycleState: browserState.lifecycleState,
        runtimeState: currentRuntimeState,
      }),
    [
      browserSpace,
      browserState.controlMode,
      browserState.lifecycleState,
      currentRuntimeState,
    ],
  );

  const currentSessionLabel = browserSessionTitle(
    currentSession,
    browserState.controlSessionId || browserState.sessionId,
  );

  const openBrowserSpace = (space: BrowserSpaceId) => {
    if (!selectedWorkspaceId || space === browserSpace) {
      return;
    }
    onBrowserSpaceChange(space);
    onActivateDisplay();
  };

  const openBookmark = (bookmark: BrowserBookmarkPayload) => {
    onActivateDisplay();
    void window.electronAPI.browser.navigate(bookmark.url);
  };

  const openNewTab = () => {
    onActivateDisplay();
    void window.electronAPI.browser.newTab();
  };

  const selectAgentSessionBrowser = (value: string | null) => {
    if (!selectedWorkspaceId || !value) {
      return;
    }
    onActivateDisplay();
    void window.electronAPI.browser.setActiveWorkspace(
      selectedWorkspaceId,
      "agent",
      value,
    );
  };

  const hasBookmarks = bookmarks.length > 0;
  const hasTabs = browserState.tabs.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      {/* Agent session chip — only surfaces when on Agent scope */}
      {browserSpace === "agent" ? (
        <div className="shrink-0 border-b border-border px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Select
              value={browserState.sessionId ?? undefined}
              onValueChange={selectAgentSessionBrowser}
              disabled={!hasAgentSessionBrowsers}
            >
              <SelectTrigger className="h-7 min-w-0 flex-1 basis-0 rounded-md border-border bg-card px-2 text-left text-xs shadow-none">
                <SelectValue
                  placeholder={
                    hasAgentSessionBrowsers
                      ? "Choose session browser"
                      : "No session browsers"
                  }
                >
                  {browserState.sessionId
                    ? currentSessionLabel
                    : hasAgentSessionBrowsers
                      ? "Choose session browser"
                      : "No session browsers"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" className="p-1">
                {sortedAgentSessions.map((session) => {
                  const runtimeState =
                    runtimeStatesBySessionId[session.session_id] ?? null;
                  const isSelectedSession =
                    (browserState.sessionId ?? "") === session.session_id;
                  return (
                    <SelectItem
                      key={session.session_id}
                      value={session.session_id}
                      className="rounded-md px-3 py-2 text-xs"
                    >
                      <span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                        <span className="min-w-0 truncate text-foreground">
                          {browserSessionTitle(session, session.session_id)}
                        </span>
                        {!isSelectedSession ? (
                          <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            {browserSessionStatusLabel(runtimeState)}
                          </span>
                        ) : null}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            {sessionBrowserStatus ? (
              <Badge
                variant="secondary"
                className={`shrink-0 gap-1 rounded-full border px-2 py-0.5 text-[10px] ${sessionStatusBadgeClasses(
                  sessionBrowserStatus.tone as SessionStatusTone,
                )}`}
              >
                {sessionBrowserStatus.tone === "paused" ? (
                  <Pause className="size-2.5" />
                ) : (
                  <span
                    aria-hidden="true"
                    className={`inline-block size-1.5 rounded-full ${
                      sessionBrowserStatus.flashing
                        ? "animate-pulse bg-success"
                        : "bg-current opacity-70"
                    }`}
                  />
                )}
                {sessionBrowserStatus.label}
              </Badge>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Scrollable content: bookmarks (when any) + tabs */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {hasBookmarks ? (
          <div className="mb-3 space-y-0.5">
            <div className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Bookmarks
            </div>
            {bookmarks.map((bookmark) => (
              <Button
                key={bookmark.id}
                variant="ghost"
                size="sm"
                onClick={() => openBookmark(bookmark)}
                className="h-auto w-full justify-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
              >
                {bookmark.faviconUrl ? (
                  <img
                    src={bookmark.faviconUrl}
                    alt=""
                    className="size-4 shrink-0 rounded-sm"
                  />
                ) : (
                  <div className="grid size-4 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground">
                    <Star className="size-2.5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">
                    {bookmark.title}
                  </div>
                </div>
              </Button>
            ))}
          </div>
        ) : null}

        <div className="space-y-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openNewTab}
            aria-label="Open new tab"
            className="h-auto w-full justify-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <div className="grid size-4 shrink-0 place-items-center">
              <Plus className="size-3.5" />
            </div>
            <span className="text-sm">New tab</span>
          </Button>

          {hasTabs ? (
            browserState.tabs.map((tab) => {
              const isActive = tab.id === activeTab.id;
              return (
                <div
                  key={tab.id}
                  className={`group relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onActivateDisplay();
                      void window.electronAPI.browser.setActiveTab(tab.id);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    title={tab.title || tab.url}
                  >
                    {tab.faviconUrl ? (
                      <img
                        src={tab.faviconUrl}
                        alt=""
                        className="size-4 shrink-0 rounded-sm"
                      />
                    ) : (
                      <div className="grid size-4 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground">
                        {browserSpace === "agent" ? (
                          <Bot className="size-2.5" />
                        ) : (
                          <Globe className="size-2.5" />
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">
                        {tab.title || "New Tab"}
                      </div>
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      onActivateDisplay();
                      void window.electronAPI.browser.closeTab(tab.id);
                    }}
                    aria-label={`Close ${tab.title || "tab"}`}
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
              <div className="grid size-8 place-items-center rounded-[10px] bg-muted text-muted-foreground">
                <Globe className="size-3.5" />
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                No open tabs in the {browserSpace} browser.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom scope switcher */}
      <div className="flex shrink-0 gap-1 border-t border-border p-1">
        {(
          [
            {
              value: "user" as const,
              label: "User",
              icon: User,
              count: browserState.tabCounts.user,
              showPending: false,
            },
            {
              value: "agent" as const,
              label: "Agent",
              icon: Bot,
              count: browserState.tabCounts.agent,
              showPending: hasPendingAgentJump && browserSpace !== "agent",
            },
          ] as const
        ).map(({ value, label, icon: Icon, count, showPending }) => {
          const isActive = browserSpace === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => openBrowserSpace(value)}
              aria-pressed={isActive}
              className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" />
              <span>{label}</span>
              <span className="text-muted-foreground tabular-nums">
                {count}
              </span>
              {showPending ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 size-1.5 animate-pulse rounded-full bg-primary"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
