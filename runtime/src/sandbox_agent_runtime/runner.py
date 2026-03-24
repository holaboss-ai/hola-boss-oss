from __future__ import annotations

import argparse
import asyncio
import base64
import fcntl
import hashlib
import importlib.util
import json
import logging
import os
import re
import shutil
import signal
import socket
import sys
import time
import types
from collections.abc import Mapping
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import yaml
from pydantic import BaseModel, Field

from sandbox_agent_runtime.product_config import resolve_product_runtime_config
from sandbox_agent_runtime.runtime_config_adapter import (
    CompiledWorkspaceRuntimePlan,
    WorkspaceGeneralSingleConfig,
    WorkspaceGeneralTeamConfig,
    WorkspaceRuntimeConfigError,
    WorkspaceRuntimePlanBuilder,
)
from sandbox_agent_runtime.workspace_scope import WORKSPACE_ROOT, sanitize_workspace_id

logger = logging.getLogger(__name__)

_EVENT_RUN_CLAIMED = "run_claimed"
_EVENT_RUN_STARTED = "run_started"
_EVENT_THINKING_DELTA = "thinking_delta"
_EVENT_OUTPUT_DELTA = "output_delta"
_EVENT_TOOL_CALL = "tool_call"
_EVENT_RUN_COMPLETED = "run_completed"
_EVENT_RUN_FAILED = "run_failed"
_TERMINAL_EVENT_TYPES = {_EVENT_RUN_COMPLETED, _EVENT_RUN_FAILED}
_PUSH_CONTEXT_KEY = "_sandbox_runtime_push_v1"
_PUSH_PROTOCOL_VERSION = "1.0"
_RUNTIME_EXEC_CONTEXT_KEY = "_sandbox_runtime_exec_v1"
_RUNTIME_EXEC_HARNESS_KEY = "harness"
_RUNTIME_EXEC_HARNESS_SESSION_ID_KEY = "harness_session_id"
_RUNTIME_EXEC_RUN_ID_KEY = "run_id"
_RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY = "model_proxy_api_key"
_RUNTIME_EXEC_SANDBOX_ID_KEY = "sandbox_id"
_MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE = "openai_compatible"
_MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE = "anthropic_native"
_DEFAULT_MODEL_PROXY_PROVIDER = _MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE
_DIRECT_OPENAI_FALLBACK_FLAG = "SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK"
_OPENCODE_PERSISTED_PROXY_HEADER_ALLOWLIST = {
    "x-api-key",
    "x-holaboss-user-id",
    "x-holaboss-sandbox-id",
}
_DEFAULT_OPENCODE_HOST = "127.0.0.1"
_DEFAULT_OPENCODE_PORT = 4096
_DEFAULT_OPENCODE_BASE_URL = f"http://{_DEFAULT_OPENCODE_HOST}:{_DEFAULT_OPENCODE_PORT}"
_DEFAULT_OPENCODE_PROVIDER_ID = "openai"
_DEFAULT_OPENCODE_SESSION_MODE = "code"
_DEFAULT_OPENCODE_STRUCTURED_RETRY_COUNT = 2
_SUPPORTED_HARNESSES = {"opencode"}
_SANDBOX_RUNTIME_API_URL_ENV = "SANDBOX_RUNTIME_API_URL"
_DEFAULT_SANDBOX_RUNTIME_API_URL = "http://sandbox-runtime:3060"
_PYTHON_OPENCODE_APP_LIFECYCLE_FALLBACK_ENV = "SANDBOX_AGENT_ENABLE_PYTHON_APP_LIFECYCLE_FALLBACK"
_OPENCODE_DEFAULT_TOOLS = ("read", "edit", "bash", "grep", "glob", "list", "question", "todowrite", "todoread", "skill")
_WORKSPACE_MCP_SERVER_ID = "workspace"
_WORKSPACE_MCP_READY_TIMEOUT_S = 10.0
_WORKSPACE_MCP_READY_POLL_S = 0.2
_WORKSPACE_MCP_LOCK_TIMEOUT_S = 15.0
_OPENCODE_LOCK_TIMEOUT_S = 15.0
_SESSION_STATE_DIR_NAME = ".holaboss"
_SESSION_STATE_FILE_NAME = "harness-session-state.json"
_SESSION_STATE_VERSION = 1
_SESSION_STATE_MAIN_SESSION_KEY = "main_session_id"
_WORKSPACE_MCP_STATE_FILE_NAME = "workspace-mcp-sidecar-state.json"
_WORKSPACE_MCP_STATE_VERSION = 1
_WORKSPACE_MCP_STDOUT_LOG_BASENAME = "workspace-mcp-sidecar.stdout.log"
_WORKSPACE_MCP_STDERR_LOG_BASENAME = "workspace-mcp-sidecar.stderr.log"
_WORKSPACE_MCP_LOG_TAIL_BYTES = 4096
_OPENCODE_STATE_FILE_NAME = "opencode-sidecar-state.json"
_OPENCODE_STATE_VERSION = 1
_OPENCODE_SKILL_MANIFEST_FILE_NAME = ".skill-manifest.json"
_TS_HARNESS_HOST_NODE_BIN_ENV = "HOLABOSS_RUNTIME_NODE_BIN"
_TS_HARNESS_HOST_NOT_IMPLEMENTED_EXIT_CODE = 86


def _sandbox_runtime_api_url() -> str:
    raw = (os.getenv(_SANDBOX_RUNTIME_API_URL_ENV) or "").strip()
    return raw.rstrip("/") or _DEFAULT_SANDBOX_RUNTIME_API_URL


def _should_fallback_opencode_app_bootstrap(exc: Exception) -> bool:
    if isinstance(exc, httpx.RequestError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
    return False


def _python_opencode_app_lifecycle_fallback_enabled() -> bool:
    raw = (os.getenv(_PYTHON_OPENCODE_APP_LIFECYCLE_FALLBACK_ENV) or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


class RunnerRequest(BaseModel):
    holaboss_user_id: str | None = Field(default=None, min_length=1)
    workspace_id: str = Field(..., min_length=1)
    session_id: str = Field(..., min_length=1)
    input_id: str = Field(..., min_length=1)
    instruction: str = Field(..., min_length=1)
    context: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None
    debug: bool = False


class RunnerOutputEvent(BaseModel):
    session_id: str
    input_id: str
    sequence: int
    event_type: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    payload: dict[str, Any] = Field(default_factory=dict)


class _HarnessHostModelClientPayload(BaseModel):
    model_proxy_provider: str
    api_key: str
    base_url: str | None = None
    default_headers: dict[str, str] | None = None


class _HarnessHostOpencodeRequest(BaseModel):
    workspace_id: str
    workspace_dir: str
    session_id: str
    input_id: str
    instruction: str
    debug: bool = False
    harness_session_id: str | None = None
    persisted_harness_session_id: str | None = None
    provider_id: str
    model_id: str
    mode: str
    opencode_base_url: str
    timeout_seconds: int
    system_prompt: str
    tools: dict[str, bool]
    workspace_tool_ids: list[str]
    workspace_skill_ids: list[str]
    mcp_servers: list[dict[str, Any]]
    output_format: dict[str, Any] | None = None
    workspace_config_checksum: str
    run_started_payload: dict[str, Any]
    model_client: _HarnessHostModelClientPayload


@dataclass(frozen=True)
class _ModelClientConfig:
    model_proxy_provider: str
    api_key: str
    base_url: str | None = None
    default_headers: dict[str, str] | None = None


@dataclass(frozen=True)
class _OpencodeRuntimeConfig:
    provider_id: str
    model_id: str
    mode: str
    system_prompt: str
    tools: dict[str, bool]
    workspace_tool_ids: tuple[str, ...]
    mcp_servers: tuple[dict[str, Any], ...]
    output_schema_member_id: str | None
    output_schema_model: type[BaseModel] | None
    output_format: dict[str, Any] | None
    workspace_config_checksum: str
    workspace_skill_ids: tuple[str, ...]


@dataclass(frozen=True)
class _WorkspaceSkillSpec:
    skill_id: str
    skill_md_path: Path


@dataclass(frozen=True)
class _WorkspaceSkillsConfig:
    skills_path: Path
    skills: tuple[_WorkspaceSkillSpec, ...]


@dataclass(frozen=True)
class _RunningWorkspaceMcpSidecar:
    logical_server_id: str
    physical_server_id: str
    sandbox_id: str
    url: str
    timeout_ms: int
    process: asyncio.subprocess.Process | None
    reused: bool


class _PushCallbackConfig(BaseModel):
    protocol_version: str = Field(default=_PUSH_PROTOCOL_VERSION, min_length=1)
    run_id: str = Field(..., min_length=1)
    callback_url: str = Field(..., min_length=1)
    callback_token: str = Field(..., min_length=1)
    ack_timeout_ms: int = Field(default=3000, ge=100, le=60000)
    max_retries: int = Field(default=3, ge=0, le=10)


@dataclass(frozen=True)
class _PushEventClient:
    config: _PushCallbackConfig
    client: httpx.AsyncClient


def _emit_event(event: RunnerOutputEvent) -> None:
    print(event.model_dump_json(), flush=True)


def _explicit_holaboss_user_id(context: Mapping[str, Any]) -> str:
    raw = context.get("holaboss_user_id")
    if isinstance(raw, str):
        return raw.strip()
    return ""


def _resolve_push_callback_config(*, request: RunnerRequest) -> _PushCallbackConfig | None:
    raw = request.context.get(_PUSH_CONTEXT_KEY)
    if not isinstance(raw, dict):
        return None
    try:
        config = _PushCallbackConfig.model_validate(raw)
    except Exception as exc:
        logger.warning("Invalid push callback config in request context: %s", exc)
        return None
    if config.protocol_version != _PUSH_PROTOCOL_VERSION:
        logger.warning("Unsupported push protocol version: %s", config.protocol_version)
        return None
    return config


def _create_push_event_client(*, request: RunnerRequest) -> _PushEventClient | None:
    config = _resolve_push_callback_config(request=request)
    if config is None:
        return None
    timeout_seconds = max(0.1, float(config.ack_timeout_ms) / 1000.0)
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 3.0)),
    )
    return _PushEventClient(config=config, client=client)


async def _close_push_event_client(push_client: _PushEventClient | None) -> None:
    if push_client is None:
        return
    with suppress(Exception):
        await push_client.client.aclose()


async def _push_event_with_retry(*, push_client: _PushEventClient, event: RunnerOutputEvent) -> None:
    payload = {
        "protocol_version": push_client.config.protocol_version,
        "run_id": push_client.config.run_id,
        "session_id": event.session_id,
        "input_id": event.input_id,
        "sequence": int(event.sequence),
        "event_type": event.event_type,
        "timestamp": event.timestamp.isoformat().replace("+00:00", "Z"),
        "payload": event.payload,
    }
    headers = {
        "Authorization": f"Bearer {push_client.config.callback_token}",
        "Content-Type": "application/json",
        "Idempotency-Key": f"{push_client.config.run_id}:{event.sequence}",
    }

    max_attempts = max(1, int(push_client.config.max_retries) + 1)
    for attempt_index in range(max_attempts):
        try:
            response = await push_client.client.post(
                push_client.config.callback_url,
                headers=headers,
                json=payload,
            )
        except httpx.HTTPError as exc:
            if attempt_index >= max_attempts - 1:
                logger.warning(
                    "Push callback failed after retries for run_id=%s sequence=%s: %s",
                    push_client.config.run_id,
                    event.sequence,
                    exc,
                )
                return
        else:
            if response.status_code < 300:
                return
            if response.status_code in {401, 403, 404}:
                logger.warning(
                    "Push callback rejected event run_id=%s sequence=%s status=%s body=%s",
                    push_client.config.run_id,
                    event.sequence,
                    response.status_code,
                    response.text[:500],
                )
                return
            if response.status_code == 409:
                return
            if response.status_code < 500 and response.status_code != 429:
                logger.warning(
                    "Push callback returned non-retryable status run_id=%s sequence=%s status=%s body=%s",
                    push_client.config.run_id,
                    event.sequence,
                    response.status_code,
                    response.text[:500],
                )
                return
            if attempt_index >= max_attempts - 1:
                logger.warning(
                    "Push callback exhausted retries run_id=%s sequence=%s status=%s",
                    push_client.config.run_id,
                    event.sequence,
                    response.status_code,
                )
                return

        backoff_seconds = min(2.0, 0.2 * (2**attempt_index))
        await asyncio.sleep(backoff_seconds)


async def _emit_event_with_push(*, event: RunnerOutputEvent, push_client: _PushEventClient | None) -> None:
    _emit_event(event)
    if push_client is None:
        return
    await _push_event_with_retry(push_client=push_client, event=event)


def _runtime_root_dir() -> Path:
    return Path(__file__).resolve().parents[2]


def _ts_harness_host_entry_path() -> Path:
    return _runtime_root_dir() / "harness-host" / "dist" / "index.mjs"


def _ts_harness_host_node_bin() -> str:
    configured = (os.getenv(_TS_HARNESS_HOST_NODE_BIN_ENV) or "").strip()
    return configured or "node"


def _opencode_run_started_payload(
    *,
    request: RunnerRequest,
    runtime_config: _OpencodeRuntimeConfig,
    mcp_server_id_map: Mapping[str, str],
    sidecar: _RunningWorkspaceMcpSidecar | None,
) -> dict[str, Any]:
    return {
        "instruction_preview": request.instruction[:120],
        "provider_id": runtime_config.provider_id,
        "model_id": runtime_config.model_id,
        "workspace_tool_ids": list(getattr(runtime_config, "workspace_tool_ids", ())),
        "workspace_skill_ids": list(getattr(runtime_config, "workspace_skill_ids", ())),
        "mcp_server_ids": [server.get("name") for server in runtime_config.mcp_servers],
        "mcp_server_mappings": _mcp_server_mapping_metadata(server_id_map=mcp_server_id_map),
        "workspace_mcp_sidecar_reused": bool(sidecar.reused) if sidecar is not None else False,
        "structured_output_enabled": bool(getattr(runtime_config, "output_schema_model", None)),
        "workspace_config_checksum": runtime_config.workspace_config_checksum,
    }


def _opencode_harness_host_request_payload(
    *,
    request: RunnerRequest,
    workspace_dir: Path,
    runtime_config: _OpencodeRuntimeConfig,
    model_client_config: _ModelClientConfig,
    run_started_payload: dict[str, Any],
) -> _HarnessHostOpencodeRequest:
    requested_harness_session_id = _runtime_exec_context_str(request=request, key=_RUNTIME_EXEC_HARNESS_SESSION_ID_KEY)
    persisted_harness_session_id = _read_workspace_main_session_id(
        workspace_dir=workspace_dir,
        harness="opencode",
    )
    return _HarnessHostOpencodeRequest(
        workspace_id=request.workspace_id,
        workspace_dir=str(workspace_dir),
        session_id=request.session_id,
        input_id=request.input_id,
        instruction=request.instruction,
        debug=bool(request.debug),
        harness_session_id=requested_harness_session_id,
        persisted_harness_session_id=persisted_harness_session_id,
        provider_id=runtime_config.provider_id,
        model_id=runtime_config.model_id,
        mode=runtime_config.mode,
        opencode_base_url=_opencode_base_url(),
        timeout_seconds=_opencode_timeout_seconds(),
        system_prompt=runtime_config.system_prompt,
        tools=dict(runtime_config.tools),
        workspace_tool_ids=list(runtime_config.workspace_tool_ids),
        workspace_skill_ids=list(runtime_config.workspace_skill_ids),
        mcp_servers=[dict(server) for server in runtime_config.mcp_servers],
        output_format=runtime_config.output_format,
        workspace_config_checksum=runtime_config.workspace_config_checksum,
        run_started_payload=run_started_payload,
        model_client=_HarnessHostModelClientPayload(
            model_proxy_provider=model_client_config.model_proxy_provider,
            api_key=model_client_config.api_key,
            base_url=model_client_config.base_url,
            default_headers=model_client_config.default_headers,
        ),
    )


