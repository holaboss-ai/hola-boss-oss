# ruff: noqa: S101, S105, S106

from __future__ import annotations

import json
from pathlib import Path

import pytest
from sandbox_agent_runtime import product_config


def test_sandbox_auth_token_prefers_product_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOLABOSS_SANDBOX_AUTH_TOKEN", "product-token")

    assert product_config.sandbox_auth_token() == "product-token"


def test_model_proxy_base_root_url_accepts_default_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HOLABOSS_MODEL_PROXY_BASE_URL", raising=False)
    monkeypatch.setenv("HOLABOSS_MODEL_PROXY_BASE_URL_DEFAULT", "https://runtime.example/api/v1/model-proxy")

    assert (
        product_config.model_proxy_base_root_url(include_default=True) == "https://runtime.example/api/v1/model-proxy"
    )


def test_product_headers_include_optional_sandbox_id(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    config_path = tmp_path / "runtime-config.json"
    config_path.write_text(
        json.dumps({"holaboss": {"sandbox_id": "sandbox-1"}}),
        encoding="utf-8",
    )
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))
    monkeypatch.setenv("HOLABOSS_SANDBOX_AUTH_TOKEN", "token-1")
    monkeypatch.setenv("HOLABOSS_USER_ID", "user-1")

    assert product_config.product_headers() == {
        "X-API-Key": "token-1",
        "X-Holaboss-User-Id": "user-1",
        "X-Holaboss-Sandbox-Id": "sandbox-1",
    }


def test_resolve_product_runtime_config_does_not_require_user_by_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config_path = tmp_path / "runtime-config.json"
    config_path.write_text(
        json.dumps({
            "runtime": {"sandbox_id": "sandbox-1", "default_model": "openai/gpt-5.1"},
            "providers": {
                "holaboss_model_proxy": {
                    "kind": "openai_compatible",
                    "base_url": "https://runtime.example/api/v1/model-proxy",
                    "api_key": "token-1",
                }
            },
            "integrations": {"holaboss": {"enabled": True, "sandbox_id": "sandbox-1", "auth_token": "token-1"}},
        }),
        encoding="utf-8",
    )
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))
    monkeypatch.delenv("HOLABOSS_USER_ID", raising=False)
    monkeypatch.delenv("HOLABOSS_SANDBOX_AUTH_TOKEN", raising=False)

    config = product_config.resolve_product_runtime_config()

    assert config.user_id == ""
    assert config.sandbox_id == "sandbox-1"
    assert config.auth_token == "token-1"
    assert config.headers == {"X-API-Key": "token-1", "X-Holaboss-Sandbox-Id": "sandbox-1"}


def test_default_model_prefers_holaboss_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENCODE_BOOT_MODEL", "openai/gpt-4.1")
    monkeypatch.setenv("HOLABOSS_DEFAULT_MODEL", "openai/gpt-5.1")

    assert product_config.default_model() == "openai/gpt-5.1"


def test_resolve_product_runtime_config_collects_structured_values(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(tmp_path / "runtime-config.json"))
    updated = product_config.update_runtime_config(
        auth_token="token-1",
        user_id="user-1",
        sandbox_id="sandbox-1",
        model_proxy_base_url="https://runtime.example/api/v1/model-proxy",
        default_model_value="openai/gpt-5.1",
    )

    config = product_config.resolve_product_runtime_config()

    assert config.auth_token == "token-1"
    assert config.user_id == "user-1"
    assert config.sandbox_id == "sandbox-1"
    assert config.model_proxy_base_url == "https://runtime.example/api/v1/model-proxy"
    assert config.default_model == "openai/gpt-5.1"
    assert config.default_provider == "holaboss_model_proxy"
    assert config.holaboss_enabled is True
    assert config.headers == {
        "X-API-Key": "token-1",
        "X-Holaboss-User-Id": "user-1",
        "X-Holaboss-Sandbox-Id": "sandbox-1",
    }
    assert updated.loaded_from_file is True


