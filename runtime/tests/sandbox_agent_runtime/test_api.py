# ruff: noqa: S101

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml
from httpx import ASGITransport, AsyncClient
from fastapi.responses import Response, StreamingResponse
from sandbox_agent_runtime import api as api_module
from sandbox_agent_runtime.api import app
from sandbox_agent_runtime.runtime_local_state import (
    claim_inputs,
    create_workspace,
    enqueue_input,
    get_input,
    list_runtime_states,
)

_APP_RUNTIME_YAML = """\
app_id: {app_id}

healthchecks:
  mcp:
    path: /mcp/health
    timeout_s: 60
    interval_s: 5

mcp:
  transport: http-sse
  port: 3099
  path: /mcp
"""


@pytest.mark.asyncio
async def test_runner_routes_proxy_to_ts_api_when_enabled(monkeypatch: pytest.MonkeyPatch, runtime_db_env: Path) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured_json: list[dict[str, object]] = []
    captured_stream: list[dict[str, object]] = []

    async def _fake_proxy_json(method: str, path: str, *, params=None, json_body=None):
        captured_json.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        return Response(
            content=json.dumps({
                "session_id": "session-1",
                "input_id": "input-1",
                "events": [
                    {"session_id": "session-1", "input_id": "input-1", "sequence": 1, "event_type": "run_started", "payload": {"instruction_preview": "hello"}},
                    {"session_id": "session-1", "input_id": "input-1", "sequence": 2, "event_type": "run_completed", "payload": {"status": "success"}},
                ],
            }).encode("utf-8"),
            media_type="application/json",
        )

    async def _fake_proxy_stream(path: str, *, method="GET", params=None, json_body=None):
        captured_stream.append({
            "path": path,
            "method": method,
            "params": params,
            "json_body": json_body,
        })
        return StreamingResponse(
            iter([
                b"event: run_started\nid: input-1:1\ndata: {\"session_id\":\"session-1\",\"input_id\":\"input-1\",\"sequence\":1,\"event_type\":\"run_started\",\"payload\":{\"instruction_preview\":\"hello\"}}\n\n",
                b"event: run_completed\nid: input-1:2\ndata: {\"session_id\":\"session-1\",\"input_id\":\"input-1\",\"sequence\":2,\"event_type\":\"run_completed\",\"payload\":{\"status\":\"success\"}}\n\n",
            ]),
            media_type="text/event-stream",
        )

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy_json)
    monkeypatch.setattr(api_module, "_proxy_ts_api_stream", _fake_proxy_stream)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/agent-runs",
            json={
                "workspace_id": "workspace-1",
                "session_id": "session-1",
                "input_id": "input-1",
                "instruction": "hello",
                "context": {},
            },
        )
        async with client.stream(
            "POST",
            "/api/v1/agent-runs/stream",
            json={
                "workspace_id": "workspace-1",
                "session_id": "session-1",
                "input_id": "input-1",
                "instruction": "hello",
                "context": {},
            },
        ) as stream_response:
            body = await stream_response.aread()

    assert response.status_code == 200
    assert [event["event_type"] for event in response.json()["events"]] == ["run_started", "run_completed"]
    text = body.decode("utf-8", errors="replace")
    assert "event: run_started" in text
    assert "event: run_completed" in text
    assert captured_json == [{
        "method": "POST",
        "path": "/api/v1/agent-runs",
        "params": None,
        "json_body": {
            "holaboss_user_id": None,
            "workspace_id": "workspace-1",
            "session_id": "session-1",
            "input_id": "input-1",
            "instruction": "hello",
            "context": {},
            "model": None,
            "debug": False,
        },
    }]
    assert captured_stream == [{
        "path": "/api/v1/agent-runs/stream",
        "method": "POST",
        "params": None,
        "json_body": {
            "holaboss_user_id": None,
            "workspace_id": "workspace-1",
            "session_id": "session-1",
            "input_id": "input-1",
            "instruction": "hello",
            "context": {},
            "model": None,
            "debug": False,
        },
    }]


