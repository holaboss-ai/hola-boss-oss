from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from sandbox_agent_runtime.ts_bridge import run_ts_json_cli, runtime_root_dir

_HOLABOSS_SANDBOX_AUTH_TOKEN_ENV = "HOLABOSS_SANDBOX_AUTH_TOKEN"  # noqa: S105
_HOLABOSS_USER_ID_ENV = "HOLABOSS_USER_ID"
_HOLABOSS_RUNTIME_CONFIG_PATH_ENV = "HOLABOSS_RUNTIME_CONFIG_PATH"
_DEFAULT_MODEL = "openai/gpt-5.1"
_DEFAULT_RUNTIME_MODE = "oss"


@dataclass(frozen=True)
class ProductRuntimeConfig:
    auth_token: str = ""
    user_id: str = ""
    sandbox_id: str = ""
    model_proxy_base_url: str = ""
    default_model: str = _DEFAULT_MODEL
    runtime_mode: str = _DEFAULT_RUNTIME_MODE
    default_provider: str = ""
    holaboss_enabled: bool = False
    desktop_browser_enabled: bool = False
    desktop_browser_url: str = ""
    desktop_browser_auth_token: str = ""
    config_path: str | None = None
    loaded_from_file: bool = False

    @property
    def headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self.auth_token:
            headers["X-API-Key"] = self.auth_token
        if self.user_id:
            headers["X-Holaboss-User-Id"] = self.user_id
        if self.sandbox_id:
            headers["X-Holaboss-Sandbox-Id"] = self.sandbox_id
        return headers

    @property
    def model_proxy_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self.auth_token:
            headers["X-API-Key"] = self.auth_token
        if self.sandbox_id:
            headers["X-Holaboss-Sandbox-Id"] = self.sandbox_id
        return headers


def first_env_value(*names: str) -> str:
    for name in names:
        value = (os.getenv(name) or "").strip()
        if value:
            return value
    return ""


def runtime_config_path() -> Path:
    explicit = first_env_value(_HOLABOSS_RUNTIME_CONFIG_PATH_ENV)
    if explicit:
        return Path(explicit).expanduser()
    sandbox_root = first_env_value("HB_SANDBOX_ROOT") or "/holaboss"
    return Path(sandbox_root) / "state" / "runtime-config.json"


def _runtime_root_dir() -> Path:
    return runtime_root_dir(__file__)


def _ts_runtime_config_call(*, operation: str, payload: Mapping[str, Any] | None = None) -> dict[str, Any]:
    parsed = run_ts_json_cli(
        module_file=__file__,
        package_name="api-server",
        dist_entry="dist/runtime-config-cli.mjs",
        source_entry="src/runtime-config-cli.ts",
        operation=operation,
        payload=payload,
        missing_entry_message=(
            "TypeScript runtime-config entrypoint not found at "
            f"{_runtime_root_dir() / 'api-server' / 'dist' / 'runtime-config-cli.mjs'} or "
            f"{_runtime_root_dir() / 'api-server' / 'src' / 'runtime-config-cli.ts'}"
        ),
        empty_output_message=f"TypeScript runtime-config operation={operation} returned no output",
    )
    if not isinstance(parsed, dict):
        raise RuntimeError("TypeScript runtime-config response must be a JSON object")
    return parsed


def _as_string(value: Any, *, default: str = "") -> str:
    if isinstance(value, str):
        return value.strip()
    return default


