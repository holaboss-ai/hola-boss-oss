import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Bell, ChevronRight, Clock3, FolderOpen, Loader2, LockKeyhole, PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react";
import { LeftNavigationRail, type LeftRailItem } from "@/components/layout/LeftNavigationRail";
import {
  OperationsDrawer,
  type OperationsDrawerTab,
  type OperationsOutputEntry
} from "@/components/layout/OperationsDrawer";
import { SettingsDialog } from "@/components/layout/SettingsDialog";
import { TopTabsBar } from "@/components/layout/TopTabsBar";
import { WorkbenchPanel, type WorkbenchTab } from "@/components/layout/WorkbenchPanel";
import { AutomationsPane } from "@/components/panes/AutomationsPane";
import { AppSurfacePane } from "@/components/panes/AppSurfacePane";
import { BrowserPane } from "@/components/panes/BrowserPane";
import { ChatPane } from "@/components/panes/ChatPane";
import { FileExplorerPane } from "@/components/panes/FileExplorerPane";
import { InternalSurfacePane } from "@/components/panes/InternalSurfacePane";
import { UpdateReminder } from "@/components/ui/UpdateReminder";
import { preferredSessionId } from "@/lib/sessionRouting";
import { getWorkspaceAppDefinition, inferInstalledWorkspaceAppIdFromText } from "@/lib/workspaceApps";
import { useWorkspaceDesktop, WorkspaceDesktopProvider } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection, WorkspaceSelectionProvider } from "@/lib/workspaceSelection";

const THEME_STORAGE_KEY = "holaboss-theme-v1";
const WORKBENCH_TAB_STORAGE_KEY = "holaboss-workbench-tab-v1";
const LEFT_RAIL_OPEN_STORAGE_KEY = "holaboss-left-rail-open-v1";
const OPERATIONS_DRAWER_OPEN_STORAGE_KEY = "holaboss-operations-drawer-open-v1";
const OPERATIONS_DRAWER_TAB_STORAGE_KEY = "holaboss-operations-drawer-tab-v1";
const THEMES = ["holaboss", "emerald", "cobalt", "ember", "glacier", "mono", "claude", "slate", "paper", "graphite"] as const;

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