@pytest.mark.asyncio
async def test_memory_routes_proxy_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        if path.endswith("/search"):
            payload = {"workspace_id": "workspace-1", "query": "durable preferences", "hits": []}
        elif path.endswith("/get"):
            payload = {"path": "workspace/workspace-1/preferences.md", "text": ""}
        elif path.endswith("/upsert"):
            payload = {"path": "workspace/workspace-1/preferences.md", "updated": True}
        elif path.endswith("/status"):
            payload = {"workspace_id": "workspace-1", "synced": True}
        else:
            payload = {"workspace_id": "workspace-1", "queued": True}
        return Response(content=json.dumps(payload).encode("utf-8"), media_type="application/json")

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        searched = await client.post(
            "/api/v1/memory/search",
            json={
                "workspace_id": "workspace-1",
                "query": "durable preferences",
                "max_results": 5,
                "min_score": 0.1,
            },
        )
        fetched = await client.post(
            "/api/v1/memory/get",
            json={"workspace_id": "workspace-1", "path": "workspace/workspace-1/preferences.md"},
        )
        upserted = await client.post(
            "/api/v1/memory/upsert",
            json={
                "workspace_id": "workspace-1",
                "path": "workspace/workspace-1/preferences.md",
                "content": "coffee",
                "append": False,
            },
        )
        status = await client.post("/api/v1/memory/status", json={"workspace_id": "workspace-1"})
        synced = await client.post(
            "/api/v1/memory/sync",
            json={"workspace_id": "workspace-1", "reason": "manual", "force": True},
        )

    assert searched.status_code == 200
    assert fetched.status_code == 200
    assert upserted.status_code == 200
    assert status.status_code == 200
    assert synced.status_code == 200
    assert captured == [
        {
            "method": "POST",
            "path": "/api/v1/memory/search",
            "params": None,
            "json_body": {
                "workspace_id": "workspace-1",
                "query": "durable preferences",
                "max_results": 5,
                "min_score": 0.1,
            },
        },
        {
            "method": "POST",
            "path": "/api/v1/memory/get",
            "params": None,
            "json_body": {
                "workspace_id": "workspace-1",
                "path": "workspace/workspace-1/preferences.md",
                "from_line": None,
                "lines": None,
            },
        },
        {
            "method": "POST",
            "path": "/api/v1/memory/upsert",
            "params": None,
            "json_body": {
                "workspace_id": "workspace-1",
                "path": "workspace/workspace-1/preferences.md",
                "content": "coffee",
                "append": False,
            },
        },
        {
            "method": "POST",
            "path": "/api/v1/memory/status",
            "params": None,
            "json_body": {"workspace_id": "workspace-1"},
        },
        {
            "method": "POST",
            "path": "/api/v1/memory/sync",
            "params": None,
            "json_body": {"workspace_id": "workspace-1", "reason": "manual", "force": True},
        },
    ]


@pytest.mark.asyncio
async def test_runtime_config_and_status_routes_proxy_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        if path == "/api/v1/runtime/status":
            payload = {
                "harness": "opencode",
                "config_loaded": True,
                "config_path": "/tmp/runtime-config.json",
                "opencode_config_present": True,
                "harness_ready": True,
                "harness_state": "ready",
                "browser_available": False,
                "browser_state": "unavailable",
                "browser_url": None,
            }
        else:
            payload = {
                "config_path": "/tmp/runtime-config.json",
                "loaded_from_file": True,
                "auth_token_present": True,
                "user_id": "user-1",
                "sandbox_id": "sandbox-1",
                "model_proxy_base_url": "https://runtime.example/api/v1/model-proxy",
                "default_model": "openai/gpt-5.1",
                "runtime_mode": "oss",
                "default_provider": "holaboss_model_proxy",
                "holaboss_enabled": True,
                "desktop_browser_enabled": False,
                "desktop_browser_url": None,
            }
        return Response(content=json.dumps(payload).encode("utf-8"), media_type="application/json")

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        config = await client.get("/api/v1/runtime/config")
        status = await client.get("/api/v1/runtime/status")
        updated = await client.put(
            "/api/v1/runtime/config",
            json={
                "auth_token": "token-1",
                "user_id": "user-1",
                "sandbox_id": "sandbox-1",
                "model_proxy_base_url": "https://runtime.example/api/v1/model-proxy",
                "default_model": "openai/gpt-5.1",
            },
        )

    assert config.status_code == 200
    assert status.status_code == 200
    assert updated.status_code == 200
    assert captured == [
        {
            "method": "GET",
            "path": "/api/v1/runtime/config",
            "params": None,
            "json_body": None,
        },
        {
            "method": "GET",
            "path": "/api/v1/runtime/status",
            "params": None,
            "json_body": None,
        },
        {
            "method": "PUT",
            "path": "/api/v1/runtime/config",
            "params": None,
            "json_body": {
                "auth_token": "token-1",
                "user_id": "user-1",
                "sandbox_id": "sandbox-1",
                "model_proxy_base_url": "https://runtime.example/api/v1/model-proxy",
                "default_model": "openai/gpt-5.1",
                "runtime_mode": None,
                "default_provider": None,
                "holaboss_enabled": None,
                "desktop_browser_enabled": None,
                "desktop_browser_url": None,
            },
        },
    ]


