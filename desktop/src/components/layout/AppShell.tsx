import {
    LeftNavigationRail,
    type LeftRailItem,
} from "@/components/layout/LeftNavigationRail";
import { NotificationToastStack } from "@/components/layout/NotificationToastStack";
import {
    OperationsDrawer,
    type OperationsDrawerTab,
} from "@/components/layout/OperationsDrawer";
import { SettingsDialog } from "@/components/layout/SettingsDialog";
import { TopTabsBar } from "@/components/layout/TopTabsBar";
import { appShellMainGridClassName } from "@/components/layout/appShellLayout";
import { FirstWorkspacePane } from "@/components/onboarding";
import { AppSurfacePane } from "@/components/panes/AppSurfacePane";
import { resolveAppSurfacePath } from "@/components/panes/appSurfaceRoute";
import { AutomationsPane } from "@/components/panes/AutomationsPane";
import { BrowserPane } from "@/components/panes/BrowserPane";
import { ChatPane } from "@/components/panes/ChatPane";
import {
    FileExplorerPane,
    type FileExplorerFocusRequest,
} from "@/components/panes/FileExplorerPane";
import { InternalSurfacePane } from "@/components/panes/InternalSurfacePane";
import { MarketplacePane } from "@/components/panes/MarketplacePane";
import { OnboardingPane } from "@/components/panes/OnboardingPane";
import { SkillsPane } from "@/components/panes/SkillsPane";
import { PublishDialog } from "@/components/publish/PublishDialog";
import { UpdateReminder } from "@/components/ui/UpdateReminder";
import { DesktopBillingProvider } from "@/lib/billing/useDesktopBilling";
import { getWorkspaceAppDefinition } from "@/lib/workspaceApps";
import {
    useWorkspaceDesktop,
    WorkspaceDesktopProvider,
} from "@/lib/workspaceDesktop";
import {
    useWorkspaceSelection,
    WorkspaceSelectionProvider,
} from "@/lib/workspaceSelection";
import { Button } from "@/components/ui/button";
import {
    CircleCheck,
    Clock3,
    Inbox as InboxIcon,
    Loader2,
    PanelRightClose,
    PanelRightOpen,
    TriangleAlert,
    XCircle,
} from "lucide-react";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from "react";

const THEME_STORAGE_KEY = "holaboss-theme-v1";
const DEV_APP_UPDATE_PREVIEW_STORAGE_KEY = "holaboss-dev-app-update-preview-v1";
const DEV_NOTIFICATION_TOAST_PREVIEW_ID_PREFIX =
  "dev-notification-toast-preview:";
const OPERATIONS_DRAWER_OPEN_STORAGE_KEY = "holaboss-operations-drawer-open-v1";
const OPERATIONS_DRAWER_TAB_STORAGE_KEY = "holaboss-operations-drawer-tab-v1";
const TASK_PROPOSAL_SEEN_STORAGE_KEY = "holaboss-task-proposal-seen-v1";
const FILES_PANE_WIDTH_STORAGE_KEY = "holaboss-files-pane-width-v1";
const BROWSER_PANE_WIDTH_STORAGE_KEY = "holaboss-browser-pane-width-v1";
const SPACE_VISIBILITY_STORAGE_KEY = "holaboss-space-visibility-v1";
const THEMES = [
  "amber-minimal-dark",
  "amber-minimal-light",
  "cosmic-night-dark",
  "cosmic-night-light",
  "sepia-dark",
  "sepia-light",
  "clean-slate-dark",
  "clean-slate-light",
  "bold-tech-dark",
  "bold-tech-light",
  "catppuccin-dark",
  "catppuccin-light",
  "bubblegum-dark",
  "bubblegum-light",
] as const;
const MIN_FILES_PANE_WIDTH = 220;
const MIN_BROWSER_PANE_WIDTH = 120;
const MAX_UTILITY_PANE_WIDTH = 720;
const LEGACY_DEFAULT_FILES_PANE_WIDTH = 420;
const DEFAULT_FILES_PANE_WIDTH = MIN_FILES_PANE_WIDTH;
const DEFAULT_BROWSER_PANE_WIDTH = 460;
const MIN_AGENT_CONTENT_WIDTH = 380;
const UTILITY_PANE_RESIZER_WIDTH = 16;
const APP_UPDATE_CHANGELOG_BASE_URL =
  "https://github.com/holaboss-ai/holaboss-ai/releases/tag";
const DEFAULT_NOTIFICATION_TOAST_DURATION_MS = 7_000;
const CRITICAL_NOTIFICATION_TOAST_DURATION_MS = 12_000;
const DEFAULT_PROACTIVE_HEARTBEAT_CRON = "0 9 * * *";
const MAX_SEEN_TASK_PROPOSAL_IDS_PER_WORKSPACE = 200;

type SpaceComponentId = "agent" | "files" | "browser";
type UtilityPaneId = "files" | "browser";
type DevAppUpdatePreviewMode = "off" | "downloading" | "ready";

type SpaceVisibilityState = Record<SpaceComponentId, boolean>;

type UtilityPaneResizeState =
  | {
      mode: "single";
      paneId: UtilityPaneId;
      startWidth: number;
      startX: number;
      direction: 1 | -1;
    }
  | {
      mode: "pair";
      leftPaneId: UtilityPaneId;
      rightPaneId: UtilityPaneId;
      startLeftWidth: number;
      startRightWidth: number;
      startX: number;
    };

const FIXED_SPACE_ORDER: SpaceComponentId[] = ["files", "browser", "agent"];
const DEFAULT_SPACE_VISIBILITY: SpaceVisibilityState = {
  agent: true,
  files: true,
  browser: true,
};

declare global {
  interface Window {
    __holabossDevUpdatePreview?: {
      downloading: () => void;
      ready: () => void;
      clear: () => void;
    };
    __holabossDevNotificationToastPreview?: {
      stack: () => void;
      clear: () => void;
    };
  }
}

export type AppTheme = (typeof THEMES)[number];

function isAppTheme(value: string): value is AppTheme {
  return THEMES.includes(value as AppTheme);
}

function isSettingsPaneSection(value: string): value is UiSettingsPaneSection {
  return (
    value === "account" ||
    value === "billing" ||
    value === "providers" ||
    value === "settings" ||
    value === "about"
  );
}

type AgentView =
  | { type: "chat" }
  | {
      type: "app";
      appId: string;
      resourceId?: string | null;
      view?: string | null;
    }
  | {
      type: "internal";
      surface: "document" | "preview" | "file" | "event";
      resourceId?: string | null;
      htmlContent?: string | null;
    };

type ChatSessionOpenRequest = {
  sessionId: string;
  requestKey: number;
  mode?: "session" | "draft";
  parentSessionId?: string | null;
};

type ChatComposerPrefillRequest = {
  text: string;
  requestKey: number;
};

type WorkspaceOutputNavigationTarget =
  | {
      type: "app";
      appId: string;
      resourceId?: string | null;
      view?: string | null;
    }
  | {
      type: "internal";
      surface: "document" | "preview" | "file" | "event";
      resourceId?: string | null;
      htmlContent?: string | null;
    };

function utilityPaneMinWidth(paneId: UtilityPaneId): number {
  return paneId === "files"
    ? MIN_FILES_PANE_WIDTH
    : MIN_BROWSER_PANE_WIDTH;
}

function notificationToastDurationMs(
  notification: RuntimeNotificationRecordPayload,
): number {
  return notification.priority === "critical"
    ? CRITICAL_NOTIFICATION_TOAST_DURATION_MS
    : DEFAULT_NOTIFICATION_TOAST_DURATION_MS;
}

function isDevNotificationToastPreviewId(notificationId: string): boolean {
  return notificationId.startsWith(DEV_NOTIFICATION_TOAST_PREVIEW_ID_PREFIX);
}

function buildDevNotificationToastPreviewNotifications(
  workspaceId: string | null,
): RuntimeNotificationRecordPayload[] {
  const normalizedWorkspaceId = workspaceId?.trim() || "dev-preview-workspace";
  const now = Date.now();
  return [
    {
      id: `${DEV_NOTIFICATION_TOAST_PREVIEW_ID_PREFIX}1`,
      workspace_id: normalizedWorkspaceId,
      cronjob_id: null,
      source_type: "dev_preview",
      source_label: "Preview",
      title: "Task proposal ready",
      message: "This is a collapsed preview stack. Hover it to fan the toasts out.",
      level: "info",
      priority: "normal",
      state: "unread",
      metadata: {},
      read_at: null,
      dismissed_at: null,
      created_at: new Date(now - 45_000).toISOString(),
      updated_at: new Date(now - 45_000).toISOString(),
    },
    {
      id: `${DEV_NOTIFICATION_TOAST_PREVIEW_ID_PREFIX}2`,
      workspace_id: normalizedWorkspaceId,
      cronjob_id: null,
      source_type: "dev_preview",
      source_label: "Preview",
      title: "Build completed",
      message: "A success toast helps show the stacked depth and color treatment.",
      level: "success",
      priority: "low",
      state: "unread",
      metadata: {},
      read_at: null,
      dismissed_at: null,
      created_at: new Date(now - 90_000).toISOString(),
      updated_at: new Date(now - 90_000).toISOString(),
    },
    {
      id: `${DEV_NOTIFICATION_TOAST_PREVIEW_ID_PREFIX}3`,
      workspace_id: normalizedWorkspaceId,
      cronjob_id: null,
      source_type: "dev_preview",
      source_label: "Preview",
      title: "Workflow waiting on input",
      message: "Use this preview hook whenever you want to inspect the stacked toast layout.",
      level: "warning",
      priority: "high",
      state: "unread",
      metadata: {},
      read_at: null,
      dismissed_at: null,
      created_at: new Date(now - 135_000).toISOString(),
      updated_at: new Date(now - 135_000).toISOString(),
    },
    {
      id: `${DEV_NOTIFICATION_TOAST_PREVIEW_ID_PREFIX}4`,
      workspace_id: normalizedWorkspaceId,
      cronjob_id: null,
      source_type: "dev_preview",
      source_label: "Preview",
      title: "Run failed",
      message: "The fourth toast makes the overlap obvious without needing real notification traffic.",
      level: "error",
      priority: "critical",
      state: "unread",
      metadata: {},
      read_at: null,
      dismissed_at: null,
      created_at: new Date(now - 180_000).toISOString(),
      updated_at: new Date(now - 180_000).toISOString(),
    },
  ];
}

function appUpdateChangelogUrl(
  status: AppUpdateStatusPayload,
): string | null {
  const version = status.latestVersion?.trim();
  if (!version) {
    return null;
  }
  return `${APP_UPDATE_CHANGELOG_BASE_URL}/holaboss-${version}`;
}

function notificationMetadataString(
  notification: RuntimeNotificationRecordPayload,
  key: string,
): string | null {
  const raw = notification.metadata[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function notificationActionUrl(
  notification: RuntimeNotificationRecordPayload,
): string | null {
  return notificationMetadataString(notification, "action_url");
}

function notificationTargetSessionId(
  notification: RuntimeNotificationRecordPayload,
): string | null {
  return notificationMetadataString(notification, "session_id");
}

function notificationActivationState(
  notification: RuntimeNotificationRecordPayload,
): RuntimeNotificationState {
  const activationState = notificationMetadataString(
    notification,
    "activation_state",
  )?.toLowerCase();
  if (activationState === "dismissed") {
    return "dismissed";
  }
  if (activationState === "read") {
    return "read";
  }
  return "read";
}

function loadSpaceVisibility(): SpaceVisibilityState {
  try {
    const raw = localStorage.getItem(SPACE_VISIBILITY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<
        Record<SpaceComponentId, unknown>
      >;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          agent: true,
          files: true,
          browser: true,
        };
      }
    }
  } catch {
    // ignore invalid persisted layout state
  }
  return DEFAULT_SPACE_VISIBILITY;
}

