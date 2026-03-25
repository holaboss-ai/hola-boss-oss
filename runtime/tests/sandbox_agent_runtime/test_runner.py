# ruff: noqa: S101

from __future__ import annotations

import asyncio
import base64
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from pydantic import BaseModel
from sandbox_agent_runtime import runner as runner_module
from sandbox_agent_runtime.runner import (
    RunnerRequest,
    _build_opencode_runtime_config,
    _decode_request,
    _execute_request,
    _map_opencode_event,
    _model_proxy_base_root_url,
    _opencode_provider_config_payload,
    _resolve_model_client_config,
    _restart_opencode_sidecar,
    _selected_harness,
    _should_emit_opencode_event,
    _workspace_mcp_failure_detail,
    _workspace_mcp_log_path,
)
from sandbox_agent_runtime.runtime_config.models import ResolvedMcpServerConfig, ResolvedMcpToolRef
from sandbox_agent_runtime.runtime_config_adapter import (
    CompiledWorkspaceRuntimePlan,
    WorkspaceGeneralMemberConfig,
    WorkspaceGeneralSingleConfig,
)

_RUNTIME_EXEC_CONTEXT_KEY = "_sandbox_runtime_exec_v1"
_DEFAULT_MODEL_HEADERS = object()


def _runtime_exec_context(
    *,
    run_id: str = "run-1",
    model_proxy_api_key: str = "hbrt.v1.run-token",
    sandbox_id: str = "sandbox-1",
    model_proxy_base_url: str = "http://sandbox-runtime:3060/api/v1/model-proxy/openai/v1",
    model_proxy_provider: str | None = "openai_compatible",
    harness: str | None = None,
    harness_session_id: str | None = None,
) -> dict[str, dict[str, str]]:
    payload = {
        "run_id": run_id,
        "model_proxy_api_key": model_proxy_api_key,
        "sandbox_id": sandbox_id,
        "model_proxy_base_url": model_proxy_base_url,
    }
    if model_proxy_provider:
        payload["model_proxy_provider"] = model_proxy_provider
    if harness:
        payload["harness"] = harness
    if harness_session_id:
        payload["harness_session_id"] = harness_session_id
    return {
        _RUNTIME_EXEC_CONTEXT_KEY: payload,
    }


class _AsyncLineStream:
    def __init__(self, lines: list[str]) -> None:
        self._lines = [f"{line.rstrip()}\n".encode("utf-8") for line in lines]
        self._index = 0

    def __aiter__(self) -> _AsyncLineStream:
        return self

    async def __anext__(self) -> bytes:
        if self._index >= len(self._lines):
            raise StopAsyncIteration
        value = self._lines[self._index]
        self._index += 1
        return value


class _AsyncReadStream:
    def __init__(self, text: str) -> None:
        self._payload = text.encode("utf-8")
        self._consumed = False

    async def read(self, size: int = -1) -> bytes:
        del size
        if self._consumed:
            return b""
        self._consumed = True
        return self._payload


class _FakeHarnessHostProcess:
    def __init__(self, *, stdout_lines: list[str], stderr_text: str = "", return_code: int = 0) -> None:
        self.stdout = _AsyncLineStream(stdout_lines)
        self.stderr = _AsyncReadStream(stderr_text)
        self._return_code = return_code

    async def wait(self) -> int:
        return self._return_code


def _opencode_runtime_config_fixture(
    *,
    workspace_tool_ids: tuple[str, ...] = ("workspace.read",),
    workspace_skill_ids: tuple[str, ...] = ("skill-1",),
) -> runner_module._OpencodeRuntimeConfig:
    return runner_module._OpencodeRuntimeConfig(
        provider_id="openai",
        model_id="gpt-5",
        mode="code",
        system_prompt="You are concise.",
        tools={"read": True},
        workspace_tool_ids=workspace_tool_ids,
        mcp_servers=(),
        output_schema_member_id=None,
        output_schema_model=None,
        output_format=None,
        workspace_config_checksum="checksum-1",
        workspace_skill_ids=workspace_skill_ids,
    )


def _model_client_config_fixture(
    *, default_headers: dict[str, str] | None | object = _DEFAULT_MODEL_HEADERS
) -> runner_module._ModelClientConfig:
    return runner_module._ModelClientConfig(
        model_proxy_provider="openai_compatible",
        api_key="token-1",
        base_url="http://sandbox-runtime:3060/api/v1/model-proxy/openai/v1",
        default_headers={"X-Test": "1"} if default_headers is _DEFAULT_MODEL_HEADERS else default_headers,
    )


@pytest.fixture(autouse=True)
def _clear_harness_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SANDBOX_AGENT_HARNESS", "opencode")
    monkeypatch.setenv("HOLABOSS_MODEL_PROXY_BASE_URL", "http://sandbox-runtime:3060/api/v1/model-proxy")
    monkeypatch.delenv("SANDBOX_AGENT_USE_TS_HARNESS_HOST", raising=False)


@pytest.fixture(autouse=True)
def _noop_workspace_mcp_lifecycle(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _start_sidecar(*, workspace_dir, compiled_plan, workspace_id, sandbox_id, physical_server_id):
        del workspace_dir, compiled_plan, workspace_id, sandbox_id, physical_server_id
        return None

    async def _stop_sidecar(sidecar):
        del sidecar
        return None

    def _effective_servers(*, compiled_plan, sidecar, server_id_map=None):
        del compiled_plan, sidecar, server_id_map
        return ()

    monkeypatch.setattr("sandbox_agent_runtime.runner._start_workspace_mcp_sidecar", _start_sidecar)
    monkeypatch.setattr("sandbox_agent_runtime.runner._stop_workspace_mcp_sidecar", _stop_sidecar)
    monkeypatch.setattr("sandbox_agent_runtime.runner._effective_mcp_server_payloads", _effective_servers)
    monkeypatch.setattr(
        "sandbox_agent_runtime.runner._mcp_tool_refs_by_server",
        lambda compiled_plan, server_id_map=None: {},
    )


@pytest.fixture(autouse=True)
def _workspace_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace_root = tmp_path / "workspace-root"
    workspace_root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("sandbox_agent_runtime.runner.WORKSPACE_ROOT", str(workspace_root))


def test_selected_harness_defaults_to_opencode_without_explicit_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SANDBOX_AGENT_HARNESS", raising=False)

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context={},
    )

    assert _selected_harness(request=request) == "opencode"


@pytest.mark.asyncio
async def test_start_opencode_apps_via_runtime_api_posts_bootstrap_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context={},
    )
    workspace_dir = Path("/tmp/workspace-1")
    app = SimpleNamespace(
        app_id="app-a",
        mcp=SimpleNamespace(transport="http-sse", port=3099, path="/mcp"),
        health_check=SimpleNamespace(path="/health", timeout_s=60, interval_s=5),
        env_contract=("HOLABOSS_USER_ID",),
        start_command="npm run start",
        base_dir="apps/app-a",
        lifecycle=SimpleNamespace(setup="", start="", stop=""),
    )
    captured: dict[str, object] = {}

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "applications": [
                    {
                        "app_id": "app-a",
                        "mcp_url": "http://localhost:13100/mcp",
                        "timeout_ms": 60000,
                    }
                ]
            }

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            del exc_type, exc, tb
            return False

        async def post(self, url: str, *, json: dict[str, object]):
            captured["url"] = url
            captured["json"] = json
            return _FakeResponse()

    monkeypatch.setenv("SANDBOX_RUNTIME_API_URL", "http://runtime.example")
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: _FakeClient())

    entries = await runner_module._start_opencode_apps_via_runtime_api(
        request=request,
        workspace_dir=workspace_dir,
        resolved_applications=(app,),
    )

    assert entries == (
        {
            "name": "app-a",
            "config": {
                "type": "remote",
                "url": "http://localhost:13100/mcp",
                "enabled": True,
                "headers": {"X-Workspace-Id": "workspace-1"},
                "timeout": 60000,
            },
        },
    )
    assert captured == {
        "url": "http://runtime.example/api/v1/internal/workspaces/workspace-1/opencode-apps/start",
        "json": {
            "workspace_dir": "/tmp/workspace-1",
            "holaboss_user_id": "",
            "resolved_applications": [
                {
                    "app_id": "app-a",
                    "mcp": {"transport": "http-sse", "port": 3099, "path": "/mcp"},
                    "health_check": {"path": "/health", "timeout_s": 60, "interval_s": 5},
                    "env_contract": ["HOLABOSS_USER_ID"],
                    "start_command": "npm run start",
                    "base_dir": "apps/app-a",
                    "lifecycle": {"setup": "", "start": "", "stop": ""},
                }
            ],
        },
    }