@pytest.fixture
def runtime_db_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    db_path = tmp_path / "runtime.db"
    workspace_root = tmp_path / "workspace"
    monkeypatch.setenv("HOLABOSS_RUNTIME_DB_PATH", str(db_path))
    monkeypatch.setattr("sandbox_agent_runtime.api.WORKSPACE_ROOT", str(workspace_root))
    monkeypatch.setattr("sandbox_agent_runtime.runtime_local_state.WORKSPACE_ROOT", str(workspace_root))
    return db_path


def _write_workspace_apps(workspace_root: Path, workspace_id: str, app_ids: list[str]) -> None:
    workspace_dir = workspace_root / workspace_id
    (workspace_dir / "apps").mkdir(parents=True, exist_ok=True)
    applications: list[dict[str, str]] = []
    for app_id in app_ids:
        app_dir = workspace_dir / "apps" / app_id
        app_dir.mkdir(parents=True, exist_ok=True)
        (app_dir / "app.runtime.yaml").write_text(_APP_RUNTIME_YAML.format(app_id=app_id), encoding="utf-8")
        applications.append({"app_id": app_id, "config_path": f"apps/{app_id}/app.runtime.yaml"})
    (workspace_dir / "workspace.yaml").write_text(
        yaml.safe_dump({"applications": applications}),
        encoding="utf-8",
    )


@pytest.mark.asyncio
async def test_app_ports_endpoint_proxies_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        return Response(
            content=json.dumps({
                "app-a": {"http": 18080, "mcp": 13100},
                "app-b": {"http": 18081, "mcp": 13101},
            }).encode("utf-8"),
            media_type="application/json",
        )

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/apps/ports", params={"workspace_id": "workspace-1"})

    assert response.status_code == 200
    assert response.json() == {
        "app-a": {"http": 18080, "mcp": 13100},
        "app-b": {"http": 18081, "mcp": 13101},
    }
    assert captured == [{
        "method": "GET",
        "path": "/api/v1/apps/ports",
        "params": {"workspace_id": "workspace-1"},
        "json_body": None,
    }]


@pytest.mark.asyncio
async def test_app_lifecycle_routes_proxy_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        if path.endswith("/start"):
            payload = {
                "app_id": "app-b",
                "status": "started",
                "detail": "app started with lifecycle manager",
                "ports": {"http": 18081, "mcp": 13101},
            }
        elif path.endswith("/stop"):
            payload = {
                "app_id": "app-b",
                "status": "stopped",
                "detail": "app stopped via lifecycle manager",
                "ports": {},
            }
        else:
            payload = {
                "app_id": "app-b",
                "status": "uninstalled",
                "detail": "App stopped, files removed, workspace.yaml updated",
                "ports": {},
            }
        return Response(content=json.dumps(payload).encode("utf-8"), media_type="application/json")

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        started = await client.post("/api/v1/apps/app-b/start", json={"workspace_id": "workspace-1"})
        stopped = await client.post("/api/v1/apps/app-b/stop", json={"workspace_id": "workspace-1"})
        uninstalled = await client.request("DELETE", "/api/v1/apps/app-b", json={"workspace_id": "workspace-1"})

    assert started.status_code == 200
    assert stopped.status_code == 200
    assert uninstalled.status_code == 200
    assert captured == [
        {
            "method": "POST",
            "path": "/api/v1/apps/app-b/start",
            "params": None,
            "json_body": {"workspace_id": "workspace-1", "env": {}},
        },
        {
            "method": "POST",
            "path": "/api/v1/apps/app-b/stop",
            "params": None,
            "json_body": {"workspace_id": "workspace-1"},
        },
        {
            "method": "DELETE",
            "path": "/api/v1/apps/app-b",
            "params": None,
            "json_body": {"workspace_id": "workspace-1"},
        },
    ]


@pytest.mark.asyncio
async def test_lifecycle_shutdown_route_proxies_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        return Response(
            content=json.dumps({"stopped": ["app-a"], "failed": []}).encode("utf-8"),
            media_type="application/json",
        )

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/lifecycle/shutdown")

    assert response.status_code == 200
    assert response.json() == {"stopped": ["app-a"], "failed": []}
    assert captured == [{
        "method": "POST",
        "path": "/api/v1/lifecycle/shutdown",
        "params": None,
        "json_body": None,
    }]


