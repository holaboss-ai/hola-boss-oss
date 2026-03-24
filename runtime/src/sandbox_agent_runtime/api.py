from __future__ import annotations

import asyncio
import base64
import inspect
import io
import json
import logging
import os
import shlex
import shutil
import stat as stat_module
import subprocess
import tarfile
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Awaitable, Callable
from uuid import uuid4

import yaml
from croniter import croniter
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from sandbox_agent_runtime.application_lifecycle import ApplicationLifecycleManager
from sandbox_agent_runtime.memory.operations import (
    memory_get,
    memory_search,
    memory_status,
    memory_sync,
    memory_upsert,
)
from sandbox_agent_runtime.proactive_bridge import (
    HttpPollingLocalBridgeReceiver,
    LocalRuntimeProactiveBridgeExecutor,
    RemoteBridgeWorker,
    bridge_enabled,
    bridge_max_items,
    bridge_poll_interval_seconds,
)
from sandbox_agent_runtime.product_config import (
    opencode_config_path,
    resolve_product_runtime_config,
    runtime_config_status,
    update_runtime_config,
    write_opencode_bootstrap_config_if_available,
)
from sandbox_agent_runtime.runner import (
    RunnerOutputEvent,
    RunnerRequest,
    _ensure_opencode_sidecar_ready,
    _opencode_base_url,
    _workspace_mcp_is_ready,
)
from sandbox_agent_runtime.runtime_config.application_loader import _parse_app_runtime_yaml
from sandbox_agent_runtime.runtime_local_state import (
    append_output_event,
    claim_inputs,
    create_cronjob,
    create_output,
    create_output_folder,
    create_session_artifact,
    create_task_proposal,
    delete_cronjob,
    delete_output,
    delete_output_folder,
    enqueue_input,
    ensure_runtime_state,
    get_binding,
    get_cronjob,
    get_output,
    get_output_counts,
    get_output_folder,
    get_runtime_state,
    get_task_proposal,
    get_workspace,
    has_available_inputs_for_session,
    insert_session_message,
    latest_output_event_id,
    list_cronjobs,
    list_output_events,
    list_output_folders,
    list_outputs,
    list_runtime_states,
    list_session_artifacts,
    list_session_messages,
    list_sessions_with_artifacts,
    list_task_proposals,
    list_unreviewed_task_proposals,
    update_cronjob,
    update_input,
    update_output,
    update_output_folder,
    update_runtime_state,
    update_task_proposal_state,
    upsert_binding,
)
from sandbox_agent_runtime.runtime_local_state import (
    create_workspace as create_local_workspace,
)
from sandbox_agent_runtime.runtime_local_state import (
    delete_workspace as delete_local_workspace,
)
from sandbox_agent_runtime.runtime_local_state import (
    list_workspaces as list_local_workspaces,
)
from sandbox_agent_runtime.runtime_local_state import (
    update_workspace as update_local_workspace,
)
from sandbox_agent_runtime.workspace_scope import WORKSPACE_ROOT, workspace_dir_for_id

logging.basicConfig(level=os.getenv("SANDBOX_AGENT_LOG_LEVEL", "INFO"))
logger = logging.getLogger("sandbox_agent_api")

app = FastAPI(title="holaboss-sandbox-agent", version="0.1.0")

_DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE = (
    "cd {runtime_app_root} && {runtime_python} -m sandbox_agent_runtime.runner --request-base64 {request_base64}"
)
_TERMINAL_EVENT_TYPES = {"run_completed", "run_failed"}
_ONBOARD_PROMPT_HEADER = "[Holaboss Workspace Onboarding v1]"
_RUNTIME_EXEC_CONTEXT_KEY = "_sandbox_runtime_exec_v1"
_RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY = "model_proxy_api_key"
_RUNTIME_EXEC_SANDBOX_ID_KEY = "sandbox_id"
_DEFAULT_OUTPUT_STREAM_POLL_INTERVAL_S = 0.05


@dataclass
class _LocalWorkerState:
    stop_event: asyncio.Event
    wake_event: asyncio.Event
    task: asyncio.Task[Any] | None = None


@dataclass
class _CronSchedulerState:
    stop_event: asyncio.Event
    task: asyncio.Task[Any] | None = None


@dataclass
class _RemoteBridgeState:
    stop_event: asyncio.Event
    task: asyncio.Task[Any] | None = None


@dataclass(frozen=True)
class _RunnerExecutionResult:
    events: list[RunnerOutputEvent]
    skipped_lines: list[str]
    stderr: str
    return_code: int
    saw_terminal: bool


def _output_stream_poll_interval_seconds() -> float:
    raw = (os.getenv("SANDBOX_OUTPUT_STREAM_POLL_INTERVAL_S") or "").strip()
    if not raw:
        return _DEFAULT_OUTPUT_STREAM_POLL_INTERVAL_S
    with suppress(ValueError):
        return min(max(float(raw), 0.01), 1.0)
    return _DEFAULT_OUTPUT_STREAM_POLL_INTERVAL_S


class WorkspaceAgentRunResponse(BaseModel):
    session_id: str
    input_id: str
    events: list[RunnerOutputEvent]


class QueueSessionInputRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    holaboss_user_id: str | None = None
    image_urls: list[str] | None = None
    session_id: str | None = None
    idempotency_key: str | None = None
    priority: int = 0
    model: str | None = None


class LocalWorkspaceCreateRequest(BaseModel):
    workspace_id: str | None = None
    name: str = Field(..., min_length=1)
    harness: str = Field(..., min_length=1)
    status: str = "provisioning"
    main_session_id: str | None = None
    error_message: str | None = None
    onboarding_status: str = "not_required"
    onboarding_session_id: str | None = None
    onboarding_completed_at: str | None = None
    onboarding_completion_summary: str | None = None
    onboarding_requested_at: str | None = None
    onboarding_requested_by: str | None = None


class LocalWorkspaceUpdateRequest(BaseModel):
    status: str | None = None
    main_session_id: str | None = None
    error_message: str | None = None
    deleted_at_utc: str | None = None
    onboarding_status: str | None = None
    onboarding_session_id: str | None = None
    onboarding_completed_at: str | None = None
    onboarding_completion_summary: str | None = None
    onboarding_requested_at: str | None = None
    onboarding_requested_by: str | None = None


class ExecSandboxRequest(BaseModel):
    command: str = Field(..., min_length=1)
    timeout_s: int = Field(default=120, ge=1, le=1800)


class QueueSessionInputResponse(BaseModel):
    input_id: str
    session_id: str
    status: str


class AgentSessionStateResponse(BaseModel):
    effective_state: str
    runtime_status: str | None
    current_input_id: str | None
    heartbeat_at: str | None
    lease_until: str | None


class SessionRuntimeStateListResponse(BaseModel):
    items: list[dict[str, Any]]
    count: int


class SessionHistoryResponse(BaseModel):
    workspace_id: str
    session_id: str
    harness: str
    harness_session_id: str
    source: str
    main_session_id: str | None
    is_main_session: bool
    messages: list[dict[str, Any]]
    count: int
    total: int
    limit: int
    offset: int
    raw: Any | None = None


class SessionArtifactListResponse(BaseModel):
    items: list[dict[str, Any]]
    count: int


class SessionWithArtifactsListResponse(BaseModel):
    items: list[dict[str, Any]]
    count: int


class LocalSessionArtifactCreateRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    artifact_type: str = Field(..., min_length=1)
    external_id: str = Field(..., min_length=1)
    platform: str | None = None
    title: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class LocalWorkspaceListResponse(BaseModel):
    items: list[dict[str, Any]]
    total: int
    limit: int
    offset: int


class MemorySearchRequest(BaseModel):
    workspace_id: str
    query: str
    max_results: int = 6
    min_score: float = 0.0


class MemoryGetRequest(BaseModel):
    workspace_id: str
    path: str
    from_line: int | None = None
    lines: int | None = None


class MemoryUpsertRequest(BaseModel):
    workspace_id: str
    path: str
    content: str
    append: bool = False


class MemoryStatusRequest(BaseModel):
    workspace_id: str


class MemorySyncRequest(BaseModel):
    workspace_id: str
    reason: str = "manual"
    force: bool = False


class RuntimeConfigResponse(BaseModel):
    config_path: str | None
    loaded_from_file: bool
    auth_token_present: bool
    user_id: str | None = None
    sandbox_id: str | None = None
    model_proxy_base_url: str | None = None
    default_model: str | None = None
    runtime_mode: str | None = None
    default_provider: str | None = None
    holaboss_enabled: bool = False
    desktop_browser_enabled: bool = False
    desktop_browser_url: str | None = None


class RuntimeStatusResponse(BaseModel):
    harness: str
    config_loaded: bool
    config_path: str | None = None
    opencode_config_present: bool = False
    harness_ready: bool = False
    harness_state: str
    browser_available: bool = False
    browser_state: str = "unavailable"
    browser_url: str | None = None


class RuntimeConfigUpdateRequest(BaseModel):
    auth_token: str | None = None
    user_id: str | None = None
    sandbox_id: str | None = None
    model_proxy_base_url: str | None = None
    default_model: str | None = None
    runtime_mode: str | None = None
    default_provider: str | None = None
    holaboss_enabled: bool | None = None
    desktop_browser_enabled: bool | None = None
    desktop_browser_url: str | None = None


class LocalOutputCreateRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    output_type: str = Field(..., min_length=1)
    title: str = ""
    module_id: str | None = None
    module_resource_id: str | None = None
    file_path: str | None = None
    html_content: str | None = None
    session_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    artifact_id: str | None = None
    folder_id: str | None = None
    platform: str | None = None


class LocalOutputUpdateRequest(BaseModel):
    title: str | None = None
    status: str | None = None
    module_resource_id: str | None = None
    file_path: str | None = None
    html_content: str | None = None
    metadata: dict[str, Any] | None = None
    folder_id: str | None = None


class LocalOutputListResponse(BaseModel):
    items: list[dict[str, Any]]


class LocalOutputFolderCreateRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)


class LocalOutputFolderUpdateRequest(BaseModel):
    name: str | None = None
    position: int | None = None


class LocalCronjobCreateRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    initiated_by: str = Field(..., min_length=1)
    name: str = ""
    cron: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    enabled: bool = True
    delivery: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class LocalCronjobUpdateRequest(BaseModel):
    name: str | None = None
    cron: str | None = None
    description: str | None = None
    enabled: bool | None = None
    delivery: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class LocalOutputFolderListResponse(BaseModel):
    items: list[dict[str, Any]]


class LocalCronjobListResponse(BaseModel):
    jobs: list[dict[str, Any]]
    count: int


class LocalTaskProposalCreateRequest(BaseModel):
    proposal_id: str = Field(..., min_length=1)
    workspace_id: str = Field(..., min_length=1)
    task_name: str = Field(..., min_length=1)
    task_prompt: str = Field(..., min_length=1)
    task_generation_rationale: str = Field(..., min_length=1)
    source_event_ids: list[str] = Field(default_factory=list)
    created_at: str = Field(..., min_length=1)
    state: str = "not_reviewed"


