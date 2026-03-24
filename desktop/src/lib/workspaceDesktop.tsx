import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { type AuthSession, useDesktopAuthSession } from "@/lib/auth/authClient";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

const ONBOARDING_ACTIVE_STATUSES = new Set(["pending", "awaiting_confirmation", "in_progress"]);
const LOCAL_OSS_TEMPLATE_USER_ID = "local-oss";

interface WorkspaceDesktopContextValue {
  runtimeConfig: RuntimeConfigPayload | null;
  runtimeStatus: RuntimeStatusPayload | null;
  clientConfig: HolabossClientConfigPayload | null;
  workspaces: WorkspaceRecordPayload[];
  selectedWorkspace: WorkspaceRecordPayload | null;
  selectedTemplateFolder: TemplateFolderSelectionPayload | null;
  newWorkspaceName: string;
  setNewWorkspaceName: (value: string) => void;
  resolvedUserId: string;
  isLoadingBootstrap: boolean;
  isRefreshing: boolean;
  isCreatingWorkspace: boolean;
  workspaceErrorMessage: string;
  statusSummary: string;
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

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
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
  const [selectedTemplateFolder, setSelectedTemplateFolder] = useState<TemplateFolderSelectionPayload | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isLoadingBootstrap, setIsLoadingBootstrap] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [workspaceErrorMessage, setWorkspaceErrorMessage] = useState("");
  const [recentAuthCompletedAt, setRecentAuthCompletedAt] = useState<number | null>(null);

  const resolvedUserId = runtimeConfig?.userId?.trim() || sessionUserId(session);
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces]
  );
  const onboardingModeActive = useMemo(() => isOnboardingMode(selectedWorkspace), [selectedWorkspace]);
  const sessionModeLabel = onboardingModeActive ? "onboarding" : "main";
  const sessionTargetId = onboardingModeActive
    ? (selectedWorkspace?.onboarding_session_id || "").trim()
    : (selectedWorkspace?.main_session_id || "").trim();

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

  async function loadWorkspaceData(preserveSelection = true) {
    const workspaceResponse = await window.electronAPI.workspace.listWorkspaces();
    const nextWorkspaces = workspaceResponse.items;
    setWorkspaces(nextWorkspaces);

    setSelectedWorkspaceId((current) => {
      const stored = preserveSelection ? current : "";
      if (stored && nextWorkspaces.some((workspace) => workspace.id === stored)) {
        return stored;
      }
      return nextWorkspaces[0]?.id ?? "";
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
      await loadWorkspaceData(true);
    } catch (error) {
      setWorkspaceErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function createWorkspace() {
    if (!selectedTemplateFolder?.rootPath) {
      setWorkspaceErrorMessage("Choose a template folder first.");
      return;
    }

    setIsCreatingWorkspace(true);
    setWorkspaceErrorMessage("");
    try {
      const response = await window.electronAPI.workspace.createWorkspace({
        holaboss_user_id: resolvedUserId || LOCAL_OSS_TEMPLATE_USER_ID,
        name: newWorkspaceName.trim() || "Desktop Workspace",
        template_root_path: selectedTemplateFolder.rootPath
      });
      setNewWorkspaceName("");
      await loadWorkspaceData(false);
      setSelectedWorkspaceId(response.workspace.id);
    } catch (error) {
      setWorkspaceErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsCreatingWorkspace(false);
    }
  }

  async function chooseTemplateFolder() {
    setWorkspaceErrorMessage("");
    try {
      const selection = await window.electronAPI.workspace.pickTemplateFolder();
      if (!selection.canceled && selection.rootPath) {
        setSelectedTemplateFolder(selection);
      }
    } catch (error) {
      setWorkspaceErrorMessage(normalizeErrorMessage(error));
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      setIsRefreshing(true);
      setWorkspaceErrorMessage("");
      try {
        await loadWorkspaceData(true);
      } catch (error) {
        if (!cancelled) {
          setWorkspaceErrorMessage(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [resolvedUserId]);

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

  const setupStatus = useMemo(() => {
    const isSignedIn = Boolean(sessionUserId(session));
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

  const value = useMemo(
    () => ({
      runtimeConfig,
      runtimeStatus,
      clientConfig,
      workspaces,
      selectedWorkspace,
      selectedTemplateFolder,
      newWorkspaceName,
      setNewWorkspaceName,
      resolvedUserId,
      isLoadingBootstrap,
      isRefreshing,
      isCreatingWorkspace,
      workspaceErrorMessage,
      statusSummary,
      setupStatus,
      onboardingModeActive,
      sessionModeLabel,
      sessionTargetId,
      refreshWorkspaceData,
      chooseTemplateFolder,
      createWorkspace
    }),
    [
      runtimeConfig,
      runtimeStatus,
      clientConfig,
      workspaces,
      selectedWorkspace,
      selectedTemplateFolder,
      newWorkspaceName,
      resolvedUserId,
      isLoadingBootstrap,
      isRefreshing,
      isCreatingWorkspace,
      workspaceErrorMessage,
      statusSummary,
      setupStatus,
      onboardingModeActive,
      sessionModeLabel,
      sessionTargetId
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