@pytest.mark.asyncio
async def test_queue_endpoint_persists_local_input_and_runtime_state(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    workspace = create_workspace(
        name="Workspace 1",
        harness="opencode",
        status="active",
        main_session_id="session-main",
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/agent-sessions/queue",
            json={
                "workspace_id": workspace.id,
                "text": "hello world",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == "session-main"
    assert payload["status"] == "QUEUED"

    queued = get_input(payload["input_id"])
    assert queued is not None
    assert queued.payload["text"] == "hello world"
    assert "holaboss_user_id" not in queued.payload
    runtime_states = list_runtime_states(workspace.id)
    assert runtime_states[0]["status"] == "QUEUED"
    assert runtime_states[0]["current_input_id"] == payload["input_id"]


@pytest.mark.asyncio
async def test_process_claimed_input_hydrates_runtime_exec_context_from_runtime_config(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env
    workspace = create_workspace(
        name="Workspace hydrate context",
        harness="opencode",
        status="active",
        main_session_id="session-main",
    )
    queued = enqueue_input(
        workspace_id=workspace.id,
        session_id="session-main",
        payload={"text": "hello", "context": {}},
    )
    claimed = claim_inputs(limit=1, claimed_by="test-worker", lease_seconds=60)
    assert claimed
    record = claimed[0]
    assert record.input_id == queued.input_id

    captured_context: dict[str, object] = {}

    async def _fake_execute_runner_request(request, on_event=None):
        del on_event
        captured_context.update(request.context)
        return api_module._RunnerExecutionResult(
            events=[],
            skipped_lines=[],
            stderr="",
            return_code=0,
            saw_terminal=True,
        )

    monkeypatch.setattr(
        "sandbox_agent_runtime.local_execution_service.execute_local_runner_request",
        _fake_execute_runner_request,
    )
    monkeypatch.setattr(
        "sandbox_agent_runtime.local_execution_service.resolve_product_runtime_config",
        lambda **kwargs: SimpleNamespace(auth_token="token-1", sandbox_id="sandbox-1"),  # noqa: S106
    )

    await api_module._process_claimed_input(record)

    runtime_context = captured_context["_sandbox_runtime_exec_v1"]
    assert isinstance(runtime_context, dict)
    assert runtime_context["model_proxy_api_key"] == "token-1"
    assert runtime_context["sandbox_id"] == "sandbox-1"
    assert runtime_context["harness"] == "opencode"
    assert runtime_context["harness_session_id"] == "session-main"


@pytest.mark.asyncio
async def test_workspace_create_endpoint_proxies_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        return Response(
            content=json.dumps({"workspace": {"id": "workspace-ts", "status": "active"}}).encode("utf-8"),
            media_type="application/json",
        )

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/workspaces",
            json={
                "name": "Workspace TS",
                "harness": "opencode",
                "status": "active",
                "main_session_id": "session-main",
            },
        )

    assert response.status_code == 200
    assert response.json()["workspace"]["id"] == "workspace-ts"
    assert captured == [{
        "method": "POST",
        "path": "/api/v1/workspaces",
        "params": None,
        "json_body": {
            "workspace_id": None,
            "name": "Workspace TS",
            "harness": "opencode",
            "status": "active",
            "main_session_id": "session-main",
            "error_message": None,
            "onboarding_status": "not_required",
            "onboarding_session_id": None,
            "onboarding_completed_at": None,
            "onboarding_completion_summary": None,
            "onboarding_requested_at": None,
            "onboarding_requested_by": None,
        },
    }]


@pytest.mark.asyncio
async def test_history_and_output_events_endpoints_proxy_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        payload = {"ok": True}
        if path.endswith("/history"):
            payload = {"source": "sandbox_local_storage", "messages": []}
        if path.endswith("/outputs/events"):
            payload = {"items": [], "count": 0, "last_event_id": 12}
        return Response(content=json.dumps(payload).encode("utf-8"), media_type="application/json")

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        history = await client.get(
            "/api/v1/agent-sessions/session-main/history",
            params={"workspace_id": "workspace-1", "limit": 50, "offset": 5},
        )
        events = await client.get(
            "/api/v1/agent-sessions/session-main/outputs/events",
            params={"input_id": "input-1", "include_history": "false"},
        )

    assert history.status_code == 200
    assert history.json()["source"] == "sandbox_local_storage"
    assert events.status_code == 200
    assert events.json()["last_event_id"] == 12
    assert captured == [
        {
            "method": "GET",
            "path": "/api/v1/agent-sessions/session-main/history",
            "params": {
                "workspace_id": "workspace-1",
                "limit": 50,
                "offset": 5,
                "include_raw": False,
            },
            "json_body": None,
        },
        {
            "method": "GET",
            "path": "/api/v1/agent-sessions/session-main/outputs/events",
            "params": {
                "input_id": "input-1",
                "include_history": False,
                "after_event_id": 0,
            },
            "json_body": None,
        },
    ]


@pytest.mark.asyncio
async def test_output_stream_endpoint_proxies_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_stream(path: str, *, params=None):
        captured.append({"path": path, "params": params})

        async def _iter():
            yield b": connected\n\n"
            yield b"event: run_completed\ndata: {\"ok\":true}\n\n"

        return StreamingResponse(_iter(), media_type="text/event-stream")

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_stream", _fake_stream)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with (
        AsyncClient(transport=transport, base_url="http://test") as client,
        client.stream(
            "GET",
            "/api/v1/agent-sessions/session-main/outputs/stream",
            params={"input_id": "input-1", "include_history": "false"},
        ) as response,
    ):
        assert response.status_code == 200
        text = (await response.aread()).decode("utf-8", errors="replace")

    assert "event: run_completed" in text
    assert captured == [{
        "path": "/api/v1/agent-sessions/session-main/outputs/stream",
        "params": {
            "input_id": "input-1",
            "include_history": False,
            "stop_on_terminal": True,
        },
    }]


@pytest.mark.asyncio
async def test_workspace_export_endpoint_proxies_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_stream(path: str, *, params=None):
        captured.append({"path": path, "params": params})

        async def _iter():
            yield b"fake tarball"

        return StreamingResponse(
            _iter(),
            media_type="application/gzip",
            headers={"Content-Disposition": "attachment; filename=workspace-1.tar.gz"},
        )

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_stream", _fake_stream)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with (
        AsyncClient(transport=transport, base_url="http://test") as client,
        client.stream("GET", "/api/v1/workspaces/workspace-1/export") as response,
    ):
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/gzip")
        body = await response.aread()

    assert body == b"fake tarball"
    assert captured == [{
        "path": "/api/v1/workspaces/workspace-1/export",
        "params": None,
    }]


@pytest.mark.asyncio
async def test_state_and_artifact_endpoints_proxy_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        payload = {"ok": True}
        if path.endswith("/state"):
            payload = {"effective_state": "QUEUED", "runtime_status": "QUEUED", "current_input_id": None, "heartbeat_at": None, "lease_until": None}
        if path.endswith("/artifacts") and method == "POST":
            payload = {"artifact": {"id": "artifact-1"}}
        if path.endswith("/artifacts") and method == "GET":
            payload = {"items": [], "count": 0}
        return Response(content=json.dumps(payload).encode("utf-8"), media_type="application/json")

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        state = await client.get(
            "/api/v1/agent-sessions/session-main/state",
            params={"workspace_id": "workspace-1"},
        )
        created_artifact = await client.post(
            "/api/v1/agent-sessions/session-main/artifacts",
            json={
                "workspace_id": "workspace-1",
                "artifact_type": "document",
                "external_id": "doc-1",
            },
        )
        listed_artifacts = await client.get(
            "/api/v1/agent-sessions/session-main/artifacts",
            params={"workspace_id": "workspace-1"},
        )

    assert state.status_code == 200
    assert state.json()["effective_state"] == "QUEUED"
    assert created_artifact.status_code == 200
    assert created_artifact.json()["artifact"]["id"] == "artifact-1"
    assert listed_artifacts.status_code == 200
    assert listed_artifacts.json()["count"] == 0
    assert captured == [
        {
            "method": "GET",
            "path": "/api/v1/agent-sessions/session-main/state",
            "params": {"workspace_id": "workspace-1", "profile_id": None},
            "json_body": None,
        },
        {
            "method": "POST",
            "path": "/api/v1/agent-sessions/session-main/artifacts",
            "params": None,
            "json_body": {
                "workspace_id": "workspace-1",
                "artifact_type": "document",
                "external_id": "doc-1",
                "platform": None,
                "title": None,
                "metadata": {},
            },
        },
        {
            "method": "GET",
            "path": "/api/v1/agent-sessions/session-main/artifacts",
            "params": {"workspace_id": "workspace-1", "profile_id": None},
            "json_body": None,
        },
    ]


@pytest.mark.asyncio
async def test_outputs_cronjobs_and_task_proposals_proxy_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        payload = {"ok": True}
        if path == "/api/v1/output-folders":
            payload = {"folder": {"id": "folder-1"}}
        elif path == "/api/v1/outputs":
            payload = {"items": [], "count": 0} if method == "GET" else {"output": {"id": "output-1"}}
        elif path == "/api/v1/cronjobs":
            payload = {"jobs": [], "count": 0} if method == "GET" else {"id": "job-1"}
        elif path == "/api/v1/task-proposals":
            payload = {"proposals": [], "count": 0} if method == "GET" else {"proposal": {"proposal_id": "proposal-1"}}
        return Response(content=json.dumps(payload).encode("utf-8"), media_type="application/json")

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        folder = await client.post("/api/v1/output-folders", json={"workspace_id": "workspace-1", "name": "Drafts"})
        output = await client.post(
            "/api/v1/outputs",
            json={"workspace_id": "workspace-1", "output_type": "document", "title": "Spec"},
        )
        outputs = await client.get("/api/v1/outputs", params={"workspace_id": "workspace-1"})
        cronjobs = await client.get("/api/v1/cronjobs", params={"workspace_id": "workspace-1"})
        proposal = await client.post(
            "/api/v1/task-proposals",
            json={
                "proposal_id": "proposal-1",
                "workspace_id": "workspace-1",
                "task_name": "Follow up",
                "task_prompt": "Write a follow-up message",
                "task_generation_rationale": "User has not replied",
                "source_event_ids": ["evt-1"],
                "created_at": datetime.now(UTC).isoformat(),
            },
        )

    assert folder.status_code == 200
    assert folder.json()["folder"]["id"] == "folder-1"
    assert output.status_code == 200
    assert output.json()["output"]["id"] == "output-1"
    assert outputs.status_code == 200
    assert cronjobs.status_code == 200
    assert proposal.status_code == 200
    assert proposal.json()["proposal"]["proposal_id"] == "proposal-1"


@pytest.mark.asyncio
async def test_workspace_exec_endpoint_proxies_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        return Response(
            content=json.dumps({"stdout": "/tmp/workspace\n", "stderr": "", "returncode": 0}).encode("utf-8"),
            media_type="application/json",
        )

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/sandbox/users/test-user/workspaces/workspace-1/exec",
            json={"command": "pwd", "timeout_s": 30},
        )

    assert response.status_code == 200
    assert response.json()["returncode"] == 0
    assert captured == [{
        "method": "POST",
        "path": "/api/v1/sandbox/users/test-user/workspaces/workspace-1/exec",
        "params": None,
        "json_body": {"command": "pwd", "timeout_s": 30},
    }]


