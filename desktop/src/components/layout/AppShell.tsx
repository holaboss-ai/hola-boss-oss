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
const OPERATIONS_DRAWER_OPEN_STORAGE_KEY = "holaboss-operations-drawer-open-v1";
const OPERATIONS_DRAWER_TAB_STORAGE_KEY = "holaboss-operations-drawer-tab-v1";
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
const MIN_UTILITY_PANE_WIDTH = 200;
const MAX_UTILITY_PANE_WIDTH = 720;
const LEGACY_DEFAULT_FILES_PANE_WIDTH = 420;
const DEFAULT_FILES_PANE_WIDTH = MIN_UTILITY_PANE_WIDTH;
const DEFAULT_BROWSER_PANE_WIDTH = 460;
const MIN_AGENT_CONTENT_WIDTH = 120;
const UTILITY_PANE_RESIZER_WIDTH = 16;
const APP_UPDATE_NOTIFICATION_SOURCE = "app_update";
const APP_UPDATE_NOTIFICATION_URL = "https://www.holaboss.ai/explore";
const DEFAULT_NOTIFICATION_TOAST_DURATION_MS = 7_000;
const CRITICAL_NOTIFICATION_TOAST_DURATION_MS = 12_000;

type SpaceComponentId = "agent" | "files" | "browser";
type UtilityPaneId = "files" | "browser";

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

function notificationPriorityRank(priority: RuntimeNotificationPriority): number {
  if (priority === "critical") {
    return 3;
  }
  if (priority === "high") {
    return 2;
  }
  if (priority === "low") {
    return 0;
  }
  return 1;
}

