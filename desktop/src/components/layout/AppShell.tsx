import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  ChevronRight,
  Clock3,
  FolderOpen,
  Loader2,
  LockKeyhole,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import { LeftNavigationRail, type LeftRailItem } from "@/components/layout/LeftNavigationRail";
import {
  OperationsDrawer,
  type OperationsDrawerTab,
  type OperationsRunningEntry,
  type OperationsOutputEntry
} from "@/components/layout/OperationsDrawer";
import { SettingsDialog } from "@/components/layout/SettingsDialog";
import { TopTabsBar } from "@/components/layout/TopTabsBar";
import { AutomationsPane } from "@/components/panes/AutomationsPane";
import { AppSurfacePane } from "@/components/panes/AppSurfacePane";
import { BrowserPane } from "@/components/panes/BrowserPane";
import {
  ChatPane,
  type ManagedChatSessionObservedPayload,
  type ManagedChatSessionRuntime,
  type ManagedQueueSessionInputPayload
} from "@/components/panes/ChatPane";
import { FileExplorerPane } from "@/components/panes/FileExplorerPane";
import { InternalSurfacePane } from "@/components/panes/InternalSurfacePane";
import { OnboardingPane } from "@/components/panes/OnboardingPane";
import { SkillsPane } from "@/components/panes/SkillsPane";
import { UpdateReminder } from "@/components/ui/UpdateReminder";
import { preferredSessionId } from "@/lib/sessionRouting";
import { getWorkspaceAppDefinition, inferInstalledWorkspaceAppIdFromText } from "@/lib/workspaceApps";
import { useWorkspaceDesktop, WorkspaceDesktopProvider } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection, WorkspaceSelectionProvider } from "@/lib/workspaceSelection";

const THEME_STORAGE_KEY = "holaboss-theme-v1";
const OPERATIONS_DRAWER_OPEN_STORAGE_KEY = "holaboss-operations-drawer-open-v1";
const OPERATIONS_DRAWER_TAB_STORAGE_KEY = "holaboss-operations-drawer-tab-v1";
const FILES_PANE_WIDTH_STORAGE_KEY = "holaboss-files-pane-width-v1";
const BROWSER_PANE_WIDTH_STORAGE_KEY = "holaboss-browser-pane-width-v1";
const SPACE_VISIBILITY_STORAGE_KEY = "holaboss-space-visibility-v1";
const THEMES = ["holaboss", "emerald", "cobalt", "ember", "glacier", "mono", "claude", "slate", "paper", "graphite"] as const;
const MIN_FILES_PANE_WIDTH = 168;
const MIN_BROWSER_PANE_WIDTH = 200;
const MAX_UTILITY_PANE_WIDTH = 720;
const LEGACY_DEFAULT_FILES_PANE_WIDTH = 420;
const PREVIOUS_DEFAULT_FILES_PANE_WIDTH = 200;
const DEFAULT_FILES_PANE_WIDTH = 176;
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
  browser: true
};

export type AppTheme = (typeof THEMES)[number];

function isAppTheme(value: string): value is AppTheme {
  return THEMES.includes(value as AppTheme);
}

function isSettingsPaneSection(value: string): value is UiSettingsPaneSection {
  return value === "account" || value === "settings" || value === "about";
}

type AgentView =
  | { type: "chat" }
  | { type: "app"; appId: string; resourceId?: string | null; view?: string | null }
  | {
      type: "internal";
      surface: "document" | "preview" | "file" | "event";
      resourceId?: string | null;
      htmlContent?: string | null;
    };

type ManagedSessionRuntimeState = ManagedChatSessionRuntime & {
  streamId: string | null;
};

function managedSessionKey(workspaceId: string, sessionId: string) {
  return `${workspaceId}:${sessionId}`;
}

function normalizeRuntimeStatus(value: string | null | undefined) {
  return (value || "").trim().toUpperCase();
}

function runtimeErrorDetail(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === "object") {
    const payload = value as Record<string, unknown>;
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  }
  return "";
}

function normalizeSessionOutputEvent(
  payload: HolabossSessionStreamEventPayload
): SessionOutputEventPayload | null {
  if (payload.type !== "event" || !payload.event || !payload.event.data || typeof payload.event.data !== "object") {
    return null;
  }
  const data = payload.event.data as Record<string, unknown>;
  const workspaceId = typeof data.workspace_id === "string" ? data.workspace_id.trim() : "";
  const sessionId = typeof data.session_id === "string" ? data.session_id.trim() : "";
  const inputId = typeof data.input_id === "string" ? data.input_id.trim() : "";
  const eventType = typeof data.event_type === "string" ? data.event_type.trim() : "";
  const sequence = typeof data.sequence === "number" && Number.isFinite(data.sequence) ? data.sequence : 0;
  const eventId =
    typeof data.id === "number" && Number.isFinite(data.id)
      ? data.id
      : typeof payload.event.id === "string" && /^\d+$/.test(payload.event.id.trim())
        ? Number.parseInt(payload.event.id, 10)
      : Number.NaN;
  const createdAt =
    typeof data.created_at === "string" && data.created_at.trim()
      ? data.created_at.trim()
      : typeof data.timestamp === "string" && data.timestamp.trim()
        ? data.timestamp.trim()
        : new Date().toISOString();
  if (!sessionId || !eventType || !Number.isFinite(eventId)) {
    return null;
  }
  return {
    id: eventId,
    workspace_id: workspaceId,
    session_id: sessionId,
    input_id: inputId,
    sequence,
    event_type: eventType,
    payload:
      data.payload && typeof data.payload === "object" && !Array.isArray(data.payload)
        ? (data.payload as Record<string, unknown>)
        : {},
    created_at: createdAt
  };
}

function mergeSessionOutputEvents(
  existing: SessionOutputEventPayload[],
  incoming: SessionOutputEventPayload[]
): SessionOutputEventPayload[] {
  if (incoming.length === 0) {
    return existing;
  }
  const byId = new Map<number, SessionOutputEventPayload>();
  for (const event of existing) {
    byId.set(event.id, event);
  }
  for (const event of incoming) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values()).sort((left, right) => left.sequence - right.sequence || left.id - right.id);
}

function loadSpaceVisibility(): SpaceVisibilityState {
  return DEFAULT_SPACE_VISIBILITY;
}

function minUtilityPaneWidth(paneId: UtilityPaneId): number {
  return paneId === "files" ? MIN_FILES_PANE_WIDTH : MIN_BROWSER_PANE_WIDTH;
}

function clampStoredUtilityPaneWidth(paneId: UtilityPaneId, width: number): number {
  return Math.max(minUtilityPaneWidth(paneId), Math.min(width, MAX_UTILITY_PANE_WIDTH));
}