@pytest.mark.asyncio
async def test_workspace_file_routes_proxy_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        if method == "GET":
            payload = {"path": "docs/readme.md", "content": "hello", "encoding": "utf-8"}
        elif method == "PUT":
            payload = {"path": "docs/readme.md", "status": "written"}
        else:
            payload = {"status": "applied", "files_written": 1}
        return Response(content=json.dumps(payload).encode("utf-8"), media_type="application/json")

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        applied = await client.post(
            "/api/v1/workspaces/workspace-1/apply-template",
            json={"files": [{"path": "docs/readme.md", "content_base64": "aGVsbG8="}], "replace_existing": False},
        )
        read = await client.get("/api/v1/workspaces/workspace-1/files/docs/readme.md")
        written = await client.put(
            "/api/v1/workspaces/workspace-1/files/docs/readme.md",
            json={"content_base64": "aGVsbG8=", "executable": False},
        )
        snapshot = await client.get("/api/v1/workspaces/workspace-1/snapshot")

    assert applied.status_code == 200
    assert read.status_code == 200
    assert written.status_code == 200
    assert snapshot.status_code == 200
    assert captured == [
        {
            "method": "POST",
            "path": "/api/v1/workspaces/workspace-1/apply-template",
            "params": None,
            "json_body": {
                "files": [{"path": "docs/readme.md", "content_base64": "aGVsbG8="}],
                "replace_existing": False,
            },
        },
        {
            "method": "GET",
            "path": "/api/v1/workspaces/workspace-1/files/docs/readme.md",
            "params": None,
            "json_body": None,
        },
        {
            "method": "PUT",
            "path": "/api/v1/workspaces/workspace-1/files/docs/readme.md",
            "params": None,
            "json_body": {"content_base64": "aGVsbG8=", "executable": False},
        },
        {
            "method": "GET",
            "path": "/api/v1/workspaces/workspace-1/snapshot",
            "params": None,
            "json_body": None,
        },
    ]