def _harness_host_run_command(*, command: str, payload: BaseModel) -> tuple[str, ...]:
    encoded = base64.b64encode(payload.model_dump_json().encode("utf-8")).decode("utf-8")
    return (
        _ts_harness_host_node_bin(),
        str(_ts_harness_host_entry_path()),
        command,
        "--request-base64",
        encoded,
    )


def _parse_harness_host_runner_event(line: str) -> RunnerOutputEvent | None:
    stripped = line.strip()
    if not stripped:
        return None
    try:
        return RunnerOutputEvent.model_validate_json(stripped)
    except Exception as exc:
        logger.warning("Ignoring invalid harness-host event line error=%s line=%s", exc, stripped[:500])
        return None


async def _read_process_text_stream(stream: asyncio.StreamReader | None) -> str:
    if stream is None:
        return ""
    chunks: list[str] = []
    while True:
        chunk = await stream.read(8192)
        if not chunk:
            break
        chunks.append(chunk.decode("utf-8", errors="replace"))
    return "".join(chunks)


async def _try_execute_request_opencode_via_harness_host(
    *,
    request: RunnerRequest,
    workspace_dir: Path,
    runtime_config: _OpencodeRuntimeConfig,
    model_client_config: _ModelClientConfig,
    mcp_server_id_map: Mapping[str, str],
    sidecar: _RunningWorkspaceMcpSidecar | None,
    push_client: _PushEventClient | None,
) -> bool:
    entry_path = _ts_harness_host_entry_path()
    if not entry_path.is_file():
        await _emit_event_with_push(
            event=RunnerOutputEvent(
                session_id=request.session_id,
                input_id=request.input_id,
                sequence=1,
                event_type=_EVENT_RUN_FAILED,
                payload={
                    "type": "RuntimeError",
                    "message": f"TypeScript OpenCode harness host entry not found at {entry_path}",
                },
            ),
            push_client=push_client,
        )
        return True

    run_started_payload = _opencode_run_started_payload(
        request=request,
        runtime_config=runtime_config,
        mcp_server_id_map=mcp_server_id_map,
        sidecar=sidecar,
    )
    command = _harness_host_run_command(
        command="run-opencode",
        payload=_opencode_harness_host_request_payload(
            request=request,
            workspace_dir=workspace_dir,
            runtime_config=runtime_config,
            model_client_config=model_client_config,
            run_started_payload=run_started_payload,
        ),
    )

    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(_runtime_root_dir()),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as exc:
        await _emit_event_with_push(
            event=RunnerOutputEvent(
                session_id=request.session_id,
                input_id=request.input_id,
                sequence=1,
                event_type=_EVENT_RUN_FAILED,
                payload={
                    "type": "RuntimeError",
                    "message": f"Failed to start TypeScript OpenCode harness host: {exc}",
                },
            ),
            push_client=push_client,
        )
        return True

    stderr_task = asyncio.create_task(_read_process_text_stream(process.stderr))
    saw_event = False
    terminal_emitted = False
    last_sequence = 0

    assert process.stdout is not None
    async for raw_line in process.stdout:
        event = _parse_harness_host_runner_event(raw_line.decode("utf-8", errors="replace"))
        if event is None:
            continue
        saw_event = True
        last_sequence = max(last_sequence, int(event.sequence))

        if event.event_type in _TERMINAL_EVENT_TYPES:
            session_id = event.payload.get("harness_session_id")
            if isinstance(session_id, str) and session_id.strip():
                _persist_workspace_main_session_id(
                    workspace_dir=workspace_dir,
                    harness="opencode",
                    session_id=session_id,
                )

        await _emit_event_with_push(event=event, push_client=push_client)
        if event.event_type in _TERMINAL_EVENT_TYPES:
            terminal_emitted = True

    return_code = await process.wait()
    stderr_text = (await stderr_task).strip()

    if not saw_event and return_code == _TS_HARNESS_HOST_NOT_IMPLEMENTED_EXIT_CODE:
        failure_message = "TypeScript OpenCode harness host reported unimplemented OpenCode adapter"
        if stderr_text:
            failure_message = f"{failure_message}: {stderr_text}"
        await _emit_event_with_push(
            event=RunnerOutputEvent(
                session_id=request.session_id,
                input_id=request.input_id,
                sequence=1,
                event_type=_EVENT_RUN_FAILED,
                payload={
                    "type": "RuntimeError",
                    "message": failure_message,
                },
            ),
            push_client=push_client,
        )
        return True

    if terminal_emitted:
        return True

    failure_message = "TypeScript OpenCode harness host ended before terminal event"
    if return_code != 0:
        failure_message = f"TypeScript OpenCode harness host failed with exit code {return_code}"
    if stderr_text:
        failure_message = f"{failure_message}: {stderr_text}"

    await _emit_event_with_push(
        event=RunnerOutputEvent(
            session_id=request.session_id,
            input_id=request.input_id,
            sequence=1 if not saw_event else last_sequence + 1,
            event_type=_EVENT_RUN_FAILED,
            payload={
                "type": "RuntimeError",
                "message": failure_message,
            },
        ),
        push_client=push_client,
    )
    return True


def _read_template_id(workspace_yaml_path: Path) -> str | None:
    try:
        content = workspace_yaml_path.read_text(encoding="utf-8")
    except OSError:
        return None
    for line in content.splitlines():
        if not line.startswith("template_id:"):
            continue
        value = line.split(":", 1)[1].strip().strip("'\"")
        return value or None
    return None


def _workspace_session_state_path(*, workspace_dir: Path) -> Path:
    return workspace_dir / _SESSION_STATE_DIR_NAME / _SESSION_STATE_FILE_NAME


def _read_workspace_session_state(*, workspace_dir: Path) -> dict[str, Any] | None:
    path = _workspace_session_state_path(workspace_dir=workspace_dir)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Ignoring invalid workspace session state path=%s", path)
        return None
    if not isinstance(parsed, dict):
        logger.warning("Ignoring non-object workspace session state path=%s", path)
        return None
    return parsed


def _read_workspace_main_session_id(*, workspace_dir: Path, harness: str) -> str | None:
    state = _read_workspace_session_state(workspace_dir=workspace_dir)
    if state is None:
        return None

    state_harness = str(state.get("harness") or "").strip().lower()
    if state_harness and state_harness != harness:
        logger.warning(
            "Workspace session state harness mismatch workspace=%s state_harness=%s requested_harness=%s",
            workspace_dir,
            state_harness,
            harness,
        )
        return None

    value = state.get(_SESSION_STATE_MAIN_SESSION_KEY)
    if isinstance(value, str):
        resolved = value.strip()
        if resolved:
            return resolved
    return None


