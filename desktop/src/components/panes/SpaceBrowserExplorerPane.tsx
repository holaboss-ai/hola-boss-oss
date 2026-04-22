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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
      <div className="border-b border-border px-3 py-2.5">
        <Tabs
          value={browserSpace}
          onValueChange={(value) => openBrowserSpace(value as BrowserSpaceId)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="user" className="flex-1 gap-1.5 text-xs">
              <User size={12} />
              User
              <Badge
                variant="secondary"
                className="ml-0.5 h-4 min-w-4 px-1 text-xs"
              >
                {browserState.tabCounts.user}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="agent"
              className="relative flex-1 gap-1.5 text-xs"
            >
              <Bot size={12} />
              Agent
              <Badge
                variant="secondary"
                className="ml-0.5 h-4 min-w-4 px-1 text-xs"
              >
                {browserState.tabCounts.agent}
              </Badge>
              {hasPendingAgentJump && browserSpace !== "agent" ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1.5 top-1 size-1.5 animate-pulse rounded-full bg-primary"
                />
              ) : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {browserSpace === "agent" ? (
          <div className="mt-2.5 flex items-center gap-1.5">
            <Select
              value={browserState.sessionId ?? undefined}
              onValueChange={selectAgentSessionBrowser}
              disabled={!hasAgentSessionBrowsers}
            >
              <SelectTrigger className="h-9 min-w-0 flex-1 basis-0 rounded-lg border-border bg-card px-3 text-left text-xs shadow-none">
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
                className={`shrink-0 gap-1 rounded-full border px-2 py-0.5 text-xs ${sessionStatusBadgeClasses(
                  sessionBrowserStatus.tone as SessionStatusTone,
                )}`}
              >
                {sessionBrowserStatus.tone === "paused" ? (
                  <Pause size={10} />
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
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-0.5">
          {hasBookmarks ? (
            bookmarks.map((bookmark) => (
              <Button
                key={bookmark.id}
                variant="ghost"
                size="sm"
                onClick={() => openBookmark(bookmark)}
                className="h-auto w-full justify-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent/55"
              >
                {bookmark.faviconUrl ? (
                  <img
                    src={bookmark.faviconUrl}
                    alt=""
                    className="size-4 shrink-0 rounded-sm"
                  />
                ) : (
                  <div className="grid size-4 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground">
                    <Star size={10} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">
                    {bookmark.title}
                  </div>
                </div>
              </Button>
            ))
          ) : (
            <div className="px-2.5 py-1.5 text-xs text-muted-foreground">
              Saved bookmarks will appear here.
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-border pt-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={openNewTab}
              aria-label="Open new tab"
              className="gap-1.5 text-xs text-muted-foreground"
            >
              <Plus size={12} />
              New Tab
            </Button>
          </div>
          <div className="space-y-0.5">
            {hasTabs ? (
              browserState.tabs.map((tab) => {
                const isActive = tab.id === activeTab.id;
                return (
                  <div
                    key={tab.id}
                    className={`group relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors ${
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/55"
                    }`}
                  >
                    {isActive ? (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary"
                      />
                    ) : null}
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
                            <Bot size={10} />
                          ) : (
                            <Globe size={10} />
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
                      <X size={12} />
                    </Button>
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                <div className="grid size-9 place-items-center rounded-[10px] bg-muted text-muted-foreground">
                  <Globe size={14} />
                </div>
                <div className="text-xs leading-5 text-muted-foreground">
                  No open tabs in the {browserSpace} browser.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
