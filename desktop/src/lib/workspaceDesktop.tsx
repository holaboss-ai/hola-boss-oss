import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { type AuthSession, useDesktopAuthSession } from "@/lib/auth/authClient";
import { hydrateInstalledWorkspaceApps, type WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

const ONBOARDING_ACTIVE_STATUSES = new Set(["pending", "awaiting_confirmation", "in_progress"]);
const LOCAL_OSS_TEMPLATE_USER_ID = "local-oss";
const DEFAULT_WORKSPACE_HARNESS: WorkspaceHarnessId = "opencode";
type TemplateSourceMode = "local" | "marketplace" | "empty" | "empty_onboarding";
type LifecycleStepState = "pending" | "current" | "done" | "error";

export interface WorkspaceHarnessOption {
  id: "opencode" | "pi";
  label: string;
  description: string;
}

type WorkspaceHarnessId = WorkspaceHarnessOption["id"];

const WORKSPACE_HARNESS_OPTIONS: WorkspaceHarnessOption[] = [
  {
    id: "opencode",
    label: "OpenCode",
    description: "Default harness with backend bootstrapping and structured output support."
  },
  {
    id: "pi",
    label: "Pi",
    description: "Lean harness path without backend bootstrapping."
  }
];

export interface DesktopLifecycleStep {
  id: "signed_in" | "runtime_provisioned" | "sandbox_assigned" | "desktop_browser_ready" | "workspace_ready";
  label: string;
  state: LifecycleStepState;
  detail: string;
}

interface WorkspaceDesktopContextValue {
  runtimeConfig: RuntimeConfigPayload | null;
  runtimeStatus: RuntimeStatusPayload | null;
  clientConfig: HolabossClientConfigPayload | null;
  workspaces: WorkspaceRecordPayload[];
  hasHydratedWorkspaceList: boolean;
  selectedWorkspace: WorkspaceRecordPayload | null;
  installedApps: WorkspaceInstalledAppDefinition[];
  isLoadingInstalledApps: boolean;
  isActivatingWorkspace: boolean;
  workspaceAppsReady: boolean;
  workspaceBlockingReason: string;
  refreshInstalledApps: () => Promise<void>;
  templateSourceMode: TemplateSourceMode;
  setTemplateSourceMode: (value: TemplateSourceMode) => void;
  createHarnessOptions: WorkspaceHarnessOption[];
  selectedCreateHarness: WorkspaceHarnessId;
  setSelectedCreateHarness: (value: string) => void;
  selectedTemplateFolder: TemplateFolderSelectionPayload | null;
  marketplaceTemplates: TemplateMetadataPayload[];
  selectedMarketplaceTemplate: TemplateMetadataPayload | null;
  selectMarketplaceTemplate: (templateName: string) => void;
  newWorkspaceName: string;
  setNewWorkspaceName: (value: string) => void;
  resolvedUserId: string;
  isLoadingBootstrap: boolean;
  isRefreshing: boolean;
  isCreatingWorkspace: boolean;
  deletingWorkspaceId: string | null;
  isLoadingMarketplaceTemplates: boolean;
  canUseMarketplaceTemplates: boolean;
  marketplaceTemplatesError: string;
  retryMarketplaceTemplates: () => void;
  workspaceErrorMessage: string;
  statusSummary: string;
  lifecycleSteps: DesktopLifecycleStep[];
  setupStatus: {
    tone: "info" | "success" | "warning";
    message: string;
  } | null;
  onboardingModeActive: boolean;
  sessionModeLabel: string;
  sessionTargetId: string;
  refreshWorkspaceData: () => Promise<void>;
  chooseTemplateFolder: () => Promise<void>;
  createWorkspace: () => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  removeInstalledApp: (appId: string) => Promise<void>;
}

const WorkspaceDesktopContext = createContext<WorkspaceDesktopContextValue | null>(null);

function sessionUserId(session: AuthSession | null): string {
  if (!session || typeof session !== "object") {
    return "";
  }

  const maybeUser = "user" in session ? session.user : null;
  if (!maybeUser || typeof maybeUser !== "object") {
    return "";
  }

  return typeof maybeUser.id === "string" ? maybeUser.id : "";
}

function normalizeWorkspaceHarness(value: string | null | undefined): WorkspaceHarnessId {
  return value?.trim().toLowerCase() === "pi" ? "pi" : "opencode";
}

function normalizeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  const normalized = message.trim().toLowerCase();

  if (normalized.includes("workspace:listworkspaces")) {
    return "Couldn't load workspace state right now. The local runtime may still be starting.";
  }

  if (normalized.includes("internal server error")) {
    return "The local runtime hit an internal error. Try again in a moment.";
  }

  if (normalized.includes("error invoking remote method")) {
    return "The desktop app couldn't complete that request. Try again in a moment.";
  }

  return message;
}

