import {
  LeftNavigationRail,
  type LeftRailItem,
} from "@/components/layout/LeftNavigationRail";
import {
  OperationsDrawer,
  type OperationsDrawerTab,
  type OperationsOutputEntry,
} from "@/components/layout/OperationsDrawer";
import { appShellMainGridClassName } from "@/components/layout/appShellLayout";
import { SettingsDialog } from "@/components/layout/SettingsDialog";
import { TopTabsBar } from "@/components/layout/TopTabsBar";
import { FirstWorkspacePane } from "@/components/onboarding";
import { AppSurfacePane } from "@/components/panes/AppSurfacePane";
import { AutomationsPane } from "@/components/panes/AutomationsPane";
import { BrowserPane } from "@/components/panes/BrowserPane";
import { ChatPane } from "@/components/panes/ChatPane";
import { FileExplorerPane } from "@/components/panes/FileExplorerPane";
import { IntegrationsPane } from "@/components/panes/IntegrationsPane";
import { InternalSurfacePane } from "@/components/panes/InternalSurfacePane";
import { MarketplacePane } from "@/components/panes/MarketplacePane";
import { OnboardingPane } from "@/components/panes/OnboardingPane";
import { SkillsPane } from "@/components/panes/SkillsPane";
import { UpdateReminder } from "@/components/ui/UpdateReminder";
import { preferredSessionId } from "@/lib/sessionRouting";
import {
  getWorkspaceAppDefinition,
  inferInstalledWorkspaceAppIdFromText,
} from "@/lib/workspaceApps";
import {
  useWorkspaceDesktop,
  WorkspaceDesktopProvider,
} from "@/lib/workspaceDesktop";
import {
  useWorkspaceSelection,
  WorkspaceSelectionProvider,
} from "@/lib/workspaceSelection";
import {
  Bell,
  ChevronRight,
  CircleCheck,
  Clock3,
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
  return value === "account" || value === "providers" || value === "settings" || value === "about";
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
    if (raw === "inbox" || raw === "running" || raw === "outputs") {
      return raw;
    }
  } catch {
    // ignore
  }

  return "outputs";
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
  return error instanceof Error ? error.message : "Request failed.";
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

function runtimeOutputTone(status: string): OperationsOutputEntry["tone"] {
  const normalized = status.trim().toLowerCase();
  if (normalized === "failed" || normalized === "error") {
    return "error";
  }
  if (
    normalized === "completed" ||
    normalized === "ready" ||
    normalized === "active"
  ) {
    return "success";
  }
  return "info";
}

