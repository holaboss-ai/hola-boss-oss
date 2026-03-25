from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import CallToolResult

from sandbox_agent_runtime.runtime_config.errors import WorkspaceRuntimeConfigError
from sandbox_agent_runtime.runtime_config.models import WorkspaceMcpCatalogEntry
from sandbox_agent_runtime.workspace_tool_loader import load_workspace_tools

logging.basicConfig(level=os.getenv("SANDBOX_AGENT_LOG_LEVEL", "INFO"))
logger = logging.getLogger("workspace_tool_bridge")


@dataclass(frozen=True)
class WorkspaceToolBridgeRequest:
    workspace_dir: str
    catalog_json_base64: str


@dataclass(frozen=True)
class WorkspaceToolCallRequest(WorkspaceToolBridgeRequest):
    tool_name: str
    arguments: dict[str, object]


def _parse_args(argv: list[str]) -> tuple[str, str]:
    parser = argparse.ArgumentParser(description="Workspace tool bridge for runtime-local workspace tools")
    parser.add_argument("operation", choices=("inspect", "call"))
    parser.add_argument("--request-base64", required=True, help="Base64-encoded JSON request payload")
    parsed = parser.parse_args(argv)
    return str(parsed.operation), str(parsed.request_base64)


def _decode_request_base64(encoded: str) -> dict[str, object]:
    try:
        raw = base64.b64decode(encoded.encode("utf-8"), validate=True).decode("utf-8")
        payload = json.loads(raw)
    except Exception as exc:
        raise WorkspaceRuntimeConfigError(
            code="workspace_tool_bridge_failed",
            path="request_base64",
            message=f"invalid bridge request payload: {exc}",
        ) from exc
    if not isinstance(payload, dict):
        raise WorkspaceRuntimeConfigError(
            code="workspace_tool_bridge_failed",
            path="request_base64",
            message="request payload must decode to an object",
        )
    return payload


def _request_string(payload: dict[str, object], *, key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise WorkspaceRuntimeConfigError(
            code="workspace_tool_bridge_failed",
            path=key,
            message=f"{key} is required",
        )
    return value


def _request_arguments(payload: dict[str, object]) -> dict[str, object]:
    value = payload.get("arguments", {})
    if not isinstance(value, dict):
        raise WorkspaceRuntimeConfigError(
            code="workspace_tool_bridge_failed",
            path="arguments",
            message="arguments must be an object",
        )
    return value


def _decode_inspect_request(encoded: str) -> WorkspaceToolBridgeRequest:
    payload = _decode_request_base64(encoded)
    return WorkspaceToolBridgeRequest(
        workspace_dir=_request_string(payload, key="workspace_dir"),
        catalog_json_base64=_request_string(payload, key="catalog_json_base64"),
    )


def _decode_call_request(encoded: str) -> WorkspaceToolCallRequest:
    payload = _decode_request_base64(encoded)
    return WorkspaceToolCallRequest(
        workspace_dir=_request_string(payload, key="workspace_dir"),
        catalog_json_base64=_request_string(payload, key="catalog_json_base64"),
        tool_name=_request_string(payload, key="tool_name"),
        arguments=_request_arguments(payload),
    )


def _decode_catalog(encoded: str) -> tuple[WorkspaceMcpCatalogEntry, ...]:
    try:
        raw = base64.b64decode(encoded.encode("utf-8"), validate=True).decode("utf-8")
        payload = json.loads(raw)
    except Exception as exc:
        raise WorkspaceRuntimeConfigError(
            code="workspace_tool_bridge_failed",
            path="catalog_json_base64",
            message=f"invalid bridge catalog payload: {exc}",
        ) from exc
    if not isinstance(payload, list):
        raise WorkspaceRuntimeConfigError(
            code="workspace_tool_bridge_failed",
            path="catalog_json_base64",
            message="catalog payload must decode to a list",
        )

    entries: list[WorkspaceMcpCatalogEntry] = []
    for item in payload:
        if not isinstance(item, dict):
            raise WorkspaceRuntimeConfigError(
                code="workspace_tool_bridge_failed",
                path="catalog_json_base64",
                message="catalog entries must be objects",
            )
        entries.append(
            WorkspaceMcpCatalogEntry(
                tool_id=str(item.get("tool_id", "")),
                tool_name=str(item.get("tool_name", "")),
                module_path=str(item.get("module_path", "")),
                symbol_name=str(item.get("symbol_name", "")),
            )
        )
    return tuple(entries)


def _workspace_path(value: str) -> Path:
    path = Path(value).resolve()
    if not path.is_dir():
        raise WorkspaceRuntimeConfigError(
            code="workspace_tool_bridge_failed",
            path="workspace_dir",
            message=f"workspace directory does not exist: {path}",
        )
    return path


def _json_default(value: object) -> object:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _mcp_server(*, workspace_dir: Path, catalog: tuple[WorkspaceMcpCatalogEntry, ...]) -> FastMCP:
    loaded_tools = load_workspace_tools(workspace_dir=workspace_dir, catalog=catalog)
    mcp = FastMCP("workspace_tool_bridge")
    for tool in loaded_tools:
        mcp.tool(name=tool.tool_name)(tool.callable_obj)
    return mcp


async def _inspect(request: WorkspaceToolBridgeRequest) -> dict[str, object]:
    workspace_dir = _workspace_path(request.workspace_dir)
    catalog = _decode_catalog(request.catalog_json_base64)
    tools = await _mcp_server(workspace_dir=workspace_dir, catalog=catalog).list_tools()
    return {
        "tools": json.loads(json.dumps(tools, default=_json_default))
    }


def _call_result_payload(result: object) -> dict[str, object]:
    if isinstance(result, CallToolResult):
        return json.loads(result.model_dump_json(by_alias=True, exclude_none=True))
    if isinstance(result, tuple) and len(result) == 2:
        unstructured, structured = result
        return {
            "content": json.loads(json.dumps(unstructured, default=_json_default)),
            "structuredContent": json.loads(json.dumps(structured, default=_json_default)),
        }
    return {
        "content": json.loads(json.dumps(result, default=_json_default)),
    }


async def _call(request: WorkspaceToolCallRequest) -> dict[str, object]:
    workspace_dir = _workspace_path(request.workspace_dir)
    catalog = _decode_catalog(request.catalog_json_base64)
    mcp = _mcp_server(workspace_dir=workspace_dir, catalog=catalog)
    try:
        result = await mcp.call_tool(request.tool_name, request.arguments)
    except ToolError as exc:
        return {
            "content": [{"type": "text", "text": str(exc)}],
            "isError": True,
        }
    return _call_result_payload(result)


def main(argv: list[str] | None = None) -> int:
    operation, encoded_request = _parse_args(argv or sys.argv[1:])
    try:
        if operation == "inspect":
            payload = asyncio.run(_inspect(_decode_inspect_request(encoded_request)))
        else:
            payload = asyncio.run(_call(_decode_call_request(encoded_request)))
    except WorkspaceRuntimeConfigError:
        logger.exception("Workspace tool bridge configuration failure")
        return 2
    except Exception:
        logger.exception("Workspace tool bridge failed")
        return 1

    sys.stdout.write(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
