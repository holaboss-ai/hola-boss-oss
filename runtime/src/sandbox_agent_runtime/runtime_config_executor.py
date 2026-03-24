from __future__ import annotations

import argparse
import asyncio

from pydantic import ValidationError

from sandbox_agent_runtime.api_models import RuntimeConfigResponse, RuntimeConfigUpdateRequest, RuntimeStatusResponse
from sandbox_agent_runtime.executor_io import print_envelope, read_json_stdin
from sandbox_agent_runtime.local_execution_service import selected_harness as _selected_harness_impl
from sandbox_agent_runtime.product_config import (
    opencode_config_path,
    runtime_config_status,
    update_runtime_config,
    write_opencode_bootstrap_config_if_available,
)
from sandbox_agent_runtime.runner import (
    _ensure_opencode_sidecar_ready,
    _opencode_base_url,
    _workspace_mcp_is_ready,
)


def _selected_harness() -> str:
    return _selected_harness_impl()


async def _ensure_selected_harness_ready() -> str:
    harness = _selected_harness()
    if harness != "opencode":
        return "not_required"
    return await _ensure_opencode_sidecar_ready()


async def _runtime_status_payload() -> RuntimeStatusResponse:
    config_status = runtime_config_status()
    harness = _selected_harness()
    opencode_config_present = opencode_config_path().exists()
    harness_ready = False
    harness_state = "not_required"
    if harness == "opencode":
        harness_ready = await _workspace_mcp_is_ready(url=f"{_opencode_base_url()}/mcp")
        if harness_ready:
            harness_state = "ready"
        elif opencode_config_present:
            harness_state = "configured"
        elif config_status.get("loaded_from_file"):
            harness_state = "config_loaded"
        else:
            harness_state = "pending_config"
    browser_available = bool(config_status.get("desktop_browser_enabled")) and bool(
        str(config_status.get("desktop_browser_url") or "").strip()
    )
    browser_state = "available" if browser_available else "unavailable"
    if bool(config_status.get("desktop_browser_enabled")) and not browser_available:
        browser_state = "enabled_unconfigured"
    return RuntimeStatusResponse(
        harness=harness,
        config_loaded=bool(config_status.get("loaded_from_file")),
        config_path=str(config_status.get("config_path") or "") or None,
        opencode_config_present=opencode_config_present,
        harness_ready=harness_ready,
        harness_state=harness_state,
        browser_available=browser_available,
        browser_state=browser_state,
        browser_url=str(config_status.get("desktop_browser_url") or "") or None,
    )


async def _run(*, operation: str, payload: dict[str, Any]) -> int:
    try:
        if operation == "get-config":
            result = RuntimeConfigResponse.model_validate(runtime_config_status()).model_dump(mode="json")
        elif operation == "get-status":
            result = (await _runtime_status_payload()).model_dump(mode="json")
        elif operation == "put-config":
            request = RuntimeConfigUpdateRequest.model_validate(payload)
            update_runtime_config(
                auth_token=request.auth_token,
                user_id=request.user_id,
                sandbox_id=request.sandbox_id,
                model_proxy_base_url=request.model_proxy_base_url,
                default_model_value=request.default_model,
                runtime_mode_value=request.runtime_mode,
                default_provider_value=request.default_provider,
                holaboss_enabled_value=request.holaboss_enabled,
                desktop_browser_enabled_value=request.desktop_browser_enabled,
                desktop_browser_url_value=request.desktop_browser_url,
            )
            if _selected_harness() == "opencode":
                write_opencode_bootstrap_config_if_available()
                await _ensure_selected_harness_ready()
            result = RuntimeConfigResponse.model_validate(runtime_config_status()).model_dump(mode="json")
        else:
            print_envelope(status_code=400, detail=f"unsupported runtime config operation: {operation}")
            return 0
    except (ValidationError, ValueError) as exc:
        print_envelope(status_code=400, detail=str(exc))
        return 0
    except Exception as exc:
        print_envelope(status_code=400, detail=str(exc))
        return 0

    print_envelope(status_code=200, payload=result)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--operation", required=True)
    args = parser.parse_args()
    return asyncio.run(_run(operation=args.operation, payload=read_json_stdin()))


if __name__ == "__main__":
    raise SystemExit(main())