function normalizedOnboardingStatus(workspace: WorkspaceRecordPayload | null): string {
  return (workspace?.onboarding_status || "").trim().toLowerCase();
}

function isOnboardingMode(workspace: WorkspaceRecordPayload | null): boolean {
  if (!workspace) {
    return false;
  }
  const onboardingSessionId = (workspace.onboarding_session_id || "").trim();
  if (!onboardingSessionId) {
    return false;
  }
  return ONBOARDING_ACTIVE_STATUSES.has(normalizedOnboardingStatus(workspace));
}

export function WorkspaceDesktopProvider({ children }: { children: ReactNode }) {
  const sessionState = useDesktopAuthSession();
  const session = sessionState.data;
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceSelection();
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigPayload | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusPayload | null>(null);
  const [clientConfig, setClientConfig] = useState<HolabossClientConfigPayload | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecordPayload[]>([]);
  const [hasHydratedWorkspaceList, setHasHydratedWorkspaceList] = useState(false);
  const [installedApps, setInstalledApps] = useState<WorkspaceInstalledAppDefinition[]>([]);
  const [templateSourceMode, setTemplateSourceModeState] = useState<TemplateSourceMode>("local");
  const [selectedCreateHarness, setSelectedCreateHarnessState] = useState<WorkspaceHarnessId>(DEFAULT_WORKSPACE_HARNESS);
  const [selectedTemplateFolder, setSelectedTemplateFolder] = useState<TemplateFolderSelectionPayload | null>(null);
  const [marketplaceTemplates, setMarketplaceTemplates] = useState<TemplateMetadataPayload[]>([]);
  const [selectedMarketplaceTemplateName, setSelectedMarketplaceTemplateName] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isLoadingBootstrap, setIsLoadingBootstrap] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);
  const [isLoadingMarketplaceTemplates, setIsLoadingMarketplaceTemplates] = useState(false);
  const [marketplaceTemplatesError, setMarketplaceTemplatesError] = useState("");
  const [marketplaceTemplatesRefreshKey, setMarketplaceTemplatesRefreshKey] = useState(0);
  const [workspaceErrorMessage, setWorkspaceErrorMessage] = useState("");
  const [isLoadingInstalledApps, setIsLoadingInstalledApps] = useState(false);
  const [isActivatingWorkspace, setIsActivatingWorkspace] = useState(false);
  const [workspaceLifecycleWorkspaceId, setWorkspaceLifecycleWorkspaceId] = useState("");
  const [workspaceAppsReadyState, setWorkspaceAppsReadyState] = useState(false);
  const [workspaceBlockingReasonState, setWorkspaceBlockingReasonState] = useState("");
  const [recentAuthCompletedAt, setRecentAuthCompletedAt] = useState<number | null>(null);

  const isSignedIn = Boolean(sessionUserId(session));
  const resolvedUserId = runtimeConfig?.userId?.trim() || sessionUserId(session);
  const canUseMarketplaceTemplates = Boolean(runtimeConfig?.authTokenPresent) && Boolean((resolvedUserId || "").trim());
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces]
  );
  const selectedMarketplaceTemplate = useMemo(
    () => marketplaceTemplates.find((template) => template.name === selectedMarketplaceTemplateName) ?? null,
    [marketplaceTemplates, selectedMarketplaceTemplateName]
  );
  const onboardingModeActive = useMemo(() => isOnboardingMode(selectedWorkspace), [selectedWorkspace]);
  const sessionModeLabel = onboardingModeActive ? "onboarding" : "main";
  const sessionTargetId = onboardingModeActive
    ? (selectedWorkspace?.onboarding_session_id || "").trim()
    : (selectedWorkspace?.main_session_id || "").trim();
  const runtimeReadyForWorkspaceData = runtimeStatus?.status === "running";
  const workspaceLifecycleMatchesSelection = Boolean(selectedWorkspaceId) && workspaceLifecycleWorkspaceId === selectedWorkspaceId;
  const workspaceAppsReady = workspaceLifecycleMatchesSelection && workspaceAppsReadyState;
  const workspaceBlockingReason = workspaceLifecycleMatchesSelection ? workspaceBlockingReasonState : "";

  function setTemplateSourceMode(value: TemplateSourceMode) {
    setWorkspaceErrorMessage("");
    setTemplateSourceModeState(value);
  }

  function setSelectedCreateHarness(value: string) {
    setWorkspaceErrorMessage("");
    setSelectedCreateHarnessState(normalizeWorkspaceHarness(value));
  }

  function selectMarketplaceTemplate(templateName: string) {
    setWorkspaceErrorMessage("");
    setSelectedMarketplaceTemplateName(templateName);
  }

  function applyWorkspaceLifecycle(lifecycle: WorkspaceLifecyclePayload) {
    const hydratedApps = hydrateInstalledWorkspaceApps(lifecycle.applications);
    const workspaceStatus = (lifecycle.workspace.status || "").trim().toLowerCase();
    const noAppsRequireStartup =
      hydratedApps.length === 0 &&
      workspaceStatus !== "provisioning" &&
      workspaceStatus !== "error" &&
      workspaceStatus !== "deleted";

    setInstalledApps(hydratedApps);
    setWorkspaceLifecycleWorkspaceId(lifecycle.workspace.id);
    setWorkspaceAppsReadyState(noAppsRequireStartup || lifecycle.ready);
    setWorkspaceBlockingReasonState(noAppsRequireStartup ? "" : (lifecycle.phase_detail || lifecycle.reason || "").trim());
    setWorkspaces((current) => {
      const nextWorkspace = lifecycle.workspace;
      const existingIndex = current.findIndex((workspace) => workspace.id === nextWorkspace.id);
      if (existingIndex === -1) {
        return [nextWorkspace, ...current];
      }
      const next = [...current];
      next[existingIndex] = { ...next[existingIndex], ...nextWorkspace };
      return next;
    });
  }

  async function refreshInstalledApps() {
    if (!selectedWorkspaceId) {
      setInstalledApps([]);
      setIsLoadingInstalledApps(false);
      setWorkspaceLifecycleWorkspaceId("");
      setWorkspaceAppsReadyState(false);
      setWorkspaceBlockingReasonState("");
      return;
    }

    setIsLoadingInstalledApps(true);
    try {
      const response = await window.electronAPI.workspace.getWorkspaceLifecycle(selectedWorkspaceId);
      applyWorkspaceLifecycle(response);
    } catch (error) {
      setInstalledApps([]);
      setWorkspaceLifecycleWorkspaceId("");
      setWorkspaceAppsReadyState(false);
      setWorkspaceBlockingReasonState("");
      setWorkspaceErrorMessage((current) => current || normalizeErrorMessage(error));
    } finally {
      setIsLoadingInstalledApps(false);
    }
  }

  useLayoutEffect(() => {
    setInstalledApps([]);
    setWorkspaceLifecycleWorkspaceId("");
    setWorkspaceAppsReadyState(false);
    setWorkspaceBlockingReasonState("");
  }, [selectedWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadBootstrap() {
      setIsLoadingBootstrap(true);
      setWorkspaceErrorMessage("");

      try {
        const [nextRuntimeConfig, nextRuntimeStatus, nextClientConfig] = await Promise.all([
          window.electronAPI.runtime.getConfig(),
          window.electronAPI.runtime.getStatus(),
          window.electronAPI.workspace.getClientConfig()
        ]);
        if (cancelled) {
          return;
        }
        setRuntimeConfig(nextRuntimeConfig);
        setRuntimeStatus(nextRuntimeStatus);
        setClientConfig(nextClientConfig);
      } catch (error) {
        if (!cancelled) {
          setWorkspaceErrorMessage(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBootstrap(false);
        }
      }
    }

    void loadBootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
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
    let mounted = true;
    void window.electronAPI.runtime.getConfig().then((config) => {
      if (mounted) {
        setRuntimeConfig(config);
      }
    });

    const unsubscribe = window.electronAPI.runtime.onConfigChange((config) => {
      if (mounted) {
        setRuntimeConfig(config);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  async function loadWorkspaceData(options: { preserveSelection?: boolean; allowEmpty?: boolean } = {}) {
    const { preserveSelection = true, allowEmpty = false } = options;
    const workspaceResponse = await window.electronAPI.workspace.listWorkspaces();
    const nextWorkspaces = workspaceResponse.items;
    const shouldKeepPreviousWorkspaces = !allowEmpty && nextWorkspaces.length === 0 && workspaces.length > 0;
    const resolvedWorkspaces = shouldKeepPreviousWorkspaces ? workspaces : nextWorkspaces;

    setWorkspaces(resolvedWorkspaces);

    setSelectedWorkspaceId((current) => {
      const stored = preserveSelection ? current : "";
      if (stored && resolvedWorkspaces.some((workspace) => workspace.id === stored)) {
        return stored;
      }
      return resolvedWorkspaces[0]?.id ?? "";
    });
  }

  async function refreshWorkspaceData() {
    setIsRefreshing(true);
    setWorkspaceErrorMessage("");
    try {
      const [nextRuntimeConfig, nextRuntimeStatus] = await Promise.all([
        window.electronAPI.runtime.getConfig(),
        window.electronAPI.runtime.getStatus()
      ]);
      setRuntimeConfig(nextRuntimeConfig);
      setRuntimeStatus(nextRuntimeStatus);
      if (nextRuntimeStatus.status === "running") {
        await loadWorkspaceData({ preserveSelection: true });
      } else if (nextRuntimeStatus.status === "error" && nextRuntimeStatus.lastError.trim()) {
        setWorkspaceErrorMessage(nextRuntimeStatus.lastError.trim());
      }
    } catch (error) {
      setWorkspaceErrorMessage(normalizeErrorMessage(error));
    } finally {
      setHasHydratedWorkspaceList((current) => current || workspaces.length > 0);
      setIsRefreshing(false);
    }
  }

  async function createWorkspace() {
    setIsCreatingWorkspace(true);
    setWorkspaceErrorMessage("");
    try {
      const trimmedWorkspaceName = newWorkspaceName.trim() || "Desktop Workspace";
      let response: WorkspaceResponsePayload;
      if (templateSourceMode === "marketplace") {
        if (!canUseMarketplaceTemplates) {
          throw new Error("Runtime binding is required to use marketplace templates.");
        }
        if (!resolvedUserId) {
          throw new Error("A runtime user id is required for marketplace templates.");
        }
        if (!selectedMarketplaceTemplate) {
          throw new Error("Choose a marketplace template first.");
        }
        response = await window.electronAPI.workspace.createWorkspace({
          holaboss_user_id: resolvedUserId,
          harness: selectedCreateHarness,
          name: trimmedWorkspaceName,
          template_mode: "template",
          template_name: selectedMarketplaceTemplate.name
        });
      } else if (templateSourceMode === "empty" || templateSourceMode === "empty_onboarding") {
        response = await window.electronAPI.workspace.createWorkspace({
          holaboss_user_id: resolvedUserId || LOCAL_OSS_TEMPLATE_USER_ID,
          harness: selectedCreateHarness,
          name: trimmedWorkspaceName,
          template_mode: templateSourceMode === "empty_onboarding" ? "empty_onboarding" : "empty"
        });
      } else {
        if (!selectedTemplateFolder?.rootPath) {
          throw new Error("Choose a template folder first.");
        }
        response = await window.electronAPI.workspace.createWorkspace({
          holaboss_user_id: resolvedUserId || LOCAL_OSS_TEMPLATE_USER_ID,
          harness: selectedCreateHarness,
          name: trimmedWorkspaceName,
          template_mode: "template",
          template_root_path: selectedTemplateFolder.rootPath
        });
      }
      setNewWorkspaceName("");
      await loadWorkspaceData({ preserveSelection: false, allowEmpty: true });
      setSelectedWorkspaceId(response.workspace.id);
    } catch (error) {
      setWorkspaceErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsCreatingWorkspace(false);
    }
  }

  async function deleteWorkspace(workspaceId: string) {
    const trimmedWorkspaceId = workspaceId.trim();
    if (!trimmedWorkspaceId) {
      throw new Error("workspaceId is required");
    }
    setDeletingWorkspaceId(trimmedWorkspaceId);
    setWorkspaceErrorMessage("");
    try {
      await window.electronAPI.workspace.deleteWorkspace(trimmedWorkspaceId);
      await loadWorkspaceData({ preserveSelection: true, allowEmpty: true });
    } catch (error) {
      setWorkspaceErrorMessage(normalizeErrorMessage(error));
      throw error;
    } finally {
      setDeletingWorkspaceId((current) => (current === trimmedWorkspaceId ? null : current));
    }
  }

  async function removeInstalledApp(appId: string) {
    if (!selectedWorkspaceId) {
      return;
    }
    try {
      await window.electronAPI.workspace.removeInstalledApp(selectedWorkspaceId, appId);
      await refreshInstalledApps();
    } catch (error) {
      setWorkspaceErrorMessage(normalizeErrorMessage(error));
    }
  }

  function retryMarketplaceTemplates() {
    setMarketplaceTemplatesRefreshKey((k) => k + 1);
  }

  async function chooseTemplateFolder() {
    setWorkspaceErrorMessage("");
    try {
      const selection = await window.electronAPI.workspace.pickTemplateFolder();
      if (!selection.canceled && selection.rootPath) {
        setSelectedTemplateFolder(selection);
        setTemplateSourceModeState("local");
      }
    } catch (error) {
      setWorkspaceErrorMessage(normalizeErrorMessage(error));
    }
  }

  useEffect(() => {
    if (!canUseMarketplaceTemplates) {
      setMarketplaceTemplates([]);
      setSelectedMarketplaceTemplateName("");
      setMarketplaceTemplatesError("");
      setIsLoadingMarketplaceTemplates(false);
      if (templateSourceMode === "marketplace") {
        setTemplateSourceModeState("local");
      }
      return;
    }

    let cancelled = false;
    async function loadMarketplaceTemplates() {
      setIsLoadingMarketplaceTemplates(true);
      setMarketplaceTemplatesError("");
      try {
        const response = await window.electronAPI.workspace.listMarketplaceTemplates();
        if (cancelled) {
          return;
        }
        const visibleTemplates = response.templates.filter((template) => !template.is_hidden);
        setMarketplaceTemplates(visibleTemplates);
        setSelectedMarketplaceTemplateName((current) => {
          if (current && visibleTemplates.some((template) => template.name === current)) {
            return current;
          }
          return visibleTemplates.find((template) => !template.is_coming_soon)?.name || visibleTemplates[0]?.name || "";
        });
      } catch (error) {
        if (!cancelled) {
          setMarketplaceTemplates([]);
          setSelectedMarketplaceTemplateName("");
          setMarketplaceTemplatesError(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMarketplaceTemplates(false);
        }
      }
    }

    void loadMarketplaceTemplates();
    return () => {
      cancelled = true;
    };
  }, [canUseMarketplaceTemplates, resolvedUserId, marketplaceTemplatesRefreshKey]);

  useEffect(() => {
    let cancelled = false;

    if (isLoadingBootstrap) {
      return () => {
        cancelled = true;
      };
    }

    if (!runtimeReadyForWorkspaceData) {
      setIsRefreshing(false);
      setHasHydratedWorkspaceList((current) => current || workspaces.length > 0);
      if (runtimeStatus?.status === "error" && runtimeStatus.lastError.trim()) {
        setWorkspaceErrorMessage((current) => current || runtimeStatus.lastError.trim());
      }
      return () => {
        cancelled = true;
      };
    }

    async function refresh() {
      setIsRefreshing(true);
      setWorkspaceErrorMessage("");
      try {
        await loadWorkspaceData({ preserveSelection: true });
      } catch (error) {
        if (!cancelled) {
          setWorkspaceErrorMessage(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
          setHasHydratedWorkspaceList(true);
        }
      }
    }

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [isLoadingBootstrap, resolvedUserId, runtimeReadyForWorkspaceData, runtimeStatus?.lastError, runtimeStatus?.status, workspaces.length]);

  useEffect(() => {
    let cancelled = false;

    async function syncAfterAuthChange() {
      try {
        const [nextRuntimeConfig, nextRuntimeStatus] = await Promise.all([
          window.electronAPI.runtime.getConfig(),
          window.electronAPI.runtime.getStatus()
        ]);
        if (cancelled) {
          return;
        }
        setRuntimeConfig(nextRuntimeConfig);
        setRuntimeStatus(nextRuntimeStatus);

        const sessionUser = sessionUserId(session);
        if (sessionUser) {
          setRecentAuthCompletedAt(Date.now());
        }
      } catch {
        // best effort; status surface will continue to use last known values
      }
    }

    void syncAfterAuthChange();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!selectedWorkspaceId || !runtimeReadyForWorkspaceData) {
      setInstalledApps([]);
      setIsLoadingInstalledApps(false);
      setWorkspaceLifecycleWorkspaceId("");
      setWorkspaceAppsReadyState(false);
      setWorkspaceBlockingReasonState("");
      return;
    }

    let cancelled = false;

    async function activateSelectedWorkspace() {
      setIsLoadingInstalledApps(true);
      setIsActivatingWorkspace(true);
      try {
        const response = await window.electronAPI.workspace.activateWorkspace(selectedWorkspaceId);
        if (!cancelled) {
          applyWorkspaceLifecycle(response);
        }
      } catch (error) {
        if (!cancelled) {
          setInstalledApps([]);
          setWorkspaceLifecycleWorkspaceId("");
          setWorkspaceAppsReadyState(false);
          setWorkspaceBlockingReasonState("");
          setWorkspaceErrorMessage((current) => current || normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingInstalledApps(false);
          setIsActivatingWorkspace(false);
        }
      }
    }

    void activateSelectedWorkspace();
    return () => {
      cancelled = true;
    };
  }, [runtimeReadyForWorkspaceData, selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId || !runtimeReadyForWorkspaceData) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void window.electronAPI.workspace
        .getWorkspaceLifecycle(selectedWorkspaceId)
        .then((response) => {
          if (!cancelled) {
            applyWorkspaceLifecycle(response);
          }
        })
        .catch(() => undefined);
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runtimeReadyForWorkspaceData, selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId || !onboardingModeActive) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void window.electronAPI.workspace
        .listWorkspaces()
        .then((response) => {
          if (!cancelled) {
            setWorkspaces(response.items);
          }
        })
        .catch(() => undefined);
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedWorkspaceId, onboardingModeActive]);

  const statusSummary = useMemo(() => {
    const parts = [];
    if (clientConfig) {
      parts.push(clientConfig.hasApiKey ? "backend key ready" : "backend key missing");
    }
    if (runtimeConfig) {
      parts.push(runtimeConfig.authTokenPresent ? "runtime binding ready" : "runtime binding missing");
    }
    if (resolvedUserId) {
      parts.push(`user ${resolvedUserId}`);
    }
    return parts.join(" - ");
  }, [clientConfig, resolvedUserId, runtimeConfig]);

  const lifecycleSteps = useMemo<DesktopLifecycleStep[]>(() => {
    const signedIn = isSignedIn;
    const runtimeProvisioned = Boolean(runtimeConfig?.authTokenPresent);
    const sandboxAssigned = Boolean(runtimeConfig?.sandboxId?.trim());
    const desktopBrowserReady = Boolean(runtimeStatus?.desktopBrowserReady);
    const workspaceReady = Boolean(selectedWorkspace && workspaceAppsReady);
    const runtimeFailed = runtimeStatus?.status === "error";
    const workspaceFailed = Boolean(selectedWorkspace && selectedWorkspace.status.trim().toLowerCase() === "error");

    return [
      {
        id: "signed_in",
        label: "Signed in",
        state: signedIn ? "done" : "current",
        detail: signedIn ? "Desktop auth session is available." : "Sign in to sync product-backed desktop state."
      },
      {
        id: "runtime_provisioned",
        label: "Runtime provisioned",
        state: runtimeFailed ? "error" : runtimeProvisioned ? "done" : signedIn ? "current" : "pending",
        detail: runtimeFailed
          ? runtimeStatus?.lastError || "Embedded runtime failed to start."
          : runtimeProvisioned
            ? "Runtime token and binding are loaded."
            : "Waiting for runtime token provisioning."
      },
      {
        id: "sandbox_assigned",
        label: "Sandbox assigned",
        state: sandboxAssigned ? "done" : runtimeProvisioned ? "current" : "pending",
        detail: sandboxAssigned
          ? `Sandbox ${runtimeConfig?.sandboxId}`
          : "Waiting for a sandbox assignment in runtime config."
      },
      {
        id: "desktop_browser_ready",
        label: "Desktop browser ready",
        state: desktopBrowserReady ? "done" : runtimeStatus?.status === "starting" ? "current" : "pending",
        detail: desktopBrowserReady
          ? "Desktop browser service is registered for agent-triggered browsing."
          : "Desktop browser service has not finished registering yet."
      },
      {
        id: "workspace_ready",
        label: "Workspace ready",
        state: workspaceFailed ? "error" : workspaceReady ? "done" : selectedWorkspace ? "current" : "pending",
        detail: workspaceFailed
          ? selectedWorkspace?.error_message || "Workspace provisioning failed."
          : workspaceReady
            ? `${selectedWorkspace?.name || "Workspace"} is active and apps are running.`
            : selectedWorkspace
              ? workspaceBlockingReason || `Current workspace status: ${selectedWorkspace.status}.`
              : "Create or select a workspace to finish desktop routing."
      }
    ];
  }, [isSignedIn, runtimeConfig, runtimeStatus, selectedWorkspace, workspaceAppsReady, workspaceBlockingReason]);

  const setupStatus = useMemo(() => {
    if (!clientConfig && !runtimeConfig && !runtimeStatus) {
      return null;
    }

    if (!isSignedIn) {
      return {
        tone: "info" as const,
        message: "Local template import is available without sign-in. Sign in only for synced Holaboss product settings."
      };
    }

    if (runtimeConfig && !runtimeConfig.authTokenPresent) {
      return {
        tone: "info" as const,
        message:
          runtimeStatus?.status === "starting"
            ? "Signed in. Runtime is restarting and waiting for the workspace token to load."
            : "Signed in. Waiting for runtime token provisioning to complete."
      };
    }

    if (runtimeStatus?.status === "starting") {
      return {
        tone: "info" as const,
        message: "Runtime config loaded. Restarting runtime with your account configuration."
      };
    }

    if (runtimeStatus?.status === "error") {
      return {
        tone: "warning" as const,
        message: runtimeStatus.lastError || "Runtime failed to start with the current configuration."
      };
    }

    if (runtimeConfig?.authTokenPresent && runtimeStatus?.status === "running" && recentAuthCompletedAt) {
      const ageMs = Date.now() - recentAuthCompletedAt;
      if (ageMs < 45000) {
        return {
          tone: "success" as const,
          message: "Signed in successfully. Runtime config loaded and ready."
        };
      }
    }

    return null;
  }, [clientConfig, recentAuthCompletedAt, runtimeConfig, runtimeStatus, session]);

  // Auto-poll installed apps when any app is not yet ready.
  useEffect(() => {
    const hasInitializing = installedApps.some((app) => !app.ready);
    if (!hasInitializing || !selectedWorkspaceId) {
      return;
    }
    const timer = setInterval(() => {
      void refreshInstalledApps();
    }, 3000);
    return () => clearInterval(timer);
  }, [installedApps, selectedWorkspaceId]);

  const value = useMemo(
    () => ({
      runtimeConfig,
      runtimeStatus,
      clientConfig,
      workspaces,
      hasHydratedWorkspaceList,
      selectedWorkspace,
      installedApps,
      isLoadingInstalledApps,
      isActivatingWorkspace,
      workspaceAppsReady,
      workspaceBlockingReason,
      refreshInstalledApps,
      templateSourceMode,
      setTemplateSourceMode,
      createHarnessOptions: WORKSPACE_HARNESS_OPTIONS,
      selectedCreateHarness,
      setSelectedCreateHarness,
      selectedTemplateFolder,
      marketplaceTemplates,
      selectedMarketplaceTemplate,
      selectMarketplaceTemplate,
      newWorkspaceName,
      setNewWorkspaceName,
      resolvedUserId,
      isLoadingBootstrap,
      isRefreshing,
      isCreatingWorkspace,
      deletingWorkspaceId,
      isLoadingMarketplaceTemplates,
      canUseMarketplaceTemplates,
      marketplaceTemplatesError,
      retryMarketplaceTemplates,
      workspaceErrorMessage,
      statusSummary,
      lifecycleSteps,
      setupStatus,
      onboardingModeActive,
      sessionModeLabel,
      sessionTargetId,
      refreshWorkspaceData,
      chooseTemplateFolder,
      createWorkspace,
      deleteWorkspace,
      removeInstalledApp
    }),
    [
      runtimeConfig,
      runtimeStatus,
      clientConfig,
      workspaces,
      hasHydratedWorkspaceList,
      selectedWorkspace,
      installedApps,
      isLoadingInstalledApps,
      isActivatingWorkspace,
      workspaceAppsReady,
      workspaceBlockingReason,
      refreshInstalledApps,
      templateSourceMode,
      selectedCreateHarness,
      selectedTemplateFolder,
      marketplaceTemplates,
      selectedMarketplaceTemplate,
      newWorkspaceName,
      resolvedUserId,
      isLoadingBootstrap,
      isRefreshing,
      isCreatingWorkspace,
      deletingWorkspaceId,
      isLoadingMarketplaceTemplates,
      canUseMarketplaceTemplates,
      marketplaceTemplatesError,
      workspaceErrorMessage,
      statusSummary,
      lifecycleSteps,
      setupStatus,
      onboardingModeActive,
      sessionModeLabel,
      sessionTargetId,
      workspaceAppsReady,
      workspaceBlockingReason
    ]
  );

  return <WorkspaceDesktopContext.Provider value={value}>{children}</WorkspaceDesktopContext.Provider>;
}

export function useWorkspaceDesktop() {
  const context = useContext(WorkspaceDesktopContext);
  if (!context) {
    throw new Error("useWorkspaceDesktop must be used within WorkspaceDesktopProvider.");
  }
  return context;
}
