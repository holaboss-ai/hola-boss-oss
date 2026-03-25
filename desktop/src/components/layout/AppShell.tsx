import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, FolderOpen, Loader2, LockKeyhole, PanelRightOpen, Sparkles } from "lucide-react";
import { LeftNavigationRail, type LeftRailItem } from "@/components/layout/LeftNavigationRail";
import {
  OperationsDrawer,
  type OperationsDrawerTab,
  type OperationsOutputEntry
} from "@/components/layout/OperationsDrawer";
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
const OPERATIONS_DRAWER_OPEN_STORAGE_KEY = "holaboss-operations-drawer-open-v1";
const OPERATIONS_DRAWER_TAB_STORAGE_KEY = "holaboss-operations-drawer-tab-v1";
const THEMES = ["emerald", "cobalt", "ember", "glacier", "mono", "claude", "slate", "paper", "graphite"] as const;

export type AppTheme = (typeof THEMES)[number];

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
    if (stored && THEMES.includes(stored as AppTheme)) {
      return stored as AppTheme;
    }
  } catch {
    // ignore
  }

  return "emerald";
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
    void window.electronAPI.auth.togglePopup({
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
      <section className="relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[32px] border border-white/8 bg-[#0a0d12] px-6 py-10 shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(120,140,255,0.2),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(100,214,255,0.14),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]" />
        <div className="relative w-full max-w-xl rounded-[28px] border border-white/10 bg-white/[0.03] px-6 py-8 text-center backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/88">
            <Loader2 size={22} className="animate-spin" />
          </div>
          <h2 className="mt-5 text-[30px] font-semibold tracking-[-0.04em] text-white">Building your workspace...</h2>
          <p className="mt-3 text-[14px] leading-7 text-white/62">
            Holaboss is preparing your workspace and wiring the desktop surface around it.
          </p>
          <div className="mt-7 overflow-hidden rounded-full border border-white/8 bg-white/[0.04] p-1">
            <div className="h-2 rounded-full bg-[linear-gradient(90deg,rgba(118,130,255,0.72),rgba(104,218,255,0.9),rgba(235,245,255,0.96))] animate-pulse" />
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/38">
            <span className="h-1.5 w-1.5 rounded-full bg-white/45" />
            <span>Provisioning runtime</span>
            <span className="h-1.5 w-1.5 rounded-full bg-white/45" />
            <span>Scaffolding files</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(120,130,255,0.18),transparent_24%),radial-gradient(circle_at_82%_20%,rgba(90,170,255,0.12),transparent_24%),radial-gradient(circle_at_50%_100%,rgba(255,255,255,0.05),transparent_42%),linear-gradient(135deg,#090d14_0%,#0c1018_48%,#0a0d14_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:96px_96px]" />
      <div className="relative flex w-full max-w-[1380px] flex-1 items-center justify-center">
        <div className="mx-auto w-full rounded-[34px] border border-white/8 bg-black/18 px-6 py-8 shadow-[0_30px_100px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.03)] sm:px-8 sm:py-9 lg:px-12 lg:py-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] uppercase tracking-[0.26em] text-white/52">
              <Sparkles size={14} className="text-white/58" />
              <span>Workspace onboarding</span>
            </div>
            <h1 className="mt-6 text-[38px] font-semibold tracking-[-0.05em] text-white sm:text-[50px]">Welcome to Holaboss</h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-8 text-white/62 sm:text-[16px]">
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
              badge="Login Required"
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
            <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/40">Marketplace access</div>
                  <div className="mt-2 text-[22px] font-medium tracking-[-0.03em] text-white">
                    Sign in only if you want Holaboss marketplace features
                  </div>
                  <div className="mt-3 text-[14px] leading-7 text-white/60">
                    Local workspaces stay completely free and available without an account. Sign in only to browse curated marketplace
                    templates and other Holaboss-specific features.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMarketplaceAuthSheet(false)}
                  className="inline-flex h-10 items-center justify-center rounded-[14px] border border-white/10 px-3 text-[12px] text-white/56 transition hover:border-white/16 hover:text-white/78"
                >
                  Not now
                </button>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  ref={authButtonRef}
                  type="button"
                  onClick={openAuthPopup}
                  className="inline-flex h-11 items-center justify-center rounded-[16px] border border-white/12 bg-white/[0.08] px-4 text-[13px] font-medium text-white transition hover:border-white/18 hover:bg-white/[0.12]"
                >
                  Sign in to use Marketplace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMarketplaceAuthSheet(false);
                    setTemplateSourceMode("local");
                  }}
                  className="inline-flex h-11 items-center justify-center rounded-[16px] border border-white/10 px-4 text-[13px] text-white/62 transition hover:border-white/16 hover:text-white/82"
                >
                  Continue with Local Template
                </button>
              </div>
            </div>
          ) : null}

          <form
            onSubmit={handleCreateWorkspace}
            className="mt-8 grid gap-5 rounded-[28px] border border-white/10 bg-white/[0.035] p-5 backdrop-blur-2xl sm:p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] lg:gap-6"
          >
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-white/42">Workspace details</div>
                  <div className="mt-2 text-[22px] font-medium tracking-[-0.03em] text-white">Configure your first workspace</div>
                </div>
                <div className="inline-flex rounded-full border border-white/10 bg-black/20 p-1">
                  <button
                    type="button"
                    onClick={() => setTemplateSourceMode("local")}
                    className={`rounded-full px-4 py-2 text-[12px] transition ${
                      templateSourceMode === "local" ? "bg-white text-[#090d14]" : "text-white/56 hover:text-white"
                    }`}
                  >
                    Local
                  </button>
                  <button
                    type="button"
                    disabled={!canUseMarketplaceTemplates}
                    onClick={() => setTemplateSourceMode("marketplace")}
                    className={`rounded-full px-4 py-2 text-[12px] transition ${
                      templateSourceMode === "marketplace" && canUseMarketplaceTemplates
                        ? "bg-white text-[#090d14]"
                        : "text-white/56 hover:text-white"
                    } disabled:cursor-not-allowed disabled:text-white/28`}
                  >
                    Marketplace
                  </button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <label className="grid gap-2">
                  <span className="text-[11px] uppercase tracking-[0.22em] text-white/40">Workspace name</span>
                  <input
                    value={newWorkspaceName}
                    onChange={(event) => setNewWorkspaceName(event.target.value)}
                    placeholder="My first workspace"
                    className="h-12 rounded-[18px] border border-white/10 bg-black/25 px-4 text-[14px] text-white outline-none placeholder:text-white/28"
                  />
                </label>

                {templateSourceMode === "marketplace" ? (
                  <label className="grid gap-2">
                    <span className="text-[11px] uppercase tracking-[0.22em] text-white/40">Template source</span>
                    <select
                      value={selectedMarketplaceTemplate?.name || ""}
                      onChange={(event) => selectMarketplaceTemplate(event.target.value)}
                      disabled={!canUseMarketplaceTemplates || isLoadingMarketplaceTemplates || marketplaceTemplates.length === 0}
                      className="h-12 rounded-[18px] border border-white/10 bg-black/25 px-4 text-[14px] text-white outline-none disabled:text-white/28"
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
                    <span className="text-[11px] uppercase tracking-[0.22em] text-white/40">Template source</span>
                    <button
                      type="button"
                      onClick={() => void chooseTemplateFolder()}
                      className="flex h-12 items-center justify-between rounded-[18px] border border-white/10 bg-black/25 px-4 text-left text-[14px] text-white transition hover:border-white/16"
                    >
                      <span className="truncate">
                        {selectedTemplateFolder?.templateName || selectedTemplateFolder?.rootPath || "Choose local folder"}
                      </span>
                      <ArrowRight size={16} className="shrink-0 text-white/40" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4 text-left lg:min-h-full">
                <div className="flex items-center gap-2 text-[12px] font-medium text-white">
                  {templateSourceMode === "marketplace" ? <Sparkles size={15} /> : <FolderOpen size={15} />}
                  <span>{templateSourceMode === "marketplace" ? "Marketplace Template" : "Local Template"}</span>
                  {templateSourceMode === "marketplace" ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/48">
                      Login Required
                    </span>
                  ) : (
                    <span className="rounded-full border border-emerald-300/14 bg-emerald-300/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-100/80">
                      No login required
                    </span>
                  )}
                </div>
                <div className="mt-2 text-[13px] leading-7 text-white/58">
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
                    className="mt-4 inline-flex h-10 items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.05] px-3 text-[12px] font-medium text-white transition hover:border-white/16 hover:bg-white/[0.08]"
                  >
                    Unlock Marketplace
                  </button>
                ) : null}
              </div>
              <button
                type="submit"
                disabled={createDisabled}
                className="inline-flex h-12 items-center justify-center gap-3 self-end rounded-[18px] border border-white/12 bg-white px-5 text-[14px] font-medium text-[#090d14] transition hover:bg-white/92 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/10 disabled:text-white/35 lg:w-full"
              >
                <span>Create Workspace</span>
                <ArrowRight size={16} />
              </button>
            </div>

            {workspaceErrorMessage ? (
              <div className="rounded-[18px] border border-rose-200/12 bg-rose-200/8 px-4 py-3 text-[13px] leading-6 text-rose-100/88">
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
          ? "border-white/20 bg-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.25)]"
          : muted
            ? "border-white/8 bg-white/[0.025] opacity-80"
            : "border-white/10 bg-white/[0.04] hover:border-white/16 hover:bg-white/[0.06]"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_32%)] opacity-70" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-white/10 bg-black/20 text-white/82">
            {icon}
          </div>
          {badge ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-white/48">
              <LockKeyhole size={11} />
              <span>{badge}</span>
            </span>
          ) : null}
        </div>
        <div className="mt-6 text-[18px] font-medium tracking-[-0.02em] text-white">{title}</div>
        <div className="mt-2 text-[14px] leading-7 text-white/64">{description}</div>
        <div className="mt-4 text-[12px] uppercase tracking-[0.18em] text-white/38">{detail}</div>
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
  const { runtimeConfig, workspaces, selectedWorkspace, installedApps, isLoadingInstalledApps } = useWorkspaceDesktop();
  const [theme, setTheme] = useState<AppTheme>(loadTheme);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusPayload | null>(null);
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatusPayload | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<WorkbenchTab>(loadWorkbenchTab);
  const [lastManualWorkbenchTab, setLastManualWorkbenchTab] = useState<WorkbenchTab>(loadWorkbenchTab);
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
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    void window.electronAPI.ui.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(WORKBENCH_TAB_STORAGE_KEY, lastManualWorkbenchTab);
  }, [lastManualWorkbenchTab]);

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

  const handleLeftRailSelect = (item: LeftRailItem) => {
    setActiveLeftRailItem(item);
    if (item === "agent") {
      setAgentView({ type: "chat" });
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

  const agentMode = activeLeftRailItem === "agent";
  const activeAppId = activeLeftRailItem === "agent" && agentView.type === "app" ? agentView.appId : null;
  const activeApp = getWorkspaceAppDefinition(activeAppId, installedApps);
  const hasWorkspaces = workspaces.length > 0;
  const hasSelectedWorkspace = Boolean(selectedWorkspace);
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
          onReturnToChat={openAgentChat}
        />
      );
    }

    return (
      <InternalSurfacePane
        surface={agentView.surface}
        resourceId={agentView.resourceId}
        htmlContent={agentView.htmlContent}
        onReturnToChat={openAgentChat}
      />
    );
  }, [activeApp, activeAppId, agentView, hasSelectedWorkspace, installedApps, refreshRuntimeOutputs]);

  return (
    <main className="fixed inset-0 overflow-hidden text-[13px] text-text-main/90">
      <div className="theme-grid pointer-events-none absolute inset-0 bg-noise-grid bg-[size:22px_22px]" />
      <div className="theme-orb-primary pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full blur-3xl" />
      <div className="theme-orb-secondary pointer-events-none absolute -bottom-40 right-12 h-96 w-96 rounded-full blur-3xl" />

      <div className="relative z-10 grid h-full w-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-2 sm:gap-3 sm:p-3">
        {appUpdateStatus?.available ? (
          <UpdateReminder status={appUpdateStatus} onDismiss={handleDismissUpdate} onDownload={handleDownloadUpdate} />
        ) : null}

        {hasWorkspaces ? (
          <div className="relative min-w-0">
            <TopTabsBar
              theme={theme}
              onThemeChange={setTheme}
              agentMode={agentMode && hasWorkspaces}
              hasWorkspaces={hasWorkspaces}
              onOpenBrowserWorkbench={() => openWorkbench("browser")}
              onOpenFilesWorkbench={() => openWorkbench("files")}
              onToggleOperationsDrawer={toggleOperationsDrawer}
              activeWorkbenchTab={activeWorkbenchTab}
              workbenchOpen={workbenchOpen}
              operationsDrawerOpen={operationsDrawerOpen}
              onUserMenuToggle={(anchorBounds) => {
                void window.electronAPI.auth.togglePopup(anchorBounds);
              }}
            />
          </div>
        ) : null}

        {!hasWorkspaces ? (
          <FirstWorkspacePane />
        ) : (
          <div
            className={`relative grid min-h-0 gap-3 overflow-hidden ${
              agentMode && operationsDrawerOpen
                ? "lg:grid-cols-[220px_minmax(0,1fr)_380px]"
                : "lg:grid-cols-[220px_minmax(0,1fr)]"
            }`}
          >
            <LeftNavigationRail
              activeItem={activeLeftRailItem}
              onSelectItem={handleLeftRailSelect}
              activeAppId={activeAppId}
              installedApps={installedApps}
              isLoadingApps={isLoadingInstalledApps}
              onSelectApp={handleSelectWorkspaceApp}
            />

            <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden">
              <div className="min-h-0 overflow-hidden">
                {activeLeftRailItem === "agent" ? (
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

            {agentMode && !operationsDrawerOpen ? (
              <button
                type="button"
                onClick={() => setOperationsDrawerOpen(true)}
                className="absolute right-0 top-1/2 z-20 hidden -translate-y-1/2 items-center gap-2 rounded-l-[18px] border border-panel-border/50 bg-panel-bg/92 px-3 py-3 text-[11px] text-text-muted shadow-card backdrop-blur transition hover:border-neon-green/45 hover:text-neon-green lg:inline-flex"
              >
                <PanelRightOpen size={14} />
                <span>Open panel</span>
              </button>
            ) : null}

            {agentMode && operationsDrawerOpen ? (
              <div className="min-h-0 overflow-hidden">
                <OperationsDrawer
                  activeTab={activeOperationsTab}
                  onTabChange={setActiveOperationsTab}
                  onClose={() => setOperationsDrawerOpen(false)}
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
            ) : null}
          </div>
        )}
      </div>
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