@pytest.mark.asyncio
async def test_app_install_and_status_routes_proxy_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        payload = {"ok": True}
        if path == "/api/v1/apps":
            payload = {"apps": [], "count": 0}
        elif path.endswith("/build-status"):
            payload = {"status": "unknown"}
        elif path.endswith("/setup"):
            payload = {"app_id": "demo-app", "status": "setup_started", "detail": "Running: npm install", "ports": {}}
        elif path == "/api/v1/apps/install":
            payload = {"app_id": "demo-app", "status": "installed", "detail": "Files written, no setup command defined"}
        return Response(content=json.dumps(payload).encode("utf-8"), media_type="application/json")

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        installed = await client.post(
            "/api/v1/apps/install",
            json={
                "app_id": "demo-app",
                "workspace_id": "workspace-1",
                "files": [{"path": "app.runtime.yaml", "content_base64": "ZGVtbw=="}],
            },
        )
        listed = await client.get("/api/v1/apps", params={"workspace_id": "workspace-1"})
        build_status = await client.get("/api/v1/apps/demo-app/build-status", params={"workspace_id": "workspace-1"})
        setup = await client.post(
            "/api/v1/apps/demo-app/setup",
            json={"workspace_id": "workspace-1"},
        )

    assert installed.status_code == 200
    assert listed.status_code == 200
    assert build_status.status_code == 200
    assert setup.status_code == 200
    assert captured == [
        {
            "method": "POST",
            "path": "/api/v1/apps/install",
            "params": None,
            "json_body": {
                "app_id": "demo-app",
                "workspace_id": "workspace-1",
                "files": [{"path": "app.runtime.yaml", "content_base64": "ZGVtbw=="}],
            },
        },
        {
            "method": "GET",
            "path": "/api/v1/apps",
            "params": {"workspace_id": "workspace-1"},
            "json_body": None,
        },
        {
            "method": "GET",
            "path": "/api/v1/apps/demo-app/build-status",
            "params": {"workspace_id": "workspace-1"},
            "json_body": None,
        },
        {
            "method": "POST",
            "path": "/api/v1/apps/demo-app/setup",
            "params": None,
            "json_body": {"workspace_id": "workspace-1"},
        },
    ]


