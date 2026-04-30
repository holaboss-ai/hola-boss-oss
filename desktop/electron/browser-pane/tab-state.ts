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
import path from "node:path";

import {
  BrowserView,
  Menu,
  clipboard,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
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
  lifecycleState: "active" | "suspended" | null;
}

export interface BrowserSessionIdentity {
  userAgent: string;
  acceptLanguages: string;
}

export interface BrowserWorkspaceState {
  workspaceId: string;
  history: BrowserHistoryEntryPayload[];
  session: import("electron").Session;
  browserIdentity: BrowserSessionIdentity;
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

  /** Default URL to seed a new tab with when there's nothing else to land on. */
  homeUrl: string;

  /** P6 callback — keep an agent-session space alive (extends suspend timer). */
  touchAgentSessionBrowserSpace: (
    workspaceId: string,
    sessionId?: string | null,
  ) => void;

  /** Detect ERR_ABORTED-style load errors (utils). */
  isAbortedBrowserLoadError: (error: unknown) => boolean;

  /** Open a non-http(s) URL in the OS default browser (main owns this). */
  openExternalUrlFromMain: (url: string, reason: string) => void;

  /** Normalize a popup window's frame name for de-dup. (utils) */
  normalizeBrowserPopupFrameName: (frameName?: string | null) => string;

  /**
   * Window during which a window.open() with the same URL is treated as a
   * duplicate of an existing tab (and merged) rather than spawned anew.
   */
  duplicateBrowserPopupTabWindowMs: number;

  /** Queue a save-as override for an upcoming Electron download. */
  queueBrowserDownloadPrompt: (
    workspaceId: string,
    targetUrl: string,
    options: {
      defaultFilename: string;
      dialogTitle: string;
      buttonLabel: string;
    },
  ) => void;

  /** Compute a sanitized suggested filename from the right-click context. */
  browserContextSuggestedFilename: (context: ContextMenuParams) => string;

  /** Should `window.open()` for this URL spawn a real BrowserWindow popup? */
  shouldAllowBrowserPopupWindow: (
    url: string,
    frameName: string,
    features: string,
  ) => boolean;

  /** P6 callback — show user-vs-agent control prompt; returns true if input should be intercepted. */
  maybePromptBrowserInterrupt: (
    workspaceId: string,
    space: BrowserSpaceId,
    sessionId?: string | null,
  ) => boolean;

  /** Detect ERR_ABORTED-style did-fail-load events. */
  isAbortedBrowserLoadFailure: (
    errorCode: number,
    errorDescription: string,
  ) => boolean;

  /** Whether a webContents is currently being driven programmatically. */
  isProgrammaticBrowserInput: (
    webContents: import("electron").WebContents,
  ) => boolean;

  /** Directory containing the popup preload bundles (for spawned popup windows). */
  preloadDir: string;

  /** Title used for blank/new tabs. */
  newTabTitle: string;
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
  navigateActiveBrowserTab: (
    workspaceId: string,
    targetUrl: string,
    space?: BrowserSpaceId,
    sessionId?: string | null,
  ) => Promise<BrowserTabListPayload>;
  handleBrowserWindowOpenAsTab: (
    workspaceId: string,
    targetUrl: string,
    disposition: string,
    frameName: string,
    space: BrowserSpaceId,
    sessionId?: string | null,
  ) => void;
  showBrowserViewContextMenu: (params: {
    workspaceId: string;
    space: BrowserSpaceId;
    sessionId?: string | null;
    view: BrowserView;
    context: ContextMenuParams;
  }) => void;
  createBrowserTab: (
    workspaceId: string,
    options?: {
      browserSpace?: BrowserSpaceId;
      sessionId?: string | null;
      id?: string;
      url?: string;
      title?: string;
      faviconUrl?: string;
      popupFrameName?: string;
      popupOpenedAtMs?: number;
      skipInitialHistoryRecord?: boolean;
    },
  ) => string | null;
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