@pytest.mark.asyncio
async def test_start_opencode_resolved_applications_falls_back_on_runtime_api_transport_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context={},
    )
    workspace_dir = Path("/tmp/workspace-1")
    app = SimpleNamespace(
        app_id="app-a",
        mcp=SimpleNamespace(transport="http-sse", port=3099, path="/mcp"),
        health_check=SimpleNamespace(path="/health", timeout_s=60, interval_s=5),
        lifecycle=SimpleNamespace(setup="", start="", stop=""),
    )
    started: dict[str, object] = {}

    async def _fail_runtime_api(**kwargs):
        del kwargs
        raise httpx.ConnectError("ts bootstrap unavailable")

    async def _local_ts_fallback(**kwargs):
        started.update(kwargs)
        return (
            {
                "name": "app-a",
                "config": {
                    "type": "remote",
                    "url": "http://localhost:13100/mcp",
                    "enabled": True,
                    "headers": {"X-Workspace-Id": "workspace-1"},
                    "timeout": 60000,
                },
            },
        )

    monkeypatch.setenv("SANDBOX_AGENT_ENABLE_PYTHON_APP_LIFECYCLE_FALLBACK", "1")
    monkeypatch.setattr(runner_module, "_start_opencode_apps_via_runtime_api", _fail_runtime_api)
    monkeypatch.setattr(runner_module, "_start_opencode_apps_via_local_ts_lifecycle", _local_ts_fallback)

    entries = await runner_module._start_opencode_resolved_applications(
        request=request,
        workspace_dir=workspace_dir,
        resolved_applications=(app,),
    )

    assert started == {
        "request": request,
        "workspace_dir": workspace_dir,
        "resolved_applications": (app,),
    }
    assert entries == (
        {
            "name": "app-a",
            "config": {
                "type": "remote",
                "url": "http://localhost:13100/mcp",
                "enabled": True,
                "headers": {"X-Workspace-Id": "workspace-1"},
                "timeout": 60000,
            },
        },
    )


@pytest.mark.asyncio
async def test_start_opencode_resolved_applications_raises_when_transport_fallback_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context={},
    )
    workspace_dir = Path("/tmp/workspace-1")
    app = SimpleNamespace(
        app_id="app-a",
        health_check=SimpleNamespace(timeout_s=60),
    )

    async def _fail_runtime_api(**kwargs):
        del kwargs
        raise httpx.ConnectError("ts bootstrap unavailable")

    async def _unexpected_local_ts_fallback(**kwargs):
        del kwargs
        raise AssertionError("local ts lifecycle fallback should stay disabled by default")

    monkeypatch.delenv("SANDBOX_AGENT_ENABLE_PYTHON_APP_LIFECYCLE_FALLBACK", raising=False)
    monkeypatch.setattr(runner_module, "_start_opencode_apps_via_runtime_api", _fail_runtime_api)
    monkeypatch.setattr(runner_module, "_start_opencode_apps_via_local_ts_lifecycle", _unexpected_local_ts_fallback)

    with pytest.raises(RuntimeError, match="SANDBOX_AGENT_ENABLE_PYTHON_APP_LIFECYCLE_FALLBACK=1"):
        await runner_module._start_opencode_resolved_applications(
            request=request,
            workspace_dir=workspace_dir,
            resolved_applications=(app,),
        )


@pytest.mark.asyncio
async def test_start_opencode_resolved_applications_raises_on_invalid_ts_bootstrap_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context={},
    )
    workspace_dir = Path("/tmp/workspace-1")
    app = SimpleNamespace(
        app_id="app-a",
        health_check=SimpleNamespace(timeout_s=60),
    )

    async def _invalid_runtime_api(**kwargs):
        del kwargs
        raise RuntimeError("invalid opencode app bootstrap response")

    async def _unexpected_local_ts_fallback(**kwargs):
        del kwargs
        raise AssertionError("local ts lifecycle fallback should not run for invalid TS bootstrap responses")

    monkeypatch.setattr(runner_module, "_start_opencode_apps_via_runtime_api", _invalid_runtime_api)
    monkeypatch.setattr(runner_module, "_start_opencode_apps_via_local_ts_lifecycle", _unexpected_local_ts_fallback)

    with pytest.raises(RuntimeError, match="invalid opencode app bootstrap response"):
        await runner_module._start_opencode_resolved_applications(
            request=request,
            workspace_dir=workspace_dir,
            resolved_applications=(app,),
        )


@pytest.mark.asyncio
async def test_start_opencode_apps_via_local_ts_lifecycle_invokes_cli_and_parses_response(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context={},
    )
    workspace_dir = tmp_path / "workspace-1"
    workspace_dir.mkdir()
    entry_path = tmp_path / "opencode-app-bootstrap.mjs"
    entry_path.write_text("// test entry\n", encoding="utf-8")
    app = SimpleNamespace(
        app_id="app-a",
        mcp=SimpleNamespace(transport="http-sse", port=3099, path="/mcp"),
        health_check=SimpleNamespace(path="/health", timeout_s=60, interval_s=5),
        env_contract=("HOLABOSS_USER_ID",),
        start_command="npm run start",
        base_dir="apps/app-a",
        lifecycle=SimpleNamespace(setup="", start="", stop=""),
    )
    captured: dict[str, object] = {}

    class _FakeProcess:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            return (
                json.dumps(
                    {
                        "applications": [
                            {
                                "app_id": "app-a",
                                "mcp_url": "http://localhost:13100/mcp",
                                "timeout_ms": 60000,
                            }
                        ]
                    }
                ).encode("utf-8"),
                b"",
            )

    async def _fake_create_subprocess_exec(*command: object, **kwargs: object) -> _FakeProcess:
        captured["command"] = command
        captured["kwargs"] = kwargs
        return _FakeProcess()

    monkeypatch.setattr(runner_module, "_ts_opencode_app_bootstrap_entry_path", lambda: entry_path)
    monkeypatch.setattr(runner_module, "_ts_harness_host_node_bin", lambda: "node")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_create_subprocess_exec)

    entries = await runner_module._start_opencode_apps_via_local_ts_lifecycle(
        request=request,
        workspace_dir=workspace_dir,
        resolved_applications=(app,),
    )

    assert entries == (
        {
            "name": "app-a",
            "config": {
                "type": "remote",
                "url": "http://localhost:13100/mcp",
                "enabled": True,
                "headers": {"X-Workspace-Id": "workspace-1"},
                "timeout": 60000,
            },
        },
    )
    assert captured["command"]
    command = captured["command"]
    assert isinstance(command, tuple)
    assert command[0] == "node"
    assert command[1] == str(entry_path)
    assert command[2] == "--request-base64"
    decoded_request = json.loads(base64.b64decode(str(command[3])).decode("utf-8"))
    assert decoded_request == {
        "workspace_id": "workspace-1",
        "workspace_dir": str(workspace_dir),
        "holaboss_user_id": "",
        "resolved_applications": [
            {
                "app_id": "app-a",
                "mcp": {"transport": "http-sse", "port": 3099, "path": "/mcp"},
                "health_check": {"path": "/health", "timeout_s": 60, "interval_s": 5},
                "env_contract": ["HOLABOSS_USER_ID"],
                "start_command": "npm run start",
                "base_dir": "apps/app-a",
                "lifecycle": {"setup": "", "start": "", "stop": ""},
            }
        ],
    }


