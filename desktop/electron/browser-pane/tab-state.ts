/**
 * Browser-pane tab state — query, view-attachment, and state-emit functions
 * (BP-P5b-1).
 *
 * The **read + emit** half of the tab subsystem. The write half
 * (createBrowserTab, navigateActiveBrowserTab, setActiveBrowserTab,
 * closeBrowserTab, showBrowserViewContextMenu, handleBrowserWindowOpenAsTab)
 * lands in subsequent extractions. Splitting the read side first keeps
 * each commit reviewable.
 *
 * Note: this module does NOT own `attachedBrowserTabView` or `browserBounds`
 * directly. Those vars still live as module-level `let`s in main.ts because
 * many functions that have not yet migrated read/write them. We expose
 * getters + setters through `deps` so tab-state.ts and main.ts share a
 * single source of truth. When the remaining write-side functions move,
 * those vars can collapse into the factory closure.
 */
import type {
  BrowserView,
  BrowserWindow,
  WebContents,
} from "electron";

import type {
  BrowserBoundsPayload,
  BrowserHistoryEntryPayload,
  BrowserSpaceId,
  BrowserStatePayload,
  BrowserTabListPayload,
  BrowserVisibleSnapshotPayload,
} from "../../shared/browser-pane-protocol.js";

/**
 * Minimal structural views of main.ts's `BrowserTabRecord`,
 * `BrowserTabSpaceState`, and `BrowserWorkspaceState`. We don't depend on
 * the full types because they reference other main-only shapes (download
 * payloads, lifecycle state, etc.) that haven't migrated yet. The actual
 * records main passes in are structurally compatible.
 */
export interface BrowserTabRecord {
  view: BrowserView;
  state: BrowserStatePayload;
  popupFrameName?: string;
  popupOpenedAtMs?: number;
}

export interface BrowserTabSpaceState {
  tabs: Map<string, BrowserTabRecord>;
  activeTabId: string;
}

export interface BrowserWorkspaceState {
  workspaceId: string;
  history: BrowserHistoryEntryPayload[];
}

export interface BrowserPaneTabStateDeps {
  getMainWindow: () => BrowserWindow | null;
  getActiveWorkspaceId: () => string;
  getActiveSpaceId: () => BrowserSpaceId;
  getActiveSessionId: () => string;

  /**
   * Reading + writing main.ts's module-level `attachedBrowserTabView`. main
   * still owns the var until the rest of the tab write-path moves.
   */
  getAttachedView: () => BrowserView | null;
  setAttachedView: (view: BrowserView | null) => void;

  /**
   * Reading + writing main.ts's module-level `browserBounds`.
   */
  getBrowserBounds: () => BrowserBoundsPayload;
  setBrowserBounds: (bounds: BrowserBoundsPayload) => void;

  getWorkspace: (workspaceId: string) => BrowserWorkspaceState | null;
  getWorkspaceOrEmpty: (
    workspaceId?: string | null,
  ) => BrowserWorkspaceState | null;

  persistWorkspace: (workspaceId: string) => Promise<void> | void;

  browserSpaceId: (value?: string | null) => BrowserSpaceId;
  browserSessionId: (value?: string | null) => string;
  browserTabSpaceState: (
    workspace: BrowserWorkspaceState | null | undefined,
    space: BrowserSpaceId,
    sessionId?: string | null,
    options?: { createIfMissing?: boolean; useVisibleAgentSession?: boolean },
  ) => BrowserTabSpaceState | null;
  browserTabSpaceTouch: (tabSpace: BrowserTabSpaceState) => void;

  browserWorkspaceSnapshot: (
    workspaceId?: string | null,
    space?: BrowserSpaceId | null,
    sessionId?: string | null,
    options?: { useVisibleAgentSession?: boolean },
  ) => BrowserTabListPayload;

  scheduleAgentSessionBrowserLifecycleCheck: (
    workspaceId: string,
    sessionId?: string | null,
  ) => void;

  shouldTrackHistoryUrl: (url: string) => boolean;

  hasOpenHistoryPopup: () => boolean;
  sendHistoryToPopup: (history: BrowserHistoryEntryPayload[]) => void;

  reserveMainWindowClosedListenerBudget: (additionalClosedListeners?: number) => void;

  /** P6 callback — provision/reuse the workspace for a given space+session. */
  ensureBrowserWorkspace: (
    workspaceId?: string | null,
    space?: BrowserSpaceId | null,
    sessionId?: string | null,
  ) => Promise<BrowserWorkspaceState | null>;

