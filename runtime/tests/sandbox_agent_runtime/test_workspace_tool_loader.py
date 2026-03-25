# ruff: noqa: S101

from __future__ import annotations

from pathlib import Path

import pytest
from sandbox_agent_runtime.runtime_config.errors import WorkspaceRuntimeConfigError
from sandbox_agent_runtime.runtime_config.models import WorkspaceMcpCatalogEntry
from sandbox_agent_runtime.workspace_tool_loader import load_workspace_tools


def test_load_workspace_tools_loads_declared_tools(tmp_path: Path) -> None:
    tools_dir = tmp_path / "tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    (tools_dir / "__init__.py").write_text("", encoding="utf-8")
    (tools_dir / "echo.py").write_text(
        """
def echo_tool(text: str) -> str:
    return text
""".strip()
        + "\n",
        encoding="utf-8",
    )

    catalog = (
        WorkspaceMcpCatalogEntry(
            tool_id="workspace.echo",
            tool_name="echo",
            module_path="tools.echo",
            symbol_name="echo_tool",
        ),
    )
    loaded = load_workspace_tools(workspace_dir=tmp_path, catalog=catalog)
    assert len(loaded) == 1
    assert loaded[0].tool_name == "echo"
    assert loaded[0].callable_obj("hello") == "hello"


def test_load_workspace_tools_rejects_non_tools_module_prefix(tmp_path: Path) -> None:
    catalog = (
        WorkspaceMcpCatalogEntry(
            tool_id="workspace.echo",
            tool_name="echo",
            module_path="bad_prefix.echo",
            symbol_name="echo_tool",
        ),
    )

    with pytest.raises(WorkspaceRuntimeConfigError) as exc:
        load_workspace_tools(workspace_dir=tmp_path, catalog=catalog)
    assert exc.value.code == "workspace_mcp_catalog_entry_invalid"
