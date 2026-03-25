from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field


class RunnerRequest(BaseModel):
    holaboss_user_id: str | None = Field(default=None, min_length=1)
    workspace_id: str = Field(..., min_length=1)
    session_id: str = Field(..., min_length=1)
    input_id: str = Field(..., min_length=1)
    instruction: str = Field(..., min_length=1)
    context: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None
    debug: bool = False


class RunnerOutputEvent(BaseModel):
    session_id: str
    input_id: str
    sequence: int
    event_type: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    payload: dict[str, Any] = Field(default_factory=dict)


class HarnessHostModelClientPayload(BaseModel):
    model_proxy_provider: str
    api_key: str
    base_url: str | None = None
    default_headers: dict[str, str] | None = None


class HarnessHostOpencodeRequest(BaseModel):
    workspace_id: str
    workspace_dir: str
    session_id: str
    input_id: str
    instruction: str
    debug: bool = False
    harness_session_id: str | None = None
    persisted_harness_session_id: str | None = None
    provider_id: str
    model_id: str
    mode: str
    opencode_base_url: str
    timeout_seconds: int
    system_prompt: str
    tools: dict[str, bool]
    workspace_tool_ids: list[str]
    workspace_skill_ids: list[str]
    mcp_servers: list[dict[str, Any]]
    output_format: dict[str, Any] | None = None
    workspace_config_checksum: str
    run_started_payload: dict[str, Any]
    model_client: HarnessHostModelClientPayload


class WorkspaceMcpSidecarCliRequest(BaseModel):
    workspace_id: str
    workspace_dir: str
    sandbox_id: str
    physical_server_id: str
    expected_fingerprint: str
    timeout_ms: int
    readiness_timeout_s: float
    catalog_json_base64: str
    enabled_tool_ids_json_base64: str
    python_executable: str


class WorkspaceMcpSidecarCliResponse(BaseModel):
    logical_server_id: str
    physical_server_id: str
    sandbox_id: str
    url: str
    timeout_ms: int
    pid: int
    reused: bool


class OpencodeSidecarCliRequest(BaseModel):
    workspace_root: str
    workspace_id: str
    config_fingerprint: str
    allow_reuse_existing: bool
    host: str
    port: int
    readiness_url: str
    ready_timeout_s: float


class OpencodeSidecarCliResponse(BaseModel):
    outcome: str
    pid: int
    url: str


class OpencodeConfigCliRequest(BaseModel):
    workspace_root: str
    provider_id: str
    model_id: str
    model_client: HarnessHostModelClientPayload


class OpencodeConfigCliResponse(BaseModel):
    path: str
    provider_config_changed: bool
    model_selection_changed: bool


class OpencodeRuntimeConfigGeneralMemberPayload(BaseModel):
    id: str
    model: str
    prompt: str
    role: str | None = None


class OpencodeRuntimeConfigCliRequest(BaseModel):
    session_id: str
    workspace_id: str
    input_id: str
    runtime_exec_model_proxy_api_key: str | None = None
    runtime_exec_sandbox_id: str | None = None
    runtime_exec_run_id: str | None = None
    selected_model: str | None = None
    default_provider_id: str
    session_mode: str
    workspace_config_checksum: str
    workspace_skill_ids: list[str] = Field(default_factory=list)
    default_tools: list[str] = Field(default_factory=list)
    extra_tools: list[str] = Field(default_factory=list)
    tool_server_id_map: dict[str, str] | None = None
    resolved_mcp_tool_refs: list[dict[str, str]] = Field(default_factory=list)
    resolved_output_schemas: dict[str, dict[str, Any]] = Field(default_factory=dict)
    general_type: str
    single_agent: OpencodeRuntimeConfigGeneralMemberPayload | None = None
    coordinator: OpencodeRuntimeConfigGeneralMemberPayload | None = None
    members: list[OpencodeRuntimeConfigGeneralMemberPayload] = Field(default_factory=list)


class OpencodeRuntimeConfigCliResponse(BaseModel):
    provider_id: str
    model_id: str
    mode: str
    system_prompt: str
    model_client: HarnessHostModelClientPayload
    tools: dict[str, bool]
    workspace_tool_ids: list[str] = Field(default_factory=list)
    workspace_skill_ids: list[str] = Field(default_factory=list)
    output_schema_member_id: str | None = None
    output_format: dict[str, Any] | None = None
    workspace_config_checksum: str


class OpencodeSkillsCliRequest(BaseModel):
    workspace_dir: str
    runtime_root: str


class OpencodeSkillsCliResponse(BaseModel):
    changed: bool
    skill_ids: list[str] = Field(default_factory=list)


class OpencodeCommandsCliRequest(BaseModel):
    workspace_dir: str


class OpencodeCommandsCliResponse(BaseModel):
    changed: bool