function loadFilesPaneWidth(): number {
  try {
    const raw = localStorage.getItem(FILES_PANE_WIDTH_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      if (parsed === LEGACY_DEFAULT_FILES_PANE_WIDTH || parsed === PREVIOUS_DEFAULT_FILES_PANE_WIDTH) {
        return DEFAULT_FILES_PANE_WIDTH;
      }
      return clampStoredUtilityPaneWidth("files", parsed);
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
      return clampStoredUtilityPaneWidth("browser", parsed);
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

  return "holaboss";
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
  rightPaneId: SpaceComponentId
): { leftPaneId: SpaceComponentId; rightPaneId: SpaceComponentId; label: string } {
  if (leftPaneId === "agent") {
    return {
      leftPaneId,
      rightPaneId,
      label: `Resize ${spaceComponentLabel(rightPaneId).toLowerCase()} pane`
    };
  }
  if (rightPaneId === "agent") {
    return {
      leftPaneId,
      rightPaneId,
      label: `Resize ${spaceComponentLabel(leftPaneId).toLowerCase()} pane`
    };
  }
  return {
    leftPaneId,
    rightPaneId,
    label: `Resize ${spaceComponentLabel(leftPaneId).toLowerCase()} and ${spaceComponentLabel(rightPaneId).toLowerCase()} panes`
  };
}

function normalizeErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : "Request failed.";
  const normalized = message.trim().toLowerCase();
  if (normalized === "aborted" || normalized.includes("stream aborted") || normalized.includes("aborterror")) {
    return "App is still starting up. Try again in a moment.";
  }
  return message;
}

function inferInternalSurfaceFromOutputType(outputType: string): "document" | "preview" | "file" | "event" {
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
  if (normalized === "completed" || normalized === "ready" || normalized === "active") {
    return "success";
  }
  return "info";
}

function runtimeOutputToEntry(
  output: WorkspaceOutputRecordPayload,
  installedAppIds: Set<string>
): OperationsOutputEntry {
  const moduleId = (output.module_id || "").trim().toLowerCase();
  const title = output.title.trim() || output.output_type.trim() || "Workspace output";
  const detailParts = [
    output.status ? `Status: ${output.status}` : "",
    output.file_path ? `File: ${output.file_path}` : "",
    output.platform ? `Platform: ${output.platform}` : ""
  ].filter(Boolean);

  return {
    id: `runtime-output:${output.id}`,
    title,
    detail: detailParts.join(" | ") || "Runtime output generated for this workspace.",
    createdAt: output.created_at,
    tone: runtimeOutputTone(output.status),
    sessionId: output.session_id,
    renderer:
      moduleId && installedAppIds.has(moduleId)
        ? {
            type: "app",
            appId: moduleId,
            resourceId: output.module_resource_id || output.artifact_id || output.id,
            view: output.output_type || "home"
          }
        : {
            type: "internal",
            surface: inferInternalSurfaceFromOutputType(output.output_type),
            resourceId: output.file_path || output.artifact_id || output.id,
            htmlContent: output.html_content
          }
  };
}

function FirstWorkspacePane() {
  const authButtonRef = useRef<HTMLButtonElement | null>(null);
  const {
    templateSourceMode,
    setTemplateSourceMode,
    createHarnessOptions,
    selectedCreateHarness,
    setSelectedCreateHarness,
    selectedTemplateFolder,
    marketplaceTemplates,
    selectedMarketplaceTemplate,
    selectMarketplaceTemplate,
    newWorkspaceName,
    setNewWorkspaceName,
    isCreatingWorkspace,
    isLoadingMarketplaceTemplates,
    canUseMarketplaceTemplates,
    marketplaceTemplatesError,
    workspaceErrorMessage,
    chooseTemplateFolder,
    createWorkspace
  } = useWorkspaceDesktop();
  const selectedCreateHarnessOption =
    createHarnessOptions.find((option) => option.id === selectedCreateHarness) ?? createHarnessOptions[0];
  const sourceLabel =
    templateSourceMode === "marketplace"
      ? "Marketplace template"
      : templateSourceMode === "empty_onboarding"
        ? "Empty onboarding workspace"
      : templateSourceMode === "empty"
        ? "Empty workspace"
        : "Local template";
  const sourceDescription =
    templateSourceMode === "marketplace"
      ? marketplaceTemplatesError ||
        selectedMarketplaceTemplate?.description ||
        (canUseMarketplaceTemplates
          ? "Choose a curated starter."
          : "Sign in to use curated starters.")
      : templateSourceMode === "empty_onboarding"
        ? "Create a minimal workspace shell plus a starter ONBOARD.md for onboarding flow testing."
      : templateSourceMode === "empty"
        ? "Create the smallest valid workspace shell."
        : selectedTemplateFolder?.description ||
          "Use an existing folder on disk.";
  const sourceChoiceDetail =
    templateSourceMode === "marketplace"
      ? canUseMarketplaceTemplates
        ? selectedMarketplaceTemplate?.name || `${marketplaceTemplates.length} templates available`
        : "Sign in required"
      : templateSourceMode === "empty_onboarding"
        ? "Blank scaffold + onboarding guide"
      : templateSourceMode === "empty"
        ? "Blank scaffold"
        : selectedTemplateFolder?.templateName || selectedTemplateFolder?.rootPath || "Choose local folder";

  const openAuthPopup = () => {
    if (!authButtonRef.current) {
      return;
    }
    const rect = authButtonRef.current.getBoundingClientRect();
    void window.electronAPI.auth.showPopup({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    });
  };

  const createDisabled =
    isCreatingWorkspace ||
    !newWorkspaceName.trim() ||
    (templateSourceMode === "marketplace"
      ? !canUseMarketplaceTemplates || !selectedMarketplaceTemplate || selectedMarketplaceTemplate.is_coming_soon
      : templateSourceMode === "local"
        ? !selectedTemplateFolder?.rootPath
        : false);

  const handleCreateWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createWorkspace();
  };

  const creatingViaMarketplaceSandbox =
    templateSourceMode === "marketplace" && canUseMarketplaceTemplates;
  const createTitle = creatingViaMarketplaceSandbox
    ? "Launching sandbox..."
    : "Preparing local workspace...";
  const createDetail = creatingViaMarketplaceSandbox
    ? "Holaboss is starting a fresh sandbox first. Workspace setup continues as soon as the sandbox is ready."
    : "Holaboss is preparing the local runtime and importing your template.";
  const createSteps = creatingViaMarketplaceSandbox
    ? ["Launching sandbox", "Configuring workspace", "Opening desktop"]
    : ["Preparing local runtime", "Importing template", "Opening workspace"];
  if (isCreatingWorkspace) {
    return (
      <section className="theme-shell relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[var(--theme-radius-card)] border border-panel-border/45 px-6 py-10 shadow-card">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(247,90,84,0.08),transparent_36%),radial-gradient(circle_at_82%_14%,rgba(233,117,109,0.1),transparent_34%)]" />
        <div className="theme-subtle-surface relative w-full max-w-xl rounded-[26px] border border-panel-border/45 px-6 py-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-neon-green/30 bg-neon-green/10 text-neon-green">
            <Loader2 size={22} className="animate-spin" />
          </div>
          <h2 className="mt-5 text-[30px] font-semibold tracking-[-0.04em] text-text-main">{createTitle}</h2>
          <p className="mt-3 text-[14px] leading-7 text-text-muted/84">
            {createDetail}
          </p>
          <div className="theme-control-surface mt-7 overflow-hidden rounded-full border border-panel-border/45 p-1">
            <div className="h-2 rounded-full bg-[linear-gradient(90deg,rgba(247,90,84,0.56),rgba(233,117,109,0.72),rgba(247,170,126,0.78))] animate-pulse" />
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.24em] text-text-dim/80">
            <span className="h-1.5 w-1.5 rounded-full bg-neon-green/70" />
            <span>{createSteps[0]}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-neon-green/55" />
            <span>{createSteps[1]}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-neon-green/40" />
            <span>{createSteps[2]}</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(247,90,84,0.08),transparent_28%),radial-gradient(circle_at_86%_14%,rgba(233,117,109,0.08),transparent_30%)]" />
      <div className="relative flex w-full max-w-[1080px] flex-1 items-center justify-center">
        <div className="theme-shell mx-auto w-full rounded-[var(--theme-radius-card)] border border-panel-border/45 px-6 py-8 shadow-card sm:px-8 sm:py-9 lg:px-12 lg:py-10">
          <div className="max-w-3xl">
            <div className="text-[11px] uppercase tracking-[0.24em] text-text-dim/78">New workspace</div>
            <h1 className="mt-3 text-[34px] font-semibold tracking-[-0.05em] text-text-main sm:text-[42px]">
              Create a workspace
            </h1>
            <p className="mt-3 text-[14px] leading-7 text-text-muted/82 sm:text-[15px]">
              Pick a source, name it, and open it directly in the desktop.
            </p>
          </div>

          <form
            onSubmit={handleCreateWorkspace}
            className="theme-subtle-surface mt-8 rounded-[28px] border border-panel-border/45 p-5 sm:p-6"
          >
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-text-dim/76">Source</div>
                <div className="mt-2 text-[22px] font-medium tracking-[-0.03em] text-text-main">
                  Choose how it starts
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-1">
                  <FirstWorkspaceChoiceCard
                    title="Local Template"
                    description="Use a folder already on this machine."
                    detail={selectedTemplateFolder?.templateName || selectedTemplateFolder?.rootPath || "Choose local folder"}
                    icon={<FolderOpen size={18} />}
                    active={templateSourceMode === "local"}
                    onClick={() => {
                      setTemplateSourceMode("local");
                    }}
                  />
                  <FirstWorkspaceChoiceCard
                    title="Marketplace Template"
                    description="Start from a curated Holaboss starter."
                    detail={
                      canUseMarketplaceTemplates
                        ? selectedMarketplaceTemplate?.name || `${marketplaceTemplates.length} templates available`
                        : "Sign in required"
                    }
                    icon={<Sparkles size={18} />}
                    active={templateSourceMode === "marketplace"}
                    badge={!canUseMarketplaceTemplates ? "Login Required" : undefined}
                    onClick={() => {
                      setTemplateSourceMode("marketplace");
                    }}
                  />
                  <FirstWorkspaceChoiceCard
                    title="Empty Workspace"
                    description="Create the smallest valid scaffold."
                    detail="workspace.yaml + AGENTS.md + skills/"
                    icon={<span className="text-[18px] leading-none">+</span>}
                    active={templateSourceMode === "empty"}
                    onClick={() => {
                      setTemplateSourceMode("empty");
                    }}
                  />
                  <FirstWorkspaceChoiceCard
                    title="Empty + Onboarding"
                    description="Create a blank workspace with ONBOARD.md included."
                    detail="workspace.yaml + AGENTS.md + skills/ + ONBOARD.md"
                    icon={<Sparkles size={18} />}
                    active={templateSourceMode === "empty_onboarding"}
                    onClick={() => {
                      setTemplateSourceMode("empty_onboarding");
                    }}
                  />
                </div>
              </div>

              <div className="rounded-[24px] border border-panel-border/40 bg-black/8 p-4 sm:p-5">
                <div className="text-[11px] uppercase tracking-[0.22em] text-text-dim/78">Workspace</div>
                <div className="mt-2 text-[22px] font-medium tracking-[-0.03em] text-text-main">
                  Name and harness
                </div>
                <div className="mt-4 grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-[11px] uppercase tracking-[0.22em] text-text-dim/78">Workspace name</span>
                    <input
                      value={newWorkspaceName}
                      onChange={(event) => setNewWorkspaceName(event.target.value)}
                      placeholder="My first workspace"
                      className="theme-control-surface h-12 rounded-[18px] border border-panel-border/45 px-4 text-[14px] text-text-main outline-none placeholder:text-text-dim/50"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-[11px] uppercase tracking-[0.22em] text-text-dim/78">Harness</span>
                    <select
                      value={selectedCreateHarness}
                      onChange={(event) => setSelectedCreateHarness(event.target.value)}
                      className="theme-control-surface h-12 rounded-[18px] border border-panel-border/45 px-4 text-[14px] text-text-main outline-none"
                    >
                      {createHarnessOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-[12px] leading-6 text-text-muted/74">
                      {selectedCreateHarnessOption?.description || "Default harness with backend bootstrapping and structured output support."}
                    </span>
                  </label>

                  <div className="rounded-[18px] border border-panel-border/35 bg-panel-bg/18 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">Selection</div>
                    <div className="mt-2 text-[14px] font-medium text-text-main">{sourceLabel}</div>
                    <div className="mt-1 text-[12px] leading-6 text-text-muted/76">{sourceChoiceDetail}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-[24px] border border-panel-border/40 bg-black/10 p-4 sm:p-5">
              <div className="border-b border-panel-border/30 pb-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-text-dim/76">Source details</div>
                  <div className="mt-2 flex items-center gap-2 text-[18px] font-medium tracking-[-0.03em] text-text-main">
                    {templateSourceMode === "marketplace" ? (
                      <Sparkles size={16} className="text-[rgba(206,92,84,0.9)]" />
                    ) : templateSourceMode === "empty_onboarding" ? (
                      <Sparkles size={16} className="text-[rgba(206,92,84,0.9)]" />
                    ) : templateSourceMode === "empty" ? (
                      <span className="text-[18px] leading-none text-[rgba(206,92,84,0.9)]">+</span>
                    ) : (
                      <FolderOpen size={16} className="text-[rgba(206,92,84,0.9)]" />
                    )}
                    <span>{sourceLabel}</span>
                  </div>
                  <div className="mt-2 max-w-3xl text-[12px] leading-6 text-text-muted/76">{sourceDescription}</div>
                </div>
              </div>

              <div className="mt-4">
                {templateSourceMode === "marketplace" ? (
                  canUseMarketplaceTemplates ? (
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.9fr)]">
                      <label className="grid gap-2">
                        <span className="text-[11px] uppercase tracking-[0.22em] text-text-dim/78">Marketplace template</span>
                        <select
                          value={selectedMarketplaceTemplate?.name || ""}
                          onChange={(event) => selectMarketplaceTemplate(event.target.value)}
                          disabled={isLoadingMarketplaceTemplates || marketplaceTemplates.length === 0}
                          className="theme-control-surface h-12 rounded-[18px] border border-panel-border/45 px-4 text-[14px] text-text-main outline-none disabled:text-text-dim/50"
                        >
                          {isLoadingMarketplaceTemplates ? (
                            <option value="">Loading templates...</option>
                          ) : marketplaceTemplates.length ? (
                            marketplaceTemplates.map((template) => (
                              <option key={template.name} value={template.name} disabled={template.is_coming_soon}>
                                {template.is_coming_soon ? `${template.name} (Coming soon)` : template.name}
                              </option>
                            ))
                          ) : (
                            <option value="">No marketplace templates available</option>
                          )}
                        </select>
                      </label>

                      <div className="rounded-[18px] border border-[rgba(247,90,84,0.16)] bg-[rgba(247,90,84,0.04)] px-4 py-3">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">Preview</div>
                        <div className="mt-2 text-[13px] font-medium text-text-main">
                          {selectedMarketplaceTemplate?.name || "Choose a marketplace template"}
                        </div>
                        <div className="mt-2 text-[12px] leading-6 text-text-muted/78">
                          {marketplaceTemplatesError ||
                            selectedMarketplaceTemplate?.description ||
                            "Curated starter kits are ready to use."}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[20px] border border-[rgba(247,90,84,0.22)] bg-[rgba(247,90,84,0.05)] p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="max-w-2xl">
                          <div className="text-[13px] font-medium text-text-main">Sign in to use marketplace templates</div>
                          <div className="mt-1 text-[12px] leading-6 text-text-muted/78">
                            Local folders and empty workspaces still work without an account.
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            ref={authButtonRef}
                            type="button"
                            onClick={openAuthPopup}
                            className="inline-flex h-10 items-center justify-center rounded-[14px] border border-[rgba(247,90,84,0.34)] bg-[rgba(247,90,84,0.9)] px-4 text-[12px] font-medium text-white transition hover:bg-[rgba(226,79,74,0.94)]"
                          >
                            Sign in
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                ) : templateSourceMode === "empty" || templateSourceMode === "empty_onboarding" ? (
                  <div className="rounded-[18px] border border-panel-border/35 bg-panel-bg/18 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">Scaffold</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        "workspace.yaml",
                        "AGENTS.md",
                        "skills/",
                        ...(templateSourceMode === "empty_onboarding" ? ["ONBOARD.md"] : [])
                      ].map((item) => (
                        <span
                          key={item}
                          className="rounded-full border border-panel-border/35 bg-black/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-text-dim/74"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                    {templateSourceMode === "empty_onboarding" ? (
                      <div className="mt-3 text-[12px] leading-6 text-text-muted/78">
                        Includes a starter onboarding guide so the workspace enters onboarding immediately after creation.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.9fr)]">
                    <div className="grid gap-2">
                      <span className="text-[11px] uppercase tracking-[0.22em] text-text-dim/78">Local template folder</span>
                      <button
                        type="button"
                        onClick={() => void chooseTemplateFolder()}
                        className="theme-control-surface flex h-12 items-center justify-between rounded-[18px] border border-panel-border/45 px-4 text-left text-[14px] text-text-main transition hover:border-[rgba(247,90,84,0.3)]"
                      >
                        <span className="truncate">
                          {selectedTemplateFolder?.templateName || selectedTemplateFolder?.rootPath || "Choose local folder"}
                        </span>
                        <ArrowRight size={16} className="shrink-0 text-text-dim/75" />
                      </button>
                    </div>

                    <div className="rounded-[18px] border border-panel-border/35 bg-panel-bg/18 px-4 py-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">Path</div>
                      <div className="mt-2 text-[12px] leading-6 text-text-muted/78">
                        {selectedTemplateFolder?.rootPath || "Choose a folder and Holaboss will use it as the source template for the new workspace."}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {workspaceErrorMessage ? (
              <div className="theme-chat-system-bubble mt-5 rounded-[18px] border px-4 py-3 text-[13px] leading-6">
                {workspaceErrorMessage}
              </div>
            ) : null}

            <div className="mt-6 flex flex-col gap-4 border-t border-panel-border/35 pt-5 md:flex-row md:items-center md:justify-end">
              <button
                type="submit"
                disabled={createDisabled}
                className="inline-flex h-12 items-center justify-center gap-3 rounded-[18px] border border-[rgba(247,90,84,0.38)] bg-[rgba(247,90,84,0.9)] px-5 text-[14px] font-medium text-white transition hover:bg-[rgba(226,79,74,0.94)] disabled:cursor-not-allowed disabled:border-panel-border/40 disabled:bg-transparent disabled:text-text-dim/50"
              >
                <span>Create Workspace</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

function FirstWorkspaceChoiceCard({
  title,
  description,
  detail,
  icon,
  active,
  badge,
  onClick
}: {
  title: string;
  description: string;
  detail: string;
  icon: ReactNode;
  active: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-[22px] border p-4 text-left transition-all duration-200 ${
        active
          ? "border-[rgba(247,90,84,0.32)] bg-[linear-gradient(145deg,rgba(247,90,84,0.1),rgba(255,255,255,0.03))] shadow-[0_10px_28px_rgba(25,33,53,0.08)]"
          : "border-panel-border/45 theme-control-surface hover:border-[rgba(247,90,84,0.24)] hover:bg-[var(--theme-hover-bg)]"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(247,90,84,0.12),transparent_36%)] opacity-70" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="theme-subtle-surface flex h-10 w-10 items-center justify-center rounded-[14px] border border-panel-border/45 text-text-main/88">
            {icon}
          </div>
          {badge ? (
            <span className="theme-subtle-surface inline-flex items-center gap-1 rounded-full border border-panel-border/45 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-text-dim/78">
              <LockKeyhole size={11} />
              <span>{badge}</span>
            </span>
          ) : null}
        </div>
        <div className="mt-4 text-[16px] font-medium tracking-[-0.02em] text-text-main">{title}</div>
        <div className="mt-1.5 text-[13px] leading-6 text-text-muted/82">{description}</div>
        <div className="mt-3 text-[11px] uppercase tracking-[0.14em] text-text-dim/72">{detail}</div>
      </div>
    </button>
  );
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
  const startupStages = ["Loading workspace records", "Restoring recent context", "Attaching desktop surfaces"] as const;

  return (
    <section className="relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(247,90,84,0.12),transparent_18%),radial-gradient(circle_at_50%_56%,rgba(247,170,126,0.08),transparent_24%)]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(247,90,84,0.08),transparent_62%)] blur-3xl" />

      <div className="relative flex w-full max-w-[560px] flex-col items-center px-6 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-panel-border/35 bg-white/45 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-text-dim/74 backdrop-blur">
          <Sparkles size={12} className="text-[rgba(206,92,84,0.88)]" />
          <span>Desktop startup</span>
        </div>

        <div className="mt-6 flex h-14 w-14 items-center justify-center rounded-full border border-[rgba(247,90,84,0.22)] bg-[rgba(247,90,84,0.08)] text-[rgba(206,92,84,0.94)]">
          <Loader2 size={20} className="animate-spin" />
        </div>

        <div className="mt-6 text-[34px] font-semibold tracking-[-0.05em] text-text-main sm:text-[40px]">Preparing the desktop shell</div>
        <div className="mt-3 max-w-[520px] text-[14px] leading-7 text-text-muted/82 sm:text-[15px]">
          Restoring workspace state so the desktop opens in the last ready-to-work context.
        </div>

        <div className="mt-8 w-full">
          <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-text-dim/74">
            <span>Loading workspace records</span>
            <span className="text-[rgba(206,92,84,0.92)]">In progress</span>
          </div>

          <div className="mt-3 overflow-hidden rounded-full bg-black/8 p-1">
            <div className="h-2 rounded-full bg-[linear-gradient(90deg,rgba(247,90,84,0.7),rgba(233,117,109,0.86),rgba(247,170,126,0.78))] animate-pulse" />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {startupStages.map((stage, index) => (
              <span
                key={stage}
                className={`rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] ${
                  index === 0
                    ? "border-[rgba(247,90,84,0.24)] bg-[rgba(247,90,84,0.08)] text-[rgba(206,92,84,0.94)]"
                    : "border-panel-border/35 bg-white/28 text-text-dim/72 backdrop-blur"
                }`}
              >
                {stage}
              </span>
            ))}
          </div>

          <div className="mt-6 text-[12px] leading-6 text-text-muted/74">
            This usually completes in a moment.
          </div>
        </div>
      </div>
    </section>
  );
}

function FocusPlaceholder({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(87,255,173,0.08),transparent_45%)]" />
      <div className="relative max-w-[520px] px-8 text-center">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neon-green/78">{eyebrow}</div>
        <div className="mt-3 text-[28px] font-semibold tracking-[-0.03em] text-text-main">{title}</div>
        <div className="mt-3 text-[13px] leading-7 text-text-muted/84">{description}</div>
      </div>
    </section>
  );
}

