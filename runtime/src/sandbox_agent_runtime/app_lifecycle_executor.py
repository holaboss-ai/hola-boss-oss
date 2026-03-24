from __future__ import annotations

import argparse
import asyncio
import json

from fastapi import HTTPException

from sandbox_agent_runtime.api_models import AppActionResult
from sandbox_agent_runtime.lifecycle_api import (
    _app_index_in_workspace,
    _get_lifecycle_manager,
    _load_resolved_app,
    _ports_for_app_index,
    _resolve_app_from_workspace,
)
from sandbox_agent_runtime.workspace_scope import sanitize_app_id, sanitize_workspace_id


def _print_envelope(*, status_code: int, payload: dict | None = None, detail: str | None = None) -> None:
    print(
        json.dumps(
            {
                "status_code": status_code,
                "payload": payload,
                "detail": detail,
            },
            ensure_ascii=True,
        ),
        end="",
    )


async def _start_app(*, workspace_id: str, app_id: str) -> AppActionResult:
    workspace_dir, resolved_app_id, config_path = _resolve_app_from_workspace(workspace_id, app_id)
    try:
        resolved_app = _load_resolved_app(workspace_dir, resolved_app_id, config_path)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"failed to parse app config: {exc}") from exc

    manager = _get_lifecycle_manager(workspace_id)
    try:
        index = _app_index_in_workspace(workspace_dir, resolved_app_id)
        http_port, mcp_port = _ports_for_app_index(index)
        manager._port_allocations[resolved_app_id] = (http_port, mcp_port)
        mcp_host_port = manager._get_mcp_host_port(resolved_app)
        if not await manager._is_app_healthy(resolved_app, mcp_host_port=mcp_host_port):
            await manager._start_app(resolved_app)
            await manager._wait_healthy_with_retry(resolved_app)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    ports: dict[str, int] = {}
    if resolved_app_id in manager._port_allocations:
        http_port, mcp_port = manager._port_allocations[resolved_app_id]
        ports = {"http": http_port, "mcp": mcp_port}
    return AppActionResult(
        app_id=resolved_app_id,
        status="started",
        detail="app started with lifecycle manager",
        ports=ports,
    )


async def _stop_app(*, workspace_id: str, app_id: str) -> AppActionResult:
    workspace_dir, resolved_app_id, config_path = _resolve_app_from_workspace(workspace_id, app_id)
    try:
        resolved_app = _load_resolved_app(workspace_dir, resolved_app_id, config_path)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"failed to parse app config: {exc}") from exc

    manager = _get_lifecycle_manager(workspace_id)
    try:
        await manager.stop_all([resolved_app])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    manager._port_allocations.pop(resolved_app_id, None)
    return AppActionResult(
        app_id=resolved_app_id,
        status="stopped",
        detail="app stopped via lifecycle manager",
    )


async def _run(*, action: str, workspace_id: str, app_id: str) -> int:
    try:
        safe_workspace_id = sanitize_workspace_id(workspace_id)
        safe_app_id = sanitize_app_id(app_id)
    except ValueError as exc:
        _print_envelope(status_code=400, detail=str(exc))
        return 0

    if action not in {"start", "stop"}:
        _print_envelope(status_code=400, detail=f"unsupported lifecycle action: {action}")
        return 0

    try:
        result = await (_start_app(workspace_id=safe_workspace_id, app_id=safe_app_id) if action == "start" else _stop_app(workspace_id=safe_workspace_id, app_id=safe_app_id))
    except HTTPException as exc:
        _print_envelope(status_code=exc.status_code, detail=str(exc.detail))
        return 0
    except Exception as exc:
        _print_envelope(status_code=500, detail=str(exc))
        return 0

    _print_envelope(status_code=200, payload=result.model_dump(mode="json"))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Execute an app lifecycle action")
    parser.add_argument("--action", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--app-id", required=True)
    args = parser.parse_args()
    return asyncio.run(_run(action=args.action, workspace_id=args.workspace_id, app_id=args.app_id))


if __name__ == "__main__":
    raise SystemExit(main())
