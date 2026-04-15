import "dotenv/config";
import * as Sentry from "@sentry/electron/main";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
});

import { electronClient } from "@better-auth/electron/client";
import { storage as electronAuthStorage } from "@better-auth/electron/storage";
import { createAuthClient } from "better-auth/client";
import Database from "better-sqlite3";
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from "electron-updater";
import {
  app,
  BrowserView,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  DownloadItem,
  ipcMain,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  nativeImage,
  screen,
  session,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type Session,
} from "electron";
import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomUUID,
} from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  type FSWatcher,
  watch,
  writeFileSync,
} from "node:fs";
import fs from "node:fs/promises";
import {
  createServer,
  request as httpRequest,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { URL } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  createMarketplaceSubmission as sdkCreateMarketplaceSubmission,
  deleteMarketplaceSubmission as sdkDeleteMarketplaceSubmission,
  finalizeMarketplaceSubmission as sdkFinalizeMarketplaceSubmission,
  generateMarketplaceTemplateContent as sdkGenerateMarketplaceTemplateContent,
  listMarketplaceAppTemplates as sdkListMarketplaceAppTemplates,
  listMarketplaceSubmissions as sdkListMarketplaceSubmissions,
  listMarketplaceTemplates as sdkListMarketplaceTemplates,
  materializeMarketplaceTemplate as sdkMaterializeMarketplaceTemplate,
} from "@holaboss/app-sdk/core";
import {
  type ModelCatalogInputModality,
} from "../shared/model-catalog.js";
import * as modelCatalog from "../shared/model-catalog.js";
import { buildAppSdkClient } from "./appSdkClient.js";
import { ensureWorkspaceGitRepo } from "./workspace-git.js";

const APP_DISPLAY_NAME = "Holaboss";
const AUTH_CALLBACK_PROTOCOL = "ai.holaboss.app";
const DESKTOP_LAUNCH_ID = randomUUID();
const verboseTelemetryEnabled =
  process.env.HOLABOSS_VERBOSE_TELEMETRY?.trim() === "1";
const chromiumStderrLoggingEnabled =
  process.env.HOLABOSS_CHROMIUM_STDERR_LOGS?.trim() === "1";
const HOME_URL = "https://www.google.com";
const NEW_TAB_TITLE = "New Tab";
const DOWNLOADS_POPUP_WIDTH = 360;
const DOWNLOADS_POPUP_HEIGHT = 340;
const HISTORY_POPUP_WIDTH = 420;
const HISTORY_POPUP_HEIGHT = 420;
const AUTH_POPUP_WIDTH = 380;
const AUTH_POPUP_HEIGHT = 460;
const AUTH_POPUP_CLOSE_DELAY_MS = 260;
const AUTH_POPUP_MARGIN_PX = 8;
const DUPLICATE_BROWSER_POPUP_TAB_WINDOW_MS = 2_000;
const OVERFLOW_POPUP_WIDTH = 220;
const OVERFLOW_POPUP_HEIGHT = 172;
const ADDRESS_SUGGESTIONS_POPUP_MIN_HEIGHT = 88;
const ADDRESS_SUGGESTIONS_POPUP_MAX_HEIGHT = 320;
const MAIN_WINDOW_CLOSED_LISTENER_BUFFER = 8;
const MAIN_WINDOW_MIN_LISTENER_BUDGET = 32;
const CHROME_HISTORY_IMPORT_LIMIT = 500;
const CHROME_COOKIE_SAFE_STORAGE_SERVICE_NAMES = [
  "Chrome Safe Storage",
  "Google Chrome Safe Storage",
];
const CHROME_COOKIE_SAFE_STORAGE_ACCOUNT_NAMES = [
  "Chrome",
  "Google Chrome",
];
const CHROME_COOKIE_PBKDF2_SALT = "saltysalt";
const CHROME_COOKIE_CBC_IV = Buffer.alloc(16, 0x20);
const CHROME_WINDOWS_DPAPI_KEY_PREFIX = "DPAPI";
const CHROME_WINDOWS_COOKIE_AEAD_PREFIXES = new Set(["v10", "v11"]);
const CHROME_WINDOWS_APP_BOUND_COOKIE_PREFIX = "v20";
const BROWSER_IMPORT_PROFILE_DIR_PATTERNS = [
  /^Default$/,
  /^Profile \d+$/,
  /^Profile [A-Za-z0-9_-]+$/,
  /^Guest Profile$/,
];
const SAFARI_EXPORT_BOOKMARKS_FILE_NAME = "bookmarks.html";
const SAFARI_EXPORT_HISTORY_FILE_NAME = "history.json";
const APP_THEMES = new Set([
  "holaboss",
  "emerald",
  "cobalt",
  "ember",
  "glacier",
  "mono",
  "sepia",
  "slate",
  "paper",
  "graphite",
]);
const GITHUB_RELEASES_OWNER = "holaboss-ai";
const GITHUB_RELEASES_REPO = "holaOS";
const APP_UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const APP_UPDATE_SUPPORTED_PLATFORMS = new Set(["darwin", "win32"]);
const LOCAL_OSS_TEMPLATE_USER_ID = "local-oss";
const HOLABOSS_HOME_URL = "https://www.holaboss.ai";
const HOLABOSS_DOCS_URL = `https://github.com/${GITHUB_RELEASES_OWNER}/${GITHUB_RELEASES_REPO}`;
const HOLABOSS_HELP_URL = `${HOLABOSS_DOCS_URL}/issues`;
const RUNTIME_PROVIDER_KIND_HOLABOSS_PROXY = "holaboss_proxy";
const RUNTIME_PROVIDER_KIND_OPENAI_COMPATIBLE = "openai_compatible";
const RUNTIME_PROVIDER_KIND_ANTHROPIC_NATIVE = "anthropic_native";
const RUNTIME_PROVIDER_KIND_OPENROUTER = "openrouter";
const RUNTIME_HOLABOSS_PROVIDER_ID = "holaboss_model_proxy";
const RUNTIME_HOLABOSS_PROVIDER_ALIASES = [
  "holaboss",
  RUNTIME_HOLABOSS_PROVIDER_ID,
] as const;
const RUNTIME_DEPRECATED_MODEL_IDS = new Set([
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex-max",
]);
const RUNTIME_LEGACY_DIRECT_PROVIDER_MODEL_ALIASES: Record<
  string,
  Record<string, string>
> = {
  anthropic_direct: {
    "claude-sonnet-4-5": "claude-sonnet-4-6",
  },
  gemini_direct: {
    "gemini-3.1-pro-preview": "gemini-2.5-pro",
    "gemini-2.5-flash-lite": "gemini-2.5-flash",
    "gemini-3.1-flash-lite-preview": "gemini-2.5-flash",
  },
};

interface DevLaunchContext {
  devServerUrl: string;
  userDataPath: string;
}

function maybeAuthCallbackUrl(argument: string | undefined): string | null {
  if (!argument) {
    return null;
  }
  const normalized = argument.trim();
  if (!normalized) {
    return null;
  }
  return normalized.startsWith(`${AUTH_CALLBACK_PROTOCOL}://`) ||
    normalized.startsWith(`${AUTH_CALLBACK_PROTOCOL}:/`)
    ? normalized
    : null;
}

function devLaunchContextPath(): string {
  return path.join(app.getPath("appData"), APP_DISPLAY_NAME, "dev-launch.json");
}

function loadRecoveredDevLaunchContext(): DevLaunchContext | null {
  const hasAuthCallbackArgument = process.argv.some((value) =>
    maybeAuthCallbackUrl(value),
  );
  if (!hasAuthCallbackArgument) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      readFileSync(devLaunchContextPath(), "utf8"),
    ) as Partial<DevLaunchContext>;
    const devServerUrl =
      typeof parsed.devServerUrl === "string" ? parsed.devServerUrl.trim() : "";
    const userDataPath =
      typeof parsed.userDataPath === "string" ? parsed.userDataPath.trim() : "";
    if (!devServerUrl || !userDataPath) {
      return null;
    }
    return {
      devServerUrl,
      userDataPath,
    };
  } catch {
    return null;
  }
}

const recoveredDevLaunchContext = loadRecoveredDevLaunchContext();
const RESOLVED_DEV_SERVER_URL =
  process.env.VITE_DEV_SERVER_URL?.trim() ||
  recoveredDevLaunchContext?.devServerUrl ||
  "";
const isDev = Boolean(RESOLVED_DEV_SERVER_URL);

function configureChromiumLoggingPolicy() {
  if (verboseTelemetryEnabled || chromiumStderrLoggingEnabled) {
    return;
  }

  delete process.env.ELECTRON_ENABLE_LOGGING;
  app.commandLine.appendSwitch("disable-logging");
  app.commandLine.appendSwitch("log-level", "3");
}

configureChromiumLoggingPolicy();

interface DirectoryEntryPayload {
  name: string;
  absolutePath: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

interface DirectoryPayload {
  currentPath: string;
  parentPath: string | null;
  entries: DirectoryEntryPayload[];
}

type FilePreviewKind = "text" | "image" | "pdf" | "table" | "unsupported";

interface FilePreviewTableSheetPayload {
  name: string;
  index: number;
  columns: string[];
  rows: string[][];
  totalRows: number;
  totalColumns: number;
  truncated: boolean;
  hasHeaderRow: boolean;
}

interface FilePreviewPayload {
  absolutePath: string;
  name: string;
  extension: string;
  kind: FilePreviewKind;
  mimeType?: string;
  content?: string;
  dataUrl?: string;
  tableSheets?: FilePreviewTableSheetPayload[];
  size: number;
  modifiedAt: string;
  isEditable: boolean;
  unsupportedReason?: string;
}

interface FileBookmarkPayload {
  id: string;
  targetPath: string;
  label: string;
  isDirectory: boolean;
  createdAt: string;
}

interface FileSystemMutationPayload {
  absolutePath: string;
}

type ExplorerExternalImportEntryPayload =
  | {
      kind: "directory";
      relativePath: string;
    }
  | {
      kind: "file";
      relativePath: string;
      content: Uint8Array;
    };

interface ExplorerExternalImportResultPayload {
  absolutePaths: string[];
}

type FileSystemCreateKind = "file" | "directory";

interface FilePreviewWatchSubscriptionPayload {
  subscriptionId: string;
  absolutePath: string;
}

interface FilePreviewChangePayload {
  absolutePath: string;
}

interface BrowserBoundsPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BrowserStatePayload {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  initialized: boolean;
  error: string;
}

const BROWSER_SPACE_IDS = ["user", "agent"] as const;

type BrowserSpaceId = (typeof BROWSER_SPACE_IDS)[number];

interface BrowserTabCountsPayload {
  user: number;
  agent: number;
}

interface BrowserTabListPayload {
  space: BrowserSpaceId;
  activeTabId: string;
  tabs: BrowserStatePayload[];
  tabCounts: BrowserTabCountsPayload;
}

type OperatorSurfaceType = "browser" | "editor" | "terminal" | "app_surface";
type OperatorSurfaceOwner = "user" | "agent";
type OperatorSurfaceMutability = "inspect_only" | "takeover_allowed" | "agent_owned";

interface OperatorSurfacePayload {
  surface_id: string;
  surface_type: OperatorSurfaceType;
  owner: OperatorSurfaceOwner;
  active: boolean;
  mutability: OperatorSurfaceMutability;
  summary: string;
}

interface OperatorSurfaceContextPayload {
  active_surface_id: string | null;
  surfaces: OperatorSurfacePayload[];
}

interface ReportedOperatorSurfaceContextPayload extends OperatorSurfaceContextPayload {
  updated_at: string;
}

interface BrowserTabRecord {
  view: BrowserView;
  state: BrowserStatePayload;
  popupFrameName?: string;
  popupOpenedAtMs?: number;
}

interface BrowserTabSpaceState {
  tabs: Map<string, BrowserTabRecord>;
  activeTabId: string;
}

interface BrowserWorkspaceTabPersistencePayload {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
}

interface BrowserWorkspaceTabSpacePersistencePayload {
  activeTabId: string;
  tabs: BrowserWorkspaceTabPersistencePayload[];
}

interface BrowserWorkspacePersistencePayload {
  activeTabId: string;
  tabs: BrowserWorkspaceTabPersistencePayload[];
  spaces?: Partial<
    Record<BrowserSpaceId, BrowserWorkspaceTabSpacePersistencePayload>
  >;
  bookmarks: BrowserBookmarkPayload[];
  downloads: BrowserDownloadPayload[];
  history: BrowserHistoryEntryPayload[];
}

interface BrowserWorkspaceState {
  workspaceId: string;
  partition: string;
  session: Session;
  browserIdentity: BrowserSessionIdentity;
  spaces: Record<BrowserSpaceId, BrowserTabSpaceState>;
  bookmarks: BrowserBookmarkPayload[];
  downloads: BrowserDownloadPayload[];
  history: BrowserHistoryEntryPayload[];
  downloadTrackingRegistered: boolean;
  pendingDownloadOverrides: BrowserDownloadOverride[];
}

interface BrowserDownloadOverride {
  url: string;
  defaultPath: string;
  dialogTitle: string;
  buttonLabel: string;
}

interface BrowserSessionIdentity {
  userAgent: string;
  acceptLanguages: string;
}

interface BrowserBookmarkPayload {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  createdAt: string;
}

type BrowserDownloadStatus =
  | "progressing"
  | "completed"
  | "cancelled"
  | "interrupted";

interface BrowserDownloadPayload {
  id: string;
  url: string;
  filename: string;
  targetPath: string;
  status: BrowserDownloadStatus;
  receivedBytes: number;
  totalBytes: number;
  createdAt: string;
  completedAt: string | null;
}

interface BrowserHistoryEntryPayload {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  visitCount: number;
  createdAt: string;
  lastVisitedAt: string;
}

type BrowserImportSource = "chrome" | "chromium" | "arc" | "safari";
type ChromiumFamilyBrowser = Exclude<BrowserImportSource, "safari">;

interface ChromiumProfileSelection {
  browser: ChromiumFamilyBrowser;
  userDataDir: string;
  profileId: string;
  profileDir: string;
  profileLabel: string;
}

interface ChromeBookmarkNodePayload {
  type?: string;
  name?: string;
  url?: string;
  date_added?: string;
  children?: ChromeBookmarkNodePayload[];
}

interface BrowserImportSummary {
  sourceKind: BrowserImportSource | "workspace_copy";
  sourceLabel: string;
  sourcePath: string;
  sourceProfileDir: string;
  sourceProfileLabel: string;
  importedBookmarks: number;
  importedHistoryEntries: number;
  importedCookies: number;
  skippedCookies: number;
  warnings: string[];
}

interface BrowserCookieImportSummary {
  importedCount: number;
  skippedCount: number;
  warnings: string[];
}

interface BrowserImportProfilePayload {
  workspaceId: string;
  source: BrowserImportSource;
  profileDir?: string | null;
  safariArchivePath?: string | null;
}

interface BrowserCopyWorkspaceProfilePayload {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
}

interface BrowserImportProfileOptionPayload {
  profileId: string;
  profileLabel: string;
  profileDir: string;
}

interface BrowserAnchorBoundsPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

type UiSettingsPaneSection =
  | "account"
  | "billing"
  | "providers"
  | "integrations"
  | "submissions"
  | "settings"
  | "automations"
  | "about";

interface AddressSuggestionPayload {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
}

type RuntimeStatus =
  | "disabled"
  | "missing"
  | "starting"
  | "running"
  | "stopped"
  | "error";

interface RuntimeStatusPayload {
  status: RuntimeStatus;
  available: boolean;
  runtimeRoot: string | null;
  sandboxRoot: string | null;
  executablePath: string | null;
  url: string | null;
  pid: number | null;
  harness: string | null;
  desktopBrowserReady: boolean;
  desktopBrowserUrl: string | null;
  lastError: string;
}

interface RuntimeConfigPayload {
  configPath: string | null;
  loadedFromFile: boolean;
  authTokenPresent: boolean;
  userId: string | null;
  sandboxId: string | null;
  modelProxyBaseUrl: string | null;
  defaultModel: string | null;
  defaultBackgroundModel: string | null;
  defaultEmbeddingModel: string | null;
  defaultImageModel: string | null;
  controlPlaneBaseUrl: string | null;
  catalogVersion: string | null;
  providerModelGroups: RuntimeProviderModelGroupPayload[];
}

interface RuntimeProviderModelPayload {
  token: string;
  modelId: string;
  label?: string;
  reasoning?: boolean;
  thinkingValues?: string[];
  defaultThinkingValue?: string | null;
  inputModalities?: ModelCatalogInputModality[];
  capabilities?: string[];
}

interface RuntimeProviderModelGroupPayload {
  providerId: string;
  providerLabel: string;
  kind: string;
  models: RuntimeProviderModelPayload[];
}

interface RuntimeConfigUpdatePayload {
  authToken?: string | null;
  modelProxyApiKey?: string | null;
  userId?: string | null;
  sandboxId?: string | null;
  modelProxyBaseUrl?: string | null;
  defaultModel?: string | null;
  defaultBackgroundModel?: string | null;
  defaultEmbeddingModel?: string | null;
  defaultImageModel?: string | null;
  controlPlaneBaseUrl?: string | null;
}

type RuntimeUserProfileNameSource = "manual" | "agent" | "authFallback";

interface RuntimeUserProfilePayload {
  profileId: string;
  name: string | null;
  nameSource: RuntimeUserProfileNameSource | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface RuntimeUserProfileUpdatePayload {
  profileId?: string | null;
  name?: string | null;
  nameSource?: RuntimeUserProfileNameSource | null;
}

interface AuthUserPayload {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  [key: string]: unknown;
}

interface AuthErrorPayload {
  message?: string;
  status: number;
  statusText: string;
  path: string;
}

type AppUpdateChannel = "latest" | "beta";

interface AppUpdatePreferencesPayload {
  dismissedVersion?: string | null;
  dismissedReleaseTag?: string | null;
  preferredChannel?: AppUpdateChannel | null;
}

interface AppUpdateStatusPayload {
  supported: boolean;
  checking: boolean;
  available: boolean;
  downloaded: boolean;
  downloadProgressPercent: number | null;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  dismissedVersion: string | null;
  lastCheckedAt: string | null;
  error: string;
  channel: AppUpdateChannel;
  preferredChannel: AppUpdateChannel | null;
}

interface DesktopWindowStatePayload {
  isFullScreen: boolean;
  isMaximized: boolean;
  isMinimized: boolean;
}
interface WorkbenchOpenBrowserPayload {
  workspaceId?: string | null;
  url?: string | null;
  space?: BrowserSpaceId | null;
}

let mainWindow: BrowserWindow | null = null;
let authPopupWindow: BrowserWindow | null = null;
let authPopupCloseTimer: ReturnType<typeof setTimeout> | null = null;
let downloadsPopupWindow: BrowserWindow | null = null;
let historyPopupWindow: BrowserWindow | null = null;
let overflowPopupWindow: BrowserWindow | null = null;
let addressSuggestionsPopupWindow: BrowserWindow | null = null;
let attachedBrowserTabView: BrowserView | null = null;
let attachedAppSurfaceView: BrowserView | null = null;
let currentTheme = "amber-minimal-light";
let browserBounds: BrowserBoundsPayload = { x: 0, y: 0, width: 0, height: 0 };
let overflowAnchorBounds: BrowserAnchorBoundsPayload | null = null;
let addressSuggestionsState: {
  suggestions: AddressSuggestionPayload[];
  selectedIndex: number;
} = {
  suggestions: [],
  selectedIndex: -1,
};
let activeBrowserWorkspaceId = "";
let activeBrowserSpaceId: BrowserSpaceId = "user";
const browserWorkspaces = new Map<string, BrowserWorkspaceState>();
const reportedOperatorSurfaceContexts = new Map<
  string,
  ReportedOperatorSurfaceContextPayload
>();
const browserDownloadTrackingPartitions = new Set<string>();
const appSurfaceViews = new Map<string, BrowserView>();
let appSurfaceBounds: BrowserBoundsPayload = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};
let activeAppSurfaceId: string | null = null;
let fileBookmarks: FileBookmarkPayload[] = [];
const filePreviewWatchSubscriptions = new Map<
  string,
  {
    absolutePath: string;
    watcher: FSWatcher;
  }
>();
let runtimeProcess: ChildProcessWithoutNullStreams | null = null;
const intentionallyStoppedRuntimeProcesses =
  new WeakSet<ChildProcessWithoutNullStreams>();
let appQuitCleanupPromise: Promise<void> | null = null;
let appQuitCleanupFinished = false;
let pendingAuthUser: AuthUserPayload | null = null;
let pendingAuthError: AuthErrorPayload | null = null;
let runtimeStatus: RuntimeStatusPayload = {
  status: "disabled",
  available: false,
  runtimeRoot: null,
  sandboxRoot: null,
  executablePath: null,
  url: null,
  pid: null,
  harness: null,
  desktopBrowserReady: false,
  desktopBrowserUrl: null,
  lastError: "",
};
let desktopBrowserServiceServer: HttpServer | null = null;
let desktopBrowserServiceUrl = "";
let desktopBrowserServiceAuthToken = "";
let appUpdateCheckTimer: NodeJS.Timeout | null = null;
let appUpdateCheckPromise: Promise<AppUpdateStatusPayload> | null = null;
let appUpdateEventsConfigured = false;
let appUpdatePreferences: AppUpdatePreferencesPayload = {};
let runtimeModelCatalogState: RuntimeModelCatalogPayload = {
  catalogVersion: null,
  defaultBackgroundModel: null,
  defaultEmbeddingModel: null,
  defaultImageModel: null,
  providerModelGroups: [],
  fetchedAt: null,
};
let runtimeModelCatalogRefreshPromise: Promise<void> | null = null;
let lastRuntimeModelCatalogRefreshAtMs = 0;
let lastRuntimeModelCatalogRefreshFailureAtMs = 0;
let appUpdateStatus: AppUpdateStatusPayload = {
  supported: false,
  checking: false,
  available: false,
  downloaded: false,
  downloadProgressPercent: null,
  currentVersion: normalizeReleaseVersion(app.getVersion()),
  latestVersion: null,
  releaseName: null,
  publishedAt: null,
  dismissedVersion: null,
  lastCheckedAt: null,
  error: "",
  channel: "latest",
  preferredChannel: null,
};

// Port 5060 is SIP — blocked by Node.js fetch (undici "bad port").
const RUNTIME_API_PORT_FALLBACK = 5160;
const RUNTIME_API_PORT_RANGE_START = 39160;
const RUNTIME_API_PORT_RANGE_SIZE = 2000;
let resolvedRuntimeApiPort = RUNTIME_API_PORT_FALLBACK;

function parseRuntimeApiPort(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    return null;
  }
  if (parsed === 5060) {
    return null;
  }
  return parsed;
}

function runtimeApiPortForUserDataPath(userDataPath: string): number {
  const hash = Number.parseInt(
    createHash("sha256")
      .update(path.resolve(userDataPath), "utf8")
      .digest("hex")
      .slice(0, 8),
    16,
  );
  return RUNTIME_API_PORT_RANGE_START + (hash % RUNTIME_API_PORT_RANGE_SIZE);
}

function resolveRuntimeApiPort(): number {
  const explicit = parseRuntimeApiPort(
    process.env.HOLABOSS_RUNTIME_API_PORT?.trim() || "",
  );
  if (explicit !== null) {
    return explicit;
  }
  return runtimeApiPortForUserDataPath(app.getPath("userData"));
}

function runtimeApiPort(): number {
  return resolvedRuntimeApiPort;
}

function runtimePlatformFromProcessPlatform(
  platform: NodeJS.Platform = process.platform,
): "macos" | "linux" | "windows" {
  switch (platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported host platform: ${platform}`);
  }
}

function runtimeBundleDirName(
  runtimePlatform:
    | "macos"
    | "linux"
    | "windows" = runtimePlatformFromProcessPlatform(),
): string {
  return `runtime-${runtimePlatform}`;
}

function runtimeBundleExecutableRelativePaths(
  runtimePlatform:
    | "macos"
    | "linux"
    | "windows" = runtimePlatformFromProcessPlatform(),
): string[] {
  const base = path.join("bin", "sandbox-runtime");
  return runtimePlatform === "windows"
    ? [`${base}.mjs`, `${base}.cmd`, `${base}.ps1`, `${base}.exe`, base]
    : [base];
}

function runtimeBundleNodeRelativePaths(
  runtimePlatform:
    | "macos"
    | "linux"
    | "windows" = runtimePlatformFromProcessPlatform(),
): string[] {
  const base = path.join("node-runtime", "node_modules", ".bin", "node");
  const packagedBin =
    runtimePlatform === "windows"
      ? path.join("node-runtime", "bin", "node.exe")
      : path.join("node-runtime", "node_modules", "node", "bin", "node");
  return runtimePlatform === "windows"
    ? [packagedBin, `${base}.exe`, `${base}.cmd`, base]
    : [packagedBin, base];
}

function runtimeBundleNpmRelativePaths(
  runtimePlatform:
    | "macos"
    | "linux"
    | "windows" = runtimePlatformFromProcessPlatform(),
): string[] {
  const base = path.join("node-runtime", "node_modules", ".bin", "npm");
  return runtimePlatform === "windows"
    ? [
        path.join("node-runtime", "bin", "npm.cmd"),
        path.join("node-runtime", "bin", "npm"),
        `${base}.cmd`,
        base,
        path.join("node-runtime", "node_modules", "npm", "bin", "npm-cli.js"),
      ]
    : [
        base,
        path.join("node-runtime", "node_modules", "npm", "bin", "npm-cli.js"),
      ];
}

function runtimeBundlePythonRelativePaths(
  runtimePlatform:
    | "macos"
    | "linux"
    | "windows" = runtimePlatformFromProcessPlatform(),
): string[] {
  const base = path.join("python-runtime", "bin", "python");
  return runtimePlatform === "windows"
    ? [
        `${base}.cmd`,
        path.join("python-runtime", "python", "python.exe"),
        path.join("python-runtime", "python", "python3.exe"),
      ]
    : [base];
}

const CURRENT_RUNTIME_PLATFORM = runtimePlatformFromProcessPlatform();
const RUNTIME_BUNDLE_DIR = runtimeBundleDirName(CURRENT_RUNTIME_PLATFORM);
const DEV_RUNTIME_ROOT =
  process.env.HOLABOSS_DEV_RUNTIME_ROOT?.trim() ||
  path.join(os.tmpdir(), `holaboss-runtime-${CURRENT_RUNTIME_PLATFORM}-full`);
const DESKTOP_USER_DATA_DIR = (
  process.env.HOLABOSS_DESKTOP_USER_DATA_DIR?.trim() || "holaboss-local"
).replace(/[\\/]+/g, "_");
const normalizeBaseUrl = (value: string): string =>
  value.trim().replace(/\/+$/, "");
interface PackagedDesktopConfig {
  authBaseUrl?: string;
  authSignInUrl?: string;
  backendBaseUrl?: string;
  desktopControlPlaneBaseUrl?: string;
  projectsUrl?: string;
  marketplaceUrl?: string;
  proactiveUrl?: string;
  appUpdateEnabled?: boolean;
  updateChannel?: string;
}

interface RuntimeLaunchSpec {
  command: string;
  args: string[];
}

function loadPackagedDesktopConfig(): PackagedDesktopConfig {
  if (!app.isPackaged) {
    return {};
  }

  const configPath = path.join(process.resourcesPath, "holaboss-config.json");
  try {
    if (!existsSync(configPath)) {
      return {};
    }
    return JSON.parse(
      readFileSync(configPath, "utf8"),
    ) as PackagedDesktopConfig;
  } catch {
    return {};
  }
}

const packagedDesktopConfig = loadPackagedDesktopConfig();

function normalizeAppUpdateChannel(
  value: string | null | undefined,
): AppUpdateChannel | null {
  const normalized = value?.trim().toLowerCase() || "";
  if (!normalized) {
    return null;
  }
  if (normalized === "latest") {
    return "latest";
  }
  if (normalized === "beta") {
    return "beta";
  }
  return null;
}

const DEFAULT_APP_UPDATE_CHANNEL =
  normalizeAppUpdateChannel(packagedDesktopConfig.updateChannel) ?? "latest";

function preferredAppUpdateChannel(): AppUpdateChannel | null {
  return normalizeAppUpdateChannel(appUpdatePreferences.preferredChannel);
}

function effectiveAppUpdateChannel(): AppUpdateChannel {
  return (
    normalizeAppUpdateChannel(process.env.HOLABOSS_APP_UPDATE_CHANNEL) ??
    preferredAppUpdateChannel() ??
    DEFAULT_APP_UPDATE_CHANNEL
  );
}

function syncAppUpdateChannelState() {
  appUpdateStatus = {
    ...appUpdateStatus,
    channel: effectiveAppUpdateChannel(),
    preferredChannel: preferredAppUpdateChannel(),
  };
}
const INTERNAL_DEV_BACKEND_OVERRIDES_ENABLED =
  Boolean(RESOLVED_DEV_SERVER_URL) ||
  process.env.HOLABOSS_INTERNAL_DEV?.trim() === "1";
function internalOverride(envName: string): string {
  if (!INTERNAL_DEV_BACKEND_OVERRIDES_ENABLED) {
    return "";
  }
  return process.env[envName]?.trim() || "";
}
function publicRuntimeEnv(envName: string): string {
  return process.env[envName]?.trim() || "";
}
function configuredRemoteBaseUrl(
  envNames: string[],
  packagedValue?: string,
): string {
  for (const envName of envNames) {
    const value = normalizeBaseUrl(
      internalOverride(envName) || publicRuntimeEnv(envName),
    );
    if (value) {
      return value;
    }
  }
  if (packagedValue) {
    return normalizeBaseUrl(packagedValue);
  }
  return "";
}
const AUTH_BASE_URL = configuredRemoteBaseUrl(
  ["HOLABOSS_AUTH_BASE_URL"],
  packagedDesktopConfig.authBaseUrl,
);
const BACKEND_BASE_URL = configuredRemoteBaseUrl(
  ["HOLABOSS_BACKEND_BASE_URL"],
  packagedDesktopConfig.backendBaseUrl,
);
const DESKTOP_CONTROL_PLANE_BASE_URL =
  serviceBaseUrlFromControlPlane(BACKEND_BASE_URL, 3060) ||
  configuredRemoteBaseUrl(
    ["HOLABOSS_DESKTOP_CONTROL_PLANE_BASE_URL"],
    packagedDesktopConfig.desktopControlPlaneBaseUrl,
  );
const AUTH_SIGN_IN_URL = configuredRemoteBaseUrl(
  ["HOLABOSS_AUTH_SIGN_IN_URL"],
  packagedDesktopConfig.authSignInUrl,
);
const DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH =
  "/api/v1/desktop-runtime/bindings/exchange";
const DESKTOP_RUNTIME_MODEL_CATALOG_PATH =
  "/api/v1/desktop-runtime/model-catalog";
const LOCAL_RUNTIME_SCHEMA_VERSION = 1;
const RUNTIME_BINDING_REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const RUNTIME_BINDING_REFRESH_FAILURE_BACKOFF_MS = 60 * 1000;
const RUNTIME_MODEL_CATALOG_REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const RUNTIME_MODEL_CATALOG_REFRESH_FAILURE_BACKOFF_MS = 60 * 1000;
const RUNTIME_MODEL_CATALOG_FETCH_TIMEOUT_MS = 8_000;

type TrustedIpcSenderScope = "main" | "auth-popup";

function trustedIpcSenderWindow(
  scope: TrustedIpcSenderScope,
): BrowserWindow | null {
  if (scope === "main") {
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  }
  return authPopupWindow && !authPopupWindow.isDestroyed()
    ? authPopupWindow
    : null;
}

function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  channel: string,
  allowedScopes: TrustedIpcSenderScope[],
) {
  const sender = event.sender;
  const allowed = allowedScopes.some((scope) => {
    const allowedWindow = trustedIpcSenderWindow(scope);
    return Boolean(allowedWindow && allowedWindow.webContents === sender);
  });
  if (!allowed) {
    throw new Error(`Unauthorized IPC sender for ${channel}.`);
  }
}

function handleTrustedIpc<Args extends unknown[], Result>(
  channel: string,
  allowedScopes: TrustedIpcSenderScope[],
  handler: (
    event: IpcMainInvokeEvent,
    ...args: Args
  ) => Result | Promise<Result>,
) {
  ipcMain.handle(channel, (event, ...args: Args) => {
    assertTrustedIpcSender(event, channel, allowedScopes);
    return handler(event, ...args);
  });
}

// Allowed characters for ids that originate from the renderer and end up
// being interpolated into URLs, file paths, or SQL bind parameters in the
// embedded runtime. Conservative on purpose: alnum, dash, underscore, dot.
// We reject path separators, whitespace, control chars, and anything that
// could break out of an URL path segment. These are NOT user-facing labels;
// they are workspace UUIDs and slug-style app ids.
const SAFE_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertSafeId(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${fieldName}: must not be empty`);
  }
  if (!SAFE_ID_REGEX.test(trimmed)) {
    throw new Error(
      `Invalid ${fieldName}: must match /[A-Za-z0-9._-]{1,128}/`,
    );
  }
  return trimmed;
}

function assertSafeWorkspaceId(value: unknown): string {
  return assertSafeId(value, "workspaceId");
}

function assertSafeAppId(value: unknown): string {
  return assertSafeId(value, "appId");
}

function configureStableUserDataPath() {
  const explicit =
    process.env.HOLABOSS_DESKTOP_USER_DATA_PATH?.trim() ||
    recoveredDevLaunchContext?.userDataPath?.trim() ||
    "";
  const nextUserDataPath = explicit
    ? path.resolve(explicit)
    : path.join(app.getPath("appData"), DESKTOP_USER_DATA_DIR);
  mkdirSync(nextUserDataPath, { recursive: true });
  if (app.getPath("userData") !== nextUserDataPath) {
    app.setPath("userData", nextUserDataPath);
  }
}

function persistDevLaunchContext() {
  if (!RESOLVED_DEV_SERVER_URL) {
    return;
  }

  const nextContext: DevLaunchContext = {
    devServerUrl: RESOLVED_DEV_SERVER_URL,
    userDataPath: app.getPath("userData"),
  };
  const targetPath = devLaunchContextPath();
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(nextContext, null, 2));
}

function appUpdatePreferencesPath() {
  return path.join(app.getPath("userData"), "app-update-preferences.json");
}

function loadAppUpdatePreferences(): AppUpdatePreferencesPayload {
  const preferencesPath = appUpdatePreferencesPath();
  try {
    if (!existsSync(preferencesPath)) {
      return {};
    }
    const parsed = JSON.parse(
      readFileSync(preferencesPath, "utf8"),
    ) as AppUpdatePreferencesPayload;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function loadRuntimeModelCatalogCache(): RuntimeModelCatalogPayload {
  const cachePath = runtimeModelCatalogCachePath();
  try {
    if (!existsSync(cachePath)) {
      return {
        catalogVersion: null,
        defaultBackgroundModel: null,
        defaultEmbeddingModel: null,
        defaultImageModel: null,
        providerModelGroups: [],
        fetchedAt: null,
      };
    }
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as unknown;
    const payload = runtimeConfigObject(parsed);
    return {
      catalogVersion:
        runtimeConfigField(payload.catalogVersion as string | undefined) ||
        runtimeConfigField(payload.catalog_version as string | undefined) ||
        null,
      defaultBackgroundModel:
        normalizeRuntimeHolabossCatalogDefaultModelId(
          runtimeFirstNonEmptyString(
            payload.defaultBackgroundModel as string | undefined,
            payload.default_background_model as string | undefined,
          ),
        ) || null,
      defaultEmbeddingModel:
        normalizeRuntimeHolabossCatalogDefaultModelId(
          runtimeFirstNonEmptyString(
            payload.defaultEmbeddingModel as string | undefined,
            payload.default_embedding_model as string | undefined,
          ),
        ) || null,
      defaultImageModel:
        normalizeRuntimeHolabossCatalogDefaultModelId(
          runtimeFirstNonEmptyString(
            payload.defaultImageModel as string | undefined,
            payload.default_image_model as string | undefined,
          ),
        ) || null,
      providerModelGroups: normalizeRuntimeProviderModelGroups(
        Array.isArray(payload.providerModelGroups)
          ? payload.providerModelGroups
          : Array.isArray(payload.provider_model_groups)
            ? payload.provider_model_groups
            : [],
      ),
      fetchedAt:
        runtimeConfigField(payload.fetchedAt as string | undefined) || null,
    };
  } catch {
    return {
      catalogVersion: null,
      defaultBackgroundModel: null,
      defaultEmbeddingModel: null,
      defaultImageModel: null,
      providerModelGroups: [],
      fetchedAt: null,
    };
  }
}

async function persistAppUpdatePreferences() {
  await fs.mkdir(path.dirname(appUpdatePreferencesPath()), { recursive: true });
  await fs.writeFile(
    appUpdatePreferencesPath(),
    `${JSON.stringify(appUpdatePreferences, null, 2)}\n`,
    "utf8",
  );
}

function serviceBaseUrlFromControlPlane(
  controlPlaneBaseUrl: string,
  port: number,
): string {
  try {
    const parsed = new URL(controlPlaneBaseUrl);
    const protocol = parsed.protocol || "http:";
    const hostname = parsed.hostname;
    if (!hostname) {
      return "";
    }
    return `${protocol}//${hostname}:${port}`;
  } catch {
    return "";
  }
}

function emitAppUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("appUpdate:state", appUpdateStatus);
}

function emitWorkbenchOpenBrowser(payload?: WorkbenchOpenBrowserPayload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("workbench:openBrowser", payload ?? {});
}

function emitThemeChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("ui:themeChanged", currentTheme);
  }
  if (authPopupWindow && !authPopupWindow.isDestroyed()) {
    authPopupWindow.webContents.send("ui:themeChanged", currentTheme);
  }
}

function normalizeReleaseVersion(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const match = trimmed.match(/(\d+\.\d+\.\d+)$/);
  return match ? match[1] : trimmed;
}

function currentAppVersion() {
  return normalizeReleaseVersion(app.getVersion());
}

function isReleaseStyleAppVersion(version: string) {
  return /^\d{4}\.\d+\.\d+$/.test(version.trim());
}

function currentDesktopReleaseTag() {
  const version = currentAppVersion();
  return version ? `holaboss-desktop-${version}` : "";
}

function appUpdateSupported() {
  if (!app.isPackaged || !APP_UPDATE_SUPPORTED_PLATFORMS.has(process.platform)) {
    return false;
  }

  if (typeof packagedDesktopConfig.appUpdateEnabled === "boolean") {
    return packagedDesktopConfig.appUpdateEnabled;
  }

  return isReleaseStyleAppVersion(currentAppVersion());
}

function dismissedAppUpdateVersion() {
  const dismissedVersion = normalizeReleaseVersion(
    appUpdatePreferences.dismissedVersion?.trim() ||
      appUpdatePreferences.dismissedReleaseTag?.trim() ||
      "",
  );
  return dismissedVersion || null;
}

function releaseNameFromUpdateInfo(info: UpdateInfo) {
  const releaseName =
    typeof info.releaseName === "string" ? info.releaseName.trim() : "";
  return releaseName || null;
}

function publishedAtFromUpdateInfo(info: UpdateInfo) {
  const publishedAt =
    typeof info.releaseDate === "string" ? info.releaseDate.trim() : "";
  return publishedAt || null;
}

function latestVersionFromUpdateInfo(info: UpdateInfo) {
  const latestVersion = normalizeReleaseVersion(info.version ?? "");
  return latestVersion || null;
}

function nextAppUpdateTimestamp() {
  return new Date().toISOString();
}

function applyAppUpdateInfo(
  info: UpdateInfo,
  overrides: Partial<AppUpdateStatusPayload> = {},
) {
  appUpdateStatus = {
    ...appUpdateStatus,
    supported: appUpdateSupported(),
    checking: false,
    currentVersion: currentAppVersion(),
    latestVersion: latestVersionFromUpdateInfo(info),
    releaseName: releaseNameFromUpdateInfo(info),
    publishedAt: publishedAtFromUpdateInfo(info),
    dismissedVersion: dismissedAppUpdateVersion(),
    lastCheckedAt: nextAppUpdateTimestamp(),
    error: "",
    ...overrides,
  };
}

function applyUnsupportedAppUpdateStatus() {
  appUpdateStatus = {
    ...appUpdateStatus,
    supported: false,
    checking: false,
    available: false,
    downloaded: false,
    downloadProgressPercent: null,
    currentVersion: currentAppVersion(),
    latestVersion: null,
    releaseName: null,
    publishedAt: null,
    dismissedVersion: dismissedAppUpdateVersion(),
    lastCheckedAt: nextAppUpdateTimestamp(),
    error: "",
  };
}

function clampDownloadProgressPercent(progress: ProgressInfo) {
  if (!Number.isFinite(progress.percent)) {
    return null;
  }
  return Math.max(0, Math.min(100, progress.percent));
}

function applyAutoUpdaterChannelConfiguration() {
  const channel = effectiveAppUpdateChannel();
  autoUpdater.allowPrerelease = channel === "beta";
  autoUpdater.channel = channel;
  syncAppUpdateChannelState();
}

function configureAutoUpdater() {
  if (!appUpdateSupported() || appUpdateEventsConfigured) {
    return;
  }

  appUpdateEventsConfigured = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  applyAutoUpdaterChannelConfiguration();

  autoUpdater.on("checking-for-update", () => {
    appUpdateStatus = {
      ...appUpdateStatus,
      supported: true,
      checking: true,
      available: false,
      downloaded: false,
      downloadProgressPercent: null,
      currentVersion: currentAppVersion(),
      dismissedVersion: dismissedAppUpdateVersion(),
      error: "",
    };
    emitAppUpdateState();
  });

  autoUpdater.on("update-available", (info) => {
    const latestVersion = latestVersionFromUpdateInfo(info);
    const dismissedVersion = dismissedAppUpdateVersion();
    applyAppUpdateInfo(info, {
      available: Boolean(latestVersion && dismissedVersion !== latestVersion),
      downloaded: false,
      downloadProgressPercent: 0,
    });
    emitAppUpdateState();
  });

  autoUpdater.on("download-progress", (progress) => {
    appUpdateStatus = {
      ...appUpdateStatus,
      checking: false,
      downloadProgressPercent: clampDownloadProgressPercent(progress),
      lastCheckedAt: nextAppUpdateTimestamp(),
      error: "",
    };
    emitAppUpdateState();
  });

  autoUpdater.on("update-downloaded", (info) => {
    applyAppUpdateInfo(info, {
      available: false,
      downloaded: true,
      downloadProgressPercent: 100,
    });
    emitAppUpdateState();
  });

  autoUpdater.on("update-not-available", (info) => {
    applyAppUpdateInfo(info, {
      available: false,
      downloaded: false,
      downloadProgressPercent: null,
    });
    emitAppUpdateState();
  });

  autoUpdater.on("error", (error) => {
    appUpdateStatus = {
      ...appUpdateStatus,
      supported: appUpdateSupported(),
      checking: false,
      available: false,
      downloadProgressPercent: null,
      currentVersion: currentAppVersion(),
      dismissedVersion: dismissedAppUpdateVersion(),
      lastCheckedAt: nextAppUpdateTimestamp(),
      error:
        error instanceof Error ? error.message : "Failed to check for updates.",
    };
    emitAppUpdateState();
  });
}

async function checkForAppUpdates(): Promise<AppUpdateStatusPayload> {
  if (!appUpdateSupported()) {
    applyUnsupportedAppUpdateStatus();
    emitAppUpdateState();
    return appUpdateStatus;
  }

  if (appUpdateStatus.downloaded) {
    return appUpdateStatus;
  }

  if (appUpdateCheckPromise) {
    return appUpdateCheckPromise;
  }

  configureAutoUpdater();
  appUpdateStatus = {
    ...appUpdateStatus,
    supported: true,
    checking: true,
    currentVersion: currentAppVersion(),
    dismissedVersion: dismissedAppUpdateVersion(),
    error: "",
  };
  emitAppUpdateState();

  appUpdateCheckPromise = (async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      appUpdateStatus = {
        ...appUpdateStatus,
        supported: true,
        checking: false,
        available: false,
        downloadProgressPercent: null,
        currentVersion: currentAppVersion(),
        dismissedVersion: dismissedAppUpdateVersion(),
        lastCheckedAt: nextAppUpdateTimestamp(),
        error:
          error instanceof Error
            ? error.message
            : "Failed to check for updates.",
      };
    } finally {
      emitAppUpdateState();
      appUpdateCheckPromise = null;
    }

    return appUpdateStatus;
  })();

  return appUpdateCheckPromise;
}

function scheduleAppUpdateChecks() {
  if (!appUpdateSupported() || appUpdateCheckTimer) {
    return;
  }

  appUpdateCheckTimer = setInterval(() => {
    void checkForAppUpdates();
  }, APP_UPDATE_CHECK_INTERVAL_MS);
  appUpdateCheckTimer.unref();
}

async function dismissAppUpdate(
  version?: string | null,
): Promise<AppUpdateStatusPayload> {
  const nextDismissedVersion =
    normalizeReleaseVersion(
      version?.trim() || appUpdateStatus.latestVersion || "",
    ) || null;
  if (!nextDismissedVersion) {
    return appUpdateStatus;
  }

  appUpdatePreferences = {
    ...appUpdatePreferences,
    dismissedVersion: nextDismissedVersion,
    dismissedReleaseTag: nextDismissedVersion,
  };
  await persistAppUpdatePreferences();

  const dismissesCurrentVersion =
    appUpdateStatus.latestVersion === nextDismissedVersion;
  appUpdateStatus = {
    ...appUpdateStatus,
    available: dismissesCurrentVersion ? false : appUpdateStatus.available,
    downloaded: dismissesCurrentVersion ? false : appUpdateStatus.downloaded,
    downloadProgressPercent: dismissesCurrentVersion
      ? null
      : appUpdateStatus.downloadProgressPercent,
    dismissedVersion: nextDismissedVersion,
  };
  emitAppUpdateState();
  return appUpdateStatus;
}

async function setAppUpdateChannel(
  channel: AppUpdateChannel,
): Promise<AppUpdateStatusPayload> {
  const nextChannel = normalizeAppUpdateChannel(channel);
  if (!nextChannel) {
    throw new Error("Unsupported app update channel.");
  }

  const previousEffectiveChannel = effectiveAppUpdateChannel();
  const previousPreferredChannel = preferredAppUpdateChannel();
  appUpdatePreferences = {
    ...appUpdatePreferences,
    preferredChannel: nextChannel,
  };
  await persistAppUpdatePreferences();
  syncAppUpdateChannelState();

  const effectiveChannelChanged =
    effectiveAppUpdateChannel() !== previousEffectiveChannel;
  const preferredChannelChanged = previousPreferredChannel !== nextChannel;
  if (!appUpdateSupported() || (!effectiveChannelChanged && !preferredChannelChanged)) {
    emitAppUpdateState();
    return appUpdateStatus;
  }

  configureAutoUpdater();
  applyAutoUpdaterChannelConfiguration();
  appUpdateStatus = {
    ...appUpdateStatus,
    checking: false,
    available: false,
    downloaded: false,
    downloadProgressPercent: null,
    latestVersion: null,
    releaseName: null,
    publishedAt: null,
    lastCheckedAt: null,
    error: "",
    currentVersion: currentAppVersion(),
    dismissedVersion: dismissedAppUpdateVersion(),
  };
  emitAppUpdateState();
  return checkForAppUpdates();
}

function installAppUpdateNow() {
  if (!appUpdateSupported()) {
    throw new Error("In-app updates are unavailable on this build.");
  }
  if (!appUpdateStatus.downloaded) {
    throw new Error("No downloaded update is ready to install.");
  }
  // Treat the toast action as an immediate in-place restart, not a manual installer flow.
  autoUpdater.quitAndInstall(true, true);
}

async function openExternalUrl(rawUrl: string): Promise<void> {
  const normalizedUrl = rawUrl.trim();
  if (!normalizedUrl) {
    throw new Error("No external URL was provided.");
  }

  const parsed = new URL(normalizedUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }

  await shell.openExternal(parsed.toString());
}

function emitOpenSettingsPane(section: UiSettingsPaneSection = "settings") {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("ui:openSettingsPane", section);
}

configureStableUserDataPath();
resolvedRuntimeApiPort = resolveRuntimeApiPort();
persistDevLaunchContext();
appUpdatePreferences = loadAppUpdatePreferences();
runtimeModelCatalogState = loadRuntimeModelCatalogCache();
appUpdateStatus = {
  ...appUpdateStatus,
  supported: appUpdateSupported(),
  dismissedVersion: dismissedAppUpdateVersion(),
  channel: effectiveAppUpdateChannel(),
  preferredChannel: preferredAppUpdateChannel(),
};

const desktopAuthClient =
  AUTH_BASE_URL && AUTH_SIGN_IN_URL
    ? createAuthClient({
        baseURL: AUTH_BASE_URL,
        plugins: [
          electronClient({
            signInURL: AUTH_SIGN_IN_URL,
            protocol: {
              scheme: AUTH_CALLBACK_PROTOCOL,
            },
            storage: electronAuthStorage(),
          }),
        ],
      })
    : null;

interface RuntimeBindingExchangePayload {
  sandbox_id: string;
  holaboss_user_id: string;
  target_kind: string;
  model_proxy_api_key?: string;
  auth_token?: string;
  model_proxy_base_url: string;
  default_model: string;
  default_background_model?: string;
  default_embedding_model?: string;
  default_image_model?: string;
  instance_id: string;
  provider: string;
  catalog_version?: string;
  provider_model_groups?: RuntimeProviderModelGroupPayload[];
}

interface RuntimeModelCatalogResponsePayload {
  catalog_version?: string;
  default_background_model?: string;
  default_embedding_model?: string;
  default_image_model?: string;
  provider_model_groups?: RuntimeProviderModelGroupPayload[];
}

interface RuntimeModelCatalogPayload {
  catalogVersion: string | null;
  defaultBackgroundModel: string | null;
  defaultEmbeddingModel: string | null;
  defaultImageModel: string | null;
  providerModelGroups: RuntimeProviderModelGroupPayload[];
  fetchedAt: string | null;
}

interface PopupThemePalette {
  fontFamily: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentStrong: string;
  border: string;
  borderSoft: string;
  hover: string;
  panelBg: string;
  panelBgAlt: string;
  controlBg: string;
  shadow: string;
  emptyBg: string;
  error: string;
}

function getPopupThemePalette(theme: string): PopupThemePalette {
  switch (theme) {
    case "holaboss":
      return {
        fontFamily: '"IBM Plex Sans", "Aptos", "Segoe UI Variable", sans-serif',
        text: "rgba(33, 38, 49, 0.94)",
        textMuted: "rgba(109, 117, 131, 0.84)",
        textSubtle: "rgba(109, 117, 131, 0.68)",
        accent: "rgb(247, 90, 84)",
        accentStrong: "rgb(233, 117, 109)",
        border: "rgba(224, 228, 236, 0.78)",
        borderSoft: "rgba(224, 228, 236, 0.42)",
        hover: "rgba(247, 90, 84, 0.08)",
        panelBg: "rgba(255, 255, 255, 0.98)",
        panelBgAlt: "rgba(248, 249, 252, 0.98)",
        controlBg: "rgba(248, 250, 253, 0.94)",
        shadow: "0 12px 30px rgba(25, 33, 53, 0.08)",
        emptyBg: "rgba(250, 245, 244, 0.92)",
        error: "rgba(184, 67, 67, 0.94)",
      };
    case "sepia":
      return {
        fontFamily: '"IBM Plex Sans", "Aptos", "Segoe UI Variable", sans-serif',
        text: "rgba(74, 54, 39, 0.94)",
        textMuted: "rgba(133, 108, 87, 0.84)",
        textSubtle: "rgba(133, 108, 87, 0.68)",
        accent: "rgb(183, 139, 98)",
        accentStrong: "rgb(160, 124, 92)",
        border: "rgba(203, 186, 165, 0.7)",
        borderSoft: "rgba(203, 186, 165, 0.34)",
        hover: "rgba(93, 70, 46, 0.05)",
        panelBg: "rgba(255, 251, 246, 0.98)",
        panelBgAlt: "rgba(246, 240, 232, 0.98)",
        controlBg: "rgba(245, 241, 234, 0.94)",
        shadow: "0 10px 28px rgba(93, 70, 46, 0.12)",
        emptyBg: "rgba(251, 248, 242, 0.92)",
        error: "rgba(181, 72, 72, 0.92)",
      };
    case "paper":
      return {
        fontFamily: '"IBM Plex Sans", "Aptos", "Segoe UI Variable", sans-serif',
        text: "rgba(78, 64, 52, 0.94)",
        textMuted: "rgba(138, 119, 103, 0.84)",
        textSubtle: "rgba(138, 119, 103, 0.68)",
        accent: "rgb(143, 115, 90)",
        accentStrong: "rgb(114, 90, 70)",
        border: "rgba(216, 203, 185, 0.72)",
        borderSoft: "rgba(216, 203, 185, 0.34)",
        hover: "rgba(93, 70, 46, 0.045)",
        panelBg: "rgba(255, 253, 249, 0.98)",
        panelBgAlt: "rgba(245, 241, 234, 0.98)",
        controlBg: "rgba(245, 241, 234, 0.92)",
        shadow: "0 10px 28px rgba(93, 70, 46, 0.1)",
        emptyBg: "rgba(251, 248, 243, 0.92)",
        error: "rgba(181, 72, 72, 0.92)",
      };
    case "slate":
      return {
        fontFamily: '"IBM Plex Sans", "Aptos", "Segoe UI Variable", sans-serif',
        text: "rgba(232, 236, 242, 0.94)",
        textMuted: "rgba(156, 168, 184, 0.84)",
        textSubtle: "rgba(156, 168, 184, 0.68)",
        accent: "rgb(124, 146, 184)",
        accentStrong: "rgb(95, 120, 163)",
        border: "rgba(67, 81, 102, 0.62)",
        borderSoft: "rgba(67, 81, 102, 0.28)",
        hover: "rgba(255, 255, 255, 0.04)",
        panelBg: "rgba(21, 26, 34, 0.98)",
        panelBgAlt: "rgba(14, 17, 22, 0.98)",
        controlBg: "rgba(14, 17, 22, 0.94)",
        shadow: "0 14px 32px rgba(0, 0, 0, 0.28)",
        emptyBg: "rgba(21, 26, 34, 0.92)",
        error: "rgba(255, 185, 185, 0.92)",
      };
    case "graphite":
      return {
        fontFamily: '"IBM Plex Sans", "Aptos", "Segoe UI Variable", sans-serif',
        text: "rgba(236, 239, 243, 0.94)",
        textMuted: "rgba(160, 167, 176, 0.84)",
        textSubtle: "rgba(160, 167, 176, 0.68)",
        accent: "rgb(139, 148, 158)",
        accentStrong: "rgb(111, 119, 128)",
        border: "rgba(79, 86, 94, 0.64)",
        borderSoft: "rgba(79, 86, 94, 0.28)",
        hover: "rgba(255, 255, 255, 0.035)",
        panelBg: "rgba(23, 25, 28, 0.98)",
        panelBgAlt: "rgba(17, 18, 20, 0.98)",
        controlBg: "rgba(17, 18, 20, 0.95)",
        shadow: "0 12px 26px rgba(0, 0, 0, 0.24)",
        emptyBg: "rgba(23, 25, 28, 0.92)",
        error: "rgba(255, 185, 185, 0.92)",
      };
    case "cobalt":
      return {
        fontFamily: '"Exo 2", "Bahnschrift", "Segoe UI Variable", sans-serif',
        text: "rgba(231, 241, 255, 0.94)",
        textMuted: "rgba(177, 194, 221, 0.84)",
        textSubtle: "rgba(177, 194, 221, 0.68)",
        accent: "rgb(111, 188, 255)",
        accentStrong: "rgb(72, 145, 255)",
        border: "rgba(111, 188, 255, 0.28)",
        borderSoft: "rgba(111, 188, 255, 0.14)",
        hover: "rgba(255, 255, 255, 0.05)",
        panelBg: "rgba(12, 19, 31, 0.98)",
        panelBgAlt: "rgba(7, 10, 16, 0.98)",
        controlBg: "rgba(7, 10, 16, 0.94)",
        shadow: "0 18px 42px rgba(0, 0, 0, 0.42)",
        emptyBg: "rgba(16, 24, 40, 0.92)",
        error: "rgba(255, 185, 185, 0.92)",
      };
    case "ember":
      return {
        fontFamily: '"Exo 2", "Bahnschrift", "Segoe UI Variable", sans-serif',
        text: "rgba(255, 236, 225, 0.94)",
        textMuted: "rgba(219, 187, 167, 0.84)",
        textSubtle: "rgba(219, 187, 167, 0.68)",
        accent: "rgb(255, 151, 94)",
        accentStrong: "rgb(227, 102, 57)",
        border: "rgba(255, 151, 94, 0.28)",
        borderSoft: "rgba(255, 151, 94, 0.14)",
        hover: "rgba(255, 255, 255, 0.05)",
        panelBg: "rgba(30, 16, 12, 0.98)",
        panelBgAlt: "rgba(16, 9, 7, 0.98)",
        controlBg: "rgba(16, 9, 7, 0.94)",
        shadow: "0 18px 42px rgba(0, 0, 0, 0.42)",
        emptyBg: "rgba(40, 21, 16, 0.92)",
        error: "rgba(255, 185, 185, 0.92)",
      };
    case "glacier":
      return {
        fontFamily: '"Exo 2", "Bahnschrift", "Segoe UI Variable", sans-serif',
        text: "rgba(236, 249, 252, 0.94)",
        textMuted: "rgba(183, 209, 216, 0.84)",
        textSubtle: "rgba(183, 209, 216, 0.68)",
        accent: "rgb(139, 233, 255)",
        accentStrong: "rgb(95, 189, 214)",
        border: "rgba(139, 233, 255, 0.28)",
        borderSoft: "rgba(139, 233, 255, 0.14)",
        hover: "rgba(255, 255, 255, 0.05)",
        panelBg: "rgba(16, 24, 29, 0.98)",
        panelBgAlt: "rgba(8, 12, 15, 0.98)",
        controlBg: "rgba(8, 12, 15, 0.94)",
        shadow: "0 18px 42px rgba(0, 0, 0, 0.42)",
        emptyBg: "rgba(23, 34, 39, 0.92)",
        error: "rgba(255, 185, 185, 0.92)",
      };
    case "mono":
      return {
        fontFamily: '"Exo 2", "Bahnschrift", "Segoe UI Variable", sans-serif',
        text: "rgba(240, 240, 240, 0.94)",
        textMuted: "rgba(184, 184, 184, 0.84)",
        textSubtle: "rgba(184, 184, 184, 0.68)",
        accent: "rgb(208, 208, 208)",
        accentStrong: "rgb(153, 153, 153)",
        border: "rgba(208, 208, 208, 0.24)",
        borderSoft: "rgba(208, 208, 208, 0.12)",
        hover: "rgba(255, 255, 255, 0.05)",
        panelBg: "rgba(20, 20, 20, 0.98)",
        panelBgAlt: "rgba(10, 10, 10, 0.98)",
        controlBg: "rgba(10, 10, 10, 0.94)",
        shadow: "0 18px 42px rgba(0, 0, 0, 0.42)",
        emptyBg: "rgba(28, 28, 28, 0.92)",
        error: "rgba(255, 185, 185, 0.92)",
      };
    case "emerald":
    default:
      return {
        fontFamily: '"Exo 2", "Bahnschrift", "Segoe UI Variable", sans-serif',
        text: "rgba(222, 238, 230, 0.94)",
        textMuted: "rgba(174, 201, 188, 0.84)",
        textSubtle: "rgba(174, 201, 188, 0.68)",
        accent: "rgb(87, 255, 173)",
        accentStrong: "rgb(62, 201, 137)",
        border: "rgba(87, 255, 173, 0.24)",
        borderSoft: "rgba(87, 255, 173, 0.14)",
        hover: "rgba(255, 255, 255, 0.05)",
        panelBg: "rgba(9, 16, 13, 0.98)",
        panelBgAlt: "rgba(5, 9, 7, 0.98)",
        controlBg: "rgba(6, 9, 8, 0.94)",
        shadow: "0 18px 42px rgba(0, 0, 0, 0.45)",
        emptyBg: "rgba(13, 21, 18, 0.92)",
        error: "rgba(255, 185, 185, 0.92)",
      };
  }
}

function popupThemeCss(theme = currentTheme) {
  const palette = getPopupThemePalette(theme);
  const isLightTheme =
    theme === "holaboss" || theme === "sepia" || theme === "paper";
  const surfaceSoft = `color-mix(in srgb, ${palette.controlBg} 72%, ${palette.panelBgAlt} 28%)`;
  const surfaceSubtle = `color-mix(in srgb, ${palette.controlBg} 52%, ${palette.panelBgAlt} 48%)`;
  return `
      :root {
        color-scheme: ${isLightTheme ? "light" : "dark"};
        --popup-text: ${palette.text};
        --popup-text-muted: ${palette.textMuted};
        --popup-text-subtle: ${palette.textSubtle};
        --popup-accent: ${palette.accent};
        --popup-accent-strong: ${palette.accentStrong};
        --popup-border: ${palette.border};
        --popup-border-soft: ${palette.borderSoft};
        --popup-hover: ${palette.hover};
        --popup-panel-bg: ${palette.panelBg};
        --popup-panel-bg-alt: ${palette.panelBgAlt};
        --popup-control-bg: ${palette.controlBg};
        --popup-shadow: ${palette.shadow};
        --popup-error: ${palette.error};
      }
      body {
        font-family: ${palette.fontFamily};
        color: ${palette.text};
        background: transparent;
      }
      .panel {
        border: 1px solid ${palette.border};
        background: linear-gradient(180deg, ${palette.panelBg}, ${palette.panelBgAlt});
        box-shadow: ${palette.shadow};
      }
      .header {
        border-bottom-color: ${palette.borderSoft};
      }
      .content {
        background: color-mix(in srgb, ${palette.panelBg} 90%, transparent);
      }
      .avatar {
        border-color: color-mix(in srgb, ${palette.accent} 30%, ${palette.borderSoft});
        background: color-mix(in srgb, ${palette.accent} 14%, transparent);
        color: ${palette.accentStrong};
      }
      .identityName, .rowLabel, .heroTitle, .statusDetail {
        color: ${palette.text};
      }
      .title, .identity, .filename, .title-row {
        color: ${palette.text};
      }
      .summary, .url-row, .status, .section-title, .field label, .clock,
      .identity, .rowValue, .heroDescription, .statusLabel, .footnote, .authSectionTitle, .advancedHint {
        color: ${palette.textSubtle};
      }
      .button, .action, .item, .remove {
        color: ${palette.textMuted};
      }
      .button, .action, .badge, .input, .item, .empty {
        border-color: ${palette.borderSoft};
      }
      .button, .action, .badge, .input {
        background: ${palette.controlBg};
      }
      .hero, .row, .section, .statusStep, .advancedToggle, .stateMessage, .message {
        border-color: ${palette.borderSoft};
        background: ${surfaceSoft};
      }
      .empty, .item, .statusStep.current {
        background: ${surfaceSubtle};
      }
      .badge {
        color: ${palette.textMuted};
      }
      .badge.idle {
        background: ${surfaceSubtle};
        color: ${palette.textMuted};
      }
      .badge.ready {
        border-color: color-mix(in srgb, ${palette.accent} 42%, ${palette.borderSoft});
        background: color-mix(in srgb, ${palette.accent} 16%, transparent);
        color: ${palette.accentStrong};
      }
      .badge.syncing {
        border-color: color-mix(in srgb, ${palette.accentStrong} 30%, ${palette.borderSoft});
        background: color-mix(in srgb, ${palette.accentStrong} 12%, transparent);
        color: ${palette.accentStrong};
      }
      .badge.error {
        border-color: color-mix(in srgb, ${palette.error} 35%, ${palette.borderSoft});
        background: color-mix(in srgb, ${palette.error} 10%, transparent);
        color: ${palette.error};
      }
      .button.primary {
        border-color: ${palette.border};
        background: color-mix(in srgb, ${palette.accent} 14%, transparent);
        color: ${palette.accentStrong};
      }
      .button:hover, .action:hover, .item:hover, .item.active, .remove:hover {
        background: ${palette.hover};
        color: ${palette.accentStrong};
      }
      .input:focus {
        border-color: ${palette.accent};
      }
      .input {
        color: ${palette.text};
      }
      .input::placeholder {
        color: ${palette.textSubtle};
      }
      .statusStep.done {
        border-color: color-mix(in srgb, ${palette.accent} 42%, ${palette.borderSoft});
        background: color-mix(in srgb, ${palette.accent} 14%, transparent);
      }
      .statusStep.error {
        border-color: color-mix(in srgb, ${palette.error} 36%, ${palette.borderSoft});
        background: color-mix(in srgb, ${palette.error} 10%, transparent);
      }
      .statusDot {
        background: color-mix(in srgb, ${palette.textMuted} 62%, transparent);
      }
      .statusStep.done .statusDot {
        background: ${palette.accentStrong};
      }
      .statusStep.current .statusDot {
        background: ${palette.accent};
      }
      .statusStep.error .statusDot {
        background: ${palette.error};
      }
      .message.success {
        border-color: color-mix(in srgb, ${palette.accent} 40%, ${palette.borderSoft});
        color: ${palette.accentStrong};
      }
      .message.error {
        color: ${palette.error};
      }
      .bar {
        background: color-mix(in srgb, ${palette.textMuted} 10%, transparent);
      }
      .bar > span {
        background: linear-gradient(90deg, ${palette.accent}, ${palette.accentStrong});
      }`;
}

interface TemplateAgentInfoPayload {
  role: string;
  description: string;
}

interface TemplateViewInfoPayload {
  name: string;
  description: string;
}

interface TemplateAppEntryPayload {
  name: string;
  required: boolean;
}

interface TemplateMetadataPayload {
  name: string;
  repo: string;
  path: string;
  default_ref: string;
  description: string | null;
  is_hidden: boolean;
  is_coming_soon: boolean;
  allowed_user_ids: string[];
  icon: string;
  emoji: string | null;
  apps: TemplateAppEntryPayload[];
  min_optional_apps: number;
  tags: string[];
  category: string;
  long_description: string | null;
  agents: TemplateAgentInfoPayload[];
  views: TemplateViewInfoPayload[];
  install_count?: number;
  source?: string;
  verified?: boolean;
  author_name?: string;
  author_id?: string;
}

interface ResolvedTemplatePayload {
  name: string;
  repo: string;
  path: string;
  effective_ref: string;
  effective_commit: string | null;
  source: string;
}

interface MaterializedTemplateFilePayload {
  path: string;
  content_base64: string;
  executable: boolean;
  symlink_target?: string | null;
}

interface MaterializeTemplateResponsePayload {
  template: ResolvedTemplatePayload;
  files: MaterializedTemplateFilePayload[];
  file_count: number;
  total_bytes: number;
}

interface SpotlightItemPayload {
  label: string;
  title: string;
  description: string;
  template_name: string;
}

interface TemplateListResponsePayload {
  templates: TemplateMetadataPayload[];
  spotlight: SpotlightItemPayload[];
}

interface ProactiveIngestItemResultPayload {
  status?: string;
  event_id?: string;
  detail?: string | null;
}

interface WorkspaceRecordPayload {
  id: string;
  name: string;
  status: string;
  harness: string | null;
  error_message: string | null;
  onboarding_status: string;
  onboarding_session_id: string | null;
  onboarding_completed_at: string | null;
  onboarding_completion_summary: string | null;
  onboarding_requested_at: string | null;
  onboarding_requested_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at_utc: string | null;
}

interface WorkspaceResponsePayload {
  workspace: WorkspaceRecordPayload;
}

interface WorkspaceListResponsePayload {
  items: WorkspaceRecordPayload[];
  total: number;
  limit: number;
  offset: number;
}

interface SubmissionListResponsePayload {
  submissions: Array<{
    id: string;
    author_id: string;
    author_name: string;
    template_name: string;
    template_id: string;
    version: string;
    status: "pending_review" | "published" | "rejected";
    manifest: Record<string, unknown>;
    archive_size_bytes: number;
    review_notes: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
  count: number;
}

interface TaskProposalRecordPayload {
  proposal_id: string;
  workspace_id: string;
  task_name: string;
  task_prompt: string;
  task_generation_rationale: string;
  proposal_source: "proactive" | "evolve";
  created_at: string;
  state: string;
  source_event_ids: string[];
  accepted_session_id: string | null;
  accepted_input_id: string | null;
  accepted_at: string | null;
}

interface TaskProposalListResponsePayload {
  proposals: TaskProposalRecordPayload[];
  count: number;
}

type MemoryUpdateProposalKind = "preference" | "identity" | "profile";
type MemoryUpdateProposalState = "pending" | "accepted" | "dismissed";

interface MemoryUpdateProposalRecordPayload {
  proposal_id: string;
  workspace_id: string;
  session_id: string;
  input_id: string;
  proposal_kind: MemoryUpdateProposalKind;
  target_key: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  evidence: string | null;
  confidence: number | null;
  source_message_id: string | null;
  state: MemoryUpdateProposalState;
  persisted_memory_id: string | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  dismissed_at: string | null;
}

interface MemoryUpdateProposalListRequestPayload {
  workspaceId: string;
  sessionId?: string | null;
  inputId?: string | null;
  state?: MemoryUpdateProposalState | null;
  limit?: number;
  offset?: number;
}

interface MemoryUpdateProposalListResponsePayload {
  proposals: MemoryUpdateProposalRecordPayload[];
  count: number;
}

interface MemoryUpdateProposalAcceptPayload {
  proposalId: string;
  summary?: string | null;
}

interface MemoryUpdateProposalAcceptResponsePayload {
  proposal: MemoryUpdateProposalRecordPayload;
}

interface MemoryUpdateProposalDismissResponsePayload {
  proposal: MemoryUpdateProposalRecordPayload;
}

interface RemoteTaskProposalGenerationRequestPayload {
  workspace_id: string;
}

interface RemoteTaskProposalGenerationResponsePayload {
  accepted: boolean;
  accepted_count: number;
  event_count: number;
  correlation_id: string;
}

interface ProactiveContextCaptureResponsePayload {
  context: Record<string, unknown>;
}

interface ProactiveTaskProposalPreferenceUpdatePayload {
  enabled: boolean;
  holaboss_user_id?: string;
  sandbox_id?: string;
}

interface ProactiveTaskProposalPreferencePayload {
  enabled: boolean;
  holaboss_user_id: string;
  sandbox_id: string;
}

interface ProactiveHeartbeatWorkspacePayload {
  workspace_id: string;
  workspace_name: string | null;
  enabled: boolean;
  last_seen_at: string | null;
}

interface ProactiveHeartbeatConfigPayload {
  holaboss_user_id: string;
  sandbox_id: string;
  has_schedule: boolean;
  cron: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  workspaces: ProactiveHeartbeatWorkspacePayload[];
}

interface ProactiveHeartbeatConfigUpdatePayload {
  cron?: string;
  enabled?: boolean;
  holaboss_user_id?: string;
  sandbox_id?: string;
}

interface ProactiveHeartbeatWorkspaceUpdatePayload {
  workspace_id: string;
  workspace_name?: string | null;
  enabled: boolean;
  holaboss_user_id?: string;
  sandbox_id?: string;
}

interface ProactiveHeartbeatCronjobRecordResponsePayload {
  sandbox_id: string;
  holaboss_user_id: string;
  cron: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

interface ProactiveHeartbeatConfigResponsePayload {
  holaboss_user_id: string;
  sandbox_id: string;
  cronjob: ProactiveHeartbeatCronjobRecordResponsePayload | null;
  workspaces: ProactiveHeartbeatWorkspacePayload[];
}

interface TaskProposalStateUpdatePayload {
  proposal: TaskProposalRecordPayload;
}

interface CronjobDeliveryPayload {
  mode: string;
  channel: string;
  to: string | null;
}

interface CronjobRecordPayload {
  id: string;
  workspace_id: string;
  initiated_by: string;
  name: string;
  cron: string;
  description: string;
  instruction: string;
  enabled: boolean;
  delivery: CronjobDeliveryPayload;
  metadata: Record<string, unknown>;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface CronjobListResponsePayload {
  jobs: CronjobRecordPayload[];
  count: number;
}

interface CronjobCreatePayload {
  workspace_id: string;
  initiated_by: string;
  name?: string;
  cron: string;
  description: string;
  instruction?: string;
  enabled?: boolean;
  delivery: CronjobDeliveryPayload;
  metadata?: Record<string, unknown>;
}

interface CronjobUpdatePayload {
  name?: string;
  cron?: string;
  description?: string;
  instruction?: string;
  enabled?: boolean;
  delivery?: CronjobDeliveryPayload;
  metadata?: Record<string, unknown>;
}

interface IntegrationCatalogProviderPayload {
  provider_id: string;
  display_name: string;
  description: string;
  auth_modes: string[];
  supports_oss: boolean;
  supports_managed: boolean;
  default_scopes: string[];
  docs_url: string | null;
}

interface IntegrationCatalogResponsePayload {
  providers: IntegrationCatalogProviderPayload[];
}

interface IntegrationConnectionPayload {
  connection_id: string;
  provider_id: string;
  owner_user_id: string;
  account_label: string;
  account_external_id: string | null;
  auth_mode: string;
  granted_scopes: string[];
  status: string;
  secret_ref: string | null;
  created_at: string;
  updated_at: string;
}

interface IntegrationConnectionListResponsePayload {
  connections: IntegrationConnectionPayload[];
}

interface IntegrationBindingPayload {
  binding_id: string;
  workspace_id: string;
  target_type: string;
  target_id: string;
  integration_key: string;
  connection_id: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface IntegrationBindingListResponsePayload {
  bindings: IntegrationBindingPayload[];
}

interface IntegrationUpsertBindingPayload {
  connection_id: string;
  is_default?: boolean;
}

interface IntegrationCreateConnectionPayload {
  provider_id: string;
  owner_user_id: string;
  account_label: string;
  auth_mode: string;
  granted_scopes: string[];
  secret_ref?: string;
}

interface IntegrationUpdateConnectionPayload {
  status?: string;
  secret_ref?: string;
  account_label?: string;
}

interface OAuthAppConfigPayload {
  provider_id: string;
  client_id: string;
  client_secret: string;
  authorize_url: string;
  token_url: string;
  scopes: string[];
  redirect_port: number;
  created_at: string;
  updated_at: string;
}

interface OAuthAppConfigListResponsePayload {
  configs: OAuthAppConfigPayload[];
}

interface OAuthAppConfigUpsertPayload {
  client_id: string;
  client_secret: string;
  authorize_url: string;
  token_url: string;
  scopes: string[];
  redirect_port?: number;
}

interface OAuthAuthorizeResponsePayload {
  authorize_url: string;
  state: string;
}

interface ComposioConnectResult {
  redirect_url: string;
  connected_account_id: string;
  auth_config_id: string;
  expires_at: string | null;
}

interface ComposioAccountStatus {
  id: string;
  status: string;
  authConfigId: string | null;
  toolkitSlug: string | null;
  userId: string | null;
}

interface SessionRuntimeRecordPayload {
  workspace_id: string;
  session_id: string;
  status: string;
  current_input_id: string | null;
  current_worker_id: string | null;
  lease_until: string | null;
  heartbeat_at: string | null;
  last_error: Record<string, unknown> | null;
  last_turn_status: string | null;
  last_turn_completed_at: string | null;
  last_turn_stop_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionRuntimeStateListResponsePayload {
  items: SessionRuntimeRecordPayload[];
  count: number;
}

interface SessionHistoryMessagePayload {
  id: string;
  role: string;
  text: string;
  created_at: string | null;
  metadata: Record<string, unknown>;
}

interface SessionInputAttachmentPayload {
  id: string;
  kind: "image" | "file";
  name: string;
  mime_type: string;
  size_bytes: number;
  workspace_path: string;
}

interface StageSessionAttachmentFilePayload {
  name: string;
  mime_type?: string | null;
  content_base64: string;
}

interface StageSessionAttachmentsPayload {
  workspace_id: string;
  files: StageSessionAttachmentFilePayload[];
}

interface StageSessionAttachmentPathPayload {
  absolute_path: string;
  name?: string | null;
  mime_type?: string | null;
}

interface StageSessionAttachmentPathsPayload {
  workspace_id: string;
  files: StageSessionAttachmentPathPayload[];
}

interface StageSessionAttachmentsResponsePayload {
  attachments: SessionInputAttachmentPayload[];
}

interface SessionHistoryResponsePayload {
  workspace_id: string;
  session_id: string;
  harness: string;
  harness_session_id: string;
  source: string;
  messages: SessionHistoryMessagePayload[];
  count: number;
  total: number;
  limit: number;
  offset: number;
  raw: unknown | null;
}

interface SessionOutputEventPayload {
  id: number;
  workspace_id: string;
  session_id: string;
  input_id: string;
  sequence: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface SessionOutputEventListResponsePayload {
  items: SessionOutputEventPayload[];
  count: number;
  last_event_id: number;
}

interface EnqueueSessionInputResponsePayload {
  input_id: string;
  session_id: string;
  status: string;
}

interface PauseSessionRunResponsePayload {
  input_id: string;
  session_id: string;
  status: string;
}

interface HolabossClientConfigPayload {
  projectsUrl: string;
  marketplaceUrl: string;
}

interface DesktopBillingOverviewPayload {
  hasHostedBillingAccount: boolean;
  planId: string;
  planName: string | null;
  planStatus: string;
  renewsAt: string | null;
  expiresAt: string | null;
  creditsBalance: number;
  totalAllocated: number;
  totalUsed: number;
  monthlyCreditsIncluded: number | null;
  monthlyCreditsUsed: number | null;
  dailyRefreshCredits: number | null;
  dailyRefreshTarget: number | null;
  lowBalanceThreshold: number;
  isLowBalance: boolean;
}

interface DesktopBillingUsageItemPayload {
  id: string;
  type: string;
  sourceType: string | null;
  reason: string | null;
  amount: number;
  absoluteAmount: number;
  createdAt: string;
}

interface DesktopBillingUsagePayload {
  items: DesktopBillingUsageItemPayload[];
  count: number;
}

interface DesktopBillingLinksPayload {
  billingPageUrl: string;
  addCreditsUrl: string;
  upgradeUrl: string;
  usageUrl: string;
}

interface DesktopBillingRpcEnvelope<T> {
  json: T;
  meta?: unknown;
}

interface DesktopBillingQuotaRpcPayload {
  balance: number;
  totalAllocated: number;
  totalUsed: number;
}

interface DesktopBillingTransactionRpcPayload {
  id: string;
  type: string;
  sourceType: string | null;
  reason: string | null;
  serviceType: string | null;
  serviceId: string | null;
  amount: number;
  createdAt: string;
}

interface DesktopBillingSubscriptionRpcPayload {
  status: string;
  plan: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface DesktopBillingInfoRpcPayload {
  hasActiveSubscription: boolean;
  subscription: DesktopBillingSubscriptionRpcPayload | null;
  stripeCustomerId: string | null;
}

interface InstalledWorkspaceAppPayload {
  app_id: string;
  config_path: string;
  lifecycle: Record<string, string> | null;
  build_status?: string;
  ready: boolean;
  error: string | null;
}

interface InstalledWorkspaceAppListResponsePayload {
  apps: InstalledWorkspaceAppPayload[];
  count: number;
}

interface WorkspaceLifecycleBlockingAppPayload {
  app_id: string;
  status: string;
  error: string | null;
}

interface WorkspaceLifecyclePayload {
  workspace: WorkspaceRecordPayload;
  applications: InstalledWorkspaceAppPayload[];
  ready: boolean;
  reason: string | null;
  phase: string;
  phase_label: string;
  phase_detail: string | null;
  blocking_apps: WorkspaceLifecycleBlockingAppPayload[];
}

interface WorkspaceOutputRecordPayload {
  id: string;
  workspace_id: string;
  output_type: string;
  title: string;
  status: string;
  module_id: string | null;
  module_resource_id: string | null;
  file_path: string | null;
  html_content: string | null;
  session_id: string | null;
  artifact_id: string | null;
  folder_id: string | null;
  platform: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface WorkspaceOutputListResponsePayload {
  items: WorkspaceOutputRecordPayload[];
}

interface WorkspaceSkillRecordPayload {
  skill_id: string;
  source_dir: string;
  skill_file_path: string;
  title: string;
  summary: string;
  modified_at: string;
}

interface WorkspaceSkillListResponsePayload {
  workspace_id: string;
  workspace_root: string;
  skills_path: string;
  skills: WorkspaceSkillRecordPayload[];
}

interface HolabossCreateWorkspacePayload {
  holaboss_user_id: string;
  harness?: string | null;
  name: string;
  template_mode?: "template" | "empty" | "empty_onboarding" | null;
  template_root_path?: string | null;
  template_name?: string | null;
  template_ref?: string | null;
  template_commit?: string | null;
  /** App names from template metadata, used for integration resolution without materialization. */
  template_apps?: string[];
}

interface TemplateFolderSelectionPayload {
  canceled: boolean;
  rootPath: string | null;
  templateName: string | null;
  description: string | null;
}

interface HolabossQueueSessionInputPayload {
  text: string;
  workspace_id: string;
  image_urls: string[] | null;
  attachments?: SessionInputAttachmentPayload[] | null;
  session_id?: string | null;
  idempotency_key?: string | null;
  priority?: number;
  model?: string | null;
  thinking_value?: string | null;
}

interface HolabossPauseSessionRunPayload {
  workspace_id: string;
  session_id: string;
}

interface HolabossStreamSessionOutputsPayload {
  sessionId: string;
  workspaceId?: string | null;
  inputId?: string | null;
  includeHistory?: boolean;
  stopOnTerminal?: boolean;
}

interface HolabossListOutputsPayload {
  workspaceId: string;
  outputType?: string | null;
  status?: string | null;
  platform?: string | null;
  folderId?: string | null;
  sessionId?: string | null;
  inputId?: string | null;
  limit?: number;
  offset?: number;
}

interface HolabossSessionStreamHandlePayload {
  streamId: string;
}

interface HolabossSessionStreamEventPayload {
  streamId: string;
  type: "event" | "error" | "done";
  event?: {
    event: string;
    id: string | null;
    data: unknown;
  };
  error?: string;
}

interface HolabossSessionStreamDebugEntry {
  at: string;
  streamId: string;
  phase: string;
  detail: string;
}

const DEFAULT_PROJECTS_URL =
  internalOverride("HOLABOSS_PROJECTS_URL") ||
  internalOverride("HOLABOSS_CLI_PROJECTS_URL") ||
  normalizeBaseUrl(packagedDesktopConfig.projectsUrl || "") ||
  serviceBaseUrlFromControlPlane(DESKTOP_CONTROL_PLANE_BASE_URL, 3033);
const DEFAULT_MARKETPLACE_URL =
  internalOverride("HOLABOSS_MARKETPLACE_URL") ||
  internalOverride("HOLABOSS_CLI_MARKETPLACE_URL") ||
  normalizeBaseUrl(packagedDesktopConfig.marketplaceUrl || "") ||
  serviceBaseUrlFromControlPlane(DESKTOP_CONTROL_PLANE_BASE_URL, 3037);
const DEFAULT_PROACTIVE_URL =
  internalOverride("HOLABOSS_PROACTIVE_URL") ||
  internalOverride("HOLABOSS_CLI_PROACTIVE_URL") ||
  normalizeBaseUrl(packagedDesktopConfig.proactiveUrl || "") ||
  serviceBaseUrlFromControlPlane(DESKTOP_CONTROL_PLANE_BASE_URL, 3032);

const sessionOutputStreams = new Map<string, AbortController>();
const sessionStreamDebugLog: HolabossSessionStreamDebugEntry[] = [];
let lastRuntimeStateSignature = "";
let lastRuntimeConfigSignature = "";
let lastRuntimeBindingRefreshAtMs = 0;
let lastRuntimeBindingRefreshUserId = "";
let lastRuntimeBindingRefreshFailureAtMs = 0;
let lastRuntimeBindingRefreshFailureUserId = "";
let runtimeBindingRefreshPromise: Promise<void> | null = null;
let runtimeConfigMutationPromise: Promise<void> | null = null;
let runtimeLifecycleChain: Promise<void> = Promise.resolve();
let runtimeStartupInFlight = false;
let startupAuthSyncPromise: Promise<void> | null = null;

function appendSessionStreamDebug(
  streamId: string,
  phase: string,
  detail: string,
) {
  if (!verboseTelemetryEnabled) {
    return;
  }
  sessionStreamDebugLog.push({
    at: new Date().toISOString(),
    streamId,
    phase,
    detail,
  });
  if (sessionStreamDebugLog.length > 1200) {
    sessionStreamDebugLog.splice(0, sessionStreamDebugLog.length - 1200);
  }
}

function sanitizeBrowserWorkspaceSegment(workspaceId: string) {
  const normalized =
    workspaceId
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "workspace";
  const digest = createHash("sha256")
    .update(workspaceId.trim(), "utf8")
    .digest("hex")
    .slice(0, 12);
  return `${normalized}-${digest}`;
}

function browserWorkspaceStorageDir(workspaceId: string) {
  return path.join(
    app.getPath("userData"),
    "browser-workspaces",
    sanitizeBrowserWorkspaceSegment(workspaceId),
  );
}

function browserWorkspaceStatePath(workspaceId: string) {
  return path.join(
    browserWorkspaceStorageDir(workspaceId),
    "browser-state.json",
  );
}

function browserWorkspacePartition(workspaceId: string) {
  return `persist:holaboss-browser-${sanitizeBrowserWorkspaceSegment(workspaceId)}`;
}

function chromiumFamilyDisplayName(browser: ChromiumFamilyBrowser) {
  switch (browser) {
    case "chromium":
      return "Chromium";
    case "arc":
      return "Arc";
    default:
      return "Chrome";
  }
}

function chromiumFamilyUserDataRootCandidates(
  browser: ChromiumFamilyBrowser,
): string[] {
  const localAppData =
    process.env.LOCALAPPDATA?.trim() ||
    path.join(os.homedir(), "AppData", "Local");
  const configHome =
    process.env.XDG_CONFIG_HOME?.trim() ||
    path.join(os.homedir(), ".config");

  switch (process.platform) {
    case "darwin":
      if (browser === "chromium") {
        return [
          path.join(os.homedir(), "Library", "Application Support", "Chromium"),
        ];
      }
      if (browser === "arc") {
        return [
          path.join(os.homedir(), "Library", "Application Support", "Arc"),
        ];
      }
      return [
        path.join(
          os.homedir(),
          "Library",
          "Application Support",
          "Google",
          "Chrome",
        ),
      ];
    case "win32":
      if (browser === "chromium") {
        return [path.join(localAppData, "Chromium", "User Data")];
      }
      if (browser === "arc") {
        return [
          path.join(localAppData, "Arc", "User Data"),
          path.join(localAppData, "TheBrowserCompany", "Arc", "User Data"),
          path.join(
            localAppData,
            "Packages",
            "TheBrowserCompany.Arc_ttt1ap7aakyb4",
            "LocalCache",
            "Local",
            "Arc",
            "User Data",
          ),
        ];
      }
      return [path.join(localAppData, "Google", "Chrome", "User Data")];
    case "linux":
      if (browser === "chromium") {
        return [path.join(configHome, "chromium")];
      }
      if (browser === "arc") {
        return [path.join(configHome, "arc"), path.join(configHome, "Arc")];
      }
      return [path.join(configHome, "google-chrome")];
    default:
      return [];
  }
}

function resolveChromiumFamilyUserDataRoot(
  browser: ChromiumFamilyBrowser,
): string | null {
  for (const candidate of chromiumFamilyUserDataRootCandidates(browser)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return chromiumFamilyUserDataRootCandidates(browser)[0] ?? null;
}

function resolveChromeUserDataRoot(): string | null {
  return resolveChromiumFamilyUserDataRoot("chrome");
}

function chromeLocalStatePath(userDataDir: string) {
  return path.join(userDataDir, "Local State");
}

function chromeProfileBookmarksPath(profileDir: string) {
  return path.join(profileDir, "Bookmarks");
}

function chromeProfileHistoryPath(profileDir: string) {
  return path.join(profileDir, "History");
}

function chromeProfileCookiesPath(profileDir: string) {
  const candidates = [
    path.join(profileDir, "Network", "Cookies"),
    path.join(profileDir, "Cookies"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function chromeProfileHasImportableData(profileDir: string) {
  return (
    existsSync(chromeProfileBookmarksPath(profileDir)) ||
    existsSync(chromeProfileHistoryPath(profileDir)) ||
    Boolean(chromeProfileCookiesPath(profileDir))
  );
}

function chromeProfileLabelFromInfo(
  info: Record<string, unknown> | null | undefined,
  profileId: string,
) {
  const candidates = [
    typeof info?.name === "string" ? info.name.trim() : "",
    typeof info?.shortcut_name === "string" ? info.shortcut_name.trim() : "",
    typeof info?.gaia_name === "string" ? info.gaia_name.trim() : "",
    typeof info?.user_name === "string" ? info.user_name.trim() : "",
  ];
  return candidates.find(Boolean) || profileId;
}

async function selectChromiumFamilyProfileDirectory(
  browser: ChromiumFamilyBrowser,
  defaultPath: string | null,
): Promise<string | null> {
  const browserDisplayName = chromiumFamilyDisplayName(browser);
  const options: OpenDialogOptions = {
    title: `Select ${browserDisplayName} Profile Folder`,
    buttonLabel: "Import From This Profile",
    properties: ["openDirectory"],
    defaultPath: defaultPath ?? undefined,
    message:
      `Choose a ${browserDisplayName} profile folder such as Default or Profile 1.`,
  };
  const ownerWindow =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0]?.trim() || null;
}

async function readChromiumFamilyProfileMetadata(userDataDir: string | null) {
  const parsedLocalState =
    userDataDir && existsSync(chromeLocalStatePath(userDataDir))
      ? await readJsonFile<Record<string, unknown>>(
          chromeLocalStatePath(userDataDir),
          {},
        )
      : {};
  const profileSection =
    parsedLocalState.profile &&
    typeof parsedLocalState.profile === "object" &&
    !Array.isArray(parsedLocalState.profile)
      ? (parsedLocalState.profile as Record<string, unknown>)
      : {};
  const infoCache =
    profileSection.info_cache &&
    typeof profileSection.info_cache === "object" &&
    !Array.isArray(profileSection.info_cache)
      ? (profileSection.info_cache as Record<string, Record<string, unknown>>)
      : {};
  const lastUsedProfileId =
    typeof profileSection.last_used === "string"
      ? profileSection.last_used.trim()
      : "";
  const lastActiveProfiles = Array.isArray(profileSection.last_active_profiles)
    ? profileSection.last_active_profiles
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];
  return {
    infoCache,
    lastUsedProfileId,
    lastActiveProfiles,
  };
}

async function discoverChromiumFamilyImportProfiles(
  browser: ChromiumFamilyBrowser,
): Promise<{
  userDataDir: string | null;
  infoCache: Record<string, Record<string, unknown>>;
  profiles: ChromiumProfileSelection[];
}> {
  const userDataDir = resolveChromiumFamilyUserDataRoot(browser);
  const { infoCache, lastUsedProfileId, lastActiveProfiles } =
    await readChromiumFamilyProfileMetadata(userDataDir);

  if (userDataDir && existsSync(userDataDir)) {
    const candidateProfileIds = new Set<string>();
    if (lastUsedProfileId) {
      candidateProfileIds.add(lastUsedProfileId);
    }
    for (const profileId of lastActiveProfiles) {
      candidateProfileIds.add(profileId);
    }
    candidateProfileIds.add("Default");

    try {
      const childEntries = await fs.readdir(userDataDir, {
        withFileTypes: true,
      });
      for (const entry of childEntries) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (BROWSER_IMPORT_PROFILE_DIR_PATTERNS.some((pattern) => pattern.test(entry.name))) {
          candidateProfileIds.add(entry.name);
        }
      }
    } catch {
      // Fall back to Local State candidates below.
    }

    const importableProfiles: ChromiumProfileSelection[] = [];
    for (const profileId of candidateProfileIds) {
      const profileDir = path.join(userDataDir, profileId);
      if (!existsSync(profileDir) || !chromeProfileHasImportableData(profileDir)) {
        continue;
      }
      importableProfiles.push({
        browser,
        userDataDir,
        profileId,
        profileDir,
        profileLabel: chromeProfileLabelFromInfo(infoCache[profileId], profileId),
      });
    }
    return {
      userDataDir,
      infoCache,
      profiles: importableProfiles,
    };
  }

  return {
    userDataDir,
    infoCache,
    profiles: [],
  };
}

function matchChromiumProfileByDirectory(
  profiles: ChromiumProfileSelection[],
  selectedProfileDir: string,
) {
  const selectedProfileId = path.basename(selectedProfileDir);
  return (
    profiles.find(
      (profile) =>
        profile.profileDir === selectedProfileDir ||
        profile.profileId === selectedProfileId,
    ) ?? null
  );
}

async function resolveChromiumFamilyProfileSelection(
  browser: ChromiumFamilyBrowser,
  preferredProfileDir?: string | null,
): Promise<ChromiumProfileSelection | null> {
  const { userDataDir, infoCache, profiles } =
    await discoverChromiumFamilyImportProfiles(browser);

  const preferredDir =
    typeof preferredProfileDir === "string" ? preferredProfileDir.trim() : "";
  if (preferredDir) {
    const matched = matchChromiumProfileByDirectory(profiles, preferredDir);
    if (matched) {
      return matched;
    }
    if (!chromeProfileHasImportableData(preferredDir)) {
      throw new Error(
        "Selected profile does not contain importable bookmarks, history, or cookies.",
      );
    }
    const selectedProfileId = path.basename(preferredDir);
    return {
      browser,
      userDataDir: path.dirname(preferredDir),
      profileId: selectedProfileId,
      profileDir: preferredDir,
      profileLabel: chromeProfileLabelFromInfo(
        infoCache[selectedProfileId],
        selectedProfileId,
      ),
    };
  }

  if (profiles.length === 1) {
    return profiles[0];
  }

  if (profiles.length > 1) {
    const selectedProfileDir = await selectChromiumFamilyProfileDirectory(
      browser,
      userDataDir,
    );
    if (!selectedProfileDir) {
      return null;
    }
    const matchedProfile = matchChromiumProfileByDirectory(
      profiles,
      selectedProfileDir,
    );
    if (matchedProfile) {
      return matchedProfile;
    }
    if (!chromeProfileHasImportableData(selectedProfileDir)) {
      throw new Error(
        "Selected profile does not contain importable bookmarks, history, or cookies.",
      );
    }

    const selectedProfileId = path.basename(selectedProfileDir);
    return {
      browser,
      userDataDir: path.dirname(selectedProfileDir),
      profileId: selectedProfileId,
      profileDir: selectedProfileDir,
      profileLabel: chromeProfileLabelFromInfo(
        infoCache[selectedProfileId],
        selectedProfileId,
      ),
    };
  }

  const selectedProfileDir = await selectChromiumFamilyProfileDirectory(
    browser,
    userDataDir,
  );
  if (!selectedProfileDir) {
    return null;
  }

  const profileId = path.basename(selectedProfileDir);
  const resolvedUserDataDir = path.dirname(selectedProfileDir);
  return {
    browser,
    userDataDir: resolvedUserDataDir,
    profileId,
    profileDir: selectedProfileDir,
    profileLabel: chromeProfileLabelFromInfo(infoCache[profileId], profileId),
  };
}

async function resolveChromeProfileSelection(): Promise<ChromiumProfileSelection | null> {
  return resolveChromiumFamilyProfileSelection("chrome");
}

async function listImportBrowserProfiles(
  source: BrowserImportSource,
): Promise<BrowserImportProfileOptionPayload[]> {
  if (source === "safari") {
    return [];
  }
  const { profiles } = await discoverChromiumFamilyImportProfiles(source);
  return profiles.map((profile) => ({
    profileId: profile.profileId,
    profileLabel: profile.profileLabel,
    profileDir: profile.profileDir,
  }));
}

function parseChromeTimestampMicros(rawValue: string | number | bigint | null | undefined) {
  if (
    rawValue == null ||
    rawValue === "" ||
    rawValue === 0 ||
    rawValue === 0n
  ) {
    return null;
  }
  try {
    return BigInt(rawValue);
  } catch {
    return null;
  }
}

function chromeTimestampMicrosToIso(
  rawValue: string | number | bigint | null | undefined,
) {
  const micros = parseChromeTimestampMicros(rawValue);
  if (!micros || micros <= 0n) {
    return null;
  }
  const unixMicros = micros - 11644473600000000n;
  if (unixMicros <= 0n) {
    return null;
  }
  return new Date(Number(unixMicros / 1000n)).toISOString();
}

function importedCookieUrl(
  hostKey: string,
  cookiePath: string,
  secure: boolean,
) {
  const normalizedHost = hostKey.trim().replace(/^\.+/, "");
  if (!normalizedHost) {
    return null;
  }
  try {
    return new URL(
      `${secure ? "https" : "http"}://${normalizedHost}${cookiePath || "/"}`,
    ).toString();
  } catch {
    return null;
  }
}

function chromeSameSiteToElectronSameSite(
  value: number | null | undefined,
): "unspecified" | "no_restriction" | "lax" | "strict" {
  switch (value) {
    case 0:
      return "no_restriction";
    case 1:
      return "lax";
    case 2:
      return "strict";
    default:
      return "unspecified";
  }
}

function chromeEncryptedCookieVersion(encryptedValue: Buffer) {
  if (encryptedValue.length < 3) {
    return null;
  }
  const prefix = encryptedValue.subarray(0, 3).toString("utf8");
  return /^v\d\d$/.test(prefix) ? prefix : null;
}

function readChromeSafeStoragePasswordMac() {
  for (const serviceName of CHROME_COOKIE_SAFE_STORAGE_SERVICE_NAMES) {
    for (const accountName of CHROME_COOKIE_SAFE_STORAGE_ACCOUNT_NAMES) {
      try {
        const password = execFileSync(
          "security",
          [
            "find-generic-password",
            "-w",
            "-s",
            serviceName,
            "-a",
            accountName,
          ],
          { encoding: "utf8" },
        ).trim();
        if (password) {
          return password;
        }
      } catch {
        // Try the next service/account pair.
      }
    }

    try {
      const password = execFileSync(
        "security",
        ["find-generic-password", "-w", "-s", serviceName],
        { encoding: "utf8" },
      ).trim();
      if (password) {
        return password;
      }
    } catch {
      // Try the next service name.
    }
  }

  throw new Error(
    "Chrome Safe Storage key was not found in the macOS keychain.",
  );
}

function readChromeWindowsEncryptedKey(userDataDir: string) {
  const localStatePath = chromeLocalStatePath(userDataDir);
  if (!existsSync(localStatePath)) {
    throw new Error("Chrome Local State was not found.");
  }
  const parsed = JSON.parse(
    readFileSync(localStatePath, "utf8"),
  ) as Record<string, unknown>;
  const osCrypt =
    parsed.os_crypt &&
    typeof parsed.os_crypt === "object" &&
    !Array.isArray(parsed.os_crypt)
      ? (parsed.os_crypt as Record<string, unknown>)
      : null;
  const encodedKey =
    typeof osCrypt?.encrypted_key === "string"
      ? osCrypt.encrypted_key.trim()
      : "";
  if (!encodedKey) {
    throw new Error("Chrome Local State did not contain os_crypt.encrypted_key.");
  }
  const encryptedKeyWithHeader = Buffer.from(encodedKey, "base64");
  const header = Buffer.from(CHROME_WINDOWS_DPAPI_KEY_PREFIX, "utf8");
  if (!encryptedKeyWithHeader.subarray(0, header.length).equals(header)) {
    throw new Error("Chrome os_crypt.encrypted_key did not use the DPAPI format.");
  }
  return encryptedKeyWithHeader.subarray(header.length);
}

function runPowerShellScriptSync(command: string) {
  const shells = ["powershell.exe", "powershell"];
  let lastError: unknown = null;
  for (const shellName of shells) {
    try {
      return execFileSync(
        shellName,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          command,
        ],
        { encoding: "utf8" },
      ).trim();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("PowerShell was not available.");
}

function decryptWindowsDpapi(input: Buffer) {
  const base64Input = input.toString("base64");
  const command = [
    "$ErrorActionPreference='Stop'",
    `Add-Type -AssemblyName System.Security`,
    `$bytes=[Convert]::FromBase64String('${base64Input}')`,
    `$plaintext=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    `[Convert]::ToBase64String($plaintext)`,
  ].join(";");
  const output = runPowerShellScriptSync(command);
  if (!output) {
    throw new Error("Windows DPAPI decryption returned an empty result.");
  }
  return Buffer.from(output, "base64");
}

function decryptChromeCookieValueWindows(
  encryptedValue: Buffer,
  encryptionKey: Buffer,
) {
  const version = chromeEncryptedCookieVersion(encryptedValue);
  if (!version || !CHROME_WINDOWS_COOKIE_AEAD_PREFIXES.has(version)) {
    throw new Error("Unsupported Windows Chrome cookie encryption format.");
  }
  const nonceOffset = version.length;
  const nonceLength = 12;
  const authTagLength = 16;
  if (encryptedValue.length <= nonceOffset + nonceLength + authTagLength) {
    throw new Error("Windows Chrome cookie value was too short to decrypt.");
  }
  const nonce = encryptedValue.subarray(nonceOffset, nonceOffset + nonceLength);
  const encryptedPayload = encryptedValue.subarray(nonceOffset + nonceLength);
  const ciphertext = encryptedPayload.subarray(
    0,
    encryptedPayload.length - authTagLength,
  );
  const authTag = encryptedPayload.subarray(
    encryptedPayload.length - authTagLength,
  );
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
}

function decryptChromeCookieValueMac(
  encryptedValue: Buffer,
  safeStoragePassword: string,
) {
  const version = chromeEncryptedCookieVersion(encryptedValue);
  if (!version) {
    throw new Error("Unsupported Chrome cookie encryption format.");
  }
  const key = pbkdf2Sync(
    safeStoragePassword,
    CHROME_COOKIE_PBKDF2_SALT,
    1003,
    16,
    "sha1",
  );
  const decipher = createDecipheriv(
    "aes-128-cbc",
    key,
    CHROME_COOKIE_CBC_IV,
  );
  decipher.setAutoPadding(true);
  return Buffer.concat([
    decipher.update(encryptedValue.subarray(version.length)),
    decipher.final(),
  ]);
}

function stripChromeCookieDomainHashPrefix(
  hostKey: string,
  decryptedValue: Buffer,
) {
  const domainHash = createHash("sha256").update(hostKey, "utf8").digest();
  if (
    decryptedValue.length >= domainHash.length &&
    decryptedValue.subarray(0, domainHash.length).equals(domainHash)
  ) {
    return decryptedValue.subarray(domainHash.length);
  }
  return decryptedValue;
}

function decodeChromeCookieValue(
  hostKey: string,
  decryptedValue: Buffer,
) {
  const valueBytes = stripChromeCookieDomainHashPrefix(hostKey, decryptedValue);
  return valueBytes.toString("utf8");
}

function collectChromeBookmarkEntries(
  node: ChromeBookmarkNodePayload,
  bucket: BrowserBookmarkPayload[],
) {
  if (node.type === "url" && typeof node.url === "string" && node.url.trim()) {
    bucket.push({
      id: `bookmark-import-${randomUUID()}`,
      url: node.url.trim(),
      title: typeof node.name === "string" && node.name.trim()
        ? node.name.trim()
        : node.url.trim(),
      createdAt: chromeTimestampMicrosToIso(node.date_added) ?? utcNowIso(),
    });
    return;
  }

  if (!Array.isArray(node.children)) {
    return;
  }
  for (const child of node.children) {
    if (child && typeof child === "object") {
      collectChromeBookmarkEntries(child, bucket);
    }
  }
}

async function readChromeBookmarks(
  profileDir: string,
): Promise<BrowserBookmarkPayload[]> {
  const bookmarksPath = chromeProfileBookmarksPath(profileDir);
  if (!existsSync(bookmarksPath)) {
    return [];
  }

  const parsed = await readJsonFile<Record<string, unknown>>(bookmarksPath, {});
  const roots =
    parsed.roots && typeof parsed.roots === "object" && !Array.isArray(parsed.roots)
      ? (parsed.roots as Record<string, ChromeBookmarkNodePayload>)
      : {};
  const bookmarks: BrowserBookmarkPayload[] = [];
  for (const root of Object.values(roots)) {
    if (root && typeof root === "object") {
      collectChromeBookmarkEntries(root, bookmarks);
    }
  }
  return bookmarks;
}

async function copyChromeProfileDatabaseToTemp(
  sourcePath: string,
  tempPrefix: string,
) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const copiedPath = path.join(tempDir, path.basename(sourcePath));
  await fs.copyFile(sourcePath, copiedPath);
  for (const suffix of ["-wal", "-shm"]) {
    const sourceCompanionPath = `${sourcePath}${suffix}`;
    if (!existsSync(sourceCompanionPath)) {
      continue;
    }
    await fs.copyFile(
      sourceCompanionPath,
      `${copiedPath}${suffix}`,
    ).catch(() => undefined);
  }
  return {
    copiedPath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    },
  };
}

async function readChromeHistory(
  profileDir: string,
): Promise<BrowserHistoryEntryPayload[]> {
  const historyPath = chromeProfileHistoryPath(profileDir);
  if (!existsSync(historyPath)) {
    return [];
  }

  const { copiedPath, cleanup } = await copyChromeProfileDatabaseToTemp(
    historyPath,
    "holaboss-chrome-history-",
  );

  try {
    const database = new Database(copiedPath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      const rows = database
        .prepare(
          `
          SELECT
            url,
            title,
            visit_count,
            CAST(last_visit_time AS TEXT) AS last_visit_time
          FROM urls
          WHERE hidden = 0
          ORDER BY last_visit_time DESC
          LIMIT ?
        `,
        )
        .all(
          CHROME_HISTORY_IMPORT_LIMIT,
        ) as Array<{
          url: string;
          title: string | null;
          visit_count: number;
          last_visit_time: string;
        }>;

      return rows
        .map((row) => {
          const url = row.url.trim();
          if (!shouldTrackHistoryUrl(url)) {
            return null;
          }
          const lastVisitedAt =
            chromeTimestampMicrosToIso(row.last_visit_time) ?? utcNowIso();
          return {
            id: `history-import-${randomUUID()}`,
            url,
            title: row.title?.trim() || url,
            visitCount:
              Number.isFinite(row.visit_count) && row.visit_count > 0
                ? row.visit_count
                : 1,
            createdAt: lastVisitedAt,
            lastVisitedAt,
          } satisfies BrowserHistoryEntryPayload;
        })
        .filter(
          (entry): entry is BrowserHistoryEntryPayload => Boolean(entry),
        );
    } finally {
      database.close();
    }
  } finally {
    await cleanup();
  }
}

function mergeImportedBookmarksIntoWorkspace(
  workspace: BrowserWorkspaceState,
  importedBookmarks: BrowserBookmarkPayload[],
) {
  const bookmarkByUrl = new Map(
    workspace.bookmarks.map((bookmark) => [bookmark.url, bookmark] as const),
  );
  let changedCount = 0;

  for (const importedBookmark of importedBookmarks) {
    if (!shouldTrackHistoryUrl(importedBookmark.url)) {
      continue;
    }
    const existing = bookmarkByUrl.get(importedBookmark.url);
    if (!existing) {
      bookmarkByUrl.set(importedBookmark.url, importedBookmark);
      changedCount += 1;
      continue;
    }

    const nextTitle = importedBookmark.title?.trim() || existing.title;
    const nextCreatedAt = existing.createdAt || importedBookmark.createdAt;
    if (nextTitle !== existing.title || nextCreatedAt !== existing.createdAt) {
      bookmarkByUrl.set(importedBookmark.url, {
        ...existing,
        title: nextTitle,
        createdAt: nextCreatedAt,
      });
      changedCount += 1;
    }
  }

  workspace.bookmarks = Array.from(bookmarkByUrl.values()).sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  return changedCount;
}

function mergeImportedHistoryIntoWorkspace(
  workspace: BrowserWorkspaceState,
  importedHistoryEntries: BrowserHistoryEntryPayload[],
) {
  const historyByUrl = new Map(
    workspace.history.map((entry) => [entry.url, entry] as const),
  );
  let changedCount = 0;

  for (const importedEntry of importedHistoryEntries) {
    if (!shouldTrackHistoryUrl(importedEntry.url)) {
      continue;
    }
    const existing = historyByUrl.get(importedEntry.url);
    if (!existing) {
      historyByUrl.set(importedEntry.url, importedEntry);
      changedCount += 1;
      continue;
    }

    const nextLastVisitedAt =
      new Date(importedEntry.lastVisitedAt).getTime() >
        new Date(existing.lastVisitedAt).getTime()
        ? importedEntry.lastVisitedAt
        : existing.lastVisitedAt;
    const nextCreatedAt =
      new Date(importedEntry.createdAt).getTime() <
        new Date(existing.createdAt).getTime()
        ? importedEntry.createdAt
        : existing.createdAt;
    const nextVisitCount = Math.max(
      existing.visitCount,
      importedEntry.visitCount,
    );
    const nextTitle = importedEntry.title?.trim() || existing.title;
    if (
      nextLastVisitedAt !== existing.lastVisitedAt ||
      nextCreatedAt !== existing.createdAt ||
      nextVisitCount !== existing.visitCount ||
      nextTitle !== existing.title
    ) {
      historyByUrl.set(importedEntry.url, {
        ...existing,
        title: nextTitle,
        createdAt: nextCreatedAt,
        lastVisitedAt: nextLastVisitedAt,
        visitCount: nextVisitCount,
      });
      changedCount += 1;
    }
  }

  workspace.history = Array.from(historyByUrl.values())
    .sort(
      (left, right) =>
        new Date(right.lastVisitedAt).getTime() -
        new Date(left.lastVisitedAt).getTime(),
    )
    .slice(0, CHROME_HISTORY_IMPORT_LIMIT);
  return changedCount;
}

async function importChromiumFamilyCookiesIntoWorkspaceSession(
  browser: ChromiumFamilyBrowser,
  browserSession: Session,
  profileDir: string,
): Promise<BrowserCookieImportSummary> {
  const browserDisplayName = chromiumFamilyDisplayName(browser);
  const cookiesPath = chromeProfileCookiesPath(profileDir);
  if (!cookiesPath) {
    return {
      importedCount: 0,
      skippedCount: 0,
      warnings: [],
    };
  }

  if (process.platform !== "darwin" && process.platform !== "win32") {
    return {
      importedCount: 0,
      skippedCount: 0,
      warnings: [
        `Cookie import for ${browserDisplayName} is currently supported on macOS and Windows only. Bookmarks and history were still imported.`,
      ],
    };
  }

  let safeStoragePassword = "";
  let windowsEncryptionKey: Buffer | null = null;
  if (process.platform === "darwin") {
    try {
      safeStoragePassword = readChromeSafeStoragePasswordMac();
    } catch (error) {
      return {
        importedCount: 0,
        skippedCount: 0,
        warnings: [
          error instanceof Error
            ? error.message
            : `${browserDisplayName} cookie decryption key could not be loaded.`,
        ],
      };
    }
  } else if (process.platform === "win32") {
    try {
      const encryptedKey = readChromeWindowsEncryptedKey(path.dirname(profileDir));
      windowsEncryptionKey = decryptWindowsDpapi(encryptedKey);
    } catch (error) {
      return {
        importedCount: 0,
        skippedCount: 0,
        warnings: [
          error instanceof Error
            ? error.message
            : `${browserDisplayName} Windows cookie decryption key could not be loaded.`,
        ],
      };
    }
  }

  const { copiedPath, cleanup } = await copyChromeProfileDatabaseToTemp(
    cookiesPath,
    "holaboss-chrome-cookies-",
  );

  try {
    const database = new Database(copiedPath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      const rows = database
        .prepare(
          `
          SELECT
            host_key,
            name,
            value,
            path,
            CAST(expires_utc AS TEXT) AS expires_utc,
            is_secure,
            is_httponly,
            has_expires,
            is_persistent,
            samesite,
            encrypted_value
          FROM cookies
          ORDER BY host_key ASC, name ASC
        `,
        )
        .all() as Array<{
          host_key: string;
          name: string;
          value: string;
          path: string;
          expires_utc: string;
          is_secure: number;
          is_httponly: number;
          has_expires: number;
          is_persistent: number;
          samesite: number | null;
          encrypted_value: Buffer;
        }>;

      let importedCount = 0;
      let skippedCount = 0;
      const warnings = new Set<string>();

      for (const row of rows) {
        const cookieUrl = importedCookieUrl(
          row.host_key,
          row.path,
          Boolean(row.is_secure),
        );
        if (!cookieUrl || !row.name?.trim()) {
          skippedCount += 1;
          continue;
        }

        let cookieValue = row.value ?? "";
        if (!cookieValue) {
          try {
            const version = chromeEncryptedCookieVersion(row.encrypted_value);
            if (
              process.platform === "win32" &&
              version === CHROME_WINDOWS_APP_BOUND_COOKIE_PREFIX
            ) {
              throw new Error(
                "Some Windows Chrome cookies use App-Bound encryption and cannot be imported from a different desktop app.",
              );
            }
            const decryptedValue =
              process.platform === "win32"
                ? decryptChromeCookieValueWindows(
                    row.encrypted_value,
                    windowsEncryptionKey ?? Buffer.alloc(0),
                  )
                : decryptChromeCookieValueMac(
                    row.encrypted_value,
                    safeStoragePassword,
                  );
            cookieValue = decodeChromeCookieValue(
              row.host_key,
              decryptedValue,
            );
          } catch (error) {
            skippedCount += 1;
            warnings.add(
              error instanceof Error
                ? error.message
                : `Some ${browserDisplayName} cookies could not be decrypted.`,
            );
            continue;
          }
        }

        const expirationDate = chromeTimestampMicrosToIso(row.expires_utc);
        const expirationDateSeconds = expirationDate
          ? Math.floor(new Date(expirationDate).getTime() / 1000)
          : undefined;

        const cookiePayload = {
          url: cookieUrl,
          name: row.name.trim(),
          value: cookieValue,
          domain: row.host_key?.trim() || undefined,
          path: row.path?.trim() || "/",
          secure: Boolean(row.is_secure),
          httpOnly: Boolean(row.is_httponly),
          sameSite: chromeSameSiteToElectronSameSite(row.samesite),
          expirationDate: row.has_expires ? expirationDateSeconds : undefined,
        } as const;

        try {
          await browserSession.cookies.set(cookiePayload);
          importedCount += 1;
        } catch (error) {
          const normalizedDomain = cookiePayload.domain?.replace(/^\.+/, "");
          if (normalizedDomain && normalizedDomain !== cookiePayload.domain) {
            try {
              await browserSession.cookies.set({
                ...cookiePayload,
                domain: normalizedDomain,
              });
              importedCount += 1;
              continue;
            } catch {
              // Fall through to warning path below.
            }
          }
          skippedCount += 1;
          warnings.add(
            error instanceof Error
              ? error.message
              : `Some ${browserDisplayName} cookies could not be imported into Electron.`,
          );
        }
      }

      await browserSession.cookies.flushStore();
      return {
        importedCount,
        skippedCount,
        warnings: Array.from(warnings),
      };
    } finally {
      database.close();
    }
  } finally {
    await cleanup();
  }
}

async function importChromeCookiesIntoWorkspaceSession(
  browserSession: Session,
  profileDir: string,
): Promise<BrowserCookieImportSummary> {
  return importChromiumFamilyCookiesIntoWorkspaceSession(
    "chrome",
    browserSession,
    profileDir,
  );
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function stripHtmlTags(value: string) {
  return value.replace(/<[^>]*>/g, " ");
}

function parseImportedVisitTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(trimmed)) {
      return parseImportedVisitTimestamp(numeric);
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (value >= 11644473600000000) {
    return chromeTimestampMicrosToIso(Math.floor(value)) ?? null;
  }

  if (value > 10_000_000_000_000) {
    return new Date(Math.floor(value / 1000)).toISOString();
  }

  if (value > 10_000_000_000) {
    return new Date(Math.floor(value)).toISOString();
  }

  return new Date(Math.floor(value * 1000)).toISOString();
}

function zipEntryBasename(entryName: string) {
  const normalized = entryName.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return (segments[segments.length - 1] || "").toLowerCase();
}

function parseSafariBookmarksFromHtml(html: string): BrowserBookmarkPayload[] {
  const bookmarks: BrowserBookmarkPayload[] = [];
  const anchorPattern =
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const url = (match[1] || "").trim();
    if (!shouldTrackHistoryUrl(url)) {
      continue;
    }
    const cleanedTitle = decodeHtmlEntities(
      stripHtmlTags(match[2] || "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    bookmarks.push({
      id: `bookmark-import-${randomUUID()}`,
      url,
      title: cleanedTitle || url,
      createdAt: utcNowIso(),
    });
  }
  return bookmarks;
}

function safariHistoryObjectString(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return "";
}

function safariHistoryObjectNumber(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === "string") {
      const parsed = Number(raw.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function collectSafariHistoryEntries(
  value: unknown,
  bucket: BrowserHistoryEntryPayload[],
) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSafariHistoryEntries(entry, bucket);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const url = safariHistoryObjectString(record, ["url", "URL"]);
  if (url && shouldTrackHistoryUrl(url)) {
    const title =
      safariHistoryObjectString(record, [
        "title",
        "Title",
        "pageTitle",
        "page_title",
      ]) || url;
    const visitCountRaw = safariHistoryObjectNumber(record, [
      "visit_count",
      "visitCount",
      "visit_count_total",
    ]);
    const visitCount =
      visitCountRaw && visitCountRaw > 0 ? Math.floor(visitCountRaw) : 1;
    const lastVisitedAt =
      parseImportedVisitTimestamp(
        record.lastVisitedAt ??
          record.last_visited_at ??
          record.lastVisitTime ??
          record.last_visit_time ??
          record.visitedAt ??
          record.visited_at ??
          record.visit_time ??
          record.visitTime ??
          record.timestamp,
      ) ?? utcNowIso();
    bucket.push({
      id: `history-import-${randomUUID()}`,
      url,
      title,
      visitCount,
      createdAt: lastVisitedAt,
      lastVisitedAt,
    });
  }

  for (const nestedValue of Object.values(record)) {
    if (nestedValue && typeof nestedValue === "object") {
      collectSafariHistoryEntries(nestedValue, bucket);
    }
  }
}

function parseSafariHistoryEntriesFromJson(
  jsonContent: string,
): BrowserHistoryEntryPayload[] {
  const parsed = JSON.parse(jsonContent) as unknown;
  const entries: BrowserHistoryEntryPayload[] = [];
  collectSafariHistoryEntries(parsed, entries);
  return entries.slice(0, CHROME_HISTORY_IMPORT_LIMIT);
}

async function selectSafariExportArchivePath(): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: "Select Safari Export ZIP",
    buttonLabel: "Import Safari Export",
    properties: ["openFile"],
    filters: [{ name: "ZIP files", extensions: ["zip"] }],
    defaultPath: path.join(os.homedir(), "Downloads"),
    message:
      "Choose a Safari export zip that contains Bookmarks.html and History.json.",
  };
  const ownerWindow =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0]?.trim() || null;
}

async function readSafariExportArchive(
  archivePath: string,
): Promise<{
  bookmarks: BrowserBookmarkPayload[];
  history: BrowserHistoryEntryPayload[];
}> {
  const zipBuffer = await fs.readFile(archivePath);
  const zip = await JSZip.loadAsync(zipBuffer);

  let bookmarksHtmlContent = "";
  let historyJsonContent = "";
  for (const zipEntry of Object.values(zip.files)) {
    if (zipEntry.dir) {
      continue;
    }
    const basename = zipEntryBasename(zipEntry.name);
    if (!bookmarksHtmlContent && basename === SAFARI_EXPORT_BOOKMARKS_FILE_NAME) {
      bookmarksHtmlContent = await zipEntry.async("string");
      continue;
    }
    if (!historyJsonContent && basename === SAFARI_EXPORT_HISTORY_FILE_NAME) {
      historyJsonContent = await zipEntry.async("string");
    }
  }

  if (!bookmarksHtmlContent && !historyJsonContent) {
    throw new Error(
      "Safari export zip did not include Bookmarks.html or History.json.",
    );
  }

  return {
    bookmarks: bookmarksHtmlContent
      ? parseSafariBookmarksFromHtml(bookmarksHtmlContent)
      : [],
    history: historyJsonContent
      ? parseSafariHistoryEntriesFromJson(historyJsonContent)
      : [],
  };
}

async function copyCookiesBetweenBrowserSessions(
  sourceSession: Session,
  targetSession: Session,
): Promise<BrowserCookieImportSummary> {
  await targetSession.clearStorageData({ storages: ["cookies"] });

  const sourceCookies = await sourceSession.cookies.get({});
  let importedCount = 0;
  let skippedCount = 0;
  const warnings = new Set<string>();

  for (const cookie of sourceCookies) {
    const cookieUrl = importedCookieUrl(
      cookie.domain || "",
      cookie.path || "/",
      Boolean(cookie.secure),
    );
    if (!cookieUrl || !cookie.name?.trim()) {
      skippedCount += 1;
      continue;
    }
    try {
      await targetSession.cookies.set({
        url: cookieUrl,
        name: cookie.name.trim(),
        value: cookie.value ?? "",
        domain: cookie.domain || undefined,
        path: cookie.path || "/",
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite ?? "unspecified",
        expirationDate:
          typeof cookie.expirationDate === "number" &&
            Number.isFinite(cookie.expirationDate)
            ? cookie.expirationDate
            : undefined,
      });
      importedCount += 1;
    } catch (error) {
      skippedCount += 1;
      warnings.add(
        error instanceof Error
          ? error.message
          : "Some cookies could not be copied into the target workspace.",
      );
    }
  }

  await targetSession.cookies.flushStore();
  return {
    importedCount,
    skippedCount,
    warnings: Array.from(warnings),
  };
}

function cloneBrowserBookmarkPayload(
  bookmark: BrowserBookmarkPayload,
): BrowserBookmarkPayload {
  return {
    id: `bookmark-import-${randomUUID()}`,
    url: bookmark.url,
    title: bookmark.title,
    faviconUrl: bookmark.faviconUrl,
    createdAt: bookmark.createdAt,
  };
}

function cloneBrowserHistoryEntryPayload(
  entry: BrowserHistoryEntryPayload,
): BrowserHistoryEntryPayload {
  return {
    id: `history-import-${randomUUID()}`,
    url: entry.url,
    title: entry.title,
    faviconUrl: entry.faviconUrl,
    visitCount: entry.visitCount,
    createdAt: entry.createdAt,
    lastVisitedAt: entry.lastVisitedAt,
  };
}

function cloneBrowserDownloadPayload(
  download: BrowserDownloadPayload,
): BrowserDownloadPayload {
  return {
    ...download,
    id: `download-import-${randomUUID()}`,
  };
}

async function importChromiumFamilyProfileIntoWorkspace(
  browser: ChromiumFamilyBrowser,
  workspaceId?: string | null,
  profileDir?: string | null,
): Promise<BrowserImportSummary | null> {
  const workspace = await ensureBrowserWorkspace(workspaceId, activeBrowserSpaceId);
  if (!workspace) {
    throw new Error("Choose a workspace before importing browser data.");
  }
  const browserDisplayName = chromiumFamilyDisplayName(browser);

  const selection = await resolveChromiumFamilyProfileSelection(
    browser,
    profileDir,
  );
  if (!selection) {
    return null;
  }

  const importedBookmarks = await readChromeBookmarks(selection.profileDir);
  const importedHistoryEntries = await readChromeHistory(selection.profileDir);
  const bookmarkCount = mergeImportedBookmarksIntoWorkspace(
    workspace,
    importedBookmarks,
  );
  const historyCount = mergeImportedHistoryIntoWorkspace(
    workspace,
    importedHistoryEntries,
  );
  const cookieSummary = await importChromiumFamilyCookiesIntoWorkspaceSession(
    browser,
    workspace.session,
    selection.profileDir,
  );

  if (
    bookmarkCount === 0 &&
    historyCount === 0 &&
    cookieSummary.importedCount === 0 &&
    cookieSummary.warnings.length === 0
  ) {
    throw new Error(
      `No importable bookmarks, history, or cookies were found in that ${browserDisplayName} profile.`,
    );
  }

  emitBookmarksState(workspace.workspaceId);
  emitHistoryState(workspace.workspaceId);
  await persistBrowserWorkspace(workspace.workspaceId);

  return {
    sourceKind: browser,
    sourceLabel: `${browserDisplayName} ${selection.profileLabel}`,
    sourcePath: selection.profileDir,
    sourceProfileDir: selection.profileDir,
    sourceProfileLabel: selection.profileLabel,
    importedBookmarks: bookmarkCount,
    importedHistoryEntries: historyCount,
    importedCookies: cookieSummary.importedCount,
    skippedCookies: cookieSummary.skippedCount,
    warnings: cookieSummary.warnings,
  };
}

async function importSafariProfileIntoWorkspace(
  workspaceId?: string | null,
  safariArchivePath?: string | null,
): Promise<BrowserImportSummary | null> {
  const workspace = await ensureBrowserWorkspace(workspaceId, activeBrowserSpaceId);
  if (!workspace) {
    throw new Error("Choose a workspace before importing browser data.");
  }

  const archivePath =
    typeof safariArchivePath === "string" && safariArchivePath.trim()
      ? safariArchivePath.trim()
      : await selectSafariExportArchivePath();
  if (!archivePath) {
    return null;
  }

  const safariExport = await readSafariExportArchive(archivePath);
  const bookmarkCount = mergeImportedBookmarksIntoWorkspace(
    workspace,
    safariExport.bookmarks,
  );
  const historyCount = mergeImportedHistoryIntoWorkspace(
    workspace,
    safariExport.history,
  );

  if (bookmarkCount === 0 && historyCount === 0) {
    throw new Error(
      "No importable bookmarks or history entries were found in that Safari export.",
    );
  }

  emitBookmarksState(workspace.workspaceId);
  emitHistoryState(workspace.workspaceId);
  await persistBrowserWorkspace(workspace.workspaceId);

  return {
    sourceKind: "safari",
    sourceLabel: `Safari export ${path.basename(archivePath)}`,
    sourcePath: archivePath,
    sourceProfileDir: archivePath,
    sourceProfileLabel: path.basename(archivePath),
    importedBookmarks: bookmarkCount,
    importedHistoryEntries: historyCount,
    importedCookies: 0,
    skippedCookies: 0,
    warnings: [
      "Safari export files include bookmarks and history only. Cookies and login sessions are not included.",
    ],
  };
}

async function copyBrowserWorkspaceProfile(
  payload: BrowserCopyWorkspaceProfilePayload,
): Promise<BrowserImportSummary> {
  const sourceWorkspaceId = payload.sourceWorkspaceId.trim();
  const targetWorkspaceId = payload.targetWorkspaceId.trim();
  if (!sourceWorkspaceId || !targetWorkspaceId) {
    throw new Error("Both source and target workspaces are required.");
  }
  if (sourceWorkspaceId === targetWorkspaceId) {
    throw new Error("Choose a different source workspace to copy from.");
  }

  const sourceWorkspace = await ensureBrowserWorkspace(sourceWorkspaceId, "user");
  const targetWorkspace = await ensureBrowserWorkspace(targetWorkspaceId, "user");
  if (!sourceWorkspace || !targetWorkspace) {
    throw new Error("Could not resolve source and target workspace browser state.");
  }

  targetWorkspace.bookmarks = sourceWorkspace.bookmarks.map(
    cloneBrowserBookmarkPayload,
  );
  targetWorkspace.history = sourceWorkspace.history.map(
    cloneBrowserHistoryEntryPayload,
  );
  targetWorkspace.downloads = sourceWorkspace.downloads.map(
    cloneBrowserDownloadPayload,
  );

  for (const browserSpace of BROWSER_SPACE_IDS) {
    const sourceSpace = sourceWorkspace.spaces[browserSpace];
    const targetSpace = targetWorkspace.spaces[browserSpace];
    for (const tab of targetSpace.tabs.values()) {
      closeBrowserTabRecord(tab);
    }
    targetSpace.tabs.clear();

    const tabIdMap = new Map<string, string>();
    for (const sourceTab of sourceSpace.tabs.values()) {
      const copiedTabId = createBrowserTab(targetWorkspaceId, {
        browserSpace,
        url: sourceTab.state.url || HOME_URL,
        title: sourceTab.state.title || NEW_TAB_TITLE,
        faviconUrl: sourceTab.state.faviconUrl,
        skipInitialHistoryRecord: true,
      });
      if (copiedTabId) {
        tabIdMap.set(sourceTab.state.id, copiedTabId);
      }
    }

    if (targetSpace.tabs.size === 0) {
      ensureBrowserTabSpaceInitialized(targetWorkspaceId, browserSpace);
    }
    const mappedActiveTabId = tabIdMap.get(sourceSpace.activeTabId || "");
    targetSpace.activeTabId =
      (mappedActiveTabId && targetSpace.tabs.has(mappedActiveTabId)
        ? mappedActiveTabId
        : Array.from(targetSpace.tabs.keys())[0]) || "";
  }

  const cookieSummary = await copyCookiesBetweenBrowserSessions(
    sourceWorkspace.session,
    targetWorkspace.session,
  );

  if (targetWorkspaceId === activeBrowserWorkspaceId) {
    updateAttachedBrowserView();
    emitBrowserState(targetWorkspaceId, activeBrowserSpaceId);
  }
  emitBookmarksState(targetWorkspaceId);
  emitDownloadsState(targetWorkspaceId);
  emitHistoryState(targetWorkspaceId);
  await persistBrowserWorkspace(targetWorkspaceId);

  return {
    sourceKind: "workspace_copy",
    sourceLabel: sourceWorkspaceId,
    sourcePath: sourceWorkspaceId,
    sourceProfileDir: sourceWorkspaceId,
    sourceProfileLabel: sourceWorkspaceId,
    importedBookmarks: targetWorkspace.bookmarks.length,
    importedHistoryEntries: targetWorkspace.history.length,
    importedCookies: cookieSummary.importedCount,
    skippedCookies: cookieSummary.skippedCount,
    warnings: cookieSummary.warnings,
  };
}

async function importBrowserProfileIntoWorkspace(
  payload: BrowserImportProfilePayload,
): Promise<BrowserImportSummary | null> {
  const source = payload.source;
  const workspaceId = payload.workspaceId;
  if (source === "safari") {
    return importSafariProfileIntoWorkspace(workspaceId, payload.safariArchivePath);
  }
  return importChromiumFamilyProfileIntoWorkspace(
    source,
    workspaceId,
    payload.profileDir,
  );
}

async function importChromeProfileIntoWorkspace(
  workspaceId?: string | null,
): Promise<BrowserImportSummary | null> {
  return importChromiumFamilyProfileIntoWorkspace("chrome", workspaceId);
}

function browserChromeLikePlatformToken(): string {
  switch (process.platform) {
    case "darwin":
      return "Macintosh; Intel Mac OS X 10_15_7";
    case "win32":
      return "Windows NT 10.0; Win64; x64";
    default:
      return "X11; Linux x86_64";
  }
}

function browserAcceptedLanguages(): string {
  const locale = app.getLocale().trim().replace(/_/g, "-");
  const preferred = [locale, "en-US", "en"].filter(Boolean);
  return [...new Set(preferred)].join(",");
}

function browserNativeIdentity(session: Session): BrowserSessionIdentity {
  const nativeUserAgent = session.getUserAgent().trim();
  const chromeVersion = (process.versions.chrome || "141.0.0.0").trim();
  return {
    userAgent:
      nativeUserAgent ||
      `Mozilla/5.0 (${browserChromeLikePlatformToken()}) AppleWebKit/537.36 ` +
        `(KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`,
    acceptLanguages: browserAcceptedLanguages(),
  };
}

function setRequestHeaderValue(
  headers: Record<string, string>,
  headerName: string,
  value: string,
): Record<string, string> {
  const normalized = headerName.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalized && key !== headerName) {
      delete headers[key];
    }
  }
  headers[headerName] = value;
  return headers;
}

function configureBrowserWorkspaceSession(
  session: Session,
): BrowserSessionIdentity {
  const browserIdentity = browserNativeIdentity(session);
  session.setUserAgent(
    browserIdentity.userAgent,
    browserIdentity.acceptLanguages,
  );
  session.webRequest.onBeforeSendHeaders(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      const requestHeaders = {
        ...details.requestHeaders,
      } as Record<string, string>;
      setRequestHeaderValue(
        requestHeaders,
        "Accept-Language",
        browserIdentity.acceptLanguages,
      );
      callback({ requestHeaders });
    },
  );
  return browserIdentity;
}

function fileBookmarksPath() {
  return path.join(app.getPath("userData"), "file-bookmarks.json");
}

function runtimeLogsPath() {
  return path.join(app.getPath("userData"), "runtime.log");
}

function authStorageConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function runtimeSandboxRoot() {
  return path.join(app.getPath("userData"), "sandbox-host");
}

function runtimeConfigPath() {
  return path.join(runtimeSandboxRoot(), "state", "runtime-config.json");
}

function runtimeModelCatalogCachePath() {
  return path.join(runtimeSandboxRoot(), "state", "runtime-model-catalog.json");
}

function runtimeDatabasePath() {
  return path.join(runtimeSandboxRoot(), "state", "runtime.db");
}

function runtimeWorkspaceRoot() {
  return path.join(runtimeSandboxRoot(), "workspace");
}

function diagnosticsBundleFileName(date = new Date()) {
  const timestamp = date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
  return `holaboss-diagnostics-${timestamp}.zip`;
}

async function exportDesktopDiagnosticsBundle() {
  const downloadsDir = app.getPath("downloads");
  const bundlePath = path.join(downloadsDir, diagnosticsBundleFileName());
  const { exportDiagnosticsBundle } = await import("./diagnostics-bundle.js");
  const result = await exportDiagnosticsBundle({
    bundlePath,
    runtimeLogPath: runtimeLogsPath(),
    runtimeDbPath: runtimeDatabasePath(),
    runtimeConfigPath: runtimeConfigPath(),
    summary: {
      exported_at: utcNowIso(),
      app_version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      versions: {
        chrome: process.versions.chrome,
        electron: process.versions.electron,
        node: process.versions.node,
      },
      runtime_status: runtimeStatus,
    },
  });
  shell.showItemInFolder(result.bundlePath);
  return result;
}

function processIsAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminatePid(pid: number, signal: NodeJS.Signals) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(pid, signal);
  } catch {
    // ignore
  }
}

function utcNowIso() {
  return new Date().toISOString();
}

function openRuntimeDatabase() {
  const database = new Database(runtimeDatabasePath());
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  return database;
}

function migrateLocalWorkspacesTable(database: Database.Database) {
  const tableInfo = database
    .prepare("PRAGMA table_info(workspaces)")
    .all() as Array<{ name: string }>;
  const columns = new Set(tableInfo.map((column) => column.name));
  if (!columns.has("holaboss_user_id")) {
    database.exec("DROP INDEX IF EXISTS idx_workspaces_user_updated;");
    return;
  }

  database.exec(`
    DROP INDEX IF EXISTS idx_workspaces_user_updated;
    ALTER TABLE workspaces RENAME TO workspaces_legacy_with_owner;

    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      harness TEXT,
      error_message TEXT,
      onboarding_status TEXT NOT NULL,
      onboarding_session_id TEXT,
      onboarding_completed_at TEXT,
      onboarding_completion_summary TEXT,
      onboarding_requested_at TEXT,
      onboarding_requested_by TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at_utc TEXT
    );

    INSERT INTO workspaces (
      id,
      name,
      status,
      harness,
      error_message,
      onboarding_status,
      onboarding_session_id,
      onboarding_completed_at,
      onboarding_completion_summary,
      onboarding_requested_at,
      onboarding_requested_by,
      created_at,
      updated_at,
      deleted_at_utc
    )
    SELECT
      id,
      name,
      status,
      harness,
      error_message,
      onboarding_status,
      onboarding_session_id,
      onboarding_completed_at,
      onboarding_completion_summary,
      onboarding_requested_at,
      onboarding_requested_by,
      created_at,
      updated_at,
      deleted_at_utc
    FROM workspaces_legacy_with_owner;

    DROP TABLE workspaces_legacy_with_owner;
  `);
}

function migrateRuntimeInstallationStateTable(database: Database.Database) {
  const tableInfo = database
    .prepare("PRAGMA table_info(runtime_installation_state)")
    .all() as Array<{ name: string }>;
  if (!tableInfo.length) {
    return;
  }

  const columns = new Set(tableInfo.map((column) => column.name));
  if (!columns.has("runtime_flavor")) {
    return;
  }

  database.exec(`
    ALTER TABLE runtime_installation_state RENAME TO runtime_installation_state_legacy;

    CREATE TABLE runtime_installation_state (
      installation_key TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      runtime_root TEXT,
      runtime_platform TEXT NOT NULL,
      runtime_bundle_version TEXT,
      runtime_bundle_commit TEXT,
      bootstrap_status TEXT NOT NULL,
      bootstrap_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO runtime_installation_state (
      installation_key,
      schema_version,
      runtime_root,
      runtime_platform,
      runtime_bundle_version,
      runtime_bundle_commit,
      bootstrap_status,
      bootstrap_error,
      created_at,
      updated_at
    )
    SELECT
      installation_key,
      schema_version,
      runtime_root,
      runtime_platform,
      runtime_bundle_version,
      runtime_bundle_commit,
      bootstrap_status,
      bootstrap_error,
      created_at,
      updated_at
    FROM runtime_installation_state_legacy;

    DROP TABLE runtime_installation_state_legacy;
  `);
}

function migrateRuntimeProcessStateTable(database: Database.Database) {
  const tableInfo = database
    .prepare("PRAGMA table_info(runtime_process_state)")
    .all() as Array<{ name: string }>;
  if (!tableInfo.length) {
    return;
  }

  const columns = new Set(tableInfo.map((column) => column.name));
  if (!columns.has("launch_id")) {
    database.exec("ALTER TABLE runtime_process_state ADD COLUMN launch_id TEXT;");
  }
  if (!columns.has("sandbox_root")) {
    database.exec("ALTER TABLE runtime_process_state ADD COLUMN sandbox_root TEXT;");
  }
}

async function bootstrapRuntimeDatabase() {
  await fs.mkdir(path.dirname(runtimeDatabasePath()), { recursive: true });

  const database = openRuntimeDatabase();
  try {
    migrateLocalWorkspacesTable(database);
    migrateRuntimeInstallationStateTable(database);
    migrateRuntimeProcessStateTable(database);
    database.exec(`
      CREATE TABLE IF NOT EXISTS runtime_installation_state (
        installation_key TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        runtime_root TEXT,
        runtime_platform TEXT NOT NULL,
        runtime_bundle_version TEXT,
        runtime_bundle_commit TEXT,
        bootstrap_status TEXT NOT NULL,
        bootstrap_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_runtime_sessions (
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        harness TEXT NOT NULL,
        harness_session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, session_id),
        UNIQUE (workspace_id, harness, harness_session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_runtime_sessions_workspace_updated
        ON agent_runtime_sessions (workspace_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_agent_runtime_sessions_workspace_harness_session
        ON agent_runtime_sessions (workspace_id, harness_session_id);

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        harness TEXT,
        error_message TEXT,
        onboarding_status TEXT NOT NULL,
        onboarding_session_id TEXT,
        onboarding_completed_at TEXT,
        onboarding_completion_summary TEXT,
        onboarding_requested_at TEXT,
        onboarding_requested_by TEXT,
        created_at TEXT,
        updated_at TEXT,
        deleted_at_utc TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_workspaces_updated
        ON workspaces (updated_at DESC);

      CREATE TABLE IF NOT EXISTS agent_session_inputs (
        input_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        available_at TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        idempotency_key TEXT,
        claimed_by TEXT,
        claimed_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_session_inputs_workspace_created
        ON agent_session_inputs (workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_agent_session_inputs_session_status
        ON agent_session_inputs (session_id, status, available_at);

      CREATE TABLE IF NOT EXISTS session_runtime_state (
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('IDLE', 'BUSY', 'WAITING_USER', 'ERROR', 'QUEUED')),
        current_input_id TEXT,
        current_worker_id TEXT,
        lease_until TEXT,
        heartbeat_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, session_id)
      );

      CREATE INDEX IF NOT EXISTS session_runtime_state_status_idx
        ON session_runtime_state (status, lease_until);

      CREATE INDEX IF NOT EXISTS session_runtime_state_session_id_idx
        ON session_runtime_state (session_id);

      CREATE INDEX IF NOT EXISTS session_runtime_state_workspace_session_idx
        ON session_runtime_state (workspace_id, session_id);

      CREATE TABLE IF NOT EXISTS sandbox_run_tokens (
        token TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        holaboss_user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        input_id TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]',
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS sandbox_run_tokens_run_id_idx
        ON sandbox_run_tokens (run_id);

      CREATE INDEX IF NOT EXISTS sandbox_run_tokens_expires_at_idx
        ON sandbox_run_tokens (expires_at);

      CREATE INDEX IF NOT EXISTS sandbox_run_tokens_revoked_at_idx
        ON sandbox_run_tokens (revoked_at);

      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_messages_workspace_session_created
        ON session_messages (workspace_id, session_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS runtime_process_state (
        process_key TEXT PRIMARY KEY,
        pid INTEGER,
        status TEXT NOT NULL,
        bind_host TEXT,
        bind_port INTEGER,
        base_url TEXT,
        launch_id TEXT,
        sandbox_root TEXT,
        last_started_at TEXT,
        last_stopped_at TEXT,
        last_healthy_at TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        event TEXT NOT NULL,
        outcome TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_event_log_category_created_at
        ON event_log (category, created_at DESC);
    `);

    const now = utcNowIso();
    const { runtimeRoot } = await resolveRuntimeRoot();
    database
      .prepare(
        `
        INSERT INTO runtime_installation_state (
          installation_key,
          schema_version,
          runtime_root,
          runtime_platform,
          runtime_bundle_version,
          runtime_bundle_commit,
          bootstrap_status,
          bootstrap_error,
          created_at,
          updated_at
        ) VALUES (
          @installation_key,
          @schema_version,
          @runtime_root,
          @runtime_platform,
          @runtime_bundle_version,
          @runtime_bundle_commit,
          @bootstrap_status,
          @bootstrap_error,
          @created_at,
          @updated_at
        )
        ON CONFLICT(installation_key) DO UPDATE SET
          schema_version = excluded.schema_version,
          runtime_root = excluded.runtime_root,
          runtime_platform = excluded.runtime_platform,
          runtime_bundle_version = excluded.runtime_bundle_version,
          runtime_bundle_commit = excluded.runtime_bundle_commit,
          bootstrap_status = excluded.bootstrap_status,
          bootstrap_error = excluded.bootstrap_error,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        installation_key: "desktop-runtime",
        schema_version: LOCAL_RUNTIME_SCHEMA_VERSION,
        runtime_root: runtimeRoot,
        runtime_platform: process.platform,
        runtime_bundle_version: null,
        runtime_bundle_commit: null,
        bootstrap_status: "ready",
        bootstrap_error: null,
        created_at: now,
        updated_at: now,
      });
  } finally {
    database.close();
  }
}

function persistRuntimeProcessState(update: {
  pid?: number | null;
  status: string;
  lastStartedAt?: string | null;
  lastStoppedAt?: string | null;
  lastHealthyAt?: string | null;
  lastError?: string | null;
}) {
  const database = openRuntimeDatabase();
  try {
    database
      .prepare(
        `
        INSERT INTO runtime_process_state (
          process_key,
          pid,
          status,
          bind_host,
          bind_port,
          base_url,
          launch_id,
          sandbox_root,
          last_started_at,
          last_stopped_at,
          last_healthy_at,
          last_error,
          updated_at
        ) VALUES (
          @process_key,
          @pid,
          @status,
          @bind_host,
          @bind_port,
          @base_url,
          @launch_id,
          @sandbox_root,
          @last_started_at,
          @last_stopped_at,
          @last_healthy_at,
          @last_error,
          @updated_at
        )
        ON CONFLICT(process_key) DO UPDATE SET
          pid = excluded.pid,
          status = excluded.status,
          bind_host = excluded.bind_host,
          bind_port = excluded.bind_port,
          base_url = excluded.base_url,
          launch_id = excluded.launch_id,
          sandbox_root = excluded.sandbox_root,
          last_started_at = COALESCE(excluded.last_started_at, runtime_process_state.last_started_at),
          last_stopped_at = COALESCE(excluded.last_stopped_at, runtime_process_state.last_stopped_at),
          last_healthy_at = COALESCE(excluded.last_healthy_at, runtime_process_state.last_healthy_at),
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `,
        )
      .run({
        process_key: "embedded-runtime",
        pid: update.pid ?? null,
        status: update.status,
        bind_host: "127.0.0.1",
        bind_port: runtimeApiPort(),
        base_url: runtimeBaseUrl(),
        launch_id: DESKTOP_LAUNCH_ID,
        sandbox_root: runtimeSandboxRoot(),
        last_started_at: update.lastStartedAt ?? null,
        last_stopped_at: update.lastStoppedAt ?? null,
        last_healthy_at: update.lastHealthyAt ?? null,
        last_error: update.lastError ?? null,
        updated_at: utcNowIso(),
      });
  } finally {
    database.close();
  }
}

type PersistedRuntimeProcessStateRecord = {
  pid: number | null;
  status: string;
  bindHost: string | null;
  bindPort: number | null;
  baseUrl: string | null;
  launchId: string | null;
  sandboxRoot: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  lastHealthyAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

function readPersistedRuntimeProcessState(): PersistedRuntimeProcessStateRecord | null {
  const database = openRuntimeDatabase();
  try {
    const row = database
      .prepare(
        `
        SELECT
          pid,
          status,
          bind_host,
          bind_port,
          base_url,
          launch_id,
          sandbox_root,
          last_started_at,
          last_stopped_at,
          last_healthy_at,
          last_error,
          updated_at
        FROM runtime_process_state
        WHERE process_key = ?
        LIMIT 1
      `,
      )
      .get("embedded-runtime") as
      | {
          pid: number | null;
          status: string;
          bind_host: string | null;
          bind_port: number | null;
          base_url: string | null;
          launch_id: string | null;
          sandbox_root: string | null;
          last_started_at: string | null;
          last_stopped_at: string | null;
          last_healthy_at: string | null;
          last_error: string | null;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      pid: typeof row.pid === "number" ? row.pid : null,
      status: row.status,
      bindHost: row.bind_host,
      bindPort: typeof row.bind_port === "number" ? row.bind_port : null,
      baseUrl: row.base_url,
      launchId: row.launch_id,
      sandboxRoot: row.sandbox_root,
      lastStartedAt: row.last_started_at,
      lastStoppedAt: row.last_stopped_at,
      lastHealthyAt: row.last_healthy_at,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  } finally {
    database.close();
  }
}

function appendRuntimeEventLog(event: {
  category: string;
  event: string;
  outcome: string;
  detail?: string | null;
}) {
  const database = openRuntimeDatabase();
  try {
    database
      .prepare(
        `
        INSERT INTO event_log (category, event, outcome, detail, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(
        event.category,
        event.event,
        event.outcome,
        event.detail ?? null,
        utcNowIso(),
      );
  } finally {
    database.close();
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, payload: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

async function loadBrowserPersistence() {
  fileBookmarks = await readJsonFile<FileBookmarkPayload[]>(
    fileBookmarksPath(),
    [],
  );
}

async function appendRuntimeLog(line: string) {
  await fs.mkdir(path.dirname(runtimeLogsPath()), { recursive: true });
  await fs.appendFile(runtimeLogsPath(), line, "utf-8");
}

async function readRuntimeConfigFile(): Promise<Record<string, string>> {
  const configPath = runtimeConfigPath();
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const parsedRecord = parsed as Record<string, unknown>;
    const runtimePayload = runtimeConfigObject(parsedRecord.runtime);
    const providersPayload = runtimeConfigObject(parsedRecord.providers);
    const integrationsPayload = runtimeConfigObject(parsedRecord.integrations);
    const holabossIntegration = runtimeConfigObject(
      integrationsPayload.holaboss,
    );
    const holabossProvider = runtimeConfigObject(
      providersPayload[RUNTIME_HOLABOSS_PROVIDER_ID],
    );
    const holabossLegacyPayload = runtimeConfigObject(parsedRecord.holaboss);
    const legacyPayload =
      Object.keys(holabossLegacyPayload).length > 0
        ? holabossLegacyPayload
        : parsedRecord;

    const normalized: Record<string, string> = {};
    const authToken = runtimeFirstNonEmptyString(
      holabossIntegration.auth_token as string | undefined,
      holabossProvider.api_key as string | undefined,
      legacyPayload.auth_token as string | undefined,
      legacyPayload.model_proxy_api_key as string | undefined,
    );
    const userId = runtimeFirstNonEmptyString(
      holabossIntegration.user_id as string | undefined,
      legacyPayload.user_id as string | undefined,
    );
    const bindingSandboxId = runtimeFirstNonEmptyString(
      holabossIntegration.sandbox_id as string | undefined,
      legacyPayload.sandbox_id as string | undefined,
    );
    const sandboxId =
      authToken && bindingSandboxId
        ? bindingSandboxId
        : runtimeFirstNonEmptyString(
            runtimePayload.sandbox_id as string | undefined,
            bindingSandboxId,
          );
    const modelProxyBaseUrl = runtimeFirstNonEmptyString(
      holabossProvider.base_url as string | undefined,
      legacyPayload.model_proxy_base_url as string | undefined,
    );
    const defaultModel = normalizeLegacyRuntimeModelToken(
      runtimeFirstNonEmptyString(
        runtimePayload.default_model as string | undefined,
        legacyPayload.default_model as string | undefined,
      ),
    );
    const defaultProvider = runtimeFirstNonEmptyString(
      runtimePayload.default_provider as string | undefined,
      legacyPayload.default_provider as string | undefined,
    );
    const controlPlaneBaseUrl = runtimeFirstNonEmptyString(
      legacyPayload.control_plane_base_url as string | undefined,
    );

    if (authToken) {
      normalized.auth_token = authToken;
      normalized.model_proxy_api_key = authToken;
    }
    if (userId) {
      normalized.user_id = userId;
    }
    if (sandboxId) {
      normalized.sandbox_id = sandboxId;
    }
    if (modelProxyBaseUrl) {
      normalized.model_proxy_base_url = modelProxyBaseUrl;
    }
    if (defaultModel) {
      normalized.default_model = defaultModel;
    }
    if (defaultProvider) {
      normalized.default_provider = defaultProvider;
    }
    if (controlPlaneBaseUrl) {
      normalized.control_plane_base_url = controlPlaneBaseUrl;
    }

    return normalized;
  } catch {
    return {};
  }
}

async function readRuntimeConfigDocument(): Promise<Record<string, unknown>> {
  const configPath = runtimeConfigPath();
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeRuntimeConfigTextAtomically(
  nextText: string,
): Promise<void> {
  const configPath = runtimeConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, nextText, "utf-8");
  try {
    await fs.rename(tempPath, configPath);
  } catch {
    await fs.rm(configPath, { force: true }).catch(() => undefined);
    await fs.rename(tempPath, configPath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function updateDesktopBrowserCapabilityConfig(update: {
  enabled: boolean;
  url?: string;
  authToken?: string;
}): Promise<void> {
  await withRuntimeConfigMutationLock(async () => {
    const currentDocument = await readRuntimeConfigDocument();
    const capabilities =
      typeof currentDocument.capabilities === "object" &&
      currentDocument.capabilities
        ? { ...(currentDocument.capabilities as Record<string, unknown>) }
        : {};
    const desktopBrowser =
      typeof capabilities.desktop_browser === "object" &&
      capabilities.desktop_browser
        ? { ...(capabilities.desktop_browser as Record<string, unknown>) }
        : {};

    desktopBrowser.enabled = update.enabled;
    if (update.url && update.url.trim()) {
      desktopBrowser.url = update.url.trim();
    } else {
      delete desktopBrowser.url;
    }
    if (update.authToken && update.authToken.trim()) {
      desktopBrowser.auth_token = update.authToken.trim();
    } else {
      delete desktopBrowser.auth_token;
    }
    delete desktopBrowser.mcp_url;

    capabilities.desktop_browser = desktopBrowser;
    const nextDocument = {
      ...currentDocument,
      capabilities,
    };

    await writeRuntimeConfigTextAtomically(
      `${JSON.stringify(nextDocument, null, 2)}\n`,
    );
  });
}

function desktopBrowserServiceTokenFromRequest(
  request: IncomingMessage,
): string {
  const raw = request.headers["x-holaboss-desktop-token"];
  if (Array.isArray(raw)) {
    return (raw[0] || "").trim();
  }
  return typeof raw === "string" ? raw.trim() : "";
}

function desktopBrowserWorkspaceIdFromRequest(
  request: IncomingMessage,
): string {
  const raw = request.headers["x-holaboss-workspace-id"];
  if (Array.isArray(raw)) {
    return (raw[0] || "").trim();
  }
  return typeof raw === "string" ? raw.trim() : "";
}

function writeBrowserServiceJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readBrowserServiceJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function browserPagePayload(tab: BrowserTabRecord): Record<string, unknown> {
  const webContents = tab.view.webContents;
  return {
    tabId: tab.state.id,
    url: webContents.getURL() || tab.state.url,
    title: webContents.getTitle() || tab.state.title,
    loading: tab.state.loading,
    initialized: tab.state.initialized,
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
    error: tab.state.error || "",
  };
}

function operatorSurfaceTypeValue(value: unknown): OperatorSurfaceType | null {
  return value === "browser" ||
    value === "editor" ||
    value === "terminal" ||
    value === "app_surface"
    ? value
    : null;
}

function operatorSurfaceOwnerValue(value: unknown): OperatorSurfaceOwner | null {
  return value === "user" || value === "agent" ? value : null;
}

function operatorSurfaceMutabilityValue(
  value: unknown,
): OperatorSurfaceMutability | null {
  return value === "inspect_only" ||
    value === "takeover_allowed" ||
    value === "agent_owned"
    ? value
    : null;
}

function normalizeOperatorSurfacePayload(
  value: unknown,
): OperatorSurfacePayload | null {
  const record = runtimeConfigObject(value);
  const surfaceId = runtimeFirstNonEmptyString(
    typeof record.surface_id === "string" ? record.surface_id : undefined,
  );
  const surfaceType = operatorSurfaceTypeValue(record.surface_type);
  const owner = operatorSurfaceOwnerValue(record.owner);
  const mutability = operatorSurfaceMutabilityValue(record.mutability);
  const summary = runtimeFirstNonEmptyString(
    typeof record.summary === "string" ? record.summary : undefined,
  );
  if (!surfaceId || !surfaceType || !owner || !mutability || !summary) {
    return null;
  }
  return {
    surface_id: surfaceId,
    surface_type: surfaceType,
    owner,
    active: record.active === true,
    mutability,
    summary,
  };
}

function normalizeReportedOperatorSurfaceContext(
  value: unknown,
): ReportedOperatorSurfaceContextPayload | null {
  const record = runtimeConfigObject(value);
  const surfaces = Array.isArray(record.surfaces)
    ? record.surfaces
        .map((surface) => normalizeOperatorSurfacePayload(surface))
        .filter((surface): surface is OperatorSurfacePayload => surface !== null)
    : [];
  if (surfaces.length === 0) {
    return null;
  }
  const activeSurfaceId = runtimeFirstNonEmptyString(
    typeof record.active_surface_id === "string"
      ? record.active_surface_id
      : undefined,
  );
  return {
    active_surface_id: activeSurfaceId ?? null,
    surfaces,
    updated_at: new Date().toISOString(),
  };
}

function browserSurfaceSummary(
  workspaceId: string,
  space: BrowserSpaceId,
  visibleInApp: boolean,
): string {
  const workspace = browserWorkspaceFromMap(workspaceId);
  const tabSpace = browserTabSpaceState(workspace, space);
  const activeTabId = tabSpace?.activeTabId ?? "";
  if (activeTabId) {
    syncBrowserState(workspaceId, activeTabId, space);
  }
  const refreshedWorkspace = browserWorkspaceFromMap(workspaceId);
  const refreshedTabSpace = browserTabSpaceState(refreshedWorkspace, space);
  const tabCount = refreshedTabSpace?.tabs.size ?? 0;
  const activeTab = activeTabId ? refreshedTabSpace?.tabs.get(activeTabId) ?? null : null;
  const spaceLabel = space === "user" ? "User browser" : "Agent browser";
  const tabSummary = `${tabCount} open ${tabCount === 1 ? "tab" : "tabs"}`;
  const summaryParts = [`${spaceLabel} surface with ${tabSummary}.`];
  if (activeTab) {
    const activeTitle = activeTab.state.title?.trim() || activeTab.state.url?.trim() || "Untitled";
    const activeUrl = activeTab.state.url?.trim();
    summaryParts.push(`Active tab: "${activeTitle}"${activeUrl ? ` at ${activeUrl}` : ""}.`);
  } else {
    summaryParts.push("No active tab is currently selected.");
  }
  if (visibleInApp) {
    summaryParts.push("This surface is currently visible in the app.");
  }
  summaryParts.push("It shares the workspace browser session and auth state with the other browser surface.");
  return summaryParts.join(" ");
}

function operatorSurfaceContextPayload(workspaceId: string): OperatorSurfaceContextPayload {
  const normalizedWorkspaceId = workspaceId.trim();
  const reportedContext =
    reportedOperatorSurfaceContexts.get(normalizedWorkspaceId) ?? null;
  const reportedSurfaces = reportedContext?.surfaces ?? [];
  const activeReportedSurfaceId =
    reportedContext?.active_surface_id?.trim() || "";
  const browserSurfaces: OperatorSurfacePayload[] = BROWSER_SPACE_IDS.map(
    (space): OperatorSurfacePayload => ({
    surface_id: `browser:${space}`,
    surface_type: "browser",
    owner: space === "user" ? "user" : "agent",
    active:
      activeReportedSurfaceId.length > 0
        ? activeReportedSurfaceId === `browser:${space}`
        : normalizedWorkspaceId === activeBrowserWorkspaceId &&
          activeBrowserSpaceId === space,
    mutability: space === "agent" ? "agent_owned" : "inspect_only",
    summary: browserSurfaceSummary(
      normalizedWorkspaceId,
      space,
      activeReportedSurfaceId.length > 0
        ? activeReportedSurfaceId === `browser:${space}`
        : normalizedWorkspaceId === activeBrowserWorkspaceId &&
          activeBrowserSpaceId === space,
    ),
  }),
  );
  const activeSurfaceId = activeReportedSurfaceId ||
    (normalizedWorkspaceId &&
    normalizedWorkspaceId === activeBrowserWorkspaceId
      ? `browser:${activeBrowserSpaceId}`
      : null);
  return {
    active_surface_id: activeSurfaceId,
    surfaces: [...reportedSurfaces, ...browserSurfaces],
  };
}

function serializeBrowserEvalResult(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function isAbortedBrowserLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    message?: unknown;
  };
  return (
    candidate.code === "ERR_ABORTED" ||
    candidate.errno === -3 ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("ERR_ABORTED"))
  );
}

function isAbortedBrowserLoadFailure(
  errorCode: number,
  errorDescription: string,
): boolean {
  return (
    errorCode === -3 || errorDescription.trim().toUpperCase() === "ERR_ABORTED"
  );
}

async function navigateActiveBrowserTab(
  workspaceId: string,
  targetUrl: string,
  space: BrowserSpaceId = activeBrowserSpaceId,
): Promise<BrowserTabListPayload> {
  await ensureBrowserWorkspace(workspaceId, space);
  const activeTab = getActiveBrowserTab(workspaceId, space);
  if (!activeTab) {
    throw new Error("No active browser tab is available.");
  }

  try {
    activeTab.state = { ...activeTab.state, error: "" };
    await activeTab.view.webContents.loadURL(targetUrl);
  } catch (error) {
    if (isAbortedBrowserLoadError(error)) {
      return browserWorkspaceSnapshot(workspaceId, space);
    }
    activeTab.state = {
      ...activeTab.state,
      loading: false,
      error: error instanceof Error ? error.message : "Failed to load URL.",
    };
    emitBrowserState(workspaceId, space);
    throw error;
  }

  return browserWorkspaceSnapshot(workspaceId, space);
}

async function handleDesktopBrowserServiceRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
): Promise<void> {
  try {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    const method = (request.method || "GET").toUpperCase();
    const requestedWorkspaceId = desktopBrowserWorkspaceIdFromRequest(request);
    const targetWorkspaceId = requestedWorkspaceId || activeBrowserWorkspaceId;

    if (
      !desktopBrowserServiceAuthToken ||
      desktopBrowserServiceTokenFromRequest(request) !==
        desktopBrowserServiceAuthToken
    ) {
      writeBrowserServiceJson(response, 401, { error: "Unauthorized." });
      return;
    }

    if (method === "GET" && pathname === "/api/v1/browser/health") {
      writeBrowserServiceJson(response, 200, { ok: true });
      return;
    }

    if (!targetWorkspaceId) {
      writeBrowserServiceJson(response, 409, {
        error: "No active browser workspace is available.",
      });
      return;
    }

    if (method === "GET" && pathname === "/api/v1/browser/tabs") {
      await ensureBrowserWorkspace(targetWorkspaceId, "agent");
      writeBrowserServiceJson(
        response,
        200,
        browserWorkspaceSnapshot(targetWorkspaceId, "agent"),
      );
      return;
    }

    if (method === "GET" && pathname === "/api/v1/browser/page") {
      await ensureBrowserWorkspace(targetWorkspaceId, "agent");
      const activeTab = getActiveBrowserTab(targetWorkspaceId, "agent");
      if (!activeTab) {
        writeBrowserServiceJson(response, 409, {
          error: "No active browser tab is available.",
        });
        return;
      }
      syncBrowserState(targetWorkspaceId, activeTab.state.id, "agent");
      writeBrowserServiceJson(response, 200, browserPagePayload(activeTab));
      return;
    }

    if (method === "GET" && pathname === "/api/v1/browser/operator-surface-context") {
      await ensureBrowserWorkspace(targetWorkspaceId, "user");
      await ensureBrowserWorkspace(targetWorkspaceId, "agent");
      writeBrowserServiceJson(response, 200, operatorSurfaceContextPayload(targetWorkspaceId));
      return;
    }

    if (method === "POST" && pathname === "/api/v1/browser/navigate") {
      const payload = await readBrowserServiceJsonBody(request);
      const targetUrl =
        typeof payload.url === "string" ? payload.url.trim() : "";
      if (!targetUrl) {
        writeBrowserServiceJson(response, 400, {
          error: "Field 'url' is required.",
        });
        return;
      }
      if (targetWorkspaceId && targetWorkspaceId === activeBrowserWorkspaceId) {
        emitWorkbenchOpenBrowser({
          workspaceId: targetWorkspaceId,
          url: targetUrl,
          space: "agent",
        });
      }
      const snapshot = await navigateActiveBrowserTab(
        targetWorkspaceId,
        targetUrl,
        "agent",
      );
      writeBrowserServiceJson(response, 200, snapshot);
      return;
    }

    if (method === "POST" && pathname === "/api/v1/browser/tabs") {
      const payload = await readBrowserServiceJsonBody(request);
      const targetUrl =
        typeof payload.url === "string" && payload.url.trim()
          ? payload.url.trim()
          : HOME_URL;
      const background = payload.background === true;
      const workspace = await ensureBrowserWorkspace(
        targetWorkspaceId,
        "agent",
      );
      const tabSpace = browserTabSpaceState(workspace, "agent");
      if (!workspace) {
        writeBrowserServiceJson(response, 409, {
          error: "No active browser workspace is available.",
        });
        return;
      }

      const nextTabId = createBrowserTab(targetWorkspaceId, {
        url: targetUrl,
        browserSpace: "agent",
      });
      if (!nextTabId) {
        writeBrowserServiceJson(response, 500, {
          error: "Failed to create browser tab.",
        });
        return;
      }

      if (!background && tabSpace) {
        tabSpace.activeTabId = nextTabId;
        if (targetWorkspaceId === activeBrowserWorkspaceId) {
          updateAttachedBrowserView();
        }
      }

      emitBrowserState(targetWorkspaceId, "agent");
      await persistBrowserWorkspace(targetWorkspaceId);
      writeBrowserServiceJson(
        response,
        200,
        browserWorkspaceSnapshot(targetWorkspaceId, "agent"),
      );
      return;
    }

    if (method === "POST" && pathname === "/api/v1/browser/evaluate") {
      const payload = await readBrowserServiceJsonBody(request);
      const expression =
        typeof payload.expression === "string" ? payload.expression.trim() : "";
      if (!expression) {
        writeBrowserServiceJson(response, 400, {
          error: "Field 'expression' is required.",
        });
        return;
      }

      await ensureBrowserWorkspace(targetWorkspaceId, "agent");
      const activeTab = getActiveBrowserTab(targetWorkspaceId, "agent");
      if (!activeTab) {
        writeBrowserServiceJson(response, 409, {
          error: "No active browser tab is available.",
        });
        return;
      }

      const result =
        await activeTab.view.webContents.executeJavaScript(expression);
      writeBrowserServiceJson(response, 200, {
        tabId: activeTab.state.id,
        result: serializeBrowserEvalResult(result),
      });
      return;
    }

    if (method === "POST" && pathname === "/api/v1/browser/screenshot") {
      const payload = await readBrowserServiceJsonBody(request);
      await ensureBrowserWorkspace(targetWorkspaceId, "agent");
      const activeTab = getActiveBrowserTab(targetWorkspaceId, "agent");
      if (!activeTab) {
        writeBrowserServiceJson(response, 409, {
          error: "No active browser tab is available.",
        });
        return;
      }

      const format = payload.format === "jpeg" ? "jpeg" : "png";
      const qualityRaw =
        typeof payload.quality === "number" ? payload.quality : 90;
      const quality = Math.max(0, Math.min(100, Math.round(qualityRaw)));
      const image = await activeTab.view.webContents.capturePage();
      const buffer = format === "jpeg" ? image.toJPEG(quality) : image.toPNG();
      const size = image.getSize();

      writeBrowserServiceJson(response, 200, {
        tabId: activeTab.state.id,
        mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
        width: size.width,
        height: size.height,
        base64: buffer.toString("base64"),
      });
      return;
    }

    writeBrowserServiceJson(response, 404, { error: "Not found." });
  } catch (error) {
    writeBrowserServiceJson(response, 500, {
      error:
        error instanceof Error
          ? error.message
          : "Browser service request failed.",
    });
  }
}

async function startDesktopBrowserService(): Promise<void> {
  if (desktopBrowserServiceServer) {
    return;
  }

  const authToken = randomUUID();
  const server = createServer((request, response) => {
    void handleDesktopBrowserServiceRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to resolve desktop browser service address.");
  }

  desktopBrowserServiceServer = server;
  desktopBrowserServiceAuthToken = authToken;
  desktopBrowserServiceUrl = `http://127.0.0.1:${address.port}/api/v1/browser`;
  runtimeStatus = withDesktopBrowserStatus({
    ...runtimeStatus,
  });
  emitRuntimeState();
  await updateDesktopBrowserCapabilityConfig({
    enabled: true,
    url: desktopBrowserServiceUrl,
    authToken,
  });
}

async function stopDesktopBrowserService(): Promise<void> {
  const server = desktopBrowserServiceServer;
  desktopBrowserServiceServer = null;
  desktopBrowserServiceUrl = "";
  desktopBrowserServiceAuthToken = "";

  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  runtimeStatus = withDesktopBrowserStatus({
    ...runtimeStatus,
  });
  emitRuntimeState();
  await updateDesktopBrowserCapabilityConfig({ enabled: false });
}

function desktopBrowserStatusFields() {
  return {
    desktopBrowserReady: Boolean(desktopBrowserServiceUrl),
    desktopBrowserUrl: desktopBrowserServiceUrl || null,
  };
}

function withDesktopBrowserStatus(
  payload: Omit<
    RuntimeStatusPayload,
    "desktopBrowserReady" | "desktopBrowserUrl"
  >,
): RuntimeStatusPayload {
  return {
    ...payload,
    ...desktopBrowserStatusFields(),
  };
}

function resolveTargetWindow(
  senderWindow: BrowserWindow | null | undefined,
): BrowserWindow | null {
  if (senderWindow && !senderWindow.isDestroyed()) {
    return senderWindow;
  }
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function desktopWindowStatePayload(
  targetWindow: BrowserWindow | null | undefined = mainWindow,
): DesktopWindowStatePayload {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return {
      isFullScreen: false,
      isMaximized: false,
      isMinimized: false,
    };
  }

  return {
    isFullScreen: targetWindow.isFullScreen(),
    isMaximized: targetWindow.isMaximized(),
    isMinimized: targetWindow.isMinimized(),
  };
}

function emitWindowStateChanged(
  targetWindow: BrowserWindow | null | undefined = mainWindow,
) {
  const resolvedWindow = resolveTargetWindow(targetWindow);
  if (!resolvedWindow) {
    return;
  }

  resolvedWindow.webContents.send(
    "ui:windowState",
    desktopWindowStatePayload(resolvedWindow),
  );
}

function runtimeModelProxyApiKeyFromConfig(
  config: Record<string, string>,
): string {
  return (config.model_proxy_api_key || config.auth_token || "").trim();
}

function runtimeBindingModelProxyApiKey(
  binding: RuntimeBindingExchangePayload,
): string {
  return (binding.model_proxy_api_key || binding.auth_token || "").trim();
}

function runtimeConfigHasBindingMaterial(
  config: Record<string, string>,
): boolean {
  return (
    Boolean(runtimeModelProxyApiKeyFromConfig(config)) &&
    Boolean((config.user_id || "").trim()) &&
    Boolean((config.sandbox_id || "").trim()) &&
    Boolean((config.model_proxy_base_url || "").trim())
  );
}

function canUsePersistedRuntimeBindingWithoutAuth(
  config: Record<string, string>,
): boolean {
  if (process.env.HOLABOSS_INTERNAL_DEV?.trim() !== "1") {
    return false;
  }
  return runtimeConfigHasBindingMaterial(config);
}

async function writeRuntimeConfigFile(update: RuntimeConfigUpdatePayload) {
  return withRuntimeConfigMutationLock(async () => {
    const current = await readRuntimeConfigFile();
    const currentDocument = await readRuntimeConfigDocument();
    const runtimePayload = runtimeConfigObject(currentDocument.runtime);
    const providersPayload = runtimeConfigObject(currentDocument.providers);
    const integrationsPayload = runtimeConfigObject(
      currentDocument.integrations,
    );
    const holabossIntegration = runtimeConfigObject(
      integrationsPayload.holaboss,
    );
    const holabossProvider = runtimeConfigObject(
      providersPayload[RUNTIME_HOLABOSS_PROVIDER_ID],
    );
    const next = { ...current };
    const entries: Array<[keyof RuntimeConfigUpdatePayload, string]> = [
      ["authToken", "auth_token"],
      ["modelProxyApiKey", "model_proxy_api_key"],
      ["userId", "user_id"],
      ["sandboxId", "sandbox_id"],
      ["modelProxyBaseUrl", "model_proxy_base_url"],
      ["defaultModel", "default_model"],
      ["controlPlaneBaseUrl", "control_plane_base_url"],
    ];

    for (const [inputKey, fileKey] of entries) {
      const value = update[inputKey];
      if (value === undefined) {
        continue;
      }
      const normalized = typeof value === "string" ? value.trim() : "";
      if (normalized) {
        next[fileKey] = normalized;
      } else {
        delete next[fileKey];
      }
    }

    const modelProxyApiKey = runtimeModelProxyApiKeyFromConfig(next);
    const managedDefaultBackgroundModel = normalizeRuntimeHolabossCatalogDefaultModelId(
      update.defaultBackgroundModel,
    );
    const managedDefaultEmbeddingModel = normalizeRuntimeHolabossCatalogDefaultModelId(
      update.defaultEmbeddingModel,
    );
    const managedDefaultImageModel = normalizeRuntimeHolabossCatalogDefaultModelId(
      update.defaultImageModel,
    );
    if (modelProxyApiKey) {
      next.auth_token = modelProxyApiKey;
      next.model_proxy_api_key = modelProxyApiKey;
    } else {
      delete next.auth_token;
      delete next.model_proxy_api_key;
    }

    const assignOrDelete = (
      target: Record<string, unknown>,
      key: string,
      value: string | undefined,
    ) => {
      const normalized = runtimeConfigField(value);
      if (normalized) {
        target[key] = normalized;
      } else {
        delete target[key];
      }
    };

    assignOrDelete(holabossIntegration, "auth_token", next.auth_token);
    assignOrDelete(holabossIntegration, "user_id", next.user_id);
    assignOrDelete(holabossIntegration, "sandbox_id", next.sandbox_id);
    assignOrDelete(holabossProvider, "api_key", next.auth_token);
    assignOrDelete(holabossProvider, "base_url", next.model_proxy_base_url);
    assignOrDelete(runtimePayload, "sandbox_id", next.sandbox_id);
    assignOrDelete(runtimePayload, "default_model", next.default_model);
    const currentBackgroundTasks = runtimeConfigObject(
      runtimePayload.background_tasks ?? runtimePayload.backgroundTasks,
    );
    const currentBackgroundProviderId = canonicalRuntimeProviderId(
      runtimeFirstNonEmptyString(
        currentBackgroundTasks.provider as string | undefined,
        currentBackgroundTasks.provider_id as string | undefined,
        currentBackgroundTasks.providerId as string | undefined,
      ),
    );
    const currentBackgroundModel = runtimeFirstNonEmptyString(
      currentBackgroundTasks.model as string | undefined,
      currentBackgroundTasks.model_id as string | undefined,
      currentBackgroundTasks.modelId as string | undefined,
    );
    const currentImageGeneration = runtimeConfigObject(
      runtimePayload.image_generation ?? runtimePayload.imageGeneration,
    );
    const currentRecallEmbeddings = runtimeConfigObject(
      runtimePayload.recall_embeddings ?? runtimePayload.recallEmbeddings,
    );
    const currentImageGenerationProviderId = canonicalRuntimeProviderId(
      runtimeFirstNonEmptyString(
        currentImageGeneration.provider as string | undefined,
        currentImageGeneration.provider_id as string | undefined,
        currentImageGeneration.providerId as string | undefined,
      ),
    );
    const currentImageGenerationModel = runtimeFirstNonEmptyString(
      currentImageGeneration.model as string | undefined,
      currentImageGeneration.model_id as string | undefined,
      currentImageGeneration.modelId as string | undefined,
    );
    const currentRecallEmbeddingsProviderId = canonicalRuntimeProviderId(
      runtimeFirstNonEmptyString(
        currentRecallEmbeddings.provider as string | undefined,
        currentRecallEmbeddings.provider_id as string | undefined,
        currentRecallEmbeddings.providerId as string | undefined,
      ),
    );
    const currentRecallEmbeddingsModel = runtimeFirstNonEmptyString(
      currentRecallEmbeddings.model as string | undefined,
      currentRecallEmbeddings.model_id as string | undefined,
      currentRecallEmbeddings.modelId as string | undefined,
    );
    delete runtimePayload.backgroundTasks;
    delete runtimePayload.recallEmbeddings;
    delete runtimePayload.imageGeneration;
    if (
      managedDefaultBackgroundModel &&
      runtimeModelProxyApiKeyFromConfig(next) &&
      runtimeConfigField(next.model_proxy_base_url) &&
      (Object.keys(currentBackgroundTasks).length === 0 ||
        (isHolabossProviderAlias(currentBackgroundProviderId) &&
          !currentBackgroundModel))
    ) {
      runtimePayload.background_tasks = {
        provider: RUNTIME_HOLABOSS_PROVIDER_ID,
        model: managedDefaultBackgroundModel,
      };
    } else if (Object.keys(currentBackgroundTasks).length > 0) {
      runtimePayload.background_tasks = currentBackgroundTasks;
    }
    if (
      managedDefaultEmbeddingModel &&
      runtimeModelProxyApiKeyFromConfig(next) &&
      runtimeConfigField(next.model_proxy_base_url) &&
      (
        Object.keys(currentRecallEmbeddings).length === 0 ||
        (isHolabossProviderAlias(currentRecallEmbeddingsProviderId) &&
          !currentRecallEmbeddingsModel)
      )
    ) {
      runtimePayload.recall_embeddings = {
        provider: RUNTIME_HOLABOSS_PROVIDER_ID,
        model: managedDefaultEmbeddingModel,
      };
    } else if (Object.keys(currentRecallEmbeddings).length > 0) {
      runtimePayload.recall_embeddings = currentRecallEmbeddings;
    }
    if (
      managedDefaultImageModel &&
      runtimeModelProxyApiKeyFromConfig(next) &&
      runtimeConfigField(next.model_proxy_base_url) &&
      (Object.keys(currentImageGeneration).length === 0 ||
        (isHolabossProviderAlias(currentImageGenerationProviderId) &&
          !currentImageGenerationModel))
    ) {
      runtimePayload.image_generation = {
        provider: RUNTIME_HOLABOSS_PROVIDER_ID,
        model: managedDefaultImageModel,
      };
    } else if (Object.keys(currentImageGeneration).length > 0) {
      runtimePayload.image_generation = currentImageGeneration;
    }

    if (
      Object.keys(holabossProvider).length > 0 &&
      !runtimeConfigField(holabossProvider.kind as string | undefined)
    ) {
      holabossProvider.kind = RUNTIME_PROVIDER_KIND_HOLABOSS_PROXY;
    }
    if (Object.keys(holabossIntegration).length > 0) {
      integrationsPayload.holaboss = holabossIntegration;
    } else {
      delete integrationsPayload.holaboss;
    }
    if (Object.keys(holabossProvider).length > 0) {
      providersPayload[RUNTIME_HOLABOSS_PROVIDER_ID] = holabossProvider;
    } else {
      delete providersPayload[RUNTIME_HOLABOSS_PROVIDER_ID];
    }

    const nextDocument = {
      ...currentDocument,
      runtime: runtimePayload,
      providers: providersPayload,
      integrations: integrationsPayload,
      holaboss: next,
    };
    await writeRuntimeConfigTextAtomically(
      `${JSON.stringify(nextDocument, null, 2)}\n`,
    );
    return next;
  });
}

function runtimeConfigField(value: string | undefined): string {
  return (value || "").trim();
}

function runtimeConfigObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function runtimeFirstNonEmptyString(
  ...values: Array<string | null | undefined>
): string {
  for (const value of values) {
    const normalized = (value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function canonicalRuntimeProviderId(providerId: string): string {
  const normalized = providerId.trim();
  if (!normalized) {
    return "";
  }
  if (
    RUNTIME_HOLABOSS_PROVIDER_ALIASES.some(
      (alias) => alias === normalized.toLowerCase(),
    )
  ) {
    return RUNTIME_HOLABOSS_PROVIDER_ID;
  }
  return normalized;
}

function canonicalRuntimeModelToken(
  providerId: string,
  token: string,
  modelId: string,
): string {
  const canonicalProviderId = canonicalRuntimeProviderId(providerId);
  const normalizedModelId = modelId.trim();
  const normalizedToken = token.trim();
  if (!canonicalProviderId) {
    return normalizedToken;
  }
  if (!normalizedToken) {
    return `${canonicalProviderId}/${normalizedModelId}`;
  }
  if (canonicalProviderId !== RUNTIME_HOLABOSS_PROVIDER_ID) {
    return normalizedToken;
  }
  if (!normalizedToken.includes("/")) {
    return normalizedToken;
  }
  const [prefix, ...rest] = normalizedToken.split("/");
  if (
    rest.length > 0 &&
    RUNTIME_HOLABOSS_PROVIDER_ALIASES.some(
      (alias) => alias === prefix.trim().toLowerCase(),
    )
  ) {
    return `${canonicalProviderId}/${rest.join("/").trim()}`;
  }
  return normalizedToken;
}

function normalizeLegacyRuntimeModelToken(token: string): string {
  return token.trim();
}

function normalizeRuntimeProviderModelId(
  providerId: string,
  modelId: string,
): string {
  const normalizedProviderId = providerId.trim().toLowerCase();
  const normalizedModelId = modelId.trim();
  if (!normalizedProviderId || !normalizedModelId) {
    return normalizedModelId;
  }
  return (
    RUNTIME_LEGACY_DIRECT_PROVIDER_MODEL_ALIASES[normalizedProviderId]?.[
      normalizedModelId
    ] ?? normalizedModelId
  );
}

function normalizeRuntimeProviderModelToken(
  providerId: string,
  token: string,
  modelId: string,
): string {
  const normalizedProviderId = canonicalRuntimeProviderId(providerId);
  const normalizedModelId = normalizeRuntimeProviderModelId(
    normalizedProviderId,
    modelId,
  );
  const normalizedToken = token.trim();
  const providerPrefix = `${normalizedProviderId}/`;
  if (!normalizedToken.startsWith(providerPrefix)) {
    return normalizedToken || providerPrefix + normalizedModelId;
  }
  return `${providerPrefix}${normalizedModelId}`;
}

function runtimeProviderLabel(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === "openai" || normalized.includes("openai")) {
    return "OpenAI";
  }
  if (normalized === "anthropic" || normalized.includes("anthropic")) {
    return "Anthropic";
  }
  if (normalized.includes("openrouter")) {
    return "OpenRouter";
  }
  if (normalized.includes("gemini") || normalized.includes("google")) {
    return "Gemini";
  }
  if (normalized.includes("ollama")) {
    return "Ollama";
  }
  if (normalized.includes("minimax")) {
    return "MiniMax";
  }
  if (
    normalized === RUNTIME_HOLABOSS_PROVIDER_ID ||
    normalized === "holaboss" ||
    normalized.includes("holaboss")
  ) {
    return "Holaboss Proxy";
  }
  return providerId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeRuntimeProviderKind(
  rawKind: string,
  providerId: string,
  baseUrl: string,
): string {
  const normalizedProviderId = providerId.trim().toLowerCase();
  const normalizedKind = rawKind.trim().toLowerCase();
  const normalizedBaseUrl = baseUrl.trim().toLowerCase();
  if (
    normalizedKind === RUNTIME_PROVIDER_KIND_HOLABOSS_PROXY ||
    normalizedProviderId === RUNTIME_HOLABOSS_PROVIDER_ID ||
    normalizedProviderId === "holaboss" ||
    normalizedProviderId.includes("holaboss")
  ) {
    return RUNTIME_PROVIDER_KIND_HOLABOSS_PROXY;
  }
  if (!normalizedKind && normalizedBaseUrl.includes("model-proxy")) {
    return RUNTIME_PROVIDER_KIND_HOLABOSS_PROXY;
  }
  if (
    normalizedKind === RUNTIME_PROVIDER_KIND_OPENROUTER ||
    normalizedProviderId.includes("openrouter")
  ) {
    return RUNTIME_PROVIDER_KIND_OPENROUTER;
  }
  if (
    normalizedKind === RUNTIME_PROVIDER_KIND_ANTHROPIC_NATIVE ||
    normalizedKind === "anthropic" ||
    normalizedProviderId.includes("anthropic")
  ) {
    return RUNTIME_PROVIDER_KIND_ANTHROPIC_NATIVE;
  }
  return RUNTIME_PROVIDER_KIND_OPENAI_COMPATIBLE;
}

function runtimeModelIdFromToken(token: string): string {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return "";
  }
  if (!normalizedToken.includes("/")) {
    return normalizedToken;
  }
  const [prefix, ...rest] = normalizedToken.split("/");
  const normalizedPrefix = prefix.trim().toLowerCase();
  if (
    normalizedPrefix.includes("openai") ||
    normalizedPrefix.includes("anthropic") ||
    normalizedPrefix.includes("holaboss") ||
    normalizedPrefix.includes("openrouter") ||
    normalizedPrefix.includes("gemini") ||
    normalizedPrefix.includes("google") ||
    normalizedPrefix.includes("ollama") ||
    normalizedPrefix.includes("minimax")
  ) {
    return rest.join("/").trim();
  }
  return normalizedToken;
}

function isDeprecatedRuntimeModelId(modelId: string): boolean {
  const normalized = runtimeModelIdFromToken(modelId).toLowerCase();
  return RUNTIME_DEPRECATED_MODEL_IDS.has(normalized);
}

const RUNTIME_MODEL_CAPABILITY_ALIASES: Record<string, string> = {
  chat: "chat",
  text: "chat",
  completion: "chat",
  completions: "chat",
  responses: "chat",
  image: "image_generation",
  images: "image_generation",
  image_generation: "image_generation",
  image_gen: "image_generation",
};

function normalizeRuntimeModelCapability(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!normalized) {
    return "";
  }
  return RUNTIME_MODEL_CAPABILITY_ALIASES[normalized] ?? normalized;
}

function normalizeRuntimeModelCapabilities(rawValues: unknown[]): string[] {
  const seen = new Set<string>();
  const capabilities: string[] = [];
  for (const value of rawValues) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = normalizeRuntimeModelCapability(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    capabilities.push(normalized);
  }
  return capabilities;
}

function runtimeModelCapabilityList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeRuntimeModelThinkingValues(rawValues: unknown[]): string[] {
  const seen = new Set<string>();
  const thinkingValues: string[] = [];
  for (const value of rawValues) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    thinkingValues.push(normalized);
  }
  return thinkingValues;
}

function runtimeModelThinkingValueList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeRuntimeModelInputModality(
  value: string,
): ModelCatalogInputModality | "" {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "text":
    case "image":
    case "audio":
    case "video":
      return normalized;
    default:
      return "";
  }
}

function normalizeRuntimeModelInputModalities(
  rawValues: unknown[],
): ModelCatalogInputModality[] {
  const seen = new Set<ModelCatalogInputModality>();
  const inputModalities: ModelCatalogInputModality[] = [];
  for (const value of rawValues) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = normalizeRuntimeModelInputModality(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    inputModalities.push(normalized);
  }
  return inputModalities;
}

function runtimeModelInputModalityList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function runtimeModelMetadataFromPayload(
  providerId: string,
  modelId: string,
  payload: Record<string, unknown>,
): Partial<RuntimeProviderModelPayload> {
  const fallback = modelCatalog.catalogMetadataForProviderModel(
    providerId,
    modelId,
  );
  const label =
    runtimeFirstNonEmptyString(
      payload.label as string | undefined,
      payload.display_label as string | undefined,
      payload.displayLabel as string | undefined,
      payload.name as string | undefined,
    ) || fallback?.label;
  const explicitReasoning =
    typeof payload.reasoning === "boolean" ? payload.reasoning : undefined;
  const useFallbackReasoningMetadata = explicitReasoning !== false;
  const explicitThinkingValues = normalizeRuntimeModelThinkingValues([
    ...runtimeModelThinkingValueList(payload.thinking_values),
    ...runtimeModelThinkingValueList(payload.thinkingValues),
  ]);
  const explicitInputModalities = normalizeRuntimeModelInputModalities([
    ...runtimeModelInputModalityList(payload.input_modalities),
    ...runtimeModelInputModalityList(payload.inputModalities),
    ...runtimeModelInputModalityList(payload.input),
  ]);
  const explicitDefaultThinkingValue =
    payload.default_thinking_value === null || payload.defaultThinkingValue === null
      ? null
      : runtimeFirstNonEmptyString(
          payload.default_thinking_value as string | undefined,
          payload.defaultThinkingValue as string | undefined,
        );
  const thinkingValues =
    explicitThinkingValues.length > 0
      ? explicitThinkingValues
      : useFallbackReasoningMetadata
        ? fallback?.thinkingValues
        : [];
  const inputModalities =
    explicitInputModalities.length > 0
      ? explicitInputModalities
      : fallback?.inputModalities;
  const defaultThinkingValue =
    explicitDefaultThinkingValue !== undefined
      ? explicitDefaultThinkingValue
      : useFallbackReasoningMetadata
        ? fallback?.defaultThinkingValue
        : null;
  const reasoning = explicitReasoning ?? fallback?.reasoning;

  return {
    ...(label ? { label } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(thinkingValues !== undefined ? { thinkingValues } : {}),
    ...(defaultThinkingValue !== undefined ? { defaultThinkingValue } : {}),
    ...(inputModalities !== undefined ? { inputModalities } : {}),
  };
}

function upsertRuntimeProviderModel(
  models: Map<string, RuntimeProviderModelPayload>,
  payload: RuntimeProviderModelPayload,
): void {
  const existing = models.get(payload.token);
  const mergedCapabilities = normalizeRuntimeModelCapabilities([
    ...(Array.isArray(existing?.capabilities) ? existing.capabilities : []),
    ...(Array.isArray(payload.capabilities) ? payload.capabilities : []),
  ]);
  models.set(payload.token, {
    token: payload.token,
    modelId: payload.modelId,
    ...(payload.label?.trim() || existing?.label
      ? { label: payload.label?.trim() || existing?.label }
      : {}),
    ...(payload.reasoning !== undefined
      ? { reasoning: payload.reasoning }
      : existing?.reasoning !== undefined
        ? { reasoning: existing.reasoning }
        : {}),
    ...(payload.thinkingValues !== undefined
      ? { thinkingValues: [...payload.thinkingValues] }
      : existing?.thinkingValues !== undefined
        ? { thinkingValues: [...existing.thinkingValues] }
        : {}),
    ...(payload.defaultThinkingValue !== undefined
      ? { defaultThinkingValue: payload.defaultThinkingValue }
      : existing?.defaultThinkingValue !== undefined
        ? { defaultThinkingValue: existing.defaultThinkingValue }
        : {}),
    ...(payload.inputModalities !== undefined
      ? { inputModalities: [...payload.inputModalities] }
      : existing?.inputModalities !== undefined
        ? { inputModalities: [...existing.inputModalities] }
        : {}),
    ...(mergedCapabilities.length > 0
      ? { capabilities: mergedCapabilities }
      : {}),
  });
}

function normalizeRuntimeProviderModelGroups(
  rawGroups: unknown[],
): RuntimeProviderModelGroupPayload[] {
  const providers = new Map<string, { label: string; kind: string }>();
  const groupedModels = new Map<
    string,
    Map<string, RuntimeProviderModelPayload>
  >();
  const ensureProviderGroup = (providerId: string) => {
    if (!groupedModels.has(providerId)) {
      groupedModels.set(
        providerId,
        new Map<string, RuntimeProviderModelPayload>(),
      );
    }
    return groupedModels.get(providerId)!;
  };

  for (const rawGroup of rawGroups) {
    const groupPayload = runtimeConfigObject(rawGroup);
    const providerId = canonicalRuntimeProviderId(
      runtimeFirstNonEmptyString(
        groupPayload.providerId as string | undefined,
        groupPayload.provider_id as string | undefined,
      ),
    );
    if (!providerId) {
      continue;
    }

    providers.set(providerId, {
      label:
        runtimeFirstNonEmptyString(
          groupPayload.providerLabel as string | undefined,
          groupPayload.provider_label as string | undefined,
        ) || runtimeProviderLabel(providerId),
      kind: normalizeRuntimeProviderKind(
        runtimeFirstNonEmptyString(
          groupPayload.kind as string | undefined,
          groupPayload.provider_kind as string | undefined,
        ),
        providerId,
        "",
      ),
    });

    const models = Array.isArray(groupPayload.models)
      ? groupPayload.models
      : [];
    for (const rawModel of models) {
      const modelPayload = runtimeConfigObject(rawModel);
      const modelId = normalizeRuntimeProviderModelId(
        providerId,
        runtimeFirstNonEmptyString(
          modelPayload.modelId as string | undefined,
          modelPayload.model_id as string | undefined,
          runtimeModelIdFromToken(
            runtimeFirstNonEmptyString(
              modelPayload.token as string | undefined,
              modelPayload.model_token as string | undefined,
            ),
          ),
        ),
      );
      if (
        !modelId ||
        isDeprecatedRuntimeModelId(modelId)
      ) {
        continue;
      }
      const token = canonicalRuntimeModelToken(
        providerId,
        normalizeRuntimeProviderModelToken(
          providerId,
          runtimeFirstNonEmptyString(
            modelPayload.token as string | undefined,
            modelPayload.model_token as string | undefined,
          ),
          modelId,
        ),
        modelId,
      );
      const capabilities = normalizeRuntimeModelCapabilities([
        ...runtimeModelCapabilityList(modelPayload.capabilities),
        ...runtimeModelCapabilityList(modelPayload.model_capabilities),
        ...runtimeModelCapabilityList(modelPayload.modalities),
        ...runtimeModelCapabilityList(modelPayload.model_modalities),
      ]);
      const metadata = runtimeModelMetadataFromPayload(
        providerId,
        modelId,
        modelPayload,
      );
      upsertRuntimeProviderModel(ensureProviderGroup(providerId), {
        token,
        modelId,
        ...metadata,
        ...(capabilities.length > 0 ? { capabilities } : {}),
      });
    }
  }

  const groups: RuntimeProviderModelGroupPayload[] = [];
  for (const [providerId, provider] of providers.entries()) {
    const models = Array.from(ensureProviderGroup(providerId).values());
    if (models.length === 0) {
      continue;
    }
    groups.push({
      providerId,
      providerLabel: provider.label,
      kind: provider.kind,
      models,
    });
  }
  return groups;
}

function normalizeRuntimeHolabossCatalogDefaultModelId(
  value: string | null | undefined,
): string {
  const normalized = runtimeFirstNonEmptyString(value);
  if (!normalized) {
    return "";
  }
  const modelId = normalizeRuntimeProviderModelId(
    RUNTIME_HOLABOSS_PROVIDER_ID,
    runtimeModelIdFromToken(normalized),
  );
  if (
    !modelId ||
    isDeprecatedRuntimeModelId(modelId)
  ) {
    return "";
  }
  return modelId;
}

function runtimeProviderModelGroups(
  document: Record<string, unknown>,
  _loadedLegacy: Record<string, string>,
  managedCatalogGroups: RuntimeProviderModelGroupPayload[],
): RuntimeProviderModelGroupPayload[] {
  const providersPayload = runtimeConfigObject(document.providers);
  const modelsPayload = runtimeConfigObject(document.models);
  const providers = new Map<
    string,
    { id: string; kind: string; label: string }
  >();
  const groupedModels = new Map<
    string,
    Map<string, RuntimeProviderModelPayload>
  >();
  const ensureProviderGroup = (providerId: string) => {
    if (!groupedModels.has(providerId)) {
      groupedModels.set(
        providerId,
        new Map<string, RuntimeProviderModelPayload>(),
      );
    }
    return groupedModels.get(providerId)!;
  };
  const addModel = (
    providerId: string,
    token: string,
    modelId: string,
    capabilities?: string[],
    metadata?: Partial<RuntimeProviderModelPayload>,
  ) => {
    const normalizedProviderId = canonicalRuntimeProviderId(providerId);
    const normalizedModelId = normalizeRuntimeProviderModelId(
      normalizedProviderId,
      modelId,
    );
    if (
      !normalizedProviderId ||
      !normalizedModelId ||
      isDeprecatedRuntimeModelId(normalizedModelId)
    ) {
      return;
    }
    const normalizedToken = canonicalRuntimeModelToken(
      normalizedProviderId,
      normalizeRuntimeProviderModelToken(
        normalizedProviderId,
        token,
        normalizedModelId,
      ),
      normalizedModelId,
    );
    if (isDeprecatedRuntimeModelId(normalizedToken)) {
      return;
    }
    const group = ensureProviderGroup(normalizedProviderId);
    upsertRuntimeProviderModel(group, {
      token: normalizedToken,
      modelId: normalizedModelId,
      ...(metadata ?? {}),
      ...(Array.isArray(capabilities) && capabilities.length > 0
        ? { capabilities }
        : {}),
    });
  };
  const mergeManagedCatalog = (groups: RuntimeProviderModelGroupPayload[]) => {
    for (const group of groups) {
      const providerId = canonicalRuntimeProviderId(group.providerId);
      if (!providerId) {
        continue;
      }
      if (!providers.has(providerId)) {
        providers.set(providerId, {
          id: providerId,
          kind: normalizeRuntimeProviderKind(group.kind, providerId, ""),
          label: group.providerLabel || runtimeProviderLabel(providerId),
        });
      }
      for (const model of group.models) {
        addModel(
          providerId,
          model.token,
          model.modelId,
          Array.isArray(model.capabilities) ? model.capabilities : [],
          {
            ...(model.label ? { label: model.label } : {}),
            ...(model.reasoning !== undefined
              ? { reasoning: model.reasoning }
              : {}),
            ...(model.thinkingValues !== undefined
              ? { thinkingValues: [...model.thinkingValues] }
              : {}),
            ...(model.defaultThinkingValue !== undefined
              ? { defaultThinkingValue: model.defaultThinkingValue }
              : {}),
            ...(model.inputModalities !== undefined
              ? { inputModalities: [...model.inputModalities] }
              : {}),
          },
        );
      }
    }
  };

  mergeManagedCatalog(managedCatalogGroups);

  for (const [providerId, rawProvider] of Object.entries(providersPayload)) {
    const canonicalProviderId = canonicalRuntimeProviderId(providerId);
    if (isHolabossProviderAlias(canonicalProviderId)) {
      continue;
    }
    const providerPayload = runtimeConfigObject(rawProvider);
    const optionsPayload = runtimeConfigObject(providerPayload.options);
    const baseUrl = runtimeFirstNonEmptyString(
      providerPayload.base_url as string | undefined,
      providerPayload.baseURL as string | undefined,
      optionsPayload.baseURL as string | undefined,
      optionsPayload.base_url as string | undefined,
    );
    const kind = normalizeRuntimeProviderKind(
      runtimeFirstNonEmptyString(
        providerPayload.kind as string | undefined,
        providerPayload.type as string | undefined,
        optionsPayload.kind as string | undefined,
      ),
      canonicalProviderId,
      baseUrl,
    );
    providers.set(canonicalProviderId, {
      id: canonicalProviderId,
      kind,
      label: runtimeProviderLabel(canonicalProviderId),
    });
  }

  for (const [token, rawModel] of Object.entries(modelsPayload)) {
    const modelPayload = runtimeConfigObject(rawModel);
    let providerId = runtimeFirstNonEmptyString(
      modelPayload.provider_id as string | undefined,
      modelPayload.provider as string | undefined,
    );
    let modelId = runtimeFirstNonEmptyString(
      modelPayload.model_id as string | undefined,
      modelPayload.model as string | undefined,
    );
    if (!providerId && token.includes("/")) {
      const [prefix, ...rest] = token.split("/");
      const normalizedPrefix = canonicalRuntimeProviderId(prefix);
      if (providers.has(normalizedPrefix) && rest.length > 0) {
        providerId = normalizedPrefix;
        modelId = modelId || rest.join("/");
      }
    }
    if (providerId && modelId) {
      const normalizedProviderId = canonicalRuntimeProviderId(providerId);
      if (isHolabossProviderAlias(normalizedProviderId)) {
        continue;
      }
      if (providers.has(normalizedProviderId)) {
        addModel(
          normalizedProviderId,
          token,
          modelId,
          undefined,
          runtimeModelMetadataFromPayload(
            normalizedProviderId,
            modelId,
            modelPayload,
          ),
        );
      }
    }
  }

  const groups: RuntimeProviderModelGroupPayload[] = [];
  const providerIds = new Set<string>([
    ...Array.from(providers.keys()),
    ...Array.from(groupedModels.keys()),
  ]);
  for (const providerId of providerIds) {
    const modelMap =
      groupedModels.get(providerId) ??
      new Map<string, RuntimeProviderModelPayload>();
    const provider = providers.get(providerId);
    if (modelMap.size === 0) {
      continue;
    }
    groups.push({
      providerId,
      providerLabel: provider?.label ?? runtimeProviderLabel(providerId),
      kind: provider?.kind ?? normalizeRuntimeProviderKind("", providerId, ""),
      models: Array.from(modelMap.values()),
    });
  }
  return groups;
}

function isHolabossProviderAlias(providerId: string): boolean {
  const normalized = providerId.trim().toLowerCase();
  return RUNTIME_HOLABOSS_PROVIDER_ALIASES.some(
    (alias) => alias === normalized,
  );
}

function runtimeModelCatalogPayloadFromResponse(
  payload:
    | RuntimeModelCatalogResponsePayload
    | RuntimeBindingExchangePayload
    | null
    | undefined,
): RuntimeModelCatalogPayload {
  return {
    catalogVersion:
      runtimeConfigField(payload?.catalog_version as string | undefined) ||
      null,
    defaultBackgroundModel:
      normalizeRuntimeHolabossCatalogDefaultModelId(
        runtimeConfigField(
          payload?.default_background_model as string | undefined,
        ) || "",
      ) || null,
    defaultEmbeddingModel:
      normalizeRuntimeHolabossCatalogDefaultModelId(
        runtimeConfigField(
          payload?.default_embedding_model as string | undefined,
        ) || "",
      ) || null,
    defaultImageModel:
      normalizeRuntimeHolabossCatalogDefaultModelId(
        runtimeConfigField(
          payload?.default_image_model as string | undefined,
        ) || "",
      ) || null,
    providerModelGroups: normalizeRuntimeProviderModelGroups(
      Array.isArray(payload?.provider_model_groups)
        ? payload.provider_model_groups
        : [],
    ),
    fetchedAt: utcNowIso(),
  };
}

async function syncRuntimeModelCatalogFromBinding(
  binding: RuntimeBindingExchangePayload,
): Promise<void> {
  const payload = runtimeModelCatalogPayloadFromResponse(binding);
  if (
    payload.catalogVersion ||
    payload.defaultBackgroundModel ||
    payload.defaultEmbeddingModel ||
    payload.defaultImageModel ||
    payload.providerModelGroups.length > 0
  ) {
    await persistRuntimeModelCatalog(payload);
    return;
  }
  await refreshRuntimeModelCatalogIfNeeded({ force: true }).catch(
    () => undefined,
  );
}

async function persistRuntimeModelCatalog(
  payload: RuntimeModelCatalogPayload,
): Promise<void> {
  runtimeModelCatalogState = payload;
  lastRuntimeModelCatalogRefreshAtMs = Date.now();
  lastRuntimeModelCatalogRefreshFailureAtMs = 0;
  await writeJsonFile(runtimeModelCatalogCachePath(), {
    catalogVersion: payload.catalogVersion,
    defaultBackgroundModel: payload.defaultBackgroundModel,
    defaultEmbeddingModel: payload.defaultEmbeddingModel,
    defaultImageModel: payload.defaultImageModel,
    providerModelGroups: payload.providerModelGroups,
    fetchedAt: payload.fetchedAt,
  });
}

async function clearRuntimeModelCatalog(): Promise<void> {
  runtimeModelCatalogState = {
    catalogVersion: null,
    defaultBackgroundModel: null,
    defaultEmbeddingModel: null,
    defaultImageModel: null,
    providerModelGroups: [],
    fetchedAt: null,
  };
  lastRuntimeModelCatalogRefreshAtMs = 0;
  lastRuntimeModelCatalogRefreshFailureAtMs = 0;
  try {
    await fs.rm(runtimeModelCatalogCachePath(), { force: true });
  } catch {
    // ignore cache cleanup errors
  }
}

async function withRuntimeModelCatalogRefreshLock<T>(
  work: () => Promise<T>,
): Promise<T> {
  while (runtimeModelCatalogRefreshPromise) {
    await runtimeModelCatalogRefreshPromise;
  }

  let releaseLock = () => {};
  runtimeModelCatalogRefreshPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  try {
    return await work();
  } finally {
    releaseLock();
    runtimeModelCatalogRefreshPromise = null;
  }
}

function shouldRefreshRuntimeModelCatalog(force = false): boolean {
  if (force) {
    return true;
  }
  if (runtimeModelCatalogState.providerModelGroups.length === 0) {
    return true;
  }
  if (
    !runtimeModelCatalogState.defaultBackgroundModel ||
    !runtimeModelCatalogState.defaultEmbeddingModel ||
    !runtimeModelCatalogState.defaultImageModel
  ) {
    return true;
  }
  return (
    Date.now() - lastRuntimeModelCatalogRefreshAtMs >
    RUNTIME_MODEL_CATALOG_REFRESH_INTERVAL_MS
  );
}

function hasRecentRuntimeModelCatalogRefreshFailure(): boolean {
  return (
    lastRuntimeModelCatalogRefreshFailureAtMs > 0 &&
    Date.now() - lastRuntimeModelCatalogRefreshFailureAtMs <
      RUNTIME_MODEL_CATALOG_REFRESH_FAILURE_BACKOFF_MS
  );
}

async function fetchDesktopRuntimeModelCatalog(): Promise<RuntimeModelCatalogResponsePayload> {
  const controlPlaneBaseUrl = requireControlPlaneBaseUrl();
  const cookieHeader = authCookieHeader();
  if (!cookieHeader) {
    throw new Error("Better Auth session cookies are missing.");
  }

  const catalogUrl = `${controlPlaneBaseUrl}${DESKTOP_RUNTIME_MODEL_CATALOG_PATH}`;
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, RUNTIME_MODEL_CATALOG_FETCH_TIMEOUT_MS);
  timeout.unref();
  try {
    response = await fetch(catalogUrl, {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
      },
      signal: controller.signal,
    });
  } catch (error) {
    const detail =
      controller.signal.aborted &&
      error instanceof Error &&
      error.name === "AbortError"
        ? `timed out after ${RUNTIME_MODEL_CATALOG_FETCH_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(
      `Runtime model catalog request failed for ${catalogUrl}: ${detail}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      detail ||
        `Runtime model catalog request failed with status ${response.status}`,
    );
  }

  return response.json() as Promise<RuntimeModelCatalogResponsePayload>;
}

async function refreshRuntimeModelCatalogIfNeeded(options?: {
  force?: boolean;
}): Promise<RuntimeModelCatalogPayload> {
  if (!DESKTOP_CONTROL_PLANE_BASE_URL) {
    return runtimeModelCatalogState;
  }
  if (!authCookieHeader()) {
    return runtimeModelCatalogState;
  }
  if (!shouldRefreshRuntimeModelCatalog(Boolean(options?.force))) {
    if (await syncManagedHolabossDefaultsToRuntimeConfigIfNeeded()) {
      await emitRuntimeConfig();
    }
    return runtimeModelCatalogState;
  }
  if (!options?.force && hasRecentRuntimeModelCatalogRefreshFailure()) {
    if (await syncManagedHolabossDefaultsToRuntimeConfigIfNeeded()) {
      await emitRuntimeConfig();
    }
    return runtimeModelCatalogState;
  }

  try {
    await withRuntimeModelCatalogRefreshLock(async () => {
      if (!shouldRefreshRuntimeModelCatalog(Boolean(options?.force))) {
        return;
      }
      const payload = runtimeModelCatalogPayloadFromResponse(
        await fetchDesktopRuntimeModelCatalog(),
      );
      await persistRuntimeModelCatalog(payload);
      if (await syncManagedHolabossDefaultsToRuntimeConfigIfNeeded(payload)) {
        await emitRuntimeConfig();
      }
    });
  } catch (error) {
    lastRuntimeModelCatalogRefreshFailureAtMs = Date.now();
    if (runtimeModelCatalogState.providerModelGroups.length === 0) {
      throw error;
    }
  }

  return runtimeModelCatalogState;
}

async function getRuntimeConfigSnapshot(
  managedCatalog: RuntimeModelCatalogPayload = runtimeModelCatalogState,
): Promise<RuntimeConfigPayload> {
  const configPath = runtimeConfigPath();
  const loaded = await readRuntimeConfigFile();
  const document = await readRuntimeConfigDocument();
  return {
    configPath,
    loadedFromFile:
      Object.keys(document).length > 0 || Object.keys(loaded).length > 0,
    authTokenPresent: Boolean(runtimeModelProxyApiKeyFromConfig(loaded)),
    userId: loaded.user_id ?? null,
    sandboxId: loaded.sandbox_id ?? null,
    modelProxyBaseUrl: loaded.model_proxy_base_url ?? null,
    defaultModel: loaded.default_model ?? null,
    defaultBackgroundModel: managedCatalog.defaultBackgroundModel,
    defaultEmbeddingModel: managedCatalog.defaultEmbeddingModel,
    defaultImageModel: managedCatalog.defaultImageModel,
    controlPlaneBaseUrl: loaded.control_plane_base_url ?? null,
    catalogVersion: managedCatalog.catalogVersion,
    providerModelGroups: runtimeProviderModelGroups(
      document,
      loaded,
      managedCatalog.providerModelGroups,
    ),
  };
}

function refreshRuntimeModelCatalogInBackground(): void {
  void refreshRuntimeModelCatalogIfNeeded()
    .then(async () => {
      await emitRuntimeConfig();
    })
    .catch(() => undefined);
}

async function syncManagedHolabossDefaultsToRuntimeConfigIfNeeded(
  managedCatalog: RuntimeModelCatalogPayload = runtimeModelCatalogState,
): Promise<boolean> {
  const currentConfig = await readRuntimeConfigFile();
  const currentDocument = await readRuntimeConfigDocument();
  if (
    !runtimeBindingNeedsManagedHolabossDefaultsRefresh(
      currentConfig,
      currentDocument,
    )
  ) {
    return false;
  }

  await writeRuntimeConfigFile({
    defaultBackgroundModel: managedCatalog.defaultBackgroundModel,
    defaultEmbeddingModel: managedCatalog.defaultEmbeddingModel,
    defaultImageModel: managedCatalog.defaultImageModel,
  });
  return true;
}

function runtimeConfigRestartRequired(
  current: Record<string, string>,
  next: Record<string, string>,
): boolean {
  for (const key of [
    "auth_token",
    "model_proxy_api_key",
    "user_id",
    "sandbox_id",
    "model_proxy_base_url",
    "default_model",
    "control_plane_base_url",
  ] as const) {
    if (runtimeConfigField(current[key]) !== runtimeConfigField(next[key])) {
      return true;
    }
  }
  return false;
}

async function restartEmbeddedRuntimeIfNeeded(
  current: Record<string, string>,
  next: Record<string, string>,
): Promise<boolean> {
  if (!runtimeConfigRestartRequired(current, next)) {
    return false;
  }
  await stopEmbeddedRuntime();
  void startEmbeddedRuntime();
  return true;
}

function withRuntimeLifecycleLock<T>(work: () => Promise<T>): Promise<T> {
  const run = runtimeLifecycleChain.then(work, work);
  runtimeLifecycleChain = run.then(() => undefined).catch(() => undefined);
  return run;
}

async function withRuntimeBindingRefreshLock<T>(
  work: () => Promise<T>,
): Promise<T> {
  while (runtimeBindingRefreshPromise) {
    await runtimeBindingRefreshPromise;
  }

  let releaseLock = () => {};
  runtimeBindingRefreshPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  try {
    return await work();
  } finally {
    releaseLock();
    runtimeBindingRefreshPromise = null;
  }
}

async function withRuntimeConfigMutationLock<T>(
  work: () => Promise<T>,
): Promise<T> {
  while (runtimeConfigMutationPromise) {
    await runtimeConfigMutationPromise;
  }

  let releaseLock = () => {};
  runtimeConfigMutationPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  try {
    return await work();
  } finally {
    releaseLock();
    runtimeConfigMutationPromise = null;
  }
}

async function getRuntimeConfig(): Promise<RuntimeConfigPayload> {
  refreshRuntimeModelCatalogInBackground();
  return getRuntimeConfigSnapshot(runtimeModelCatalogState);
}

async function getRuntimeConfigWithoutCatalogRefresh(): Promise<RuntimeConfigPayload> {
  const managedCatalog = runtimeModelCatalogState;
  if (await syncManagedHolabossDefaultsToRuntimeConfigIfNeeded(managedCatalog)) {
    return getRuntimeConfigSnapshot(runtimeModelCatalogState);
  }
  return getRuntimeConfigSnapshot(managedCatalog);
}

async function getRuntimeConfigDocumentText(): Promise<string> {
  const document = await readRuntimeConfigDocument();
  if (Object.keys(document).length > 0) {
    return `${JSON.stringify(document, null, 2)}\n`;
  }
  return `{
  "runtime": {
    "sandbox_id": "desktop:replace-me"
  },
  "providers": {},
  "models": {}
}
`;
}

async function setRuntimeConfigDocument(
  rawDocument: string,
): Promise<RuntimeConfigPayload> {
  const trimmed = rawDocument.trim();
  if (!trimmed) {
    throw new Error("Runtime config JSON is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Invalid runtime config JSON: ${error.message}`
        : "Invalid runtime config JSON.",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Runtime config must be a JSON object.");
  }

  const nextText = `${JSON.stringify(parsed, null, 2)}\n`;
  let shouldRestartRuntime = false;
  await withRuntimeConfigMutationLock(async () => {
    const currentDocument = await readRuntimeConfigDocument();
    const currentText =
      Object.keys(currentDocument).length > 0
        ? `${JSON.stringify(currentDocument, null, 2)}\n`
        : "";

    if (currentText !== nextText) {
      await writeRuntimeConfigTextAtomically(nextText);
      shouldRestartRuntime = true;
    }
  });

  if (shouldRestartRuntime) {
    await stopEmbeddedRuntime();
    void startEmbeddedRuntime();
  }

  const config = await getRuntimeConfig();
  await emitRuntimeConfig(config);
  return config;
}

function runtimeUserProfileNameSourceFromApi(
  value: unknown,
): RuntimeUserProfileNameSource | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "manual" || normalized === "agent") {
    return normalized;
  }
  if (normalized === "auth_fallback") {
    return "authFallback";
  }
  return null;
}

function runtimeUserProfileNameSourceToApi(
  value: RuntimeUserProfileNameSource | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (value === "authFallback") {
    return "auth_fallback";
  }
  return value;
}

function runtimeUserProfilePayloadFromApi(
  value: unknown,
): RuntimeUserProfilePayload {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    profileId:
      typeof record.profile_id === "string" && record.profile_id.trim()
        ? record.profile_id
        : "default",
    name:
      typeof record.name === "string" && record.name.trim()
        ? record.name
        : null,
    nameSource: runtimeUserProfileNameSourceFromApi(record.name_source),
    createdAt:
      typeof record.created_at === "string" && record.created_at.trim()
        ? record.created_at
        : null,
    updatedAt:
      typeof record.updated_at === "string" && record.updated_at.trim()
        ? record.updated_at
        : null,
  };
}

async function runtimeApiRequest<T>(
  pathname: string,
  init: RequestInit = {},
): Promise<T> {
  const status = await ensureRuntimeReady();
  const baseUrl = status.url ?? runtimeBaseUrl();
  const targetUrl = new URL(
    pathname,
    `${baseUrl.replace(/\/+$/, "")}/`,
  ).toString();
  const response = await fetch(targetUrl, init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      detail.trim() ||
        `Runtime API request failed: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

async function getRuntimeUserProfile(): Promise<RuntimeUserProfilePayload> {
  const payload = await runtimeApiRequest<unknown>("/api/v1/runtime/profile", {
    method: "GET",
  });
  return runtimeUserProfilePayloadFromApi(payload);
}

async function setRuntimeUserProfile(
  payload: RuntimeUserProfileUpdatePayload,
): Promise<RuntimeUserProfilePayload> {
  const body: Record<string, unknown> = {};
  if (typeof payload.profileId === "string" && payload.profileId.trim()) {
    body.profile_id = payload.profileId.trim();
  }
  if (payload.name !== undefined) {
    body.name = payload.name;
  }
  if (payload.nameSource !== undefined) {
    body.name_source = runtimeUserProfileNameSourceToApi(payload.nameSource);
  }
  const response = await runtimeApiRequest<unknown>("/api/v1/runtime/profile", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return runtimeUserProfilePayloadFromApi(response);
}

async function applyRuntimeUserProfileAuthFallback(
  name: string,
  profileId = "default",
): Promise<RuntimeUserProfilePayload> {
  const response = await runtimeApiRequest<unknown>(
    "/api/v1/runtime/profile/auth-fallback",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        profile_id: profileId,
        name,
      }),
    },
  );
  return runtimeUserProfilePayloadFromApi(response);
}

async function syncRuntimeUserProfileFromAuth(
  user: AuthUserPayload,
): Promise<void> {
  const name = typeof user.name === "string" ? user.name.trim() : "";
  if (!name) {
    return;
  }
  try {
    await applyRuntimeUserProfileAuthFallback(name);
  } catch (error) {
    appendRuntimeEventLog({
      category: "auth",
      event: "runtime_profile.auth_fallback",
      outcome: "error",
      detail:
        error instanceof Error
          ? error.message
          : "Runtime profile auth fallback failed.",
    });
  }
}

async function exchangeDesktopRuntimeBinding(
  sandboxId: string,
): Promise<RuntimeBindingExchangePayload> {
  const controlPlaneBaseUrl = requireControlPlaneBaseUrl();
  const cookieHeader = authCookieHeader();
  if (!cookieHeader) {
    throw new Error("Better Auth session cookies are missing.");
  }

  const exchangeUrl = `${controlPlaneBaseUrl}${DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH}`;
  let response: Response;
  try {
    response = await fetch(exchangeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        sandbox_id: sandboxId,
        target_kind: "desktop",
      }),
    });
  } catch (error) {
    throw new Error(
      `Runtime binding exchange request failed for ${exchangeUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      detail ||
        `Runtime binding exchange failed with status ${response.status}`,
    );
  }

  return response.json() as Promise<RuntimeBindingExchangePayload>;
}

function emitAuthAuthenticated(user: AuthUserPayload) {
  pendingAuthUser = user;
  pendingAuthError = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:authenticated", user);
  }
  if (authPopupWindow && !authPopupWindow.isDestroyed()) {
    authPopupWindow.webContents.send("auth:authenticated", user);
  }
  // Notify any pending 401 retry waiters that auth completed.
  for (const listener of gatewayAuthCallbackListeners) {
    listener();
  }
}

function emitAuthUserUpdated(user: AuthUserPayload | null) {
  pendingAuthUser = user;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:userUpdated", user);
  }
  if (authPopupWindow && !authPopupWindow.isDestroyed()) {
    authPopupWindow.webContents.send("auth:userUpdated", user);
  }
  // Notify 401 retry waiters — auth succeeded via session recovery
  // (handles callback paths C/D where emitAuthAuthenticated is not called).
  if (user) {
    for (const listener of gatewayAuthCallbackListeners) {
      listener();
    }
  }
}

function emitAuthError(payload: AuthErrorPayload) {
  pendingAuthError = payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:error", payload);
  }
  if (authPopupWindow && !authPopupWindow.isDestroyed()) {
    authPopupWindow.webContents.send("auth:error", payload);
  }
  // Reject any pending 401 retry waiters so they fail fast instead of
  // hanging until the 2-minute timeout.
  for (const listener of gatewayAuthErrorListeners) {
    listener(payload);
  }
}

function emitPendingAuthState() {
  if (pendingAuthUser) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("auth:userUpdated", pendingAuthUser);
    }
    if (authPopupWindow && !authPopupWindow.isDestroyed()) {
      authPopupWindow.webContents.send("auth:userUpdated", pendingAuthUser);
    }
  }
  if (pendingAuthError) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("auth:error", pendingAuthError);
    }
    if (authPopupWindow && !authPopupWindow.isDestroyed()) {
      authPopupWindow.webContents.send("auth:error", pendingAuthError);
    }
    pendingAuthError = null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("appUpdate:state", appUpdateStatus);
  }
}

function clearPersistedAuthCookie() {
  const configPath = authStorageConfigPath();
  if (!existsSync(configPath)) {
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const root = parsed && typeof parsed === "object" ? parsed : null;
    if (!root) {
      return;
    }

    const betterAuthRaw = root["better-auth"];
    if (
      !betterAuthRaw ||
      typeof betterAuthRaw !== "object" ||
      Array.isArray(betterAuthRaw)
    ) {
      return;
    }

    const betterAuth = { ...(betterAuthRaw as Record<string, unknown>) };
    let cleared = false;
    if ("cookie" in betterAuth) {
      delete betterAuth.cookie;
      cleared = true;
    }
    if ("local_cache" in betterAuth) {
      delete betterAuth.local_cache;
      cleared = true;
    }
    if (!cleared) {
      return;
    }
    if (Object.keys(betterAuth).length === 0) {
      delete root["better-auth"];
    } else {
      root["better-auth"] = betterAuth;
    }

    writeFileSync(configPath, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
  } catch {
    // Best-effort recovery path for stale encrypted cookie state.
  }
}

function authCookieHeader() {
  if (!desktopAuthClient) {
    return "";
  }

  const isUsableCookieHeader = (value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      return false;
    }
    if (normalized.toLowerCase().includes("invalid-encrypted-cookie")) {
      return false;
    }
    return normalized.includes("=");
  };

  const readCookieOrThrow = () => {
    const cookie = requireAuthClient().getCookie() || "";
    if (!isUsableCookieHeader(cookie)) {
      throw new Error("Better Auth cookie is missing or invalid.");
    }
    return cookie;
  };

  try {
    return readCookieOrThrow();
  } catch (error) {
    appendRuntimeEventLog({
      category: "auth",
      event: "auth.cookie.read",
      outcome: "error",
      detail:
        error instanceof Error
          ? error.message
          : "Failed to read Better Auth cookie.",
    });
    clearPersistedAuthCookie();

    try {
      return readCookieOrThrow();
    } catch (retryError) {
      appendRuntimeEventLog({
        category: "auth",
        event: "auth.cookie.read",
        outcome: "error",
        detail:
          retryError instanceof Error
            ? retryError.message
            : "Failed to read Better Auth cookie after reset.",
      });
      return "";
    }
  }
}

function requireAuthClient() {
  if (!desktopAuthClient) {
    throw new Error(
      "Remote authentication is not configured. Set HOLABOSS_AUTH_BASE_URL and HOLABOSS_AUTH_SIGN_IN_URL outside the public repo.",
    );
  }
  return desktopAuthClient;
}

let marketplaceAppSdkClientCache: ReturnType<typeof buildAppSdkClient> | null =
  null;

function getMarketplaceAppSdkClient() {
  if (marketplaceAppSdkClientCache) {
    return marketplaceAppSdkClientCache;
  }
  if (!AUTH_BASE_URL) {
    throw new Error(
      "Remote backend is not configured. Set HOLABOSS_AUTH_BASE_URL outside the public repo.",
    );
  }
  marketplaceAppSdkClientCache = buildAppSdkClient({
    baseURL: `${AUTH_BASE_URL.replace(/\/+$/, "")}/api/marketplace`,
    getCookie: authCookieHeader,
    // Intentionally do NOT clear the persisted cookie on 401 — the marketplace
    // BFF may 401 for reasons unrelated to cookie validity (e.g. session
    // middleware not attaching to OpenAPIHono sub-routes). Clearing the cookie
    // would destroy a valid session shared with `billingFetch`, which would
    // then fail too. Treat cookie lifecycle as owned by the auth flow itself.
  });
  return marketplaceAppSdkClientCache;
}

function requireControlPlaneBaseUrl() {
  if (!DESKTOP_CONTROL_PLANE_BASE_URL) {
    throw new Error(
      "Remote backend is not configured. Set HOLABOSS_BACKEND_BASE_URL outside the public repo.",
    );
  }
  return DESKTOP_CONTROL_PLANE_BASE_URL;
}

async function getAuthenticatedUser(): Promise<AuthUserPayload | null> {
  if (!AUTH_BASE_URL) {
    return null;
  }

  const cookieHeader = authCookieHeader();
  if (!cookieHeader) {
    return null;
  }

  const response = await fetch(`${AUTH_BASE_URL}/api/auth/get-session`, {
    method: "GET",
    headers: {
      Cookie: cookieHeader,
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearPersistedAuthCookie();
      return null;
    }
    const detail = await response.text();
    throw new Error(
      detail || `Failed to load auth session with status ${response.status}`,
    );
  }

  const payload = (await response.json()) as { user?: AuthUserPayload } | null;
  return payload?.user ?? null;
}

const DESKTOP_BILLING_TOKENS_PER_CREDIT = 2000;
const DESKTOP_BILLING_LOW_BALANCE_THRESHOLD = 10;
const DESKTOP_BILLING_PLAN_META = {
  basic: {
    planId: "basic",
    planName: "Holaboss",
    monthlyCreditsIncluded: 200,
  },
  pro: {
    planId: "pro",
    planName: "Holaboss Pro",
    monthlyCreditsIncluded: 2000,
  },
  customize: {
    planId: "customize",
    planName: "Holaboss Custom",
    monthlyCreditsIncluded: null,
  },
} as const;

type DesktopBillingPlanMeta =
  (typeof DESKTOP_BILLING_PLAN_META)[keyof typeof DESKTOP_BILLING_PLAN_META];

function desktopBillingTokensToCredits(tokens: number): number {
  return Math.floor(tokens / DESKTOP_BILLING_TOKENS_PER_CREDIT);
}

function desktopBillingPlanMeta(
  plan: string | null | undefined,
): DesktopBillingPlanMeta {
  if (plan === "pro" || plan === "customize") {
    return DESKTOP_BILLING_PLAN_META[plan];
  }
  return DESKTOP_BILLING_PLAN_META.basic;
}

async function billingFetch<T>(path: string, input?: unknown): Promise<T> {
  if (!AUTH_BASE_URL) {
    throw new Error(
      "Remote billing is not configured. Set HOLABOSS_AUTH_BASE_URL outside the public repo.",
    );
  }

  const cookieHeader = authCookieHeader();
  if (!cookieHeader) {
    throw new Error("Not authenticated — sign in first.");
  }

  const response = await fetch(`${AUTH_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input === undefined ? {} : { json: input }),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearPersistedAuthCookie();
      throw new Error("Not authenticated — sign in first.");
    }
    const detail = await response.text();
    throw new Error(
      detail || `Desktop billing request failed with status ${response.status}`,
    );
  }

  const payload =
    (await response.json()) as DesktopBillingRpcEnvelope<T> | null;
  if (!payload || !("json" in payload)) {
    throw new Error("Desktop billing received a malformed RPC response.");
  }

  return payload.json;
}

function desktopAppBaseUrl(): string {
  if (!AUTH_BASE_URL) {
    return HOLABOSS_HOME_URL;
  }

  try {
    const parsed = new URL(AUTH_BASE_URL);
    if (parsed.hostname === "localhost" && parsed.port === "4000") {
      parsed.port = "4321";
      return parsed.origin;
    }
    if (parsed.hostname.startsWith("api-preview.")) {
      parsed.hostname = parsed.hostname.replace(/^api-preview\./, "preview.");
      return parsed.origin;
    }
    if (parsed.hostname.startsWith("api.")) {
      parsed.hostname = parsed.hostname.replace(/^api\./, "app.");
      return parsed.origin;
    }
    return parsed.origin;
  } catch {
    return HOLABOSS_HOME_URL;
  }
}

function buildDesktopBillingLinks(
  appBaseUrl = desktopAppBaseUrl(),
): DesktopBillingLinksPayload {
  const normalizedBaseUrl = normalizeBaseUrl(appBaseUrl) || HOLABOSS_HOME_URL;
  return {
    billingPageUrl: `${normalizedBaseUrl}/app/settings?tab=billing`,
    addCreditsUrl: `${normalizedBaseUrl}/app/settings?tab=billing&intent=add-credits`,
    upgradeUrl: `${normalizedBaseUrl}/app/settings?tab=billing&intent=upgrade`,
    usageUrl: `${normalizedBaseUrl}/app/settings?tab=billing&intent=usage`,
  };
}

async function getDesktopBillingOverview(): Promise<DesktopBillingOverviewPayload> {
  const [quota, billingInfo] = await Promise.all([
    billingFetch<DesktopBillingQuotaRpcPayload>("/rpc/quota/myQuota"),
    billingFetch<DesktopBillingInfoRpcPayload>("/rpc/billing/myBillingInfo"),
  ]);
  const subscription = billingInfo.subscription;
  const planMeta = desktopBillingPlanMeta(subscription?.plan);
  const renewsAt =
    subscription && !subscription.cancelAtPeriodEnd
      ? subscription.currentPeriodEnd
      : null;
  const expiresAt = subscription?.cancelAtPeriodEnd
    ? subscription.currentPeriodEnd
    : null;
  const creditsBalance = quota.balance;

  return {
    hasHostedBillingAccount: true,
    planId: planMeta.planId,
    planName: planMeta.planName,
    planStatus: subscription?.status ?? "inactive",
    renewsAt,
    expiresAt,
    creditsBalance,
    totalAllocated: quota.totalAllocated,
    totalUsed: quota.totalUsed,
    monthlyCreditsIncluded: planMeta.monthlyCreditsIncluded,
    monthlyCreditsUsed: null,
    dailyRefreshCredits: null,
    dailyRefreshTarget: null,
    lowBalanceThreshold: DESKTOP_BILLING_LOW_BALANCE_THRESHOLD,
    isLowBalance:
      creditsBalance > 0 &&
      creditsBalance < DESKTOP_BILLING_LOW_BALANCE_THRESHOLD,
  };
}

async function getDesktopBillingUsage(
  limit = 10,
): Promise<DesktopBillingUsagePayload> {
  const normalizedLimit = Math.max(1, Math.min(limit, 50));
  const items = await billingFetch<DesktopBillingTransactionRpcPayload[]>(
    "/rpc/quota/myTransactions",
    { limit: normalizedLimit },
  );

  return {
    items: items.map((transaction) => {
      const amount = desktopBillingTokensToCredits(transaction.amount);
      return {
        id: transaction.id,
        type: transaction.type,
        sourceType: transaction.sourceType,
        reason: transaction.reason,
        serviceType: transaction.serviceType,
        serviceId: transaction.serviceId,
        amount,
        absoluteAmount: Math.abs(amount),
        createdAt: transaction.createdAt,
      };
    }),
    count: items.length,
  };
}

function authUserId(user: AuthUserPayload | null | undefined): string {
  if (!user || typeof user.id !== "string") {
    return "";
  }
  return user.id.trim();
}

function generateDesktopSandboxId(): string {
  return `desktop:${randomUUID()}`;
}

function runtimeConfigNeedsBindingRefresh(
  config: Record<string, string>,
  userId: string,
): boolean {
  const runtimeUserId = (config.user_id || "").trim();
  const hasAuthToken = Boolean(runtimeModelProxyApiKeyFromConfig(config));
  const hasSandboxId = Boolean((config.sandbox_id || "").trim());
  const runtimeControlPlaneBaseUrl = normalizeBaseUrl(
    config.control_plane_base_url || "",
  );
  if (!hasAuthToken || !hasSandboxId) {
    return true;
  }
  if (!runtimeControlPlaneBaseUrl) {
    return true;
  }
  if (runtimeControlPlaneBaseUrl !== DESKTOP_CONTROL_PLANE_BASE_URL) {
    return true;
  }
  return runtimeUserId !== userId;
}

function runtimeConfigIsControlPlaneManaged(
  config: Record<string, string>,
): boolean {
  const runtimeControlPlaneBaseUrl = normalizeBaseUrl(
    config.control_plane_base_url || "",
  );
  if (runtimeControlPlaneBaseUrl) {
    return runtimeControlPlaneBaseUrl === DESKTOP_CONTROL_PLANE_BASE_URL;
  }
  const modelProxyBaseUrl = normalizeBaseUrl(config.model_proxy_base_url || "");
  return modelProxyBaseUrl.includes("/api/v1/model-proxy");
}

function runtimeBindingNeedsManagedHolabossDefaultsRefresh(
  config: Record<string, string>,
  document: Record<string, unknown>,
): boolean {
  if (!runtimeConfigIsControlPlaneManaged(config)) {
    return false;
  }
  if (
    runtimeModelCatalogState.providerModelGroups.length > 0 &&
    (
      !runtimeModelCatalogState.defaultBackgroundModel ||
      !runtimeModelCatalogState.defaultEmbeddingModel ||
      !runtimeModelCatalogState.defaultImageModel
    )
  ) {
    return true;
  }

  const runtimePayload = runtimeConfigObject(document.runtime);
  const currentBackgroundTasks = runtimeConfigObject(
    runtimePayload.background_tasks ?? runtimePayload.backgroundTasks,
  );
  const currentImageGeneration = runtimeConfigObject(
    runtimePayload.image_generation ?? runtimePayload.imageGeneration,
  );
  const currentRecallEmbeddings = runtimeConfigObject(
    runtimePayload.recall_embeddings ?? runtimePayload.recallEmbeddings,
  );
  const currentBackgroundProviderId = canonicalRuntimeProviderId(
    runtimeFirstNonEmptyString(
      currentBackgroundTasks.provider as string | undefined,
      currentBackgroundTasks.provider_id as string | undefined,
      currentBackgroundTasks.providerId as string | undefined,
    ),
  );
  const currentBackgroundModel = runtimeFirstNonEmptyString(
    currentBackgroundTasks.model as string | undefined,
    currentBackgroundTasks.model_id as string | undefined,
    currentBackgroundTasks.modelId as string | undefined,
  );
  const currentImageGenerationProviderId = canonicalRuntimeProviderId(
    runtimeFirstNonEmptyString(
      currentImageGeneration.provider as string | undefined,
      currentImageGeneration.provider_id as string | undefined,
      currentImageGeneration.providerId as string | undefined,
    ),
  );
  const currentImageGenerationModel = runtimeFirstNonEmptyString(
    currentImageGeneration.model as string | undefined,
    currentImageGeneration.model_id as string | undefined,
    currentImageGeneration.modelId as string | undefined,
  );
  const currentRecallEmbeddingsProviderId = canonicalRuntimeProviderId(
    runtimeFirstNonEmptyString(
      currentRecallEmbeddings.provider as string | undefined,
      currentRecallEmbeddings.provider_id as string | undefined,
      currentRecallEmbeddings.providerId as string | undefined,
    ),
  );
  const currentRecallEmbeddingsModel = runtimeFirstNonEmptyString(
    currentRecallEmbeddings.model as string | undefined,
    currentRecallEmbeddings.model_id as string | undefined,
    currentRecallEmbeddings.modelId as string | undefined,
  );

  return (
    (Boolean(runtimeModelCatalogState.defaultBackgroundModel) &&
      (Object.keys(currentBackgroundTasks).length === 0 ||
        (isHolabossProviderAlias(currentBackgroundProviderId) &&
          !currentBackgroundModel))) ||
    (Boolean(runtimeModelCatalogState.defaultEmbeddingModel) &&
      (Object.keys(currentRecallEmbeddings).length === 0 ||
        (isHolabossProviderAlias(currentRecallEmbeddingsProviderId) &&
          !currentRecallEmbeddingsModel))) ||
    (Boolean(runtimeModelCatalogState.defaultImageModel) &&
      (Object.keys(currentImageGeneration).length === 0 ||
        (isHolabossProviderAlias(currentImageGenerationProviderId) &&
          !currentImageGenerationModel)))
  );
}

function configuredProviderIdForRuntimeModelToken(
  modelToken: string | null | undefined,
): string {
  const normalizedModelToken = normalizeLegacyRuntimeModelToken(
    runtimeConfigField(modelToken ?? ""),
  );
  if (!normalizedModelToken.includes("/")) {
    return "";
  }
  const [providerId] = normalizedModelToken.split("/");
  return providerId.trim();
}

function sessionQueueRequiresRuntimeBinding(
  config: Record<string, string>,
  selectedModelToken: string | null | undefined,
): boolean {
  const explicitProviderId =
    configuredProviderIdForRuntimeModelToken(selectedModelToken);
  if (explicitProviderId) {
    return isHolabossProviderAlias(explicitProviderId);
  }

  const defaultProviderId = runtimeConfigField(config.default_provider);
  if (defaultProviderId) {
    return isHolabossProviderAlias(defaultProviderId);
  }

  const defaultModelProviderId = configuredProviderIdForRuntimeModelToken(
    config.default_model,
  );
  if (defaultModelProviderId) {
    return isHolabossProviderAlias(defaultModelProviderId);
  }

  return runtimeConfigIsControlPlaneManaged(config);
}

function shouldForceRuntimeBindingRefresh(userId: string): boolean {
  if (!userId) {
    return false;
  }
  if (lastRuntimeBindingRefreshUserId !== userId) {
    return true;
  }
  return (
    Date.now() - lastRuntimeBindingRefreshAtMs >
    RUNTIME_BINDING_REFRESH_INTERVAL_MS
  );
}

function hasRecentTransientRuntimeBindingRefreshFailure(
  userId: string,
): boolean {
  if (!userId) {
    return false;
  }
  if (lastRuntimeBindingRefreshFailureUserId !== userId) {
    return false;
  }
  return (
    Date.now() - lastRuntimeBindingRefreshFailureAtMs <
    RUNTIME_BINDING_REFRESH_FAILURE_BACKOFF_MS
  );
}

function markTransientRuntimeBindingRefreshFailure(userId: string): void {
  if (!userId) {
    return;
  }
  lastRuntimeBindingRefreshFailureAtMs = Date.now();
  lastRuntimeBindingRefreshFailureUserId = userId;
}

function clearTransientRuntimeBindingRefreshFailure(): void {
  lastRuntimeBindingRefreshFailureAtMs = 0;
  lastRuntimeBindingRefreshFailureUserId = "";
}

async function clearRuntimeBindingSecrets(reason: string): Promise<void> {
  appendRuntimeEventLog({
    category: "auth",
    event: "runtime_binding.invalidate",
    outcome: "start",
    detail: reason,
  });
  const currentConfig = await readRuntimeConfigFile();
  const nextConfig = await writeRuntimeConfigFile({
    authToken: null,
    modelProxyApiKey: null,
    userId: null,
    sandboxId: null,
    modelProxyBaseUrl: null,
    controlPlaneBaseUrl: null,
  });
  await clearRuntimeModelCatalog();
  lastRuntimeBindingRefreshAtMs = 0;
  lastRuntimeBindingRefreshUserId = "";
  clearTransientRuntimeBindingRefreshFailure();
  await restartEmbeddedRuntimeIfNeeded(currentConfig, nextConfig);
  await emitRuntimeConfig();
  appendRuntimeEventLog({
    category: "auth",
    event: "runtime_binding.invalidate",
    outcome: "success",
    detail: reason,
  });
}

async function provisionRuntimeBindingForAuthenticatedUser(
  user: AuthUserPayload,
  options?: {
    forceNewSandbox?: boolean;
    forceRefresh?: boolean;
    reason?: string;
  },
): Promise<void> {
  const userId = authUserId(user);
  if (!userId) {
    return;
  }

  await withRuntimeBindingRefreshLock(async () => {
    const forceNewSandbox = Boolean(options?.forceNewSandbox);
    const forceRefresh = Boolean(options?.forceRefresh);
    const currentConfig = await readRuntimeConfigFile();
    const currentDocument = await readRuntimeConfigDocument();
    const managedDefaultsNeedRefresh =
      runtimeBindingNeedsManagedHolabossDefaultsRefresh(
        currentConfig,
        currentDocument,
      );
    if (
      !forceNewSandbox &&
      !forceRefresh &&
      !runtimeConfigNeedsBindingRefresh(currentConfig, userId) &&
      !managedDefaultsNeedRefresh
    ) {
      await refreshRuntimeModelCatalogIfNeeded().catch(() => undefined);
      await syncRuntimeUserProfileFromAuth(user);
      return;
    }

    const runtimeSandboxId = (currentConfig.sandbox_id || "").trim();
    const runtimeUserId = (currentConfig.user_id || "").trim();
    const sandboxId =
      forceNewSandbox || !runtimeSandboxId || runtimeUserId !== userId
        ? generateDesktopSandboxId()
        : runtimeSandboxId;

    appendRuntimeEventLog({
      category: "auth",
      event: "runtime_binding.provision",
      outcome: "start",
      detail: options?.reason || null,
    });

    try {
      const binding = await exchangeDesktopRuntimeBinding(sandboxId);
      const modelProxyApiKey = runtimeBindingModelProxyApiKey(binding);
      if (!modelProxyApiKey) {
        throw new Error(
          "Runtime binding response missing model_proxy_api_key.",
        );
      }
      const nextConfig = await writeRuntimeConfigFile({
        authToken: modelProxyApiKey,
        modelProxyApiKey,
        userId: binding.holaboss_user_id,
        sandboxId: binding.sandbox_id,
        modelProxyBaseUrl: (binding.model_proxy_base_url || "").replace(
          "host.docker.internal",
          "127.0.0.1",
        ),
        defaultModel: binding.default_model,
        defaultBackgroundModel: binding.default_background_model ?? null,
        defaultEmbeddingModel: binding.default_embedding_model ?? null,
        defaultImageModel: binding.default_image_model ?? null,
        controlPlaneBaseUrl: DESKTOP_CONTROL_PLANE_BASE_URL,
      });
      await syncRuntimeModelCatalogFromBinding(binding);
      await restartEmbeddedRuntimeIfNeeded(currentConfig, nextConfig);
      await emitRuntimeConfig();
      await syncRuntimeUserProfileFromAuth(user);

      appendRuntimeEventLog({
        category: "auth",
        event: "runtime_binding.provision",
        outcome: "success",
        detail: `${options?.reason || "unknown"}:${binding.sandbox_id}`,
      });
      lastRuntimeBindingRefreshAtMs = Date.now();
      lastRuntimeBindingRefreshUserId = userId;
      clearTransientRuntimeBindingRefreshFailure();
    } catch (error) {
      appendRuntimeEventLog({
        category: "auth",
        event: "runtime_binding.provision",
        outcome: "error",
        detail:
          error instanceof Error
            ? error.message
            : "Failed to provision runtime binding.",
      });
      throw error;
    }
  });
}

async function ensureRuntimeBindingReadyForWorkspaceFlow(
  reason: string,
  options?: {
    forceRefresh?: boolean;
    allowProvisionWhenUnmanaged?: boolean;
    waitForStartupSync?: boolean;
  },
): Promise<void> {
  if (options?.waitForStartupSync !== false) {
    const startupSync = startupAuthSyncPromise;
    if (startupSync) {
      await startupSync;
    }
  }

  const currentConfig = await readRuntimeConfigFile();
  const controlPlaneManaged = runtimeConfigIsControlPlaneManaged(currentConfig);
  const allowProvisionWhenUnmanaged = Boolean(
    options?.allowProvisionWhenUnmanaged,
  );
  if (!controlPlaneManaged && !allowProvisionWhenUnmanaged) {
    return;
  }

  let user: AuthUserPayload | null;
  try {
    user = await getAuthenticatedUser();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const canUseExistingBindingOnSessionLookupFailure =
      runtimeConfigHasBindingMaterial(currentConfig) &&
      !Boolean(options?.forceRefresh) &&
      !(allowProvisionWhenUnmanaged && !controlPlaneManaged);
    if (
      canUseExistingBindingOnSessionLookupFailure &&
      isTransientRuntimeError(error)
    ) {
      appendRuntimeEventLog({
        category: "auth",
        event: "runtime_binding.session_lookup",
        outcome: "skipped",
        detail:
          `${reason}:using_existing_binding_after_transient_session_lookup_failure:` +
          detail,
      });
      return;
    }
    throw error;
  }
  if (!user) {
    if (canUsePersistedRuntimeBindingWithoutAuth(currentConfig)) {
      return;
    }
    if (runtimeModelProxyApiKeyFromConfig(currentConfig)) {
      await clearRuntimeBindingSecrets(`${reason}:missing_auth_session`);
    }
    throw new Error("Authentication session missing. Sign in again.");
  }

  const userId = authUserId(user);
  const bindingNeedsReplacement = runtimeConfigNeedsBindingRefresh(
    currentConfig,
    userId,
  );
  const hasExistingBindingMaterial =
    runtimeConfigHasBindingMaterial(currentConfig);
  const canUseExistingBindingOnRefreshFailure =
    hasExistingBindingMaterial &&
    !bindingNeedsReplacement &&
    !Boolean(options?.forceRefresh) &&
    !(allowProvisionWhenUnmanaged && !controlPlaneManaged);
  const shouldRefresh =
    Boolean(options?.forceRefresh) ||
    (allowProvisionWhenUnmanaged && !controlPlaneManaged) ||
    bindingNeedsReplacement ||
    shouldForceRuntimeBindingRefresh(userId);
  if (
    shouldRefresh &&
    canUseExistingBindingOnRefreshFailure &&
    hasRecentTransientRuntimeBindingRefreshFailure(userId)
  ) {
    appendRuntimeEventLog({
      category: "auth",
      event: "runtime_binding.provision",
      outcome: "skipped",
      detail: `${reason}:using_recent_binding_refresh_backoff`,
    });
    return;
  }
  if (shouldRefresh) {
    try {
      await provisionRuntimeBindingForAuthenticatedUser(user, {
        forceRefresh: true,
        forceNewSandbox: false,
        reason,
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Binding exchange failed.";
      if (
        canUseExistingBindingOnRefreshFailure &&
        isTransientRuntimeError(error)
      ) {
        markTransientRuntimeBindingRefreshFailure(userId);
        appendRuntimeEventLog({
          category: "auth",
          event: "runtime_binding.provision",
          outcome: "skipped",
          detail: `${reason}:using_existing_binding_after_transient_refresh_failure:${detail}`,
        });
        return;
      }
      await clearRuntimeBindingSecrets(`${reason}:provision_failed`);
      throw new Error(`Runtime binding provisioning failed: ${detail}`);
    }
  }

  const refreshedConfig = await readRuntimeConfigFile();
  const hasBindingMaterial = runtimeConfigHasBindingMaterial(refreshedConfig);
  if (!hasBindingMaterial) {
    await clearRuntimeBindingSecrets(`${reason}:binding_incomplete`);
    throw new Error("Runtime binding is incomplete. Sign in again.");
  }
}

function nearestPackageJsonDirectory(startDirectory: string): string | null {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    if (existsSync(path.join(currentDirectory, "package.json"))) {
      return currentDirectory;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }
    currentDirectory = parentDirectory;
  }
}

function defaultAppProtocolClientArgs(): string[] {
  const packageRoot = nearestPackageJsonDirectory(__dirname);
  if (packageRoot) {
    return [packageRoot];
  }

  const flagsWithSeparateValue = new Set(["--require", "-r"]);
  for (let index = 1; index < process.argv.length; index += 1) {
    const argument = process.argv[index]?.trim();
    if (!argument) {
      continue;
    }
    if (argument.startsWith("-")) {
      if (
        flagsWithSeparateValue.has(argument) &&
        index + 1 < process.argv.length
      ) {
        index += 1;
      }
      continue;
    }
    if (maybeAuthCallbackUrl(argument)) {
      continue;
    }
    return [path.resolve(argument)];
  }

  const appPath = app.getAppPath().trim();
  return appPath ? [path.resolve(appPath)] : [];
}

function extractAuthToken(callbackUrl: string): string | null {
  try {
    const parsed = new URL(callbackUrl);
    if (parsed.protocol !== `${AUTH_CALLBACK_PROTOCOL}:`) {
      return null;
    }
    const callbackPath = `/${parsed.hostname}${parsed.pathname}`.replace(
      /\/+/g,
      "/",
    );
    if (callbackPath !== "/auth/callback") {
      return null;
    }
    if (parsed.hash.startsWith("#token=")) {
      const hashToken = parsed.hash.slice("#token=".length).trim();
      if (hashToken) {
        return hashToken;
      }
    }
    const queryToken = parsed.searchParams.get("token");
    if (typeof queryToken === "string" && queryToken.trim()) {
      return queryToken.trim();
    }
    return null;
  } catch {
    return null;
  }
}

async function handleAuthCallbackUrl(targetUrl: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }

  const token = extractAuthToken(targetUrl);
  if (!token) {
    emitAuthError({
      message: "Invalid desktop authentication callback.",
      status: 400,
      statusText: "Bad Request",
      path: targetUrl,
    });
    return;
  }

  try {
    const result = await requireAuthClient().authenticate({ token });
    const user = (result.data?.user ?? null) as AuthUserPayload | null;
    if (user) {
      emitAuthAuthenticated(user);
      emitAuthUserUpdated(user);
      try {
        await provisionRuntimeBindingForAuthenticatedUser(user, {
          forceNewSandbox: true,
          reason: "auth_callback",
        });
      } catch (bindingError) {
        emitAuthError({
          message:
            bindingError instanceof Error
              ? `Signed in, but runtime binding provisioning failed: ${bindingError.message}`
              : "Signed in, but runtime binding provisioning failed.",
          status: 502,
          statusText: "Bad Gateway",
          path: DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH,
        });
      }
      return;
    }
    const resolvedUser = await getAuthenticatedUser();
    emitAuthUserUpdated(resolvedUser);
    if (resolvedUser) {
      try {
        await provisionRuntimeBindingForAuthenticatedUser(resolvedUser, {
          forceNewSandbox: true,
          reason: "auth_callback_session_lookup",
        });
      } catch (bindingError) {
        emitAuthError({
          message:
            bindingError instanceof Error
              ? `Signed in, but runtime binding provisioning failed: ${bindingError.message}`
              : "Signed in, but runtime binding provisioning failed.",
          status: 502,
          statusText: "Bad Gateway",
          path: DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH,
        });
      }
    }
  } catch (error) {
    const fallbackUser = await getAuthenticatedUser().catch(() => null);
    if (fallbackUser) {
      emitAuthUserUpdated(fallbackUser);
      try {
        await provisionRuntimeBindingForAuthenticatedUser(fallbackUser, {
          forceNewSandbox: true,
          reason: "auth_callback_fallback_session_lookup",
        });
      } catch (bindingError) {
        emitAuthError({
          message:
            bindingError instanceof Error
              ? `Signed in, but runtime binding provisioning failed: ${bindingError.message}`
              : "Signed in, but runtime binding provisioning failed.",
          status: 502,
          statusText: "Bad Gateway",
          path: DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH,
        });
      }
      return;
    }

    emitAuthError({
      message:
        error instanceof Error
          ? error.message
          : "Authentication callback failed.",
      status: 500,
      statusText: "Internal Server Error",
      path: targetUrl,
    });
  }
}

async function syncPersistedAuthSessionOnStartup(): Promise<void> {
  try {
    const user = await getAuthenticatedUser();
    emitAuthUserUpdated(user);
    if (!user) {
      const currentConfig = await readRuntimeConfigFile();
      if (runtimeModelProxyApiKeyFromConfig(currentConfig)) {
        await clearRuntimeBindingSecrets("startup_missing_auth_session");
      }
      return;
    }

    await provisionRuntimeBindingForAuthenticatedUser(user, {
      forceNewSandbox: false,
      forceRefresh: false,
      reason: "startup_session_restore",
    });
  } catch (error) {
    emitAuthError({
      message:
        error instanceof Error
          ? `Signed in, but runtime binding provisioning failed: ${error.message}`
          : "Signed in, but runtime binding provisioning failed.",
      status: 502,
      statusText: "Bad Gateway",
      path: DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH,
    });
  }
}

function gatewayBaseUrl(service: string): string {
  return `${AUTH_BASE_URL.replace(/\/+$/, "")}/gateway/${service}`;
}

function projectsBaseUrl() {
  return AUTH_BASE_URL
    ? gatewayBaseUrl("projects")
    : DEFAULT_PROJECTS_URL.replace(/\/+$/, "");
}

function marketplaceBaseUrl() {
  return AUTH_BASE_URL
    ? gatewayBaseUrl("marketplace")
    : DEFAULT_MARKETPLACE_URL.replace(/\/+$/, "");
}

async function controlPlaneHeaders(
  _service: "projects" | "marketplace" | "proactive",
  extraHeaders?: Record<string, string>,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  // Send Better Auth session cookie so the Hono gateway can resolve
  // the user identity. Main-process fetch is not subject to browser
  // CORS — the earlier "no Cookie" comment was about renderer-process
  // constraints that don't apply here.
  // TODO(phase-2): Once the Python backend reads X-Holaboss-User-Id
  // from the gateway-injected header, remove holaboss_user_id from
  // request bodies in requestControlPlaneJson callers.
  const cookie = authCookieHeader();
  if (cookie) {
    headers["Cookie"] = cookie;
  }
  return headers;
}

function proactiveBaseUrl() {
  return AUTH_BASE_URL
    ? gatewayBaseUrl("proactive")
    : DEFAULT_PROACTIVE_URL.replace(/\/+$/, "");
}

function runtimeProactiveBridgeBaseUrl() {
  return proactiveBaseUrl();
}

function embeddedRuntimeStartupConfigError() {
  if (runtimeProactiveBridgeBaseUrl()) {
    return "";
  }
  return (
    "Embedded runtime remote bridge is enabled but no remote base URL is configured. " +
    "Set HOLABOSS_BACKEND_BASE_URL or HOLABOSS_PROACTIVE_URL in desktop/.env."
  );
}

function controlPlaneServiceBaseUrl(
  service: "projects" | "marketplace" | "proactive",
) {
  if (service === "projects") {
    return projectsBaseUrl();
  }
  if (service === "marketplace") {
    return marketplaceBaseUrl();
  }
  return proactiveBaseUrl();
}

async function readControlPlaneError(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return `status=${response.status}`;
  }

  try {
    const payload = JSON.parse(text) as unknown;
    if (payload && typeof payload === "object" && "detail" in payload) {
      const detail = (payload as Record<string, unknown>).detail;
      return typeof detail === "string" ? detail : JSON.stringify(detail);
    }
    return JSON.stringify(payload);
  } catch {
    return text;
  }
}

/**
 * Deduplicates concurrent 401 sign-in prompts.
 * Opens the sign-in browser once, then waits for the auth callback
 * (deep link → handleAuthCallbackUrl → emitAuthAuthenticated or
 * emitAuthUserUpdated) before resolving. Rejects early on emitAuthError.
 * Callers retry their request after this resolves.
 */
let pendingGatewayAuthRetry: Promise<void> | null = null;

/** Listeners notified when emitAuthAuthenticated or emitAuthUserUpdated(non-null) fires. */
const gatewayAuthCallbackListeners = new Set<() => void>();

/** Listeners notified when emitAuthError fires so waiters reject promptly. */
const gatewayAuthErrorListeners = new Set<(err: AuthErrorPayload) => void>();

function waitForAuthCallback(timeoutMs = 120_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      gatewayAuthCallbackListeners.delete(successListener);
      gatewayAuthErrorListeners.delete(errorListener);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Sign-in timed out."));
    }, timeoutMs);

    const successListener = () => {
      cleanup();
      resolve();
    };

    const errorListener = (err: AuthErrorPayload) => {
      cleanup();
      reject(new Error(err.message ?? "Sign-in failed."));
    };

    gatewayAuthCallbackListeners.add(successListener);
    gatewayAuthErrorListeners.add(errorListener);
  });
}

async function requestControlPlaneJson<T>({
  service,
  method,
  path: requestPath,
  payload,
  params,
}: {
  service: "projects" | "marketplace" | "proactive";
  method: "GET" | "POST" | "DELETE";
  path: string;
  payload?: unknown;
  params?: Record<string, string | number | boolean | null | undefined>;
}): Promise<T> {
  const url = new URL(`${controlPlaneServiceBaseUrl(service)}${requestPath}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  const executeRequest = async () => {
    return fetch(url.toString(), {
      method,
      headers: await controlPlaneHeaders(service),
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  };

  const maybeRetryRuntimeBinding = async (
    status: number,
    detail: string,
  ): Promise<boolean> => {
    if (service !== "marketplace" && service !== "proactive") {
      return false;
    }
    const normalizedDetail = detail.trim().toLowerCase();
    const looksLikeApiKeyAuthFailure =
      status === 401 ||
      status === 403 ||
      normalizedDetail.includes("invalid or missing api key") ||
      normalizedDetail.includes("api key") ||
      normalizedDetail.includes("unauthorized") ||
      normalizedDetail.includes("forbidden");
    if (!looksLikeApiKeyAuthFailure) {
      return false;
    }
    await ensureRuntimeBindingReadyForWorkspaceFlow(
      `control_plane_${service}_auth_retry`,
      {
        forceRefresh: true,
        allowProvisionWhenUnmanaged: true,
        waitForStartupSync: true,
      },
    );
    return true;
  };

  let response = await executeRequest();
  let errorDetail = "";
  if (!response.ok) {
    errorDetail = await readControlPlaneError(response);
    const retried = await maybeRetryRuntimeBinding(
      response.status,
      errorDetail,
    ).catch(() => false);
    if (retried) {
      response = await executeRequest();
      errorDetail = "";
    }
  }
  // If gateway returned 401 (session expired/missing), prompt sign-in and retry once.
  // requestAuth() only opens the browser and resolves immediately — it does NOT
  // wait for the user to complete sign-in. We wait for the auth callback
  // (deep link → handleAuthCallbackUrl → emitAuthAuthenticated/emitAuthUserUpdated)
  // before retrying. On auth failure/dismissal, emitAuthError rejects the wait.
  if (response.status === 401 && desktopAuthClient) {
    try {
      if (!pendingGatewayAuthRetry) {
        const authComplete = waitForAuthCallback();
        requireAuthClient().requestAuth().catch(() => {});
        pendingGatewayAuthRetry = authComplete.finally(() => {
          pendingGatewayAuthRetry = null;
        });
      }
      await pendingGatewayAuthRetry;
      // Auth callback received — cookie is now fresh, retry
      response = await executeRequest();
      errorDetail = "";
    } catch {
      // User dismissed sign-in or auth failed — fall through to error
    }
  }
  if (!response.ok) {
    throw new Error(errorDetail || (await readControlPlaneError(response)));
  }
  if (response.status === 204) {
    return null as T;
  }

  const text = await response.text();
  if (!text.trim()) {
    const hdrs = Object.fromEntries(response.headers.entries());
    console.error(
      `[control-plane] Empty response: ${method} ${url.toString()} → status=${response.status} headers=${JSON.stringify(hdrs)}`,
    );
    throw new Error(
      `Empty response from ${service} ${method} ${requestPath} (status ${response.status})`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Invalid JSON from ${service} ${method} ${requestPath} (status ${response.status}): ${text.slice(0, 200)}`,
    );
  }
}

async function ingestWorkspaceHeartbeat(params: {
  workspaceId: string;
  actorId: string;
  sourceRef: string;
  correlationId: string;
}): Promise<RemoteTaskProposalGenerationResponsePayload> {
  const workspaceId = params.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("workspace_id is required to ingest a heartbeat event.");
  }

  const correlationId = params.correlationId.trim();
  if (!correlationId) {
    throw new Error("correlation_id is required to ingest a heartbeat event.");
  }

  appendRuntimeEventLog({
    category: "workspace",
    event: "workspace.heartbeat.emit",
    outcome: "start",
    detail:
      `workspace_id=${workspaceId} source=${params.sourceRef} ` +
      `correlation_id=${correlationId}`,
  });

  try {
    const bundledContext =
      await requestRuntimeJson<ProactiveContextCaptureResponsePayload>({
        method: "POST",
        path: "/api/v1/proactive/context/capture",
        payload: {
          workspace_id: workspaceId,
        },
        retryTransientErrors: true,
      });
    const results = await requestControlPlaneJson<
      ProactiveIngestItemResultPayload[]
    >({
      service: "proactive",
      method: "POST",
      path: "/api/v1/proactive/ingest",
      payload: {
        events: [
          {
            event_id: `evt-heartbeat-${crypto.randomUUID().replace(/-/g, "")}`,
            event_type: "heartbeat",
            workspace_id: workspaceId,
            actor: {
              type: "system",
              id: params.actorId,
            },
            correlation_id: correlationId,
            origin: "system",
            timestamp: utcNowIso(),
            source_refs: [params.sourceRef],
            window: "24h",
            proposal_scope: "window",
            captured_context: bundledContext.context,
          },
        ],
      },
    });
    const acceptedCount = results.filter(
      (item) => (item?.status || "").trim().toLowerCase() === "accepted",
    ).length;
    appendRuntimeEventLog({
      category: "workspace",
      event: "workspace.heartbeat.emit",
      outcome: "success",
      detail:
        `workspace_id=${workspaceId} source=${params.sourceRef} ` +
        `correlation_id=${correlationId} accepted=${acceptedCount}/${results.length}`,
    });
    return {
      accepted: acceptedCount > 0,
      accepted_count: acceptedCount,
      event_count: results.length,
      correlation_id: correlationId,
    };
  } catch (error) {
    appendRuntimeEventLog({
      category: "workspace",
      event: "workspace.heartbeat.emit",
      outcome: "error",
      detail:
        `workspace_id=${workspaceId} source=${params.sourceRef} ` +
        `correlation_id=${correlationId} error=${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  }
}

async function emitWorkspaceReadyHeartbeat(params: {
  workspaceId: string;
  holabossUserId: string;
}): Promise<void> {
  const workspaceId = params.workspaceId.trim();
  const holabossUserId = params.holabossUserId.trim();
  if (
    !workspaceId ||
    !holabossUserId ||
    holabossUserId === LOCAL_OSS_TEMPLATE_USER_ID
  ) {
    return;
  }

  await ingestWorkspaceHeartbeat({
    workspaceId,
    actorId: "desktop_workspace_create",
    sourceRef: "workspace-created:ready",
    correlationId: `workspace-ready-${workspaceId}`,
  });
}

function getHolabossClientConfig(): HolabossClientConfigPayload {
  return {
    projectsUrl: projectsBaseUrl(),
    marketplaceUrl: marketplaceBaseUrl(),
  };
}

function firstNonEmptyLine(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    return trimmed.replace(/^#+\s*/, "");
  }
  return null;
}

async function parseLocalTemplateMetadata(
  templateRoot: string,
): Promise<TemplateMetadataPayload> {
  const templateName = path.basename(templateRoot);
  const workspaceYamlPath = path.join(templateRoot, "workspace.yaml");
  const workspaceYaml = await fs.readFile(workspaceYamlPath, "utf-8");
  const resolvedName =
    workspaceYaml.match(/^\s*name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() ||
    templateName;

  let description: string | null = null;
  try {
    description = firstNonEmptyLine(
      await fs.readFile(path.join(templateRoot, "README.md"), "utf-8"),
    );
  } catch {
    try {
      description = firstNonEmptyLine(
        await fs.readFile(path.join(templateRoot, "AGENTS.md"), "utf-8"),
      );
    } catch {
      description = null;
    }
  }

  const skillsDir = path.join(templateRoot, "skills");
  let tags: string[] = [];
  if (existsSync(skillsDir)) {
    tags = (await fs.readdir(skillsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  return {
    name: templateName,
    repo: "local",
    path: templateName,
    default_ref: "local",
    description,
    is_hidden: false,
    is_coming_soon: false,
    allowed_user_ids: [],
    icon: "folder",
    emoji: null,
    apps: [],
    min_optional_apps: 0,
    tags,
    category: "local",
    long_description: description,
    agents: [],
    views: [],
    install_count: 0,
    source: "local",
    verified: false,
    author_name: "Local folder",
    author_id: "_local",
  };
}

async function listMarketplaceTemplates(): Promise<TemplateListResponsePayload> {
  // Uses @holaboss/app-sdk against Hono's native /api/marketplace/templates
  // route. The endpoint is publicly readable, so the Cookie header is
  // forwarded when a session exists but the call still works anonymously.
  const client = getMarketplaceAppSdkClient();
  const data = await sdkListMarketplaceTemplates({ client });
  return {
    templates: data.templates as TemplateMetadataPayload[],
    spotlight: (data.spotlight ?? []) as SpotlightItemPayload[],
  };
}

interface AppTemplateListResponsePayload {
  templates: AppTemplateMetadataPayload[];
}

async function listAppTemplatesViaControlPlane(): Promise<AppTemplateListResponsePayload> {
  // Uses @holaboss/app-sdk against Hono's /api/marketplace/app-templates
  // route. Publicly readable, so the Cookie header is forwarded when a
  // session exists but the call still works anonymously.
  const client = getMarketplaceAppSdkClient();
  const data = await sdkListMarketplaceAppTemplates({ client });
  return {
    templates: data.templates as AppTemplateMetadataPayload[],
  };
}

// Hard cap on archive size to prevent runaway downloads from filling disk
// or OOMing the Electron main process. App tarballs are normally well under
// 50 MB; 500 MB leaves headroom while still bounding the worst case.
const MAX_APP_ARCHIVE_BYTES = 500 * 1024 * 1024;
// Whole-download timeout. Streaming progress doesn't reset this.
const APP_ARCHIVE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

async function downloadAppArchive(url: string, appId: string): Promise<string> {
  const dir = path.join(os.tmpdir(), "holaboss-app-archives");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${appId}-${Date.now()}.tar.gz`);

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort(new Error("Download timed out"));
  }, APP_ARCHIVE_DOWNLOAD_TIMEOUT_MS);

  let fileStream: ReturnType<typeof createWriteStream> | null = null;
  try {
    const res = await fetch(url, { method: "GET", signal: abortController.signal });
    if (!res.ok || !res.body) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }
    const totalHeader = res.headers.get("content-length");
    const total = totalHeader ? Number.parseInt(totalHeader, 10) : 0;
    if (total > MAX_APP_ARCHIVE_BYTES) {
      throw new Error(
        `App archive too large: ${total} bytes (max ${MAX_APP_ARCHIVE_BYTES})`,
      );
    }
    let received = 0;

    // Rewrap the WHATWG ReadableStream as a Node Readable, then pipeline
    // it into the file writer. pipeline() guarantees both sides see errors
    // and resources are torn down on failure — the previous hand-rolled
    // loop swallowed write() errors and attached its error handler too
    // late to catch them.
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on("data", (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > MAX_APP_ARCHIVE_BYTES) {
        source.destroy(
          new Error(
            `App archive exceeded ${MAX_APP_ARCHIVE_BYTES} bytes during download`,
          ),
        );
        return;
      }
      mainWindow?.webContents.send("app-install-progress", {
        appId,
        phase: "downloading",
        bytes: received,
        total,
      });
    });

    fileStream = createWriteStream(filePath);
    await pipeline(source, fileStream);
    return filePath;
  } catch (error) {
    // Best-effort cleanup of the partially written archive so the temp dir
    // doesn't accumulate junk on every failed download.
    try {
      fileStream?.destroy();
    } catch {
      // ignore
    }
    try {
      await fs.rm(filePath, { force: true });
    } catch {
      // ignore
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function listTaskProposals(
  workspaceId: string,
): Promise<TaskProposalListResponsePayload> {
  if (!workspaceId.trim()) {
    return { proposals: [], count: 0 };
  }
  return requestRuntimeJson<TaskProposalListResponsePayload>({
    method: "GET",
    path: "/api/v1/task-proposals/unreviewed",
    params: { workspace_id: workspaceId },
  });
}

async function listMemoryUpdateProposals(
  payload: MemoryUpdateProposalListRequestPayload,
): Promise<MemoryUpdateProposalListResponsePayload> {
  if (!payload.workspaceId.trim()) {
    return { proposals: [], count: 0 };
  }
  return requestRuntimeJson<MemoryUpdateProposalListResponsePayload>({
    method: "GET",
    path: "/api/v1/memory-update-proposals",
    params: {
      workspace_id: payload.workspaceId,
      session_id: payload.sessionId ?? undefined,
      input_id: payload.inputId ?? undefined,
      state: payload.state ?? undefined,
      limit: payload.limit ?? 200,
      offset: payload.offset ?? 0,
    },
  });
}

function secondsSinceIso(value: string | null): number | null {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - parsed) / 1000));
}

async function acceptTaskProposal(
  payload: TaskProposalAcceptPayload,
): Promise<TaskProposalAcceptResponsePayload> {
  return requestRuntimeJson<TaskProposalAcceptResponsePayload>({
    method: "POST",
    path: `/api/v1/task-proposals/${encodeURIComponent(payload.proposal_id)}/accept`,
    payload: {
      task_name: payload.task_name,
      task_prompt: payload.task_prompt,
      session_id: payload.session_id,
      parent_session_id: payload.parent_session_id,
      created_by: payload.created_by,
      priority: payload.priority ?? 0,
      model: payload.model ?? null,
    },
  });
}

async function acceptMemoryUpdateProposal(
  payload: MemoryUpdateProposalAcceptPayload,
): Promise<MemoryUpdateProposalAcceptResponsePayload> {
  return requestRuntimeJson<MemoryUpdateProposalAcceptResponsePayload>({
    method: "POST",
    path: `/api/v1/memory-update-proposals/${encodeURIComponent(payload.proposalId)}/accept`,
    payload: {
      summary: payload.summary ?? undefined,
    },
  });
}

async function dismissMemoryUpdateProposal(
  proposalId: string,
): Promise<MemoryUpdateProposalDismissResponsePayload> {
  return requestRuntimeJson<MemoryUpdateProposalDismissResponsePayload>({
    method: "POST",
    path: `/api/v1/memory-update-proposals/${encodeURIComponent(proposalId)}/dismiss`,
    payload: {},
  });
}

async function getProactiveStatus(
  workspaceId: string,
): Promise<ProactiveAgentStatusPayload> {
  const normalizedWorkspaceId = workspaceId.trim();
  const fallbackHeartbeat: ProactiveStatusSnapshotPayload = {
    state: "unknown",
    detail: null,
    recorded_at: null,
  };
  const fallbackBridge: ProactiveStatusSnapshotPayload = {
    state: "unknown",
    detail: null,
    recorded_at: null,
  };
  if (!normalizedWorkspaceId) {
    return {
      workspace_id: "",
      proposal_count: 0,
      heartbeat: fallbackHeartbeat,
      bridge: fallbackBridge,
      lifecycle_state: "idle",
      lifecycle_summary: "Select a workspace to inspect proactive status.",
      lifecycle_detail: null,
    };
  }

  let proposalCount = 0;
  let heartbeat = fallbackHeartbeat;
  const database = openRuntimeDatabase();
  try {
    const proposalRow = database
      .prepare(
        `
          SELECT COUNT(*) AS proposal_count
          FROM task_proposals
          WHERE workspace_id = ?
        `,
      )
      .get(normalizedWorkspaceId) as { proposal_count?: number } | undefined;
    proposalCount = Number(proposalRow?.proposal_count ?? 0);

    const correlationId = `workspace-ready-${normalizedWorkspaceId}`;
    const heartbeatRow = database
      .prepare(
        `
          SELECT outcome, detail, created_at
          FROM event_log
          WHERE category = 'workspace'
            AND event = 'workspace.heartbeat.emit'
            AND (
              detail LIKE ?
              OR detail LIKE ?
            )
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .get(`%workspace_id=${normalizedWorkspaceId}%`, `%${correlationId}%`) as
      | {
          outcome?: string | null;
          detail?: string | null;
          created_at?: string | null;
        }
      | undefined;
    if (heartbeatRow) {
      const outcome = (heartbeatRow.outcome || "").trim().toLowerCase();
      heartbeat = {
        state:
          outcome === "success"
            ? "published"
            : outcome === "error"
              ? "failed"
              : outcome === "skipped"
                ? "skipped"
                : outcome === "start" || outcome === "retry"
                  ? "pending"
                  : "unknown",
        detail: heartbeatRow.detail?.trim() || null,
        recorded_at: heartbeatRow.created_at?.trim() || null,
      };
    }
  } catch {
    heartbeat = fallbackHeartbeat;
  } finally {
    database.close();
  }

  const runtimeConfig = await readRuntimeConfigFile().catch(() => ({}));
  const runtimeToken = runtimeModelProxyApiKeyFromConfig(runtimeConfig);
  let bridge: ProactiveStatusSnapshotPayload;
  if (!runtimeToken) {
    bridge = {
      state: "inactive",
      detail: "Sign in to enable proactive delivery.",
      recorded_at: null,
    };
  } else if (runtimeStatus.status === "running") {
    bridge = {
      state: "healthy",
      detail: "Embedded runtime is ready to receive proactive work.",
      recorded_at: null,
    };
  } else if (runtimeStatus.status === "starting") {
    bridge = {
      state: "pending",
      detail: "Embedded runtime is still starting.",
      recorded_at: null,
    };
  } else if (runtimeStatus.status === "error") {
    bridge = {
      state: "error",
      detail:
        runtimeStatus.lastError?.trim() ||
        "Embedded runtime reported an error.",
      recorded_at: null,
    };
  } else {
    bridge = {
      state: "inactive",
      detail:
        runtimeStatus.lastError?.trim() || "Embedded runtime is not running.",
      recorded_at: null,
    };
  }

  let lifecycleState = "idle";
  let lifecycleSummary = "Idle.";
  let lifecycleDetail: string | null = null;
  const heartbeatAgeSeconds = secondsSinceIso(heartbeat.recorded_at);
  const heartbeatJustClaimed =
    heartbeatAgeSeconds !== null && heartbeatAgeSeconds < 10;
  const heartbeatSettled =
    heartbeatAgeSeconds !== null && heartbeatAgeSeconds >= 120;
  if (heartbeat.state === "pending") {
    lifecycleState = "sent";
    lifecycleSummary = "Sent.";
    lifecycleDetail = "Waiting for the proactive agent to claim this run.";
  } else if (heartbeat.state === "published" && heartbeatJustClaimed) {
    lifecycleState = "claimed";
    lifecycleSummary = "Claimed.";
    lifecycleDetail = "The proactive agent has started working on this run.";
  } else if (heartbeat.state === "published" && !heartbeatSettled) {
    lifecycleState = "analyzing";
    lifecycleSummary = "Analyzing.";
    lifecycleDetail = "Looking for useful suggestions.";
  } else if (heartbeat.state === "failed") {
    lifecycleState = "error";
    lifecycleSummary = "Error.";
    lifecycleDetail = heartbeat.detail;
  } else if (heartbeat.state === "skipped") {
    if (
      bridge.state === "healthy" &&
      (heartbeat.detail || "").includes("skipped=no_active_runtime_binding")
    ) {
      lifecycleState = proposalCount > 0 ? "analyzing" : "idle";
      lifecycleSummary = proposalCount > 0 ? "Analyzing." : "Idle.";
      lifecycleDetail =
        proposalCount > 0 ? "Looking for useful suggestions." : bridge.detail;
    } else {
      lifecycleState = "unavailable";
      lifecycleSummary = "Unavailable.";
      lifecycleDetail = heartbeat.detail;
    }
  } else if (
    bridge.state === "error" ||
    bridge.state === "inactive" ||
    bridge.state === "pending"
  ) {
    lifecycleState = "unavailable";
    lifecycleSummary = "Unavailable.";
    lifecycleDetail = bridge.detail;
  }

  return {
    workspace_id: normalizedWorkspaceId,
    proposal_count: proposalCount,
    heartbeat,
    bridge,
    lifecycle_state: lifecycleState,
    lifecycle_summary: lifecycleSummary,
    lifecycle_detail: lifecycleDetail,
  };
}

async function listCronjobs(
  workspaceId: string,
  enabledOnly = false,
): Promise<CronjobListResponsePayload> {
  return requestRuntimeJson<CronjobListResponsePayload>({
    method: "GET",
    path: "/api/v1/cronjobs",
    params: { workspace_id: workspaceId, enabled_only: enabledOnly },
  });
}

async function runCronjobNow(
  jobId: string,
): Promise<CronjobRunResponsePayload> {
  return requestRuntimeJson<CronjobRunResponsePayload>({
    method: "POST",
    path: `/api/v1/cronjobs/${encodeURIComponent(jobId)}/run`,
  });
}

async function createCronjob(
  payload: CronjobCreatePayload,
): Promise<CronjobRecordPayload> {
  return requestRuntimeJson<CronjobRecordPayload>({
    method: "POST",
    path: "/api/v1/cronjobs",
    payload,
  });
}

async function updateCronjob(
  jobId: string,
  payload: CronjobUpdatePayload,
): Promise<CronjobRecordPayload> {
  return requestRuntimeJson<CronjobRecordPayload>({
    method: "PATCH",
    path: `/api/v1/cronjobs/${encodeURIComponent(jobId)}`,
    payload,
  });
}

async function deleteCronjob(jobId: string): Promise<{ success: boolean }> {
  return requestRuntimeJson<{ success: boolean }>({
    method: "DELETE",
    path: `/api/v1/cronjobs/${encodeURIComponent(jobId)}`,
  });
}

const runtimeNotificationListCache = new Map<
  string,
  RuntimeNotificationListResponsePayload
>();

function runtimeNotificationListCacheKey(
  workspaceId?: string | null,
  includeDismissed = false,
): string {
  return JSON.stringify({
    workspaceId: workspaceId?.trim() || null,
    includeDismissed,
  });
}

function emptyRuntimeNotificationListResponse(): RuntimeNotificationListResponsePayload {
  return {
    items: [],
    count: 0,
  };
}

async function listNotifications(
  workspaceId?: string | null,
  includeDismissed = false,
): Promise<RuntimeNotificationListResponsePayload> {
  const cacheKey = runtimeNotificationListCacheKey(
    workspaceId,
    includeDismissed,
  );
  try {
    const response =
      await requestRuntimeJson<RuntimeNotificationListResponsePayload>({
        method: "GET",
        path: "/api/v1/notifications",
        params: {
          workspace_id: workspaceId ?? undefined,
          include_dismissed: includeDismissed,
          limit: 50,
        },
      });
    runtimeNotificationListCache.set(cacheKey, response);
    return response;
  } catch (error) {
    if (isTransientRuntimeError(error)) {
      return (
        runtimeNotificationListCache.get(cacheKey) ??
        emptyRuntimeNotificationListResponse()
      );
    }
    throw error;
  }
}

async function updateNotification(
  notificationId: string,
  payload: RuntimeNotificationUpdatePayload,
): Promise<RuntimeNotificationRecordPayload> {
  const response = await requestRuntimeJson<RuntimeNotificationRecordPayload>({
    method: "PATCH",
    path: `/api/v1/notifications/${encodeURIComponent(notificationId)}`,
    payload,
  });
  runtimeNotificationListCache.clear();
  return response;
}

async function listIntegrationCatalog(): Promise<IntegrationCatalogResponsePayload> {
  return requestRuntimeJson<IntegrationCatalogResponsePayload>({
    method: "GET",
    path: "/api/v1/integrations/catalog",
  });
}

async function listIntegrationConnections(params?: {
  providerId?: string;
  ownerUserId?: string;
}): Promise<IntegrationConnectionListResponsePayload> {
  return requestRuntimeJson<IntegrationConnectionListResponsePayload>({
    method: "GET",
    path: "/api/v1/integrations/connections",
    params: {
      provider_id: params?.providerId,
      owner_user_id: params?.ownerUserId,
    },
  });
}

async function listIntegrationBindings(
  workspaceId: string,
): Promise<IntegrationBindingListResponsePayload> {
  return requestRuntimeJson<IntegrationBindingListResponsePayload>({
    method: "GET",
    path: "/api/v1/integrations/bindings",
    params: { workspace_id: workspaceId },
  });
}

async function upsertIntegrationBinding(
  workspaceId: string,
  targetType: string,
  targetId: string,
  integrationKey: string,
  payload: IntegrationUpsertBindingPayload,
): Promise<IntegrationBindingPayload> {
  return requestRuntimeJson<IntegrationBindingPayload>({
    method: "PUT",
    path: `/api/v1/integrations/bindings/${encodeURIComponent(workspaceId)}/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/${encodeURIComponent(integrationKey)}`,
    payload,
  });
}

async function deleteIntegrationBinding(
  bindingId: string,
  workspaceId: string,
): Promise<{ deleted: boolean }> {
  return requestRuntimeJson<{ deleted: boolean }>({
    method: "DELETE",
    path: `/api/v1/integrations/bindings/${encodeURIComponent(bindingId)}`,
    params: { workspace_id: workspaceId },
  });
}

async function createIntegrationConnection(
  payload: IntegrationCreateConnectionPayload,
): Promise<IntegrationConnectionPayload> {
  return requestRuntimeJson<IntegrationConnectionPayload>({
    method: "POST",
    path: "/api/v1/integrations/connections",
    payload,
  });
}

async function updateIntegrationConnection(
  connectionId: string,
  payload: IntegrationUpdateConnectionPayload,
): Promise<IntegrationConnectionPayload> {
  return requestRuntimeJson<IntegrationConnectionPayload>({
    method: "PATCH",
    path: `/api/v1/integrations/connections/${encodeURIComponent(connectionId)}`,
    payload,
  });
}

async function deleteIntegrationConnection(
  connectionId: string,
): Promise<{ deleted: boolean }> {
  return requestRuntimeJson<{ deleted: boolean }>({
    method: "DELETE",
    path: `/api/v1/integrations/connections/${encodeURIComponent(connectionId)}`,
  });
}

async function listOAuthConfigs(): Promise<OAuthAppConfigListResponsePayload> {
  return requestRuntimeJson<OAuthAppConfigListResponsePayload>({
    method: "GET",
    path: "/api/v1/integrations/oauth/configs",
  });
}

async function upsertOAuthConfig(
  providerId: string,
  payload: OAuthAppConfigUpsertPayload,
): Promise<OAuthAppConfigPayload> {
  return requestRuntimeJson<OAuthAppConfigPayload>({
    method: "PUT",
    path: `/api/v1/integrations/oauth/configs/${encodeURIComponent(providerId)}`,
    payload,
  });
}

async function deleteOAuthConfig(
  providerId: string,
): Promise<{ deleted: boolean }> {
  return requestRuntimeJson<{ deleted: boolean }>({
    method: "DELETE",
    path: `/api/v1/integrations/oauth/configs/${encodeURIComponent(providerId)}`,
  });
}

async function startOAuthFlow(
  provider: string,
): Promise<OAuthAuthorizeResponsePayload> {
  const runtimeConfig = await readRuntimeConfigFile();
  const userId = (runtimeConfig.user_id || "").trim() || "local";
  const result = await requestRuntimeJson<OAuthAuthorizeResponsePayload>({
    method: "POST",
    path: "/api/v1/integrations/oauth/authorize",
    payload: { provider, owner_user_id: userId },
  });
  if (result.authorize_url) {
    shell.openExternal(result.authorize_url);
  }
  return result;
}

async function composioFetch<T>(
  path: string,
  method: "GET" | "POST",
  payload?: unknown,
): Promise<T> {
  if (!AUTH_BASE_URL) {
    throw new Error(
      "Backend is not configured (HOLABOSS_AUTH_BASE_URL missing)",
    );
  }
  const cookieHeader = authCookieHeader();
  if (!cookieHeader) {
    throw new Error("Not authenticated — sign in first");
  }
  const response = await fetch(`${AUTH_BASE_URL}${path}`, {
    method,
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Composio API error (${response.status}): ${text.slice(0, 300)}`,
    );
  }
  return response.json() as Promise<T>;
}

async function composioConnect(payload: {
  provider: string;
  owner_user_id: string;
  callback_url?: string;
}): Promise<ComposioConnectResult> {
  return composioFetch<ComposioConnectResult>(
    "/api/composio/connect",
    "POST",
    payload,
  );
}

interface ComposioToolkit {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  auth_schemes: string[];
  categories: string[];
}

async function composioListToolkits(): Promise<{
  toolkits: ComposioToolkit[];
}> {
  if (!authCookieHeader()) {
    return { toolkits: [] };
  }
  return composioFetch<{ toolkits: ComposioToolkit[] }>(
    "/api/composio/toolkits",
    "GET",
  );
}

async function composioAccountStatus(
  connectedAccountId: string,
): Promise<ComposioAccountStatus> {
  return composioFetch<ComposioAccountStatus>(
    `/api/composio/account/${encodeURIComponent(connectedAccountId)}`,
    "GET",
  );
}

async function composioFinalize(payload: {
  connected_account_id: string;
  provider: string;
  owner_user_id: string;
  account_label?: string;
}): Promise<IntegrationConnectionPayload> {
  return requestRuntimeJson<IntegrationConnectionPayload>({
    method: "POST",
    path: "/api/v1/integrations/composio/finalize",
    payload,
  });
}

interface TemplateIntegrationRequirement {
  key: string;
  provider: string;
  required: boolean;
  app_id: string;
}

interface ResolveTemplateIntegrationsResult {
  requirements: TemplateIntegrationRequirement[];
  connected_providers: string[];
  missing_providers: string[];
  provider_logos: Record<string, string>;
}

function extractIntegrationRequirementsFromTemplateFiles(
  files: MaterializedTemplateFilePayload[],
): TemplateIntegrationRequirement[] {
  const requirements: TemplateIntegrationRequirement[] = [];
  const appRuntimePattern = /^apps\/([^/]+)\/app\.runtime\.yaml$/;

  for (const file of files) {
    const match = file.path.match(appRuntimePattern);
    if (!match) continue;
    const appId = match[1];

    let parsed: Record<string, unknown>;
    try {
      const content = Buffer.from(file.content_base64, "base64").toString(
        "utf-8",
      );
      parsed = parseYaml(content) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;

    // List format: integrations: [{ key, provider, required }]
    if (Array.isArray(parsed.integrations)) {
      for (const entry of parsed.integrations) {
        if (entry && typeof entry === "object" && entry.key && entry.provider) {
          requirements.push({
            key: String(entry.key),
            provider: String(entry.provider),
            required: entry.required !== false,
            app_id: appId,
          });
        }
      }
    }
    // Legacy format: integration: { destination, credential_source }
    else if (
      parsed.integration &&
      typeof parsed.integration === "object" &&
      !Array.isArray(parsed.integration)
    ) {
      const legacy = parsed.integration as Record<string, unknown>;
      const destination = legacy.destination
        ? String(legacy.destination)
        : null;
      if (destination) {
        requirements.push({
          key: destination,
          provider: destination,
          required: true,
          app_id: appId,
        });
      }
    }
  }

  return requirements;
}

/**
 * Known app-name → provider mapping. Used to infer integration requirements
 * from template metadata (app names) without materializing the template.
 */
const APP_TO_PROVIDER: Record<string, string> = {
  gmail: "gmail",
  sheets: "googlesheets",
  github: "github",
  reddit: "reddit",
  twitter: "twitter",
  linkedin: "linkedin",
};

async function resolveTemplateIntegrations(
  payload: HolabossCreateWorkspacePayload,
): Promise<ResolveTemplateIntegrationsResult> {
  // Infer requirements from the app names in the payload or selected template
  const appNames: string[] = payload.template_apps ?? [];

  if (appNames.length === 0) {
    return {
      requirements: [],
      connected_providers: [],
      missing_providers: [],
      provider_logos: {},
    };
  }

  const requirements: TemplateIntegrationRequirement[] = [];
  const seenProviders = new Set<string>();

  for (const appName of appNames) {
    const provider = APP_TO_PROVIDER[appName.toLowerCase()];
    if (provider && !seenProviders.has(provider)) {
      seenProviders.add(provider);
      requirements.push({
        key: provider,
        provider,
        required: true,
        app_id: appName,
      });
    }
  }

  if (requirements.length === 0) {
    return {
      requirements: [],
      connected_providers: [],
      missing_providers: [],
      provider_logos: {},
    };
  }

  let connections: IntegrationConnectionPayload[] = [];
  try {
    const resp = await listIntegrationConnections();
    connections = resp.connections;
  } catch {
    // If we cannot reach the integration API, treat all as missing.
  }

  // Fetch toolkit logos from Composio
  const providerLogos: Record<string, string> = {};
  try {
    const { toolkits } = await composioListToolkits();
    for (const toolkit of toolkits) {
      if (toolkit.logo && seenProviders.has(toolkit.slug)) {
        providerLogos[toolkit.slug] = toolkit.logo;
      }
    }
  } catch {
    // Non-fatal — UI will fall back to built-in SVG icons
  }

  const connectedProviderSet = new Set(
    connections.filter((c) => c.status === "active").map((c) => c.provider_id),
  );

  const requiredProviders = [...seenProviders];
  const connectedProviders = requiredProviders.filter((p) =>
    connectedProviderSet.has(p),
  );
  const missingProviders = requiredProviders.filter(
    (p) => !connectedProviderSet.has(p),
  );

  return {
    requirements,
    connected_providers: connectedProviders,
    missing_providers: missingProviders,
    provider_logos: providerLogos,
  };
}

async function requestRemoteTaskProposalGeneration(
  payload: RemoteTaskProposalGenerationRequestPayload,
): Promise<RemoteTaskProposalGenerationResponsePayload> {
  await ensureRuntimeBindingReadyForWorkspaceFlow(
    "remote_task_proposal_generation",
    {
      forceRefresh: true,
    },
  );
  const workspaceId = payload.workspace_id.trim();
  const correlationId = `manual-heartbeat-${workspaceId}-${Date.now()}`;
  try {
    return await ingestWorkspaceHeartbeat({
      workspaceId,
      actorId: "desktop_manual_heartbeat",
      sourceRef: "desktop:manual-heartbeat",
      correlationId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Service not found") || msg.includes("fetch failed")) {
      throw new Error(
        "Proactive service is not reachable. Check your network or backend configuration.",
      );
    }
    throw error;
  }
}

async function proactivePreferenceScopeFromRuntimeConfig(): Promise<{
  holabossUserId: string;
  sandboxId: string;
}> {
  const runtimeConfig = await readRuntimeConfigFile();
  const holabossUserId = (runtimeConfig.user_id || "").trim();
  const sandboxId = (runtimeConfig.sandbox_id || "").trim();
  if (!holabossUserId || !sandboxId) {
    throw new Error(
      "Proactive auth is missing. Sign in to provision a runtime binding token.",
    );
  }
  return { holabossUserId, sandboxId };
}

const DEFAULT_PROACTIVE_HEARTBEAT_CRON = "0 9 * * *";

function assertProactivePreferenceScopedToInstance(
  response: ProactiveTaskProposalPreferencePayload,
  expected: { holabossUserId: string; sandboxId: string },
) {
  const responseUserId = (response.holaboss_user_id || "").trim();
  const responseSandboxId = (response.sandbox_id || "").trim();
  if (!responseUserId || !responseSandboxId) {
    throw new Error(
      "Proactive preference response is missing user/instance scope.",
    );
  }
  if (
    responseUserId !== expected.holabossUserId ||
    responseSandboxId !== expected.sandboxId
  ) {
    throw new Error(
      "Proactive preference scope mismatch for current desktop instance.",
    );
  }
}

async function setProactiveTaskProposalPreference(
  payload: ProactiveTaskProposalPreferenceUpdatePayload,
): Promise<ProactiveTaskProposalPreferencePayload> {
  const scope = await proactivePreferenceScopeFromRuntimeConfig();
  try {
    const response =
      await requestControlPlaneJson<ProactiveTaskProposalPreferencePayload>({
        service: "proactive",
        method: "POST",
        path: "/api/v1/proactive/preferences/task-proposals",
        payload: {
          enabled: payload.enabled !== false,
          holaboss_user_id:
            payload.holaboss_user_id?.trim() || scope.holabossUserId,
          sandbox_id: payload.sandbox_id?.trim() || scope.sandboxId,
        },
      });
    assertProactivePreferenceScopedToInstance(response, scope);
    return response;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Service not found") || msg.includes("fetch failed")) {
      console.warn("[proactive] preference update unavailable:", msg);
      return {
        enabled: payload.enabled !== false,
        holaboss_user_id: scope.holabossUserId,
        sandbox_id: scope.sandboxId,
      };
    }
    throw error;
  }
}

async function getProactiveTaskProposalPreference(): Promise<ProactiveTaskProposalPreferencePayload> {
  try {
    const scope = await proactivePreferenceScopeFromRuntimeConfig();
    const response =
      await requestControlPlaneJson<ProactiveTaskProposalPreferencePayload>({
        service: "proactive",
        method: "GET",
        path: "/api/v1/proactive/preferences/task-proposals",
        params: {
          holaboss_user_id: scope.holabossUserId,
          sandbox_id: scope.sandboxId,
        },
      });
    assertProactivePreferenceScopedToInstance(response, scope);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isExpectedUnavailable =
      message.includes("Proactive auth is missing") ||
      message.includes("Service not found") ||
      message.includes("fetch failed");
    if (!isExpectedUnavailable) {
      throw error;
    }
    if (
      message.includes("Service not found") ||
      message.includes("fetch failed")
    ) {
      console.warn("[proactive] preference fetch unavailable:", message);
    }
    const runtimeConfig = await readRuntimeConfigFile();
    const holabossUserId =
      typeof (runtimeConfig as { user_id?: unknown }).user_id === "string"
        ? ((runtimeConfig as { user_id: string }).user_id || "").trim()
        : "";
    const sandboxId =
      typeof (runtimeConfig as { sandbox_id?: unknown }).sandbox_id === "string"
        ? ((runtimeConfig as { sandbox_id: string }).sandbox_id || "").trim()
        : "";
    return {
      enabled: false,
      holaboss_user_id: holabossUserId,
      sandbox_id: sandboxId,
    };
  }
}

function assertProactiveHeartbeatScopedToInstance(
  response: ProactiveHeartbeatConfigResponsePayload,
  expected: { holabossUserId: string; sandboxId: string },
) {
  const responseUserId = (response.holaboss_user_id || "").trim();
  const responseSandboxId = (response.sandbox_id || "").trim();
  if (!responseUserId || !responseSandboxId) {
    throw new Error(
      "Proactive heartbeat response is missing user/instance scope.",
    );
  }
  if (
    responseUserId !== expected.holabossUserId ||
    responseSandboxId !== expected.sandboxId
  ) {
    throw new Error(
      "Proactive heartbeat scope mismatch for current desktop instance.",
    );
  }
}

function normalizeProactiveHeartbeatConfig(
  response: ProactiveHeartbeatConfigResponsePayload,
): ProactiveHeartbeatConfigPayload {
  return {
    holaboss_user_id: (response.holaboss_user_id || "").trim(),
    sandbox_id: (response.sandbox_id || "").trim(),
    has_schedule: Boolean(response.cronjob),
    cron:
      (response.cronjob?.cron || "").trim() || DEFAULT_PROACTIVE_HEARTBEAT_CRON,
    enabled: response.cronjob?.enabled !== false,
    last_run_at: response.cronjob?.last_run_at || null,
    next_run_at: response.cronjob?.next_run_at || null,
    workspaces: (response.workspaces || []).map((workspace) => ({
      workspace_id: (workspace.workspace_id || "").trim(),
      workspace_name: (workspace.workspace_name || "").trim() || null,
      enabled: workspace.enabled !== false,
      last_seen_at: workspace.last_seen_at || null,
    })),
  };
}

async function listLocalProactiveHeartbeatWorkspaces(): Promise<
  Array<{ workspace_id: string; workspace_name: string | null }>
> {
  const response = await listWorkspacesViaRuntime();
  return response.items
    .map((workspace) => ({
      workspace_id: workspace.id.trim(),
      workspace_name: (workspace.name || "").trim() || null,
    }))
    .filter((workspace) => Boolean(workspace.workspace_id));
}

async function syncCurrentProactiveHeartbeatWorkspaces(scope: {
  holabossUserId: string;
  sandboxId: string;
}): Promise<ProactiveHeartbeatConfigPayload> {
  try {
    const workspaces = await listLocalProactiveHeartbeatWorkspaces();
    const response =
      await requestControlPlaneJson<ProactiveHeartbeatConfigResponsePayload>({
        service: "proactive",
        method: "POST",
        path: "/api/v1/proactive/heartbeat-cronjobs/current/workspaces/sync",
        payload: {
          holaboss_user_id: scope.holabossUserId,
          sandbox_id: scope.sandboxId,
          workspaces,
        },
      });
    assertProactiveHeartbeatScopedToInstance(response, scope);
    return normalizeProactiveHeartbeatConfig(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Service not found") ||
      message.includes("fetch failed")
    ) {
      throw new Error(
        "Proactive service is not reachable. Check your network or backend configuration.",
      );
    }
    throw error;
  }
}

async function getProactiveHeartbeatConfig(): Promise<ProactiveHeartbeatConfigPayload> {
  try {
    const scope = await proactivePreferenceScopeFromRuntimeConfig();
    return await syncCurrentProactiveHeartbeatWorkspaces(scope);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Proactive auth is missing")) {
      throw error;
    }
    const runtimeConfig = await readRuntimeConfigFile();
    const holabossUserId =
      typeof (runtimeConfig as { user_id?: unknown }).user_id === "string"
        ? ((runtimeConfig as { user_id: string }).user_id || "").trim()
        : "";
    const sandboxId =
      typeof (runtimeConfig as { sandbox_id?: unknown }).sandbox_id === "string"
        ? ((runtimeConfig as { sandbox_id: string }).sandbox_id || "").trim()
        : "";
    return {
      holaboss_user_id: holabossUserId,
      sandbox_id: sandboxId,
      has_schedule: false,
      cron: DEFAULT_PROACTIVE_HEARTBEAT_CRON,
      enabled: false,
      last_run_at: null,
      next_run_at: null,
      workspaces: [],
    };
  }
}

async function setProactiveHeartbeatConfig(
  payload: ProactiveHeartbeatConfigUpdatePayload,
): Promise<ProactiveHeartbeatConfigPayload> {
  const scope = await proactivePreferenceScopeFromRuntimeConfig();
  await syncCurrentProactiveHeartbeatWorkspaces(scope);
  try {
    const response =
      await requestControlPlaneJson<ProactiveHeartbeatConfigResponsePayload>({
        service: "proactive",
        method: "POST",
        path: "/api/v1/proactive/heartbeat-cronjobs/current",
        payload: {
          holaboss_user_id:
            payload.holaboss_user_id?.trim() || scope.holabossUserId,
          sandbox_id: payload.sandbox_id?.trim() || scope.sandboxId,
          cron: payload.cron?.trim() || undefined,
          enabled: payload.enabled,
        },
      });
    assertProactiveHeartbeatScopedToInstance(response, scope);
    return normalizeProactiveHeartbeatConfig(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Service not found") ||
      message.includes("fetch failed")
    ) {
      throw new Error(
        "Proactive service is not reachable. Check your network or backend configuration.",
      );
    }
    throw error;
  }
}

async function setProactiveHeartbeatWorkspaceEnabled(
  payload: ProactiveHeartbeatWorkspaceUpdatePayload,
): Promise<ProactiveHeartbeatConfigPayload> {
  const scope = await proactivePreferenceScopeFromRuntimeConfig();
  const workspaceId = payload.workspace_id.trim();
  if (!workspaceId) {
    throw new Error("workspace_id is required");
  }
  try {
    const response =
      await requestControlPlaneJson<ProactiveHeartbeatConfigResponsePayload>({
        service: "proactive",
        method: "POST",
        path: `/api/v1/proactive/heartbeat-cronjobs/current/workspaces/${encodeURIComponent(workspaceId)}`,
        payload: {
          holaboss_user_id:
            payload.holaboss_user_id?.trim() || scope.holabossUserId,
          sandbox_id: payload.sandbox_id?.trim() || scope.sandboxId,
          workspace_name: payload.workspace_name?.trim() || undefined,
          enabled: payload.enabled !== false,
        },
      });
    assertProactiveHeartbeatScopedToInstance(response, scope);
    return normalizeProactiveHeartbeatConfig(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Service not found") ||
      message.includes("fetch failed")
    ) {
      throw new Error(
        "Proactive service is not reachable. Check your network or backend configuration.",
      );
    }
    throw error;
  }
}

async function updateTaskProposalState(
  proposalId: string,
  state: string,
): Promise<TaskProposalStateUpdatePayload> {
  return requestRuntimeJson<TaskProposalStateUpdatePayload>({
    method: "PATCH",
    path: `/api/v1/task-proposals/${encodeURIComponent(proposalId)}`,
    payload: { state },
  });
}

const LOCAL_TEMPLATE_IGNORE_NAMES = new Set([
  ".git",
  "node_modules",
  ".output",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".DS_Store",
  ".holaboss",
  ".opencode",
  "workspace.json",
]);
const LOCAL_TEMPLATE_APP_BINDINGS: Record<string, string[]> = {
  build_in_public: ["github", "twitter"],
  crm: ["gmail", "sheets"],
  gmail_assistant: ["gmail"],
  social_media: ["twitter", "linkedin", "reddit"],
  social_operator: ["twitter", "linkedin", "reddit"],
};
const LOCAL_APP_MCP_PORT_BASE = 13100;
const LOCAL_DEFAULT_APP_MCP_TIMEOUT_MS = 60000;
const LOCAL_MCP_TOOL_CALL_PATTERN = /\btool\(\s*["']([^"']+)["']/g;
const LOCAL_MCP_SOURCE_PATH_PATTERN = /(^|\/)(mcp\.(ts|tsx|js|mjs|cjs|py))$/;

interface LocalAppTemplateBinding {
  lifecycle: Record<string, string> | null;
  path: string | null;
  timeoutMs: number;
  toolNames: string[];
}

function shouldSkipLocalTemplateEntry(name: string) {
  return LOCAL_TEMPLATE_IGNORE_NAMES.has(name);
}

function shouldPreserveWorkspaceRuntimeEntry(name: string) {
  return name === ".holaboss" || name === "workspace.json";
}

function shouldSkipMaterializedWorkspacePath(relativePath: string) {
  const normalized = path.posix.normalize(relativePath.trim());
  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    return false;
  }
  const rootSegment = normalized.split("/")[0];
  return (
    rootSegment === ".holaboss" ||
    rootSegment === ".opencode" ||
    rootSegment === "workspace.json"
  );
}

function decodeMaterializedTemplateFile(
  file: MaterializedTemplateFilePayload,
): string {
  return Buffer.from(file.content_base64, "base64").toString("utf-8");
}

function extractLocalAppToolNames(
  appFiles: MaterializedTemplateFilePayload[],
  declaredToolNames: string[],
): string[] {
  const toolNames = [...declaredToolNames];
  const seenToolNames = new Set(toolNames);
  for (const file of appFiles) {
    if (!LOCAL_MCP_SOURCE_PATH_PATTERN.test(file.path)) {
      continue;
    }
    const source = decodeMaterializedTemplateFile(file);
    for (const match of source.matchAll(LOCAL_MCP_TOOL_CALL_PATTERN)) {
      const toolName = match[1]?.trim();
      if (!toolName || seenToolNames.has(toolName)) {
        continue;
      }
      seenToolNames.add(toolName);
      toolNames.push(toolName);
    }
  }
  return toolNames;
}

function replaceOrAppendMaterializedTemplateFile(
  files: MaterializedTemplateFilePayload[],
  nextFile: MaterializedTemplateFilePayload,
) {
  const index = files.findIndex((file) => file.path === nextFile.path);
  if (index === -1) {
    files.push(nextFile);
    return;
  }
  files[index] = nextFile;
}

function localModulesRootCandidates() {
  return [
    internalOverride("HOLABOSS_MODULES_ROOT"),
    path.resolve(process.cwd(), "..", "..", "holaboss-modules"),
    path.resolve(process.cwd(), "..", "holaboss-modules"),
    path.resolve(app.getAppPath(), "..", "..", "..", "..", "holaboss-modules"),
  ].filter(Boolean);
}

function resolveLocalModulesRoot() {
  for (const candidate of localModulesRootCandidates()) {
    const resolved = path.resolve(candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

function resolveLocalArchiveTarget():
  | "darwin-arm64"
  | "linux-x64"
  | "win32-x64" {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "win32" && arch === "x64") return "win32-x64";
  throw new Error(`Unsupported app archive target: ${platform}/${arch}`);
}

function localAppsRootCandidates() {
  return [
    internalOverride("HOLABOSS_APPS_ROOT"),
    path.resolve(process.cwd(), "..", "..", "hola-boss-apps"),
    path.resolve(process.cwd(), "..", "hola-boss-apps"),
    path.resolve(app.getAppPath(), "..", "..", "..", "..", "hola-boss-apps"),
  ].filter(Boolean) as string[];
}

function resolveLocalAppsRoot(): string | null {
  for (const candidate of localAppsRootCandidates()) {
    const resolved = path.resolve(candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

interface LocalAppArchiveScanEntry {
  appId: string;
  filePath: string;
  target: string;
}

async function scanLocalAppArchives(): Promise<LocalAppArchiveScanEntry[]> {
  const root = resolveLocalAppsRoot();
  if (!root) return [];
  const distDir = path.join(root, "dist");
  if (!existsSync(distDir)) return [];
  let target: string;
  try {
    target = resolveLocalArchiveTarget();
  } catch {
    return [];
  }
  const files = await fs.readdir(distDir);
  const pattern = new RegExp(`^(.+)-module-${target}\\.tar\\.gz$`);
  const out: LocalAppArchiveScanEntry[] = [];
  for (const name of files) {
    const match = name.match(pattern);
    if (!match) continue;
    out.push({ appId: match[1], filePath: path.join(distDir, name), target });
  }
  return out;
}

async function collectLocalTrackedFiles(
  sourceRoot: string,
): Promise<MaterializedTemplateFilePayload[]> {
  const files: MaterializedTemplateFilePayload[] = [];

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkipLocalTemplateEntry(entry.name)) {
        continue;
      }
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      const relativePath = path
        .relative(sourceRoot, absolutePath)
        .split(path.sep)
        .join("/");
      const stats = await fs.lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        files.push({
          path: relativePath,
          content_base64: "",
          executable: false,
          symlink_target: await fs.readlink(absolutePath),
        });
      } else {
        const content = await fs.readFile(absolutePath);
        files.push({
          path: relativePath,
          content_base64: content.toString("base64"),
          executable: Boolean(stats.mode & 0o111),
        });
      }
    }
  }

  await walk(sourceRoot);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

async function collectLocalDirectoryFiles(
  sourceRoot: string,
  relativeRoot: string,
): Promise<MaterializedTemplateFilePayload[]> {
  const files: MaterializedTemplateFilePayload[] = [];

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".DS_Store") {
        continue;
      }
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      const relativePath = path
        .join(relativeRoot, path.relative(sourceRoot, absolutePath))
        .split(path.sep)
        .join("/");
      const stats = await fs.lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        files.push({
          path: relativePath,
          content_base64: "",
          executable: false,
          symlink_target: await fs.readlink(absolutePath),
        });
      } else {
        const content = await fs.readFile(absolutePath);
        files.push({
          path: relativePath,
          content_base64: content.toString("base64"),
          executable: Boolean(stats.mode & 0o111),
        });
      }
    }
  }

  if (!existsSync(sourceRoot)) {
    return files;
  }

  await walk(sourceRoot);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function extractLocalAppTemplateBinding(
  appFiles: MaterializedTemplateFilePayload[],
  appRuntimeFile: MaterializedTemplateFilePayload | null,
): LocalAppTemplateBinding | null {
  if (!appRuntimeFile) {
    return null;
  }

  const loaded = parseYaml(decodeMaterializedTemplateFile(appRuntimeFile));
  if (!loaded || typeof loaded !== "object") {
    return null;
  }

  const data = loaded as Record<string, unknown>;
  const lifecycleSource =
    data.lifecycle && typeof data.lifecycle === "object"
      ? (data.lifecycle as Record<string, unknown>)
      : null;
  const lifecycle: Record<string, string> = {};
  for (const key of ["setup", "start", "stop"]) {
    const value = lifecycleSource?.[key];
    if (typeof value === "string" && value.trim()) {
      lifecycle[key] = value.trim();
    }
  }

  const mcpSource =
    data.mcp && typeof data.mcp === "object"
      ? (data.mcp as Record<string, unknown>)
      : null;
  const healthchecksSource =
    data.healthchecks && typeof data.healthchecks === "object"
      ? (data.healthchecks as Record<string, unknown>)
      : null;

  let timeoutMs = LOCAL_DEFAULT_APP_MCP_TIMEOUT_MS;
  for (const key of ["mcp", "api"]) {
    const healthcheck = healthchecksSource?.[key];
    if (!healthcheck || typeof healthcheck !== "object") {
      continue;
    }
    const timeoutSeconds = (healthcheck as Record<string, unknown>).timeout_s;
    if (typeof timeoutSeconds === "number" && Number.isFinite(timeoutSeconds)) {
      timeoutMs = Math.max(1000, Math.round(timeoutSeconds * 1000));
      break;
    }
    if (typeof timeoutSeconds === "string" && timeoutSeconds.trim()) {
      const parsed = Number.parseInt(timeoutSeconds.trim(), 10);
      if (Number.isFinite(parsed)) {
        timeoutMs = Math.max(1000, parsed * 1000);
        break;
      }
    }
  }

  const toolsSource = Array.isArray(data.tools) ? data.tools : [];
  const declaredToolNames = toolsSource
    .map((tool) =>
      tool &&
      typeof tool === "object" &&
      typeof (tool as Record<string, unknown>).name === "string"
        ? String((tool as Record<string, unknown>).name).trim()
        : "",
    )
    .filter(Boolean);
  const toolNames = extractLocalAppToolNames(appFiles, declaredToolNames);

  const mcpEnabled = mcpSource?.enabled !== false;
  const mcpPath =
    mcpEnabled && typeof mcpSource?.path === "string" && mcpSource.path.trim()
      ? mcpSource.path.trim()
      : mcpEnabled
        ? "/mcp"
        : null;

  if (Object.keys(lifecycle).length === 0 && !mcpPath) {
    return null;
  }

  return {
    lifecycle: Object.keys(lifecycle).length > 0 ? lifecycle : null,
    path: mcpPath,
    timeoutMs,
    toolNames,
  };
}

function ensureWorkspaceMcpRegistry(data: Record<string, unknown>): {
  allowlist: Record<string, unknown>;
  toolIds: string[];
  servers: Record<string, unknown>;
} {
  const registry =
    data.mcp_registry && typeof data.mcp_registry === "object"
      ? (data.mcp_registry as Record<string, unknown>)
      : {};
  data.mcp_registry = registry;

  const allowlist =
    registry.allowlist && typeof registry.allowlist === "object"
      ? (registry.allowlist as Record<string, unknown>)
      : {};
  registry.allowlist = allowlist;

  const toolIds = Array.isArray(allowlist.tool_ids)
    ? allowlist.tool_ids.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  allowlist.tool_ids = toolIds;

  const servers =
    registry.servers && typeof registry.servers === "object"
      ? (registry.servers as Record<string, unknown>)
      : {};
  registry.servers = servers;

  if (!registry.catalog || typeof registry.catalog !== "object") {
    registry.catalog = {};
  }

  return { allowlist, toolIds, servers };
}

function appendApplicationToWorkspaceYaml(
  workspaceYamlContent: string,
  appId: string,
  configPath: string,
  appFiles: MaterializedTemplateFilePayload[],
  appIndex: number,
) {
  const loaded = parseYaml(workspaceYamlContent);
  const data =
    loaded && typeof loaded === "object"
      ? (loaded as Record<string, unknown>)
      : {};
  const applications = Array.isArray(data.applications)
    ? [...data.applications]
    : [];
  let applicationEntry = applications.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      String((entry as Record<string, unknown>).app_id || "") === appId,
  ) as Record<string, unknown> | undefined;

  if (!applicationEntry) {
    applicationEntry = { app_id: appId, config_path: configPath };
    applications.push(applicationEntry);
  } else {
    applicationEntry.config_path = configPath;
  }
  data.applications = applications;

  const binding = extractLocalAppTemplateBinding(
    appFiles,
    appFiles.find((file) => file.path === "app.runtime.yaml") ?? null,
  );
  if (binding?.lifecycle) {
    applicationEntry.lifecycle = binding.lifecycle;
  }

  if (binding?.path) {
    const { toolIds, servers } = ensureWorkspaceMcpRegistry(data);
    servers[appId] = {
      type: "remote",
      url: `http://localhost:${LOCAL_APP_MCP_PORT_BASE + appIndex}${binding.path}`,
      enabled: true,
      timeout_ms: binding.timeoutMs,
    };
    const seenToolIds = new Set(toolIds);
    for (const toolName of binding.toolNames) {
      const toolId = `${appId}.${toolName}`;
      if (!seenToolIds.has(toolId)) {
        toolIds.push(toolId);
        seenToolIds.add(toolId);
      }
    }
  }

  return stringifyYaml(data, { defaultStringType: "QUOTE_DOUBLE" }).trimEnd();
}

function readLocalTemplateAppIds(
  templateRoot: string,
  workspaceYamlContent: string,
) {
  const loaded = parseYaml(workspaceYamlContent);
  const data =
    loaded && typeof loaded === "object"
      ? (loaded as Record<string, unknown>)
      : {};
  const applications = Array.isArray(data.applications)
    ? data.applications
    : [];
  if (applications.length > 0) {
    return [];
  }

  const templateId =
    (typeof data.template_id === "string" && data.template_id.trim()) ||
    path.basename(templateRoot).trim();
  return LOCAL_TEMPLATE_APP_BINDINGS[templateId] ?? [];
}

async function enrichLocalTemplateWithApps(
  templateRoot: string,
  files: MaterializedTemplateFilePayload[],
): Promise<MaterializedTemplateFilePayload[]> {
  if (process.env.HOLABOSS_INTERNAL_DEV?.trim() !== "1") {
    return files;
  }

  const workspaceYamlFile = files.find(
    (file) => file.path === "workspace.yaml",
  );
  if (!workspaceYamlFile) {
    return files;
  }

  const workspaceYamlContent =
    decodeMaterializedTemplateFile(workspaceYamlFile);
  const appIds = readLocalTemplateAppIds(templateRoot, workspaceYamlContent);
  if (appIds.length === 0) {
    return files;
  }

  const modulesRoot = resolveLocalModulesRoot();
  if (!modulesRoot) {
    throw new Error(
      "Local template enrichment needs holaboss-modules, but no local modules root was found.",
    );
  }

  let nextWorkspaceYaml = workspaceYamlContent;
  const nextFiles = [...files];
  for (const [index, appId] of appIds.entries()) {
    const appRoot = path.join(modulesRoot, appId);
    if (!existsSync(appRoot)) {
      throw new Error(
        `Local template enrichment could not find app module '${appId}' at '${appRoot}'.`,
      );
    }
    const appFiles = await collectLocalTrackedFiles(appRoot);
    const nodeModulesRoot = path.join(appRoot, "node_modules");
    const hasLocalNodeModules = existsSync(nodeModulesRoot);
    for (const appFile of appFiles) {
      let nextFile = appFile;
      if (appFile.path === "app.runtime.yaml") {
        const loaded = parseYaml(decodeMaterializedTemplateFile(appFile));
        const parsed =
          loaded && typeof loaded === "object"
            ? (loaded as Record<string, unknown>)
            : {};
        parsed.app_id = appId;
        if (
          hasLocalNodeModules &&
          parsed.lifecycle &&
          typeof parsed.lifecycle === "object"
        ) {
          const lifecycle = parsed.lifecycle as Record<string, unknown>;
          if (typeof lifecycle.setup === "string" && lifecycle.setup.trim()) {
            lifecycle.setup = `if [ -d node_modules ]; then NODE_OPTIONS=--max-old-space-size=384 npm run build; else ${lifecycle.setup.trim()}; fi`;
          }
        }
        nextFile = {
          ...appFile,
          content_base64: Buffer.from(
            stringifyYaml(parsed, { defaultStringType: "QUOTE_DOUBLE" }),
            "utf-8",
          ).toString("base64"),
        };
      }
      replaceOrAppendMaterializedTemplateFile(nextFiles, {
        ...nextFile,
        path: `apps/${appId}/${nextFile.path}`,
      });
    }
    nextWorkspaceYaml = appendApplicationToWorkspaceYaml(
      nextWorkspaceYaml,
      appId,
      `apps/${appId}/app.runtime.yaml`,
      appFiles,
      index,
    );
  }

  replaceOrAppendMaterializedTemplateFile(nextFiles, {
    path: "workspace.yaml",
    content_base64: Buffer.from(`${nextWorkspaceYaml}\n`, "utf-8").toString(
      "base64",
    ),
    executable: false,
  });
  nextFiles.sort((left, right) => left.path.localeCompare(right.path));
  return nextFiles;
}

async function copyLocalTemplateAppNodeModulesToWorkspace(
  templateRoot: string,
  workspaceId: string,
) {
  if (process.env.HOLABOSS_INTERNAL_DEV?.trim() !== "1") {
    return;
  }

  const workspaceYamlPath = path.join(templateRoot, "workspace.yaml");
  if (!existsSync(workspaceYamlPath)) {
    return;
  }

  const modulesRoot = resolveLocalModulesRoot();
  if (!modulesRoot) {
    return;
  }

  const workspaceYamlContent = await fs.readFile(workspaceYamlPath, "utf-8");
  const appIds = readLocalTemplateAppIds(templateRoot, workspaceYamlContent);
  if (appIds.length === 0) {
    return;
  }

  const workspaceDir = workspaceDirectoryPath(workspaceId);
  for (const appId of appIds) {
    const sourceNodeModules = path.join(modulesRoot, appId, "node_modules");
    if (!existsSync(sourceNodeModules)) {
      continue;
    }
    const targetNodeModules = path.join(
      workspaceDir,
      "apps",
      appId,
      "node_modules",
    );
    await fs.rm(targetNodeModules, { recursive: true, force: true });
    await fs.cp(sourceNodeModules, targetNodeModules, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
  }
}

async function materializeLocalTemplate(payload: {
  template_root_path: string;
}): Promise<MaterializeTemplateResponsePayload> {
  const templateRoot = path.resolve(payload.template_root_path);
  const workspaceYamlPath = path.join(templateRoot, "workspace.yaml");
  if (!existsSync(workspaceYamlPath)) {
    throw new Error(
      `Template folder '${templateRoot}' is missing workspace.yaml.`,
    );
  }

  const metadata = await parseLocalTemplateMetadata(templateRoot);
  const files = await enrichLocalTemplateWithApps(
    templateRoot,
    await collectLocalTrackedFiles(templateRoot),
  );
  const totalBytes = files.reduce(
    (sum, file) => sum + Buffer.byteLength(file.content_base64, "base64"),
    0,
  );
  return {
    template: {
      name: metadata.name,
      repo: "local",
      path: templateRoot,
      effective_ref: "local",
      effective_commit: null,
      source: "template_folder",
    },
    files,
    file_count: files.length,
    total_bytes: totalBytes,
  };
}

async function materializeMarketplaceTemplate(payload: {
  holaboss_user_id: string;
  template_name: string;
  template_ref?: string | null;
  template_commit?: string | null;
}): Promise<MaterializeTemplateResponsePayload> {
  const client = getMarketplaceAppSdkClient();
  const data = await sdkMaterializeMarketplaceTemplate(payload, { client });
  return data as MaterializeTemplateResponsePayload;
}

async function pickTemplateFolder(): Promise<TemplateFolderSelectionPayload> {
  const ownerWindow = mainWindow ?? BrowserWindow.getFocusedWindow() ?? null;
  const options: OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"],
    title: "Choose Template Folder",
    buttonLabel: "Use Template Folder",
  };
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return {
      canceled: true,
      rootPath: null,
      templateName: null,
      description: null,
    };
  }

  const rootPath = path.resolve(result.filePaths[0]);
  const workspaceYamlPath = path.join(rootPath, "workspace.yaml");
  if (!existsSync(workspaceYamlPath)) {
    throw new Error("Selected folder must contain a workspace.yaml file.");
  }

  const metadata = await parseLocalTemplateMetadata(rootPath);
  return {
    canceled: false,
    rootPath,
    templateName: metadata.name,
    description: metadata.description,
  };
}

function runtimeBaseUrl() {
  return `http://127.0.0.1:${runtimeApiPort()}`;
}

async function ensureRuntimeReady() {
  const status = await startEmbeddedRuntime();
  if (status.status === "running" && status.url) {
    return status;
  }

  const runtimeUrl = status.url ?? runtimeBaseUrl();
  if (status.status === "starting" && runtimeUrl) {
    const healthy = await waitForRuntimeHealth(runtimeUrl, 10, 300);
    if (healthy) {
      const refreshed = await refreshRuntimeStatus();
      if (refreshed.status === "running" && refreshed.url) {
        return refreshed;
      }
    }
  }

  const refreshed = await refreshRuntimeStatus();
  if (refreshed.status === "running" && refreshed.url) {
    return refreshed;
  }

  throw new Error(
    refreshed.lastError || status.lastError || "Embedded runtime is not ready.",
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientRuntimeError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("embedded runtime is not ready") ||
    message.includes("fetch failed") ||
    message.includes("bad port") ||
    message.includes("invalid url") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("socket hang up")
  );
}

function runtimeErrorFromBody(
  statusCode: number,
  statusMessage: string | undefined,
  body: string,
): Error {
  const trimmed = body.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as {
        detail?: unknown;
        message?: unknown;
        error?: unknown;
      };
      const detail =
        typeof parsed.detail === "string"
          ? parsed.detail
          : typeof parsed.message === "string"
            ? parsed.message
            : typeof parsed.error === "string"
              ? parsed.error
              : "";
      if (detail) {
        return new Error(detail);
      }
    } catch {
      return new Error(trimmed);
    }
  }
  return new Error(
    `${statusCode} ${statusMessage ?? "Runtime request failed."}`.trim(),
  );
}

async function requestRuntimeJsonViaHttp<T>(
  targetUrl: URL,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  payload?: unknown,
  timeoutMs = 15000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const serializedPayload =
      payload === undefined ? null : JSON.stringify(payload);
    const request = httpRequest(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || "80",
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        headers:
          serializedPayload === null
            ? undefined
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(serializedPayload),
              },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf-8");
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              runtimeErrorFromBody(statusCode, response.statusMessage, body),
            );
            return;
          }
          if (statusCode === 204 || !body.trim()) {
            resolve(null as T);
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error("Runtime returned invalid JSON."));
          }
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("Runtime request timed out."));
    });
    request.on("error", (error) => {
      reject(error);
    });

    if (serializedPayload !== null) {
      request.write(serializedPayload);
    }
    request.end();
  });
}

async function requestRuntimeJson<T>({
  method,
  path: requestPath,
  payload,
  params,
  timeoutMs,
  retryTransientErrors = false,
}: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  payload?: unknown;
  params?: Record<string, string | number | boolean | null | undefined>;
  timeoutMs?: number;
  retryTransientErrors?: boolean;
}): Promise<T> {
  const attempts = method === "GET" || retryTransientErrors ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const status = await ensureRuntimeReady();
      const url = new URL(`${status.url}${requestPath}`);
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value === undefined || value === null || value === "") {
            continue;
          }
          url.searchParams.set(key, String(value));
        }
      }
      return requestRuntimeJsonViaHttp<T>(url, method, payload, timeoutMs);
    } catch (error) {
      if (attempt < attempts && isTransientRuntimeError(error)) {
        await sleep(250 * attempt);
        continue;
      }
      throw error;
    }
  }

  throw new Error("Runtime request failed after retries.");
}

function workspaceHarness() {
  return (
    (process.env.HOLABOSS_RUNTIME_HARNESS || "pi").trim().toLowerCase() || "pi"
  );
}

function normalizeRequestedWorkspaceHarness(
  value: string | null | undefined,
): string {
  const normalized = value?.trim().toLowerCase() || "pi";
  if (normalized === "pi") {
    return "pi";
  }
  throw new Error(`Unsupported workspace harness '${value}'.`);
}

function requestedWorkspaceTemplateMode(
  payload: HolabossCreateWorkspacePayload,
): "template" | "empty" {
  return payload.template_mode === "empty" ||
    payload.template_mode === "empty_onboarding"
    ? "empty"
    : "template";
}

function workspaceDirectoryPath(workspaceId: string) {
  // Hard-validate before path.join so a renderer can't smuggle ".." or
  // path separators in a workspace id and escape the workspace root.
  // assertSafeWorkspaceId rejects /, \, NUL, whitespace, and limits length.
  const safeId = assertSafeWorkspaceId(workspaceId);
  const root = runtimeWorkspaceRoot();
  const joined = path.join(root, safeId);
  // Belt-and-suspenders: even if SAFE_ID_REGEX is later relaxed, ensure
  // the resolved path is still under the workspace root.
  const resolved = path.resolve(joined);
  const resolvedRoot = path.resolve(root);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error(`workspaceId resolves outside workspace root: ${workspaceId}`);
  }
  return joined;
}

function resolveWorkspaceDownloadTargetPath(
  workspaceId: string,
  filename: string,
): string {
  const downloadsDir = path.join(
    workspaceDirectoryPath(workspaceId),
    "Downloads",
  );
  mkdirSync(downloadsDir, { recursive: true });

  const sanitizedFilename = sanitizeAttachmentName(filename || "download");
  const parsed = path.parse(sanitizedFilename);
  const basename = parsed.name || "download";
  const extension = parsed.ext || "";

  let candidate = `${basename}${extension}`;
  let candidatePath = path.join(downloadsDir, candidate);
  let index = 2;
  while (existsSync(candidatePath)) {
    candidate = `${basename}-${index}${extension}`;
    candidatePath = path.join(downloadsDir, candidate);
    index += 1;
  }

  return candidatePath;
}

function sanitizeAttachmentName(name: string): string {
  const basename = path.basename(name || "").trim();
  const sanitized = basename
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || "attachment";
}

function dedupeAttachmentName(name: string, usedNames: Set<string>): string {
  const parsed = path.parse(name);
  const basename = parsed.name || "attachment";
  const extension = parsed.ext || "";
  let candidate = `${basename}${extension}`;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${basename}-${index}${extension}`;
    index += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function attachmentMimeType(name: string, mimeType?: string | null): string {
  const normalized = (mimeType ?? "").trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") {
    return normalized;
  }

  switch (path.extname(name).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".md":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".ts":
      return "text/typescript";
    case ".tsx":
      return "text/tsx";
    case ".js":
      return "text/javascript";
    case ".jsx":
      return "text/jsx";
    case ".css":
      return "text/css";
    case ".html":
      return "text/html";
    default:
      return "application/octet-stream";
  }
}

function attachmentKind(mimeType: string): "image" | "file" {
  return mimeType.startsWith("image/") ? "image" : "file";
}

function resolveWorkspaceMaterializedFilePath(
  workspaceRoot: string,
  relativePath: string,
) {
  const normalized = path.posix.normalize(relativePath.trim());
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized.startsWith("../")
  ) {
    throw new Error(`Invalid template file path: ${relativePath}`);
  }
  if (
    normalized
      .split("/")
      .some((part) => part === "." || part === ".." || part.length === 0)
  ) {
    throw new Error(`Invalid template file path: ${relativePath}`);
  }
  const absolute = path.resolve(workspaceRoot, normalized);
  const relativeToRoot = path.relative(workspaceRoot, absolute);
  if (
    relativeToRoot === "" ||
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error(`Template file escaped workspace root: ${relativePath}`);
  }
  return absolute;
}

async function applyMaterializedTemplateToWorkspace(
  workspaceId: string,
  files: MaterializedTemplateFilePayload[],
) {
  const workspaceDir = workspaceDirectoryPath(workspaceId);
  await fs.mkdir(workspaceDir, { recursive: true });

  const existingEntries = await fs.readdir(workspaceDir, {
    withFileTypes: true,
  });
  await Promise.all(
    existingEntries
      .filter((entry) => !shouldPreserveWorkspaceRuntimeEntry(entry.name))
      .map((entry) =>
        fs.rm(path.join(workspaceDir, entry.name), {
          recursive: true,
          force: true,
        }),
      ),
  );

  for (const item of files) {
    if (shouldSkipMaterializedWorkspacePath(item.path)) {
      continue;
    }
    const absolutePath = resolveWorkspaceMaterializedFilePath(
      workspaceDir,
      item.path,
    );
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    if (typeof item.symlink_target === "string" && item.symlink_target.trim()) {
      await fs.symlink(item.symlink_target, absolutePath);
    } else {
      const content = Buffer.from(item.content_base64, "base64");
      await fs.writeFile(absolutePath, content);
      if (item.executable) {
        await fs.chmod(absolutePath, 0o755);
      }
    }
  }
}

async function stageSessionAttachments(
  payload: StageSessionAttachmentsPayload,
): Promise<StageSessionAttachmentsResponsePayload> {
  const workspaceId = payload.workspace_id?.trim();
  if (!workspaceId) {
    throw new Error("workspace_id is required");
  }

  const files = Array.isArray(payload.files) ? payload.files : [];
  if (files.length === 0) {
    return { attachments: [] };
  }

  const workspaceDir = workspaceDirectoryPath(workspaceId);
  await fs.mkdir(workspaceDir, { recursive: true });

  const batchId = randomUUID();
  const relativeRoot = path.posix.join(
    ".holaboss",
    "input-attachments",
    batchId,
  );
  const absoluteRoot = resolveWorkspaceMaterializedFilePath(
    workspaceDir,
    relativeRoot,
  );
  await fs.mkdir(absoluteRoot, { recursive: true });

  const usedNames = new Set<string>();
  const attachments: SessionInputAttachmentPayload[] = [];
  for (const [index, file] of files.entries()) {
    const contentBase64 =
      typeof file?.content_base64 === "string"
        ? file.content_base64.trim()
        : "";
    if (!contentBase64) {
      throw new Error(`files[${index}].content_base64 is required`);
    }

    const name = dedupeAttachmentName(
      sanitizeAttachmentName(file?.name ?? ""),
      usedNames,
    );
    const relativePath = path.posix.join(relativeRoot, name);
    const absolutePath = resolveWorkspaceMaterializedFilePath(
      workspaceDir,
      relativePath,
    );
    const content = Buffer.from(contentBase64, "base64");
    await fs.writeFile(absolutePath, content);

    const mimeType = attachmentMimeType(name, file?.mime_type);
    attachments.push({
      id: randomUUID(),
      kind: attachmentKind(mimeType),
      name,
      mime_type: mimeType,
      size_bytes: content.byteLength,
      workspace_path: relativePath,
    });
  }

  return { attachments };
}

async function stageSessionAttachmentPaths(
  payload: StageSessionAttachmentPathsPayload,
): Promise<StageSessionAttachmentsResponsePayload> {
  const workspaceId = payload.workspace_id?.trim();
  if (!workspaceId) {
    throw new Error("workspace_id is required");
  }

  const files = Array.isArray(payload.files) ? payload.files : [];
  if (files.length === 0) {
    return { attachments: [] };
  }

  const workspaceDir = workspaceDirectoryPath(workspaceId);
  await fs.mkdir(workspaceDir, { recursive: true });

  const batchId = randomUUID();
  const relativeRoot = path.posix.join(
    ".holaboss",
    "input-attachments",
    batchId,
  );
  const absoluteRoot = resolveWorkspaceMaterializedFilePath(
    workspaceDir,
    relativeRoot,
  );
  await fs.mkdir(absoluteRoot, { recursive: true });

  const usedNames = new Set<string>();
  const attachments: SessionInputAttachmentPayload[] = [];
  for (const [index, file] of files.entries()) {
    const absolutePath =
      typeof file?.absolute_path === "string"
        ? path.resolve(file.absolute_path)
        : "";
    if (!absolutePath) {
      throw new Error(`files[${index}].absolute_path is required`);
    }

    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`files[${index}] must reference a file`);
    }

    const name = dedupeAttachmentName(
      sanitizeAttachmentName(file?.name ?? path.basename(absolutePath)),
      usedNames,
    );
    const relativePath = path.posix.join(relativeRoot, name);
    const targetPath = resolveWorkspaceMaterializedFilePath(
      workspaceDir,
      relativePath,
    );
    await fs.copyFile(absolutePath, targetPath);

    const mimeType = attachmentMimeType(name, file?.mime_type);
    attachments.push({
      id: randomUUID(),
      kind: attachmentKind(mimeType),
      name,
      mime_type: mimeType,
      size_bytes: stat.size,
      workspace_path: relativePath,
    });
  }

  return { attachments };
}

function insertSessionMessage(message: {
  id: string;
  workspaceId: string;
  sessionId: string;
  role: string;
  text: string;
  createdAt?: string;
}) {
  const database = openRuntimeDatabase();
  try {
    database
      .prepare(
        `
        INSERT OR REPLACE INTO session_messages (
          id, workspace_id, session_id, role, text, created_at
        ) VALUES (
          @id, @workspace_id, @session_id, @role, @text, @created_at
        )
      `,
      )
      .run({
        id: message.id,
        workspace_id: message.workspaceId,
        session_id: message.sessionId,
        role: message.role,
        text: message.text,
        created_at: message.createdAt ?? utcNowIso(),
      });
  } finally {
    database.close();
  }
}

function upsertRuntimeState(record: {
  workspaceId: string;
  sessionId: string;
  status: "IDLE" | "BUSY" | "WAITING_USER" | "ERROR" | "QUEUED";
  currentInputId?: string | null;
  lastError?: Record<string, unknown> | string | null;
}) {
  const now = utcNowIso();
  const database = openRuntimeDatabase();
  try {
    database
      .prepare(
        `
        INSERT INTO session_runtime_state (
          workspace_id,
          session_id,
          status,
          current_input_id,
          current_worker_id,
          lease_until,
          heartbeat_at,
          last_error,
          created_at,
          updated_at
        ) VALUES (
          @workspace_id,
          @session_id,
          @status,
          @current_input_id,
          NULL,
          NULL,
          NULL,
          @last_error,
          @created_at,
          @updated_at
        )
        ON CONFLICT(workspace_id, session_id) DO UPDATE SET
          status = excluded.status,
          current_input_id = excluded.current_input_id,
          heartbeat_at = excluded.heartbeat_at,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        workspace_id: record.workspaceId,
        session_id: record.sessionId,
        status: record.status,
        current_input_id: record.currentInputId ?? null,
        last_error:
          typeof record.lastError === "string"
            ? record.lastError
            : record.lastError
              ? JSON.stringify(record.lastError)
              : null,
        created_at: now,
        updated_at: now,
      });
  } finally {
    database.close();
  }
}

function updateQueuedInputStatus(inputId: string, status: string) {
  const database = openRuntimeDatabase();
  try {
    database
      .prepare(
        `
        UPDATE agent_session_inputs
        SET status = @status, updated_at = @updated_at
        WHERE input_id = @input_id
      `,
      )
      .run({
        input_id: inputId,
        status,
        updated_at: utcNowIso(),
      });
  } finally {
    database.close();
  }
}

function getWorkspaceRecord(
  workspaceId: string,
): WorkspaceRecordPayload | null {
  const database = openRuntimeDatabase();
  try {
    const row = database
      .prepare(
        `
        SELECT
          id,
          name,
          status,
          harness,
          error_message,
          onboarding_status,
          onboarding_session_id,
          onboarding_completed_at,
          onboarding_completion_summary,
          onboarding_requested_at,
          onboarding_requested_by,
          created_at,
          updated_at,
          deleted_at_utc
        FROM workspaces
        WHERE id = @id
      `,
      )
      .get({ id: workspaceId }) as WorkspaceRecordPayload | undefined;
    return row ?? null;
  } finally {
    database.close();
  }
}

async function listWorkspaces(): Promise<WorkspaceListResponsePayload> {
  // Desktop always uses local runtime for workspace CRUD.
  return listWorkspacesViaRuntime();
}

async function listWorkspacesViaRuntime(): Promise<WorkspaceListResponsePayload> {
  return requestRuntimeJson<WorkspaceListResponsePayload>({
    method: "GET",
    path: "/api/v1/workspaces",
    params: {
      include_deleted: false,
      limit: 100,
      offset: 0,
    },
  });
}

const STATIC_APP_CATALOG: Record<
  string,
  {
    name: string;
    description: string | null;
    icon: string | null;
    category: string | null;
    tags: string[];
  }
> = {
  twitter: {
    name: "Twitter / X",
    description: "Short-form post drafting and thread editing.",
    icon: null,
    category: "social",
    tags: ["social media", "twitter"],
  },
  linkedin: {
    name: "LinkedIn",
    description: "Long-form post drafting and professional publishing.",
    icon: null,
    category: "social",
    tags: ["social media", "linkedin"],
  },
  reddit: {
    name: "Reddit",
    description: "Subreddit posts, comments and community replies.",
    icon: null,
    category: "social",
    tags: ["social media", "reddit"],
  },
  gmail: {
    name: "Gmail",
    description: "Email drafts, replies, and thread management.",
    icon: null,
    category: "communication",
    tags: ["email", "gmail"],
  },
  sheets: {
    name: "Google Sheets",
    description: "Spreadsheet data as a lightweight database.",
    icon: null,
    category: "productivity",
    tags: ["spreadsheet", "google sheets"],
  },
  github: {
    name: "GitHub",
    description: "Repository activity tracking and release notes.",
    icon: null,
    category: "developer",
    tags: ["github", "developer"],
  },
};

function staticCatalogMeta(appId: string) {
  return (
    STATIC_APP_CATALOG[appId] ?? {
      name: appId,
      description: null,
      icon: null,
      category: null,
      tags: [] as string[],
    }
  );
}

async function listAppCatalog(params: {
  source?: "marketplace" | "local";
}): Promise<AppCatalogListResponse> {
  const query: Record<string, string> = {};
  if (params.source) query.source = params.source;
  return requestRuntimeJson<AppCatalogListResponse>({
    method: "GET",
    path: "/api/v1/apps/catalog",
    params: query,
  });
}

async function syncAppCatalog(params: {
  source: "marketplace" | "local";
}): Promise<AppCatalogSyncResponse> {
  const target = resolveLocalArchiveTarget();

  if (params.source === "marketplace") {
    const resp = await listAppTemplatesViaControlPlane();
    const entries: Array<Record<string, unknown>> = [];
    for (const tmpl of resp.templates) {
      const archives = Array.isArray(tmpl.archives) ? tmpl.archives : [];
      const matching = archives.find((a) => a?.target === target);
      if (!matching) continue;
      const meta = staticCatalogMeta(tmpl.name);
      entries.push({
        app_id: tmpl.name,
        name: meta.name,
        description: tmpl.description ?? meta.description,
        icon: tmpl.icon ?? meta.icon,
        category: tmpl.category ?? meta.category,
        tags:
          Array.isArray(tmpl.tags) && tmpl.tags.length > 0
            ? tmpl.tags
            : meta.tags,
        version: tmpl.version ?? null,
        archive_url: matching.url,
        archive_path: null,
      });
    }
    return requestRuntimeJson<AppCatalogSyncResponse>({
      method: "POST",
      path: "/api/v1/apps/catalog/sync",
      payload: { source: "marketplace", target, entries },
    });
  }

  const scanned = await scanLocalAppArchives();
  const entries = scanned.map((row) => {
    const meta = staticCatalogMeta(row.appId);
    return {
      app_id: row.appId,
      name: meta.name,
      description: meta.description,
      icon: meta.icon,
      category: meta.category,
      tags: meta.tags,
      version: null,
      archive_url: null,
      archive_path: row.filePath,
    };
  });
  return requestRuntimeJson<AppCatalogSyncResponse>({
    method: "POST",
    path: "/api/v1/apps/catalog/sync",
    payload: { source: "local", target, entries },
  });
}

async function installAppFromCatalog(params: {
  workspaceId: string;
  appId: string;
  source: "marketplace" | "local";
}): Promise<InstallAppFromCatalogResponse> {
  params = {
    ...params,
    workspaceId: assertSafeWorkspaceId(params.workspaceId),
    appId: assertSafeAppId(params.appId),
  };
  const listing = await listAppCatalog({ source: params.source });
  const entry = listing.entries.find((e) => e.app_id === params.appId);
  if (!entry) {
    throw new Error(
      `App '${params.appId}' not found in ${params.source} catalog`,
    );
  }

  let archivePath: string;
  let cleanupTempFile = false;
  if (params.source === "marketplace") {
    if (!entry.archive_url) {
      throw new Error(
        `Catalog entry for '${params.appId}' is missing archive_url`,
      );
    }
    mainWindow?.webContents.send("app-install-progress", {
      appId: params.appId,
      phase: "downloading",
      bytes: 0,
      total: 0,
    });
    archivePath = await downloadAppArchive(entry.archive_url, params.appId);
    cleanupTempFile = true;
  } else {
    if (!entry.archive_path) {
      throw new Error(
        `Catalog entry for '${params.appId}' is missing archive_path`,
      );
    }
    archivePath = entry.archive_path;
  }

  mainWindow?.webContents.send("app-install-progress", {
    appId: params.appId,
    phase: "installing",
    bytes: 0,
    total: 0,
  });

  try {
    const resp = await requestRuntimeJson<InstallAppFromCatalogResponse>({
      method: "POST",
      path: "/api/v1/apps/install-archive",
      payload: {
        workspace_id: params.workspaceId,
        app_id: params.appId,
        archive_path: archivePath,
      },
      timeoutMs: 300_000,
    });
    return resp;
  } finally {
    if (cleanupTempFile) {
      // Use the already-imported fs/promises namespace instead of a
      // dynamic import. The dynamic import could itself throw under
      // certain ESM-loader edge cases, leaving the temp archive on disk.
      try {
        await fs.rm(archivePath, { force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

async function listInstalledApps(
  workspaceId: string,
): Promise<InstalledWorkspaceAppListResponsePayload> {
  const lifecycle = await getWorkspaceLifecycle(workspaceId);
  return {
    apps: lifecycle.applications,
    count: lifecycle.applications.length,
  };
}

async function listInstalledAppsViaRuntime(
  workspaceId: string,
): Promise<InstalledWorkspaceAppListResponsePayload> {
  return requestRuntimeJson<InstalledWorkspaceAppListResponsePayload>({
    method: "GET",
    path: "/api/v1/apps",
    params: {
      workspace_id: workspaceId,
    },
  });
}

async function removeInstalledApp(
  workspaceId: string,
  appId: string,
): Promise<void> {
  const safeWorkspaceId = assertSafeWorkspaceId(workspaceId);
  const safeAppId = assertSafeAppId(appId);
  await requestRuntimeJson<Record<string, unknown>>({
    method: "DELETE",
    path: `/api/v1/apps/${encodeURIComponent(safeAppId)}`,
    payload: {
      workspace_id: safeWorkspaceId,
    },
    timeoutMs: 30000,
  });
}

async function controlPlaneWorkspaceUserId(): Promise<string | null> {
  // Check runtime config first — populated during binding provisioning.
  const runtimeConfig = await readRuntimeConfigFile();
  const runtimeUserId = (runtimeConfig.user_id || "").trim();
  if (runtimeUserId && runtimeUserId !== LOCAL_OSS_TEMPLATE_USER_ID) {
    return runtimeUserId;
  }

  // Fall back to authenticated user.
  const authenticatedUser = await getAuthenticatedUser().catch(() => null);
  const authId = authenticatedUser ? authUserId(authenticatedUser) : "";
  return authId.trim() || null;
}

function workspaceReadinessFromApps(apps: InstalledWorkspaceAppPayload[]) {
  const blockingApps = apps
    .filter((app) => !app.ready)
    .map((app) => ({
      app_id: app.app_id,
      status: app.error ? "error" : "initializing",
      error: app.error ?? null,
    }));

  if (blockingApps.length === 0) {
    return {
      ready: true,
      reason: null,
      blocking_apps: [],
    };
  }

  const hasErrors = blockingApps.some((app) => app.error);
  const prefix = hasErrors
    ? "Some apps failed to start"
    : "Apps are initializing";
  const details = blockingApps.map((app) => app.app_id).join(", ");
  return {
    ready: false,
    reason: `${prefix}: ${details}.`,
    blocking_apps: blockingApps,
  };
}

function workspaceLifecyclePhaseFromState(
  workspace: WorkspaceRecordPayload,
  readiness: ReturnType<typeof workspaceReadinessFromApps>,
) {
  const reason = readiness.reason?.trim() || null;
  const blockingStatuses = new Set(
    readiness.blocking_apps.map((app) =>
      (app.status || "").trim().toLowerCase(),
    ),
  );

  if ((workspace.status || "").trim().toLowerCase() === "error") {
    return {
      phase: "error",
      phase_label: "Workspace error",
      phase_detail:
        workspace.error_message || reason || "Workspace provisioning failed.",
    };
  }
  if ((workspace.status || "").trim().toLowerCase() === "provisioning") {
    return {
      phase: "provisioning_workspace",
      phase_label: "Configuring workspace",
      phase_detail: "Preparing the local workspace files and settings.",
    };
  }
  if (readiness.ready) {
    return {
      phase: "ready",
      phase_label: "Workspace ready",
      phase_detail: null,
    };
  }
  if (blockingStatuses.has("failed")) {
    return {
      phase: "error",
      phase_label: "Workspace error",
      phase_detail:
        reason || workspace.error_message || "Workspace apps failed to start.",
    };
  }
  if (blockingStatuses.has("building") || blockingStatuses.has("pending")) {
    return {
      phase: "building_apps",
      phase_label: "Building apps",
      phase_detail: reason || "Building workspace apps.",
    };
  }
  if (readiness.blocking_apps.length > 0) {
    return {
      phase: "starting_apps",
      phase_label: "Starting apps",
      phase_detail: reason || "Starting workspace apps.",
    };
  }
  return {
    phase: "preparing_workspace",
    phase_label: "Preparing workspace",
    phase_detail: reason || "Finalizing workspace startup.",
  };
}

async function getWorkspaceLifecycle(
  workspaceId: string,
): Promise<WorkspaceLifecyclePayload> {
  // Desktop always uses local runtime for workspace lifecycle.
  return getWorkspaceLifecycleViaRuntime(assertSafeWorkspaceId(workspaceId));
}

async function activateWorkspace(
  workspaceId: string,
): Promise<WorkspaceLifecyclePayload> {
  const safeWorkspaceId = assertSafeWorkspaceId(workspaceId);
  // Desktop always activates via local runtime.
  // Ensure all enabled apps are running in parallel via the runtime.
  await requestRuntimeJson<Record<string, unknown>>({
    method: "POST",
    path: "/api/v1/apps/ensure-running",
    payload: { workspace_id: safeWorkspaceId },
    timeoutMs: 300000,
    retryTransientErrors: true,
  });
  return getWorkspaceLifecycleViaRuntime(safeWorkspaceId);
}

async function getWorkspaceLifecycleViaRuntime(
  workspaceId: string,
): Promise<WorkspaceLifecyclePayload> {
  const workspace =
    getWorkspaceRecord(workspaceId) ??
    (await listWorkspacesViaRuntime()).items.find(
      (item) => item.id === workspaceId,
    ) ??
    null;
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found.`);
  }

  const installedApps = await listInstalledAppsViaRuntime(workspaceId);
  const readiness = workspaceReadinessFromApps(installedApps.apps);
  const phaseState = workspaceLifecyclePhaseFromState(workspace, readiness);

  return {
    workspace,
    applications: installedApps.apps,
    ready: readiness.ready,
    reason: readiness.reason,
    phase: phaseState.phase,
    phase_label: phaseState.phase_label,
    phase_detail: phaseState.phase_detail,
    blocking_apps: readiness.blocking_apps,
  };
}

async function listOutputs(
  payload: string | HolabossListOutputsPayload,
): Promise<WorkspaceOutputListResponsePayload> {
  const requestPayload =
    typeof payload === "string" ? { workspaceId: payload } : payload;
  return requestRuntimeJson<WorkspaceOutputListResponsePayload>({
    method: "GET",
    path: "/api/v1/outputs",
    params: {
      workspace_id: requestPayload.workspaceId,
      output_type: requestPayload.outputType ?? undefined,
      status: requestPayload.status ?? undefined,
      platform: requestPayload.platform ?? undefined,
      folder_id: requestPayload.folderId ?? undefined,
      session_id: requestPayload.sessionId ?? undefined,
      input_id: requestPayload.inputId ?? undefined,
      limit: requestPayload.limit ?? 50,
      offset: requestPayload.offset ?? 0,
    },
  });
}

function normalizeWorkspaceSkillId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const skillId = value.trim();
  if (!skillId || skillId === "." || skillId === "..") {
    return null;
  }
  if (
    skillId.includes("/") ||
    skillId.includes("\\") ||
    skillId.includes("\0")
  ) {
    return null;
  }
  return skillId;
}

function sanitizeYamlScalar(rawValue: string): string {
  const trimmed = rawValue.replace(/\s+#.*$/, "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function humanizeSkillId(skillId: string): string {
  return skillId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractSkillMetadata(
  markdown: string,
  skillId: string,
): { title: string; summary: string } {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  let remaining = normalized;
  let summary = "";

  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\s*/);
  if (frontmatterMatch) {
    const descriptionMatch = frontmatterMatch[1].match(
      /^description:\s*(.+)$/m,
    );
    if (descriptionMatch) {
      summary = sanitizeYamlScalar(descriptionMatch[1]);
    }
    remaining = normalized.slice(frontmatterMatch[0].length).trim();
  }

  const titleMatch = remaining.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || humanizeSkillId(skillId) || skillId;

  if (!summary) {
    const lines = remaining.split("\n");
    const paragraphLines: string[] = [];
    let collecting = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        if (collecting) {
          break;
        }
        continue;
      }
      if (!collecting && (line.startsWith("#") || line === "---")) {
        continue;
      }
      if (line.startsWith("```")) {
        if (collecting) {
          break;
        }
        continue;
      }
      collecting = true;
      paragraphLines.push(line);
    }
    summary = paragraphLines.join(" ").trim();
  }

  return {
    title,
    summary: summary || "No description provided.",
  };
}

async function readSkillCatalogFromRoot(params: {
  skillsRoot: string;
}): Promise<WorkspaceSkillRecordPayload[]> {
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(params.skillsRoot, {
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  return (
    await Promise.all(
      directoryEntries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const skillId = normalizeWorkspaceSkillId(entry.name);
          if (!skillId) {
            return null;
          }
          const sourceDir = path.join(params.skillsRoot!, entry.name);
          const skillFilePath = path.join(sourceDir, "SKILL.md");
          try {
            const [content, stats] = await Promise.all([
              fs.readFile(skillFilePath, "utf-8"),
              fs.stat(skillFilePath),
            ]);
            const metadata = extractSkillMetadata(content, skillId);
            return {
              skill_id: skillId,
              source_dir: sourceDir,
              skill_file_path: skillFilePath,
              title: metadata.title,
              summary: metadata.summary,
              modified_at: stats.mtime.toISOString(),
            } satisfies WorkspaceSkillRecordPayload;
          } catch {
            return null;
          }
        }),
    )
  ).filter((skill): skill is WorkspaceSkillRecordPayload => Boolean(skill));
}

async function listWorkspaceSkills(
  workspaceId: string,
): Promise<WorkspaceSkillListResponsePayload> {
  const workspaceRoot = workspaceDirectoryPath(workspaceId);
  const skillsPath = path.resolve(workspaceRoot, "skills");

  const workspaceSkills = await readSkillCatalogFromRoot({ skillsRoot: skillsPath });

  const skills = [...workspaceSkills].sort((left, right) =>
    left.title.localeCompare(right.title, undefined, {
      sensitivity: "base",
    }),
  );

  return {
    workspace_id: workspaceId,
    workspace_root: workspaceRoot,
    skills_path: skillsPath,
    skills,
  };
}

function renderMinimalWorkspaceYaml(
  workspace: WorkspaceRecordPayload,
  template: ResolvedTemplatePayload,
) {
  const createdAt = workspace.created_at ?? utcNowIso();
  const templateCommit = template.effective_commit
    ? `  commit: ${JSON.stringify(template.effective_commit)}\n`
    : "";
  return [
    `name: ${JSON.stringify(workspace.name)}`,
    `created_at: ${JSON.stringify(createdAt)}`,
    "agents:",
    '  id: "workspace.general"',
    '  model: "openai/gpt-5"',
    "mcp_registry:",
    "  allowlist:",
    "    tool_ids: []",
    "  servers:",
    "    workspace:",
    '      type: "local"',
    "      enabled: true",
    "      timeout_ms: 10000",
    "  catalog: {}",
    `template_id: ${JSON.stringify(template.name)}`,
    "template:",
    `  name: ${JSON.stringify(template.name)}`,
    `  repo: ${JSON.stringify(template.repo)}`,
    `  path: ${JSON.stringify(template.path)}`,
    `  ref: ${JSON.stringify(template.effective_ref)}`,
    templateCommit + `  imported_at: ${JSON.stringify(utcNowIso())}`,
  ].join("\n");
}

function renderEmptyWorkspaceYaml() {
  return [
    "agents:",
    "  id: workspace.general",
    "  model: openai/gpt-5",
    "mcp_registry:",
    "  allowlist:",
    "    tool_ids: []",
    "  servers: {}",
  ].join("\n");
}

function renderEmptyOnboardingGuide() {
  return [
    "# Workspace Onboarding",
    "",
    "Use this conversation to set up the workspace before regular execution starts.",
    "",
    "## Objectives",
    "",
    "- Ask concise questions to understand what this workspace is for.",
    "- Capture durable facts, preferences, and constraints.",
    "- Do not start execution work until onboarding is complete.",
    "",
    "## Gather",
    "",
    "- Primary goal for this workspace",
    "- Preferred outputs or deliverables",
    "- Style or tone preferences",
    "- Tools, accounts, or apps that matter",
    "- Constraints, deadlines, or things to avoid",
    "",
    "## Completion",
    "",
    "- Summarize the durable facts you collected.",
    "- Ask the user to confirm the summary is correct.",
    "- When the user confirms, request onboarding completion.",
  ].join("\n");
}

async function createWorkspace(
  payload: HolabossCreateWorkspacePayload,
): Promise<WorkspaceResponsePayload> {
  // Structured stage logs for workspace create/install debugging. These
  // go to the Electron main process stdout; in dev they appear in the
  // terminal, in packaged builds they land in the platform log dir
  // under `holaboss-local/logs/main.log` (handled by Electron).
  const stageLog = (event: string, data?: Record<string, unknown>): void => {
    const line = { event: `desktop.${event}`, ts: new Date().toISOString(), ...(data ?? {}) };
    // eslint-disable-next-line no-console
    console.info(`[holaboss.createWorkspace] ${JSON.stringify(line)}`);
  };
  const stageError = (event: string, err: unknown, data?: Record<string, unknown>): void => {
    const line = {
      event: `desktop.${event}`,
      ts: new Date().toISOString(),
      err: err instanceof Error ? err.message : String(err),
      ...(data ?? {}),
    };
    // eslint-disable-next-line no-console
    console.error(`[holaboss.createWorkspace] ${JSON.stringify(line)}`);
  };

  const harness = normalizeRequestedWorkspaceHarness(payload.harness);
  const templateMode = requestedWorkspaceTemplateMode(payload);
  const templateRootPath = payload.template_root_path?.trim() || "";
  const templateName = payload.template_name?.trim() || "";
  const requiresRuntimeBinding =
    templateMode !== "empty" && !templateRootPath && Boolean(templateName);
  stageLog("begin", {
    templateMode,
    templateName,
    hasTemplateRootPath: Boolean(templateRootPath),
    harness,
    requiresRuntimeBinding,
  });
  if (requiresRuntimeBinding) {
    await ensureRuntimeBindingReadyForWorkspaceFlow("workspace_create");
  }
  // Desktop always materializes templates locally — never delegate to remote
  // projects service which would write files into a remote sandbox.
  let materializedTemplate: MaterializeTemplateResponsePayload | null = null;
  let resolvedTemplate: ResolvedTemplatePayload | null = null;
  if (templateMode === "empty") {
    resolvedTemplate = null;
  } else if (templateRootPath) {
    stageLog("materialize_local_template.start", { templateRootPath });
    try {
      materializedTemplate = await materializeLocalTemplate({
        template_root_path: templateRootPath,
      });
      resolvedTemplate = materializedTemplate.template;
      stageLog("materialize_local_template.ok", {
        fileCount: materializedTemplate.files.length,
      });
    } catch (error) {
      stageError("materialize_local_template.failed", error, { templateRootPath });
      throw new Error(
        contextualWorkspaceCreateError(
          "Couldn't materialize the local template",
          error,
        ),
      );
    }
  } else if (templateName) {
    stageLog("materialize_marketplace_template.start", { templateName });
    try {
      materializedTemplate = await materializeMarketplaceTemplate({
        holaboss_user_id: payload.holaboss_user_id,
        template_name: templateName,
        template_ref: payload.template_ref,
        template_commit: payload.template_commit,
      });
      resolvedTemplate = materializedTemplate.template;
      stageLog("materialize_marketplace_template.ok", {
        templateName,
        fileCount: materializedTemplate.files.length,
      });
    } catch (error) {
      stageError("materialize_marketplace_template.failed", error, { templateName });
      throw new Error(
        contextualWorkspaceCreateError(
          `Couldn't materialize the marketplace template '${templateName}'`,
          error,
        ),
      );
    }
  } else {
    throw new Error("Choose a local folder or a marketplace template first.");
  }
  let created: WorkspaceResponsePayload;
  stageLog("runtime_post_workspaces.start");
  try {
    created = await requestRuntimeJson<WorkspaceResponsePayload>({
      method: "POST",
      path: "/api/v1/workspaces",
      payload: {
        name: payload.name,
        harness,
        status: "provisioning",
        onboarding_status: "not_required",
      },
    });
    stageLog("runtime_post_workspaces.ok", { workspaceId: created.workspace.id });
  } catch (error) {
    stageError("runtime_post_workspaces.failed", error);
    throw new Error(
      contextualWorkspaceCreateError(
        "Couldn't create the workspace record",
        error,
      ),
    );
  }
  const workspaceId = created.workspace.id;

  try {
    const workspaceDir = workspaceDirectoryPath(workspaceId);
    stageLog("workspace_dir_resolved", { workspaceId, workspaceDir });
    const workspaceAgentsPath = path.join(workspaceDir, "AGENTS.md");
    const workspaceYamlPath = path.join(workspaceDir, "workspace.yaml");
    const workspaceOnboardPath = path.join(workspaceDir, "ONBOARD.md");
    const wantsEmptyOnboardingScaffold =
      payload.template_mode === "empty_onboarding";
    if (templateMode === "empty") {
      await fs.mkdir(path.join(workspaceDir, "skills"), { recursive: true });
      await fs.writeFile(workspaceAgentsPath, "", "utf-8");
      await fs.writeFile(
        workspaceYamlPath,
        `${renderEmptyWorkspaceYaml()}\n`,
        "utf-8",
      );
      if (wantsEmptyOnboardingScaffold) {
        await fs.writeFile(
          workspaceOnboardPath,
          `${renderEmptyOnboardingGuide()}\n`,
          "utf-8",
        );
      }
    } else if (materializedTemplate && resolvedTemplate) {
      stageLog("apply_template.start", {
        workspaceId,
        fileCount: materializedTemplate.files.length,
      });
      try {
        await applyMaterializedTemplateToWorkspace(
          workspaceId,
          materializedTemplate.files,
        );
        stageLog("apply_template.ok", { workspaceId });
      } catch (error) {
        stageError("apply_template.failed", error, { workspaceId });
        throw error;
      }
      if (templateRootPath) {
        stageLog("copy_local_node_modules.start", { workspaceId, templateRootPath });
        try {
          await copyLocalTemplateAppNodeModulesToWorkspace(
            templateRootPath,
            workspaceId,
          );
          stageLog("copy_local_node_modules.ok", { workspaceId });
        } catch (error) {
          stageError("copy_local_node_modules.failed", error, { workspaceId });
          throw error;
        }
      }

      let workspaceYamlExists = true;
      try {
        await fs.access(workspaceYamlPath);
      } catch {
        workspaceYamlExists = false;
      }
      if (!workspaceYamlExists) {
        const current = getWorkspaceRecord(workspaceId);
        if (current) {
          await fs.writeFile(
            workspaceYamlPath,
            `${renderMinimalWorkspaceYaml(current, resolvedTemplate)}\n`,
            "utf-8",
          );
        }
      }
    }

    await ensureWorkspaceGitRepo(workspaceDir);

    let onboardingStatus = "NOT_REQUIRED";
    let onboardingSessionId: string | null = null;
    try {
      const onboardContent = await fs.readFile(
        path.join(workspaceDir, "ONBOARD.md"),
        "utf-8",
      );
      if (onboardContent.trim()) {
        onboardingStatus = "PENDING";
        onboardingSessionId = crypto.randomUUID();
      }
    } catch {
      onboardingStatus = "NOT_REQUIRED";
      onboardingSessionId = null;
    }

    stageLog("activate_workspace.start", { workspaceId, onboardingStatus });
    let updated: WorkspaceResponsePayload;
    try {
      updated = await requestRuntimeJson<WorkspaceResponsePayload>({
        method: "PATCH",
        path: `/api/v1/workspaces/${workspaceId}`,
        payload: {
          status: "active",
          onboarding_status: onboardingStatus.toLowerCase(),
          onboarding_session_id: onboardingSessionId,
          error_message: null,
        },
      });
      stageLog("activate_workspace.ok", { workspaceId });
    } catch (error) {
      stageError("activate_workspace.failed", error, { workspaceId });
      throw error;
    }

    // --- Auto-bind integrations (best-effort) ---
    if (materializedTemplate) {
      try {
        const integrationReqs = extractIntegrationRequirementsFromTemplateFiles(
          materializedTemplate.files,
        );
        if (integrationReqs.length > 0) {
          let connections: IntegrationConnectionPayload[] = [];
          try {
            const resp = await listIntegrationConnections();
            connections = resp.connections.filter((c) => c.status === "active");
          } catch {
            // Cannot reach integration API; skip auto-bind.
          }

          if (connections.length > 0) {
            const connectionsByProvider = new Map<
              string,
              IntegrationConnectionPayload
            >();
            for (const conn of connections) {
              // Keep the first (most recently created) connection per provider
              if (!connectionsByProvider.has(conn.provider_id)) {
                connectionsByProvider.set(conn.provider_id, conn);
              }
            }

            for (const req of integrationReqs) {
              const conn = connectionsByProvider.get(req.provider);
              if (!conn) continue;
              try {
                await upsertIntegrationBinding(
                  workspaceId,
                  "app",
                  req.app_id,
                  req.key,
                  { connection_id: conn.connection_id, is_default: true },
                );
              } catch {
                // Best-effort: skip binding failures silently.
              }
            }
          }
        }
      } catch {
        // Auto-bind is best-effort; do not fail workspace creation.
      }
    }

    const templateAppNames = (payload.template_apps ?? []).filter(
      (name) => typeof name === "string" && name.trim(),
    );
    if (templateAppNames.length > 0) {
      stageLog("install_template_apps.start", {
        workspaceId,
        apps: templateAppNames,
      });
      try {
        await syncAppCatalog({ source: "marketplace" });
        stageLog("install_template_apps.catalog_synced", { workspaceId });
      } catch (error) {
        stageError("install_template_apps.catalog_sync_failed", error, {
          workspaceId,
        });
      }
      for (const appName of templateAppNames) {
        try {
          stageLog("install_template_apps.installing", {
            workspaceId,
            appId: appName,
          });
          await installAppFromCatalog({
            workspaceId,
            appId: appName,
            source: "marketplace",
          });
          stageLog("install_template_apps.installed", {
            workspaceId,
            appId: appName,
          });
        } catch (error) {
          stageError("install_template_apps.failed", error, {
            workspaceId,
            appId: appName,
          });
        }
      }
      stageLog("install_template_apps.done", { workspaceId });
    }

    if (onboardingSessionId) {
      try {
        await requestRuntimeJson<EnqueueSessionInputResponsePayload>({
          method: "POST",
          path: "/api/v1/agent-sessions/queue",
          payload: {
            workspace_id: workspaceId,
            session_id: onboardingSessionId,
            text: "Start workspace onboarding now. Use ONBOARD.md as the guide and ask the first onboarding question only.",
            priority: 0,
          },
        });
      } catch (error) {
        updated = await requestRuntimeJson<WorkspaceResponsePayload>({
          method: "PATCH",
          path: `/api/v1/workspaces/${workspaceId}`,
          payload: {
            error_message: contextualWorkspaceCreateError(
              "Workspace created, but automatic onboarding could not start",
              error,
            ),
          },
        }).catch(() => updated);
      }
    }
    const runtimeConfigForHeartbeat = await readRuntimeConfigFile();
    const runtimeHeartbeatToken = runtimeModelProxyApiKeyFromConfig(
      runtimeConfigForHeartbeat,
    );
    const runtimeHeartbeatUserId = (
      runtimeConfigForHeartbeat.user_id || ""
    ).trim();
    const requestedHeartbeatUserId = (payload.holaboss_user_id || "").trim();
    const shouldEmitWorkspaceReadyHeartbeat =
      Boolean(runtimeHeartbeatToken) &&
      Boolean(requestedHeartbeatUserId) &&
      requestedHeartbeatUserId !== LOCAL_OSS_TEMPLATE_USER_ID &&
      runtimeHeartbeatUserId === requestedHeartbeatUserId;

    if (shouldEmitWorkspaceReadyHeartbeat) {
      try {
        await emitWorkspaceReadyHeartbeat({
          workspaceId,
          holabossUserId: requestedHeartbeatUserId,
        });
      } catch (error) {
        throw new Error(
          contextualWorkspaceCreateError(
            "Workspace created locally, but the workspace-ready heartbeat was not confirmed",
            error,
          ),
        );
      }
    } else {
      appendRuntimeEventLog({
        category: "workspace",
        event: "workspace.heartbeat.emit",
        outcome: "skipped",
        detail:
          `workspace_id=${workspaceId} skipped=no_active_runtime_binding ` +
          `requested_user_id=${requestedHeartbeatUserId || "missing"} runtime_user_id=${runtimeHeartbeatUserId || "missing"}`,
      });
    }
    return updated;
  } catch (error) {
    await requestRuntimeJson<WorkspaceResponsePayload>({
      method: "PATCH",
      path: `/api/v1/workspaces/${workspaceId}`,
      payload: {
        status: "error",
        error_message: normalizeErrorMessage(error),
      },
    }).catch(() => undefined);
    throw error;
  }
}

async function deleteWorkspace(
  workspaceId: string,
): Promise<WorkspaceResponsePayload> {
  const safeWorkspaceId = assertSafeWorkspaceId(workspaceId);
  return requestRuntimeJson<WorkspaceResponsePayload>({
    method: "DELETE",
    path: `/api/v1/workspaces/${encodeURIComponent(safeWorkspaceId)}`,
  });
}

async function listRuntimeStates(
  workspaceId: string,
): Promise<SessionRuntimeStateListResponsePayload> {
  return requestRuntimeJson<SessionRuntimeStateListResponsePayload>({
    method: "GET",
    path: `/api/v1/agent-sessions/by-workspace/${workspaceId}/runtime-states`,
    params: {
      limit: 100,
      offset: 0,
    },
  });
}

async function listAgentSessions(
  workspaceId: string,
): Promise<AgentSessionListResponsePayload> {
  if (!workspaceId.trim()) {
    return { items: [], count: 0 };
  }
  return requestRuntimeJson<AgentSessionListResponsePayload>({
    method: "GET",
    path: "/api/v1/agent-sessions",
    params: {
      workspace_id: workspaceId,
      include_archived: false,
      limit: 100,
      offset: 0,
    },
  });
}

async function createAgentSession(
  payload: CreateAgentSessionPayload,
): Promise<CreateAgentSessionResponsePayload> {
  return requestRuntimeJson<CreateAgentSessionResponsePayload>({
    method: "POST",
    path: "/api/v1/agent-sessions",
    payload: {
      workspace_id: payload.workspace_id,
      session_id: payload.session_id ?? undefined,
      kind: payload.kind ?? undefined,
      title: payload.title ?? undefined,
      parent_session_id: payload.parent_session_id ?? undefined,
      created_by: payload.created_by ?? undefined,
    },
  });
}

function isMissingSessionBindingError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.trim().toLowerCase() === "session binding not found"
  );
}

function isWorkspaceNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.trim().toLowerCase() === "workspace not found"
  );
}

function emptySessionHistoryPayload(
  sessionId: string,
  workspaceId: string,
): SessionHistoryResponsePayload {
  return {
    workspace_id: workspaceId,
    session_id: sessionId,
    harness: "",
    harness_session_id: "",
    source: "sandbox_local_storage",
    messages: [],
    count: 0,
    total: 0,
    limit: 200,
    offset: 0,
    raw: null,
  };
}

async function getSessionHistory(
  sessionId: string,
  workspaceId: string,
): Promise<SessionHistoryResponsePayload> {
  try {
    return await requestRuntimeJson<SessionHistoryResponsePayload>({
      method: "GET",
      path: `/api/v1/agent-sessions/${sessionId}/history`,
      params: {
        workspace_id: workspaceId,
        limit: 200,
        offset: 0,
      },
    });
  } catch (error) {
    if (
      isMissingSessionBindingError(error) ||
      isWorkspaceNotFoundError(error)
    ) {
      return emptySessionHistoryPayload(sessionId, workspaceId);
    }
    throw error;
  }
}

async function getSessionOutputEvents(
  sessionId: string,
): Promise<SessionOutputEventListResponsePayload> {
  return requestRuntimeJson<SessionOutputEventListResponsePayload>({
    method: "GET",
    path: `/api/v1/agent-sessions/${encodeURIComponent(sessionId)}/outputs/events`,
    params: {
      include_history: true,
      after_event_id: 0,
    },
  });
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation failed.";
}

function contextualWorkspaceCreateError(stage: string, error: unknown) {
  return `${stage}: ${normalizeErrorMessage(error)}`;
}

async function queueSessionInput(
  payload: HolabossQueueSessionInputPayload,
): Promise<EnqueueSessionInputResponsePayload> {
  const currentConfig = await readRuntimeConfigFile();
  if (sessionQueueRequiresRuntimeBinding(currentConfig, payload.model)) {
    await ensureRuntimeBindingReadyForWorkspaceFlow("session_queue");
  }
  const idempotencyKey =
    payload.idempotency_key?.trim() || `desktop-session-input:${randomUUID()}`;
  return requestRuntimeJson<EnqueueSessionInputResponsePayload>({
    method: "POST",
    path: "/api/v1/agent-sessions/queue",
    payload: {
      workspace_id: payload.workspace_id,
      text: payload.text,
      image_urls: payload.image_urls,
      attachments: payload.attachments ?? null,
      session_id: payload.session_id,
      idempotency_key: idempotencyKey,
      priority: payload.priority ?? 0,
      model: payload.model,
      thinking_value: payload.thinking_value ?? null,
    },
    retryTransientErrors: true,
  });
}

async function pauseSessionRun(
  payload: HolabossPauseSessionRunPayload,
): Promise<PauseSessionRunResponsePayload> {
  return requestRuntimeJson<PauseSessionRunResponsePayload>({
    method: "POST",
    path: `/api/v1/agent-sessions/${encodeURIComponent(payload.session_id)}/pause`,
    payload: {
      workspace_id: payload.workspace_id,
    },
  });
}

async function* iterSseEvents(stream: NodeJS.ReadableStream) {
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let eventId: string | null = null;
  let dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length === 0) {
      return null;
    }
    const data = dataLines.join("\n");
    dataLines = [];
    const payload = { event: eventName, id: eventId, data };
    eventName = "message";
    eventId = null;
    return payload;
  };

  for await (const chunk of stream) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes("\n")) {
      const newlineIndex = buffer.indexOf("\n");
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r$/, "");

      if (line.startsWith(":")) {
        continue;
      }

      if (line === "") {
        const event = flush();
        if (event) {
          yield event;
        }
        continue;
      }

      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim() || "message";
        continue;
      }

      if (line.startsWith("id:")) {
        eventId = line.slice("id:".length).trim() || null;
        continue;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim().startsWith("data:")) {
    dataLines.push(buffer.trim().slice("data:".length).trim());
  }
  const tail = flush();
  if (tail) {
    yield tail;
  }
}

function emitSessionStreamEvent(payload: HolabossSessionStreamEventPayload) {
  const detail =
    payload.type === "event"
      ? `event=${payload.event?.event || "message"} id=${payload.event?.id || "-"}`
      : payload.type === "error"
        ? `error=${payload.error || "unknown"}`
        : "done";
  appendSessionStreamDebug(payload.streamId, `emit_${payload.type}`, detail);

  const windows = BrowserWindow.getAllWindows().filter(
    (win) => !win.isDestroyed(),
  );
  if (windows.length === 0) {
    appendSessionStreamDebug(payload.streamId, "emit_skipped", "no windows");
    return;
  }
  for (const win of windows) {
    try {
      win.webContents.send("workspace:sessionStream", payload);
    } catch (error) {
      appendSessionStreamDebug(
        payload.streamId,
        "emit_error",
        error instanceof Error ? error.message : "webContents.send failed",
      );
    }
  }
}

function getQueuedInput(inputId: string) {
  const database = openRuntimeDatabase();
  try {
    const row = database
      .prepare(
        `
        SELECT
          input_id,
          session_id,
          workspace_id,
          payload,
          status,
          priority,
          available_at,
          attempt,
          idempotency_key,
          created_at,
          updated_at
        FROM agent_session_inputs
        WHERE input_id = @input_id
      `,
      )
      .get({ input_id: inputId }) as
      | {
          input_id: string;
          session_id: string;
          workspace_id: string;
          payload: string;
          status: string;
          priority: number;
          available_at: string;
          attempt: number;
          idempotency_key: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    let parsedPayload: Record<string, unknown> = {};
    try {
      parsedPayload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      parsedPayload = {};
    }
    return {
      ...row,
      payload: parsedPayload,
    };
  } finally {
    database.close();
  }
}

async function openSessionOutputStream(
  payload: HolabossStreamSessionOutputsPayload,
): Promise<HolabossSessionStreamHandlePayload> {
  const streamId = crypto.randomUUID();
  const controller = new AbortController();
  sessionOutputStreams.set(streamId, controller);
  appendSessionStreamDebug(streamId, "open_requested", JSON.stringify(payload));

  void (async () => {
    try {
      const status = await ensureRuntimeReady();
      const url = new URL(
        `/api/v1/agent-sessions/${payload.sessionId}/outputs/stream`,
        status.url ?? runtimeBaseUrl(),
      );
      if (payload.inputId) {
        url.searchParams.set("input_id", payload.inputId);
      }
      if (payload.workspaceId) {
        url.searchParams.set("workspace_id", payload.workspaceId);
      }
      if (payload.includeHistory !== undefined) {
        url.searchParams.set(
          "include_history",
          payload.includeHistory ? "true" : "false",
        );
      }
      if (payload.stopOnTerminal !== undefined) {
        url.searchParams.set(
          "stop_on_terminal",
          payload.stopOnTerminal ? "true" : "false",
        );
      }
      appendSessionStreamDebug(streamId, "http_request_start", url.toString());
      await new Promise<void>((resolve, reject) => {
        const abortError = new Error("Stream aborted.");
        abortError.name = "AbortError";

        const request = httpRequest(
          {
            hostname: url.hostname,
            port: url.port || "80",
            path: `${url.pathname}${url.search}`,
            method: "GET",
            headers: {
              Accept: "text/event-stream",
            },
            // Session output uses a long-lived SSE connection. Let runtime-side
            // queue and runner recovery determine terminal failure instead of
            // aborting the desktop stream after 30s of quiet.
            timeout: 0,
          },
          (response) => {
            const statusCode = response.statusCode ?? 0;
            appendSessionStreamDebug(
              streamId,
              "http_response",
              `status=${statusCode} message=${response.statusMessage || ""}`,
            );
            if (statusCode < 200 || statusCode >= 300) {
              const chunks: Buffer[] = [];
              response.on("data", (chunk) => {
                chunks.push(
                  Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
                );
              });
              response.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf-8");
                reject(
                  runtimeErrorFromBody(
                    statusCode,
                    response.statusMessage,
                    body,
                  ),
                );
              });
              return;
            }

            void (async () => {
              try {
                for await (const event of iterSseEvents(response)) {
                  appendSessionStreamDebug(
                    streamId,
                    "sse_event_raw",
                    `event=${event.event} id=${event.id || "-"}`,
                  );
                  let parsedData: unknown = event.data;
                  try {
                    parsedData = JSON.parse(event.data);
                  } catch {
                    parsedData = event.data;
                  }
                  const normalizedData =
                    parsedData &&
                    typeof parsedData === "object" &&
                    !Array.isArray(parsedData) &&
                    "event_type" in parsedData
                      ? parsedData
                      : {
                          event_type: event.event,
                          payload: parsedData,
                        };

                  emitSessionStreamEvent({
                    streamId,
                    type: "event",
                    event: {
                      event: event.event,
                      id: event.id,
                      data: normalizedData,
                    },
                  });
                  await new Promise<void>((resolve) => {
                    setImmediate(resolve);
                  });
                }
                appendSessionStreamDebug(
                  streamId,
                  "sse_complete",
                  "iterSseEvents completed",
                );
                resolve();
              } catch (streamError) {
                appendSessionStreamDebug(
                  streamId,
                  "sse_error",
                  streamError instanceof Error
                    ? streamError.message
                    : "unknown stream error",
                );
                reject(streamError);
              }
            })();
          },
        );

        const abortRequest = () => {
          request.destroy(abortError);
        };
        controller.signal.addEventListener("abort", abortRequest, {
          once: true,
        });
        request.on("close", () => {
          controller.signal.removeEventListener("abort", abortRequest);
        });
        request.on("timeout", () => {
          appendSessionStreamDebug(streamId, "http_timeout", "request timeout");
          request.destroy(new Error("Session stream request timed out."));
        });
        request.on("error", (requestError) => {
          appendSessionStreamDebug(
            streamId,
            "http_error",
            requestError instanceof Error
              ? requestError.message
              : "request error",
          );
          reject(requestError);
        });
        request.end();
      });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AbortError") {
        appendSessionStreamDebug(
          streamId,
          "open_error",
          error instanceof Error ? error.message : "unknown error",
        );
        emitSessionStreamEvent({
          streamId,
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to stream session output.",
        });
      }
    } finally {
      sessionOutputStreams.delete(streamId);
      appendSessionStreamDebug(streamId, "open_finally", "stream closed");
      emitSessionStreamEvent({ streamId, type: "done" });
    }
  })();

  return { streamId };
}

async function closeSessionOutputStream(
  streamId: string,
  reason?: string,
): Promise<void> {
  const controller = sessionOutputStreams.get(streamId);
  if (!controller) {
    appendSessionStreamDebug(
      streamId,
      "close_ignored",
      reason || "missing_controller",
    );
    return;
  }
  appendSessionStreamDebug(
    streamId,
    "close_requested",
    reason || "unspecified",
  );
  controller.abort();
  sessionOutputStreams.delete(streamId);
}

function emitRuntimeState(force = false) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const nextSignature = JSON.stringify({
    status: runtimeStatus.status,
    available: runtimeStatus.available,
    runtimeRoot: runtimeStatus.runtimeRoot,
    sandboxRoot: runtimeStatus.sandboxRoot,
    executablePath: runtimeStatus.executablePath,
    url: runtimeStatus.url,
    pid: runtimeStatus.pid,
    harness: runtimeStatus.harness,
    desktopBrowserReady: runtimeStatus.desktopBrowserReady,
    desktopBrowserUrl: runtimeStatus.desktopBrowserUrl,
    lastError: runtimeStatus.lastError,
  });
  if (!force && nextSignature === lastRuntimeStateSignature) {
    return;
  }
  lastRuntimeStateSignature = nextSignature;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("runtime:state", runtimeStatus);
  }
  if (authPopupWindow && !authPopupWindow.isDestroyed()) {
    authPopupWindow.webContents.send("runtime:state", runtimeStatus);
  }
}

async function emitRuntimeConfig(config?: RuntimeConfigPayload) {
  const payload = config ?? (await getRuntimeConfigWithoutCatalogRefresh());
  const nextSignature = JSON.stringify(payload);
  if (nextSignature === lastRuntimeConfigSignature) {
    return;
  }
  lastRuntimeConfigSignature = nextSignature;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("runtime:config", payload);
  }
  if (authPopupWindow && !authPopupWindow.isDestroyed()) {
    authPopupWindow.webContents.send("runtime:config", payload);
  }
}

async function fileExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

const REQUIRED_RUNTIME_ROOT_PATH_GROUPS = [
  runtimeBundleExecutableRelativePaths(CURRENT_RUNTIME_PLATFORM),
  ["package-metadata.json"],
  runtimeBundleNodeRelativePaths(CURRENT_RUNTIME_PLATFORM),
  runtimeBundleNpmRelativePaths(CURRENT_RUNTIME_PLATFORM),
  runtimeBundlePythonRelativePaths(CURRENT_RUNTIME_PLATFORM),
  [path.join("runtime", "metadata.json")],
  [path.join("runtime", "api-server", "dist", "index.mjs")],
];

async function firstExistingRelativePath(
  rootPath: string,
  relativePaths: readonly string[],
): Promise<string | null> {
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(rootPath, relativePath);
    if (await fileExists(absolutePath)) {
      return absolutePath;
    }
  }
  return null;
}

async function resolveRuntimeExecutablePath(
  runtimeRoot: string,
): Promise<string | null> {
  return firstExistingRelativePath(
    runtimeRoot,
    runtimeBundleExecutableRelativePaths(CURRENT_RUNTIME_PLATFORM),
  );
}

async function resolveRuntimeNodePath(
  runtimeRoot: string,
): Promise<string | null> {
  return firstExistingRelativePath(
    runtimeRoot,
    runtimeBundleNodeRelativePaths(CURRENT_RUNTIME_PLATFORM),
  );
}

async function resolveRuntimeLaunchSpec(
  runtimeRoot: string,
  executablePath: string,
): Promise<RuntimeLaunchSpec | null> {
  const extension = path.extname(executablePath).toLowerCase();
  if (extension === ".mjs") {
    const nodePath = await resolveRuntimeNodePath(runtimeRoot);
    if (!nodePath) {
      return null;
    }
    return {
      command: nodePath,
      args: [executablePath],
    };
  }

  if (extension === ".ps1") {
    return {
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        executablePath,
      ],
    };
  }

  if (extension === ".cmd" || extension === ".bat") {
    return {
      command: process.env.ComSpec?.trim() || "cmd.exe",
      args: ["/d", "/s", "/c", `"${executablePath}"`],
    };
  }

  return {
    command: executablePath,
    args: [],
  };
}

async function killWindowsProcessTree(pid: number | undefined | null) {
  if (!pid) {
    return;
  }

  await new Promise<void>((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => resolve());
    killer.once("exit", () => resolve());
  });
}

async function validateRuntimeRoot(runtimeRoot: string) {
  for (const relativePaths of REQUIRED_RUNTIME_ROOT_PATH_GROUPS) {
    if (!(await firstExistingRelativePath(runtimeRoot, relativePaths))) {
      return `Runtime bundle is incomplete. Missing ${relativePaths.join(" or ")} under ${runtimeRoot}. Rebuild or restage ${RUNTIME_BUNDLE_DIR}.`;
    }
  }

  return null;
}

async function resolveRuntimeRoot() {
  const candidates = [
    process.env.HOLABOSS_RUNTIME_ROOT,
    isDev ? path.resolve(__dirname, "..", RUNTIME_BUNDLE_DIR) : undefined,
    isDev
      ? DEV_RUNTIME_ROOT
      : path.join(process.resourcesPath, RUNTIME_BUNDLE_DIR),
  ].filter((value): value is string =>
    Boolean(value && value.trim().length > 0),
  );

  let firstInvalidError: string | null = null;
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const validationError = await validateRuntimeRoot(resolved);
    if (!validationError) {
      return {
        runtimeRoot: resolved,
        validationError: null,
      };
    }
    if (!firstInvalidError) {
      firstInvalidError = validationError;
    }
  }

  return {
    runtimeRoot: null,
    validationError: firstInvalidError,
  };
}

async function waitForRuntimeHealth(
  url: string,
  attempts = 30,
  delayMs = 1000,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isRuntimeHealthy(url)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return false;
}

async function isRuntimeHealthy(url: string) {
  return new Promise<boolean>((resolve) => {
    const target = new URL("/healthz", url);
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        timeout: 1500,
      },
      (response) => {
        response.resume();
        resolve(
          (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
        );
      },
    );

    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
    request.end();
  });
}

function persistedRuntimeMatchesCurrentLaunch(
  record: PersistedRuntimeProcessStateRecord | null,
  sandboxRoot: string,
) {
  return (
    record?.launchId === DESKTOP_LAUNCH_ID &&
    record?.sandboxRoot === sandboxRoot
  );
}

function processExists(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code !== "ESRCH";
  }
}

async function killRuntimeProcessByPid(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return false;
  }

  if (process.platform === "win32") {
    await killWindowsProcessTree(pid);
    return !processExists(pid);
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return !processExists(pid);
  }

  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (!processExists(pid)) {
      return true;
    }
    await sleep(100);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return !processExists(pid);
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!processExists(pid)) {
      return true;
    }
    await sleep(100);
  }

  return !processExists(pid);
}

function windowsPowerShellPath() {
  const systemRoot = (process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows").trim();
  if (!systemRoot) {
    return "powershell.exe";
  }
  return path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function killRuntimePortListener(port: number) {
  if (!Number.isInteger(port) || port <= 0) {
    return;
  }

  try {
    if (process.platform === "win32") {
      execFileSync(
        windowsPowerShellPath(),
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          [
            `$port = ${port};`,
            "Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |",
            "  Where-Object { $_.State -eq 'Listen' } |",
            "  Select-Object -ExpandProperty OwningProcess -Unique |",
            "  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }",
          ].join(" "),
        ],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      return;
    }

    // Restrict to LISTEN state so health-check sockets do not kill the caller.
    execFileSync(
      "/bin/bash",
      [
        "-lc",
        `command -v lsof >/dev/null 2>&1 && kill $(lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null) 2>/dev/null || true`,
      ],
      {
        stdio: "ignore",
      },
    );
  } catch {
    // Ignore best-effort stale-port cleanup failures.
  }
}

async function waitForRuntimeShutdown(
  url: string,
  attempts = 20,
  delayMs = 150,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await isRuntimeHealthy(url))) {
      return true;
    }
    await sleep(delayMs);
  }
  return !(await isRuntimeHealthy(url));
}

async function terminateDetachedRuntime(params: {
  reason: string;
  url: string;
  sandboxRoot: string;
}) {
  const persisted = readPersistedRuntimeProcessState();
  const pid = persisted?.pid ?? null;
  if (pid !== null) {
    await killRuntimeProcessByPid(pid);
  }
  let stopped = await waitForRuntimeShutdown(params.url, 10, 150);
  if (!stopped) {
    killRuntimePortListener(runtimeApiPort());
    stopped = await waitForRuntimeShutdown(params.url, 20, 150);
  }

  appendRuntimeEventLog({
    category: "runtime",
    event: "embedded_runtime.detached_cleanup",
    outcome: stopped ? "success" : "error",
    detail: `reason=${params.reason} launch_id=${persisted?.launchId ?? "unknown"} pid=${pid ?? "null"} sandbox_root=${persisted?.sandboxRoot ?? params.sandboxRoot}`,
  });

  if (stopped) {
    persistRuntimeProcessState({
      pid: null,
      status: "stopped",
      lastStoppedAt: utcNowIso(),
      lastError: "",
    });
  }

  return {
    stopped,
    persisted,
  };
}

async function ensureRuntimePortAvailable(params: {
  url: string;
  sandboxRoot: string;
  reason: string;
}) {
  if (!(await isRuntimeHealthy(params.url))) {
    return "available" as const;
  }

  const persisted = readPersistedRuntimeProcessState();
  if (persistedRuntimeMatchesCurrentLaunch(persisted, params.sandboxRoot)) {
    return "reused" as const;
  }

  const { stopped } = await terminateDetachedRuntime(params);
  return stopped ? ("available" as const) : ("blocked" as const);
}

function runtimeUnavailableStatus(hasBundle: boolean): RuntimeStatus {
  if (runtimeStartupInFlight && hasBundle) {
    return "starting";
  }
  if (runtimeProcess) {
    const currentStatus = runtimeStatus.status;
    if (
      currentStatus === "error" ||
      currentStatus === "missing" ||
      currentStatus === "stopped"
    ) {
      return "starting";
    }
    return currentStatus;
  }
  return hasBundle ? "stopped" : "missing";
}

async function refreshRuntimeStatus() {
  const { runtimeRoot, validationError } = await resolveRuntimeRoot();
  const executablePath = runtimeRoot
    ? await resolveRuntimeExecutablePath(runtimeRoot)
    : null;
  const sandboxRoot = runtimeSandboxRoot();
  const persisted = readPersistedRuntimeProcessState();
  const persistedPid = persistedRuntimeMatchesCurrentLaunch(
    persisted,
    sandboxRoot,
  )
    ? persisted?.pid ?? null
    : null;
  const harness = process.env.HOLABOSS_RUNTIME_HARNESS || "pi";
  const workflowBackend =
    process.env.HOLABOSS_RUNTIME_WORKFLOW_BACKEND || "remote_api";
  const url = runtimeBaseUrl();
  const healthy = await isRuntimeHealthy(url);
  const hasBundle = Boolean(runtimeRoot && executablePath);

  if (healthy) {
    persistRuntimeProcessState({
      pid: runtimeProcess?.pid ?? persistedPid,
      status: "running",
      lastHealthyAt: utcNowIso(),
      lastError: "",
    });
    runtimeStatus = withDesktopBrowserStatus({
      status: "running",
      available: hasBundle,
      runtimeRoot,
      sandboxRoot,
      executablePath,
      url,
      pid: runtimeProcess?.pid ?? persistedPid,
      harness,
      lastError: "",
    });
    emitRuntimeState();
    return runtimeStatus;
  }

  runtimeStatus = withDesktopBrowserStatus({
    ...runtimeStatus,
    available: hasBundle,
    runtimeRoot,
    sandboxRoot,
    executablePath,
    url,
    harness,
    status: runtimeUnavailableStatus(hasBundle),
    lastError:
      hasBundle
        ? runtimeStartupInFlight
          ? ""
          : runtimeStatus.lastError
        : validationError ||
          `Runtime bundle not found. Set HOLABOSS_RUNTIME_ROOT or package ${RUNTIME_BUNDLE_DIR} into app resources.`,
  });
  emitRuntimeState();
  return runtimeStatus;
}

async function stopEmbeddedRuntime() {
  await withRuntimeLifecycleLock(async () => {
    const running = runtimeProcess;
    runtimeProcess = null;
    if (!running) {
      const url = runtimeBaseUrl();
      if (await isRuntimeHealthy(url)) {
        const { stopped } = await terminateDetachedRuntime({
          reason: "quit_without_child_handle",
          url,
          sandboxRoot: runtimeSandboxRoot(),
        });
        const nextStatus = stopped ? "stopped" : "error";
        const nextError = stopped
          ? ""
          : "Runtime is still responding after detached cleanup.";
        runtimeStatus = withDesktopBrowserStatus({
          ...runtimeStatus,
          status: nextStatus,
          pid: null,
          lastError: nextError,
        });
        if (!stopped) {
          persistRuntimeProcessState({
            pid: null,
            status: "error",
            lastStoppedAt: utcNowIso(),
            lastError: nextError,
          });
        }
        emitRuntimeState();
        return;
      }
      if (
        runtimeStatus.status === "running" ||
        runtimeStatus.status === "starting"
      ) {
        runtimeStatus = withDesktopBrowserStatus({
          ...runtimeStatus,
          status: "stopped",
          pid: null,
        });
        persistRuntimeProcessState({
          pid: null,
          status: "stopped",
          lastStoppedAt: utcNowIso(),
          lastError: "",
        });
        emitRuntimeState();
      }
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let forceSettleTimer: NodeJS.Timeout | null = null;
      let sigkillTimer: NodeJS.Timeout | null = null;
      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (forceSettleTimer) {
          clearTimeout(forceSettleTimer);
        }
        if (sigkillTimer) {
          clearTimeout(sigkillTimer);
        }
        running.removeListener("exit", onExit);
        resolve();
      };
      const onExit = () => settle();
      running.once("exit", onExit);

      intentionallyStoppedRuntimeProcesses.add(running);
      if (process.platform === "win32") {
        void killWindowsProcessTree(running.pid).finally(() => {
          forceSettleTimer = setTimeout(() => settle(), 1000);
          forceSettleTimer.unref();
        });
        return;
      }

      sigkillTimer = setTimeout(() => {
        if (running.exitCode === null && running.signalCode === null) {
          try {
            running.kill("SIGKILL");
          } catch {
            settle();
            return;
          }
        }
        forceSettleTimer = setTimeout(() => settle(), 1000);
        forceSettleTimer.unref();
      }, 3000);
      sigkillTimer.unref();
      try {
        const signalSent = running.kill("SIGTERM");
        if (
          !signalSent &&
          (running.exitCode !== null || running.signalCode !== null)
        ) {
          settle();
        }
      } catch {
        settle();
      }
    });
  });
}

async function ensureAppQuitCleanup(): Promise<void> {
  if (appQuitCleanupFinished) {
    return;
  }
  if (!appQuitCleanupPromise) {
    // Block the final Electron quit until embedded services have been torn down.
    appQuitCleanupPromise = Promise.allSettled([
      stopDesktopBrowserService(),
      stopEmbeddedRuntime(),
    ])
      .then(() => {
        appQuitCleanupFinished = true;
      })
      .finally(() => {
        appQuitCleanupPromise = null;
      });
  }
  await appQuitCleanupPromise;
}

async function startEmbeddedRuntime() {
  return withRuntimeLifecycleLock(async () => {
    runtimeStartupInFlight = true;
    try {
      if (runtimeProcess) {
        return refreshRuntimeStatus();
      }

      const { runtimeRoot, validationError } = await resolveRuntimeRoot();
      const executablePath = runtimeRoot
        ? await resolveRuntimeExecutablePath(runtimeRoot)
        : null;
      const sandboxRoot = runtimeSandboxRoot();
      const harness = process.env.HOLABOSS_RUNTIME_HARNESS || "pi";
      const workflowBackend =
        process.env.HOLABOSS_RUNTIME_WORKFLOW_BACKEND || "remote_api";
      const url = runtimeBaseUrl();

      await fs.mkdir(sandboxRoot, { recursive: true });
      await bootstrapRuntimeDatabase();

      const preflightRuntimePort = await ensureRuntimePortAvailable({
        url,
        sandboxRoot,
        reason: "startup_preflight",
      });
      if (preflightRuntimePort === "reused") {
        return refreshRuntimeStatus();
      }
      if (preflightRuntimePort === "blocked") {
        const portCleanupError =
          "A stale runtime is still bound to the profile runtime port. Quit the other desktop instance or kill the orphaned runtime process.";
        runtimeStatus = withDesktopBrowserStatus({
          ...runtimeStatus,
          status: "error",
          available: Boolean(runtimeRoot && executablePath),
          runtimeRoot,
          sandboxRoot,
          executablePath,
          url,
          pid: null,
          harness,
          lastError: portCleanupError,
        });
        persistRuntimeProcessState({
          pid: null,
          status: "error",
          lastError: portCleanupError,
        });
        emitRuntimeState();
        return runtimeStatus;
      }

      runtimeStatus = withDesktopBrowserStatus({
        ...runtimeStatus,
        status: runtimeRoot && executablePath ? "starting" : "missing",
        available: Boolean(runtimeRoot && executablePath),
        runtimeRoot,
        sandboxRoot,
        executablePath,
        url,
        pid: null,
        harness,
        lastError:
          runtimeRoot && executablePath
            ? ""
            : validationError ||
              `Runtime bundle not found. Set HOLABOSS_RUNTIME_ROOT or package ${RUNTIME_BUNDLE_DIR} into app resources.`,
      });
      emitRuntimeState();

      if (!runtimeRoot || !executablePath) {
        persistRuntimeProcessState({
          pid: null,
          status: "missing",
          lastError: runtimeStatus.lastError,
        });
        return runtimeStatus;
      }

      const startupConfigError = embeddedRuntimeStartupConfigError();
      if (startupConfigError) {
        runtimeStatus = withDesktopBrowserStatus({
          ...runtimeStatus,
          status: "error",
          pid: null,
          lastError: startupConfigError,
        });
        persistRuntimeProcessState({
          pid: null,
          status: "error",
          lastError: startupConfigError,
        });
        appendRuntimeEventLog({
          category: "runtime",
          event: "embedded_runtime.config_error",
          outcome: "error",
          detail: startupConfigError,
        });
        void appendRuntimeLog(`[embedded-runtime] ${startupConfigError}\n`);
        emitRuntimeState();
        return runtimeStatus;
      }

      const launchRuntimePort = await ensureRuntimePortAvailable({
        url,
        sandboxRoot,
        reason: "startup_before_spawn",
      });
      if (launchRuntimePort === "reused") {
        return refreshRuntimeStatus();
      }
      if (launchRuntimePort === "blocked") {
        const launchBlockedError =
          "A stale runtime reclaimed the profile runtime port before startup completed.";
        runtimeStatus = withDesktopBrowserStatus({
          ...runtimeStatus,
          status: "error",
          pid: null,
          lastError: launchBlockedError,
        });
        persistRuntimeProcessState({
          pid: null,
          status: "error",
          lastError: launchBlockedError,
        });
        appendRuntimeEventLog({
          category: "runtime",
          event: "embedded_runtime.launch_blocked",
          outcome: "error",
          detail: launchBlockedError,
        });
        emitRuntimeState();
        return runtimeStatus;
      }

      const launchSpec = await resolveRuntimeLaunchSpec(
        runtimeRoot,
        executablePath,
      );
      if (!launchSpec) {
        const launchError = `Runtime bundle is incomplete. Missing ${runtimeBundleNodeRelativePaths(CURRENT_RUNTIME_PLATFORM).join(" or ")} under ${runtimeRoot}. Rebuild or restage ${RUNTIME_BUNDLE_DIR}.`;
        runtimeStatus = withDesktopBrowserStatus({
          ...runtimeStatus,
          status: "error",
          pid: null,
          lastError: launchError,
        });
        persistRuntimeProcessState({
          pid: null,
          status: "error",
          lastError: launchError,
        });
        appendRuntimeEventLog({
          category: "runtime",
          event: "embedded_runtime.launch_error",
          outcome: "error",
          detail: launchError,
        });
        void appendRuntimeLog(`[embedded-runtime] ${launchError}\n`);
        emitRuntimeState();
        return runtimeStatus;
      }

      const child = spawn(launchSpec.command, launchSpec.args, {
        cwd: runtimeRoot,
        env: {
          ...process.env,
          HB_SANDBOX_ROOT: sandboxRoot,
          SANDBOX_AGENT_BIND_HOST: "127.0.0.1",
          SANDBOX_AGENT_BIND_PORT: String(runtimeApiPort()),
          HOLABOSS_EMBEDDED_RUNTIME: "1",
          SANDBOX_AGENT_HARNESS: harness,
          HOLABOSS_RUNTIME_WORKFLOW_BACKEND: workflowBackend,
          HOLABOSS_RUNTIME_DB_PATH: runtimeDatabasePath(),
          PROACTIVE_ENABLE_REMOTE_BRIDGE: "1",
          PROACTIVE_BRIDGE_BASE_URL: runtimeProactiveBridgeBaseUrl(),
          PYTHONDONTWRITEBYTECODE: "1",
          HOLABOSS_AUTH_BASE_URL: AUTH_BASE_URL,
          HOLABOSS_AUTH_COOKIE: authCookieHeader() ?? "",
        },
        stdio: "pipe",
        windowsHide: process.platform === "win32",
      });

      runtimeProcess = child;
      persistRuntimeProcessState({
        pid: child.pid ?? null,
        status: "starting",
        lastStartedAt: utcNowIso(),
        lastError: "",
      });
      appendRuntimeEventLog({
        category: "runtime",
        event: "embedded_runtime.start",
        outcome: "start",
        detail: `pid=${child.pid ?? "null"}`,
      });
      runtimeStatus = withDesktopBrowserStatus({
        ...runtimeStatus,
        status: "starting",
        pid: child.pid ?? null,
      });
      emitRuntimeState();

      child.stdout.on("data", (chunk) => {
        void appendRuntimeLog(String(chunk));
      });
      child.stderr.on("data", (chunk) => {
        void appendRuntimeLog(String(chunk));
      });

      child.once("exit", (code, signal) => {
        const wasIntentional =
          intentionallyStoppedRuntimeProcesses.delete(child);
        if (runtimeProcess === child) {
          runtimeProcess = null;
        }

        void (async () => {
          if (await isRuntimeHealthy(url)) {
            await refreshRuntimeStatus();
            return;
          }

          const cleanExit = wasIntentional || code === 0;
          const nextStatus = cleanExit ? "stopped" : "error";
          const nextError = cleanExit
            ? ""
            : `Runtime exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"}).`;
          runtimeStatus = withDesktopBrowserStatus({
            ...runtimeStatus,
            status: nextStatus,
            pid: null,
            lastError: nextError,
          });
          persistRuntimeProcessState({
            pid: null,
            status: nextStatus,
            lastStoppedAt: utcNowIso(),
            lastError: nextError,
          });
          appendRuntimeEventLog({
            category: "runtime",
            event: "embedded_runtime.exit",
            outcome: cleanExit ? "success" : "error",
            detail: `code=${code ?? "null"} signal=${signal ?? "null"}${wasIntentional ? " intentional=true" : ""}`,
          });
          emitRuntimeState();
        })();
      });

      const healthy = await waitForRuntimeHealth(url);
      if (healthy) {
        runtimeStatus = await refreshRuntimeStatus();
      } else {
        runtimeStatus = withDesktopBrowserStatus({
          ...runtimeStatus,
          status: "error",
          pid: child.pid ?? null,
          lastError:
            "Runtime process started but did not pass health checks. Check runtime.log in the Electron userData directory.",
        });
        persistRuntimeProcessState({
          pid: child.pid ?? null,
          status: "error",
          lastError: runtimeStatus.lastError,
        });
        appendRuntimeEventLog({
          category: "runtime",
          event: "embedded_runtime.healthcheck",
          outcome: "error",
          detail: runtimeStatus.lastError,
        });
      }
      emitRuntimeState();
      return runtimeStatus;
    } catch (error) {
      const startupError =
        error instanceof Error ? error.message : String(error);
      runtimeStatus = withDesktopBrowserStatus({
        ...runtimeStatus,
        status: "error",
        pid: null,
        lastError: startupError,
      });
      persistRuntimeProcessState({
        pid: null,
        status: "error",
        lastError: startupError,
      });
      appendRuntimeEventLog({
        category: "runtime",
        event: "embedded_runtime.start_error",
        outcome: "error",
        detail: startupError,
      });
      void appendRuntimeLog(`[embedded-runtime] ${startupError}\n`);
      emitRuntimeState();
      return runtimeStatus;
    } finally {
      runtimeStartupInFlight = false;
    }
  });
}

function persistFileBookmarks() {
  return writeJsonFile(fileBookmarksPath(), fileBookmarks);
}

function createBrowserState(
  overrides?: Partial<BrowserStatePayload>,
): BrowserStatePayload {
  return {
    id: overrides?.id ?? "",
    url: overrides?.url ?? "",
    title: overrides?.title ?? NEW_TAB_TITLE,
    faviconUrl: overrides?.faviconUrl,
    canGoBack: overrides?.canGoBack ?? false,
    canGoForward: overrides?.canGoForward ?? false,
    loading: overrides?.loading ?? false,
    initialized: overrides?.initialized ?? false,
    error: overrides?.error ?? "",
  };
}

function browserSpaceId(
  value?: string | null,
  fallback: BrowserSpaceId = activeBrowserSpaceId,
): BrowserSpaceId {
  return value === "agent" ? "agent" : value === "user" ? "user" : fallback;
}

function createBrowserTabSpaceState(): BrowserTabSpaceState {
  return {
    tabs: new Map<string, BrowserTabRecord>(),
    activeTabId: "",
  };
}

function emptyBrowserTabCountsPayload(): BrowserTabCountsPayload {
  return {
    user: 0,
    agent: 0,
  };
}

function emptyBrowserTabListPayload(
  space: BrowserSpaceId = activeBrowserSpaceId,
): BrowserTabListPayload {
  return {
    space,
    activeTabId: "",
    tabs: [],
    tabCounts: emptyBrowserTabCountsPayload(),
  };
}

function defaultBrowserWorkspacePersistence(): BrowserWorkspacePersistencePayload {
  return {
    activeTabId: "",
    tabs: [],
    spaces: {
      user: { activeTabId: "", tabs: [] },
      agent: { activeTabId: "", tabs: [] },
    },
    bookmarks: [],
    downloads: [],
    history: [],
  };
}

// ---------------------------------------------------------------------------
// App surface BrowserView management
// ---------------------------------------------------------------------------

function getOrCreateAppSurfaceView(appId: string): BrowserView {
  const existing = appSurfaceViews.get(appId);
  if (existing) {
    return existing;
  }
  const view = new BrowserView({
    webPreferences: {
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  view.setAutoResize({
    width: false,
    height: false,
    horizontal: false,
    vertical: false,
  });
  view.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  appSurfaceViews.set(appId, view);
  return view;
}

async function getAppHttpUrl(
  workspaceId: string,
  appId: string,
): Promise<string | null> {
  try {
    const ports = await requestRuntimeJson<
      Record<string, { http: number; mcp: number }>
    >({
      method: "GET",
      path: "/api/v1/apps/ports",
      params: { workspace_id: workspaceId },
    });
    const appPorts = ports[appId];
    if (!appPorts?.http) {
      return null;
    }
    return `http://localhost:${appPorts.http}`;
  } catch {
    return null;
  }
}

function setAppSurfaceBounds(bounds: BrowserBoundsPayload): void {
  appSurfaceBounds = {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  };
  updateAttachedAppSurfaceView();
}

function updateAttachedAppSurfaceView(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (
    !activeAppSurfaceId ||
    appSurfaceBounds.width <= 0 ||
    appSurfaceBounds.height <= 0
  ) {
    if (attachedAppSurfaceView) {
      mainWindow.removeBrowserView(attachedAppSurfaceView);
      attachedAppSurfaceView = null;
    }
    return;
  }
  const view = appSurfaceViews.get(activeAppSurfaceId);
  if (!view) {
    if (attachedAppSurfaceView) {
      mainWindow.removeBrowserView(attachedAppSurfaceView);
      attachedAppSurfaceView = null;
    }
    return;
  }
  if (attachedAppSurfaceView !== view) {
    if (attachedAppSurfaceView) {
      mainWindow.removeBrowserView(attachedAppSurfaceView);
    }
    reserveMainWindowClosedListenerBudget(1);
    mainWindow.addBrowserView(view);
    attachedAppSurfaceView = view;
  }
  view.setBounds(appSurfaceBounds);
}

async function resolveAppSurfaceUrl(
  workspaceId: string,
  appId: string,
  urlPath?: string,
): Promise<string> {
  const baseUrl = await getAppHttpUrl(workspaceId, appId);
  if (!baseUrl) {
    throw new Error(`Could not resolve HTTP URL for app ${appId}`);
  }
  const normalizedPath = typeof urlPath === "string" ? urlPath.trim() : "";
  if (!normalizedPath) {
    return baseUrl;
  }
  const targetPath = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;
  return `${baseUrl}${targetPath}`;
}

async function navigateAppSurface(
  workspaceId: string,
  appId: string,
  urlPath?: string,
): Promise<void> {
  const baseUrl = await getAppHttpUrl(workspaceId, appId);
  if (!baseUrl) {
    throw new Error(`Could not resolve HTTP URL for app ${appId}`);
  }
  const view = getOrCreateAppSurfaceView(appId);
  const targetUrl = urlPath ? `${baseUrl}${urlPath}` : baseUrl;
  activeAppSurfaceId = appId;
  await view.webContents.loadURL(targetUrl);
  updateAttachedAppSurfaceView();
}

function destroyAppSurfaceView(appId: string): void {
  const view = appSurfaceViews.get(appId);
  if (!view) {
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeBrowserView(view);
  }
  if (attachedAppSurfaceView === view) {
    attachedAppSurfaceView = null;
  }
  try {
    (view.webContents as unknown as { destroy?: () => void }).destroy?.();
  } catch {
    // best effort
  }
  appSurfaceViews.delete(appId);
  if (activeAppSurfaceId === appId) {
    activeAppSurfaceId = null;
  }
}

function hideAppSurface(): void {
  activeAppSurfaceId = null;
  updateAttachedAppSurfaceView();
}

// ---------------------------------------------------------------------------

function browserWorkspaceFromMap(
  workspaceId: string,
): BrowserWorkspaceState | null {
  return browserWorkspaces.get(workspaceId.trim()) ?? null;
}

function activeBrowserWorkspace(): BrowserWorkspaceState | null {
  if (!activeBrowserWorkspaceId) {
    return null;
  }
  return browserWorkspaceFromMap(activeBrowserWorkspaceId);
}

function browserWorkspaceOrEmpty(
  workspaceId?: string | null,
): BrowserWorkspaceState | null {
  const normalizedWorkspaceId =
    typeof workspaceId === "string"
      ? workspaceId.trim()
      : activeBrowserWorkspaceId;
  if (!normalizedWorkspaceId) {
    return null;
  }
  return browserWorkspaceFromMap(normalizedWorkspaceId);
}

function browserTabSpaceState(
  workspace: BrowserWorkspaceState | null | undefined,
  space: BrowserSpaceId,
): BrowserTabSpaceState | null {
  if (!workspace) {
    return null;
  }
  return workspace.spaces[space] ?? null;
}

function browserWorkspaceTabCounts(
  workspace: BrowserWorkspaceState | null | undefined,
): BrowserTabCountsPayload {
  if (!workspace) {
    return emptyBrowserTabCountsPayload();
  }
  return {
    user: workspace.spaces.user.tabs.size,
    agent: workspace.spaces.agent.tabs.size,
  };
}

function serializedBrowserWorkspaceTabs(
  tabSpace: BrowserTabSpaceState,
): BrowserWorkspaceTabPersistencePayload[] {
  return Array.from(tabSpace.tabs.values(), ({ state }) => ({
    id: state.id,
    url: state.url,
    title: state.title,
    faviconUrl: state.faviconUrl,
  }));
}

function serializeBrowserWorkspace(
  workspace: BrowserWorkspaceState,
): BrowserWorkspacePersistencePayload {
  return {
    activeTabId: workspace.spaces.user.activeTabId,
    tabs: serializedBrowserWorkspaceTabs(workspace.spaces.user),
    spaces: {
      user: {
        activeTabId: workspace.spaces.user.activeTabId,
        tabs: serializedBrowserWorkspaceTabs(workspace.spaces.user),
      },
      agent: {
        activeTabId: workspace.spaces.agent.activeTabId,
        tabs: serializedBrowserWorkspaceTabs(workspace.spaces.agent),
      },
    },
    bookmarks: workspace.bookmarks,
    downloads: workspace.downloads,
    history: workspace.history,
  };
}

function persistBrowserWorkspace(workspaceId: string) {
  const workspace = browserWorkspaceFromMap(workspaceId);
  if (!workspace) {
    return Promise.resolve();
  }
  return writeJsonFile(
    browserWorkspaceStatePath(workspace.workspaceId),
    serializeBrowserWorkspace(workspace),
  );
}

function createBrowserWorkspaceState(
  workspaceId: string,
): BrowserWorkspaceState {
  const browserSession = session.fromPartition(
    browserWorkspacePartition(workspaceId),
  );
  const browserIdentity = configureBrowserWorkspaceSession(browserSession);
  return {
    workspaceId,
    partition: browserWorkspacePartition(workspaceId),
    session: browserSession,
    browserIdentity,
    spaces: {
      user: createBrowserTabSpaceState(),
      agent: createBrowserTabSpaceState(),
    },
    bookmarks: [],
    downloads: [],
    history: [],
    downloadTrackingRegistered: false,
    pendingDownloadOverrides: [],
  };
}

const TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".markdown",
  ".json",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".env",
  ".sh",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".swift",
  ".php",
  ".sql",
  ".log",
]);

const TABLE_FILE_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);

const IMAGE_FILE_MIME_TYPES = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".bmp", "image/bmp"],
]);

const PDF_FILE_MIME_TYPES = new Map<string, string>([
  [".pdf", "application/pdf"],
]);

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024 * 2;
const MAX_IMAGE_PREVIEW_BYTES = 1024 * 1024 * 12;
const MAX_TABLE_PREVIEW_BYTES = 1024 * 1024 * 8;
const MAX_TABLE_PREVIEW_ROWS = 250;
const MAX_TABLE_PREVIEW_COLUMNS = 60;
const MAX_TABLE_PREVIEW_SHEETS = 8;

function toPreviewTableCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  return String(value);
}

function trimTrailingEmptyTableCells(row: string[]): string[] {
  let lastNonEmptyIndex = row.length - 1;
  while (lastNonEmptyIndex >= 0 && row[lastNonEmptyIndex] === "") {
    lastNonEmptyIndex -= 1;
  }
  return row.slice(0, lastNonEmptyIndex + 1);
}

function worksheetPreviewRows(worksheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      values[columnNumber - 1] = toPreviewTableCellValue(cell.text);
    });
    rows.push(trimTrailingEmptyTableCells(values));
  });
  return rows;
}

function tablePreviewSheetFromRows(
  sheetName: string,
  sheetIndex: number,
  rawRows: string[][],
  totalSheetCount: number,
): FilePreviewTableSheetPayload {
  const totalColumns = rawRows.reduce(
    (max, row) => Math.max(max, row.length),
    0,
  );
  const visibleColumnCount = Math.min(
    Math.max(totalColumns, 1),
    MAX_TABLE_PREVIEW_COLUMNS,
  );
  const paddedRows = rawRows.map((row) =>
    Array.from(
      { length: visibleColumnCount },
      (_unused, columnIndex) => row[columnIndex] ?? "",
    ),
  );
  const hasHeaderRow =
    paddedRows.length > 0 &&
    paddedRows[0].some((cell) => cell.trim().length > 0);
  const columns = hasHeaderRow
    ? paddedRows[0].map(
        (value, columnIndex) => value.trim() || `Column ${columnIndex + 1}`,
      )
    : Array.from(
        { length: visibleColumnCount },
        (_unused, columnIndex) => `Column ${columnIndex + 1}`,
      );
  const allRows = hasHeaderRow ? paddedRows.slice(1) : paddedRows;
  const rows = allRows.slice(0, MAX_TABLE_PREVIEW_ROWS);
  const truncated =
    allRows.length > rows.length ||
    totalColumns > visibleColumnCount ||
    totalSheetCount > MAX_TABLE_PREVIEW_SHEETS;

  return {
    name: sheetName || `Sheet ${sheetIndex + 1}`,
    index: sheetIndex,
    columns,
    rows,
    totalRows: allRows.length,
    totalColumns,
    truncated,
    hasHeaderRow,
  };
}

function normalizeWritableTableString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function normalizeWritableTableSheets(
  value: unknown,
): FilePreviewTableSheetPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((sheet, sheetIndex) => {
      if (!sheet || typeof sheet !== "object") {
        return null;
      }

      const candidate = sheet as Partial<FilePreviewTableSheetPayload>;
      const columns = Array.isArray(candidate.columns)
        ? candidate.columns.map((column) =>
            normalizeWritableTableString(column),
          )
        : [];
      const rows = Array.isArray(candidate.rows)
        ? candidate.rows.map((row) =>
            Array.isArray(row)
              ? row.map((cell) => normalizeWritableTableString(cell))
              : [],
          )
        : [];
      const normalizedName =
        typeof candidate.name === "string" && candidate.name.trim()
          ? candidate.name.trim()
          : `Sheet ${sheetIndex + 1}`;

      return {
        name: normalizedName,
        index:
          typeof candidate.index === "number" &&
          Number.isFinite(candidate.index)
            ? candidate.index
            : sheetIndex,
        columns,
        rows,
        totalRows:
          typeof candidate.totalRows === "number" &&
          Number.isFinite(candidate.totalRows)
            ? candidate.totalRows
            : rows.length,
        totalColumns:
          typeof candidate.totalColumns === "number" &&
          Number.isFinite(candidate.totalColumns)
            ? candidate.totalColumns
            : columns.length,
        truncated: Boolean(candidate.truncated),
        hasHeaderRow: candidate.hasHeaderRow !== false,
      } satisfies FilePreviewTableSheetPayload;
    })
    .filter((sheet): sheet is FilePreviewTableSheetPayload => sheet !== null);
}

function sourceRowsFromTablePreviewSheet(
  sheet: FilePreviewTableSheetPayload,
): string[][] {
  const visibleColumnCount = Math.max(sheet.columns.length, 1);
  const sourceRows = sheet.hasHeaderRow
    ? [sheet.columns, ...sheet.rows]
    : sheet.rows;
  return sourceRows.map((row) =>
    Array.from(
      { length: visibleColumnCount },
      (_unused, columnIndex) => row[columnIndex] ?? "",
    ),
  );
}

function applyPreviewSheetEditsToWorksheet(
  worksheet: ExcelJS.Worksheet,
  sheet: FilePreviewTableSheetPayload,
) {
  const sourceRows = sourceRowsFromTablePreviewSheet(sheet);
  for (const [rowIndex, row] of sourceRows.entries()) {
    const worksheetRow = worksheet.getRow(rowIndex + 1);
    for (const [columnIndex, value] of row.entries()) {
      worksheetRow.getCell(columnIndex + 1).value = value;
    }
    worksheetRow.commit();
  }
}

async function writeCsvTablePreview(
  absolutePath: string,
  sheet: FilePreviewTableSheetPayload,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheet.name || "Sheet 1");
  const sourceRows = sourceRowsFromTablePreviewSheet(sheet);
  if (sourceRows.length > 0) {
    worksheet.addRows(sourceRows);
  }
  const outputBuffer = await workbook.csv.writeBuffer({
    sheetName: worksheet.name,
    formatterOptions: {
      delimiter: ",",
      quote: '"',
      escape: '"',
      rowDelimiter: "\r\n",
    },
  });
  await fs.writeFile(absolutePath, Buffer.from(outputBuffer as ArrayBuffer));
}

async function writeWorkbookTablePreview(
  absolutePath: string,
  buffer: Buffer,
  tableSheets: FilePreviewTableSheetPayload[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0],
  );

  for (const sheet of tableSheets) {
    const worksheet = workbook.worksheets[sheet.index];
    if (!worksheet) {
      continue;
    }
    applyPreviewSheetEditsToWorksheet(worksheet, sheet);
  }

  const outputBuffer = await workbook.xlsx.writeBuffer();
  await fs.writeFile(absolutePath, Buffer.from(outputBuffer as ArrayBuffer));
}

async function buildWorkbookPreviewSheets(
  buffer: Buffer,
): Promise<FilePreviewTableSheetPayload[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0],
  );

  const worksheets = workbook.worksheets.slice(0, MAX_TABLE_PREVIEW_SHEETS);
  return worksheets.map((worksheet, sheetIndex) =>
    tablePreviewSheetFromRows(
      worksheet.name,
      sheetIndex,
      worksheetPreviewRows(worksheet),
      workbook.worksheets.length,
    ),
  );
}

async function buildCsvPreviewSheets(
  buffer: Buffer,
): Promise<FilePreviewTableSheetPayload[]> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = await workbook.csv.read(
    Readable.from([buffer.toString("utf8")]),
    {
      parserOptions: {
        delimiter: ",",
        quote: '"',
        escape: '"',
        trim: false,
      },
    },
  );

  return [
    tablePreviewSheetFromRows(
      worksheet.name,
      0,
      worksheetPreviewRows(worksheet),
      1,
    ),
  ];
}

async function buildTablePreviewSheets(
  buffer: Buffer,
  extension: string,
): Promise<FilePreviewTableSheetPayload[]> {
  if (extension === ".csv") {
    return buildCsvPreviewSheets(buffer);
  }
  return buildWorkbookPreviewSheets(buffer);
}

function getFilePreviewKind(targetPath: string) {
  const extension = path.extname(targetPath).toLowerCase();
  if (!extension) {
    return { extension, kind: "text" as const };
  }

  if (TABLE_FILE_EXTENSIONS.has(extension)) {
    return { extension, kind: "table" as const };
  }

  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return { extension, kind: "text" as const };
  }

  const mimeType = IMAGE_FILE_MIME_TYPES.get(extension);
  if (mimeType) {
    return { extension, kind: "image" as const, mimeType };
  }

  const pdfMimeType = PDF_FILE_MIME_TYPES.get(extension);
  if (pdfMimeType) {
    return { extension, kind: "pdf" as const, mimeType: pdfMimeType };
  }

  return { extension, kind: "unsupported" as const };
}

async function readFilePreview(
  targetPath: string,
  workspaceId?: string | null,
): Promise<FilePreviewPayload> {
  const { absolutePath } = await resolveWorkspaceScopedExplorerPath(
    targetPath,
    workspaceId,
  );
  const stat = await fs.stat(absolutePath);

  if (stat.isDirectory()) {
    throw new Error("Target path is a directory.");
  }

  const { extension, kind, mimeType } = getFilePreviewKind(absolutePath);
  const basePayload: FilePreviewPayload = {
    absolutePath,
    name: path.basename(absolutePath),
    extension,
    kind,
    mimeType,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    isEditable: kind === "text",
  };

  if (kind === "table") {
    if (stat.size > MAX_TABLE_PREVIEW_BYTES) {
      return {
        ...basePayload,
        kind: "unsupported",
        isEditable: false,
        unsupportedReason: "Spreadsheet is too large to preview inline.",
      };
    }

    try {
      const buffer = await fs.readFile(absolutePath);
      const tableSheets = await buildTablePreviewSheets(buffer, extension);
      if (tableSheets.length === 0) {
        return {
          ...basePayload,
          kind: "unsupported",
          isEditable: false,
          unsupportedReason: "No sheet data could be extracted from this file.",
        };
      }

      return {
        ...basePayload,
        kind: "table",
        isEditable:
          extension !== ".xls" &&
          tableSheets.every((sheet) => !sheet.truncated),
        tableSheets,
      };
    } catch {
      return {
        ...basePayload,
        kind: "unsupported",
        isEditable: false,
        unsupportedReason:
          "Spreadsheet could not be parsed for inline preview.",
      };
    }
  }

  if (kind === "text") {
    if (stat.size > MAX_TEXT_PREVIEW_BYTES) {
      return {
        ...basePayload,
        kind: "unsupported",
        isEditable: false,
        unsupportedReason: "Text file is too large to preview inline.",
      };
    }

    return {
      ...basePayload,
      content: await fs.readFile(absolutePath, "utf-8"),
    };
  }

  if (kind === "image") {
    if (stat.size > MAX_IMAGE_PREVIEW_BYTES) {
      return {
        ...basePayload,
        kind: "unsupported",
        isEditable: false,
        unsupportedReason: "Image is too large to preview inline.",
      };
    }

    const buffer = await fs.readFile(absolutePath);
    return {
      ...basePayload,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    };
  }

  if (kind === "pdf") {
    const buffer = await fs.readFile(absolutePath);
    return {
      ...basePayload,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    };
  }

  return {
    ...basePayload,
    unsupportedReason: "Preview is not available for this file type yet.",
  };
}

async function writeTextFile(
  targetPath: string,
  content: string,
  workspaceId?: string | null,
): Promise<FilePreviewPayload> {
  const { absolutePath } = await resolveWorkspaceScopedExplorerPath(
    targetPath,
    workspaceId,
  );
  await fs.writeFile(absolutePath, content, "utf-8");
  return readFilePreview(absolutePath, workspaceId);
}

async function writeTableFile(
  targetPath: string,
  tableSheets: unknown,
  workspaceId?: string | null,
): Promise<FilePreviewPayload> {
  const { absolutePath } = await resolveWorkspaceScopedExplorerPath(
    targetPath,
    workspaceId,
  );
  const stat = await fs.stat(absolutePath);
  if (stat.isDirectory()) {
    throw new Error("Target path is a directory.");
  }

  const { extension, kind } = getFilePreviewKind(absolutePath);
  if (kind !== "table") {
    throw new Error("Target file is not a spreadsheet preview.");
  }
  if (extension === ".xls") {
    throw new Error("Legacy .xls files are preview-only in the inline editor.");
  }

  const normalizedTableSheets = normalizeWritableTableSheets(tableSheets);
  if (normalizedTableSheets.length === 0) {
    throw new Error(
      "Spreadsheet preview did not include any editable sheet data.",
    );
  }
  if (normalizedTableSheets.some((sheet) => sheet.truncated)) {
    throw new Error("Spreadsheet is too large to edit inline.");
  }

  if (extension === ".csv") {
    await writeCsvTablePreview(absolutePath, normalizedTableSheets[0]);
    return readFilePreview(absolutePath, workspaceId);
  }

  const buffer = await fs.readFile(absolutePath);
  await writeWorkbookTablePreview(absolutePath, buffer, normalizedTableSheets);
  return readFilePreview(absolutePath, workspaceId);
}

async function watchFilePreviewPath(
  targetPath: string,
  workspaceId?: string | null,
): Promise<FilePreviewWatchSubscriptionPayload> {
  const { absolutePath } = await resolveWorkspaceScopedExplorerPath(
    targetPath,
    workspaceId,
  );
  const watchedDirectoryPath = path.dirname(absolutePath);
  const watchedFileName = path.basename(absolutePath);
  const subscriptionId = `file-preview-watch:${randomUUID()}`;
  const watcher = watch(
    watchedDirectoryPath,
    { persistent: false },
    (_eventType, filename) => {
      const normalizedFilename =
        typeof filename === "string"
          ? filename
          : filename == null
            ? ""
            : String(filename);
      if (normalizedFilename && normalizedFilename !== watchedFileName) {
        return;
      }
      emitFilePreviewChanged({ absolutePath });
    },
  );

  filePreviewWatchSubscriptions.set(subscriptionId, {
    absolutePath,
    watcher,
  });
  watcher.on("error", () => {
    closeFilePreviewWatchSubscription(subscriptionId);
    emitFilePreviewChanged({ absolutePath });
  });

  return {
    subscriptionId,
    absolutePath,
  };
}

function isPathWithinRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function shouldAutoRenameBookmarkLabel(
  bookmark: FileBookmarkPayload,
  previousTargetPath: string,
): boolean {
  return (
    bookmark.label === path.basename(previousTargetPath) ||
    bookmark.label === previousTargetPath
  );
}

function isSameOrDescendantPath(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function persistUpdatedFileBookmarks(
  nextBookmarks: FileBookmarkPayload[],
): Promise<void> {
  if (nextBookmarks === fileBookmarks) {
    return;
  }
  fileBookmarks = nextBookmarks;
  emitFileBookmarksState();
  await persistFileBookmarks();
}

async function resolveWorkspaceScopedExplorerPath(
  targetPath?: string | null,
  workspaceId?: string | null,
): Promise<{ absolutePath: string; workspaceRoot: string | null }> {
  const normalizedWorkspaceId =
    typeof workspaceId === "string" ? workspaceId.trim() : "";
  const trimmedTargetPath =
    typeof targetPath === "string" ? targetPath.trim() : "";

  if (!normalizedWorkspaceId) {
    const fallbackPath = trimmedTargetPath || runtimeSandboxRoot();
    return {
      absolutePath: path.resolve(fallbackPath),
      workspaceRoot: null,
    };
  }

  const workspaceRoot = path.resolve(
    await workspaceDirectoryPath(normalizedWorkspaceId),
  );
  const resolvedTargetPath = trimmedTargetPath
    ? path.resolve(
        path.isAbsolute(trimmedTargetPath)
          ? trimmedTargetPath
          : path.join(workspaceRoot, trimmedTargetPath),
      )
    : workspaceRoot;

  if (!isPathWithinRoot(workspaceRoot, resolvedTargetPath)) {
    throw new Error(`Target path escapes workspace root: ${trimmedTargetPath}`);
  }

  return {
    absolutePath: resolvedTargetPath,
    workspaceRoot,
  };
}

async function ensureExplorerPathDoesNotExist(
  targetPath: string,
): Promise<void> {
  if (await fileExists(targetPath)) {
    const targetName = path.basename(targetPath) || targetPath;
    throw new Error(`A file or folder named "${targetName}" already exists.`);
  }
}

async function rewriteExplorerBookmarksAfterPathChange(
  previousAbsolutePath: string,
  nextAbsolutePath: string,
): Promise<void> {
  let didRewriteBookmarks = false;
  const nextBookmarks = fileBookmarks.map((bookmark) => {
    if (!isSameOrDescendantPath(previousAbsolutePath, bookmark.targetPath)) {
      return bookmark;
    }

    const relativePath = path.relative(
      previousAbsolutePath,
      bookmark.targetPath,
    );
    const rewrittenTargetPath = relativePath
      ? path.join(nextAbsolutePath, relativePath)
      : nextAbsolutePath;
    const rewrittenLabel =
      relativePath === "" &&
      shouldAutoRenameBookmarkLabel(bookmark, previousAbsolutePath)
        ? path.basename(nextAbsolutePath)
        : bookmark.label === bookmark.targetPath
          ? rewrittenTargetPath
          : bookmark.label;

    if (
      rewrittenTargetPath === bookmark.targetPath &&
      rewrittenLabel === bookmark.label
    ) {
      return bookmark;
    }

    didRewriteBookmarks = true;
    return {
      ...bookmark,
      targetPath: rewrittenTargetPath,
      label: rewrittenLabel,
    };
  });

  if (didRewriteBookmarks) {
    await persistUpdatedFileBookmarks(nextBookmarks);
  }
}

function numberedExplorerCreateName(baseName: string, attempt: number): string {
  if (attempt <= 1) {
    return baseName;
  }
  const extension = path.extname(baseName);
  const stem = extension ? baseName.slice(0, -extension.length) : baseName;
  return `${stem} ${attempt}${extension}`;
}

async function nextAvailableExplorerCreatePath(
  parentPath: string,
  baseName: string,
): Promise<string> {
  for (let attempt = 1; attempt < 10_000; attempt += 1) {
    const candidatePath = path.join(
      parentPath,
      numberedExplorerCreateName(baseName, attempt),
    );
    if (!(await fileExists(candidatePath))) {
      return candidatePath;
    }
  }

  throw new Error(`Failed to choose an available name for "${baseName}".`);
}

async function createExplorerPath(
  parentPath: string | null | undefined,
  kind: FileSystemCreateKind,
  workspaceId?: string | null,
): Promise<FileSystemMutationPayload> {
  const { absolutePath: parentAbsolutePath, workspaceRoot } =
    await resolveWorkspaceScopedExplorerPath(parentPath, workspaceId);
  const parentStat = await fs.stat(parentAbsolutePath);
  if (!parentStat.isDirectory()) {
    throw new Error("Target path is not a directory.");
  }

  const nextAbsolutePath = await nextAvailableExplorerCreatePath(
    parentAbsolutePath,
    kind === "directory" ? "New Folder" : "Untitled.txt",
  );
  if (workspaceRoot && !isPathWithinRoot(workspaceRoot, nextAbsolutePath)) {
    throw new Error("Created path escapes workspace root.");
  }

  if (kind === "directory") {
    await fs.mkdir(nextAbsolutePath);
  } else {
    await fs.writeFile(nextAbsolutePath, "", { flag: "wx" });
  }

  return {
    absolutePath: nextAbsolutePath,
  };
}

function normalizeExplorerImportRelativePath(relativePath: string) {
  const normalized = relativePath
    .trim()
    .replace(/[\\/]+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    throw new Error("Imported path cannot be empty.");
  }

  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\"),
    )
  ) {
    throw new Error(`Imported path is invalid: ${relativePath}`);
  }

  return segments.join("/");
}

function normalizeExplorerImportEntries(
  entries: unknown,
): ExplorerExternalImportEntryPayload[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("No files or folders were dropped.");
  }

  const normalizedEntries: ExplorerExternalImportEntryPayload[] = [];
  const seenRelativePaths = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Dropped content could not be parsed.");
    }

    const kind = "kind" in entry ? entry.kind : "";
    const relativePath =
      "relativePath" in entry && typeof entry.relativePath === "string"
        ? normalizeExplorerImportRelativePath(entry.relativePath)
        : "";
    if (!relativePath) {
      throw new Error("Dropped content is missing a relative path.");
    }
    if (seenRelativePaths.has(relativePath)) {
      continue;
    }
    seenRelativePaths.add(relativePath);

    if (kind === "directory") {
      normalizedEntries.push({
        kind: "directory",
        relativePath,
      });
      continue;
    }

    if (kind !== "file") {
      throw new Error(`Unsupported dropped item kind: ${String(kind)}`);
    }

    const contentValue = "content" in entry ? entry.content : null;
    const content =
      contentValue instanceof Uint8Array
        ? contentValue
        : contentValue instanceof ArrayBuffer
          ? new Uint8Array(contentValue)
          : ArrayBuffer.isView(contentValue)
            ? new Uint8Array(
                contentValue.buffer.slice(
                  contentValue.byteOffset,
                  contentValue.byteOffset + contentValue.byteLength,
                ),
              )
            : Array.isArray(contentValue)
              ? Uint8Array.from(contentValue)
              : null;
    if (!content) {
      throw new Error(`Dropped file content is invalid: ${relativePath}`);
    }

    normalizedEntries.push({
      kind: "file",
      relativePath,
      content,
    });
  }

  return normalizedEntries;
}

function importedEntryDepth(relativePath: string) {
  return normalizeExplorerImportRelativePath(relativePath).split("/").length;
}

function resolveImportedEntryAbsolutePath(
  rootPathMap: Map<string, string>,
  relativePath: string,
) {
  const segments = normalizeExplorerImportRelativePath(relativePath).split("/");
  const rootAbsolutePath = rootPathMap.get(segments[0]);
  if (!rootAbsolutePath) {
    throw new Error(`Missing import root for ${relativePath}`);
  }

  if (segments.length === 1) {
    return rootAbsolutePath;
  }

  return path.join(rootAbsolutePath, ...segments.slice(1));
}

async function importExternalExplorerEntries(
  destinationDirectoryPath: string,
  entries: unknown,
  workspaceId?: string | null,
): Promise<ExplorerExternalImportResultPayload> {
  const normalizedEntries = normalizeExplorerImportEntries(entries);
  const { absolutePath: destinationAbsolutePath, workspaceRoot } =
    await resolveWorkspaceScopedExplorerPath(
      destinationDirectoryPath,
      workspaceId,
    );
  const destinationStat = await fs.stat(destinationAbsolutePath);
  if (!destinationStat.isDirectory()) {
    throw new Error("Destination is not a directory.");
  }

  const rootNames: string[] = [];
  for (const entry of normalizedEntries) {
    const [rootName = ""] = normalizeExplorerImportRelativePath(
      entry.relativePath,
    ).split("/");
    if (rootName && !rootNames.includes(rootName)) {
      rootNames.push(rootName);
    }
  }

  const rootPathMap = new Map<string, string>();
  for (const rootName of rootNames) {
    const nextRootAbsolutePath = await nextAvailableExplorerCreatePath(
      destinationAbsolutePath,
      rootName,
    );
    if (workspaceRoot && !isPathWithinRoot(workspaceRoot, nextRootAbsolutePath)) {
      throw new Error("Imported path escapes workspace root.");
    }
    rootPathMap.set(rootName, nextRootAbsolutePath);
  }

  const directoryEntries = normalizedEntries
    .filter(
      (
        entry,
      ): entry is Extract<ExplorerExternalImportEntryPayload, { kind: "directory" }> =>
        entry.kind === "directory",
    )
    .sort((left, right) => importedEntryDepth(left.relativePath) - importedEntryDepth(right.relativePath));
  for (const directoryEntry of directoryEntries) {
    const absolutePath = resolveImportedEntryAbsolutePath(
      rootPathMap,
      directoryEntry.relativePath,
    );
    if (workspaceRoot && !isPathWithinRoot(workspaceRoot, absolutePath)) {
      throw new Error("Imported path escapes workspace root.");
    }
    await fs.mkdir(absolutePath, { recursive: true });
  }

  const fileEntries = normalizedEntries
    .filter(
      (
        entry,
      ): entry is Extract<ExplorerExternalImportEntryPayload, { kind: "file" }> =>
        entry.kind === "file",
    )
    .sort((left, right) => importedEntryDepth(left.relativePath) - importedEntryDepth(right.relativePath));
  for (const fileEntry of fileEntries) {
    const absolutePath = resolveImportedEntryAbsolutePath(
      rootPathMap,
      fileEntry.relativePath,
    );
    if (workspaceRoot && !isPathWithinRoot(workspaceRoot, absolutePath)) {
      throw new Error("Imported path escapes workspace root.");
    }
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from(fileEntry.content));
  }

  return {
    absolutePaths: rootNames
      .map((rootName) => rootPathMap.get(rootName) ?? "")
      .filter(Boolean),
  };
}

async function renameExplorerPath(
  targetPath: string,
  nextName: string,
  workspaceId?: string | null,
): Promise<FileSystemMutationPayload> {
  const trimmedName = nextName.trim();
  if (!trimmedName) {
    throw new Error("Name cannot be empty.");
  }
  if (
    trimmedName === "." ||
    trimmedName === ".." ||
    trimmedName.includes("/") ||
    trimmedName.includes("\\")
  ) {
    throw new Error("Name must not contain path separators.");
  }

  const { absolutePath, workspaceRoot } =
    await resolveWorkspaceScopedExplorerPath(targetPath, workspaceId);

  if (
    workspaceRoot &&
    path.normalize(absolutePath) === path.normalize(workspaceRoot)
  ) {
    throw new Error("Workspace root cannot be renamed.");
  }

  const nextAbsolutePath = path.join(path.dirname(absolutePath), trimmedName);
  if (path.normalize(nextAbsolutePath) === path.normalize(absolutePath)) {
    return { absolutePath };
  }

  if (workspaceRoot && !isPathWithinRoot(workspaceRoot, nextAbsolutePath)) {
    throw new Error("Renamed path escapes workspace root.");
  }
  await ensureExplorerPathDoesNotExist(nextAbsolutePath);

  await fs.rename(absolutePath, nextAbsolutePath);
  await rewriteExplorerBookmarksAfterPathChange(absolutePath, nextAbsolutePath);

  return {
    absolutePath: nextAbsolutePath,
  };
}

async function moveExplorerPath(
  sourcePath: string,
  destinationDirectoryPath: string,
  workspaceId?: string | null,
): Promise<FileSystemMutationPayload> {
  const { absolutePath: sourceAbsolutePath, workspaceRoot } =
    await resolveWorkspaceScopedExplorerPath(sourcePath, workspaceId);
  const { absolutePath: destinationAbsolutePath } =
    await resolveWorkspaceScopedExplorerPath(
      destinationDirectoryPath,
      workspaceId,
    );

  if (
    workspaceRoot &&
    path.normalize(sourceAbsolutePath) === path.normalize(workspaceRoot)
  ) {
    throw new Error("Workspace root cannot be moved.");
  }

  const sourceStat = await fs.stat(sourceAbsolutePath);
  const destinationStat = await fs.stat(destinationAbsolutePath);
  if (!destinationStat.isDirectory()) {
    throw new Error("Destination is not a directory.");
  }
  if (
    sourceStat.isDirectory() &&
    isSameOrDescendantPath(sourceAbsolutePath, destinationAbsolutePath)
  ) {
    throw new Error("Cannot move a folder into itself.");
  }

  const nextAbsolutePath = path.join(
    destinationAbsolutePath,
    path.basename(sourceAbsolutePath),
  );
  if (path.normalize(nextAbsolutePath) === path.normalize(sourceAbsolutePath)) {
    return {
      absolutePath: sourceAbsolutePath,
    };
  }
  if (workspaceRoot && !isPathWithinRoot(workspaceRoot, nextAbsolutePath)) {
    throw new Error("Moved path escapes workspace root.");
  }

  await ensureExplorerPathDoesNotExist(nextAbsolutePath);
  await fs.rename(sourceAbsolutePath, nextAbsolutePath);
  await rewriteExplorerBookmarksAfterPathChange(
    sourceAbsolutePath,
    nextAbsolutePath,
  );

  return {
    absolutePath: nextAbsolutePath,
  };
}

async function deleteExplorerPath(
  targetPath: string,
  workspaceId?: string | null,
): Promise<{ deleted: boolean }> {
  const { absolutePath, workspaceRoot } =
    await resolveWorkspaceScopedExplorerPath(targetPath, workspaceId);

  if (
    workspaceRoot &&
    path.normalize(absolutePath) === path.normalize(workspaceRoot)
  ) {
    throw new Error("Workspace root cannot be deleted.");
  }

  const stat = await fs.stat(absolutePath);
  if (stat.isDirectory()) {
    await fs.rm(absolutePath, { recursive: true, force: false });
  } else {
    await fs.unlink(absolutePath);
  }

  const nextBookmarks = fileBookmarks.filter(
    (bookmark) => !isSameOrDescendantPath(absolutePath, bookmark.targetPath),
  );
  if (nextBookmarks.length !== fileBookmarks.length) {
    await persistUpdatedFileBookmarks(nextBookmarks);
  }

  return { deleted: true };
}

async function listDirectory(
  targetPath?: string | null,
  workspaceId?: string | null,
): Promise<DirectoryPayload> {
  const { absolutePath: resolvedPath, workspaceRoot } =
    await resolveWorkspaceScopedExplorerPath(targetPath, workspaceId);
  await fs.mkdir(resolvedPath, { recursive: true });
  const stat = await fs.stat(resolvedPath);

  if (!stat.isDirectory()) {
    throw new Error("Target path is not a directory.");
  }

  const normalizedCurrent = path.normalize(resolvedPath);
  const normalizedRoot = path.normalize(
    workspaceRoot ? workspaceRoot : path.parse(resolvedPath).root,
  );
  const hideWorkspaceManagedRootEntries = normalizedCurrent === normalizedRoot;
  const dirEntries = await fs.readdir(resolvedPath, { withFileTypes: true });
  const entries: DirectoryEntryPayload[] = [];

  for (const dirEntry of dirEntries) {
    if (dirEntry.name.startsWith(".")) {
      continue;
    }
    if (
      hideWorkspaceManagedRootEntries &&
      ((dirEntry.isDirectory() && dirEntry.name === "apps") ||
        (!dirEntry.isDirectory() && dirEntry.name === "workspace.yaml"))
    ) {
      continue;
    }
    const absolutePath = path.join(resolvedPath, dirEntry.name);
    try {
      const meta = await fs.stat(absolutePath);
      entries.push({
        name: dirEntry.name,
        absolutePath,
        isDirectory: meta.isDirectory(),
        size: meta.isDirectory() ? 0 : meta.size,
        modifiedAt: meta.mtime.toISOString(),
      });
    } catch {
      continue;
    }
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  const parentPath =
    normalizedCurrent === normalizedRoot
      ? null
      : path.dirname(normalizedCurrent);

  return {
    currentPath: normalizedCurrent,
    parentPath,
    entries,
  };
}

function emitFileBookmarksState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("fs:bookmarks", fileBookmarks);
}

function emitFilePreviewChanged(payload: FilePreviewChangePayload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("fs:fileChanged", payload);
}

function closeFilePreviewWatchSubscription(subscriptionId: string) {
  const subscription = filePreviewWatchSubscriptions.get(subscriptionId);
  if (!subscription) {
    return;
  }
  filePreviewWatchSubscriptions.delete(subscriptionId);
  try {
    subscription.watcher.close();
  } catch {
    // Ignore watcher shutdown errors during cleanup.
  }
}

function closeAllFilePreviewWatchSubscriptions() {
  for (const subscriptionId of Array.from(
    filePreviewWatchSubscriptions.keys(),
  )) {
    closeFilePreviewWatchSubscription(subscriptionId);
  }
}

function emitAddressSuggestionsState() {
  addressSuggestionsPopupWindow?.webContents.send(
    "addressSuggestions:update",
    addressSuggestionsState,
  );
}

function createAuthPopupHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Account</title>
    <style>
      * { box-sizing: border-box; }
      html,
      body {
        margin: 0;
        height: 100vh;
        background: transparent;
        color: var(--popup-text);
        overflow: hidden;
      }
      @keyframes auth-popup-enter {
        from {
          opacity: 0;
          transform: translateY(-8px) scale(0.975);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      .panel {
        margin: ${AUTH_POPUP_MARGIN_PX}px;
        max-height: calc(100vh - ${AUTH_POPUP_MARGIN_PX * 2}px);
        border-radius: 26px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform-origin: top right;
        will-change: transform, opacity;
      }
      body.popup-opening .panel {
        animation: auth-popup-enter 180ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      @media (prefers-reduced-motion: reduce) {
        body.popup-opening .panel {
          animation: none;
        }
      }
      .profile {
        padding: 18px;
        border-bottom: 1px solid var(--popup-border-soft);
      }
      .profileRow {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .avatar {
        flex: 0 0 auto;
        width: 46px;
        height: 46px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        font-size: 18px;
        font-weight: 600;
      }
      .identityWrap {
        min-width: 0;
        flex: 1 1 auto;
      }
      .identityName {
        font-size: 15px;
        font-weight: 600;
      }
      .identity {
        margin-top: 4px;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .badge {
        flex: 0 0 auto;
        border-radius: 999px;
        padding: 8px 11px;
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      .runtimeLine {
        margin-top: 14px;
        border-radius: 16px;
        border: 1px solid var(--popup-border-soft);
        background: color-mix(in srgb, var(--popup-control-bg) 68%, transparent);
        padding: 12px 14px;
      }
      .runtimeLabel {
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--popup-text-subtle);
      }
      .runtimeValue {
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--popup-text);
      }
      .content {
        flex: 1 1 auto;
        min-height: 0;
        display: grid;
        gap: 12px;
        overflow-y: auto;
        padding: 12px;
      }
      .button {
        width: 100%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border-radius: 16px;
        border: 1px solid var(--popup-border-soft);
        padding: 12px 14px;
        font-size: 12px;
        cursor: pointer;
        transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
      }
      .button:disabled,
      .menuItem:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      .message {
        margin: 0;
        border-radius: 16px;
        border: 1px solid var(--popup-border-soft);
        padding: 12px 14px;
        font-size: 11px;
        line-height: 1.6;
      }
      .menuSection {
        display: grid;
        gap: 6px;
      }
      .menuSection + .menuSection {
        padding-top: 10px;
        border-top: 1px solid var(--popup-border-soft);
      }
      .menuItem {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-radius: 18px;
        border: 1px solid transparent;
        background: transparent;
        padding: 11px 12px;
        text-align: left;
        color: var(--popup-text);
        cursor: pointer;
        transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease;
      }
      .menuItem:hover {
        border-color: var(--popup-border-soft);
        background: color-mix(in srgb, var(--popup-control-bg) 72%, transparent);
      }
      .menuLead {
        min-width: 0;
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .menuIcon {
        width: 36px;
        height: 36px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        border-radius: 12px;
        border: 1px solid var(--popup-border-soft);
        background: color-mix(in srgb, var(--popup-control-bg) 85%, transparent);
        color: var(--popup-text-muted);
      }
      .menuIcon svg {
        width: 17px;
        height: 17px;
        stroke: currentColor;
        fill: none;
        stroke-width: 1.85;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .menuCopy {
        min-width: 0;
        flex: 1 1 auto;
      }
      .menuTitle {
        display: block;
        font-size: 13px;
        font-weight: 600;
      }
      .menuMeta {
        display: block;
        margin-top: 3px;
        font-size: 10px;
        line-height: 1.35;
        color: var(--popup-text-subtle);
      }
      .menuArrow {
        flex: 0 0 auto;
        font-size: 16px;
        color: var(--popup-text-subtle);
      }
      .menuItem:not(.detailed) .menuTitle {
        font-size: 12.5px;
        font-weight: 500;
      }
      .menuItem:not(.detailed) .menuCopy {
        display: flex;
        align-items: center;
      }
      .menuItem.danger {
        color: var(--popup-error);
      }
      .menuItem.danger .menuIcon {
        border-color: color-mix(in srgb, var(--popup-error) 28%, var(--popup-border-soft));
        background: color-mix(in srgb, var(--popup-error) 10%, transparent);
        color: var(--popup-error);
      }
      .menuItem.danger .menuMeta,
      .menuItem.danger .menuArrow {
        color: color-mix(in srgb, var(--popup-error) 70%, var(--popup-text-subtle));
      }
      .menuItem[hidden],
      .button[hidden],
      .message[hidden] {
        display: none !important;
      }
      ${popupThemeCss()}
    </style>
  </head>
  <body>
    <div id="panel" class="panel">
      <div class="profile">
        <div class="profileRow">
          <div id="avatar" class="avatar">H</div>
          <div class="identityWrap">
            <div id="identityName" class="identityName">Holaboss account</div>
            <div id="identity" class="identity">Loading session...</div>
          </div>
          <div id="badge" class="badge idle">Checking</div>
        </div>

        <div class="runtimeLine">
          <div class="runtimeLabel">Desktop status</div>
          <div id="runtimeValue" class="runtimeValue">Checking local runtime connection...</div>
        </div>
      </div>

      <div class="content">
        <button id="signIn" class="button primary" type="button">Sign in with browser</button>
        <div id="notice" class="message success" hidden></div>

        <div class="menuSection">
          <button id="accountAction" class="item menuItem detailed" type="button">
            <span class="menuLead">
              <span class="menuIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M19 21a7 7 0 0 0-14 0"/><circle cx="12" cy="8" r="4"/></svg>
              </span>
              <span class="menuCopy">
                <span class="menuTitle">Account</span>
                <span id="accountMeta" class="menuMeta">Connected</span>
              </span>
            </span>
            <span class="menuArrow">&#8250;</span>
          </button>
          <button id="settingsAction" class="item menuItem" type="button">
            <span class="menuLead">
              <span class="menuIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 7h10"/><path d="M4 17h16"/><path d="M14 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M10 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>
              </span>
              <span class="menuCopy">
                <span class="menuTitle">Settings</span>
              </span>
            </span>
            <span class="menuArrow">&#8250;</span>
          </button>
          <button id="homeAction" class="item menuItem" type="button">
            <span class="menuLead">
              <span class="menuIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M9 20v-6h6v6"/></svg>
              </span>
              <span class="menuCopy">
                <span class="menuTitle">Homepage</span>
              </span>
            </span>
            <span class="menuArrow">&#8250;</span>
          </button>
          <button id="docsAction" class="item menuItem" type="button">
            <span class="menuLead">
              <span class="menuIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M6 4.5h9a3 3 0 0 1 3 3V20l-4-2-4 2-4-2-4 2V7.5a3 3 0 0 1 3-3Z"/></svg>
              </span>
              <span class="menuCopy">
                <span class="menuTitle">Docs</span>
              </span>
            </span>
            <span class="menuArrow">&#8250;</span>
          </button>
          <button id="helpAction" class="item menuItem" type="button">
            <span class="menuLead">
              <span class="menuIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4"/><path d="M12 17h.01"/></svg>
              </span>
              <span class="menuCopy">
                <span class="menuTitle">Get help</span>
              </span>
            </span>
            <span class="menuArrow">&#8250;</span>
          </button>
        </div>

        <div class="menuSection">
          <button id="signOut" class="menuItem danger" type="button">
            <span class="menuLead">
              <span class="menuIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M20 19V5"/></svg>
              </span>
              <span class="menuCopy">
                <span class="menuTitle">Sign out</span>
              </span>
            </span>
            <span class="menuArrow">&#8250;</span>
          </button>
        </div>
      </div>
    </div>
    <script>
      const LINKS = {
        home: ${JSON.stringify(HOLABOSS_HOME_URL)},
        docs: ${JSON.stringify(HOLABOSS_DOCS_URL)},
        help: ${JSON.stringify(HOLABOSS_HELP_URL)}
      };

      const state = {
        user: null,
        runtimeConfig: null,
        runtimeStatus: null,
        isPending: true,
        isStartingSignIn: false,
        isSigningOut: false,
        authError: "",
        authMessage: ""
      };

      const els = {
        panel: document.getElementById("panel"),
        avatar: document.getElementById("avatar"),
        identityName: document.getElementById("identityName"),
        identity: document.getElementById("identity"),
        badge: document.getElementById("badge"),
        runtimeValue: document.getElementById("runtimeValue"),
        notice: document.getElementById("notice"),
        signIn: document.getElementById("signIn"),
        signOut: document.getElementById("signOut"),
        accountAction: document.getElementById("accountAction"),
        accountMeta: document.getElementById("accountMeta"),
        settingsAction: document.getElementById("settingsAction"),
        homeAction: document.getElementById("homeAction"),
        docsAction: document.getElementById("docsAction"),
        helpAction: document.getElementById("helpAction")
      };

      const sessionUserId = (user) => user && typeof user.id === "string" ? user.id : "";
      const sessionEmail = (user) => user && typeof user.email === "string" ? user.email : "";
      const sessionDisplayName = (user) => user && typeof user.name === "string" ? user.name.trim() : "";
      const sessionInitials = (user) => {
        const name = sessionDisplayName(user);
        if (name) {
          const initials = name
            .split(/\\s+/)
            .map((part) => part[0] || "")
            .join("")
            .slice(0, 2)
            .toUpperCase();
          if (initials) {
            return initials;
          }
        }
        const email = sessionEmail(user);
        return (email[0] || "H").toUpperCase();
      };

      const runtimeBindingReady = () => Boolean(state.runtimeConfig?.authTokenPresent)
        && Boolean((state.runtimeConfig?.sandboxId || "").trim())
        && Boolean((state.runtimeConfig?.modelProxyBaseUrl || "").trim());

      const runtimeStatusLabel = (isSignedIn) => {
        if (state.runtimeStatus?.status === "running") {
          return "Runtime connected and running.";
        }
        if (state.runtimeStatus?.status === "starting") {
          return "Runtime is starting.";
        }
        if (state.runtimeStatus?.status === "error") {
          return state.runtimeStatus?.lastError || "Runtime needs attention.";
        }
        if (runtimeBindingReady()) {
          return "Runtime connected and ready.";
        }
        return isSignedIn ? "Finishing runtime setup." : "Sign in to connect desktop features.";
      };

      const restartOpenAnimation = () => {
        document.body.classList.remove("popup-opening");
        void document.body.offsetWidth;
        document.body.classList.add("popup-opening");
      };

      const render = () => {
        const isSignedIn = Boolean(sessionUserId(state.user));
        const hasError = Boolean(state.authError);
        const ready = runtimeBindingReady();
        const badgeTone = hasError ? "error" : ready ? "ready" : isSignedIn ? "syncing" : "idle";
        const badgeLabel = state.isPending ? "Checking" : hasError ? "Needs help" : ready ? "Connected" : isSignedIn ? "Syncing" : "Signed out";
        const noticeText = state.authError || state.authMessage;

        els.avatar.textContent = sessionInitials(state.user);
        els.identityName.textContent = isSignedIn ? (sessionDisplayName(state.user) || "Holaboss account") : "Holaboss account";
        els.identity.textContent = isSignedIn ? (sessionEmail(state.user) || sessionUserId(state.user) || "Signed in") : "Not connected";
        els.badge.className = "badge " + badgeTone;
        els.badge.textContent = badgeLabel;
        els.runtimeValue.textContent = runtimeStatusLabel(isSignedIn);
        els.accountMeta.textContent = isSignedIn ? (ready ? "Connected" : "Syncing setup") : "Sign in required";

        els.signIn.hidden = isSignedIn;
        els.signIn.disabled = state.isStartingSignIn;
        els.signIn.textContent = state.isStartingSignIn ? "Opening sign-in..." : "Connect account";

        els.signOut.hidden = !isSignedIn;
        els.signOut.disabled = state.isSigningOut;
        els.notice.hidden = !noticeText;
        els.notice.className = "message " + (state.authError ? "error" : "success");
        els.notice.textContent = noticeText;
      };

      const closeAndScheduleNothing = () => {
        void window.authPopup.close();
      };

      const refreshSession = async () => {
        state.isPending = true;
        render();
        try {
          state.user = await window.authPopup.getUser();
          state.authError = "";
        } catch (error) {
          state.authError = error instanceof Error ? error.message : "Failed to refresh session.";
        } finally {
          state.isPending = false;
          render();
        }
      };

      const refreshConfig = async () => {
        try {
          state.runtimeConfig = await window.authPopup.getRuntimeConfig();
        } catch (error) {
          state.authError = error instanceof Error ? error.message : "Failed to load runtime config.";
        } finally {
          render();
        }
      };

      const refreshRuntimeStatus = async () => {
        try {
          state.runtimeStatus = await window.authPopup.getRuntimeStatus();
        } catch (error) {
          state.authError = error instanceof Error ? error.message : "Failed to load runtime status.";
        } finally {
          render();
        }
      };

      els.panel?.addEventListener("animationend", () => {
        document.body.classList.remove("popup-opening");
      });

      els.signIn.addEventListener("click", async () => {
        state.isStartingSignIn = true;
        state.authError = "";
        state.authMessage = "";
        render();
        try {
          await window.authPopup.requestAuth();
          state.authMessage = "Sign-in opened in your browser. Finish the flow there to connect this desktop.";
        } catch (error) {
          state.authError = error instanceof Error ? error.message : "Failed to start sign-in.";
        } finally {
          state.isStartingSignIn = false;
          render();
        }
      });

      els.signOut.addEventListener("click", async () => {
        state.isSigningOut = true;
        state.authError = "";
        state.authMessage = "";
        render();
        try {
          await window.authPopup.signOut();
          state.user = null;
          state.runtimeConfig = null;
          state.authMessage = "Signed out from this desktop session.";
        } catch (error) {
          state.authError = error instanceof Error ? error.message : "Failed to sign out.";
        } finally {
          state.isSigningOut = false;
          render();
        }
      });

      els.accountAction.addEventListener("click", async () => {
        await window.authPopup.openSettingsPane("account");
        closeAndScheduleNothing();
      });
      els.settingsAction.addEventListener("click", async () => {
        await window.authPopup.openSettingsPane("settings");
        closeAndScheduleNothing();
      });
      els.homeAction.addEventListener("click", async () => {
        await window.authPopup.openExternalUrl(LINKS.home);
        closeAndScheduleNothing();
      });
      els.docsAction.addEventListener("click", async () => {
        await window.authPopup.openExternalUrl(LINKS.docs);
        closeAndScheduleNothing();
      });
      els.helpAction.addEventListener("click", async () => {
        await window.authPopup.openExternalUrl(LINKS.help);
        closeAndScheduleNothing();
      });

      window.authPopup.onAuthenticated((user) => {
        state.user = user;
        state.isPending = false;
        state.authError = "";
        state.authMessage = "Desktop account connected.";
        void refreshConfig();
        void refreshRuntimeStatus();
        render();
      });

      window.authPopup.onUserUpdated((user) => {
        state.user = user;
        state.isPending = false;
        state.authError = "";
        render();
      });

      window.authPopup.onError((payload) => {
        state.isPending = false;
        state.authError = payload?.message || ((payload?.status || "") + " " + (payload?.statusText || "")).trim() || "Authentication failed.";
        render();
      });

      window.authPopup.onRuntimeConfigChange((config) => {
        state.runtimeConfig = config;
        render();
      });

      window.authPopup.onRuntimeStateChange((runtimeStatus) => {
        state.runtimeStatus = runtimeStatus;
        render();
      });

      window.authPopup.onOpened(() => {
        restartOpenAnimation();
      });

      Promise.all([refreshSession(), refreshConfig(), refreshRuntimeStatus()]).then(() => render());
    </script>
  </body>
</html>`;
}

function shouldTrackHistoryUrl(rawUrl: string) {
  if (!rawUrl) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function recordHistoryVisit(
  workspaceId: string,
  entry: Pick<BrowserHistoryEntryPayload, "url" | "title" | "faviconUrl">,
) {
  const workspace = browserWorkspaceFromMap(workspaceId);
  const url = entry.url.trim();
  if (!workspace || !shouldTrackHistoryUrl(url)) {
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
  await persistBrowserWorkspace(workspaceId);
}

function browserWorkspaceSnapshot(
  workspaceId?: string | null,
  space?: BrowserSpaceId | null,
): BrowserTabListPayload {
  const browserSpace = browserSpaceId(space);
  const workspace = browserWorkspaceOrEmpty(workspaceId);
  if (!workspace) {
    return emptyBrowserTabListPayload(browserSpace);
  }
  const tabSpace = browserTabSpaceState(workspace, browserSpace);
  const tabs = Array.from(tabSpace?.tabs.values() ?? [], ({ state }) => state);
  return {
    space: browserSpace,
    activeTabId: tabSpace?.activeTabId || tabs[0]?.id || "",
    tabs,
    tabCounts: browserWorkspaceTabCounts(workspace),
  };
}

function getActiveBrowserTab(
  workspaceId?: string | null,
  space?: BrowserSpaceId | null,
): BrowserTabRecord | null {
  const browserSpace = browserSpaceId(space);
  const workspace = browserWorkspaceOrEmpty(workspaceId);
  const tabSpace = browserTabSpaceState(workspace, browserSpace);
  if (!tabSpace || !tabSpace.activeTabId) {
    return null;
  }
  return tabSpace.tabs.get(tabSpace.activeTabId) ?? null;
}

function reserveMainWindowClosedListenerBudget(additionalClosedListeners = 0) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  // Electron's deprecated BrowserView compatibility layer adds a fresh
  // BrowserWindow "closed" listener every time a view is attached, and those
  // listeners are not released when the view is detached.
  const desiredBudget = Math.max(
    MAIN_WINDOW_MIN_LISTENER_BUDGET,
    mainWindow.listenerCount("closed") +
      additionalClosedListeners +
      MAIN_WINDOW_CLOSED_LISTENER_BUFFER,
  );
  if (mainWindow.getMaxListeners() < desiredBudget) {
    mainWindow.setMaxListeners(desiredBudget);
  }
}

function applyBoundsToTab(
  workspaceId: string,
  tabId: string,
  space: BrowserSpaceId = activeBrowserSpaceId,
) {
  const workspace = browserWorkspaceFromMap(workspaceId);
  const tab = browserTabSpaceState(workspace, space)?.tabs.get(tabId);
  if (!tab) {
    return;
  }
  tab.view.setBounds(browserBounds);
}

function hasVisibleBrowserBounds() {
  return browserBounds.width > 0 && browserBounds.height > 0;
}

function emitBrowserState(
  workspaceId?: string | null,
  space?: BrowserSpaceId | null,
) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const normalizedWorkspaceId =
    typeof workspaceId === "string"
      ? workspaceId.trim()
      : activeBrowserWorkspaceId;
  const browserSpace = browserSpaceId(space);
  if (normalizedWorkspaceId !== activeBrowserWorkspaceId) {
    return;
  }
  if (browserSpace !== activeBrowserSpaceId) {
    return;
  }
  mainWindow.webContents.send(
    "browser:state",
    browserWorkspaceSnapshot(normalizedWorkspaceId, browserSpace),
  );
}

function emitBookmarksState(workspaceId?: string | null) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const normalizedWorkspaceId =
    typeof workspaceId === "string"
      ? workspaceId.trim()
      : activeBrowserWorkspaceId;
  if (normalizedWorkspaceId !== activeBrowserWorkspaceId) {
    return;
  }
  const workspace = browserWorkspaceOrEmpty(normalizedWorkspaceId);
  mainWindow.webContents.send("browser:bookmarks", workspace?.bookmarks ?? []);
}

function emitDownloadsState(workspaceId?: string | null) {
  const normalizedWorkspaceId =
    typeof workspaceId === "string"
      ? workspaceId.trim()
      : activeBrowserWorkspaceId;
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!downloadsPopupWindow || downloadsPopupWindow.isDestroyed()) {
      return;
    }
  }
  if (normalizedWorkspaceId !== activeBrowserWorkspaceId) {
    return;
  }
  const workspace = browserWorkspaceOrEmpty(normalizedWorkspaceId);
  const downloads = workspace?.downloads ?? [];
  mainWindow?.webContents.send("browser:downloads", downloads);
  downloadsPopupWindow?.webContents.send("downloads:update", downloads);
}

function emitHistoryState(workspaceId?: string | null) {
  const normalizedWorkspaceId =
    typeof workspaceId === "string"
      ? workspaceId.trim()
      : activeBrowserWorkspaceId;
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!historyPopupWindow || historyPopupWindow.isDestroyed()) {
      return;
    }
    return;
  }
  if (normalizedWorkspaceId !== activeBrowserWorkspaceId) {
    return;
  }
  const workspace = browserWorkspaceOrEmpty(normalizedWorkspaceId);
  const history = workspace?.history ?? [];
  mainWindow.webContents.send("browser:history", history);
  historyPopupWindow?.webContents.send("history:update", history);
}

function closeBrowserTabRecord(tab: BrowserTabRecord) {
  tab.view.webContents.removeAllListeners();
  void tab.view.webContents.close();
}

function destroyBrowserWorkspace(workspaceId: string) {
  const workspace = browserWorkspaceFromMap(workspaceId);
  if (!workspace) {
    return;
  }
  for (const browserSpace of BROWSER_SPACE_IDS) {
    for (const tab of workspace.spaces[browserSpace].tabs.values()) {
      closeBrowserTabRecord(tab);
    }
    workspace.spaces[browserSpace].tabs.clear();
  }
  browserWorkspaces.delete(workspaceId);
}

function updateAttachedBrowserView() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const activeTab = getActiveBrowserTab(
    activeBrowserWorkspaceId,
    activeBrowserSpaceId,
  );
  if (!activeTab || !hasVisibleBrowserBounds()) {
    if (attachedBrowserTabView) {
      mainWindow.setBrowserView(null);
      attachedBrowserTabView = null;
    }
    return;
  }
  if (attachedBrowserTabView !== activeTab.view) {
    reserveMainWindowClosedListenerBudget(1);
    mainWindow.setBrowserView(activeTab.view);
    attachedBrowserTabView = activeTab.view;
  }
  applyBoundsToTab(
    activeBrowserWorkspaceId,
    activeTab.state.id,
    activeBrowserSpaceId,
  );
}

function syncBrowserState(
  workspaceId: string,
  tabId: string,
  space: BrowserSpaceId,
) {
  const workspace = browserWorkspaceFromMap(workspaceId);
  const tab = browserTabSpaceState(workspace, space)?.tabs.get(tabId);
  if (!workspace || !tab) {
    return;
  }

  const viewContents = tab.view.webContents;
  tab.state = {
    ...tab.state,
    url: viewContents.getURL() || tab.state.url,
    title: viewContents.getTitle() || tab.state.title,
    faviconUrl: tab.state.faviconUrl,
    canGoBack: viewContents.navigationHistory.canGoBack(),
    canGoForward: viewContents.navigationHistory.canGoForward(),
  };
  emitBrowserState(workspaceId, space);
  void persistBrowserWorkspace(workspaceId);
}

function normalizeBrowserPopupFrameName(frameName?: string | null): string {
  const normalized = typeof frameName === "string" ? frameName.trim() : "";
  return normalized && normalized !== "_blank" ? normalized : "";
}

function isBrowserPopupWindowRequest(
  frameName?: string | null,
  features?: string | null,
): boolean {
  if (normalizeBrowserPopupFrameName(frameName)) {
    return true;
  }
  const normalizedFeatures =
    typeof features === "string" ? features.trim().toLowerCase() : "";
  return (
    normalizedFeatures.includes("popup") ||
    normalizedFeatures.includes("width=") ||
    normalizedFeatures.includes("height=") ||
    normalizedFeatures.includes("left=") ||
    normalizedFeatures.includes("top=")
  );
}

function focusBrowserTabInSpace(
  workspaceId: string,
  tabSpace: BrowserTabSpaceState,
  tabId: string,
  space: BrowserSpaceId,
) {
  tabSpace.activeTabId = tabId;
  if (workspaceId === activeBrowserWorkspaceId && space === activeBrowserSpaceId) {
    updateAttachedBrowserView();
  }
  emitBrowserState(workspaceId, space);
  void persistBrowserWorkspace(workspaceId);
}

function handleBrowserWindowOpenAsTab(
  workspaceId: string,
  targetUrl: string,
  disposition: string,
  frameName: string,
  space: BrowserSpaceId,
) {
  const normalizedUrl = targetUrl.trim();
  if (!normalizedUrl) {
    return;
  }

  try {
    const parsed = new URL(normalizedUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      void shell.openExternal(normalizedUrl);
      return;
    }
  } catch {
    return;
  }

  const workspace = browserWorkspaceFromMap(workspaceId);
  const tabSpace = browserTabSpaceState(workspace, space);
  if (!workspace || !tabSpace) {
    return;
  }

  const normalizedFrameName = normalizeBrowserPopupFrameName(frameName);
  const now = Date.now();
  const existingPopupTab = Array.from(tabSpace.tabs.entries()).find(
    ([, tab]) =>
      (normalizedFrameName && tab.popupFrameName === normalizedFrameName) ||
      (!normalizedFrameName &&
        tab.state.url === normalizedUrl &&
        typeof tab.popupOpenedAtMs === "number" &&
        now - tab.popupOpenedAtMs <= DUPLICATE_BROWSER_POPUP_TAB_WINDOW_MS),
  );

  if (existingPopupTab) {
    const [existingTabId, existingTab] = existingPopupTab;
    existingTab.popupFrameName =
      normalizedFrameName || existingTab.popupFrameName;
    existingTab.popupOpenedAtMs = now;
    if (existingTab.state.url !== normalizedUrl) {
      existingTab.state = { ...existingTab.state, error: "" };
      void existingTab.view.webContents.loadURL(normalizedUrl).catch((error) => {
        if (isAbortedBrowserLoadError(error)) {
          return;
        }
        existingTab.state = {
          ...existingTab.state,
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load URL.",
        };
        emitBrowserState(workspaceId, space);
        void persistBrowserWorkspace(workspaceId);
      });
    }
    if (disposition !== "background-tab") {
      focusBrowserTabInSpace(workspaceId, tabSpace, existingTabId, space);
    }
    return;
  }

  const nextTabId = createBrowserTab(workspaceId, {
    url: normalizedUrl,
    browserSpace: space,
    popupFrameName: normalizedFrameName,
    popupOpenedAtMs: now,
  });
  if (!nextTabId) {
    return;
  }

  if (disposition !== "background-tab") {
    focusBrowserTabInSpace(workspaceId, tabSpace, nextTabId, space);
    return;
  }

  emitBrowserState(workspaceId, space);
  void persistBrowserWorkspace(workspaceId);
}

function browserContextSuggestedFilename(context: ContextMenuParams): string {
  const suggested = context.suggestedFilename.trim();
  if (suggested) {
    return sanitizeAttachmentName(suggested);
  }

  const candidateUrl = context.srcURL.trim() || context.linkURL.trim();
  if (!candidateUrl) {
    return context.mediaType === "image" ? "image" : "download";
  }

  try {
    const parsed = new URL(candidateUrl);
    const basename = path.basename(parsed.pathname).trim();
    if (basename) {
      return sanitizeAttachmentName(basename);
    }
  } catch {
    // fall through to fallback names below
  }

  return context.mediaType === "image" ? "image" : "download";
}

function queueBrowserDownloadPrompt(
  workspaceId: string,
  targetUrl: string,
  options: {
    defaultFilename: string;
    dialogTitle: string;
    buttonLabel: string;
  },
) {
  const workspace = browserWorkspaceFromMap(workspaceId);
  if (!workspace) {
    return;
  }
  workspace.pendingDownloadOverrides.push({
    url: targetUrl.trim(),
    defaultPath: path.join(
      workspaceDirectoryPath(workspaceId),
      "Downloads",
      sanitizeAttachmentName(options.defaultFilename),
    ),
    dialogTitle: options.dialogTitle,
    buttonLabel: options.buttonLabel,
  });
}

function consumeBrowserDownloadOverride(
  workspace: BrowserWorkspaceState,
  targetUrl: string,
): BrowserDownloadOverride | null {
  const normalizedTargetUrl = targetUrl.trim();
  const overrideIndex = workspace.pendingDownloadOverrides.findIndex(
    (override) => override.url === normalizedTargetUrl,
  );
  if (overrideIndex < 0) {
    return null;
  }
  const [override] = workspace.pendingDownloadOverrides.splice(
    overrideIndex,
    1,
  );
  return override ?? null;
}

function showBrowserViewContextMenu(params: {
  workspaceId: string;
  space: BrowserSpaceId;
  view: BrowserView;
  context: ContextMenuParams;
}) {
  const { workspaceId, space, view, context } = params;
  const template: MenuItemConstructorOptions[] = [];
  const selectionText = context.selectionText.trim();
  const linkUrl = context.linkURL.trim();
  const canGoBack = view.webContents.navigationHistory.canGoBack();
  const canGoForward = view.webContents.navigationHistory.canGoForward();
  const popupX = browserBounds.x + context.x;
  const popupY = browserBounds.y + context.y;
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
          ),
      },
      {
        label: "Open Link Externally",
        click: () => {
          void shell.openExternal(linkUrl);
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
          queueBrowserDownloadPrompt(workspaceId, imageUrl, {
            defaultFilename: browserContextSuggestedFilename(context),
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

  Menu.buildFromTemplate(template).popup({
    window: mainWindow ?? undefined,
    frame: context.frame ?? undefined,
    x: popupX,
    y: popupY,
    sourceType: context.menuSourceType,
  });
}

function createBrowserTab(
  workspaceId: string,
  options: {
    browserSpace?: BrowserSpaceId;
    id?: string;
    url?: string;
    title?: string;
    faviconUrl?: string;
    popupFrameName?: string;
    popupOpenedAtMs?: number;
    skipInitialHistoryRecord?: boolean;
  } = {},
) {
  const workspace = browserWorkspaceFromMap(workspaceId);
  const browserSpace = browserSpaceId(options.browserSpace);
  const tabSpace = browserTabSpaceState(workspace, browserSpace);
  if (!mainWindow || !workspace || !tabSpace) {
    return null;
  }

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
  const state = createBrowserState({
    id: tabId,
    url: initialUrl,
    title: options.title || NEW_TAB_TITLE,
    faviconUrl: options.faviconUrl,
    initialized: !hasInitialUrl,
  });
  tabSpace.tabs.set(tabId, {
    view,
    state,
    popupFrameName: options.popupFrameName?.trim() || undefined,
    popupOpenedAtMs:
      typeof options.popupOpenedAtMs === "number" ? options.popupOpenedAtMs : undefined,
  });

  view.setBounds(browserBounds);
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

    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        void shell.openExternal(normalizedUrl);
        return { action: "deny" };
      }
    } catch {
      return { action: "deny" };
    }

    if (isBrowserPopupWindowRequest(frameName, features)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          parent: mainWindow ?? undefined,
          autoHideMenuBar: true,
          backgroundColor: "#050907",
          width: 520,
          height: 760,
          minWidth: 420,
          minHeight: 620,
          webPreferences: {
            preload: path.join(__dirname, "browserPopupPreload.cjs"),
          },
        },
      };
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
      );
    }
    return { action: "deny" };
    },
  );
  view.webContents.setZoomFactor(1);
  view.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);

  view.webContents.on("dom-ready", () => {
    const currentTab = browserTabSpaceState(
      browserWorkspaceFromMap(workspaceId),
      browserSpace,
    )?.tabs.get(tabId);
    if (!currentTab) {
      return;
    }
    currentTab.state = { ...currentTab.state, initialized: true, error: "" };
    syncBrowserState(workspaceId, tabId, browserSpace);
  });

  view.webContents.on("did-start-loading", () => {
    const currentTab = browserTabSpaceState(
      browserWorkspaceFromMap(workspaceId),
      browserSpace,
    )?.tabs.get(tabId);
    if (!currentTab) {
      return;
    }
    currentTab.state = { ...currentTab.state, loading: true, error: "" };
    syncBrowserState(workspaceId, tabId, browserSpace);
  });

  view.webContents.on("did-stop-loading", () => {
    const currentTab = browserTabSpaceState(
      browserWorkspaceFromMap(workspaceId),
      browserSpace,
    )?.tabs.get(tabId);
    if (!currentTab) {
      return;
    }
    currentTab.state = { ...currentTab.state, loading: false, error: "" };
    syncBrowserState(workspaceId, tabId, browserSpace);
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
    syncBrowserState(workspaceId, tabId, browserSpace);
  });

  view.webContents.on("page-favicon-updated", (_event, favicons) => {
    const currentTab = browserTabSpaceState(
      browserWorkspaceFromMap(workspaceId),
      browserSpace,
    )?.tabs.get(tabId);
    if (!currentTab) {
      return;
    }
    currentTab.state = {
      ...currentTab.state,
      faviconUrl: favicons[0] || currentTab.state.faviconUrl,
    };
    emitBrowserState(workspaceId, browserSpace);
    void persistBrowserWorkspace(workspaceId);
  });

  view.webContents.on("did-navigate", () => {
    syncBrowserState(workspaceId, tabId, browserSpace);
  });

  view.webContents.on("did-navigate-in-page", () => {
    syncBrowserState(workspaceId, tabId, browserSpace);
  });

  view.webContents.on("context-menu", (_event, params) => {
    showBrowserViewContextMenu({
      workspaceId,
      space: browserSpace,
      view,
      context: params,
    });
  });

  view.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (
        !isMainFrame ||
        isAbortedBrowserLoadFailure(errorCode, errorDescription)
      ) {
        return;
      }
      const currentTab = browserTabSpaceState(
        browserWorkspaceFromMap(workspaceId),
        browserSpace,
      )?.tabs.get(tabId);
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
      void persistBrowserWorkspace(workspaceId);
    },
  );

  if (hasInitialUrl) {
    void view.webContents.loadURL(initialUrl).catch((error) => {
      if (isAbortedBrowserLoadError(error)) {
        return;
      }
      const currentTab = browserTabSpaceState(
        browserWorkspaceFromMap(workspaceId),
        browserSpace,
      )?.tabs.get(tabId);
      if (!currentTab) {
        return;
      }
      currentTab.state = {
        ...currentTab.state,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load page.",
      };
      emitBrowserState(workspaceId, browserSpace);
      void persistBrowserWorkspace(workspaceId);
    });
  }

  return tabId;
}

function ensureBrowserTabSpaceInitialized(
  workspaceId: string,
  space: BrowserSpaceId,
): boolean {
  const workspace = browserWorkspaceFromMap(workspaceId);
  const tabSpace = browserTabSpaceState(workspace, space);
  if (!workspace || !tabSpace || tabSpace.tabs.size > 0) {
    return false;
  }

  const initialTabId = createBrowserTab(workspaceId, {
    url: HOME_URL,
    browserSpace: space,
  });
  tabSpace.activeTabId = initialTabId ?? "";
  return true;
}

function ensureBrowserWorkspaceDownloadTracking(
  workspace: BrowserWorkspaceState,
) {
  if (
    workspace.downloadTrackingRegistered ||
    browserDownloadTrackingPartitions.has(workspace.partition)
  ) {
    workspace.downloadTrackingRegistered = true;
    return;
  }
  workspace.downloadTrackingRegistered = true;
  browserDownloadTrackingPartitions.add(workspace.partition);
  workspace.session.on("will-download", (_event, item: DownloadItem) => {
    const currentWorkspace = browserWorkspaceFromMap(workspace.workspaceId);
    if (!currentWorkspace) {
      return;
    }

    const createdAt = new Date().toISOString();
    const downloadId = `download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const override = consumeBrowserDownloadOverride(
      currentWorkspace,
      item.getURL(),
    );
    const savePath = override
      ? ""
      : resolveWorkspaceDownloadTargetPath(
          currentWorkspace.workspaceId,
          item.getFilename(),
        );
    if (override) {
      item.setSaveDialogOptions({
        title: override.dialogTitle,
        buttonLabel: override.buttonLabel,
        defaultPath: override.defaultPath,
        properties: ["showOverwriteConfirmation"],
      });
    } else {
      item.setSavePath(savePath);
    }

    const payload: BrowserDownloadPayload = {
      id: downloadId,
      url: item.getURL(),
      filename: item.getFilename(),
      targetPath: item.getSavePath() || savePath,
      status: "progressing",
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      createdAt,
      completedAt: null,
    };

    currentWorkspace.downloads = [payload, ...currentWorkspace.downloads].slice(
      0,
      100,
    );
    emitDownloadsState(workspace.workspaceId);
    void persistBrowserWorkspace(workspace.workspaceId);

    const updateDownload = (patch: Partial<BrowserDownloadPayload>) => {
      const latestWorkspace = browserWorkspaceFromMap(workspace.workspaceId);
      if (!latestWorkspace) {
        return;
      }
      latestWorkspace.downloads = latestWorkspace.downloads.map((download) =>
        download.id === downloadId ? { ...download, ...patch } : download,
      );
      emitDownloadsState(workspace.workspaceId);
      void persistBrowserWorkspace(workspace.workspaceId);
    };

    item.on("updated", (_updatedEvent, state) => {
      updateDownload({
        status: state === "interrupted" ? "interrupted" : "progressing",
        targetPath: item.getSavePath() || "",
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
      });
    });

    item.once("done", (_doneEvent, state) => {
      const nextStatus: BrowserDownloadStatus =
        state === "completed"
          ? "completed"
          : state === "cancelled"
            ? "cancelled"
            : "interrupted";
      updateDownload({
        status: nextStatus,
        targetPath: item.getSavePath() || "",
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        completedAt:
          nextStatus === "completed" ? new Date().toISOString() : null,
      });
    });
  });
}

async function ensureBrowserWorkspace(
  workspaceId?: string | null,
  space?: BrowserSpaceId | null,
): Promise<BrowserWorkspaceState | null> {
  const normalizedWorkspaceId =
    typeof workspaceId === "string"
      ? workspaceId.trim()
      : activeBrowserWorkspaceId;
  const browserSpace = browserSpaceId(space);
  if (!normalizedWorkspaceId) {
    return null;
  }

  const existing = browserWorkspaceFromMap(normalizedWorkspaceId);
  if (existing) {
    if (ensureBrowserTabSpaceInitialized(normalizedWorkspaceId, browserSpace)) {
      void persistBrowserWorkspace(normalizedWorkspaceId);
    }
    return existing;
  }

  const workspace = createBrowserWorkspaceState(normalizedWorkspaceId);
  browserWorkspaces.set(normalizedWorkspaceId, workspace);
  ensureBrowserWorkspaceDownloadTracking(workspace);

  const persisted = await readJsonFile<BrowserWorkspacePersistencePayload>(
    browserWorkspaceStatePath(normalizedWorkspaceId),
    defaultBrowserWorkspacePersistence(),
  );
  workspace.bookmarks = Array.isArray(persisted.bookmarks)
    ? persisted.bookmarks
    : [];
  workspace.downloads = Array.isArray(persisted.downloads)
    ? persisted.downloads
    : [];
  workspace.history = Array.isArray(persisted.history) ? persisted.history : [];

  const persistedSpaces =
    persisted.spaces && typeof persisted.spaces === "object"
      ? persisted.spaces
      : {};

  for (const persistedSpace of BROWSER_SPACE_IDS) {
    const tabSpace = workspace.spaces[persistedSpace];
    const storedSpace =
      persistedSpaces[persistedSpace] &&
      typeof persistedSpaces[persistedSpace] === "object"
        ? persistedSpaces[persistedSpace]
        : null;
    const persistedTabs = Array.isArray(storedSpace?.tabs)
      ? storedSpace.tabs
      : persistedSpace === "user" && Array.isArray(persisted.tabs)
        ? persisted.tabs
        : [];
    for (const persistedTab of persistedTabs) {
      if (!persistedTab || typeof persistedTab !== "object") {
        continue;
      }
      createBrowserTab(normalizedWorkspaceId, {
        browserSpace: persistedSpace,
        id: typeof persistedTab.id === "string" ? persistedTab.id : undefined,
        url:
          typeof persistedTab.url === "string" && persistedTab.url.trim()
            ? persistedTab.url.trim()
            : HOME_URL,
        title:
          typeof persistedTab.title === "string"
            ? persistedTab.title
            : NEW_TAB_TITLE,
        faviconUrl:
          typeof persistedTab.faviconUrl === "string"
            ? persistedTab.faviconUrl
            : undefined,
        skipInitialHistoryRecord: true,
      });
    }

    const persistedActiveTabId =
      typeof storedSpace?.activeTabId === "string"
        ? storedSpace.activeTabId.trim()
        : persistedSpace === "user" && typeof persisted.activeTabId === "string"
          ? persisted.activeTabId.trim()
          : "";
    tabSpace.activeTabId = tabSpace.tabs.has(persistedActiveTabId)
      ? persistedActiveTabId
      : (Array.from(tabSpace.tabs.keys())[0] ?? "");
  }

  if (ensureBrowserTabSpaceInitialized(normalizedWorkspaceId, browserSpace)) {
    void persistBrowserWorkspace(normalizedWorkspaceId);
  }
  return workspace;
}

async function setActiveBrowserWorkspace(
  workspaceId: string | null | undefined,
  space?: BrowserSpaceId | null,
) {
  const normalizedWorkspaceId =
    typeof workspaceId === "string" ? workspaceId.trim() : "";
  const browserSpace = browserSpaceId(space);
  activeBrowserWorkspaceId = normalizedWorkspaceId;
  activeBrowserSpaceId = browserSpace;
  if (!normalizedWorkspaceId) {
    emitBrowserState();
    emitBookmarksState();
    emitDownloadsState();
    emitHistoryState();
    return emptyBrowserTabListPayload(browserSpace);
  }

  await ensureBrowserWorkspace(normalizedWorkspaceId, browserSpace);
  updateAttachedBrowserView();
  emitBrowserState(normalizedWorkspaceId, browserSpace);
  emitBookmarksState(normalizedWorkspaceId);
  emitDownloadsState(normalizedWorkspaceId);
  emitHistoryState(normalizedWorkspaceId);
  return browserWorkspaceSnapshot(normalizedWorkspaceId, browserSpace);
}

async function setActiveBrowserTab(
  tabId: string,
  space?: BrowserSpaceId | null,
) {
  const browserSpace = browserSpaceId(space);
  const workspace = await ensureBrowserWorkspace(undefined, browserSpace);
  const tabSpace = browserTabSpaceState(workspace, browserSpace);
  if (!workspace || !tabSpace || !tabSpace.tabs.has(tabId)) {
    return browserWorkspaceSnapshot(undefined, browserSpace);
  }

  tabSpace.activeTabId = tabId;
  if (
    workspace.workspaceId === activeBrowserWorkspaceId &&
    browserSpace === activeBrowserSpaceId
  ) {
    updateAttachedBrowserView();
  }
  emitBrowserState(workspace.workspaceId, browserSpace);
  await persistBrowserWorkspace(workspace.workspaceId);
  return browserWorkspaceSnapshot(workspace.workspaceId, browserSpace);
}

async function closeBrowserTab(tabId: string, space?: BrowserSpaceId | null) {
  const browserSpace = browserSpaceId(space);
  const workspace = await ensureBrowserWorkspace(undefined, browserSpace);
  const tabSpace = browserTabSpaceState(workspace, browserSpace);
  const tab = tabSpace?.tabs.get(tabId);
  if (!workspace || !tabSpace || !tab) {
    return browserWorkspaceSnapshot(undefined, browserSpace);
  }

  const tabIds = Array.from(tabSpace.tabs.keys());
  const closedIndex = tabIds.indexOf(tabId);
  tabSpace.tabs.delete(tabId);
  closeBrowserTabRecord(tab);

  if (tabSpace.tabs.size === 0) {
    const replacementTabId = createBrowserTab(workspace.workspaceId, {
      url: HOME_URL,
      browserSpace,
    });
    tabSpace.activeTabId = replacementTabId ?? "";
  } else if (tabSpace.activeTabId === tabId) {
    const remainingIds = Array.from(tabSpace.tabs.keys());
    tabSpace.activeTabId =
      remainingIds[Math.max(0, closedIndex - 1)] ?? remainingIds[0] ?? "";
  }

  if (
    workspace.workspaceId === activeBrowserWorkspaceId &&
    browserSpace === activeBrowserSpaceId
  ) {
    updateAttachedBrowserView();
  }
  emitBrowserState(workspace.workspaceId, browserSpace);
  await persistBrowserWorkspace(workspace.workspaceId);
  return browserWorkspaceSnapshot(workspace.workspaceId, browserSpace);
}

function setBrowserBounds(bounds: BrowserBoundsPayload) {
  browserBounds = {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  };

  const activeTab = getActiveBrowserTab(
    activeBrowserWorkspaceId,
    activeBrowserSpaceId,
  );
  if (!activeTab || !hasVisibleBrowserBounds()) {
    mainWindow?.setBrowserView(null);
    attachedBrowserTabView = null;
    return;
  }
  updateAttachedBrowserView();
}

function createDownloadsPopupHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Downloads</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Exo 2", "Segoe UI Variable", sans-serif;
        background: transparent;
        color: #deeee6;
      }
      .panel {
        margin: 10px;
        border-radius: 18px;
        border: 1px solid rgba(87, 255, 173, 0.24);
        background: linear-gradient(180deg, rgba(9, 16, 13, 0.98), rgba(5, 9, 7, 0.98));
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
        overflow: hidden;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 18px 10px;
      }
      .title {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(222, 238, 230, 0.82);
      }
      .close {
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        color: rgba(222, 238, 230, 0.6);
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
      }
      .close:hover { background: rgba(255, 255, 255, 0.06); color: rgba(222, 238, 230, 0.92); }
      .list {
        max-height: 274px;
        overflow-y: auto;
        padding: 0 12px 12px;
      }
      .empty {
        margin: 0 6px 6px;
        padding: 16px;
        border-radius: 14px;
        border: 1px solid rgba(87, 255, 173, 0.14);
        background: rgba(255, 255, 255, 0.03);
        font-size: 12px;
        color: rgba(222, 238, 230, 0.68);
      }
      .item {
        margin: 0 6px 10px;
        padding: 12px;
        border-radius: 14px;
        border: 1px solid rgba(87, 255, 173, 0.14);
        background: rgba(255, 255, 255, 0.03);
      }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .meta {
        min-width: 0;
        flex: 1;
      }
      .filename {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 700;
        color: rgba(222, 238, 230, 0.92);
      }
      .status {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 3px;
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(222, 238, 230, 0.48);
      }
      .actions {
        display: flex;
        gap: 6px;
      }
      .action {
        height: 28px;
        min-width: 28px;
        padding: 0 10px;
        border-radius: 10px;
        border: 1px solid rgba(87, 255, 173, 0.18);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(222, 238, 230, 0.76);
        cursor: pointer;
        font-size: 11px;
      }
      .action:hover { border-color: rgba(87, 255, 173, 0.42); color: #57ffad; }
      .bar {
        margin-top: 10px;
        height: 6px;
        border-radius: 9999px;
        background: rgba(0, 0, 0, 0.35);
        overflow: hidden;
      }
      .bar > span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, rgba(87, 255, 173, 0.72), rgba(87, 255, 173, 0.92));
      }
      ${popupThemeCss()}
    </style>
  </head>
  <body>
    <div class="panel">
      <div class="header">
        <div class="title">Downloads</div>
        <button class="close" id="close" aria-label="Close">×</button>
      </div>
      <div class="list" id="list"></div>
    </div>
    <script>
      const list = document.getElementById("list");
      const close = document.getElementById("close");

      const render = (downloads) => {
        const recent = downloads.slice(0, 5);
        if (!recent.length) {
          list.innerHTML = '<div class="empty">No downloads yet.</div>';
          return;
        }

        list.innerHTML = recent.map((download) => {
          const progress = download.totalBytes > 0 ? Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100)) : 0;
          return \`
            <div class="item">
              <div class="row">
                <div class="meta">
                  <div class="filename" title="\${download.filename}">\${download.filename}</div>
                  <div class="status">\${download.status}</div>
                </div>
                <div class="actions">
                  <button class="action" data-open="\${download.id}">Open</button>
                  <button class="action" data-reveal="\${download.id}">Show</button>
                </div>
              </div>
              <div class="bar"><span style="width:\${progress}%"></span></div>
            </div>
          \`;
        }).join("");

        list.querySelectorAll("[data-open]").forEach((button) => {
          button.addEventListener("click", () => window.downloadsPopup.openDownload(button.dataset.open));
        });
        list.querySelectorAll("[data-reveal]").forEach((button) => {
          button.addEventListener("click", () => window.downloadsPopup.showDownloadInFolder(button.dataset.reveal));
        });
      };

      close.addEventListener("click", () => window.downloadsPopup.close());
      window.downloadsPopup.onDownloadsChange(render);
      window.downloadsPopup.getDownloads().then(render);
    </script>
  </body>
</html>`;
}

function ensureAuthPopupWindow() {
  if (authPopupWindow && !authPopupWindow.isDestroyed()) {
    return authPopupWindow;
  }

  if (!mainWindow) {
    return null;
  }

  authPopupWindow = new BrowserWindow({
    width: AUTH_POPUP_WIDTH,
    height: AUTH_POPUP_HEIGHT,
    parent: mainWindow,
    acceptFirstMouse: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "authPopupPreload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  authPopupWindow.on("blur", () => {
    scheduleAuthPopupHide();
  });

  authPopupWindow.on("focus", () => {
    clearScheduledAuthPopupHide();
  });

  authPopupWindow.once("closed", () => {
    clearScheduledAuthPopupHide();
    authPopupWindow = null;
  });

  const html = createAuthPopupHtml();
  void authPopupWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  return authPopupWindow;
}

function clearScheduledAuthPopupHide() {
  if (!authPopupCloseTimer) {
    return;
  }

  clearTimeout(authPopupCloseTimer);
  authPopupCloseTimer = null;
}

function scheduleAuthPopupHide(delayMs = AUTH_POPUP_CLOSE_DELAY_MS) {
  clearScheduledAuthPopupHide();
  authPopupCloseTimer = setTimeout(
    () => {
      authPopupCloseTimer = null;
      hideAuthPopup();
    },
    Math.max(0, delayMs),
  );
}

function notifyAuthPopupOpened(popup: BrowserWindow) {
  if (popup.webContents.isLoadingMainFrame()) {
    popup.webContents.once("did-finish-load", () => {
      if (!popup.isDestroyed()) {
        popup.webContents.send("auth:opened");
      }
    });
    return;
  }

  popup.webContents.send("auth:opened");
}

function hideAuthPopup() {
  clearScheduledAuthPopupHide();
  authPopupWindow?.hide();
}

function showAuthPopup(anchorBounds: BrowserAnchorBoundsPayload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  clearScheduledAuthPopupHide();
  const popup = ensureAuthPopupWindow();
  if (!popup) {
    return;
  }

  const contentBounds = mainWindow.getContentBounds();
  const x = Math.round(
    Math.min(
      Math.max(contentBounds.x + anchorBounds.x, contentBounds.x + 8),
      contentBounds.x + contentBounds.width - AUTH_POPUP_WIDTH - 8,
    ),
  );
  const y = Math.round(contentBounds.y + anchorBounds.y + anchorBounds.height);

  popup.setBounds({
    x,
    y,
    width: AUTH_POPUP_WIDTH,
    height: AUTH_POPUP_HEIGHT,
  });
  if (popup.isVisible()) {
    return;
  }
  popup.show();
  popup.focus();
  notifyAuthPopupOpened(popup);
  emitPendingAuthState();
}

function toggleAuthPopup(anchorBounds: BrowserAnchorBoundsPayload) {
  if (
    authPopupWindow &&
    !authPopupWindow.isDestroyed() &&
    authPopupWindow.isVisible()
  ) {
    hideAuthPopup();
    return;
  }

  showAuthPopup(anchorBounds);
}

function ensureDownloadsPopupWindow() {
  if (downloadsPopupWindow && !downloadsPopupWindow.isDestroyed()) {
    return downloadsPopupWindow;
  }

  if (!mainWindow) {
    return null;
  }

  downloadsPopupWindow = new BrowserWindow({
    width: DOWNLOADS_POPUP_WIDTH,
    height: DOWNLOADS_POPUP_HEIGHT,
    parent: mainWindow,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "downloadsPopupPreload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  downloadsPopupWindow.on("blur", () => {
    downloadsPopupWindow?.hide();
  });

  downloadsPopupWindow.once("closed", () => {
    downloadsPopupWindow = null;
  });

  const html = createDownloadsPopupHtml();
  void downloadsPopupWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  return downloadsPopupWindow;
}

function toggleDownloadsPopup(anchorBounds: BrowserAnchorBoundsPayload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const popup = ensureDownloadsPopupWindow();
  if (!popup) {
    return;
  }

  if (popup.isVisible()) {
    popup.hide();
    return;
  }

  const contentBounds = mainWindow.getContentBounds();
  const x = Math.round(
    Math.min(
      Math.max(
        contentBounds.x +
          anchorBounds.x +
          anchorBounds.width -
          DOWNLOADS_POPUP_WIDTH,
        contentBounds.x + 8,
      ),
      contentBounds.x + contentBounds.width - DOWNLOADS_POPUP_WIDTH - 8,
    ),
  );
  const y = Math.round(
    contentBounds.y + anchorBounds.y + anchorBounds.height + 8,
  );

  popup.setBounds({
    x,
    y,
    width: DOWNLOADS_POPUP_WIDTH,
    height: DOWNLOADS_POPUP_HEIGHT,
  });
  popup.show();
  popup.focus();
  emitDownloadsState();
}

function createHistoryPopupHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>History</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Exo 2", "Segoe UI Variable", sans-serif;
        background: transparent;
        color: #deeee6;
      }
      .panel {
        margin: 10px;
        border-radius: 18px;
        border: 1px solid rgba(87, 255, 173, 0.24);
        background: linear-gradient(180deg, rgba(9, 16, 13, 0.98), rgba(5, 9, 7, 0.98));
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
        overflow: hidden;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 16px 18px 10px;
      }
      .title {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(222, 238, 230, 0.82);
      }
      .actions { display: flex; gap: 6px; }
      .button {
        height: 28px;
        min-width: 28px;
        padding: 0 10px;
        border-radius: 10px;
        border: 1px solid rgba(87, 255, 173, 0.18);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(222, 238, 230, 0.76);
        cursor: pointer;
        font-size: 11px;
      }
      .button:hover { border-color: rgba(87, 255, 173, 0.42); color: #57ffad; }
      .list {
        max-height: 344px;
        overflow-y: auto;
        padding: 0 12px 12px;
      }
      .empty {
        margin: 0 6px 6px;
        padding: 16px;
        border-radius: 14px;
        border: 1px solid rgba(87, 255, 173, 0.14);
        background: rgba(255, 255, 255, 0.03);
        font-size: 12px;
        color: rgba(222, 238, 230, 0.68);
      }
      .item {
        margin: 0 6px 8px;
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid rgba(87, 255, 173, 0.14);
        background: rgba(255, 255, 255, 0.03);
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .open {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
        padding: 0;
      }
      .title-row {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 700;
        color: rgba(222, 238, 230, 0.92);
      }
      .url-row {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 3px;
        font-size: 11px;
        color: rgba(222, 238, 230, 0.56);
      }
      .icon {
        width: 16px;
        height: 16px;
        border-radius: 4px;
        flex: 0 0 auto;
      }
      .remove {
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        color: rgba(222, 238, 230, 0.58);
        cursor: pointer;
        font-size: 16px;
      }
      .remove:hover { background: rgba(255, 255, 255, 0.06); color: #57ffad; }
      ${popupThemeCss()}
    </style>
  </head>
  <body>
    <div class="panel">
      <div class="header">
        <div class="title">History</div>
        <div class="actions">
          <button class="button" id="clear">Clear</button>
          <button class="button" id="close">Close</button>
        </div>
      </div>
      <div class="list" id="list"></div>
    </div>
    <script>
      const list = document.getElementById("list");
      const clear = document.getElementById("clear");
      const close = document.getElementById("close");

      const formatTime = (value) => new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(new Date(value));

      const render = (entries) => {
        const recent = entries.slice(0, 30);
        if (!recent.length) {
          list.innerHTML = '<div class="empty">No browsing history yet.</div>';
          return;
        }

        list.innerHTML = recent.map((entry) => {
          const icon = entry.faviconUrl
            ? '<img class="icon" src="' + entry.faviconUrl + '" alt="" />'
            : '<div class="icon" style="background:rgba(255,255,255,0.08)"></div>';

          return \`
            <div class="item">
              \${icon}
              <button class="open" data-url="\${entry.url}">
                <div class="title-row" title="\${entry.title}">\${entry.title}</div>
                <div class="url-row" title="\${entry.url}">\${entry.url} · \${formatTime(entry.lastVisitedAt)}</div>
              </button>
              <button class="remove" data-remove="\${entry.id}" aria-label="Remove">×</button>
            </div>
          \`;
        }).join("");

        list.querySelectorAll("[data-url]").forEach((button) => {
          button.addEventListener("click", () => window.historyPopup.openUrl(button.dataset.url));
        });
        list.querySelectorAll("[data-remove]").forEach((button) => {
          button.addEventListener("click", () => window.historyPopup.removeEntry(button.dataset.remove));
        });
      };

      clear.addEventListener("click", () => window.historyPopup.clear());
      close.addEventListener("click", () => window.historyPopup.close());
      window.historyPopup.onHistoryChange(render);
      window.historyPopup.getHistory().then(render);
    </script>
  </body>
</html>`;
}

function ensureHistoryPopupWindow() {
  if (historyPopupWindow && !historyPopupWindow.isDestroyed()) {
    return historyPopupWindow;
  }

  if (!mainWindow) {
    return null;
  }

  historyPopupWindow = new BrowserWindow({
    width: HISTORY_POPUP_WIDTH,
    height: HISTORY_POPUP_HEIGHT,
    parent: mainWindow,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "historyPopupPreload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  historyPopupWindow.on("blur", () => {
    historyPopupWindow?.hide();
  });

  historyPopupWindow.once("closed", () => {
    historyPopupWindow = null;
  });

  const html = createHistoryPopupHtml();
  void historyPopupWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  return historyPopupWindow;
}

function toggleHistoryPopup(anchorBounds: BrowserAnchorBoundsPayload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const popup = ensureHistoryPopupWindow();
  if (!popup) {
    return;
  }

  if (popup.isVisible()) {
    popup.hide();
    return;
  }

  const contentBounds = mainWindow.getContentBounds();
  const x = Math.round(
    Math.min(
      Math.max(
        contentBounds.x +
          anchorBounds.x +
          anchorBounds.width -
          HISTORY_POPUP_WIDTH,
        contentBounds.x + 8,
      ),
      contentBounds.x + contentBounds.width - HISTORY_POPUP_WIDTH - 8,
    ),
  );
  const y = Math.round(
    contentBounds.y + anchorBounds.y + anchorBounds.height + 8,
  );

  popup.setBounds({
    x,
    y,
    width: HISTORY_POPUP_WIDTH,
    height: HISTORY_POPUP_HEIGHT,
  });
  popup.show();
  popup.focus();
  emitHistoryState();
}

function createOverflowPopupHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>More</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Exo 2", "Segoe UI Variable", sans-serif;
        background: transparent;
        color: #deeee6;
      }
      .panel {
        margin: 10px;
        border-radius: 16px;
        border: 1px solid rgba(87, 255, 173, 0.24);
        background: linear-gradient(180deg, rgba(9, 16, 13, 0.98), rgba(5, 9, 7, 0.98));
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
        padding: 8px;
      }
      .item {
        display: flex;
        width: 100%;
        align-items: center;
        gap: 10px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        color: rgba(222, 238, 230, 0.88);
        padding: 10px 12px;
        font-size: 13px;
        cursor: pointer;
      }
      .item:hover {
        background: rgba(255,255,255,0.05);
        color: #57ffad;
      }
      .icon {
        width: 18px;
        text-align: center;
        flex: 0 0 auto;
        color: rgba(222,238,230,0.66);
      }
      ${popupThemeCss()}
    </style>
  </head>
  <body>
    <div class="panel">
      <button class="item" id="downloads"><span class="icon">⭳</span><span>Downloads</span></button>
      <button class="item" id="history"><span class="icon">🕘</span><span>History</span></button>
      <button class="item" id="chrome-import"><span class="icon">⇪</span><span>Import Chrome</span></button>
    </div>
    <script>
      document.getElementById("downloads").addEventListener("click", () => window.overflowPopup.openDownloads());
      document.getElementById("history").addEventListener("click", () => window.overflowPopup.openHistory());
      document.getElementById("chrome-import").addEventListener("click", () => window.overflowPopup.importChrome());
    </script>
  </body>
</html>`;
}

function createAddressSuggestionsPopupHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Suggestions</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI Variable", sans-serif;
        background: transparent;
        color: #deeee6;
      }
      .panel {
        margin: 6px 0 0;
        border-radius: 14px;
        border: 1px solid rgba(87, 255, 173, 0.18);
        background: linear-gradient(180deg, rgba(17, 19, 22, 0.98), rgba(12, 15, 18, 0.98));
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.36);
        overflow: hidden;
      }
      .list {
        max-height: 100%;
        overflow-y: auto;
      }
      .item {
        display: flex;
        width: 100%;
        align-items: center;
        gap: 10px;
        border: 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        background: transparent;
        color: rgba(222, 238, 230, 0.84);
        padding: 10px 12px;
        text-align: left;
        cursor: pointer;
      }
      .item:last-child { border-bottom: 0; }
      .item:hover,
      .item.active {
        background: rgba(124, 146, 184, 0.12);
      }
      .icon {
        width: 14px;
        height: 14px;
        flex: 0 0 auto;
        border-radius: 4px;
        opacity: 0.74;
      }
      .meta {
        min-width: 0;
        flex: 1;
      }
      .title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 600;
        color: rgba(236, 239, 243, 0.92);
      }
      .url {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 2px;
        font-size: 10px;
        color: rgba(160, 167, 176, 0.72);
      }
      .clock {
        width: 14px;
        text-align: center;
        flex: 0 0 auto;
        color: rgba(160, 167, 176, 0.55);
        font-size: 12px;
      }
      ${popupThemeCss()}
    </style>
  </head>
  <body>
    <div class="panel">
      <div class="list" id="list"></div>
    </div>
    <script>
      const list = document.getElementById("list");

      const render = (payload) => {
        const suggestions = payload?.suggestions ?? [];
        const selectedIndex = payload?.selectedIndex ?? -1;
        list.innerHTML = suggestions.map((entry, index) => {
          const icon = entry.faviconUrl
            ? '<img class="icon" src="' + entry.faviconUrl + '" alt="" />'
            : '<span class="clock">🕘</span>';

          return \`
            <button class="item \${index === selectedIndex ? "active" : ""}" data-index="\${index}">
              \${icon}
              <div class="meta">
                <div class="title" title="\${entry.title || entry.url}">\${entry.title || entry.url}</div>
                <div class="url" title="\${entry.url}">\${entry.url}</div>
              </div>
            </button>
          \`;
        }).join("");

        list.querySelectorAll("[data-index]").forEach((button) => {
          button.addEventListener("mousedown", (event) => {
            event.preventDefault();
            window.addressSuggestions.choose(Number(button.dataset.index));
          });
        });
      };

      window.addressSuggestions.onSuggestionsChange(render);
    </script>
  </body>
</html>`;
}

function ensureOverflowPopupWindow() {
  if (overflowPopupWindow && !overflowPopupWindow.isDestroyed()) {
    return overflowPopupWindow;
  }

  if (!mainWindow) {
    return null;
  }

  overflowPopupWindow = new BrowserWindow({
    width: OVERFLOW_POPUP_WIDTH,
    height: OVERFLOW_POPUP_HEIGHT,
    parent: mainWindow,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "overflowPopupPreload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  overflowPopupWindow.on("blur", () => {
    overflowPopupWindow?.hide();
  });

  overflowPopupWindow.once("closed", () => {
    overflowPopupWindow = null;
  });

  const html = createOverflowPopupHtml();
  void overflowPopupWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  return overflowPopupWindow;
}

function ensureAddressSuggestionsPopupWindow() {
  if (
    addressSuggestionsPopupWindow &&
    !addressSuggestionsPopupWindow.isDestroyed()
  ) {
    return addressSuggestionsPopupWindow;
  }

  if (!mainWindow) {
    return null;
  }

  addressSuggestionsPopupWindow = new BrowserWindow({
    width: 420,
    height: ADDRESS_SUGGESTIONS_POPUP_MIN_HEIGHT,
    parent: mainWindow,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    focusable: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "addressSuggestionsPopupPreload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  addressSuggestionsPopupWindow.once("closed", () => {
    addressSuggestionsPopupWindow = null;
  });

  const html = createAddressSuggestionsPopupHtml();
  void addressSuggestionsPopupWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  return addressSuggestionsPopupWindow;
}

function showAddressSuggestionsPopup(
  anchorBounds: BrowserAnchorBoundsPayload,
  suggestions: AddressSuggestionPayload[],
  selectedIndex: number,
) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const popup = ensureAddressSuggestionsPopupWindow();
  if (!popup) {
    return;
  }

  addressSuggestionsState = { suggestions, selectedIndex };
  const contentBounds = mainWindow.getContentBounds();
  const itemHeight = 49;
  const popupHeight = Math.max(
    ADDRESS_SUGGESTIONS_POPUP_MIN_HEIGHT,
    Math.min(
      ADDRESS_SUGGESTIONS_POPUP_MAX_HEIGHT,
      suggestions.length * itemHeight + 8,
    ),
  );

  popup.setBounds({
    x: Math.round(contentBounds.x + anchorBounds.x),
    y: Math.round(contentBounds.y + anchorBounds.y + anchorBounds.height),
    width: Math.round(anchorBounds.width),
    height: popupHeight,
  });
  popup.showInactive();
  emitAddressSuggestionsState();
}

function hideAddressSuggestionsPopup() {
  addressSuggestionsState = { suggestions: [], selectedIndex: -1 };
  addressSuggestionsPopupWindow?.hide();
}

function toggleOverflowPopup(anchorBounds: BrowserAnchorBoundsPayload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const popup = ensureOverflowPopupWindow();
  if (!popup) {
    return;
  }

  overflowAnchorBounds = anchorBounds;

  if (popup.isVisible()) {
    popup.hide();
    return;
  }

  const contentBounds = mainWindow.getContentBounds();
  const x = Math.round(
    Math.min(
      Math.max(
        contentBounds.x +
          anchorBounds.x +
          anchorBounds.width -
          OVERFLOW_POPUP_WIDTH,
        contentBounds.x + 8,
      ),
      contentBounds.x + contentBounds.width - OVERFLOW_POPUP_WIDTH - 8,
    ),
  );
  const y = Math.round(
    contentBounds.y + anchorBounds.y + anchorBounds.height + 8,
  );

  popup.setBounds({
    x,
    y,
    width: OVERFLOW_POPUP_WIDTH,
    height: OVERFLOW_POPUP_HEIGHT,
  });
  popup.show();
  popup.focus();
}

function createMainWindow() {
  const titleBarOptions =
    process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 23 },
        }
      : process.platform === "win32"
        ? {
            frame: false,
          }
        : {};

  const appIcon = nativeImage.createFromPath(
    app.isPackaged
      ? path.join(process.resourcesPath, "icon.png")
      : path.join(__dirname, "..", "..", "resources", "icon.png"),
  );

  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    center: true,
    backgroundColor: "#050907",
    autoHideMenuBar: true,
    icon: appIcon,
    ...titleBarOptions,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;
  attachedBrowserTabView = null;
  attachedAppSurfaceView = null;
  reserveMainWindowClosedListenerBudget();
  browserBounds = { x: 0, y: 0, width: 0, height: 0 };
  activeBrowserWorkspaceId = "";
  activeBrowserSpaceId = "user";
  for (const workspaceId of Array.from(browserWorkspaces.keys())) {
    destroyBrowserWorkspace(workspaceId);
  }

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomFactor(1);
    win.webContents.setZoomLevel(0);
    emitBrowserState();
    emitRuntimeState(true);
    emitPendingAuthState();
    emitAppUpdateState();
    emitWindowStateChanged(win);
  });

  win.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    const isZoomHotkey =
      input.control &&
      (key === "+" ||
        key === "-" ||
        key === "=" ||
        key === "0" ||
        key === "add" ||
        key === "subtract");
    if (isZoomHotkey) {
      event.preventDefault();
      win.webContents.setZoomFactor(1);
      win.webContents.setZoomLevel(0);
    }
  });

  if (isDev) {
    void win.loadURL(RESOLVED_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.on("maximize", () => {
    emitWindowStateChanged(win);
  });
  win.on("unmaximize", () => {
    emitWindowStateChanged(win);
  });
  win.on("minimize", () => {
    emitWindowStateChanged(win);
  });
  win.on("restore", () => {
    emitWindowStateChanged(win);
  });
  win.on("enter-full-screen", () => {
    emitWindowStateChanged(win);
  });
  win.on("leave-full-screen", () => {
    emitWindowStateChanged(win);
  });

  win.once("ready-to-show", () => {
    if (process.platform === "win32") {
      win.maximize();
      win.show();
      emitWindowStateChanged(win);
      return;
    }

    const display = screen.getDisplayMatching(win.getBounds());
    const { x, y, width, height } = display.workArea;
    win.setBounds({ x, y, width, height });
    win.show();
    emitWindowStateChanged(win);
  });

  win.once("closed", () => {
    authPopupWindow?.close();
    authPopupWindow = null;
    addressSuggestionsPopupWindow?.close();
    addressSuggestionsPopupWindow = null;
    downloadsPopupWindow?.close();
    downloadsPopupWindow = null;
    historyPopupWindow?.close();
    historyPopupWindow = null;
    overflowPopupWindow?.close();
    overflowPopupWindow = null;
    for (const workspaceId of Array.from(browserWorkspaces.keys())) {
      destroyBrowserWorkspace(workspaceId);
    }
    activeBrowserWorkspaceId = "";
    activeBrowserSpaceId = "user";
    attachedBrowserTabView = null;
    attachedAppSurfaceView = null;
    closeAllFilePreviewWatchSubscriptions();
    mainWindow = null;
  });
}

const singleInstanceLock =
  process.env.HOLABOSS_DISABLE_SINGLE_INSTANCE_LOCK?.trim() === "1"
    ? true
    : app.requestSingleInstanceLock();
app.setName(APP_DISPLAY_NAME);
if (!singleInstanceLock) {
  app.quit();
} else {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(
      AUTH_CALLBACK_PROTOCOL,
      process.execPath,
      defaultAppProtocolClientArgs(),
    );
  } else {
    app.setAsDefaultProtocolClient(AUTH_CALLBACK_PROTOCOL);
  }

  app.on("second-instance", (_event, commandLine) => {
    const callbackUrl = commandLine
      .map((value) => maybeAuthCallbackUrl(value))
      .find((value) => value !== null);
    if (callbackUrl) {
      void handleAuthCallbackUrl(callbackUrl);
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.on("open-url", (event, targetUrl) => {
    event.preventDefault();
    void handleAuthCallbackUrl(targetUrl);
  });

  const initialCallbackUrl = process.argv
    .map((value) => maybeAuthCallbackUrl(value))
    .find((value) => value !== null);
  if (initialCallbackUrl) {
    void handleAuthCallbackUrl(initialCallbackUrl);
  }
}

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(
      app.isPackaged
        ? path.join(process.resourcesPath, "icon.png")
        : path.join(__dirname, "..", "..", "resources", "icon.png"),
    );
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  await loadBrowserPersistence();
  await bootstrapRuntimeDatabase();

  handleTrustedIpc(
    "fs:listDirectory",
    ["main"],
    async (_event, targetPath?: string | null, workspaceId?: string | null) =>
      listDirectory(targetPath, workspaceId),
  );
  handleTrustedIpc(
    "fs:readFilePreview",
    ["main"],
    async (_event, targetPath: string, workspaceId?: string | null) =>
      readFilePreview(targetPath, workspaceId),
  );
  handleTrustedIpc(
    "fs:writeTextFile",
    ["main"],
    async (
      _event,
      targetPath: string,
      content: string,
      workspaceId?: string | null,
    ) => writeTextFile(targetPath, content, workspaceId),
  );
  handleTrustedIpc(
    "fs:writeTableFile",
    ["main"],
    async (
      _event,
      targetPath: string,
      tableSheets: FilePreviewTableSheetPayload[],
      workspaceId?: string | null,
    ) => writeTableFile(targetPath, tableSheets, workspaceId),
  );
  handleTrustedIpc(
    "fs:watchFile",
    ["main"],
    async (_event, targetPath: string, workspaceId?: string | null) =>
      watchFilePreviewPath(targetPath, workspaceId),
  );
  handleTrustedIpc(
    "fs:unwatchFile",
    ["main"],
    async (_event, subscriptionId: string) => {
      closeFilePreviewWatchSubscription(subscriptionId);
    },
  );
  handleTrustedIpc(
    "fs:createPath",
    ["main"],
    async (
      _event,
      parentPath: string | null | undefined,
      kind: FileSystemCreateKind,
      workspaceId?: string | null,
    ) => createExplorerPath(parentPath, kind, workspaceId),
  );
  handleTrustedIpc(
    "fs:importExternalEntries",
    ["main"],
    async (
      _event,
      destinationDirectoryPath: string,
      entries: ExplorerExternalImportEntryPayload[],
      workspaceId?: string | null,
    ) =>
      importExternalExplorerEntries(
        destinationDirectoryPath,
        entries,
        workspaceId,
      ),
  );
  handleTrustedIpc(
    "fs:renamePath",
    ["main"],
    async (
      _event,
      targetPath: string,
      nextName: string,
      workspaceId?: string | null,
    ) => renameExplorerPath(targetPath, nextName, workspaceId),
  );
  handleTrustedIpc(
    "fs:movePath",
    ["main"],
    async (
      _event,
      sourcePath: string,
      destinationDirectoryPath: string,
      workspaceId?: string | null,
    ) => moveExplorerPath(sourcePath, destinationDirectoryPath, workspaceId),
  );
  handleTrustedIpc(
    "fs:deletePath",
    ["main"],
    async (_event, targetPath: string, workspaceId?: string | null) =>
      deleteExplorerPath(targetPath, workspaceId),
  );
  handleTrustedIpc("fs:getBookmarks", ["main"], () => fileBookmarks);
  handleTrustedIpc(
    "fs:addBookmark",
    ["main"],
    async (_event, targetPath: string, label?: string) => {
      const resolvedPath = path.resolve(targetPath);
      const stat = await fs.stat(resolvedPath);
      const nextLabel =
        label?.trim() || path.basename(resolvedPath) || resolvedPath;
      const existing = fileBookmarks.find(
        (bookmark) => bookmark.targetPath === resolvedPath,
      );

      if (existing) {
        if (
          existing.label !== nextLabel ||
          existing.isDirectory !== stat.isDirectory()
        ) {
          fileBookmarks = fileBookmarks.map((bookmark) =>
            bookmark.id === existing.id
              ? {
                  ...bookmark,
                  label: nextLabel,
                  isDirectory: stat.isDirectory(),
                }
              : bookmark,
          );
          emitFileBookmarksState();
          await persistFileBookmarks();
        }

        return fileBookmarks;
      }

      fileBookmarks = [
        {
          id: `file-bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          targetPath: resolvedPath,
          label: nextLabel,
          isDirectory: stat.isDirectory(),
          createdAt: new Date().toISOString(),
        },
        ...fileBookmarks,
      ];
      emitFileBookmarksState();
      await persistFileBookmarks();
      return fileBookmarks;
    },
  );
  handleTrustedIpc(
    "fs:removeBookmark",
    ["main"],
    async (_event, bookmarkId: string) => {
      fileBookmarks = fileBookmarks.filter(
        (bookmark) => bookmark.id !== bookmarkId,
      );
      emitFileBookmarksState();
      await persistFileBookmarks();
      return fileBookmarks;
    },
  );
  handleTrustedIpc("runtime:getStatus", ["main", "auth-popup"], () =>
    refreshRuntimeStatus(),
  );
  handleTrustedIpc("runtime:restart", ["main"], async () => {
    await stopEmbeddedRuntime();
    return startEmbeddedRuntime();
  });
  handleTrustedIpc("auth:getUser", ["main", "auth-popup"], async () =>
    getAuthenticatedUser(),
  );
  handleTrustedIpc("billing:getOverview", ["main"], async () =>
    getDesktopBillingOverview(),
  );
  handleTrustedIpc(
    "billing:getUsage",
    ["main"],
    async (_event, limit?: number) =>
      getDesktopBillingUsage(typeof limit === "number" ? limit : 10),
  );
  handleTrustedIpc("billing:getLinks", ["main"], async () =>
    buildDesktopBillingLinks(),
  );
  handleTrustedIpc("auth:requestAuth", ["main", "auth-popup"], async () => {
    await requireAuthClient().requestAuth();
  });
  handleTrustedIpc("auth:signOut", ["main", "auth-popup"], async () => {
    try {
      await requireAuthClient().signOut();
    } finally {
      clearPersistedAuthCookie();
    }
    const runtimeConfig = await readRuntimeConfigFile();
    if (
      runtimeConfigIsControlPlaneManaged(runtimeConfig) &&
      runtimeModelProxyApiKeyFromConfig(runtimeConfig)
    ) {
      await clearRuntimeBindingSecrets("auth_sign_out");
    }
    pendingAuthError = null;
    emitAuthUserUpdated(null);
  });
  handleTrustedIpc(
    "auth:showPopup",
    ["main"],
    (_event, anchorBounds: BrowserAnchorBoundsPayload) => {
      showAuthPopup(anchorBounds);
    },
  );
  handleTrustedIpc(
    "auth:togglePopup",
    ["main"],
    (_event, anchorBounds: BrowserAnchorBoundsPayload) => {
      toggleAuthPopup(anchorBounds);
    },
  );
  handleTrustedIpc(
    "auth:scheduleClosePopup",
    ["main", "auth-popup"],
    (_event, delayMs?: number) => {
      scheduleAuthPopupHide(
        typeof delayMs === "number" ? delayMs : AUTH_POPUP_CLOSE_DELAY_MS,
      );
    },
  );
  handleTrustedIpc("auth:cancelClosePopup", ["main", "auth-popup"], () => {
    clearScheduledAuthPopupHide();
  });
  handleTrustedIpc("auth:closePopup", ["main", "auth-popup"], () => {
    hideAuthPopup();
  });
  handleTrustedIpc("runtime:getConfig", ["main", "auth-popup"], () =>
    getRuntimeConfig(),
  );
  handleTrustedIpc("runtime:getProfile", ["main", "auth-popup"], () =>
    getRuntimeUserProfile(),
  );
  handleTrustedIpc("runtime:getConfigDocument", ["main", "auth-popup"], () =>
    getRuntimeConfigDocumentText(),
  );
  handleTrustedIpc(
    "runtime:setConfig",
    ["main", "auth-popup"],
    async (_event, payload: RuntimeConfigUpdatePayload) => {
      const currentConfig = await readRuntimeConfigFile();
      const nextConfig = await writeRuntimeConfigFile(payload);
      await restartEmbeddedRuntimeIfNeeded(currentConfig, nextConfig);
      const config = await getRuntimeConfig();
      await emitRuntimeConfig(config);
      return config;
    },
  );
  handleTrustedIpc(
    "runtime:setProfile",
    ["main", "auth-popup"],
    async (_event, payload: RuntimeUserProfileUpdatePayload) =>
      setRuntimeUserProfile(payload ?? {}),
  );
  handleTrustedIpc(
    "runtime:setConfigDocument",
    ["main", "auth-popup"],
    async (_event, rawDocument: string) =>
      setRuntimeConfigDocument(rawDocument),
  );
  handleTrustedIpc(
    "ui:getTheme",
    ["main", "auth-popup"],
    async () => currentTheme,
  );
  handleTrustedIpc(
    "ui:openSettingsPane",
    ["main", "auth-popup"],
    async (_event, section?: UiSettingsPaneSection) => {
      emitOpenSettingsPane(section ?? "settings");
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
      }
    },
  );
  handleTrustedIpc(
    "ui:openExternalUrl",
    ["main", "auth-popup"],
    async (_event, rawUrl: string) => {
      await openExternalUrl(rawUrl);
    },
  );
  handleTrustedIpc("ui:getWindowState", ["main"], async (event) => {
    return desktopWindowStatePayload(
      resolveTargetWindow(BrowserWindow.fromWebContents(event.sender)),
    );
  });
  handleTrustedIpc("ui:minimizeWindow", ["main"], async (event) => {
    const targetWindow = resolveTargetWindow(
      BrowserWindow.fromWebContents(event.sender),
    );
    if (!targetWindow) {
      return;
    }
    targetWindow.minimize();
  });
  handleTrustedIpc("ui:toggleWindowSize", ["main"], async (event) => {
    const targetWindow = resolveTargetWindow(
      BrowserWindow.fromWebContents(event.sender),
    );
    if (!targetWindow) {
      return;
    }

    if (targetWindow.isFullScreen()) {
      targetWindow.setFullScreen(false);
      return;
    }

    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
      return;
    }

    targetWindow.maximize();
  });
  handleTrustedIpc("ui:closeWindow", ["main"], async (event) => {
    const targetWindow = resolveTargetWindow(
      BrowserWindow.fromWebContents(event.sender),
    );
    if (!targetWindow) {
      return;
    }
    targetWindow.close();
  });
  handleTrustedIpc(
    "ui:setTheme",
    ["main", "auth-popup"],
    async (_event, theme: string) => {
      currentTheme = APP_THEMES.has(theme) ? theme : "holaboss";
      emitThemeChanged();
      authPopupWindow?.close();
      authPopupWindow = null;
      downloadsPopupWindow?.close();
      downloadsPopupWindow = null;
      historyPopupWindow?.close();
      historyPopupWindow = null;
      overflowPopupWindow?.close();
      overflowPopupWindow = null;
      addressSuggestionsPopupWindow?.close();
      addressSuggestionsPopupWindow = null;
    },
  );
  handleTrustedIpc(
    "appUpdate:getStatus",
    ["main"],
    async () => appUpdateStatus,
  );
  handleTrustedIpc("appUpdate:checkNow", ["main"], async () =>
    checkForAppUpdates(),
  );
  handleTrustedIpc(
    "appUpdate:dismiss",
    ["main"],
    async (_event, version?: string | null) => dismissAppUpdate(version),
  );
  handleTrustedIpc(
    "appUpdate:setChannel",
    ["main"],
    async (_event, channel: AppUpdateChannel) => setAppUpdateChannel(channel),
  );
  handleTrustedIpc("appUpdate:installNow", ["main"], async () => {
    installAppUpdateNow();
  });
  handleTrustedIpc(
    "runtime:exchangeBinding",
    ["main", "auth-popup"],
    async (_event, sandboxId: string) => {
      const binding = await exchangeDesktopRuntimeBinding(sandboxId);
      const modelProxyApiKey = runtimeBindingModelProxyApiKey(binding);
      if (!modelProxyApiKey) {
        throw new Error(
          "Runtime binding response missing model_proxy_api_key.",
        );
      }
      const currentConfig = await readRuntimeConfigFile();
      const nextConfig = await writeRuntimeConfigFile({
        authToken: modelProxyApiKey,
        modelProxyApiKey,
        userId: binding.holaboss_user_id,
        sandboxId: binding.sandbox_id,
        modelProxyBaseUrl: (binding.model_proxy_base_url || "").replace(
          "host.docker.internal",
          "127.0.0.1",
        ),
        defaultModel: binding.default_model,
        defaultBackgroundModel: binding.default_background_model ?? null,
        defaultEmbeddingModel: binding.default_embedding_model ?? null,
        defaultImageModel: binding.default_image_model ?? null,
        controlPlaneBaseUrl: DESKTOP_CONTROL_PLANE_BASE_URL,
      });
      await syncRuntimeModelCatalogFromBinding(binding);
      await restartEmbeddedRuntimeIfNeeded(currentConfig, nextConfig);
      const config = await getRuntimeConfig();
      await emitRuntimeConfig(config);
      return config;
    },
  );
  handleTrustedIpc("workspace:getClientConfig", ["main"], () =>
    getHolabossClientConfig(),
  );
  handleTrustedIpc("workspace:listMarketplaceTemplates", ["main"], async () =>
    listMarketplaceTemplates(),
  );
  handleTrustedIpc("workspace:pickTemplateFolder", ["main"], async () =>
    pickTemplateFolder(),
  );
  handleTrustedIpc(
    "workspace:listImportBrowserProfiles",
    ["main"],
    async (_event, source: BrowserImportSource) =>
      listImportBrowserProfiles(source),
  );
  handleTrustedIpc(
    "workspace:importBrowserProfile",
    ["main"],
    async (_event, payload: BrowserImportProfilePayload) =>
      importBrowserProfileIntoWorkspace(payload),
  );
  handleTrustedIpc(
    "workspace:copyBrowserWorkspaceProfile",
    ["main"],
    async (_event, payload: BrowserCopyWorkspaceProfilePayload) =>
      copyBrowserWorkspaceProfile(payload),
  );
  handleTrustedIpc(
    "workspace:listWorkspaces",
    ["main", "auth-popup"],
    async () => listWorkspaces(),
  );
  handleTrustedIpc(
    "workspace:getWorkspaceLifecycle",
    ["main"],
    async (_event, workspaceId: string) => getWorkspaceLifecycle(workspaceId),
  );
  handleTrustedIpc(
    "workspace:activateWorkspace",
    ["main"],
    async (_event, workspaceId: string) => activateWorkspace(workspaceId),
  );
  handleTrustedIpc(
    "workspace:listInstalledApps",
    ["main"],
    async (_event, workspaceId: string) => listInstalledApps(workspaceId),
  );
  handleTrustedIpc(
    "workspace:removeInstalledApp",
    ["main"],
    async (_event, workspaceId: string, appId: string) =>
      removeInstalledApp(workspaceId, appId),
  );
  handleTrustedIpc(
    "workspace:listAppCatalog",
    ["main"],
    async (_event, params: { source?: "marketplace" | "local" }) =>
      listAppCatalog(params),
  );
  handleTrustedIpc(
    "workspace:syncAppCatalog",
    ["main"],
    async (_event, params: { source: "marketplace" | "local" }) =>
      syncAppCatalog(params),
  );
  handleTrustedIpc(
    "workspace:installAppFromCatalog",
    ["main"],
    async (_event, params: InstallAppFromCatalogRequest) =>
      installAppFromCatalog({
        workspaceId: params.workspaceId,
        appId: params.appId,
        source: params.source,
      }),
  );
  handleTrustedIpc(
    "appSurface:navigate",
    ["main"],
    async (_event, workspaceId: string, appId: string, urlPath?: string) =>
      navigateAppSurface(workspaceId, appId, urlPath),
  );
  handleTrustedIpc(
    "appSurface:setBounds",
    ["main"],
    (_event, bounds: BrowserBoundsPayload) => {
      setAppSurfaceBounds(bounds);
    },
  );
  handleTrustedIpc("appSurface:reload", ["main"], (_event, appId: string) => {
    appSurfaceViews.get(appId)?.webContents.reload();
  });
  handleTrustedIpc("appSurface:destroy", ["main"], (_event, appId: string) => {
    destroyAppSurfaceView(appId);
  });
  handleTrustedIpc("appSurface:hide", ["main"], () => {
    hideAppSurface();
  });
  handleTrustedIpc(
    "appSurface:resolveUrl",
    ["main"],
    async (_event, workspaceId: string, appId: string, urlPath?: string) =>
      resolveAppSurfaceUrl(workspaceId, appId, urlPath),
  );
  handleTrustedIpc(
    "workspace:listOutputs",
    ["main"],
    async (_event, payload: string | HolabossListOutputsPayload) =>
      listOutputs(payload),
  );
  handleTrustedIpc(
    "workspace:listSkills",
    ["main"],
    async (_event, workspaceId: string) => listWorkspaceSkills(workspaceId),
  );
  handleTrustedIpc(
    "workspace:getWorkspaceRoot",
    ["main"],
    async (_event, workspaceId: string) => workspaceDirectoryPath(workspaceId),
  );
  handleTrustedIpc(
    "workspace:setOperatorSurfaceContext",
    ["main"],
    async (_event, workspaceId: string, context: unknown) => {
      const normalizedWorkspaceId = workspaceId.trim();
      if (!normalizedWorkspaceId) {
        return;
      }
      const normalizedContext = normalizeReportedOperatorSurfaceContext(context);
      if (!normalizedContext) {
        reportedOperatorSurfaceContexts.delete(normalizedWorkspaceId);
        return;
      }
      reportedOperatorSurfaceContexts.set(
        normalizedWorkspaceId,
        normalizedContext,
      );
    },
  );
  handleTrustedIpc(
    "workspace:createWorkspace",
    ["main"],
    async (_event, payload: HolabossCreateWorkspacePayload) =>
      createWorkspace(payload),
  );
  handleTrustedIpc(
    "workspace:deleteWorkspace",
    ["main"],
    async (_event, workspaceId: string) => deleteWorkspace(workspaceId),
  );
  handleTrustedIpc(
    "workspace:listCronjobs",
    ["main"],
    async (_event, workspaceId: string, enabledOnly?: boolean) =>
      listCronjobs(workspaceId, enabledOnly),
  );
  handleTrustedIpc(
    "workspace:createCronjob",
    ["main"],
    async (_event, payload: CronjobCreatePayload) => createCronjob(payload),
  );
  handleTrustedIpc(
    "workspace:runCronjobNow",
    ["main"],
    async (_event, jobId: string) => runCronjobNow(jobId),
  );
  handleTrustedIpc(
    "workspace:updateCronjob",
    ["main"],
    async (_event, jobId: string, payload: CronjobUpdatePayload) =>
      updateCronjob(jobId, payload),
  );
  handleTrustedIpc(
    "workspace:deleteCronjob",
    ["main"],
    async (_event, jobId: string) => deleteCronjob(jobId),
  );
  handleTrustedIpc(
    "workspace:listNotifications",
    ["main"],
    async (_event, workspaceId?: string | null, includeDismissed?: boolean) =>
      listNotifications(workspaceId, includeDismissed),
  );
  handleTrustedIpc(
    "workspace:updateNotification",
    ["main"],
    async (
      _event,
      notificationId: string,
      payload: RuntimeNotificationUpdatePayload,
    ) => updateNotification(notificationId, payload),
  );
  handleTrustedIpc(
    "workspace:listTaskProposals",
    ["main"],
    async (_event, workspaceId: string) => listTaskProposals(workspaceId),
  );
  handleTrustedIpc(
    "workspace:acceptTaskProposal",
    ["main"],
    async (_event, payload: TaskProposalAcceptPayload) =>
      acceptTaskProposal(payload),
  );
  handleTrustedIpc(
    "workspace:listMemoryUpdateProposals",
    ["main"],
    async (_event, payload: MemoryUpdateProposalListRequestPayload) =>
      listMemoryUpdateProposals(payload),
  );
  handleTrustedIpc(
    "workspace:acceptMemoryUpdateProposal",
    ["main"],
    async (_event, payload: MemoryUpdateProposalAcceptPayload) =>
      acceptMemoryUpdateProposal(payload),
  );
  handleTrustedIpc(
    "workspace:dismissMemoryUpdateProposal",
    ["main"],
    async (_event, proposalId: string) =>
      dismissMemoryUpdateProposal(proposalId),
  );
  handleTrustedIpc(
    "workspace:getProactiveStatus",
    ["main"],
    async (_event, workspaceId: string) => getProactiveStatus(workspaceId),
  );
  handleTrustedIpc(
    "workspace:updateTaskProposalState",
    ["main"],
    async (_event, proposalId: string, state: string) =>
      updateTaskProposalState(proposalId, state),
  );
  handleTrustedIpc(
    "workspace:requestRemoteTaskProposalGeneration",
    ["main"],
    async (_event, payload: RemoteTaskProposalGenerationRequestPayload) =>
      requestRemoteTaskProposalGeneration(payload),
  );
  handleTrustedIpc(
    "workspace:setProactiveTaskProposalPreference",
    ["main"],
    async (_event, payload: ProactiveTaskProposalPreferenceUpdatePayload) =>
      setProactiveTaskProposalPreference(payload),
  );
  handleTrustedIpc(
    "workspace:getProactiveTaskProposalPreference",
    ["main"],
    async () => getProactiveTaskProposalPreference(),
  );
  handleTrustedIpc(
    "workspace:getProactiveHeartbeatConfig",
    ["main"],
    async () => getProactiveHeartbeatConfig(),
  );
  handleTrustedIpc(
    "workspace:setProactiveHeartbeatConfig",
    ["main"],
    async (_event, payload: ProactiveHeartbeatConfigUpdatePayload) =>
      setProactiveHeartbeatConfig(payload),
  );
  handleTrustedIpc(
    "workspace:setProactiveHeartbeatWorkspaceEnabled",
    ["main"],
    async (_event, payload: ProactiveHeartbeatWorkspaceUpdatePayload) =>
      setProactiveHeartbeatWorkspaceEnabled(payload),
  );
  handleTrustedIpc(
    "workspace:listRuntimeStates",
    ["main"],
    async (_event, workspaceId: string) => listRuntimeStates(workspaceId),
  );
  handleTrustedIpc(
    "workspace:listAgentSessions",
    ["main"],
    async (_event, workspaceId: string) => listAgentSessions(workspaceId),
  );
  handleTrustedIpc(
    "workspace:createAgentSession",
    ["main"],
    async (_event, payload: CreateAgentSessionPayload) =>
      createAgentSession(payload),
  );
  handleTrustedIpc(
    "workspace:getSessionHistory",
    ["main"],
    async (_event, payload: { sessionId: string; workspaceId: string }) =>
      getSessionHistory(payload.sessionId, payload.workspaceId),
  );
  handleTrustedIpc(
    "workspace:getSessionOutputEvents",
    ["main"],
    async (_event, payload: { sessionId: string }) =>
      getSessionOutputEvents(payload.sessionId),
  );
  handleTrustedIpc(
    "workspace:stageSessionAttachments",
    ["main"],
    async (_event, payload: StageSessionAttachmentsPayload) =>
      stageSessionAttachments(payload),
  );
  handleTrustedIpc(
    "workspace:stageSessionAttachmentPaths",
    ["main"],
    async (_event, payload: StageSessionAttachmentPathsPayload) =>
      stageSessionAttachmentPaths(payload),
  );
  handleTrustedIpc(
    "workspace:queueSessionInput",
    ["main"],
    async (_event, payload: HolabossQueueSessionInputPayload) =>
      queueSessionInput(payload),
  );
  handleTrustedIpc(
    "workspace:pauseSessionRun",
    ["main"],
    async (_event, payload: HolabossPauseSessionRunPayload) =>
      pauseSessionRun(payload),
  );
  handleTrustedIpc(
    "workspace:openSessionOutputStream",
    ["main"],
    async (_event, payload: HolabossStreamSessionOutputsPayload) =>
      openSessionOutputStream(payload),
  );
  handleTrustedIpc(
    "workspace:closeSessionOutputStream",
    ["main"],
    async (_event, streamId: string, reason?: string) =>
      closeSessionOutputStream(streamId, reason),
  );
  handleTrustedIpc("workspace:getSessionStreamDebug", ["main"], async () =>
    verboseTelemetryEnabled ? sessionStreamDebugLog.slice(-600) : [],
  );
  handleTrustedIpc(
    "workspace:isVerboseTelemetryEnabled",
    ["main"],
    async () => verboseTelemetryEnabled,
  );
  handleTrustedIpc("workspace:listIntegrationCatalog", ["main"], async () =>
    listIntegrationCatalog(),
  );
  handleTrustedIpc(
    "workspace:listIntegrationConnections",
    ["main"],
    async (_event, params?: { providerId?: string; ownerUserId?: string }) =>
      listIntegrationConnections(params),
  );
  handleTrustedIpc(
    "workspace:listIntegrationBindings",
    ["main"],
    async (_event, workspaceId: string) => listIntegrationBindings(workspaceId),
  );
  handleTrustedIpc(
    "workspace:upsertIntegrationBinding",
    ["main"],
    async (
      _event,
      workspaceId: string,
      targetType: string,
      targetId: string,
      integrationKey: string,
      payload: IntegrationUpsertBindingPayload,
    ) =>
      upsertIntegrationBinding(
        workspaceId,
        targetType,
        targetId,
        integrationKey,
        payload,
      ),
  );
  handleTrustedIpc(
    "workspace:deleteIntegrationBinding",
    ["main"],
    async (_event, bindingId: string, workspaceId: string) =>
      deleteIntegrationBinding(bindingId, workspaceId),
  );
  handleTrustedIpc(
    "workspace:createIntegrationConnection",
    ["main"],
    async (_event, payload: IntegrationCreateConnectionPayload) =>
      createIntegrationConnection(payload),
  );
  handleTrustedIpc(
    "workspace:updateIntegrationConnection",
    ["main"],
    async (
      _event,
      connectionId: string,
      payload: IntegrationUpdateConnectionPayload,
    ) => updateIntegrationConnection(connectionId, payload),
  );
  handleTrustedIpc(
    "workspace:deleteIntegrationConnection",
    ["main"],
    async (_event, connectionId: string) =>
      deleteIntegrationConnection(connectionId),
  );
  handleTrustedIpc("workspace:listOAuthConfigs", ["main"], async () =>
    listOAuthConfigs(),
  );
  handleTrustedIpc(
    "workspace:upsertOAuthConfig",
    ["main"],
    async (_event, providerId: string, payload: OAuthAppConfigUpsertPayload) =>
      upsertOAuthConfig(providerId, payload),
  );
  handleTrustedIpc(
    "workspace:deleteOAuthConfig",
    ["main"],
    async (_event, providerId: string) => deleteOAuthConfig(providerId),
  );
  handleTrustedIpc(
    "workspace:startOAuthFlow",
    ["main"],
    async (_event, provider: string) => startOAuthFlow(provider),
  );
  handleTrustedIpc("workspace:composioListToolkits", ["main"], async () =>
    composioListToolkits(),
  );
  handleTrustedIpc(
    "workspace:composioConnect",
    ["main"],
    async (
      _event,
      payload: {
        provider: string;
        owner_user_id: string;
        callback_url?: string;
      },
    ) => composioConnect(payload),
  );
  handleTrustedIpc(
    "workspace:composioAccountStatus",
    ["main"],
    async (_event, connectedAccountId: string) =>
      composioAccountStatus(connectedAccountId),
  );
  handleTrustedIpc(
    "workspace:composioFinalize",
    ["main"],
    async (
      _event,
      payload: {
        connected_account_id: string;
        provider: string;
        owner_user_id: string;
        account_label?: string;
      },
    ) => composioFinalize(payload),
  );
  handleTrustedIpc(
    "workspace:resolveTemplateIntegrations",
    ["main"],
    async (_event, payload: HolabossCreateWorkspacePayload) =>
      resolveTemplateIntegrations(payload),
  );
  handleTrustedIpc(
    "workspace:createSubmission",
    ["main"],
    async (
      _event,
      payload: {
        workspaceId: string;
        name: string;
        description: string;
        category: string;
        tags: string[];
        apps: string[];
        onboardingMd: string | null;
        readmeMd: string | null;
      },
    ) => {
      const holabossUserId = await controlPlaneWorkspaceUserId();
      const client = getMarketplaceAppSdkClient();
      return await sdkCreateMarketplaceSubmission(
        {
          workspace_id: payload.workspaceId,
          name: payload.name,
          description: payload.description,
          category: payload.category,
          tags: payload.tags,
          apps: payload.apps,
          onboarding_md: payload.onboardingMd,
          readme_md: payload.readmeMd,
          holaboss_user_id: holabossUserId,
        },
        { client },
      );
    },
  );
  handleTrustedIpc(
    "workspace:packageAndUploadWorkspace",
    ["main"],
    async (
      _event,
      params: {
        workspaceId: string;
        apps: string[];
        manifest: Record<string, unknown>;
        uploadUrl: string;
      },
    ) => {
      try {
        const { packageWorkspace, uploadToPresignedUrl } =
          await import("./workspace-packager.js");
        const workspaceDir = workspaceDirectoryPath(params.workspaceId);
        const result = await packageWorkspace({
          workspaceDir,
          apps: params.apps,
          manifest: params.manifest,
        });
        await uploadToPresignedUrl(params.uploadUrl, result.archiveBuffer);
        return { archiveSizeBytes: result.archiveSizeBytes };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`packageAndUploadWorkspace failed: ${msg}`);
      }
    },
  );
  handleTrustedIpc(
    "workspace:finalizeSubmission",
    ["main"],
    async (_event, submissionId: string) => {
      const holabossUserId = await controlPlaneWorkspaceUserId();
      const client = getMarketplaceAppSdkClient();
      return await sdkFinalizeMarketplaceSubmission(
        submissionId,
        { holaboss_user_id: holabossUserId },
        { client },
      );
    },
  );
  handleTrustedIpc(
    "workspace:generateTemplateContent",
    ["main"],
    async (
      _event,
      params: {
        contentType: "onboarding" | "readme";
        name: string;
        description: string;
        category: string;
        tags: string[];
        apps: string[];
      },
    ) => {
      const client = getMarketplaceAppSdkClient();
      return await sdkGenerateMarketplaceTemplateContent(
        {
          content_type: params.contentType,
          name: params.name,
          description: params.description,
          category: params.category,
          tags: params.tags,
          apps: params.apps,
        },
        { client },
      );
    },
  );
  handleTrustedIpc("workspace:listSubmissions", ["main"], async () => {
    const authorId = await controlPlaneWorkspaceUserId();
    if (!authorId) {
      throw new Error("Not authenticated — sign in first.");
    }
    const client = getMarketplaceAppSdkClient();
    const data = await sdkListMarketplaceSubmissions(
      { author_id: authorId },
      { client },
    );
    return data as SubmissionListResponsePayload;
  });
  handleTrustedIpc(
    "workspace:deleteSubmission",
    ["main"],
    async (_event: unknown, params: { submissionId: string }) => {
      const authorId = await controlPlaneWorkspaceUserId();
      if (!authorId) {
        throw new Error("Not authenticated — sign in first.");
      }
      const client = getMarketplaceAppSdkClient();
      const data = await sdkDeleteMarketplaceSubmission(
        params.submissionId,
        { author_id: authorId },
        { client },
      );
      return data as { deleted: boolean };
    },
  );
  handleTrustedIpc("diagnostics:exportBundle", ["main"], async () =>
    exportDesktopDiagnosticsBundle(),
  );
  ipcMain.handle(
    "browser:setActiveWorkspace",
    async (
      _event,
      workspaceId?: string | null,
      space?: BrowserSpaceId | null,
    ) => {
      return setActiveBrowserWorkspace(workspaceId, space);
    },
  );
  ipcMain.handle("browser:getState", async () => {
    await ensureBrowserWorkspace(undefined, activeBrowserSpaceId);
    return browserWorkspaceSnapshot(undefined, activeBrowserSpaceId);
  });
  ipcMain.handle(
    "browser:setBounds",
    async (_event, bounds: BrowserBoundsPayload) => {
      setBrowserBounds(bounds);
      return browserWorkspaceSnapshot(undefined, activeBrowserSpaceId);
    },
  );
  ipcMain.handle("browser:navigate", async (_event, targetUrl: string) => {
    if (!activeBrowserWorkspaceId) {
      return emptyBrowserTabListPayload(activeBrowserSpaceId);
    }
    return navigateActiveBrowserTab(
      activeBrowserWorkspaceId,
      targetUrl,
      activeBrowserSpaceId,
    );
  });
  ipcMain.handle("browser:back", async () => {
    await ensureBrowserWorkspace(undefined, activeBrowserSpaceId);
    const activeTab = getActiveBrowserTab(undefined, activeBrowserSpaceId);
    if (activeTab?.view.webContents.navigationHistory.canGoBack()) {
      activeTab.view.webContents.navigationHistory.goBack();
    }
    return browserWorkspaceSnapshot(undefined, activeBrowserSpaceId);
  });
  ipcMain.handle("browser:forward", async () => {
    await ensureBrowserWorkspace(undefined, activeBrowserSpaceId);
    const activeTab = getActiveBrowserTab(undefined, activeBrowserSpaceId);
    if (activeTab?.view.webContents.navigationHistory.canGoForward()) {
      activeTab.view.webContents.navigationHistory.goForward();
    }
    return browserWorkspaceSnapshot(undefined, activeBrowserSpaceId);
  });
  ipcMain.handle("browser:reload", async () => {
    await ensureBrowserWorkspace(undefined, activeBrowserSpaceId);
    getActiveBrowserTab(
      undefined,
      activeBrowserSpaceId,
    )?.view.webContents.reload();
    return browserWorkspaceSnapshot(undefined, activeBrowserSpaceId);
  });
  ipcMain.handle("browser:stopLoading", async () => {
    await ensureBrowserWorkspace(undefined, activeBrowserSpaceId);
    const activeTab = getActiveBrowserTab(undefined, activeBrowserSpaceId);
    if (activeTab?.view.webContents.isLoadingMainFrame()) {
      activeTab.view.webContents.stop();
    }
    return browserWorkspaceSnapshot(undefined, activeBrowserSpaceId);
  });
  ipcMain.handle("browser:newTab", async (_event, targetUrl?: string) => {
    const workspace = await ensureBrowserWorkspace(
      undefined,
      activeBrowserSpaceId,
    );
    const tabSpace = browserTabSpaceState(workspace, activeBrowserSpaceId);
    if (!workspace) {
      return emptyBrowserTabListPayload(activeBrowserSpaceId);
    }
    const nextTabId = createBrowserTab(workspace.workspaceId, {
      url: targetUrl,
      browserSpace: activeBrowserSpaceId,
    });
    if (nextTabId && tabSpace) {
      tabSpace.activeTabId = nextTabId;
      updateAttachedBrowserView();
      emitBrowserState(workspace.workspaceId, activeBrowserSpaceId);
      await persistBrowserWorkspace(workspace.workspaceId);
    }
    return browserWorkspaceSnapshot(
      workspace.workspaceId,
      activeBrowserSpaceId,
    );
  });
  ipcMain.handle("browser:setActiveTab", async (_event, tabId: string) => {
    await ensureBrowserWorkspace(undefined, activeBrowserSpaceId);
    return setActiveBrowserTab(tabId, activeBrowserSpaceId);
  });
  ipcMain.handle("browser:closeTab", async (_event, tabId: string) => {
    await ensureBrowserWorkspace(undefined, activeBrowserSpaceId);
    return closeBrowserTab(tabId, activeBrowserSpaceId);
  });
  ipcMain.handle("browser:getBookmarks", async () => {
    const workspace = await ensureBrowserWorkspace();
    return workspace?.bookmarks ?? [];
  });
  ipcMain.handle(
    "browser:addBookmark",
    async (_event, payload: { url: string; title?: string }) => {
      const workspace = await ensureBrowserWorkspace();
      const url = payload.url.trim();
      if (!workspace || !url) {
        return workspace?.bookmarks ?? [];
      }

      const activeTab = getActiveBrowserTab(undefined, activeBrowserSpaceId);
      const faviconUrl =
        activeTab?.state.url === url ? activeTab.state.faviconUrl : undefined;

      const existing = workspace.bookmarks.find(
        (bookmark) => bookmark.url === url,
      );
      if (existing) {
        const nextTitle = payload.title?.trim() || existing.title;
        const nextFaviconUrl = faviconUrl || existing.faviconUrl;
        if (
          nextTitle !== existing.title ||
          nextFaviconUrl !== existing.faviconUrl
        ) {
          workspace.bookmarks = workspace.bookmarks.map((bookmark) =>
            bookmark.id === existing.id
              ? { ...bookmark, title: nextTitle, faviconUrl: nextFaviconUrl }
              : bookmark,
          );
          emitBookmarksState(workspace.workspaceId);
          await persistBrowserWorkspace(workspace.workspaceId);
        }
        return workspace.bookmarks;
      }

      workspace.bookmarks = [
        {
          id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url,
          title: payload.title?.trim() || url,
          faviconUrl,
          createdAt: new Date().toISOString(),
        },
        ...workspace.bookmarks,
      ];
      emitBookmarksState(workspace.workspaceId);
      await persistBrowserWorkspace(workspace.workspaceId);
      return workspace.bookmarks;
    },
  );
  ipcMain.handle(
    "browser:removeBookmark",
    async (_event, bookmarkId: string) => {
      const workspace = await ensureBrowserWorkspace();
      if (!workspace) {
        return [];
      }
      workspace.bookmarks = workspace.bookmarks.filter(
        (bookmark) => bookmark.id !== bookmarkId,
      );
      emitBookmarksState(workspace.workspaceId);
      await persistBrowserWorkspace(workspace.workspaceId);
      return workspace.bookmarks;
    },
  );
  ipcMain.handle("browser:getDownloads", async () => {
    const workspace = await ensureBrowserWorkspace();
    return workspace?.downloads ?? [];
  });
  ipcMain.handle("browser:getHistory", async () => {
    const workspace = await ensureBrowserWorkspace();
    return workspace?.history ?? [];
  });
  ipcMain.handle(
    "browser:showAddressSuggestions",
    (
      _event,
      anchorBounds: BrowserAnchorBoundsPayload,
      suggestions: AddressSuggestionPayload[],
      selectedIndex: number,
    ) => {
      showAddressSuggestionsPopup(anchorBounds, suggestions, selectedIndex);
    },
  );
  ipcMain.handle("browser:hideAddressSuggestions", () => {
    hideAddressSuggestionsPopup();
  });
  ipcMain.handle("browser:chooseAddressSuggestion", (_event, index: number) => {
    hideAddressSuggestionsPopup();
    mainWindow?.webContents.send("browser:addressSuggestionChosen", index);
  });
  ipcMain.handle(
    "browser:toggleOverflowPopup",
    (_event, anchorBounds: BrowserAnchorBoundsPayload) => {
      toggleOverflowPopup(anchorBounds);
    },
  );
  ipcMain.handle("browser:overflowOpenHistory", () => {
    overflowPopupWindow?.hide();
    if (overflowAnchorBounds) {
      toggleHistoryPopup(overflowAnchorBounds);
    }
  });
  ipcMain.handle("browser:overflowOpenDownloads", () => {
    overflowPopupWindow?.hide();
    if (overflowAnchorBounds) {
      toggleDownloadsPopup(overflowAnchorBounds);
    }
  });
  ipcMain.handle("browser:overflowImportChrome", async () => {
    overflowPopupWindow?.hide();

    try {
      const summary = await importChromeProfileIntoWorkspace(
        activeBrowserWorkspaceId,
      );
      if (!summary) {
        return;
      }

      const detailLines = [
        `Profile: ${summary.sourceProfileLabel}`,
        `Location: ${summary.sourceProfileDir}`,
        `Bookmarks imported: ${summary.importedBookmarks}`,
        `History entries imported: ${summary.importedHistoryEntries}`,
        `Cookies imported: ${summary.importedCookies}`,
      ];
      if (summary.skippedCookies > 0) {
        detailLines.push(`Cookies skipped: ${summary.skippedCookies}`);
      }
      if (summary.warnings.length > 0) {
        detailLines.push("", "Warnings:", ...summary.warnings.map((warning) => `- ${warning}`));
      }

      const ownerWindow =
        mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const messageBoxOptions = {
        type: summary.warnings.length > 0 ? "warning" : "info",
        title: "Chrome Import Complete",
        message: "Chrome data was imported into this workspace browser.",
        detail: detailLines.join("\n"),
      } as const;
      if (ownerWindow) {
        await dialog.showMessageBox(ownerWindow, messageBoxOptions);
      } else {
        await dialog.showMessageBox(messageBoxOptions);
      }
    } catch (error) {
      const ownerWindow =
        mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const messageBoxOptions = {
        type: "error",
        title: "Chrome Import Failed",
        message: "Could not import data from Chrome.",
        detail:
          error instanceof Error
            ? error.message
            : "The Chrome import did not complete.",
      } as const;
      if (ownerWindow) {
        await dialog.showMessageBox(ownerWindow, messageBoxOptions);
      } else {
        await dialog.showMessageBox(messageBoxOptions);
      }
    }
  });
  ipcMain.handle(
    "browser:toggleHistoryPopup",
    (_event, anchorBounds: BrowserAnchorBoundsPayload) => {
      toggleHistoryPopup(anchorBounds);
    },
  );
  ipcMain.handle("browser:closeHistoryPopup", () => {
    historyPopupWindow?.hide();
  });
  ipcMain.handle(
    "browser:openHistoryUrl",
    async (_event, targetUrl: string) => {
      const workspace = await ensureBrowserWorkspace(
        undefined,
        activeBrowserSpaceId,
      );
      const activeTab = getActiveBrowserTab(undefined, activeBrowserSpaceId);
      if (!workspace || !activeTab) {
        return browserWorkspaceSnapshot(undefined, activeBrowserSpaceId);
      }

      try {
        historyPopupWindow?.hide();
        activeTab.state = { ...activeTab.state, error: "" };
        await activeTab.view.webContents.loadURL(targetUrl);
      } catch (error) {
        if (isAbortedBrowserLoadError(error)) {
          return browserWorkspaceSnapshot(workspace.workspaceId, activeBrowserSpaceId);
        }
        activeTab.state = {
          ...activeTab.state,
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load URL.",
        };
        emitBrowserState(workspace.workspaceId, activeBrowserSpaceId);
      }

      return browserWorkspaceSnapshot(
        workspace.workspaceId,
        activeBrowserSpaceId,
      );
    },
  );
  ipcMain.handle(
    "browser:removeHistoryEntry",
    async (_event, historyId: string) => {
      const workspace = await ensureBrowserWorkspace();
      if (!workspace) {
        return [];
      }
      workspace.history = workspace.history.filter(
        (entry) => entry.id !== historyId,
      );
      emitHistoryState(workspace.workspaceId);
      await persistBrowserWorkspace(workspace.workspaceId);
      return workspace.history;
    },
  );
  ipcMain.handle("browser:clearHistory", async () => {
    const workspace = await ensureBrowserWorkspace();
    if (!workspace) {
      return [];
    }
    workspace.history = [];
    emitHistoryState(workspace.workspaceId);
    await persistBrowserWorkspace(workspace.workspaceId);
    return workspace.history;
  });
  ipcMain.handle(
    "browser:toggleDownloadsPopup",
    (_event, anchorBounds: BrowserAnchorBoundsPayload) => {
      toggleDownloadsPopup(anchorBounds);
    },
  );
  ipcMain.handle("browser:closeDownloadsPopup", () => {
    downloadsPopupWindow?.hide();
  });
  ipcMain.handle(
    "browser:showDownloadInFolder",
    async (_event, downloadId: string) => {
      const workspace = await ensureBrowserWorkspace();
      const download = workspace?.downloads.find(
        (item) => item.id === downloadId,
      );
      if (!download?.targetPath) {
        return false;
      }

      return shell.showItemInFolder(download.targetPath);
    },
  );
  ipcMain.handle("browser:openDownload", async (_event, downloadId: string) => {
    const workspace = await ensureBrowserWorkspace();
    const download = workspace?.downloads.find(
      (item) => item.id === downloadId,
    );
    if (!download?.targetPath) {
      return "Download not found.";
    }

    return shell.openPath(download.targetPath);
  });

  createMainWindow();
  configureAutoUpdater();
  scheduleAppUpdateChecks();
  void checkForAppUpdates();
  try {
    await startDesktopBrowserService();
  } catch (error) {
    void appendRuntimeLog(
      `[desktop-browser-service] failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  runtimeStatus = withDesktopBrowserStatus({
    ...runtimeStatus,
    status: "starting",
    url: runtimeBaseUrl(),
    sandboxRoot: runtimeSandboxRoot(),
    harness: process.env.HOLABOSS_RUNTIME_HARNESS || "pi",
    lastError: "",
  });
  emitRuntimeState();
  void startEmbeddedRuntime();
  startupAuthSyncPromise = syncPersistedAuthSessionOnStartup()
    .catch(() => undefined)
    .finally(() => {
      startupAuthSyncPromise = null;
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (appQuitCleanupFinished) {
    return;
  }
  event.preventDefault();
  void ensureAppQuitCleanup().finally(() => {
    app.quit();
  });
});