@pytest.mark.asyncio
async def test_start_opencode_apps_via_local_ts_lifecycle_raises_on_nonzero_exit(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context={},
    )
    workspace_dir = tmp_path / "workspace-1"
    workspace_dir.mkdir()
    entry_path = tmp_path / "opencode-app-bootstrap.mjs"
    entry_path.write_text("// test entry\n", encoding="utf-8")
    app = SimpleNamespace(
        app_id="app-a",
        mcp=SimpleNamespace(transport="http-sse", port=3099, path="/mcp"),
        health_check=SimpleNamespace(path="/health", timeout_s=60, interval_s=5),
        lifecycle=SimpleNamespace(setup="", start="", stop=""),
    )

    class _FakeProcess:
        returncode = 1

        async def communicate(self) -> tuple[bytes, bytes]:
            return (b"", b"bootstrap failed")

    async def _fake_create_subprocess_exec(*command: object, **kwargs: object) -> _FakeProcess:
        del command, kwargs
        return _FakeProcess()

    monkeypatch.setattr(runner_module, "_ts_opencode_app_bootstrap_entry_path", lambda: entry_path)
    monkeypatch.setattr(runner_module, "_ts_harness_host_node_bin", lambda: "node")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_create_subprocess_exec)

    with pytest.raises(RuntimeError, match="bootstrap failed"):
        await runner_module._start_opencode_apps_via_local_ts_lifecycle(
            request=request,
            workspace_dir=workspace_dir,
            resolved_applications=(app,),
        )


@pytest.mark.asyncio
def test_model_proxy_base_root_url_accepts_product_base_url_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HOLABOSS_MODEL_PROXY_BASE_URL", raising=False)
    monkeypatch.setenv("HOLABOSS_MODEL_PROXY_BASE_URL", "https://runtime.example/api/v1/model-proxy")

    assert _model_proxy_base_root_url() == "https://runtime.example/api/v1/model-proxy"