  function showBrowserViewContextMenu(params: {
    workspaceId: string;
    space: BrowserSpaceId;
    sessionId?: string | null;
    view: BrowserView;
    context: ContextMenuParams;
  }): void {
    const { workspaceId, space, sessionId, view, context } = params;
    const template: MenuItemConstructorOptions[] = [];
    const selectionText = context.selectionText.trim();
    const linkUrl = context.linkURL.trim();
    const canGoBack = view.webContents.navigationHistory.canGoBack();
    const canGoForward = view.webContents.navigationHistory.canGoForward();
    const bounds = deps.getBrowserBounds();
    const popupX = bounds.x + context.x;
    const popupY = bounds.y + context.y;
    const imageUrl = context.srcURL.trim();

    if (linkUrl) {
      template.push(
        {
          label: "Open Link in New Tab",
          click: () =>
            handleBrowserWindowOpenAsTab(
              workspaceId,
              linkUrl,
              "foreground-tab",
              "",
              space,
              sessionId,
            ),
        },
        {
          label: "Open Link Externally",
          click: () => {
            deps.openExternalUrlFromMain(linkUrl, "browser context menu");
          },
        },
        {
          label: "Copy Link Address",
          click: () => {
            clipboard.writeText(linkUrl);
          },
        },
        { type: "separator" },
      );
    }

    if (context.mediaType === "image" && imageUrl) {
      template.push(
        {
          label: "Open Image in New Tab",
          click: () =>
            handleBrowserWindowOpenAsTab(
              workspaceId,
              imageUrl,
              "foreground-tab",
              "",
              space,
              sessionId,
            ),
        },
        {
          label: "Copy Image Address",
          click: () => {
            clipboard.writeText(imageUrl);
          },
        },
        {
          label: "Save Image As...",
          click: () => {
            deps.queueBrowserDownloadPrompt(workspaceId, imageUrl, {
              defaultFilename: deps.browserContextSuggestedFilename(context),
              dialogTitle: "Save Image As",
              buttonLabel: "Save Image",
            });
            void view.webContents.downloadURL(imageUrl);
          },
        },
        { type: "separator" },
      );
    }

    if (context.isEditable) {
      template.push(
        { label: "Undo", role: "undo", enabled: context.editFlags.canUndo },
        { label: "Redo", role: "redo", enabled: context.editFlags.canRedo },
        { type: "separator" },
        { label: "Cut", role: "cut", enabled: context.editFlags.canCut },
        { label: "Copy", role: "copy", enabled: context.editFlags.canCopy },
        { label: "Paste", role: "paste", enabled: context.editFlags.canPaste },
        {
          label: "Select All",
          role: "selectAll",
          enabled: context.editFlags.canSelectAll,
        },
      );
    } else if (selectionText) {
      template.push(
        { label: "Copy", role: "copy", enabled: context.editFlags.canCopy },
        {
          label: "Select All",
          role: "selectAll",
          enabled: context.editFlags.canSelectAll,
        },
      );
    } else {
      template.push(
        {
          label: "Back",
          enabled: canGoBack,
          click: () => view.webContents.navigationHistory.goBack(),
        },
        {
          label: "Forward",
          enabled: canGoForward,
          click: () => view.webContents.navigationHistory.goForward(),
        },
        {
          label: "Reload",
          click: () => view.webContents.reload(),
        },
        {
          label: "Select All",
          role: "selectAll",
          enabled: context.editFlags.canSelectAll,
        },
      );
    }

    if (template.length === 0) {
      return;
    }

    const win = deps.getMainWindow();
    Menu.buildFromTemplate(template).popup({
      window: win ?? undefined,
      frame: context.frame ?? undefined,
      x: popupX,
      y: popupY,
      sourceType: context.menuSourceType,
    });
  }