@pytest.mark.asyncio
async def test_queue_endpoint_proxies_to_ts_api_when_enabled_and_does_not_wake_python_worker_by_default(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    class _WakeEvent:
        def __init__(self) -> None:
            self.calls = 0

        def set(self) -> None:
            self.calls += 1

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []
    wake_event = _WakeEvent()

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        captured.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
        })
        return Response(
            content=json.dumps({"input_id": "input-1", "session_id": "session-main", "status": "QUEUED"}).encode("utf-8"),
            media_type="application/json",
        )

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setattr(api_module, "_local_worker_state", lambda: SimpleNamespace(wake_event=wake_event))
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/agent-sessions/queue",
            json={"workspace_id": "workspace-1", "text": "hello world"},
        )

    assert response.status_code == 200
    assert response.json()["input_id"] == "input-1"
    assert wake_event.calls == 0
    assert captured == [{
        "method": "POST",
        "path": "/api/v1/agent-sessions/queue",
        "params": None,
        "json_body": {
            "workspace_id": "workspace-1",
            "text": "hello world",
            "holaboss_user_id": None,
            "image_urls": None,
            "session_id": None,
            "idempotency_key": None,
            "priority": 0,
            "model": None,
        },
    }]


@pytest.mark.asyncio
async def test_queue_endpoint_proxies_to_ts_api_and_wakes_python_worker_when_ts_queue_worker_opted_out(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    class _WakeEvent:
        def __init__(self) -> None:
            self.calls = 0

        def set(self) -> None:
            self.calls += 1

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    wake_event = _WakeEvent()

    async def _fake_proxy(method: str, path: str, *, params=None, json_body=None):
        del method, path, params, json_body
        return Response(
            content=json.dumps({"input_id": "input-1", "session_id": "session-main", "status": "QUEUED"}).encode("utf-8"),
            media_type="application/json",
        )

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_json", _fake_proxy)
    monkeypatch.setattr(api_module, "_local_worker_state", lambda: SimpleNamespace(wake_event=wake_event))
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER", "0")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/agent-sessions/queue",
            json={"workspace_id": "workspace-1", "text": "hello world"},
        )

    assert response.status_code == 200
    assert wake_event.calls == 1


