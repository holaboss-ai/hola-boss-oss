import "dotenv/config";
import { electronClient } from "@better-auth/electron/client";
import { storage as electronAuthStorage } from "@better-auth/electron/storage";
import { createAuthClient } from "better-auth/client";
import { app, BrowserView, BrowserWindow, DownloadItem, dialog, ipcMain, screen, session, shell, type OpenDialogOptions } from "electron";
import Database from "better-sqlite3";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { URL } from "node:url";

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const verboseTelemetryEnabled = process.env.HOLABOSS_VERBOSE_TELEMETRY?.trim() === "1";
const HOME_URL = "https://www.google.com/";
const NEW_TAB_TITLE = "New Tab";
const DOWNLOADS_POPUP_WIDTH = 360;
const DOWNLOADS_POPUP_HEIGHT = 340;
const HISTORY_POPUP_WIDTH = 420;
const HISTORY_POPUP_HEIGHT = 420;
const AUTH_POPUP_WIDTH = 440;
const AUTH_POPUP_HEIGHT = 500;
const OVERFLOW_POPUP_WIDTH = 220;
const OVERFLOW_POPUP_HEIGHT = 88;
const ADDRESS_SUGGESTIONS_POPUP_MIN_HEIGHT = 88;
const ADDRESS_SUGGESTIONS_POPUP_MAX_HEIGHT = 320;
const APP_THEMES = new Set(["holaboss", "emerald", "cobalt", "ember", "glacier", "mono", "claude", "slate", "paper", "graphite"]);
const GITHUB_RELEASES_OWNER = "holaboss-ai";
const GITHUB_RELEASES_REPO = "hola-boss-oss";
const APP_UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const APP_UPDATE_REQUEST_TIMEOUT_MS = 15000;
const APP_UPDATE_MACOS_ASSET_NAME = "Holaboss-macos-arm64.dmg";
const LOCAL_OSS_TEMPLATE_USER_ID = "local-oss";

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

type FilePreviewKind = "text" | "image" | "pdf" | "unsupported";

interface FilePreviewPayload {
  absolutePath: string;
  name: string;
  extension: string;
  kind: FilePreviewKind;
  mimeType?: string;
  content?: string;
  dataUrl?: string;
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

interface BrowserTabListPayload {
  activeTabId: string;
  tabs: BrowserStatePayload[];
}

interface BrowserTabRecord {
  view: BrowserView;
  state: BrowserStatePayload;
}

interface BrowserBookmarkPayload {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  createdAt: string;
}

type BrowserDownloadStatus = "progressing" | "completed" | "cancelled" | "interrupted";

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

interface BrowserAnchorBoundsPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  controlPlaneBaseUrl: string | null;
}

interface RuntimeConfigUpdatePayload {
  authToken?: string | null;
  modelProxyApiKey?: string | null;
  userId?: string | null;
  sandboxId?: string | null;
  modelProxyBaseUrl?: string | null;
  defaultModel?: string | null;
  controlPlaneBaseUrl?: string | null;
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

interface AppUpdatePreferencesPayload {
  dismissedReleaseTag?: string | null;
}

interface AppUpdateStatusPayload {
  supported: boolean;
  checking: boolean;
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseTag: string | null;
  releaseUrl: string | null;
  downloadUrl: string | null;
  publishedAt: string | null;
  dismissedReleaseTag: string | null;
  lastCheckedAt: string | null;
  error: string;
}

interface GithubReleaseAssetPayload {
  name?: string;
  browser_download_url?: string;
}

interface GithubReleasePayload {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GithubReleaseAssetPayload[];
}

interface WorkbenchOpenBrowserPayload {
  url?: string | null;
}

let mainWindow: BrowserWindow | null = null;
let authPopupWindow: BrowserWindow | null = null;
let downloadsPopupWindow: BrowserWindow | null = null;
let historyPopupWindow: BrowserWindow | null = null;
let overflowPopupWindow: BrowserWindow | null = null;
let browserPopupWindow: BrowserWindow | null = null;
let addressSuggestionsPopupWindow: BrowserWindow | null = null;
let currentTheme = "holaboss";
let browserBounds: BrowserBoundsPayload = { x: 0, y: 0, width: 0, height: 0 };
let overflowAnchorBounds: BrowserAnchorBoundsPayload | null = null;
let addressSuggestionsState: { suggestions: AddressSuggestionPayload[]; selectedIndex: number } = {
  suggestions: [],
  selectedIndex: -1
};
let activeBrowserTabId = "";
const browserTabs = new Map<string, BrowserTabRecord>();
let browserBookmarks: BrowserBookmarkPayload[] = [];
let browserDownloads: BrowserDownloadPayload[] = [];
let browserHistory: BrowserHistoryEntryPayload[] = [];
let fileBookmarks: FileBookmarkPayload[] = [];
let runtimeProcess: ChildProcessWithoutNullStreams | null = null;
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
  lastError: ""
};
let desktopBrowserServiceServer: HttpServer | null = null;
let desktopBrowserServiceUrl = "";
let desktopBrowserServiceAuthToken = "";
let appUpdateCheckTimer: NodeJS.Timeout | null = null;
let appUpdateCheckPromise: Promise<AppUpdateStatusPayload> | null = null;
let appUpdatePreferences: AppUpdatePreferencesPayload = {};
let appUpdateStatus: AppUpdateStatusPayload = {
  supported: false,
  checking: false,
  available: false,
  currentVersion: app.getVersion(),
  latestVersion: null,
  releaseTag: null,
  releaseUrl: null,
  downloadUrl: null,
  publishedAt: null,
  dismissedReleaseTag: null,
  lastCheckedAt: null,
  error: ""
};

const RUNTIME_API_PORT = 5060;
const RUNTIME_OPENCODE_PORT = 5096;
const DEV_RUNTIME_ROOT = "/tmp/holaboss-runtime-macos-full";
const STAGED_RUNTIME_ROOT = path.join("out", "runtime-macos");
const DESKTOP_USER_DATA_DIR = (process.env.HOLABOSS_DESKTOP_USER_DATA_DIR?.trim() || "holaboss-local").replace(
  /[\\/]+/g,
  "_"
);
const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, "");
interface PackagedDesktopConfig {
  authBaseUrl?: string;
  authSignInUrl?: string;
  backendBaseUrl?: string;
  desktopControlPlaneBaseUrl?: string;
  projectsUrl?: string;
  marketplaceUrl?: string;
  proactiveUrl?: string;
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
    return JSON.parse(readFileSync(configPath, "utf8")) as PackagedDesktopConfig;
  } catch {
    return {};
  }
}

const packagedDesktopConfig = loadPackagedDesktopConfig();
const INTERNAL_DEV_BACKEND_OVERRIDES_ENABLED =
  Boolean(process.env.VITE_DEV_SERVER_URL) || process.env.HOLABOSS_INTERNAL_DEV?.trim() === "1";
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
  packagedValue?: string
): string {
  for (const envName of envNames) {
    const value = normalizeBaseUrl(internalOverride(envName) || publicRuntimeEnv(envName));
    if (value) {
      return value;
    }
  }
  if (packagedValue) {
    return normalizeBaseUrl(packagedValue);
  }
  return "";
}
const AUTH_BASE_URL = configuredRemoteBaseUrl(["HOLABOSS_AUTH_BASE_URL"], packagedDesktopConfig.authBaseUrl);
const BACKEND_BASE_URL = configuredRemoteBaseUrl(["HOLABOSS_BACKEND_BASE_URL"], packagedDesktopConfig.backendBaseUrl);
const DESKTOP_CONTROL_PLANE_BASE_URL =
  serviceBaseUrlFromControlPlane(BACKEND_BASE_URL, 3060) ||
  configuredRemoteBaseUrl(
    ["HOLABOSS_DESKTOP_CONTROL_PLANE_BASE_URL"],
    packagedDesktopConfig.desktopControlPlaneBaseUrl
  );
const AUTH_SIGN_IN_URL = configuredRemoteBaseUrl(
  ["HOLABOSS_AUTH_SIGN_IN_URL"],
  packagedDesktopConfig.authSignInUrl
);
const DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH = "/api/v1/desktop-runtime/bindings/exchange";
const AUTH_CALLBACK_PROTOCOL = "ai.holaboss.app";
const LOCAL_RUNTIME_SCHEMA_VERSION = 1;
const RUNTIME_BINDING_REFRESH_INTERVAL_MS = 3 * 60 * 1000;

function configureStableUserDataPath() {
  const explicit = process.env.HOLABOSS_DESKTOP_USER_DATA_PATH?.trim();
  const nextUserDataPath = explicit ? path.resolve(explicit) : path.join(app.getPath("appData"), DESKTOP_USER_DATA_DIR);
  if (app.getPath("userData") !== nextUserDataPath) {
    app.setPath("userData", nextUserDataPath);
  }
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
    const parsed = JSON.parse(readFileSync(preferencesPath, "utf8")) as AppUpdatePreferencesPayload;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

async function persistAppUpdatePreferences() {
  await fs.mkdir(path.dirname(appUpdatePreferencesPath()), { recursive: true });
  await fs.writeFile(appUpdatePreferencesPath(), `${JSON.stringify(appUpdatePreferences, null, 2)}\n`, "utf8");
}

function serviceBaseUrlFromControlPlane(
  controlPlaneBaseUrl: string,
  port: number
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

function versionParts(value: string): number[] {
  return normalizeReleaseVersion(value)
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function compareReleaseVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue < rightValue) {
      return -1;
    }
    if (leftValue > rightValue) {
      return 1;
    }
  }

  return 0;
}

function releaseDownloadUrl(release: GithubReleasePayload): string {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  if (process.platform === "darwin") {
    const dmgAsset = assets.find((asset) => asset.name === APP_UPDATE_MACOS_ASSET_NAME);
    if (typeof dmgAsset?.browser_download_url === "string" && dmgAsset.browser_download_url.trim()) {
      return dmgAsset.browser_download_url.trim();
    }
  }

  return typeof release.html_url === "string" ? release.html_url.trim() : "";
}

async function requestJsonFromUrl<T>(targetUrl: URL): Promise<T> {
  const requestImpl = targetUrl.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<T>((resolve, reject) => {
    const request = requestImpl(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === "https:" ? "443" : "80"),
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Holaboss-Desktop-Updater"
        },
        timeout: APP_UPDATE_REQUEST_TIMEOUT_MS
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf8");
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`GitHub release check failed (${statusCode} ${response.statusMessage ?? "error"}).`));
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error("GitHub returned invalid JSON."));
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("GitHub release check timed out."));
    });
    request.on("error", (error) => {
      reject(error);
    });
    request.end();
  });
}

async function checkForAppUpdates(): Promise<AppUpdateStatusPayload> {
  if (!app.isPackaged) {
    appUpdateStatus = {
      ...appUpdateStatus,
      supported: false,
      checking: false,
      available: false,
      currentVersion: app.getVersion(),
      error: "",
      lastCheckedAt: new Date().toISOString()
    };
    emitAppUpdateState();
    return appUpdateStatus;
  }

  if (appUpdateCheckPromise) {
    return appUpdateCheckPromise;
  }

  appUpdateStatus = {
    ...appUpdateStatus,
    supported: true,
    checking: true,
    currentVersion: normalizeReleaseVersion(app.getVersion()),
    dismissedReleaseTag: appUpdatePreferences.dismissedReleaseTag ?? null,
    error: ""
  };
  emitAppUpdateState();

  appUpdateCheckPromise = (async () => {
    try {
      const release = await requestJsonFromUrl<GithubReleasePayload>(
        new URL(`https://api.github.com/repos/${GITHUB_RELEASES_OWNER}/${GITHUB_RELEASES_REPO}/releases/latest`)
      );

      const releaseTag = typeof release.tag_name === "string" ? release.tag_name.trim() : "";
      const latestVersion = normalizeReleaseVersion(releaseTag);
      const currentVersion = normalizeReleaseVersion(app.getVersion());
      const dismissedReleaseTag = appUpdatePreferences.dismissedReleaseTag ?? null;
      const newerReleaseAvailable =
        Boolean(releaseTag) &&
        Boolean(latestVersion) &&
        compareReleaseVersions(currentVersion, latestVersion) < 0;

      appUpdateStatus = {
        supported: true,
        checking: false,
        available: newerReleaseAvailable && dismissedReleaseTag !== releaseTag,
        currentVersion,
        latestVersion: latestVersion || null,
        releaseTag: releaseTag || null,
        releaseUrl: typeof release.html_url === "string" ? release.html_url.trim() || null : null,
        downloadUrl: releaseDownloadUrl(release) || null,
        publishedAt: typeof release.published_at === "string" ? release.published_at : null,
        dismissedReleaseTag,
        lastCheckedAt: new Date().toISOString(),
        error: ""
      };
    } catch (error) {
      appUpdateStatus = {
        ...appUpdateStatus,
        supported: true,
        checking: false,
        currentVersion: normalizeReleaseVersion(app.getVersion()),
        lastCheckedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Failed to check for updates."
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
  if (!app.isPackaged || appUpdateCheckTimer) {
    return;
  }

  appUpdateCheckTimer = setInterval(() => {
    void checkForAppUpdates();
  }, APP_UPDATE_CHECK_INTERVAL_MS);
  appUpdateCheckTimer.unref();
}

async function dismissAppUpdate(releaseTag?: string | null): Promise<AppUpdateStatusPayload> {
  const nextDismissedReleaseTag = releaseTag?.trim() || appUpdateStatus.releaseTag || null;
  if (!nextDismissedReleaseTag) {
    return appUpdateStatus;
  }

  appUpdatePreferences = {
    ...appUpdatePreferences,
    dismissedReleaseTag: nextDismissedReleaseTag
  };
  await persistAppUpdatePreferences();

  appUpdateStatus = {
    ...appUpdateStatus,
    available: appUpdateStatus.releaseTag !== nextDismissedReleaseTag ? appUpdateStatus.available : false,
    dismissedReleaseTag: nextDismissedReleaseTag
  };
  emitAppUpdateState();
  return appUpdateStatus;
}

async function openAppUpdateDownload(): Promise<void> {
  const targetUrl = appUpdateStatus.downloadUrl || appUpdateStatus.releaseUrl;
  if (!targetUrl) {
    throw new Error("No release download link is available.");
  }

  await shell.openExternal(targetUrl);
}

configureStableUserDataPath();
appUpdatePreferences = loadAppUpdatePreferences();
appUpdateStatus = {
  ...appUpdateStatus,
  supported: app.isPackaged,
  dismissedReleaseTag: appUpdatePreferences.dismissedReleaseTag ?? null
};

const desktopAuthClient =
  AUTH_BASE_URL && AUTH_SIGN_IN_URL
    ? createAuthClient({
        baseURL: AUTH_BASE_URL,
        plugins: [
          electronClient({
            signInURL: AUTH_SIGN_IN_URL,
            protocol: {
              scheme: AUTH_CALLBACK_PROTOCOL
            },
            storage: electronAuthStorage()
          })
        ]
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
  instance_id: string;
  provider: string;
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
        error: "rgba(184, 67, 67, 0.94)"
      };
    case "claude":
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
        error: "rgba(181, 72, 72, 0.92)"
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
        error: "rgba(181, 72, 72, 0.92)"
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
        error: "rgba(255, 185, 185, 0.92)"
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
        error: "rgba(255, 185, 185, 0.92)"
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
        error: "rgba(255, 185, 185, 0.92)"
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
        error: "rgba(255, 185, 185, 0.92)"
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
        error: "rgba(255, 185, 185, 0.92)"
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
        error: "rgba(255, 185, 185, 0.92)"
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
        error: "rgba(255, 185, 185, 0.92)"
      };
  }
}

function popupThemeCss(theme = currentTheme) {
  const palette = getPopupThemePalette(theme);
  const isLightTheme = theme === "holaboss" || theme === "claude" || theme === "paper";
  const surfaceSoft = `color-mix(in srgb, ${palette.controlBg} 72%, ${palette.panelBgAlt} 28%)`;
  const surfaceSubtle = `color-mix(in srgb, ${palette.controlBg} 52%, ${palette.panelBgAlt} 48%)`;
  return `
      :root { color-scheme: ${isLightTheme ? "light" : "dark"}; }
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
  apps: string[];
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
  main_session_id: string | null;
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

interface TaskProposalRecordPayload {
  proposal_id: string;
  workspace_id: string;
  task_name: string;
  task_prompt: string;
  task_generation_rationale: string;
  created_at: string;
  state: string;
  source_event_ids: string[];
}

interface TaskProposalListResponsePayload {
  proposals: TaskProposalRecordPayload[];
  count: number;
}

interface DemoTaskProposalRequestPayload {
  workspace_id: string;
  task_name?: string;
  task_prompt?: string;
  task_generation_rationale?: string;
}

interface DemoTaskProposalEnqueueResponsePayload {
  accepted: boolean;
  pending_count: number;
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
  enabled?: boolean;
  delivery: CronjobDeliveryPayload;
  metadata?: Record<string, unknown>;
}

interface CronjobUpdatePayload {
  name?: string;
  cron?: string;
  description?: string;
  enabled?: boolean;
  delivery?: CronjobDeliveryPayload;
  metadata?: Record<string, unknown>;
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

interface SessionHistoryResponsePayload {
  workspace_id: string;
  session_id: string;
  harness: string;
  harness_session_id: string;
  source: string;
  main_session_id: string | null;
  is_main_session: boolean;
  messages: SessionHistoryMessagePayload[];
  count: number;
  total: number;
  limit: number;
  offset: number;
  raw: unknown | null;
}

interface EnqueueSessionInputResponsePayload {
  input_id: string;
  session_id: string;
  status: string;
}

interface HolabossClientConfigPayload {
  projectsUrl: string;
  marketplaceUrl: string;
  hasApiKey: boolean;
}

type WorkspaceAppBuildStatus =
  | "unknown"
  | "pending"
  | "building"
  | "completed"
  | "failed"
  | "running"
  | "stopped";

interface InstalledWorkspaceAppPayload {
  app_id: string;
  config_path: string;
  lifecycle: Record<string, string> | null;
  build_status: WorkspaceAppBuildStatus;
}

interface InstalledWorkspaceAppListResponsePayload {
  apps: InstalledWorkspaceAppPayload[];
  count: number;
}

interface WorkspaceAppLifecycleActionPayload {
  app_id: string;
  status: string;
  detail: string;
  ports: Record<string, number>;
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

interface HolabossCreateWorkspacePayload {
  holaboss_user_id: string;
  name: string;
  template_root_path?: string | null;
  template_name?: string | null;
  template_ref?: string | null;
  template_commit?: string | null;
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
  session_id?: string | null;
  idempotency_key?: string | null;
  priority?: number;
  model?: string | null;
}

interface HolabossStreamSessionOutputsPayload {
  sessionId: string;
  workspaceId?: string | null;
  inputId?: string | null;
  includeHistory?: boolean;
  stopOnTerminal?: boolean;
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
let runtimeBindingRefreshPromise: Promise<void> | null = null;

function appendSessionStreamDebug(streamId: string, phase: string, detail: string) {
  if (!verboseTelemetryEnabled) {
    return;
  }
  sessionStreamDebugLog.push({
    at: new Date().toISOString(),
    streamId,
    phase,
    detail
  });
  if (sessionStreamDebugLog.length > 1200) {
    sessionStreamDebugLog.splice(0, sessionStreamDebugLog.length - 1200);
  }
}

function browserBookmarksPath() {
  return path.join(app.getPath("userData"), "browser-bookmarks.json");
}

function browserDownloadsPath() {
  return path.join(app.getPath("userData"), "browser-downloads.json");
}

function browserHistoryPath() {
  return path.join(app.getPath("userData"), "browser-history.json");
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

function runtimeDatabasePath() {
  return path.join(runtimeSandboxRoot(), "state", "runtime.db");
}

function runtimeWorkspaceRoot() {
  return path.join(runtimeSandboxRoot(), "workspace");
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
  const tableInfo = database.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
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
      main_session_id TEXT,
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
      main_session_id,
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
      main_session_id,
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

async function bootstrapRuntimeDatabase() {
  await fs.mkdir(path.dirname(runtimeDatabasePath()), { recursive: true });

  const database = openRuntimeDatabase();
  try {
    migrateLocalWorkspacesTable(database);
    migrateRuntimeInstallationStateTable(database);
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
        main_session_id TEXT,
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
      .prepare(`
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
      `)
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
        updated_at: now
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
      .prepare(`
        INSERT INTO runtime_process_state (
          process_key,
          pid,
          status,
          bind_host,
          bind_port,
          base_url,
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
          last_started_at = COALESCE(excluded.last_started_at, runtime_process_state.last_started_at),
          last_stopped_at = COALESCE(excluded.last_stopped_at, runtime_process_state.last_stopped_at),
          last_healthy_at = COALESCE(excluded.last_healthy_at, runtime_process_state.last_healthy_at),
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `)
      .run({
        process_key: "embedded-runtime",
        pid: update.pid ?? null,
        status: update.status,
        bind_host: "127.0.0.1",
        bind_port: RUNTIME_API_PORT,
        base_url: `http://127.0.0.1:${RUNTIME_API_PORT}`,
        last_started_at: update.lastStartedAt ?? null,
        last_stopped_at: update.lastStoppedAt ?? null,
        last_healthy_at: update.lastHealthyAt ?? null,
        last_error: update.lastError ?? null,
        updated_at: utcNowIso()
      });
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
      .prepare(`
        INSERT INTO event_log (category, event, outcome, detail, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(event.category, event.event, event.outcome, event.detail ?? null, utcNowIso());
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
  browserBookmarks = await readJsonFile<BrowserBookmarkPayload[]>(browserBookmarksPath(), []);
  browserDownloads = await readJsonFile<BrowserDownloadPayload[]>(browserDownloadsPath(), []);
  browserHistory = await readJsonFile<BrowserHistoryEntryPayload[]>(browserHistoryPath(), []);
  fileBookmarks = await readJsonFile<FileBookmarkPayload[]>(fileBookmarksPath(), []);
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
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const parsedRecord = parsed as Record<string, unknown>;
    const holabossSection = parsedRecord.holaboss;
    const source = typeof holabossSection === "object" && holabossSection
      ? (holabossSection as Record<string, unknown>)
      : parsedRecord;

    const normalized: Record<string, string> = {};
    for (const key of [
      "auth_token",
      "model_proxy_api_key",
      "user_id",
      "sandbox_id",
      "model_proxy_base_url",
      "default_model",
      "control_plane_base_url"
    ] as const) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        normalized[key] = value.trim();
      }
    }
    if (!normalized.auth_token && normalized.model_proxy_api_key) {
      normalized.auth_token = normalized.model_proxy_api_key;
    }
    if (!normalized.model_proxy_api_key && normalized.auth_token) {
      normalized.model_proxy_api_key = normalized.auth_token;
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

async function updateDesktopBrowserCapabilityConfig(update: {
  enabled: boolean;
  url?: string;
  authToken?: string;
}): Promise<void> {
  const currentDocument = await readRuntimeConfigDocument();
  const capabilities =
    typeof currentDocument.capabilities === "object" && currentDocument.capabilities
      ? { ...(currentDocument.capabilities as Record<string, unknown>) }
      : {};
  const desktopBrowser =
    typeof capabilities.desktop_browser === "object" && capabilities.desktop_browser
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
    capabilities
  };

  const configPath = runtimeConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(nextDocument, null, 2)}\n`, "utf-8");
}

function desktopBrowserServiceTokenFromRequest(request: IncomingMessage): string {
  const raw = request.headers["x-holaboss-desktop-token"];
  if (Array.isArray(raw)) {
    return (raw[0] || "").trim();
  }
  return typeof raw === "string" ? raw.trim() : "";
}

function writeBrowserServiceJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readBrowserServiceJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
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
    error: tab.state.error || ""
  };
}

