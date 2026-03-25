# ruff: noqa: S101
from __future__ import annotations

import pytest
from sandbox_agent_runtime.runtime_config.errors import WorkspaceRuntimeConfigError
from sandbox_agent_runtime.runtime_config.runtime_plan import WorkspaceRuntimePlanBuilder

_WORKSPACE_YAML = """\
template_id: social_operator
name: Social Operator

agents:
  general:
    type: single
    agent:
      id: workspace.general
      model: gpt-4o

applications:
  - app_id: holaposter-ts-lite
    config_path: apps/holaposter-ts-lite/app.runtime.yaml

mcp_registry:
  allowlist:
    tool_ids:
      - "holaposter.create_post"
  servers:
    holaposter:
      type: remote
      url: "http://localhost:3099/mcp"
      enabled: true
"""

_APP_YAML = """\
app_id: holaposter-ts-lite

healthchecks:
  mcp:
    path: /mcp/health
    timeout_s: 60
    interval_s: 5

mcp:
  transport: http-sse
  port: 3099
  path: /mcp

env_contract:
  - HOLABOSS_USER_ID
"""

_FILES = {
    "apps/holaposter-ts-lite/app.runtime.yaml": _APP_YAML,
}


def _reader(files: dict[str, str]):
    async def _read(path: str) -> str:
        if path not in files:
            raise FileNotFoundError(path)
        return files[path]

    return _read


@pytest.mark.asyncio
async def test_compile_with_applications_populates_plan() -> None:
    builder = WorkspaceRuntimePlanBuilder()
    plan = await builder.compile(
        workspace_id="ws-test",
        workspace_yaml=_WORKSPACE_YAML,
        reference_reader=_reader(_FILES),
    )
    assert len(plan.resolved_applications) == 1
    app = plan.resolved_applications[0]
    assert app.app_id == "holaposter-ts-lite"
    assert app.mcp.port == 3099
    assert app.mcp.path == "/mcp"
    assert app.health_check.path == "/mcp/health"


@pytest.mark.asyncio
async def test_compile_populates_mcp_tool_allowlist() -> None:
    builder = WorkspaceRuntimePlanBuilder()
    plan = await builder.compile(
        workspace_id="ws-test",
        workspace_yaml=_WORKSPACE_YAML,
        reference_reader=_reader(_FILES),
    )
    assert "holaposter.create_post" in plan.mcp_tool_allowlist
    assert len(plan.mcp_tool_allowlist) == 1


@pytest.mark.asyncio
async def test_compile_without_applications_returns_empty() -> None:
    yaml_no_apps = """\
template_id: example
agents:
  general:
    type: single
    agent:
      id: workspace.general
      model: gpt-4o
mcp_registry:
  allowlist:
    tool_ids: []
  servers: {}
"""

    async def _simple_reader(path: str) -> str:
        raise FileNotFoundError(path)

    builder = WorkspaceRuntimePlanBuilder()
    plan = await builder.compile(
        workspace_id="ws-test",
        workspace_yaml=yaml_no_apps,
        reference_reader=_simple_reader,
    )
    assert plan.resolved_applications == ()
    assert plan.mcp_tool_allowlist == frozenset()


@pytest.mark.asyncio
async def test_compile_with_missing_app_config_raises() -> None:
    builder = WorkspaceRuntimePlanBuilder()
    with pytest.raises(WorkspaceRuntimeConfigError) as exc_info:
        await builder.compile(
            workspace_id="ws-test",
            workspace_yaml=_WORKSPACE_YAML,
            reference_reader=_reader({}),
        )
    assert exc_info.value.code == "app_config_not_found"


@pytest.mark.asyncio
async def test_compile_with_app_id_mismatch_raises() -> None:
    bad_yaml = _APP_YAML.replace("app_id: holaposter-ts-lite", "app_id: wrong-name")
    builder = WorkspaceRuntimePlanBuilder()
    with pytest.raises(WorkspaceRuntimeConfigError) as exc_info:
        await builder.compile(
            workspace_id="ws-test",
            workspace_yaml=_WORKSPACE_YAML,
            reference_reader=_reader({"apps/holaposter-ts-lite/app.runtime.yaml": bad_yaml}),
        )
    assert exc_info.value.code == "app_id_mismatch"


@pytest.mark.asyncio
async def test_compile_with_missing_mcp_port_raises() -> None:
    bad_yaml = _APP_YAML.replace("  port: 3099\n", "")
    builder = WorkspaceRuntimePlanBuilder()
    with pytest.raises(WorkspaceRuntimeConfigError) as exc_info:
        await builder.compile(
            workspace_id="ws-test",
            workspace_yaml=_WORKSPACE_YAML,
            reference_reader=_reader({"apps/holaposter-ts-lite/app.runtime.yaml": bad_yaml}),
        )
    assert exc_info.value.code == "app_mcp_port_missing"


@pytest.mark.asyncio
async def test_compile_with_duplicate_app_ids_raises() -> None:
    workspace_yaml = """\
template_id: social_operator
name: Social Operator

agents:
  general:
    type: single
    agent:
      id: workspace.general
      model: gpt-4o

applications:
  - app_id: holaposter-ts-lite
    config_path: apps/holaposter-ts-lite/app.runtime.yaml
  - app_id: holaposter-ts-lite
    config_path: apps/holaposter-ts-lite/app.runtime.yaml

mcp_registry:
  allowlist:
    tool_ids:
      - "holaposter.create_post"
  servers:
    holaposter:
      type: remote
      url: "http://localhost:3099/mcp"
      enabled: true
"""
    builder = WorkspaceRuntimePlanBuilder()
    with pytest.raises(WorkspaceRuntimeConfigError) as exc_info:
        await builder.compile(
            workspace_id="ws-test",
            workspace_yaml=workspace_yaml,
            reference_reader=_reader(_FILES),
        )
    assert exc_info.value.code == "app_duplicate_id"