class LocalTaskProposalStateUpdateRequest(BaseModel):
    state: str = Field(..., min_length=1)


class LocalTaskProposalListResponse(BaseModel):
    proposals: list[dict[str, Any]]
    count: int


def _sse_comment(text: str) -> bytes:
    return f": {text}\n\n".encode()


def _workspace_record_payload(workspace: Any) -> dict[str, Any]:
    return {
        "id": workspace.id,
        "name": workspace.name,
        "status": workspace.status,
        "harness": workspace.harness,
        "main_session_id": workspace.main_session_id,
        "error_message": workspace.error_message,
        "onboarding_status": workspace.onboarding_status,
        "onboarding_session_id": workspace.onboarding_session_id,
        "onboarding_completed_at": workspace.onboarding_completed_at,
        "onboarding_completion_summary": workspace.onboarding_completion_summary,
        "onboarding_requested_at": workspace.onboarding_requested_at,
        "onboarding_requested_by": workspace.onboarding_requested_by,
        "created_at": workspace.created_at,
        "updated_at": workspace.updated_at,
        "deleted_at_utc": workspace.deleted_at_utc,
    }


def _output_type_for_artifact(artifact_type: str) -> str:
    return {
        "draft": "post",
        "image": "file",
        "document": "document",
        "html": "html",
    }.get(artifact_type, "document")


def _local_worker_state() -> _LocalWorkerState:
    state = getattr(app.state, "local_worker_state", None)
    if state is None:
        state = _LocalWorkerState(stop_event=asyncio.Event(), wake_event=asyncio.Event())
        app.state.local_worker_state = state
    return state


def _cron_scheduler_state() -> _CronSchedulerState:
    state = getattr(app.state, "cron_scheduler_state", None)
    if state is None:
        state = _CronSchedulerState(stop_event=asyncio.Event())
        app.state.cron_scheduler_state = state
    return state


def _remote_bridge_state() -> _RemoteBridgeState:
    state = getattr(app.state, "remote_bridge_state", None)
    if state is None:
        state = _RemoteBridgeState(stop_event=asyncio.Event())
        app.state.remote_bridge_state = state
    return state


@app.on_event("startup")
async def startup_local_worker() -> None:
    state = _local_worker_state()
    state.stop_event.clear()
    if state.task is None or state.task.done():
        state.task = asyncio.create_task(_local_worker_loop())
    cron_state = _cron_scheduler_state()
    cron_state.stop_event.clear()
    if cron_state.task is None or cron_state.task.done():
        cron_state.task = asyncio.create_task(_cron_scheduler_loop())
    bridge_state = _remote_bridge_state()
    bridge_state.stop_event.clear()
    if bridge_enabled() and (bridge_state.task is None or bridge_state.task.done()):
        receiver = HttpPollingLocalBridgeReceiver.from_environment()
        bridge_state.task = asyncio.create_task(
            RemoteBridgeWorker(
                receiver=receiver,
                executor=LocalRuntimeProactiveBridgeExecutor(),
                stop_event=bridge_state.stop_event,
                poll_interval_seconds=bridge_poll_interval_seconds(),
                max_items=bridge_max_items(),
            ).run_forever()
        )
    elif not bridge_enabled():
        logger.info("Remote proactive bridge disabled in local runtime")


@app.on_event("shutdown")
async def shutdown_local_worker() -> None:
    state = _local_worker_state()
    state.stop_event.set()
    state.wake_event.set()
    task = state.task
    state.task = None
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    cron_state = _cron_scheduler_state()
    cron_state.stop_event.set()
    cron_task = cron_state.task
    cron_state.task = None
    if cron_task is not None:
        cron_task.cancel()
        with suppress(asyncio.CancelledError):
            await cron_task
    bridge_state = _remote_bridge_state()
    bridge_state.stop_event.set()
    bridge_task = bridge_state.task
    bridge_state.task = None
    if bridge_task is not None:
        bridge_task.cancel()
        with suppress(asyncio.CancelledError):
            await bridge_task


def _selected_harness() -> str:
    configured = (os.getenv("SANDBOX_AGENT_HARNESS") or "").strip().lower()
    if configured:
        return configured
    return "opencode"


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


def _resolve_queue_session_id(*, requested_session_id: str | None, workspace: Any) -> str:
    if requested_session_id and requested_session_id.strip():
        return requested_session_id.strip()
    onboarding_status = (workspace.onboarding_status or "").strip().lower()
    if onboarding_status in {"pending", "awaiting_confirmation"} and workspace.onboarding_session_id:
        return workspace.onboarding_session_id
    if workspace.main_session_id:
        return workspace.main_session_id
    raise HTTPException(status_code=409, detail="workspace main_session_id is not configured")


def _build_onboarding_instruction(*, workspace_id: str, session_id: str, text: str, workspace: Any) -> str:
    trimmed = text.strip()
    if not trimmed:
        raise HTTPException(status_code=422, detail="text is required")
    onboarding_status = (workspace.onboarding_status or "").strip().lower()
    onboarding_session_id = (workspace.onboarding_session_id or "").strip()
    if onboarding_status not in {"pending", "awaiting_confirmation"} or onboarding_session_id != session_id:
        return trimmed

    onboard_path = Path(WORKSPACE_ROOT) / workspace_id / "ONBOARD.md"
    if not onboard_path.exists():
        return trimmed
    onboard_prompt = onboard_path.read_text(encoding="utf-8").strip()
    if not onboard_prompt or trimmed.startswith(_ONBOARD_PROMPT_HEADER):
        return trimmed
    return "\n".join([
        _ONBOARD_PROMPT_HEADER,
        "- You are in onboarding mode for this workspace.",
        f"- The workspace directory is ./{workspace_id} relative to the current working directory.",
        f"- The onboarding guide file is ./{workspace_id}/ONBOARD.md (absolute path: {onboard_path}).",
        "- Use that workspace-scoped ONBOARD.md to drive the conversation and gather required details.",
        "- ONBOARD.md content is already included below; do not re-read it unless needed.",
        f"- If file reads are needed, use ./{workspace_id}/... paths rather than files directly under {WORKSPACE_ROOT}.",
        "- Ask concise questions and collect durable facts/preferences.",
        "- Do not start regular execution work until onboarding is complete.",
        "- When all onboarding requirements are satisfied and the user confirms, invoke the `hb` CLI tool with `onboarding request-complete`.",
        "- Do not merely output or quote the command as text; actually execute the tool.",
        "",
        "[ONBOARD.md]",
        onboard_prompt,
        "[/ONBOARD.md]",
        "",
        trimmed,
    ]).strip()


def _ensure_local_binding(*, workspace_id: str, session_id: str, harness: str) -> str:
    existing = get_binding(workspace_id=workspace_id, session_id=session_id)
    if existing is not None and existing.harness_session_id.strip():
        return existing.harness_session_id
    binding = upsert_binding(
        workspace_id=workspace_id,
        session_id=session_id,
        harness=harness,
        harness_session_id=session_id,
    )
    return binding.harness_session_id


async def _process_claimed_input(record) -> None:
    workspace = get_workspace(record.workspace_id)
    if workspace is None:
        update_input(record.input_id, status="FAILED")
        update_runtime_state(
            workspace_id=record.workspace_id,
            session_id=record.session_id,
            status="ERROR",
            current_input_id=None,
            last_error={"message": "workspace not found"},
        )
        return

    harness = (workspace.harness or _selected_harness()).strip().lower() or _selected_harness()
    harness_session_id = _ensure_local_binding(
        workspace_id=record.workspace_id,
        session_id=record.session_id,
        harness=harness,
    )
    instruction = _build_onboarding_instruction(
        workspace_id=record.workspace_id,
        session_id=record.session_id,
        text=str(record.payload.get("text") or ""),
        workspace=workspace,
    )
    update_runtime_state(
        workspace_id=record.workspace_id,
        session_id=record.session_id,
        status="BUSY",
        current_input_id=record.input_id,
        current_worker_id="sandbox-agent-local-worker",
        heartbeat_at=None,
        last_error=None,
    )

    runtime_context = dict(record.payload.get("context") or {})
    prior_runtime_context = dict(runtime_context.get(_RUNTIME_EXEC_CONTEXT_KEY) or {})
    runtime_binding = resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    )
    if (
        not str(prior_runtime_context.get(_RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY) or "").strip()
        and runtime_binding.auth_token
    ):
        prior_runtime_context[_RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY] = runtime_binding.auth_token
    if not str(prior_runtime_context.get(_RUNTIME_EXEC_SANDBOX_ID_KEY) or "").strip() and runtime_binding.sandbox_id:
        prior_runtime_context[_RUNTIME_EXEC_SANDBOX_ID_KEY] = runtime_binding.sandbox_id
    prior_runtime_context["harness"] = harness
    prior_runtime_context["harness_session_id"] = harness_session_id
    runtime_context[_RUNTIME_EXEC_CONTEXT_KEY] = prior_runtime_context

    payload = RunnerRequest(
        workspace_id=record.workspace_id,
        session_id=record.session_id,
        input_id=record.input_id,
        instruction=instruction,
        context=runtime_context,
        model=str(record.payload.get("model")) if record.payload.get("model") is not None else None,
        debug=False,
    )

    assistant_parts: list[str] = []
    try:
        terminal_status = "WAITING_USER"
        last_error: dict[str, Any] | None = None
        last_sequence = 0

        async def _handle_event(event: RunnerOutputEvent) -> None:
            nonlocal terminal_status, last_error, last_sequence
            event_sequence = int(event.sequence)
            last_sequence = max(last_sequence, event_sequence)
            append_output_event(
                workspace_id=record.workspace_id,
                session_id=record.session_id,
                input_id=record.input_id,
                sequence=event_sequence,
                event_type=event.event_type,
                payload=event.payload,
                created_at=event.timestamp.isoformat(),
            )
            if event.event_type == "output_delta":
                delta = event.payload.get("delta")
                if isinstance(delta, str):
                    assistant_parts.append(delta)
            if event.event_type == "run_failed":
                terminal_status = "ERROR"
                last_error = event.payload

        execution = await _execute_runner_request(payload, on_event=_handle_event)
        if not execution.saw_terminal:
            if execution.return_code != 0:
                failure_event = _build_run_failed_event(
                    session_id=record.session_id,
                    input_id=record.input_id,
                    sequence=last_sequence + 1,
                    message=execution.stderr.strip() or f"runner command failed with exit_code={execution.return_code}",
                    error_type="RunnerCommandError",
                )
            else:
                details = "; ".join(execution.skipped_lines[:3]) if execution.skipped_lines else ""
                suffix = f" (skipped output: {details})" if details else ""
                failure_event = _build_run_failed_event(
                    session_id=record.session_id,
                    input_id=record.input_id,
                    sequence=last_sequence + 1,
                    message=f"runner ended before terminal event{suffix}",
                )
            await _handle_event(failure_event)

        update_input(record.input_id, status="DONE" if terminal_status != "ERROR" else "FAILED", claimed_until=None)
        update_runtime_state(
            workspace_id=record.workspace_id,
            session_id=record.session_id,
            status=terminal_status,
            current_input_id=None,
            current_worker_id=None,
            heartbeat_at=None,
            last_error=last_error,
        )
        assistant_text = "".join(assistant_parts).strip()
        if assistant_text:
            insert_session_message(
                workspace_id=record.workspace_id,
                session_id=record.session_id,
                role="assistant",
                text=assistant_text,
                message_id=f"assistant-{record.input_id}",
            )
    except Exception as exc:
        update_input(record.input_id, status="FAILED", claimed_until=None)
        failure_payload = {"message": str(exc)}
        append_output_event(
            workspace_id=record.workspace_id,
            session_id=record.session_id,
            input_id=record.input_id,
            sequence=1,
            event_type="run_failed",
            payload=failure_payload,
        )
        update_runtime_state(
            workspace_id=record.workspace_id,
            session_id=record.session_id,
            status="ERROR",
            current_input_id=None,
            current_worker_id=None,
            heartbeat_at=None,
            last_error=failure_payload,
        )