function serializeBrowserEvalResult(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
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

async function navigateActiveBrowserTab(targetUrl: string): Promise<BrowserTabListPayload> {
  ensureBrowserTabs();
  const activeTab = getActiveBrowserTab();
  if (!activeTab) {
    throw new Error("No active browser tab is available.");
  }

  try {
    activeTab.state = { ...activeTab.state, error: "" };
    await activeTab.view.webContents.loadURL(targetUrl);
  } catch (error) {
    activeTab.state = {
      ...activeTab.state,
      loading: false,
      error: error instanceof Error ? error.message : "Failed to load URL."
    };
    emitBrowserState();
    throw error;
  }

  return getBrowserTabsSnapshot();
}

async function handleDesktopBrowserServiceRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>
): Promise<void> {
  try {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    const method = (request.method || "GET").toUpperCase();

    if (!desktopBrowserServiceAuthToken || desktopBrowserServiceTokenFromRequest(request) !== desktopBrowserServiceAuthToken) {
      writeBrowserServiceJson(response, 401, { error: "Unauthorized." });
      return;
    }

    if (method === "GET" && pathname === "/api/v1/browser/health") {
      writeBrowserServiceJson(response, 200, { ok: true });
      return;
    }

    if (method === "GET" && pathname === "/api/v1/browser/tabs") {
      ensureBrowserTabs();
      writeBrowserServiceJson(response, 200, getBrowserTabsSnapshot());
      return;
    }

    if (method === "GET" && pathname === "/api/v1/browser/page") {
      ensureBrowserTabs();
      const activeTab = getActiveBrowserTab();
      if (!activeTab) {
        writeBrowserServiceJson(response, 409, { error: "No active browser tab is available." });
        return;
      }
      syncBrowserState(activeTab.state.id);
      writeBrowserServiceJson(response, 200, browserPagePayload(activeTab));
      return;
    }

    if (method === "POST" && pathname === "/api/v1/browser/navigate") {
      const payload = await readBrowserServiceJsonBody(request);
      const targetUrl = typeof payload.url === "string" ? payload.url.trim() : "";
      if (!targetUrl) {
        writeBrowserServiceJson(response, 400, { error: "Field 'url' is required." });
        return;
      }
      emitWorkbenchOpenBrowser({ url: targetUrl });
      const snapshot = await navigateActiveBrowserTab(targetUrl);
      writeBrowserServiceJson(response, 200, snapshot);
      return;
    }

    if (method === "POST" && pathname === "/api/v1/browser/evaluate") {
      const payload = await readBrowserServiceJsonBody(request);
      const expression = typeof payload.expression === "string" ? payload.expression.trim() : "";
      if (!expression) {
        writeBrowserServiceJson(response, 400, { error: "Field 'expression' is required." });
        return;
      }

      ensureBrowserTabs();
      const activeTab = getActiveBrowserTab();
      if (!activeTab) {
        writeBrowserServiceJson(response, 409, { error: "No active browser tab is available." });
        return;
      }

      const result = await activeTab.view.webContents.executeJavaScript(expression);
      writeBrowserServiceJson(response, 200, {
        tabId: activeTab.state.id,
        result: serializeBrowserEvalResult(result)
      });
      return;
    }

    if (method === "POST" && pathname === "/api/v1/browser/screenshot") {
      const payload = await readBrowserServiceJsonBody(request);
      ensureBrowserTabs();
      const activeTab = getActiveBrowserTab();
      if (!activeTab) {
        writeBrowserServiceJson(response, 409, { error: "No active browser tab is available." });
        return;
      }

      const format = payload.format === "jpeg" ? "jpeg" : "png";
      const qualityRaw = typeof payload.quality === "number" ? payload.quality : 90;
      const quality = Math.max(0, Math.min(100, Math.round(qualityRaw)));
      const image = await activeTab.view.webContents.capturePage();
      const buffer = format === "jpeg" ? image.toJPEG(quality) : image.toPNG();
      const size = image.getSize();

      writeBrowserServiceJson(response, 200, {
        tabId: activeTab.state.id,
        mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
        width: size.width,
        height: size.height,
        base64: buffer.toString("base64")
      });
      return;
    }

    writeBrowserServiceJson(response, 404, { error: "Not found." });
  } catch (error) {
    writeBrowserServiceJson(response, 500, {
      error: error instanceof Error ? error.message : "Browser service request failed."
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
    ...runtimeStatus
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
    ...runtimeStatus
  });
  emitRuntimeState();
  await updateDesktopBrowserCapabilityConfig({ enabled: false });
}

function desktopBrowserStatusFields() {
  return {
    desktopBrowserReady: Boolean(desktopBrowserServiceUrl),
    desktopBrowserUrl: desktopBrowserServiceUrl || null
  };
}

function withDesktopBrowserStatus(
  payload: Omit<RuntimeStatusPayload, "desktopBrowserReady" | "desktopBrowserUrl">
): RuntimeStatusPayload {
  return {
    ...payload,
    ...desktopBrowserStatusFields()
  };
}

function runtimeModelProxyApiKeyFromConfig(config: Record<string, string>): string {
  return (config.model_proxy_api_key || config.auth_token || "").trim();
}

function runtimeBindingModelProxyApiKey(binding: RuntimeBindingExchangePayload): string {
  return (binding.model_proxy_api_key || binding.auth_token || "").trim();
}

async function writeRuntimeConfigFile(update: RuntimeConfigUpdatePayload) {
  const current = await readRuntimeConfigFile();
  const currentDocument = await readRuntimeConfigDocument();
  const next = { ...current };
  const entries: Array<[keyof RuntimeConfigUpdatePayload, string]> = [
    ["authToken", "auth_token"],
    ["modelProxyApiKey", "model_proxy_api_key"],
    ["userId", "user_id"],
    ["sandboxId", "sandbox_id"],
    ["modelProxyBaseUrl", "model_proxy_base_url"],
    ["defaultModel", "default_model"],
    ["controlPlaneBaseUrl", "control_plane_base_url"]
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
  if (modelProxyApiKey) {
    next.auth_token = modelProxyApiKey;
    next.model_proxy_api_key = modelProxyApiKey;
  } else {
    delete next.auth_token;
    delete next.model_proxy_api_key;
  }

  const configPath = runtimeConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const nextDocument = {
    ...currentDocument,
    holaboss: next
  };
  await fs.writeFile(configPath, `${JSON.stringify(nextDocument, null, 2)}\n`, "utf-8");
  return next;
}

function runtimeConfigField(value: string | undefined): string {
  return (value || "").trim();
}

function runtimeConfigRestartRequired(current: Record<string, string>, next: Record<string, string>): boolean {
  for (const key of [
    "auth_token",
    "model_proxy_api_key",
    "user_id",
    "sandbox_id",
    "model_proxy_base_url",
    "default_model",
    "control_plane_base_url"
  ] as const) {
    if (runtimeConfigField(current[key]) !== runtimeConfigField(next[key])) {
      return true;
    }
  }
  return false;
}

async function restartEmbeddedRuntimeIfNeeded(current: Record<string, string>, next: Record<string, string>): Promise<boolean> {
  if (!runtimeConfigRestartRequired(current, next)) {
    return false;
  }
  await stopEmbeddedRuntime();
  void startEmbeddedRuntime();
  return true;
}

async function withRuntimeBindingRefreshLock<T>(work: () => Promise<T>): Promise<T> {
  while (runtimeBindingRefreshPromise) {
    await runtimeBindingRefreshPromise;
  }

  const lockState: {
    resolve: (() => void) | null;
    reject: ((error: unknown) => void) | null;
  } = {
    resolve: null,
    reject: null
  };
  runtimeBindingRefreshPromise = new Promise<void>((resolve, reject) => {
    lockState.resolve = resolve;
    lockState.reject = reject;
  });

  try {
    const result = await work();
    if (lockState.resolve) {
      lockState.resolve();
    }
    return result;
  } catch (error) {
    if (lockState.reject) {
      lockState.reject(error);
    }
    throw error;
  } finally {
    runtimeBindingRefreshPromise = null;
  }
}

async function getRuntimeConfig(): Promise<RuntimeConfigPayload> {
  const configPath = runtimeConfigPath();
  const loaded = await readRuntimeConfigFile();
  return {
    configPath,
    loadedFromFile: Object.keys(loaded).length > 0,
    authTokenPresent: Boolean(runtimeModelProxyApiKeyFromConfig(loaded)),
    userId: loaded.user_id ?? null,
    sandboxId: loaded.sandbox_id ?? null,
    modelProxyBaseUrl: loaded.model_proxy_base_url ?? null,
    defaultModel: loaded.default_model ?? null,
    controlPlaneBaseUrl: loaded.control_plane_base_url ?? null
  };
}

async function exchangeDesktopRuntimeBinding(sandboxId: string): Promise<RuntimeBindingExchangePayload> {
  const controlPlaneBaseUrl = requireControlPlaneBaseUrl();
  const cookieHeader = authCookieHeader();
  if (!cookieHeader) {
    throw new Error("Better Auth session cookies are missing.");
  }

  const response = await fetch(`${controlPlaneBaseUrl}${DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader
    },
    body: JSON.stringify({
      sandbox_id: sandboxId,
      target_kind: "desktop"
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Runtime binding exchange failed with status ${response.status}`);
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
}

function emitAuthUserUpdated(user: AuthUserPayload | null) {
  pendingAuthUser = user;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:userUpdated", user);
  }
  if (authPopupWindow && !authPopupWindow.isDestroyed()) {
    authPopupWindow.webContents.send("auth:userUpdated", user);
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
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const root = parsed && typeof parsed === "object" ? parsed : null;
    if (!root) {
      return;
    }

    const betterAuthRaw = root["better-auth"];
    if (!betterAuthRaw || typeof betterAuthRaw !== "object" || Array.isArray(betterAuthRaw)) {
      return;
    }

    const betterAuth = { ...(betterAuthRaw as Record<string, unknown>) };
    if (!("cookie" in betterAuth)) {
      return;
    }

    delete betterAuth.cookie;
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
      detail: error instanceof Error ? error.message : "Failed to read Better Auth cookie."
    });
    clearPersistedAuthCookie();

    try {
      return readCookieOrThrow();
    } catch (retryError) {
      appendRuntimeEventLog({
        category: "auth",
        event: "auth.cookie.read",
        outcome: "error",
        detail: retryError instanceof Error ? retryError.message : "Failed to read Better Auth cookie after reset."
      });
      return "";
    }
  }
}

function requireAuthClient() {
  if (!desktopAuthClient) {
    throw new Error(
      "Remote authentication is not configured. Set HOLABOSS_AUTH_BASE_URL and HOLABOSS_AUTH_SIGN_IN_URL outside the public repo."
    );
  }
  return desktopAuthClient;
}

function requireControlPlaneBaseUrl() {
  if (!DESKTOP_CONTROL_PLANE_BASE_URL) {
    throw new Error(
      "Remote backend is not configured. Set HOLABOSS_BACKEND_BASE_URL outside the public repo."
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
      Cookie: cookieHeader
    }
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearPersistedAuthCookie();
      return null;
    }
    const detail = await response.text();
    throw new Error(detail || `Failed to load auth session with status ${response.status}`);
  }

  const payload = (await response.json()) as { user?: AuthUserPayload } | null;
  return payload?.user ?? null;
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

