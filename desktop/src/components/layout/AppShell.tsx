import { useEffect, useMemo, useState } from "react";
import { PanelRightOpen } from "lucide-react";
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
import { UpdateReminder } from "@/components/ui/UpdateReminder";
import { preferredSessionId } from "@/lib/sessionRouting";
import { inferWorkspaceAppIdFromText } from "@/lib/workspaceApps";
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
  | { type: "internal"; surface: "document" | "preview" | "file" | "event"; resourceId?: string | null };

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
  const { runtimeConfig, selectedWorkspace } = useWorkspaceDesktop();
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
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);

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

  const runtimeInfo = useMemo(() => {
    if (!window.electronAPI) {
      return {
        label: "Web",
        detail: "Web runtime"
      };
    }

    const platformInfo = `${window.electronAPI.platform.toUpperCase()} - ELECTRON ${window.electronAPI.versions.electron}`;
    if (!runtimeStatus) {
      return {
        label: "Unknown",
        detail: `${platformInfo} - runtime unknown`
      };
    }

    const statusLabelByState: Record<RuntimeStatusPayload["status"], string> = {
      disabled: "Runtime disabled",
      missing: "Runtime missing",
      starting: "Runtime starting",
      running: "Runtime running",
      stopped: "Runtime stopped",
      error: "Runtime error"
    };

    return {
      label:
        runtimeStatus.status === "running"
          ? "Running"
          : runtimeStatus.status === "starting"
            ? "Starting"
            : runtimeStatus.status === "error"
              ? "Error"
              : runtimeStatus.status === "missing"
                ? "Missing"
                : runtimeStatus.status === "disabled"
                  ? "Disabled"
                  : "Stopped",
      detail: `${platformInfo} - ${statusLabelByState[runtimeStatus.status]}`
    };
  }, [runtimeStatus]);

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
    if (!selectedWorkspaceId) {
      setTaskProposals([]);
      setTaskProposalStatusMessage("");
      return;
    }

    setTaskProposalStatusMessage("");
    setIsLoadingTaskProposals(true);
    try {
      const response = await window.electronAPI.workspace.listTaskProposals(selectedWorkspaceId);
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
      const inferredAppId = inferWorkspaceAppIdFromText(`${proposal.task_name}\n${proposal.task_prompt}`);
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
    } finally {
      setProposalAction(null);
    }
  }

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setTaskProposals([]);
      setTaskProposalStatusMessage("");
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const response = await window.electronAPI.workspace.listTaskProposals(selectedWorkspaceId);
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
  }, [selectedWorkspaceId]);

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
      resourceId: entry.renderer.resourceId ?? entry.id
    });
  };

  const openAgentChat = () => {
    setActiveLeftRailItem("agent");
    setAgentView({ type: "chat" });
  };

  const agentMode = activeLeftRailItem === "agent";
  const activeAppId = activeLeftRailItem === "agent" && agentView.type === "app" ? agentView.appId : null;

  const agentContent = useMemo(() => {
    if (agentView.type === "chat") {
      return <ChatPane />;
    }

    if (agentView.type === "app") {
      return (
        <AppSurfacePane
          appId={agentView.appId}
          resourceId={agentView.resourceId}
          view={agentView.view}
          onReturnToChat={openAgentChat}
        />
      );
    }

    const title =
      agentView.surface === "document"
        ? "Internal document renderer"
        : agentView.surface === "preview"
          ? "Internal preview renderer"
          : agentView.surface === "file"
            ? "Internal file renderer"
            : "Internal event detail";
    const description =
      agentView.surface === "event"
        ? "This output stays within Holaboss itself instead of opening a workspace app. The routing contract is in place; a future pass can replace this placeholder with a dedicated internal viewer."
        : "This output is intended to stay inside the desktop shell rather than jumping into an installed app surface.";

    return (
      <FocusPlaceholder
        eyebrow="Internal Surface"
        title={title}
        description={`${description} Target id: ${agentView.resourceId ?? "n/a"}.`}
      />
    );
  }, [agentView]);

  return (
    <main className="fixed inset-0 overflow-hidden text-[13px] text-text-main/90">
      <div className="theme-grid pointer-events-none absolute inset-0 bg-noise-grid bg-[size:22px_22px]" />
      <div className="theme-orb-primary pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full blur-3xl" />
      <div className="theme-orb-secondary pointer-events-none absolute -bottom-40 right-12 h-96 w-96 rounded-full blur-3xl" />

      <div className="relative z-10 grid h-full w-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-2 sm:gap-3 sm:p-3">
        {appUpdateStatus?.available ? (
          <UpdateReminder status={appUpdateStatus} onDismiss={handleDismissUpdate} onDownload={handleDownloadUpdate} />
        ) : null}

        <div className="relative min-w-0">
          <TopTabsBar
            theme={theme}
            onThemeChange={setTheme}
            agentMode={agentMode}
            onOpenBrowserWorkbench={() => openWorkbench("browser")}
            onOpenFilesWorkbench={() => openWorkbench("files")}
            onToggleOperationsDrawer={toggleOperationsDrawer}
            activeWorkbenchTab={activeWorkbenchTab}
            workbenchOpen={workbenchOpen}
            operationsDrawerOpen={operationsDrawerOpen}
            onUserMenuToggle={(anchorBounds) => {
              void window.electronAPI.auth.togglePopup(anchorBounds);
            }}
            runtimeIndicator={{
              label: runtimeInfo.label,
              detail: runtimeInfo.detail,
              status: runtimeStatus?.status ?? null
            }}
          />
        </div>

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
                outputs={outputEntries}
                selectedOutputId={selectedOutputId}
                onSelectOutput={setSelectedOutputId}
                onOpenOutput={handleOpenOutput}
                onRefreshProposals={() => void refreshTaskProposals({ logErrors: true })}
                onTriggerProposal={() => void triggerRemoteTaskProposal()}
                onAcceptProposal={(proposal) => void acceptTaskProposal(proposal)}
                onDismissProposal={(proposal) => void dismissTaskProposal(proposal)}
                hasWorkspace={Boolean(selectedWorkspaceId)}
              />
            </div>
          ) : null}
        </div>
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
