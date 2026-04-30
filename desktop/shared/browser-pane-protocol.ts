/**
 * Wire types for the browser-pane subsystem. Shared between Electron main
 * and renderer (and the popup preload bundles) so the IPC contract has one
 * source of truth.
 *
 * Existing inline interfaces in `desktop/src/types/electron.d.ts` (declared
 * as ambient globals there: BrowserBoundsPayload, BrowserStatePayload, ...)
 * are gradually migrated into this module so they can be imported across
 * the main process side as well. For now we re-export the renderer-visible
 * ones from here as concrete types.
 */

export type BrowserSpaceId = "user" | "agent";

export interface BrowserBoundsPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserAnchorBoundsPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserStatePayload {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  initialized: boolean;
  error?: string | null;
}

export interface BrowserTabCountsPayload {
  user: number;
  agent: number;
}

export type BrowserTabLifecycleState =
  | "active"
  | "suspended"
  | "evicted"
  | "released";

export type BrowserControlMode = "user" | "agent" | "shared";

export interface BrowserTabListPayload {
  space: BrowserSpaceId;
  activeTabId: string;
  tabs: BrowserStatePayload[];
  tabCounts: BrowserTabCountsPayload;
  sessionId: string;
  lifecycleState: BrowserTabLifecycleState;
  controlMode: BrowserControlMode;
  controlSessionId: string | null;
}

export interface BrowserVisibleSnapshotPayload {
  bounds: BrowserBoundsPayload;
  dataUrl: string;
}

export interface BrowserBookmarkPayload {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  createdAt: string;
}

export interface BrowserDownloadPayload {
  id: string;
  url: string;
  filename: string;
  targetPath: string | null;
  status: "in_progress" | "completed" | "cancelled" | "failed";
  receivedBytes: number;
  totalBytes: number;
  createdAt: string;
  completedAt: string | null;
}

export interface BrowserHistoryEntryPayload {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  visitCount: number;
  createdAt: string;
  lastVisitedAt: string;
}

export interface BrowserClipboardScreenshotPayload {
  tabId: string;
  pageTitle: string;
  url: string;
  width: number;
  height: number;
  copied: boolean;
}

export interface AddressSuggestionPayload {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
}