def _as_bool(value: Any, *, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    return default


def _product_runtime_config_from_payload(payload: Mapping[str, Any]) -> ProductRuntimeConfig:
    return ProductRuntimeConfig(
        auth_token=_as_string(payload.get("auth_token")),
        user_id=_as_string(payload.get("user_id")),
        sandbox_id=_as_string(payload.get("sandbox_id")),
        model_proxy_base_url=_as_string(payload.get("model_proxy_base_url")),
        default_model=_as_string(payload.get("default_model"), default=_DEFAULT_MODEL) or _DEFAULT_MODEL,
        runtime_mode=_as_string(payload.get("runtime_mode"), default=_DEFAULT_RUNTIME_MODE) or _DEFAULT_RUNTIME_MODE,
        default_provider=_as_string(payload.get("default_provider")),
        holaboss_enabled=_as_bool(payload.get("holaboss_enabled")),
        desktop_browser_enabled=_as_bool(payload.get("desktop_browser_enabled")),
        desktop_browser_url=_as_string(payload.get("desktop_browser_url")),
        desktop_browser_auth_token=_as_string(payload.get("desktop_browser_auth_token")),
        config_path=_as_string(payload.get("config_path")) or None,
        loaded_from_file=_as_bool(payload.get("loaded_from_file")),
    )


def sandbox_auth_token() -> str:
    return resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    ).auth_token


def holaboss_user_id() -> str:
    return resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    ).user_id


def sandbox_instance_id() -> str:
    return resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    ).sandbox_id


def model_proxy_base_root_url(*, include_default: bool = False, required: bool = True) -> str:
    return resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=required,
        include_default_base_url=include_default,
    ).model_proxy_base_url


def default_model() -> str:
    return resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    ).default_model


def runtime_mode() -> str:
    return resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    ).runtime_mode


def default_provider() -> str:
    return resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    ).default_provider


def resolve_product_runtime_config(
    *,
    require_auth: bool = True,
    require_user: bool = False,
    require_base_url: bool = True,
    include_default_base_url: bool = False,
) -> ProductRuntimeConfig:
    payload = _ts_runtime_config_call(
        operation="resolve",
        payload={
            "require_auth": require_auth,
            "require_user": require_user,
            "require_base_url": require_base_url,
            "include_default_base_url": include_default_base_url,
        },
    )
    return _product_runtime_config_from_payload(payload)


def update_runtime_config(
    *,
    auth_token: str | None = None,
    user_id: str | None = None,
    sandbox_id: str | None = None,
    model_proxy_base_url: str | None = None,
    default_model_value: str | None = None,
    runtime_mode_value: str | None = None,
    default_provider_value: str | None = None,
    holaboss_enabled_value: bool | None = None,
    desktop_browser_enabled_value: bool | None = None,
    desktop_browser_url_value: str | None = None,
    desktop_browser_auth_token_value: str | None = None,
) -> ProductRuntimeConfig:
    payload = _ts_runtime_config_call(
        operation="update",
        payload={
            "auth_token": auth_token,
            "user_id": user_id,
            "sandbox_id": sandbox_id,
            "model_proxy_base_url": model_proxy_base_url,
            "default_model": default_model_value,
            "runtime_mode": runtime_mode_value,
            "default_provider": default_provider_value,
            "holaboss_enabled": holaboss_enabled_value,
            "desktop_browser_enabled": desktop_browser_enabled_value,
            "desktop_browser_url": desktop_browser_url_value,
            "desktop_browser_auth_token": desktop_browser_auth_token_value,
        },
    )
    return _product_runtime_config_from_payload(payload)


def runtime_config_status() -> dict[str, object]:
    payload = _ts_runtime_config_call(operation="status")
    return dict(payload)


def product_headers(*, require_auth: bool = True, require_user: bool = False) -> dict[str, str]:
    return resolve_product_runtime_config(
        require_auth=require_auth,
        require_user=require_user,
        require_base_url=False,
    ).headers


__all__ = [
    "ProductRuntimeConfig",
    "default_model",
    "first_env_value",
    "holaboss_user_id",
    "model_proxy_base_root_url",
    "product_headers",
    "resolve_product_runtime_config",
    "runtime_config_path",
    "runtime_config_status",
    "runtime_mode",
    "sandbox_auth_token",
    "sandbox_instance_id",
    "update_runtime_config",
]