def _persist_workspace_main_session_id(*, workspace_dir: Path, harness: str, session_id: str) -> None:
    resolved_harness = harness.strip().lower()
    resolved_session_id = session_id.strip()
    if not resolved_harness or not resolved_session_id:
        return

    existing_state = _read_workspace_session_state(workspace_dir=workspace_dir)
    if existing_state is not None:
        existing_harness = str(existing_state.get("harness") or "").strip().lower()
        if existing_harness and existing_harness != resolved_harness:
            logger.warning(
                "Refusing to overwrite workspace session state harness workspace=%s state_harness=%s requested_harness=%s",
                workspace_dir,
                existing_harness,
                resolved_harness,
            )
            return

    path = _workspace_session_state_path(workspace_dir=workspace_dir)
    payload = {
        "version": _SESSION_STATE_VERSION,
        "harness": resolved_harness,
        _SESSION_STATE_MAIN_SESSION_KEY: resolved_session_id,
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(f"{path.suffix}.tmp")
        temp_path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
        temp_path.replace(path)
    except OSError as exc:
        logger.warning("Failed to persist workspace session state path=%s error=%s", path, exc)

def _is_valid_module_name(name: str) -> bool:
    if not name or not name.strip():
        return False
    return all(part.isidentifier() for part in name.strip().split("."))


@contextmanager
def _workspace_import_scope(*, workspace_dir: str | None, template_id: str | None):
    added_sys_path = False
    if workspace_dir and workspace_dir not in sys.path:
        sys.path.insert(0, workspace_dir)
        added_sys_path = True

    alias = template_id.strip() if isinstance(template_id, str) else ""
    alias_added = False
    if workspace_dir and alias and _is_valid_module_name(alias) and alias not in sys.modules:
        alias_module = types.ModuleType(alias)
        alias_module.__package__ = alias
        alias_module.__path__ = [workspace_dir]  # type: ignore[attr-defined]
        alias_module.__spec__ = importlib.util.spec_from_loader(alias, loader=None, is_package=True)
        sys.modules[alias] = alias_module
        alias_added = True

    try:
        yield
    finally:
        if alias_added:
            sys.modules.pop(alias, None)
        if added_sys_path:
            with suppress(ValueError):
                sys.path.remove(workspace_dir)


def _read_workspace_yaml_mapping(*, workspace_dir: Path) -> Mapping[str, Any] | None:
    workspace_yaml_path = workspace_dir / "workspace.yaml"
    if not workspace_yaml_path.is_file():
        return None
    try:
        loaded = yaml.safe_load(workspace_yaml_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(loaded, Mapping):
        return None
    return loaded


def _normalize_skill_id(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    skill_id = value.strip()
    if not skill_id or skill_id in {".", ".."}:
        return None
    if "/" in skill_id or "\\" in skill_id or "\x00" in skill_id:
        return None
    return skill_id


def _workspace_skills_path_token(*, payload: Mapping[str, Any]) -> str | None:
    skills = payload.get("skills")
    if isinstance(skills, Mapping):
        raw = skills.get("path")
        if isinstance(raw, str) and raw.strip():
            return raw.strip()

    # Legacy fallback.
    agents = payload.get("agents")
    if not isinstance(agents, Mapping):
        return None
    proactive = agents.get("proactive")
    if not isinstance(proactive, Mapping):
        return None
    raw = proactive.get("skills_path")
    if not isinstance(raw, str) or not raw.strip():
        return None
    return raw.strip()


def _workspace_enabled_skill_ids(*, payload: Mapping[str, Any]) -> tuple[str, ...]:
    skills = payload.get("skills")
    if not isinstance(skills, Mapping):
        return ()
    enabled = skills.get("enabled")
    if not isinstance(enabled, list):
        return ()

    ordered: list[str] = []
    seen: set[str] = set()
    for item in enabled:
        skill_id = _normalize_skill_id(item)
        if skill_id is None or skill_id in seen:
            continue
        seen.add(skill_id)
        ordered.append(skill_id)
    return tuple(ordered)


def _resolve_workspace_skills(*, workspace_dir: Path) -> _WorkspaceSkillsConfig | None:
    payload = _read_workspace_yaml_mapping(workspace_dir=workspace_dir)
    if payload is None:
        return None

    skills_path_token = _workspace_skills_path_token(payload=payload)
    if skills_path_token is None:
        return None

    relative = Path(skills_path_token)
    if relative.is_absolute() or ".." in relative.parts:
        return None
    skills_path = (workspace_dir / relative).resolve()
    workspace_root = workspace_dir.resolve()
    if workspace_root not in skills_path.parents and skills_path != workspace_root:
        return None
    if not skills_path.is_dir():
        return None

    selected_skill_ids = _workspace_enabled_skill_ids(payload=payload)
    if not selected_skill_ids:
        selected_skill_ids = tuple(
            child.name
            for child in sorted(skills_path.iterdir(), key=lambda path: path.name)
            if child.is_dir() and (child / "SKILL.md").is_file()
        )

    loaded_specs: list[_WorkspaceSkillSpec] = []
    for skill_id in selected_skill_ids:
        skill_md_path = (skills_path / skill_id / "SKILL.md").resolve()
        if workspace_root not in skill_md_path.parents and skill_md_path != workspace_root:
            continue
        if not skill_md_path.is_file():
            continue
        loaded_specs.append(_WorkspaceSkillSpec(skill_id=skill_id, skill_md_path=skill_md_path))

    if not loaded_specs:
        return None
    return _WorkspaceSkillsConfig(skills_path=skills_path, skills=tuple(loaded_specs))


def _remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink(missing_ok=True)
        return
    if path.is_dir():
        shutil.rmtree(path)


def _opencode_skill_manifest_payload(*, workspace_skills: _WorkspaceSkillsConfig) -> dict[str, Any]:
    return {
        "skills": [
            {
                "skill_id": skill.skill_id,
                "source_dir": str(skill.skill_md_path.parent.resolve()),
            }
            for skill in workspace_skills.skills
        ]
    }


def _read_opencode_skill_manifest(*, staged_root: Path) -> dict[str, Any] | None:
    manifest_path = staged_root / _OPENCODE_SKILL_MANIFEST_FILE_NAME
    if not manifest_path.is_file():
        return None
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _write_opencode_skill_manifest(*, staged_root: Path, payload: dict[str, Any]) -> None:
    manifest_path = staged_root / _OPENCODE_SKILL_MANIFEST_FILE_NAME
    manifest_path.write_text(json.dumps(payload, ensure_ascii=True, sort_keys=True, indent=2), encoding="utf-8")


def _staged_skill_root_matches_manifest(*, staged_root: Path, manifest_payload: dict[str, Any]) -> bool:
    existing_manifest = _read_opencode_skill_manifest(staged_root=staged_root)
    if existing_manifest != manifest_payload:
        return False

    expected_names = {
        str(item.get("skill_id", "")).strip()
        for item in manifest_payload.get("skills", [])
        if isinstance(item, dict)
    }
    if not expected_names:
        return False

    actual_names = {
        child.name
        for child in staged_root.iterdir()
        if child.name != _OPENCODE_SKILL_MANIFEST_FILE_NAME
    }
    if actual_names != expected_names:
        return False

    for item in manifest_payload["skills"]:
        if not isinstance(item, dict):
            return False
        skill_id = str(item.get("skill_id", "")).strip()
        source_dir = Path(str(item.get("source_dir", "")).strip())
        target_dir = staged_root / skill_id
        if not target_dir.exists():
            return False
        if target_dir.is_symlink():
            try:
                if target_dir.resolve() != source_dir:
                    return False
            except OSError:
                return False
            continue
        if not (target_dir / "SKILL.md").is_file():
            return False
    return True


def _stage_workspace_skills_for_opencode(
    *, workspace_dir: Path, workspace_skills: _WorkspaceSkillsConfig | None
) -> bool:
    if workspace_skills is None:
        return False

    workspace_staged_root = (workspace_dir / ".opencode" / "skills").resolve()
    # OpenCode skill discovery starts from the sidecar process working directory.
    # Runtime-staged skills are shared under WORKSPACE_ROOT/.opencode, not per-workspace directories.
    # Mirror enabled workspace skills at both locations so built-in `skill` discovery works.
    runtime_staged_root = (Path(WORKSPACE_ROOT) / ".opencode" / "skills").resolve()
    manifest_payload = _opencode_skill_manifest_payload(workspace_skills=workspace_skills)

    staged_roots: list[Path] = [workspace_staged_root]
    if runtime_staged_root != workspace_staged_root:
        staged_roots.append(runtime_staged_root)

    changed = False
    for staged_root in staged_roots:
        if staged_root.is_dir() and _staged_skill_root_matches_manifest(
            staged_root=staged_root,
            manifest_payload=manifest_payload,
        ):
            continue

        if staged_root.exists() or staged_root.is_symlink():
            _remove_path(staged_root)
        staged_root.mkdir(parents=True, exist_ok=True)

        for skill in workspace_skills.skills:
            source_dir = skill.skill_md_path.parent.resolve()
            target_dir = staged_root / skill.skill_id
            try:
                target_dir.symlink_to(source_dir, target_is_directory=True)
            except OSError:
                shutil.copytree(source_dir, target_dir, dirs_exist_ok=False)
        _write_opencode_skill_manifest(staged_root=staged_root, payload=manifest_payload)
        changed = True

    return changed


def _stage_workspace_commands_for_opencode(*, workspace_dir: Path) -> None:
    workspace_root = workspace_dir.resolve()
    commands_source = workspace_dir / "commands"
    staged_target = workspace_dir / ".opencode" / "commands"

    # Heal prior bad state where commands became a self-referential symlink.
    if commands_source.is_symlink():
        try:
            commands_source.resolve(strict=True)
        except RuntimeError:
            logger.warning("Removing invalid workspace commands symlink loop at %s", commands_source)
            commands_source.unlink(missing_ok=True)
        except OSError:
            commands_source.unlink(missing_ok=True)

    try:
        commands_source_resolved = commands_source.resolve(strict=True)
    except FileNotFoundError:
        commands_source_resolved = commands_source
    except RuntimeError:
        commands_source_resolved = commands_source

    if workspace_root not in commands_source_resolved.parents and commands_source_resolved != workspace_root:
        return

    if not commands_source.is_dir():
        if staged_target.exists() or staged_target.is_symlink():
            _remove_path(staged_target)
        return

    if staged_target.exists() or staged_target.is_symlink():
        _remove_path(staged_target)
    staged_target.parent.mkdir(parents=True, exist_ok=True)
    try:
        staged_target.symlink_to(commands_source, target_is_directory=True)
    except OSError:
        shutil.copytree(commands_source, staged_target, dirs_exist_ok=False)


async def _compile_workspace_runtime_plan(*, workspace_dir: Path, workspace_id: str) -> CompiledWorkspaceRuntimePlan:
    workspace_yaml_path = workspace_dir / "workspace.yaml"
    if not workspace_yaml_path.is_file():
        raise WorkspaceRuntimeConfigError(
            code="workspace_config_missing",
            path="workspace.yaml",
            message="workspace.yaml is missing from workspace root",
        )

    workspace_yaml = workspace_yaml_path.read_text(encoding="utf-8")
    plan_builder = WorkspaceRuntimePlanBuilder()

    async def _reference_reader(relative_path: str) -> str:
        normalized = Path(relative_path)
        if normalized.is_absolute() or ".." in normalized.parts:
            raise WorkspaceRuntimeConfigError(
                code="workspace_reference_path_invalid",
                message=f"path '{relative_path}' must be a safe relative path",
            )
        target = (workspace_dir / normalized).resolve()
        workspace_root = workspace_dir.resolve()
        if workspace_root not in target.parents and target != workspace_root:
            raise WorkspaceRuntimeConfigError(
                code="workspace_reference_path_invalid",
                message=f"path '{relative_path}' escapes workspace root",
            )
        if not target.is_file():
            raise FileNotFoundError(relative_path)
        return target.read_text(encoding="utf-8")

    return await plan_builder.compile(
        workspace_id=workspace_id,
        workspace_yaml=workspace_yaml,
        reference_reader=_reference_reader,
    )


def _pairs_to_mapping(items: tuple[tuple[str, str], ...]) -> dict[str, str]:
    return dict(items)


def _resolve_env_placeholders(mapping: dict[str, str]) -> dict[str, str]:
    resolved: dict[str, str] = {}
    for key, value in mapping.items():
        token = value.strip()
        if token.startswith("{env:") and token.endswith("}"):
            env_name = token[5:-1].strip()
            if env_name and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", env_name):
                env_value = os.getenv(env_name)
                if env_value is None:
                    raise WorkspaceRuntimeConfigError(
                        code="workspace_mcp_registration_failed",
                        message=f"environment variable '{env_name}' is required by MCP config for header '{key}'",
                    )
                resolved[key] = env_value
                continue
        resolved[key] = value
    return resolved


def _workspace_mcp_sandbox_id() -> str:
    raw = (
        os.getenv("SANDBOX_INSTANCE_ID")
        or os.getenv("SANDBOX_ID")
        or os.getenv("HOSTNAME")
        or socket.gethostname()
        or "sandbox"
    )
    token = re.sub(r"[^A-Za-z0-9_-]+", "_", str(raw).strip()).strip("_")
    return token or "sandbox"


def _workspace_mcp_physical_server_id(*, workspace_id: str, sandbox_id: str) -> str:
    workspace_segment = sanitize_workspace_id(workspace_id)
    digest = hashlib.sha256(f"{sandbox_id}:{workspace_segment}".encode()).hexdigest()[:16]
    return f"{_WORKSPACE_MCP_SERVER_ID}__{digest}"


def _mcp_server_id_map(
    *,
    request: RunnerRequest,
    compiled_plan: CompiledWorkspaceRuntimePlan,
    sandbox_id: str,
) -> dict[str, str]:
    resolved_servers = getattr(compiled_plan, "resolved_mcp_servers", ()) or ()
    workspace_catalog = getattr(compiled_plan, "workspace_mcp_catalog", ()) or ()
    mapping = {
        server.server_id: server.server_id
        for server in resolved_servers
        if isinstance(getattr(server, "server_id", None), str)
    }
    has_workspace_server = _WORKSPACE_MCP_SERVER_ID in mapping or bool(workspace_catalog)
    if has_workspace_server:
        mapping[_WORKSPACE_MCP_SERVER_ID] = _workspace_mcp_physical_server_id(
            workspace_id=request.workspace_id,
            sandbox_id=sandbox_id,
        )
    return mapping


def _workspace_mcp_state_path() -> Path:
    state_dir = Path(WORKSPACE_ROOT) / _SESSION_STATE_DIR_NAME
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir / _WORKSPACE_MCP_STATE_FILE_NAME


def _workspace_mcp_log_dir() -> Path:
    state_dir = Path(WORKSPACE_ROOT) / _SESSION_STATE_DIR_NAME
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir


def _workspace_mcp_log_path(*, physical_server_id: str, stream: str) -> Path:
    safe_id = re.sub(r"[^A-Za-z0-9_-]+", "_", physical_server_id).strip("_") or "workspace"
    basename = _WORKSPACE_MCP_STDOUT_LOG_BASENAME if stream == "stdout" else _WORKSPACE_MCP_STDERR_LOG_BASENAME
    return _workspace_mcp_log_dir() / f"{safe_id}.{basename}"


def _tail_text_file(path: Path, *, max_bytes: int = _WORKSPACE_MCP_LOG_TAIL_BYTES) -> str:
    if not path.is_file():
        return ""
    try:
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - max_bytes))
            data = handle.read()
    except OSError:
        return ""
    return data.decode("utf-8", errors="replace").strip()


def _workspace_mcp_failure_detail(*, physical_server_id: str) -> str:
    stderr_tail = _tail_text_file(_workspace_mcp_log_path(physical_server_id=physical_server_id, stream="stderr"))
    stdout_tail = _tail_text_file(_workspace_mcp_log_path(physical_server_id=physical_server_id, stream="stdout"))
    parts: list[str] = []
    if stderr_tail:
        parts.append(f"stderr_tail={stderr_tail}")
    if stdout_tail:
        parts.append(f"stdout_tail={stdout_tail}")
    if not parts:
        return ""
    return "; " + "; ".join(parts)


def _workspace_mcp_lock_path(*, physical_server_id: str) -> Path:
    safe_id = re.sub(r"[^A-Za-z0-9_-]+", "_", physical_server_id).strip("_") or "workspace"
    state_dir = Path(WORKSPACE_ROOT) / _SESSION_STATE_DIR_NAME
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir / f"workspace-mcp-lock-{safe_id}.lock"


async def _acquire_workspace_mcp_lock(*, physical_server_id: str) -> Any:
    lock_path = _workspace_mcp_lock_path(physical_server_id=physical_server_id)
    lock_file = lock_path.open("a+", encoding="utf-8")
    deadline = asyncio.get_running_loop().time() + _WORKSPACE_MCP_LOCK_TIMEOUT_S
    while True:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if asyncio.get_running_loop().time() >= deadline:
                lock_file.close()
                raise WorkspaceRuntimeConfigError(
                    code="workspace_mcp_sidecar_start_failed",
                    message=f"timed out waiting for MCP sidecar lock '{physical_server_id}'",
                ) from None
            await asyncio.sleep(0.05)
        else:
            return lock_file


def _release_workspace_mcp_lock(*, lock_file: Any) -> None:
    with suppress(Exception):
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    with suppress(Exception):
        lock_file.close()


def _opencode_lock_path() -> Path:
    state_dir = Path(WORKSPACE_ROOT) / _SESSION_STATE_DIR_NAME
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir / "opencode-sidecar.lock"


async def _acquire_opencode_lock() -> Any:
    lock_path = _opencode_lock_path()
    lock_file = lock_path.open("a+", encoding="utf-8")
    deadline = asyncio.get_running_loop().time() + _OPENCODE_LOCK_TIMEOUT_S
    while True:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if asyncio.get_running_loop().time() >= deadline:
                lock_file.close()
                raise RuntimeError("timed out waiting for OpenCode sidecar restart lock") from None
            await asyncio.sleep(0.05)
        else:
            return lock_file


def _release_opencode_lock(*, lock_file: Any) -> None:
    with suppress(Exception):
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    with suppress(Exception):
        lock_file.close()


def _opencode_state_path() -> Path:
    state_dir = Path(WORKSPACE_ROOT) / _SESSION_STATE_DIR_NAME
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir / _OPENCODE_STATE_FILE_NAME


def _read_opencode_sidecar_state() -> dict[str, Any]:
    state_path = _opencode_state_path()
    if not state_path.is_file():
        return {}
    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    if int(payload.get("version") or 0) != _OPENCODE_STATE_VERSION:
        return {}
    sidecar = payload.get("sidecar")
    if not isinstance(sidecar, dict):
        return {}
    return sidecar


def _write_opencode_sidecar_state(entry: dict[str, Any]) -> None:
    state_path = _opencode_state_path()
    payload = {
        "version": _OPENCODE_STATE_VERSION,
        "sidecar": entry,
    }
    state_path.write_text(json.dumps(payload, ensure_ascii=True, sort_keys=True, indent=2), encoding="utf-8")


def _clear_opencode_sidecar_state() -> None:
    _opencode_state_path().unlink(missing_ok=True)


def _read_workspace_mcp_sidecar_state() -> dict[str, dict[str, Any]]:
    state_path = _workspace_mcp_state_path()
    if not state_path.is_file():
        return {}
    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    if int(payload.get("version") or 0) != _WORKSPACE_MCP_STATE_VERSION:
        return {}
    raw_entries = payload.get("sidecars")
    if not isinstance(raw_entries, dict):
        return {}
    entries: dict[str, dict[str, Any]] = {}
    for key, value in raw_entries.items():
        if isinstance(key, str) and isinstance(value, dict):
            entries[key] = value
    return entries


def _write_workspace_mcp_sidecar_state(entries: dict[str, dict[str, Any]]) -> None:
    state_path = _workspace_mcp_state_path()
    payload = {
        "version": _WORKSPACE_MCP_STATE_VERSION,
        "sidecars": entries,
    }
    state_path.write_text(json.dumps(payload, ensure_ascii=True, sort_keys=True, indent=2), encoding="utf-8")


def _workspace_mcp_catalog_fingerprint(compiled_plan: CompiledWorkspaceRuntimePlan) -> str:
    payload = {
        "enabled_tool_ids": list(_workspace_sidecar_enabled_tool_ids(compiled_plan=compiled_plan)),
        "catalog": [
            {
                "tool_id": entry.tool_id,
                "module_path": entry.module_path,
                "symbol_name": entry.symbol_name,
            }
            for entry in compiled_plan.workspace_mcp_catalog
        ],
        "timeouts": {
            server.server_id: server.timeout_ms
            for server in compiled_plan.resolved_mcp_servers
            if server.server_id == _WORKSPACE_MCP_SERVER_ID
        },
    }
    serialized = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _workspace_sidecar_enabled_tool_ids(*, compiled_plan: CompiledWorkspaceRuntimePlan) -> tuple[str, ...]:
    tool_ids = [
        tool_ref.tool_id
        for tool_ref in compiled_plan.resolved_mcp_tool_refs
        if tool_ref.server_id == _WORKSPACE_MCP_SERVER_ID
    ]
    return tuple(dict.fromkeys(tool_ids))


def _workspace_mcp_pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _terminate_workspace_mcp_pid(pid: int) -> None:
    if pid <= 0:
        return
    with suppress(OSError):
        os.kill(pid, signal.SIGTERM)


async def _workspace_mcp_is_ready(*, url: str) -> bool:
    async with httpx.AsyncClient(timeout=2.0, trust_env=False) as client:
        with suppress(Exception):
            response = await client.get(url)
            return response.status_code < 500
    return False


def _mcp_server_payloads(
    compiled_plan: CompiledWorkspaceRuntimePlan,
    *,
    server_id_map: Mapping[str, str] | None = None,
) -> tuple[dict[str, Any], ...]:
    payloads: list[dict[str, Any]] = []
    for server in compiled_plan.resolved_mcp_servers:
        physical_server_id = (
            server_id_map.get(server.server_id, server.server_id) if server_id_map else server.server_id
        )
        headers = _resolve_env_placeholders(_pairs_to_mapping(server.headers))
        environment = _resolve_env_placeholders(_pairs_to_mapping(server.environment))

        if server.type == "local":
            payload = {
                "name": physical_server_id,
                "config": {
                    "type": "local",
                    "command": list(server.command),
                    "enabled": True,
                    "environment": environment or {},
                    "timeout": server.timeout_ms,
                },
            }
            payloads.append(payload)
            continue

        payload = {
            "name": physical_server_id,
            "config": {
                "type": "remote",
                "url": server.url,
                "enabled": True,
                "headers": headers or {},
                "timeout": server.timeout_ms,
            },
        }
        payloads.append(payload)
    return tuple(payloads)


def _sidecar_catalog_payload(compiled_plan: CompiledWorkspaceRuntimePlan) -> str:
    payload = [
        {
            "tool_id": entry.tool_id,
            "server_id": entry.server_id,
            "tool_name": entry.tool_name,
            "module_path": entry.module_path,
            "symbol_name": entry.symbol_name,
        }
        for entry in compiled_plan.workspace_mcp_catalog
    ]
    encoded = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")
    return encoded


def _sidecar_enabled_tool_ids_payload(compiled_plan: CompiledWorkspaceRuntimePlan) -> str:
    payload = list(_workspace_sidecar_enabled_tool_ids(compiled_plan=compiled_plan))
    return base64.b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")


def _next_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return int(sock.getsockname()[1])


async def _wait_for_http_ready(*, url: str, timeout_seconds: float, target_name: str) -> None:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    async with httpx.AsyncClient(timeout=2.0, trust_env=False) as client:
        while True:
            now = asyncio.get_running_loop().time()
            if now >= deadline:
                raise TimeoutError(f"{target_name} readiness timed out for {url}")
            with suppress(Exception):
                response = await client.get(url)
                if response.status_code < 500:
                    return
            await asyncio.sleep(_WORKSPACE_MCP_READY_POLL_S)


async def _wait_for_workspace_mcp_ready(*, url: str, timeout_seconds: float) -> None:
    await _wait_for_http_ready(
        url=url,
        timeout_seconds=timeout_seconds,
        target_name="workspace MCP sidecar",
    )


async def _wait_for_opencode_ready(*, url: str, timeout_seconds: float) -> None:
    await _wait_for_http_ready(
        url=url,
        timeout_seconds=timeout_seconds,
        target_name="OpenCode sidecar",
    )


async def _start_workspace_mcp_sidecar(
    *,
    workspace_dir: Path,
    compiled_plan: CompiledWorkspaceRuntimePlan,
    workspace_id: str,
    sandbox_id: str,
    physical_server_id: str,
) -> _RunningWorkspaceMcpSidecar | None:
    enabled_workspace_tool_ids = _workspace_sidecar_enabled_tool_ids(compiled_plan=compiled_plan)
    if not enabled_workspace_tool_ids:
        return None

    timeout_ms = 10_000
    for server in compiled_plan.resolved_mcp_servers:
        if server.server_id == _WORKSPACE_MCP_SERVER_ID:
            timeout_ms = server.timeout_ms
            break

    lock_file = await _acquire_workspace_mcp_lock(physical_server_id=physical_server_id)
    try:
        state_entries = _read_workspace_mcp_sidecar_state()
        state_entry = state_entries.get(physical_server_id)
        expected_fingerprint = _workspace_mcp_catalog_fingerprint(compiled_plan)

        if isinstance(state_entry, dict):
            persisted_url = str(state_entry.get("url") or "").strip()
            persisted_pid = int(state_entry.get("pid") or 0)
            persisted_workspace_id = str(state_entry.get("workspace_id") or "").strip()
            persisted_sandbox_id = str(state_entry.get("sandbox_id") or "").strip()
            persisted_fingerprint = str(state_entry.get("config_fingerprint") or "").strip()
            if (
                persisted_url
                and persisted_workspace_id == workspace_id
                and persisted_sandbox_id == sandbox_id
                and persisted_fingerprint == expected_fingerprint
                and _workspace_mcp_pid_alive(persisted_pid)
                and await _workspace_mcp_is_ready(url=persisted_url)
            ):
                logger.info(
                    "Reusing workspace MCP sidecar for physical_id=%s url=%s",
                    physical_server_id,
                    persisted_url,
                    extra={
                        "event": "workspace_mcp.sidecar",
                        "outcome": "reuse",
                        "logical_server_id": _WORKSPACE_MCP_SERVER_ID,
                        "physical_server_id": physical_server_id,
                        "sandbox_id": sandbox_id,
                    },
                )
                return _RunningWorkspaceMcpSidecar(
                    logical_server_id=_WORKSPACE_MCP_SERVER_ID,
                    physical_server_id=physical_server_id,
                    sandbox_id=sandbox_id,
                    url=persisted_url,
                    timeout_ms=timeout_ms,
                    process=None,
                    reused=True,
                )

            if persisted_pid > 0 and _workspace_mcp_pid_alive(persisted_pid):
                _terminate_workspace_mcp_pid(persisted_pid)
            state_entries.pop(physical_server_id, None)
            _write_workspace_mcp_sidecar_state(state_entries)

        port = _next_local_port()
        url = f"http://127.0.0.1:{port}/mcp"
        command = [
            sys.executable,
            "-m",
            "sandbox_agent_runtime.workspace_mcp_sidecar",
            "--workspace-dir",
            str(workspace_dir),
            "--workspace-id",
            workspace_id,
            "--catalog-json-base64",
            _sidecar_catalog_payload(compiled_plan),
            "--enabled-tool-ids-json-base64",
            _sidecar_enabled_tool_ids_payload(compiled_plan),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--server-name",
            physical_server_id,
        ]
        env = os.environ.copy()
        pythonpath = (env.get("PYTHONPATH") or "").strip()
        if not pythonpath:
            env["PYTHONPATH"] = "/app"
        elif "/app" not in pythonpath.split(":"):
            env["PYTHONPATH"] = f"/app:{pythonpath}"
        stdout_log_path = _workspace_mcp_log_path(physical_server_id=physical_server_id, stream="stdout")
        stderr_log_path = _workspace_mcp_log_path(physical_server_id=physical_server_id, stream="stderr")
        stdout_log_path.parent.mkdir(parents=True, exist_ok=True)
        stdout_log_path.write_text("", encoding="utf-8")
        stderr_log_path.write_text("", encoding="utf-8")
        with stdout_log_path.open("ab") as stdout_handle, stderr_log_path.open("ab") as stderr_handle:
            process = await asyncio.create_subprocess_exec(
                *command,
                cwd=str(workspace_dir),
                env=env,
                stdout=stdout_handle,
                stderr=stderr_handle,
            )
        try:
            await _wait_for_workspace_mcp_ready(url=url, timeout_seconds=_WORKSPACE_MCP_READY_TIMEOUT_S)
        except Exception as exc:
            if process.returncode is None:
                process.terminate()
                with suppress(Exception):
                    await asyncio.wait_for(process.wait(), timeout=1.0)
            detail = _workspace_mcp_failure_detail(physical_server_id=physical_server_id)
            raise WorkspaceRuntimeConfigError(
                code="workspace_mcp_sidecar_start_failed",
                message=f"failed to start workspace MCP sidecar{detail}",
            ) from exc

        state_entries[physical_server_id] = {
            "workspace_id": workspace_id,
            "sandbox_id": sandbox_id,
            "logical_server_id": _WORKSPACE_MCP_SERVER_ID,
            "physical_server_id": physical_server_id,
            "url": url,
            "pid": int(process.pid or 0),
            "config_fingerprint": expected_fingerprint,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        _write_workspace_mcp_sidecar_state(state_entries)

        logger.info(
            "Started workspace MCP sidecar for physical_id=%s url=%s",
            physical_server_id,
            url,
            extra={
                "event": "workspace_mcp.sidecar",
                "outcome": "start",
                "logical_server_id": _WORKSPACE_MCP_SERVER_ID,
                "physical_server_id": physical_server_id,
                "sandbox_id": sandbox_id,
            },
        )
        return _RunningWorkspaceMcpSidecar(
            logical_server_id=_WORKSPACE_MCP_SERVER_ID,
            physical_server_id=physical_server_id,
            sandbox_id=sandbox_id,
            url=url,
            timeout_ms=timeout_ms,
            process=process,
            reused=False,
        )
    finally:
        _release_workspace_mcp_lock(lock_file=lock_file)


async def _stop_workspace_mcp_sidecar(sidecar: _RunningWorkspaceMcpSidecar | None) -> None:
    if sidecar is None:
        return
    keep_warm = (os.getenv("SANDBOX_WORKSPACE_MCP_KEEP_WARM", "true") or "").strip().lower()
    if keep_warm in {"1", "true", "yes", "on"}:
        return

    process = sidecar.process
    if process is None:
        return
    if process.returncode is not None:
        return
    process.terminate()
    with suppress(asyncio.TimeoutError):
        await asyncio.wait_for(process.wait(), timeout=2.0)
    if process.returncode is None:
        process.kill()
        with suppress(Exception):
            await process.wait()


def _effective_mcp_server_payloads(
    *,
    compiled_plan: CompiledWorkspaceRuntimePlan,
    sidecar: _RunningWorkspaceMcpSidecar | None,
    server_id_map: Mapping[str, str] | None = None,
) -> tuple[dict[str, Any], ...]:
    payloads = list(_mcp_server_payloads(compiled_plan, server_id_map=server_id_map))
    if sidecar is None:
        return tuple(payloads)

    sidecar_payload = {
        "name": sidecar.physical_server_id,
        "config": {
            "type": "remote",
            "url": sidecar.url,
            "enabled": True,
            "headers": {},
            "timeout": sidecar.timeout_ms,
        },
        "_holaboss_force_refresh": not sidecar.reused,
    }
    for index, payload in enumerate(payloads):
        if payload.get("name") == sidecar.physical_server_id:
            payloads[index] = sidecar_payload
            break
    else:
        payloads.append(sidecar_payload)
    return tuple(payloads)


def _mcp_tool_refs_by_server(
    compiled_plan: CompiledWorkspaceRuntimePlan,
    *,
    server_id_map: Mapping[str, str] | None = None,
) -> dict[str, tuple[str, ...]]:
    grouped: dict[str, list[str]] = {}
    for tool_ref in compiled_plan.resolved_mcp_tool_refs:
        server_id = server_id_map.get(tool_ref.server_id, tool_ref.server_id) if server_id_map else tool_ref.server_id
        grouped.setdefault(server_id, []).append(tool_ref.tool_name)
    return {server_id: tuple(tool_names) for server_id, tool_names in grouped.items()}


def _mcp_server_mapping_metadata(*, server_id_map: Mapping[str, str]) -> list[dict[str, str]]:
    return [
        {"logical_id": logical_id, "physical_id": physical_id}
        for logical_id, physical_id in sorted(server_id_map.items())
        if logical_id != physical_id
    ]


def _dedupe_tools(tools: list[Any]) -> list[Any]:
    deduped_tools: list[Any] = []
    seen: set[int] = set()
    for tool in tools:
        identity = id(tool)
        if identity in seen:
            continue
        seen.add(identity)
        deduped_tools.append(tool)
    return deduped_tools


def _enabled_flag(name: str) -> bool:
    return (os.getenv(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def _direct_openai_fallback_enabled() -> bool:
    if _enabled_flag(_DIRECT_OPENAI_FALLBACK_FLAG):
        return True
    config = resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    )
    return not config.holaboss_enabled


def _runtime_exec_context(request: RunnerRequest) -> dict[str, Any]:
    raw = request.context.get(_RUNTIME_EXEC_CONTEXT_KEY)
    if isinstance(raw, dict):
        return raw
    return {}


def _runtime_exec_context_str(*, request: RunnerRequest, key: str) -> str:
    value = _runtime_exec_context(request).get(key)
    if isinstance(value, str):
        return value.strip()
    return ""


def _normalize_model_proxy_provider(provider: str) -> str:
    normalized = provider.strip().lower()
    alias_map = {
        "openai": _MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE,
        _MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE: _MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE,
        "anthropic": _MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE,
        _MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE: _MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE,
    }
    return alias_map.get(normalized, normalized)


def _configured_default_provider() -> str:
    return resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    ).default_provider.strip()


def _default_model_proxy_provider() -> str:
    configured = _configured_default_provider()
    if configured:
        return _normalize_model_proxy_provider(configured)
    return _DEFAULT_MODEL_PROXY_PROVIDER


def _model_proxy_base_url_for_provider(provider: str) -> str:
    normalized_provider = _normalize_model_proxy_provider(provider)
    base_root = _model_proxy_base_root_url()
    if normalized_provider == _MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE:
        return f"{base_root}/anthropic/v1"
    return f"{base_root}/openai/v1"


def _model_proxy_base_root_url() -> str:
    return resolve_product_runtime_config(require_auth=False, require_user=False).model_proxy_base_url


def _resolve_model_proxy_provider_and_model_id(*, model_token: str, default_provider: str) -> tuple[str, str]:
    token = model_token.strip()
    if not token:
        raise WorkspaceRuntimeConfigError(
            code="workspace_general_missing",
            path="agents[0].model",
            message="model must be a non-empty string",
        )

    if "/" in token:
        provider_token, model_id = token.split("/", 1)
        normalized_provider = _normalize_model_proxy_provider(provider_token.strip())
        normalized_model_id = model_id.strip()
        if normalized_provider in {_MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE, _MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE}:
            if normalized_model_id:
                return normalized_provider, normalized_model_id
            raise WorkspaceRuntimeConfigError(
                code="workspace_general_missing",
                path="agents[0].model",
                message="model id segment after provider must be non-empty",
            )

    normalized = token.lower()
    if normalized.startswith("claude"):
        return _MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE, token
    return _normalize_model_proxy_provider(default_provider), token


def _resolve_model_client_config(
    *,
    request: RunnerRequest,
    model_proxy_provider: str = _DEFAULT_MODEL_PROXY_PROVIDER,
    harness: str | None = None,
) -> _ModelClientConfig:
    del harness
    provider = _normalize_model_proxy_provider(model_proxy_provider)
    if provider not in {_MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE, _MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE}:
        raise RuntimeError(
            f"resolved model proxy provider={model_proxy_provider!r} is unsupported; expected one of: "
            f"{_MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE!r}, {_MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE!r}"
        )

    proxy_api_key = _runtime_exec_context_str(request=request, key=_RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY)
    sandbox_id = _runtime_exec_context_str(request=request, key=_RUNTIME_EXEC_SANDBOX_ID_KEY)
    run_id = _runtime_exec_context_str(request=request, key=_RUNTIME_EXEC_RUN_ID_KEY)
    if proxy_api_key and sandbox_id:
        headers = {
            "X-API-Key": proxy_api_key,
            "X-Holaboss-Sandbox-Id": sandbox_id,
            "X-Holaboss-Session-Id": request.session_id,
            "X-Holaboss-Workspace-Id": request.workspace_id,
            "X-Holaboss-Input-Id": request.input_id,
        }
        if run_id:
            headers["X-Holaboss-Run-Id"] = run_id
        return _ModelClientConfig(
            model_proxy_provider=provider,
            api_key=proxy_api_key,
            base_url=_model_proxy_base_url_for_provider(provider),
            default_headers=headers,
        )

    if provider == _MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE and _direct_openai_fallback_enabled():
        direct_api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
        if direct_api_key:
            return _ModelClientConfig(
                model_proxy_provider=_MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE,
                api_key=direct_api_key,
            )

    missing_vars: list[str] = []
    if not proxy_api_key:
        missing_vars.append(f"{_RUNTIME_EXEC_CONTEXT_KEY}.{_RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY}")
    if not sandbox_id:
        missing_vars.append(f"{_RUNTIME_EXEC_CONTEXT_KEY}.{_RUNTIME_EXEC_SANDBOX_ID_KEY}")

    message = f"Sandbox model proxy is not configured (missing: {', '.join(missing_vars)})"
    if provider == _MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE and _direct_openai_fallback_enabled():
        message += "; OPENAI_API_KEY is also missing for direct fallback"
    raise RuntimeError(message)


def _inject_mcp_context_params(
    *,
    mcp_tools: tuple[Any, ...],
    workspace_id: str,
) -> None:
    """Auto-inject ``workspaceId`` into MCP tool calls where the tool schema declares it.

    ``workspaceId`` maps to the current ``workspace_id`` and is a per-run value
    that cannot be provided via environment variables.  For each MCP tool whose
    input schema includes a ``workspaceId`` property, the entrypoint is wrapped so
    the value is injected automatically and the parameter is hidden from the LLM.
    """
    injection_map: dict[str, str] = {
        "workspaceId": workspace_id,
    }

    for toolkit in mcp_tools:
        for func in toolkit.functions.values():
            schema_props = (func.parameters or {}).get("properties", {})
            params_to_inject = {k: v for k, v in injection_map.items() if k in schema_props}
            if not params_to_inject:
                continue

            original_entrypoint = func.entrypoint

            def _make_wrapper(orig: Any, injected: dict[str, str]) -> Any:
                async def _wrapped(*args: Any, **kwargs: Any) -> Any:
                    for key, value in injected.items():
                        kwargs.setdefault(key, value)
                    return await orig(*args, **kwargs)

                return _wrapped

            func.entrypoint = _make_wrapper(original_entrypoint, params_to_inject)

            required = func.parameters.get("required", [])
            for key in params_to_inject:
                schema_props.pop(key, None)
                if key in required:
                    required.remove(key)


def _event_name(chunk: Any) -> str:
    event = getattr(chunk, "event", "")
    event_value = getattr(event, "value", event)
    return str(event_value)


def _event_source(event_name: str, chunk: Any) -> str:
    agent_id = getattr(chunk, "agent_id", None)
    if isinstance(agent_id, str) and agent_id:
        return "member"
    if event_name.startswith("Team"):
        return "team"
    return "runner"


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool, dict, list)):
        return value
    if hasattr(value, "model_dump"):
        with suppress(Exception):
            return value.model_dump()
    try:
        return json.loads(str(value))
    except Exception:
        return str(value)


