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
from sandbox_agent_runtime import runner_api as runner_api_module
from sandbox_agent_runtime import memory_api as memory_api_module
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
async def test_run_endpoint_returns_runner_events(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_execute_runner_request(request, on_event=None):
        del request, on_event
        events = [
            api_module.RunnerOutputEvent(
                session_id="session-1",
                input_id="input-1",
                sequence=1,
                event_type="run_started",
                payload={"instruction_preview": "hello"},
            ),
            api_module.RunnerOutputEvent(
                session_id="session-1",
                input_id="input-1",
                sequence=2,
                event_type="run_completed",
                payload={"status": "success"},
            ),
        ]
        return api_module._RunnerExecutionResult(
            events=events,
            skipped_lines=[],
            stderr="",
            return_code=0,
            saw_terminal=True,
        )

    monkeypatch.setattr("sandbox_agent_runtime.api._execute_runner_request", _fake_execute_runner_request)

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

    assert response.status_code == 200
    payload = response.json()
    assert [event["event_type"] for event in payload["events"]] == ["run_started", "run_completed"]


@pytest.mark.asyncio
async def test_stream_endpoint_emits_sse_events(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakePipe:
        def __init__(self, lines: list[bytes]) -> None:
            self._lines = list(lines)

        async def readline(self) -> bytes:
            if self._lines:
                return self._lines.pop(0)
            return b""

        async def read(self) -> bytes:
            return b""

    class _FakeProcess:
        def __init__(self) -> None:
            self.returncode: int | None = None
            self.stdout = _FakePipe([
                json.dumps({
                    "session_id": "session-1",
                    "input_id": "input-1",
                    "sequence": 1,
                    "event_type": "run_started",
                    "payload": {"instruction_preview": "hello"},
                }).encode("utf-8")
                + b"\n",
                json.dumps({
                    "session_id": "session-1",
                    "input_id": "input-1",
                    "sequence": 2,
                    "event_type": "run_completed",
                    "payload": {"status": "success"},
                }).encode("utf-8")
                + b"\n",
            ])
            self.stderr = _FakePipe([])

        async def wait(self) -> int:
            self.returncode = 0
            return 0

        def kill(self) -> None:
            self.returncode = -9

    async def _fake_create_subprocess_exec(*args, **kwargs) -> _FakeProcess:
        del args, kwargs
        return _FakeProcess()

    monkeypatch.setattr(runner_api_module.asyncio, "create_subprocess_exec", _fake_create_subprocess_exec)

    transport = ASGITransport(app=app)
    async with (
        AsyncClient(transport=transport, base_url="http://test") as client,
        client.stream(
            "POST",
            "/api/v1/agent-runs/stream",
            json={
                "workspace_id": "workspace-1",
                "session_id": "session-1",
                "input_id": "input-1",
                "instruction": "hello",
                "context": {},
            },
        ) as response,
    ):
        assert response.status_code == 200
        body = await response.aread()
        text = body.decode("utf-8", errors="replace")

    assert "event: run_started" in text
    assert "event: run_completed" in text


@pytest.mark.asyncio
async def test_memory_search_endpoint_uses_shared_operations(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        memory_api_module,
        "memory_search",
        lambda *, workspace_id, query, max_results, min_score: {
            "workspace_id": workspace_id,
            "query": query,
            "max_results": max_results,
            "min_score": min_score,
        },
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/memory/search",
            json={
                "workspace_id": "workspace-1",
                "query": "durable preferences",
                "max_results": 5,
                "min_score": 0.1,
            },
        )

    assert response.status_code == 200
    assert response.json()["workspace_id"] == "workspace-1"
    assert response.json()["query"] == "durable preferences"


@pytest.mark.asyncio
async def test_memory_status_endpoint_returns_400_on_validation_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(*, workspace_id: str) -> dict[str, object]:
        del workspace_id
        raise ValueError("bad workspace")

    monkeypatch.setattr(memory_api_module, "memory_status", _boom)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/memory/status", json={"workspace_id": "workspace-1"})

    assert response.status_code == 400
    assert "bad workspace" in response.json()["detail"]


@pytest.mark.asyncio
async def test_memory_get_endpoint_returns_empty_text_when_file_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    def _missing(*, workspace_id: str, path: str, from_line: int | None, lines: int | None) -> dict[str, object]:
        del workspace_id, path, from_line, lines
        raise FileNotFoundError("workspace/workspace-1/preferences.md")

    monkeypatch.setattr(memory_api_module, "memory_get", _missing)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/memory/get",
            json={"workspace_id": "workspace-1", "path": "workspace/workspace-1/preferences.md"},
        )

    assert response.status_code == 200
    assert response.json() == {"path": "workspace/workspace-1/preferences.md", "text": ""}


@pytest.mark.asyncio
async def test_runtime_config_endpoints_round_trip(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    sandbox_root = tmp_path / "sandbox-root"
    config_path = sandbox_root / "state" / "runtime-config.json"
    monkeypatch.setenv("HB_SANDBOX_ROOT", str(sandbox_root))
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))
    monkeypatch.delenv("HOLABOSS_SANDBOX_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("HOLABOSS_USER_ID", raising=False)
    monkeypatch.delenv("HOLABOSS_MODEL_PROXY_BASE_URL", raising=False)
    monkeypatch.delenv("HOLABOSS_DEFAULT_MODEL", raising=False)
    monkeypatch.setattr("sandbox_agent_runtime.api._ensure_selected_harness_ready", lambda: asyncio.sleep(0, "started"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        initial = await client.get("/api/v1/runtime/config")
        assert initial.status_code == 200
        assert initial.json()["auth_token_present"] is False
        assert initial.json()["loaded_from_file"] is False

        updated = await client.put(
            "/api/v1/runtime/config",
            json={
                "auth_token": "token-1",
                "user_id": "user-1",
                "sandbox_id": "sandbox-1",
                "model_proxy_base_url": "http://54.214.105.154:3060/api/v1/model-proxy",
                "default_model": "openai/gpt-5.1",
            },
        )
        assert updated.status_code == 200
        payload = updated.json()
        assert payload["auth_token_present"] is True
        assert payload["user_id"] == "user-1"
        assert payload["sandbox_id"] == "sandbox-1"
        assert payload["model_proxy_base_url"] == "http://54.214.105.154:3060/api/v1/model-proxy"
        assert payload["default_model"] == "openai/gpt-5.1"
        assert payload["runtime_mode"] == "oss"
        assert payload["default_provider"] == "holaboss_model_proxy"
        assert payload["holaboss_enabled"] is True
        assert payload["desktop_browser_enabled"] is False
        assert payload["desktop_browser_url"] is None
        assert payload["config_path"] == str(config_path)
        assert payload["loaded_from_file"] is True

        current = await client.get("/api/v1/runtime/config")
        assert current.status_code == 200
        assert current.json()["auth_token_present"] is True
        opencode_config = json.loads((sandbox_root / "workspace" / "opencode.json").read_text(encoding="utf-8"))
        assert opencode_config["provider"]["openai"]["options"]["apiKey"] == "token-1"
        assert opencode_config["provider"]["openai"]["options"]["headers"]["X-Holaboss-Sandbox-Id"] == "sandbox-1"


@pytest.mark.asyncio
async def test_runtime_config_endpoints_support_oss_direct_provider(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    sandbox_root = tmp_path / "sandbox-root"
    config_path = sandbox_root / "state" / "runtime-config.json"
    monkeypatch.setenv("HB_SANDBOX_ROOT", str(sandbox_root))
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))
    monkeypatch.delenv("HOLABOSS_SANDBOX_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("HOLABOSS_USER_ID", raising=False)
    monkeypatch.delenv("HOLABOSS_MODEL_PROXY_BASE_URL", raising=False)
    monkeypatch.delenv("HOLABOSS_DEFAULT_MODEL", raising=False)
    monkeypatch.setattr("sandbox_agent_runtime.api._ensure_selected_harness_ready", lambda: asyncio.sleep(0, "started"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        updated = await client.put(
            "/api/v1/runtime/config",
            json={
                "sandbox_id": "sandbox-oss-1",
                "default_model": "gpt-5.1",
                "runtime_mode": "oss",
                "default_provider": "openai",
                "holaboss_enabled": False,
            },
        )
        assert updated.status_code == 200
        payload = updated.json()
        assert payload["auth_token_present"] is False
        assert payload["user_id"] is None
        assert payload["sandbox_id"] == "sandbox-oss-1"
        assert payload["model_proxy_base_url"] is None
        assert payload["default_model"] == "gpt-5.1"
        assert payload["runtime_mode"] == "oss"
        assert payload["default_provider"] == "openai"
        assert payload["holaboss_enabled"] is False
        assert payload["desktop_browser_enabled"] is False
        assert payload["desktop_browser_url"] is None
        assert payload["config_path"] == str(config_path)
        assert payload["loaded_from_file"] is True

    assert not (sandbox_root / "workspace" / "opencode.json").exists()


@pytest.mark.asyncio
async def test_runtime_status_reports_pending_config_then_ready(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    sandbox_root = tmp_path / "sandbox-root"
    config_path = sandbox_root / "state" / "runtime-config.json"
    monkeypatch.setenv("HB_SANDBOX_ROOT", str(sandbox_root))
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))
    monkeypatch.setenv("HOLABOSS_MODEL_PROXY_BASE_URL", "https://runtime.example/api/v1/model-proxy")

    readiness = {"ready": False}

    async def _fake_workspace_mcp_is_ready(*, url: str) -> bool:
        assert url == "http://127.0.0.1:4096/mcp"
        return readiness["ready"]

    async def _fake_ensure_selected_harness_ready() -> str:
        readiness["ready"] = True
        return "started"

    monkeypatch.setattr("sandbox_agent_runtime.api._workspace_mcp_is_ready", _fake_workspace_mcp_is_ready)
    monkeypatch.setattr("sandbox_agent_runtime.api._ensure_selected_harness_ready", _fake_ensure_selected_harness_ready)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pending = await client.get("/api/v1/runtime/status")
        assert pending.status_code == 200
        assert pending.json()["harness_state"] == "pending_config"
        assert pending.json()["harness_ready"] is False
        assert pending.json()["browser_state"] == "unavailable"
        assert pending.json()["browser_available"] is False

        updated = await client.put(
            "/api/v1/runtime/config",
            json={
                "auth_token": "token-1",
                "user_id": "user-1",
                "sandbox_id": "sandbox-1",
                "model_proxy_base_url": "https://runtime.example/api/v1/model-proxy",
                "default_model": "openai/gpt-5.1",
                "desktop_browser_enabled": True,
            },
        )
        assert updated.status_code == 200

        ready = await client.get("/api/v1/runtime/status")
        assert ready.status_code == 200
        assert ready.json()["config_loaded"] is True
        assert ready.json()["opencode_config_present"] is True
        assert ready.json()["harness_ready"] is True
        assert ready.json()["harness_state"] == "ready"
        assert ready.json()["browser_state"] == "enabled_unconfigured"
        assert ready.json()["browser_available"] is False


@pytest.mark.asyncio
async def test_runtime_status_reports_available_desktop_browser_when_url_is_configured(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    sandbox_root = tmp_path / "sandbox-root"
    config_path = sandbox_root / "state" / "runtime-config.json"
    monkeypatch.setenv("HB_SANDBOX_ROOT", str(sandbox_root))
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))

    async def _fake_workspace_mcp_is_ready(*, url: str) -> bool:
        assert url == "http://127.0.0.1:4096/mcp"
        return False

    monkeypatch.setattr("sandbox_agent_runtime.api._workspace_mcp_is_ready", _fake_workspace_mcp_is_ready)
    monkeypatch.setattr("sandbox_agent_runtime.api._ensure_selected_harness_ready", lambda: asyncio.sleep(0, "started"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        updated = await client.put(
            "/api/v1/runtime/config",
            json={
                "desktop_browser_enabled": True,
                "desktop_browser_url": "http://127.0.0.1:8787/api/v1/browser",
            },
        )
        assert updated.status_code == 200
        assert updated.json()["desktop_browser_enabled"] is True
        assert updated.json()["desktop_browser_url"] == "http://127.0.0.1:8787/api/v1/browser"

        status = await client.get("/api/v1/runtime/status")
        assert status.status_code == 200
        assert status.json()["browser_available"] is True
        assert status.json()["browser_state"] == "available"
        assert status.json()["browser_url"] == "http://127.0.0.1:8787/api/v1/browser"


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
async def test_list_app_ports_returns_deterministic_workspace_ports(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    workspace_root = tmp_path / "workspace-root"
    _write_workspace_apps(workspace_root, "workspace-1", ["app-a", "app-b"])
    monkeypatch.setattr(api_module, "WORKSPACE_ROOT", str(workspace_root))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/apps/ports", params={"workspace_id": "workspace-1"})

    assert response.status_code == 200
    assert response.json() == {
        "app-a": {"http": 18080, "mcp": 13100},
        "app-b": {"http": 18081, "mcp": 13101},
    }


@pytest.mark.asyncio
async def test_start_app_endpoint_assigns_deterministic_ports_from_workspace_order(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    workspace_root = tmp_path / "workspace-root"
    _write_workspace_apps(workspace_root, "workspace-1", ["app-a", "app-b"])
    monkeypatch.setattr(api_module, "WORKSPACE_ROOT", str(workspace_root))
    api_module._lifecycle_managers.clear()

    async def _healthy(*args, **kwargs) -> bool:
        del args, kwargs
        return True

    monkeypatch.setattr(
        "sandbox_agent_runtime.application_lifecycle.ApplicationLifecycleManager._is_app_healthy",
        _healthy,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/apps/app-b/start", json={"workspace_id": "workspace-1"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["app_id"] == "app-b"
    assert payload["ports"] == {"http": 18081, "mcp": 13101}
    assert api_module._lifecycle_managers["workspace-1"]._port_allocations["app-b"] == (18081, 13101)


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
