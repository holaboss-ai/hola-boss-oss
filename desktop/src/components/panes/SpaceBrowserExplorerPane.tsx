import { Bot, Globe, Plus, Star, X } from "lucide-react";
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
  const { selectedWorkspaceId, browserState, activeTab, bookmarks } =
    useWorkspaceBrowser(browserSpace);

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

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="border-b border-border/45 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex min-w-0 flex-1 items-center rounded-md border border-border bg-muted/50 p-0.5">
            <button
              type="button"
              onClick={() => openBrowserSpace("user")}
              className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium transition ${
                browserSpace === "user"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <Globe size={12} />
              <span>User</span>
              <span className="rounded-full bg-foreground/8 px-1.5 py-0.5 text-[10px] text-current/80">
                {browserState.tabCounts.user}
              </span>
            </button>
            <button
              type="button"
              onClick={() => openBrowserSpace("agent")}
              className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium transition ${
                browserSpace === "agent"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <Bot size={12} />
              <span>Agent</span>
              <span className="rounded-full bg-foreground/8 px-1.5 py-0.5 text-[10px] text-current/80">
                {browserState.tabCounts.agent}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-1">
          {bookmarks.length === 0 ? (
            <div className="px-1 py-1 text-[12px] leading-6 text-muted-foreground/72">
              Saved bookmarks will appear here.
            </div>
          ) : (
            bookmarks.map((bookmark) => (
              <button
                key={bookmark.id}
                type="button"
                onClick={() => openBookmark(bookmark)}
                className="flex w-full items-center gap-2 rounded-md border border-transparent px-3 py-2 text-left transition hover:bg-accent hover:text-accent-foreground"
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
                  <div className="truncate text-[12px] font-medium text-foreground/88">
                    {bookmark.title}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground/72">
                    {bookmark.url}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="mt-4 border-t border-border/40 pt-4">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
              Tabs
            </div>
            <button
              type="button"
              onClick={openNewTab}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card/80 px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
              aria-label="Open new tab"
            >
              <Plus size={12} />
              <span>New Tab</span>
            </button>
          </div>
          <div className="space-y-1">
          {browserState.tabs.length === 0 ? (
            <div className="rounded-[16px] border border-dashed border-border/50 px-3 py-3 text-[12px] leading-6 text-muted-foreground/72">
              No open tabs in the {browserSpace} browser.
            </div>
          ) : (
            browserState.tabs.map((tab) => {
              const isActive = tab.id === activeTab.id;
              return (
                <div
                  key={tab.id}
                  className={`group flex items-center gap-2 rounded-md border border-transparent px-3 py-2 transition ${
                    isActive
                      ? "border-primary/35 bg-primary/10 text-primary"
                      : "hover:bg-accent hover:text-accent-foreground"
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
                      <div className="grid size-4 shrink-0 place-items-center rounded-sm bg-foreground/8 text-muted-foreground">
                        {browserSpace === "agent" ? (
                          <Bot size={10} />
                        ) : (
                          <Globe size={10} />
                        )}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-current">
                        {tab.title || "New Tab"}
                      </div>
                      <div className="truncate text-[11px] text-current/70">
                        {tab.url || "about:blank"}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onActivateDisplay();
                      void window.electronAPI.browser.closeTab(tab.id);
                    }}
                    className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground/75 transition hover:bg-accent hover:text-accent-foreground"
                    aria-label={`Close ${tab.title || "tab"}`}
                  >
                    <X size={12} />
                  </button>
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