function runtimeConfigNeedsBindingRefresh(config: Record<string, string>, userId: string): boolean {
  const runtimeUserId = (config.user_id || "").trim();
  const hasAuthToken = Boolean(runtimeModelProxyApiKeyFromConfig(config));
  const hasSandboxId = Boolean((config.sandbox_id || "").trim());
  const runtimeControlPlaneBaseUrl = normalizeBaseUrl(config.control_plane_base_url || "");
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

function runtimeConfigIsControlPlaneManaged(config: Record<string, string>): boolean {
  const runtimeControlPlaneBaseUrl = normalizeBaseUrl(config.control_plane_base_url || "");
  if (runtimeControlPlaneBaseUrl) {
    return runtimeControlPlaneBaseUrl === DESKTOP_CONTROL_PLANE_BASE_URL;
  }
  const modelProxyBaseUrl = normalizeBaseUrl(config.model_proxy_base_url || "");
  return modelProxyBaseUrl.includes("/api/v1/model-proxy");
}

function shouldForceRuntimeBindingRefresh(userId: string): boolean {
  if (!userId) {
    return false;
  }
  if (lastRuntimeBindingRefreshUserId !== userId) {
    return true;
  }
  return Date.now() - lastRuntimeBindingRefreshAtMs > RUNTIME_BINDING_REFRESH_INTERVAL_MS;
}

async function clearRuntimeBindingSecrets(reason: string): Promise<void> {
  appendRuntimeEventLog({
    category: "auth",
    event: "runtime_binding.invalidate",
    outcome: "start",
    detail: reason
  });
  const currentConfig = await readRuntimeConfigFile();
  const nextConfig = await writeRuntimeConfigFile({
    authToken: null,
    modelProxyApiKey: null
  });
  lastRuntimeBindingRefreshAtMs = 0;
  lastRuntimeBindingRefreshUserId = "";
  await restartEmbeddedRuntimeIfNeeded(currentConfig, nextConfig);
  await emitRuntimeConfig();
  appendRuntimeEventLog({
    category: "auth",
    event: "runtime_binding.invalidate",
    outcome: "success",
    detail: reason
  });
}

async function provisionRuntimeBindingForAuthenticatedUser(
  user: AuthUserPayload,
  options?: { forceNewSandbox?: boolean; forceRefresh?: boolean; reason?: string }
): Promise<void> {
  const userId = authUserId(user);
  if (!userId) {
    return;
  }

  await withRuntimeBindingRefreshLock(async () => {
    const forceNewSandbox = Boolean(options?.forceNewSandbox);
    const forceRefresh = Boolean(options?.forceRefresh);
    const currentConfig = await readRuntimeConfigFile();
    if (!forceNewSandbox && !forceRefresh && !runtimeConfigNeedsBindingRefresh(currentConfig, userId)) {
      return;
    }

    const runtimeSandboxId = (currentConfig.sandbox_id || "").trim();
    const runtimeUserId = (currentConfig.user_id || "").trim();
    const sandboxId =
      forceNewSandbox || !runtimeSandboxId || runtimeUserId !== userId ? generateDesktopSandboxId() : runtimeSandboxId;

    appendRuntimeEventLog({
      category: "auth",
      event: "runtime_binding.provision",
      outcome: "start",
      detail: options?.reason || null
    });

    try {
      const binding = await exchangeDesktopRuntimeBinding(sandboxId);
      const modelProxyApiKey = runtimeBindingModelProxyApiKey(binding);
      if (!modelProxyApiKey) {
        throw new Error("Runtime binding response missing model_proxy_api_key.");
      }
      const nextConfig = await writeRuntimeConfigFile({
        authToken: modelProxyApiKey,
        modelProxyApiKey,
        userId: binding.holaboss_user_id,
        sandboxId: binding.sandbox_id,
        modelProxyBaseUrl: binding.model_proxy_base_url,
        defaultModel: binding.default_model,
        controlPlaneBaseUrl: DESKTOP_CONTROL_PLANE_BASE_URL
      });
      await restartEmbeddedRuntimeIfNeeded(currentConfig, nextConfig);
      await emitRuntimeConfig();

      appendRuntimeEventLog({
        category: "auth",
        event: "runtime_binding.provision",
        outcome: "success",
        detail: `${options?.reason || "unknown"}:${binding.sandbox_id}`
      });
      lastRuntimeBindingRefreshAtMs = Date.now();
      lastRuntimeBindingRefreshUserId = userId;
    } catch (error) {
      appendRuntimeEventLog({
        category: "auth",
        event: "runtime_binding.provision",
        outcome: "error",
        detail: error instanceof Error ? error.message : "Failed to provision runtime binding."
      });
      throw error;
    }
  });
}

async function ensureRuntimeBindingReadyForWorkspaceFlow(
  reason: string,
  options?: { forceRefresh?: boolean }
): Promise<void> {
  const currentConfig = await readRuntimeConfigFile();
  if (!runtimeConfigIsControlPlaneManaged(currentConfig)) {
    return;
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    if (runtimeModelProxyApiKeyFromConfig(currentConfig)) {
      await clearRuntimeBindingSecrets(`${reason}:missing_auth_session`);
    }
    throw new Error("Authentication session missing. Sign in again.");
  }

  const userId = authUserId(user);
  const shouldRefresh =
    Boolean(options?.forceRefresh) ||
    runtimeConfigNeedsBindingRefresh(currentConfig, userId) ||
    shouldForceRuntimeBindingRefresh(userId);
  if (shouldRefresh) {
    try {
      await provisionRuntimeBindingForAuthenticatedUser(user, {
        forceRefresh: true,
        forceNewSandbox: false,
        reason
      });
    } catch (error) {
      await clearRuntimeBindingSecrets(`${reason}:provision_failed`);
      const detail = error instanceof Error ? error.message : "Binding exchange failed.";
      throw new Error(`Runtime binding provisioning failed: ${detail}`);
    }
  }

  const refreshedConfig = await readRuntimeConfigFile();
  const hasBindingMaterial =
    Boolean(runtimeModelProxyApiKeyFromConfig(refreshedConfig)) &&
    Boolean((refreshedConfig.sandbox_id || "").trim()) &&
    Boolean((refreshedConfig.model_proxy_base_url || "").trim());
  if (!hasBindingMaterial) {
    await clearRuntimeBindingSecrets(`${reason}:binding_incomplete`);
    throw new Error("Runtime binding is incomplete. Sign in again.");
  }
}

function maybeAuthCallbackUrl(argument: string | undefined): string | null {
  if (!argument) {
    return null;
  }
  const normalized = argument.trim();
  if (!normalized) {
    return null;
  }
  return normalized.startsWith(`${AUTH_CALLBACK_PROTOCOL}://`) || normalized.startsWith(`${AUTH_CALLBACK_PROTOCOL}:/`)
    ? normalized
    : null;
}

function extractAuthToken(callbackUrl: string): string | null {
  try {
    const parsed = new URL(callbackUrl);
    if (parsed.protocol !== `${AUTH_CALLBACK_PROTOCOL}:`) {
      return null;
    }
    const callbackPath = `/${parsed.hostname}${parsed.pathname}`.replace(/\/+/g, "/");
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
      path: targetUrl
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
          reason: "auth_callback"
        });
      } catch (bindingError) {
        emitAuthError({
          message:
            bindingError instanceof Error
              ? `Signed in, but runtime binding provisioning failed: ${bindingError.message}`
              : "Signed in, but runtime binding provisioning failed.",
          status: 502,
          statusText: "Bad Gateway",
          path: DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH
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
          reason: "auth_callback_session_lookup"
        });
      } catch (bindingError) {
        emitAuthError({
          message:
            bindingError instanceof Error
              ? `Signed in, but runtime binding provisioning failed: ${bindingError.message}`
              : "Signed in, but runtime binding provisioning failed.",
          status: 502,
          statusText: "Bad Gateway",
          path: DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH
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
          reason: "auth_callback_fallback_session_lookup"
        });
      } catch (bindingError) {
        emitAuthError({
          message:
            bindingError instanceof Error
              ? `Signed in, but runtime binding provisioning failed: ${bindingError.message}`
              : "Signed in, but runtime binding provisioning failed.",
          status: 502,
          statusText: "Bad Gateway",
          path: DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH
        });
      }
      return;
    }

    emitAuthError({
      message: error instanceof Error ? error.message : "Authentication callback failed.",
      status: 500,
      statusText: "Internal Server Error",
      path: targetUrl
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
      reason: "startup_session_restore"
    });
  } catch (error) {
    emitAuthError({
      message:
        error instanceof Error
          ? `Signed in, but runtime binding provisioning failed: ${error.message}`
          : "Signed in, but runtime binding provisioning failed.",
      status: 502,
      statusText: "Bad Gateway",
      path: DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH
    });
  }
}

function projectsBaseUrl() {
  return DEFAULT_PROJECTS_URL.replace(/\/+$/, "");
}

function marketplaceBaseUrl() {
  return DEFAULT_MARKETPLACE_URL.replace(/\/+$/, "");
}

function controlPlaneApiKey() {
  const value = process.env.HOLA_AGENT_API_KEY?.trim() || process.env.HOLABOSS_API_KEY?.trim();
  return value || null;
}

async function controlPlaneHeaders(
  service: "projects" | "marketplace" | "proactive",
  extraHeaders?: Record<string, string>
): Promise<Record<string, string>> {
  if (service === "marketplace" || service === "proactive") {
    const runtimeConfig = await readRuntimeConfigFile();
    const runtimeToken = runtimeModelProxyApiKeyFromConfig(runtimeConfig);
    if (runtimeToken) {
      const sandboxId = (runtimeConfig.sandbox_id || "").trim();
      const userId = (runtimeConfig.user_id || "").trim();
      return {
        "Content-Type": "application/json",
        "X-API-Key": runtimeToken,
        ...(sandboxId ? { "X-Holaboss-Sandbox-Id": sandboxId } : {}),
        ...(userId ? { "X-Holaboss-User-Id": userId } : {}),
        ...extraHeaders
      };
    }
  }

  if (service === "marketplace" || service === "proactive") {
    throw new Error(
      `${service === "marketplace" ? "Marketplace" : "Proactive"} auth is missing. Sign in to provision a runtime binding token.`
    );
  }

  const apiKey = controlPlaneApiKey();
  if (apiKey) {
    return {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      ...extraHeaders
    };
  }

  throw new Error(
    "Projects API key is missing. Set HOLA_AGENT_API_KEY or HOLABOSS_API_KEY in the desktop app environment."
  );
}

function proactiveBaseUrl() {
  return DEFAULT_PROACTIVE_URL.replace(/\/+$/, "");
}