@pytest.mark.asyncio
async def test_unreviewed_task_proposal_stream_proxies_to_ts_api_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    captured: list[dict[str, object]] = []

    async def _fake_stream(path: str, *, params=None):
        captured.append({"path": path, "params": params})

        async def _iter():
            yield b": connected\n\n"
            yield b"event: insert\ndata: {\"proposal_id\":\"proposal-1\"}\n\n"

        return StreamingResponse(_iter(), media_type="text/event-stream")

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr(api_module, "_proxy_ts_api_stream", _fake_stream)
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")

    transport = ASGITransport(app=app)
    async with (
        AsyncClient(transport=transport, base_url="http://test") as client,
        client.stream(
            "GET",
            "/api/v1/task-proposals/unreviewed/stream",
            params={"workspace_id": "workspace-1"},
        ) as response,
    ):
        assert response.status_code == 200
        text = (await response.aread()).decode("utf-8", errors="replace")

    assert "event: insert" in text
    assert captured == [{
        "path": "/api/v1/task-proposals/unreviewed/stream",
        "params": {"workspace_id": "workspace-1"},
    }]


@pytest.mark.asyncio
async def test_managed_ts_api_server_starts_on_demand(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    entry_path = tmp_path / "index.mjs"
    entry_path.write_text("console.log('stub')\n", encoding="utf-8")

    class _FakeProcess:
        def __init__(self) -> None:
            self.returncode: int | None = None

        async def wait(self) -> int:
            self.returncode = 0
            return 0

        def terminate(self) -> None:
            self.returncode = 0

        def kill(self) -> None:
            self.returncode = 0

    spawned: list[dict[str, object]] = []
    fake_process = _FakeProcess()

    async def _fake_create_subprocess_exec(*args, **kwargs):
        spawned.append({"args": args, "kwargs": kwargs})
        return fake_process

    async def _fake_healthz_ok() -> bool:
        return True

    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")
    monkeypatch.setenv("HOLABOSS_RUNTIME_TS_API_PORT", "3061")
    monkeypatch.delenv("HOLABOSS_RUNTIME_TS_API_URL", raising=False)
    monkeypatch.setattr(api_module._ts_api_proxy, "ts_api_server_entry_path", lambda: entry_path)
    monkeypatch.setattr(api_module._ts_api_proxy, "ts_api_healthz_ok", _fake_healthz_ok)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_create_subprocess_exec)
    monkeypatch.setattr(api_module.app.state, "ts_api_server_state", None, raising=False)

    await api_module._ensure_managed_ts_api_server_ready()

    assert len(spawned) == 1
    assert spawned[0]["args"][:2] == ("node", str(entry_path))
    assert spawned[0]["kwargs"]["env"]["SANDBOX_RUNTIME_API_PORT"] == "3061"
    assert api_module.app.state.ts_api_server_state.process is fake_process

    await api_module._shutdown_managed_ts_api_server()


def test_ts_api_server_enabled_defaults_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", raising=False)

    assert api_module._ts_api_server_enabled() is True


def test_ts_queue_worker_enabled_defaults_with_ts_api_server(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")
    monkeypatch.delenv("HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER", raising=False)

    assert api_module._ts_queue_worker_enabled() is True


def test_ts_queue_worker_enabled_respects_explicit_opt_out(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER", "off")

    assert api_module._ts_queue_worker_enabled() is False


def test_ts_cron_worker_enabled_defaults_with_ts_api_server(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")
    monkeypatch.delenv("HOLABOSS_RUNTIME_USE_TS_CRON_WORKER", raising=False)

    assert api_module._ts_cron_worker_enabled() is True


def test_ts_cron_worker_enabled_respects_explicit_opt_out(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_CRON_WORKER", "off")

    assert api_module._ts_cron_worker_enabled() is False


def test_ts_bridge_worker_enabled_defaults_with_ts_api_server(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")
    monkeypatch.setenv("PROACTIVE_ENABLE_REMOTE_BRIDGE", "1")
    monkeypatch.delenv("HOLABOSS_RUNTIME_USE_TS_BRIDGE_WORKER", raising=False)

    assert api_module._ts_bridge_worker_enabled() is True


def test_ts_bridge_worker_enabled_respects_explicit_opt_out(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_API_SERVER", "1")
    monkeypatch.setenv("PROACTIVE_ENABLE_REMOTE_BRIDGE", "1")
    monkeypatch.setenv("HOLABOSS_RUNTIME_USE_TS_BRIDGE_WORKER", "off")

    assert api_module._ts_bridge_worker_enabled() is False
