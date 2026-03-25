from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from typing import Literal


@dataclass(slots=True, frozen=True)
class WorkspaceGeneralMemberConfig:
    id: str
    model: str
    prompt: str
    config_path: str | None = None
    role: str | None = None
    schema_id: str | None = None
    schema_module_path: str | None = None


@dataclass(slots=True, frozen=True)
class WorkspaceGeneralSingleConfig:
    type: Literal["single"]
    agent: WorkspaceGeneralMemberConfig


@dataclass(slots=True, frozen=True)
class WorkspaceGeneralTeamConfig:
    type: Literal["team"]
    coordinator: WorkspaceGeneralMemberConfig
    members: tuple[WorkspaceGeneralMemberConfig, ...]


WorkspaceGeneralConfig = WorkspaceGeneralSingleConfig | WorkspaceGeneralTeamConfig


@dataclass(slots=True, frozen=True)
class ResolvedMcpServerConfig:
    server_id: str
    type: Literal["local", "remote"]
    command: tuple[str, ...] = ()
    url: str | None = None
    headers: tuple[tuple[str, str], ...] = ()
    environment: tuple[tuple[str, str], ...] = ()
    timeout_ms: int = 10000


@dataclass(slots=True, frozen=True)
class ResolvedMcpToolRef:
    tool_id: str
    server_id: str
    tool_name: str


@dataclass(slots=True, frozen=True)
class WorkspaceMcpCatalogEntry:
    tool_id: str
    tool_name: str
    module_path: str
    symbol_name: str


@dataclass(slots=True, frozen=True)
class ResolvedApplicationMcp:
    transport: str  # "http-sse" (others reserved for future)
    port: int
    path: str  # e.g. "/mcp"


@dataclass(slots=True, frozen=True)
class ResolvedApplicationHealthCheck:
    path: str  # e.g. "/mcp/health"
    timeout_s: int = 60
    interval_s: int = 5


@dataclass(slots=True, frozen=True)
class ResolvedApplicationLifecycle:
    setup: str = ""  # install dependencies & build (required in app.runtime.yaml)
    start: str = ""  # launch the application (required in app.runtime.yaml)
    stop: str = ""  # graceful shutdown (optional; SIGTERM used when empty)


@dataclass(slots=True, frozen=True)
class ResolvedApplication:
    app_id: str
    mcp: ResolvedApplicationMcp
    health_check: ResolvedApplicationHealthCheck
    env_contract: tuple[str, ...] = ()
    start_command: str = ""  # deprecated: use lifecycle.start
    base_dir: str = ""  # relative to workspace root; empty means apps/{app_id}
    lifecycle: ResolvedApplicationLifecycle = ResolvedApplicationLifecycle()


@dataclass(slots=True, frozen=True)
class CompiledWorkspaceRuntimePlan:
    workspace_id: str
    mode: Literal["single", "team"]
    general_config: WorkspaceGeneralConfig
    resolved_prompts: dict[str, str]
    resolved_mcp_servers: tuple[ResolvedMcpServerConfig, ...]
    resolved_mcp_tool_refs: tuple[ResolvedMcpToolRef, ...]
    workspace_mcp_catalog: tuple[WorkspaceMcpCatalogEntry, ...]
    resolved_output_schemas: dict[str, dict[str, Any]]
    config_checksum: str
    resolved_applications: tuple[ResolvedApplication, ...] = ()
    mcp_tool_allowlist: frozenset[str] = field(default_factory=frozenset)