function controlPlaneServiceBaseUrl(service: "projects" | "marketplace" | "proactive") {
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

async function requestControlPlaneJson<T>({
  service,
  method,
  path: requestPath,
  payload,
  params
}: {
  service: "projects" | "marketplace" | "proactive";
  method: "GET" | "POST";
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

  const response = await fetch(url, {
    method,
    headers: await controlPlaneHeaders(service),
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readControlPlaneError(response));
  }
  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

async function emitWorkspaceReadyHeartbeat(params: {
  workspaceId: string;
  holabossUserId: string;
}): Promise<void> {
  const workspaceId = params.workspaceId.trim();
  const holabossUserId = params.holabossUserId.trim();
  if (!workspaceId || !holabossUserId || holabossUserId === LOCAL_OSS_TEMPLATE_USER_ID) {
    return;
  }

  const correlationId = `workspace-ready-${workspaceId}`;
  appendRuntimeEventLog({
    category: "workspace",
    event: "workspace.heartbeat.emit",
    outcome: "start",
    detail: correlationId
  });

  try {
    const results = await requestControlPlaneJson<ProactiveIngestItemResultPayload[]>({
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
              id: "desktop_workspace_create"
            },
            correlation_id: correlationId,
            origin: "system",
            timestamp: utcNowIso(),
            source_refs: ["workspace-created:ready"],
            window: "24h",
            proposal_scope: "window"
          }
        ]
      }
    });
    const acceptedCount = results.filter((item) => (item?.status || "").trim().toLowerCase() === "accepted").length;
    appendRuntimeEventLog({
      category: "workspace",
      event: "workspace.heartbeat.emit",
      outcome: "success",
      detail: `workspace_id=${workspaceId} accepted=${acceptedCount}/${results.length}`
    });
  } catch (error) {
    appendRuntimeEventLog({
      category: "workspace",
      event: "workspace.heartbeat.emit",
      outcome: "error",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

function getHolabossClientConfig(): HolabossClientConfigPayload {
  return {
    projectsUrl: projectsBaseUrl(),
    marketplaceUrl: marketplaceBaseUrl(),
    hasApiKey: Boolean(controlPlaneApiKey())
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

async function parseLocalTemplateMetadata(templateRoot: string): Promise<TemplateMetadataPayload> {
  const templateName = path.basename(templateRoot);
  const workspaceYamlPath = path.join(templateRoot, "workspace.yaml");
  const workspaceYaml = await fs.readFile(workspaceYamlPath, "utf-8");
  const resolvedName = workspaceYaml.match(/^\s*name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() || templateName;

  let description: string | null = null;
  try {
    description = firstNonEmptyLine(await fs.readFile(path.join(templateRoot, "README.md"), "utf-8"));
  } catch {
    try {
      description = firstNonEmptyLine(await fs.readFile(path.join(templateRoot, "AGENTS.md"), "utf-8"));
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
  await ensureRuntimeBindingReadyForWorkspaceFlow("marketplace_templates");
  return requestControlPlaneJson<TemplateListResponsePayload>({
    service: "marketplace",
    method: "GET",
    path: "/api/v1/marketplace/templates"
  });
}

async function listTaskProposals(workspaceId: string): Promise<TaskProposalListResponsePayload> {
  if (!workspaceId.trim()) {
    return { proposals: [], count: 0 };
  }
  return requestRuntimeJson<TaskProposalListResponsePayload>({
    method: "GET",
    path: "/api/v1/task-proposals/unreviewed",
    params: { workspace_id: workspaceId }
  });
}

async function listCronjobs(workspaceId: string, enabledOnly = false): Promise<CronjobListResponsePayload> {
  return requestRuntimeJson<CronjobListResponsePayload>({
    method: "GET",
    path: "/api/v1/cronjobs",
    params: { workspace_id: workspaceId, enabled_only: enabledOnly }
  });
}

async function createCronjob(payload: CronjobCreatePayload): Promise<CronjobRecordPayload> {
  return requestRuntimeJson<CronjobRecordPayload>({
    method: "POST",
    path: "/api/v1/cronjobs",
    payload
  });
}

async function updateCronjob(jobId: string, payload: CronjobUpdatePayload): Promise<CronjobRecordPayload> {
  return requestRuntimeJson<CronjobRecordPayload>({
    method: "PATCH",
    path: `/api/v1/cronjobs/${encodeURIComponent(jobId)}`,
    payload
  });
}

async function deleteCronjob(jobId: string): Promise<{ success: boolean }> {
  return requestRuntimeJson<{ success: boolean }>({
    method: "DELETE",
    path: `/api/v1/cronjobs/${encodeURIComponent(jobId)}`
  });
}

async function enqueueRemoteDemoTaskProposal(
  payload: DemoTaskProposalRequestPayload
): Promise<DemoTaskProposalEnqueueResponsePayload> {
  await ensureRuntimeBindingReadyForWorkspaceFlow("remote_demo_task_proposal", {
    forceRefresh: true
  });
  return requestControlPlaneJson<DemoTaskProposalEnqueueResponsePayload>({
    service: "proactive",
    method: "POST",
    path: "/api/v1/proactive/bridge/demo/task-proposal",
    payload
  });
}

async function updateTaskProposalState(
  proposalId: string,
  state: string
): Promise<TaskProposalStateUpdatePayload> {
  return requestRuntimeJson<TaskProposalStateUpdatePayload>({
    method: "PATCH",
    path: `/api/v1/task-proposals/${encodeURIComponent(proposalId)}`,
    payload: { state }
  });
}

async function collectLocalTemplateFiles(templateRoot: string): Promise<MaterializedTemplateFilePayload[]> {
  const files: MaterializedTemplateFilePayload[] = [];

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      const relativePath = path.relative(templateRoot, absolutePath).split(path.sep).join("/");
      const content = await fs.readFile(absolutePath);
      const stats = await fs.stat(absolutePath);
      files.push({
        path: relativePath,
        content_base64: content.toString("base64"),
        executable: Boolean(stats.mode & 0o111),
      });
    }
  }

  await walk(templateRoot);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

async function materializeLocalTemplate(payload: {
  template_root_path: string;
}): Promise<MaterializeTemplateResponsePayload> {
  const templateRoot = path.resolve(payload.template_root_path);
  const workspaceYamlPath = path.join(templateRoot, "workspace.yaml");
  if (!existsSync(workspaceYamlPath)) {
    throw new Error(`Template folder '${templateRoot}' is missing workspace.yaml.`);
  }

  const metadata = await parseLocalTemplateMetadata(templateRoot);
  const files = await collectLocalTemplateFiles(templateRoot);
  const totalBytes = files.reduce(
    (sum, file) => sum + Buffer.byteLength(file.content_base64, "base64"),
    0
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
  await ensureRuntimeBindingReadyForWorkspaceFlow("marketplace_template_materialize");
  return requestControlPlaneJson<MaterializeTemplateResponsePayload>({
    service: "marketplace",
    method: "POST",
    path: "/api/v1/marketplace/templates/materialize",
    payload
  });
}

async function pickTemplateFolder(): Promise<TemplateFolderSelectionPayload> {
  const ownerWindow = mainWindow ?? BrowserWindow.getFocusedWindow() ?? null;
  const options: OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"],
    title: "Choose Template Folder",
    buttonLabel: "Use Template Folder"
  };
  const result = ownerWindow ? await dialog.showOpenDialog(ownerWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return {
      canceled: true,
      rootPath: null,
      templateName: null,
      description: null
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
    description: metadata.description
  };
}

function runtimeBaseUrl() {
  return `http://127.0.0.1:${RUNTIME_API_PORT}`;
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

  throw new Error(refreshed.lastError || status.lastError || "Embedded runtime is not ready.");
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

function runtimeErrorFromBody(statusCode: number, statusMessage: string | undefined, body: string): Error {
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
  return new Error(`${statusCode} ${statusMessage ?? "Runtime request failed."}`.trim());
}

async function requestRuntimeJsonViaHttp<T>(
  targetUrl: URL,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  payload?: unknown,
  timeoutMs = 15000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || "80",
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        headers: {
          "Content-Type": "application/json"
        },
        timeout: timeoutMs
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
            reject(runtimeErrorFromBody(statusCode, response.statusMessage, body));
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
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Runtime request timed out."));
    });
    request.on("error", (error) => {
      reject(error);
    });

    if (payload !== undefined) {
      request.write(JSON.stringify(payload));
    }
    request.end();
  });
}

async function requestRuntimeJson<T>({
  method,
  path: requestPath,
  payload,
  params,
  timeoutMs
}: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  payload?: unknown;
  params?: Record<string, string | number | boolean | null | undefined>;
  timeoutMs?: number;
}): Promise<T> {
  const attempts = method === "GET" ? 3 : 1;
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
  return (process.env.HOLABOSS_RUNTIME_HARNESS || "opencode").trim().toLowerCase() || "opencode";
}

function workspaceDirectoryPath(workspaceId: string) {
  return path.join(runtimeWorkspaceRoot(), workspaceId);
}

function resolveWorkspaceMaterializedFilePath(workspaceRoot: string, relativePath: string) {
  const normalized = path.posix.normalize(relativePath.trim());
  if (!normalized || normalized === "." || normalized.startsWith("/") || normalized.startsWith("../")) {
    throw new Error(`Invalid template file path: ${relativePath}`);
  }
  if (normalized.split("/").some((part) => part === "." || part === ".." || part.length === 0)) {
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
  files: MaterializedTemplateFilePayload[]
) {
  const workspaceDir = workspaceDirectoryPath(workspaceId);
  await fs.mkdir(workspaceDir, { recursive: true });

  const existingEntries = await fs.readdir(workspaceDir, { withFileTypes: true });
  await Promise.all(
    existingEntries.map((entry) =>
      fs.rm(path.join(workspaceDir, entry.name), {
        recursive: true,
        force: true
      })
    )
  );

  for (const item of files) {
    const absolutePath = resolveWorkspaceMaterializedFilePath(workspaceDir, item.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const content = Buffer.from(item.content_base64, "base64");
    await fs.writeFile(absolutePath, content);
    if (item.executable) {
      await fs.chmod(absolutePath, 0o755);
    }
  }
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
      .prepare(`
        INSERT OR REPLACE INTO session_messages (
          id, workspace_id, session_id, role, text, created_at
        ) VALUES (
          @id, @workspace_id, @session_id, @role, @text, @created_at
        )
      `)
      .run({
        id: message.id,
        workspace_id: message.workspaceId,
        session_id: message.sessionId,
        role: message.role,
        text: message.text,
        created_at: message.createdAt ?? utcNowIso()
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
      .prepare(`
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
      `)
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
        updated_at: now
      });
  } finally {
    database.close();
  }
}

function updateQueuedInputStatus(inputId: string, status: string) {
  const database = openRuntimeDatabase();
  try {
    database
      .prepare(`
        UPDATE agent_session_inputs
        SET status = @status, updated_at = @updated_at
        WHERE input_id = @input_id
      `)
      .run({
        input_id: inputId,
        status,
        updated_at: utcNowIso()
      });
  } finally {
    database.close();
  }
}

function getWorkspaceRecord(workspaceId: string): WorkspaceRecordPayload | null {
  const database = openRuntimeDatabase();
  try {
    const row = database
      .prepare(`
        SELECT
          id,
          name,
          status,
          harness,
          main_session_id,
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
      `)
      .get({ id: workspaceId }) as WorkspaceRecordPayload | undefined;
    return row ?? null;
  } finally {
    database.close();
  }
}

async function listWorkspaces(): Promise<WorkspaceListResponsePayload> {
  return requestRuntimeJson<WorkspaceListResponsePayload>({
    method: "GET",
    path: "/api/v1/workspaces",
    params: {
      include_deleted: false,
      limit: 100,
      offset: 0
    }
  });
}

async function listInstalledApps(workspaceId: string): Promise<InstalledWorkspaceAppListResponsePayload> {
  return requestRuntimeJson<InstalledWorkspaceAppListResponsePayload>({
    method: "GET",
    path: "/api/v1/apps",
    params: {
      workspace_id: workspaceId
    }
  });
}

async function startInstalledApp(workspaceId: string, appId: string): Promise<WorkspaceAppLifecycleActionPayload> {
  return requestRuntimeJson<WorkspaceAppLifecycleActionPayload>({
    method: "POST",
    path: `/api/v1/apps/${encodeURIComponent(appId)}/start`,
    payload: {
      workspace_id: workspaceId
    },
    timeoutMs: 75000
  });
}

async function stopInstalledApp(workspaceId: string, appId: string): Promise<WorkspaceAppLifecycleActionPayload> {
  return requestRuntimeJson<WorkspaceAppLifecycleActionPayload>({
    method: "POST",
    path: `/api/v1/apps/${encodeURIComponent(appId)}/stop`,
    payload: {
      workspace_id: workspaceId
    },
    timeoutMs: 30000
  });
}

async function listOutputs(workspaceId: string): Promise<WorkspaceOutputListResponsePayload> {
  return requestRuntimeJson<WorkspaceOutputListResponsePayload>({
    method: "GET",
    path: "/api/v1/outputs",
    params: {
      workspace_id: workspaceId,
      limit: 50
    }
  });
}

function renderMinimalWorkspaceYaml(workspace: WorkspaceRecordPayload, template: ResolvedTemplatePayload) {
  const createdAt = workspace.created_at ?? utcNowIso();
  const templateCommit = template.effective_commit ? `  commit: ${JSON.stringify(template.effective_commit)}\n` : "";
  return [
    `name: ${JSON.stringify(workspace.name)}`,
    `created_at: ${JSON.stringify(createdAt)}`,
    "agents:",
    '  - id: "workspace.general"',
    '    model: "openai/gpt-5"',
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
    templateCommit + `  imported_at: ${JSON.stringify(utcNowIso())}`
  ].join("\n");
}

async function createWorkspace(payload: HolabossCreateWorkspacePayload): Promise<WorkspaceResponsePayload> {
  await ensureRuntimeBindingReadyForWorkspaceFlow("workspace_create");
  const mainSessionId = crypto.randomUUID();
  const harness = workspaceHarness();
  const templateRootPath = payload.template_root_path?.trim() || "";
  const templateName = payload.template_name?.trim() || "";
  let materializedTemplate: MaterializeTemplateResponsePayload;
  if (templateRootPath) {
    try {
      materializedTemplate = await materializeLocalTemplate({ template_root_path: templateRootPath });
    } catch (error) {
      throw new Error(contextualWorkspaceCreateError("Couldn't materialize the local template", error));
    }
  } else if (templateName) {
    try {
      materializedTemplate = await materializeMarketplaceTemplate({
        holaboss_user_id: payload.holaboss_user_id,
        template_name: templateName,
        template_ref: payload.template_ref,
        template_commit: payload.template_commit
      });
    } catch (error) {
      throw new Error(
        contextualWorkspaceCreateError(`Couldn't materialize the marketplace template '${templateName}'`, error)
      );
    }
  } else {
    throw new Error("Choose a local folder or a marketplace template first.");
  }
  const resolvedTemplate = materializedTemplate.template;
  let created: WorkspaceResponsePayload;
  try {
    created = await requestRuntimeJson<WorkspaceResponsePayload>({
      method: "POST",
      path: "/api/v1/workspaces",
      payload: {
        name: payload.name,
        harness,
        status: "provisioning",
        main_session_id: mainSessionId,
        onboarding_status: "not_required"
      }
    });
  } catch (error) {
    throw new Error(contextualWorkspaceCreateError("Couldn't create the workspace record", error));
  }
  const workspaceId = created.workspace.id;

  try {
    await applyMaterializedTemplateToWorkspace(workspaceId, materializedTemplate.files);

    const workspaceDir = workspaceDirectoryPath(workspaceId);
    const workspaceYamlPath = path.join(workspaceDir, "workspace.yaml");
    let workspaceYamlExists = true;
    try {
      await fs.access(workspaceYamlPath);
    } catch {
      workspaceYamlExists = false;
    }
    if (!workspaceYamlExists) {
      const current = getWorkspaceRecord(workspaceId);
      if (current) {
        await fs.writeFile(workspaceYamlPath, `${renderMinimalWorkspaceYaml(current, resolvedTemplate)}\n`, "utf-8");
      }
    }

    let onboardingStatus = "NOT_REQUIRED";
    let onboardingSessionId: string | null = null;
    try {
      const onboardContent = await fs.readFile(path.join(workspaceDir, "ONBOARD.md"), "utf-8");
      if (onboardContent.trim()) {
        onboardingStatus = "PENDING";
        onboardingSessionId = crypto.randomUUID();
      }
    } catch {
      onboardingStatus = "NOT_REQUIRED";
      onboardingSessionId = null;
    }

    let updated = await requestRuntimeJson<WorkspaceResponsePayload>({
      method: "PATCH",
      path: `/api/v1/workspaces/${workspaceId}`,
      payload: {
        status: "active",
        onboarding_status: onboardingStatus.toLowerCase(),
        onboarding_session_id: onboardingSessionId,
        error_message: null
      }
    });
    if (onboardingSessionId) {
      try {
        await requestRuntimeJson<EnqueueSessionInputResponsePayload>({
          method: "POST",
          path: "/api/v1/agent-sessions/queue",
          payload: {
            workspace_id: workspaceId,
            session_id: onboardingSessionId,
            text: "Start workspace onboarding now. Use ONBOARD.md as the guide and ask the first onboarding question only.",
            priority: 0
          }
        });
      } catch (error) {
        updated = await requestRuntimeJson<WorkspaceResponsePayload>({
          method: "PATCH",
          path: `/api/v1/workspaces/${workspaceId}`,
          payload: {
            error_message: contextualWorkspaceCreateError(
              "Workspace created, but automatic onboarding could not start",
              error
            )
          }
        }).catch(() => updated);
      }
    }
    await emitWorkspaceReadyHeartbeat({
      workspaceId,
      holabossUserId: payload.holaboss_user_id
    });
    return updated;
  } catch (error) {
    await requestRuntimeJson<WorkspaceResponsePayload>({
      method: "PATCH",
      path: `/api/v1/workspaces/${workspaceId}`,
      payload: {
        status: "error",
        error_message: normalizeErrorMessage(error)
      }
    }).catch(() => undefined);
    throw error;
  }
}

async function listRuntimeStates(workspaceId: string): Promise<SessionRuntimeStateListResponsePayload> {
  return requestRuntimeJson<SessionRuntimeStateListResponsePayload>({
    method: "GET",
    path: `/api/v1/agent-sessions/by-workspace/${workspaceId}/runtime-states`,
    params: {
      limit: 100,
      offset: 0
    }
  });
}

function isMissingSessionBindingError(error: unknown): boolean {
  return error instanceof Error && error.message.trim().toLowerCase() === "session binding not found";
}

function emptySessionHistoryPayload(sessionId: string, workspaceId: string): SessionHistoryResponsePayload {
  return {
    workspace_id: workspaceId,
    session_id: sessionId,
    harness: "",
    harness_session_id: "",
    source: "sandbox_local_storage",
    main_session_id: sessionId,
    is_main_session: true,
    messages: [],
    count: 0,
    total: 0,
    limit: 200,
    offset: 0,
    raw: null
  };
}

async function getSessionHistory(sessionId: string, workspaceId: string): Promise<SessionHistoryResponsePayload> {
  try {
    return await requestRuntimeJson<SessionHistoryResponsePayload>({
      method: "GET",
      path: `/api/v1/agent-sessions/${sessionId}/history`,
      params: {
        workspace_id: workspaceId,
        limit: 200,
        offset: 0
      }
    });
  } catch (error) {
    if (isMissingSessionBindingError(error)) {
      return emptySessionHistoryPayload(sessionId, workspaceId);
    }
    throw error;
  }
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation failed.";
}

function contextualWorkspaceCreateError(stage: string, error: unknown) {
  return `${stage}: ${normalizeErrorMessage(error)}`;
}

async function queueSessionInput(
  payload: HolabossQueueSessionInputPayload
): Promise<EnqueueSessionInputResponsePayload> {
  await ensureRuntimeBindingReadyForWorkspaceFlow("session_queue");
  return requestRuntimeJson<EnqueueSessionInputResponsePayload>({
    method: "POST",
    path: "/api/v1/agent-sessions/queue",
    payload: {
      workspace_id: payload.workspace_id,
      text: payload.text,
      image_urls: payload.image_urls,
      session_id: payload.session_id,
      idempotency_key: payload.idempotency_key,
      priority: payload.priority ?? 0,
      model: payload.model
    }
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

  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
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
        error instanceof Error ? error.message : "webContents.send failed"
      );
    }
  }
}

function getQueuedInput(inputId: string) {
  const database = openRuntimeDatabase();
  try {
    const row = database
      .prepare(`
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
      `)
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
      payload: parsedPayload
    };
  } finally {
    database.close();
  }
}

async function openSessionOutputStream(
  payload: HolabossStreamSessionOutputsPayload
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
        status.url ?? runtimeBaseUrl()
      );
      if (payload.inputId) {
        url.searchParams.set("input_id", payload.inputId);
      }
      if (payload.workspaceId) {
        url.searchParams.set("workspace_id", payload.workspaceId);
      }
      if (payload.includeHistory !== undefined) {
        url.searchParams.set("include_history", payload.includeHistory ? "true" : "false");
      }
      if (payload.stopOnTerminal !== undefined) {
        url.searchParams.set("stop_on_terminal", payload.stopOnTerminal ? "true" : "false");
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
              Accept: "text/event-stream"
            },
            timeout: 0
          },
          (response) => {
            const statusCode = response.statusCode ?? 0;
            appendSessionStreamDebug(
              streamId,
              "http_response",
              `status=${statusCode} message=${response.statusMessage || ""}`
            );
            if (statusCode < 200 || statusCode >= 300) {
              const chunks: Buffer[] = [];
              response.on("data", (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
              });
              response.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf-8");
                reject(runtimeErrorFromBody(statusCode, response.statusMessage, body));
              });
              return;
            }

            void (async () => {
              try {
                for await (const event of iterSseEvents(response)) {
                  appendSessionStreamDebug(streamId, "sse_event_raw", `event=${event.event} id=${event.id || "-"}`);
                  let parsedData: unknown = event.data;
                  try {
                    parsedData = JSON.parse(event.data);
                  } catch {
                    parsedData = event.data;
                  }
                  const normalizedData =
                    parsedData && typeof parsedData === "object" && !Array.isArray(parsedData) && "event_type" in parsedData
                      ? parsedData
                      : {
                          event_type: event.event,
                          payload: parsedData
                        };

                  emitSessionStreamEvent({
                    streamId,
                    type: "event",
                    event: {
                      event: event.event,
                      id: event.id,
                      data: normalizedData
                    }
                  });
                  await new Promise<void>((resolve) => {
                    setImmediate(resolve);
                  });
                }
                appendSessionStreamDebug(streamId, "sse_complete", "iterSseEvents completed");
                resolve();
              } catch (streamError) {
                appendSessionStreamDebug(
                  streamId,
                  "sse_error",
                  streamError instanceof Error ? streamError.message : "unknown stream error"
                );
                reject(streamError);
              }
            })();
          }
        );

        const abortRequest = () => {
          request.destroy(abortError);
        };
        controller.signal.addEventListener("abort", abortRequest, { once: true });
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
            requestError instanceof Error ? requestError.message : "request error"
          );
          reject(requestError);
        });
        request.end();
      });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AbortError") {
        appendSessionStreamDebug(streamId, "open_error", error instanceof Error ? error.message : "unknown error");
        emitSessionStreamEvent({
          streamId,
          type: "error",
          error: error instanceof Error ? error.message : "Failed to stream session output."
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

async function closeSessionOutputStream(streamId: string, reason?: string): Promise<void> {
  const controller = sessionOutputStreams.get(streamId);
  if (!controller) {
    appendSessionStreamDebug(streamId, "close_ignored", reason || "missing_controller");
    return;
  }
  appendSessionStreamDebug(streamId, "close_requested", reason || "unspecified");
  controller.abort();
  sessionOutputStreams.delete(streamId);
}

function emitRuntimeState() {
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
    lastError: runtimeStatus.lastError
  });
  if (nextSignature === lastRuntimeStateSignature) {
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
  const payload = config ?? (await getRuntimeConfig());
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

const REQUIRED_RUNTIME_BUNDLE_PATHS = [
  path.join("bin", "sandbox-runtime"),
  "package-metadata.json",
  path.join("runtime", "metadata.json"),
  path.join("runtime", "api-server", "dist", "index.mjs")
] as const;

async function validateRuntimeRoot(runtimeRoot: string) {
  for (const relativePath of REQUIRED_RUNTIME_BUNDLE_PATHS) {
    const absolutePath = path.join(runtimeRoot, relativePath);
    if (!(await fileExists(absolutePath))) {
      return `Runtime bundle is incomplete. Missing ${relativePath} under ${runtimeRoot}. Rebuild or restage runtime-macos.`;
    }
  }

  return null;
}

async function resolveRuntimeRoot() {
  const candidates = [
    process.env.HOLABOSS_RUNTIME_ROOT,
    isDev ? path.resolve(__dirname, "..", "runtime-macos") : undefined,
    isDev ? DEV_RUNTIME_ROOT : path.join(process.resourcesPath, "runtime-macos")
  ].filter((value): value is string => Boolean(value && value.trim().length > 0));

  let firstInvalidError: string | null = null;
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const validationError = await validateRuntimeRoot(resolved);
    if (!validationError) {
      return {
        runtimeRoot: resolved,
        validationError: null
      };
    }
    if (!firstInvalidError) {
      firstInvalidError = validationError;
    }
  }

  return {
    runtimeRoot: null,
    validationError: firstInvalidError
  };
}

async function waitForRuntimeHealth(url: string, attempts = 30, delayMs = 1000) {
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
        timeout: 1500
      },
      (response) => {
        response.resume();
        resolve((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300);
      }
    );

    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
    request.end();
  });
}