async def _local_worker_loop() -> None:
    state = _local_worker_state()
    while not state.stop_event.is_set():
        claimed = claim_inputs(limit=1, claimed_by="sandbox-agent-local-worker", lease_seconds=300)
        if not claimed:
            state.wake_event.clear()
            try:
                await asyncio.wait_for(state.wake_event.wait(), timeout=1.0)
            except TimeoutError:
                continue
            continue
        for record in claimed:
            await _process_claimed_input(record)


def _cronjob_check_interval_seconds() -> int:
    raw = (os.getenv("CRONJOB_RUNNER_CHECK_INTERVAL_SECONDS") or "60").strip()
    try:
        value = int(raw)
    except ValueError:
        return 60
    return max(5, value)


def _cronjob_next_run_at(*, cron_expression: str, now: datetime) -> str | None:
    try:
        return croniter(cron_expression, now).get_next(datetime).astimezone(UTC).isoformat()
    except Exception:
        return None


def _cronjob_is_due(job: dict[str, Any], *, now: datetime) -> bool:
    if not bool(job.get("enabled")):
        return False
    try:
        last_scheduled = croniter(str(job["cron"]), now).get_prev(datetime)
    except Exception:
        return False
    last_run_at_raw = job.get("last_run_at")
    if last_run_at_raw is None:
        return True
    try:
        normalized = str(last_run_at_raw).replace("Z", "+00:00")
        last_run_at = datetime.fromisoformat(normalized)
        if last_run_at.tzinfo is None:
            last_run_at = last_run_at.replace(tzinfo=UTC)
    except Exception:
        return True
    return last_run_at < last_scheduled


def _cronjob_instruction(*, description: str, metadata: dict[str, Any]) -> str:
    cleaned_description = description.strip()
    execution_metadata = {
        key: value
        for key, value in (metadata or {}).items()
        if key not in {"model", "session_id", "priority", "idempotency_key"}
    }
    if not execution_metadata:
        return cleaned_description
    return f"{cleaned_description}\n\n[Cronjob Metadata]\n{execution_metadata}"


def _queue_local_cronjob_run(job: dict[str, Any], *, now: datetime) -> None:
    workspace_id = str(job["workspace_id"])
    workspace = get_workspace(workspace_id)
    if workspace is None:
        raise RuntimeError(f"workspace not found for cronjob {job['id']}")
    metadata = job.get("metadata")
    resolved_metadata = metadata if isinstance(metadata, dict) else {}
    resolved_session_id = str(resolved_metadata.get("session_id") or uuid4())
    model = resolved_metadata.get("model")
    priority = resolved_metadata.get("priority") if isinstance(resolved_metadata.get("priority"), int) else 0
    idempotency_key = resolved_metadata.get("idempotency_key")
    ensure_runtime_state(
        workspace_id=workspace_id,
        session_id=resolved_session_id,
        status="QUEUED",
    )
    record = enqueue_input(
        workspace_id=workspace_id,
        session_id=resolved_session_id,
        priority=priority,
        idempotency_key=idempotency_key if isinstance(idempotency_key, str) else None,
        payload={
            "text": _cronjob_instruction(description=str(job["description"]), metadata=resolved_metadata),
            "image_urls": [],
            "model": model if isinstance(model, str) else None,
            "context": {
                "source": "cronjob",
                "cronjob_id": str(job["id"]),
            },
        },
    )
    insert_session_message(
        workspace_id=workspace_id,
        session_id=resolved_session_id,
        role="user",
        text=_cronjob_instruction(description=str(job["description"]), metadata=resolved_metadata),
        message_id=f"cronjob-{job['id']}-{record.input_id}",
    )
    update_runtime_state(
        workspace_id=workspace_id,
        session_id=resolved_session_id,
        status="QUEUED",
        current_input_id=record.input_id,
        current_worker_id=None,
        lease_until=None,
        heartbeat_at=now.isoformat(),
        last_error=None,
    )
    _local_worker_state().wake_event.set()


async def _cron_scheduler_loop() -> None:
    state = _cron_scheduler_state()
    interval = _cronjob_check_interval_seconds()
    while not state.stop_event.is_set():
        now = datetime.now(UTC)
        for job in list_cronjobs(enabled_only=True):
            if not _cronjob_is_due(job, now=now):
                continue
            status = "success"
            error: str | None = None
            try:
                delivery = job.get("delivery")
                channel = delivery.get("channel") if isinstance(delivery, dict) else None
                if channel == "session_run":
                    _queue_local_cronjob_run(job, now=now)
                elif channel == "system_notification":
                    logger.info(
                        "Cronjob system_notification delivery is currently a no-op placeholder",
                        extra={
                            "event": "cronjob.delivery.system_notification",
                            "outcome": "noop",
                            "cronjob_id": str(job["id"]),
                            "workspace_id": str(job["workspace_id"]),
                        },
                    )
                else:
                    raise ValueError(f"unsupported cronjob delivery channel: {channel}")
            except Exception as exc:
                status = "failed"
                error = str(exc)
                logger.exception(
                    "Cronjob execution failed",
                    extra={
                        "event": "cronjob.execution",
                        "outcome": "error",
                        "cronjob_id": str(job["id"]),
                        "workspace_id": str(job["workspace_id"]),
                    },
                )
            update_cronjob(
                job_id=str(job["id"]),
                last_run_at=now.isoformat(),
                next_run_at=_cronjob_next_run_at(cron_expression=str(job["cron"]), now=now),
                run_count=int(job.get("run_count") or 0) + (1 if status == "success" else 0),
                last_status=status,
                last_error=error,
            )
        try:
            await asyncio.wait_for(state.stop_event.wait(), timeout=interval)
        except TimeoutError:
            continue


def _agent_runner_timeout_seconds() -> int:
    raw = os.getenv("SANDBOX_AGENT_RUN_TIMEOUT_S", "1800").strip()
    try:
        value = int(raw)
    except ValueError:
        return 1800
    return max(1, min(value, 7200))


def _agent_runner_command(payload: RunnerRequest) -> str:
    request_json = payload.model_dump_json(exclude_none=False)
    encoded = base64.b64encode(request_json.encode("utf-8")).decode("utf-8")
    runtime_app_root = os.getenv("HOLABOSS_RUNTIME_APP_ROOT", "/app")
    runtime_python = os.getenv("HOLABOSS_RUNTIME_PYTHON", "/opt/venv/bin/python")
    template = os.getenv("SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE", _DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE)
    try:
        return template.format(
            request_base64=shlex.quote(encoded),
            runtime_app_root=shlex.quote(runtime_app_root),
            runtime_python=shlex.quote(runtime_python),
        )
    except Exception as exc:  # pragma: no cover - defensive env misconfiguration path
        raise HTTPException(status_code=500, detail=f"invalid SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE: {exc}") from exc


def _build_run_failed_event(
    *,
    session_id: str,
    input_id: str,
    sequence: int,
    message: str,
    error_type: str = "RuntimeError",
) -> RunnerOutputEvent:
    return RunnerOutputEvent(
        session_id=session_id,
        input_id=input_id,
        sequence=sequence,
        event_type="run_failed",
        payload={
            "type": error_type,
            "message": message,
        },
    )


def _sse_event(*, event: RunnerOutputEvent) -> bytes:
    event_name = event.event_type
    event_id = f"{event.input_id}:{event.sequence}"
    lines = [f"event: {event_name}", f"id: {event_id}", f"data: {event.model_dump_json()}"]
    return ("\n".join(lines) + "\n\n").encode("utf-8")


def _normalize_event(raw_event: Any) -> RunnerOutputEvent | None:
    if not isinstance(raw_event, dict):
        return None
    try:
        return RunnerOutputEvent.model_validate(raw_event)
    except Exception:
        return None


def _parse_runner_output_lines(stdout: str) -> tuple[list[RunnerOutputEvent], list[str]]:
    events: list[RunnerOutputEvent] = []
    skipped_lines: list[str] = []
    for raw_line in stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            skipped_lines.append(line)
            continue
        normalized = _normalize_event(payload)
        if normalized is None:
            skipped_lines.append(line)
            continue
        events.append(normalized)
    return events, skipped_lines


@app.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/v1/runtime/config")
async def get_runtime_config() -> RuntimeConfigResponse:
    try:
        return RuntimeConfigResponse.model_validate(runtime_config_status())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/v1/runtime/status")
async def get_runtime_status() -> RuntimeStatusResponse:
    try:
        return await _runtime_status_payload()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/api/v1/runtime/config")
async def put_runtime_config(payload: RuntimeConfigUpdateRequest) -> RuntimeConfigResponse:
    try:
        update_runtime_config(
            auth_token=payload.auth_token,
            user_id=payload.user_id,
            sandbox_id=payload.sandbox_id,
            model_proxy_base_url=payload.model_proxy_base_url,
            default_model_value=payload.default_model,
            runtime_mode_value=payload.runtime_mode,
            default_provider_value=payload.default_provider,
            holaboss_enabled_value=payload.holaboss_enabled,
            desktop_browser_enabled_value=payload.desktop_browser_enabled,
            desktop_browser_url_value=payload.desktop_browser_url,
        )
        if _selected_harness() == "opencode":
            write_opencode_bootstrap_config_if_available()
            await _ensure_selected_harness_ready()
        return RuntimeConfigResponse.model_validate(runtime_config_status())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/workspaces")
async def create_local_workspace_endpoint(payload: LocalWorkspaceCreateRequest) -> dict[str, Any]:
    workspace = create_local_workspace(
        workspace_id=payload.workspace_id,
        name=payload.name,
        harness=payload.harness,
        status=payload.status,
        main_session_id=payload.main_session_id,
        onboarding_status=payload.onboarding_status,
        onboarding_session_id=payload.onboarding_session_id,
        error_message=payload.error_message,
    )
    if payload.onboarding_completed_at is not None or payload.onboarding_completion_summary is not None:
        workspace = update_local_workspace(
            workspace.id,
            onboarding_completed_at=payload.onboarding_completed_at,
            onboarding_completion_summary=payload.onboarding_completion_summary,
            onboarding_requested_at=payload.onboarding_requested_at,
            onboarding_requested_by=payload.onboarding_requested_by,
        )
    return {"workspace": _workspace_record_payload(workspace)}


