import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/IconButton";
import { PaneCard } from "@/components/ui/PaneCard";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

const HOME_URL = "https://www.google.com";
const DEFAULT_BROWSER_SPACE: BrowserSpaceId = "user";
const EXPLICIT_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const LOCALHOST_PATTERN = /^localhost(?::\d+)?(?:[/?#]|$)/i;
const IPV4_HOST_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/;
const IPV6_HOST_PATTERN = /^\[[0-9a-fA-F:]+\](?::\d+)?(?:[/?#]|$)/;

const EMPTY_BROWSER_STATE: BrowserStatePayload = {
  id: "",
  url: "",
  title: "New Tab",
  canGoBack: false,
  canGoForward: false,
  loading: false,
  initialized: false,
  error: "",
};

const INITIAL_STATE: BrowserTabListPayload = {
  space: DEFAULT_BROWSER_SPACE,
  activeTabId: "",
  tabs: [],
  tabCounts: {
    user: 0,
    agent: 0,
  },
};

function normalizeUrl(rawInput: string) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return HOME_URL;
  }

  if (EXPLICIT_SCHEME_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  if (
    LOCALHOST_PATTERN.test(trimmed) ||
    IPV4_HOST_PATTERN.test(trimmed) ||
    IPV6_HOST_PATTERN.test(trimmed)
  ) {
    return `http://${trimmed}`;
  }

  if (trimmed.includes(".")) {
    return `https://${trimmed}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserPane({
  suspendNativeView = false,
  layoutSyncKey = "",
}: {
  suspendNativeView?: boolean;
  layoutSyncKey?: string;
}) {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const [paneWidth, setPaneWidth] = useState(0);
  const [browserState, setBrowserState] =
    useState<BrowserTabListPayload>(INITIAL_STATE);
  const [inputValue, setInputValue] = useState("");
  const [bookmarks, setBookmarks] = useState<BrowserBookmarkPayload[]>([]);
  const [downloads, setDownloads] = useState<BrowserDownloadPayload[]>([]);
  const [historyEntries, setHistoryEntries] = useState<
    BrowserHistoryEntryPayload[]
  >([]);
  const [addressFocused, setAddressFocused] = useState(false);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] =
    useState(-1);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const addressFieldRef = useRef<HTMLDivElement | null>(null);
  const shouldFocusAddressRef = useRef(false);

  const activeTab = useMemo(
    () =>
      browserState.tabs.find((tab) => tab.id === browserState.activeTabId) ??
      browserState.tabs[0] ??
      EMPTY_BROWSER_STATE,
    [browserState],
  );
  const isCompactPane = paneWidth > 0 && paneWidth <= 320;
  const isNarrowPane = paneWidth > 0 && paneWidth <= 240;
  const showBookmarkStrip = bookmarks.length > 0 && !isCompactPane;
  const visibleBrowserSpace = browserState.space || DEFAULT_BROWSER_SPACE;
  const alternateBrowserSpace =
    visibleBrowserSpace === "user" ? "agent" : "user";
  const visibleBrowserLabel =
    visibleBrowserSpace === "user" ? "User" : "Agent";
  const alternateBrowserLabel =
    alternateBrowserSpace === "user" ? "user" : "agent";
  const VisibleBrowserIcon = visibleBrowserSpace === "user" ? Globe : Bot;

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) {
      return;
    }

    const syncPaneWidth = () => {
      setPaneWidth(Math.round(pane.getBoundingClientRect().width));
    };

    syncPaneWidth();
    const observer = new ResizeObserver(syncPaneWidth);
    observer.observe(pane);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const applyState = (state: BrowserTabListPayload) => {
      if (!mounted) {
        return;
      }

      setBrowserState(state);
    };

    if (!selectedWorkspaceId) {
      applyState(INITIAL_STATE);
      return () => {
        mounted = false;
      };
    }

    void window.electronAPI.browser
      .setActiveWorkspace(selectedWorkspaceId, visibleBrowserSpace)
      .then(applyState);
    const unsubscribe = window.electronAPI.browser.onStateChange(applyState);

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [selectedWorkspaceId, visibleBrowserSpace]);

  useEffect(() => {
    let mounted = true;

    const applyBookmarks = (nextBookmarks: BrowserBookmarkPayload[]) => {
      if (!mounted) {
        return;
      }

      setBookmarks(nextBookmarks);
    };

    const applyDownloads = (nextDownloads: BrowserDownloadPayload[]) => {
      if (!mounted) {
        return;
      }

      setDownloads(nextDownloads);
    };

    const applyHistory = (nextHistory: BrowserHistoryEntryPayload[]) => {
      if (!mounted) {
        return;
      }

      setHistoryEntries(nextHistory);
    };

    if (!selectedWorkspaceId) {
      applyBookmarks([]);
      applyDownloads([]);
      applyHistory([]);
      return () => {
        mounted = false;
      };
    }

    void window.electronAPI.browser.setActiveWorkspace(
      selectedWorkspaceId,
      visibleBrowserSpace,
    );
    void window.electronAPI.browser.getBookmarks().then(applyBookmarks);
    void window.electronAPI.browser.getDownloads().then(applyDownloads);
    void window.electronAPI.browser.getHistory().then(applyHistory);
    const unsubscribeBookmarks =
      window.electronAPI.browser.onBookmarksChange(applyBookmarks);
    const unsubscribeDownloads =
      window.electronAPI.browser.onDownloadsChange(applyDownloads);
    const unsubscribeHistory =
      window.electronAPI.browser.onHistoryChange(applyHistory);

    return () => {
      mounted = false;
      unsubscribeBookmarks();
      unsubscribeDownloads();
      unsubscribeHistory();
    };
  }, [selectedWorkspaceId, visibleBrowserSpace]);

  useEffect(() => {
    setInputValue(activeTab.url || "");
  }, [activeTab.id, activeTab.url]);

  useEffect(() => {
    setHighlightedSuggestionIndex(
      addressFocused && historyEntries.length > 0 ? 0 : -1,
    );
  }, [activeTab.id]);

  useEffect(() => {
    if (!shouldFocusAddressRef.current) {
      return;
    }

    shouldFocusAddressRef.current = false;
    window.requestAnimationFrame(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    });
  }, [activeTab.id]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    if (suspendNativeView) {
      void window.electronAPI.browser.setBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      return;
    }

    let rafId = 0;

    const syncBounds = () => {
      const rect = viewport.getBoundingClientRect();
      void window.electronAPI.browser.setBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };

    const queueSync = () => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(syncBounds);
    };

    queueSync();

    const observer = new ResizeObserver(queueSync);
    observer.observe(viewport);
    window.addEventListener("resize", queueSync);
    window.setTimeout(queueSync, 100);
    window.setTimeout(queueSync, 400);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", queueSync);
      window.cancelAnimationFrame(rafId);
      void window.electronAPI.browser.setBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    };
  }, [layoutSyncKey, suspendNativeView]);

  const navigateTo = (rawInput: string) => {
    const nextUrl = normalizeUrl(rawInput);
    setInputValue(nextUrl);
    void window.electronAPI.browser.navigate(nextUrl);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigateTo(inputValue);
  };

  const onNewTab = () => {
    shouldFocusAddressRef.current = true;
    setInputValue("");
    void window.electronAPI.browser.newTab();
  };

  const onCloseTab = (tabId: string) => {
    void window.electronAPI.browser.closeTab(tabId);
  };

  const onSelectBrowserSpace = (space: BrowserSpaceId) => {
    if (!selectedWorkspaceId || space === visibleBrowserSpace) {
      return;
    }
    void window.electronAPI.browser.setActiveWorkspace(selectedWorkspaceId, space);
  };

  const isBookmarked = useMemo(
    () => bookmarks.some((bookmark) => bookmark.url === activeTab.url),
    [activeTab.url, bookmarks],
  );

  const activeBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.url === activeTab.url) ?? null,
    [activeTab.url, bookmarks],
  );

  const activeDownloadCount = useMemo(
    () =>
      downloads.filter((download) => download.status === "progressing").length,
    [downloads],
  );
  const historySuggestions = useMemo(() => {
    if (!addressFocused) {
      return [];
    }

    const query = inputValue.trim().toLowerCase();
    const filtered = historyEntries.filter((entry) => {
      if (!query) {
        return true;
      }

      return (
        entry.url.toLowerCase().includes(query) ||
        entry.title.toLowerCase().includes(query)
      );
    });

    return filtered.filter((entry) => entry.url !== activeTab.url).slice(0, 6);
  }, [activeTab.url, addressFocused, historyEntries, inputValue]);

  useEffect(() => {
    if (!historySuggestions.length) {
      setHighlightedSuggestionIndex(-1);
      return;
    }

    setHighlightedSuggestionIndex((current) => {
      if (current < 0 || current >= historySuggestions.length) {
        return 0;
      }
      return current;
    });
  }, [historySuggestions]);

  const onToggleBookmark = () => {
    if (!activeTab.url) {
      return;
    }

    if (activeBookmark) {
      void window.electronAPI.browser.removeBookmark(activeBookmark.id);
      return;
    }

    void window.electronAPI.browser.addBookmark({
      url: activeTab.url,
      title: activeTab.title || activeTab.url,
    });
  };

  const getButtonBounds = (button: HTMLButtonElement | null) => {
    if (!button) {
      return null;
    }

    const rect = button.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  };

  const getAnchorBounds = (element: HTMLElement | null) => {
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  };

  useEffect(() => {
    if (!addressFocused || historySuggestions.length === 0) {
      void window.electronAPI.browser.hideAddressSuggestions();
      return;
    }

    const bounds = getAnchorBounds(addressFieldRef.current);
    if (!bounds) {
      return;
    }

    const suggestions: AddressSuggestionPayload[] = historySuggestions.map(
      (entry) => ({
        id: entry.id,
        url: entry.url,
        title: entry.title,
        faviconUrl: entry.faviconUrl,
      }),
    );

    void window.electronAPI.browser.showAddressSuggestions(
      bounds,
      suggestions,
      highlightedSuggestionIndex,
    );
  }, [addressFocused, highlightedSuggestionIndex, historySuggestions]);

  useEffect(() => {
    return window.electronAPI.browser.onAddressSuggestionChosen((index) => {
      const entry = historySuggestions[index];
      if (!entry) {
        return;
      }

      setAddressFocused(false);
      setHighlightedSuggestionIndex(index);
      navigateTo(entry.url);
    });
  }, [historySuggestions]);

  const onAddressKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!historySuggestions.length) {
      if (event.key === "Escape") {
        setAddressFocused(false);
        void window.electronAPI.browser.hideAddressSuggestions();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedSuggestionIndex(
        (current) => (current + 1) % historySuggestions.length,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedSuggestionIndex((current) =>
        current <= 0 ? historySuggestions.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === "Enter" && highlightedSuggestionIndex >= 0) {
      event.preventDefault();
      const entry = historySuggestions[highlightedSuggestionIndex];
      if (!entry) {
        return;
      }

      setAddressFocused(false);
      navigateTo(entry.url);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setAddressFocused(false);
      setHighlightedSuggestionIndex(-1);
      void window.electronAPI.browser.hideAddressSuggestions();
    }
  };

  return (
    <PaneCard title="" className="shadow-md">
      <div ref={paneRef} className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-border px-2 py-1.5">
          <div className="mb-1.5 flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {browserState.tabs.map((tab) => {
              const isActive = tab.id === activeTab.id;

              return (
                <div
                  key={tab.id}
                  className={[
                    "group flex min-w-0 max-w-[200px] items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors",
                    isActive
                      ? "border-primary/50 bg-primary/12 text-primary"
                      : "bg-muted border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() =>
                      void window.electronAPI.browser.setActiveTab(tab.id)
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={tab.title}
                  >
                    <Globe size={12} className="shrink-0" />
                    {!isNarrowPane ? (
                      <span className="truncate text-[10px] font-semibold tracking-wide">
                        {tab.title || "New Tab"}
                      </span>
                    ) : null}
                    {tab.loading ? (
                      <Loader2 size={11} className="shrink-0 animate-spin" />
                    ) : null}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onCloseTab(tab.id)}
                    className="size-4.5 shrink-0 rounded-full text-muted-foreground"
                    aria-label={`Close ${tab.title || "tab"}`}
                  >
                    <X size={11} />
                  </Button>
                </div>
              );
            })}

            <Button
              variant="outline"
              size="icon-sm"
              onClick={onNewTab}
              className="shrink-0 rounded-full"
              aria-label="New tab"
            >
              <Plus size={12} />
            </Button>
          </div>

          <div
            className={`mb-1 flex min-w-0 ${isCompactPane ? "flex-col gap-1.5" : "items-center gap-1"}`}
          >
            <div
              className={`flex min-w-0 ${isCompactPane ? "w-full items-center justify-between gap-1" : "items-center gap-1"}`}
            >
              <div className="flex min-w-0 items-center gap-1">
                <IconButton
                  icon={<ChevronLeft size={13} />}
                  label="Back"
                  onClick={() => void window.electronAPI.browser.back()}
                  disabled={!activeTab.canGoBack}
                  className="size-7"
                />
                <IconButton
                  icon={<ChevronRight size={13} />}
                  label="Forward"
                  onClick={() => void window.electronAPI.browser.forward()}
                  disabled={!activeTab.canGoForward}
                  className="size-7"
                />
                <IconButton
                  icon={<RefreshCcw size={13} />}
                  label="Refresh"
                  onClick={() => void window.electronAPI.browser.reload()}
                  disabled={!activeTab.initialized}
                  className="size-7"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSelectBrowserSpace(alternateBrowserSpace)}
                  className="shrink-0 rounded-full border-border/45 bg-background/80 px-2.5 text-[11px] text-muted-foreground"
                  aria-label={`Switch to ${alternateBrowserLabel} browser`}
                  title={`Switch to ${alternateBrowserLabel} browser`}
                >
                  <VisibleBrowserIcon
                    size={12}
                    className={
                      visibleBrowserSpace === "agent"
                        ? "text-primary/85"
                        : "text-muted-foreground/80"
                    }
                  />
                  {!isNarrowPane ? <span>{visibleBrowserLabel}</span> : null}
                </Button>
              </div>

              <div
                className={`relative flex shrink-0 items-center gap-1 ${isCompactPane ? "" : "ml-auto"}`}
              >
                <Button
                  ref={moreButtonRef}
                  variant="outline"
                  size="icon-sm"
                  className="relative"
                  aria-label="More browser options"
                  title="More"
                  onClick={() => {
                    const bounds = getButtonBounds(moreButtonRef.current);
                    if (!bounds) {
                      return;
                    }

                    void window.electronAPI.browser.toggleOverflowPopup(bounds);
                  }}
                >
                  <MoreHorizontal size={14} />
                  {activeDownloadCount > 0 ? (
                    <Badge className="absolute -right-1 -top-1 h-4 min-w-[16px] px-1 text-[9px] font-bold leading-4 text-black">
                      {activeDownloadCount}
                    </Badge>
                  ) : null}
                </Button>
              </div>
            </div>

            <form
              className={`flex min-w-0 ${isCompactPane ? "w-full" : "ml-1.5 flex-1 items-center gap-1.5"}`}
              onSubmit={onSubmit}
            >
              <div
                ref={addressFieldRef}
                className="relative flex min-w-0 flex-1"
              >
                <div className="border border-border bg-muted/50 transition-colors focus-within:border-ring flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2.5 py-1.5">
                  <Globe size={12} className="shrink-0 text-primary/85" />
                  <input
                    ref={addressInputRef}
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    onFocus={(event) => {
                      event.currentTarget.select();
                      setAddressFocused(true);
                    }}
                    onBlur={() =>
                      window.setTimeout(() => setAddressFocused(false), 120)
                    }
                    onKeyDown={onAddressKeyDown}
                    className="embedded-input w-full min-w-0 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
                    placeholder={
                      isNarrowPane ? "Search" : "Enter URL or search"
                    }
                  />
                  {!isNarrowPane ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={onToggleBookmark}
                      className={
                        isBookmarked
                          ? "rounded-full border border-primary/60 bg-primary/18 text-primary"
                          : "rounded-full text-muted-foreground"
                      }
                      aria-label={
                        isBookmarked ? "Remove bookmark" : "Add bookmark"
                      }
                      title={
                        isBookmarked ? "Remove bookmark" : "Bookmark this tab"
                      }
                      disabled={!activeTab.url}
                    >
                      <Star
                        size={13}
                        fill={isBookmarked ? "currentColor" : "none"}
                      />
                    </Button>
                  ) : null}
                </div>
              </div>
            </form>
          </div>

          {showBookmarkStrip ? (
            <div className="flex min-h-6 items-center gap-0.5 overflow-x-auto px-1.5 py-0.5">
              {bookmarks.slice(0, 12).map((bookmark) => (
                <Button
                  variant="ghost"
                  size="xs"
                  key={bookmark.id}
                  onClick={() => navigateTo(bookmark.url)}
                  className="shrink-0 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    {bookmark.faviconUrl ? (
                      <img
                        src={bookmark.faviconUrl}
                        alt=""
                        className="size-3 shrink-0 rounded-sm"
                      />
                    ) : (
                      <span className="grid size-3 shrink-0 place-items-center rounded-sm bg-muted text-[8px] text-muted-foreground">
                        •
                      </span>
                    )}
                    <span className="block max-w-[170px] truncate">
                      {bookmark.title}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-px pb-px">
          <div
            ref={viewportRef}
            className="relative min-h-0 flex-1 overflow-hidden rounded-b-xl bg-card"
          >
            {!activeTab.initialized ? (
              <div className="absolute inset-0 grid place-items-center bg-card p-6 text-center">
                <div className="pointer-events-none w-full max-w-[320px] rounded-[24px] border border-border/55 bg-card px-5 py-5 shadow-xl backdrop-blur">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-[18px] border border-primary/25 bg-primary/8 text-primary">
                    <Loader2 size={18} className="animate-spin" />
                  </div>
                  <div className="mt-4 text-[15px] font-medium tracking-[-0.02em] text-foreground">
                    Starting {visibleBrowserSpace === "agent" ? "agent" : "user"} browser
                  </div>
                  <div className="mt-1.5 text-[12px] leading-6 text-muted-foreground">
                    Opening the embedded {visibleBrowserSpace === "agent" ? "agent" : "user"} browser for this workspace.
                  </div>
                  <div className="bg-muted mt-4 overflow-hidden rounded-full border border-border/40 p-1">
                    <div className="h-1.5 rounded-full bg-primary/60 animate-pulse" />
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab.initialized && activeTab.loading ? (
              <div className="pointer-events-none absolute inset-x-3 top-3 z-10">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-card px-3 py-1.5 text-[11px] text-muted-foreground shadow-lg backdrop-blur">
                  <Loader2
                    size={12}
                    className="animate-spin text-primary"
                  />
                  <span>Loading page</span>
                </div>
              </div>
            ) : null}

            {activeTab.error ? (
              <div className="absolute inset-x-3 bottom-3 rounded-lg border border-amber-300/40 bg-black/70 px-3 py-2 text-xs text-amber-100/85">
                {activeTab.error}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </PaneCard>
  );
}