def test_resolve_product_runtime_config_reads_split_runtime_config_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config_path = tmp_path / "runtime-config.json"
    config_path.write_text(
        json.dumps({
            "runtime": {
                "sandbox_id": "file-sandbox",
                "mode": "oss",
                "default_provider": "holaboss_model_proxy",
                "default_model": "openai/gpt-5.1",
            },
            "providers": {
                "holaboss_model_proxy": {
                    "kind": "openai_compatible",
                    "base_url": "https://runtime.example/api/v1/model-proxy",
                    "api_key": "file-token",
                }
            },
            "integrations": {
                "holaboss": {
                    "enabled": True,
                    "sandbox_id": "file-sandbox",
                    "user_id": "file-user",
                    "auth_token": "file-token",
                }
            },
        }),
        encoding="utf-8",
    )
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))
    monkeypatch.delenv("HOLABOSS_SANDBOX_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("HOLABOSS_USER_ID", raising=False)
    monkeypatch.delenv("HOLABOSS_MODEL_PROXY_BASE_URL", raising=False)
    monkeypatch.delenv("HOLABOSS_DEFAULT_MODEL", raising=False)

    config = product_config.resolve_product_runtime_config()

    assert config.auth_token == "file-token"
    assert config.user_id == "file-user"
    assert config.sandbox_id == "file-sandbox"
    assert config.model_proxy_base_url == "https://runtime.example/api/v1/model-proxy"
    assert config.default_model == "openai/gpt-5.1"
    assert config.runtime_mode == "oss"
    assert config.default_provider == "holaboss_model_proxy"
    assert config.holaboss_enabled is True
    assert config.loaded_from_file is True
    assert config.config_path == str(config_path)


def test_resolve_product_runtime_config_reads_optional_desktop_browser_capability(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config_path = tmp_path / "runtime-config.json"
    config_path.write_text(
        json.dumps({
            "capabilities": {
                "desktop_browser": {
                    "enabled": True,
                    "url": "http://127.0.0.1:8787/api/v1/browser",
                    "auth_token": "desktop-token",
                }
            }
        }),
        encoding="utf-8",
    )
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))

    config = product_config.resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    )

    assert config.desktop_browser_enabled is True
    assert config.desktop_browser_url == "http://127.0.0.1:8787/api/v1/browser"
    assert config.desktop_browser_auth_token == "desktop-token"


def test_resolve_product_runtime_config_reads_runtime_config_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config_path = tmp_path / "runtime-config.json"
    config_path.write_text(
        json.dumps({
            "holaboss": {
                "auth_token": "file-token",
                "user_id": "file-user",
                "sandbox_id": "file-sandbox",
                "model_proxy_base_url": "https://runtime.example/api/v1/model-proxy",
                "default_model": "openai/gpt-5.1",
            }
        }),
        encoding="utf-8",
    )
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))
    monkeypatch.delenv("HOLABOSS_SANDBOX_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("HOLABOSS_USER_ID", raising=False)
    monkeypatch.delenv("HOLABOSS_MODEL_PROXY_BASE_URL", raising=False)
    monkeypatch.delenv("HOLABOSS_DEFAULT_MODEL", raising=False)

    config = product_config.resolve_product_runtime_config()

    assert config.auth_token == "file-token"
    assert config.user_id == "file-user"
    assert config.sandbox_id == "file-sandbox"
    assert config.model_proxy_base_url == "https://runtime.example/api/v1/model-proxy"
    assert config.default_model == "openai/gpt-5.1"
    assert config.loaded_from_file is True
    assert config.config_path == str(config_path)


def test_update_runtime_config_persists_optional_desktop_browser_capability(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config_path = tmp_path / "runtime-config.json"
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))

    updated = product_config.update_runtime_config(
        desktop_browser_enabled_value=True,
        desktop_browser_url_value="http://127.0.0.1:8787/api/v1/browser",
        desktop_browser_auth_token_value="desktop-token",
    )

    assert updated.desktop_browser_enabled is True
    assert updated.desktop_browser_url == "http://127.0.0.1:8787/api/v1/browser"
    assert updated.desktop_browser_auth_token == "desktop-token"
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    assert payload["capabilities"]["desktop_browser"]["enabled"] is True
    assert payload["capabilities"]["desktop_browser"]["url"] == "http://127.0.0.1:8787/api/v1/browser"
    assert payload["capabilities"]["desktop_browser"]["auth_token"] == "desktop-token"


def test_runtime_config_file_overrides_legacy_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    config_path = tmp_path / "runtime-config.json"
    config_path.write_text(
        json.dumps({
            "auth_token": "file-token",
            "user_id": "file-user",
            "sandbox_id": "file-sandbox",
            "model_proxy_base_url": "https://runtime.example/api/v1/model-proxy",
            "default_model": "openai/gpt-4.1",
        }),
        encoding="utf-8",
    )
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))
    monkeypatch.setenv("HOLABOSS_SANDBOX_AUTH_TOKEN", "env-token")
    monkeypatch.setenv("HOLABOSS_USER_ID", "env-user")
    monkeypatch.setenv("HOLABOSS_MODEL_PROXY_BASE_URL", "https://env.example/api/v1/model-proxy")
    monkeypatch.setenv("HOLABOSS_DEFAULT_MODEL", "openai/gpt-5.1")

    config = product_config.resolve_product_runtime_config()

    assert config.auth_token == "file-token"
    assert config.user_id == "file-user"
    assert config.sandbox_id == "file-sandbox"
    assert config.model_proxy_base_url == "https://runtime.example/api/v1/model-proxy"
    assert config.default_model == "openai/gpt-4.1"


