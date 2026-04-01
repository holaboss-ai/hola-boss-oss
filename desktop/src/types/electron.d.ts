/// <reference types="vite/client" />

declare global {
  interface LocalFileEntry {
    name: string;
    absolutePath: string;
    isDirectory: boolean;
    size: number;
    modifiedAt: string;
  }

  interface LocalDirectoryResponse {
    currentPath: string;
    parentPath: string | null;
    entries: LocalFileEntry[];
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

  type UiSettingsPaneSection = "account" | "providers" | "settings" | "about";

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
    desktopBrowserReady: boolean;
    desktopBrowserUrl: string | null;
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

  interface SessionInputAttachmentPayload {
    id: string;
    kind: "image" | "file";
    name: string;
    mime_type: string;
    size_bytes: number;
    workspace_path: string;
  }

  interface StageSessionAttachmentFilePayload {
    name: string;
    mime_type?: string | null;
    content_base64: string;
  }

  interface StageSessionAttachmentsPayload {
    workspace_id: string;
    files: StageSessionAttachmentFilePayload[];
  }

  interface StageSessionAttachmentPathPayload {
    absolute_path: string;
    name?: string | null;
    mime_type?: string | null;
  }

  interface StageSessionAttachmentPathsPayload {
    workspace_id: string;
    files: StageSessionAttachmentPathPayload[];
  }

  interface StageSessionAttachmentsResponsePayload {
    attachments: SessionInputAttachmentPayload[];
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

  interface WorkspaceOutputRecordPayload {
    id: string;
    workspace_id: string;
    output_type: string;
    title: string;
    status: string;
    module_id: string | null;
    module_resource_id: string | null;
    file_path: string | null;
    html_content: string | null;
    session_id: string | null;
    artifact_id: string | null;
    folder_id: string | null;
    platform: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }

  interface WorkspaceOutputListResponsePayload {
    items: WorkspaceOutputRecordPayload[];
  }

  interface WorkspaceSkillRecordPayload {
    skill_id: string;
    source_dir: string;
    skill_file_path: string;
    title: string;
    summary: string;
    enabled: boolean;
    modified_at: string;
  }

  interface WorkspaceSkillListResponsePayload {
    workspace_id: string;
    workspace_root: string;
    skills_path: string;
    configured_path: string;
    enabled_skill_ids: string[];
    missing_enabled_skill_ids: string[];
    skills: WorkspaceSkillRecordPayload[];
  }

  interface AuthUserPayload {
    id: string;
    email?: string | null;
    name?: string | null;
    image?: string | null;
    personalXAccount?: string | null;
    timezone?: string | null;
    invitationVerified?: boolean | null;
    onboardingCompleted?: boolean | null;
    role?: string | null;
    [key: string]: unknown;
  }

  interface AuthErrorPayload {
    message?: string;
    status: number;
    statusText: string;
    path: string;
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
    template_apps?: string[];
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
    attachments?: SessionInputAttachmentPayload[] | null;
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

  interface IntegrationCatalogProviderPayload {
    provider_id: string;
    display_name: string;
    description: string;
    auth_modes: string[];
    supports_oss: boolean;
    supports_managed: boolean;
    default_scopes: string[];
    docs_url: string | null;
  }

  interface IntegrationCatalogResponsePayload {
    providers: IntegrationCatalogProviderPayload[];
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

  interface IntegrationBindingPayload {
    binding_id: string;
    workspace_id: string;
    target_type: "workspace" | "app" | "agent";
    target_id: string;
    integration_key: string;
    connection_id: string;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }

  interface IntegrationBindingListResponsePayload {
    bindings: IntegrationBindingPayload[];
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
  interface ElectronAPI {
    platform: string;
    versions: {
      chrome: string;
      electron: string;
      node: string;
    };
    fs: {
      listDirectory: (targetPath?: string | null, workspaceId?: string | null) => Promise<LocalDirectoryResponse>;
      readFilePreview: (targetPath: string, workspaceId?: string | null) => Promise<FilePreviewPayload>;
      writeTextFile: (targetPath: string, content: string, workspaceId?: string | null) => Promise<FilePreviewPayload>;
      getBookmarks: (workspaceId?: string | null) => Promise<FileBookmarkPayload[]>;
      addBookmark: (targetPath: string, label?: string, workspaceId?: string | null) => Promise<FileBookmarkPayload[]>;
      removeBookmark: (bookmarkId: string) => Promise<FileBookmarkPayload[]>;
      onBookmarksChange: (listener: (bookmarks: FileBookmarkPayload[]) => void) => () => void;
    };
    runtime: {
      getStatus: () => Promise<RuntimeStatusPayload>;
      restart: () => Promise<RuntimeStatusPayload>;
      getConfig: () => Promise<RuntimeConfigPayload>;
      getConfigDocument: () => Promise<string>;
      setConfig: (payload: RuntimeConfigUpdatePayload) => Promise<RuntimeConfigPayload>;
      setConfigDocument: (rawDocument: string) => Promise<RuntimeConfigPayload>;
      exchangeBinding: (sandboxId: string) => Promise<RuntimeConfigPayload>;
      onConfigChange: (listener: (config: RuntimeConfigPayload) => void) => () => void;
      onStateChange: (listener: (status: RuntimeStatusPayload) => void) => () => void;
    };
    ui: {
      getTheme: () => Promise<string>;
      toggleWindowSize: () => Promise<void>;
      setTheme: (theme: string) => Promise<void>;
      openSettingsPane: (section?: UiSettingsPaneSection) => Promise<void>;
      openExternalUrl: (url: string) => Promise<void>;
      onThemeChange: (listener: (theme: string) => void) => () => void;
      onOpenSettingsPane: (listener: (section: UiSettingsPaneSection) => void) => () => void;
    };
    appUpdate: {
      getStatus: () => Promise<AppUpdateStatusPayload>;
      checkNow: () => Promise<AppUpdateStatusPayload>;
      dismiss: (releaseTag?: string | null) => Promise<AppUpdateStatusPayload>;
      openDownload: () => Promise<void>;
      onStateChange: (listener: (status: AppUpdateStatusPayload) => void) => () => void;
    };
    workbench: {
      onOpenBrowser: (listener: (payload: WorkbenchOpenBrowserPayload) => void) => () => void;
    };
    appSurface: {
      navigate(workspaceId: string, appId: string, path?: string): Promise<void>;
      setBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
      reload(appId: string): Promise<void>;
      destroy(appId: string): Promise<void>;
      hide(): Promise<void>;
    };
    workspace: {
      getClientConfig: () => Promise<HolabossClientConfigPayload>;
      listMarketplaceTemplates: () => Promise<TemplateListResponsePayload>;
      pickTemplateFolder: () => Promise<TemplateFolderSelectionPayload>;
      listWorkspaces: () => Promise<WorkspaceListResponsePayload>;
      getWorkspaceLifecycle: (workspaceId: string) => Promise<WorkspaceLifecyclePayload>;
      activateWorkspace: (workspaceId: string) => Promise<WorkspaceLifecyclePayload>;
      listInstalledApps: (workspaceId: string) => Promise<InstalledWorkspaceAppListResponsePayload>;
      removeInstalledApp: (workspaceId: string, appId: string) => Promise<void>;
      listOutputs: (workspaceId: string) => Promise<WorkspaceOutputListResponsePayload>;
      listSkills: (workspaceId: string) => Promise<WorkspaceSkillListResponsePayload>;
      getWorkspaceRoot: (workspaceId: string) => Promise<string>;
      createWorkspace: (payload: HolabossCreateWorkspacePayload) => Promise<WorkspaceResponsePayload>;
      deleteWorkspace: (workspaceId: string) => Promise<WorkspaceResponsePayload>;
      listCronjobs: (workspaceId: string, enabledOnly?: boolean) => Promise<CronjobListResponsePayload>;
      createCronjob: (payload: CronjobCreatePayload) => Promise<CronjobRecordPayload>;
      updateCronjob: (jobId: string, payload: CronjobUpdatePayload) => Promise<CronjobRecordPayload>;
      deleteCronjob: (jobId: string) => Promise<{ success: boolean }>;
      listTaskProposals: (workspaceId: string) => Promise<TaskProposalListResponsePayload>;
      acceptTaskProposal: (payload: TaskProposalAcceptPayload) => Promise<TaskProposalAcceptResponsePayload>;
      getProactiveStatus: (workspaceId: string) => Promise<ProactiveAgentStatusPayload>;
      updateTaskProposalState: (proposalId: string, state: string) => Promise<TaskProposalStateUpdatePayload>;
      enqueueRemoteDemoTaskProposal: (
        payload: DemoTaskProposalRequestPayload
      ) => Promise<DemoTaskProposalEnqueueResponsePayload>;
      listAgentSessions: (workspaceId: string) => Promise<AgentSessionListResponsePayload>;
      listRuntimeStates: (workspaceId: string) => Promise<SessionRuntimeStateListResponsePayload>;
      getSessionHistory: (payload: { sessionId: string; workspaceId: string }) => Promise<SessionHistoryResponsePayload>;
      getSessionOutputEvents: (payload: { sessionId: string }) => Promise<SessionOutputEventListResponsePayload>;
      stageSessionAttachments: (payload: StageSessionAttachmentsPayload) => Promise<StageSessionAttachmentsResponsePayload>;
      stageSessionAttachmentPaths: (
        payload: StageSessionAttachmentPathsPayload
      ) => Promise<StageSessionAttachmentsResponsePayload>;
      queueSessionInput: (payload: HolabossQueueSessionInputPayload) => Promise<EnqueueSessionInputResponsePayload>;
      openSessionOutputStream: (payload: HolabossStreamSessionOutputsPayload) => Promise<HolabossSessionStreamHandlePayload>;
      closeSessionOutputStream: (streamId: string, reason?: string) => Promise<void>;
      getSessionStreamDebug: () => Promise<HolabossSessionStreamDebugEntry[]>;
      isVerboseTelemetryEnabled: () => Promise<boolean>;
      listIntegrationCatalog: () => Promise<IntegrationCatalogResponsePayload>;
      listIntegrationConnections: (params?: { providerId?: string; ownerUserId?: string }) => Promise<IntegrationConnectionListResponsePayload>;
      listIntegrationBindings: (workspaceId: string) => Promise<IntegrationBindingListResponsePayload>;
      upsertIntegrationBinding: (workspaceId: string, targetType: string, targetId: string, integrationKey: string, payload: IntegrationUpsertBindingPayload) => Promise<IntegrationBindingPayload>;
      createIntegrationConnection: (payload: IntegrationCreateConnectionPayload) => Promise<IntegrationConnectionPayload>;
      updateIntegrationConnection: (connectionId: string, payload: IntegrationUpdateConnectionPayload) => Promise<IntegrationConnectionPayload>;
      deleteIntegrationConnection: (connectionId: string) => Promise<{ deleted: boolean }>;
      deleteIntegrationBinding: (bindingId: string, workspaceId: string) => Promise<{ deleted: boolean }>;
      listOAuthConfigs: () => Promise<OAuthAppConfigListResponsePayload>;
      upsertOAuthConfig: (providerId: string, payload: OAuthAppConfigUpsertPayload) => Promise<OAuthAppConfigPayload>;
      deleteOAuthConfig: (providerId: string) => Promise<{ deleted: boolean }>;
      startOAuthFlow: (provider: string) => Promise<OAuthAuthorizeResponsePayload>;
      composioListToolkits: () => Promise<{ toolkits: Array<{ slug: string; name: string; description: string; logo: string | null; auth_schemes: string[]; categories: string[] }> }>;
      composioConnect: (payload: { provider: string; owner_user_id: string; callback_url?: string }) => Promise<ComposioConnectResult>;
      composioAccountStatus: (connectedAccountId: string) => Promise<ComposioAccountStatus>;
      composioFinalize: (payload: { connected_account_id: string; provider: string; owner_user_id: string; account_label?: string }) => Promise<IntegrationConnectionPayload>;
      resolveTemplateIntegrations: (payload: HolabossCreateWorkspacePayload) => Promise<ResolveTemplateIntegrationsResult>;
      onSessionStreamEvent: (listener: (payload: HolabossSessionStreamEventPayload) => void) => () => void;
    };
    auth: {
      getUser: () => Promise<AuthUserPayload | null>;
      requestAuth: () => Promise<void>;
      signOut: () => Promise<void>;
      showPopup: (anchorBounds: BrowserAnchorBoundsPayload) => Promise<void>;
      togglePopup: (anchorBounds: BrowserAnchorBoundsPayload) => Promise<void>;
      scheduleClosePopup: (delayMs?: number) => Promise<void>;
      cancelClosePopup: () => Promise<void>;
      closePopup: () => Promise<void>;
      onAuthenticated: (callback: (user: AuthUserPayload) => unknown) => () => void;
      onUserUpdated: (callback: (user: AuthUserPayload | null) => unknown) => () => void;
      onError: (callback: (context: AuthErrorPayload) => unknown) => () => void;
    };
    browser: {
      setActiveWorkspace: (workspaceId?: string | null) => Promise<BrowserTabListPayload>;
      getState: () => Promise<BrowserTabListPayload>;
      setBounds: (bounds: BrowserBoundsPayload) => Promise<BrowserTabListPayload>;
      navigate: (targetUrl: string) => Promise<BrowserTabListPayload>;
      back: () => Promise<BrowserTabListPayload>;
      forward: () => Promise<BrowserTabListPayload>;
      reload: () => Promise<BrowserTabListPayload>;
      newTab: (targetUrl?: string) => Promise<BrowserTabListPayload>;
      setActiveTab: (tabId: string) => Promise<BrowserTabListPayload>;
      closeTab: (tabId: string) => Promise<BrowserTabListPayload>;
      getBookmarks: () => Promise<BrowserBookmarkPayload[]>;
      addBookmark: (payload: { url: string; title?: string }) => Promise<BrowserBookmarkPayload[]>;
      removeBookmark: (bookmarkId: string) => Promise<BrowserBookmarkPayload[]>;
      getDownloads: () => Promise<BrowserDownloadPayload[]>;
      getHistory: () => Promise<BrowserHistoryEntryPayload[]>;
      showAddressSuggestions: (
        anchorBounds: BrowserAnchorBoundsPayload,
        suggestions: AddressSuggestionPayload[],
        selectedIndex: number
      ) => Promise<void>;
      hideAddressSuggestions: () => Promise<void>;
      toggleOverflowPopup: (anchorBounds: BrowserAnchorBoundsPayload) => Promise<void>;
      toggleHistoryPopup: (anchorBounds: BrowserAnchorBoundsPayload) => Promise<void>;
      removeHistoryEntry: (historyId: string) => Promise<BrowserHistoryEntryPayload[]>;
      clearHistory: () => Promise<BrowserHistoryEntryPayload[]>;
      toggleDownloadsPopup: (anchorBounds: BrowserAnchorBoundsPayload) => Promise<void>;
      showDownloadInFolder: (downloadId: string) => Promise<boolean>;
      openDownload: (downloadId: string) => Promise<string>;
      closeDownloadsPopup: () => Promise<void>;
      onStateChange: (listener: (state: BrowserTabListPayload) => void) => () => void;
      onBookmarksChange: (listener: (bookmarks: BrowserBookmarkPayload[]) => void) => () => void;
      onDownloadsChange: (listener: (downloads: BrowserDownloadPayload[]) => void) => () => void;
      onHistoryChange: (listener: (history: BrowserHistoryEntryPayload[]) => void) => () => void;
      onAddressSuggestionChosen: (listener: (index: number) => void) => () => void;
    };
  }

  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
