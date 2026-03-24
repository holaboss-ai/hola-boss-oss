# ruff: noqa: S101

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from sandbox_agent_runtime import app_lifecycle_executor as executor_module


@pytest.mark.asyncio
async def test_run_returns_validation_error_for_invalid_app_id(
    capsys: pytest.CaptureFixture[str],
) -> None:
    rc = await executor_module._run(action="start", workspace_id="workspace-1", app_id="../bad")

    captured = capsys.readouterr()
    assert rc == 0
    payload = json.loads(captured.out)
    assert payload["status_code"] == 400
    assert "app_id" in payload["detail"]


@pytest.mark.asyncio
async def test_run_start_prints_app_action_payload(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    manager = SimpleNamespace(
        _port_allocations={},
        _get_mcp_host_port=lambda resolved_app: 13101,
    )

    async def _healthy(*args, **kwargs) -> bool:
        del args, kwargs
        return True

    async def _start_app(resolved_app) -> None:
        del resolved_app

    async def _wait_healthy(*args, **kwargs) -> None:
        del args, kwargs

    manager._is_app_healthy = _healthy
    manager._start_app = _start_app
    manager._wait_healthy_with_retry = _wait_healthy

    monkeypatch.setattr(executor_module, "_resolve_app_from_workspace", lambda workspace_id, app_id: (SimpleNamespace(), app_id, "apps/app-b/app.runtime.yaml"))
    monkeypatch.setattr(executor_module, "_load_resolved_app", lambda workspace_dir, app_id, config_path: SimpleNamespace(app_id=app_id))
    monkeypatch.setattr(executor_module, "_get_lifecycle_manager", lambda workspace_id: manager)
    monkeypatch.setattr(executor_module, "_app_index_in_workspace", lambda workspace_dir, app_id: 1)
    monkeypatch.setattr(executor_module, "_ports_for_app_index", lambda index: (18081, 13101))

    rc = await executor_module._run(action="start", workspace_id="workspace-1", app_id="app-b")

    captured = capsys.readouterr()
    assert rc == 0
    payload = json.loads(captured.out)
    assert payload["status_code"] == 200
    assert payload["payload"] == {
        "app_id": "app-b",
        "status": "started",
        "detail": "app started with lifecycle manager",
        "ports": {"http": 18081, "mcp": 13101},
    }


@pytest.mark.asyncio
async def test_run_stop_prints_app_action_payload(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def _stop_all(apps) -> None:
        assert len(apps) == 1

    manager = SimpleNamespace(
        _port_allocations={"app-b": (18081, 13101)},
        stop_all=_stop_all,
    )

    monkeypatch.setattr(executor_module, "_resolve_app_from_workspace", lambda workspace_id, app_id: (SimpleNamespace(), app_id, "apps/app-b/app.runtime.yaml"))
    monkeypatch.setattr(executor_module, "_load_resolved_app", lambda workspace_dir, app_id, config_path: SimpleNamespace(app_id=app_id))
    monkeypatch.setattr(executor_module, "_get_lifecycle_manager", lambda workspace_id: manager)

    rc = await executor_module._run(action="stop", workspace_id="workspace-1", app_id="app-b")

    captured = capsys.readouterr()
    assert rc == 0
    payload = json.loads(captured.out)
    assert payload["status_code"] == 200
    assert payload["payload"] == {
        "app_id": "app-b",
        "status": "stopped",
        "detail": "app stopped via lifecycle manager",
        "ports": {},
    }
    assert manager._port_allocations == {}