def test_opencode_ready_timeout_seconds_defaults_to_30(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENCODE_READY_TIMEOUT_S", raising=False)

    assert runner_module._opencode_ready_timeout_seconds() == 30.0


def test_opencode_ready_timeout_seconds_uses_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENCODE_READY_TIMEOUT_S", "45")

    assert runner_module._opencode_ready_timeout_seconds() == 45.0


def test_opencode_base_url_defaults_to_server_host_and_port(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENCODE_BASE_URL", raising=False)
    monkeypatch.setenv("OPENCODE_SERVER_HOST", "127.0.0.1")
    monkeypatch.setenv("OPENCODE_SERVER_PORT", "5096")

    assert runner_module._opencode_base_url() == "http://127.0.0.1:5096"


def test_opencode_base_url_prefers_explicit_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENCODE_BASE_URL", "http://127.0.0.1:4096/")
    monkeypatch.setenv("OPENCODE_SERVER_PORT", "5096")

    assert runner_module._opencode_base_url() == "http://127.0.0.1:4096"


@pytest.mark.asyncio
async def test_restart_opencode_sidecar_reuses_matching_healthy_sidecar(monkeypatch: pytest.MonkeyPatch) -> None:
    runner_module._write_opencode_sidecar_state(
        {
            "pid": 12345,
            "url": "http://127.0.0.1:4096/mcp",
            "workspace_id": "workspace-1",
            "config_fingerprint": "fingerprint-1",
        }
    )

    async def _fake_ready(*, url: str) -> bool:
        assert url == "http://127.0.0.1:4096/mcp"
        return True

    async def _unexpected_subprocess_exec(*args, **kwargs):
        raise AssertionError(f"unexpected subprocess restart: args={args} kwargs={kwargs}")

    monkeypatch.setattr("sandbox_agent_runtime.runner._workspace_mcp_is_ready", _fake_ready)
    monkeypatch.setattr("sandbox_agent_runtime.runner.asyncio.create_subprocess_exec", _unexpected_subprocess_exec)

    await _restart_opencode_sidecar(config_fingerprint="fingerprint-1", workspace_id="workspace-1")


def test_workspace_mcp_failure_detail_includes_stderr_and_stdout_tails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_root = tmp_path / "workspace-root"
    workspace_root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("sandbox_agent_runtime.runner.WORKSPACE_ROOT", str(workspace_root))

    stderr_path = _workspace_mcp_log_path(physical_server_id="workspace__abc123", stream="stderr")
    stdout_path = _workspace_mcp_log_path(physical_server_id="workspace__abc123", stream="stdout")
    stderr_path.write_text("stderr-line-1\nstderr-line-2\n", encoding="utf-8")
    stdout_path.write_text("stdout-line-1\n", encoding="utf-8")

    detail = _workspace_mcp_failure_detail(physical_server_id="workspace__abc123")

    assert "stderr_tail=stderr-line-1\nstderr-line-2" in detail
    assert "stdout_tail=stdout-line-1" in detail


@pytest.mark.asyncio
async def test_wait_for_opencode_ready_uses_opencode_error_label(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sandbox_agent_runtime.runner._WORKSPACE_MCP_READY_POLL_S", 0.001)

    class _AlwaysFailClient:
        async def __aenter__(self) -> _AlwaysFailClient:
            return self

        async def __aexit__(self, exc_type, exc, tb) -> None:
            del exc_type, exc, tb

        async def get(self, url: str) -> None:
            raise httpx.ConnectError("connection refused", request=httpx.Request("GET", url))

    monkeypatch.setattr(
        "sandbox_agent_runtime.runner.httpx.AsyncClient",
        lambda timeout=2.0, trust_env=False: _AlwaysFailClient(),
    )

    with pytest.raises(TimeoutError, match="OpenCode sidecar readiness timed out"):
        await runner_module._wait_for_opencode_ready(
            url="http://127.0.0.1:4096/mcp",
            timeout_seconds=0.01,
        )


@pytest.mark.asyncio
async def test_execute_request_emits_run_failed_without_model_proxy_config(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.delenv("SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    async def _fake_compile_workspace_runtime_plan(*, workspace_dir, workspace_id):
        del workspace_dir, workspace_id
        return _single_plan()

    monkeypatch.setattr(
        "sandbox_agent_runtime.runner._compile_workspace_runtime_plan",
        _fake_compile_workspace_runtime_plan,
    )

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context={},
    )

    exit_code = await _execute_request(request)
    assert exit_code == 0
    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip() and line.lstrip().startswith("{")]
    assert lines
    event = json.loads(lines[-1])
    assert event["event_type"] == "run_failed"
    assert event["session_id"] == "session-1"
    assert event["input_id"] == "input-1"
    assert "_sandbox_runtime_exec_v1.model_proxy_api_key" in event["payload"]["message"]
    assert "_sandbox_runtime_exec_v1.sandbox_id" in event["payload"]["message"]


@pytest.mark.asyncio
async def test_workspace_mcp_is_ready_disables_proxy_env(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class _ReadyClient:
        async def __aenter__(self) -> _ReadyClient:
            return self

        async def __aexit__(self, exc_type, exc, tb) -> None:
            del exc_type, exc, tb

        async def get(self, url: str) -> httpx.Response:
            return httpx.Response(406, request=httpx.Request("GET", url))

    def _fake_async_client(*, timeout: float = 2.0, trust_env: bool = True) -> _ReadyClient:
        captured["timeout"] = timeout
        captured["trust_env"] = trust_env
        return _ReadyClient()

    monkeypatch.setattr("sandbox_agent_runtime.runner.httpx.AsyncClient", _fake_async_client)

    ready = await runner_module._workspace_mcp_is_ready(url="http://127.0.0.1:50444/mcp")

    assert ready is True
    assert captured["timeout"] == 2.0
    assert captured["trust_env"] is False


def test_decode_request_round_trip() -> None:
    payload = {
        "workspace_id": "workspace-1",
        "session_id": "session-1",
        "input_id": "input-1",
        "instruction": "hello",
        "context": {"k": "v"},
        "debug": True,
    }
    encoded = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")

    request = _decode_request(encoded)

    assert request.holaboss_user_id is None
    assert request.workspace_id == "workspace-1"
    assert request.context == {"k": "v"}
    assert request.debug is True


@pytest.mark.asyncio
async def test_try_execute_request_opencode_via_harness_host_relays_events_and_persists_session(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("SANDBOX_AGENT_USE_TS_HARNESS_HOST", "1")
    entry_path = tmp_path / "index.mjs"
    entry_path.write_text("// built harness host placeholder\n", encoding="utf-8")
    monkeypatch.setattr("sandbox_agent_runtime.runner._ts_harness_host_entry_path", lambda: entry_path)
    monkeypatch.setattr("sandbox_agent_runtime.runner._ts_harness_host_node_bin", lambda: "node")

    captured_args: dict[str, tuple[object, ...]] = {}

    async def _fake_subprocess_exec(*args, **kwargs):
        captured_args["args"] = args
        captured_args["kwargs"] = kwargs
        return _FakeHarnessHostProcess(
            stdout_lines=[
                json.dumps(
                    {
                        "session_id": "session-1",
                        "input_id": "input-1",
                        "sequence": 1,
                        "event_type": "run_started",
                        "payload": {"provider_id": "openai", "model_id": "gpt-5"},
                    }
                ),
                json.dumps(
                    {
                        "session_id": "session-1",
                        "input_id": "input-1",
                        "sequence": 2,
                        "event_type": "run_completed",
                        "payload": {"harness_session_id": "host-session-1"},
                    }
                ),
            ]
        )

    monkeypatch.setattr("sandbox_agent_runtime.runner.asyncio.create_subprocess_exec", _fake_subprocess_exec)

    request = RunnerRequest(
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(harness="opencode", harness_session_id="opencode-session-1"),
    )
    runtime_config = _opencode_runtime_config_fixture()
    model_client_config = _model_client_config_fixture()
    workspace_dir = tmp_path / "workspace-1"
    workspace_dir.mkdir(parents=True, exist_ok=True)

    used = await runner_module._try_execute_request_opencode_via_harness_host(
        request=request,
        workspace_dir=workspace_dir,
        runtime_config=runtime_config,
        model_client_config=model_client_config,
        mcp_server_id_map={},
        sidecar=None,
        push_client=None,
    )

    assert used is True
    assert captured_args["args"][0] == "node"
    assert captured_args["args"][1] == str(entry_path)
    assert captured_args["args"][2] == "run-opencode"
    assert captured_args["args"][3] == "--request-base64"
    assert captured_args["kwargs"]["cwd"] == str(runner_module._runtime_root_dir())
    assert captured_args["kwargs"]["stdout"] == asyncio.subprocess.PIPE
    request_payload = json.loads(base64.b64decode(captured_args["args"][4]).decode("utf-8"))
    assert request_payload["workspace_dir"] == str(workspace_dir)
    assert request_payload["harness_session_id"] == "opencode-session-1"
    assert request_payload["persisted_harness_session_id"] is None
    assert request_payload["opencode_base_url"] == runner_module._opencode_base_url()
    assert request_payload["timeout_seconds"] == runner_module._opencode_timeout_seconds()
    assert runner_module._read_workspace_main_session_id(workspace_dir=workspace_dir, harness="opencode") == "host-session-1"

    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert len(lines) == 2
    started = json.loads(lines[0])
    completed = json.loads(lines[1])
    assert started["event_type"] == "run_started"
    assert completed["event_type"] == "run_completed"
    assert completed["payload"]["harness_session_id"] == "host-session-1"


@pytest.mark.asyncio
async def test_try_execute_request_opencode_via_harness_host_includes_persisted_session_and_replaces_it(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("SANDBOX_AGENT_USE_TS_HARNESS_HOST", "1")
    entry_path = tmp_path / "index.mjs"
    entry_path.write_text("// built harness host placeholder\n", encoding="utf-8")
    monkeypatch.setattr("sandbox_agent_runtime.runner._ts_harness_host_entry_path", lambda: entry_path)
    monkeypatch.setattr("sandbox_agent_runtime.runner._ts_harness_host_node_bin", lambda: "node")

    captured_args: dict[str, tuple[object, ...]] = {}

    async def _fake_subprocess_exec(*args, **kwargs):
        captured_args["args"] = args
        captured_args["kwargs"] = kwargs
        return _FakeHarnessHostProcess(
            stdout_lines=[
                json.dumps(
                    {
                        "session_id": "session-1",
                        "input_id": "input-1",
                        "sequence": 1,
                        "event_type": "run_started",
                        "payload": {"provider_id": "openai", "model_id": "gpt-5"},
                    }
                ),
                json.dumps(
                    {
                        "session_id": "session-1",
                        "input_id": "input-1",
                        "sequence": 2,
                        "event_type": "run_completed",
                        "payload": {
                            "status": "success",
                            "harness_session_id": "replacement-session-1",
                        },
                    }
                ),
            ]
        )

    monkeypatch.setattr("sandbox_agent_runtime.runner.asyncio.create_subprocess_exec", _fake_subprocess_exec)

    request = RunnerRequest(
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(harness="opencode", harness_session_id="requested-session-1"),
    )
    workspace_dir = tmp_path / "workspace-1"
    workspace_dir.mkdir(parents=True, exist_ok=True)
    runner_module._persist_workspace_main_session_id(
        workspace_dir=workspace_dir,
        harness="opencode",
        session_id="persisted-session-1",
    )

    used = await runner_module._try_execute_request_opencode_via_harness_host(
        request=request,
        workspace_dir=workspace_dir,
        runtime_config=_opencode_runtime_config_fixture(),
        model_client_config=_model_client_config_fixture(),
        mcp_server_id_map={},
        sidecar=None,
        push_client=None,
    )

    assert used is True
    request_payload = json.loads(base64.b64decode(captured_args["args"][4]).decode("utf-8"))
    assert request_payload["harness_session_id"] == "requested-session-1"
    assert request_payload["persisted_harness_session_id"] == "persisted-session-1"
    assert runner_module._read_workspace_main_session_id(workspace_dir=workspace_dir, harness="opencode") == (
        "replacement-session-1"
    )

    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert [json.loads(line)["event_type"] for line in lines] == ["run_started", "run_completed"]


@pytest.mark.asyncio
async def test_try_execute_request_opencode_via_harness_host_persists_session_from_failed_terminal_event(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("SANDBOX_AGENT_USE_TS_HARNESS_HOST", "1")
    entry_path = tmp_path / "index.mjs"
    entry_path.write_text("// built harness host placeholder\n", encoding="utf-8")
    monkeypatch.setattr("sandbox_agent_runtime.runner._ts_harness_host_entry_path", lambda: entry_path)
    monkeypatch.setattr("sandbox_agent_runtime.runner._ts_harness_host_node_bin", lambda: "node")

    async def _fake_subprocess_exec(*args, **kwargs):
        del args, kwargs
        return _FakeHarnessHostProcess(
            stdout_lines=[
                json.dumps(
                    {
                        "session_id": "session-1",
                        "input_id": "input-1",
                        "sequence": 1,
                        "event_type": "run_started",
                        "payload": {"provider_id": "openai", "model_id": "gpt-5"},
                    }
                ),
                json.dumps(
                    {
                        "session_id": "session-1",
                        "input_id": "input-1",
                        "sequence": 2,
                        "event_type": "run_failed",
                        "payload": {
                            "type": "OpenCodeSessionError",
                            "message": "permission denied",
                            "harness_session_id": "failed-session-1",
                        },
                    }
                ),
            ]
        )

    monkeypatch.setattr("sandbox_agent_runtime.runner.asyncio.create_subprocess_exec", _fake_subprocess_exec)

    request = RunnerRequest(
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(harness="opencode", harness_session_id="requested-session-1"),
    )
    workspace_dir = tmp_path / "workspace-1"
    workspace_dir.mkdir(parents=True, exist_ok=True)

    used = await runner_module._try_execute_request_opencode_via_harness_host(
        request=request,
        workspace_dir=workspace_dir,
        runtime_config=_opencode_runtime_config_fixture(),
        model_client_config=_model_client_config_fixture(),
        mcp_server_id_map={},
        sidecar=None,
        push_client=None,
    )

    assert used is True
    assert runner_module._read_workspace_main_session_id(workspace_dir=workspace_dir, harness="opencode") == (
        "failed-session-1"
    )

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert [line["event_type"] for line in lines] == ["run_started", "run_failed"]
    assert lines[-1]["payload"]["harness_session_id"] == "failed-session-1"


@pytest.mark.asyncio
async def test_try_execute_request_opencode_via_harness_host_emits_runtime_failure_without_terminal_event(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("SANDBOX_AGENT_USE_TS_HARNESS_HOST", "1")
    entry_path = tmp_path / "index.mjs"
    entry_path.write_text("// built harness host placeholder\n", encoding="utf-8")
    monkeypatch.setattr("sandbox_agent_runtime.runner._ts_harness_host_entry_path", lambda: entry_path)
    monkeypatch.setattr("sandbox_agent_runtime.runner._ts_harness_host_node_bin", lambda: "node")

    async def _fake_subprocess_exec(*args, **kwargs):
        del args, kwargs
        return _FakeHarnessHostProcess(
            stdout_lines=[
                json.dumps(
                    {
                        "session_id": "session-1",
                        "input_id": "input-1",
                        "sequence": 4,
                        "event_type": "run_started",
                        "payload": {"provider_id": "openai", "model_id": "gpt-5"},
                    }
                ),
                json.dumps(
                    {
                        "session_id": "session-1",
                        "input_id": "input-1",
                        "sequence": 5,
                        "event_type": "output_delta",
                        "payload": {"delta": "partial output"},
                    }
                ),
            ],
            stderr_text="terminal event missing\n",
            return_code=0,
        )

    monkeypatch.setattr("sandbox_agent_runtime.runner.asyncio.create_subprocess_exec", _fake_subprocess_exec)

    request = RunnerRequest(
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(harness="opencode", harness_session_id="requested-session-1"),
    )
    workspace_dir = tmp_path / "workspace-1"
    workspace_dir.mkdir(parents=True, exist_ok=True)

    used = await runner_module._try_execute_request_opencode_via_harness_host(
        request=request,
        workspace_dir=workspace_dir,
        runtime_config=_opencode_runtime_config_fixture(),
        model_client_config=_model_client_config_fixture(),
        mcp_server_id_map={},
        sidecar=None,
        push_client=None,
    )

    assert used is True
    assert runner_module._read_workspace_main_session_id(workspace_dir=workspace_dir, harness="opencode") is None

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert [line["event_type"] for line in lines] == ["run_started", "output_delta", "run_failed"]
    assert lines[-1]["sequence"] == 6
    assert lines[-1]["payload"] == {
        "type": "RuntimeError",
        "message": "TypeScript OpenCode harness host ended before terminal event: terminal event missing",
    }


@pytest.mark.asyncio
async def test_try_execute_request_opencode_via_harness_host_fails_when_not_implemented(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("SANDBOX_AGENT_USE_TS_HARNESS_HOST", "1")
    entry_path = tmp_path / "index.mjs"
    entry_path.write_text("// built harness host placeholder\n", encoding="utf-8")
    monkeypatch.setattr("sandbox_agent_runtime.runner._ts_harness_host_entry_path", lambda: entry_path)
    monkeypatch.setattr("sandbox_agent_runtime.runner._ts_harness_host_node_bin", lambda: "node")

    async def _fake_subprocess_exec(*args, **kwargs):
        del args, kwargs
        return _FakeHarnessHostProcess(
            stdout_lines=[],
            stderr_text="TypeScript OpenCode harness host is scaffolded, but the OpenCode adapter is not implemented yet.\n",
            return_code=86,
        )

    monkeypatch.setattr("sandbox_agent_runtime.runner.asyncio.create_subprocess_exec", _fake_subprocess_exec)

    request = RunnerRequest(
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(harness="opencode", harness_session_id="opencode-session-1"),
    )
    runtime_config = _opencode_runtime_config_fixture(workspace_tool_ids=(), workspace_skill_ids=())
    model_client_config = _model_client_config_fixture(default_headers=None)
    workspace_dir = tmp_path / "workspace-1"
    workspace_dir.mkdir(parents=True, exist_ok=True)

    used = await runner_module._try_execute_request_opencode_via_harness_host(
        request=request,
        workspace_dir=workspace_dir,
        runtime_config=runtime_config,
        model_client_config=model_client_config,
        mcp_server_id_map={},
        sidecar=None,
        push_client=None,
    )

    assert used is True
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert [line["event_type"] for line in lines] == ["run_failed"]
    assert lines[0]["payload"] == {
        "type": "RuntimeError",
        "message": (
            "TypeScript OpenCode harness host reported unimplemented OpenCode adapter: "
            "TypeScript OpenCode harness host is scaffolded, but the OpenCode adapter is not implemented yet."
        ),
    }


def test_resolve_model_client_config_prefers_runtime_context(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(run_id="run-ctx-1", model_proxy_api_key="hbrt.v1.proxy-user-key"),
    )

    config = _resolve_model_client_config(request=request, model_proxy_provider="openai_compatible")
    assert config.model_proxy_provider == "openai_compatible"
    assert config.base_url == "http://sandbox-runtime:3060/api/v1/model-proxy/openai/v1"
    assert config.api_key == "hbrt.v1.proxy-user-key"
    assert config.default_headers == {
        "X-API-Key": "hbrt.v1.proxy-user-key",
        "X-Holaboss-Sandbox-Id": "sandbox-1",
        "X-Holaboss-Run-Id": "run-ctx-1",
        "X-Holaboss-Session-Id": "session-1",
        "X-Holaboss-Workspace-Id": "workspace-1",
        "X-Holaboss-Input-Id": "input-1",
    }




def test_resolve_model_client_config_uses_direct_openai_fallback_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "direct-openai-key")

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context={},
    )

    config = _resolve_model_client_config(request=request, model_proxy_provider="openai_compatible")
    assert config.model_proxy_provider == "openai_compatible"
    assert config.api_key == "direct-openai-key"
    assert config.base_url is None
    assert config.default_headers is None


def test_resolve_model_client_config_uses_direct_openai_fallback_without_product_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "direct-openai-key")

    request = RunnerRequest(
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context={},
    )

    config = _resolve_model_client_config(request=request, model_proxy_provider="openai_compatible")
    assert config.model_proxy_provider == "openai_compatible"
    assert config.api_key == "direct-openai-key"
    assert config.base_url is None
    assert config.default_headers is None


def test_resolve_model_client_config_supports_anthropic_native_for_opencode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(run_id="run-ctx-1", model_proxy_api_key="hbrt.v1.proxy-user-key"),
    )

    config = _resolve_model_client_config(request=request, model_proxy_provider="anthropic_native", harness="opencode")
    assert config.model_proxy_provider == "anthropic_native"
    assert config.base_url == "http://sandbox-runtime:3060/api/v1/model-proxy/anthropic/v1"
    assert config.default_headers is not None
    assert config.default_headers["X-Holaboss-Sandbox-Id"] == "sandbox-1"
    assert config.default_headers["X-Holaboss-Run-Id"] == "run-ctx-1"


def test_resolve_model_client_config_defaults_to_openai_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(run_id="run-ctx-1", model_proxy_api_key="hbrt.v1.proxy-user-key"),
    )

    config = _resolve_model_client_config(request=request, harness="opencode")
    assert config.model_proxy_provider == "openai_compatible"
    assert config.base_url == "http://sandbox-runtime:3060/api/v1/model-proxy/openai/v1"


def test_resolve_model_client_config_supports_anthropic_native(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(),
    )

    config = _resolve_model_client_config(request=request, model_proxy_provider="anthropic_native", harness="opencode")
    assert config.model_proxy_provider == "anthropic_native"
    assert config.base_url == "http://sandbox-runtime:3060/api/v1/model-proxy/anthropic/v1"


def _single_plan(
    *,
    servers: tuple[ResolvedMcpServerConfig, ...] = (),
    tools: tuple[ResolvedMcpToolRef, ...] = (),
    output_schemas: dict[str, type[BaseModel]] | None = None,
) -> CompiledWorkspaceRuntimePlan:
    general_member = WorkspaceGeneralMemberConfig(
        id="workspace.general",
        model="gpt-5.2",
        prompt="You are concise.",
    )
    return CompiledWorkspaceRuntimePlan(
        workspace_id="workspace-1",
        mode="single",
        general_config=WorkspaceGeneralSingleConfig(type="single", agent=general_member),
        resolved_prompts={"workspace.general": "You are concise."},
        resolved_mcp_servers=servers,
        resolved_mcp_tool_refs=tools,
        workspace_mcp_catalog=(),
        resolved_output_schemas=output_schemas or {},
        config_checksum="checksum-1",
    )


def test_build_opencode_runtime_config_maps_workspace_tools_and_schema() -> None:
    class _HealthPlan(BaseModel):
        checks: list[str]

    tools = (
        ResolvedMcpToolRef(tool_id="workspace.read_file", server_id="workspace", tool_name="read_file"),
        ResolvedMcpToolRef(tool_id="remote.lookup", server_id="remote", tool_name="lookup"),
    )
    plan = _single_plan(tools=tools, output_schemas={"workspace.general": _HealthPlan})
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(),
    )

    config = _build_opencode_runtime_config(request=request, compiled_plan=plan, mcp_servers=())

    expected_tools = dict.fromkeys(runner_module._OPENCODE_DEFAULT_TOOLS, True)
    expected_tools.update({"workspace_read_file": True, "remote_lookup": True})
    assert config.tools == expected_tools
    assert config.workspace_tool_ids == ("workspace.read_file", "remote.lookup")
    assert config.output_schema_member_id == "workspace.general"
    assert config.output_schema_model is _HealthPlan
    assert config.output_format is not None
    assert config.output_format["type"] == "json_schema"
    assert "checks" in config.output_format["schema"]["properties"]


def test_workspace_sidecar_enabled_tool_ids_payload_only_includes_workspace_tools() -> None:
    tools = (
        ResolvedMcpToolRef(tool_id="workspace.echo", server_id="workspace", tool_name="echo"),
        ResolvedMcpToolRef(tool_id="remote.lookup", server_id="remote", tool_name="lookup"),
    )
    plan = _single_plan(tools=tools)
    tool_ids = runner_module._workspace_sidecar_enabled_tool_ids(compiled_plan=plan)
    assert tool_ids == ("workspace.echo",)

    payload = runner_module._sidecar_enabled_tool_ids_payload(plan)
    decoded = json.loads(base64.b64decode(payload.encode("utf-8")).decode("utf-8"))
    assert decoded == ["workspace.echo"]


def test_build_opencode_runtime_config_maps_workspace_tools_to_physical_server_ids() -> None:
    tools = (
        ResolvedMcpToolRef(tool_id="workspace.read_file", server_id="workspace", tool_name="read_file"),
        ResolvedMcpToolRef(tool_id="remote.lookup", server_id="remote", tool_name="lookup"),
    )
    servers = (
        ResolvedMcpServerConfig(
            server_id="workspace",
            type="local",
            command=("python", "-m", "sandbox_agent_runtime.workspace_mcp_sidecar"),
            timeout_ms=10000,
        ),
        ResolvedMcpServerConfig(server_id="remote", type="remote", url="https://example.com/mcp", timeout_ms=10000),
    )
    plan = _single_plan(servers=servers, tools=tools)
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(),
    )

    config = _build_opencode_runtime_config(
        request=request,
        compiled_plan=plan,
        mcp_servers=(),
        tool_server_id_map={"workspace": "workspace__abc123", "remote": "remote"},
    )
    expected_tools = dict.fromkeys(runner_module._OPENCODE_DEFAULT_TOOLS, True)
    expected_tools.update({"workspace__abc123_read_file": True, "remote_lookup": True})
    assert config.tools == expected_tools


def test_mcp_server_id_map_assigns_stable_workspace_physical_id() -> None:
    servers = (
        ResolvedMcpServerConfig(
            server_id="workspace",
            type="local",
            command=("python", "-m", "sandbox_agent_runtime.workspace_mcp_sidecar"),
            timeout_ms=10000,
        ),
    )
    plan = _single_plan(servers=servers)
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(),
    )

    mapping_one = runner_module._mcp_server_id_map(request=request, compiled_plan=plan, sandbox_id="sandbox-a")
    mapping_two = runner_module._mcp_server_id_map(request=request, compiled_plan=plan, sandbox_id="sandbox-a")
    mapping_other_workspace = runner_module._mcp_server_id_map(
        request=request.model_copy(update={"workspace_id": "workspace-2"}),
        compiled_plan=plan,
        sandbox_id="sandbox-a",
    )

    assert mapping_one["workspace"].startswith("workspace__")
    assert mapping_one["workspace"] != "workspace"
    assert mapping_one == mapping_two
    assert mapping_one["workspace"] != mapping_other_workspace["workspace"]


def test_build_opencode_runtime_config_defaults_to_builtin_tools_when_no_allowlisted_mcp_tools() -> None:
    plan = _single_plan(tools=())
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(),
    )

    config = _build_opencode_runtime_config(request=request, compiled_plan=plan, mcp_servers=())
    assert config.tools == dict.fromkeys(runner_module._OPENCODE_DEFAULT_TOOLS, True)


