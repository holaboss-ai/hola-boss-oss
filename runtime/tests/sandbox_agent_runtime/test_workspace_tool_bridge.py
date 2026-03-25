# ruff: noqa: S101

from __future__ import annotations

import asyncio
import base64
import json
from pathlib import Path

from sandbox_agent_runtime import workspace_tool_bridge
from sandbox_agent_runtime.runtime_config.errors import WorkspaceRuntimeConfigError


def test_decode_inspect_request_from_args() -> None:
    encoded = base64.b64encode(
        json.dumps(
            {
                "workspace_dir": "/tmp/workspace-1",
                "catalog_json_base64": "W10=",
            }
        ).encode("utf-8")
    ).decode("utf-8")

    operation, payload = workspace_tool_bridge._parse_args(["inspect", "--request-base64", encoded])
    request = workspace_tool_bridge._decode_inspect_request(payload)

    assert operation == "inspect"
    assert request.workspace_dir == "/tmp/workspace-1"
    assert request.catalog_json_base64 == "W10="


def test_decode_call_request_from_args() -> None:
    encoded = base64.b64encode(
        json.dumps(
            {
                "workspace_dir": "/tmp/workspace-1",
                "catalog_json_base64": "W10=",
                "tool_name": "echo",
                "arguments": {"text": "hello"},
            }
        ).encode("utf-8")
    ).decode("utf-8")

    operation, payload = workspace_tool_bridge._parse_args(["call", "--request-base64", encoded])
    request = workspace_tool_bridge._decode_call_request(payload)

    assert operation == "call"
    assert request.tool_name == "echo"
    assert request.arguments == {"text": "hello"}


def test_decode_request_rejects_invalid_request_base64() -> None:
    try:
        workspace_tool_bridge._decode_inspect_request("not-base64")
    except WorkspaceRuntimeConfigError as exc:
        assert exc.path == "request_base64"
    else:
        raise AssertionError("expected WorkspaceRuntimeConfigError")


def test_call_invokes_workspace_tool(tmp_path: Path) -> None:
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

    catalog = base64.b64encode(
        json.dumps(
            [
                {
                    "tool_id": "workspace.echo",
                    "tool_name": "echo",
                    "module_path": "tools.echo",
                    "symbol_name": "echo_tool",
                }
            ]
        ).encode("utf-8")
    ).decode("utf-8")

    result = asyncio.run(
        workspace_tool_bridge._call(
            workspace_tool_bridge.WorkspaceToolCallRequest(
                workspace_dir=str(tmp_path),
                catalog_json_base64=catalog,
                tool_name="echo",
                arguments={"text": "hello"},
            )
        )
    )

    assert result == {
        "content": [{"type": "text", "text": "hello"}],
        "structuredContent": {"result": "hello"},
    }