def _normalize_event_token(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def _extract_text_delta(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        if parts:
            return "".join(parts)
    if isinstance(value, dict):
        text = value.get("text")
        if isinstance(text, str):
            return text
    return None


def _extract_output_payload(chunk: Any) -> dict[str, Any] | None:
    event_name = _event_name(chunk)
    if _normalize_event_token(event_name) not in {
        "runcontent",
        "runintermediatecontent",
        "teamruncontent",
        "teamrunintermediatecontent",
        "runcompleted",
        "teamruncompleted",
    }:
        return None
    for field in ("content", "delta", "text"):
        value = _extract_text_delta(getattr(chunk, field, None))
        if isinstance(value, str) and value != "":
            payload: dict[str, Any] = {
                "delta": value,
                "event": event_name,
                "source": _event_source(event_name, chunk),
            }
            agent_id = getattr(chunk, "agent_id", None)
            if isinstance(agent_id, str) and agent_id:
                payload["agent_id"] = agent_id
            return payload
    return None


def _extract_thinking_payload(chunk: Any) -> dict[str, Any] | None:
    event_name = _event_name(chunk)
    if event_name not in {
        "ReasoningContentDelta",
        "ReasoningStep",
        "TeamReasoningContentDelta",
        "TeamReasoningStep",
    }:
        return None
    for field in ("reasoning_content", "reasoning", "content", "delta", "text"):
        value = getattr(chunk, field, None)
        if isinstance(value, str):
            value = value.strip()
            if value:
                payload: dict[str, Any] = {
                    "delta": value,
                    "event": event_name,
                    "source": _event_source(event_name, chunk),
                }
                agent_id = getattr(chunk, "agent_id", None)
                if isinstance(agent_id, str) and agent_id:
                    payload["agent_id"] = agent_id
                return payload
    return None


def _extract_tool_payload(chunk: Any) -> dict[str, Any] | None:
    event_name = _event_name(chunk)
    tool = getattr(chunk, "tool", None)
    if (
        event_name
        not in {
            "ToolCallStarted",
            "ToolCallCompleted",
            "ToolCallError",
            "TeamToolCallStarted",
            "TeamToolCallCompleted",
            "TeamToolCallError",
        }
        or tool is None
    ):
        return None

    if event_name in {"ToolCallStarted", "TeamToolCallStarted"}:
        phase = "started"
    elif event_name in {"ToolCallCompleted", "TeamToolCallCompleted"}:
        phase = "completed"
    else:
        phase = "error"

    tool_name = getattr(tool, "tool_name", None) or getattr(tool, "name", "unknown_tool")
    result = getattr(tool, "result", None)
    tool_args = getattr(tool, "tool_args", None)
    tool_call_error = bool(getattr(tool, "tool_call_error", False) or phase == "error")
    payload: dict[str, Any] = {
        "phase": phase,
        "tool_name": str(tool_name),
        "error": tool_call_error,
        "tool_args": _jsonable(tool_args),
        "result": _jsonable(result),
        "event": event_name,
        "source": _event_source(event_name, chunk),
    }
    agent_id = getattr(chunk, "agent_id", None)
    if isinstance(agent_id, str) and agent_id:
        payload["agent_id"] = agent_id

    return payload


def _extract_error_payload(chunk: Any) -> dict[str, Any] | None:
    event_name = _event_name(chunk)
    if event_name not in {
        "RunError",
        "TeamRunError",
        "ModelRequestError",
        "TeamModelRequestError",
    }:
        return None

    message = ""
    for field in ("error", "message", "content", "delta", "text"):
        value = getattr(chunk, field, None)
        if isinstance(value, Exception):
            message = str(value)
            break
        if isinstance(value, str) and value.strip():
            message = value.strip()
            break

    if not message:
        message = f"{event_name} received from runner"

    payload: dict[str, Any] = {
        "type": "RunnerStreamError",
        "message": message,
        "event": event_name,
        "source": _event_source(event_name, chunk),
    }
    agent_id = getattr(chunk, "agent_id", None)
    if isinstance(agent_id, str) and agent_id:
        payload["agent_id"] = agent_id
    return payload


def _resolved_application_runtime_payload(app: Any) -> dict[str, Any]:
    return {
        "app_id": str(app.app_id),
        "mcp": {
            "transport": str(app.mcp.transport),
            "port": int(app.mcp.port),
            "path": str(app.mcp.path),
        },
        "health_check": {
            "path": str(app.health_check.path),
            "timeout_s": int(app.health_check.timeout_s),
            "interval_s": int(app.health_check.interval_s),
        },
        "env_contract": [str(value) for value in getattr(app, "env_contract", ())],
        "start_command": str(getattr(app, "start_command", "") or ""),
        "base_dir": str(getattr(app, "base_dir", "") or ""),
        "lifecycle": {
            "setup": str(getattr(app.lifecycle, "setup", "") or ""),
            "start": str(getattr(app.lifecycle, "start", "") or ""),
            "stop": str(getattr(app.lifecycle, "stop", "") or ""),
        },
    }


async def _start_opencode_apps_via_runtime_api(
    *,
    request: RunnerRequest,
    workspace_dir: Path,
    resolved_applications: tuple[Any, ...],
) -> tuple[dict[str, Any], ...]:
    payload = {
        "workspace_dir": str(workspace_dir),
        "holaboss_user_id": _explicit_holaboss_user_id(request.context),
        "resolved_applications": [
            _resolved_application_runtime_payload(app)
            for app in resolved_applications
        ],
    }
    url = f"{_sandbox_runtime_api_url()}/api/v1/internal/workspaces/{request.workspace_id}/opencode-apps/start"
    async with httpx.AsyncClient(timeout=60.0, trust_env=False) as client:
        response = await client.post(url, json=payload)
    response.raise_for_status()
    response_payload = response.json()
    applications = response_payload.get("applications") if isinstance(response_payload, dict) else None
    if not isinstance(applications, list):
        raise RuntimeError("invalid opencode app bootstrap response")
    entries: list[dict[str, Any]] = []
    for application in applications:
        if not isinstance(application, dict):
            raise RuntimeError("invalid opencode app bootstrap item")
        app_id = application.get("app_id")
        mcp_url = application.get("mcp_url")
        timeout_ms = application.get("timeout_ms")
        if (
            not isinstance(app_id, str)
            or not isinstance(mcp_url, str)
            or not isinstance(timeout_ms, int)
        ):
            raise RuntimeError("invalid opencode app bootstrap item")
        entries.append(
            {
                "name": app_id,
                "config": {
                    "type": "remote",
                    "url": mcp_url,
                    "enabled": True,
                    "headers": {"X-Workspace-Id": request.workspace_id},
                    "timeout": timeout_ms,
                },
            }
        )
    return tuple(entries)


async def _start_opencode_apps_via_python_lifecycle(
    *,
    request: RunnerRequest,
    workspace_dir: Path,
    resolved_applications: tuple[Any, ...],
) -> tuple[dict[str, Any], ...]:
    from sandbox_agent_runtime.legacy_opencode_app_lifecycle import (
        start_resolved_applications_via_python_lifecycle,
    )

    return await start_resolved_applications_via_python_lifecycle(
        workspace_id=request.workspace_id,
        workspace_dir=workspace_dir,
        holaboss_user_id=_explicit_holaboss_user_id(request.context),
        resolved_applications=resolved_applications,
    )


async def _start_opencode_resolved_applications(
    *,
    request: RunnerRequest,
    workspace_dir: Path,
    resolved_applications: tuple[Any, ...],
) -> tuple[dict[str, Any], ...]:
    try:
        return await _start_opencode_apps_via_runtime_api(
            request=request,
            workspace_dir=workspace_dir,
            resolved_applications=resolved_applications,
        )
    except Exception as exc:
        if not _should_fallback_opencode_app_bootstrap(exc):
            raise
        if not _python_opencode_app_lifecycle_fallback_enabled():
            raise RuntimeError(
                "OpenCode app bootstrap via TS runtime API failed and Python lifecycle fallback is disabled"
            ) from exc
        logger.warning("Falling back to Python app lifecycle manager for OpenCode app startup: %s", exc)
    return await _start_opencode_apps_via_python_lifecycle(
        request=request,
        workspace_dir=workspace_dir,
        resolved_applications=resolved_applications,
    )


def _selected_harness(*, request: RunnerRequest) -> str:
    harness = (
        _runtime_exec_context_str(request=request, key=_RUNTIME_EXEC_HARNESS_KEY)
        or (os.getenv("SANDBOX_AGENT_HARNESS") or "opencode").strip()
    ).lower()
    if harness not in _SUPPORTED_HARNESSES:
        allowed = ", ".join(sorted(_SUPPORTED_HARNESSES))
        raise RuntimeError(f"SANDBOX_AGENT_HARNESS={harness!r} is unsupported; expected one of: {allowed}")
    return harness


def _opencode_base_url() -> str:
    configured = (os.getenv("OPENCODE_BASE_URL") or "").strip().rstrip("/")
    if configured:
        return configured
    return f"http://{_opencode_server_host()}:{_opencode_server_port()}"


def _opencode_timeout_seconds() -> int:
    raw = (os.getenv("OPENCODE_RUN_TIMEOUT_S") or "1800").strip()
    try:
        value = int(raw)
    except ValueError:
        return 1800
    return max(1, min(value, 7200))


def _opencode_server_host() -> str:
    host = (os.getenv("OPENCODE_SERVER_HOST") or _DEFAULT_OPENCODE_HOST).strip()
    return host or _DEFAULT_OPENCODE_HOST


def _opencode_server_port() -> int:
    raw = (os.getenv("OPENCODE_SERVER_PORT") or str(_DEFAULT_OPENCODE_PORT)).strip()
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_OPENCODE_PORT
    return max(1, min(value, 65535))


def _opencode_server_log_path() -> Path:
    path = Path(WORKSPACE_ROOT) / _SESSION_STATE_DIR_NAME / "opencode-server.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _opencode_ready_timeout_seconds() -> float:
    raw = (os.getenv("OPENCODE_READY_TIMEOUT_S") or "30").strip()
    with suppress(ValueError):
        return max(float(raw), 1.0)
    return 30.0


def _opencode_sidecar_fingerprint(*, runtime_config: _OpencodeRuntimeConfig, workspace_id: str) -> str:
    payload = {
        "workspace_id": workspace_id,
        "provider_id": str(getattr(runtime_config, "provider_id", "") or ""),
        "model_id": str(getattr(runtime_config, "model_id", "") or ""),
        "mode": str(getattr(runtime_config, "mode", "") or ""),
        "workspace_skill_ids": list(getattr(runtime_config, "workspace_skill_ids", ()) or ()),
    }
    serialized = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


async def _restart_opencode_sidecar(
    *, allow_reuse_existing: bool = False, config_fingerprint: str = "", workspace_id: str = ""
) -> None:
    host = _opencode_server_host()
    port = _opencode_server_port()
    process_marker = f"opencode serve --hostname {host} --port {port}"
    workspace_root = str(Path(WORKSPACE_ROOT))
    readiness_url = f"{_opencode_base_url()}/mcp"

    async def _opencode_sidecar_pids() -> list[int]:
        try:
            ps_process = await asyncio.create_subprocess_exec(
                "ps",
                "-eo",
                "pid=,args=",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await ps_process.communicate()
        except Exception as exc:
            raise RuntimeError(f"failed to inspect running OpenCode sidecar processes: {exc}") from exc

        pids: list[int] = []
        for line in stdout.decode("utf-8", errors="replace").splitlines():
            row = line.strip()
            if not row:
                continue
            parts = row.split(maxsplit=1)
            if len(parts) != 2:
                continue
            pid_token, args = parts
            if process_marker not in args:
                continue
            with suppress(ValueError):
                pids.append(int(pid_token))
        return pids

    lock_file = await _acquire_opencode_lock()
    try:
        persisted_state = _read_opencode_sidecar_state()
        persisted_fingerprint = str(persisted_state.get("config_fingerprint") or "").strip()
        persisted_pid = int(persisted_state.get("pid") or 0)
        fingerprint_matches = bool(config_fingerprint) and persisted_fingerprint == config_fingerprint

        if await _workspace_mcp_is_ready(url=readiness_url):
            if allow_reuse_existing or fingerprint_matches:
                return

        if persisted_pid and not _workspace_mcp_pid_alive(persisted_pid):
            _clear_opencode_sidecar_state()
            persisted_state = {}

        running_pids = await _opencode_sidecar_pids()
        for pid in sorted(set(running_pids)):
            _terminate_workspace_mcp_pid(pid)

        if running_pids:
            deadline = asyncio.get_running_loop().time() + 3.0
            while asyncio.get_running_loop().time() < deadline:
                if not await _opencode_sidecar_pids():
                    break
                await asyncio.sleep(0.1)
            remaining = await _opencode_sidecar_pids()
            for pid in sorted(set(remaining)):
                with suppress(OSError):
                    os.kill(pid, signal.SIGKILL)
            if remaining:
                await asyncio.sleep(0.1)
                if await _opencode_sidecar_pids():
                    raise RuntimeError("failed to stop existing OpenCode sidecar before restart")

        with _opencode_server_log_path().open("ab") as log_file:
            try:
                sidecar_process = await asyncio.create_subprocess_exec(
                    "opencode",
                    "serve",
                    "--hostname",
                    host,
                    "--port",
                    str(port),
                    cwd=workspace_root,
                    stdout=log_file,
                    stderr=asyncio.subprocess.STDOUT,
                    start_new_session=True,
                )
            except Exception as exc:
                raise RuntimeError(f"failed to restart OpenCode sidecar: {exc}") from exc
        try:
            await asyncio.wait_for(sidecar_process.wait(), timeout=0.2)
        except TimeoutError:
            pass
        else:
            # Exit code -15 (SIGTERM) likely means a concurrent restart killed our
            # freshly spawned process.  Fall through to the readiness check — the
            # other restart may have already brought up a healthy sidecar.
            if sidecar_process.returncode != -15:
                _clear_opencode_sidecar_state()
                raise RuntimeError(f"OpenCode sidecar exited during startup with code {sidecar_process.returncode}")

        await _wait_for_opencode_ready(
            url=readiness_url,
            timeout_seconds=_opencode_ready_timeout_seconds(),
        )
        _write_opencode_sidecar_state(
            {
                "pid": sidecar_process.pid,
                "url": readiness_url,
                "workspace_id": workspace_id,
                "config_fingerprint": config_fingerprint,
            }
        )
    finally:
        _release_opencode_lock(lock_file=lock_file)


async def _ensure_opencode_sidecar_ready() -> str:
    readiness_url = f"{_opencode_base_url()}/mcp"
    if await _workspace_mcp_is_ready(url=readiness_url):
        return "reused"
    await _restart_opencode_sidecar(allow_reuse_existing=True)
    return "started"

def _opencode_session_mode() -> str:
    mode = (os.getenv("OPENCODE_SESSION_MODE") or _DEFAULT_OPENCODE_SESSION_MODE).strip()
    return mode or _DEFAULT_OPENCODE_SESSION_MODE


def _opencode_default_provider_id() -> str:
    configured = _configured_default_provider()
    if configured:
        normalized = _normalize_model_proxy_provider(configured)
        if normalized == _MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE:
            return "anthropic"
        return "openai"
    provider = (os.getenv("OPENCODE_PROVIDER_ID") or _DEFAULT_OPENCODE_PROVIDER_ID).strip()
    return provider or _DEFAULT_OPENCODE_PROVIDER_ID


def _opencode_proxy_config_path() -> Path:
    return Path(WORKSPACE_ROOT) / "opencode.json"


def _opencode_provider_config_payload(
    *,
    provider_id: str,
    model_id: str,
    model_client_config: _ModelClientConfig,
) -> dict[str, Any]:
    base_url = (model_client_config.base_url or "").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("OpenCode model proxy base URL is not configured")

    headers: dict[str, str] = {}
    if model_client_config.default_headers:
        for key, value in model_client_config.default_headers.items():
            normalized_key = str(key).strip()
            normalized_value = str(value).strip()
            if not normalized_key or not normalized_value:
                continue
            # Persist only stable auth/routing headers in opencode.json.
            # Per-run metadata headers (session/input/run IDs) would mutate the
            # file every turn and invalidate harness sessions on each request.
            if normalized_key.lower() not in _OPENCODE_PERSISTED_PROXY_HEADER_ALLOWLIST:
                continue
            if normalized_key and normalized_value:
                headers[normalized_key] = normalized_value
    if "X-API-Key" not in headers:
        headers["X-API-Key"] = model_client_config.api_key

    provider_npm_package = "@ai-sdk/openai-compatible"
    if model_client_config.model_proxy_provider == _MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE:
        provider_npm_package = "@ai-sdk/anthropic"

    return {
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            provider_id: {
                "npm": provider_npm_package,
                "name": "Holaboss Model Proxy",
                "options": {
                    "apiKey": model_client_config.api_key,
                    "baseURL": base_url,
                    "headers": headers,
                },
                "models": {
                    model_id: {
                        "name": model_id,
                    },
                },
            },
        },
        "model": f"{provider_id}/{model_id}",
    }


def _write_opencode_provider_config(
    *,
    provider_id: str,
    model_id: str,
    model_client_config: _ModelClientConfig,
) -> tuple[Path, bool]:
    """Write opencode provider config. Returns (path, changed) where changed=True if the file was updated."""
    path = _opencode_proxy_config_path()
    payload = _opencode_provider_config_payload(
        provider_id=provider_id,
        model_id=model_id,
        model_client_config=model_client_config,
    )
    new_text = json.dumps(payload, ensure_ascii=True, indent=2)
    try:
        existing_text = path.read_text(encoding="utf-8")
    except OSError:
        existing_text = ""
    if existing_text == new_text:
        return path, False
    path.write_text(new_text, encoding="utf-8")
    return path, True


def _write_opencode_model_selection(
    *,
    provider_id: str,
    model_id: str,
) -> tuple[Path, bool]:
    """Update only top-level model selection in opencode.json.

    Provider definitions are bootstrapped by entrypoint.sh and should remain
    stable across runs to avoid unnecessary session invalidation.
    """

    path = _opencode_proxy_config_path()
    desired_model = f"{provider_id}/{model_id}"

    try:
        existing_text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"OpenCode config file is missing at {path}") from exc

    try:
        payload = json.loads(existing_text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"OpenCode config at {path} is invalid JSON") from exc
    if not isinstance(payload, dict):
        raise TypeError(f"OpenCode config at {path} must be a JSON object")

    existing_model = str(payload.get("model") or "").strip()
    if existing_model == desired_model:
        return path, False

    payload["model"] = desired_model
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    return path, True


def _opencode_structured_retry_count() -> int:
    raw = (os.getenv("OPENCODE_STRUCTURED_OUTPUT_RETRY_COUNT") or str(_DEFAULT_OPENCODE_STRUCTURED_RETRY_COUNT)).strip()
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_OPENCODE_STRUCTURED_RETRY_COUNT
    return max(0, min(value, 10))


def _opencode_tool_name_from_mcp_server_and_tool(*, server_id: str, tool_name: str) -> str:
    return f"{server_id}_{tool_name}"


def _opencode_tools_from_workspace(
    *,
    compiled_plan: CompiledWorkspaceRuntimePlan,
    tool_server_id_map: Mapping[str, str] | None = None,
) -> tuple[dict[str, bool], tuple[str, ...]]:
    workspace_tool_ids = tuple(tool_ref.tool_id for tool_ref in compiled_plan.resolved_mcp_tool_refs)
    tools: dict[str, bool] = dict.fromkeys(_OPENCODE_DEFAULT_TOOLS, True)
    for tool_ref in compiled_plan.resolved_mcp_tool_refs:
        server_id = (
            tool_server_id_map.get(tool_ref.server_id, tool_ref.server_id) if tool_server_id_map else tool_ref.server_id
        )
        tools[_opencode_tool_name_from_mcp_server_and_tool(server_id=server_id, tool_name=tool_ref.tool_name)] = True
    return tools, workspace_tool_ids


def _opencode_chat_tools_from_workspace(
    *,
    compiled_plan: CompiledWorkspaceRuntimePlan,
    tool_server_id_map: Mapping[str, str] | None = None,
) -> tuple[dict[str, bool], tuple[str, ...]]:
    tools, workspace_tool_ids = _opencode_tools_from_workspace(
        compiled_plan=compiled_plan,
        tool_server_id_map=tool_server_id_map,
    )
    extra_tools = (os.getenv("OPENCODE_EXTRA_TOOLS") or "").strip()
    for token in extra_tools.split(","):
        tool_name = token.strip()
        if tool_name:
            tools[tool_name] = True
    return tools, workspace_tool_ids


def _selected_opencode_schema(
    *,
    general_config: WorkspaceGeneralSingleConfig | WorkspaceGeneralTeamConfig,
    resolved_output_schemas: dict[str, type[BaseModel]],
) -> tuple[str | None, type[BaseModel] | None]:
    if isinstance(general_config, WorkspaceGeneralSingleConfig):
        member_id = general_config.agent.id
        return member_id, resolved_output_schemas.get(member_id)

    coordinator_id = general_config.coordinator.id
    unsupported_member_ids = sorted(member_id for member_id in resolved_output_schemas if member_id != coordinator_id)
    if unsupported_member_ids:
        raise WorkspaceRuntimeConfigError(
            code="workspace_schema_member_unsupported",
            path="agents",
            message=(
                "OpenCode harness currently validates a single schema for the selected runtime member only; "
                + f"unsupported schema members: {', '.join(unsupported_member_ids)}"
            ),
        )
    return coordinator_id, resolved_output_schemas.get(coordinator_id)


def _opencode_output_format(*, schema_model: type[BaseModel] | None) -> dict[str, Any] | None:
    if schema_model is None:
        return None
    return {
        "type": "json_schema",
        "schema": schema_model.model_json_schema(),
        "retryCount": _opencode_structured_retry_count(),
    }


def _resolve_opencode_provider_and_model(*, model: str, default_provider_id: str) -> tuple[str, str]:
    provider, model_id = _resolve_model_proxy_provider_and_model_id(
        model_token=model,
        default_provider=default_provider_id,
    )
    if provider == _MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE:
        return "anthropic", model_id
    return "openai", model_id


def _compose_opencode_team_system_prompt(*, general_config: WorkspaceGeneralTeamConfig) -> str:
    lines = [
        "You are the workspace coordinator agent.",
        "Follow coordinator guidance and apply member guidance when useful.",
        "",
        "Coordinator instructions:",
        general_config.coordinator.prompt.strip(),
        "",
        "Member guidance:",
    ]
    for member in general_config.members:
        role_label = member.role or "member"
        lines.extend([
            f"- {member.id} ({role_label}):",
            member.prompt.strip(),
            "",
        ])
    return "\n".join(lines).strip()


def _build_opencode_runtime_config(
    *,
    request: RunnerRequest,
    compiled_plan: CompiledWorkspaceRuntimePlan,
    mcp_servers: tuple[dict[str, Any], ...],
    tool_server_id_map: Mapping[str, str] | None = None,
) -> _OpencodeRuntimeConfig:
    workspace_dir = Path(WORKSPACE_ROOT) / sanitize_workspace_id(request.workspace_id)
    workspace_skills = _resolve_workspace_skills(workspace_dir=workspace_dir)

    general_config = compiled_plan.general_config
    if isinstance(general_config, WorkspaceGeneralSingleConfig):
        selected_model = request.model or general_config.agent.model
        system_prompt = general_config.agent.prompt.strip()
    elif isinstance(general_config, WorkspaceGeneralTeamConfig):
        selected_model = request.model or general_config.coordinator.model
        system_prompt = _compose_opencode_team_system_prompt(general_config=general_config)
    else:
        raise WorkspaceRuntimeConfigError(
            code="workspace_general_type_invalid",
            path="agents",
            message=f"unsupported general runtime mode: {type(general_config).__name__}",
        )

    provider_id, model_id = _resolve_opencode_provider_and_model(
        model=selected_model,
        default_provider_id=_opencode_default_provider_id(),
    )
    tools, workspace_tool_ids = _opencode_chat_tools_from_workspace(
        compiled_plan=compiled_plan,
        tool_server_id_map=tool_server_id_map,
    )
    if workspace_skills is not None:
        tools.setdefault("read", True)
    output_schema_member_id, output_schema_model = _selected_opencode_schema(
        general_config=general_config,
        resolved_output_schemas=compiled_plan.resolved_output_schemas,
    )
    output_format = _opencode_output_format(schema_model=output_schema_model)

    return _OpencodeRuntimeConfig(
        provider_id=provider_id,
        model_id=model_id,
        mode=_opencode_session_mode(),
        system_prompt=system_prompt,
        tools=tools,
        workspace_tool_ids=workspace_tool_ids,
        mcp_servers=mcp_servers,
        output_schema_member_id=output_schema_member_id,
        output_schema_model=output_schema_model,
        output_format=output_format,
        workspace_config_checksum=compiled_plan.config_checksum,
        workspace_skill_ids=tuple(skill.skill_id for skill in workspace_skills.skills) if workspace_skills else (),
    )


async def _iter_opencode_stream_with_timeout(*, stream: Any, timeout_seconds: int):
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    iterator = stream.__aiter__()
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise TimeoutError("timed out waiting for OpenCode stream")
        try:
            event = await asyncio.wait_for(iterator.__anext__(), timeout=remaining)
        except StopAsyncIteration:
            return
        yield event


def _event_session_id(raw_event: Any) -> str:
    properties = getattr(raw_event, "properties", None)
    if properties is None:
        payload = _jsonable(raw_event)
        if not isinstance(payload, dict):
            return ""
        return (
            _first_nonempty_string(
                _dig(payload, "properties.session_id"),
                _dig(payload, "properties.sessionID"),
                _dig(payload, "properties.part.session_id"),
                _dig(payload, "properties.part.sessionID"),
                _dig(payload, "properties.info.session_id"),
                _dig(payload, "properties.info.sessionID"),
            )
            or ""
        )

    session_id = getattr(properties, "session_id", None)
    if isinstance(session_id, str) and session_id.strip():
        return session_id.strip()
    session_id_alias = getattr(properties, "sessionID", None)
    if isinstance(session_id_alias, str) and session_id_alias.strip():
        return session_id_alias.strip()
    if isinstance(properties, dict):
        session_id_dict = _first_nonempty_string(properties.get("session_id"), properties.get("sessionID"))
        if session_id_dict:
            return session_id_dict

    part = getattr(properties, "part", None)
    if part is None and isinstance(properties, dict):
        part = properties.get("part")
    part_session_id = getattr(part, "session_id", None) if part is not None else None
    if isinstance(part_session_id, str) and part_session_id.strip():
        return part_session_id.strip()
    part_session_id_alias = getattr(part, "sessionID", None) if part is not None else None
    if isinstance(part_session_id_alias, str) and part_session_id_alias.strip():
        return part_session_id_alias.strip()

    info = getattr(properties, "info", None)
    info_session_id = getattr(info, "session_id", None) if info is not None else None
    if isinstance(info_session_id, str) and info_session_id.strip():
        return info_session_id.strip()
    info_session_id_alias = getattr(info, "sessionID", None) if info is not None else None
    if isinstance(info_session_id_alias, str) and info_session_id_alias.strip():
        return info_session_id_alias.strip()

    payload = _jsonable(raw_event)
    if isinstance(payload, dict):
        return (
            _first_nonempty_string(
                _dig(payload, "properties.session_id"),
                _dig(payload, "properties.sessionID"),
                _dig(payload, "properties.part.session_id"),
                _dig(payload, "properties.part.sessionID"),
                _dig(payload, "properties.info.session_id"),
                _dig(payload, "properties.info.sessionID"),
            )
            or ""
        )
    return ""


def _dig(value: Any, path: str) -> Any:
    if not path:
        return value
    current = value
    for segment in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(segment)
    return current


def _first_nonempty_string(*values: Any) -> str | None:
    for item in values:
        if isinstance(item, str):
            trimmed = item.strip()
            if trimmed:
                return trimmed
    return None


def _first_nonempty_int(*values: Any) -> int | None:
    for item in values:
        if isinstance(item, bool):
            continue
        if isinstance(item, int):
            return item
        if isinstance(item, str):
            stripped = item.strip()
            if not stripped:
                continue
            with suppress(ValueError):
                return int(stripped)
    return None


def _extract_error_message(value: Any) -> str | None:
    return _first_nonempty_string(
        _dig(value, "message"),
        _dig(value, "error.message"),
        _dig(value, "detail"),
        _dig(value, "error.detail"),
        value if isinstance(value, str) else None,
    )


def _event_error_payload(raw_event: Any) -> dict[str, Any]:
    properties = getattr(raw_event, "properties", None)
    error = getattr(properties, "error", None) if properties is not None else None
    if error is None:
        return {"message": "OpenCode session reported an error"}

    error_payload = _jsonable(error)
    data_payload = _jsonable(getattr(error, "data", None))

    error_name = _first_nonempty_string(
        _dig(error_payload, "name"),
        getattr(error, "name", None),
    )
    message = _first_nonempty_string(
        _extract_error_message(data_payload),
        _extract_error_message(error_payload),
    )
    status_code = _first_nonempty_int(
        _dig(data_payload, "status"),
        _dig(data_payload, "status_code"),
        _dig(data_payload, "error.status"),
        _dig(error_payload, "status"),
    )
    error_code = _first_nonempty_string(
        _dig(data_payload, "code"),
        _dig(data_payload, "error.code"),
        _dig(error_payload, "code"),
    )
    provider_id = _first_nonempty_string(
        _dig(data_payload, "provider_id"),
        _dig(data_payload, "providerID"),
        _dig(data_payload, "provider.id"),
    )

    if not message:
        message = error_name or "OpenCode session reported an error"

    detail_parts: list[str] = []
    if status_code is not None:
        detail_parts.append(f"status={status_code}")
    if error_code:
        detail_parts.append(f"code={error_code}")
    if provider_id:
        detail_parts.append(f"provider={provider_id}")

    summary = f"{error_name}: {message}" if error_name and not message.startswith(f"{error_name}:") else message
    if detail_parts:
        summary = f"{summary} ({', '.join(detail_parts)})"

    result: dict[str, Any] = {"message": summary}
    if error_name:
        result["error_name"] = error_name
    if error_code:
        result["error_code"] = error_code
    if status_code is not None:
        result["status_code"] = status_code
    if provider_id:
        result["provider_id"] = provider_id
    return result


def _exception_failure_payload(exc: BaseException, *, prefix: str | None = None) -> dict[str, Any]:
    exception_type = exc.__class__.__name__
    raw_message = str(exc).strip() or exception_type

    body_payload = _jsonable(getattr(exc, "body", None))
    response = getattr(exc, "response", None)
    request = getattr(exc, "request", None)

    status_code = _first_nonempty_int(
        getattr(exc, "status_code", None),
        getattr(response, "status_code", None),
        _dig(body_payload, "status"),
        _dig(body_payload, "status_code"),
        _dig(body_payload, "error.status"),
    )

    response_payload: Any = None
    if response is not None:
        with suppress(Exception):
            response_payload = response.json()
    if response_payload is None and response is not None:
        response_text = getattr(response, "text", None)
        if isinstance(response_text, str) and response_text.strip():
            with suppress(Exception):
                response_payload = json.loads(response_text)
            if response_payload is None:
                response_payload = response_text.strip()

    message_detail = _first_nonempty_string(
        _extract_error_message(body_payload),
        _extract_error_message(response_payload),
    )
    error_code = _first_nonempty_string(
        _dig(body_payload, "code"),
        _dig(body_payload, "error.code"),
        _dig(response_payload, "code"),
        _dig(response_payload, "error.code"),
        getattr(exc, "code", None),
    )
    provider_id = _first_nonempty_string(
        _dig(body_payload, "provider_id"),
        _dig(body_payload, "providerID"),
        _dig(body_payload, "provider.id"),
        _dig(response_payload, "provider_id"),
        _dig(response_payload, "providerID"),
        _dig(response_payload, "provider.id"),
    )

    request_url = getattr(request, "url", None)
    response_url = getattr(response, "url", None)
    target_host = _first_nonempty_string(
        getattr(request_url, "host", None),
        getattr(response_url, "host", None),
    )
    target_path = _first_nonempty_string(
        getattr(request_url, "path", None),
        getattr(response_url, "path", None),
    )
    request_method = _first_nonempty_string(
        getattr(request, "method", None),
        getattr(response, "request", None).method if getattr(response, "request", None) is not None else None,
    )
    source_module = exc.__class__.__module__
    source = (
        "openai"
        if source_module.startswith("openai.")
        else "opencode"
        if source_module.startswith("opencode_ai.")
        else "runtime"
    )

    summary = message_detail or raw_message
    if prefix:
        summary = f"{prefix}: {summary}"

    detail_parts: list[str] = []
    if status_code is not None:
        detail_parts.append(f"status={status_code}")
    if error_code:
        detail_parts.append(f"code={error_code}")
    if provider_id:
        detail_parts.append(f"provider={provider_id}")
    if target_host:
        detail_parts.append(f"host={target_host}")
    if target_path:
        detail_parts.append(f"path={target_path}")
    if request_method:
        detail_parts.append(f"method={request_method.upper()}")
    if source != "runtime":
        detail_parts.append(f"source={source}")
    if message_detail is None:
        debug_payload = body_payload
        if debug_payload in (None, "", {}):
            debug_payload = response_payload
        if debug_payload not in (None, "", {}):
            debug_snippet = _snapshot_value(value=debug_payload)
            if len(debug_snippet) > 280:
                debug_snippet = f"{debug_snippet[:277]}..."
            detail_parts.append(f"body={debug_snippet}")
    if detail_parts:
        summary = f"{summary} ({', '.join(detail_parts)})"

    payload: dict[str, Any] = {
        "type": exception_type,
        "message": summary,
        "raw_message": raw_message,
    }
    if status_code is not None:
        payload["status_code"] = status_code
    if error_code:
        payload["error_code"] = error_code
    if provider_id:
        payload["provider_id"] = provider_id
    if target_host:
        payload["target_host"] = target_host
    if target_path:
        payload["target_path"] = target_path
    if request_method:
        payload["request_method"] = request_method.upper()
    if source != "runtime":
        payload["source"] = source
    return payload


def _snapshot_value(*, value: Any) -> str:
    try:
        return json.dumps(_jsonable(value), sort_keys=True)
    except Exception:
        return str(value)


def _part_value(part: Any, *keys: str) -> Any:
    for key in keys:
        if isinstance(part, dict) and key in part:
            return part.get(key)
        value = getattr(part, key, None)
        if value is not None:
            return value
    return None


def _event_delta(raw_event: Any) -> str:
    properties = getattr(raw_event, "properties", None)
    if properties is not None:
        delta = getattr(properties, "delta", None)
        if isinstance(delta, str) and delta:
            return delta
        if isinstance(properties, dict):
            delta_dict = properties.get("delta")
            if isinstance(delta_dict, str) and delta_dict:
                return delta_dict

    payload = _jsonable(raw_event)
    delta_value = _dig(payload, "properties.delta") if isinstance(payload, dict) else None
    if isinstance(delta_value, str) and delta_value:
        return delta_value
    return ""


def _event_part(raw_event: Any) -> Any:
    properties = getattr(raw_event, "properties", None)
    if properties is not None:
        part = getattr(properties, "part", None)
        if part is not None:
            return part
        if isinstance(properties, dict):
            part = properties.get("part")
            if part is not None:
                return part

    payload = _jsonable(raw_event)
    if isinstance(payload, dict):
        part = _dig(payload, "properties.part")
        if part is not None:
            return part
    return None


def _event_session_status_type(raw_event: Any) -> str:
    properties = getattr(raw_event, "properties", None)
    if properties is not None:
        status = getattr(properties, "status", None)
        if status is None and isinstance(properties, dict):
            status = properties.get("status")
        if status is not None:
            status_type = getattr(status, "type", None)
            if isinstance(status_type, str) and status_type.strip():
                return status_type.strip().lower()
            if isinstance(status, dict):
                status_type_dict = status.get("type")
                if isinstance(status_type_dict, str) and status_type_dict.strip():
                    return status_type_dict.strip().lower()

    payload = _jsonable(raw_event)
    if isinstance(payload, dict):
        status_type = _dig(payload, "properties.status.type")
        if isinstance(status_type, str) and status_type.strip():
            return status_type.strip().lower()
    return ""


def _event_part_id(*, raw_event: Any, part: Any) -> str:
    part_id = str(_part_value(part, "id", "part_id", "partID") or "").strip()
    if part_id:
        return part_id

    properties = getattr(raw_event, "properties", None)
    if properties is not None:
        for key in ("part_id", "partID", "partId", "id"):
            candidate = getattr(properties, key, None)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        if isinstance(properties, dict):
            for key in ("part_id", "partID", "partId", "id"):
                candidate = properties.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    return candidate.strip()

    payload = _jsonable(raw_event)
    if isinstance(payload, dict):
        return (
            _first_nonempty_string(
                _dig(payload, "properties.part_id"),
                _dig(payload, "properties.partID"),
                _dig(payload, "properties.partId"),
                _dig(payload, "properties.id"),
            )
            or ""
        )
    return ""


def _normalize_opencode_part_type(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().lower()


def _part_stream_event_type(part_type: str) -> tuple[str, str]:
    normalized = _normalize_opencode_part_type(part_type)
    if normalized == "reasoning":
        return _EVENT_THINKING_DELTA, "thinking"
    return _EVENT_OUTPUT_DELTA, "output"


def _queued_part_delta_events(
    *,
    part_id: str,
    part_type: str,
    event_name: str,
    pending_part_deltas: dict[str, list[tuple[str, str]]],
) -> list[tuple[str, dict[str, Any]]]:
    queued = pending_part_deltas.pop(part_id, [])
    if not queued:
        return []

    event_type, delta_kind = _part_stream_event_type(part_type)
    payloads: list[tuple[str, dict[str, Any]]] = []
    for queued_event_name, queued_delta in queued:
        payloads.append((
            event_type,
            {
                "delta": queued_delta,
                "event": queued_event_name or event_name,
                "source": "opencode",
                "part_id": part_id,
                "part_type": _normalize_opencode_part_type(part_type),
                "delta_kind": delta_kind,
            },
        ))
    return payloads


def _flush_unresolved_pending_part_deltas(
    *,
    pending_part_deltas: dict[str, list[tuple[str, str]]],
) -> list[tuple[str, dict[str, Any]]]:
    if not pending_part_deltas:
        return []

    flushed: list[tuple[str, dict[str, Any]]] = []
    for part_id, queued in list(pending_part_deltas.items()):
        for queued_event_name, queued_delta in queued:
            if not queued_delta:
                continue
            flushed.append((
                _EVENT_OUTPUT_DELTA,
                {
                    "delta": queued_delta,
                    "event": queued_event_name or "message.part.delta",
                    "source": "opencode",
                    "part_id": part_id,
                    "part_type": None,
                    "delta_kind": "unknown",
                    "unresolved_part_type": True,
                },
            ))
    pending_part_deltas.clear()
    return flushed


def _text_delta_from_values(*, part_id: str, text: str, snapshots: dict[str, str]) -> str:
    normalized_part_id = part_id.strip()
    if not normalized_part_id:
        return ""

    previous = snapshots.get(normalized_part_id, "")
    snapshots[normalized_part_id] = text
    if not text:
        return ""
    if text.startswith(previous):
        return text[len(previous) :]
    return text


def _text_delta(*, part: Any, snapshots: dict[str, str]) -> str:
    raw_part_id = _part_value(part, "id", "part_id", "partID")
    part_id = str(raw_part_id).strip() if raw_part_id is not None else ""
    if not part_id:
        return ""
    raw_text = _part_value(part, "text", "snapshot")
    text = str(raw_text) if raw_text is not None else ""
    if not text:
        return ""
    return _text_delta_from_values(part_id=part_id, text=text, snapshots=snapshots)


def _opencode_tool_payload(
    *,
    part: Any,
    event_name: str,
    snapshots: dict[str, tuple[str, str]],
) -> dict[str, Any] | None:
    state = getattr(part, "state", None)
    status = str(getattr(state, "status", "")).strip().lower()
    if status not in {"pending", "running", "completed", "error"}:
        return None

    phase = "started" if status in {"pending", "running"} else status
    part_id = str(getattr(part, "id", "")).strip()
    snapshot = _snapshot_value(
        value=getattr(state, "output", None) if status == "completed" else getattr(state, "error", None)
    )
    previous = snapshots.get(part_id)
    current = (status, snapshot)
    if previous == current:
        return None
    snapshots[part_id] = current

    return {
        "phase": phase,
        "tool_name": str(getattr(part, "tool", "unknown_tool")),
        "error": phase == "error",
        "tool_args": _jsonable(getattr(state, "input", None)),
        "result": _jsonable(getattr(state, "output", None) if status == "completed" else getattr(state, "error", None)),
        "event": event_name,
        "source": "opencode",
        "call_id": str(getattr(part, "call_id", "")),
    }


def _question_tool_terminal_payload(tool_payload: dict[str, Any]) -> dict[str, Any] | None:
    if str(tool_payload.get("tool_name", "")).strip().lower() != "question":
        return None
    if bool(tool_payload.get("error")):
        return None
    if str(tool_payload.get("phase", "")).strip().lower() not in {"started", "completed"}:
        return None

    tool_args = tool_payload.get("tool_args")
    result = tool_payload.get("result")
    question_data: Any = None
    if isinstance(tool_args, dict) and tool_args:
        question_data = tool_args
    elif isinstance(result, dict) and result:
        question_data = result
    if not isinstance(question_data, dict):
        return None
    if not question_data.get("questions") and not question_data.get("question"):
        return None

    return {
        "status": "waiting_user",
        "event": str(tool_payload.get("event") or "message.part.updated"),
        "interaction_type": "question",
        "tool_name": "question",
        "question": question_data,
        "call_id": tool_payload.get("call_id"),
    }


def _message_updated_events(
    *,
    raw_event: Any,
    event_name: str,
    text_snapshots: dict[str, str],
    part_type_snapshots: dict[str, str],
    pending_part_deltas: dict[str, list[tuple[str, str]]],
) -> list[tuple[str, dict[str, Any]]]:
    payload = _jsonable(raw_event)
    parts = _dig(payload, "properties.info.parts") if isinstance(payload, dict) else None
    if not isinstance(parts, list):
        properties = getattr(raw_event, "properties", None)
        info = getattr(properties, "info", None) if properties is not None else None
        if isinstance(info, dict):
            parts = info.get("parts")
        elif info is not None:
            parts = getattr(info, "parts", None)
    if not isinstance(parts, list):
        return []

    output_events: list[tuple[str, dict[str, Any]]] = []
    for index, part in enumerate(parts):
        if not isinstance(part, dict):
            continue
        part_type = _normalize_opencode_part_type(part.get("type"))
        if part_type not in {"text", "reasoning"}:
            continue
        part_id_raw = part.get("id")
        if not isinstance(part_id_raw, str) or not part_id_raw.strip():
            part_id_raw = f"message-updated-{index}"
        part_type_snapshots[part_id_raw] = part_type
        text = str(part.get("text", ""))
        delta = _text_delta_from_values(part_id=part_id_raw, text=text, snapshots=text_snapshots)
        output_events.extend(
            _queued_part_delta_events(
                part_id=part_id_raw,
                part_type=part_type,
                event_name=event_name,
                pending_part_deltas=pending_part_deltas,
            )
        )
        if not delta:
            continue
        stream_event_type, delta_kind = _part_stream_event_type(part_type)
        output_events.append((
            stream_event_type,
            {
                "delta": delta,
                "event": event_name,
                "source": "opencode",
                "part_id": part_id_raw,
                "part_type": part_type,
                "delta_kind": delta_kind,
            },
        ))
    return output_events


def _map_opencode_event(
    *,
    raw_event: Any,
    target_session_id: str,
    text_snapshots: dict[str, str],
    tool_snapshots: dict[str, tuple[str, str]],
    part_type_snapshots: dict[str, str] | None = None,
    pending_part_deltas: dict[str, list[tuple[str, str]]] | None = None,
) -> list[tuple[str, dict[str, Any]]]:
    if part_type_snapshots is None:
        part_type_snapshots = {}
    if pending_part_deltas is None:
        pending_part_deltas = {}

    event_name = str(getattr(raw_event, "type", "")).strip()
    if not event_name:
        return []

    if event_name == "session.error":
        if _event_session_id(raw_event) not in {"", target_session_id}:
            return []
        error_payload = _event_error_payload(raw_event)
        return [
            (
                _EVENT_RUN_FAILED,
                {
                    "type": "OpenCodeSessionError",
                    "message": str(error_payload["message"]),
                    "event": event_name,
                    **{k: v for k, v in error_payload.items() if k != "message"},
                },
            )
        ]

    if _event_session_id(raw_event) != target_session_id:
        return []

    if event_name == "session.idle":
        return [
            *_flush_unresolved_pending_part_deltas(pending_part_deltas=pending_part_deltas),
            (_EVENT_RUN_COMPLETED, {"status": "success", "event": event_name}),
        ]

    if event_name == "session.status":
        status_type = _event_session_status_type(raw_event)
        if status_type != "idle":
            return []
        return [
            *_flush_unresolved_pending_part_deltas(pending_part_deltas=pending_part_deltas),
            (
                _EVENT_RUN_COMPLETED,
                {
                    "status": "success",
                    "event": event_name,
                    "session_status": status_type,
                },
            ),
        ]

    if event_name == "message.updated":
        return _message_updated_events(
            raw_event=raw_event,
            event_name=event_name,
            text_snapshots=text_snapshots,
            part_type_snapshots=part_type_snapshots,
            pending_part_deltas=pending_part_deltas,
        )

    if event_name not in {"message.part.updated", "message.part.delta"}:
        return []

    part = _event_part(raw_event)
    part_type_raw = _part_value(part, "type")
    part_type = _normalize_opencode_part_type(part_type_raw)
    part_id = _event_part_id(raw_event=raw_event, part=part)
    if part_id and part_type:
        part_type_snapshots[part_id] = part_type
    resolved_part_type = part_type_snapshots.get(part_id, part_type) if part_id else part_type

    if event_name == "message.part.delta":
        delta = _event_delta(raw_event)
        if not delta:
            return []
        if resolved_part_type and resolved_part_type not in {"text", "reasoning", "snapshot"}:
            return []
        if part_id and not resolved_part_type:
            pending_part_deltas.setdefault(part_id, []).append((event_name, delta))
            return []
        if part_id:
            raw_text = _part_value(part, "text", "snapshot")
            text = str(raw_text) if raw_text is not None else ""
            if text:
                text_snapshots[part_id] = text
            else:
                text_snapshots[part_id] = f"{text_snapshots.get(part_id, '')}{delta}"
        stream_event_type, delta_kind = _part_stream_event_type(resolved_part_type)
        queued_events = (
            _queued_part_delta_events(
                part_id=part_id,
                part_type=resolved_part_type,
                event_name=event_name,
                pending_part_deltas=pending_part_deltas,
            )
            if part_id and resolved_part_type
            else []
        )
        return [
            *queued_events,
            (
                stream_event_type,
                {
                    "delta": delta,
                    "event": event_name,
                    "source": "opencode",
                    "part_id": part_id,
                    "part_type": resolved_part_type or None,
                    "delta_kind": delta_kind,
                },
            ),
        ]

    if resolved_part_type == "text":
        delta = _event_delta(raw_event)
        if delta:
            if part_id:
                raw_text = _part_value(part, "text", "snapshot")
                text = str(raw_text) if raw_text is not None else ""
                if text:
                    text_snapshots[part_id] = text
                else:
                    text_snapshots[part_id] = f"{text_snapshots.get(part_id, '')}{delta}"
        else:
            delta = _text_delta(part=part, snapshots=text_snapshots)
        if not delta:
            return []
        queued_events = (
            _queued_part_delta_events(
                part_id=part_id,
                part_type=resolved_part_type,
                event_name=event_name,
                pending_part_deltas=pending_part_deltas,
            )
            if part_id
            else []
        )
        return [
            *queued_events,
            (
                _EVENT_OUTPUT_DELTA,
                {
                    "delta": delta,
                    "event": event_name,
                    "source": "opencode",
                    "part_id": part_id,
                    "part_type": resolved_part_type,
                    "delta_kind": "output",
                },
            ),
        ]

    if resolved_part_type == "reasoning":
        delta = _event_delta(raw_event)
        if not delta:
            delta = _text_delta(part=part, snapshots=text_snapshots)
        if not delta:
            return []
        queued_events = (
            _queued_part_delta_events(
                part_id=part_id,
                part_type=resolved_part_type,
                event_name=event_name,
                pending_part_deltas=pending_part_deltas,
            )
            if part_id
            else []
        )
        return [
            *queued_events,
            (
                _EVENT_THINKING_DELTA,
                {
                    "delta": delta,
                    "event": event_name,
                    "source": "opencode",
                    "part_id": part_id,
                    "part_type": resolved_part_type,
                    "delta_kind": "thinking",
                },
            ),
        ]

    if resolved_part_type == "snapshot":
        delta = _text_delta(part=part, snapshots=text_snapshots)
        if not delta:
            return []
        return [
            (
                _EVENT_OUTPUT_DELTA,
                {
                    "delta": delta,
                    "event": event_name,
                    "source": "opencode",
                    "part_id": part_id,
                    "part_type": resolved_part_type,
                    "delta_kind": "output",
                },
            )
        ]

    if resolved_part_type == "tool":
        tool_payload = _opencode_tool_payload(part=part, event_name=event_name, snapshots=tool_snapshots)
        if tool_payload is None:
            return []
        terminal_payload = _question_tool_terminal_payload(tool_payload)
        events: list[tuple[str, dict[str, Any]]] = [(_EVENT_TOOL_CALL, tool_payload)]
        if terminal_payload is not None:
            events.append((_EVENT_RUN_COMPLETED, terminal_payload))
        return events

    if resolved_part_type in {"step-start", "step-finish"}:
        return [
            (
                _EVENT_THINKING_DELTA,
                {
                    "delta": resolved_part_type,
                    "event": event_name,
                    "source": "opencode",
                    "part_id": str(_part_value(part, "id", "part_id", "partID") or ""),
                    "part_type": resolved_part_type,
                    "delta_kind": "thinking",
                },
            )
        ]

    return []


def _should_emit_opencode_event(*, event_type: str, payload: dict[str, Any], instruction: str) -> bool:
    if event_type == _EVENT_THINKING_DELTA:
        delta = payload.get("delta")
        if isinstance(delta, str) and delta in {"step-start", "step-finish"}:
            return False

    if event_type == _EVENT_OUTPUT_DELTA:
        delta = payload.get("delta")
        source = payload.get("source")
        if (
            isinstance(delta, str)
            and isinstance(source, str)
            and source == "opencode"
            and delta.strip() == instruction.strip()
        ):
            return False

    return True


async def _execute_request_opencode(request: RunnerRequest) -> int:
    push_client = _create_push_event_client(request=request)
    workspace_segment = sanitize_workspace_id(request.workspace_id)
    workspace_dir = Path(WORKSPACE_ROOT) / workspace_segment
    template_id = _read_template_id(workspace_dir / "workspace.yaml")

    sequence = 0
    sidecar: _RunningWorkspaceMcpSidecar | None = None
    execution_started_at = time.perf_counter()
    def _next_sequence() -> int:
        nonlocal sequence
        sequence += 1
        return sequence

    def _log_phase(phase: str, started_at: float, *, outcome: str = "success", **extra_fields: Any) -> None:
        logger.debug(
            "OpenCode phase %s %s",
            phase,
            outcome,
            extra={
                "event": "sandbox_agent_runtime.opencode.phase",
                "outcome": outcome,
                "phase": phase,
                "elapsed_ms": int((time.perf_counter() - started_at) * 1000),
                "workspace_id": request.workspace_id,
                "session_id": request.session_id,
                "input_id": request.input_id,
                **extra_fields,
            },
        )

    try:
        with _workspace_import_scope(workspace_dir=str(workspace_dir), template_id=template_id):
            await _emit_event_with_push(
                event=RunnerOutputEvent(
                    session_id=request.session_id,
                    input_id=request.input_id,
                    sequence=_next_sequence(),
                    event_type=_EVENT_RUN_CLAIMED,
                    payload={"instruction_preview": request.instruction[:120]},
                ),
                push_client=push_client,
            )

            phase_started_at = time.perf_counter()
            workspace_skills = _resolve_workspace_skills(workspace_dir=workspace_dir)
            workspace_skills_changed = _stage_workspace_skills_for_opencode(
                workspace_dir=workspace_dir,
                workspace_skills=workspace_skills,
            )
            _stage_workspace_commands_for_opencode(workspace_dir=workspace_dir)
            _log_phase("stage_workspace_assets", phase_started_at)

            phase_started_at = time.perf_counter()
            compiled_plan = await _compile_workspace_runtime_plan(
                workspace_dir=workspace_dir,
                workspace_id=request.workspace_id,
            )
            _log_phase("compile_runtime_plan", phase_started_at)

            phase_started_at = time.perf_counter()
            sandbox_id = _workspace_mcp_sandbox_id()
            mcp_server_id_map = _mcp_server_id_map(
                request=request,
                compiled_plan=compiled_plan,
                sandbox_id=sandbox_id,
            )
            workspace_physical_server_id = mcp_server_id_map.get(_WORKSPACE_MCP_SERVER_ID, _WORKSPACE_MCP_SERVER_ID)
            sidecar = await _start_workspace_mcp_sidecar(
                workspace_dir=workspace_dir,
                compiled_plan=compiled_plan,
                workspace_id=request.workspace_id,
                sandbox_id=sandbox_id,
                physical_server_id=workspace_physical_server_id,
            )
            _log_phase(
                "start_workspace_mcp_sidecar",
                phase_started_at,
                reused=bool(sidecar.reused) if sidecar is not None else False,
            )

            phase_started_at = time.perf_counter()
            effective_mcp_servers = _effective_mcp_server_payloads(
                compiled_plan=compiled_plan,
                sidecar=sidecar,
                server_id_map=mcp_server_id_map,
            )

            # Start app containers and append their MCP servers
            opencode_resolved_applications = getattr(compiled_plan, "resolved_applications", ())
            if opencode_resolved_applications:
                app_mcp_entries = await _start_opencode_resolved_applications(
                    request=request,
                    workspace_dir=workspace_dir,
                    resolved_applications=tuple(opencode_resolved_applications),
                )
                effective_mcp_servers = effective_mcp_servers + app_mcp_entries

            runtime_config = _build_opencode_runtime_config(
                request=request,
                compiled_plan=compiled_plan,
                mcp_servers=effective_mcp_servers,
                tool_server_id_map=mcp_server_id_map,
            )

            model_client_config = _resolve_model_client_config(
                request=request,
                model_proxy_provider=runtime_config.provider_id,
            )
            _, opencode_provider_config_changed = _write_opencode_provider_config(
                provider_id=runtime_config.provider_id,
                model_id=runtime_config.model_id,
                model_client_config=model_client_config,
            )
            if opencode_provider_config_changed:
                logger.info(
                    "opencode.json provider config updated provider_id=%s model_id=%s",
                    runtime_config.provider_id,
                    runtime_config.model_id,
                )

            _, opencode_model_selection_changed = _write_opencode_model_selection(
                provider_id=runtime_config.provider_id,
                model_id=runtime_config.model_id,
            )
            if opencode_model_selection_changed:
                logger.info(
                    "opencode.json model selection updated provider_id=%s model_id=%s",
                    runtime_config.provider_id,
                    runtime_config.model_id,
                )

            _log_phase("build_runtime_config", phase_started_at)

            phase_started_at = time.perf_counter()
            restart_policy = "sandbox_boot"
            should_restart_opencode_sidecar = False
            opencode_sidecar_fingerprint = _opencode_sidecar_fingerprint(
                runtime_config=runtime_config,
                workspace_id=request.workspace_id,
            )
            if opencode_provider_config_changed:
                should_restart_opencode_sidecar = True
                restart_policy = "provider_config_refresh"
            elif workspace_skills_changed:
                # OpenCode skill index is loaded from disk at sidecar startup.
                # Restart only when the staged workspace skill set actually changed.
                should_restart_opencode_sidecar = True
                restart_policy = "workspace_skills_refresh"

            if should_restart_opencode_sidecar:
                await _restart_opencode_sidecar(
                    config_fingerprint=opencode_sidecar_fingerprint,
                    workspace_id=request.workspace_id,
                )
                _log_phase("restart_opencode_sidecar", phase_started_at, restart_policy=restart_policy)
            else:
                _log_phase(
                    "restart_opencode_sidecar", phase_started_at, outcome="skipped", restart_policy=restart_policy
                )

            _log_phase("pre_run_total", execution_started_at)

            await _try_execute_request_opencode_via_harness_host(
                request=request,
                workspace_dir=workspace_dir,
                runtime_config=runtime_config,
                model_client_config=model_client_config,
                mcp_server_id_map=mcp_server_id_map,
                sidecar=sidecar,
                push_client=push_client,
            )
            return 0
    except Exception as exc:
        await _emit_event_with_push(
            event=RunnerOutputEvent(
                session_id=request.session_id,
                input_id=request.input_id,
                sequence=_next_sequence() if sequence > 0 else 1,
                event_type=_EVENT_RUN_FAILED,
                payload=_exception_failure_payload(exc, prefix="OpenCode execution failed"),
            ),
            push_client=push_client,
        )
    finally:
        # App containers are intentionally left running so the next run can reuse them
        # without a full start/stop cycle.
        await _stop_workspace_mcp_sidecar(sidecar)
        await _close_push_event_client(push_client)

    return 0


async def _execute_request(request: RunnerRequest) -> int:
    try:
        harness = _selected_harness(request=request)
    except RuntimeError as exc:
        push_client = _create_push_event_client(request=request)
        await _emit_event_with_push(
            event=RunnerOutputEvent(
                session_id=request.session_id,
                input_id=request.input_id,
                sequence=1,
                event_type=_EVENT_RUN_FAILED,
                payload={"type": "RuntimeError", "message": str(exc)},
            ),
            push_client=push_client,
        )
        await _close_push_event_client(push_client)
        return 0

    return await _execute_request_opencode(request)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run workspace runtime execution inside sandbox and emit JSON events")
    parser.add_argument("--request-base64", required=True, help="Base64-encoded JSON RunnerRequest payload")
    return parser.parse_args(argv)


def _decode_request(encoded: str) -> RunnerRequest:
    raw = base64.b64decode(encoded.encode("utf-8"), validate=True)
    payload = json.loads(raw.decode("utf-8"))
    return RunnerRequest.model_validate(payload)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])
    try:
        request = _decode_request(args.request_base64)
    except Exception as exc:
        logger.exception("Failed to decode in-sandbox runner request")
        print(
            json.dumps({
                "session_id": "unknown",
                "input_id": "unknown",
                "sequence": 1,
                "event_type": _EVENT_RUN_FAILED,
                "payload": {
                    "type": exc.__class__.__name__,
                    "message": f"invalid runner request payload: {exc}",
                },
            }),
            flush=True,
        )
        return 1

    return asyncio.run(_execute_request(request))


if __name__ == "__main__":
    raise SystemExit(main())