async function refreshRuntimeStatus() {
  const { runtimeRoot, validationError } = await resolveRuntimeRoot();
  const executablePath = runtimeRoot ? path.join(runtimeRoot, "bin", "sandbox-runtime") : null;
  const sandboxRoot = runtimeSandboxRoot();
  const harness = process.env.HOLABOSS_RUNTIME_HARNESS || "opencode";
  const workflowBackend = process.env.HOLABOSS_RUNTIME_WORKFLOW_BACKEND || "remote_api";
  const url = `http://127.0.0.1:${RUNTIME_API_PORT}`;
  const healthy = await isRuntimeHealthy(url);

  if (healthy) {
    persistRuntimeProcessState({
      pid: runtimeProcess?.pid ?? null,
      status: "running",
      lastHealthyAt: utcNowIso(),
      lastError: ""
    });
    runtimeStatus = withDesktopBrowserStatus({
      status: "running",
      available: Boolean(runtimeRoot && executablePath),
      runtimeRoot,
      sandboxRoot,
      executablePath,
      url,
      pid: runtimeProcess?.pid ?? null,
      harness,
      lastError: ""
    });
    emitRuntimeState();
    return runtimeStatus;
  }

  runtimeStatus = withDesktopBrowserStatus({
    ...runtimeStatus,
    available: Boolean(runtimeRoot && executablePath),
    runtimeRoot,
    sandboxRoot,
    executablePath,
    url,
    harness,
    status: runtimeProcess ? runtimeStatus.status : runtimeRoot && executablePath ? "stopped" : "missing",
    lastError:
      runtimeRoot && executablePath
        ? runtimeStatus.lastError
        : validationError ||
          "Runtime bundle not found. Set HOLABOSS_RUNTIME_ROOT or package runtime-macos into app resources."
  });
  emitRuntimeState();
  return runtimeStatus;
}

async function stopEmbeddedRuntime() {
  const running = runtimeProcess;
  runtimeProcess = null;
  if (!running) {
    if (runtimeStatus.status === "running" || runtimeStatus.status === "starting") {
      runtimeStatus = withDesktopBrowserStatus({
        ...runtimeStatus,
        status: "stopped",
        pid: null
      });
      persistRuntimeProcessState({
        pid: null,
        status: "stopped",
        lastStoppedAt: utcNowIso(),
        lastError: ""
      });
      emitRuntimeState();
    }
    return;
  }

  await new Promise<void>((resolve) => {
    running.once("exit", () => resolve());
    running.kill("SIGTERM");
    setTimeout(() => {
      if (!running.killed) {
        running.kill("SIGKILL");
      }
      resolve();
    }, 3000).unref();
  });
}

async function startEmbeddedRuntime() {
  if (runtimeProcess) {
    return refreshRuntimeStatus();
  }

  const { runtimeRoot, validationError } = await resolveRuntimeRoot();
  const executablePath = runtimeRoot ? path.join(runtimeRoot, "bin", "sandbox-runtime") : null;
  const sandboxRoot = runtimeSandboxRoot();
  const harness = process.env.HOLABOSS_RUNTIME_HARNESS || "opencode";
  const workflowBackend = process.env.HOLABOSS_RUNTIME_WORKFLOW_BACKEND || "remote_api";
  const url = `http://127.0.0.1:${RUNTIME_API_PORT}`;

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
          "Runtime bundle not found. Set HOLABOSS_RUNTIME_ROOT or package runtime-macos into app resources."
  });
  emitRuntimeState();

  if (!runtimeRoot || !executablePath) {
    persistRuntimeProcessState({
      pid: null,
      status: "missing",
      lastError: runtimeStatus.lastError
    });
    return runtimeStatus;
  }

  await fs.mkdir(sandboxRoot, { recursive: true });
  await bootstrapRuntimeDatabase();

  if (await isRuntimeHealthy(url)) {
    return refreshRuntimeStatus();
  }

  const child = spawn(executablePath, [], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      HB_SANDBOX_ROOT: sandboxRoot,
      SANDBOX_AGENT_BIND_HOST: "127.0.0.1",
      SANDBOX_AGENT_BIND_PORT: String(RUNTIME_API_PORT),
      OPENCODE_SERVER_HOST: "127.0.0.1",
      OPENCODE_SERVER_PORT: String(RUNTIME_OPENCODE_PORT),
      SANDBOX_AGENT_HARNESS: harness,
      HOLABOSS_RUNTIME_WORKFLOW_BACKEND: workflowBackend,
      HOLABOSS_RUNTIME_DB_PATH: runtimeDatabasePath(),
      PROACTIVE_ENABLE_REMOTE_BRIDGE: "1",
      PROACTIVE_BRIDGE_BASE_URL: proactiveBaseUrl(),
      PYTHONDONTWRITEBYTECODE: "1"
    },
    stdio: "pipe"
  });

  runtimeProcess = child;
  persistRuntimeProcessState({
    pid: child.pid ?? null,
    status: "starting",
    lastStartedAt: utcNowIso(),
    lastError: ""
  });
  appendRuntimeEventLog({
    category: "runtime",
    event: "embedded_runtime.start",
    outcome: "start",
    detail: `pid=${child.pid ?? "null"}`
  });
  runtimeStatus = withDesktopBrowserStatus({
    ...runtimeStatus,
    status: "starting",
    pid: child.pid ?? null
  });
  emitRuntimeState();

  child.stdout.on("data", (chunk) => {
    void appendRuntimeLog(String(chunk));
  });
  child.stderr.on("data", (chunk) => {
    void appendRuntimeLog(String(chunk));
  });

  child.once("exit", (code, signal) => {
    if (runtimeProcess === child) {
      runtimeProcess = null;
    }

    void (async () => {
      if (await isRuntimeHealthy(url)) {
        await refreshRuntimeStatus();
        return;
      }

      runtimeStatus = withDesktopBrowserStatus({
        ...runtimeStatus,
        status: code === 0 ? "stopped" : "error",
        pid: null,
        lastError: code === 0 ? "" : `Runtime exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"}).`
      });
      persistRuntimeProcessState({
        pid: null,
        status: code === 0 ? "stopped" : "error",
        lastStoppedAt: utcNowIso(),
        lastError: runtimeStatus.lastError
      });
      appendRuntimeEventLog({
        category: "runtime",
        event: "embedded_runtime.exit",
        outcome: code === 0 ? "success" : "error",
        detail: `code=${code ?? "null"} signal=${signal ?? "null"}`
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
      lastError: "Runtime process started but did not pass health checks. Check runtime.log in the Electron userData directory."
    });
    persistRuntimeProcessState({
      pid: child.pid ?? null,
      status: "error",
      lastError: runtimeStatus.lastError
    });
    appendRuntimeEventLog({
      category: "runtime",
      event: "embedded_runtime.healthcheck",
      outcome: "error",
      detail: runtimeStatus.lastError
    });
  }
  emitRuntimeState();
  return runtimeStatus;
}

function persistBookmarks() {
  return writeJsonFile(browserBookmarksPath(), browserBookmarks);
}

function persistDownloads() {
  return writeJsonFile(browserDownloadsPath(), browserDownloads);
}

function persistHistory() {
  return writeJsonFile(browserHistoryPath(), browserHistory);
}

function persistFileBookmarks() {
  return writeJsonFile(fileBookmarksPath(), fileBookmarks);
}

function createBrowserState(overrides?: Partial<BrowserStatePayload>): BrowserStatePayload {
  return {
    id: overrides?.id ?? "",
    url: overrides?.url ?? "",
    title: overrides?.title ?? NEW_TAB_TITLE,
    faviconUrl: overrides?.faviconUrl,
    canGoBack: overrides?.canGoBack ?? false,
    canGoForward: overrides?.canGoForward ?? false,
    loading: overrides?.loading ?? false,
    initialized: overrides?.initialized ?? false,
    error: overrides?.error ?? ""
  };
}

const TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
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
  ".csv",
  ".log"
]);

const IMAGE_FILE_MIME_TYPES = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".bmp", "image/bmp"]
]);

const PDF_FILE_MIME_TYPES = new Map<string, string>([[".pdf", "application/pdf"]]);

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024 * 2;
const MAX_IMAGE_PREVIEW_BYTES = 1024 * 1024 * 12;

function getFilePreviewKind(targetPath: string) {
  const extension = path.extname(targetPath).toLowerCase();
  if (!extension) {
    return { extension, kind: "text" as const };
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

async function readFilePreview(targetPath: string): Promise<FilePreviewPayload> {
  const absolutePath = path.resolve(targetPath);
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
    isEditable: kind === "text"
  };

  if (kind === "text") {
    if (stat.size > MAX_TEXT_PREVIEW_BYTES) {
      return {
        ...basePayload,
        kind: "unsupported",
        isEditable: false,
        unsupportedReason: "Text file is too large to preview inline."
      };
    }

    return {
      ...basePayload,
      content: await fs.readFile(absolutePath, "utf-8")
    };
  }

  if (kind === "image") {
    if (stat.size > MAX_IMAGE_PREVIEW_BYTES) {
      return {
        ...basePayload,
        kind: "unsupported",
        isEditable: false,
        unsupportedReason: "Image is too large to preview inline."
      };
    }

    const buffer = await fs.readFile(absolutePath);
    return {
      ...basePayload,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`
    };
  }

  if (kind === "pdf") {
    const buffer = await fs.readFile(absolutePath);
    return {
      ...basePayload,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`
    };
  }

  return {
    ...basePayload,
    unsupportedReason: "Preview is not available for this file type yet."
  };
}

async function writeTextFile(targetPath: string, content: string): Promise<FilePreviewPayload> {
  const absolutePath = path.resolve(targetPath);
  await fs.writeFile(absolutePath, content, "utf-8");
  return readFilePreview(absolutePath);
}

async function listDirectory(targetPath?: string | null): Promise<DirectoryPayload> {
  const initialPath = targetPath && targetPath.trim().length > 0 ? targetPath : runtimeSandboxRoot();
  const resolvedPath = path.resolve(initialPath);
  await fs.mkdir(resolvedPath, { recursive: true });
  const stat = await fs.stat(resolvedPath);

  if (!stat.isDirectory()) {
    throw new Error("Target path is not a directory.");
  }

  const dirEntries = await fs.readdir(resolvedPath, { withFileTypes: true });
  const entries: DirectoryEntryPayload[] = [];

  for (const dirEntry of dirEntries) {
    const absolutePath = path.join(resolvedPath, dirEntry.name);
    try {
      const meta = await fs.stat(absolutePath);
      entries.push({
        name: dirEntry.name,
        absolutePath,
        isDirectory: meta.isDirectory(),
        size: meta.isDirectory() ? 0 : meta.size,
        modifiedAt: meta.mtime.toISOString()
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

  const parsedRoot = path.parse(resolvedPath).root;
  const normalizedCurrent = path.normalize(resolvedPath);
  const normalizedRoot = path.normalize(parsedRoot);
  const parentPath = normalizedCurrent === normalizedRoot ? null : path.dirname(normalizedCurrent);

  return {
    currentPath: normalizedCurrent,
    parentPath,
    entries
  };
}

function getBrowserTabsSnapshot(): BrowserTabListPayload {
  const tabs = Array.from(browserTabs.values(), ({ state }) => state);
  return {
    activeTabId: activeBrowserTabId || tabs[0]?.id || "",
    tabs
  };
}

function emitBrowserState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("browser:state", getBrowserTabsSnapshot());
}

function emitBookmarksState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("browser:bookmarks", browserBookmarks);
}

function emitDownloadsState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!downloadsPopupWindow || downloadsPopupWindow.isDestroyed()) {
      return;
    }
  }

  mainWindow?.webContents.send("browser:downloads", browserDownloads);
  downloadsPopupWindow?.webContents.send("downloads:update", browserDownloads);
}

function emitHistoryState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!historyPopupWindow || historyPopupWindow.isDestroyed()) {
      return;
    }
    return;
  }

  mainWindow.webContents.send("browser:history", browserHistory);
  historyPopupWindow?.webContents.send("history:update", browserHistory);
}

function emitFileBookmarksState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("fs:bookmarks", fileBookmarks);
}

function emitAddressSuggestionsState() {
  addressSuggestionsPopupWindow?.webContents.send("addressSuggestions:update", addressSuggestionsState);
}