@app.get("/api/v1/workspaces")
async def list_local_workspaces_endpoint(
    status: str | None = Query(None),
    include_deleted: bool = Query(False),
    limit: int = Query(50, ge=1),
    offset: int = Query(0, ge=0),
) -> LocalWorkspaceListResponse:
    items = list_local_workspaces(include_deleted=include_deleted)
    if status:
        items = [item for item in items if item.status == status]
    total = len(items)
    paged = items[offset : offset + limit]
    return LocalWorkspaceListResponse(
        items=[_workspace_record_payload(item) for item in paged],
        total=total,
        limit=limit,
        offset=offset,
    )


@app.get("/api/v1/workspaces/{workspace_id}")
async def get_local_workspace_endpoint(
    workspace_id: str,
    include_deleted: bool = Query(False),
) -> dict[str, Any]:
    workspace = get_workspace(workspace_id, include_deleted=include_deleted)
    if workspace is None:
        raise HTTPException(status_code=404, detail="workspace not found")
    return {"workspace": _workspace_record_payload(workspace)}


@app.patch("/api/v1/workspaces/{workspace_id}")
async def update_local_workspace_endpoint(
    workspace_id: str,
    payload: LocalWorkspaceUpdateRequest,
) -> dict[str, Any]:
    try:
        workspace = update_local_workspace(
            workspace_id,
            **payload.model_dump(exclude_unset=True),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="workspace not found") from exc
    return {"workspace": _workspace_record_payload(workspace)}


@app.delete("/api/v1/workspaces/{workspace_id}")
async def delete_local_workspace_endpoint(workspace_id: str) -> dict[str, Any]:
    try:
        workspace = delete_local_workspace(workspace_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="workspace not found") from exc
    return {"workspace": _workspace_record_payload(workspace)}