  /** P6 callback — promote a session to the visible agent space. */
  setVisibleAgentBrowserSession: (
    workspace: BrowserWorkspaceState,
    sessionId: string,
  ) => void;

  /**
   * P5b-4 callback — open a fresh tab in the given workspace+space. We pass
   * it in (rather than implement here) because createBrowserTab is heavy and
   * lives in main.ts until the next extraction.
   */
  createBrowserTab: (
    workspaceId: string,
    options: {
      url?: string;
      browserSpace?: BrowserSpaceId;
      sessionId?: string | null;
      [key: string]: unknown;
    },
  ) => string | null;

  /** Default URL to seed a new tab with when there's nothing else to land on. */
  homeUrl: string;
}

export interface BrowserPaneTabState {
  hasVisibleBounds: () => boolean;
  setBounds: (bounds: BrowserBoundsPayload) => void;
  captureVisibleSnapshot: () => Promise<BrowserVisibleSnapshotPayload | null>;
  closeBrowserTabRecord: (tab: BrowserTabRecord) => void;
  focusBrowserTabInSpace: (
    workspaceId: string,
    tabSpace: BrowserTabSpaceState,
    tabId: string,
    space: BrowserSpaceId,
    sessionId?: string | null,
  ) => void;
  setActiveBrowserTab: (
    tabId: string,
    space?: BrowserSpaceId | null,
    sessionId?: string | null,
  ) => Promise<BrowserTabListPayload>;
  closeBrowserTab: (
    tabId: string,
    space?: BrowserSpaceId | null,
    sessionId?: string | null,
  ) => Promise<BrowserTabListPayload>;
  // ensureBrowserTabSpaceInitialized + initialBrowserTabSeed deferred —
  // they pull in oppositeBrowserSpaceId / browserTabSpaceStates / NEW_TAB_TITLE
  // which are still being threaded through. Move them in BP-P5b-4.
  getActiveBrowserTab: (
    workspaceId?: string | null,
    space?: BrowserSpaceId | null,
    sessionId?: string | null,
    options?: { useVisibleAgentSession?: boolean },
  ) => BrowserTabRecord | null;
  activeVisibleBrowserTarget: () => {
    workspaceId: string;
    space: BrowserSpaceId;
    sessionId: string | null;
  };
  currentBrowserTabPageTitle: (tab: BrowserTabRecord) => string;
  currentBrowserTabUrl: (tab: BrowserTabRecord) => string;
  applyBoundsToTab: (
    workspaceId: string,
    tabId: string,
    space?: BrowserSpaceId,
    sessionId?: string | null,
  ) => void;
  updateAttachedBrowserView: () => void;
  syncBrowserState: (
    workspaceId: string,
    tabId: string,
    space: BrowserSpaceId,
    sessionId?: string | null,
  ) => void;
  emitBrowserState: (
    workspaceId?: string | null,
    space?: BrowserSpaceId | null,
  ) => void;
  emitHistoryState: (workspaceId?: string | null) => void;
  recordHistoryVisit: (
    workspaceId: string,
    entry: Pick<BrowserHistoryEntryPayload, "url" | "title" | "faviconUrl">,
  ) => Promise<void>;
}