function loadFilesPaneWidth(): number {
  try {
    const raw = localStorage.getItem(FILES_PANE_WIDTH_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      if (parsed === LEGACY_DEFAULT_FILES_PANE_WIDTH) {
        return DEFAULT_FILES_PANE_WIDTH;
      }
      return Math.max(
        MIN_FILES_PANE_WIDTH,
        Math.min(parsed, MAX_UTILITY_PANE_WIDTH),
      );
    }
  } catch {
    // ignore
  }

  return DEFAULT_FILES_PANE_WIDTH;
}

function loadBrowserPaneWidth(): number {
  try {
    const raw = localStorage.getItem(BROWSER_PANE_WIDTH_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(
        MIN_BROWSER_PANE_WIDTH,
        Math.min(parsed, MAX_UTILITY_PANE_WIDTH),
      );
    }
  } catch {
    // ignore
  }

  return DEFAULT_BROWSER_PANE_WIDTH;
}

function loadOperationsDrawerOpen(): boolean {
  try {
    const raw = localStorage.getItem(OPERATIONS_DRAWER_OPEN_STORAGE_KEY);
    if (raw === "1" || raw === "true") {
      return true;
    }
    if (raw === "0" || raw === "false") {
      return false;
    }
  } catch {
    // ignore
  }

  return false;
}

function loadOperationsDrawerTab(): OperationsDrawerTab {
  try {
    const raw = localStorage.getItem(OPERATIONS_DRAWER_TAB_STORAGE_KEY);
    if (raw === "inbox" || raw === "running") {
      return raw;
    }
  } catch {
    // ignore
  }

  return "inbox";
}

function loadSeenTaskProposalIdsByWorkspace(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(TASK_PROPOSAL_SEEN_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const next: Record<string, string[]> = {};
    for (const [workspaceId, proposalIds] of Object.entries(parsed)) {
      const normalizedWorkspaceId = workspaceId.trim();
      if (!normalizedWorkspaceId || !Array.isArray(proposalIds)) {
        continue;
      }
      const cleaned = Array.from(
        new Set(
          proposalIds
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ).slice(-MAX_SEEN_TASK_PROPOSAL_IDS_PER_WORKSPACE);
      if (cleaned.length > 0) {
        next[normalizedWorkspaceId] = cleaned;
      }
    }
    return next;
  } catch {
    // ignore invalid persisted proposal state
  }

  return {};
}

function loadTheme(): AppTheme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && isAppTheme(stored)) {
      return stored;
    }
  } catch {
    // ignore
  }

  return "amber-minimal-light";
}

function normalizeDevAppUpdatePreviewMode(
  value: string | null | undefined,
): DevAppUpdatePreviewMode {
  if (value === "downloading" || value === "ready") {
    return value;
  }
  return "off";
}

function loadDevAppUpdatePreviewMode(): DevAppUpdatePreviewMode {
  if (!import.meta.env.DEV) {
    return "off";
  }

  try {
    return normalizeDevAppUpdatePreviewMode(
      localStorage.getItem(DEV_APP_UPDATE_PREVIEW_STORAGE_KEY),
    );
  } catch {
    return "off";
  }
}

function buildDevAppUpdatePreviewStatus(
  mode: DevAppUpdatePreviewMode,
  currentVersion: string,
): AppUpdateStatusPayload | null {
  if (mode === "off") {
    return null;
  }

  const now = new Date().toISOString();
  const latestVersion = "2026.4.99";

  return {
    supported: true,
    checking: false,
    available: mode === "downloading",
    downloaded: mode === "ready",
    downloadProgressPercent: mode === "downloading" ? 64 : 100,
    currentVersion: currentVersion.trim() || "0.1.0",
    latestVersion,
    releaseName: `Holaboss ${latestVersion}`,
    publishedAt: now,
    dismissedVersion: null,
    lastCheckedAt: now,
    error: "",
  };
}

function spaceComponentLabel(componentId: SpaceComponentId) {
  if (componentId === "agent") {
    return "Agent";
  }
  if (componentId === "files") {
    return "Files";
  }
  return "Browser";
}

function spaceResizeHandleSpec(
  leftPaneId: SpaceComponentId,
  rightPaneId: SpaceComponentId,
): {
  leftPaneId: SpaceComponentId;
  rightPaneId: SpaceComponentId;
  label: string;
} {
  if (leftPaneId === "agent") {
    return {
      leftPaneId,
      rightPaneId,
      label: `Resize ${spaceComponentLabel(rightPaneId).toLowerCase()} pane`,
    };
  }
  if (rightPaneId === "agent") {
    return {
      leftPaneId,
      rightPaneId,
      label: `Resize ${spaceComponentLabel(leftPaneId).toLowerCase()} pane`,
    };
  }
  return {
    leftPaneId,
    rightPaneId,
    label: `Resize ${spaceComponentLabel(leftPaneId).toLowerCase()} and ${spaceComponentLabel(rightPaneId).toLowerCase()} panes`,
  };
}

function normalizeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Request failed.";
  }
  // Strip Electron IPC wrapper: "Error invoking remote method '...': Error: <actual>"
  const ipcMatch = error.message.match(
    /^Error invoking remote method '[^']+': Error: (.+)$/s,
  );
  return ipcMatch ? ipcMatch[1] : error.message;
}

function inferInternalSurfaceFromOutputType(
  outputType: string,
): "document" | "preview" | "file" | "event" {
  const normalized = outputType.trim().toLowerCase();
  if (normalized === "document") {
    return "document";
  }
  if (normalized === "preview") {
    return "preview";
  }
  if (normalized === "file") {
    return "file";
  }
  return "event";
}

function workspaceOutputNavigationTarget(
  output: WorkspaceOutputRecordPayload,
  installedAppIds: Set<string>,
): WorkspaceOutputNavigationTarget {
  const moduleId = (output.module_id || "").trim().toLowerCase();
  const metadata = (output.metadata ?? {}) as Record<string, unknown>;
  const presentation = metadata.presentation as
    | { kind?: string; view?: string; path?: string }
    | undefined;
  const hasAppPresentation =
    presentation?.kind === "app_resource" && presentation.view;

  if (moduleId && installedAppIds.has(moduleId)) {
    return {
      type: "app",
      appId: moduleId,
      resourceId:
        hasAppPresentation && presentation?.path
          ? presentation.path
          : output.module_resource_id || output.artifact_id || output.id,
      view: hasAppPresentation
        ? presentation.view
        : output.output_type || "home",
    };
  }

  return {
    type: "internal",
    surface: inferInternalSurfaceFromOutputType(output.output_type),
    resourceId: output.file_path || output.artifact_id || output.id,
    htmlContent: output.html_content,
  };
}

function EmptyWorkspacePane() {
  return (
    <FocusPlaceholder
      eyebrow="Workspace"
      title="Select a workspace to continue"
      description="Your desktop layout is ready, but no active workspace is selected yet. Choose one from the switcher in the top bar."
    />
  );
}

function WorkspaceBootstrapPane() {
  return (
    <section className="relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden px-6">
      <div className="flex flex-col items-center text-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground/60" />
        <h2 className="mt-5 text-[17px] font-medium tracking-[-0.01em] text-foreground">
          Preparing desktop...
        </h2>
        <p className="mt-2 max-w-sm text-[13px] leading-6 text-muted-foreground/70">
          Restoring workspace state and attaching surfaces.
        </p>
      </div>
    </section>
  );
}

function WorkspaceInitializingGate({
  apps,
}: {
  apps: Array<{
    id: string;
    label: string;
    ready: boolean;
    error: string | null;
  }>;
}) {
  const hasErrors = apps.some((app) => app.error);
  const readyCount = apps.filter((app) => app.ready).length;

  return (
    <section className="relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden px-6">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        {hasErrors ? (
          <TriangleAlert size={20} className="text-rose-400" />
        ) : (
          <Loader2
            size={20}
            className="animate-spin text-muted-foreground/60"
          />
        )}

        <h2 className="mt-5 text-[17px] font-medium tracking-[-0.01em] text-foreground">
          {hasErrors ? "Some apps need attention" : "Setting up workspace"}
        </h2>
        <p className="mt-2 max-w-sm text-[13px] leading-6 text-muted-foreground/70">
          {hasErrors
            ? "Some workspace apps encountered errors."
            : "Starting workspace apps. This may take a moment on first setup."}
        </p>

        <div className="mt-6 w-full space-y-2">
          {apps.map((app) => (
            <div
              key={app.id}
              className="flex items-center gap-3 rounded-[14px] border border-border/35 bg-muted px-4 py-2.5"
            >
              {app.ready ? (
                <CircleCheck size={14} className="shrink-0 text-primary" />
              ) : app.error ? (
                <XCircle size={14} className="shrink-0 text-rose-400" />
              ) : (
                <Loader2
                  size={14}
                  className="shrink-0 animate-spin text-muted-foreground/50"
                />
              )}
              <span className="min-w-0 flex-1 text-left text-[13px] text-foreground">
                {app.label}
              </span>
              <span
                className={`text-[11px] ${
                  app.ready
                    ? "text-primary"
                    : app.error
                      ? "text-rose-400"
                      : "text-muted-foreground/60"
                }`}
              >
                {app.ready ? "Ready" : app.error ? "Failed" : "Setting up..."}
              </span>
            </div>
          ))}
        </div>

        {!hasErrors ? (
          <div className="mt-3 text-[12px] text-muted-foreground/60">
            {readyCount} of {apps.length} ready
          </div>
        ) : null}
      </div>
    </section>
  );
}

function FocusPlaceholder({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[var(--radius-xl)] shadow-lg">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(87,255,173,0.08),transparent_45%)]" />
      <div className="relative max-w-[520px] px-8 text-center">
        <div className="text-[10px] uppercase tracking-[0.18em] text-primary/78">
          {eyebrow}
        </div>
        <div className="mt-3 text-[28px] font-semibold tracking-[-0.03em] text-foreground">
          {title}
        </div>
        <div className="mt-3 text-[13px] leading-7 text-muted-foreground/84">
          {description}
        </div>
      </div>
    </section>
  );
}

function WorkspaceStartupErrorPane({ message }: { message: string }) {
  return (
    <section className="theme-shell relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[var(--radius-xl)] shadow-lg">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(247,90,84,0.12),transparent_32%),radial-gradient(circle_at_bottom,rgba(247,170,126,0.08),transparent_36%)]" />
      <div className="relative w-full max-w-[720px] px-6 py-8">
        <div className="theme-subtle-surface rounded-[30px] border border-[rgba(247,90,84,0.24)] p-6 shadow-lg sm:p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(247,90,84,0.22)] bg-[rgba(247,90,84,0.08)] px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[rgba(206,92,84,0.92)]">
            <TriangleAlert size={12} />
            <span>Desktop startup blocked</span>
          </div>
          <div className="mt-6 text-[30px] font-semibold tracking-[-0.04em] text-foreground">
            The local runtime failed to start
          </div>
          <div className="mt-3 text-[14px] leading-7 text-muted-foreground/84">
            The desktop shell cannot finish restoring workspaces until the
            embedded runtime comes online.
          </div>
          <div className="mt-6 rounded-[20px] border border-[rgba(247,90,84,0.22)] bg-[rgba(247,90,84,0.06)] px-4 py-4 text-[13px] leading-7 text-foreground">
            {message}
          </div>
          <div className="mt-5 text-[12px] leading-6 text-muted-foreground/76">
            Check `runtime.log` in the Electron userData directory and confirm
            the required desktop runtime configuration is present.
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceOnboardingTakeover({
  focusRequestKey,
}: {
  focusRequestKey: number;
}) {
  return (
    <section className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_16%,rgba(247,90,84,0.1),transparent_28%),radial-gradient(circle_at_88%_10%,rgba(247,170,126,0.08),transparent_24%),radial-gradient(circle_at_50%_100%,rgba(247,90,84,0.06),transparent_34%)]" />
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <OnboardingPane focusRequestKey={focusRequestKey} />
      </div>
    </section>
  );
}