function runtimeOutputToEntry(
  output: WorkspaceOutputRecordPayload,
  installedAppIds: Set<string>,
): OperationsOutputEntry {
  const moduleId = (output.module_id || "").trim().toLowerCase();
  const title =
    output.title.trim() || output.output_type.trim() || "Workspace output";
  const detailParts = [
    output.status ? `Status: ${output.status}` : "",
    output.file_path ? `File: ${output.file_path}` : "",
    output.platform ? `Platform: ${output.platform}` : "",
  ].filter(Boolean);

  return {
    id: `runtime-output:${output.id}`,
    title,
    detail:
      detailParts.join(" | ") || "Runtime output generated for this workspace.",
    createdAt: output.created_at,
    tone: runtimeOutputTone(output.status),
    sessionId: output.session_id,
    renderer:
      moduleId && installedAppIds.has(moduleId)
        ? {
            type: "app",
            appId: moduleId,
            resourceId:
              output.module_resource_id || output.artifact_id || output.id,
            view: output.output_type || "home",
          }
        : {
            type: "internal",
            surface: inferInternalSurfaceFromOutputType(output.output_type),
            resourceId: output.file_path || output.artifact_id || output.id,
            htmlContent: output.html_content,
          },
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
          <Loader2 size={20} className="animate-spin text-muted-foreground/60" />
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
                <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground/50" />
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
  onOutputsChanged,
  focusRequestKey,
}: {
  onOutputsChanged: () => void;
  focusRequestKey: number;
}) {
  return (
    <section className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_16%,rgba(247,90,84,0.1),transparent_28%),radial-gradient(circle_at_88%_10%,rgba(247,170,126,0.08),transparent_24%),radial-gradient(circle_at_50%_100%,rgba(247,90,84,0.06),transparent_34%)]" />
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <OnboardingPane
          onOutputsChanged={onOutputsChanged}
          focusRequestKey={focusRequestKey}
        />
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
  const [activeLeftRailItem, setActiveLeftRailItem] =
    useState<LeftRailItem>("space");
  const [agentView, setAgentView] = useState<AgentView>({ type: "chat" });
  const [chatFocusRequestKey, setChatFocusRequestKey] = useState(1);
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
  const [proposalAction, setProposalAction] = useState<{
    proposalId: string;
    action: "accept" | "dismiss";
  } | null>(null);
  const [outputEntries, setOutputEntries] = useState<OperationsOutputEntry[]>(
    [],
  );
  const [runtimeOutputEntries, setRuntimeOutputEntries] = useState<
    OperationsOutputEntry[]
  >([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const outputRefreshTimerRef = useRef<number | null>(null);
  const utilityPaneHostRef = useRef<HTMLDivElement | null>(null);
  const utilityPaneResizeStateRef = useRef<UtilityPaneResizeState | null>(null);
  const filesPaneWidthRef = useRef(filesPaneWidth);
  const browserPaneWidthRef = useRef(browserPaneWidth);
  const spaceVisibilityRef = useRef(spaceVisibility);

  filesPaneWidthRef.current = filesPaneWidth;
  browserPaneWidthRef.current = browserPaneWidth;
  spaceVisibilityRef.current = spaceVisibility;

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

  const refreshRuntimeOutputs = useCallback(async () => {
    if (!selectedWorkspaceId || runtimeStatus?.status !== "running") {
      setRuntimeOutputEntries([]);
      return;
    }
    try {
      const response =
        await window.electronAPI.workspace.listOutputs(selectedWorkspaceId);
      const installedAppIds = new Set(installedApps.map((app) => app.id));
      setRuntimeOutputEntries(
        response.items.map((item) =>
          runtimeOutputToEntry(item, installedAppIds),
        ),
      );
    } catch {
      setRuntimeOutputEntries([]);
    }
  }, [installedApps, runtimeStatus?.status, selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId || runtimeStatus?.status !== "running") {
      setRuntimeOutputEntries([]);
      return;
    }

    void refreshRuntimeOutputs();
  }, [refreshRuntimeOutputs, runtimeStatus?.status, selectedWorkspaceId]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.workspace.onSessionStreamEvent(
      (payload) => {
        if (payload.type !== "event") {
          return;
        }
        const data =
          payload.event?.data &&
          typeof payload.event.data === "object" &&
          !Array.isArray(payload.event.data)
            ? (payload.event.data as {
                event_type?: string;
                session_id?: string;
              })
            : null;
        const eventType =
          typeof data?.event_type === "string"
            ? data.event_type
            : payload.event?.event || "";
        if (eventType === "output_delta" || eventType === "thinking_delta") {
          return;
        }
        if (outputRefreshTimerRef.current !== null) {
          window.clearTimeout(outputRefreshTimerRef.current);
        }
        outputRefreshTimerRef.current = window.setTimeout(() => {
          outputRefreshTimerRef.current = null;
          void refreshRuntimeOutputs();
        }, 250);
      },
    );

    return () => {
      if (outputRefreshTimerRef.current !== null) {
        window.clearTimeout(outputRefreshTimerRef.current);
        outputRefreshTimerRef.current = null;
      }
      unsubscribe();
    };
  }, [refreshRuntimeOutputs]);

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
        setActiveLeftRailItem("space");
        setSpaceVisibility((previous) => ({
          ...previous,
          browser: true,
        }));
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

  const handleThemeChange = useCallback((nextTheme: string) => {
    if (isAppTheme(nextTheme)) {
      setTheme(nextTheme);
    }
  }, []);

  const handleOpenExternalUrl = useCallback((url: string) => {
    void window.electronAPI.ui.openExternalUrl(url);
  }, []);

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

  const appendOutputEntry = (
    entry: Omit<OperationsOutputEntry, "id" | "createdAt">,
  ) => {
    const nextEntry: OperationsOutputEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...entry,
    };
    setOutputEntries((previous) => [nextEntry, ...previous].slice(0, 16));
    setSelectedOutputId(nextEntry.id);
  };

  async function refreshTaskProposals(options?: { logErrors?: boolean }) {
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
      const message = normalizeErrorMessage(error);
      setTaskProposalStatusMessage(message);
      if (options?.logErrors) {
        appendOutputEntry({
          title: "Proposal refresh failed",
          detail: message,
          tone: "error",
          renderer: {
            type: "internal",
            surface: "event",
          },
        });
      }
    } finally {
      setIsLoadingTaskProposals(false);
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
        await window.electronAPI.workspace.enqueueRemoteDemoTaskProposal({
          workspace_id: selectedWorkspaceId,
        });
      const detail = `Remote proactive job queued. Pending cloud jobs: ${response.pending_count}.`;
      setTaskProposalStatusMessage(detail);
      appendOutputEntry({
        title: "Remote task proposal queued",
        detail,
        tone: "success",
        renderer: {
          type: "internal",
          surface: "event",
        },
      });
      void refreshRuntimeOutputs();
      window.setTimeout(() => {
        void refreshTaskProposals();
      }, 1500);
    } catch (error) {
      const message = normalizeErrorMessage(error);
      setTaskProposalStatusMessage(message);
      appendOutputEntry({
        title: "Remote task proposal failed",
        detail: message,
        tone: "error",
        renderer: {
          type: "internal",
          surface: "event",
        },
      });
      void refreshRuntimeOutputs();
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
      const runtimeStatesResponse =
        await window.electronAPI.workspace.listRuntimeStates(
          selectedWorkspaceId,
        );
      const targetSessionId = preferredSessionId(
        selectedWorkspace,
        runtimeStatesResponse.items,
      );
      if (!targetSessionId) {
        throw new Error("No active session found for this workspace.");
      }

      await window.electronAPI.workspace.queueSessionInput({
        text: proposal.task_prompt,
        workspace_id: selectedWorkspaceId,
        image_urls: null,
        session_id: targetSessionId,
        priority: 0,
        model: runtimeConfig?.defaultModel ?? null,
      });
      await window.electronAPI.workspace.updateTaskProposalState(
        proposal.proposal_id,
        "accepted",
      );

      const detail = `Queued "${proposal.task_name}" into session ${targetSessionId}.`;
      const inferredAppId = inferInstalledWorkspaceAppIdFromText(
        `${proposal.task_name}\n${proposal.task_prompt}`,
        installedApps,
      );
      setTaskProposalStatusMessage(detail);
      appendOutputEntry({
        title: `Accepted: ${proposal.task_name}`,
        detail,
        tone: "success",
        sessionId: targetSessionId,
        renderer: inferredAppId
          ? {
              type: "app",
              appId: inferredAppId,
              resourceId: proposal.proposal_id,
              view: "editor",
            }
          : {
              type: "internal",
              surface: "event",
            },
      });
      void refreshRuntimeOutputs();
      await refreshTaskProposals();
    } catch (error) {
      const message = normalizeErrorMessage(error);
      setTaskProposalStatusMessage(message);
      appendOutputEntry({
        title: `Accept failed: ${proposal.task_name}`,
        detail: message,
        tone: "error",
        renderer: {
          type: "internal",
          surface: "event",
        },
      });
      void refreshRuntimeOutputs();
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
      appendOutputEntry({
        title: `Dismissed: ${proposal.task_name}`,
        detail,
        tone: "info",
        renderer: {
          type: "internal",
          surface: "event",
        },
      });
      void refreshRuntimeOutputs();
      await refreshTaskProposals();
    } catch (error) {
      const message = normalizeErrorMessage(error);
      setTaskProposalStatusMessage(message);
      appendOutputEntry({
        title: `Dismiss failed: ${proposal.task_name}`,
        detail: message,
        tone: "error",
        renderer: {
          type: "internal",
          surface: "event",
        },
      });
      void refreshRuntimeOutputs();
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
  }, [selectedWorkspace, selectedWorkspaceId]);

  const handleDismissUpdate = () => {
    void window.electronAPI.appUpdate.dismiss(
      appUpdateStatus?.releaseTag ?? null,
    );
  };

  const handleDownloadUpdate = () => {
    void window.electronAPI.appUpdate.openDownload();
  };

  const toggleOperationsDrawer = () => {
    setOperationsDrawerOpen((open) => !open);
  };

  const openOperationsDrawerTab = (tab: OperationsDrawerTab) => {
    setActiveOperationsTab(tab);
    setOperationsDrawerOpen(true);
  };

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

  const handleOpenOutput = (entry: OperationsOutputEntry) => {
    if (entry.renderer.type === "app") {
      setActiveLeftRailItem("app");
      setAgentView({
        type: "app",
        appId: entry.renderer.appId,
        resourceId: entry.renderer.resourceId,
        view: entry.renderer.view,
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
      surface: entry.renderer.surface,
      resourceId: entry.renderer.resourceId ?? entry.id,
      htmlContent: entry.renderer.htmlContent,
    });
  };

  const spaceMode = activeLeftRailItem === "space";
  const appMode = activeLeftRailItem === "app";
  const activeAppId =
    appMode && agentView.type === "app" ? agentView.appId : null;
  const activeApp = getWorkspaceAppDefinition(activeAppId, installedApps);
  const hasWorkspaces = workspaces.length > 0;
  const hasSelectedWorkspace = Boolean(selectedWorkspace);
  const allAppsReady =
    installedApps.length === 0 || installedApps.every((app) => app.ready);
  const showInitializingGate =
    hasSelectedWorkspace && installedApps.length > 0 && !allAppsReady;

  const visibleSpacePaneIds =
    hasWorkspaces && spaceMode
      ? FIXED_SPACE_ORDER.filter((paneId) => spaceVisibility[paneId])
      : [];
  const flexSpacePaneId = visibleSpacePaneIds.includes("agent")
    ? "agent"
    : (visibleSpacePaneIds[visibleSpacePaneIds.length - 1] ?? null);
  const showOperationsDrawer =
    spaceMode && spaceVisibility.agent && operationsDrawerOpen;
  const bootstrapErrorMessage =
    !hasHydratedWorkspaceList && runtimeStatus?.status === "error"
      ? runtimeStatus.lastError.trim() ||
        workspaceErrorMessage ||
        "Embedded runtime failed to start."
      : "";
  const isMacDesktop = window.electronAPI?.platform === "darwin";
  const mainGridClassName = appShellMainGridClassName({
    hasWorkspaces,
    isMacDesktop,
  });
  const showOnboardingTakeover =
    hasHydratedWorkspaceList &&
    hasWorkspaces &&
    hasSelectedWorkspace &&
    onboardingModeActive;
  const combinedOutputEntries = useMemo(() => {
    const merged = [...runtimeOutputEntries, ...outputEntries];
    const seen = new Set<string>();
    return merged.filter((entry) => {
      if (seen.has(entry.id)) {
        return false;
      }
      seen.add(entry.id);
      return true;
    });
  }, [outputEntries, runtimeOutputEntries]);

  const agentContent = useMemo(() => {
    if (!hasSelectedWorkspace) {
      return <EmptyWorkspacePane />;
    }

    if (agentView.type === "chat") {
      return onboardingModeActive ? (
        <OnboardingPane
          onOutputsChanged={() => void refreshRuntimeOutputs()}
          focusRequestKey={chatFocusRequestKey}
        />
      ) : (
        <ChatPane
          onOutputsChanged={() => void refreshRuntimeOutputs()}
          focusRequestKey={chatFocusRequestKey}
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
    chatFocusRequestKey,
    hasSelectedWorkspace,
    installedApps,
    onboardingModeActive,
    refreshRuntimeOutputs,
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
            <FileExplorerPane />
          ) : (
            <BrowserPane
              suspendNativeView={
                isUtilityPaneResizing ||
                workspaceSwitcherOpen ||
                settingsDialogOpen
              }
              layoutSyncKey={`${visibleSpacePaneIds.join("|")}:${filesPaneWidth}:${browserPaneWidth}:${showOperationsDrawer ? 1 : 0}`}
            />
          ),
      })),
    [
      agentContent,
      browserPaneWidth,
      filesPaneWidth,
      flexSpacePaneId,
      isUtilityPaneResizing,
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
        {appUpdateStatus?.available ? (
          <UpdateReminder
            status={appUpdateStatus}
            onDismiss={handleDismissUpdate}
            onDownload={handleDownloadUpdate}
          />
        ) : null}

        {hasWorkspaces ? (
          <div className="relative min-w-0">
            <TopTabsBar
              integratedTitleBar={isMacDesktop}
              onWorkspaceSwitcherVisibilityChange={setWorkspaceSwitcherOpen}
              onOpenMarketplace={() => handleLeftRailSelect("marketplace")}
              isMarketplaceActive={activeLeftRailItem === "marketplace"}
              onOpenSettings={() => {
                setSettingsDialogSection("settings");
                setSettingsDialogOpen(true);
              }}
              onOpenAccount={() => {
                setSettingsDialogSection("account");
                setSettingsDialogOpen(true);
              }}
              onOpenExternalUrl={handleOpenExternalUrl}
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
        ) : showOnboardingTakeover ? (
          <WorkspaceOnboardingTakeover
            onOutputsChanged={() => void refreshRuntimeOutputs()}
            focusRequestKey={chatFocusRequestKey}
          />
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
                                  className={`relative min-h-0 min-w-0 overflow-hidden ${pane.flex ? "flex-1" : "shrink-0"}`}
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
                  <div className="h-full min-h-0 overflow-hidden">
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
                  <div className="h-full min-h-0 overflow-hidden">
                    <AutomationsPane />
                  </div>
                ) : activeLeftRailItem === "integrations" ? (
                  <div className="h-full min-h-0 overflow-hidden">
                    <IntegrationsPane />
                  </div>
                ) : activeLeftRailItem === "marketplace" ? (
                  <div className="h-full min-h-0 overflow-hidden">
                    <MarketplacePane />
                  </div>
                ) : (
                  <div className="h-full min-h-0 overflow-hidden">
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
                        <Bell size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openOperationsDrawerTab("running")}
                        aria-label="Open running panel"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-border/45 text-muted-foreground transition-all duration-200 hover:border-primary/45 hover:text-primary active:scale-95"
                      >
                        <Clock3 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openOperationsDrawerTab("outputs")}
                        aria-label="Open outputs panel"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-border/45 text-muted-foreground transition-all duration-200 hover:border-primary/45 hover:text-primary active:scale-95"
                      >
                        <ChevronRight size={13} />
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
                  isLoadingProposals={isLoadingTaskProposals}
                  isTriggeringProposal={isTriggeringTaskProposal}
                  proposalStatusMessage={taskProposalStatusMessage}
                  proposalAction={proposalAction}
                  outputs={combinedOutputEntries}
                  installedApps={installedApps}
                  selectedOutputId={selectedOutputId}
                  onSelectOutput={setSelectedOutputId}
                  onOpenOutput={handleOpenOutput}
                  onRefreshProposals={() =>
                    void refreshTaskProposals({ logErrors: true })
                  }
                  onTriggerProposal={() => void triggerRemoteTaskProposal()}
                  onAcceptProposal={(proposal) =>
                    void acceptTaskProposal(proposal)
                  }
                  onDismissProposal={(proposal) =>
                    void dismissTaskProposal(proposal)
                  }
                  hasWorkspace={hasSelectedWorkspace}
                  selectedWorkspaceId={selectedWorkspaceId}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

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
    </main>
  );
}

export function AppShell() {
  return (
    <WorkspaceSelectionProvider>
      <WorkspaceDesktopProvider>
        <AppShellContent />
      </WorkspaceDesktopProvider>
    </WorkspaceSelectionProvider>
  );
}
