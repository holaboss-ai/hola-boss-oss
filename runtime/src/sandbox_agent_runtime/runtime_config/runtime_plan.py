from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Any

from sandbox_agent_runtime.ts_bridge import run_ts_json_cli

from .errors import WorkspaceRuntimeConfigError
from .models import (
    CompiledWorkspaceRuntimePlan,
    ResolvedApplication,
    ResolvedApplicationHealthCheck,
    ResolvedApplicationLifecycle,
    ResolvedApplicationMcp,
    ResolvedMcpServerConfig,
    ResolvedMcpToolRef,
    WorkspaceGeneralMemberConfig,
    WorkspaceGeneralSingleConfig,
    WorkspaceGeneralTeamConfig,
    WorkspaceMcpCatalogEntry,
)
from .schema_registry import WorkspaceOutputSchemaResolver

ReferenceReader = Callable[[str], Awaitable[str]]


class WorkspaceRuntimePlanBuilder:
    def __init__(self) -> None:
        self._schema_resolver = WorkspaceOutputSchemaResolver()

    async def compile(
        self,
        *,
        workspace_id: str,
        workspace_yaml: str,
        reference_reader: ReferenceReader,
    ) -> CompiledWorkspaceRuntimePlan:
        references = await _collect_references(workspace_yaml=workspace_yaml, reference_reader=reference_reader)
        response = run_ts_json_cli(
            module_file=str(Path(__file__).resolve().parents[1] / "__init__.py"),
            package_name="api-server",
            dist_entry="dist/workspace-runtime-plan.mjs",
            source_entry="src/workspace-runtime-plan.ts",
            operation="compile",
            payload={
                "workspace_id": workspace_id,
                "workspace_yaml": workspace_yaml,
                "references": references,
            },
            missing_entry_message="workspace runtime plan TypeScript entrypoint not found",
            empty_output_message="workspace runtime plan TypeScript compiler returned empty output",
        )
        plan_payload = _require_compiled_plan_payload(response)
        general_config = _load_general_config(plan_payload.get("general_config"))
        resolved_output_schemas = {
            member_id: schema_model.model_json_schema()
            for member_id, schema_model in self._schema_resolver.resolve(
                schema_aliases=_string_mapping(plan_payload.get("schema_aliases")),
                general_config=general_config,
                module_prefixes=_module_prefixes_from_catalog(plan_payload.get("workspace_mcp_catalog")),
            ).items()
        }
        return CompiledWorkspaceRuntimePlan(
            workspace_id=str(plan_payload.get("workspace_id") or workspace_id),
            mode=str(plan_payload.get("mode") or general_config.type),  # type: ignore[arg-type]
            general_config=general_config,
            resolved_prompts=_string_mapping(plan_payload.get("resolved_prompts")),
            resolved_mcp_servers=_load_mcp_servers(plan_payload.get("resolved_mcp_servers")),
            resolved_mcp_tool_refs=_load_mcp_tool_refs(plan_payload.get("resolved_mcp_tool_refs")),
            workspace_mcp_catalog=_load_workspace_catalog(plan_payload.get("workspace_mcp_catalog")),
            resolved_output_schemas=resolved_output_schemas,
            config_checksum=str(plan_payload.get("config_checksum") or ""),
            resolved_applications=_load_resolved_applications(plan_payload.get("resolved_applications")),
            mcp_tool_allowlist=_string_frozenset(plan_payload.get("mcp_tool_allowlist")),
        )


async def _collect_references(
    *,
    workspace_yaml: str,
    reference_reader: ReferenceReader,
) -> dict[str, str]:
    reference_paths = _require_reference_paths_payload(
        run_ts_json_cli(
            module_file=str(Path(__file__).resolve().parents[1] / "__init__.py"),
            package_name="api-server",
            dist_entry="dist/workspace-runtime-plan.mjs",
            source_entry="src/workspace-runtime-plan.ts",
            operation="collect-references",
            payload={"workspace_yaml": workspace_yaml},
            missing_entry_message="workspace runtime plan TypeScript entrypoint not found",
            empty_output_message="workspace runtime plan TypeScript reference collector returned empty output",
        )
    )
    references: dict[str, str] = {}
    for normalized in reference_paths:
        try:
            references[normalized] = await reference_reader(normalized)
        except FileNotFoundError:
            continue
    return references


