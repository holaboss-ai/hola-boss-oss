import { contextBridge, ipcRenderer } from "electron";

interface FileSystemEntry {
  name: string;
  absolutePath: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

interface ListDirectoryResponse {
  currentPath: string;
  parentPath: string | null;
  entries: FileSystemEntry[];
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

interface BrowserAnchorBoundsPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

type UiSettingsPaneSection = "account" | "billing" | "providers" | "settings" | "about";

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

interface AddressSuggestionPayload {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
}

type RuntimeStatus = "disabled" | "missing" | "starting" | "running" | "stopped" | "error";

interface RuntimeStatusPayload {
  status: RuntimeStatus;
  available: boolean;
  runtimeRoot: string | null;
  sandboxRoot: string | null;
  executablePath: string | null;
  url: string | null;
  pid: number | null;
  harness: string | null;
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
  providerModelGroups: RuntimeProviderModelGroupPayload[];
}

interface RuntimeProviderModelPayload {
  token: string;
  modelId: string;
}

interface RuntimeProviderModelGroupPayload {
  providerId: string;
  providerLabel: string;
  kind: string;
  models: RuntimeProviderModelPayload[];
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

interface WorkbenchOpenBrowserPayload {
  workspaceId?: string | null;
  url?: string | null;
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
  accepted_session_id: string | null;
  accepted_input_id: string | null;
  accepted_at: string | null;
}

interface TaskProposalListResponsePayload {
  proposals: TaskProposalRecordPayload[];
  count: number;
}

interface ProactiveStatusSnapshotPayload {
  state: string;
  detail: string | null;
  recorded_at: string | null;
}

interface ProactiveAgentStatusPayload {
  workspace_id: string;
  proposal_count: number;
  heartbeat: ProactiveStatusSnapshotPayload;
  bridge: ProactiveStatusSnapshotPayload;
  delivery_state: string;
  delivery_summary: string;
  delivery_detail: string | null;
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

interface AgentSessionRecordPayload {
  workspace_id: string;
  session_id: string;
  kind: string;
  title: string | null;
  parent_session_id: string | null;
  source_proposal_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface AgentSessionListResponsePayload {
  items: AgentSessionRecordPayload[];
  count: number;
}

interface TaskProposalAcceptPayload {
  proposal_id: string;
  task_name?: string | null;
  task_prompt?: string | null;
  session_id?: string | null;
  parent_session_id?: string | null;
  created_by?: string | null;
  priority?: number;
  model?: string | null;
}

interface TaskProposalAcceptResponsePayload {
  proposal: TaskProposalRecordPayload;
  session: AgentSessionRecordPayload;
  input: EnqueueSessionInputResponsePayload;
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

interface SessionOutputEventPayload {
  id: number;
  workspace_id: string;
  session_id: string;
  input_id: string;
  sequence: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface SessionOutputEventListResponsePayload {
  items: SessionOutputEventPayload[];
  count: number;
  last_event_id: number;
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

interface DesktopBillingOverviewPayload {
  hasHostedBillingAccount: boolean;
  planId: string;
  planName: string | null;
  planStatus: string;
  renewsAt: string | null;
  expiresAt: string | null;
  creditsBalance: number;
  totalAllocated: number;
  totalUsed: number;
  monthlyCreditsIncluded: number | null;
  monthlyCreditsUsed: number | null;
  dailyRefreshCredits: number | null;
  dailyRefreshTarget: number | null;
  lowBalanceThreshold: number;
  isLowBalance: boolean;
}

interface DesktopBillingUsageItemPayload {
  id: string;
  type: string;
  sourceType: string | null;
  reason: string | null;
  amount: number;
  absoluteAmount: number;
  createdAt: string;
}

interface DesktopBillingUsagePayload {
  items: DesktopBillingUsageItemPayload[];
  count: number;
}

interface DesktopBillingLinksPayload {
  billingPageUrl: string;
  addCreditsUrl: string;
  upgradeUrl: string;
  usageUrl: string;
}

interface HolabossCreateWorkspacePayload {
  holaboss_user_id: string;
  harness?: string | null;
  name: string;
  template_mode?: "template" | "empty" | "empty_onboarding" | null;
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

interface InstalledWorkspaceAppPayload {
  app_id: string;
  config_path: string;
  lifecycle: Record<string, string> | null;
  build_status?: string;
  ready: boolean;
  error: string | null;
}

interface InstalledWorkspaceAppListResponsePayload {
  apps: InstalledWorkspaceAppPayload[];
  count: number;
}

interface WorkspaceLifecycleBlockingAppPayload {
  app_id: string;
  status: string;
  error: string | null;
}

interface WorkspaceLifecyclePayload {
  workspace: WorkspaceRecordPayload;
  applications: InstalledWorkspaceAppPayload[];
  ready: boolean;
  reason: string | null;
  phase: string;
  phase_label: string;
  phase_detail: string | null;
  blocking_apps: WorkspaceLifecycleBlockingAppPayload[];
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

interface IntegrationCatalogResponsePayload {
  providers: {
    provider_id: string;
    display_name: string;
    description: string;
    auth_modes: string[];
    supports_oss: boolean;
    supports_managed: boolean;
    default_scopes: string[];
    docs_url: string | null;
  }[];
}

interface IntegrationConnectionPayload {
  connection_id: string;
  provider_id: string;
  owner_user_id: string;
  account_label: string;
  account_external_id: string | null;
  auth_mode: string;
  granted_scopes: string[];
  status: string;
  secret_ref: string | null;
  created_at: string;
  updated_at: string;
}

interface IntegrationConnectionListResponsePayload {
  connections: IntegrationConnectionPayload[];
}

interface IntegrationBindingListResponsePayload {
  bindings: {
    binding_id: string;
    workspace_id: string;
    target_type: string;
    target_id: string;
    integration_key: string;
    connection_id: string;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }[];
}

interface IntegrationBindingPayload {
  binding_id: string;
  workspace_id: string;
  target_type: string;
  target_id: string;
  integration_key: string;
  connection_id: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface IntegrationUpsertBindingPayload {
  connection_id: string;
  is_default?: boolean;
}

interface IntegrationCreateConnectionPayload {
  provider_id: string;
  owner_user_id: string;
  account_label: string;
  auth_mode: string;
  granted_scopes: string[];
  secret_ref?: string;
}

interface IntegrationUpdateConnectionPayload {
  status?: string;
  secret_ref?: string;
  account_label?: string;
}

interface OAuthAppConfigPayload {
  provider_id: string;
  client_id: string;
  client_secret: string;
  authorize_url: string;
  token_url: string;
  scopes: string[];
  redirect_port: number;
  created_at: string;
  updated_at: string;
}

interface OAuthAppConfigListResponsePayload {
  configs: OAuthAppConfigPayload[];
}

interface OAuthAppConfigUpsertPayload {
  client_id: string;
  client_secret: string;
  authorize_url: string;
  token_url: string;
  scopes: string[];
  redirect_port?: number;
}

interface OAuthAuthorizeResponsePayload {
  authorize_url: string;
  state: string;
}

interface ComposioConnectResult {
  redirect_url: string;
  connected_account_id: string;
  auth_config_id: string;
  expires_at: string | null;
}

interface ComposioAccountStatus {
  id: string;
  status: string;
  authConfigId: string | null;
  toolkitSlug: string | null;
  userId: string | null;
}

interface TemplateIntegrationRequirement {
  key: string;
  provider: string;
  required: boolean;
  app_id: string;
}

interface ResolveTemplateIntegrationsResult {
  requirements: TemplateIntegrationRequirement[];
  connected_providers: string[];
  missing_providers: string[];
}
contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node
  },
  fs: {
    listDirectory: (targetPath?: string | null, workspaceId?: string | null) =>
      ipcRenderer.invoke("fs:listDirectory", targetPath, workspaceId) as Promise<ListDirectoryResponse>,
    readFilePreview: (targetPath: string, workspaceId?: string | null) =>
      ipcRenderer.invoke("fs:readFilePreview", targetPath, workspaceId) as Promise<FilePreviewPayload>,
    writeTextFile: (targetPath: string, content: string, workspaceId?: string | null) =>
      ipcRenderer.invoke("fs:writeTextFile", targetPath, content, workspaceId) as Promise<FilePreviewPayload>,
    getBookmarks: (workspaceId?: string | null) =>
      ipcRenderer.invoke("fs:getBookmarks", workspaceId) as Promise<FileBookmarkPayload[]>,
    addBookmark: (targetPath: string, label?: string, workspaceId?: string | null) =>
      ipcRenderer.invoke("fs:addBookmark", targetPath, label, workspaceId) as Promise<FileBookmarkPayload[]>,
    removeBookmark: (bookmarkId: string) =>
      ipcRenderer.invoke("fs:removeBookmark", bookmarkId) as Promise<FileBookmarkPayload[]>,
    onBookmarksChange: (listener: (bookmarks: FileBookmarkPayload[]) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, bookmarks: FileBookmarkPayload[]) => listener(bookmarks);
      ipcRenderer.on("fs:bookmarks", wrapped);
      return () => ipcRenderer.removeListener("fs:bookmarks", wrapped);
    }
  },
  runtime: {
    getStatus: () => ipcRenderer.invoke("runtime:getStatus") as Promise<RuntimeStatusPayload>,
    restart: () => ipcRenderer.invoke("runtime:restart") as Promise<RuntimeStatusPayload>,
    getConfig: () => ipcRenderer.invoke("runtime:getConfig") as Promise<RuntimeConfigPayload>,
    getConfigDocument: () => ipcRenderer.invoke("runtime:getConfigDocument") as Promise<string>,
    setConfig: (payload: RuntimeConfigUpdatePayload) =>
      ipcRenderer.invoke("runtime:setConfig", payload) as Promise<RuntimeConfigPayload>,
    setConfigDocument: (rawDocument: string) =>
      ipcRenderer.invoke("runtime:setConfigDocument", rawDocument) as Promise<RuntimeConfigPayload>,
    exchangeBinding: (sandboxId: string) =>
      ipcRenderer.invoke("runtime:exchangeBinding", sandboxId) as Promise<RuntimeConfigPayload>,
    onConfigChange: (listener: (config: RuntimeConfigPayload) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, config: RuntimeConfigPayload) => listener(config);
      ipcRenderer.on("runtime:config", wrapped);
      return () => ipcRenderer.removeListener("runtime:config", wrapped);
    },
    onStateChange: (listener: (status: RuntimeStatusPayload) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, status: RuntimeStatusPayload) => listener(status);
      ipcRenderer.on("runtime:state", wrapped);
      return () => ipcRenderer.removeListener("runtime:state", wrapped);
    }
  },
  ui: {
    getTheme: () => ipcRenderer.invoke("ui:getTheme") as Promise<string>,
    toggleWindowSize: () => ipcRenderer.invoke("ui:toggleWindowSize") as Promise<void>,
    setTheme: (theme: string) => ipcRenderer.invoke("ui:setTheme", theme) as Promise<void>,
    openSettingsPane: (section?: UiSettingsPaneSection) => ipcRenderer.invoke("ui:openSettingsPane", section) as Promise<void>,
    openExternalUrl: (url: string) => ipcRenderer.invoke("ui:openExternalUrl", url) as Promise<void>,
    onThemeChange: (listener: (theme: string) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, theme: string) => listener(theme);
      ipcRenderer.on("ui:themeChanged", wrapped);
      return () => ipcRenderer.removeListener("ui:themeChanged", wrapped);
    },
    onOpenSettingsPane: (listener: (section: UiSettingsPaneSection) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, section: UiSettingsPaneSection) => listener(section);
      ipcRenderer.on("ui:openSettingsPane", wrapped);
      return () => ipcRenderer.removeListener("ui:openSettingsPane", wrapped);
    }
  },
  billing: {
    getOverview: () =>
      ipcRenderer.invoke("billing:getOverview") as Promise<DesktopBillingOverviewPayload>,
    getUsage: (limit?: number) =>
      ipcRenderer.invoke("billing:getUsage", limit) as Promise<DesktopBillingUsagePayload>,
    getLinks: () =>
      ipcRenderer.invoke("billing:getLinks") as Promise<DesktopBillingLinksPayload>,
  },
  appUpdate: {
    getStatus: () => ipcRenderer.invoke("appUpdate:getStatus") as Promise<AppUpdateStatusPayload>,
    checkNow: () => ipcRenderer.invoke("appUpdate:checkNow") as Promise<AppUpdateStatusPayload>,
    dismiss: (releaseTag?: string | null) => ipcRenderer.invoke("appUpdate:dismiss", releaseTag) as Promise<AppUpdateStatusPayload>,
    openDownload: () => ipcRenderer.invoke("appUpdate:openDownload") as Promise<void>,
    onStateChange: (listener: (status: AppUpdateStatusPayload) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, status: AppUpdateStatusPayload) => listener(status);
      ipcRenderer.on("appUpdate:state", wrapped);
      return () => ipcRenderer.removeListener("appUpdate:state", wrapped);
    }
  },
  workbench: {
    onOpenBrowser: (listener: (payload: WorkbenchOpenBrowserPayload) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: WorkbenchOpenBrowserPayload) => listener(payload);
      ipcRenderer.on("workbench:openBrowser", wrapped);
      return () => ipcRenderer.removeListener("workbench:openBrowser", wrapped);
    }
  },
  appSurface: {
    navigate: (workspaceId: string, appId: string, path?: string) =>
      ipcRenderer.invoke("appSurface:navigate", workspaceId, appId, path) as Promise<void>,
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke("appSurface:setBounds", bounds) as Promise<void>,
    reload: (appId: string) =>
      ipcRenderer.invoke("appSurface:reload", appId) as Promise<void>,
    destroy: (appId: string) =>
      ipcRenderer.invoke("appSurface:destroy", appId) as Promise<void>,
    hide: () =>
      ipcRenderer.invoke("appSurface:hide") as Promise<void>,
  },
  workspace: {
    getClientConfig: () => ipcRenderer.invoke("workspace:getClientConfig") as Promise<HolabossClientConfigPayload>,
    listMarketplaceTemplates: () =>
      ipcRenderer.invoke("workspace:listMarketplaceTemplates") as Promise<TemplateListResponsePayload>,
    pickTemplateFolder: () =>
      ipcRenderer.invoke("workspace:pickTemplateFolder") as Promise<TemplateFolderSelectionPayload>,
    listWorkspaces: () => ipcRenderer.invoke("workspace:listWorkspaces") as Promise<WorkspaceListResponsePayload>,
    getWorkspaceLifecycle: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:getWorkspaceLifecycle", workspaceId) as Promise<WorkspaceLifecyclePayload>,
    activateWorkspace: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:activateWorkspace", workspaceId) as Promise<WorkspaceLifecyclePayload>,
    listInstalledApps: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:listInstalledApps", workspaceId) as Promise<InstalledWorkspaceAppListResponsePayload>,
    removeInstalledApp: (workspaceId: string, appId: string) =>
      ipcRenderer.invoke("workspace:removeInstalledApp", workspaceId, appId) as Promise<void>,
    listOutputs: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:listOutputs", workspaceId) as Promise<WorkspaceOutputListResponsePayload>,
    listSkills: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:listSkills", workspaceId) as Promise<WorkspaceSkillListResponsePayload>,
    getWorkspaceRoot: (workspaceId: string) => ipcRenderer.invoke("workspace:getWorkspaceRoot", workspaceId) as Promise<string>,
    createWorkspace: (payload: HolabossCreateWorkspacePayload) =>
      ipcRenderer.invoke("workspace:createWorkspace", payload) as Promise<WorkspaceResponsePayload>,
    deleteWorkspace: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:deleteWorkspace", workspaceId) as Promise<WorkspaceResponsePayload>,
    listCronjobs: (workspaceId: string, enabledOnly?: boolean) =>
      ipcRenderer.invoke("workspace:listCronjobs", workspaceId, enabledOnly) as Promise<CronjobListResponsePayload>,
    createCronjob: (payload: CronjobCreatePayload) =>
      ipcRenderer.invoke("workspace:createCronjob", payload) as Promise<CronjobRecordPayload>,
    updateCronjob: (jobId: string, payload: CronjobUpdatePayload) =>
      ipcRenderer.invoke("workspace:updateCronjob", jobId, payload) as Promise<CronjobRecordPayload>,
    deleteCronjob: (jobId: string) =>
      ipcRenderer.invoke("workspace:deleteCronjob", jobId) as Promise<{ success: boolean }>,
    listTaskProposals: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:listTaskProposals", workspaceId) as Promise<TaskProposalListResponsePayload>,
    acceptTaskProposal: (payload: TaskProposalAcceptPayload) =>
      ipcRenderer.invoke("workspace:acceptTaskProposal", payload) as Promise<TaskProposalAcceptResponsePayload>,
    getProactiveStatus: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:getProactiveStatus", workspaceId) as Promise<ProactiveAgentStatusPayload>,
    updateTaskProposalState: (proposalId: string, state: string) =>
      ipcRenderer.invoke("workspace:updateTaskProposalState", proposalId, state) as Promise<TaskProposalStateUpdatePayload>,
    enqueueRemoteDemoTaskProposal: (payload: DemoTaskProposalRequestPayload) =>
      ipcRenderer.invoke("workspace:enqueueRemoteDemoTaskProposal", payload) as Promise<DemoTaskProposalEnqueueResponsePayload>,
    listAgentSessions: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:listAgentSessions", workspaceId) as Promise<AgentSessionListResponsePayload>,
    listRuntimeStates: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:listRuntimeStates", workspaceId) as Promise<SessionRuntimeStateListResponsePayload>,
    getSessionHistory: (payload: { sessionId: string; workspaceId: string }) =>
      ipcRenderer.invoke("workspace:getSessionHistory", payload) as Promise<SessionHistoryResponsePayload>,
    getSessionOutputEvents: (payload: { sessionId: string }) =>
      ipcRenderer.invoke("workspace:getSessionOutputEvents", payload) as Promise<SessionOutputEventListResponsePayload>,
    stageSessionAttachments: (payload: StageSessionAttachmentsPayload) =>
      ipcRenderer.invoke("workspace:stageSessionAttachments", payload) as Promise<StageSessionAttachmentsResponsePayload>,
    stageSessionAttachmentPaths: (payload: StageSessionAttachmentPathsPayload) =>
      ipcRenderer.invoke("workspace:stageSessionAttachmentPaths", payload) as Promise<StageSessionAttachmentsResponsePayload>,
    queueSessionInput: (payload: HolabossQueueSessionInputPayload) =>
      ipcRenderer.invoke("workspace:queueSessionInput", payload) as Promise<EnqueueSessionInputResponsePayload>,
    openSessionOutputStream: (payload: HolabossStreamSessionOutputsPayload) =>
      ipcRenderer.invoke("workspace:openSessionOutputStream", payload) as Promise<HolabossSessionStreamHandlePayload>,
    closeSessionOutputStream: (streamId: string, reason?: string) =>
      ipcRenderer.invoke("workspace:closeSessionOutputStream", streamId, reason) as Promise<void>,
    getSessionStreamDebug: () =>
      ipcRenderer.invoke("workspace:getSessionStreamDebug") as Promise<HolabossSessionStreamDebugEntry[]>,
    isVerboseTelemetryEnabled: () => ipcRenderer.invoke("workspace:isVerboseTelemetryEnabled") as Promise<boolean>,
    listIntegrationCatalog: () =>
      ipcRenderer.invoke("workspace:listIntegrationCatalog") as Promise<IntegrationCatalogResponsePayload>,
    listIntegrationConnections: (params?: { providerId?: string; ownerUserId?: string }) =>
      ipcRenderer.invoke("workspace:listIntegrationConnections", params) as Promise<IntegrationConnectionListResponsePayload>,
    listIntegrationBindings: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:listIntegrationBindings", workspaceId) as Promise<IntegrationBindingListResponsePayload>,
    upsertIntegrationBinding: (workspaceId: string, targetType: string, targetId: string, integrationKey: string, payload: IntegrationUpsertBindingPayload) =>
      ipcRenderer.invoke("workspace:upsertIntegrationBinding", workspaceId, targetType, targetId, integrationKey, payload) as Promise<IntegrationBindingPayload>,
    createIntegrationConnection: (payload: IntegrationCreateConnectionPayload) =>
      ipcRenderer.invoke("workspace:createIntegrationConnection", payload) as Promise<IntegrationConnectionPayload>,
    updateIntegrationConnection: (connectionId: string, payload: IntegrationUpdateConnectionPayload) =>
      ipcRenderer.invoke("workspace:updateIntegrationConnection", connectionId, payload) as Promise<IntegrationConnectionPayload>,
    deleteIntegrationConnection: (connectionId: string) =>
      ipcRenderer.invoke("workspace:deleteIntegrationConnection", connectionId) as Promise<{ deleted: boolean }>,
    deleteIntegrationBinding: (bindingId: string, workspaceId: string) =>
      ipcRenderer.invoke("workspace:deleteIntegrationBinding", bindingId, workspaceId) as Promise<{ deleted: boolean }>,
    listOAuthConfigs: () =>
      ipcRenderer.invoke("workspace:listOAuthConfigs") as Promise<OAuthAppConfigListResponsePayload>,
    upsertOAuthConfig: (providerId: string, payload: OAuthAppConfigUpsertPayload) =>
      ipcRenderer.invoke("workspace:upsertOAuthConfig", providerId, payload) as Promise<OAuthAppConfigPayload>,
    deleteOAuthConfig: (providerId: string) =>
      ipcRenderer.invoke("workspace:deleteOAuthConfig", providerId) as Promise<{ deleted: boolean }>,
    startOAuthFlow: (provider: string) =>
      ipcRenderer.invoke("workspace:startOAuthFlow", provider) as Promise<OAuthAuthorizeResponsePayload>,
    composioListToolkits: () =>
      ipcRenderer.invoke("workspace:composioListToolkits") as Promise<{ toolkits: Array<{ slug: string; name: string; description: string; logo: string | null; auth_schemes: string[]; categories: string[] }> }>,
    composioConnect: (payload: { provider: string; owner_user_id: string; callback_url?: string }) =>
      ipcRenderer.invoke("workspace:composioConnect", payload) as Promise<ComposioConnectResult>,
    composioAccountStatus: (connectedAccountId: string) =>
      ipcRenderer.invoke("workspace:composioAccountStatus", connectedAccountId) as Promise<ComposioAccountStatus>,
    composioFinalize: (payload: { connected_account_id: string; provider: string; owner_user_id: string; account_label?: string }) =>
      ipcRenderer.invoke("workspace:composioFinalize", payload) as Promise<IntegrationConnectionPayload>,
    resolveTemplateIntegrations: (payload: HolabossCreateWorkspacePayload) =>
      ipcRenderer.invoke("workspace:resolveTemplateIntegrations", payload) as Promise<ResolveTemplateIntegrationsResult>,
    generateTemplateContent: (params: {
      contentType: "onboarding" | "readme";
      name: string;
      description: string;
      category: string;
      tags: string[];
      apps: string[];
    }) =>
      ipcRenderer.invoke("workspace:generateTemplateContent", params) as Promise<{ content: string }>,
    createSubmission: (payload: CreateSubmissionPayload) =>
      ipcRenderer.invoke("workspace:createSubmission", payload) as Promise<CreateSubmissionResponse>,
    packageAndUploadWorkspace: (params: {
      workspaceId: string;
      apps: string[];
      manifest: Record<string, unknown>;
      uploadUrl: string;
    }) =>
      ipcRenderer.invoke("workspace:packageAndUploadWorkspace", params) as Promise<PackageAndUploadResult>,
    finalizeSubmission: (submissionId: string) =>
      ipcRenderer.invoke("workspace:finalizeSubmission", submissionId) as Promise<FinalizeSubmissionResponse>,
    onSessionStreamEvent: (listener: (payload: HolabossSessionStreamEventPayload) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: HolabossSessionStreamEventPayload) => listener(payload);
      ipcRenderer.on("workspace:sessionStream", wrapped);
      return () => ipcRenderer.removeListener("workspace:sessionStream", wrapped);
    }
  },
  auth: {
    getUser: () => ipcRenderer.invoke("auth:getUser") as Promise<AuthUserPayload | null>,
    requestAuth: () => ipcRenderer.invoke("auth:requestAuth") as Promise<void>,
    signOut: () => ipcRenderer.invoke("auth:signOut") as Promise<void>,
    showPopup: (anchorBounds: BrowserAnchorBoundsPayload) => ipcRenderer.invoke("auth:showPopup", anchorBounds) as Promise<void>,
    togglePopup: (anchorBounds: BrowserAnchorBoundsPayload) => ipcRenderer.invoke("auth:togglePopup", anchorBounds) as Promise<void>,
    scheduleClosePopup: (delayMs?: number) => ipcRenderer.invoke("auth:scheduleClosePopup", delayMs) as Promise<void>,
    cancelClosePopup: () => ipcRenderer.invoke("auth:cancelClosePopup") as Promise<void>,
    closePopup: () => ipcRenderer.invoke("auth:closePopup") as Promise<void>,
    onAuthenticated: (listener: (user: AuthUserPayload) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, user: AuthUserPayload) => listener(user);
      ipcRenderer.on("auth:authenticated", wrapped);
      return () => ipcRenderer.removeListener("auth:authenticated", wrapped);
    },
    onUserUpdated: (listener: (user: AuthUserPayload | null) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, user: AuthUserPayload | null) => listener(user);
      ipcRenderer.on("auth:userUpdated", wrapped);
      return () => ipcRenderer.removeListener("auth:userUpdated", wrapped);
    },
    onError: (listener: (payload: AuthErrorPayload) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: AuthErrorPayload) => listener(payload);
      ipcRenderer.on("auth:error", wrapped);
      return () => ipcRenderer.removeListener("auth:error", wrapped);
    }
  },
  browser: {
    setActiveWorkspace: (workspaceId?: string | null) =>
      ipcRenderer.invoke("browser:setActiveWorkspace", workspaceId) as Promise<BrowserTabListPayload>,
    getState: () => ipcRenderer.invoke("browser:getState") as Promise<BrowserTabListPayload>,
    setBounds: (bounds: BrowserBoundsPayload) => ipcRenderer.invoke("browser:setBounds", bounds) as Promise<BrowserTabListPayload>,
    navigate: (targetUrl: string) => ipcRenderer.invoke("browser:navigate", targetUrl) as Promise<BrowserTabListPayload>,
    back: () => ipcRenderer.invoke("browser:back") as Promise<BrowserTabListPayload>,
    forward: () => ipcRenderer.invoke("browser:forward") as Promise<BrowserTabListPayload>,
    reload: () => ipcRenderer.invoke("browser:reload") as Promise<BrowserTabListPayload>,
    newTab: (targetUrl?: string) => ipcRenderer.invoke("browser:newTab", targetUrl) as Promise<BrowserTabListPayload>,
    setActiveTab: (tabId: string) => ipcRenderer.invoke("browser:setActiveTab", tabId) as Promise<BrowserTabListPayload>,
    closeTab: (tabId: string) => ipcRenderer.invoke("browser:closeTab", tabId) as Promise<BrowserTabListPayload>,
    getBookmarks: () => ipcRenderer.invoke("browser:getBookmarks") as Promise<BrowserBookmarkPayload[]>,
    addBookmark: (payload: { url: string; title?: string }) =>
      ipcRenderer.invoke("browser:addBookmark", payload) as Promise<BrowserBookmarkPayload[]>,
    removeBookmark: (bookmarkId: string) =>
      ipcRenderer.invoke("browser:removeBookmark", bookmarkId) as Promise<BrowserBookmarkPayload[]>,
    getDownloads: () => ipcRenderer.invoke("browser:getDownloads") as Promise<BrowserDownloadPayload[]>,
    getHistory: () => ipcRenderer.invoke("browser:getHistory") as Promise<BrowserHistoryEntryPayload[]>,
    showAddressSuggestions: (
      anchorBounds: BrowserAnchorBoundsPayload,
      suggestions: AddressSuggestionPayload[],
      selectedIndex: number
    ) => ipcRenderer.invoke("browser:showAddressSuggestions", anchorBounds, suggestions, selectedIndex) as Promise<void>,
    hideAddressSuggestions: () => ipcRenderer.invoke("browser:hideAddressSuggestions") as Promise<void>,
    toggleOverflowPopup: (anchorBounds: BrowserAnchorBoundsPayload) =>
      ipcRenderer.invoke("browser:toggleOverflowPopup", anchorBounds) as Promise<void>,
    toggleHistoryPopup: (anchorBounds: BrowserAnchorBoundsPayload) =>
      ipcRenderer.invoke("browser:toggleHistoryPopup", anchorBounds) as Promise<void>,
    removeHistoryEntry: (historyId: string) =>
      ipcRenderer.invoke("browser:removeHistoryEntry", historyId) as Promise<BrowserHistoryEntryPayload[]>,
    clearHistory: () => ipcRenderer.invoke("browser:clearHistory") as Promise<BrowserHistoryEntryPayload[]>,
    toggleDownloadsPopup: (anchorBounds: BrowserAnchorBoundsPayload) =>
      ipcRenderer.invoke("browser:toggleDownloadsPopup", anchorBounds) as Promise<void>,
    showDownloadInFolder: (downloadId: string) => ipcRenderer.invoke("browser:showDownloadInFolder", downloadId) as Promise<boolean>,
    openDownload: (downloadId: string) => ipcRenderer.invoke("browser:openDownload", downloadId) as Promise<string>,
    closeDownloadsPopup: () => ipcRenderer.invoke("browser:closeDownloadsPopup") as Promise<void>,
    onStateChange: (listener: (state: BrowserTabListPayload) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: BrowserTabListPayload) => listener(state);
      ipcRenderer.on("browser:state", wrapped);
      return () => ipcRenderer.removeListener("browser:state", wrapped);
    },
    onBookmarksChange: (listener: (bookmarks: BrowserBookmarkPayload[]) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, bookmarks: BrowserBookmarkPayload[]) => listener(bookmarks);
      ipcRenderer.on("browser:bookmarks", wrapped);
      return () => ipcRenderer.removeListener("browser:bookmarks", wrapped);
    },
    onDownloadsChange: (listener: (downloads: BrowserDownloadPayload[]) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, downloads: BrowserDownloadPayload[]) => listener(downloads);
      ipcRenderer.on("browser:downloads", wrapped);
      return () => ipcRenderer.removeListener("browser:downloads", wrapped);
    },
    onHistoryChange: (listener: (history: BrowserHistoryEntryPayload[]) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, history: BrowserHistoryEntryPayload[]) => listener(history);
      ipcRenderer.on("browser:history", wrapped);
      return () => ipcRenderer.removeListener("browser:history", wrapped);
    },
    onAddressSuggestionChosen: (listener: (index: number) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, index: number) => listener(index);
      ipcRenderer.on("browser:addressSuggestionChosen", wrapped);
      return () => ipcRenderer.removeListener("browser:addressSuggestionChosen", wrapped);
    }
  }
});
