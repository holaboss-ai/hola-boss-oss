from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from sandbox_agent_runtime.runner_models import RunnerOutputEvent


class WorkspaceAgentRunResponse(BaseModel):
    session_id: str
    input_id: str
    events: list[RunnerOutputEvent]


class QueueSessionInputRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    holaboss_user_id: str | None = None
    image_urls: list[str] | None = None
    session_id: str | None = None
    idempotency_key: str | None = None
    priority: int = 0
    model: str | None = None


class LocalWorkspaceCreateRequest(BaseModel):
    workspace_id: str | None = None
    name: str = Field(..., min_length=1)
    harness: str = Field(..., min_length=1)
    status: str = "provisioning"
    main_session_id: str | None = None
    error_message: str | None = None
    onboarding_status: str = "not_required"
    onboarding_session_id: str | None = None
    onboarding_completed_at: str | None = None
    onboarding_completion_summary: str | None = None
    onboarding_requested_at: str | None = None
    onboarding_requested_by: str | None = None


class LocalWorkspaceUpdateRequest(BaseModel):
    status: str | None = None
    main_session_id: str | None = None
    error_message: str | None = None
    deleted_at_utc: str | None = None
    onboarding_status: str | None = None
    onboarding_session_id: str | None = None
    onboarding_completed_at: str | None = None
    onboarding_completion_summary: str | None = None
    onboarding_requested_at: str | None = None
    onboarding_requested_by: str | None = None


class ExecSandboxRequest(BaseModel):
    command: str = Field(..., min_length=1)
    timeout_s: int = Field(default=120, ge=1, le=1800)


class QueueSessionInputResponse(BaseModel):
    input_id: str
    session_id: str
    status: str


class AgentSessionStateResponse(BaseModel):
    effective_state: str
    runtime_status: str | None
    current_input_id: str | None
    heartbeat_at: str | None
    lease_until: str | None


class SessionRuntimeStateListResponse(BaseModel):
    items: list[dict[str, Any]]
    count: int


class SessionHistoryResponse(BaseModel):
    workspace_id: str
    session_id: str
    harness: str
    harness_session_id: str
    source: str
    main_session_id: str | None
    is_main_session: bool
    messages: list[dict[str, Any]]
    count: int
    total: int
    limit: int
    offset: int
    raw: Any | None = None


class SessionArtifactListResponse(BaseModel):
    items: list[dict[str, Any]]
    count: int


class SessionWithArtifactsListResponse(BaseModel):
    items: list[dict[str, Any]]
    count: int


class LocalSessionArtifactCreateRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    artifact_type: str = Field(..., min_length=1)
    external_id: str = Field(..., min_length=1)
    platform: str | None = None
    title: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class LocalWorkspaceListResponse(BaseModel):
    items: list[dict[str, Any]]
    total: int
    limit: int
    offset: int


class MemorySearchRequest(BaseModel):
    workspace_id: str
    query: str
    max_results: int = 6
    min_score: float = 0.0


class MemoryGetRequest(BaseModel):
    workspace_id: str
    path: str
    from_line: int | None = None
    lines: int | None = None


class MemoryUpsertRequest(BaseModel):
    workspace_id: str
    path: str
    content: str
    append: bool = False


class MemoryStatusRequest(BaseModel):
    workspace_id: str


class MemorySyncRequest(BaseModel):
    workspace_id: str
    reason: str = "manual"
    force: bool = False


class RuntimeConfigResponse(BaseModel):
    config_path: str | None
    loaded_from_file: bool
    auth_token_present: bool
    user_id: str | None = None
    sandbox_id: str | None = None
    model_proxy_base_url: str | None = None
    default_model: str | None = None
    runtime_mode: str | None = None
    default_provider: str | None = None
    holaboss_enabled: bool = False
    desktop_browser_enabled: bool = False
    desktop_browser_url: str | None = None


class RuntimeStatusResponse(BaseModel):
    harness: str
    config_loaded: bool
    config_path: str | None = None
    opencode_config_present: bool = False
    harness_ready: bool = False
    harness_state: str
    browser_available: bool = False
    browser_state: str = "unavailable"
    browser_url: str | None = None


class RuntimeConfigUpdateRequest(BaseModel):
    auth_token: str | None = None
    user_id: str | None = None
    sandbox_id: str | None = None
    model_proxy_base_url: str | None = None
    default_model: str | None = None
    runtime_mode: str | None = None
    default_provider: str | None = None
    holaboss_enabled: bool | None = None
    desktop_browser_enabled: bool | None = None
    desktop_browser_url: str | None = None


class LocalOutputCreateRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    output_type: str = Field(..., min_length=1)
    title: str = ""
    module_id: str | None = None
    module_resource_id: str | None = None
    file_path: str | None = None
    html_content: str | None = None
    session_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    artifact_id: str | None = None
    folder_id: str | None = None
    platform: str | None = None


class LocalOutputUpdateRequest(BaseModel):
    title: str | None = None
    status: str | None = None
    module_resource_id: str | None = None
    file_path: str | None = None
    html_content: str | None = None
    metadata: dict[str, Any] | None = None
    folder_id: str | None = None


class LocalOutputListResponse(BaseModel):
    items: list[dict[str, Any]]


class LocalOutputFolderCreateRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)


class LocalOutputFolderUpdateRequest(BaseModel):
    name: str | None = None
    position: int | None = None


class LocalCronjobCreateRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    initiated_by: str = Field(..., min_length=1)
    name: str = ""
    cron: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    enabled: bool = True
    delivery: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class LocalCronjobUpdateRequest(BaseModel):
    name: str | None = None
    cron: str | None = None
    description: str | None = None
    enabled: bool | None = None
    delivery: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class LocalOutputFolderListResponse(BaseModel):
    items: list[dict[str, Any]]


class LocalCronjobListResponse(BaseModel):
    jobs: list[dict[str, Any]]
    count: int


class LocalTaskProposalCreateRequest(BaseModel):
    proposal_id: str = Field(..., min_length=1)
    workspace_id: str = Field(..., min_length=1)
    task_name: str = Field(..., min_length=1)
    task_prompt: str = Field(..., min_length=1)
    task_generation_rationale: str = Field(..., min_length=1)
    source_event_ids: list[str] = Field(default_factory=list)
    created_at: str = Field(..., min_length=1)
    state: str = "not_reviewed"


class LocalTaskProposalStateUpdateRequest(BaseModel):
    state: str = Field(..., min_length=1)


class LocalTaskProposalListResponse(BaseModel):
    proposals: list[dict[str, Any]]
    count: int


class ShutdownResult(BaseModel):
    stopped: list[str]
    failed: list[str]


class AppStartRequest(BaseModel):
    workspace_id: str = "workspace-1"
    env: dict[str, str] = Field(default_factory=dict)


class AppStopRequest(BaseModel):
    workspace_id: str = "workspace-1"


class AppActionResult(BaseModel):
    app_id: str
    status: str
    detail: str = ""
    ports: dict[str, int] = Field(default_factory=dict)


class InstallAppRequest(BaseModel):
    app_id: str = Field(..., min_length=1)
    workspace_id: str = Field(..., min_length=1)
    files: list[dict[str, Any]]


class InstallAppResponse(BaseModel):
    app_id: str
    status: str
    detail: str


class UninstallAppRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)


class AppSetupRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)


class ApplyTemplateRequest(BaseModel):
    files: list[dict[str, Any]]
    replace_existing: bool = False


class WriteFileRequest(BaseModel):
    content_base64: str
    executable: bool = False
