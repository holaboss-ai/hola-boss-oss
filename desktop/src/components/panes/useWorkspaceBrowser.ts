import { useEffect, useMemo, useState } from "react";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

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

function initialBrowserState(space: BrowserSpaceId): BrowserTabListPayload {
  return {
    space,
    activeTabId: "",
    tabs: [],
    tabCounts: {
      user: 0,
      agent: 0,
    },
  };
}

interface UseWorkspaceBrowserOptions {
  includeDownloads?: boolean;
  includeHistory?: boolean;
}

export function useWorkspaceBrowser(
  browserSpace: BrowserSpaceId,
  options?: UseWorkspaceBrowserOptions,
) {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const [browserState, setBrowserState] = useState<BrowserTabListPayload>(
    () => initialBrowserState(browserSpace),
  );
  const [bookmarks, setBookmarks] = useState<BrowserBookmarkPayload[]>([]);
  const [downloads, setDownloads] = useState<BrowserDownloadPayload[]>([]);
  const [historyEntries, setHistoryEntries] = useState<
    BrowserHistoryEntryPayload[]
  >([]);

  useEffect(() => {
    let mounted = true;

    const applyState = (state: BrowserTabListPayload) => {
      if (!mounted || state.space !== browserSpace) {
        return;
      }
      setBrowserState(state);
    };

    if (!selectedWorkspaceId) {
      setBrowserState(initialBrowserState(browserSpace));
      return () => {
        mounted = false;
      };
    }

    void window.electronAPI.browser
      .setActiveWorkspace(selectedWorkspaceId, browserSpace)
      .then((state) => {
        if (mounted) {
          applyState(state);
        }
      });
    const unsubscribe = window.electronAPI.browser.onStateChange(applyState);

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [browserSpace, selectedWorkspaceId]);

  useEffect(() => {
    let mounted = true;

    const applyBookmarks = (nextBookmarks: BrowserBookmarkPayload[]) => {
      if (mounted) {
        setBookmarks(nextBookmarks);
      }
    };
    const applyDownloads = (nextDownloads: BrowserDownloadPayload[]) => {
      if (mounted) {
        setDownloads(nextDownloads);
      }
    };
    const applyHistory = (nextHistory: BrowserHistoryEntryPayload[]) => {
      if (mounted) {
        setHistoryEntries(nextHistory);
      }
    };

    if (!selectedWorkspaceId) {
      setBookmarks([]);
      setDownloads([]);
      setHistoryEntries([]);
      return () => {
        mounted = false;
      };
    }

    void window.electronAPI.browser.getBookmarks().then(applyBookmarks);
    const unsubscribeBookmarks =
      window.electronAPI.browser.onBookmarksChange(applyBookmarks);

    let unsubscribeDownloads: () => void = () => {};
    if (options?.includeDownloads) {
      void window.electronAPI.browser.getDownloads().then(applyDownloads);
      unsubscribeDownloads =
        window.electronAPI.browser.onDownloadsChange(applyDownloads);
    } else {
      setDownloads([]);
    }

    let unsubscribeHistory: () => void = () => {};
    if (options?.includeHistory) {
      void window.electronAPI.browser.getHistory().then(applyHistory);
      unsubscribeHistory =
        window.electronAPI.browser.onHistoryChange(applyHistory);
    } else {
      setHistoryEntries([]);
    }

    return () => {
      mounted = false;
      unsubscribeBookmarks();
      unsubscribeDownloads();
      unsubscribeHistory();
    };
  }, [options?.includeDownloads, options?.includeHistory, selectedWorkspaceId]);

  const activeTab = useMemo(
    () =>
      browserState.tabs.find((tab) => tab.id === browserState.activeTabId) ??
      browserState.tabs[0] ??
      EMPTY_BROWSER_STATE,
    [browserState],
  );

  const activeBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.url === activeTab.url) ?? null,
    [activeTab.url, bookmarks],
  );

  return {
    selectedWorkspaceId,
    browserState,
    activeTab,
    bookmarks,
    downloads,
    historyEntries,
    activeBookmark,
    isBookmarked: Boolean(activeBookmark),
  };
}