  function handleBrowserWindowOpenAsTab(
    workspaceId: string,
    targetUrl: string,
    disposition: string,
    frameName: string,
    space: BrowserSpaceId,
    sessionId?: string | null,
  ): void {
    const normalizedUrl = targetUrl.trim();
    if (!normalizedUrl) {
      return;
    }

    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        deps.openExternalUrlFromMain(normalizedUrl, "browser tab creation");
        return;
      }
    } catch {
      return;
    }

    const workspace = deps.getWorkspace(workspaceId);
    const tabSpace = deps.browserTabSpaceState(workspace, space, sessionId, {
      createIfMissing: true,
    });
    if (!workspace || !tabSpace) {
      return;
    }

    const normalizedFrameName = deps.normalizeBrowserPopupFrameName(frameName);
    const now = Date.now();
    const existingPopupTab = Array.from(tabSpace.tabs.entries()).find(
      ([, tab]) =>
        (normalizedFrameName && tab.popupFrameName === normalizedFrameName) ||
        (!normalizedFrameName &&
          tab.state.url === normalizedUrl &&
          typeof tab.popupOpenedAtMs === "number" &&
          now - tab.popupOpenedAtMs <= deps.duplicateBrowserPopupTabWindowMs),
    );

    if (existingPopupTab) {
      const [existingTabId, existingTab] = existingPopupTab;
      existingTab.popupFrameName =
        normalizedFrameName || existingTab.popupFrameName;
      existingTab.popupOpenedAtMs = now;
      if (existingTab.state.url !== normalizedUrl) {
        existingTab.state = { ...existingTab.state, error: "" };
        void existingTab.view.webContents
          .loadURL(normalizedUrl)
          .catch((error: unknown) => {
            if (deps.isAbortedBrowserLoadError(error)) {
              return;
            }
            existingTab.state = {
              ...existingTab.state,
              loading: false,
              error:
                error instanceof Error ? error.message : "Failed to load URL.",
            };
            emitBrowserState(workspaceId, space);
            void deps.persistWorkspace(workspaceId);
          });
      }
      if (disposition !== "background-tab") {
        focusBrowserTabInSpace(
          workspaceId,
          tabSpace,
          existingTabId,
          space,
          sessionId,
        );
      }
      return;
    }

    const nextTabId = createBrowserTab(workspaceId, {
      url: normalizedUrl,
      browserSpace: space,
      sessionId,
      popupFrameName: normalizedFrameName,
      popupOpenedAtMs: now,
    });
    if (!nextTabId) {
      return;
    }

    if (disposition !== "background-tab") {
      focusBrowserTabInSpace(workspaceId, tabSpace, nextTabId, space, sessionId);
      return;
    }

    emitBrowserState(workspaceId, space);
    void deps.persistWorkspace(workspaceId);
  }

  async function navigateActiveBrowserTab(
    workspaceId: string,
    targetUrl: string,
    space: BrowserSpaceId = deps.getActiveSpaceId(),
    sessionId?: string | null,
  ): Promise<BrowserTabListPayload> {
    await deps.ensureBrowserWorkspace(workspaceId, space, sessionId);
    if (space === "agent" && deps.browserSessionId(sessionId)) {
      deps.touchAgentSessionBrowserSpace(workspaceId, sessionId);
    }
    const activeTab = getActiveBrowserTab(workspaceId, space, sessionId, {
      useVisibleAgentSession: !deps.browserSessionId(sessionId),
    });
    if (!activeTab) {
      throw new Error("No active browser tab is available.");
    }

    try {
      activeTab.state = { ...activeTab.state, error: "" };
      await activeTab.view.webContents.loadURL(targetUrl);
    } catch (error) {
      if (deps.isAbortedBrowserLoadError(error)) {
        return deps.browserWorkspaceSnapshot(workspaceId, space, sessionId, {
          useVisibleAgentSession: !deps.browserSessionId(sessionId),
        });
      }
      activeTab.state = {
        ...activeTab.state,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load URL.",
      };
      emitBrowserState(workspaceId, space);
      throw error;
    }

    return deps.browserWorkspaceSnapshot(workspaceId, space, sessionId, {
      useVisibleAgentSession: !deps.browserSessionId(sessionId),
    });
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
      const replacementTabId = createBrowserTab(workspace.workspaceId, {
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

  function createBrowserTab(
    workspaceId: string,
    options: {
      browserSpace?: BrowserSpaceId;
      sessionId?: string | null;
      id?: string;
      url?: string;
      title?: string;
      faviconUrl?: string;
      popupFrameName?: string;
      popupOpenedAtMs?: number;
      skipInitialHistoryRecord?: boolean;
    } = {},
  ): string | null {
    const workspace = deps.getWorkspace(workspaceId);
    const browserSpace = deps.browserSpaceId(options.browserSpace);
    const normalizedSessionId = deps.browserSessionId(options.sessionId);
    const tabSpace = deps.browserTabSpaceState(
      workspace,
      browserSpace,
      normalizedSessionId,
      { createIfMissing: Boolean(normalizedSessionId) },
    );
    const win = deps.getMainWindow();
    if (!win || !workspace || !tabSpace) {
      return null;
    }
    tabSpace.lifecycleState = "active";
    deps.browserTabSpaceTouch(tabSpace);

    const tabId =
      options.id?.trim() ||
      `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const initialUrl = options.url?.trim() || "";
    const hasInitialUrl = initialUrl.length > 0;
    let suppressNextHistoryEntry = Boolean(options.skipInitialHistoryRecord);
    const view = new BrowserView({
      webPreferences: {
        session: workspace.session,
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    view.webContents.setUserAgent(workspace.browserIdentity.userAgent);
    const state: BrowserStatePayload = {
      id: tabId,
      url: initialUrl,
      title: options.title || deps.newTabTitle,
      faviconUrl: options.faviconUrl,
      canGoBack: false,
      canGoForward: false,
      loading: false,
      initialized: !hasInitialUrl,
      error: "",
    };
    tabSpace.tabs.set(tabId, {
      view,
      state,
      popupFrameName: options.popupFrameName?.trim() || undefined,
      popupOpenedAtMs:
        typeof options.popupOpenedAtMs === "number"
          ? options.popupOpenedAtMs
          : undefined,
    });

    view.setBounds(deps.getBrowserBounds());
    view.setAutoResize({
      width: false,
      height: false,
      horizontal: false,
      vertical: false,
    });
    view.webContents.setWindowOpenHandler(
      ({ url, disposition, frameName, features }) => {
        const normalizedUrl = url.trim();
        if (!normalizedUrl) {
          return { action: "deny" };
        }

        if (deps.shouldAllowBrowserPopupWindow(normalizedUrl, frameName, features)) {
          return {
            action: "allow",
            overrideBrowserWindowOptions: {
              parent: deps.getMainWindow() ?? undefined,
              autoHideMenuBar: true,
              backgroundColor: "#050907",
              width: 520,
              height: 760,
              minWidth: 420,
              minHeight: 620,
              webPreferences: {
                session: workspace.session,
                preload: path.join(deps.preloadDir, "browserPopupPreload.cjs"),
              },
            },
          };
        }

        try {
          const parsed = new URL(normalizedUrl);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            deps.openExternalUrlFromMain(normalizedUrl, "browser window open");
            return { action: "deny" };
          }
        } catch {
          return { action: "deny" };
        }

        const shouldOpenAsTab =
          disposition === "foreground-tab" ||
          disposition === "background-tab" ||
          disposition === "new-window";
        if (shouldOpenAsTab) {
          handleBrowserWindowOpenAsTab(
            workspaceId,
            normalizedUrl,
            disposition,
            frameName,
            browserSpace,
            normalizedSessionId,
          );
        }
        return { action: "deny" };
      },
    );
    view.webContents.setZoomFactor(1);
    view.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);

    const currentTabRecord = () =>
      deps.browserTabSpaceState(
        deps.getWorkspace(workspaceId),
        browserSpace,
        normalizedSessionId,
      )?.tabs.get(tabId);

    view.webContents.on("before-input-event", (event, input) => {
      if (deps.isProgrammaticBrowserInput(view.webContents)) {
        return;
      }
      if (
        (input.type === "keyDown" ||
          input.type === "keyUp" ||
          input.type === "char" ||
          input.type === "rawKeyDown") &&
        deps.maybePromptBrowserInterrupt(
          workspaceId,
          browserSpace,
          normalizedSessionId,
        )
      ) {
        event.preventDefault();
      }
    });

    view.webContents.on("before-mouse-event", (event, mouse) => {
      if (deps.isProgrammaticBrowserInput(view.webContents)) {
        return;
      }
      if (
        mouse.type !== "mouseMove" &&
        mouse.type !== "mouseEnter" &&
        mouse.type !== "mouseLeave" &&
        deps.maybePromptBrowserInterrupt(
          workspaceId,
          browserSpace,
          normalizedSessionId,
        )
      ) {
        event.preventDefault();
      }
    });

    view.webContents.on("dom-ready", () => {
      const currentTab = currentTabRecord();
      if (!currentTab) {
        return;
      }
      currentTab.state = { ...currentTab.state, initialized: true, error: "" };
      syncBrowserState(workspaceId, tabId, browserSpace, normalizedSessionId);
    });

    view.webContents.on("did-start-loading", () => {
      const currentTab = currentTabRecord();
      if (!currentTab) {
        return;
      }
      currentTab.state = { ...currentTab.state, loading: true, error: "" };
      syncBrowserState(workspaceId, tabId, browserSpace, normalizedSessionId);
    });

    view.webContents.on("did-stop-loading", () => {
      const currentTab = currentTabRecord();
      if (!currentTab) {
        return;
      }
      currentTab.state = { ...currentTab.state, loading: false, error: "" };
      syncBrowserState(workspaceId, tabId, browserSpace, normalizedSessionId);
      if (suppressNextHistoryEntry) {
        suppressNextHistoryEntry = false;
        return;
      }
      void recordHistoryVisit(workspaceId, {
        url: currentTab.view.webContents.getURL() || currentTab.state.url,
        title: currentTab.view.webContents.getTitle() || currentTab.state.title,
        faviconUrl: currentTab.state.faviconUrl,
      });
    });

    view.webContents.on("page-title-updated", () => {
      syncBrowserState(workspaceId, tabId, browserSpace, normalizedSessionId);
    });

    view.webContents.on("page-favicon-updated", (_event, favicons) => {
      const currentTab = currentTabRecord();
      if (!currentTab) {
        return;
      }
      currentTab.state = {
        ...currentTab.state,
        faviconUrl: favicons[0] || currentTab.state.faviconUrl,
      };
      emitBrowserState(workspaceId, browserSpace);
      void deps.persistWorkspace(workspaceId);
    });

    view.webContents.on("did-navigate", () => {
      syncBrowserState(workspaceId, tabId, browserSpace, normalizedSessionId);
    });

    view.webContents.on("did-navigate-in-page", () => {
      syncBrowserState(workspaceId, tabId, browserSpace, normalizedSessionId);
    });

    view.webContents.on("context-menu", (_event, params) => {
      showBrowserViewContextMenu({
        workspaceId,
        space: browserSpace,
        sessionId: normalizedSessionId,
        view,
        context: params,
      });
    });

    view.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (
          !isMainFrame ||
          deps.isAbortedBrowserLoadFailure(errorCode, errorDescription)
        ) {
          return;
        }
        const currentTab = currentTabRecord();
        if (!currentTab) {
          return;
        }
        currentTab.state = {
          ...currentTab.state,
          loading: false,
          error: `${errorDescription} (${errorCode})`,
          url: validatedURL || currentTab.state.url,
        };
        emitBrowserState(workspaceId, browserSpace);
        void deps.persistWorkspace(workspaceId);
      },
    );

    if (hasInitialUrl) {
      void view.webContents.loadURL(initialUrl).catch((error: unknown) => {
        if (deps.isAbortedBrowserLoadError(error)) {
          return;
        }
        const currentTab = currentTabRecord();
        if (!currentTab) {
          return;
        }
        currentTab.state = {
          ...currentTab.state,
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load page.",
        };
        emitBrowserState(workspaceId, browserSpace);
        void deps.persistWorkspace(workspaceId);
      });
    }

    if (browserSpace === "agent" && normalizedSessionId) {
      deps.scheduleAgentSessionBrowserLifecycleCheck(
        workspaceId,
        normalizedSessionId,
      );
    }

    return tabId;
  }

  return {
    hasVisibleBounds,
    setBounds,
    captureVisibleSnapshot,
    closeBrowserTabRecord,
    focusBrowserTabInSpace,
    setActiveBrowserTab,
    closeBrowserTab,
    navigateActiveBrowserTab,
    handleBrowserWindowOpenAsTab,
    showBrowserViewContextMenu,
    createBrowserTab,
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