def test_write_opencode_bootstrap_config_if_available_returns_none_without_runtime_config(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(tmp_path / "runtime-config.json"))
    monkeypatch.delenv("HOLABOSS_SANDBOX_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("HOLABOSS_USER_ID", raising=False)
    monkeypatch.delenv("HOLABOSS_MODEL_PROXY_BASE_URL", raising=False)

    assert product_config.write_opencode_bootstrap_config_if_available() is None


def test_write_opencode_bootstrap_config_if_available_does_not_require_user_id(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    sandbox_root = tmp_path / "sandbox-root"
    monkeypatch.setenv("HB_SANDBOX_ROOT", str(sandbox_root))
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(sandbox_root / "state" / "runtime-config.json"))
    product_config.update_runtime_config(
        auth_token="token-1",
        user_id="",
        sandbox_id="sandbox-1",
        model_proxy_base_url="https://runtime.example/api/v1/model-proxy",
        default_model_value="openai/gpt-5.1",
    )

    config_path = product_config.write_opencode_bootstrap_config_if_available()

    assert config_path == sandbox_root / "workspace" / "opencode.json"
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    assert payload["provider"]["openai"]["options"]["headers"]["X-Holaboss-Sandbox-Id"] == "sandbox-1"
    assert "X-Holaboss-User-Id" not in payload["provider"]["openai"]["options"]["headers"]


def test_write_opencode_bootstrap_config_persists_provider_config(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    sandbox_root = tmp_path / "sandbox-root"
    monkeypatch.setenv("HB_SANDBOX_ROOT", str(sandbox_root))
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(sandbox_root / "state" / "runtime-config.json"))
    product_config.update_runtime_config(
        auth_token="token-1",
        user_id="user-1",
        sandbox_id="sandbox-1",
        model_proxy_base_url="https://runtime.example/api/v1/model-proxy",
        default_model_value="openai/gpt-5.1",
    )

    config_path = product_config.write_opencode_bootstrap_config()
    payload = json.loads(config_path.read_text(encoding="utf-8"))

    assert config_path == sandbox_root / "workspace" / "opencode.json"
    assert payload["model"] == "openai/gpt-5.1"
    assert payload["provider"]["openai"]["options"]["apiKey"] == "token-1"
    assert payload["provider"]["openai"]["options"]["headers"]["X-Holaboss-Sandbox-Id"] == "sandbox-1"
    assert "X-Holaboss-User-Id" not in payload["provider"]["openai"]["options"]["headers"]


def test_update_runtime_config_writes_split_and_legacy_compat_fields(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config_path = tmp_path / "runtime-config.json"
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))

    product_config.update_runtime_config(
        auth_token="token-1",
        user_id="user-1",
        sandbox_id="sandbox-1",
        model_proxy_base_url="https://runtime.example/api/v1/model-proxy",
        default_model_value="openai/gpt-5.1",
    )

    payload = json.loads(config_path.read_text(encoding="utf-8"))

    assert payload["runtime"]["sandbox_id"] == "sandbox-1"
    assert payload["runtime"]["default_model"] == "openai/gpt-5.1"
    assert payload["providers"]["holaboss_model_proxy"]["api_key"] == "token-1"
    assert payload["providers"]["holaboss_model_proxy"]["base_url"] == "https://runtime.example/api/v1/model-proxy"
    assert payload["integrations"]["holaboss"]["enabled"] is True
    assert payload["integrations"]["holaboss"]["user_id"] == "user-1"
    assert payload["holaboss"]["auth_token"] == "token-1"
    assert payload["holaboss"]["model_proxy_api_key"] == "token-1"


def test_update_runtime_config_supports_oss_direct_provider_without_holaboss(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config_path = tmp_path / "runtime-config.json"
    monkeypatch.setenv("HOLABOSS_RUNTIME_CONFIG_PATH", str(config_path))

    updated = product_config.update_runtime_config(
        sandbox_id="sandbox-1",
        default_model_value="gpt-5.1",
        runtime_mode_value="oss",
        default_provider_value="openai",
        holaboss_enabled_value=False,
    )

    payload = json.loads(config_path.read_text(encoding="utf-8"))

    assert updated.auth_token == ""
    assert updated.user_id == ""
    assert updated.sandbox_id == "sandbox-1"
    assert updated.default_model == "gpt-5.1"
    assert updated.runtime_mode == "oss"
    assert updated.default_provider == "openai"
    assert updated.holaboss_enabled is False
    assert payload["runtime"]["sandbox_id"] == "sandbox-1"
    assert payload["runtime"]["default_model"] == "gpt-5.1"
    assert payload["runtime"]["mode"] == "oss"
    assert payload["runtime"]["default_provider"] == "openai"
    assert payload["integrations"]["holaboss"]["enabled"] is False
