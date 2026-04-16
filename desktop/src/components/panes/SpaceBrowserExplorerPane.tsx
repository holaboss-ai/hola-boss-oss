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
}

export function SpaceBrowserExplorerPane({
  browserSpace,
  onBrowserSpaceChange,
  onActivateDisplay,
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="border-b border-border/45 px-3 py-2.5">
        <Tabs
          value={browserSpace}
          onValueChange={(value) => openBrowserSpace(value as BrowserSpaceId)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="user" className="flex-1 gap-1.5">
              <User size={12} />
              User
              <Badge
                variant="secondary"
                className="ml-0.5 px-1.5 py-0 text-[10px]"
              >
                {browserState.tabCounts.user}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="agent" className="flex-1 gap-1.5">
              <Bot size={12} />
              Agent
              <Badge
                variant="secondary"
                className="ml-0.5 px-1.5 py-0 text-[10px]"
              >
                {browserState.tabCounts.agent}
              </Badge>
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
              <SelectTrigger className="h-9 min-w-0 flex-1 basis-0 rounded-[11px] border-border/45 bg-card px-3 text-left text-xs font-medium shadow-none">
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
                      className="rounded-[11px] px-3 py-2 text-xs"
                    >
                      <span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                        <span className="min-w-0 truncate font-medium text-foreground">
                          {browserSessionTitle(session, session.session_id)}
                        </span>
                        {!isSelectedSession ? (
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
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
                className={`shrink-0 gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${
                  sessionBrowserStatus.tone === "active"
                    ? "border border-emerald-300/60 bg-emerald-500/12 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-200"
                    : sessionBrowserStatus.tone === "waiting"
                      ? "border border-amber-300/60 bg-amber-500/12 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100"
                      : sessionBrowserStatus.tone === "paused"
                        ? "border border-sky-300/60 bg-sky-500/12 text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-100"
                        : sessionBrowserStatus.tone === "error"
                          ? "border border-rose-300/60 bg-rose-500/12 text-rose-700 dark:border-rose-400/35 dark:bg-rose-500/10 dark:text-rose-100"
                          : ""
                }`}
              >
                {sessionBrowserStatus.tone === "paused" ? (
                  <Pause size={10} />
                ) : (
                  <span
                    className={`inline-block size-2 rounded-full ${
                      sessionBrowserStatus.flashing
                        ? "animate-pulse bg-emerald-300"
                        : "bg-current/80"
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
          {bookmarks.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted-foreground/70">
              Saved bookmarks will appear here.
            </div>
          ) : (
            bookmarks.map((bookmark) => (
              <Button
                key={bookmark.id}
                variant="ghost"
                size="sm"
                onClick={() => openBookmark(bookmark)}
                className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-left"
              >
                {bookmark.faviconUrl ? (
                  <img
                    src={bookmark.faviconUrl}
                    alt=""
                    className="size-4 shrink-0 rounded-sm"
                  />
                ) : (
                  <div className="grid size-4 shrink-0 place-items-center rounded-sm bg-primary/12 text-primary">
                    <Star size={10} />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-foreground">
                    {bookmark.title}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {bookmark.url}
                  </div>
                </div>
              </Button>
            ))
          )}
        </div>

        <div className="mt-4 border-t border-border/40 pt-3">
          <div className="mb-2 flex items-center justify-between gap-2 px-2">
            <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">
              Tabs
            </div>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={openNewTab}
              aria-label="Open new tab"
            >
              <Plus size={11} />
              New Tab
            </Button>
          </div>
          <div className="space-y-0.5">
            {browserState.tabs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/40 px-3 py-3 text-xs text-muted-foreground/70">
                No open tabs in the {browserSpace} browser.
              </div>
            ) : (
              browserState.tabs.map((tab) => {
                const isActive = tab.id === activeTab.id;
                return (
                  <div
                    key={tab.id}
                    className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onActivateDisplay();
                        void window.electronAPI.browser.setActiveTab(tab.id);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
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
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">
                          {tab.title || "New Tab"}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {tab.url || "about:blank"}
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
                      className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
                    >
                      <X size={11} />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
