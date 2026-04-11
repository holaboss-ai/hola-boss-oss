import { Bot, Globe, Plus, Star, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
      <div className="border-b border-border/45 px-3 py-2.5">
        <Tabs
          value={browserSpace}
          onValueChange={(value) => openBrowserSpace(value as BrowserSpaceId)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="user" className="flex-1 gap-1.5">
              <Globe size={12} />
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
