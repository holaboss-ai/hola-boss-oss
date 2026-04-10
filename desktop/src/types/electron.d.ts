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

  type FilePreviewKind = "text" | "image" | "pdf" | "table" | "unsupported";

  interface FilePreviewTableSheetPayload {
    name: string;
    index: number;
    columns: string[];
    rows: string[][];
    totalRows: number;
    totalColumns: number;
    truncated: boolean;
  }

  interface FilePreviewPayload {
    absolutePath: string;
    name: string;
    extension: string;
    kind: FilePreviewKind;
    mimeType?: string;
    content?: string;
    dataUrl?: string;
    tableSheets?: FilePreviewTableSheetPayload[];
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

  interface FileSystemMutationPayload {
    absolutePath: string;
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

  type UiSettingsPaneSection = "account" | "billing" | "providers" | "integrations" | "submissions" | "settings" | "about";

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

  type BrowserSpaceId = "user" | "agent";

  interface BrowserTabCountsPayload {
    user: number;
    agent: number;
  }

  interface BrowserTabListPayload {
    space: BrowserSpaceId;
    activeTabId: string;
    tabs: BrowserStatePayload[];
    tabCounts: BrowserTabCountsPayload;
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
    defaultBackgroundModel: string | null;
    defaultImageModel: string | null;
    controlPlaneBaseUrl: string | null;
    catalogVersion: string | null;
    providerModelGroups: RuntimeProviderModelGroupPayload[];
  }

  interface RuntimeProviderModelPayload {
    token: string;
    modelId: string;
    capabilities?: string[];
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
    defaultBackgroundModel?: string | null;
    defaultImageModel?: string | null;
    controlPlaneBaseUrl?: string | null;
  }

  type RuntimeUserProfileNameSource = "manual" | "agent" | "authFallback";

  interface RuntimeUserProfilePayload {
    profileId: string;
    name: string | null;
    nameSource: RuntimeUserProfileNameSource | null;
    createdAt: string | null;
    updatedAt: string | null;
  }

  interface RuntimeUserProfileUpdatePayload {
    profileId?: string | null;
    name?: string | null;
    nameSource?: RuntimeUserProfileNameSource | null;
  }

  interface AppUpdateStatusPayload {
    supported: boolean;
    checking: boolean;
    available: boolean;
    downloaded: boolean;
    downloadProgressPercent: number | null;
    currentVersion: string;
    latestVersion: string | null;
    releaseName: string | null;
    publishedAt: string | null;
    dismissedVersion: string | null;
    lastCheckedAt: string | null;
    error: string;
  }

  interface DesktopWindowStatePayload {
    isFullScreen: boolean;
    isMaximized: boolean;
    isMinimized: boolean;
  }

  interface WorkbenchOpenBrowserPayload {
    workspaceId?: string | null;
    url?: string | null;
    space?: BrowserSpaceId | null;
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
    display_name?: string | null;
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
    proposal_source: "proactive" | "evolve";
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
    lifecycle_state: string;
    lifecycle_summary: string;
    lifecycle_detail: string | null;
  }

  interface RemoteTaskProposalGenerationRequestPayload {
    workspace_id: string;
  }

  interface RemoteTaskProposalGenerationResponsePayload {
    accepted: boolean;
    accepted_count: number;
    event_count: number;
    correlation_id: string;
  }

  interface ProactiveTaskProposalPreferenceUpdatePayload {
    enabled: boolean;
    holaboss_user_id?: string;
    sandbox_id?: string;
  }

  interface ProactiveTaskProposalPreferencePayload {
    enabled: boolean;
    holaboss_user_id: string;
    sandbox_id: string;
  }

  interface ProactiveHeartbeatWorkspacePayload {
    workspace_id: string;
    workspace_name: string | null;
    enabled: boolean;
    last_seen_at: string | null;
  }

  interface ProactiveHeartbeatConfigPayload {
    holaboss_user_id: string;
    sandbox_id: string;
    has_schedule: boolean;
    cron: string;
    enabled: boolean;
    last_run_at: string | null;
    next_run_at: string | null;
    workspaces: ProactiveHeartbeatWorkspacePayload[];
  }

  interface ProactiveHeartbeatConfigUpdatePayload {
    cron?: string;
    enabled?: boolean;
    holaboss_user_id?: string;
    sandbox_id?: string;
  }

  interface ProactiveHeartbeatWorkspaceUpdatePayload {
    workspace_id: string;
    workspace_name?: string | null;
    enabled: boolean;
    holaboss_user_id?: string;
    sandbox_id?: string;
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

  interface CreateAgentSessionPayload {
    workspace_id: string;
    session_id?: string | null;
    kind?: string | null;
    title?: string | null;
    parent_session_id?: string | null;
    created_by?: string | null;
  }

  interface CreateAgentSessionResponsePayload {
    session: AgentSessionRecordPayload;
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

  type MemoryUpdateProposalKind = "preference" | "identity" | "profile";
  type MemoryUpdateProposalState = "pending" | "accepted" | "dismissed";

  interface MemoryUpdateProposalRecordPayload {
    proposal_id: string;
    workspace_id: string;
    session_id: string;
    input_id: string;
    proposal_kind: MemoryUpdateProposalKind;
    target_key: string;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
    evidence: string | null;
    confidence: number | null;
    source_message_id: string | null;
    state: MemoryUpdateProposalState;
    persisted_memory_id: string | null;
    created_at: string;
    updated_at: string;
    accepted_at: string | null;
    dismissed_at: string | null;
  }

  interface MemoryUpdateProposalListRequestPayload {
    workspaceId: string;
    sessionId?: string | null;
    inputId?: string | null;
    state?: MemoryUpdateProposalState | null;
    limit?: number;
    offset?: number;
  }

  interface MemoryUpdateProposalListResponsePayload {
    proposals: MemoryUpdateProposalRecordPayload[];
    count: number;
  }

  interface MemoryUpdateProposalAcceptPayload {
    proposalId: string;
    summary?: string | null;
  }

  interface MemoryUpdateProposalAcceptResponsePayload {
    proposal: MemoryUpdateProposalRecordPayload;
  }

  interface MemoryUpdateProposalDismissResponsePayload {
    proposal: MemoryUpdateProposalRecordPayload;
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
    instruction: string;
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

  interface CronjobRunResponsePayload {
    success: boolean;
    cronjob: CronjobRecordPayload;
    session_id: string | null;
    notification_id: string | null;
  }

  interface CronjobCreatePayload {
    workspace_id: string;
    initiated_by: string;
    name?: string;
    cron: string;
    description: string;
    instruction?: string;
    enabled?: boolean;
    delivery: CronjobDeliveryPayload;
    metadata?: Record<string, unknown>;
  }

  interface CronjobUpdatePayload {
    name?: string;
    cron?: string;
    description?: string;
    instruction?: string;
    enabled?: boolean;
    delivery?: CronjobDeliveryPayload;
    metadata?: Record<string, unknown>;
  }

  type RuntimeNotificationLevel = "info" | "success" | "warning" | "error";
  type RuntimeNotificationPriority = "low" | "normal" | "high" | "critical";
  type RuntimeNotificationState = "unread" | "read" | "dismissed";

  interface RuntimeNotificationRecordPayload {
    id: string;
    workspace_id: string;
    cronjob_id: string | null;
    source_type: string;
    source_label: string | null;
    title: string;
    message: string;
    level: RuntimeNotificationLevel;
    priority: RuntimeNotificationPriority;
    state: RuntimeNotificationState;
    metadata: Record<string, unknown>;
    read_at: string | null;
    dismissed_at: string | null;
    created_at: string;
    updated_at: string;
  }

  interface RuntimeNotificationListResponsePayload {
    items: RuntimeNotificationRecordPayload[];
    count: number;
  }

  interface RuntimeNotificationUpdatePayload {
    state?: RuntimeNotificationState;
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
    last_turn_status: string | null;
    last_turn_completed_at: string | null;
    last_turn_stop_reason: string | null;
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

  interface PauseSessionRunResponsePayload {
    input_id: string;
    session_id: string;
    status: string;
  }

  interface HolabossClientConfigPayload {
    projectsUrl: string;
    marketplaceUrl: string;
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
    input_id: string | null;
    artifact_id: string | null;
    folder_id: string | null;
    platform: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }

  interface WorkspaceOutputListRequestPayload {
    workspaceId: string;
    outputType?: string | null;
    status?: string | null;
    platform?: string | null;
    folderId?: string | null;
    sessionId?: string | null;
    inputId?: string | null;
    limit?: number;
    offset?: number;
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

  interface HolabossPauseSessionRunPayload {
    workspace_id: string;
    session_id: string;
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
    provider_logos: Record<string, string>;
  }

  interface CreateSubmissionPayload {
    workspaceId: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    apps: string[];
    onboardingMd: string | null;
    readmeMd: string | null;
  }

  interface CreateSubmissionResponse {
    submission_id: string;
    template_id: string;
    upload_url: string;
    upload_expires_at: string;
  }

  interface FinalizeSubmissionResponse {
    submission_id: string;
    status: string;
    template_name: string;
  }

  interface PackageAndUploadResult {
    archiveSizeBytes: number;
  }

  interface SubmissionRecord {
    id: string;
    author_id: string;
    author_name: string;
    template_name: string;
    template_id: string;
    version: string;
    status: "pending_review" | "published" | "rejected";
    manifest: Record<string, unknown>;
    archive_size_bytes: number;
    review_notes: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
  }

  interface SubmissionListResponse {
    submissions: SubmissionRecord[];
    count: number;
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
      renamePath: (targetPath: string, nextName: string, workspaceId?: string | null) => Promise<FileSystemMutationPayload>;
      deletePath: (targetPath: string, workspaceId?: string | null) => Promise<{ deleted: boolean }>;
      getBookmarks: (workspaceId?: string | null) => Promise<FileBookmarkPayload[]>;
      addBookmark: (targetPath: string, label?: string, workspaceId?: string | null) => Promise<FileBookmarkPayload[]>;
      removeBookmark: (bookmarkId: string) => Promise<FileBookmarkPayload[]>;
      onBookmarksChange: (listener: (bookmarks: FileBookmarkPayload[]) => void) => () => void;
    };
    runtime: {
      getStatus: () => Promise<RuntimeStatusPayload>;
      restart: () => Promise<RuntimeStatusPayload>;
      getConfig: () => Promise<RuntimeConfigPayload>;
      getProfile: () => Promise<RuntimeUserProfilePayload>;
      getConfigDocument: () => Promise<string>;
      setConfig: (payload: RuntimeConfigUpdatePayload) => Promise<RuntimeConfigPayload>;
      setProfile: (payload: RuntimeUserProfileUpdatePayload) => Promise<RuntimeUserProfilePayload>;
      setConfigDocument: (rawDocument: string) => Promise<RuntimeConfigPayload>;
      exchangeBinding: (sandboxId: string) => Promise<RuntimeConfigPayload>;
      onConfigChange: (listener: (config: RuntimeConfigPayload) => void) => () => void;
      onStateChange: (listener: (status: RuntimeStatusPayload) => void) => () => void;
    };
    ui: {
      getTheme: () => Promise<string>;
      getWindowState: () => Promise<DesktopWindowStatePayload>;
      minimizeWindow: () => Promise<void>;
      toggleWindowSize: () => Promise<void>;
      closeWindow: () => Promise<void>;
      setTheme: (theme: string) => Promise<void>;
      openSettingsPane: (section?: UiSettingsPaneSection) => Promise<void>;
      openExternalUrl: (url: string) => Promise<void>;
      onWindowStateChange: (listener: (state: DesktopWindowStatePayload) => void) => () => void;
      onThemeChange: (listener: (theme: string) => void) => () => void;
      onOpenSettingsPane: (listener: (section: UiSettingsPaneSection) => void) => () => void;
    };
    billing: {
      getOverview: () => Promise<DesktopBillingOverviewPayload>;
      getUsage: (limit?: number) => Promise<DesktopBillingUsagePayload>;
      getLinks: () => Promise<DesktopBillingLinksPayload>;
    };
    appUpdate: {
      getStatus: () => Promise<AppUpdateStatusPayload>;
      checkNow: () => Promise<AppUpdateStatusPayload>;
      dismiss: (version?: string | null) => Promise<AppUpdateStatusPayload>;
      installNow: () => Promise<void>;
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
      resolveUrl(workspaceId: string, appId: string, path?: string): Promise<string>;
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
      listOutputs: (payload: string | WorkspaceOutputListRequestPayload) => Promise<WorkspaceOutputListResponsePayload>;
      listSkills: (workspaceId: string) => Promise<WorkspaceSkillListResponsePayload>;
      getWorkspaceRoot: (workspaceId: string) => Promise<string>;
      createWorkspace: (payload: HolabossCreateWorkspacePayload) => Promise<WorkspaceResponsePayload>;
      deleteWorkspace: (workspaceId: string) => Promise<WorkspaceResponsePayload>;
      listCronjobs: (workspaceId: string, enabledOnly?: boolean) => Promise<CronjobListResponsePayload>;
      runCronjobNow: (jobId: string) => Promise<CronjobRunResponsePayload>;
      createCronjob: (payload: CronjobCreatePayload) => Promise<CronjobRecordPayload>;
      updateCronjob: (jobId: string, payload: CronjobUpdatePayload) => Promise<CronjobRecordPayload>;
      deleteCronjob: (jobId: string) => Promise<{ success: boolean }>;
      listNotifications: (
        workspaceId?: string | null,
        includeDismissed?: boolean
      ) => Promise<RuntimeNotificationListResponsePayload>;
      updateNotification: (
        notificationId: string,
        payload: RuntimeNotificationUpdatePayload
      ) => Promise<RuntimeNotificationRecordPayload>;
      listTaskProposals: (workspaceId: string) => Promise<TaskProposalListResponsePayload>;
      acceptTaskProposal: (payload: TaskProposalAcceptPayload) => Promise<TaskProposalAcceptResponsePayload>;
      listMemoryUpdateProposals: (
        payload: MemoryUpdateProposalListRequestPayload
      ) => Promise<MemoryUpdateProposalListResponsePayload>;
      acceptMemoryUpdateProposal: (
        payload: MemoryUpdateProposalAcceptPayload
      ) => Promise<MemoryUpdateProposalAcceptResponsePayload>;
      dismissMemoryUpdateProposal: (proposalId: string) => Promise<MemoryUpdateProposalDismissResponsePayload>;
      getProactiveStatus: (workspaceId: string) => Promise<ProactiveAgentStatusPayload>;
      getProactiveTaskProposalPreference: () => Promise<ProactiveTaskProposalPreferencePayload>;
      setProactiveTaskProposalPreference: (
        payload: ProactiveTaskProposalPreferenceUpdatePayload
      ) => Promise<ProactiveTaskProposalPreferencePayload>;
      getProactiveHeartbeatConfig: () => Promise<ProactiveHeartbeatConfigPayload>;
      setProactiveHeartbeatConfig: (
        payload: ProactiveHeartbeatConfigUpdatePayload
      ) => Promise<ProactiveHeartbeatConfigPayload>;
      setProactiveHeartbeatWorkspaceEnabled: (
        payload: ProactiveHeartbeatWorkspaceUpdatePayload
      ) => Promise<ProactiveHeartbeatConfigPayload>;
      updateTaskProposalState: (proposalId: string, state: string) => Promise<TaskProposalStateUpdatePayload>;
      requestRemoteTaskProposalGeneration: (
        payload: RemoteTaskProposalGenerationRequestPayload
      ) => Promise<RemoteTaskProposalGenerationResponsePayload>;
      listAgentSessions: (workspaceId: string) => Promise<AgentSessionListResponsePayload>;
      createAgentSession: (payload: CreateAgentSessionPayload) => Promise<CreateAgentSessionResponsePayload>;
      listRuntimeStates: (workspaceId: string) => Promise<SessionRuntimeStateListResponsePayload>;
      getSessionHistory: (payload: { sessionId: string; workspaceId: string }) => Promise<SessionHistoryResponsePayload>;
      getSessionOutputEvents: (payload: { sessionId: string }) => Promise<SessionOutputEventListResponsePayload>;
      stageSessionAttachments: (payload: StageSessionAttachmentsPayload) => Promise<StageSessionAttachmentsResponsePayload>;
      stageSessionAttachmentPaths: (
        payload: StageSessionAttachmentPathsPayload
      ) => Promise<StageSessionAttachmentsResponsePayload>;
      queueSessionInput: (payload: HolabossQueueSessionInputPayload) => Promise<EnqueueSessionInputResponsePayload>;
      pauseSessionRun: (payload: HolabossPauseSessionRunPayload) => Promise<PauseSessionRunResponsePayload>;
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
      generateTemplateContent(params: {
        contentType: "onboarding" | "readme";
        name: string;
        description: string;
        category: string;
        tags: string[];
        apps: string[];
      }): Promise<{ content: string }>;
      createSubmission(payload: CreateSubmissionPayload): Promise<CreateSubmissionResponse>;
      packageAndUploadWorkspace(params: {
        workspaceId: string;
        apps: string[];
        manifest: Record<string, unknown>;
        uploadUrl: string;
      }): Promise<PackageAndUploadResult>;
      finalizeSubmission(submissionId: string): Promise<FinalizeSubmissionResponse>;
      listSubmissions(): Promise<SubmissionListResponse>;
      deleteSubmission(submissionId: string): Promise<{ deleted: boolean }>;
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
      setActiveWorkspace: (workspaceId?: string | null, space?: BrowserSpaceId | null) => Promise<BrowserTabListPayload>;
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