function createAuthPopupHtml() {
  const themeOptions = Array.from(APP_THEMES)
    .map((theme) => `<option value="${theme}">${theme.charAt(0).toUpperCase()}${theme.slice(1)}</option>`)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Account</title>
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
        margin: 10px;
        height: calc(100vh - 20px);
        border-radius: 22px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: linear-gradient(180deg, rgba(23, 19, 16, 0.98), rgba(13, 10, 8, 0.98));
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 18px 18px 14px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      .account {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        min-width: 0;
      }
      .avatar {
        flex: 0 0 auto;
        width: 42px;
        height: 42px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(185, 138, 54, 0.35);
        background: rgba(140, 101, 23, 0.2);
        color: #f4d28d;
        font-size: 16px;
        font-weight: 600;
      }
      .identityName {
        font-size: 15px;
        color: rgba(236, 239, 243, 0.96);
      }
      .identity {
        margin-top: 4px;
        font-size: 12px;
        color: rgba(181, 195, 188, 0.8);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .badge {
        flex: 0 0 auto;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        padding: 8px 12px;
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      .badge.idle {
        background: rgba(255, 255, 255, 0.03);
        color: rgba(181, 195, 188, 0.82);
      }
      .badge.ready {
        border-color: rgba(87, 255, 173, 0.22);
        background: rgba(87, 255, 173, 0.08);
        color: rgba(87, 255, 173, 0.92);
      }
      .badge.syncing {
        border-color: rgba(252, 211, 77, 0.22);
        background: rgba(252, 211, 77, 0.08);
        color: rgba(255, 233, 177, 0.92);
      }
      .badge.error {
        border-color: rgba(251, 146, 146, 0.24);
        background: rgba(251, 146, 146, 0.08);
        color: rgba(255, 203, 203, 0.94);
      }
      .content {
        min-height: 0;
        overflow-y: auto;
        padding: 16px 18px 18px;
      }
      .hero {
        border-radius: 18px;
        border: 1px solid rgba(91, 70, 35, 0.55);
        background: rgba(35, 27, 18, 0.92);
        padding: 14px 16px;
      }
      .hero[hidden] {
        display: none;
      }
      .heroTitle {
        font-size: 13px;
        color: rgba(222, 238, 230, 0.94);
      }
      .heroDescription {
        margin-top: 6px;
        font-size: 11px;
        line-height: 1.5;
        color: rgba(181, 195, 188, 0.72);
      }
      .list {
        margin-top: 14px;
        display: grid;
        gap: 8px;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(33, 25, 20, 0.72);
        padding: 13px 14px;
      }
      .rowLabel {
        font-size: 11px;
        color: rgba(236, 239, 243, 0.92);
      }
      .rowValue {
        max-width: 58%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: right;
        font-size: 11px;
        color: rgba(181, 195, 188, 0.8);
      }
      .actions {
        margin-top: 14px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .button {
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(27, 23, 20, 0.96);
        color: rgba(236, 239, 243, 0.92);
        padding: 11px 14px;
        font-size: 12px;
        cursor: pointer;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .button.primary {
        border-color: rgba(185, 138, 54, 0.35);
        background: rgba(140, 101, 23, 0.16);
        color: #f4d28d;
      }
      .button:hover { border-color: rgba(185, 138, 54, 0.3); }
      .button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      .stateMessage {
        margin-top: 12px;
        border-radius: 16px;
        padding: 12px 14px;
        font-size: 11px;
        line-height: 1.5;
      }
      .stateMessage.ready {
        border: 1px solid rgba(87, 255, 173, 0.18);
        background: rgba(87, 255, 173, 0.08);
        color: rgba(87, 255, 173, 0.9);
      }
      .stateMessage.syncing {
        border: 1px solid rgba(252, 211, 77, 0.18);
        background: rgba(252, 211, 77, 0.08);
        color: rgba(255, 233, 177, 0.92);
      }
      .message {
        margin-top: 12px;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        padding: 12px 14px;
        font-size: 11px;
        line-height: 1.5;
      }
      .message.error {
        border-color: rgba(251, 146, 146, 0.28);
        color: rgba(255, 203, 203, 0.94);
      }
      .message.success {
        border-color: rgba(87, 255, 173, 0.24);
        color: rgba(87, 255, 173, 0.92);
      }
      .advancedToggle {
        margin-top: 14px;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(29, 23, 20, 0.8);
        color: rgba(236, 239, 243, 0.92);
        padding: 12px 14px;
        font-size: 11px;
        cursor: pointer;
      }
      .advancedHint {
        color: rgba(181, 195, 188, 0.72);
      }
      .section {
        margin-top: 12px;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(27, 23, 20, 0.75);
        padding: 14px;
      }
      .section[hidden] {
        display: none;
      }
      .section-title {
        margin-bottom: 10px;
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(181, 195, 188, 0.72);
      }
      .statusGrid {
        display: grid;
        gap: 10px;
      }
      .statusStep {
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        padding: 12px 14px;
      }
      .statusStep.done {
        border-color: rgba(87, 255, 173, 0.2);
        background: rgba(87, 255, 173, 0.08);
      }
      .statusStep.current {
        border-color: rgba(125, 211, 252, 0.22);
        background: rgba(125, 211, 252, 0.08);
      }
      .statusStep.error {
        border-color: rgba(251, 146, 146, 0.24);
        background: rgba(251, 146, 146, 0.08);
      }
      .statusHeader {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .statusDot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: rgba(181, 195, 188, 0.5);
      }
      .statusStep.done .statusDot {
        background: rgba(87, 255, 173, 0.95);
      }
      .statusStep.current .statusDot {
        background: rgba(125, 211, 252, 0.95);
      }
      .statusStep.error .statusDot {
        background: rgba(251, 146, 146, 0.95);
      }
      .statusLabel {
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(181, 195, 188, 0.72);
      }
      .statusDetail {
        margin-top: 8px;
        font-size: 11px;
        line-height: 1.6;
        color: rgba(236, 239, 243, 0.88);
      }
      .field {
        display: grid;
        gap: 6px;
        margin-bottom: 10px;
      }
      .field label {
        font-size: 10px;
        letter-spacing: 0.12em;
        color: rgba(181, 195, 188, 0.72);
      }
      .input {
        width: 100%;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.03);
        color: rgba(236, 239, 243, 0.94);
        padding: 10px 12px;
        font-size: 12px;
        outline: none;
      }
      .input:focus { border-color: rgba(185, 138, 54, 0.45); }
      .footnote {
        margin-top: 10px;
        font-size: 11px;
        line-height: 1.5;
        color: rgba(181, 195, 188, 0.72);
      }
      .authSectionTitle {
        margin: 14px 0 8px;
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(181, 195, 188, 0.72);
      }
      .themeSection {
        margin-top: 10px;
      }
      .themeSelectWrap {
        margin-top: 8px;
      }
      .hero,
      .list,
      .statusSection,
      #stateMessage,
      #error,
      #success,
      #advancedToggle,
      #advancedSection,
      #exchange {
        display: none !important;
      }
      ${popupThemeCss()}
    </style>
  </head>
  <body>
    <div class="panel">
      <div class="header">
        <div class="account">
          <div id="avatar" class="avatar">H</div>
          <div style="min-width: 0;">
            <div id="identityName" class="identityName">Holaboss account</div>
            <div id="identity" class="identity">Loading session...</div>
          </div>
        </div>
        <div id="badge" class="badge idle">Checking session</div>
      </div>
      <div class="content">
        <div id="hero" class="hero">
          <div id="heroTitle" class="heroTitle">Sign in to connect this desktop runtime</div>
          <div id="heroDescription" class="heroDescription">
            Use your Holaboss account to connect this desktop app and enable synced product features.
          </div>
        </div>

        <div class="list">
          <div class="row">
            <div class="rowLabel">Profile</div>
            <div id="profileStatus" class="rowValue">Sign in required</div>
          </div>
          <div class="row">
            <div class="rowLabel">Runtime</div>
            <div id="runtimeStatus" class="rowValue">Offline</div>
          </div>
          <div class="row">
            <div class="rowLabel">Sandbox</div>
            <div id="sandboxStatus" class="rowValue">Will be assigned automatically</div>
          </div>
        </div>

        <div class="section statusSection">
          <div class="section-title">Status</div>
          <div id="statusSummary" class="footnote" style="margin-top: 0;"></div>
          <div id="statusSteps" class="statusGrid"></div>
          <div id="statusError" class="message error" hidden></div>
        </div>

        <div class="authSectionTitle">Account actions</div>
        <div class="actions">
          <button id="signIn" class="button primary" type="button">Sign in with browser</button>
          <button id="refresh" class="button" type="button">Refresh session</button>
          <button id="signOut" class="button" type="button">Sign out</button>
          <button id="exchange" class="button primary" type="button">Retry setup</button>
        </div>

        <div class="themeSection">
          <div class="authSectionTitle" style="margin-top: 12px;">Theme selection</div>
          <div class="themeSelectWrap">
            <select id="themeSelect" class="input">
              ${themeOptions}
            </select>
          </div>
        </div>

        <div id="stateMessage" class="stateMessage syncing" hidden></div>

        <div id="error" class="message error" hidden></div>
        <div id="success" class="message success" hidden></div>

        <button id="advancedToggle" class="advancedToggle" type="button">
          <span>Advanced runtime settings</span>
          <span id="advancedHint" class="advancedHint">Show</span>
        </button>

        <div id="advancedSection" class="section" hidden>
          <div class="section-title">Runtime Product Config</div>

          <div class="field">
            <label for="sandboxId">Runtime sandbox ID</label>
            <input id="sandboxId" class="input" type="text" />
          </div>

          <div class="field">
            <label for="runtimeUserId">Runtime user ID</label>
            <input id="runtimeUserId" class="input" type="text" />
          </div>

          <div class="field">
            <label for="modelProxyBaseUrl">Model proxy base URL</label>
            <input id="modelProxyBaseUrl" class="input" type="url" />
          </div>

          <div class="field">
            <label for="defaultModel">Default model</label>
            <input id="defaultModel" class="input" type="text" />
          </div>

          <div class="actions">
            <button id="exchangeAdvanced" class="button" type="button">Refresh runtime binding</button>
            <button id="save" class="button primary" type="button">Save runtime config</button>
          </div>

          <div id="summary" class="footnote"></div>
          <div class="footnote">
            Sign-in is handled on the hosted Holaboss sign-in page. Runtime binding is provisioned automatically after sign-in. Use "Retry runtime binding" only if the automatic exchange fails.
          </div>
        </div>

      </div>
    </div>
    <script>
      const state = {
        user: null,
        runtimeConfig: null,
        runtimeStatus: null,
        workspaces: [],
        isPending: true,
        isStartingSignIn: false,
        isSaving: false,
        isExchanging: false,
        isAdvancedOpen: false,
        authError: "",
        authMessage: "",
        modelProxyBaseUrl: "",
        defaultModel: "",
        runtimeUserId: "",
        sandboxId: "",
        theme: ${JSON.stringify(currentTheme)}
      };
      const availableThemes = new Set(${JSON.stringify(Array.from(APP_THEMES))});

      const els = {
        identity: document.getElementById("identity"),
        identityName: document.getElementById("identityName"),
        avatar: document.getElementById("avatar"),
        summary: document.getElementById("summary"),
        hero: document.getElementById("hero"),
        heroTitle: document.getElementById("heroTitle"),
        heroDescription: document.getElementById("heroDescription"),
        badge: document.getElementById("badge"),
        profileStatus: document.getElementById("profileStatus"),
        runtimeStatus: document.getElementById("runtimeStatus"),
        sandboxStatus: document.getElementById("sandboxStatus"),
        statusSummary: document.getElementById("statusSummary"),
        statusSteps: document.getElementById("statusSteps"),
        statusError: document.getElementById("statusError"),
        signIn: document.getElementById("signIn"),
        refresh: document.getElementById("refresh"),
        signOut: document.getElementById("signOut"),
        exchange: document.getElementById("exchange"),
        exchangeAdvanced: document.getElementById("exchangeAdvanced"),
        save: document.getElementById("save"),
        stateMessage: document.getElementById("stateMessage"),
        advancedToggle: document.getElementById("advancedToggle"),
        advancedHint: document.getElementById("advancedHint"),
        advancedSection: document.getElementById("advancedSection"),
        sandboxId: document.getElementById("sandboxId"),
        runtimeUserId: document.getElementById("runtimeUserId"),
        modelProxyBaseUrl: document.getElementById("modelProxyBaseUrl"),
        defaultModel: document.getElementById("defaultModel"),
        themeSelect: document.getElementById("themeSelect"),
        error: document.getElementById("error"),
        success: document.getElementById("success")
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

      const runtimeSummary = (config) => {
        if (!config) {
          return "runtime config unavailable";
        }

        const parts = [
          config.loadedFromFile ? "runtime config loaded" : "runtime config empty",
          config.authTokenPresent ? "token present" : "token missing",
          config.userId ? "user " + config.userId : "user missing",
          config.sandboxId ? "sandbox " + config.sandboxId : "sandbox missing"
        ];
        return parts.join(" - ");
      };

      const runtimeStateLabel = (runtimeStatus, isSignedIn, runtimeBindingReady) => {
        if (runtimeStatus?.status === "running") {
          return "Running";
        }
        if (runtimeStatus?.status === "starting") {
          return "Starting";
        }
        if (runtimeStatus?.status === "error") {
          return "Error";
        }
        if (runtimeStatus?.status === "missing") {
          return "Missing";
        }
        if (runtimeStatus?.status === "disabled") {
          return "Disabled";
        }
        if (runtimeStatus?.status === "stopped") {
          return "Stopped";
        }
        if (runtimeBindingReady) {
          return "Ready";
        }
        return isSignedIn ? "Finishing setup" : "Offline";
      };

      const normalizedWorkspaceStatus = (workspace) => ((workspace && typeof workspace.status === "string" ? workspace.status : "").trim().toLowerCase());

      const pickStatusWorkspace = (workspaces) => {
        if (!Array.isArray(workspaces) || workspaces.length === 0) {
          return null;
        }
        return workspaces.find((workspace) => normalizedWorkspaceStatus(workspace) === "active") || workspaces[0] || null;
      };

      const lifecycleSteps = () => {
        const isSignedIn = Boolean(sessionUserId(state.user));
        const runtimeProvisioned = Boolean(state.runtimeConfig?.authTokenPresent);
        const sandboxAssigned = Boolean((state.runtimeConfig?.sandboxId || "").trim());
        const desktopBrowserReady = Boolean(state.runtimeStatus?.desktopBrowserReady);
        const runtimeFailed = state.runtimeStatus?.status === "error";
        const workspace = pickStatusWorkspace(state.workspaces);
        const workspaceStatus = normalizedWorkspaceStatus(workspace);
        const workspaceFailed = workspaceStatus === "error";
        const workspaceReady = workspaceStatus === "active";

        return [
          {
            label: "Signed in",
            state: isSignedIn ? "done" : "current",
            detail: isSignedIn ? "Desktop auth session is available." : "Sign in to sync product-backed desktop state."
          },
          {
            label: "Runtime provisioned",
            state: runtimeFailed ? "error" : runtimeProvisioned ? "done" : isSignedIn ? "current" : "pending",
            detail: runtimeFailed
              ? state.runtimeStatus?.lastError || "Embedded runtime failed to start."
              : runtimeProvisioned
                ? "Runtime token and binding are loaded."
                : "Waiting for runtime token provisioning."
          },
          {
            label: "Sandbox assigned",
            state: sandboxAssigned ? "done" : runtimeProvisioned ? "current" : "pending",
            detail: sandboxAssigned
              ? "Sandbox " + state.runtimeConfig.sandboxId
              : "Waiting for a sandbox assignment in runtime config."
          },
          {
            label: "Desktop browser ready",
            state: desktopBrowserReady ? "done" : state.runtimeStatus?.status === "starting" ? "current" : "pending",
            detail: desktopBrowserReady
              ? "Desktop browser service is registered for agent-triggered browsing."
              : "Desktop browser service has not finished registering yet."
          },
          {
            label: "Workspace ready",
            state: workspaceFailed ? "error" : workspaceReady ? "done" : workspace ? "current" : "pending",
            detail: workspaceFailed
              ? workspace?.error_message || "Workspace provisioning failed."
              : workspaceReady
                ? (workspace?.name || "Workspace") + " is active."
                : workspace
                  ? "Current workspace status: " + workspace.status + "."
                  : "Create or select a workspace to finish desktop routing."
          }
        ];
      };

      const statusSummary = () => {
        const workspace = pickStatusWorkspace(state.workspaces);
        const parts = [];
        parts.push(Array.isArray(state.workspaces) && state.workspaces.length ? state.workspaces.length + " workspace" + (state.workspaces.length === 1 ? "" : "s") : "no workspaces");
        if (workspace) {
          parts.push("focused status " + workspace.name);
        }
        if (state.runtimeStatus?.status) {
          parts.push("runtime " + state.runtimeStatus.status);
        }
        return parts.join(" - ");
      };

      const renderLifecycleSteps = () => {
        const steps = lifecycleSteps();
        els.statusSummary.textContent = statusSummary();
        els.statusSteps.innerHTML = steps.map((step) => (
          '<div class="statusStep ' + step.state + '">' +
            '<div class="statusHeader">' +
              '<span class="statusDot"></span>' +
              '<span class="statusLabel">' + step.label + '</span>' +
            '</div>' +
            '<div class="statusDetail">' + step.detail + '</div>' +
          '</div>'
        )).join("");

        const workspaceError = pickStatusWorkspace(state.workspaces)?.error_message || "";
        els.statusError.hidden = !workspaceError;
        els.statusError.textContent = workspaceError;
      };

      const syncFormFromConfig = (config) => {
        const defaults = window.authPopup.getDefaults();
        state.runtimeConfig = config;
        state.modelProxyBaseUrl = config?.modelProxyBaseUrl || defaults.modelProxyBaseUrl;
        state.defaultModel = config?.defaultModel || defaults.defaultModel;
        state.runtimeUserId = config?.userId || sessionUserId(state.user);
        state.sandboxId = config?.sandboxId || ("desktop:" + crypto.randomUUID());
      };

      const render = () => {
        const isSignedIn = Boolean(sessionUserId(state.user));
        const resolvedUserId = state.runtimeUserId.trim() || sessionUserId(state.user);
        const runtimeBindingReady = Boolean(state.runtimeConfig?.authTokenPresent)
          && Boolean((state.runtimeConfig?.sandboxId || "").trim())
          && Boolean((state.runtimeConfig?.modelProxyBaseUrl || "").trim());
        const hasError = Boolean(state.authError);
        const isFinishingSetup = isSignedIn && !runtimeBindingReady && !hasError;
        const badgeTone = hasError ? "error" : runtimeBindingReady ? "ready" : isFinishingSetup ? "syncing" : "idle";
        const badgeLabel = state.isPending ? "Checking session" : hasError ? "Needs attention" : runtimeBindingReady ? "Connected" : isSignedIn ? "Finishing setup" : "Signed out";
        const heroTitle = !isSignedIn
          ? "Sign in to connect this desktop runtime"
          : runtimeBindingReady
            ? "Desktop runtime is connected"
            : hasError
              ? "We couldn't finish desktop setup"
              : "Finishing desktop setup";
        const heroDescription = !isSignedIn
          ? "Use your Holaboss account to connect this desktop app and enable synced product features."
          : runtimeBindingReady
            ? "Your desktop runtime is bound to your Holaboss account and ready to use product features."
            : hasError
              ? "Your account session is active, but the desktop runtime binding needs to be refreshed."
              : "Sign-in succeeded. Holaboss is finishing the local runtime setup in the background.";

        els.identityName.textContent = isSignedIn ? (sessionDisplayName(state.user) || "Holaboss account") : "Holaboss account";
        els.identity.textContent = isSignedIn
          ? (sessionEmail(state.user) || resolvedUserId || "Signed in")
          : "Not connected";
        els.avatar.textContent = sessionInitials(state.user);
        els.heroTitle.textContent = heroTitle;
        els.heroDescription.textContent = heroDescription;
        els.hero.hidden = runtimeBindingReady && !hasError;
        els.summary.textContent = runtimeSummary(state.runtimeConfig);
        els.badge.textContent = badgeLabel;
        els.badge.className = "badge " + badgeTone;
        els.profileStatus.textContent = isSignedIn ? "Connected" : "Sign in required";
        els.runtimeStatus.textContent = runtimeStateLabel(state.runtimeStatus, isSignedIn, runtimeBindingReady);
        els.sandboxStatus.textContent = state.sandboxId || "Will be assigned automatically";
        renderLifecycleSteps();
        els.sandboxId.value = state.sandboxId;
        els.runtimeUserId.value = state.runtimeUserId;
        els.modelProxyBaseUrl.value = state.modelProxyBaseUrl;
        els.defaultModel.value = state.defaultModel;
        els.themeSelect.value = state.theme;
        els.signIn.hidden = isSignedIn;
        els.signIn.disabled = state.isStartingSignIn || isSignedIn;
        els.signIn.textContent = state.isStartingSignIn ? "Opening sign-in..." : "Sign in with browser";
        els.refresh.disabled = state.isPending;
        els.signOut.disabled = !isSignedIn;
        els.exchange.hidden = !isSignedIn || runtimeBindingReady;
        els.exchange.disabled = state.isExchanging;
        els.exchange.textContent = state.isExchanging ? "Retrying setup..." : "Retry setup";
        els.exchangeAdvanced.disabled = state.isExchanging || !isSignedIn;
        els.exchangeAdvanced.textContent = state.isExchanging ? "Refreshing..." : "Refresh runtime binding";
        els.save.disabled = state.isSaving;
        els.save.textContent = state.isSaving ? "Saving runtime config..." : "Save runtime config";
        els.stateMessage.hidden = !(isFinishingSetup || (runtimeBindingReady && !state.authMessage && !state.authError));
        if (runtimeBindingReady && !state.authMessage && !state.authError) {
          els.stateMessage.className = "stateMessage ready";
          els.stateMessage.textContent = "Connected. Remote proactive and marketplace features are available on this desktop runtime.";
        } else if (isFinishingSetup) {
          els.stateMessage.className = "stateMessage syncing";
          els.stateMessage.textContent = "Sign-in completed. Holaboss is finishing local runtime setup.";
        }
        els.error.hidden = !state.authError;
        els.error.textContent = state.authError;
        els.success.hidden = !state.authMessage;
        els.success.textContent = state.authMessage;
        els.advancedSection.hidden = !state.isAdvancedOpen;
        els.advancedHint.textContent = state.isAdvancedOpen ? "Hide" : "Show";
      };

      const refreshSession = async () => {
        state.isPending = true;
        render();
        try {
          state.user = await window.authPopup.getUser();
          if (!state.runtimeUserId.trim()) {
            state.runtimeUserId = sessionUserId(state.user);
          }
          state.authError = "";
        } catch (error) {
          state.authError = error instanceof Error ? error.message : "Failed to refresh session.";
        } finally {
          state.isPending = false;
          render();
        }
      };

      const refreshConfig = async () => {
        const config = await window.authPopup.getRuntimeConfig();
        syncFormFromConfig(config);
        render();
      };

      const refreshRuntimeStatus = async () => {
        state.runtimeStatus = await window.authPopup.getRuntimeStatus();
        render();
      };

      const refreshWorkspaces = async () => {
        const response = await window.authPopup.listWorkspaces();
        state.workspaces = Array.isArray(response?.items) ? response.items : [];
        render();
      };

      els.sandboxId.addEventListener("input", (event) => {
        state.sandboxId = event.target.value;
      });
      els.runtimeUserId.addEventListener("input", (event) => {
        state.runtimeUserId = event.target.value;
      });
      els.modelProxyBaseUrl.addEventListener("input", (event) => {
        state.modelProxyBaseUrl = event.target.value;
      });
      els.defaultModel.addEventListener("input", (event) => {
        state.defaultModel = event.target.value;
      });
      els.themeSelect.addEventListener("change", async (event) => {
        const nextTheme = String(event.target.value || "").trim();
        if (!availableThemes.has(nextTheme)) {
          return;
        }
        state.theme = nextTheme;
        render();
        try {
          await window.authPopup.setTheme(nextTheme);
        } catch (error) {
          state.authError = error instanceof Error ? error.message : "Failed to update theme.";
          render();
        }
      });
      els.advancedToggle.addEventListener("click", () => {
        state.isAdvancedOpen = !state.isAdvancedOpen;
        render();
      });

      els.signIn.addEventListener("click", async () => {
        state.isStartingSignIn = true;
        state.authError = "";
        state.authMessage = "";
        render();
        try {
          await window.authPopup.requestAuth();
          state.authMessage = "Sign-in opened in the browser. Complete the flow on the Holaboss sign-in page.";
        } catch (error) {
          state.authError = error instanceof Error ? error.message : "Failed to start sign-in.";
        } finally {
          state.isStartingSignIn = false;
          render();
        }
      });

      els.refresh.addEventListener("click", () => {
        state.authError = "";
        state.authMessage = "";
        void refreshSession();
      });

      els.signOut.addEventListener("click", async () => {
        state.authError = "";
        state.authMessage = "";
        render();
        try {
          await window.authPopup.signOut();
          state.user = null;
          state.runtimeUserId = "";
        } catch (error) {
          state.authError = error instanceof Error ? error.message : "Failed to sign out.";
        } finally {
          render();
        }
      });

      els.save.addEventListener("click", async () => {
        state.isSaving = true;
        state.authError = "";
        state.authMessage = "";
        render();
        try {
          const nextConfig = await window.authPopup.setRuntimeConfig({
            userId: state.runtimeUserId.trim() || sessionUserId(state.user) || null,
            sandboxId: state.sandboxId.trim() || null,
            modelProxyBaseUrl: state.modelProxyBaseUrl.trim() || null,
            defaultModel: state.defaultModel.trim() || null
          });
          syncFormFromConfig(nextConfig);
          state.authMessage = "Runtime config updated. The runtime was restarted with the new settings.";
        } catch (error) {
          state.authError = error instanceof Error ? error.message : "Failed to update runtime config.";
        } finally {
          state.isSaving = false;
          render();
        }
      });

      const exchangeBinding = async () => {
        if (!sessionUserId(state.user)) {
          state.authError = "Sign in first.";
          state.authMessage = "";
          render();
          return;
        }

        state.isExchanging = true;
        state.authError = "";
        state.authMessage = "";
        render();
        try {
          const sandboxId = state.sandboxId.trim() || ("desktop:" + crypto.randomUUID());
          const nextConfig = await window.authPopup.exchangeBinding(sandboxId);
          syncFormFromConfig(nextConfig);
          state.authMessage = "Runtime binding refreshed and local runtime config updated.";
        } catch (error) {
          state.authError = error instanceof Error ? error.message : "Failed to exchange runtime binding.";
        } finally {
          state.isExchanging = false;
          render();
        }
      };

      els.exchange.addEventListener("click", () => { void exchangeBinding(); });
      els.exchangeAdvanced.addEventListener("click", () => { void exchangeBinding(); });

      window.authPopup.onAuthenticated((user) => {
        state.user = user;
        state.isPending = false;
        state.authError = "";
        if (!state.runtimeUserId.trim()) {
          state.runtimeUserId = sessionUserId(user);
        }
        void refreshWorkspaces();
        render();
      });

      window.authPopup.onUserUpdated((user) => {
        state.user = user;
        state.isPending = false;
        state.authError = "";
        if (!state.runtimeUserId.trim()) {
          state.runtimeUserId = sessionUserId(user);
        }
        void refreshWorkspaces();
        render();
      });

      window.authPopup.onError((payload) => {
        state.isPending = false;
        state.authError = payload?.message || ((payload?.status || "") + " " + (payload?.statusText || "")).trim() || "Authentication failed.";
        render();
      });

      window.authPopup.onRuntimeConfigChange((config) => {
        syncFormFromConfig(config);
        render();
      });

      window.authPopup.onRuntimeStateChange((runtimeStatus) => {
        state.runtimeStatus = runtimeStatus;
        render();
      });

      Promise.all([refreshSession(), refreshConfig(), refreshRuntimeStatus(), refreshWorkspaces()]).then(() => render());
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

async function recordHistoryVisit(entry: Pick<BrowserHistoryEntryPayload, "url" | "title" | "faviconUrl">) {
  const url = entry.url.trim();
  if (!shouldTrackHistoryUrl(url)) {
    return;
  }

  const now = new Date().toISOString();
  const existing = browserHistory.find((item) => item.url === url);

  if (existing) {
    browserHistory = browserHistory
      .map((item) =>
        item.id === existing.id
          ? {
              ...item,
              title: entry.title?.trim() || item.title || url,
              faviconUrl: entry.faviconUrl || item.faviconUrl,
              visitCount: item.visitCount + 1,
              lastVisitedAt: now
            }
          : item
      )
      .sort((a, b) => new Date(b.lastVisitedAt).getTime() - new Date(a.lastVisitedAt).getTime());
  } else {
    browserHistory = [
      {
        id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url,
        title: entry.title?.trim() || url,
        faviconUrl: entry.faviconUrl,
        visitCount: 1,
        createdAt: now,
        lastVisitedAt: now
      },
      ...browserHistory
    ]
      .sort((a, b) => new Date(b.lastVisitedAt).getTime() - new Date(a.lastVisitedAt).getTime())
      .slice(0, 500);
  }

  emitHistoryState();
  await persistHistory();
}

function getActiveBrowserTab(): BrowserTabRecord | null {
  if (!activeBrowserTabId) {
    return null;
  }

  return browserTabs.get(activeBrowserTabId) ?? null;
}

function applyBoundsToTab(tabId: string) {
  const tab = browserTabs.get(tabId);
  if (!tab) {
    return;
  }

  tab.view.setBounds(browserBounds);
}

function updateAttachedBrowserView() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const activeTab = getActiveBrowserTab();
  if (!activeTab) {
    return;
  }

  mainWindow.setBrowserView(activeTab.view);
  applyBoundsToTab(activeBrowserTabId);
}

function syncBrowserState(tabId: string) {
  const tab = browserTabs.get(tabId);
  if (!tab) {
    return;
  }

  const viewContents = tab.view.webContents;
  tab.state = {
    ...tab.state,
    url: viewContents.getURL() || tab.state.url,
    title: viewContents.getTitle() || tab.state.title,
    faviconUrl: tab.state.faviconUrl,
    canGoBack: viewContents.navigationHistory.canGoBack(),
    canGoForward: viewContents.navigationHistory.canGoForward()
  };
  emitBrowserState();
}

function handleBrowserWindowOpenAsTab(targetUrl: string, disposition: string) {
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

  const nextTabId = createBrowserTab(normalizedUrl);
  if (!nextTabId) {
    return;
  }

  if (disposition !== "background-tab") {
    activeBrowserTabId = nextTabId;
    updateAttachedBrowserView();
  }

  emitBrowserState();
}

function createBrowserTab(initialUrl?: string) {
  if (!mainWindow) {
    return null;
  }

  const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const view = new BrowserView({
    webPreferences: {
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  const hasInitialUrl = Boolean(initialUrl && initialUrl.trim().length > 0);
  const state = createBrowserState({
    id: tabId,
    url: hasInitialUrl ? initialUrl : "",
    initialized: !hasInitialUrl
  });
  browserTabs.set(tabId, { view, state });

  view.setBounds(browserBounds);
  view.setAutoResize({ width: false, height: false, horizontal: false, vertical: false });
  view.webContents.setWindowOpenHandler(({ url, disposition }) => {
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

    const shouldOpenAsTab = disposition === "foreground-tab" || disposition === "background-tab";
    if (shouldOpenAsTab) {
      handleBrowserWindowOpenAsTab(normalizedUrl, disposition);
      return { action: "deny" };
    }

    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        parent: mainWindow ?? undefined,
        width: 520,
        height: 760,
        minWidth: 420,
        minHeight: 560,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: "#111214",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      }
    };
  });
  view.webContents.on("did-create-window", (window) => {
    if (browserPopupWindow && !browserPopupWindow.isDestroyed() && browserPopupWindow !== window) {
      browserPopupWindow.close();
    }

    browserPopupWindow = window;
    window.webContents.setWindowOpenHandler(({ url, disposition }) => {
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

      handleBrowserWindowOpenAsTab(normalizedUrl, disposition);
      return { action: "deny" };
    });
    window.once("ready-to-show", () => {
      window.show();
    });
    window.on("closed", () => {
      if (browserPopupWindow === window) {
        browserPopupWindow = null;
      }
    });
  });
  view.webContents.setZoomFactor(1);
  view.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);

  view.webContents.on("dom-ready", () => {
    const currentTab = browserTabs.get(tabId);
    if (!currentTab) {
      return;
    }

    currentTab.state = { ...currentTab.state, initialized: true, error: "" };
    syncBrowserState(tabId);
  });

  view.webContents.on("did-start-loading", () => {
    const currentTab = browserTabs.get(tabId);
    if (!currentTab) {
      return;
    }

    currentTab.state = { ...currentTab.state, loading: true, error: "" };
    syncBrowserState(tabId);
  });

  view.webContents.on("did-stop-loading", () => {
    const currentTab = browserTabs.get(tabId);
    if (!currentTab) {
      return;
    }

    currentTab.state = { ...currentTab.state, loading: false, error: "" };
    syncBrowserState(tabId);
    void recordHistoryVisit({
      url: currentTab.view.webContents.getURL() || currentTab.state.url,
      title: currentTab.view.webContents.getTitle() || currentTab.state.title,
      faviconUrl: currentTab.state.faviconUrl
    });
  });

  view.webContents.on("page-title-updated", () => {
    syncBrowserState(tabId);
  });

  view.webContents.on("page-favicon-updated", (_event, favicons) => {
    const currentTab = browserTabs.get(tabId);
    if (!currentTab) {
      return;
    }

    currentTab.state = {
      ...currentTab.state,
      faviconUrl: favicons[0] || currentTab.state.faviconUrl
    };
    emitBrowserState();
  });

  view.webContents.on("did-navigate", () => {
    syncBrowserState(tabId);
  });

  view.webContents.on("did-navigate-in-page", () => {
    syncBrowserState(tabId);
  });

  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }

    const currentTab = browserTabs.get(tabId);
    if (!currentTab) {
      return;
    }

    currentTab.state = {
      ...currentTab.state,
      loading: false,
      error: `${errorDescription} (${errorCode})`,
      url: validatedURL || currentTab.state.url
    };
    emitBrowserState();
  });

  if (hasInitialUrl) {
    void view.webContents.loadURL(initialUrl!).catch((error) => {
      const currentTab = browserTabs.get(tabId);
      if (!currentTab) {
        return;
      }

      currentTab.state = {
        ...currentTab.state,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load page."
      };
      emitBrowserState();
    });
  }

  return tabId;
}

