from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

_HOLABOSS_MODEL_PROXY_BASE_URL_ENV = "HOLABOSS_MODEL_PROXY_BASE_URL"
_HOLABOSS_MODEL_PROXY_BASE_URL_DEFAULT_ENV = "HOLABOSS_MODEL_PROXY_BASE_URL_DEFAULT"
_HOLABOSS_SANDBOX_AUTH_TOKEN_ENV = "HOLABOSS_SANDBOX_AUTH_TOKEN"  # noqa: S105
_HOLABOSS_USER_ID_ENV = "HOLABOSS_USER_ID"
_HOLABOSS_DEFAULT_MODEL_ENV = "HOLABOSS_DEFAULT_MODEL"
_OPENCODE_BOOT_MODEL_ENV = "OPENCODE_BOOT_MODEL"
_HOLABOSS_RUNTIME_CONFIG_PATH_ENV = "HOLABOSS_RUNTIME_CONFIG_PATH"
_DEFAULT_MODEL = "openai/gpt-5.1"
_DEFAULT_RUNTIME_MODE = "oss"
_HOLABOSS_PROXY_PROVIDER = "holaboss_model_proxy"


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


def _sandbox_root_path() -> Path:
    sandbox_root = first_env_value("HB_SANDBOX_ROOT") or "/holaboss"
    return Path(sandbox_root)