function AppShellContent() {
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceSelection();
  const {
    runtimeConfig,
    workspaces,
    hasHydratedWorkspaceList,
    selectedWorkspace,
    installedApps,
    workspaceAppsReady,
    workspaceBlockingReason,
    workspaceErrorMessage,
    onboardingModeActive,
  } = useWorkspaceDesktop();
  const [theme, setTheme] = useState<AppTheme>(loadTheme);
  const [runtimeStatus, setRuntimeStatus] =
    useState<RuntimeStatusPayload | null>(null);
  const [appUpdateStatus, setAppUpdateStatus] =
    useState<AppUpdateStatusPayload | null>(null);
  const [devAppUpdatePreviewMode, setDevAppUpdatePreviewMode] =
    useState<DevAppUpdatePreviewMode>(loadDevAppUpdatePreviewMode);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsDialogSection, setSettingsDialogSection] =
    useState<UiSettingsPaneSection>("settings");
  const [publishOpen, setPublishOpen] = useState(false);
  const [createWorkspacePanelOpen, setCreateWorkspacePanelOpen] =
    useState(false);
  const [
    createWorkspacePanelAnchorWorkspaceId,
    setCreateWorkspacePanelAnchorWorkspaceId,
  ] = useState("");
  const [activeLeftRailItem, setActiveLeftRailItem] =
    useState<LeftRailItem>("space");
  const [agentView, setAgentView] = useState<AgentView>({ type: "chat" });
  const [chatFocusRequestKey, setChatFocusRequestKey] = useState(1);
  const [chatSessionJumpRequest, setChatSessionJumpRequest] = useState<{
    sessionId: string;
    requestKey: number;
  } | null>(null);
  const [chatSessionOpenRequest, setChatSessionOpenRequest] =
    useState<ChatSessionOpenRequest | null>(null);
  const [chatComposerPrefillRequest, setChatComposerPrefillRequest] =
    useState<ChatComposerPrefillRequest | null>(null);
  const [fileExplorerFocusRequest, setFileExplorerFocusRequest] =
    useState<FileExplorerFocusRequest | null>(null);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(
    null,
  );
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [spaceVisibility, setSpaceVisibility] =
    useState<SpaceVisibilityState>(loadSpaceVisibility);
  const [filesPaneWidth, setFilesPaneWidth] = useState(loadFilesPaneWidth);
  const [browserPaneWidth, setBrowserPaneWidth] =
    useState(loadBrowserPaneWidth);
  const [isUtilityPaneResizing, setIsUtilityPaneResizing] = useState(false);
  const [operationsDrawerOpen, setOperationsDrawerOpen] = useState(
    loadOperationsDrawerOpen,
  );
  const [activeOperationsTab, setActiveOperationsTab] =
    useState<OperationsDrawerTab>(loadOperationsDrawerTab);
  const [taskProposals, setTaskProposals] = useState<
    TaskProposalRecordPayload[]
  >([]);
  const [seenTaskProposalIdsByWorkspace, setSeenTaskProposalIdsByWorkspace] =
    useState<Record<string, string[]>>(loadSeenTaskProposalIdsByWorkspace);
  const [isLoadingTaskProposals, setIsLoadingTaskProposals] = useState(false);
  const [isTriggeringTaskProposal, setIsTriggeringTaskProposal] =
    useState(false);
  const [taskProposalStatusMessage, setTaskProposalStatusMessage] =
    useState("");
  const [proactiveTaskProposalsEnabled, setProactiveTaskProposalsEnabled] =
    useState(true);
  const [
    isLoadingProactiveTaskProposalsEnabled,
    setIsLoadingProactiveTaskProposalsEnabled,
  ] = useState(true);
  const [
    hasLoadedProactiveTaskProposalsPreference,
    setHasLoadedProactiveTaskProposalsPreference,
  ] = useState(false);
  const [
    isUpdatingProactiveTaskProposalsEnabled,
    setIsUpdatingProactiveTaskProposalsEnabled,
  ] = useState(false);
  const [proactiveTaskProposalsError, setProactiveTaskProposalsError] =
    useState("");
  const [proactiveHeartbeatConfig, setProactiveHeartbeatConfig] =
    useState<ProactiveHeartbeatConfigPayload | null>(null);
  const [isLoadingProactiveHeartbeatConfig, setIsLoadingProactiveHeartbeatConfig] =
    useState(false);
  const [isUpdatingProactiveHeartbeatConfig, setIsUpdatingProactiveHeartbeatConfig] =
    useState(false);
  const [proactiveHeartbeatError, setProactiveHeartbeatError] = useState("");
  const [proactiveStatus, setProactiveStatus] =
    useState<ProactiveAgentStatusPayload | null>(null);
  const [isLoadingProactiveStatus, setIsLoadingProactiveStatus] =
    useState(false);
  const [proposalAction, setProposalAction] = useState<{
    proposalId: string;
    action: "accept" | "dismiss";
  } | null>(null);
  const [notifications, setNotifications] = useState<
    RuntimeNotificationRecordPayload[]
  >([]);
  const [toastNotifications, setToastNotifications] = useState<
    RuntimeNotificationRecordPayload[]
  >([]);
  const [devNotificationToastPreview, setDevNotificationToastPreview] =
    useState<RuntimeNotificationRecordPayload[]>([]);
  const utilityPaneHostRef = useRef<HTMLDivElement | null>(null);
  const utilityPaneResizeStateRef = useRef<UtilityPaneResizeState | null>(null);
  const filesPaneWidthRef = useRef(filesPaneWidth);
  const browserPaneWidthRef = useRef(browserPaneWidth);
  const spaceVisibilityRef = useRef(spaceVisibility);
  const notificationsHydratedRef = useRef(false);
  const seenNotificationIdsRef = useRef(new Set<string>());
  const notificationToastTimeoutsRef = useRef(new Map<string, number>());

  filesPaneWidthRef.current = filesPaneWidth;
  browserPaneWidthRef.current = browserPaneWidth;
  spaceVisibilityRef.current = spaceVisibility;

  const proactiveHeartbeatWorkspaceSyncKey = useMemo(
    () =>
      [...workspaces]
        .map((workspace) => `${workspace.id}:${workspace.name || ""}`)
        .sort()
        .join("|"),
    [workspaces],
  );
  const currentProactiveHeartbeatWorkspace = useMemo(
    () =>
      proactiveHeartbeatConfig?.workspaces.find(
        (workspace) => workspace.workspace_id === selectedWorkspaceId,
      ) ?? null,
    [proactiveHeartbeatConfig, selectedWorkspaceId],
  );
  const proactiveWorkspaceEnabled = useMemo(
    () =>
      Boolean(
        selectedWorkspaceId &&
          proactiveTaskProposalsEnabled &&
          (proactiveHeartbeatConfig?.enabled ?? false) &&
          (currentProactiveHeartbeatWorkspace?.enabled ?? true),
      ),
    [
      currentProactiveHeartbeatWorkspace,
      proactiveHeartbeatConfig,
      proactiveTaskProposalsEnabled,
      selectedWorkspaceId,
    ],
  );
  const isLoadingProactiveWorkspaceEnabled =
    isLoadingProactiveTaskProposalsEnabled ||
    isLoadingProactiveHeartbeatConfig;
  const isUpdatingProactiveWorkspaceEnabled =
    isUpdatingProactiveTaskProposalsEnabled ||
    isUpdatingProactiveHeartbeatConfig;

  const effectiveAppUpdateStatus = useMemo(
    () =>
      buildDevAppUpdatePreviewStatus(
        devAppUpdatePreviewMode,
        appUpdateStatus?.currentVersion || "",
      ) ?? appUpdateStatus,
    [appUpdateStatus, devAppUpdatePreviewMode],
  );
  const effectiveToastNotifications = useMemo(
    () =>
      devNotificationToastPreview.length > 0
        ? devNotificationToastPreview
        : toastNotifications,
    [devNotificationToastPreview, toastNotifications],
  );
  const runtimeNotificationById = useMemo(
    () => new Map(notifications.map((notification) => [notification.id, notification])),
    [notifications],
  );
  const unreadTaskProposalCount = useMemo(() => {
    if (!selectedWorkspaceId || taskProposals.length === 0) {
      return 0;
    }
    const seenProposalIds = new Set(
      seenTaskProposalIdsByWorkspace[selectedWorkspaceId] ?? [],
    );
    return taskProposals.reduce((count, proposal) => {
      const proposalId = proposal.proposal_id.trim();
      if (!proposalId || seenProposalIds.has(proposalId)) {
        return count;
      }
      return count + 1;
    }, 0);
  }, [seenTaskProposalIdsByWorkspace, selectedWorkspaceId, taskProposals]);

  const markTaskProposalsSeen = useCallback(
    (
      workspaceId: string | null | undefined,
      proposals: TaskProposalRecordPayload[],
    ) => {
      const normalizedWorkspaceId = workspaceId?.trim() || "";
      if (!normalizedWorkspaceId || proposals.length === 0) {
        return;
      }

      const proposalIds = Array.from(
        new Set(
          proposals
            .map((proposal) => proposal.proposal_id.trim())
            .filter(Boolean),
        ),
      );
      if (proposalIds.length === 0) {
        return;
      }

      setSeenTaskProposalIdsByWorkspace((current) => {
        const existing = current[normalizedWorkspaceId] ?? [];
        const nextIds = [...existing];
        let changed = false;
        for (const proposalId of proposalIds) {
          if (nextIds.includes(proposalId)) {
            continue;
          }
          nextIds.push(proposalId);
          changed = true;
        }
        if (!changed) {
          return current;
        }
        return {
          ...current,
          [normalizedWorkspaceId]: nextIds.slice(
            -MAX_SEEN_TASK_PROPOSAL_IDS_PER_WORKSPACE,
          ),
        };
      });
    },
    [],
  );

  const clampUtilityPaneWidth = useCallback(
    (
      paneId: UtilityPaneId,
      width: number,
      options?: { filesWidth?: number; browserWidth?: number },
    ) => {
      const hostWidth =
        utilityPaneHostRef.current?.getBoundingClientRect().width ?? 0;
      const effectiveFilesWidth =
        options?.filesWidth ?? filesPaneWidthRef.current;
      const effectiveBrowserWidth =
        options?.browserWidth ?? browserPaneWidthRef.current;
      const visiblePaneIds = FIXED_SPACE_ORDER.filter(
        (pane) => spaceVisibilityRef.current[pane],
      );
      const flexPaneId = visiblePaneIds.includes("agent")
        ? "agent"
        : (visiblePaneIds[visiblePaneIds.length - 1] ?? null);
      const resizerCount = Math.max(0, visiblePaneIds.length - 1);
      const fixedOtherWidths = visiblePaneIds.reduce((total, visiblePaneId) => {
        if (
          visiblePaneId === paneId ||
          visiblePaneId === flexPaneId ||
          visiblePaneId === "agent"
        ) {
          return total;
        }
        return (
          total +
          (visiblePaneId === "files"
            ? effectiveFilesWidth
            : effectiveBrowserWidth)
        );
      }, 0);
      const minFlexibleWidth =
        flexPaneId === "agent"
          ? MIN_AGENT_CONTENT_WIDTH
          : utilityPaneMinWidth(flexPaneId);
      const minPaneWidth = utilityPaneMinWidth(paneId);
      const maxWidth =
        hostWidth > 0
          ? Math.min(
              MAX_UTILITY_PANE_WIDTH,
              Math.max(
                minPaneWidth,
                hostWidth -
                  fixedOtherWidths -
                  minFlexibleWidth -
                  resizerCount * UTILITY_PANE_RESIZER_WIDTH,
              ),
            )
          : MAX_UTILITY_PANE_WIDTH;
      return Math.max(minPaneWidth, Math.min(width, maxWidth));
    },
    [],
  );

  const clampPairedUtilityPaneWidths = useCallback(
    (
      leftPaneId: UtilityPaneId,
      rightPaneId: UtilityPaneId,
      leftWidth: number,
      rightWidth: number,
    ) => {
      const hostWidth =
        utilityPaneHostRef.current?.getBoundingClientRect().width ?? 0;
      if (hostWidth <= 0) {
        return {
          leftWidth: Math.max(
            utilityPaneMinWidth(leftPaneId),
            Math.min(leftWidth, MAX_UTILITY_PANE_WIDTH),
          ),
          rightWidth: Math.max(
            utilityPaneMinWidth(rightPaneId),
            Math.min(rightWidth, MAX_UTILITY_PANE_WIDTH),
          ),
        };
      }

      const effectiveFilesWidth =
        leftPaneId === "files"
          ? leftWidth
          : rightPaneId === "files"
            ? rightWidth
            : filesPaneWidthRef.current;
      const effectiveBrowserWidth =
        leftPaneId === "browser"
          ? leftWidth
          : rightPaneId === "browser"
            ? rightWidth
            : browserPaneWidthRef.current;
      const visiblePaneIds = FIXED_SPACE_ORDER.filter(
        (pane) => spaceVisibilityRef.current[pane],
      );
      const resizerCount = Math.max(0, visiblePaneIds.length - 1);
      const fixedOtherWidths = visiblePaneIds.reduce((total, visiblePaneId) => {
        if (
          visiblePaneId === "agent" ||
          visiblePaneId === leftPaneId ||
          visiblePaneId === rightPaneId
        ) {
          return total;
        }
        return (
          total +
          (visiblePaneId === "files"
            ? effectiveFilesWidth
            : effectiveBrowserWidth)
        );
      }, 0);
      const maxCombinedWidth = Math.min(
        MAX_UTILITY_PANE_WIDTH * 2,
        Math.max(
          utilityPaneMinWidth(leftPaneId) + utilityPaneMinWidth(rightPaneId),
          hostWidth -
            fixedOtherWidths -
            MIN_AGENT_CONTENT_WIDTH -
            resizerCount * UTILITY_PANE_RESIZER_WIDTH,
        ),
      );
      const combinedWidth = Math.min(leftWidth + rightWidth, maxCombinedWidth);
      const nextLeftWidth = Math.max(
        utilityPaneMinWidth(leftPaneId),
        Math.min(
          leftWidth,
          combinedWidth - utilityPaneMinWidth(rightPaneId),
        ),
      );
      return {
        leftWidth: nextLeftWidth,
        rightWidth: combinedWidth - nextLeftWidth,
      };
    },
    [],
  );

  const syncUtilityPaneWidths = useCallback(() => {
    const visiblePaneIds = FIXED_SPACE_ORDER.filter(
      (pane) => spaceVisibilityRef.current[pane],
    );
    if (visiblePaneIds.length === 0) {
      return;
    }

    const flexPaneId = visiblePaneIds.includes("agent")
      ? "agent"
      : (visiblePaneIds[visiblePaneIds.length - 1] ?? null);

    if (spaceVisibilityRef.current.files && flexPaneId !== "files") {
      setFilesPaneWidth((current) => clampUtilityPaneWidth("files", current));
    }
    if (spaceVisibilityRef.current.browser && flexPaneId !== "browser") {
      setBrowserPaneWidth((current) =>
        clampUtilityPaneWidth("browser", current),
      );
    }
  }, [clampUtilityPaneWidth]);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    let mounted = true;
    void window.electronAPI.runtime.getStatus().then((status) => {
      if (mounted) {
        setRuntimeStatus(status);
      }
    });

    const unsubscribe = window.electronAPI.runtime.onStateChange((status) => {
      if (mounted) {
        setRuntimeStatus(status);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const updateMode = (mode: DevAppUpdatePreviewMode) => {
      setDevAppUpdatePreviewMode(mode);
      try {
        if (mode === "off") {
          localStorage.removeItem(DEV_APP_UPDATE_PREVIEW_STORAGE_KEY);
        } else {
          localStorage.setItem(DEV_APP_UPDATE_PREVIEW_STORAGE_KEY, mode);
        }
      } catch {
        // Ignore localStorage failures in dev preview mode.
      }
    };

    window.__holabossDevUpdatePreview = {
      downloading: () => updateMode("downloading"),
      ready: () => updateMode("ready"),
      clear: () => updateMode("off"),
    };

    return () => {
      delete window.__holabossDevUpdatePreview;
    };
  }, []);

  const showDevNotificationToastPreview = useCallback(() => {
    setDevNotificationToastPreview(
      buildDevNotificationToastPreviewNotifications(selectedWorkspaceId),
    );
  }, [selectedWorkspaceId]);

  const clearDevNotificationToastPreview = useCallback(() => {
    setDevNotificationToastPreview([]);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    window.__holabossDevNotificationToastPreview = {
      stack: () => showDevNotificationToastPreview(),
      clear: () => clearDevNotificationToastPreview(),
    };

    return () => {
      delete window.__holabossDevNotificationToastPreview;
    };
  }, [clearDevNotificationToastPreview, showDevNotificationToastPreview]);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    const unsubscribe = window.electronAPI.ui.onOpenSettingsPane((section) => {
      setSettingsDialogSection(
        isSettingsPaneSection(section) ? section : "settings",
      );
      setSettingsDialogOpen(true);
      void window.electronAPI.auth.closePopup();
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    const unsubscribe = window.electronAPI.workbench.onOpenBrowser(
      (payload) => {
        if (
          payload.workspaceId &&
          payload.workspaceId !== selectedWorkspaceId
        ) {
          return;
        }

        const openBrowserPane = () => {
          setActiveLeftRailItem("space");
          setSpaceVisibility((previous) => ({
            ...previous,
            browser: true,
          }));
        };
        const targetBrowserSpace =
          payload.space === "agent" ? "agent" : "user";

        const requestedUrl =
          typeof payload.url === "string" ? payload.url.trim() : "";
        if (requestedUrl) {
          openBrowserPane();
          void window.electronAPI.browser
            .setActiveWorkspace(
              payload.workspaceId ?? selectedWorkspaceId ?? null,
              targetBrowserSpace,
            )
            .then(() => window.electronAPI.browser.navigate(requestedUrl))
            .catch(() => undefined);
          return;
        }
        openBrowserPane();
        void window.electronAPI.browser
          .setActiveWorkspace(
            payload.workspaceId ?? selectedWorkspaceId ?? null,
            targetBrowserSpace,
          )
          .catch(() => undefined);
      },
    );

    return unsubscribe;
  }, [hasHydratedWorkspaceList, selectedWorkspaceId]);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    let mounted = true;
    void window.electronAPI.appUpdate.getStatus().then((status) => {
      if (mounted) {
        setAppUpdateStatus(status);
      }
    });

    const unsubscribe = window.electronAPI.appUpdate.onStateChange((status) => {
      if (mounted) {
        setAppUpdateStatus(status);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    let mounted = true;
    void window.electronAPI.ui.getTheme().then((nextTheme) => {
      if (mounted && isAppTheme(nextTheme)) {
        setTheme(nextTheme);
      }
    });

    const unsubscribe = window.electronAPI.ui.onThemeChange((nextTheme) => {
      if (isAppTheme(nextTheme)) {
        setTheme(nextTheme);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    void window.electronAPI.ui.setTheme(theme);
  }, [theme]);

  const dismissNotificationToast = useCallback((notificationId: string) => {
    const timeoutId = notificationToastTimeoutsRef.current.get(notificationId);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      notificationToastTimeoutsRef.current.delete(notificationId);
    }
    setToastNotifications((current) =>
      current.filter((item) => item.id !== notificationId),
    );
  }, []);

  const refreshNotifications = useCallback(async () => {
    if (!window.electronAPI) {
      return;
    }

    try {
      const response = await window.electronAPI.workspace.listNotifications(null);
      setNotifications(response.items);

      if (!notificationsHydratedRef.current) {
        notificationsHydratedRef.current = true;
        for (const item of response.items) {
          seenNotificationIdsRef.current.add(item.id);
        }
        return;
      }

      for (const item of response.items) {
        if (
          item.state !== "unread" ||
          seenNotificationIdsRef.current.has(item.id)
        ) {
          continue;
        }
        seenNotificationIdsRef.current.add(item.id);
        setToastNotifications((current) => {
          if (current.some((existing) => existing.id === item.id)) {
            return current;
          }
          return [item, ...current].slice(0, 4);
        });
        if (!notificationToastTimeoutsRef.current.has(item.id)) {
          const timeoutId = window.setTimeout(() => {
            dismissNotificationToast(item.id);
          }, notificationToastDurationMs(item));
          notificationToastTimeoutsRef.current.set(item.id, timeoutId);
        }
      }
    } catch {
      // Notification polling should stay silent when the runtime is restarting.
    }
  }, [dismissNotificationToast]);

  useEffect(() => {
    const activeNotificationIds = new Set(
      notifications.map((notification) => notification.id),
    );
    setToastNotifications((current) => {
      const next = current.filter((item) => activeNotificationIds.has(item.id));
      return next.length === current.length ? current : next;
    });
    for (const [notificationId, timeoutId] of notificationToastTimeoutsRef.current.entries()) {
      if (activeNotificationIds.has(notificationId)) {
        continue;
      }
      window.clearTimeout(timeoutId);
      notificationToastTimeoutsRef.current.delete(notificationId);
    }
  }, [notifications]);

  const handleActivateNotification = useCallback(
    async (notificationId: string) => {
      if (!window.electronAPI) {
        return;
      }
      const notification = runtimeNotificationById.get(notificationId);
      if (!notification) {
        return;
      }

      dismissNotificationToast(notification.id);
      const targetUrl = notificationActionUrl(notification);
      const targetSessionId = notificationTargetSessionId(notification);
      const nextState = notificationActivationState(notification);

      try {
        await window.electronAPI.workspace.updateNotification(notification.id, {
          state: nextState,
        });
        await refreshNotifications();
      } catch {
        // Ignore transient notification update failures in the shell.
      }
      if (targetSessionId) {
        const targetWorkspaceId = notification.workspace_id.trim();
        if (targetWorkspaceId) {
          setSelectedWorkspaceId(targetWorkspaceId);
        }
        setActiveLeftRailItem("space");
        setSpaceVisibility((previous) => ({
          ...previous,
          agent: true,
        }));
        setAgentView({ type: "chat" });
        setChatSessionJumpRequest({
          sessionId: targetSessionId,
          requestKey: Date.now(),
        });
        setChatFocusRequestKey((current) => current + 1);
        return;
      }
      if (targetUrl) {
        try {
          await window.electronAPI.ui.openExternalUrl(targetUrl);
        } catch {
          // Ignore transient shell URL open failures.
        }
      }
    },
    [
      dismissNotificationToast,
      runtimeNotificationById,
      refreshNotifications,
      setSelectedWorkspaceId,
    ],
  );

  const handleDismissNotification = useCallback(
    async (notificationId: string) => {
      if (isDevNotificationToastPreviewId(notificationId)) {
        setDevNotificationToastPreview((current) =>
          current.filter((item) => item.id !== notificationId),
        );
        return;
      }
      if (!window.electronAPI) {
        return;
      }
      const notification = runtimeNotificationById.get(notificationId);
      if (!notification) {
        return;
      }

      try {
        dismissNotificationToast(notificationId);
        await window.electronAPI.workspace.updateNotification(notificationId, {
          state: "dismissed",
        });
        await refreshNotifications();
      } catch {
        // Ignore transient notification update failures in the shell.
      }
    },
    [
      dismissNotificationToast,
      runtimeNotificationById,
      refreshNotifications,
    ],
  );

  const handleActivateDisplayedNotification = useCallback(
    async (notificationId: string) => {
      if (isDevNotificationToastPreviewId(notificationId)) {
        setDevNotificationToastPreview((current) =>
          current.filter((item) => item.id !== notificationId),
        );
        return;
      }
      await handleActivateNotification(notificationId);
    },
    [handleActivateNotification],
  );

  const handleCloseDisplayedNotification = useCallback(
    async (notificationId: string) => {
      if (isDevNotificationToastPreviewId(notificationId)) {
        setDevNotificationToastPreview((current) =>
          current.filter((item) => item.id !== notificationId),
        );
        return;
      }
      await handleDismissNotification(notificationId);
    },
    [handleDismissNotification],
  );

  useEffect(() => {
    void refreshNotifications();
    const intervalId = window.setInterval(() => {
      void refreshNotifications();
    }, 3000);
    return () => {
      window.clearInterval(intervalId);
      for (const timeoutId of notificationToastTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      notificationToastTimeoutsRef.current.clear();
    };
  }, [refreshNotifications]);

  const handleThemeChange = useCallback((nextTheme: string) => {
    if (isAppTheme(nextTheme)) {
      setTheme(nextTheme);
    }
  }, []);

  const handleOpenExternalUrl = useCallback((url: string) => {
    void window.electronAPI.ui.openExternalUrl(url);
  }, []);

  const revealBrowserPane = useCallback(() => {
    setActiveLeftRailItem("space");
    setSpaceVisibility((previous) => ({
      ...previous,
      browser: true,
    }));
  }, []);

  const handleOpenLinkInAppBrowser = useCallback(
    (url: string, workspaceIdOverride?: string | null) => {
      const normalizedUrl = url.trim();
      if (!normalizedUrl) {
        return;
      }

      revealBrowserPane();
      const targetWorkspaceId =
        workspaceIdOverride !== undefined
          ? workspaceIdOverride
          : selectedWorkspaceId || null;
      void window.electronAPI.browser
        .setActiveWorkspace(targetWorkspaceId, "user")
        .then(() => window.electronAPI.browser.navigate(normalizedUrl))
        .catch(() => undefined);
    },
    [revealBrowserPane, selectedWorkspaceId],
  );

  const handleOpenCreateWorkspacePanel = useCallback(() => {
    setCreateWorkspacePanelAnchorWorkspaceId(selectedWorkspaceId || "");
    setCreateWorkspacePanelOpen(true);
  }, [hasHydratedWorkspaceList, selectedWorkspaceId]);

  const handleCloseCreateWorkspacePanel = useCallback(() => {
    setCreateWorkspacePanelOpen(false);
    setCreateWorkspacePanelAnchorWorkspaceId("");
  }, []);

  useEffect(() => {
    if (!createWorkspacePanelOpen) {
      return;
    }
    if (!selectedWorkspaceId || !createWorkspacePanelAnchorWorkspaceId) {
      return;
    }
    if (selectedWorkspaceId !== createWorkspacePanelAnchorWorkspaceId) {
      setCreateWorkspacePanelOpen(false);
      setCreateWorkspacePanelAnchorWorkspaceId("");
    }
  }, [
    createWorkspacePanelAnchorWorkspaceId,
    createWorkspacePanelOpen,
    selectedWorkspaceId,
  ]);

  useEffect(() => {
    setChatSessionJumpRequest(null);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    localStorage.setItem(
      OPERATIONS_DRAWER_OPEN_STORAGE_KEY,
      operationsDrawerOpen ? "1" : "0",
    );
  }, [operationsDrawerOpen]);

  useEffect(() => {
    localStorage.setItem(
      OPERATIONS_DRAWER_TAB_STORAGE_KEY,
      activeOperationsTab,
    );
  }, [activeOperationsTab]);

  useEffect(() => {
    localStorage.setItem(
      TASK_PROPOSAL_SEEN_STORAGE_KEY,
      JSON.stringify(seenTaskProposalIdsByWorkspace),
    );
  }, [seenTaskProposalIdsByWorkspace]);

  useEffect(() => {
    localStorage.setItem(FILES_PANE_WIDTH_STORAGE_KEY, String(filesPaneWidth));
  }, [filesPaneWidth]);

  useEffect(() => {
    localStorage.setItem(
      BROWSER_PANE_WIDTH_STORAGE_KEY,
      String(browserPaneWidth),
    );
  }, [browserPaneWidth]);

  useEffect(() => {
    localStorage.setItem(
      SPACE_VISIBILITY_STORAGE_KEY,
      JSON.stringify(spaceVisibility),
    );
  }, [spaceVisibility]);

  useEffect(() => {
    if (spaceVisibility.agent) {
      return;
    }
    setSpaceVisibility((previous) => ({
      ...previous,
      agent: true,
    }));
  }, [spaceVisibility.agent]);

  useEffect(() => {
    setChatSessionOpenRequest(null);
    setActiveChatSessionId(null);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    if (!hasHydratedWorkspaceList) {
      return;
    }
    let cancelled = false;
    const loadPreference = async () => {
      setIsLoadingProactiveTaskProposalsEnabled(true);
      try {
        const preference =
          await window.electronAPI.workspace.getProactiveTaskProposalPreference();
        if (!cancelled) {
          setProactiveTaskProposalsEnabled(preference.enabled !== false);
          setProactiveTaskProposalsError("");
        }
      } catch (error) {
        if (!cancelled) {
          setProactiveTaskProposalsEnabled(false);
          setProactiveTaskProposalsError(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setHasLoadedProactiveTaskProposalsPreference(true);
          setIsLoadingProactiveTaskProposalsEnabled(false);
        }
      }
    };

    void loadPreference();
    return () => {
      cancelled = true;
    };
  }, [selectedWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    const loadHeartbeatConfig = async () => {
      setIsLoadingProactiveHeartbeatConfig(true);
      try {
        const config =
          await window.electronAPI.workspace.getProactiveHeartbeatConfig();
        if (!cancelled) {
          setProactiveHeartbeatConfig(config);
          setProactiveHeartbeatError("");
        }
      } catch (error) {
        if (!cancelled) {
          setProactiveHeartbeatConfig(null);
          setProactiveHeartbeatError(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingProactiveHeartbeatConfig(false);
        }
      }
    };

    void loadHeartbeatConfig();
    return () => {
      cancelled = true;
    };
  }, [
    hasHydratedWorkspaceList,
    proactiveHeartbeatWorkspaceSyncKey,
    runtimeConfig?.sandboxId,
    runtimeConfig?.userId,
  ]);

  async function handleProactiveWorkspaceEnabledChange(enabled: boolean) {
    if (!selectedWorkspaceId) {
      return;
    }

    setProactiveTaskProposalsError("");
    setProactiveHeartbeatError("");
    setIsUpdatingProactiveTaskProposalsEnabled(true);
    setIsUpdatingProactiveHeartbeatConfig(true);
    let errorTarget: "task-proposals" | "heartbeat" = "heartbeat";

    try {
      if (enabled) {
        errorTarget = "task-proposals";
        const preference =
          await window.electronAPI.workspace.setProactiveTaskProposalPreference(
            {
              enabled: true,
            },
          );
        const nextTaskProposalPreferenceEnabled = preference.enabled !== false;
        setProactiveTaskProposalsEnabled(nextTaskProposalPreferenceEnabled);

        errorTarget = "heartbeat";
        let nextHeartbeatConfig =
          await window.electronAPI.workspace.setProactiveHeartbeatConfig({
            cron:
              proactiveHeartbeatConfig?.cron?.trim() ||
              DEFAULT_PROACTIVE_HEARTBEAT_CRON,
            enabled: true,
          });
        setProactiveHeartbeatConfig(nextHeartbeatConfig);

        nextHeartbeatConfig =
          await window.electronAPI.workspace.setProactiveHeartbeatWorkspaceEnabled(
            {
              workspace_id: selectedWorkspaceId,
              workspace_name: selectedWorkspace?.name || null,
              enabled: true,
            },
          );
        setProactiveHeartbeatConfig(nextHeartbeatConfig);

        if (!nextTaskProposalPreferenceEnabled) {
          setProactiveTaskProposalsError(
            "Task proposals could not be enabled for this workspace.",
          );
        }
        return;
      }

      const config =
        await window.electronAPI.workspace.setProactiveHeartbeatWorkspaceEnabled(
          {
            workspace_id: selectedWorkspaceId,
            workspace_name: selectedWorkspace?.name || null,
            enabled: false,
          },
        );
      setProactiveHeartbeatConfig(config);
    } catch (error) {
      const message = normalizeErrorMessage(error);
      if (errorTarget === "task-proposals") {
        setProactiveTaskProposalsError(message);
      } else {
        setProactiveHeartbeatError(message);
      }
    } finally {
      setIsUpdatingProactiveTaskProposalsEnabled(false);
      setIsUpdatingProactiveHeartbeatConfig(false);
    }
  }

  async function handleProactiveHeartbeatCronChange(cron: string) {
    const normalizedCron = cron.trim();
    if (!normalizedCron) {
      return;
    }

    setProactiveHeartbeatError("");
    setIsUpdatingProactiveHeartbeatConfig(true);
    try {
      const config = await window.electronAPI.workspace.setProactiveHeartbeatConfig(
        {
          cron: normalizedCron,
          enabled: proactiveHeartbeatConfig?.enabled ?? false,
        },
      );
      setProactiveHeartbeatConfig(config);
    } catch (error) {
      setProactiveHeartbeatError(normalizeErrorMessage(error));
    } finally {
      setIsUpdatingProactiveHeartbeatConfig(false);
    }
  }

  async function refreshTaskProposals() {
    if (!selectedWorkspaceId || !selectedWorkspace) {
      setTaskProposals([]);
      setTaskProposalStatusMessage("");
      return;
    }

    setTaskProposalStatusMessage("");
    setIsLoadingTaskProposals(true);
    try {
      const response = await window.electronAPI.workspace.listTaskProposals(
        selectedWorkspace.id,
      );
      setTaskProposals(response.proposals);
    } catch (error) {
      setTaskProposalStatusMessage(normalizeErrorMessage(error));
    } finally {
      setIsLoadingTaskProposals(false);
    }
  }

  async function refreshProactiveStatus(options?: { silent?: boolean }) {
    if (!selectedWorkspaceId || !selectedWorkspace) {
      setProactiveStatus(null);
      setIsLoadingProactiveStatus(false);
      return;
    }

    if (!options?.silent) {
      setIsLoadingProactiveStatus(true);
    }
    try {
      const response = await window.electronAPI.workspace.getProactiveStatus(
        selectedWorkspace.id,
      );
      setProactiveStatus(response);
    } catch (error) {
      if (!options?.silent) {
        setTaskProposalStatusMessage(normalizeErrorMessage(error));
      }
    } finally {
      if (!options?.silent) {
        setIsLoadingProactiveStatus(false);
      }
    }
  }

  async function triggerRemoteTaskProposal() {
    if (!selectedWorkspaceId) {
      return;
    }
    setIsTriggeringTaskProposal(true);
    setTaskProposalStatusMessage("");
    try {
      const response =
        await window.electronAPI.workspace.requestRemoteTaskProposalGeneration({
          workspace_id: selectedWorkspaceId,
        });
      setTaskProposalStatusMessage(
        response.accepted ? "" : "Suggestions are unavailable right now.",
      );
      void refreshProactiveStatus();
      window.setTimeout(() => {
        void refreshTaskProposals();
        void refreshProactiveStatus({ silent: true });
      }, 1500);
    } catch (error) {
      setTaskProposalStatusMessage(normalizeErrorMessage(error));
    } finally {
      setIsTriggeringTaskProposal(false);
    }
  }

  async function acceptTaskProposal(proposal: TaskProposalRecordPayload) {
    if (!selectedWorkspaceId || !selectedWorkspace) {
      return;
    }

    setProposalAction({ proposalId: proposal.proposal_id, action: "accept" });
    setTaskProposalStatusMessage("");
    try {
      const proposalSessionId = `proposal-${crypto.randomUUID()}`;
      const accepted = await window.electronAPI.workspace.acceptTaskProposal({
        proposal_id: proposal.proposal_id,
        task_name: proposal.task_name,
        task_prompt: proposal.task_prompt,
        session_id: proposalSessionId,
        parent_session_id: activeChatSessionId?.trim() || null,
        priority: 0,
        model: runtimeConfig?.defaultModel ?? null,
      });
      const targetSessionId = accepted.session.session_id;

      const detail = `Queued "${proposal.task_name}" into session ${targetSessionId}.`;
      setTaskProposalStatusMessage(detail);
      await refreshTaskProposals();
    } catch (error) {
      setTaskProposalStatusMessage(normalizeErrorMessage(error));
    } finally {
      setProposalAction(null);
    }
  }

  async function dismissTaskProposal(proposal: TaskProposalRecordPayload) {
    setProposalAction({ proposalId: proposal.proposal_id, action: "dismiss" });
    setTaskProposalStatusMessage("");
    try {
      await window.electronAPI.workspace.updateTaskProposalState(
        proposal.proposal_id,
        "dismissed",
      );
      const detail = `Dismissed "${proposal.task_name}" and persisted the update back to the backend.`;
      setTaskProposalStatusMessage(detail);
      await refreshTaskProposals();
    } catch (error) {
      setTaskProposalStatusMessage(normalizeErrorMessage(error));
    } finally {
      setProposalAction(null);
    }
  }

  useEffect(() => {
    if (!selectedWorkspaceId || !selectedWorkspace) {
      setTaskProposals([]);
      setTaskProposalStatusMessage("");
      setIsLoadingTaskProposals(false);
      return;
    }

    if (!hasLoadedProactiveTaskProposalsPreference) {
      setIsLoadingTaskProposals(false);
      return;
    }

    if (!proactiveTaskProposalsEnabled) {
      setIsLoadingTaskProposals(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const response = await window.electronAPI.workspace.listTaskProposals(
          selectedWorkspace.id,
        );
        if (!cancelled) {
          setTaskProposals(response.proposals);
        }
      } catch (error) {
        if (!cancelled) {
          setTaskProposalStatusMessage(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTaskProposals(false);
        }
      }
    };

    setIsLoadingTaskProposals(true);
    void load();
    const timer = window.setInterval(() => {
      setIsLoadingTaskProposals(true);
      void load();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    hasLoadedProactiveTaskProposalsPreference,
    proactiveTaskProposalsEnabled,
    selectedWorkspace,
    selectedWorkspaceId,
  ]);

  useEffect(() => {
    if (
      !operationsDrawerOpen ||
      activeOperationsTab !== "inbox" ||
      !selectedWorkspaceId ||
      taskProposals.length === 0
    ) {
      return;
    }
    markTaskProposalsSeen(selectedWorkspaceId, taskProposals);
  }, [
    activeOperationsTab,
    markTaskProposalsSeen,
    operationsDrawerOpen,
    selectedWorkspaceId,
    taskProposals,
  ]);

  useEffect(() => {
    if (!selectedWorkspaceId || !selectedWorkspace) {
      setProactiveStatus(null);
      setIsLoadingProactiveStatus(false);
      return;
    }

    let cancelled = false;

    const load = async (options?: { silent?: boolean }) => {
      if (!options?.silent && !cancelled) {
        setIsLoadingProactiveStatus(true);
      }
      try {
        const response = await window.electronAPI.workspace.getProactiveStatus(
          selectedWorkspace.id,
        );
        if (!cancelled) {
          setProactiveStatus(response);
        }
      } catch (error) {
        if (!cancelled && !options?.silent) {
          setTaskProposalStatusMessage(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled && !options?.silent) {
          setIsLoadingProactiveStatus(false);
        }
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load({ silent: true });
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedWorkspace, selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId || !selectedWorkspace) {
      return;
    }

    let cancelled = false;
    void window.electronAPI.workspace
      .getProactiveStatus(selectedWorkspace.id)
      .then((response) => {
        if (!cancelled) {
          setProactiveStatus(response);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    runtimeConfig?.authTokenPresent,
    runtimeConfig?.modelProxyBaseUrl,
    runtimeConfig?.userId,
    runtimeStatus?.status,
    selectedWorkspace,
    selectedWorkspaceId,
  ]);

  const handleDismissUpdate = useCallback(() => {
    if (import.meta.env.DEV && devAppUpdatePreviewMode !== "off") {
      setDevAppUpdatePreviewMode("off");
      try {
        localStorage.removeItem(DEV_APP_UPDATE_PREVIEW_STORAGE_KEY);
      } catch {
        // Ignore localStorage failures in dev preview mode.
      }
      return;
    }
    void window.electronAPI.appUpdate.dismiss(
      effectiveAppUpdateStatus?.latestVersion ?? null,
    );
  }, [devAppUpdatePreviewMode, effectiveAppUpdateStatus]);

  const handleInstallUpdate = () => {
    if (import.meta.env.DEV && devAppUpdatePreviewMode !== "off") {
      return;
    }
    void window.electronAPI.appUpdate.installNow();
  };

  const handleOpenUpdateChangelog = useCallback(() => {
    if (!effectiveAppUpdateStatus) {
      return;
    }
    const changelogUrl = appUpdateChangelogUrl(effectiveAppUpdateStatus);
    if (!changelogUrl) {
      return;
    }
    void window.electronAPI.ui.openExternalUrl(changelogUrl);
  }, [effectiveAppUpdateStatus]);
  const toggleOperationsDrawer = () => {
    setOperationsDrawerOpen((open) => !open);
  };

  const openOperationsDrawerTab = (tab: OperationsDrawerTab) => {
    setActiveOperationsTab(tab);
    setOperationsDrawerOpen(true);
    if (tab === "inbox" && selectedWorkspaceId) {
      markTaskProposalsSeen(selectedWorkspaceId, taskProposals);
    }
  };

  const installedAppIds = useMemo(
    () => new Set(installedApps.map((app) => app.id)),
    [installedApps],
  );

  const handleLeftRailSelect = (item: LeftRailItem) => {
    if (item === "space") {
      setActiveLeftRailItem("space");
      if (agentView.type === "app") {
        setAgentView({ type: "chat" });
      }
      setChatFocusRequestKey((current) => current + 1);
      return;
    }
    setActiveLeftRailItem(item);
  };

  const handleOpenInstalledApp = (appId: string) => {
    setActiveLeftRailItem("app");
    setAgentView({
      type: "app",
      appId,
    });
  };

  const handleOpenAutomationRunSession = useCallback((sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return;
    }

    setActiveLeftRailItem("space");
    setSpaceVisibility((previous) => ({
      ...previous,
      agent: true,
    }));
    setAgentView({ type: "chat" });
    setChatSessionJumpRequest({
      sessionId: normalizedSessionId,
      requestKey: Date.now(),
    });
    setChatFocusRequestKey((current) => current + 1);
  }, []);

  const handleCreateScheduleInChat = useCallback(() => {
    setActiveLeftRailItem("space");
    setSpaceVisibility((previous) => ({
      ...previous,
      agent: true,
    }));
    setAgentView({ type: "chat" });
    setChatSessionJumpRequest(null);
    setChatSessionOpenRequest((previous) =>
      activeChatSessionId
        ? {
            sessionId: activeChatSessionId,
            requestKey: (previous?.requestKey ?? 0) + 1,
          }
        : null,
    );
    setChatComposerPrefillRequest((previous) => ({
      text: "Create a cronjob for ",
      requestKey: (previous?.requestKey ?? 0) + 1,
    }));
    setChatFocusRequestKey((current) => current + 1);
  }, [activeChatSessionId]);

  const handleCreateSession = useCallback(() => {
    if (!selectedWorkspaceId) {
      return;
    }

    setActiveLeftRailItem("space");
    setSpaceVisibility((previous) => ({
      ...previous,
      agent: true,
    }));
    setAgentView({ type: "chat" });
    setChatSessionJumpRequest(null);
    setChatSessionOpenRequest((previous) => ({
      sessionId: "",
      mode: "draft",
      parentSessionId: null,
      requestKey: (previous?.requestKey ?? 0) + 1,
    }));
    setChatFocusRequestKey((current) => current + 1);
  }, [selectedWorkspaceId]);

  const handleChatComposerPrefillConsumed = useCallback((requestKey: number) => {
    setChatComposerPrefillRequest((current) =>
      current?.requestKey === requestKey ? null : current,
    );
  }, []);

  const handleOpenWorkspaceOutput = useCallback(
    (output: WorkspaceOutputRecordPayload) => {
      const target = workspaceOutputNavigationTarget(output, installedAppIds);
      if (target.type === "app" && selectedWorkspaceId) {
        // target.resourceId is already a full route path (e.g. "/drafts/abc")
        // when derived from presentation.path — pass it as `path` so
        // resolveAppSurfacePath uses it directly instead of nesting it under view.
        const routePath = resolveAppSurfacePath({
          path: target.resourceId,
          view: target.view,
        });
        void window.electronAPI.appSurface
          .resolveUrl(selectedWorkspaceId, target.appId, routePath)
          .then((url) => {
            revealBrowserPane();
            void window.electronAPI.browser
              .setActiveWorkspace(selectedWorkspaceId)
              .then(() => window.electronAPI.browser.navigate(url))
              .catch(() => undefined);
          })
          .catch(() => {
            // Fallback: open in full app view if URL resolution fails
            setActiveLeftRailItem("app");
            setAgentView({
              type: "app",
              appId: target.appId,
              resourceId: target.resourceId,
              view: target.view,
            });
          });
        return;
      }

      if (target.type === "internal") {
        if (
          (target.surface === "document" || target.surface === "file") &&
          target.resourceId?.trim()
        ) {
          setActiveLeftRailItem("space");
          setSpaceVisibility((previous) => ({
            ...previous,
            agent: true,
            files: true,
          }));
          setAgentView({ type: "chat" });
          setFileExplorerFocusRequest({
            path: target.resourceId,
            requestKey: Date.now(),
          });
          return;
        }

        setActiveLeftRailItem("space");
        setSpaceVisibility((previous) => ({
          ...previous,
          agent: true,
        }));
        setAgentView({
          type: "internal",
          surface: target.surface,
          resourceId: target.resourceId ?? output.id,
          htmlContent: target.htmlContent,
        });
      }
    },
    [installedAppIds, selectedWorkspaceId, revealBrowserPane],
  );

  const handleOpenRunningSession = (sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return;
    }

    setActiveLeftRailItem("space");
    setSpaceVisibility((previous) => ({
      ...previous,
      agent: true,
    }));
    setAgentView({ type: "chat" });
    setChatSessionOpenRequest((previous) => ({
      sessionId: normalizedSessionId,
      mode: "session",
      requestKey: (previous?.requestKey ?? 0) + 1,
    }));
  };

  const spaceMode = activeLeftRailItem === "space";
  const appMode = activeLeftRailItem === "app";
  const activeAppId =
    appMode && agentView.type === "app" ? agentView.appId : null;
  const activeApp = getWorkspaceAppDefinition(activeAppId, installedApps);
  const hasWorkspaces = workspaces.length > 0;
  const hasSelectedWorkspace = Boolean(selectedWorkspace);

  const visibleSpacePaneIds =
    hasWorkspaces && spaceMode
      ? FIXED_SPACE_ORDER.filter((paneId) => spaceVisibility[paneId])
      : [];
  const flexSpacePaneId = visibleSpacePaneIds.includes("agent")
    ? "agent"
    : (visibleSpacePaneIds[visibleSpacePaneIds.length - 1] ?? null);
  const showOperationsDrawer =
    spaceMode && spaceVisibility.agent && operationsDrawerOpen;
  const shouldShowAppUpdateReminder = Boolean(
    effectiveAppUpdateStatus &&
      effectiveAppUpdateStatus.downloaded,
  );
  const appVersionLabel =
    effectiveAppUpdateStatus?.currentVersion?.trim() || "";
  const shouldSuspendBrowserNativeView =
    isUtilityPaneResizing ||
    workspaceSwitcherOpen ||
    settingsDialogOpen ||
    createWorkspacePanelOpen ||
    publishOpen;
  const bootstrapErrorMessage =
    !hasHydratedWorkspaceList && runtimeStatus?.status === "error"
      ? runtimeStatus.lastError.trim() ||
        workspaceErrorMessage ||
        "Embedded runtime failed to start."
      : "";
  const hydratedRuntimeErrorMessage =
    hasHydratedWorkspaceList &&
    hasSelectedWorkspace &&
    runtimeStatus?.status === "error" &&
    !workspaceAppsReady
      ? runtimeStatus.lastError.trim() ||
        workspaceBlockingReason ||
        workspaceErrorMessage ||
        "Embedded runtime failed to start."
      : "";
  const desktopPlatform = window.electronAPI?.platform ?? null;
  const hasIntegratedTitleBar =
    desktopPlatform === "darwin" || desktopPlatform === "win32";
  const titleBarContainerClassName =
    desktopPlatform === "win32"
      ? "relative min-w-0 -mx-2 -mt-2 sm:-mx-3 sm:-mt-2.5"
      : "relative min-w-0";
  const mainGridClassName = appShellMainGridClassName({
    hasWorkspaces,
    hasIntegratedTitleBar,
  });
  const showOnboardingTakeover =
    hasHydratedWorkspaceList &&
    hasWorkspaces &&
    hasSelectedWorkspace &&
    onboardingModeActive;

  const agentContent = useMemo(() => {
    if (!hasSelectedWorkspace) {
      return <EmptyWorkspacePane />;
    }

    if (agentView.type === "chat") {
      return onboardingModeActive ? (
        <OnboardingPane
          onOpenOutput={handleOpenWorkspaceOutput}
          focusRequestKey={chatFocusRequestKey}
        />
      ) : (
        <ChatPane
          onOpenOutput={handleOpenWorkspaceOutput}
          focusRequestKey={chatFocusRequestKey}
          onOpenLinkInBrowser={handleOpenLinkInAppBrowser}
          sessionJumpSessionId={chatSessionJumpRequest?.sessionId ?? null}
          sessionJumpRequestKey={chatSessionJumpRequest?.requestKey ?? 0}
          sessionOpenRequest={chatSessionOpenRequest}
          composerPrefillRequest={chatComposerPrefillRequest}
          onComposerPrefillConsumed={handleChatComposerPrefillConsumed}
          onActiveSessionIdChange={setActiveChatSessionId}
        />
      );
    }

    if (agentView.type === "app") {
      return (
        <AppSurfacePane
          appId={agentView.appId}
          app={
            activeAppId === agentView.appId
              ? activeApp
              : getWorkspaceAppDefinition(agentView.appId, installedApps)
          }
          resourceId={agentView.resourceId}
          view={agentView.view}
        />
      );
    }

    return (
      <InternalSurfacePane
        surface={agentView.surface}
        resourceId={agentView.resourceId}
        htmlContent={agentView.htmlContent}
      />
    );
  }, [
    activeApp,
    activeAppId,
    agentView,
    chatSessionJumpRequest,
    chatFocusRequestKey,
    handleOpenWorkspaceOutput,
    hasSelectedWorkspace,
    handleOpenLinkInAppBrowser,
    onboardingModeActive,
  ]);

  const spacePanes = useMemo(
    () =>
      visibleSpacePaneIds.map((paneId) => ({
        id: paneId,
        flex: paneId === flexSpacePaneId,
        width:
          paneId === "files"
            ? filesPaneWidth
            : paneId === "browser"
              ? browserPaneWidth
              : 0,
        content:
          paneId === "agent" ? (
            agentContent
          ) : paneId === "files" ? (
            <FileExplorerPane
              focusRequest={fileExplorerFocusRequest}
              onFocusRequestConsumed={(requestKey) => {
                setFileExplorerFocusRequest((current) =>
                  current?.requestKey === requestKey ? null : current,
                );
              }}
            />
          ) : (
            <BrowserPane
              suspendNativeView={shouldSuspendBrowserNativeView}
              layoutSyncKey={`${visibleSpacePaneIds.join("|")}:${filesPaneWidth}:${browserPaneWidth}:${showOperationsDrawer ? 1 : 0}`}
            />
          ),
      })),
    [
      agentContent,
      browserPaneWidth,
      fileExplorerFocusRequest,
      filesPaneWidth,
      flexSpacePaneId,
      shouldSuspendBrowserNativeView,
      showOperationsDrawer,
      visibleSpacePaneIds,
    ],
  );

  const startUtilityPaneResize = useCallback(
    (
      leftPaneId: SpaceComponentId,
      rightPaneId: SpaceComponentId,
      event: ReactPointerEvent<HTMLDivElement>,
    ) => {
      if (leftPaneId !== "agent" && rightPaneId !== "agent") {
        if (!spaceVisibility[leftPaneId] || !spaceVisibility[rightPaneId]) {
          return;
        }
        utilityPaneResizeStateRef.current = {
          mode: "pair",
          leftPaneId,
          rightPaneId,
          startLeftWidth:
            leftPaneId === "files" ? filesPaneWidth : browserPaneWidth,
          startRightWidth:
            rightPaneId === "files" ? filesPaneWidth : browserPaneWidth,
          startX: event.clientX,
        };
      } else {
        const paneId = leftPaneId === "agent" ? rightPaneId : leftPaneId;
        if (paneId === "agent" || !spaceVisibility[paneId]) {
          return;
        }
        utilityPaneResizeStateRef.current = {
          mode: "single",
          paneId,
          startWidth: paneId === "files" ? filesPaneWidth : browserPaneWidth,
          startX: event.clientX,
          direction: leftPaneId === "agent" ? -1 : 1,
        };
      }

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // BrowserView resizing falls back to the window listeners below.
      }
      if (spaceVisibility.browser) {
        void window.electronAPI.browser.setBounds({
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        });
      }
      setIsUtilityPaneResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      event.preventDefault();
    },
    [browserPaneWidth, filesPaneWidth, spaceVisibility],
  );

  useEffect(() => {
    if (visibleSpacePaneIds.length === 0) {
      return;
    }

    syncUtilityPaneWidths();
    window.addEventListener("resize", syncUtilityPaneWidths);

    const host = utilityPaneHostRef.current;
    const observer =
      host && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            syncUtilityPaneWidths();
          })
        : null;
    if (observer && host) {
      observer.observe(host);
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncUtilityPaneWidths);
    };
  }, [
    showOperationsDrawer,
    syncUtilityPaneWidths,
    visibleSpacePaneIds.length,
  ]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = utilityPaneResizeStateRef.current;
      if (!resizeState) {
        return;
      }

      if (resizeState.mode === "pair") {
        const delta = event.clientX - resizeState.startX;
        const { leftWidth, rightWidth } = clampPairedUtilityPaneWidths(
          resizeState.leftPaneId,
          resizeState.rightPaneId,
          resizeState.startLeftWidth + delta,
          resizeState.startRightWidth - delta,
        );
        if (resizeState.leftPaneId === "files") {
          setFilesPaneWidth(leftWidth);
        } else {
          setBrowserPaneWidth(leftWidth);
        }
        if (resizeState.rightPaneId === "files") {
          setFilesPaneWidth(rightWidth);
        } else {
          setBrowserPaneWidth(rightWidth);
        }
        return;
      }

      const nextWidth = clampUtilityPaneWidth(
        resizeState.paneId,
        resizeState.startWidth +
          resizeState.direction * (event.clientX - resizeState.startX),
      );
      if (resizeState.paneId === "files") {
        setFilesPaneWidth(nextWidth);
      } else {
        setBrowserPaneWidth(nextWidth);
      }
    };

    const stopResize = () => {
      if (!utilityPaneResizeStateRef.current) {
        return;
      }

      utilityPaneResizeStateRef.current = null;
      setIsUtilityPaneResizing(false);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      stopResize();
    };
  }, [clampPairedUtilityPaneWidths, clampUtilityPaneWidth]);

  return (
    <main className="fixed inset-0 h-screen overflow-hidden text-foreground/90">
      <div className="theme-grid pointer-events-none absolute inset-0 bg-noise-grid bg-[size:22px_22px]" />
      <div className="theme-orb-primary pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full blur-3xl" />
      <div className="theme-orb-secondary pointer-events-none absolute -bottom-40 right-12 h-96 w-96 rounded-full blur-3xl" />

      <div className={mainGridClassName}>
        {isUtilityPaneResizing ? (
          <div className="absolute inset-0 z-30 cursor-col-resize" />
        ) : null}
        <NotificationToastStack
          leadingToast={
            shouldShowAppUpdateReminder && effectiveAppUpdateStatus ? (
              <UpdateReminder
                status={effectiveAppUpdateStatus}
                onDismiss={handleDismissUpdate}
                onInstallNow={handleInstallUpdate}
                onOpenChangelog={handleOpenUpdateChangelog}
              />
            ) : null
          }
          notifications={effectiveToastNotifications}
          onCloseToast={(notificationId) => {
            void handleCloseDisplayedNotification(notificationId);
          }}
          onActivateNotification={(notificationId) => {
            void handleActivateDisplayedNotification(notificationId);
          }}
        />

        {hasWorkspaces ? (
          <div className={titleBarContainerClassName}>
            <TopTabsBar
              integratedTitleBar={hasIntegratedTitleBar}
              desktopPlatform={desktopPlatform}
              onWorkspaceSwitcherVisibilityChange={setWorkspaceSwitcherOpen}
              onOpenMarketplace={() => handleLeftRailSelect("marketplace")}
              isMarketplaceActive={activeLeftRailItem === "marketplace"}
              onOpenWorkspaceCreatePanel={handleOpenCreateWorkspacePanel}
              onOpenSettings={() => {
                setSettingsDialogSection("settings");
                setSettingsDialogOpen(true);
              }}
              onOpenAccount={() => {
                setSettingsDialogSection("account");
                setSettingsDialogOpen(true);
              }}
              onOpenBilling={() => {
                setSettingsDialogSection("billing");
                setSettingsDialogOpen(true);
              }}
              onOpenExternalUrl={handleOpenExternalUrl}
              onPublish={() => setPublishOpen(true)}
            />
          </div>
        ) : null}

        {!hasHydratedWorkspaceList ? (
          bootstrapErrorMessage ? (
            <WorkspaceStartupErrorPane message={bootstrapErrorMessage} />
          ) : (
            <WorkspaceBootstrapPane />
          )
        ) : !hasWorkspaces ? (
          <FirstWorkspacePane />
        ) : hydratedRuntimeErrorMessage ? (
          <WorkspaceStartupErrorPane message={hydratedRuntimeErrorMessage} />
        ) : showOnboardingTakeover ? (
          <WorkspaceOnboardingTakeover focusRequestKey={chatFocusRequestKey} />
        ) : (
          <div
            className={`relative grid h-full min-h-0 gap-y-3 overflow-hidden transition-[grid-template-columns,column-gap] duration-300 ease-in-out ${
              showOperationsDrawer
                ? "lg:grid-cols-[60px_minmax(0,1fr)_336px]"
                : "lg:grid-cols-[60px_minmax(0,1fr)]"
            }`}
            style={{ columnGap: "0.5rem" }}
          >
            <LeftNavigationRail
              activeItem={activeLeftRailItem}
              onSelectItem={handleLeftRailSelect}
              installedApps={installedApps}
              activeAppId={activeAppId}
              onSelectApp={handleOpenInstalledApp}
              appVersionLabel={appVersionLabel}
            />

            <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-hidden">
                {spaceMode ? (
                  <div className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
                    <div
                      ref={utilityPaneHostRef}
                      className="min-h-0 min-w-0 flex-1 overflow-hidden"
                    >
                      {spacePanes.length > 0 ? (
                        <div className="flex h-full min-h-0 min-w-0 items-stretch overflow-hidden">
                          {spacePanes.map((pane, index) => {
                            const nextPane = spacePanes[index + 1] ?? null;
                            const resizeHandle = nextPane
                              ? spaceResizeHandleSpec(pane.id, nextPane.id)
                              : null;

                            return (
                              <div key={pane.id} className="contents">
                                <div
                                  className={`relative min-h-0 min-w-0 overflow-hidden rounded-[var(--radius-xl)] ${pane.flex ? "flex-1" : "shrink-0"}`}
                                  style={
                                    pane.flex
                                      ? {
                                          minWidth: `${MIN_AGENT_CONTENT_WIDTH}px`,
                                        }
                                      : { width: `${pane.width}px` }
                                  }
                                >
                                  {pane.content}
                                </div>

                                {resizeHandle ? (
                                  <div
                                    role="separator"
                                    aria-label={resizeHandle.label}
                                    aria-orientation="vertical"
                                    onPointerDown={(event) =>
                                      startUtilityPaneResize(
                                        resizeHandle.leftPaneId,
                                        resizeHandle.rightPaneId,
                                        event,
                                      )
                                    }
                                    className="group relative z-10 flex w-4 shrink-0 cursor-col-resize touch-none items-center justify-center"
                                  >
                                    <div className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded-full bg-border/55 transition-all duration-150 group-hover:w-[2px] group-hover:bg-[rgba(247,90,84,0.5)]" />
                                    <div className="pointer-events-none absolute left-1/2 top-1/2 h-14 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(247,90,84,0.08)] opacity-0 transition duration-150 group-hover:opacity-100" />
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <section className="theme-shell flex h-full min-h-0 items-center justify-center rounded-[var(--radius-xl)] border border-border/45 shadow-lg">
                          <div className="max-w-[360px] px-6 text-center">
                            <div className="text-[22px] font-medium tracking-[-0.03em] text-foreground">
                              Turn on a space surface
                            </div>
                            <div className="mt-3 text-[13px] leading-6 text-muted-foreground/78">
                              Space keeps your files, browser, and agent panes
                              available together.
                            </div>
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                ) : activeLeftRailItem === "app" ? (
                  <div className="h-full min-h-0 overflow-hidden rounded-[var(--radius-xl)]">
                    {agentView.type === "app" ? (
                      <AppSurfacePane
                        appId={agentView.appId}
                        app={
                          activeAppId === agentView.appId
                            ? activeApp
                            : getWorkspaceAppDefinition(
                                agentView.appId,
                                installedApps,
                              )
                        }
                        resourceId={agentView.resourceId}
                        view={agentView.view}
                      />
                    ) : (
                      <section className="theme-shell flex h-full min-h-0 items-center justify-center rounded-[var(--radius-xl)] border border-border/45 shadow-lg">
                        <div className="max-w-[360px] px-6 text-center">
                          <div className="text-[22px] font-medium tracking-[-0.03em] text-foreground">
                            Choose an app
                          </div>
                          <div className="mt-3 text-[13px] leading-6 text-muted-foreground/78">
                            Select a workspace app from the left rail to open
                            its dedicated screen.
                          </div>
                        </div>
                      </section>
                    )}
                  </div>
                ) : activeLeftRailItem === "automations" ? (
                  <div className="h-full min-h-0 overflow-hidden rounded-[var(--radius-xl)]">
                    <AutomationsPane
                      onOpenRunSession={handleOpenAutomationRunSession}
                      onCreateSchedule={handleCreateScheduleInChat}
                    />
                  </div>
                ) : activeLeftRailItem === "marketplace" ? (
                  <div className="h-full min-h-0 overflow-hidden rounded-[var(--radius-xl)]">
                    <MarketplacePane />
                  </div>
                ) : (
                  <div className="h-full min-h-0 overflow-hidden rounded-[var(--radius-xl)]">
                    <SkillsPane />
                  </div>
                )}
              </div>
            </div>

            {spaceMode && spaceVisibility.agent ? (
              <div className="pointer-events-none absolute right-0 top-0 z-20 hidden lg:block">
                <div className="pointer-events-auto inline-flex items-center gap-1 rounded-bl-[16px] rounded-tr-[var(--radius-xl)] border border-border/50 border-r-0 border-t-0 bg-card/94 px-2 py-2 text-muted-foreground shadow-lg backdrop-blur">
                  {showOperationsDrawer ? (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleOperationsDrawer()}
                      aria-label="Hide right panel"
                      className="rounded-[12px] border-primary/45 bg-primary/10 text-primary hover:border-primary/60 hover:bg-primary/14 active:scale-95"
                    >
                      <PanelRightClose size={14} />
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openOperationsDrawerTab("inbox")}
                        aria-label={
                          unreadTaskProposalCount > 0
                            ? `Open inbox panel with ${unreadTaskProposalCount} unread proposal${unreadTaskProposalCount === 1 ? "" : "s"}`
                            : "Open inbox panel"
                        }
                        className="relative rounded-[12px] border-border/45 text-muted-foreground hover:border-primary/45 hover:text-primary active:scale-95"
                      >
                        <InboxIcon size={13} />
                        {unreadTaskProposalCount > 0 ? (
                          <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card bg-destructive" />
                        ) : null}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openOperationsDrawerTab("running")}
                        aria-label="Open sessions panel"
                        className="rounded-[12px] border-border/45 text-muted-foreground hover:border-primary/45 hover:text-primary active:scale-95"
                      >
                        <Clock3 size={13} />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => toggleOperationsDrawer()}
                        aria-label="Show right panel"
                        className="rounded-[12px] border-border/45 text-muted-foreground hover:border-primary/45 hover:text-primary active:scale-95"
                      >
                        <PanelRightOpen size={14} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {showOperationsDrawer ? (
              <div className="min-h-0 min-w-0 overflow-hidden transition-all duration-300 ease-out">
                <OperationsDrawer
                  activeTab={activeOperationsTab}
                  onTabChange={openOperationsDrawerTab}
                  proposals={taskProposals}
                  unreadProposalCount={unreadTaskProposalCount}
                  proactiveStatus={proactiveStatus}
                  isLoadingProactiveStatus={isLoadingProactiveStatus}
                  proactiveWorkspaceEnabled={proactiveWorkspaceEnabled}
                  isLoadingProactiveWorkspaceEnabled={
                    isLoadingProactiveWorkspaceEnabled
                  }
                  isUpdatingProactiveWorkspaceEnabled={
                    isUpdatingProactiveWorkspaceEnabled
                  }
                  proactiveHeartbeatCron={
                    proactiveHeartbeatConfig?.cron ||
                    DEFAULT_PROACTIVE_HEARTBEAT_CRON
                  }
                  isLoadingProactiveHeartbeatConfig={
                    isLoadingProactiveHeartbeatConfig
                  }
                  isUpdatingProactiveHeartbeatConfig={
                    isUpdatingProactiveHeartbeatConfig
                  }
                  proactiveTaskProposalsError={proactiveTaskProposalsError}
                  proactiveHeartbeatError={proactiveHeartbeatError}
                  isLoadingProposals={isLoadingTaskProposals}
                  isTriggeringProposal={isTriggeringTaskProposal}
                  proposalStatusMessage={taskProposalStatusMessage}
                  proposalAction={proposalAction}
                  onTriggerProposal={() => void triggerRemoteTaskProposal()}
                  onProactiveWorkspaceEnabledChange={(enabled) =>
                    void handleProactiveWorkspaceEnabledChange(enabled)
                  }
                  onProactiveHeartbeatCronChange={(cron) =>
                    void handleProactiveHeartbeatCronChange(cron)
                  }
                  onAcceptProposal={(proposal) =>
                    void acceptTaskProposal(proposal)
                  }
                  onDismissProposal={(proposal) =>
                    void dismissTaskProposal(proposal)
                  }
                  onOpenRunningSession={handleOpenRunningSession}
                  onCreateSession={() => void handleCreateSession()}
                  activeRunningSessionId={activeChatSessionId}
                  hasWorkspace={hasSelectedWorkspace}
                  selectedWorkspaceId={selectedWorkspaceId}
                  selectedWorkspaceName={selectedWorkspace?.name || null}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {createWorkspacePanelOpen ? (
        <FirstWorkspacePane
          variant="panel"
          onClose={handleCloseCreateWorkspacePanel}
        />
      ) : null}

      <SettingsDialog
        open={settingsDialogOpen}
        activeSection={settingsDialogSection}
        onSectionChange={setSettingsDialogSection}
        onClose={() => setSettingsDialogOpen(false)}
        theme={theme}
        themes={THEMES}
        onThemeChange={handleThemeChange}
        onOpenExternalUrl={handleOpenExternalUrl}
      />
      {selectedWorkspaceId && (
        <PublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          workspaceId={selectedWorkspaceId}
        />
      )}
    </main>
  );
}

export function AppShell() {
  return (
    <WorkspaceSelectionProvider>
      <WorkspaceDesktopProvider>
        <DesktopBillingProvider>
          <AppShellContent />
        </DesktopBillingProvider>
      </WorkspaceDesktopProvider>
    </WorkspaceSelectionProvider>
  );
}