function ensureBrowserTabs() {
  if (!mainWindow || browserTabs.size > 0) {
    return;
  }

  const initialTabId = createBrowserTab(HOME_URL);
  if (!initialTabId) {
    return;
  }

  activeBrowserTabId = initialTabId;
  updateAttachedBrowserView();
}

function setActiveBrowserTab(tabId: string) {
  if (!browserTabs.has(tabId)) {
    return getBrowserTabsSnapshot();
  }

  activeBrowserTabId = tabId;
  updateAttachedBrowserView();
  emitBrowserState();
  return getBrowserTabsSnapshot();
}

function closeBrowserTab(tabId: string) {
  const tab = browserTabs.get(tabId);
  if (!tab) {
    return getBrowserTabsSnapshot();
  }

  const tabIds = Array.from(browserTabs.keys());
  const closedIndex = tabIds.indexOf(tabId);
  browserTabs.delete(tabId);
  tab.view.webContents.removeAllListeners();
  void tab.view.webContents.close();

  if (browserTabs.size === 0) {
    const replacementTabId = createBrowserTab(HOME_URL);
    activeBrowserTabId = replacementTabId ?? "";
  } else if (activeBrowserTabId === tabId) {
    const remainingIds = Array.from(browserTabs.keys());
    activeBrowserTabId = remainingIds[Math.max(0, closedIndex - 1)] ?? remainingIds[0] ?? "";
  }

  updateAttachedBrowserView();
  emitBrowserState();
  return getBrowserTabsSnapshot();
}

function setBrowserBounds(bounds: BrowserBoundsPayload) {
  browserBounds = {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height))
  };

  applyBoundsToTab(activeBrowserTabId);
}