def _require_reference_paths_payload(response: Any) -> tuple[str, ...]:
    if not isinstance(response, Mapping):
        raise RuntimeError("workspace runtime plan TypeScript reference collector returned invalid response")
    if response.get("ok") is False:
        error = response.get("error")
        if not isinstance(error, Mapping):
            raise RuntimeError("workspace runtime plan TypeScript reference collector returned invalid error payload")
        raise WorkspaceRuntimeConfigError(
            code=str(error.get("code") or "workspace_runtime_plan_reference_collection_failed"),
            path=error.get("path") if isinstance(error.get("path"), str) else None,
            message=str(error.get("message") or "workspace runtime plan reference collection failed"),
            hint=error.get("hint") if isinstance(error.get("hint"), str) else None,
        )
    references = response.get("references")
    if not isinstance(references, list):
        raise RuntimeError("workspace runtime plan TypeScript reference collector returned invalid references payload")
    return tuple(str(item) for item in references if isinstance(item, str) and item)


def _require_compiled_plan_payload(response: Any) -> Mapping[str, Any]:
    if not isinstance(response, Mapping):
        raise RuntimeError("workspace runtime plan TypeScript compiler returned invalid response")

    if response.get("ok") is False:
        error = response.get("error")
        if not isinstance(error, Mapping):
            raise RuntimeError("workspace runtime plan TypeScript compiler returned invalid error payload")
        raise WorkspaceRuntimeConfigError(
            code=str(error.get("code") or "workspace_runtime_plan_compile_failed"),
            path=error.get("path") if isinstance(error.get("path"), str) else None,
            message=str(error.get("message") or "workspace runtime plan compilation failed"),
            hint=error.get("hint") if isinstance(error.get("hint"), str) else None,
        )

    plan = response.get("plan")
    if not isinstance(plan, Mapping):
        raise RuntimeError("workspace runtime plan TypeScript compiler returned invalid plan payload")
    return plan


def _load_general_config(value: Any):
    if not isinstance(value, Mapping):
        raise RuntimeError("workspace runtime plan TypeScript compiler returned invalid general_config")

    config_type = value.get("type")
    if config_type == "single":
        return WorkspaceGeneralSingleConfig(type="single", agent=_load_member(value.get("agent")))
    if config_type == "team":
        members = value.get("members")
        if not isinstance(members, list):
            raise RuntimeError("workspace runtime plan TypeScript compiler returned invalid team members")
        return WorkspaceGeneralTeamConfig(
            type="team",
            coordinator=_load_member(value.get("coordinator")),
            members=tuple(_load_member(item) for item in members),
        )
    raise RuntimeError("workspace runtime plan TypeScript compiler returned invalid general_config.type")


def _load_member(value: Any) -> WorkspaceGeneralMemberConfig:
    if not isinstance(value, Mapping):
        raise RuntimeError("workspace runtime plan TypeScript compiler returned invalid member payload")
    return WorkspaceGeneralMemberConfig(
        id=str(value.get("id") or ""),
        model=str(value.get("model") or ""),
        prompt=str(value.get("prompt") or ""),
        config_path=value.get("config_path") if isinstance(value.get("config_path"), str) else None,
        role=value.get("role") if isinstance(value.get("role"), str) else None,
        schema_id=value.get("schema_id") if isinstance(value.get("schema_id"), str) else None,
        schema_module_path=value.get("schema_module_path") if isinstance(value.get("schema_module_path"), str) else None,
    )


def _load_mcp_servers(value: Any) -> tuple[ResolvedMcpServerConfig, ...]:
    if not isinstance(value, list):
        return ()
    resolved: list[ResolvedMcpServerConfig] = []
    for entry in value:
        if not isinstance(entry, Mapping):
            continue
        command = entry.get("command")
        headers = entry.get("headers")
        environment = entry.get("environment")
        resolved.append(
            ResolvedMcpServerConfig(
                server_id=str(entry.get("server_id") or ""),
                type=str(entry.get("type") or "local"),  # type: ignore[arg-type]
                command=tuple(str(token) for token in command) if isinstance(command, list) else (),
                url=entry.get("url") if isinstance(entry.get("url"), str) else None,
                headers=_string_pair_tuple(headers),
                environment=_string_pair_tuple(environment),
                timeout_ms=int(entry.get("timeout_ms") or 10000),
            )
        )
    return tuple(resolved)


