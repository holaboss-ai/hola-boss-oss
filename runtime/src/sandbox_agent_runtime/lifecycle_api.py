from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException

from sandbox_agent_runtime.api_models import AppActionResult, AppStartRequest, AppStopRequest, ShutdownResult
from sandbox_agent_runtime.application_lifecycle import ApplicationLifecycleManager
from sandbox_agent_runtime.runtime_config.application_loader import _parse_app_runtime_yaml
from sandbox_agent_runtime.workspace_scope import WORKSPACE_ROOT

logger = logging.getLogger("sandbox_agent_api")

_lifecycle_managers: dict[str, ApplicationLifecycleManager] = {}


def _get_lifecycle_manager(workspace_id: str) -> ApplicationLifecycleManager:
    if workspace_id not in _lifecycle_managers:
        workspace_dir = Path(WORKSPACE_ROOT) / workspace_id
        _lifecycle_managers[workspace_id] = ApplicationLifecycleManager(workspace_dir=workspace_dir)
    return _lifecycle_managers[workspace_id]


def _resolve_app_from_workspace(workspace_id: str, target_app_id: str) -> tuple[Path, str, str]:
    workspace_dir = Path(WORKSPACE_ROOT) / workspace_id
    workspace_yaml_path = workspace_dir / "workspace.yaml"

    if not workspace_yaml_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"workspace.yaml not found for workspace '{workspace_id}'",
        )

    data = yaml.safe_load(workspace_yaml_path.read_text())
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="workspace.yaml is not a valid mapping")

    applications = data.get("applications")
    if not isinstance(applications, list):
        raise HTTPException(status_code=400, detail="workspace.yaml has no applications list")

    for entry in applications:
        if not isinstance(entry, dict):
            continue
        entry_app_id = str(entry.get("app_id") or "")
        if entry_app_id == target_app_id:
            config_path = str(entry.get("config_path") or "")
            return workspace_dir, entry_app_id, config_path

    raise HTTPException(
        status_code=404,
        detail=f"app '{target_app_id}' not found in workspace.yaml",
    )


def _load_resolved_app(workspace_dir: Path, app_id: str, config_path: str):
    yaml_path = workspace_dir / config_path
    if not yaml_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"app config not found: '{config_path}'",
        )

    raw_yaml = yaml_path.read_text()
    return _parse_app_runtime_yaml(
        raw_yaml=raw_yaml,
        declared_app_id=app_id,
        config_path=config_path,
    )


def _app_index_in_workspace(workspace_dir: Path, target_app_id: str) -> int:
    workspace_yaml_path = workspace_dir / "workspace.yaml"
    if not workspace_yaml_path.exists():
        return 0
    data = yaml.safe_load(workspace_yaml_path.read_text())
    if not isinstance(data, dict):
        return 0
    applications = data.get("applications")
    if not isinstance(applications, list):
        return 0
    for index, entry in enumerate(applications):
        if isinstance(entry, dict) and str(entry.get("app_id") or "") == target_app_id:
            return index
    return 0


def _ports_for_app_index(index: int) -> tuple[int, int]:
    from sandbox_agent_runtime.application_lifecycle import _APP_HTTP_PORT_BASE, _MCP_PORT_BASE

    return (_APP_HTTP_PORT_BASE + index, _MCP_PORT_BASE + index)


def _find_workspace_yaml() -> Path | None:
    root = Path(WORKSPACE_ROOT)
    if not root.is_dir():
        return None
    for child in root.iterdir():
        if child.is_dir():
            candidate = child / "workspace.yaml"
            if candidate.exists():
                return candidate
    return None


def _parse_app_ports_from_yaml(workspace_yaml_path: Path) -> dict[str, dict[str, int]]:
    data = yaml.safe_load(workspace_yaml_path.read_text())
    if not isinstance(data, dict):
        return {}
    applications = data.get("applications")
    if not isinstance(applications, list):
        return {}
    result: dict[str, dict[str, int]] = {}
    for index, entry in enumerate(applications):
        if not isinstance(entry, dict):
            continue
        app_id = str(entry.get("app_id") or "")
        if not app_id:
            continue
        http_port, mcp_port = _ports_for_app_index(index)
        result[app_id] = {"http": http_port, "mcp": mcp_port}
    return result


def _resolve_apps_from_workspace_yaml(workspace_yaml: Path) -> list[tuple[str, Path]]:
    data = yaml.safe_load(workspace_yaml.read_text())
    if not isinstance(data, dict):
        return []

    applications = data.get("applications")
    if not isinstance(applications, list):
        return []

    workspace_dir = workspace_yaml.parent
    result: list[tuple[str, Path]] = []
    for entry in applications:
        if not isinstance(entry, dict):
            continue
        app_id = str(entry.get("app_id") or "")
        config_path = str(entry.get("config_path") or "")
        if not app_id:
            continue
        app_dir = workspace_dir / str(Path(config_path).parent) if config_path else workspace_dir / "apps" / app_id
        result.append((app_id, app_dir))
    return result