def test_build_opencode_runtime_config_includes_workspace_skills(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    workspace_root = tmp_path / "workspace-root"
    workspace_dir = workspace_root / "workspace-1"
    skill_dir = workspace_dir / "skills" / "skill-creator"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text("# Skill Creator\nUse this skill.\n", encoding="utf-8")
    (workspace_dir / "workspace.yaml").write_text(
        """
template_id: "workspace-1"
name: "Workspace"
skills:
  path: "skills"
  enabled:
    - "skill-creator"
""".strip()
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr("sandbox_agent_runtime.runner.WORKSPACE_ROOT", str(workspace_root))

    plan = _single_plan(tools=())
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(harness="opencode", harness_session_id="opencode-session-1"),
    )

    config = _build_opencode_runtime_config(request=request, compiled_plan=plan, mcp_servers=())
    assert config.workspace_skill_ids == ("skill-creator",)
    assert "Workspace skills are available in this run." not in config.system_prompt
    assert "skill-creator" not in config.system_prompt
    assert config.tools["skill"] is True
    assert config.tools["read"] is True


def test_stage_workspace_skills_for_opencode_creates_discoverable_skill_dir(tmp_path: Path) -> None:
    workspace_dir = tmp_path / "workspace-1"
    skill_dir = workspace_dir / "skills" / "skill-creator"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text("# Skill Creator\n", encoding="utf-8")
    (workspace_dir / "workspace.yaml").write_text(
        """
template_id: "workspace-1"
name: "Workspace"
skills:
  path: "skills"
  enabled:
    - "skill-creator"
""".strip()
        + "\n",
        encoding="utf-8",
    )

    workspace_skills = runner_module._resolve_workspace_skills(workspace_dir=workspace_dir)
    assert workspace_skills is not None

    changed = runner_module._stage_workspace_skills_for_opencode(
        workspace_dir=workspace_dir,
        workspace_skills=workspace_skills,
    )
    assert changed is True

    staged_skill = workspace_dir / ".opencode" / "skills" / "skill-creator" / "SKILL.md"
    assert staged_skill.is_file()
    assert "Skill Creator" in staged_skill.read_text(encoding="utf-8")
    runtime_staged_skill = Path(runner_module.WORKSPACE_ROOT) / ".opencode" / "skills" / "skill-creator" / "SKILL.md"
    assert runtime_staged_skill.is_file()


def test_stage_workspace_skills_for_opencode_is_noop_when_manifest_matches(tmp_path: Path) -> None:
    workspace_dir = tmp_path / "workspace-1"
    skill_dir = workspace_dir / "skills" / "skill-creator"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text("# Skill Creator\n", encoding="utf-8")
    (workspace_dir / "workspace.yaml").write_text(
        """
template_id: "workspace-1"
name: "Workspace"
skills:
  path: "skills"
  enabled:
    - "skill-creator"
""".strip()
        + "\n",
        encoding="utf-8",
    )

    workspace_skills = runner_module._resolve_workspace_skills(workspace_dir=workspace_dir)
    assert workspace_skills is not None

    first_changed = runner_module._stage_workspace_skills_for_opencode(
        workspace_dir=workspace_dir,
        workspace_skills=workspace_skills,
    )
    second_changed = runner_module._stage_workspace_skills_for_opencode(
        workspace_dir=workspace_dir,
        workspace_skills=workspace_skills,
    )

    assert first_changed is True
    assert second_changed is False
    runtime_staged_skill = Path(runner_module.WORKSPACE_ROOT) / ".opencode" / "skills" / "skill-creator" / "SKILL.md"
    assert "Skill Creator" in runtime_staged_skill.read_text(encoding="utf-8")


def test_stage_workspace_commands_for_opencode_creates_discoverable_commands_dir(tmp_path: Path) -> None:
    workspace_dir = tmp_path / "workspace-1"
    commands_dir = workspace_dir / "commands"
    commands_dir.mkdir(parents=True, exist_ok=True)
    (commands_dir / "hello.md").write_text("---\ndescription: Hello\n---\nEcho hello.\n", encoding="utf-8")

    runner_module._stage_workspace_commands_for_opencode(workspace_dir=workspace_dir)

    staged_command = workspace_dir / ".opencode" / "commands" / "hello.md"
    assert staged_command.is_file()
    assert "Echo hello" in staged_command.read_text(encoding="utf-8")

def test_build_opencode_runtime_config_preserves_mcp_server_payloads() -> None:
    tools = (ResolvedMcpToolRef(tool_id="workspace.lookup", server_id="workspace", tool_name="lookup"),)
    plan = _single_plan(tools=tools)
    mcp_servers = (
        {
            "name": "workspace",
            "config": {"type": "remote", "url": "http://127.0.0.1:9911/mcp", "enabled": True},
        },
    )
    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(harness="opencode", harness_session_id="opencode-session-1"),
    )

    config = _build_opencode_runtime_config(request=request, compiled_plan=plan, mcp_servers=mcp_servers)
    assert config.mcp_servers == mcp_servers