function loadWorkbenchTab(): WorkbenchTab {
  try {
    const raw = localStorage.getItem(WORKBENCH_TAB_STORAGE_KEY);
    if (raw === "browser" || raw === "files") {
      return raw;
    }
  } catch {
    // ignore
  }

  return "browser";
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

function loadLeftRailOpen(): boolean {
  try {
    const raw = localStorage.getItem(LEFT_RAIL_OPEN_STORAGE_KEY);
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

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
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
  const [showMarketplaceAuthSheet, setShowMarketplaceAuthSheet] = useState(false);
  const {
    templateSourceMode,
    setTemplateSourceMode,
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
      : !selectedTemplateFolder?.rootPath);

  const handleCreateWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createWorkspace();
  };

  useEffect(() => {
    if (!canUseMarketplaceTemplates) {
      return;
    }
    setShowMarketplaceAuthSheet(false);
  }, [canUseMarketplaceTemplates]);

  if (isCreatingWorkspace) {
    return (
      <section className="theme-shell relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[var(--theme-radius-card)] border border-panel-border/45 px-6 py-10 shadow-card">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(247,90,84,0.08),transparent_36%),radial-gradient(circle_at_82%_14%,rgba(233,117,109,0.1),transparent_34%)]" />
        <div className="theme-subtle-surface relative w-full max-w-xl rounded-[26px] border border-panel-border/45 px-6 py-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-neon-green/30 bg-neon-green/10 text-neon-green">
            <Loader2 size={22} className="animate-spin" />
          </div>
          <h2 className="mt-5 text-[30px] font-semibold tracking-[-0.04em] text-text-main">Building your workspace...</h2>
          <p className="mt-3 text-[14px] leading-7 text-text-muted/84">
            Holaboss is preparing your workspace and wiring the desktop surface around it.
          </p>
          <div className="theme-control-surface mt-7 overflow-hidden rounded-full border border-panel-border/45 p-1">
            <div className="h-2 rounded-full bg-[linear-gradient(90deg,rgba(247,90,84,0.56),rgba(233,117,109,0.72),rgba(247,170,126,0.78))] animate-pulse" />
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.24em] text-text-dim/80">
            <span className="h-1.5 w-1.5 rounded-full bg-neon-green/70" />
            <span>Provisioning runtime</span>
            <span className="h-1.5 w-1.5 rounded-full bg-neon-green/55" />
            <span>Scaffolding workspace</span>
            <span className="h-1.5 w-1.5 rounded-full bg-neon-green/40" />
            <span>Preparing desktop</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(247,90,84,0.08),transparent_28%),radial-gradient(circle_at_86%_14%,rgba(233,117,109,0.08),transparent_30%)]" />
      <div className="relative flex w-full max-w-[1240px] flex-1 items-center justify-center">
        <div className="theme-shell mx-auto w-full rounded-[var(--theme-radius-card)] border border-panel-border/45 px-6 py-8 shadow-card sm:px-8 sm:py-9 lg:px-12 lg:py-10">
          <div className="max-w-3xl">
            <div className="theme-control-surface inline-flex items-center gap-2 rounded-full border border-panel-border/45 px-4 py-2 text-[11px] uppercase tracking-[0.26em] text-text-dim/80">
              <Sparkles size={14} className="text-neon-green/80" />
              <span>Workspace onboarding</span>
            </div>
            <h1 className="mt-6 text-[38px] font-semibold tracking-[-0.05em] text-text-main sm:text-[50px]">Welcome to Holaboss</h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-8 text-text-muted/84 sm:text-[16px]">
              Create a workspace to start building.
            </p>
          </div>

          <div className="mt-9 grid gap-4 lg:grid-cols-2">
            <FirstWorkspaceChoiceCard
              title="Local Template"
              description="Use a folder from your disk."
              detail="No login required"
              icon={<FolderOpen size={18} />}
              active={templateSourceMode === "local"}
              onClick={() => {
                setTemplateSourceMode("local");
              }}
            />
            <FirstWorkspaceChoiceCard
              title="Marketplace Template"
              description="Browse curated templates."
              detail={
                canUseMarketplaceTemplates
                  ? selectedMarketplaceTemplate?.description || "Curated starter kits are ready to use."
                  : "Login Required"
              }
              icon={<Sparkles size={18} />}
              active={templateSourceMode === "marketplace" && canUseMarketplaceTemplates}
              badge={!canUseMarketplaceTemplates ? "Login Required" : undefined}
              muted={!canUseMarketplaceTemplates}
              onClick={() => {
                if (!canUseMarketplaceTemplates) {
                  setShowMarketplaceAuthSheet(true);
                  return;
                }
                setTemplateSourceMode("marketplace");
              }}
            />
          </div>

          {!canUseMarketplaceTemplates && showMarketplaceAuthSheet ? (
            <div className="theme-subtle-surface mt-5 rounded-[24px] border border-panel-border/45 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-text-dim/76">Marketplace access</div>
                  <div className="mt-2 text-[22px] font-medium tracking-[-0.03em] text-text-main">
                    Sign in only if you want Holaboss marketplace features
                  </div>
                  <div className="mt-3 text-[14px] leading-7 text-text-muted/84">
                    Local workspaces stay completely free and available without an account. Sign in only to browse curated marketplace
                    templates and other Holaboss-specific features.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMarketplaceAuthSheet(false)}
                  className="inline-flex h-10 items-center justify-center rounded-[14px] border border-panel-border/45 px-3 text-[12px] text-text-muted transition hover:border-neon-green/35 hover:text-text-main"
                >
                  Not now
                </button>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  ref={authButtonRef}
                  type="button"
                  onClick={openAuthPopup}
                  className="inline-flex h-11 items-center justify-center rounded-[16px] border border-neon-green/40 bg-neon-green/10 px-4 text-[13px] font-medium text-neon-green transition hover:bg-neon-green/14"
                >
                  Sign in to use Marketplace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMarketplaceAuthSheet(false);
                    setTemplateSourceMode("local");
                  }}
                  className="inline-flex h-11 items-center justify-center rounded-[16px] border border-panel-border/45 px-4 text-[13px] text-text-muted transition hover:border-neon-green/35 hover:text-text-main"
                >
                  Continue with Local Template
                </button>
              </div>
            </div>
          ) : null}

          <form
            onSubmit={handleCreateWorkspace}
            className="theme-subtle-surface mt-8 grid gap-5 rounded-[28px] border border-panel-border/45 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] lg:gap-6"
          >
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-text-dim/78">Workspace details</div>
                  <div className="mt-2 text-[22px] font-medium tracking-[-0.03em] text-text-main">Configure your first workspace</div>
                </div>
                <div className="theme-control-surface inline-flex items-center gap-2 rounded-full border border-panel-border/45 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-text-dim/78">
                  {templateSourceMode === "marketplace" ? (
                    <Sparkles size={13} className="text-neon-green/82" />
                  ) : (
                    <FolderOpen size={13} className="text-neon-green/82" />
                  )}
                  <span>{templateSourceMode === "marketplace" ? "Marketplace source" : "Local source"}</span>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <label className="grid gap-2">
                  <span className="text-[11px] uppercase tracking-[0.22em] text-text-dim/78">Workspace name</span>
                  <input
                    value={newWorkspaceName}
                    onChange={(event) => setNewWorkspaceName(event.target.value)}
                    placeholder="My first workspace"
                    className="theme-control-surface h-12 rounded-[18px] border border-panel-border/45 px-4 text-[14px] text-text-main outline-none placeholder:text-text-dim/50"
                  />
                </label>

                {templateSourceMode === "marketplace" ? (
                  <label className="grid gap-2">
                    <span className="text-[11px] uppercase tracking-[0.22em] text-text-dim/78">Template source</span>
                    <select
                      value={selectedMarketplaceTemplate?.name || ""}
                      onChange={(event) => selectMarketplaceTemplate(event.target.value)}
                      disabled={!canUseMarketplaceTemplates || isLoadingMarketplaceTemplates || marketplaceTemplates.length === 0}
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
                ) : (
                  <div className="grid gap-2">
                    <span className="text-[11px] uppercase tracking-[0.22em] text-text-dim/78">Template source</span>
                    <button
                      type="button"
                      onClick={() => void chooseTemplateFolder()}
                      className="theme-control-surface flex h-12 items-center justify-between rounded-[18px] border border-panel-border/45 px-4 text-left text-[14px] text-text-main transition hover:border-neon-green/35"
                    >
                      <span className="truncate">
                        {selectedTemplateFolder?.templateName || selectedTemplateFolder?.rootPath || "Choose local folder"}
                      </span>
                      <ArrowRight size={16} className="shrink-0 text-text-dim/75" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4">
              <div className="theme-control-surface rounded-[22px] border border-panel-border/45 px-4 py-4 text-left lg:min-h-full">
                <div className="flex items-center gap-2 text-[12px] font-medium text-text-main">
                  {templateSourceMode === "marketplace" ? <Sparkles size={15} /> : <FolderOpen size={15} />}
                  <span>{templateSourceMode === "marketplace" ? "Marketplace Template" : "Local Template"}</span>
                  {templateSourceMode === "marketplace" ? (
                    <span
                      className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${
                        canUseMarketplaceTemplates
                          ? "border-neon-green/30 bg-neon-green/10 text-neon-green"
                          : "theme-chat-system-bubble"
                      }`}
                    >
                      {canUseMarketplaceTemplates ? "Marketplace ready" : "Login required"}
                    </span>
                  ) : (
                    <span className="rounded-full border border-neon-green/30 bg-neon-green/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-neon-green">
                      No login required
                    </span>
                  )}
                </div>
                <div className="mt-2 text-[13px] leading-7 text-text-muted/84">
                  {templateSourceMode === "marketplace"
                    ? marketplaceTemplatesError ||
                      selectedMarketplaceTemplate?.long_description ||
                      selectedMarketplaceTemplate?.description ||
                      "Choose a curated template to bootstrap your workspace."
                    : selectedTemplateFolder?.description ||
                      selectedTemplateFolder?.rootPath ||
                      "Pick a folder from your machine and Holaboss will use it as the template source."}
                </div>
                {templateSourceMode === "marketplace" && !canUseMarketplaceTemplates ? (
                  <button
                    type="button"
                    onClick={() => setShowMarketplaceAuthSheet(true)}
                    className="mt-4 inline-flex h-10 items-center justify-center rounded-[14px] border border-neon-green/40 bg-neon-green/10 px-3 text-[12px] font-medium text-neon-green transition hover:bg-neon-green/14"
                  >
                    Unlock Marketplace
                  </button>
                ) : null}
              </div>
              <button
                type="submit"
                disabled={createDisabled}
                className="inline-flex h-12 items-center justify-center gap-3 self-end rounded-[18px] border border-neon-green/40 bg-neon-green/14 px-5 text-[14px] font-medium text-neon-green transition hover:bg-neon-green/20 disabled:cursor-not-allowed disabled:border-panel-border/40 disabled:bg-transparent disabled:text-text-dim/50 lg:w-full"
              >
                <span>Create Workspace</span>
                <ArrowRight size={16} />
              </button>
            </div>

            {workspaceErrorMessage ? (
              <div className="theme-chat-system-bubble rounded-[18px] border px-4 py-3 text-[13px] leading-6">
                {workspaceErrorMessage}
              </div>
            ) : null}
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
  muted = false,
  badge,
  onClick
}: {
  title: string;
  description: string;
  detail: string;
  icon: ReactNode;
  active: boolean;
  muted?: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-[26px] border p-5 text-left transition ${
        active
          ? "border-neon-green/35 bg-neon-green/10 shadow-[0_8px_24px_rgba(25,33,53,0.08)]"
          : muted
            ? "border-panel-border/35 theme-control-surface opacity-80"
            : "border-panel-border/45 theme-control-surface hover:border-neon-green/25 hover:bg-[var(--theme-hover-bg)]"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(247,90,84,0.12),transparent_36%)] opacity-70" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="theme-subtle-surface flex h-11 w-11 items-center justify-center rounded-[16px] border border-panel-border/45 text-text-main/88">
            {icon}
          </div>
          {badge ? (
            <span className="theme-subtle-surface inline-flex items-center gap-1 rounded-full border border-panel-border/45 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-text-dim/78">
              <LockKeyhole size={11} />
              <span>{badge}</span>
            </span>
          ) : null}
        </div>
        <div className="mt-6 text-[18px] font-medium tracking-[-0.02em] text-text-main">{title}</div>
        <div className="mt-2 text-[14px] leading-7 text-text-muted/84">{description}</div>
        <div className="mt-4 text-[12px] uppercase tracking-[0.18em] text-text-dim/76">{detail}</div>
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
  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_14%,rgba(247,90,84,0.1),transparent_26%),radial-gradient(circle_at_86%_16%,rgba(233,117,109,0.08),transparent_22%),radial-gradient(circle_at_50%_110%,rgba(247,170,126,0.08),transparent_28%)]" />

      <div className="relative grid w-full max-w-[1120px] gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1.15fr)_340px] lg:px-8 lg:py-8">
        <div className="theme-subtle-surface relative overflow-hidden rounded-[30px] border border-panel-border/45 p-4 sm:p-5">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_42%,rgba(247,90,84,0.05)_100%)]" />

          <div className="relative flex items-center justify-between gap-3 rounded-[22px] border border-panel-border/35 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="h-10 w-40 rounded-[16px] border border-panel-border/35 bg-black/10" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-10 w-24 rounded-[16px] border border-panel-border/35 bg-black/10" />
              <div className="h-10 w-10 rounded-[16px] border border-panel-border/35 bg-black/10" />
            </div>
          </div>

          <div className="relative mt-5 grid min-h-[420px] gap-4 lg:grid-cols-[96px_minmax(0,1fr)_280px]">
            <div className="theme-shell flex flex-col items-center gap-4 rounded-[24px] border border-panel-border/35 px-3 py-4">
              <div className="h-11 w-11 rounded-[16px] border border-neon-green/30 bg-neon-green/12" />
              <div className="h-11 w-11 rounded-[16px] border border-panel-border/35 bg-black/10" />
              <div className="h-11 w-11 rounded-[16px] border border-panel-border/35 bg-black/10" />
              <div className="mt-auto h-24 w-full rounded-[18px] border border-panel-border/30 bg-black/10" />
            </div>

            <div className="grid gap-4">
              <div className="theme-shell rounded-[24px] border border-panel-border/35 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-neon-green/74">Workspace</div>
                    <div className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-text-main">Loading your workspace</div>
                  </div>
                  <div className="grid h-12 w-12 place-items-center rounded-[18px] border border-neon-green/35 bg-neon-green/10 text-neon-green">
                    <Loader2 size={18} className="animate-spin" />
                  </div>
                </div>
                <div className="mt-3 max-w-[560px] text-[14px] leading-7 text-text-muted/84">
                  Restoring workspace state, session history, and desktop surfaces so the shell opens in a ready-to-work state.
                </div>
                <div className="mt-5 overflow-hidden rounded-full border border-panel-border/35 bg-black/10 p-1">
                  <div className="h-2 rounded-full bg-[linear-gradient(90deg,rgba(247,90,84,0.62),rgba(233,117,109,0.82),rgba(247,170,126,0.72))] animate-pulse" />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-text-dim/74">
                  <span className="rounded-full border border-panel-border/35 bg-black/10 px-2.5 py-1">Hydrating workspace</span>
                  <span className="rounded-full border border-panel-border/35 bg-black/10 px-2.5 py-1">Restoring agent state</span>
                  <span className="rounded-full border border-panel-border/35 bg-black/10 px-2.5 py-1">Attaching desktop surfaces</span>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="theme-shell rounded-[24px] border border-panel-border/35 p-4">
                  <div className="h-4 w-28 rounded-full bg-black/10" />
                  <div className="mt-4 space-y-3">
                    <div className="h-14 rounded-[18px] border border-panel-border/30 bg-black/10" />
                    <div className="h-24 rounded-[22px] border border-panel-border/30 bg-black/10" />
                    <div className="h-11 rounded-[16px] border border-panel-border/30 bg-black/10" />
                  </div>
                </div>

                <div className="theme-shell rounded-[24px] border border-panel-border/35 p-4">
                  <div className="h-4 w-24 rounded-full bg-black/10" />
                  <div className="mt-4 space-y-3">
                    <div className="h-16 rounded-[18px] border border-panel-border/30 bg-black/10" />
                    <div className="h-16 rounded-[18px] border border-panel-border/30 bg-black/10" />
                    <div className="h-16 rounded-[18px] border border-panel-border/30 bg-black/10" />
                  </div>
                </div>
              </div>
            </div>

            <div className="theme-shell hidden rounded-[24px] border border-panel-border/35 p-4 lg:block">
              <div className="h-4 w-28 rounded-full bg-black/10" />
              <div className="mt-4 space-y-3">
                <div className="h-20 rounded-[18px] border border-panel-border/30 bg-black/10" />
                <div className="h-20 rounded-[18px] border border-panel-border/30 bg-black/10" />
                <div className="h-20 rounded-[18px] border border-panel-border/30 bg-black/10" />
                <div className="h-20 rounded-[18px] border border-panel-border/30 bg-black/10" />
              </div>
            </div>
          </div>
        </div>

        <div className="theme-subtle-surface relative overflow-hidden rounded-[28px] border border-panel-border/45 p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(247,90,84,0.1),transparent_34%)]" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-panel-border/35 bg-black/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-text-dim/74">
              <Sparkles size={12} className="text-neon-green/82" />
              <span>Bring-up</span>
            </div>
            <div className="mt-4 text-[24px] font-semibold tracking-[-0.04em] text-text-main">Preparing the desktop shell</div>
            <div className="mt-3 text-[13px] leading-7 text-text-muted/84">
              This should only take a moment. The app is syncing your workspace list and restoring the last active desktop state.
            </div>

            <div className="mt-6 grid gap-3">
              {[
                "Syncing workspace records",
                "Restoring recent session context",
                "Initializing browser and file surfaces"
              ].map((step, index) => (
                <div key={step} className="flex items-center gap-3 rounded-[18px] border border-panel-border/35 bg-black/10 px-4 py-3">
                  <div
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-[12px] border ${
                      index === 0
                        ? "border-neon-green/35 bg-neon-green/12 text-neon-green"
                        : "border-panel-border/35 bg-panel-bg/40 text-text-dim/74"
                    }`}
                  >
                    {index === 0 ? <Loader2 size={14} className="animate-spin" /> : <span className="text-[11px]">{index + 1}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-text-main">{step}</div>
                    <div className="mt-1 text-[11px] text-text-dim/72">
                      {index === 0 ? "In progress" : "Queued next"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
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

function AppShellContent() {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const { runtimeConfig, workspaces, hasHydratedWorkspaceList, selectedWorkspace, installedApps, isLoadingInstalledApps } =
    useWorkspaceDesktop();
  const [theme, setTheme] = useState<AppTheme>(loadTheme);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusPayload | null>(null);
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatusPayload | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsDialogSection, setSettingsDialogSection] = useState<UiSettingsPaneSection>("settings");
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<WorkbenchTab>(loadWorkbenchTab);
  const [lastManualWorkbenchTab, setLastManualWorkbenchTab] = useState<WorkbenchTab>(loadWorkbenchTab);
  const [leftRailOpen, setLeftRailOpen] = useState(loadLeftRailOpen);
  const [activeLeftRailItem, setActiveLeftRailItem] = useState<LeftRailItem>("agent");
  const [agentView, setAgentView] = useState<AgentView>({ type: "chat" });
  const [operationsDrawerOpen, setOperationsDrawerOpen] = useState(loadOperationsDrawerOpen);
  const [activeOperationsTab, setActiveOperationsTab] = useState<OperationsDrawerTab>(loadOperationsDrawerTab);
  const [taskProposals, setTaskProposals] = useState<TaskProposalRecordPayload[]>([]);
  const [isLoadingTaskProposals, setIsLoadingTaskProposals] = useState(false);
  const [isTriggeringTaskProposal, setIsTriggeringTaskProposal] = useState(false);
  const [taskProposalStatusMessage, setTaskProposalStatusMessage] = useState("");
  const [proposalAction, setProposalAction] = useState<{
    proposalId: string;
    action: "accept" | "dismiss";
  } | null>(null);
  const [outputEntries, setOutputEntries] = useState<OperationsOutputEntry[]>([]);
  const [runtimeOutputEntries, setRuntimeOutputEntries] = useState<OperationsOutputEntry[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const outputRefreshTimerRef = useRef<number | null>(null);

  const refreshRuntimeOutputs = useCallback(async () => {
    if (!selectedWorkspaceId) {
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
  }, [installedApps, selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setRuntimeOutputEntries([]);
      return;
    }

    void refreshRuntimeOutputs();
  }, [refreshRuntimeOutputs, selectedWorkspaceId]);

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

    const unsubscribe = window.electronAPI.workbench.onOpenBrowser(() => {
      setActiveLeftRailItem("agent");
      setAgentView({ type: "chat" });
      setWorkbenchOpen(true);
      setActiveWorkbenchTab("browser");
    });

    return unsubscribe;
  }, []);

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
    localStorage.setItem(WORKBENCH_TAB_STORAGE_KEY, lastManualWorkbenchTab);
  }, [lastManualWorkbenchTab]);

  useEffect(() => {
    localStorage.setItem(LEFT_RAIL_OPEN_STORAGE_KEY, leftRailOpen ? "1" : "0");
  }, [leftRailOpen]);

  useEffect(() => {
    localStorage.setItem(OPERATIONS_DRAWER_OPEN_STORAGE_KEY, operationsDrawerOpen ? "1" : "0");
  }, [operationsDrawerOpen]);

  useEffect(() => {
    localStorage.setItem(OPERATIONS_DRAWER_TAB_STORAGE_KEY, activeOperationsTab);
  }, [activeOperationsTab]);

  const appendOutputEntry = (entry: Omit<OperationsOutputEntry, "id" | "createdAt">) => {
    const nextEntry: OperationsOutputEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...entry
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
      const targetSessionId = preferredSessionId(selectedWorkspace, runtimeStatesResponse.items);
      if (!targetSessionId) {
        throw new Error("No active session found for this workspace.");
      }

      await window.electronAPI.workspace.queueSessionInput({
        text: proposal.task_prompt,
        workspace_id: selectedWorkspaceId,
        image_urls: null,
        session_id: targetSessionId,
        priority: 0,
        model: runtimeConfig?.defaultModel ?? null
      });
      await window.electronAPI.workspace.updateTaskProposalState(proposal.proposal_id, "accepted");

      const detail = `Queued "${proposal.task_name}" into session ${targetSessionId}.`;
      const inferredAppId = inferInstalledWorkspaceAppIdFromText(
        `${proposal.task_name}\n${proposal.task_prompt}`,
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

  const handleDismissUpdate = () => {
    void window.electronAPI.appUpdate.dismiss(appUpdateStatus?.releaseTag ?? null);
  };

  const handleDownloadUpdate = () => {
    void window.electronAPI.appUpdate.openDownload();
  };

  const openWorkbench = (tab?: WorkbenchTab) => {
    const nextTab = tab ?? lastManualWorkbenchTab;
    setWorkbenchOpen(true);
    setActiveWorkbenchTab(nextTab);
    if (tab) {
      setLastManualWorkbenchTab(tab);
    }
  };

  const closeWorkbench = () => {
    setWorkbenchOpen(false);
  };

  const handleWorkbenchTabChange = (tab: WorkbenchTab) => {
    setActiveWorkbenchTab(tab);
    setLastManualWorkbenchTab(tab);
  };

  const toggleOperationsDrawer = () => {
    setOperationsDrawerOpen((open) => !open);
  };

  const openOperationsDrawerTab = (tab: OperationsDrawerTab) => {
    setActiveOperationsTab(tab);
    setOperationsDrawerOpen(true);
  };

  const handleLeftRailSelect = (item: LeftRailItem) => {
    setActiveLeftRailItem(item);
    if (item === "agent") {
      setAgentView({ type: "chat" });
      return;
    }
    if (item === "files") {
      openWorkbench("files");
    }
  };

  const handleSelectWorkspaceApp = (appId: string) => {
    setActiveLeftRailItem("agent");
    setAgentView({
      type: "app",
      appId,
      view: "home"
    });
  };

  const handleOpenOutput = (entry: OperationsOutputEntry) => {
    setActiveLeftRailItem("agent");
    if (entry.renderer.type === "app") {
      setAgentView({
        type: "app",
        appId: entry.renderer.appId,
        resourceId: entry.renderer.resourceId,
        view: entry.renderer.view
      });
      return;
    }

    setAgentView({
      type: "internal",
      surface: entry.renderer.surface,
      resourceId: entry.renderer.resourceId ?? entry.id,
      htmlContent: entry.renderer.htmlContent
    });
  };

  const openAgentChat = () => {
    setActiveLeftRailItem("agent");
    setAgentView({ type: "chat" });
  };

  const agentMode = activeLeftRailItem === "agent" || activeLeftRailItem === "files";
  const activeAppId = activeLeftRailItem === "agent" && agentView.type === "app" ? agentView.appId : null;
  const activeApp = getWorkspaceAppDefinition(activeAppId, installedApps);
  const hasWorkspaces = workspaces.length > 0;
  const hasSelectedWorkspace = Boolean(selectedWorkspace);
  const isMacDesktop = window.electronAPI?.platform === "darwin";
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
      return <ChatPane onOutputsChanged={() => void refreshRuntimeOutputs()} />;
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
  }, [activeApp, activeAppId, agentView, hasSelectedWorkspace, installedApps, refreshRuntimeOutputs]);

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
        {appUpdateStatus?.available ? (
          <UpdateReminder status={appUpdateStatus} onDismiss={handleDismissUpdate} onDownload={handleDownloadUpdate} />
        ) : null}

        {hasWorkspaces ? (
          <div className={`${isMacDesktop ? "window-drag " : ""}relative min-w-0`}>
            <TopTabsBar
              agentMode={agentMode && hasWorkspaces}
              hasWorkspaces={hasWorkspaces}
              integratedTitleBar={isMacDesktop}
              onOpenBrowserWorkbench={() => openWorkbench("browser")}
              activeWorkbenchTab={activeWorkbenchTab}
              workbenchOpen={workbenchOpen}
            />
          </div>
        ) : null}

        {!hasHydratedWorkspaceList ? (
          <WorkspaceBootstrapPane />
        ) : !hasWorkspaces ? (
          <FirstWorkspacePane />
        ) : (
          <div
            className={`relative grid min-h-0 gap-y-3 overflow-hidden transition-[grid-template-columns,column-gap] duration-300 ease-in-out ${
              operationsDrawerOpen
                ? leftRailOpen
                  ? "lg:grid-cols-[220px_minmax(0,1fr)_380px]"
                  : "lg:grid-cols-[72px_minmax(0,1fr)_380px]"
                : leftRailOpen
                  ? "lg:grid-cols-[220px_minmax(0,1fr)_0px]"
                  : "lg:grid-cols-[72px_minmax(0,1fr)_0px]"
            }`}
            style={{ columnGap: operationsDrawerOpen ? "0.75rem" : "0rem" }}
          >
            <LeftNavigationRail
              activeItem={activeLeftRailItem}
              onSelectItem={handleLeftRailSelect}
              activeAppId={activeAppId}
              installedApps={installedApps}
              isLoadingApps={isLoadingInstalledApps}
              onSelectApp={handleSelectWorkspaceApp}
              collapsed={!leftRailOpen}
              onToggleCollapsed={() => setLeftRailOpen((open) => !open)}
            />

            <div
              className={
                agentMode && workbenchOpen
                  ? "grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden"
                  : "h-full min-h-0 overflow-hidden"
              }
            >
              <div className={agentMode && workbenchOpen ? "min-h-0 overflow-hidden" : "h-full min-h-0 overflow-hidden"}>
                {activeLeftRailItem === "agent" || activeLeftRailItem === "files" ? (
                  agentContent
                ) : activeLeftRailItem === "automations" ? (
                  <AutomationsPane />
                ) : (
                  <FocusPlaceholder
                    eyebrow="Skills"
                    title="Skills catalog lives here"
                    description="This screen is reserved for skill discovery, installation, and configuration. The agent drawer stays scoped to Agent mode only."
                  />
                )}
              </div>

              {agentMode && workbenchOpen ? (
                <WorkbenchPanel activeTab={activeWorkbenchTab} onTabChange={handleWorkbenchTabChange} onClose={closeWorkbench}>
                  {activeWorkbenchTab === "browser" ? <BrowserPane /> : <FileExplorerPane />}
                </WorkbenchPanel>
              ) : null}
            </div>

            <div className="pointer-events-none absolute right-0 top-0 z-20 hidden lg:block">
              <div className="pointer-events-auto inline-flex items-center gap-1 rounded-bl-[16px] rounded-tr-[var(--theme-radius-card)] border border-panel-border/50 border-r-0 border-t-0 bg-panel-bg/94 px-2 py-2 text-text-muted shadow-card backdrop-blur">
                {operationsDrawerOpen ? (
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

            <div
              className={`min-h-0 min-w-0 overflow-hidden transition-all duration-300 ease-out ${
                operationsDrawerOpen ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0"
              }`}
              aria-hidden={!operationsDrawerOpen}
            >
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
                onRefreshProposals={() => void refreshTaskProposals({ logErrors: true })}
                onTriggerProposal={() => void triggerRemoteTaskProposal()}
                onAcceptProposal={(proposal) => void acceptTaskProposal(proposal)}
                onDismissProposal={(proposal) => void dismissTaskProposal(proposal)}
                hasWorkspace={hasSelectedWorkspace}
              />
            </div>
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
