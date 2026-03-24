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
from sandbox_agent_runtime import api as api_module
from sandbox_agent_runtime.api import app
from sandbox_agent_runtime.runtime_local_state import (
    append_output_event,
    claim_inputs,
    create_workspace,
    enqueue_input,
    get_input,
    insert_session_message,
    list_runtime_states,
    upsert_binding,
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

    monkeypatch.setattr("sandbox_agent_runtime.api.asyncio.create_subprocess_exec", _fake_create_subprocess_exec)

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
        "sandbox_agent_runtime.api.memory_search",
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

    monkeypatch.setattr("sandbox_agent_runtime.api.memory_status", _boom)

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

    monkeypatch.setattr("sandbox_agent_runtime.api.memory_get", _missing)

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

    monkeypatch.setattr("sandbox_agent_runtime.api._execute_runner_request", _fake_execute_runner_request)
    monkeypatch.setattr(
        "sandbox_agent_runtime.api.resolve_product_runtime_config",
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
async def test_local_outputs_folders_and_artifacts_round_trip(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    workspace = create_workspace(
        name="Workspace Outputs",
        harness="opencode",
        status="active",
        main_session_id="session-main",
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        folder_resp = await client.post(
            "/api/v1/output-folders",
            json={"workspace_id": workspace.id, "name": "Drafts"},
        )
        assert folder_resp.status_code == 200
        folder = folder_resp.json()["folder"]

        output_resp = await client.post(
            "/api/v1/outputs",
            json={
                "workspace_id": workspace.id,
                "output_type": "document",
                "title": "Spec Draft",
                "folder_id": folder["id"],
                "session_id": "session-main",
            },
        )
        assert output_resp.status_code == 200
        output = output_resp.json()["output"]
        assert output["folder_id"] == folder["id"]

        artifact_resp = await client.post(
            "/api/v1/agent-sessions/session-main/artifacts",
            json={
                "workspace_id": workspace.id,
                "artifact_type": "document",
                "external_id": "doc-1",
                "title": "Generated Doc",
                "platform": "notion",
            },
        )
        assert artifact_resp.status_code == 200

        outputs_resp = await client.get("/api/v1/outputs", params={"workspace_id": workspace.id})
        counts_resp = await client.get("/api/v1/outputs/counts", params={"workspace_id": workspace.id})
        artifacts_resp = await client.get(
            "/api/v1/agent-sessions/session-main/artifacts",
            params={"workspace_id": workspace.id},
        )
        with_artifacts_resp = await client.get(
            f"/api/v1/agent-sessions/by-workspace/{workspace.id}/with-artifacts",
        )

    assert outputs_resp.status_code == 200
    assert counts_resp.status_code == 200
    assert artifacts_resp.status_code == 200
    assert with_artifacts_resp.status_code == 200
    assert len(outputs_resp.json()["items"]) == 2
    assert counts_resp.json()["total"] == 2
    assert artifacts_resp.json()["count"] == 1
    assert with_artifacts_resp.json()["items"][0]["artifacts"][0]["external_id"] == "doc-1"


@pytest.mark.asyncio
async def test_local_cronjobs_round_trip(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    async def _fake_cron_scheduler_loop() -> None:
        await asyncio.sleep(0)

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr("sandbox_agent_runtime.api._cron_scheduler_loop", _fake_cron_scheduler_loop)
    workspace = create_workspace(
        name="Workspace Cronjobs",
        harness="opencode",
        status="active",
        main_session_id="session-main",
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/api/v1/cronjobs",
            json={
                "workspace_id": workspace.id,
                "initiated_by": "workspace_agent",
                "cron": "0 9 * * *",
                "description": "Daily check",
                "delivery": {"mode": "announce", "channel": "session_run", "to": None},
            },
        )
        assert created.status_code == 200
        job = created.json()

        listed = await client.get("/api/v1/cronjobs", params={"workspace_id": workspace.id})
        fetched = await client.get(f"/api/v1/cronjobs/{job['id']}")
        updated = await client.patch(
            f"/api/v1/cronjobs/{job['id']}",
            json={"description": "Updated check"},
        )
        deleted = await client.delete(f"/api/v1/cronjobs/{job['id']}")

    assert listed.status_code == 200
    assert listed.json()["count"] == 1
    assert fetched.status_code == 200
    assert updated.status_code == 200
    assert updated.json()["description"] == "Updated check"
    assert deleted.status_code == 200
    assert deleted.json()["success"] is True


@pytest.mark.asyncio
async def test_local_task_proposals_round_trip(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    workspace = create_workspace(
        name="Workspace Task Proposals",
        harness="opencode",
        status="active",
        main_session_id="session-main",
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/api/v1/task-proposals",
            json={
                "proposal_id": "proposal-1",
                "workspace_id": workspace.id,
                "task_name": "Follow up",
                "task_prompt": "Write a follow-up message",
                "task_generation_rationale": "User has not replied",
                "source_event_ids": ["evt-1"],
                "created_at": datetime.now(UTC).isoformat(),
            },
        )
        assert created.status_code == 200

        listed = await client.get("/api/v1/task-proposals", params={"workspace_id": workspace.id})
        unreviewed = await client.get("/api/v1/task-proposals/unreviewed", params={"workspace_id": workspace.id})
        fetched = await client.get("/api/v1/task-proposals/proposal-1")
        updated = await client.patch("/api/v1/task-proposals/proposal-1", json={"state": "accepted"})

    assert listed.status_code == 200
    assert listed.json()["count"] == 1
    assert unreviewed.status_code == 200
    assert unreviewed.json()["count"] == 1
    assert fetched.status_code == 200
    assert fetched.json()["proposal"]["proposal_id"] == "proposal-1"
    assert updated.status_code == 200
    assert updated.json()["proposal"]["state"] == "accepted"


@pytest.mark.asyncio
async def test_local_workspace_crud_endpoints_round_trip(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/api/v1/workspaces",
            json={
                "name": "Workspace 1",
                "harness": "opencode",
                "status": "provisioning",
                "main_session_id": "session-main",
            },
        )
        assert created.status_code == 200
        workspace = created.json()["workspace"]

        listed = await client.get("/api/v1/workspaces")
        fetched = await client.get(f"/api/v1/workspaces/{workspace['id']}")
        updated = await client.patch(
            f"/api/v1/workspaces/{workspace['id']}",
            json={"status": "active", "onboarding_status": "pending"},
        )
        deleted = await client.delete(f"/api/v1/workspaces/{workspace['id']}")

    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert fetched.status_code == 200
    assert fetched.json()["workspace"]["id"] == workspace["id"]
    assert updated.status_code == 200
    assert updated.json()["workspace"]["status"] == "active"
    assert updated.json()["workspace"]["onboarding_status"] == "pending"
    assert deleted.status_code == 200
    assert deleted.json()["workspace"]["status"] == "deleted"


@pytest.mark.asyncio
async def test_local_workspace_exec_endpoint_runs_in_workspace_dir(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
    tmp_path: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)
    monkeypatch.setattr("sandbox_agent_runtime.api.WORKSPACE_ROOT", str(tmp_path / "workspace"))
    monkeypatch.setattr("sandbox_agent_runtime.runtime_local_state.WORKSPACE_ROOT", str(tmp_path / "workspace"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/api/v1/workspaces",
            json={
                "name": "Workspace Exec",
                "harness": "opencode",
                "status": "active",
            },
        )
        workspace = created.json()["workspace"]
        response = await client.post(
            f"/api/v1/sandbox/users/test-user/workspaces/{workspace['id']}/exec",
            json={"command": "pwd", "timeout_s": 30},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["returncode"] == 0
    assert payload["stderr"] == ""
    assert payload["stdout"].strip() == str((tmp_path / "workspace") / workspace["id"])


@pytest.mark.asyncio
async def test_local_workspace_patch_ignores_null_for_non_nullable_fields(
    monkeypatch: pytest.MonkeyPatch,
    runtime_db_env: Path,
) -> None:
    del runtime_db_env

    async def _fake_worker_loop() -> None:
        await asyncio.sleep(0)

    monkeypatch.setattr("sandbox_agent_runtime.api._local_worker_loop", _fake_worker_loop)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/api/v1/workspaces",
            json={
                "name": "Workspace 2",
                "harness": "opencode",
                "status": "active",
                "onboarding_status": "pending",
                "error_message": "old error",
            },
        )
        workspace = created.json()["workspace"]

        updated = await client.patch(
            f"/api/v1/workspaces/{workspace['id']}",
            json={"onboarding_status": None, "error_message": None},
        )

    assert updated.status_code == 200
    assert updated.json()["workspace"]["onboarding_status"] == "pending"
    assert updated.json()["workspace"]["error_message"] is None


@pytest.mark.asyncio
async def test_runtime_states_and_history_endpoints_read_local_sqlite(
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
    upsert_binding(
        workspace_id=workspace.id,
        session_id="session-main",
        harness="opencode",
        harness_session_id="harness-1",
    )
    insert_session_message(
        workspace_id=workspace.id,
        session_id="session-main",
        role="user",
        text="hello",
        message_id="m-1",
    )
    insert_session_message(
        workspace_id=workspace.id,
        session_id="session-main",
        role="assistant",
        text="hi",
        message_id="m-2",
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        states = await client.get(f"/api/v1/agent-sessions/by-workspace/{workspace.id}/runtime-states")
        history = await client.get(
            "/api/v1/agent-sessions/session-main/history",
            params={"workspace_id": workspace.id},
        )

    assert states.status_code == 200
    assert states.json()["items"] == []
    assert history.status_code == 200
    history_payload = history.json()
    assert history_payload["source"] == "sandbox_local_storage"
    assert history_payload["harness"] == "opencode"
    assert [item["role"] for item in history_payload["messages"]] == ["user", "assistant"]


@pytest.mark.asyncio
async def test_session_state_endpoint_reads_local_runtime_and_queue(
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
        queued = await client.post(
            "/api/v1/agent-sessions/queue",
            json={
                "workspace_id": workspace.id,
                "text": "hello world",
                "holaboss_user_id": "user-1",
            },
        )
        assert queued.status_code == 200
        state = await client.get(
            "/api/v1/agent-sessions/session-main/state",
            params={"workspace_id": workspace.id},
        )

    assert state.status_code == 200
    assert state.json()["effective_state"] == "QUEUED"
    assert state.json()["runtime_status"] == "QUEUED"


@pytest.mark.asyncio
async def test_output_stream_endpoint_tails_local_events(
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
    append_output_event(
        workspace_id=workspace.id,
        session_id="session-main",
        input_id="input-1",
        sequence=1,
        event_type="run_started",
        payload={"instruction_preview": "hello"},
    )
    append_output_event(
        workspace_id=workspace.id,
        session_id="session-main",
        input_id="input-1",
        sequence=2,
        event_type="run_completed",
        payload={"status": "success"},
    )

    transport = ASGITransport(app=app)
    async with (
        AsyncClient(transport=transport, base_url="http://test") as client,
        client.stream(
            "GET",
            "/api/v1/agent-sessions/session-main/outputs/stream",
            params={"input_id": "input-1"},
        ) as response,
    ):
        assert response.status_code == 200
        body = await response.aread()
        text = body.decode("utf-8", errors="replace")

    assert "event: run_started" in text
    assert "event: run_completed" in text


@pytest.mark.asyncio
async def test_output_events_endpoint_returns_incremental_local_events(
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
    append_output_event(
        workspace_id=workspace.id,
        session_id="session-main",
        input_id="input-1",
        sequence=1,
        event_type="run_started",
        payload={"instruction_preview": "hello"},
    )
    append_output_event(
        workspace_id=workspace.id,
        session_id="session-main",
        input_id="input-1",
        sequence=2,
        event_type="output_delta",
        payload={"delta": "hi"},
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/v1/agent-sessions/session-main/outputs/events",
            params={"input_id": "input-1", "after_event_id": 1},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["items"][0]["event_type"] == "output_delta"
    assert payload["last_event_id"] == payload["items"][0]["id"]


@pytest.mark.asyncio
async def test_output_events_endpoint_include_history_false_starts_at_tail(
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
    append_output_event(
        workspace_id=workspace.id,
        session_id="session-main",
        input_id="input-1",
        sequence=1,
        event_type="run_started",
        payload={"instruction_preview": "hello"},
    )
    append_output_event(
        workspace_id=workspace.id,
        session_id="session-main",
        input_id="input-1",
        sequence=2,
        event_type="run_completed",
        payload={"status": "success"},
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/v1/agent-sessions/session-main/outputs/events",
            params={"input_id": "input-1", "include_history": "false"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 0
    assert payload["last_event_id"] >= 2