export function createBrowserPaneTabState(
  deps: BrowserPaneTabStateDeps,
): BrowserPaneTabState {
  function hasVisibleBounds(): boolean {
    const b = deps.getBrowserBounds();
    return b.width > 0 && b.height > 0;
  }

  function setBounds(bounds: BrowserBoundsPayload): void {
    deps.setBrowserBounds({
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    });

    const target = activeVisibleBrowserTarget();
    const activeTab = getActiveBrowserTab(
      target.workspaceId,
      target.space,
      target.sessionId,
      { useVisibleAgentSession: true },
    );
    if (!activeTab || !hasVisibleBounds()) {
      const win = deps.getMainWindow();
      win?.setBrowserView(null);
      deps.setAttachedView(null);
      return;
    }
    updateAttachedBrowserView();
  }

  async function captureVisibleSnapshot(): Promise<BrowserVisibleSnapshotPayload | null> {
    const target = activeVisibleBrowserTarget();
    const activeTab = getActiveBrowserTab(
      target.workspaceId,
      target.space,
      target.sessionId,
      { useVisibleAgentSession: true },
    );
    if (!activeTab || !hasVisibleBounds()) {
      return null;
    }
    const image = await activeTab.view.webContents.capturePage();
    return {
      bounds: { ...deps.getBrowserBounds() },
      dataUrl: `data:image/png;base64,${image.toPNG().toString("base64")}`,
    };
  }

  function getActiveBrowserTab(
    workspaceId?: string | null,
    space?: BrowserSpaceId | null,
    sessionId?: string | null,
    options?: { useVisibleAgentSession?: boolean },
  ): BrowserTabRecord | null {
    const browserSpace = deps.browserSpaceId(space);
    const workspace = deps.getWorkspaceOrEmpty(workspaceId);
    const tabSpace = deps.browserTabSpaceState(
      workspace,
      browserSpace,
      sessionId,
      options,
    );
    if (!tabSpace || !tabSpace.activeTabId) {
      return null;
    }
    return tabSpace.tabs.get(tabSpace.activeTabId) ?? null;
  }

  function activeVisibleBrowserTarget(): {
    workspaceId: string;
    space: BrowserSpaceId;
    sessionId: string | null;
  } {
    const space = deps.getActiveSpaceId();
    return {
      workspaceId: deps.getActiveWorkspaceId(),
      space,
      sessionId: space === "agent" ? deps.getActiveSessionId() : null,
    };
  }

  function currentBrowserTabPageTitle(tab: BrowserTabRecord): string {
    return tab.view.webContents.getTitle() || tab.state.title || "";
  }

  function currentBrowserTabUrl(tab: BrowserTabRecord): string {
    return tab.view.webContents.getURL() || tab.state.url || "";
  }

  function applyBoundsToTab(
    workspaceId: string,
    tabId: string,
    space: BrowserSpaceId = deps.getActiveSpaceId(),
    sessionId?: string | null,
  ): void {
    const workspace = deps.getWorkspace(workspaceId);
    const tab = deps.browserTabSpaceState(workspace, space, sessionId, {
      useVisibleAgentSession: !deps.browserSessionId(sessionId),
    })?.tabs.get(tabId);
    if (!tab) {
      return;
    }
    tab.view.setBounds(deps.getBrowserBounds());
  }

  function updateAttachedBrowserView(): void {
    const win = deps.getMainWindow();
    if (!win || win.isDestroyed()) {
      return;
    }
    const activeTab = getActiveBrowserTab(
      deps.getActiveWorkspaceId(),
      deps.getActiveSpaceId(),
      null,
      { useVisibleAgentSession: true },
    );
    if (!activeTab || !hasVisibleBounds()) {
      if (deps.getAttachedView()) {
        win.setBrowserView(null);
        deps.setAttachedView(null);
      }
      return;
    }
    if (deps.getAttachedView() !== activeTab.view) {
      deps.reserveMainWindowClosedListenerBudget(1);
      win.setBrowserView(activeTab.view);
      deps.setAttachedView(activeTab.view);
    }
    const space = deps.getActiveSpaceId();
    applyBoundsToTab(
      deps.getActiveWorkspaceId(),
      activeTab.state.id,
      space,
      space === "agent" ? deps.getActiveSessionId() : null,
    );
  }

  function emitBrowserState(
    workspaceId?: string | null,
    space?: BrowserSpaceId | null,
  ): void {
    const win = deps.getMainWindow();
    if (!win || win.isDestroyed()) {
      return;
    }
    const activeId = deps.getActiveWorkspaceId();
    const normalized =
      typeof workspaceId === "string" ? workspaceId.trim() : activeId;
    const browserSpace = deps.browserSpaceId(space);
    if (normalized !== activeId) {
      return;
    }
    if (browserSpace !== deps.getActiveSpaceId()) {
      return;
    }
    win.webContents.send(
      "browser:state",
      deps.browserWorkspaceSnapshot(normalized, browserSpace, null, {
        useVisibleAgentSession: true,
      }),
    );
  }

  function emitHistoryState(workspaceId?: string | null): void {
    const win = deps.getMainWindow();
    const activeId = deps.getActiveWorkspaceId();
    const normalized =
      typeof workspaceId === "string" ? workspaceId.trim() : activeId;
    if (!win || win.isDestroyed()) {
      if (!deps.hasOpenHistoryPopup()) {
        return;
      }
      return;
    }
    if (normalized !== activeId) {
      return;
    }
    const workspace = deps.getWorkspaceOrEmpty(normalized);
    const history = workspace?.history ?? [];
    win.webContents.send("browser:history", history);
    deps.sendHistoryToPopup(history);
  }

  function closeBrowserTabRecord(tab: BrowserTabRecord): void {
    tab.view.webContents.removeAllListeners();
    void (
      tab.view.webContents as unknown as { close?: () => void }
    ).close?.();
  }

  function focusBrowserTabInSpace(
    workspaceId: string,
    tabSpace: BrowserTabSpaceState,
    tabId: string,
    space: BrowserSpaceId,
    sessionId?: string | null,
  ): void {
    tabSpace.activeTabId = tabId;
    deps.browserTabSpaceTouch(tabSpace);
    if (space === "agent" && deps.browserSessionId(sessionId)) {
      deps.scheduleAgentSessionBrowserLifecycleCheck(workspaceId, sessionId);
    }
    if (
      workspaceId === deps.getActiveWorkspaceId() &&
      space === deps.getActiveSpaceId()
    ) {
      updateAttachedBrowserView();
    }
    emitBrowserState(workspaceId, space);
    void deps.persistWorkspace(workspaceId);
  }

  async function setActiveBrowserTab(
    tabId: string,
    space?: BrowserSpaceId | null,
    sessionId?: string | null,
  ): Promise<BrowserTabListPayload> {
    const browserSpace = deps.browserSpaceId(space);
    const normalizedSessionId =
      browserSpace === "agent"
        ? deps.browserSessionId(sessionId) ||
          deps.browserSessionId(deps.getActiveSessionId())
        : "";
    const workspace = await deps.ensureBrowserWorkspace(
      undefined,
      browserSpace,
      normalizedSessionId,
    );
    const tabSpace = deps.browserTabSpaceState(
      workspace,
      browserSpace,
      normalizedSessionId,
      { useVisibleAgentSession: !normalizedSessionId },
    );
    if (!workspace || !tabSpace || !tabSpace.tabs.has(tabId)) {
      return deps.browserWorkspaceSnapshot(
        undefined,
        browserSpace,
        normalizedSessionId,
        { useVisibleAgentSession: true },
      );
    }

    tabSpace.activeTabId = tabId;
    deps.browserTabSpaceTouch(tabSpace);
    if (browserSpace === "agent" && normalizedSessionId) {
      deps.setVisibleAgentBrowserSession(workspace, normalizedSessionId);
      deps.scheduleAgentSessionBrowserLifecycleCheck(
        workspace.workspaceId,
        normalizedSessionId,
      );
    }
    if (
      workspace.workspaceId === deps.getActiveWorkspaceId() &&
      browserSpace === deps.getActiveSpaceId()
    ) {
      updateAttachedBrowserView();
    }
    emitBrowserState(workspace.workspaceId, browserSpace);
    await deps.persistWorkspace(workspace.workspaceId);
    return deps.browserWorkspaceSnapshot(
      workspace.workspaceId,
      browserSpace,
      normalizedSessionId,
      { useVisibleAgentSession: true },
    );
  }

  async function closeBrowserTab(
    tabId: string,
    space?: BrowserSpaceId | null,
    sessionId?: string | null,
  ): Promise<BrowserTabListPayload> {
    const browserSpace = deps.browserSpaceId(space);
    const normalizedSessionId =
      browserSpace === "agent"
        ? deps.browserSessionId(sessionId) ||
          deps.browserSessionId(deps.getActiveSessionId())
        : "";
    const workspace = await deps.ensureBrowserWorkspace(
      undefined,
      browserSpace,
      normalizedSessionId,
    );
    const tabSpace = deps.browserTabSpaceState(
      workspace,
      browserSpace,
      normalizedSessionId,
      { useVisibleAgentSession: !normalizedSessionId },
    );
    const tab = tabSpace?.tabs.get(tabId);
    if (!workspace || !tabSpace || !tab) {
      return deps.browserWorkspaceSnapshot(
        undefined,
        browserSpace,
        normalizedSessionId,
        { useVisibleAgentSession: true },
      );
    }

    const tabIds = Array.from(tabSpace.tabs.keys());
    const closedIndex = tabIds.indexOf(tabId);
    tabSpace.tabs.delete(tabId);
    closeBrowserTabRecord(tab);
    deps.browserTabSpaceTouch(tabSpace);

    if (tabSpace.tabs.size === 0) {
      const replacementTabId = deps.createBrowserTab(workspace.workspaceId, {
        url: deps.homeUrl,
        browserSpace,
        sessionId: normalizedSessionId,
      });
      tabSpace.activeTabId = replacementTabId ?? "";
    } else if (tabSpace.activeTabId === tabId) {
      const remainingIds = Array.from(tabSpace.tabs.keys());
      tabSpace.activeTabId =
        remainingIds[Math.max(0, closedIndex - 1)] ?? remainingIds[0] ?? "";
    }

    if (
      workspace.workspaceId === deps.getActiveWorkspaceId() &&
      browserSpace === deps.getActiveSpaceId()
    ) {
      updateAttachedBrowserView();
    }
    if (browserSpace === "agent" && normalizedSessionId) {
      deps.scheduleAgentSessionBrowserLifecycleCheck(
        workspace.workspaceId,
        normalizedSessionId,
      );
    }
    emitBrowserState(workspace.workspaceId, browserSpace);
    await deps.persistWorkspace(workspace.workspaceId);
    return deps.browserWorkspaceSnapshot(
      workspace.workspaceId,
      browserSpace,
      normalizedSessionId,
      { useVisibleAgentSession: true },
    );
  }

  function syncBrowserState(
    workspaceId: string,
    tabId: string,
    space: BrowserSpaceId,
    sessionId?: string | null,
  ): void {
    const workspace = deps.getWorkspace(workspaceId);
    const tabSpace = deps.browserTabSpaceState(workspace, space, sessionId);
    const tab = tabSpace?.tabs.get(tabId);
    if (!workspace || !tab) {
      return;
    }
    if (tabSpace) {
      deps.browserTabSpaceTouch(tabSpace);
    }
    if (space === "agent" && deps.browserSessionId(sessionId)) {
      deps.scheduleAgentSessionBrowserLifecycleCheck(workspaceId, sessionId);
    }

    const viewContents: WebContents = tab.view.webContents;
    const updatedState: BrowserStatePayload = {
      ...tab.state,
      url: viewContents.getURL() || tab.state.url,
      title: viewContents.getTitle() || tab.state.title,
      faviconUrl: tab.state.faviconUrl,
      canGoBack: viewContents.navigationHistory.canGoBack(),
      canGoForward: viewContents.navigationHistory.canGoForward(),
    };
    tab.state = updatedState;
    emitBrowserState(workspaceId, space);
    void deps.persistWorkspace(workspaceId);
  }

  async function recordHistoryVisit(
    workspaceId: string,
    entry: Pick<BrowserHistoryEntryPayload, "url" | "title" | "faviconUrl">,
  ): Promise<void> {
    const workspace = deps.getWorkspace(workspaceId);
    const url = entry.url.trim();
    if (!workspace || !deps.shouldTrackHistoryUrl(url)) {
      return;
    }

    const now = new Date().toISOString();
    const existing = workspace.history.find((item) => item.url === url);

    if (existing) {
      workspace.history = workspace.history
        .map((item) =>
          item.id === existing.id
            ? {
                ...item,
                title: entry.title?.trim() || item.title || url,
                faviconUrl: entry.faviconUrl || item.faviconUrl,
                visitCount: item.visitCount + 1,
                lastVisitedAt: now,
              }
            : item,
        )
        .sort(
          (a, b) =>
            new Date(b.lastVisitedAt).getTime() -
            new Date(a.lastVisitedAt).getTime(),
        );
    } else {
      workspace.history = [
        {
          id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url,
          title: entry.title?.trim() || url,
          faviconUrl: entry.faviconUrl,
          visitCount: 1,
          createdAt: now,
          lastVisitedAt: now,
        },
        ...workspace.history,
      ]
        .sort(
          (a, b) =>
            new Date(b.lastVisitedAt).getTime() -
            new Date(a.lastVisitedAt).getTime(),
        )
        .slice(0, 500);
    }

    emitHistoryState(workspaceId);
    await deps.persistWorkspace(workspaceId);
  }

  return {
    hasVisibleBounds,
    setBounds,
    captureVisibleSnapshot,
    closeBrowserTabRecord,
    focusBrowserTabInSpace,
    setActiveBrowserTab,
    closeBrowserTab,
    getActiveBrowserTab,
    activeVisibleBrowserTarget,
    currentBrowserTabPageTitle,
    currentBrowserTabUrl,
    applyBoundsToTab,
    updateAttachedBrowserView,
    syncBrowserState,
    emitBrowserState,
    emitHistoryState,
    recordHistoryVisit,
  };
}