function WorkspaceStartupErrorPane({ message }: { message: string }) {
  return (
    <section className="theme-shell relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(247,90,84,0.12),transparent_32%),radial-gradient(circle_at_bottom,rgba(247,170,126,0.08),transparent_36%)]" />
      <div className="relative w-full max-w-[720px] px-6 py-8">
        <div className="theme-subtle-surface rounded-[30px] border border-[rgba(247,90,84,0.24)] p-6 shadow-card sm:p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(247,90,84,0.22)] bg-[rgba(247,90,84,0.08)] px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[rgba(206,92,84,0.92)]">
            <TriangleAlert size={12} />
            <span>Desktop startup blocked</span>
          </div>
          <div className="mt-6 text-[30px] font-semibold tracking-[-0.04em] text-text-main">The local runtime failed to start</div>
          <div className="mt-3 text-[14px] leading-7 text-text-muted/84">
            The desktop shell cannot finish restoring workspaces until the embedded runtime comes online.
          </div>
          <div className="mt-6 rounded-[20px] border border-[rgba(247,90,84,0.22)] bg-[rgba(247,90,84,0.06)] px-4 py-4 text-[13px] leading-7 text-text-main">
            {message}
          </div>
          <div className="mt-5 text-[12px] leading-6 text-text-muted/76">
            Check `runtime.log` in the Electron userData directory and confirm the required desktop runtime configuration is present.
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceOnboardingTakeover({
  onOutputsChanged,
  focusRequestKey
}: {
  onOutputsChanged: () => void;
  focusRequestKey: number;
}) {
  return (
    <section className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_16%,rgba(247,90,84,0.1),transparent_28%),radial-gradient(circle_at_88%_10%,rgba(247,170,126,0.08),transparent_24%),radial-gradient(circle_at_50%_100%,rgba(247,90,84,0.06),transparent_34%)]" />
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <OnboardingPane onOutputsChanged={onOutputsChanged} focusRequestKey={focusRequestKey} />
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
    onboardingModeActive
  } =
    useWorkspaceDesktop();
  const [theme, setTheme] = useState<AppTheme>(loadTheme);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusPayload | null>(null);
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatusPayload | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsDialogSection, setSettingsDialogSection] = useState<UiSettingsPaneSection>("settings");
  const [activeLeftRailItem, setActiveLeftRailItem] = useState<LeftRailItem>("space");
  const [agentView, setAgentView] = useState<AgentView>({ type: "chat" });
  const [chatFocusRequestKey, setChatFocusRequestKey] = useState(1);
  const [chatSessionRequest, setChatSessionRequest] = useState<{
    workspaceId: string;
    sessionId: string;
    key: number;
  } | null>(null);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [spaceVisibility, setSpaceVisibility] = useState<SpaceVisibilityState>(loadSpaceVisibility);
  const [filesPaneWidth, setFilesPaneWidth] = useState(loadFilesPaneWidth);
  const [browserPaneWidth, setBrowserPaneWidth] = useState(loadBrowserPaneWidth);
  const [isUtilityPaneResizing, setIsUtilityPaneResizing] = useState(false);
  const [operationsDrawerOpen, setOperationsDrawerOpen] = useState(loadOperationsDrawerOpen);
  const [activeOperationsTab, setActiveOperationsTab] = useState<OperationsDrawerTab>(loadOperationsDrawerTab);
  const [taskProposals, setTaskProposals] = useState<TaskProposalRecordPayload[]>([]);
  const [isLoadingTaskProposals, setIsLoadingTaskProposals] = useState(false);
  const [isTriggeringTaskProposal, setIsTriggeringTaskProposal] = useState(false);
  const [taskProposalStatusMessage, setTaskProposalStatusMessage] = useState("");
  const [agentSessions, setAgentSessions] = useState<AgentSessionRecordPayload[]>([]);
  const [runtimeSessions, setRuntimeSessions] = useState<SessionRuntimeRecordPayload[]>([]);
  const [isLoadingRunningEntries, setIsLoadingRunningEntries] = useState(false);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [managedSessionRuntimes, setManagedSessionRuntimes] = useState<Record<string, ManagedSessionRuntimeState>>({});
  const [proposalAction, setProposalAction] = useState<{
    proposalId: string;
    action: "accept" | "dismiss";
  } | null>(null);
  const [outputEntries, setOutputEntries] = useState<OperationsOutputEntry[]>([]);
  const [runtimeOutputEntries, setRuntimeOutputEntries] = useState<OperationsOutputEntry[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const outputRefreshTimerRef = useRef<number | null>(null);
  const utilityPaneHostRef = useRef<HTMLDivElement | null>(null);
  const utilityPaneResizeStateRef = useRef<UtilityPaneResizeState | null>(null);
  const filesPaneWidthRef = useRef(filesPaneWidth);
  const browserPaneWidthRef = useRef(browserPaneWidth);
  const spaceVisibilityRef = useRef(spaceVisibility);
  const managedSessionRuntimesRef = useRef<Record<string, ManagedSessionRuntimeState>>({});
  const managedStreamSessionKeyRef = useRef<Map<string, string>>(new Map());
  const previousSelectedWorkspaceIdRef = useRef<string | null>(selectedWorkspaceId ?? null);

  filesPaneWidthRef.current = filesPaneWidth;
  browserPaneWidthRef.current = browserPaneWidth;
  spaceVisibilityRef.current = spaceVisibility;
  managedSessionRuntimesRef.current = managedSessionRuntimes;

  const clampUtilityPaneWidth = useCallback(
    (paneId: UtilityPaneId, width: number, options?: { filesWidth?: number; browserWidth?: number }) => {
      const hostWidth = utilityPaneHostRef.current?.getBoundingClientRect().width ?? 0;
      const effectiveFilesWidth = options?.filesWidth ?? filesPaneWidthRef.current;
      const effectiveBrowserWidth = options?.browserWidth ?? browserPaneWidthRef.current;
      const minPaneWidth = minUtilityPaneWidth(paneId);
      const visiblePaneIds = FIXED_SPACE_ORDER.filter((pane) => spaceVisibilityRef.current[pane]);
      const flexPaneId = visiblePaneIds.includes("agent") ? "agent" : visiblePaneIds[visiblePaneIds.length - 1] ?? null;
      const resizerCount = Math.max(0, visiblePaneIds.length - 1);
      const fixedOtherWidths = visiblePaneIds.reduce((total, visiblePaneId) => {
        if (visiblePaneId === paneId || visiblePaneId === flexPaneId || visiblePaneId === "agent") {
          return total;
        }
        return total + (visiblePaneId === "files" ? effectiveFilesWidth : effectiveBrowserWidth);
      }, 0);
      const minFlexibleWidth =
        flexPaneId === "agent" ? MIN_AGENT_CONTENT_WIDTH : minUtilityPaneWidth(flexPaneId as UtilityPaneId);
      const maxWidth =
        hostWidth > 0
          ? Math.min(
              MAX_UTILITY_PANE_WIDTH,
              Math.max(
                minPaneWidth,
                hostWidth - fixedOtherWidths - minFlexibleWidth - resizerCount * UTILITY_PANE_RESIZER_WIDTH
              )
            )
          : MAX_UTILITY_PANE_WIDTH;
      return Math.max(minPaneWidth, Math.min(width, maxWidth));
    },
    []
  );

  const clampPairedUtilityPaneWidths = useCallback(
    (leftPaneId: UtilityPaneId, rightPaneId: UtilityPaneId, leftWidth: number, rightWidth: number) => {
      const hostWidth = utilityPaneHostRef.current?.getBoundingClientRect().width ?? 0;
      const minLeftWidth = minUtilityPaneWidth(leftPaneId);
      const minRightWidth = minUtilityPaneWidth(rightPaneId);
      if (hostWidth <= 0) {
        return {
          leftWidth: Math.max(minLeftWidth, Math.min(leftWidth, MAX_UTILITY_PANE_WIDTH)),
          rightWidth: Math.max(minRightWidth, Math.min(rightWidth, MAX_UTILITY_PANE_WIDTH))
        };
      }

      const effectiveFilesWidth =
        leftPaneId === "files" ? leftWidth : rightPaneId === "files" ? rightWidth : filesPaneWidthRef.current;
      const effectiveBrowserWidth =
        leftPaneId === "browser" ? leftWidth : rightPaneId === "browser" ? rightWidth : browserPaneWidthRef.current;
      const visiblePaneIds = FIXED_SPACE_ORDER.filter((pane) => spaceVisibilityRef.current[pane]);
      const resizerCount = Math.max(0, visiblePaneIds.length - 1);
      const fixedOtherWidths = visiblePaneIds.reduce((total, visiblePaneId) => {
        if (visiblePaneId === "agent" || visiblePaneId === leftPaneId || visiblePaneId === rightPaneId) {
          return total;
        }
        return total + (visiblePaneId === "files" ? effectiveFilesWidth : effectiveBrowserWidth);
      }, 0);
      const maxCombinedWidth = Math.min(
        MAX_UTILITY_PANE_WIDTH * 2,
        Math.max(
          minLeftWidth + minRightWidth,
          hostWidth - fixedOtherWidths - MIN_AGENT_CONTENT_WIDTH - resizerCount * UTILITY_PANE_RESIZER_WIDTH
        )
      );
      const combinedWidth = Math.max(minLeftWidth + minRightWidth, Math.min(leftWidth + rightWidth, maxCombinedWidth));
      const nextLeftWidth = Math.max(
        minLeftWidth,
        Math.min(leftWidth, combinedWidth - minRightWidth)
      );
      return {
        leftWidth: nextLeftWidth,
        rightWidth: combinedWidth - nextLeftWidth
      };
    },
    []
  );

  const refreshRuntimeOutputs = useCallback(async () => {
    if (!selectedWorkspaceId || runtimeStatus?.status !== "running") {
      setRuntimeOutputEntries([]);
      return;
    }
    try {
      const response = await window.electronAPI.workspace.listOutputs(selectedWorkspaceId);
      const installedAppIds = new Set(installedApps.map((app) => app.id));
      setRuntimeOutputEntries(response.items.map((item) => runtimeOutputToEntry(item, installedAppIds)));
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
    const unsubscribe = window.electronAPI.workspace.onSessionStreamEvent((payload) => {
      if (payload.type !== "event") {
        return;
      }
      const data =
        payload.event?.data && typeof payload.event.data === "object" && !Array.isArray(payload.event.data)
          ? (payload.event.data as {
              event_type?: string;
              session_id?: string;
            })
          : null;
      const eventType = typeof data?.event_type === "string" ? data.event_type : payload.event?.event || "";
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
    });

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
      setSettingsDialogSection(isSettingsPaneSection(section) ? section : "settings");
      setSettingsDialogOpen(true);
      void window.electronAPI.auth.closePopup();
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    const unsubscribe = window.electronAPI.workbench.onOpenBrowser((payload) => {
      if (payload.workspaceId && payload.workspaceId !== selectedWorkspaceId) {
        return;
      }
      setActiveLeftRailItem("space");
      setSpaceVisibility((previous) => ({
        ...previous,
        browser: true
      }));
    });

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
    localStorage.setItem(OPERATIONS_DRAWER_OPEN_STORAGE_KEY, operationsDrawerOpen ? "1" : "0");
  }, [operationsDrawerOpen]);

  useEffect(() => {
    localStorage.setItem(OPERATIONS_DRAWER_TAB_STORAGE_KEY, activeOperationsTab);
  }, [activeOperationsTab]);

  useEffect(() => {
    localStorage.setItem(FILES_PANE_WIDTH_STORAGE_KEY, String(filesPaneWidth));
  }, [filesPaneWidth]);

  useEffect(() => {
    localStorage.setItem(BROWSER_PANE_WIDTH_STORAGE_KEY, String(browserPaneWidth));
  }, [browserPaneWidth]);

  useEffect(() => {
    localStorage.setItem(SPACE_VISIBILITY_STORAGE_KEY, JSON.stringify(spaceVisibility));
  }, [spaceVisibility]);

  useEffect(() => {
    if (spaceVisibility.agent) {
      return;
    }
    setSpaceVisibility((previous) => ({
      ...previous,
      agent: true
    }));
  }, [spaceVisibility.agent]);

  const appendOutputEntry = (entry: Omit<OperationsOutputEntry, "id" | "createdAt">) => {
    const nextEntry: OperationsOutputEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...entry
    };
    setOutputEntries((previous) => [nextEntry, ...previous].slice(0, 16));
    setSelectedOutputId(nextEntry.id);
  };

  const refreshRunningEntries = useCallback(async () => {
    if (!selectedWorkspaceId) {
      setAgentSessions([]);
      setRuntimeSessions([]);
      setIsLoadingRunningEntries(false);
      return;
    }

    setIsLoadingRunningEntries(true);
    try {
      const [sessionsResponse, runtimeStatesResponse] = await Promise.all([
        window.electronAPI.workspace.listAgentSessions(selectedWorkspaceId),
        window.electronAPI.workspace.listRuntimeStates(selectedWorkspaceId)
      ]);
      setAgentSessions(sessionsResponse.items);
      setRuntimeSessions(runtimeStatesResponse.items);
    } finally {
      setIsLoadingRunningEntries(false);
    }
  }, [selectedWorkspaceId]);

  const updateManagedSessionRuntime = useCallback(
    (
      key: string,
      updater: (current: ManagedSessionRuntimeState | null) => ManagedSessionRuntimeState | null
    ) => {
      setManagedSessionRuntimes((previous) => {
        const current = previous[key] ?? null;
        const next = updater(current);
        if (!next) {
          if (!(key in previous)) {
            return previous;
          }
          const trimmed = { ...previous };
          delete trimmed[key];
          return trimmed;
        }
        return {
          ...previous,
          [key]: next
        };
      });
    },
    []
  );

  const closeManagedSessionStream = useCallback(
    async (key: string, reason: string) => {
      const current = managedSessionRuntimesRef.current[key];
      const streamId = current?.streamId;
      if (!streamId) {
        return;
      }
      managedStreamSessionKeyRef.current.delete(streamId);
      await window.electronAPI.workspace.closeSessionOutputStream(streamId, reason).catch(() => undefined);
      updateManagedSessionRuntime(key, (snapshot) => (snapshot && snapshot.streamId === streamId ? { ...snapshot, streamId: null } : snapshot));
    },
    [updateManagedSessionRuntime]
  );

  const openManagedSessionStream = useCallback(
    async (options: {
      workspaceId: string;
      sessionId: string;
      inputId: string;
      includeHistory?: boolean;
    }) => {
      const key = managedSessionKey(options.workspaceId, options.sessionId);
      const current = managedSessionRuntimesRef.current[key];
      if (current?.streamId && current.currentInputId === options.inputId) {
        return current.streamId;
      }
      if (current?.streamId) {
        await closeManagedSessionStream(key, "managed_stream_reopen");
      }
      const handle = await window.electronAPI.workspace.openSessionOutputStream({
        sessionId: options.sessionId,
        workspaceId: options.workspaceId,
        inputId: options.inputId,
        includeHistory: options.includeHistory ?? true,
        stopOnTerminal: true
      });
      managedStreamSessionKeyRef.current.set(handle.streamId, key);
      updateManagedSessionRuntime(key, (snapshot) =>
        snapshot
          ? {
              ...snapshot,
              streamId: handle.streamId
            }
          : {
              workspaceId: options.workspaceId,
              sessionId: options.sessionId,
              runtimeStatus: "QUEUED",
              currentInputId: options.inputId,
              errorMessage: "",
              events: [],
              historyVersion: 0,
              awaitingHistoryHydration: false,
              streamId: handle.streamId
            }
      );
      return handle.streamId;
    },
    [closeManagedSessionStream, updateManagedSessionRuntime]
  );

  const syncManagedSessionRuntime = useCallback(
    async (options: {
      workspaceId: string;
      sessionId: string;
      runtimeStatus: string;
      currentInputId: string | null;
      errorMessage?: string;
      currentInputEvents?: SessionOutputEventPayload[];
    }) => {
      const key = managedSessionKey(options.workspaceId, options.sessionId);
      const current = managedSessionRuntimesRef.current[key] ?? null;
      const normalizedStatus = normalizeRuntimeStatus(options.runtimeStatus);
      const nextInputId = (options.currentInputId || "").trim() || null;
      const inputChanged = current?.currentInputId !== nextInputId;
      const terminalTransition =
        inputChanged &&
        !nextInputId &&
        Boolean(current?.currentInputId) &&
        (normalizedStatus === "IDLE" || normalizedStatus === "ERROR");
      if (inputChanged && current?.streamId) {
        await closeManagedSessionStream(key, "managed_input_changed");
      }

      const nextEvents =
        inputChanged
          ? terminalTransition
            ? current?.events ?? options.currentInputEvents ?? []
            : options.currentInputEvents ?? []
          : mergeSessionOutputEvents(current?.events ?? [], options.currentInputEvents ?? []);
      const nextErrorMessage =
        normalizedStatus === "ERROR"
          ? options.errorMessage || current?.errorMessage || ""
          : terminalTransition
            ? current?.errorMessage || ""
          : inputChanged
            ? ""
            : current?.errorMessage || "";

      updateManagedSessionRuntime(key, (snapshot) => {
        const currentHistoryVersion = snapshot?.historyVersion ?? 0;
        const alreadyAwaitingHydration = snapshot?.awaitingHistoryHydration ?? false;
        return {
          workspaceId: options.workspaceId,
          sessionId: options.sessionId,
          runtimeStatus: normalizedStatus,
          currentInputId: nextInputId,
          errorMessage: nextErrorMessage,
          events: nextEvents,
          historyVersion: terminalTransition && !alreadyAwaitingHydration ? currentHistoryVersion + 1 : currentHistoryVersion,
          awaitingHistoryHydration: terminalTransition ? true : inputChanged ? false : alreadyAwaitingHydration,
          streamId: inputChanged ? null : snapshot?.streamId ?? null
        };
      });

      if ((normalizedStatus === "BUSY" || normalizedStatus === "QUEUED") && nextInputId) {
        await openManagedSessionStream({
          workspaceId: options.workspaceId,
          sessionId: options.sessionId,
          inputId: nextInputId,
          includeHistory: nextEvents.length === 0
        }).catch(() => undefined);
      } else if (normalizedStatus !== "BUSY" && normalizedStatus !== "QUEUED" && current?.streamId) {
        await closeManagedSessionStream(key, `managed_status_${normalizedStatus.toLowerCase() || "idle"}`);
      }
    },
    [closeManagedSessionStream, openManagedSessionStream, updateManagedSessionRuntime]
  );

  const observeManagedSession = useCallback(
    (payload: ManagedChatSessionObservedPayload) => {
      void syncManagedSessionRuntime({
        workspaceId: payload.workspaceId,
        sessionId: payload.sessionId,
        runtimeStatus: payload.runtimeStatus,
        currentInputId: payload.currentInputId,
        currentInputEvents: payload.currentInputEvents
      });
    },
    [syncManagedSessionRuntime]
  );

  const acknowledgeManagedHistoryHydration = useCallback(
    (payload: { workspaceId: string; sessionId: string; historyVersion: number }) => {
      const key = managedSessionKey(payload.workspaceId, payload.sessionId);
      updateManagedSessionRuntime(key, (snapshot) => {
        if (!snapshot || !snapshot.awaitingHistoryHydration || snapshot.historyVersion !== payload.historyVersion) {
          return snapshot;
        }
        const runtimeStatus = normalizeRuntimeStatus(snapshot.runtimeStatus);
        if (runtimeStatus === "BUSY" || runtimeStatus === "QUEUED" || runtimeStatus === "WAITING_USER") {
          return {
            ...snapshot,
            awaitingHistoryHydration: false
          };
        }
        return {
          ...snapshot,
          currentInputId: null,
          errorMessage: "",
          events: [],
          awaitingHistoryHydration: false
        };
      });
    },
    [updateManagedSessionRuntime]
  );

  const queueManagedSessionInput = useCallback(
    async (payload: ManagedQueueSessionInputPayload) => {
      const queued = await window.electronAPI.workspace.queueSessionInput({
        text: payload.text,
        workspace_id: payload.workspaceId,
        image_urls: null,
        attachments: payload.attachments,
        session_id: payload.sessionId,
        priority: 0,
        model: payload.model
      });
      const key = managedSessionKey(payload.workspaceId, queued.session_id);
      updateManagedSessionRuntime(key, (snapshot) => ({
        workspaceId: payload.workspaceId,
        sessionId: queued.session_id,
        runtimeStatus: "QUEUED",
        currentInputId: queued.input_id,
        errorMessage: "",
        events: [],
        historyVersion: snapshot?.historyVersion ?? 0,
        awaitingHistoryHydration: false,
        streamId: snapshot?.streamId ?? null
      }));
      await openManagedSessionStream({
        workspaceId: payload.workspaceId,
        sessionId: queued.session_id,
        inputId: queued.input_id,
        includeHistory: true
      }).catch(() => undefined);
      return queued;
    },
    [openManagedSessionStream, updateManagedSessionRuntime]
  );

  async function refreshTaskProposals(options?: { logErrors?: boolean }) {
    if (!selectedWorkspaceId || !selectedWorkspace) {
      setTaskProposals([]);
      setTaskProposalStatusMessage("");
      return;
    }

    setTaskProposalStatusMessage("");
    setIsLoadingTaskProposals(true);
    try {
      const response = await window.electronAPI.workspace.listTaskProposals(selectedWorkspace.id);
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
            surface: "event"
          }
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
      const response = await window.electronAPI.workspace.enqueueRemoteDemoTaskProposal({
        workspace_id: selectedWorkspaceId
      });
      const detail = `Remote proactive job queued. Pending cloud jobs: ${response.pending_count}.`;
      setTaskProposalStatusMessage(detail);
      appendOutputEntry({
        title: "Remote task proposal queued",
        detail,
        tone: "success",
        renderer: {
          type: "internal",
          surface: "event"
        }
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
          surface: "event"
        }
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
      const runtimeStatesResponse = await window.electronAPI.workspace.listRuntimeStates(selectedWorkspaceId);
      const parentSessionId = preferredSessionId(selectedWorkspace, runtimeStatesResponse.items);

      const accepted = await window.electronAPI.workspace.acceptTaskProposal({
        proposal_id: proposal.proposal_id,
        parent_session_id: parentSessionId,
        task_name: proposal.task_name,
        task_prompt: proposal.task_prompt,
        priority: 0,
        model: runtimeConfig?.defaultModel ?? null
      });

      const targetSessionId = accepted.session.session_id;
      setActiveOperationsTab("running");
      setOperationsDrawerOpen(true);

      const detail = `Queued "${proposal.task_name}" into child session ${targetSessionId}. Open it from Running when you want to enter that session.`;
      const inferredAppId = inferInstalledWorkspaceAppIdFromText(
        `${accepted.proposal.task_name}\n${accepted.proposal.task_prompt}`,
        installedApps
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
              view: "editor"
            }
          : {
              type: "internal",
              surface: "event"
            }
      });
      await refreshRunningEntries();
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
          surface: "event"
        }
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
      await window.electronAPI.workspace.updateTaskProposalState(proposal.proposal_id, "dismissed");
      const detail = `Dismissed "${proposal.task_name}" and persisted the update back to the backend.`;
      setTaskProposalStatusMessage(detail);
      appendOutputEntry({
        title: `Dismissed: ${proposal.task_name}`,
        detail,
        tone: "info",
        renderer: {
          type: "internal",
          surface: "event"
        }
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
          surface: "event"
        }
      });
      void refreshRuntimeOutputs();
    } finally {
      setProposalAction(null);
    }
  }

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setAgentSessions([]);
      setRuntimeSessions([]);
      setIsLoadingRunningEntries(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setIsLoadingRunningEntries(true);
      try {
        const [sessionsResponse, runtimeStatesResponse] = await Promise.all([
          window.electronAPI.workspace.listAgentSessions(selectedWorkspaceId),
          window.electronAPI.workspace.listRuntimeStates(selectedWorkspaceId)
        ]);
        if (!cancelled) {
          setAgentSessions(sessionsResponse.items);
          setRuntimeSessions(runtimeStatesResponse.items);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRunningEntries(false);
        }
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedWorkspaceId]);

  useEffect(() => {
    const previousWorkspaceId = previousSelectedWorkspaceIdRef.current;
    previousSelectedWorkspaceIdRef.current = selectedWorkspaceId ?? null;
    if (!previousWorkspaceId || previousWorkspaceId === selectedWorkspaceId) {
      return;
    }
    for (const key of Object.keys(managedSessionRuntimesRef.current)) {
      if (key.startsWith(`${previousWorkspaceId}:`)) {
        void closeManagedSessionStream(key, "workspace_switch");
      }
    }
  }, [closeManagedSessionStream, selectedWorkspaceId]);

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
        const response = await window.electronAPI.workspace.listTaskProposals(selectedWorkspace.id);
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

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }
    const trackedKeys = new Set<string>();
    if (activeChatSessionId) {
      trackedKeys.add(managedSessionKey(selectedWorkspaceId, activeChatSessionId));
    }
    for (const key of Object.keys(managedSessionRuntimesRef.current)) {
      if (key.startsWith(`${selectedWorkspaceId}:`)) {
        trackedKeys.add(key);
      }
    }
    for (const key of trackedKeys) {
      const separatorIndex = key.indexOf(":");
      const sessionId = separatorIndex >= 0 ? key.slice(separatorIndex + 1) : "";
      if (!sessionId) {
        continue;
      }
      const runtimeState = runtimeSessions.find((item) => item.session_id === sessionId);
      if (!runtimeState) {
        continue;
      }
      void syncManagedSessionRuntime({
        workspaceId: selectedWorkspaceId,
        sessionId,
        runtimeStatus: runtimeState.status,
        currentInputId: runtimeState.current_input_id,
        errorMessage: runtimeErrorDetail(runtimeState.last_error)
      });
    }
  }, [activeChatSessionId, runtimeSessions, selectedWorkspaceId, syncManagedSessionRuntime]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.workspace.onSessionStreamEvent((payload) => {
      const key = managedStreamSessionKeyRef.current.get(payload.streamId);
      if (!key) {
        return;
      }

      if (payload.type === "done") {
        managedStreamSessionKeyRef.current.delete(payload.streamId);
        updateManagedSessionRuntime(key, (snapshot) =>
          snapshot && snapshot.streamId === payload.streamId
            ? {
                ...snapshot,
                streamId: null
              }
            : snapshot
        );
        return;
      }

      if (payload.type === "error") {
        managedStreamSessionKeyRef.current.delete(payload.streamId);
        updateManagedSessionRuntime(key, (snapshot) =>
          snapshot
            ? {
                ...snapshot,
                streamId: snapshot.streamId === payload.streamId ? null : snapshot.streamId,
                runtimeStatus: normalizeRuntimeStatus(snapshot.runtimeStatus) === "IDLE" ? snapshot.runtimeStatus : "ERROR",
                errorMessage: normalizeErrorMessage(payload.error || snapshot.errorMessage || "The agent stream failed.")
              }
            : snapshot
        );
        return;
      }

      const event = normalizeSessionOutputEvent(payload);
      if (!event) {
        return;
      }

      updateManagedSessionRuntime(key, (snapshot) => {
        if (!snapshot) {
          return snapshot;
        }
        if (snapshot.events.some((item) => item.id === event.id)) {
          return snapshot;
        }
        const sameInput =
          !snapshot.currentInputId || !event.input_id || event.input_id === snapshot.currentInputId;
        const nextEvents = sameInput ? mergeSessionOutputEvents(snapshot.events, [event]) : snapshot.events;
        let nextRuntimeStatus = snapshot.runtimeStatus;
        let nextErrorMessage = snapshot.errorMessage;
        let nextHistoryVersion = snapshot.historyVersion;
        let awaitingHistoryHydration = snapshot.awaitingHistoryHydration;

        if (event.event_type === "run_claimed" || event.event_type === "run_started") {
          nextRuntimeStatus = "BUSY";
        } else if (event.event_type === "run_waiting_user" || event.event_type === "awaiting_user_input") {
          nextRuntimeStatus = "WAITING_USER";
        } else if (event.event_type === "run_completed") {
          nextRuntimeStatus = "IDLE";
          nextHistoryVersion += 1;
          awaitingHistoryHydration = true;
        } else if (event.event_type === "run_failed") {
          nextRuntimeStatus = "ERROR";
          nextErrorMessage = runtimeErrorDetail(event.payload) || nextErrorMessage;
          nextHistoryVersion += 1;
          awaitingHistoryHydration = true;
        }

        return {
          ...snapshot,
          currentInputId: sameInput ? snapshot.currentInputId || event.input_id || null : snapshot.currentInputId,
          events: nextEvents,
          runtimeStatus: nextRuntimeStatus,
          errorMessage: nextErrorMessage,
          historyVersion: nextHistoryVersion,
          awaitingHistoryHydration
        };
      });
    });

    return () => {
      unsubscribe();
    };
  }, [updateManagedSessionRuntime]);

  useEffect(() => {
    return () => {
      for (const key of Object.keys(managedSessionRuntimesRef.current)) {
        void closeManagedSessionStream(key, "appshell_unmount");
      }
    };
  }, [closeManagedSessionStream]);

  const handleDismissUpdate = () => {
    void window.electronAPI.appUpdate.dismiss(appUpdateStatus?.releaseTag ?? null);
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

  const openChatSession = useCallback(
    (sessionId: string) => {
      if (!selectedWorkspaceId) {
        return;
      }

      setActiveLeftRailItem("space");
      setSpaceVisibility((previous) => ({
        ...previous,
        agent: true
      }));
      setAgentView({ type: "chat" });
      setChatSessionRequest({
        workspaceId: selectedWorkspaceId,
        sessionId,
        key: Date.now()
      });
      setChatFocusRequestKey((current) => current + 1);
    },
    [selectedWorkspaceId]
  );

  const handleOpenRunningSession = useCallback(
    (sessionId: string) => {
      openChatSession(sessionId);
    },
    [openChatSession]
  );

  const handleReturnToMainSession = useCallback(() => {
    const mainSessionId = (selectedWorkspace?.main_session_id || "").trim();
    if (!mainSessionId) {
      return;
    }
    openChatSession(mainSessionId);
  }, [openChatSession, selectedWorkspace?.main_session_id]);

  const handleLeftRailSelect = (item: LeftRailItem) => {
    if (item === "space") {
      setActiveLeftRailItem("space");
      if (selectedWorkspaceId && activeChatSessionId) {
        setChatSessionRequest({
          workspaceId: selectedWorkspaceId,
          sessionId: activeChatSessionId,
          key: Date.now()
        });
      }
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
      appId
    });
  };

  const handleOpenOutput = (entry: OperationsOutputEntry) => {
    if (entry.renderer.type === "app") {
      setActiveLeftRailItem("app");
      setAgentView({
        type: "app",
        appId: entry.renderer.appId,
        resourceId: entry.renderer.resourceId,
        view: entry.renderer.view
      });
      return;
    }

    setActiveLeftRailItem("space");
    setSpaceVisibility((previous) => ({
      ...previous,
      agent: true
    }));
    setAgentView({
      type: "internal",
      surface: entry.renderer.surface,
      resourceId: entry.renderer.resourceId ?? entry.id,
      htmlContent: entry.renderer.htmlContent
    });
  };

  const spaceMode = activeLeftRailItem === "space";
  const appMode = activeLeftRailItem === "app";
  const activeAppId = appMode && agentView.type === "app" ? agentView.appId : null;
  const activeApp = getWorkspaceAppDefinition(activeAppId, installedApps);
  const hasWorkspaces = workspaces.length > 0;
  const hasSelectedWorkspace = Boolean(selectedWorkspace);
  const visibleSpacePaneIds = hasWorkspaces && spaceMode ? FIXED_SPACE_ORDER.filter((paneId) => spaceVisibility[paneId]) : [];
  const flexSpacePaneId = visibleSpacePaneIds.includes("agent")
    ? "agent"
    : visibleSpacePaneIds[visibleSpacePaneIds.length - 1] ?? null;
  const showOperationsDrawer = spaceMode && spaceVisibility.agent && operationsDrawerOpen;
  const bootstrapErrorMessage =
    !hasHydratedWorkspaceList && runtimeStatus?.status === "error"
      ? runtimeStatus.lastError.trim() || workspaceErrorMessage || "Embedded runtime failed to start."
      : "";
  const isMacDesktop = window.electronAPI?.platform === "darwin";
  const showOnboardingTakeover =
    hasHydratedWorkspaceList && hasWorkspaces && hasSelectedWorkspace && onboardingModeActive;
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
  const runtimeStateBySessionId = useMemo(
    () => new Map(runtimeSessions.map((item) => [item.session_id, item])),
    [runtimeSessions]
  );
  const runningEntries = useMemo<OperationsRunningEntry[]>(() => {
    const mainSessionId = (selectedWorkspace?.main_session_id || "").trim();
    return agentSessions
      .filter((session) => session.kind === "task_proposal")
      .map((session) => {
        const runtimeState = runtimeStateBySessionId.get(session.session_id);
        const title = session.title?.trim() || session.session_id;
        const detail =
          session.parent_session_id && session.parent_session_id === mainSessionId
            ? "Continues from main session."
            : session.parent_session_id
              ? `Parent session: ${session.parent_session_id}`
              : "Proposal-created child session.";
        return {
          sessionId: session.session_id,
          title,
          detail,
          status: runtimeState?.status || "IDLE",
          createdAt: session.created_at,
          updatedAt: runtimeState?.updated_at || session.updated_at,
          isActive: agentView.type === "chat" && activeChatSessionId === session.session_id
        };
      })
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }, [activeChatSessionId, agentSessions, agentView.type, runtimeStateBySessionId, selectedWorkspace?.main_session_id]);
  const activeSessionMeta = useMemo(
    () => agentSessions.find((session) => session.session_id === activeChatSessionId) ?? null,
    [activeChatSessionId, agentSessions]
  );
  const requestedChatSessionId =
    chatSessionRequest?.workspaceId === selectedWorkspaceId ? chatSessionRequest.sessionId.trim() : "";
  const managedChatSessionRuntime =
    selectedWorkspaceId && (activeChatSessionId || requestedChatSessionId)
      ? managedSessionRuntimes[managedSessionKey(selectedWorkspaceId, activeChatSessionId || requestedChatSessionId)] ?? null
      : null;
  const mainSessionId = (selectedWorkspace?.main_session_id || "").trim();
  const showChildSessionBanner =
    agentView.type === "chat" &&
    !onboardingModeActive &&
    Boolean(activeChatSessionId) &&
    Boolean(mainSessionId) &&
    activeChatSessionId !== mainSessionId;
  const activeSessionBannerTitle = activeSessionMeta?.title?.trim() || activeChatSessionId || "Child session";

  const agentContent = useMemo(() => {
    if (!hasSelectedWorkspace) {
      return <EmptyWorkspacePane />;
    }

    if (agentView.type === "chat") {
      return onboardingModeActive
        ? <OnboardingPane onOutputsChanged={() => void refreshRuntimeOutputs()} focusRequestKey={chatFocusRequestKey} />
        : <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
            {showChildSessionBanner ? (
              <div className="theme-subtle-surface relative z-10 shrink-0 rounded-[20px] border border-neon-green/24 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="min-w-0 pr-20 lg:pr-28">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-neon-green/76">Child session</div>
                    <div className="mt-1 truncate text-[13px] font-medium text-text-main">{activeSessionBannerTitle}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleReturnToMainSession}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-neon-green/40 bg-neon-green/10 px-3 text-[11px] text-neon-green transition hover:bg-neon-green/14"
                    >
                      <ArrowRight size={12} />
                      <span>Back to main session</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatPane
                onOutputsChanged={() => void refreshRuntimeOutputs()}
                focusRequestKey={chatFocusRequestKey}
                sessionRequest={chatSessionRequest}
                onActiveSessionChange={setActiveChatSessionId}
                managedSessionRuntime={managedChatSessionRuntime}
                onManagedSessionObserved={observeManagedSession}
                onManagedHistoryHydrated={acknowledgeManagedHistoryHydration}
                onManagedQueueSessionInput={queueManagedSessionInput}
              />
            </div>
          </div>;
    }

    if (agentView.type === "app") {
      return (
        <AppSurfacePane
          appId={agentView.appId}
          app={activeAppId === agentView.appId ? activeApp : getWorkspaceAppDefinition(agentView.appId, installedApps)}
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
    activeChatSessionId,
    activeSessionBannerTitle,
    acknowledgeManagedHistoryHydration,
    agentView,
    chatFocusRequestKey,
    chatSessionRequest,
    handleReturnToMainSession,
    hasSelectedWorkspace,
    installedApps,
    managedChatSessionRuntime,
    onboardingModeActive,
    observeManagedSession,
    queueManagedSessionInput,
    refreshRuntimeOutputs,
    selectedWorkspaceId,
    showChildSessionBanner
  ]);

  const spacePanes = useMemo(
    () =>
      visibleSpacePaneIds.map((paneId) => ({
        id: paneId,
        flex: paneId === flexSpacePaneId,
        width:
          paneId === "files" ? filesPaneWidth : paneId === "browser" ? browserPaneWidth : 0,
        content:
          paneId === "agent"
            ? agentContent
            : paneId === "files"
              ? <FileExplorerPane />
              : (
                  <BrowserPane
                    suspendNativeView={
                      isUtilityPaneResizing || workspaceSwitcherOpen || settingsDialogOpen
                    }
                    layoutSyncKey={`${visibleSpacePaneIds.join("|")}:${filesPaneWidth}:${browserPaneWidth}:${showOperationsDrawer ? 1 : 0}`}
                  />
                )
      })),
    [agentContent, browserPaneWidth, filesPaneWidth, flexSpacePaneId, isUtilityPaneResizing, showOperationsDrawer, visibleSpacePaneIds]
  );

  const startUtilityPaneResize = useCallback(
    (leftPaneId: SpaceComponentId, rightPaneId: SpaceComponentId, event: ReactPointerEvent<HTMLDivElement>) => {
      if (leftPaneId !== "agent" && rightPaneId !== "agent") {
        if (!spaceVisibility[leftPaneId] || !spaceVisibility[rightPaneId]) {
          return;
        }
        utilityPaneResizeStateRef.current = {
          mode: "pair",
          leftPaneId,
          rightPaneId,
          startLeftWidth: leftPaneId === "files" ? filesPaneWidth : browserPaneWidth,
          startRightWidth: rightPaneId === "files" ? filesPaneWidth : browserPaneWidth,
          startX: event.clientX
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
          direction: leftPaneId === "agent" ? -1 : 1
        };
      }

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // BrowserView resizing falls back to the window listeners below.
      }
      if (spaceVisibility.browser) {
        void window.electronAPI.browser.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
      setIsUtilityPaneResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      event.preventDefault();
    },
    [browserPaneWidth, filesPaneWidth, spaceVisibility]
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
        setBrowserPaneWidth((current) => clampUtilityPaneWidth("browser", current));
      }
    };

    syncWidth();
    window.addEventListener("resize", syncWidth);
    return () => {
      window.removeEventListener("resize", syncWidth);
    };
  }, [clampUtilityPaneWidth, flexSpacePaneId, spaceVisibility, visibleSpacePaneIds.length]);

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
          resizeState.startRightWidth - delta
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
        resizeState.startWidth + resizeState.direction * (event.clientX - resizeState.startX)
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
    <main className="fixed inset-0 overflow-hidden text-[13px] text-text-main/90">
      <div className="theme-grid pointer-events-none absolute inset-0 bg-noise-grid bg-[size:22px_22px]" />
      <div className="theme-orb-primary pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full blur-3xl" />
      <div className="theme-orb-secondary pointer-events-none absolute -bottom-40 right-12 h-96 w-96 rounded-full blur-3xl" />

      <div
        className={`relative z-10 grid h-full w-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-2 ${
          isMacDesktop ? "sm:gap-2.5 sm:px-3 sm:pb-3 sm:pt-2.5" : "sm:gap-3 sm:p-3"
        }`}
      >
        {isUtilityPaneResizing ? <div className="absolute inset-0 z-30 cursor-col-resize" /> : null}
        {appUpdateStatus?.available ? (
          <UpdateReminder status={appUpdateStatus} onDismiss={handleDismissUpdate} onDownload={handleDownloadUpdate} />
        ) : null}

        {hasWorkspaces ? (
          <div className="relative min-w-0">
            <TopTabsBar
              integratedTitleBar={isMacDesktop}
              onWorkspaceSwitcherVisibilityChange={setWorkspaceSwitcherOpen}
            />
          </div>
        ) : null}

        {!hasHydratedWorkspaceList ? (
          bootstrapErrorMessage ? <WorkspaceStartupErrorPane message={bootstrapErrorMessage} /> : <WorkspaceBootstrapPane />
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
                ? "lg:grid-cols-[60px_minmax(0,1fr)_304px]"
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
                    <div ref={utilityPaneHostRef} className="min-h-0 flex-1 overflow-hidden">
                      {spacePanes.length > 0 ? (
                        <div className="flex h-full min-h-0 min-w-0 items-stretch overflow-hidden">
                          {spacePanes.map((pane, index) => {
                            const nextPane = spacePanes[index + 1] ?? null;
                            const resizeHandle = nextPane ? spaceResizeHandleSpec(pane.id, nextPane.id) : null;

                            return (
                              <div key={pane.id} className="contents">
                                <div
                                  className={`relative min-h-0 min-w-0 overflow-hidden ${pane.flex ? "flex-1" : "shrink-0"}`}
                                  style={pane.flex ? undefined : { width: `${pane.width}px` }}
                                >
                                  {pane.content}
                                </div>

                                {resizeHandle ? (
                                  <div
                                    role="separator"
                                    aria-label={resizeHandle.label}
                                    aria-orientation="vertical"
                                    onPointerDown={(event) => startUtilityPaneResize(resizeHandle.leftPaneId, resizeHandle.rightPaneId, event)}
                                    className="group relative z-10 flex w-4 shrink-0 cursor-col-resize touch-none items-center justify-center"
                                  >
                                    <div className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded-full bg-panel-border/55 transition-all duration-150 group-hover:w-[2px] group-hover:bg-[rgba(247,90,84,0.5)]" />
                                    <div className="pointer-events-none absolute left-1/2 top-1/2 h-14 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(247,90,84,0.08)] opacity-0 transition duration-150 group-hover:opacity-100" />
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <section className="theme-shell flex h-full min-h-0 items-center justify-center rounded-[var(--theme-radius-card)] border border-panel-border/45 shadow-card">
                          <div className="max-w-[360px] px-6 text-center">
                            <div className="text-[22px] font-medium tracking-[-0.03em] text-text-main">Turn on a space surface</div>
                            <div className="mt-3 text-[13px] leading-6 text-text-muted/78">
                              Space keeps your files, browser, and agent panes available together.
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
                        app={activeAppId === agentView.appId ? activeApp : getWorkspaceAppDefinition(agentView.appId, installedApps)}
                        resourceId={agentView.resourceId}
                        view={agentView.view}
                      />
                    ) : (
                      <section className="theme-shell flex h-full min-h-0 items-center justify-center rounded-[var(--theme-radius-card)] border border-panel-border/45 shadow-card">
                        <div className="max-w-[360px] px-6 text-center">
                          <div className="text-[22px] font-medium tracking-[-0.03em] text-text-main">Choose an app</div>
                          <div className="mt-3 text-[13px] leading-6 text-text-muted/78">
                            Select a workspace app from the left rail to open its dedicated screen.
                          </div>
                        </div>
                      </section>
                    )}
                  </div>
                ) : activeLeftRailItem === "automations" ? (
                  <div className="h-full min-h-0 overflow-hidden">
                    <AutomationsPane />
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
                <div className="pointer-events-auto inline-flex items-center gap-1 rounded-bl-[16px] rounded-tr-[var(--theme-radius-card)] border border-panel-border/50 border-r-0 border-t-0 bg-panel-bg/94 px-2 py-2 text-text-muted shadow-card backdrop-blur">
                  {showOperationsDrawer ? (
                    <button
                      type="button"
                      onClick={() => toggleOperationsDrawer()}
                      aria-label="Hide right panel"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-neon-green/45 bg-neon-green/10 text-neon-green transition-all duration-200 hover:border-neon-green/60 hover:bg-neon-green/14 active:scale-95"
                    >
                      <PanelRightClose size={14} />
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openOperationsDrawerTab("inbox")}
                        aria-label="Open inbox panel"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-panel-border/45 text-text-muted transition-all duration-200 hover:border-neon-green/45 hover:text-neon-green active:scale-95"
                      >
                        <Bell size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openOperationsDrawerTab("running")}
                        aria-label="Open running panel"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-panel-border/45 text-text-muted transition-all duration-200 hover:border-neon-green/45 hover:text-neon-green active:scale-95"
                      >
                        <Clock3 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openOperationsDrawerTab("outputs")}
                        aria-label="Open outputs panel"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-panel-border/45 text-text-muted transition-all duration-200 hover:border-neon-green/45 hover:text-neon-green active:scale-95"
                      >
                        <ChevronRight size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleOperationsDrawer()}
                        aria-label="Show right panel"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-panel-border/45 text-text-muted transition-all duration-200 hover:border-neon-green/45 hover:text-neon-green active:scale-95"
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
                  runningEntries={runningEntries}
                  isLoadingRunningEntries={isLoadingRunningEntries}
                  outputs={combinedOutputEntries}
                  installedApps={installedApps}
                  selectedOutputId={selectedOutputId}
                  onSelectOutput={setSelectedOutputId}
                  onOpenRunningSession={handleOpenRunningSession}
                  onOpenOutput={handleOpenOutput}
                  onRefreshProposals={() => void refreshTaskProposals({ logErrors: true })}
                  onTriggerProposal={() => void triggerRemoteTaskProposal()}
                  onAcceptProposal={(proposal) => void acceptTaskProposal(proposal)}
                  onDismissProposal={(proposal) => void dismissTaskProposal(proposal)}
                  hasWorkspace={hasSelectedWorkspace}
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
