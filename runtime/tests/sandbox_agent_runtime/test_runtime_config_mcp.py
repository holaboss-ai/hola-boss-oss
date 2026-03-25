# ruff: noqa: S101

from __future__ import annotations

import pytest
from sandbox_agent_runtime.runtime_config import WorkspaceRuntimeConfigError, WorkspaceRuntimePlanBuilder


async def _reference_reader(path: str) -> str:
    fixtures = {
        "AGENTS.md": "You are concise.",
    }
    if path in fixtures:
        return fixtures[path]
    raise FileNotFoundError(path)


@pytest.mark.asyncio
async def test_runtime_plan_compile_accepts_mcp_registry_workspace_catalog() -> None:
    workspace_yaml = """
template_id: demo
name: Demo
agents:
  - id: workspace.general
    model: gpt-5.2
mcp_registry:
  allowlist:
    tool_ids:
      - workspace.echo
  servers:
    workspace:
      type: local
      enabled: true
      timeout_ms: 10000
  catalog:
    workspace.echo:
      module_path: tools.echo
      symbol: echo_tool
"""
    plan = await WorkspaceRuntimePlanBuilder().compile(
        workspace_id="workspace-1",
        workspace_yaml=workspace_yaml,
        reference_reader=_reference_reader,
    )
    tool_ids = [tool_ref.tool_id for tool_ref in plan.resolved_mcp_tool_refs]
    assert "workspace.echo" in tool_ids
    assert [server.server_id for server in plan.resolved_mcp_servers] == ["workspace"]
    assert [entry.module_path for entry in plan.workspace_mcp_catalog] == ["tools.echo"]


@pytest.mark.asyncio
async def test_runtime_plan_compile_rejects_legacy_tool_registry() -> None:
    workspace_yaml = """
template_id: demo
name: Demo
agents:
  - id: workspace.general
    model: gpt-5.2
tool_registry:
  allowlist:
    tool_ids: []
"""
    with pytest.raises(WorkspaceRuntimeConfigError) as exc:
        await WorkspaceRuntimePlanBuilder().compile(
            workspace_id="workspace-1",
            workspace_yaml=workspace_yaml,
            reference_reader=_reference_reader,
        )
    assert exc.value.code == "workspace_tool_registry_unsupported"


@pytest.mark.asyncio
async def test_runtime_plan_compile_rejects_invalid_mcp_tool_id() -> None:
    workspace_yaml = """
template_id: demo
name: Demo
agents:
  - id: workspace.general
    model: gpt-5.2
mcp_registry:
  allowlist:
    tool_ids:
      - invalid-format
  servers:
    workspace:
      type: local
  catalog: {}
"""
    with pytest.raises(WorkspaceRuntimeConfigError) as exc:
        await WorkspaceRuntimePlanBuilder().compile(
            workspace_id="workspace-1",
            workspace_yaml=workspace_yaml,
            reference_reader=_reference_reader,
        )
    assert exc.value.code == "workspace_mcp_tool_id_invalid"


@pytest.mark.asyncio
async def test_runtime_plan_compile_does_not_inject_default_workspace_tools() -> None:
    workspace_yaml = """
template_id: demo
name: Demo
agents:
  - id: workspace.general
    model: gpt-5.2
mcp_registry:
  allowlist:
    tool_ids: []
  servers: {}
"""
    plan = await WorkspaceRuntimePlanBuilder().compile(
        workspace_id="workspace-1",
        workspace_yaml=workspace_yaml,
        reference_reader=_reference_reader,
    )
    tool_ids = [tool_ref.tool_id for tool_ref in plan.resolved_mcp_tool_refs]
    assert tool_ids == []
    assert [server.server_id for server in plan.resolved_mcp_servers] == []


@pytest.mark.asyncio
async def test_runtime_plan_compile_legacy_system_workspace_tool_requires_catalog_entry() -> None:
    workspace_yaml = """
template_id: demo
name: Demo
agents:
  - id: workspace.general
    model: gpt-5.2
mcp_registry:
  allowlist:
    tool_ids:
      - workspace.memory_search
  servers:
    workspace:
      type: local
  catalog: {}
"""
    with pytest.raises(WorkspaceRuntimeConfigError) as exc:
        await WorkspaceRuntimePlanBuilder().compile(
            workspace_id="workspace-1",
            workspace_yaml=workspace_yaml,
            reference_reader=_reference_reader,
        )
    assert exc.value.code == "workspace_mcp_catalog_missing"