@app.post("/api/v1/sandbox/users/{holaboss_user_id}/workspaces/{workspace_id}/exec")
async def exec_local_workspace(
    holaboss_user_id: str,
    workspace_id: str,
    payload: ExecSandboxRequest,
) -> dict[str, Any]:
    del holaboss_user_id
    workspace = get_workspace(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="workspace not found")

    workspace_dir = Path(WORKSPACE_ROOT) / workspace_id
    workspace_dir.mkdir(parents=True, exist_ok=True)
    process = await asyncio.create_subprocess_exec(
        "/bin/bash",
        "-lc",
        payload.command,
        cwd=str(workspace_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    if process.stdout is None or process.stderr is None:
        raise HTTPException(status_code=500, detail="workspace exec streams were not initialized")

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=max(1, payload.timeout_s))
    except TimeoutError as exc:
        process.kill()
        with suppress(Exception):
            await process.wait()
        raise HTTPException(status_code=504, detail="workspace exec timed out") from exc

    return {
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
        "returncode": int(process.returncode or 0),
    }


@app.post("/api/v1/agent-sessions/queue")
async def queue_session_input(payload: QueueSessionInputRequest) -> QueueSessionInputResponse:
    workspace = get_workspace(payload.workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="workspace not found")

    resolved_session_id = _resolve_queue_session_id(
        requested_session_id=payload.session_id,
        workspace=workspace,
    )
    ensure_runtime_state(
        workspace_id=payload.workspace_id,
        session_id=resolved_session_id,
        status="QUEUED",
    )
    record = enqueue_input(
        workspace_id=payload.workspace_id,
        session_id=resolved_session_id,
        priority=payload.priority,
        idempotency_key=payload.idempotency_key,
        payload={
            "text": payload.text.strip(),
            "image_urls": payload.image_urls or [],
            "model": payload.model,
            "context": {},
        },
    )
    insert_session_message(
        workspace_id=payload.workspace_id,
        session_id=resolved_session_id,
        role="user",
        text=payload.text.strip(),
        message_id=f"user-{record.input_id}",
    )
    update_runtime_state(
        workspace_id=payload.workspace_id,
        session_id=resolved_session_id,
        status="QUEUED",
        current_input_id=record.input_id,
        current_worker_id=None,
        lease_until=None,
        heartbeat_at=None,
        last_error=None,
    )
    state = _local_worker_state()
    state.wake_event.set()
    return QueueSessionInputResponse(
        input_id=record.input_id,
        session_id=record.session_id,
        status=record.status,
    )


@app.get("/api/v1/agent-sessions/{session_id}/state")
async def get_local_session_state(
    session_id: str,
    workspace_id: str | None = Query(None),
    profile_id: str | None = Query(None),
) -> AgentSessionStateResponse:
    if workspace_id and profile_id and workspace_id != profile_id:
        raise HTTPException(status_code=422, detail="workspace_id and profile_id must match when both are provided")
    resolved_workspace_id = workspace_id or profile_id
    runtime_state = get_runtime_state(session_id=session_id, workspace_id=resolved_workspace_id)
    runtime_status = str(runtime_state["status"]) if runtime_state is not None else None
    if runtime_status in {"BUSY", "WAITING_USER", "ERROR"}:
        effective_state = runtime_status
    else:
        has_queued = has_available_inputs_for_session(session_id=session_id, workspace_id=resolved_workspace_id)
        if has_queued:
            effective_state = "QUEUED"
        elif runtime_status:
            effective_state = runtime_status
        else:
            effective_state = "IDLE"

    return AgentSessionStateResponse(
        effective_state=effective_state,
        runtime_status=runtime_status,
        current_input_id=str(runtime_state["current_input_id"])
        if runtime_state and runtime_state.get("current_input_id")
        else None,
        heartbeat_at=str(runtime_state["heartbeat_at"])
        if runtime_state and runtime_state.get("heartbeat_at")
        else None,
        lease_until=str(runtime_state["lease_until"]) if runtime_state and runtime_state.get("lease_until") else None,
    )


@app.get("/api/v1/agent-sessions/by-workspace/{workspace_id}/runtime-states")
async def list_workspace_runtime_states(
    workspace_id: str,
    limit: int = Query(100, ge=1),
    offset: int = Query(0, ge=0),
) -> SessionRuntimeStateListResponse:
    del limit, offset
    items = list_runtime_states(workspace_id)
    return SessionRuntimeStateListResponse(items=items, count=len(items))


@app.post("/api/v1/agent-sessions/{session_id}/artifacts")
async def create_local_session_artifact(
    session_id: str,
    payload: LocalSessionArtifactCreateRequest,
) -> dict[str, Any]:
    ensure_runtime_state(
        workspace_id=payload.workspace_id,
        session_id=session_id,
        status="IDLE",
    )
    artifact = create_session_artifact(
        session_id=session_id,
        workspace_id=payload.workspace_id,
        artifact_type=payload.artifact_type,
        external_id=payload.external_id,
        platform=payload.platform,
        title=payload.title,
        metadata=payload.metadata,
    )
    create_output(
        workspace_id=payload.workspace_id,
        output_type=_output_type_for_artifact(payload.artifact_type),
        title=payload.title or "",
        session_id=session_id,
        artifact_id=artifact["id"],
        platform=payload.platform,
        metadata=payload.metadata,
    )
    return {"artifact": artifact}


@app.get("/api/v1/agent-sessions/{session_id}/artifacts")
async def list_local_session_artifacts(
    session_id: str,
    workspace_id: str | None = Query(None),
    profile_id: str | None = Query(None),
) -> SessionArtifactListResponse:
    if workspace_id and profile_id and workspace_id != profile_id:
        raise HTTPException(status_code=422, detail="workspace_id and profile_id must match when both are provided")
    resolved_workspace_id = workspace_id or profile_id
    items = list_session_artifacts(session_id=session_id, workspace_id=resolved_workspace_id)
    return SessionArtifactListResponse(items=items, count=len(items))


@app.get("/api/v1/agent-sessions/by-workspace/{workspace_id}/with-artifacts")
async def list_local_sessions_with_artifacts(
    workspace_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> SessionWithArtifactsListResponse:
    items = list_sessions_with_artifacts(workspace_id=workspace_id, limit=limit, offset=offset)
    return SessionWithArtifactsListResponse(items=items, count=len(items))


@app.get("/api/v1/output-folders")
async def list_local_output_folders(workspace_id: str = Query(...)) -> LocalOutputFolderListResponse:
    return LocalOutputFolderListResponse(items=list_output_folders(workspace_id=workspace_id))


@app.post("/api/v1/output-folders")
async def create_local_output_folder(payload: LocalOutputFolderCreateRequest) -> dict[str, Any]:
    return {"folder": create_output_folder(workspace_id=payload.workspace_id, name=payload.name)}


@app.get("/api/v1/output-folders/{folder_id}")
async def get_local_output_folder_endpoint(folder_id: str) -> dict[str, Any]:
    folder = get_output_folder(folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return {"folder": folder}


@app.patch("/api/v1/output-folders/{folder_id}")
async def update_local_output_folder_endpoint(
    folder_id: str,
    payload: LocalOutputFolderUpdateRequest,
) -> dict[str, Any]:
    folder = update_output_folder(folder_id=folder_id, name=payload.name, position=payload.position)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return {"folder": folder}


@app.delete("/api/v1/output-folders/{folder_id}")
async def delete_local_output_folder_endpoint(folder_id: str) -> dict[str, bool]:
    deleted = delete_output_folder(folder_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Folder not found")
    return {"deleted": True}


@app.get("/api/v1/outputs")
async def list_local_outputs(
    workspace_id: str = Query(...),
    output_type: str | None = Query(None),
    status: str | None = Query(None),
    platform: str | None = Query(None),
    folder_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> LocalOutputListResponse:
    items = list_outputs(
        workspace_id=workspace_id,
        output_type=output_type,
        status=status,
        platform=platform,
        folder_id=folder_id,
        limit=limit,
        offset=offset,
    )
    return LocalOutputListResponse(items=items)


@app.get("/api/v1/outputs/counts")
async def get_local_output_counts(workspace_id: str = Query(...)) -> dict[str, Any]:
    return get_output_counts(workspace_id=workspace_id)


@app.get("/api/v1/outputs/{output_id}")
async def get_local_output(output_id: str) -> dict[str, Any]:
    output = get_output(output_id)
    if output is None:
        raise HTTPException(status_code=404, detail="Output not found")
    return {"output": output}


@app.post("/api/v1/outputs")
async def create_local_output_endpoint(payload: LocalOutputCreateRequest) -> dict[str, Any]:
    return {
        "output": create_output(
            workspace_id=payload.workspace_id,
            output_type=payload.output_type,
            title=payload.title,
            module_id=payload.module_id,
            module_resource_id=payload.module_resource_id,
            file_path=payload.file_path,
            html_content=payload.html_content,
            session_id=payload.session_id,
            artifact_id=payload.artifact_id,
            folder_id=payload.folder_id,
            platform=payload.platform,
            metadata=payload.metadata,
        )
    }


@app.patch("/api/v1/outputs/{output_id}")
async def update_local_output_endpoint(output_id: str, payload: LocalOutputUpdateRequest) -> dict[str, Any]:
    output = update_output(
        output_id=output_id,
        title=payload.title,
        status=payload.status,
        module_resource_id=payload.module_resource_id,
        file_path=payload.file_path,
        html_content=payload.html_content,
        metadata=payload.metadata,
        folder_id=payload.folder_id,
    )
    if output is None:
        raise HTTPException(status_code=404, detail="Output not found")
    return {"output": output}


@app.delete("/api/v1/outputs/{output_id}")
async def delete_local_output_endpoint(output_id: str) -> dict[str, bool]:
    deleted = delete_output(output_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Output not found")
    return {"deleted": True}


@app.get("/api/v1/cronjobs")
async def list_local_cronjobs(
    workspace_id: str = Query(...),
    enabled_only: bool = Query(False),
) -> LocalCronjobListResponse:
    jobs = list_cronjobs(workspace_id=workspace_id, enabled_only=enabled_only)
    return LocalCronjobListResponse(jobs=jobs, count=len(jobs))


@app.post("/api/v1/cronjobs")
async def create_local_cronjob_endpoint(payload: LocalCronjobCreateRequest) -> dict[str, Any]:
    if get_workspace(payload.workspace_id) is None:
        raise HTTPException(status_code=404, detail="workspace not found")
    job = create_cronjob(
        workspace_id=payload.workspace_id,
        initiated_by=payload.initiated_by,
        name=payload.name,
        cron=payload.cron,
        description=payload.description,
        enabled=payload.enabled,
        delivery=payload.delivery,
        metadata=payload.metadata,
        next_run_at=_cronjob_next_run_at(cron_expression=payload.cron, now=datetime.now(UTC)),
    )
    return job


@app.get("/api/v1/cronjobs/{job_id}")
async def get_local_cronjob_endpoint(job_id: str) -> dict[str, Any]:
    job = get_cronjob(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Cronjob not found")
    return job


@app.patch("/api/v1/cronjobs/{job_id}")
async def update_local_cronjob_endpoint(job_id: str, payload: LocalCronjobUpdateRequest) -> dict[str, Any]:
    job = update_cronjob(
        job_id=job_id,
        name=payload.name,
        cron=payload.cron,
        description=payload.description,
        enabled=payload.enabled,
        delivery=payload.delivery,
        metadata=payload.metadata,
        next_run_at=(
            _cronjob_next_run_at(cron_expression=payload.cron, now=datetime.now(UTC))
            if payload.cron is not None
            else None
        ),
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Cronjob not found")
    return job


@app.delete("/api/v1/cronjobs/{job_id}")
async def delete_local_cronjob_endpoint(job_id: str) -> dict[str, bool]:
    deleted = delete_cronjob(job_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Cronjob not found")
    return {"success": True}


@app.get("/api/v1/task-proposals")
async def list_local_task_proposals(workspace_id: str = Query(...)) -> LocalTaskProposalListResponse:
    proposals = list_task_proposals(workspace_id=workspace_id)
    return LocalTaskProposalListResponse(proposals=proposals, count=len(proposals))


@app.get("/api/v1/task-proposals/unreviewed")
async def list_local_unreviewed_task_proposals(workspace_id: str = Query(...)) -> LocalTaskProposalListResponse:
    proposals = list_unreviewed_task_proposals(workspace_id=workspace_id)
    return LocalTaskProposalListResponse(proposals=proposals, count=len(proposals))


@app.get("/api/v1/task-proposals/unreviewed/stream")
async def stream_local_unreviewed_task_proposals(workspace_id: str = Query(...)) -> StreamingResponse:
    async def event_stream() -> Any:
        seen_proposal_ids = {
            str(item["proposal_id"]) for item in list_unreviewed_task_proposals(workspace_id=workspace_id)
        }
        yield _sse_comment("connected")
        while True:
            proposals = list_unreviewed_task_proposals(workspace_id=workspace_id)
            for proposal in proposals:
                proposal_id = str(proposal["proposal_id"])
                if proposal_id in seen_proposal_ids:
                    continue
                seen_proposal_ids.add(proposal_id)
                yield _sse_event(proposal, event="insert", event_id=proposal_id)
            yield _sse_comment("ping")
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/v1/task-proposals")
async def create_local_task_proposal_endpoint(payload: LocalTaskProposalCreateRequest) -> dict[str, Any]:
    if get_workspace(payload.workspace_id) is None:
        raise HTTPException(status_code=404, detail="workspace not found")
    return {
        "proposal": create_task_proposal(
            proposal_id=payload.proposal_id,
            workspace_id=payload.workspace_id,
            task_name=payload.task_name,
            task_prompt=payload.task_prompt,
            task_generation_rationale=payload.task_generation_rationale,
            source_event_ids=payload.source_event_ids,
            created_at=payload.created_at,
            state=payload.state,
        )
    }


@app.get("/api/v1/task-proposals/{proposal_id}")
async def get_local_task_proposal_endpoint(proposal_id: str) -> dict[str, Any]:
    proposal = get_task_proposal(proposal_id)
    if proposal is None:
        raise HTTPException(status_code=404, detail="Task proposal not found")
    return {"proposal": proposal}


@app.patch("/api/v1/task-proposals/{proposal_id}")
async def update_local_task_proposal_state_endpoint(
    proposal_id: str, payload: LocalTaskProposalStateUpdateRequest
) -> dict[str, Any]:
    proposal = update_task_proposal_state(proposal_id=proposal_id, state=payload.state)
    if proposal is None:
        raise HTTPException(status_code=404, detail="Task proposal not found")
    return {"proposal": proposal}


@app.get("/api/v1/agent-sessions/{session_id}/history")
async def get_local_session_history(
    session_id: str,
    workspace_id: str = Query(..., min_length=1),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    include_raw: bool = Query(False),
) -> SessionHistoryResponse:
    del include_raw
    workspace = get_workspace(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="workspace not found")
    binding = get_binding(workspace_id=workspace_id, session_id=session_id)
    if binding is None:
        raise HTTPException(status_code=404, detail="session binding not found")

    all_messages = list_session_messages(workspace_id=workspace_id, session_id=session_id)
    sliced = all_messages[offset : offset + limit]
    return SessionHistoryResponse(
        workspace_id=workspace_id,
        session_id=session_id,
        harness=binding.harness,
        harness_session_id=binding.harness_session_id,
        source="sandbox_local_storage",
        main_session_id=workspace.main_session_id,
        is_main_session=workspace.main_session_id == session_id,
        messages=sliced,
        count=len(sliced),
        total=len(all_messages),
        limit=limit,
        offset=offset,
        raw=None,
    )


def _stored_event_to_runner_event(raw_event: dict[str, Any]) -> RunnerOutputEvent:
    return RunnerOutputEvent.model_validate({
        "session_id": raw_event["session_id"],
        "input_id": raw_event["input_id"],
        "sequence": raw_event["sequence"],
        "event_type": raw_event["event_type"],
        "timestamp": raw_event.get("created_at"),
        "payload": raw_event.get("payload") or {},
    })


@app.get("/api/v1/agent-sessions/{session_id}/outputs/stream")
async def stream_local_session_outputs(
    session_id: str,
    request: Request,
    input_id: str | None = Query(None),
    include_history: bool = Query(True),
    stop_on_terminal: bool = Query(True),
) -> StreamingResponse:
    terminal_events = _TERMINAL_EVENT_TYPES
    poll_interval_seconds = _output_stream_poll_interval_seconds()

    async def event_stream():
        last_event_id = latest_output_event_id(session_id=session_id, input_id=input_id) if not include_history else 0
        last_heartbeat = asyncio.get_running_loop().time()
        heartbeat_every = 10.0
        yield _sse_comment("connected")
        while True:
            if await request.is_disconnected():
                return

            events = list_output_events(
                session_id=session_id,
                input_id=input_id,
                include_history=True,
                after_event_id=last_event_id,
            )
            if events:
                for raw_event in events:
                    last_event_id = max(last_event_id, int(raw_event["id"]))
                    event = _stored_event_to_runner_event(raw_event)
                    yield _sse_event(event=event)
                    if stop_on_terminal and event.event_type in terminal_events:
                        return
                last_heartbeat = asyncio.get_running_loop().time()
                continue

            now = asyncio.get_running_loop().time()
            if now - last_heartbeat >= heartbeat_every:
                last_heartbeat = now
                yield _sse_comment("ping")
            await asyncio.sleep(poll_interval_seconds)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/v1/agent-sessions/{session_id}/outputs/events")
async def list_local_session_output_events(
    session_id: str,
    input_id: str | None = Query(None),
    include_history: bool = Query(True),
    after_event_id: int = Query(0, ge=0),
) -> dict[str, Any]:
    effective_after_event_id = int(after_event_id)
    if not include_history and effective_after_event_id <= 0:
        effective_after_event_id = latest_output_event_id(session_id=session_id, input_id=input_id)
    items = list_output_events(
        session_id=session_id,
        input_id=input_id,
        include_history=True,
        after_event_id=effective_after_event_id,
    )
    return {
        "items": items,
        "count": len(items),
        "last_event_id": max((int(item["id"]) for item in items), default=effective_after_event_id),
    }


@app.post("/api/v1/agent-runs")
async def run_agent(
    payload: RunnerRequest,
) -> WorkspaceAgentRunResponse:
    execution = await _execute_runner_request(payload)
    events = list(execution.events)
    skipped_lines = execution.skipped_lines
    stderr = execution.stderr.strip()
    exit_code = int(execution.return_code)
    last_sequence = max((int(event.sequence) for event in events), default=0)

    if not execution.saw_terminal and exit_code != 0:
        events.append(
            _build_run_failed_event(
                session_id=payload.session_id,
                input_id=payload.input_id,
                sequence=last_sequence + 1,
                message=stderr or f"runner command failed with exit_code={exit_code}",
                error_type="RunnerCommandError",
            )
        )
    elif not execution.saw_terminal:
        details = "; ".join(skipped_lines[:3]) if skipped_lines else ""
        suffix = f" (skipped output: {details})" if details else ""
        events.append(
            _build_run_failed_event(
                session_id=payload.session_id,
                input_id=payload.input_id,
                sequence=last_sequence + 1,
                message=f"runner ended before terminal event{suffix}",
            )
        )

    return WorkspaceAgentRunResponse(
        session_id=payload.session_id,
        input_id=payload.input_id,
        events=events,
    )


@app.post("/api/v1/memory/search")
async def memory_search_endpoint(payload: MemorySearchRequest) -> dict[str, Any]:
    try:
        return memory_search(
            workspace_id=payload.workspace_id,
            query=payload.query,
            max_results=payload.max_results,
            min_score=payload.min_score,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/memory/get")
async def memory_get_endpoint(payload: MemoryGetRequest) -> dict[str, Any]:
    try:
        return memory_get(
            workspace_id=payload.workspace_id,
            path=payload.path,
            from_line=payload.from_line,
            lines=payload.lines,
        )
    except FileNotFoundError:
        return {"path": payload.path, "text": ""}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/memory/upsert")
async def memory_upsert_endpoint(payload: MemoryUpsertRequest) -> dict[str, Any]:
    try:
        return memory_upsert(
            workspace_id=payload.workspace_id,
            path=payload.path,
            content=payload.content,
            append=payload.append,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/memory/status")
async def memory_status_endpoint(payload: MemoryStatusRequest) -> dict[str, Any]:
    try:
        return memory_status(workspace_id=payload.workspace_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/memory/sync")
async def memory_sync_endpoint(payload: MemorySyncRequest) -> dict[str, Any]:
    try:
        return memory_sync(
            workspace_id=payload.workspace_id,
            reason=payload.reason,
            force=payload.force,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/agent-runs/stream")
async def stream_agent_run(
    payload: RunnerRequest,
) -> StreamingResponse:
    runner_command = _agent_runner_command(payload)

    async def _event_stream():
        process = await asyncio.create_subprocess_exec(
            "/bin/bash",
            "-lc",
            runner_command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        if process.stdout is None or process.stderr is None:
            raise RuntimeError("sandbox runner subprocess streams were not initialized")

        stderr_task = asyncio.create_task(process.stderr.read())
        saw_terminal = False
        last_sequence = 0
        skipped_lines: list[str] = []
        heartbeat_every = 5.0
        last_heartbeat = asyncio.get_running_loop().time()

        try:
            yield b": connected\n\n"
            while True:
                try:
                    line = await asyncio.wait_for(process.stdout.readline(), timeout=1.0)
                except TimeoutError:
                    if process.returncode is not None:
                        break
                    now = asyncio.get_running_loop().time()
                    if now - last_heartbeat >= heartbeat_every:
                        last_heartbeat = now
                        yield b": ping\n\n"
                    continue

                if not line:
                    if process.returncode is None:
                        await process.wait()
                    break

                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue

                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError:
                    if len(skipped_lines) < 20:
                        skipped_lines.append(text)
                    continue

                event = _normalize_event(parsed)
                if event is None:
                    if len(skipped_lines) < 20:
                        skipped_lines.append(text)
                    continue

                last_sequence = max(last_sequence, int(event.sequence))
                yield _sse_event(event=event)
                last_heartbeat = asyncio.get_running_loop().time()

                if event.event_type in _TERMINAL_EVENT_TYPES:
                    saw_terminal = True
                    return

            return_code = process.returncode
            if return_code is None:
                return_code = await process.wait()

            stderr_bytes = await stderr_task
            stderr_text = stderr_bytes.decode("utf-8", errors="replace").strip()

            if return_code != 0:
                failure = _build_run_failed_event(
                    session_id=payload.session_id,
                    input_id=payload.input_id,
                    sequence=last_sequence + 1,
                    message=stderr_text or f"runner command failed with exit_code={return_code}",
                    error_type="RunnerCommandError",
                )
                yield _sse_event(event=failure)
                return

            if not saw_terminal:
                details = "; ".join(skipped_lines[:3]) if skipped_lines else ""
                suffix = f" (skipped output: {details})" if details else ""
                failure = _build_run_failed_event(
                    session_id=payload.session_id,
                    input_id=payload.input_id,
                    sequence=last_sequence + 1,
                    message=f"runner stream ended before terminal event{suffix}",
                )
                yield _sse_event(event=failure)
        finally:
            if not stderr_task.done():
                stderr_task.cancel()
                with suppress(asyncio.CancelledError):
                    await stderr_task
            if process.returncode is None:
                process.kill()
                with suppress(Exception):
                    await process.wait()

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class ShutdownResult(BaseModel):
    stopped: list[str]
    failed: list[str]


@app.post("/api/v1/lifecycle/shutdown")
async def lifecycle_shutdown() -> ShutdownResult:
    """Gracefully stop all running applications across all workspaces.

    Called before sandbox suspend to ensure clean shutdown of docker-compose
    containers and subprocess apps.
    """
    stopped: list[str] = []
    failed: list[str] = []

    workspace_root = Path(WORKSPACE_ROOT)
    if not workspace_root.is_dir():
        return ShutdownResult(stopped=stopped, failed=failed)

    for workspace_dir in workspace_root.iterdir():
        if not workspace_dir.is_dir():
            continue
        workspace_yaml = workspace_dir / "workspace.yaml"
        if not workspace_yaml.exists():
            continue

        try:
            apps = _resolve_apps_from_workspace_yaml(workspace_yaml)
        except Exception as exc:
            logger.warning("Failed to parse %s: %s", workspace_yaml, exc)
            continue

        if not apps:
            continue

        for app_id, app_dir in apps:
            compose_file = app_dir / "docker-compose.yml"
            compose_file_yaml = app_dir / "docker-compose.yaml"
            if not (compose_file.exists() or compose_file_yaml.exists()):
                continue
            try:
                compose_cmd = await _find_lifecycle_compose_command()
                if compose_cmd is None:
                    continue
                proc = await asyncio.create_subprocess_exec(
                    *compose_cmd,
                    "down",
                    "--remove-orphans",
                    cwd=str(app_dir),
                    env={**os.environ},
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                returncode = await proc.wait()
                if returncode == 0:
                    stopped.append(app_id)
                    logger.info("Stopped app '%s' in %s", app_id, workspace_dir.name)
                else:
                    failed.append(app_id)
                    stderr = (await proc.stderr.read()).decode(errors="replace") if proc.stderr else ""
                    logger.warning("Failed to stop app '%s': %s", app_id, stderr[:300])
            except Exception as exc:
                failed.append(app_id)
                logger.warning("Error stopping app '%s': %s", app_id, exc)

    return ShutdownResult(stopped=stopped, failed=failed)


# ---------------------------------------------------------------------------
# Per-app start / stop endpoints
# ---------------------------------------------------------------------------
# These run inside the sandbox container and can execute lifecycle commands
# that contain shell expansions ($(), ${}, etc.) which are blocked by the
# sandbox-host exec validation layer.

# Singleton lifecycle managers keyed by workspace_id.
# Stored on app.state so stop can access processes started by start.
_lifecycle_managers: dict[str, ApplicationLifecycleManager] = {}


class AppStartRequest(BaseModel):
    workspace_id: str = "workspace-1"
    env: dict[str, str] = Field(default_factory=dict)


class AppStopRequest(BaseModel):
    workspace_id: str = "workspace-1"


class AppActionResult(BaseModel):
    app_id: str
    status: str
    detail: str = ""
    ports: dict[str, int] = Field(default_factory=dict)


def _get_lifecycle_manager(workspace_id: str) -> ApplicationLifecycleManager:
    """Get or create a lifecycle manager for the given workspace."""
    if workspace_id not in _lifecycle_managers:
        workspace_dir = Path(WORKSPACE_ROOT) / workspace_id
        _lifecycle_managers[workspace_id] = ApplicationLifecycleManager(
            workspace_dir=workspace_dir,
        )
    return _lifecycle_managers[workspace_id]


def _resolve_app_from_workspace(workspace_id: str, target_app_id: str) -> tuple[Path, str, str]:
    """Find an app entry in workspace.yaml and return (workspace_dir, app_id, config_path).

    Raises HTTPException if not found.
    """
    workspace_dir = Path(WORKSPACE_ROOT) / workspace_id
    workspace_yaml_path = workspace_dir / "workspace.yaml"

    if not workspace_yaml_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"workspace.yaml not found for workspace '{workspace_id}'",
        )

    data = yaml.safe_load(workspace_yaml_path.read_text())
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="workspace.yaml is not a valid mapping")

    applications = data.get("applications")
    if not isinstance(applications, list):
        raise HTTPException(status_code=400, detail="workspace.yaml has no applications list")

    for entry in applications:
        if not isinstance(entry, dict):
            continue
        entry_app_id = str(entry.get("app_id") or "")
        if entry_app_id == target_app_id:
            config_path = str(entry.get("config_path") or "")
            return workspace_dir, entry_app_id, config_path

    raise HTTPException(
        status_code=404,
        detail=f"app '{target_app_id}' not found in workspace.yaml",
    )


def _load_resolved_app(workspace_dir: Path, app_id: str, config_path: str):
    """Read app.runtime.yaml and return a ResolvedApplication."""
    yaml_path = workspace_dir / config_path
    if not yaml_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"app config not found: '{config_path}'",
        )

    raw_yaml = yaml_path.read_text()
    return _parse_app_runtime_yaml(
        raw_yaml=raw_yaml,
        declared_app_id=app_id,
        config_path=config_path,
    )


def _app_index_in_workspace(workspace_dir: Path, target_app_id: str) -> int:
    """Return the 0-based index of an app in workspace.yaml's applications list."""
    workspace_yaml_path = workspace_dir / "workspace.yaml"
    if not workspace_yaml_path.exists():
        return 0
    data = yaml.safe_load(workspace_yaml_path.read_text())
    if not isinstance(data, dict):
        return 0
    applications = data.get("applications")
    if not isinstance(applications, list):
        return 0
    for index, entry in enumerate(applications):
        if isinstance(entry, dict) and str(entry.get("app_id") or "") == target_app_id:
            return index
    return 0


def _ports_for_app_index(index: int) -> tuple[int, int]:
    """Derive deterministic HTTP and MCP ports from app index."""
    from sandbox_agent_runtime.application_lifecycle import _APP_HTTP_PORT_BASE, _MCP_PORT_BASE

    return (_APP_HTTP_PORT_BASE + index, _MCP_PORT_BASE + index)


def _find_workspace_yaml() -> Path | None:
    """Find the first workspace.yaml across all workspace directories."""
    root = Path(WORKSPACE_ROOT)
    if not root.is_dir():
        return None
    for child in root.iterdir():
        if child.is_dir():
            candidate = child / "workspace.yaml"
            if candidate.exists():
                return candidate
    return None


def _parse_app_ports_from_yaml(workspace_yaml_path: Path) -> dict[str, dict[str, int]]:
    """Parse workspace.yaml and return deterministic port assignments for listed apps."""
    data = yaml.safe_load(workspace_yaml_path.read_text())
    if not isinstance(data, dict):
        return {}
    applications = data.get("applications")
    if not isinstance(applications, list):
        return {}
    result: dict[str, dict[str, int]] = {}
    for index, entry in enumerate(applications):
        if not isinstance(entry, dict):
            continue
        app_id = str(entry.get("app_id") or "")
        if not app_id:
            continue
        http_port, mcp_port = _ports_for_app_index(index)
        result[app_id] = {"http": http_port, "mcp": mcp_port}
    return result


@app.get("/api/v1/apps/ports")
async def list_app_ports(workspace_id: str | None = None) -> dict[str, dict[str, int]]:
    """Return deterministic app ports based on application order in workspace.yaml."""
    if workspace_id:
        workspace_yaml_path = Path(WORKSPACE_ROOT) / workspace_id / "workspace.yaml"
    else:
        workspace_yaml_path = _find_workspace_yaml()

    if not workspace_yaml_path or not workspace_yaml_path.exists():
        return {}
    return _parse_app_ports_from_yaml(workspace_yaml_path)


@app.post("/api/v1/apps/{app_id}/start")
async def start_app_endpoint(app_id: str, payload: AppStartRequest) -> AppActionResult:
    """Start an application using its lifecycle commands.

    Runs inside the sandbox container so shell expansions ($(), ${}) work.
    Port assignment is deterministic from app order in workspace.yaml.
    """
    workspace_dir, resolved_app_id, config_path = _resolve_app_from_workspace(payload.workspace_id, app_id)

    try:
        resolved_app = _load_resolved_app(workspace_dir, resolved_app_id, config_path)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"failed to parse app config: {exc}") from exc

    manager = _get_lifecycle_manager(payload.workspace_id)

    try:
        index = _app_index_in_workspace(workspace_dir, resolved_app_id)
        http_port, mcp_port = _ports_for_app_index(index)
        manager._port_allocations[resolved_app_id] = (http_port, mcp_port)
        logger.info(
            "Assigned deterministic ports for app '%s': HTTP=%d, MCP=%d",
            resolved_app_id,
            http_port,
            mcp_port,
        )

        # Check if already healthy before starting
        mcp_host_port = manager._get_mcp_host_port(resolved_app)
        if not await manager._is_app_healthy(resolved_app, mcp_host_port=mcp_host_port):
            await manager._start_app(resolved_app)
            await manager._wait_healthy_with_retry(resolved_app)
        else:
            logger.info("App '%s' already healthy on port %d, skipping start", app_id, mcp_host_port)
    except Exception as exc:
        logger.exception("Failed to start app '%s'", app_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Return allocated ports so the caller knows where to reach the app
    ports: dict[str, int] = {}
    if resolved_app_id in manager._port_allocations:
        http_port, mcp_port = manager._port_allocations[resolved_app_id]
        ports = {"http": http_port, "mcp": mcp_port}

    return AppActionResult(
        app_id=resolved_app_id,
        status="started",
        detail="app started with lifecycle manager",
        ports=ports,
    )


@app.post("/api/v1/apps/{app_id}/stop")
async def stop_app_endpoint(app_id: str, payload: AppStopRequest) -> AppActionResult:
    """Stop an application using its lifecycle commands.

    Runs inside the sandbox container so shell expansions ($(), ${}) work.
    """
    workspace_dir, resolved_app_id, config_path = _resolve_app_from_workspace(payload.workspace_id, app_id)

    try:
        resolved_app = _load_resolved_app(workspace_dir, resolved_app_id, config_path)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"failed to parse app config: {exc}") from exc

    manager = _get_lifecycle_manager(payload.workspace_id)

    try:
        await manager.stop_all([resolved_app])
    except Exception as exc:
        logger.exception("Failed to stop app '%s'", app_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Clean up port allocations
    manager._port_allocations.pop(resolved_app_id, None)

    return AppActionResult(
        app_id=resolved_app_id,
        status="stopped",
        detail="app stopped via lifecycle manager",
    )


# ---------------------------------------------------------------------------
# App install / uninstall / build-status / list / setup endpoints
# ---------------------------------------------------------------------------

_background_tasks: set[asyncio.Task[Any]] = set()


class InstallAppRequest(BaseModel):
    app_id: str = Field(..., min_length=1)
    workspace_id: str = Field(..., min_length=1)
    files: list[dict[str, Any]]  # [{path, content_base64, executable?}]


class InstallAppResponse(BaseModel):
    app_id: str
    status: str
    detail: str


class UninstallAppRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)


class AppSetupRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)


async def _run_app_setup(
    *,
    workspace_dir: str,
    workspace_id: str,
    app_id: str,
    setup_command: str,
) -> None:
    """Execute lifecycle.setup in background, track status in SQLite."""
    from sandbox_agent_runtime.runtime_local_state import upsert_app_build

    upsert_app_build(workspace_id=workspace_id, app_id=app_id, status="building")
    try:
        proc = await asyncio.create_subprocess_shell(
            setup_command,
            cwd=os.path.join(workspace_dir, "apps", app_id),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        if proc.returncode != 0:
            error_detail = stderr.decode("utf-8", errors="replace")[:2000]
            upsert_app_build(workspace_id=workspace_id, app_id=app_id, status="failed", error=error_detail)
            return
        upsert_app_build(workspace_id=workspace_id, app_id=app_id, status="completed")
    except asyncio.TimeoutError:
        upsert_app_build(workspace_id=workspace_id, app_id=app_id, status="failed", error="setup timed out after 300s")
    except Exception as exc:
        upsert_app_build(workspace_id=workspace_id, app_id=app_id, status="failed", error=str(exc)[:2000])


@app.post("/api/v1/apps/install")
async def install_app(payload: InstallAppRequest) -> InstallAppResponse:
    """Install an app by writing files, registering in workspace.yaml, and optionally running setup."""
    from sandbox_agent_runtime.workspace_yaml import (
        append_application,
        read_workspace_yaml,
        write_workspace_yaml,
    )

    workspace_dir = workspace_dir_for_id(payload.workspace_id)
    app_dir = os.path.join(workspace_dir, "apps", payload.app_id)

    # Write files
    for file_entry in payload.files:
        file_path = os.path.join(app_dir, file_entry["path"])
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        content = base64.b64decode(file_entry["content_base64"])
        with open(file_path, "wb") as f:
            f.write(content)
        if file_entry.get("executable"):
            os.chmod(file_path, 0o755)

    # Parse app.runtime.yaml
    app_yaml_path = os.path.join(app_dir, "app.runtime.yaml")
    if not os.path.exists(app_yaml_path):
        raise HTTPException(status_code=400, detail="app.runtime.yaml not found in uploaded files")
    raw_yaml = Path(app_yaml_path).read_text(encoding="utf-8")
    config_path = f"apps/{payload.app_id}/app.runtime.yaml"
    resolved = _parse_app_runtime_yaml(raw_yaml=raw_yaml, declared_app_id=payload.app_id, config_path=config_path)

    # Register in workspace.yaml
    existing_content = read_workspace_yaml(workspace_dir)
    lifecycle_dict: dict[str, str] = {}
    if resolved.lifecycle.setup:
        lifecycle_dict["setup"] = resolved.lifecycle.setup
    if resolved.lifecycle.start:
        lifecycle_dict["start"] = resolved.lifecycle.start
    if resolved.lifecycle.stop:
        lifecycle_dict["stop"] = resolved.lifecycle.stop
    updated_content = append_application(
        existing_content,
        app_id=payload.app_id,
        config_path=config_path,
        lifecycle=lifecycle_dict or None,
    )
    write_workspace_yaml(workspace_dir, updated_content)

    # Run setup if defined
    setup_cmd = resolved.lifecycle.setup
    if setup_cmd:
        task = asyncio.create_task(
            _run_app_setup(
                workspace_dir=workspace_dir,
                workspace_id=payload.workspace_id,
                app_id=payload.app_id,
                setup_command=setup_cmd,
            )
        )
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
        return InstallAppResponse(
            app_id=payload.app_id,
            status="setup_started",
            detail=f"Files written, running setup: {setup_cmd}",
        )

    return InstallAppResponse(
        app_id=payload.app_id,
        status="installed",
        detail="Files written, no setup command defined",
    )


@app.delete("/api/v1/apps/{app_id}")
async def uninstall_app(app_id: str, payload: UninstallAppRequest) -> AppActionResult:
    """Uninstall an app: stop it, remove files, remove from workspace.yaml, clean up build status."""
    from sandbox_agent_runtime.runtime_local_state import delete_app_build
    from sandbox_agent_runtime.workspace_yaml import (
        read_workspace_yaml,
        remove_application,
        write_workspace_yaml,
    )

    workspace_dir = workspace_dir_for_id(payload.workspace_id)

    # Best-effort stop
    try:
        workspace_dir_path = Path(workspace_dir)
        workspace_yaml_path = workspace_dir_path / "workspace.yaml"
        if workspace_yaml_path.exists():
            data = yaml.safe_load(workspace_yaml_path.read_text())
            if isinstance(data, dict):
                applications = data.get("applications", [])
                if isinstance(applications, list):
                    for entry in applications:
                        if isinstance(entry, dict) and entry.get("app_id") == app_id:
                            config_path = entry.get("config_path", "")
                            if config_path:
                                try:
                                    resolved_app = _load_resolved_app(workspace_dir_path, app_id, config_path)
                                    manager = _get_lifecycle_manager(payload.workspace_id)
                                    await manager.stop_all([resolved_app])
                                    manager._port_allocations.pop(app_id, None)
                                except Exception:
                                    logger.debug("Best-effort stop failed for app '%s'", app_id, exc_info=True)
                            break
    except Exception:
        logger.debug("Best-effort stop failed for app '%s'", app_id, exc_info=True)

    # Remove files
    shutil.rmtree(os.path.join(workspace_dir, "apps", app_id), ignore_errors=True)

    # Remove from workspace.yaml
    existing_content = read_workspace_yaml(workspace_dir)
    updated_content = remove_application(existing_content, app_id=app_id)
    write_workspace_yaml(workspace_dir, updated_content)

    # Clean up build status
    delete_app_build(workspace_id=payload.workspace_id, app_id=app_id)

    return AppActionResult(
        app_id=app_id,
        status="uninstalled",
        detail="App stopped, files removed, workspace.yaml updated",
        ports={},
    )


@app.get("/api/v1/apps/{app_id}/build-status")
async def app_build_status(app_id: str, workspace_id: str = Query(...)) -> dict[str, Any]:
    """Get the build/setup status for a given app."""
    from sandbox_agent_runtime.runtime_local_state import get_app_build

    record = get_app_build(workspace_id=workspace_id, app_id=app_id)
    if record is None:
        return {"status": "unknown"}
    return dict(record)


@app.get("/api/v1/apps")
async def list_installed_apps(workspace_id: str = Query(...)) -> dict[str, Any]:
    """List all installed apps for a workspace, including build status."""
    from sandbox_agent_runtime.runtime_local_state import get_app_build
    from sandbox_agent_runtime.workspace_yaml import parse_workspace_yaml, read_workspace_yaml

    workspace_dir = workspace_dir_for_id(workspace_id)
    content = read_workspace_yaml(workspace_dir)
    data = parse_workspace_yaml(content)
    apps_list = data.get("applications", [])
    if not isinstance(apps_list, list):
        apps_list = []

    result = []
    for entry in apps_list:
        if not isinstance(entry, dict) or "app_id" not in entry:
            continue
        aid = entry["app_id"]
        build = get_app_build(workspace_id=workspace_id, app_id=aid)
        result.append({
            "app_id": aid,
            "config_path": entry.get("config_path", ""),
            "lifecycle": entry.get("lifecycle"),
            "build_status": build["status"] if build else "unknown",
        })
    return {"apps": result, "count": len(result)}


@app.post("/api/v1/apps/{app_id}/setup")
async def setup_app_endpoint(app_id: str, payload: AppSetupRequest) -> AppActionResult:
    """Re-run the lifecycle.setup command for an already-installed app."""
    workspace_dir = workspace_dir_for_id(payload.workspace_id)
    app_yaml_path = os.path.join(workspace_dir, "apps", app_id, "app.runtime.yaml")
    if not os.path.exists(app_yaml_path):
        raise HTTPException(status_code=404, detail=f"app.runtime.yaml not found for {app_id}")
    raw_yaml = Path(app_yaml_path).read_text(encoding="utf-8")
    resolved = _parse_app_runtime_yaml(
        raw_yaml=raw_yaml,
        declared_app_id=app_id,
        config_path=f"apps/{app_id}/app.runtime.yaml",
    )
    setup_cmd = resolved.lifecycle.setup
    if not setup_cmd:
        return AppActionResult(app_id=app_id, status="no_setup_command", detail="No lifecycle.setup defined", ports={})
    task = asyncio.create_task(
        _run_app_setup(
            workspace_dir=workspace_dir,
            workspace_id=payload.workspace_id,
            app_id=app_id,
            setup_command=setup_cmd,
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return AppActionResult(app_id=app_id, status="setup_started", detail=f"Running: {setup_cmd}", ports={})


def _resolve_apps_from_workspace_yaml(workspace_yaml: Path) -> list[tuple[str, Path]]:
    """Parse workspace.yaml and return (app_id, app_dir) pairs."""
    import yaml

    data = yaml.safe_load(workspace_yaml.read_text())
    if not isinstance(data, dict):
        return []

    applications = data.get("applications")
    if not isinstance(applications, list):
        return []

    workspace_dir = workspace_yaml.parent
    result: list[tuple[str, Path]] = []
    for entry in applications:
        if not isinstance(entry, dict):
            continue
        app_id = str(entry.get("app_id") or "")
        config_path = str(entry.get("config_path") or "")
        if not app_id:
            continue
        # Derive app_dir from config_path (e.g. "apps/myapp/app.runtime.yaml" → "apps/myapp")
        app_dir = workspace_dir / str(Path(config_path).parent) if config_path else workspace_dir / "apps" / app_id
        result.append((app_id, app_dir))
    return result


async def _find_lifecycle_compose_command() -> list[str] | None:
    """Find available docker compose command."""
    for cmd in (["docker", "compose"], ["docker-compose"]):
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                "version",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.wait()
            if proc.returncode == 0:
                return cmd
        except FileNotFoundError:
            continue
    return None


# ---------------------------------------------------------------------------
# Workspace file & snapshot operations
# ---------------------------------------------------------------------------


class ApplyTemplateRequest(BaseModel):
    files: list[dict[str, Any]]
    replace_existing: bool = False


@app.post("/api/v1/workspaces/{workspace_id}/apply-template")
async def apply_template(workspace_id: str, payload: ApplyTemplateRequest) -> dict[str, Any]:
    """Atomically apply a materialized template to a workspace."""
    workspace_dir = workspace_dir_for_id(workspace_id)
    ws_path = Path(workspace_dir)

    if not ws_path.exists():
        ws_path.mkdir(parents=True, exist_ok=True)

    if payload.replace_existing:
        # Remove everything except .holaboss and workspace.json
        for child in ws_path.iterdir():
            if child.name in (".holaboss", "workspace.json"):
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()

    files_written = 0
    for entry in payload.files:
        rel_path = entry.get("path", "")
        content_b64 = entry.get("content_base64", "")
        executable = bool(entry.get("executable", False))

        if not rel_path or not content_b64:
            continue

        # Validate no traversal
        if ".." in rel_path.split("/"):
            raise HTTPException(status_code=400, detail=f"path traversal not allowed: {rel_path}")

        full_path = ws_path / rel_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(base64.b64decode(content_b64))
        if executable:
            full_path.chmod(full_path.stat().st_mode | 0o111)
        files_written += 1

    return {"status": "applied", "files_written": files_written}


@app.get("/api/v1/workspaces/{workspace_id}/files/{file_path:path}")
async def read_file_endpoint(workspace_id: str, file_path: str) -> dict[str, Any]:
    """Read a file from the workspace."""
    workspace_dir = workspace_dir_for_id(workspace_id)

    # Validate path
    if ".." in file_path.split("/"):
        raise HTTPException(status_code=400, detail="path traversal not allowed")

    full_path = Path(workspace_dir) / file_path
    if not full_path.exists():
        raise HTTPException(status_code=404, detail=f"file not found: {file_path}")
    if not full_path.is_file():
        raise HTTPException(status_code=400, detail=f"not a file: {file_path}")

    raw = full_path.read_bytes()
    try:
        content = raw.decode("utf-8")
        return {"path": file_path, "content": content, "encoding": "utf-8"}
    except UnicodeDecodeError:
        return {"path": file_path, "content": base64.b64encode(raw).decode("ascii"), "encoding": "base64"}


class WriteFileRequest(BaseModel):
    content_base64: str
    executable: bool = False


@app.put("/api/v1/workspaces/{workspace_id}/files/{file_path:path}")
async def write_file_endpoint(workspace_id: str, file_path: str, payload: WriteFileRequest) -> dict[str, Any]:
    """Write a file to the workspace."""
    workspace_dir = workspace_dir_for_id(workspace_id)

    if ".." in file_path.split("/"):
        raise HTTPException(status_code=400, detail="path traversal not allowed")

    full_path = Path(workspace_dir) / file_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(base64.b64decode(payload.content_base64))
    if payload.executable:
        full_path.chmod(full_path.stat().st_mode | 0o111)

    return {"path": file_path, "status": "written"}


@app.get("/api/v1/workspaces/{workspace_id}/snapshot")
async def workspace_snapshot(workspace_id: str) -> dict[str, Any]:
    """Return workspace filesystem metadata and git state."""
    workspace_dir = workspace_dir_for_id(workspace_id)
    ws_path = Path(workspace_dir)

    if not ws_path.exists():
        raise HTTPException(status_code=404, detail="workspace not found")

    # Collect filesystem tree
    files: list[dict[str, Any]] = []
    extension_counts: dict[str, int] = {}
    total_size = 0
    max_files = 5000

    for item in sorted(ws_path.rglob("*")):
        if len(files) >= max_files:
            break
        if not item.is_file():
            continue

        rel = item.relative_to(ws_path).as_posix()

        # Skip noisy dirs
        skip_prefixes = (".git/", "node_modules/", "__pycache__/", ".venv/", "dist/", "build/")
        if any(rel.startswith(p) for p in skip_prefixes):
            continue

        try:
            st = item.stat()
        except OSError:
            continue

        size = st.st_size
        total_size += size
        ext = item.suffix.lower() if item.suffix else "(none)"
        extension_counts[ext] = extension_counts.get(ext, 0) + 1

        files.append({
            "path": rel,
            "size": size,
            "modified": datetime.fromtimestamp(st.st_mtime, tz=UTC).isoformat(),
        })

    # Key file previews
    previews: dict[str, str] = {}
    for key_file in ("workspace.yaml", "README.md", "AGENTS.md", "package.json"):
        kf_path = ws_path / key_file
        if kf_path.exists() and kf_path.is_file():
            try:
                raw = kf_path.read_bytes()[:1000]
                previews[key_file] = raw.decode("utf-8", errors="replace")
            except OSError:
                pass

    # Git state
    git_state: dict[str, Any] = {}
    if (ws_path / ".git").exists():
        try:
            branch_result = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=str(ws_path), capture_output=True, text=True, timeout=5,
            )
            if branch_result.returncode == 0:
                git_state["branch"] = branch_result.stdout.strip()

            status_result = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=str(ws_path), capture_output=True, text=True, timeout=5,
            )
            git_state["dirty"] = bool(status_result.stdout.strip())
        except (subprocess.TimeoutExpired, OSError):
            pass

    return {
        "workspace_id": workspace_id,
        "file_count": len(files),
        "total_size": total_size,
        "files": files,
        "extension_counts": extension_counts,
        "previews": previews,
        "git": git_state,
    }


@app.get("/api/v1/workspaces/{workspace_id}/export")
async def export_workspace(workspace_id: str):
    """Export workspace as streaming tar.gz."""
    workspace_dir = workspace_dir_for_id(workspace_id)
    ws_path = Path(workspace_dir)

    if not ws_path.exists():
        raise HTTPException(status_code=404, detail="workspace not found")

    exclude_dirs = {"node_modules", ".git", "dist", "build", "__pycache__", ".venv", ".hb_template_bootstrap_tmp", ".hb_app_template_tmp"}

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for item in sorted(ws_path.rglob("*")):
            rel = item.relative_to(ws_path)
            # Skip excluded directories
            if any(part in exclude_dirs for part in rel.parts):
                continue
            if item.is_file():
                tar.add(str(item), arcname=rel.as_posix())

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/gzip",
        headers={"Content-Disposition": f"attachment; filename={workspace_id}.tar.gz"},
    )


async def _execute_runner_request(
    payload: RunnerRequest,
    *,
    on_event: Callable[[RunnerOutputEvent], Awaitable[None] | None] | None = None,
) -> _RunnerExecutionResult:
    runner_command = _agent_runner_command(payload)
    process = await asyncio.create_subprocess_exec(
        "/bin/bash",
        "-lc",
        runner_command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    if process.stdout is None or process.stderr is None:
        raise RuntimeError("sandbox runner subprocess streams were not initialized")

    requested_timeout = getattr(payload, "timeout_s", None)
    timeout_s = max(1, requested_timeout) if isinstance(requested_timeout, int) else _agent_runner_timeout_seconds()
    started_at = asyncio.get_running_loop().time()
    stderr_task = asyncio.create_task(process.stderr.read())
    events: list[RunnerOutputEvent] = []
    skipped_lines: list[str] = []
    saw_terminal = False
    timed_out = False

    try:
        while True:
            elapsed = asyncio.get_running_loop().time() - started_at
            remaining = timeout_s - elapsed
            if remaining <= 0:
                timed_out = True
                break

            try:
                line = await asyncio.wait_for(process.stdout.readline(), timeout=min(1.0, remaining))
            except TimeoutError:
                if process.returncode is not None:
                    break
                continue

            if not line:
                if process.returncode is None:
                    await process.wait()
                break

            text = line.decode("utf-8", errors="replace").strip()
            if not text:
                continue

            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                if len(skipped_lines) < 20:
                    skipped_lines.append(text)
                continue

            event = _normalize_event(parsed)
            if event is None:
                if len(skipped_lines) < 20:
                    skipped_lines.append(text)
                continue

            events.append(event)
            if on_event is not None:
                callback_result = on_event(event)
                if inspect.isawaitable(callback_result):
                    await callback_result
            if event.event_type in _TERMINAL_EVENT_TYPES:
                saw_terminal = True
    finally:
        if timed_out and process.returncode is None:
            process.kill()
            with suppress(Exception):
                await process.wait()
        if process.returncode is None:
            process.kill()
            with suppress(Exception):
                await process.wait()

    stderr_text: str
    if timed_out:
        stderr_text = "runner command timed out"
        return_code = 124
    else:
        return_code = int(process.returncode or 0)
        stderr_bytes = await stderr_task
        stderr_text = stderr_bytes.decode("utf-8", errors="replace").strip()

    if not stderr_task.done():
        stderr_task.cancel()
        with suppress(asyncio.CancelledError):
            await stderr_task

    return _RunnerExecutionResult(
        events=events,
        skipped_lines=skipped_lines,
        stderr=stderr_text,
        return_code=return_code,
        saw_terminal=saw_terminal,
    )