def test_opencode_provider_config_payload_uses_model_proxy_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(run_id="run-ctx-1", model_proxy_api_key="hbrt.v1.proxy-user-key"),
    )

    model_client_config = _resolve_model_client_config(request=request, model_proxy_provider="openai_compatible")
    payload = _opencode_provider_config_payload(
        provider_id="holaboss_proxy",
        model_id="gpt-5.1",
        model_client_config=model_client_config,
    )

    assert payload["model"] == "holaboss_proxy/gpt-5.1"
    provider = payload["provider"]["holaboss_proxy"]
    assert provider["npm"] == "@ai-sdk/openai-compatible"
    assert provider["options"]["baseURL"] == "http://sandbox-runtime:3060/api/v1/model-proxy/openai/v1"
    assert provider["options"]["apiKey"] == "hbrt.v1.proxy-user-key"
    assert provider["options"]["headers"]["X-API-Key"] == "hbrt.v1.proxy-user-key"
    assert provider["options"]["headers"]["X-Holaboss-Sandbox-Id"] == "sandbox-1"
    assert "X-Holaboss-Run-Id" not in provider["options"]["headers"]


def test_opencode_provider_config_payload_uses_anthropic_provider_package(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(run_id="run-ctx-1", model_proxy_api_key="hbrt.v1.proxy-user-key"),
    )

    model_client_config = _resolve_model_client_config(
        request=request,
        model_proxy_provider="anthropic_native",
        harness="opencode",
    )
    payload = _opencode_provider_config_payload(
        provider_id="anthropic",
        model_id="claude-3-7-sonnet-20250219",
        model_client_config=model_client_config,
    )

    provider = payload["provider"]["anthropic"]
    assert provider["npm"] == "@ai-sdk/anthropic"
    assert provider["options"]["baseURL"] == "http://sandbox-runtime:3060/api/v1/model-proxy/anthropic/v1"