function registerDownloadTracking() {
  session.defaultSession.on("will-download", (_event, item: DownloadItem) => {
    const createdAt = new Date().toISOString();
    const downloadId = `download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const savePath = path.join(app.getPath("downloads"), item.getFilename());
    item.setSavePath(savePath);

    const payload: BrowserDownloadPayload = {
      id: downloadId,
      url: item.getURL(),
      filename: item.getFilename(),
      targetPath: savePath,
      status: "progressing",
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      createdAt,
      completedAt: null
    };

    browserDownloads = [payload, ...browserDownloads].slice(0, 100);
    emitDownloadsState();
    void persistDownloads();

    const updateDownload = (patch: Partial<BrowserDownloadPayload>) => {
      browserDownloads = browserDownloads.map((download) => (download.id === downloadId ? { ...download, ...patch } : download));
      emitDownloadsState();
      void persistDownloads();
    };

    item.on("updated", (_updatedEvent, state) => {
      updateDownload({
        status: state === "interrupted" ? "interrupted" : "progressing",
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes()
      });
    });

    item.once("done", (_doneEvent, state) => {
      const nextStatus: BrowserDownloadStatus =
        state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "interrupted";
      updateDownload({
        status: nextStatus,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        completedAt: nextStatus === "completed" ? new Date().toISOString() : null
      });
    });
  });
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
      sandbox: false
    }
  });

  authPopupWindow.on("blur", () => {
    authPopupWindow?.hide();
  });

  authPopupWindow.on("closed", () => {
    authPopupWindow = null;
  });

  const html = createAuthPopupHtml();
  void authPopupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return authPopupWindow;
}

function toggleAuthPopup(anchorBounds: BrowserAnchorBoundsPayload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const popup = ensureAuthPopupWindow();
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
      Math.max(contentBounds.x + anchorBounds.x, contentBounds.x + 8),
      contentBounds.x + contentBounds.width - AUTH_POPUP_WIDTH - 8
    )
  );
  const y = Math.round(contentBounds.y + anchorBounds.y + anchorBounds.height + 8);

  popup.setBounds({
    x,
    y,
    width: AUTH_POPUP_WIDTH,
    height: AUTH_POPUP_HEIGHT
  });
  popup.show();
  popup.focus();
  emitPendingAuthState();
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
      sandbox: false
    }
  });

  downloadsPopupWindow.on("blur", () => {
    downloadsPopupWindow?.hide();
  });

  downloadsPopupWindow.on("closed", () => {
    downloadsPopupWindow = null;
  });

  const html = createDownloadsPopupHtml();
  void downloadsPopupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
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
      Math.max(contentBounds.x + anchorBounds.x + anchorBounds.width - DOWNLOADS_POPUP_WIDTH, contentBounds.x + 8),
      contentBounds.x + contentBounds.width - DOWNLOADS_POPUP_WIDTH - 8
    )
  );
  const y = Math.round(contentBounds.y + anchorBounds.y + anchorBounds.height + 8);

  popup.setBounds({
    x,
    y,
    width: DOWNLOADS_POPUP_WIDTH,
    height: DOWNLOADS_POPUP_HEIGHT
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
      sandbox: false
    }
  });

  historyPopupWindow.on("blur", () => {
    historyPopupWindow?.hide();
  });

  historyPopupWindow.on("closed", () => {
    historyPopupWindow = null;
  });

  const html = createHistoryPopupHtml();
  void historyPopupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
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
      Math.max(contentBounds.x + anchorBounds.x + anchorBounds.width - HISTORY_POPUP_WIDTH, contentBounds.x + 8),
      contentBounds.x + contentBounds.width - HISTORY_POPUP_WIDTH - 8
    )
  );
  const y = Math.round(contentBounds.y + anchorBounds.y + anchorBounds.height + 8);

  popup.setBounds({
    x,
    y,
    width: HISTORY_POPUP_WIDTH,
    height: HISTORY_POPUP_HEIGHT
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
      <button class="item" id="history"><span class="icon">🕘</span><span>History</span></button>
    </div>
    <script>
      document.getElementById("history").addEventListener("click", () => window.overflowPopup.openHistory());
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
      sandbox: false
    }
  });

  overflowPopupWindow.on("blur", () => {
    overflowPopupWindow?.hide();
  });

  overflowPopupWindow.on("closed", () => {
    overflowPopupWindow = null;
  });

  const html = createOverflowPopupHtml();
  void overflowPopupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return overflowPopupWindow;
}

function ensureAddressSuggestionsPopupWindow() {
  if (addressSuggestionsPopupWindow && !addressSuggestionsPopupWindow.isDestroyed()) {
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
      sandbox: false
    }
  });

  addressSuggestionsPopupWindow.on("closed", () => {
    addressSuggestionsPopupWindow = null;
  });

  const html = createAddressSuggestionsPopupHtml();
  void addressSuggestionsPopupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return addressSuggestionsPopupWindow;
}

function showAddressSuggestionsPopup(
  anchorBounds: BrowserAnchorBoundsPayload,
  suggestions: AddressSuggestionPayload[],
  selectedIndex: number
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
    Math.min(ADDRESS_SUGGESTIONS_POPUP_MAX_HEIGHT, suggestions.length * itemHeight + 8)
  );

  popup.setBounds({
    x: Math.round(contentBounds.x + anchorBounds.x),
    y: Math.round(contentBounds.y + anchorBounds.y + anchorBounds.height),
    width: Math.round(anchorBounds.width),
    height: popupHeight
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
      Math.max(contentBounds.x + anchorBounds.x + anchorBounds.width - OVERFLOW_POPUP_WIDTH, contentBounds.x + 8),
      contentBounds.x + contentBounds.width - OVERFLOW_POPUP_WIDTH - 8
    )
  );
  const y = Math.round(contentBounds.y + anchorBounds.y + anchorBounds.height + 8);

  popup.setBounds({
    x,
    y,
    width: OVERFLOW_POPUP_WIDTH,
    height: OVERFLOW_POPUP_HEIGHT
  });
  popup.show();
  popup.focus();
}

function createMainWindow() {
  const macTitleBarOptions =
    process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 30 }
        }
      : {};

  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    center: true,
    backgroundColor: "#050907",
    autoHideMenuBar: true,
    ...macTitleBarOptions,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow = win;
  browserBounds = { x: 0, y: 0, width: 0, height: 0 };
  activeBrowserTabId = "";
  browserTabs.clear();
  ensureBrowserTabs();

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomFactor(1);
    win.webContents.setZoomLevel(0);
    emitBrowserState();
    emitPendingAuthState();
    emitAppUpdateState();
  });

  win.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    const isZoomHotkey =
      input.control &&
      (key === "+" || key === "-" || key === "=" || key === "0" || key === "add" || key === "subtract");
    if (isZoomHotkey) {
      event.preventDefault();
      win.webContents.setZoomFactor(1);
      win.webContents.setZoomLevel(0);
    }
  });

  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.once("ready-to-show", () => {
    const display = screen.getDisplayMatching(win.getBounds());
    const { x, y, width, height } = display.workArea;
    win.setBounds({ x, y, width, height });
    win.show();
  });

  win.on("closed", () => {
    authPopupWindow?.close();
    authPopupWindow = null;
    addressSuggestionsPopupWindow?.close();
    addressSuggestionsPopupWindow = null;
    browserPopupWindow?.close();
    browserPopupWindow = null;
    downloadsPopupWindow?.close();
    downloadsPopupWindow = null;
    historyPopupWindow?.close();
    historyPopupWindow = null;
    overflowPopupWindow?.close();
    overflowPopupWindow = null;
    browserTabs.clear();
    mainWindow = null;
  });
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(AUTH_CALLBACK_PROTOCOL, process.execPath, [path.resolve(process.argv[1]!)]);
  } else {
    app.setAsDefaultProtocolClient(AUTH_CALLBACK_PROTOCOL);
  }

  app.on("second-instance", (_event, commandLine) => {
    const callbackUrl = commandLine.map((value) => maybeAuthCallbackUrl(value)).find((value) => value !== null);
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

  const initialCallbackUrl = process.argv.map((value) => maybeAuthCallbackUrl(value)).find((value) => value !== null);
  if (initialCallbackUrl) {
    void handleAuthCallbackUrl(initialCallbackUrl);
  }
}

app.whenReady().then(async () => {
  await loadBrowserPersistence();
  await bootstrapRuntimeDatabase();
  registerDownloadTracking();

  ipcMain.handle("fs:listDirectory", async (_event, targetPath?: string | null) => listDirectory(targetPath));
  ipcMain.handle("fs:readFilePreview", async (_event, targetPath: string) => readFilePreview(targetPath));
  ipcMain.handle("fs:writeTextFile", async (_event, targetPath: string, content: string) => writeTextFile(targetPath, content));
  ipcMain.handle("fs:getBookmarks", () => fileBookmarks);
  ipcMain.handle("fs:addBookmark", async (_event, targetPath: string, label?: string) => {
    const resolvedPath = path.resolve(targetPath);
    const stat = await fs.stat(resolvedPath);
    const nextLabel = label?.trim() || path.basename(resolvedPath) || resolvedPath;
    const existing = fileBookmarks.find((bookmark) => bookmark.targetPath === resolvedPath);

    if (existing) {
      if (existing.label !== nextLabel || existing.isDirectory !== stat.isDirectory()) {
        fileBookmarks = fileBookmarks.map((bookmark) =>
          bookmark.id === existing.id
            ? { ...bookmark, label: nextLabel, isDirectory: stat.isDirectory() }
            : bookmark
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
        createdAt: new Date().toISOString()
      },
      ...fileBookmarks
    ];
    emitFileBookmarksState();
    await persistFileBookmarks();
    return fileBookmarks;
  });
  ipcMain.handle("fs:removeBookmark", async (_event, bookmarkId: string) => {
    fileBookmarks = fileBookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
    emitFileBookmarksState();
    await persistFileBookmarks();
    return fileBookmarks;
  });
  ipcMain.handle("runtime:getStatus", () => refreshRuntimeStatus());
  ipcMain.handle("runtime:restart", async () => {
    await stopEmbeddedRuntime();
    return startEmbeddedRuntime();
  });
  ipcMain.handle("auth:getUser", async () => getAuthenticatedUser());
  ipcMain.handle("auth:requestAuth", async () => {
    await requireAuthClient().requestAuth();
  });
  ipcMain.handle("auth:signOut", async () => {
    await requireAuthClient().signOut();
    const runtimeConfig = await readRuntimeConfigFile();
    if (runtimeConfigIsControlPlaneManaged(runtimeConfig) && runtimeModelProxyApiKeyFromConfig(runtimeConfig)) {
      await clearRuntimeBindingSecrets("auth_sign_out");
    }
    emitAuthUserUpdated(null);
  });
  ipcMain.handle("auth:togglePopup", (_event, anchorBounds: BrowserAnchorBoundsPayload) => {
    toggleAuthPopup(anchorBounds);
  });
  ipcMain.handle("auth:closePopup", () => {
    authPopupWindow?.hide();
  });
  ipcMain.handle("runtime:getConfig", () => getRuntimeConfig());
  ipcMain.handle("runtime:setConfig", async (_event, payload: RuntimeConfigUpdatePayload) => {
    const currentConfig = await readRuntimeConfigFile();
    const nextConfig = await writeRuntimeConfigFile(payload);
    await restartEmbeddedRuntimeIfNeeded(currentConfig, nextConfig);
    const config = await getRuntimeConfig();
    await emitRuntimeConfig(config);
    return config;
  });
  ipcMain.handle("ui:getTheme", async () => currentTheme);
  ipcMain.handle("ui:toggleWindowSize", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const targetWindow = senderWindow && !senderWindow.isDestroyed() ? senderWindow : mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
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
  ipcMain.handle("ui:setTheme", async (_event, theme: string) => {
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
  });
  ipcMain.handle("appUpdate:getStatus", async () => appUpdateStatus);
  ipcMain.handle("appUpdate:checkNow", async () => checkForAppUpdates());
  ipcMain.handle("appUpdate:dismiss", async (_event, releaseTag?: string | null) => dismissAppUpdate(releaseTag));
  ipcMain.handle("appUpdate:openDownload", async () => {
    await openAppUpdateDownload();
  });
  ipcMain.handle("runtime:exchangeBinding", async (_event, sandboxId: string) => {
    const binding = await exchangeDesktopRuntimeBinding(sandboxId);
    const modelProxyApiKey = runtimeBindingModelProxyApiKey(binding);
    if (!modelProxyApiKey) {
      throw new Error("Runtime binding response missing model_proxy_api_key.");
    }
    const currentConfig = await readRuntimeConfigFile();
    const nextConfig = await writeRuntimeConfigFile({
      authToken: modelProxyApiKey,
      modelProxyApiKey,
      userId: binding.holaboss_user_id,
      sandboxId: binding.sandbox_id,
      modelProxyBaseUrl: binding.model_proxy_base_url,
      defaultModel: binding.default_model,
      controlPlaneBaseUrl: DESKTOP_CONTROL_PLANE_BASE_URL
    });
    await restartEmbeddedRuntimeIfNeeded(currentConfig, nextConfig);
    const config = await getRuntimeConfig();
    await emitRuntimeConfig(config);
    return config;
  });
  ipcMain.handle("workspace:getClientConfig", () => getHolabossClientConfig());
  ipcMain.handle("workspace:listMarketplaceTemplates", async () => listMarketplaceTemplates());
  ipcMain.handle("workspace:pickTemplateFolder", async () => pickTemplateFolder());
  ipcMain.handle("workspace:listWorkspaces", async () => listWorkspaces());
  ipcMain.handle("workspace:listInstalledApps", async (_event, workspaceId: string) => listInstalledApps(workspaceId));
  ipcMain.handle("workspace:startInstalledApp", async (_event, workspaceId: string, appId: string) =>
    startInstalledApp(workspaceId, appId)
  );
  ipcMain.handle("workspace:stopInstalledApp", async (_event, workspaceId: string, appId: string) =>
    stopInstalledApp(workspaceId, appId)
  );
  ipcMain.handle("workspace:listOutputs", async (_event, workspaceId: string) => listOutputs(workspaceId));
  ipcMain.handle("workspace:getWorkspaceRoot", async (_event, workspaceId: string) => workspaceDirectoryPath(workspaceId));
  ipcMain.handle("workspace:createWorkspace", async (_event, payload: HolabossCreateWorkspacePayload) => createWorkspace(payload));
  ipcMain.handle("workspace:listCronjobs", async (_event, workspaceId: string, enabledOnly?: boolean) =>
    listCronjobs(workspaceId, enabledOnly)
  );
  ipcMain.handle("workspace:createCronjob", async (_event, payload: CronjobCreatePayload) => createCronjob(payload));
  ipcMain.handle("workspace:updateCronjob", async (_event, jobId: string, payload: CronjobUpdatePayload) =>
    updateCronjob(jobId, payload)
  );
  ipcMain.handle("workspace:deleteCronjob", async (_event, jobId: string) => deleteCronjob(jobId));
  ipcMain.handle("workspace:listTaskProposals", async (_event, workspaceId: string) => listTaskProposals(workspaceId));
  ipcMain.handle("workspace:updateTaskProposalState", async (_event, proposalId: string, state: string) =>
    updateTaskProposalState(proposalId, state)
  );
  ipcMain.handle("workspace:enqueueRemoteDemoTaskProposal", async (_event, payload: DemoTaskProposalRequestPayload) =>
    enqueueRemoteDemoTaskProposal(payload)
  );
  ipcMain.handle("workspace:listRuntimeStates", async (_event, workspaceId: string) => listRuntimeStates(workspaceId));
  ipcMain.handle("workspace:getSessionHistory", async (_event, payload: { sessionId: string; workspaceId: string }) =>
    getSessionHistory(payload.sessionId, payload.workspaceId)
  );
  ipcMain.handle("workspace:queueSessionInput", async (_event, payload: HolabossQueueSessionInputPayload) =>
    queueSessionInput(payload)
  );
  ipcMain.handle("workspace:openSessionOutputStream", async (_event, payload: HolabossStreamSessionOutputsPayload) =>
    openSessionOutputStream(payload)
  );
  ipcMain.handle("workspace:closeSessionOutputStream", async (_event, streamId: string, reason?: string) =>
    closeSessionOutputStream(streamId, reason)
  );
  ipcMain.handle("workspace:getSessionStreamDebug", async () =>
    verboseTelemetryEnabled ? sessionStreamDebugLog.slice(-600) : []
  );
  ipcMain.handle("workspace:isVerboseTelemetryEnabled", async () => verboseTelemetryEnabled);
  ipcMain.handle("browser:getState", () => {
    ensureBrowserTabs();
    return getBrowserTabsSnapshot();
  });
  ipcMain.handle("browser:setBounds", (_event, bounds: BrowserBoundsPayload) => {
    ensureBrowserTabs();
    setBrowserBounds(bounds);
    return getBrowserTabsSnapshot();
  });
  ipcMain.handle("browser:navigate", async (_event, targetUrl: string) => {
    ensureBrowserTabs();
    const activeTab = getActiveBrowserTab();
    if (!activeTab) {
      return getBrowserTabsSnapshot();
    }

    try {
      activeTab.state = { ...activeTab.state, error: "" };
      await activeTab.view.webContents.loadURL(targetUrl);
    } catch (error) {
      activeTab.state = {
        ...activeTab.state,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load URL."
      };
      emitBrowserState();
    }

    return getBrowserTabsSnapshot();
  });
  ipcMain.handle("browser:back", () => {
    const activeTab = getActiveBrowserTab();
    if (activeTab?.view.webContents.navigationHistory.canGoBack()) {
      activeTab.view.webContents.navigationHistory.goBack();
    }
    return getBrowserTabsSnapshot();
  });
  ipcMain.handle("browser:forward", () => {
    const activeTab = getActiveBrowserTab();
    if (activeTab?.view.webContents.navigationHistory.canGoForward()) {
      activeTab.view.webContents.navigationHistory.goForward();
    }
    return getBrowserTabsSnapshot();
  });
  ipcMain.handle("browser:reload", () => {
    getActiveBrowserTab()?.view.webContents.reload();
    return getBrowserTabsSnapshot();
  });
  ipcMain.handle("browser:newTab", async (_event, targetUrl?: string) => {
    ensureBrowserTabs();
    const nextTabId = createBrowserTab(targetUrl);
    if (nextTabId) {
      activeBrowserTabId = nextTabId;
      updateAttachedBrowserView();
      emitBrowserState();
    }
    return getBrowserTabsSnapshot();
  });
  ipcMain.handle("browser:setActiveTab", (_event, tabId: string) => {
    ensureBrowserTabs();
    return setActiveBrowserTab(tabId);
  });
  ipcMain.handle("browser:closeTab", (_event, tabId: string) => {
    ensureBrowserTabs();
    return closeBrowserTab(tabId);
  });
  ipcMain.handle("browser:getBookmarks", () => browserBookmarks);
  ipcMain.handle("browser:addBookmark", async (_event, payload: { url: string; title?: string }) => {
    const url = payload.url.trim();
    if (!url) {
      return browserBookmarks;
    }

    const activeTab = getActiveBrowserTab();
    const faviconUrl = activeTab?.state.url === url ? activeTab.state.faviconUrl : undefined;

    const existing = browserBookmarks.find((bookmark) => bookmark.url === url);
    if (existing) {
      const nextTitle = payload.title?.trim() || existing.title;
      const nextFaviconUrl = faviconUrl || existing.faviconUrl;
      if (nextTitle !== existing.title || nextFaviconUrl !== existing.faviconUrl) {
        browserBookmarks = browserBookmarks.map((bookmark) =>
          bookmark.id === existing.id ? { ...bookmark, title: nextTitle, faviconUrl: nextFaviconUrl } : bookmark
        );
        emitBookmarksState();
        await persistBookmarks();
      }
      return browserBookmarks;
    }

    browserBookmarks = [
      {
        id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url,
        title: payload.title?.trim() || url,
        faviconUrl,
        createdAt: new Date().toISOString()
      },
      ...browserBookmarks
    ];
    emitBookmarksState();
    await persistBookmarks();
    return browserBookmarks;
  });
  ipcMain.handle("browser:removeBookmark", async (_event, bookmarkId: string) => {
    browserBookmarks = browserBookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
    emitBookmarksState();
    await persistBookmarks();
    return browserBookmarks;
  });
  ipcMain.handle("browser:getDownloads", () => browserDownloads);
  ipcMain.handle("browser:getHistory", () => browserHistory);
  ipcMain.handle(
    "browser:showAddressSuggestions",
    (_event, anchorBounds: BrowserAnchorBoundsPayload, suggestions: AddressSuggestionPayload[], selectedIndex: number) => {
      showAddressSuggestionsPopup(anchorBounds, suggestions, selectedIndex);
    }
  );
  ipcMain.handle("browser:hideAddressSuggestions", () => {
    hideAddressSuggestionsPopup();
  });
  ipcMain.handle("browser:chooseAddressSuggestion", (_event, index: number) => {
    hideAddressSuggestionsPopup();
    mainWindow?.webContents.send("browser:addressSuggestionChosen", index);
  });
  ipcMain.handle("browser:toggleOverflowPopup", (_event, anchorBounds: BrowserAnchorBoundsPayload) => {
    toggleOverflowPopup(anchorBounds);
  });
  ipcMain.handle("browser:overflowOpenHistory", () => {
    overflowPopupWindow?.hide();
    if (overflowAnchorBounds) {
      toggleHistoryPopup(overflowAnchorBounds);
    }
  });
  ipcMain.handle("browser:toggleHistoryPopup", (_event, anchorBounds: BrowserAnchorBoundsPayload) => {
    toggleHistoryPopup(anchorBounds);
  });
  ipcMain.handle("browser:closeHistoryPopup", () => {
    historyPopupWindow?.hide();
  });
  ipcMain.handle("browser:openHistoryUrl", async (_event, targetUrl: string) => {
    ensureBrowserTabs();
    const activeTab = getActiveBrowserTab();
    if (!activeTab) {
      return getBrowserTabsSnapshot();
    }

    try {
      historyPopupWindow?.hide();
      activeTab.state = { ...activeTab.state, error: "" };
      await activeTab.view.webContents.loadURL(targetUrl);
    } catch (error) {
      activeTab.state = {
        ...activeTab.state,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load URL."
      };
      emitBrowserState();
    }

    return getBrowserTabsSnapshot();
  });
  ipcMain.handle("browser:removeHistoryEntry", async (_event, historyId: string) => {
    browserHistory = browserHistory.filter((entry) => entry.id !== historyId);
    emitHistoryState();
    await persistHistory();
    return browserHistory;
  });
  ipcMain.handle("browser:clearHistory", async () => {
    browserHistory = [];
    emitHistoryState();
    await persistHistory();
    return browserHistory;
  });
  ipcMain.handle("browser:toggleDownloadsPopup", (_event, anchorBounds: BrowserAnchorBoundsPayload) => {
    toggleDownloadsPopup(anchorBounds);
  });
  ipcMain.handle("browser:closeDownloadsPopup", () => {
    downloadsPopupWindow?.hide();
  });
  ipcMain.handle("browser:showDownloadInFolder", async (_event, downloadId: string) => {
    const download = browserDownloads.find((item) => item.id === downloadId);
    if (!download?.targetPath) {
      return false;
    }

    return shell.showItemInFolder(download.targetPath);
  });
  ipcMain.handle("browser:openDownload", async (_event, downloadId: string) => {
    const download = browserDownloads.find((item) => item.id === downloadId);
    if (!download?.targetPath) {
      return "Download not found.";
    }

    return shell.openPath(download.targetPath);
  });

  createMainWindow();
  scheduleAppUpdateChecks();
  void checkForAppUpdates();
  try {
    await startDesktopBrowserService();
  } catch (error) {
    void appendRuntimeLog(
      `[desktop-browser-service] failed to start: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
  runtimeStatus = withDesktopBrowserStatus({
    ...runtimeStatus,
    status: "starting",
    url: `http://127.0.0.1:${RUNTIME_API_PORT}`,
    sandboxRoot: runtimeSandboxRoot(),
    harness: process.env.HOLABOSS_RUNTIME_HARNESS || "opencode",
    lastError: ""
  });
  emitRuntimeState();
  void startEmbeddedRuntime();
  void syncPersistedAuthSessionOnStartup();

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

app.on("before-quit", () => {
  void stopDesktopBrowserService();
  void stopEmbeddedRuntime();
});