def _normalize_string(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


def _normalize_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        token = value.strip().lower()
        if token in {"1", "true", "yes", "on"}:
            return True
        if token in {"0", "false", "no", "off"}:
            return False
    return None


def _as_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _load_runtime_config_document() -> tuple[dict[str, Any], Path]:
    path = runtime_config_path()
    if not path.exists():
        return {}, path

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid runtime config JSON at {path}: {exc}") from exc
    except OSError as exc:
        raise RuntimeError(f"failed to read runtime config at {path}: {exc}") from exc

    if not isinstance(payload, dict):
        raise TypeError(f"runtime config at {path} must be a JSON object")
    return payload, path


def _write_runtime_config_document(document: dict[str, Any], *, path: Path | None = None) -> Path:
    target_path = path or runtime_config_path()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(json.dumps(document, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    return target_path


def _load_runtime_config_payload() -> tuple[dict[str, str], Path]:
    document, path = _load_runtime_config_document()
    runtime_payload = _as_object(document.get("runtime"))
    providers_payload = _as_object(document.get("providers"))
    integrations_payload = _as_object(document.get("integrations"))
    capabilities_payload = _as_object(document.get("capabilities"))
    holaboss_integration = _as_object(integrations_payload.get("holaboss"))
    desktop_browser_capability = _as_object(capabilities_payload.get("desktop_browser"))
    holaboss_provider = _as_object(providers_payload.get(_HOLABOSS_PROXY_PROVIDER))

    legacy_payload = _as_object(document.get("holaboss"))
    if not legacy_payload:
        legacy_payload = document

    auth_token = (
        _normalize_string(holaboss_integration.get("auth_token"))
        or _normalize_string(holaboss_provider.get("api_key"))
        or _normalize_string(legacy_payload.get("auth_token"))
        or _normalize_string(legacy_payload.get("model_proxy_api_key"))
    )
    user_id = _normalize_string(holaboss_integration.get("user_id")) or _normalize_string(legacy_payload.get("user_id"))
    sandbox_id = (
        _normalize_string(runtime_payload.get("sandbox_id"))
        or _normalize_string(holaboss_integration.get("sandbox_id"))
        or _normalize_string(legacy_payload.get("sandbox_id"))
    )
    model_proxy_base_url = _normalize_string(holaboss_provider.get("base_url")) or _normalize_string(
        legacy_payload.get("model_proxy_base_url")
    )
    default_model_value = _normalize_string(runtime_payload.get("default_model")) or _normalize_string(
        legacy_payload.get("default_model")
    )
    default_provider = _normalize_string(runtime_payload.get("default_provider"))
    explicit_holaboss_enabled = _normalize_bool(holaboss_integration.get("enabled"))
    holaboss_enabled = (
        explicit_holaboss_enabled
        if explicit_holaboss_enabled is not None
        else bool(auth_token or user_id or model_proxy_base_url or default_provider == _HOLABOSS_PROXY_PROVIDER)
    )
    explicit_desktop_browser_enabled = _normalize_bool(desktop_browser_capability.get("enabled"))
    desktop_browser_enabled = explicit_desktop_browser_enabled if explicit_desktop_browser_enabled is not None else False
    desktop_browser_url = _normalize_string(desktop_browser_capability.get("url")) or _normalize_string(
        desktop_browser_capability.get("mcp_url")
    )
    desktop_browser_auth_token = _normalize_string(desktop_browser_capability.get("auth_token"))
    runtime_mode = _normalize_string(runtime_payload.get("mode")) or (
        "product" if holaboss_enabled else _DEFAULT_RUNTIME_MODE
    )

    normalized: dict[str, str] = {}
    if auth_token:
        normalized["auth_token"] = auth_token
    if user_id:
        normalized["user_id"] = user_id
    if sandbox_id:
        normalized["sandbox_id"] = sandbox_id
    if model_proxy_base_url:
        normalized["model_proxy_base_url"] = model_proxy_base_url
    if default_model_value:
        normalized["default_model"] = default_model_value
    if runtime_mode:
        normalized["runtime_mode"] = runtime_mode
    if default_provider:
        normalized["default_provider"] = default_provider
    normalized["holaboss_enabled"] = "true" if holaboss_enabled else "false"
    normalized["desktop_browser_enabled"] = "true" if desktop_browser_enabled else "false"
    if desktop_browser_url:
        normalized["desktop_browser_url"] = desktop_browser_url
    if desktop_browser_auth_token:
        normalized["desktop_browser_auth_token"] = desktop_browser_auth_token
    return normalized, path


def opencode_config_path() -> Path:
    return _sandbox_root_path() / "workspace" / "opencode.json"


def sandbox_auth_token() -> str:
    payload, _ = _load_runtime_config_payload()
    return payload.get("auth_token", "") or first_env_value(_HOLABOSS_SANDBOX_AUTH_TOKEN_ENV)


def holaboss_user_id() -> str:
    payload, _ = _load_runtime_config_payload()
    return payload.get("user_id", "") or first_env_value(_HOLABOSS_USER_ID_ENV)


def sandbox_instance_id() -> str:
    payload, _ = _load_runtime_config_payload()
    return payload.get("sandbox_id", "")


def model_proxy_base_root_url(*, include_default: bool = False, required: bool = True) -> str:
    payload, _ = _load_runtime_config_payload()

    env_names = [_HOLABOSS_MODEL_PROXY_BASE_URL_ENV]
    if include_default:
        env_names.append(_HOLABOSS_MODEL_PROXY_BASE_URL_DEFAULT_ENV)

    base_root = (payload.get("model_proxy_base_url", "") or first_env_value(*env_names)).rstrip("/")
    if not base_root:
        if required:
            detail = " or ".join([*env_names, "runtime-config.json:model_proxy_base_url"])
            raise RuntimeError(f"{detail} is required")
        return ""

    parsed = urlparse(base_root)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError(f"{_HOLABOSS_MODEL_PROXY_BASE_URL_ENV} must be an absolute http(s) URL")
    if parsed.query or parsed.fragment:
        raise RuntimeError(f"{_HOLABOSS_MODEL_PROXY_BASE_URL_ENV} must not include query or fragment")
    return base_root


def default_model() -> str:
    payload, _ = _load_runtime_config_payload()
    return (
        payload.get("default_model", "")
        or first_env_value(_HOLABOSS_DEFAULT_MODEL_ENV, _OPENCODE_BOOT_MODEL_ENV)
        or _DEFAULT_MODEL
    )


def runtime_mode() -> str:
    payload, _ = _load_runtime_config_payload()
    return payload.get("runtime_mode", "") or _DEFAULT_RUNTIME_MODE


def default_provider() -> str:
    payload, _ = _load_runtime_config_payload()
    return payload.get("default_provider", "")


def resolve_product_runtime_config(
    *,
    require_auth: bool = True,
    require_user: bool = False,
    require_base_url: bool = True,
    include_default_base_url: bool = False,
) -> ProductRuntimeConfig:
    payload, path = _load_runtime_config_payload()
    loaded_from_file = path.exists()
    auth_token = sandbox_auth_token()
    if require_auth and not auth_token:
        raise RuntimeError(f"{_HOLABOSS_SANDBOX_AUTH_TOKEN_ENV} or runtime-config.json:auth_token is required")

    user_id = holaboss_user_id()
    if require_user and not user_id:
        raise RuntimeError(f"{_HOLABOSS_USER_ID_ENV} or runtime-config.json:user_id is required")

    base_url = model_proxy_base_root_url(include_default=include_default_base_url, required=require_base_url)

    return ProductRuntimeConfig(
        auth_token=auth_token,
        user_id=user_id,
        sandbox_id=sandbox_instance_id(),
        model_proxy_base_url=base_url,
        default_model=default_model(),
        runtime_mode=runtime_mode(),
        default_provider=default_provider(),
        holaboss_enabled=(payload.get("holaboss_enabled", "false") == "true"),
        desktop_browser_enabled=(payload.get("desktop_browser_enabled", "false") == "true"),
        desktop_browser_url=payload.get("desktop_browser_url", ""),
        desktop_browser_auth_token=payload.get("desktop_browser_auth_token", ""),
        config_path=str(path),
        loaded_from_file=loaded_from_file,
    )


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
    document, path = _load_runtime_config_document()
    runtime_payload = _as_object(document.setdefault("runtime", {}))
    providers_payload = _as_object(document.setdefault("providers", {}))
    integrations_payload = _as_object(document.setdefault("integrations", {}))
    capabilities_payload = _as_object(document.setdefault("capabilities", {}))
    holaboss_integration = _as_object(integrations_payload.setdefault("holaboss", {}))
    desktop_browser_capability = _as_object(capabilities_payload.setdefault("desktop_browser", {}))
    holaboss_provider = _as_object(providers_payload.setdefault(_HOLABOSS_PROXY_PROVIDER, {}))
    legacy_payload = _as_object(document.setdefault("holaboss", {}))

    def assign_or_remove(target: dict[str, Any], key: str, value: str | None) -> None:
        if value is None:
            return
        stripped = value.strip()
        if stripped:
            target[key] = stripped
        else:
            target.pop(key, None)

    assign_or_remove(holaboss_integration, "auth_token", auth_token)
    assign_or_remove(holaboss_integration, "user_id", user_id)
    assign_or_remove(holaboss_integration, "sandbox_id", sandbox_id)
    assign_or_remove(holaboss_provider, "api_key", auth_token)
    assign_or_remove(holaboss_provider, "base_url", model_proxy_base_url)
    assign_or_remove(runtime_payload, "sandbox_id", sandbox_id)
    assign_or_remove(runtime_payload, "default_model", default_model_value)
    assign_or_remove(runtime_payload, "mode", runtime_mode_value)
    assign_or_remove(runtime_payload, "default_provider", default_provider_value)
    assign_or_remove(legacy_payload, "auth_token", auth_token)
    assign_or_remove(legacy_payload, "model_proxy_api_key", auth_token)
    assign_or_remove(legacy_payload, "user_id", user_id)
    assign_or_remove(legacy_payload, "sandbox_id", sandbox_id)
    assign_or_remove(legacy_payload, "model_proxy_base_url", model_proxy_base_url)
    assign_or_remove(legacy_payload, "default_model", default_model_value)
    assign_or_remove(desktop_browser_capability, "url", desktop_browser_url_value)
    assign_or_remove(desktop_browser_capability, "auth_token", desktop_browser_auth_token_value)
    if desktop_browser_url_value is not None:
        desktop_browser_capability.pop("mcp_url", None)

    if holaboss_provider and "kind" not in holaboss_provider:
        holaboss_provider["kind"] = "openai_compatible"

    runtime_payload.setdefault("mode", _DEFAULT_RUNTIME_MODE)
    if holaboss_enabled_value is not None:
        holaboss_integration["enabled"] = bool(holaboss_enabled_value)
    elif holaboss_provider.get("api_key") or holaboss_provider.get("base_url"):
        runtime_payload.setdefault("default_provider", _HOLABOSS_PROXY_PROVIDER)
        holaboss_integration["enabled"] = True
    elif (
        not holaboss_integration.get("auth_token")
        and not holaboss_integration.get("user_id")
        and not holaboss_integration.get("sandbox_id")
    ):
        holaboss_integration["enabled"] = False

    if desktop_browser_enabled_value is not None:
        desktop_browser_capability["enabled"] = bool(desktop_browser_enabled_value)
    elif not desktop_browser_capability.get("url") and not desktop_browser_capability.get("mcp_url"):
        desktop_browser_capability["enabled"] = False

    _write_runtime_config_document(document, path=path)
    return resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    )


def runtime_config_status() -> dict[str, object]:
    config = resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    )
    return {
        "config_path": config.config_path,
        "loaded_from_file": config.loaded_from_file,
        "auth_token_present": bool(config.auth_token),
        "user_id": config.user_id or None,
        "sandbox_id": config.sandbox_id or None,
        "model_proxy_base_url": config.model_proxy_base_url or None,
        "default_model": config.default_model or None,
        "runtime_mode": config.runtime_mode or None,
        "default_provider": config.default_provider or None,
        "holaboss_enabled": config.holaboss_enabled,
        "desktop_browser_enabled": config.desktop_browser_enabled,
        "desktop_browser_url": config.desktop_browser_url or None,
    }


def _opencode_bootstrap_payload(config: ProductRuntimeConfig) -> dict[str, object]:
    return {
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            "openai": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "Holaboss Model Proxy (OpenAI)",
                "options": {
                    "apiKey": config.auth_token,
                    "baseURL": f"{config.model_proxy_base_url}/openai/v1",
                    "headers": config.model_proxy_headers,
                },
            },
            "anthropic": {
                "npm": "@ai-sdk/anthropic",
                "name": "Holaboss Model Proxy (Anthropic)",
                "options": {
                    "apiKey": config.auth_token,
                    "baseURL": f"{config.model_proxy_base_url}/anthropic/v1",
                    "headers": config.model_proxy_headers,
                },
            },
        },
        "model": config.default_model,
    }


def write_opencode_bootstrap_config() -> Path:
    config = resolve_product_runtime_config(require_user=False, include_default_base_url=True)
    path = opencode_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _opencode_bootstrap_payload(config)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    return path


def write_opencode_bootstrap_config_if_available() -> Path | None:
    config = resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
        include_default_base_url=True,
    )
    if not config.auth_token or not config.model_proxy_base_url:
        return None

    path = opencode_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _opencode_bootstrap_payload(config)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    return path


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
    "opencode_config_path",
    "product_headers",
    "resolve_product_runtime_config",
    "runtime_config_path",
    "runtime_config_status",
    "runtime_mode",
    "sandbox_auth_token",
    "sandbox_instance_id",
    "update_runtime_config",
    "write_opencode_bootstrap_config",
    "write_opencode_bootstrap_config_if_available",
]