def test_resolve_model_client_config_requires_sandbox_model_proxy_base_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("HOLABOSS_MODEL_PROXY_BASE_URL", raising=False)
    monkeypatch.delenv("SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(run_id="run-ctx-1", model_proxy_api_key="hbrt.v1.proxy-user-key"),
    )

    with pytest.raises(
        RuntimeError,
        match=r"HOLABOSS_MODEL_PROXY_BASE_URL or runtime-config\.json:model_proxy_base_url is required",
    ):
        _resolve_model_client_config(request=request, model_proxy_provider="openai_compatible")


def test_map_opencode_event_extracts_text_from_message_updated_payload() -> None:
    raw_event = SimpleNamespace(
        type="message.updated",
        properties=SimpleNamespace(
            session_id="opencode-session-1",
            info={
                "parts": [
                    {"id": "text-part-1", "type": "text", "text": "Hello"},
                ]
            },
        ),
    )

    events = _map_opencode_event(
        raw_event=raw_event,
        target_session_id="opencode-session-1",
        text_snapshots={},
        tool_snapshots={},
    )

    assert events == [
        (
            "output_delta",
            {
                "delta": "Hello",
                "event": "message.updated",
                "source": "opencode",
                "part_id": "text-part-1",
                "part_type": "text",
                "delta_kind": "output",
            },
        )
    ]


def test_map_opencode_event_maps_reasoning_message_updated_part_to_thinking_delta() -> None:
    raw_event = SimpleNamespace(
        type="message.updated",
        properties=SimpleNamespace(
            session_id="opencode-session-1",
            info={
                "parts": [
                    {"id": "reason-part-1", "type": "reasoning", "text": "Plan first"},
                ]
            },
        ),
    )

    events = _map_opencode_event(
        raw_event=raw_event,
        target_session_id="opencode-session-1",
        text_snapshots={},
        tool_snapshots={},
    )

    assert events == [
        (
            "thinking_delta",
            {
                "delta": "Plan first",
                "event": "message.updated",
                "source": "opencode",
                "part_id": "reason-part-1",
                "part_type": "reasoning",
                "delta_kind": "thinking",
            },
        )
    ]


def test_map_opencode_event_uses_message_part_delta_for_incremental_streaming() -> None:
    raw_event = SimpleNamespace(
        type="message.part.updated",
        properties=SimpleNamespace(
            session_id="opencode-session-1",
            delta="Hel",
            part=SimpleNamespace(type="text", id="text-part-1", text="Hel", session_id="opencode-session-1"),
        ),
    )

    events = _map_opencode_event(
        raw_event=raw_event,
        target_session_id="opencode-session-1",
        text_snapshots={},
        tool_snapshots={},
    )

    assert events == [
        (
            "output_delta",
            {
                "delta": "Hel",
                "event": "message.part.updated",
                "source": "opencode",
                "part_id": "text-part-1",
                "part_type": "text",
                "delta_kind": "output",
            },
        )
    ]


def test_map_opencode_event_uses_reasoning_snapshot_for_part_delta() -> None:
    events = _map_opencode_event(
        raw_event=SimpleNamespace(
            type="message.part.delta",
            properties=SimpleNamespace(
                session_id="opencode-session-1",
                part_id="reason-part-1",
                delta="Think",
            ),
        ),
        target_session_id="opencode-session-1",
        text_snapshots={},
        tool_snapshots={},
        part_type_snapshots={"reason-part-1": "reasoning"},
    )

    assert events == [
        (
            "thinking_delta",
            {
                "delta": "Think",
                "event": "message.part.delta",
                "source": "opencode",
                "part_id": "reason-part-1",
                "part_type": "reasoning",
                "delta_kind": "thinking",
            },
        )
    ]


def test_map_opencode_event_buffers_untyped_message_part_delta_until_part_type_is_known() -> None:
    part_type_snapshots: dict[str, str] = {}
    pending_part_deltas: dict[str, list[tuple[str, str]]] = {}

    raw_event = SimpleNamespace(
        type="message.part.delta",
        properties=SimpleNamespace(
            session_id="opencode-session-1",
            part_id="text-part-1",
            delta="Hello ",
        ),
    )

    events = _map_opencode_event(
        raw_event=raw_event,
        target_session_id="opencode-session-1",
        text_snapshots={},
        tool_snapshots={},
        part_type_snapshots=part_type_snapshots,
        pending_part_deltas=pending_part_deltas,
    )

    assert events == []
    assert pending_part_deltas == {"text-part-1": [("message.part.delta", "Hello ")]}

    part_type_snapshots["text-part-1"] = "text"
    raw_event_2 = SimpleNamespace(
        type="message.part.delta",
        properties=SimpleNamespace(
            session_id="opencode-session-1",
            part_id="text-part-1",
            delta="world",
        ),
    )

    events_2 = _map_opencode_event(
        raw_event=raw_event_2,
        target_session_id="opencode-session-1",
        text_snapshots={},
        tool_snapshots={},
        part_type_snapshots=part_type_snapshots,
        pending_part_deltas=pending_part_deltas,
    )

    assert events_2 == [
        (
            "output_delta",
            {
                "delta": "Hello ",
                "event": "message.part.delta",
                "source": "opencode",
                "part_id": "text-part-1",
                "part_type": "text",
                "delta_kind": "output",
            },
        ),
        (
            "output_delta",
            {
                "delta": "world",
                "event": "message.part.delta",
                "source": "opencode",
                "part_id": "text-part-1",
                "part_type": "text",
                "delta_kind": "output",
            },
        ),
    ]