def _load_mcp_tool_refs(value: Any) -> tuple[ResolvedMcpToolRef, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(
        ResolvedMcpToolRef(
            tool_id=str(entry.get("tool_id") or ""),
            server_id=str(entry.get("server_id") or ""),
            tool_name=str(entry.get("tool_name") or ""),
        )
        for entry in value
        if isinstance(entry, Mapping)
    )


def _load_workspace_catalog(value: Any) -> tuple[WorkspaceMcpCatalogEntry, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(
        WorkspaceMcpCatalogEntry(
            tool_id=str(entry.get("tool_id") or ""),
            tool_name=str(entry.get("tool_name") or ""),
            module_path=str(entry.get("module_path") or ""),
            symbol_name=str(entry.get("symbol_name") or ""),
        )
        for entry in value
        if isinstance(entry, Mapping)
    )


def _load_resolved_applications(value: Any) -> tuple[ResolvedApplication, ...]:
    if not isinstance(value, list):
        return ()
    resolved: list[ResolvedApplication] = []
    for entry in value:
        if not isinstance(entry, Mapping):
            continue
        mcp = entry.get("mcp")
        health_check = entry.get("health_check")
        lifecycle = entry.get("lifecycle")
        env_contract = entry.get("env_contract")
        resolved.append(
            ResolvedApplication(
                app_id=str(entry.get("app_id") or ""),
                mcp=ResolvedApplicationMcp(
                    transport=str(mcp.get("transport") or "http-sse") if isinstance(mcp, Mapping) else "http-sse",
                    port=int(mcp.get("port") or 0) if isinstance(mcp, Mapping) else 0,
                    path=str(mcp.get("path") or "/mcp") if isinstance(mcp, Mapping) else "/mcp",
                ),
                health_check=ResolvedApplicationHealthCheck(
                    path=str(health_check.get("path") or "/health") if isinstance(health_check, Mapping) else "/health",
                    timeout_s=int(health_check.get("timeout_s") or 60) if isinstance(health_check, Mapping) else 60,
                    interval_s=int(health_check.get("interval_s") or 5) if isinstance(health_check, Mapping) else 5,
                ),
                env_contract=tuple(str(item) for item in env_contract) if isinstance(env_contract, list) else (),
                start_command=str(entry.get("start_command") or ""),
                base_dir=str(entry.get("base_dir") or ""),
                lifecycle=ResolvedApplicationLifecycle(
                    setup=str(lifecycle.get("setup") or "") if isinstance(lifecycle, Mapping) else "",
                    start=str(lifecycle.get("start") or "") if isinstance(lifecycle, Mapping) else "",
                    stop=str(lifecycle.get("stop") or "") if isinstance(lifecycle, Mapping) else "",
                ),
            )
        )
    return tuple(resolved)


def _string_mapping(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        return {}
    return {str(key): mapped for key, mapped in value.items() if isinstance(key, str) and isinstance(mapped, str)}


def _string_pair_tuple(value: Any) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, list):
        return ()
    items: list[tuple[str, str]] = []
    for entry in value:
        if not isinstance(entry, (list, tuple)) or len(entry) != 2:
            continue
        key, mapped = entry
        if isinstance(key, str) and isinstance(mapped, str):
            items.append((key, mapped))
    return tuple(items)


def _module_prefixes_from_catalog(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    prefixes: set[str] = set()
    for entry in value:
        if not isinstance(entry, Mapping):
            continue
        module_path = entry.get("module_path")
        if not isinstance(module_path, str) or not module_path:
            continue
        parts = module_path.split(".")
        for index in range(1, len(parts) + 1):
            prefixes.add(".".join(parts[:index]))
    return tuple(sorted(prefixes))


def _string_frozenset(value: Any) -> frozenset[str]:
    if not isinstance(value, list):
        return frozenset()
    return frozenset(str(item) for item in value if isinstance(item, str))
