# ruff: noqa: S101

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from sandbox_agent_runtime import runtime_config_executor as executor_module


@pytest.mark.asyncio
async def test_get_config_round_trips_runtime_config_and_writes_opencode_bootstrap(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    sandbox_root = tmp_path / "sandbox-root"
    config_path = sandbox_root / "state" / "runtime-config.json"
    monkeypatch.setenv("HB_SANDBOX_ROOT", str(sandbox_root))
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))
    monkeypatch.delenv("HOLABOSS_SANDBOX_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("HOLABOSS_USER_ID", raising=False)
    monkeypatch.delenv("HOLABOSS_MODEL_PROXY_BASE_URL", raising=False)
    monkeypatch.delenv("HOLABOSS_DEFAULT_MODEL", raising=False)
    monkeypatch.setattr(executor_module, "_ensure_selected_harness_ready", lambda: asyncio.sleep(0, "started"))

    rc = await executor_module._run(
        operation="put-config",
        payload={
            "auth_token": "token-1",
            "user_id": "user-1",
            "sandbox_id": "sandbox-1",
            "model_proxy_base_url": "http://54.214.105.154:3060/api/v1/model-proxy",
            "default_model": "openai/gpt-5.1",
        },
    )

    captured = capsys.readouterr()
    assert rc == 0
    payload = json.loads(captured.out)
    assert payload["status_code"] == 200
    assert payload["payload"]["auth_token_present"] is True
    assert payload["payload"]["user_id"] == "user-1"
    assert payload["payload"]["sandbox_id"] == "sandbox-1"
    assert payload["payload"]["model_proxy_base_url"] == "http://54.214.105.154:3060/api/v1/model-proxy"
    assert payload["payload"]["default_model"] == "openai/gpt-5.1"
    assert payload["payload"]["runtime_mode"] == "oss"
    assert payload["payload"]["default_provider"] == "holaboss_model_proxy"
    assert payload["payload"]["holaboss_enabled"] is True
    assert payload["payload"]["desktop_browser_enabled"] is False
    assert payload["payload"]["desktop_browser_url"] is None
    assert payload["payload"]["config_path"] == str(config_path)
    assert payload["payload"]["loaded_from_file"] is True
    opencode_config = json.loads((sandbox_root / "workspace" / "opencode.json").read_text(encoding="utf-8"))
    assert opencode_config["provider"]["openai"]["options"]["apiKey"] == "token-1"
    assert opencode_config["provider"]["openai"]["options"]["headers"]["X-Holaboss-Sandbox-Id"] == "sandbox-1"


@pytest.mark.asyncio
async def test_put_config_supports_oss_direct_provider(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    sandbox_root = tmp_path / "sandbox-root"
    config_path = sandbox_root / "state" / "runtime-config.json"
    monkeypatch.setenv("HB_SANDBOX_ROOT", str(sandbox_root))
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))
    monkeypatch.delenv("HOLABOSS_SANDBOX_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("HOLABOSS_USER_ID", raising=False)
    monkeypatch.delenv("HOLABOSS_MODEL_PROXY_BASE_URL", raising=False)
    monkeypatch.delenv("HOLABOSS_DEFAULT_MODEL", raising=False)
    monkeypatch.setattr(executor_module, "_ensure_selected_harness_ready", lambda: asyncio.sleep(0, "started"))

    rc = await executor_module._run(
        operation="put-config",
        payload={
            "sandbox_id": "sandbox-oss-1",
            "default_model": "gpt-5.1",
            "runtime_mode": "oss",
            "default_provider": "openai",
            "holaboss_enabled": False,
        },
    )

    captured = capsys.readouterr()
    assert rc == 0
    payload = json.loads(captured.out)
    assert payload["status_code"] == 200
    assert payload["payload"]["auth_token_present"] is False
    assert payload["payload"]["user_id"] is None
    assert payload["payload"]["sandbox_id"] == "sandbox-oss-1"
    assert payload["payload"]["model_proxy_base_url"] is None
    assert payload["payload"]["default_model"] == "gpt-5.1"
    assert payload["payload"]["runtime_mode"] == "oss"
    assert payload["payload"]["default_provider"] == "openai"
    assert payload["payload"]["holaboss_enabled"] is False
    assert payload["payload"]["desktop_browser_enabled"] is False
    assert payload["payload"]["desktop_browser_url"] is None
    assert payload["payload"]["config_path"] == str(config_path)
    assert payload["payload"]["loaded_from_file"] is True
    assert not (sandbox_root / "workspace" / "opencode.json").exists()


@pytest.mark.asyncio
async def test_get_status_reports_pending_config_then_ready(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
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

    monkeypatch.setattr(executor_module, "_workspace_mcp_is_ready", _fake_workspace_mcp_is_ready)
    monkeypatch.setattr(executor_module, "_ensure_selected_harness_ready", _fake_ensure_selected_harness_ready)

    rc_pending = await executor_module._run(operation="get-status", payload={})
    pending = json.loads(capsys.readouterr().out)
    assert rc_pending == 0
    assert pending["payload"]["harness_state"] == "pending_config"
    assert pending["payload"]["harness_ready"] is False
    assert pending["payload"]["browser_state"] == "unavailable"
    assert pending["payload"]["browser_available"] is False

    rc_updated = await executor_module._run(
        operation="put-config",
        payload={
            "auth_token": "token-1",
            "user_id": "user-1",
            "sandbox_id": "sandbox-1",
            "model_proxy_base_url": "https://runtime.example/api/v1/model-proxy",
            "default_model": "openai/gpt-5.1",
            "desktop_browser_enabled": True,
        },
    )
    assert rc_updated == 0
    capsys.readouterr()

    rc_ready = await executor_module._run(operation="get-status", payload={})
    ready = json.loads(capsys.readouterr().out)
    assert rc_ready == 0
    assert ready["payload"]["config_loaded"] is True
    assert ready["payload"]["opencode_config_present"] is True
    assert ready["payload"]["harness_ready"] is True
    assert ready["payload"]["harness_state"] == "ready"
    assert ready["payload"]["browser_state"] == "enabled_unconfigured"
    assert ready["payload"]["browser_available"] is False


@pytest.mark.asyncio
async def test_get_status_reports_available_desktop_browser_when_url_is_configured(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    sandbox_root = tmp_path / "sandbox-root"
    config_path = sandbox_root / "state" / "runtime-config.json"
    monkeypatch.setenv("HB_SANDBOX_ROOT", str(sandbox_root))
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))

    async def _fake_workspace_mcp_is_ready(*, url: str) -> bool:
        assert url == "http://127.0.0.1:4096/mcp"
        return False

    monkeypatch.setattr(executor_module, "_workspace_mcp_is_ready", _fake_workspace_mcp_is_ready)
    monkeypatch.setattr(executor_module, "_ensure_selected_harness_ready", lambda: asyncio.sleep(0, "started"))

    rc_updated = await executor_module._run(
        operation="put-config",
        payload={
            "desktop_browser_enabled": True,
            "desktop_browser_url": "http://127.0.0.1:8787/api/v1/browser",
        },
    )
    updated = json.loads(capsys.readouterr().out)
    assert rc_updated == 0
    assert updated["payload"]["desktop_browser_enabled"] is True
    assert updated["payload"]["desktop_browser_url"] == "http://127.0.0.1:8787/api/v1/browser"

    rc_status = await executor_module._run(operation="get-status", payload={})
    status = json.loads(capsys.readouterr().out)
    assert rc_status == 0
    assert status["payload"]["browser_available"] is True
    assert status["payload"]["browser_state"] == "available"
    assert status["payload"]["browser_url"] == "http://127.0.0.1:8787/api/v1/browser"