def test_map_opencode_event_supports_message_part_delta_dict_properties_aliases() -> None:
    raw_event = SimpleNamespace(
        type="message.part.delta",
        properties={
            "sessionID": "opencode-session-1",
            "partID": "text-part-1",
            "delta": "world",
        },
    )

    events = _map_opencode_event(
        raw_event=raw_event,
        target_session_id="opencode-session-1",
        text_snapshots={},
        tool_snapshots={},
        part_type_snapshots={"text-part-1": "text"},
    )

    assert events == [
        (
            "output_delta",
            {
                "delta": "world",
                "event": "message.part.delta",
                "source": "opencode",
                "part_id": "text-part-1",
                "part_type": "text",
                "delta_kind": "output",
            },
        )
    ]


def test_map_opencode_event_maps_session_status_idle_to_run_completed() -> None:
    raw_event = SimpleNamespace(
        type="session.status",
        properties=SimpleNamespace(
            session_id="opencode-session-1",
            status=SimpleNamespace(type="idle"),
        ),
    )

    events = _map_opencode_event(
        raw_event=raw_event,
        target_session_id="opencode-session-1",
        text_snapshots={},
        tool_snapshots={},
    )

    assert events == [
        (
            "run_completed",
            {
                "status": "success",
                "event": "session.status",
                "session_status": "idle",
            },
        )
    ]


def test_map_opencode_event_treats_question_tool_call_as_waiting_user_terminal() -> None:
    raw_event = SimpleNamespace(
        type="message.part.updated",
        properties=SimpleNamespace(
            session_id="opencode-session-1",
            part=SimpleNamespace(
                type="tool",
                id="tool-part-1",
                tool="question",
                call_id="call-1",
                state=SimpleNamespace(
                    status="running",
                    input={
                        "questions": [
                            {
                                "question": "What are your top 1-3 outcomes?",
                                "header": "Top Outcomes",
                            }
                        ]
                    },
                    output=None,
                    error=None,
                ),
            ),
        ),
    )

    events = _map_opencode_event(
        raw_event=raw_event,
        target_session_id="opencode-session-1",
        text_snapshots={},
        tool_snapshots={},
    )

    assert events == [
        (
            "tool_call",
            {
                "phase": "started",
                "tool_name": "question",
                "error": False,
                "tool_args": {
                    "questions": [
                        {
                            "question": "What are your top 1-3 outcomes?",
                            "header": "Top Outcomes",
                        }
                    ]
                },
                "result": None,
                "event": "message.part.updated",
                "source": "opencode",
                "call_id": "call-1",
            },
        ),
        (
            "run_completed",
            {
                "status": "waiting_user",
                "event": "message.part.updated",
                "interaction_type": "question",
                "tool_name": "question",
                "question": {
                    "questions": [
                        {
                            "question": "What are your top 1-3 outcomes?",
                            "header": "Top Outcomes",
                        }
                    ]
                },
                "call_id": "call-1",
            },
        ),
    ]


def test_should_emit_opencode_event_filters_step_markers_and_prompt_echo() -> None:
    assert (
        _should_emit_opencode_event(
            event_type="thinking_delta",
            payload={"delta": "step-start", "source": "opencode"},
            instruction="hello",
        )
        is False
    )
    assert (
        _should_emit_opencode_event(
            event_type="thinking_delta",
            payload={"delta": "step-finish", "source": "opencode"},
            instruction="hello",
        )
        is False
    )
    assert (
        _should_emit_opencode_event(
            event_type="output_delta",
            payload={"delta": "hello", "source": "opencode"},
            instruction="hello",
        )
        is False
    )
    assert (
        _should_emit_opencode_event(
            event_type="output_delta",
            payload={"delta": "hello world", "source": "opencode"},
            instruction="hello",
        )
        is True
    )


@pytest.mark.asyncio
async def test_execute_request_opencode_delegates_to_harness_host(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("SANDBOX_AGENT_HARNESS", "opencode")

    async def _noop_restart(**kwargs) -> None:
        del kwargs
        return None

    def _noop_write_provider_config(*, provider_id, model_id, model_client_config):
        del provider_id, model_id, model_client_config
        return Path("opencode.json"), False

    def _noop_write_model_selection(*, provider_id, model_id):
        del provider_id, model_id
        return Path("opencode.json"), False

    async def _fake_compile_workspace_runtime_plan(*, workspace_dir, workspace_id):
        del workspace_dir, workspace_id
        return object()

    def _fake_build_opencode_runtime_config(*, request, compiled_plan, mcp_servers, tool_server_id_map=None):
        del request, compiled_plan, mcp_servers, tool_server_id_map
        return SimpleNamespace(
            provider_id="openai",
            model_id="gpt-5.2",
            mode="code",
            system_prompt="You are concise.",
            tools={"read": True},
            mcp_servers=(),
            workspace_tool_ids=(),
            workspace_skill_ids=(),
            output_schema_member_id=None,
            output_schema_model=None,
            output_format=None,
            workspace_config_checksum="checksum-1",
        )

    captured: dict[str, object] = {}

    async def _fake_try_execute_request_opencode_via_harness_host(
        *, request, workspace_dir, runtime_config, model_client_config, mcp_server_id_map, sidecar, push_client
    ) -> bool:
        del model_client_config, mcp_server_id_map, sidecar
        captured["workspace_id"] = request.workspace_id
        captured["workspace_dir"] = str(workspace_dir)
        captured["model_id"] = runtime_config.model_id
        await runner_module._emit_event_with_push(
            event=runner_module.RunnerOutputEvent(
                session_id=request.session_id,
                input_id=request.input_id,
                sequence=2,
                event_type="run_started",
                payload={"provider_id": "openai", "model_id": runtime_config.model_id},
            ),
            push_client=push_client,
        )
        await runner_module._emit_event_with_push(
            event=runner_module.RunnerOutputEvent(
                session_id=request.session_id,
                input_id=request.input_id,
                sequence=3,
                event_type="run_completed",
                payload={"status": "success", "harness_session_id": "host-session-1"},
            ),
            push_client=push_client,
        )
        return True

    monkeypatch.setattr(
        "sandbox_agent_runtime.runner._compile_workspace_runtime_plan",
        _fake_compile_workspace_runtime_plan,
    )
    monkeypatch.setattr(
        "sandbox_agent_runtime.runner._build_opencode_runtime_config",
        _fake_build_opencode_runtime_config,
    )
    monkeypatch.setattr("sandbox_agent_runtime.runner._write_opencode_provider_config", _noop_write_provider_config)
    monkeypatch.setattr("sandbox_agent_runtime.runner._write_opencode_model_selection", _noop_write_model_selection)
    monkeypatch.setattr("sandbox_agent_runtime.runner._restart_opencode_sidecar", _noop_restart)
    monkeypatch.setattr(
        "sandbox_agent_runtime.runner._try_execute_request_opencode_via_harness_host",
        _fake_try_execute_request_opencode_via_harness_host,
    )

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(harness="opencode", harness_session_id="opencode-session-1"),
    )
    exit_code = await _execute_request(request)
    assert exit_code == 0

    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip() and line.lstrip().startswith("{")]
    events = [json.loads(line) for line in lines]
    assert [event["event_type"] for event in events] == ["run_claimed", "run_started", "run_completed"]
    assert captured["workspace_id"] == "workspace-1"
    assert str(captured["workspace_dir"]).endswith("workspace-root/workspace-1")
    assert captured["model_id"] == "gpt-5.2"


@pytest.mark.asyncio
async def test_execute_request_run_failed_when_harness_value_invalid(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("SANDBOX_AGENT_HARNESS", "invalid-harness")

    request = RunnerRequest(
        holaboss_user_id="user-1",
        workspace_id="workspace-1",
        session_id="session-1",
        input_id="input-1",
        instruction="hello",
        context=_runtime_exec_context(),
    )
    exit_code = await _execute_request(request)
    assert exit_code == 0

    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert lines
    event = json.loads(lines[-1])
    assert event["event_type"] == "run_failed"
    assert "SANDBOX_AGENT_HARNESS='invalid-harness'" in event["payload"]["message"]