function notificationSortComparator(
  left: RuntimeNotificationRecordPayload,
  right: RuntimeNotificationRecordPayload,
): number {
  const priorityDelta =
    notificationPriorityRank(right.priority) -
    notificationPriorityRank(left.priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const createdAtDelta =
    Date.parse(right.created_at) - Date.parse(left.created_at);
  if (Number.isFinite(createdAtDelta) && createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return right.id.localeCompare(left.id);
}

function notificationToastDurationMs(
  notification: RuntimeNotificationRecordPayload,
): number {
  return notification.priority === "critical"
    ? CRITICAL_NOTIFICATION_TOAST_DURATION_MS
    : DEFAULT_NOTIFICATION_TOAST_DURATION_MS;
}

function appUpdateNotificationId(status: AppUpdateStatusPayload): string {
  return `app-update:${
    status.releaseTag || status.latestVersion || status.publishedAt || "latest"
  }`;
}

function appUpdateReleaseLabel(status: AppUpdateStatusPayload): string {
  return status.latestVersion || status.releaseTag || "latest";
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

function notificationReleaseTag(
  notification: RuntimeNotificationRecordPayload,
): string | null {
  return notificationMetadataString(notification, "update_release_tag");
}

function isAppUpdateNotification(
  notification: RuntimeNotificationRecordPayload,
): boolean {
  return (
    notification.source_type === APP_UPDATE_NOTIFICATION_SOURCE ||
    notificationMetadataString(notification, "notification_kind") ===
      APP_UPDATE_NOTIFICATION_SOURCE
  );
}

function buildAppUpdateNotification(
  status: AppUpdateStatusPayload,
  state: RuntimeNotificationState,
): RuntimeNotificationRecordPayload {
  const releaseLabel = appUpdateReleaseLabel(status);
  const createdAt =
    status.publishedAt || status.lastCheckedAt || "1970-01-01T00:00:00.000Z";

  return {
    id: appUpdateNotificationId(status),
    workspace_id: "",
    cronjob_id: null,
    source_type: APP_UPDATE_NOTIFICATION_SOURCE,
    source_label: "Desktop updates",
    title: `Holaboss ${releaseLabel} is ready`,
    message: `You are on ${status.currentVersion}. Click to download the newer stable desktop build.`,
    level: "info",
    priority: "critical",
    state,
    metadata: {
      notification_kind: APP_UPDATE_NOTIFICATION_SOURCE,
      action_url: APP_UPDATE_NOTIFICATION_URL,
      activation_state: "dismissed",
      update_release_tag: status.releaseTag ?? null,
    },
    read_at: state === "unread" ? null : createdAt,
    dismissed_at: null,
    created_at: createdAt,
    updated_at: status.lastCheckedAt || createdAt,
  };
}

function loadSpaceVisibility(): SpaceVisibilityState {
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
        MIN_UTILITY_PANE_WIDTH,
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
        MIN_UTILITY_PANE_WIDTH,
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
    if (raw === "0") {
      return false;
    }
  } catch {
    // ignore
  }

  return true;
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

function loadTheme(): AppTheme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && isAppTheme(stored)) {
      return stored;
    }
  } catch {
    // ignore
  }

  return "amber-minimal-dark";
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
  const { selectedWorkspaceId } = useWorkspaceSelection();
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
  const [syntheticNotificationStates, setSyntheticNotificationStates] =
    useState<Record<string, RuntimeNotificationState>>({});
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

  const appUpdateNotification = useMemo(() => {
    if (!appUpdateStatus?.available) {
      return null;
    }
    const notificationId = appUpdateNotificationId(appUpdateStatus);
    return buildAppUpdateNotification(
      appUpdateStatus,
      syntheticNotificationStates[notificationId] ?? "unread",
    );
  }, [appUpdateStatus, syntheticNotificationStates]);

  const combinedNotifications = useMemo(() => {
    const items = appUpdateNotification
      ? [appUpdateNotification, ...notifications]
      : notifications;
    return [...items].sort(notificationSortComparator);
  }, [appUpdateNotification, notifications]);

  const notificationById = useMemo(
    () =>
      new Map(combinedNotifications.map((notification) => [notification.id, notification])),
    [combinedNotifications],
  );

  const notificationUnreadCount = useMemo(
    () => combinedNotifications.filter((item) => item.state === "unread").length,
    [combinedNotifications],
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
          : MIN_UTILITY_PANE_WIDTH;
      const maxWidth =
        hostWidth > 0
          ? Math.min(
              MAX_UTILITY_PANE_WIDTH,
              Math.max(
                MIN_UTILITY_PANE_WIDTH,
                hostWidth -
                  fixedOtherWidths -
                  minFlexibleWidth -
                  resizerCount * UTILITY_PANE_RESIZER_WIDTH,
              ),
            )
          : MAX_UTILITY_PANE_WIDTH;
      return Math.max(MIN_UTILITY_PANE_WIDTH, Math.min(width, maxWidth));
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
            MIN_UTILITY_PANE_WIDTH,
            Math.min(leftWidth, MAX_UTILITY_PANE_WIDTH),
          ),
          rightWidth: Math.max(
            MIN_UTILITY_PANE_WIDTH,
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
          MIN_UTILITY_PANE_WIDTH * 2,
          hostWidth -
            fixedOtherWidths -
            MIN_AGENT_CONTENT_WIDTH -
            resizerCount * UTILITY_PANE_RESIZER_WIDTH,
        ),
      );
      const combinedWidth = Math.min(leftWidth + rightWidth, maxCombinedWidth);
      const nextLeftWidth = Math.max(
        MIN_UTILITY_PANE_WIDTH,
        Math.min(leftWidth, combinedWidth - MIN_UTILITY_PANE_WIDTH),
      );
      return {
        leftWidth: nextLeftWidth,
        rightWidth: combinedWidth - nextLeftWidth,
      };
    },
    [],
  );

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

        const requestedUrl =
          typeof payload.url === "string" ? payload.url.trim() : "";
        if (requestedUrl) {
          openBrowserPane();
          void window.electronAPI.browser
            .setActiveWorkspace(
              payload.workspaceId ?? selectedWorkspaceId ?? null,
            )
            .then(() => window.electronAPI.browser.navigate(requestedUrl))
            .catch(() => undefined);
          return;
        }
        openBrowserPane();
      },
    );

    return unsubscribe;
  }, [selectedWorkspaceId]);

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

  const markSyntheticNotificationsRead = useCallback(
    (notificationIds: string[]) => {
      if (notificationIds.length === 0) {
        return;
      }
      setSyntheticNotificationStates((current) => {
        let changed = false;
        const next = { ...current };
        for (const notificationId of notificationIds) {
          if (next[notificationId] !== "read") {
            next[notificationId] = "read";
            changed = true;
          }
        }
        return changed ? next : current;
      });
    },
    [],
  );

  const refreshNotifications = useCallback(async () => {
    if (!window.electronAPI) {
      return;
    }

    try {
      const response = await window.electronAPI.workspace.listNotifications(
        null,
        false,
      );
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
    if (!appUpdateNotification || appUpdateNotification.state !== "unread") {
      return;
    }
    if (seenNotificationIdsRef.current.has(appUpdateNotification.id)) {
      return;
    }
    seenNotificationIdsRef.current.add(appUpdateNotification.id);
    setToastNotifications((current) => {
      if (current.some((existing) => existing.id === appUpdateNotification.id)) {
        return current;
      }
      return [appUpdateNotification, ...current].slice(0, 4);
    });
    if (!notificationToastTimeoutsRef.current.has(appUpdateNotification.id)) {
      const timeoutId = window.setTimeout(() => {
        dismissNotificationToast(appUpdateNotification.id);
      }, notificationToastDurationMs(appUpdateNotification));
      notificationToastTimeoutsRef.current.set(appUpdateNotification.id, timeoutId);
    }
  }, [appUpdateNotification, dismissNotificationToast]);

  useEffect(() => {
    const activeNotificationIds = new Set(
      combinedNotifications.map((notification) => notification.id),
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
  }, [combinedNotifications]);

  const handleActivateNotification = useCallback(
    async (notificationId: string) => {
      if (!window.electronAPI) {
        return;
      }
      const notification = notificationById.get(notificationId);
      if (!notification) {
        return;
      }

      dismissNotificationToast(notification.id);
      const targetUrl = notificationActionUrl(notification);
      const nextState = notificationActivationState(notification);

      if (isAppUpdateNotification(notification)) {
        if (nextState === "dismissed") {
          try {
            await window.electronAPI.appUpdate.dismiss(
              notificationReleaseTag(notification),
            );
          } catch {
            // Ignore transient update-dismiss failures in the shell.
          }
        } else {
          markSyntheticNotificationsRead([notification.id]);
        }
        if (targetUrl) {
          try {
            await window.electronAPI.ui.openExternalUrl(targetUrl);
          } catch {
            // Ignore transient shell URL open failures.
          }
        }
        return;
      }

      try {
        await window.electronAPI.workspace.updateNotification(notification.id, {
          state: nextState,
        });
        await refreshNotifications();
      } catch {
        // Ignore transient notification update failures in the shell.
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
      markSyntheticNotificationsRead,
      notificationById,
      refreshNotifications,
    ],
  );

  const handleDismissNotification = useCallback(
    async (notificationId: string) => {
      if (!window.electronAPI) {
        return;
      }
      const notification = notificationById.get(notificationId);
      if (!notification) {
        return;
      }

      if (isAppUpdateNotification(notification)) {
        try {
          dismissNotificationToast(notification.id);
          markSyntheticNotificationsRead([notification.id]);
          await window.electronAPI.appUpdate.dismiss(
            notificationReleaseTag(notification),
          );
        } catch {
          // Ignore transient notification update failures in the shell.
        }
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
      markSyntheticNotificationsRead,
      notificationById,
      refreshNotifications,
    ],
  );

  const handleClearAllNotifications = useCallback(async () => {
    if (!window.electronAPI || combinedNotifications.length === 0) {
      return;
    }

    for (const notification of combinedNotifications) {
      dismissNotificationToast(notification.id);
    }

    try {
      const runtimeNotificationIds = combinedNotifications
        .filter((notification) => !isAppUpdateNotification(notification))
        .map((notification) => notification.id);
      const appUpdateNotifications = combinedNotifications.filter((notification) =>
        isAppUpdateNotification(notification),
      );
      if (appUpdateNotifications.length > 0) {
        markSyntheticNotificationsRead(
          appUpdateNotifications.map((notification) => notification.id),
        );
      }
      await Promise.allSettled([
        ...runtimeNotificationIds.map((notificationId) =>
          window.electronAPI.workspace.updateNotification(notificationId, {
            state: "dismissed",
          }),
        ),
        ...appUpdateNotifications.map((notification) =>
          window.electronAPI.appUpdate.dismiss(notificationReleaseTag(notification)),
        ),
      ]);
      if (runtimeNotificationIds.length > 0) {
        await refreshNotifications();
      }
    } catch {
      // Ignore transient notification update failures in the shell.
    }
  }, [
    combinedNotifications,
    dismissNotificationToast,
    markSyntheticNotificationsRead,
    refreshNotifications,
  ]);

  const handleNotificationCenterOpenChange = useCallback(
    (open: boolean) => {
      if (!open || !window.electronAPI) {
        return;
      }
      const unreadNotifications = combinedNotifications
        .filter((item) => item.state === "unread")
        .map((item) => item);
      if (unreadNotifications.length === 0) {
        return;
      }
      const syntheticUnreadIds = unreadNotifications
        .filter((notification) => isAppUpdateNotification(notification))
        .map((notification) => notification.id);
      if (syntheticUnreadIds.length > 0) {
        markSyntheticNotificationsRead(syntheticUnreadIds);
      }
      const runtimeUnreadIds = unreadNotifications
        .filter((notification) => !isAppUpdateNotification(notification))
        .map((notification) => notification.id);
      for (const notification of unreadNotifications) {
        dismissNotificationToast(notification.id);
      }
      if (runtimeUnreadIds.length === 0) {
        return;
      }
      void Promise.allSettled(
        runtimeUnreadIds.map((notificationId) =>
          window.electronAPI.workspace.updateNotification(notificationId, {
            state: "read",
          }),
        ),
      ).then(() => refreshNotifications());
    },
    [
      combinedNotifications,
      dismissNotificationToast,
      markSyntheticNotificationsRead,
      refreshNotifications,
    ],
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
        .setActiveWorkspace(targetWorkspaceId)
        .then(() => window.electronAPI.browser.navigate(normalizedUrl))
        .catch(() => undefined);
    },
    [revealBrowserPane, selectedWorkspaceId],
  );

  const handleOpenCreateWorkspacePanel = useCallback(() => {
    setCreateWorkspacePanelAnchorWorkspaceId(selectedWorkspaceId || "");
    setCreateWorkspacePanelOpen(true);
  }, [selectedWorkspaceId]);

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

  async function handleProactiveTaskProposalsEnabledChange(enabled: boolean) {
    setProactiveTaskProposalsError("");
    setIsUpdatingProactiveTaskProposalsEnabled(true);
    try {
      const preference =
        await window.electronAPI.workspace.setProactiveTaskProposalPreference({
          enabled,
        });
      setProactiveTaskProposalsEnabled(preference.enabled !== false);
    } catch (error) {
      setProactiveTaskProposalsError(normalizeErrorMessage(error));
    } finally {
      setIsUpdatingProactiveTaskProposalsEnabled(false);
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
        parent_session_id:
          (selectedWorkspace.main_session_id || "").trim() || null,
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

  const toggleOperationsDrawer = () => {
    setOperationsDrawerOpen((open) => !open);
  };

  const openOperationsDrawerTab = (tab: OperationsDrawerTab) => {
    setActiveOperationsTab(tab);
    setOperationsDrawerOpen(true);
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
    const mainSessionId = (selectedWorkspace?.main_session_id || "").trim();

    setActiveLeftRailItem("space");
    setSpaceVisibility((previous) => ({
      ...previous,
      agent: true,
    }));
    setAgentView({ type: "chat" });
    setChatSessionJumpRequest(null);
    setChatSessionOpenRequest((previous) =>
      mainSessionId
        ? {
            sessionId: mainSessionId,
            requestKey: (previous?.requestKey ?? 0) + 1,
          }
        : null,
    );
    setChatComposerPrefillRequest((previous) => ({
      text: "Create a cronjob for ",
      requestKey: (previous?.requestKey ?? 0) + 1,
    }));
    setChatFocusRequestKey((current) => current + 1);
  }, [selectedWorkspace?.main_session_id]);

  const handleChatComposerPrefillConsumed = useCallback((requestKey: number) => {
    setChatComposerPrefillRequest((current) =>
      current?.requestKey === requestKey ? null : current,
    );
  }, []);

  const handleOpenWorkspaceOutput = useCallback(
    (output: WorkspaceOutputRecordPayload) => {
      const target = workspaceOutputNavigationTarget(output, installedAppIds);
      if (target.type === "app") {
        setActiveLeftRailItem("app");
        setAgentView({
          type: "app",
          appId: target.appId,
          resourceId: target.resourceId,
          view: target.view,
        });
        return;
      }

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
    },
    [installedAppIds],
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
      filesPaneWidth,
      flexSpacePaneId,
      publishOpen,
      isUtilityPaneResizing,
      createWorkspacePanelOpen,
      settingsDialogOpen,
      shouldSuspendBrowserNativeView,
      showOperationsDrawer,
      visibleSpacePaneIds,
      workspaceSwitcherOpen,
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

    const syncWidth = () => {
      if (spaceVisibility.files && flexSpacePaneId !== "files") {
        setFilesPaneWidth((current) => clampUtilityPaneWidth("files", current));
      }
      if (spaceVisibility.browser && flexSpacePaneId !== "browser") {
        setBrowserPaneWidth((current) =>
          clampUtilityPaneWidth("browser", current),
        );
      }
    };

    syncWidth();
    window.addEventListener("resize", syncWidth);
    return () => {
      window.removeEventListener("resize", syncWidth);
    };
  }, [
    clampUtilityPaneWidth,
    flexSpacePaneId,
    spaceVisibility,
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
          notifications={toastNotifications}
          onCloseToast={dismissNotificationToast}
          onActivateNotification={(notificationId) => {
            void handleActivateNotification(notificationId);
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
              notificationUnreadCount={notificationUnreadCount}
              onNotificationCenterOpenChange={
                handleNotificationCenterOpenChange
              }
              onActivateNotification={(notificationId) => {
                void handleActivateNotification(notificationId);
              }}
              onDismissNotification={(notificationId) => {
                void handleDismissNotification(notificationId);
              }}
              notifications={combinedNotifications}
              onClearAllNotifications={() => {
                void handleClearAllNotifications();
              }}
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
                ? "lg:grid-cols-[60px_minmax(0,1fr)_380px]"
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
            />

            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-hidden">
                {spaceMode ? (
                  <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
                    <div
                      ref={utilityPaneHostRef}
                      className="min-h-0 flex-1 overflow-hidden"
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
                                      ? undefined
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
                    <button
                      type="button"
                      onClick={() => toggleOperationsDrawer()}
                      aria-label="Hide right panel"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-primary/45 bg-primary/10 text-primary transition-all duration-200 hover:border-primary/60 hover:bg-primary/14 active:scale-95"
                    >
                      <PanelRightClose size={14} />
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openOperationsDrawerTab("inbox")}
                        aria-label="Open inbox panel"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-border/45 text-muted-foreground transition-all duration-200 hover:border-primary/45 hover:text-primary active:scale-95"
                      >
                        <InboxIcon size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openOperationsDrawerTab("running")}
                        aria-label="Open sub-sessions panel"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-border/45 text-muted-foreground transition-all duration-200 hover:border-primary/45 hover:text-primary active:scale-95"
                      >
                        <Clock3 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleOperationsDrawer()}
                        aria-label="Show right panel"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-border/45 text-muted-foreground transition-all duration-200 hover:border-primary/45 hover:text-primary active:scale-95"
                      >
                        <PanelRightOpen size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {showOperationsDrawer ? (
              <div className="min-h-0 min-w-0 overflow-hidden transition-all duration-300 ease-out">
                <OperationsDrawer
                  activeTab={activeOperationsTab}
                  onTabChange={setActiveOperationsTab}
                  proposals={taskProposals}
                  proactiveStatus={proactiveStatus}
                  isLoadingProactiveStatus={isLoadingProactiveStatus}
                  proactiveTaskProposalsEnabled={proactiveTaskProposalsEnabled}
                  isUpdatingProactiveTaskProposalsEnabled={
                    isLoadingProactiveTaskProposalsEnabled ||
                    isUpdatingProactiveTaskProposalsEnabled
                  }
                  proactiveTaskProposalsError={proactiveTaskProposalsError}
                  isLoadingProposals={isLoadingTaskProposals}
                  isTriggeringProposal={isTriggeringTaskProposal}
                  proposalStatusMessage={taskProposalStatusMessage}
                  proposalAction={proposalAction}
                  onTriggerProposal={() => void triggerRemoteTaskProposal()}
                  onProactiveTaskProposalsEnabledChange={(enabled) =>
                    void handleProactiveTaskProposalsEnabledChange(enabled)
                  }
                  onAcceptProposal={(proposal) =>
                    void acceptTaskProposal(proposal)
                  }
                  onDismissProposal={(proposal) =>
                    void dismissTaskProposal(proposal)
                  }
                  onOpenRunningSession={handleOpenRunningSession}
                  activeRunningSessionId={activeChatSessionId}
                  hasWorkspace={hasSelectedWorkspace}
                  selectedWorkspaceId={selectedWorkspaceId}
                  selectedWorkspaceName={selectedWorkspace?.name || null}
                  mainSessionId={
                    (selectedWorkspace?.main_session_id || "").trim() || null
                  }
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