async def _find_lifecycle_compose_command() -> list[str] | None:
    for cmd in (["docker", "compose"], ["docker-compose"]):
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                "version",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.wait()
            if proc.returncode == 0:
                return cmd
        except FileNotFoundError:
            continue
    return None


def register_lifecycle_routes(app: FastAPI) -> None:
    @app.post("/api/v1/lifecycle/shutdown")
    async def lifecycle_shutdown() -> ShutdownResult:
        stopped: list[str] = []
        failed: list[str] = []

        workspace_root = Path(WORKSPACE_ROOT)
        if not workspace_root.is_dir():
            return ShutdownResult(stopped=stopped, failed=failed)

        for workspace_dir in workspace_root.iterdir():
            if not workspace_dir.is_dir():
                continue
            workspace_yaml = workspace_dir / "workspace.yaml"
            if not workspace_yaml.exists():
                continue

            try:
                apps = _resolve_apps_from_workspace_yaml(workspace_yaml)
            except Exception as exc:
                logger.warning("Failed to parse %s: %s", workspace_yaml, exc)
                continue

            if not apps:
                continue

            for app_id, app_dir in apps:
                compose_file = app_dir / "docker-compose.yml"
                compose_file_yaml = app_dir / "docker-compose.yaml"
                if not (compose_file.exists() or compose_file_yaml.exists()):
                    continue
                try:
                    compose_cmd = await _find_lifecycle_compose_command()
                    if compose_cmd is None:
                        continue
                    proc = await asyncio.create_subprocess_exec(
                        *compose_cmd,
                        "down",
                        "--remove-orphans",
                        cwd=str(app_dir),
                        env={**os.environ},
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    returncode = await proc.wait()
                    if returncode == 0:
                        stopped.append(app_id)
                        logger.info("Stopped app '%s' in %s", app_id, workspace_dir.name)
                    else:
                        failed.append(app_id)
                        stderr = (await proc.stderr.read()).decode(errors="replace") if proc.stderr else ""
                        logger.warning("Failed to stop app '%s': %s", app_id, stderr[:300])
                except Exception as exc:
                    failed.append(app_id)
                    logger.warning("Error stopping app '%s': %s", app_id, exc)

        return ShutdownResult(stopped=stopped, failed=failed)

    @app.get("/api/v1/apps/ports")
    async def list_app_ports(workspace_id: str | None = None) -> dict[str, dict[str, int]]:
        if workspace_id:
            workspace_yaml_path = Path(WORKSPACE_ROOT) / workspace_id / "workspace.yaml"
        else:
            workspace_yaml_path = _find_workspace_yaml()

        if not workspace_yaml_path or not workspace_yaml_path.exists():
            return {}
        return _parse_app_ports_from_yaml(workspace_yaml_path)

    @app.post("/api/v1/apps/{app_id}/start")
    async def start_app_endpoint(app_id: str, payload: AppStartRequest) -> AppActionResult:
        workspace_dir, resolved_app_id, config_path = _resolve_app_from_workspace(payload.workspace_id, app_id)

        try:
            resolved_app = _load_resolved_app(workspace_dir, resolved_app_id, config_path)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"failed to parse app config: {exc}") from exc

        manager = _get_lifecycle_manager(payload.workspace_id)

        try:
            index = _app_index_in_workspace(workspace_dir, resolved_app_id)
            http_port, mcp_port = _ports_for_app_index(index)
            manager._port_allocations[resolved_app_id] = (http_port, mcp_port)
            logger.info(
                "Assigned deterministic ports for app '%s': HTTP=%d, MCP=%d",
                resolved_app_id,
                http_port,
                mcp_port,
            )

            mcp_host_port = manager._get_mcp_host_port(resolved_app)
            if not await manager._is_app_healthy(resolved_app, mcp_host_port=mcp_host_port):
                await manager._start_app(resolved_app)
                await manager._wait_healthy_with_retry(resolved_app)
            else:
                logger.info("App '%s' already healthy on port %d, skipping start", app_id, mcp_host_port)
        except Exception as exc:
            logger.exception("Failed to start app '%s'", app_id)
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

    @app.post("/api/v1/apps/{app_id}/stop")
    async def stop_app_endpoint(app_id: str, payload: AppStopRequest) -> AppActionResult:
        workspace_dir, resolved_app_id, config_path = _resolve_app_from_workspace(payload.workspace_id, app_id)

        try:
            resolved_app = _load_resolved_app(workspace_dir, resolved_app_id, config_path)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"failed to parse app config: {exc}") from exc

        manager = _get_lifecycle_manager(payload.workspace_id)

        try:
            await manager.stop_all([resolved_app])
        except Exception as exc:
            logger.exception("Failed to stop app '%s'", app_id)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        manager._port_allocations.pop(resolved_app_id, None)

        return AppActionResult(
            app_id=resolved_app_id,
            status="stopped",
            detail="app stopped via lifecycle manager",
        )
