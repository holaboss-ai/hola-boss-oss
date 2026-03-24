from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import shutil
import subprocess
import tarfile
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Awaitable

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
import yaml

from sandbox_agent_runtime.api_models import (
    AgentSessionStateResponse,
    ExecSandboxRequest,
    LocalCronjobCreateRequest,
    LocalCronjobListResponse,
    LocalCronjobUpdateRequest,
    LocalOutputCreateRequest,
    LocalOutputFolderCreateRequest,
    LocalOutputFolderListResponse,
    LocalOutputFolderUpdateRequest,
    LocalOutputListResponse,
    LocalOutputUpdateRequest,
    LocalSessionArtifactCreateRequest,
    LocalTaskProposalCreateRequest,
    LocalTaskProposalListResponse,
    LocalTaskProposalStateUpdateRequest,
    LocalWorkspaceCreateRequest,
    LocalWorkspaceListResponse,
    LocalWorkspaceUpdateRequest,
    MemoryGetRequest,
    MemorySearchRequest,
    MemoryStatusRequest,
    MemorySyncRequest,
    MemoryUpsertRequest,
    QueueSessionInputRequest,
    QueueSessionInputResponse,
    RuntimeConfigResponse,
    RuntimeConfigUpdateRequest,
    RuntimeStatusResponse,
    SessionArtifactListResponse,
    SessionHistoryResponse,
    SessionRuntimeStateListResponse,
    SessionWithArtifactsListResponse,
    WorkspaceAgentRunResponse,
)
from sandbox_agent_runtime.application_lifecycle import ApplicationLifecycleManager
from sandbox_agent_runtime.control_plane_api import (
    cron_scheduler_state as _cron_scheduler_state_impl,
    local_worker_state as _local_worker_state_impl,
    python_bridge_worker_enabled as _python_bridge_worker_enabled_impl,
    python_cron_worker_enabled as _python_cron_worker_enabled_impl,
    python_queue_worker_enabled as _python_queue_worker_enabled_impl,
    shutdown_worker_control_plane as _shutdown_worker_control_plane_impl,
    startup_worker_control_plane as _startup_worker_control_plane_impl,
    ts_bridge_worker_enabled as _ts_bridge_worker_enabled_impl,
    ts_cron_worker_enabled as _ts_cron_worker_enabled_impl,
    ts_queue_worker_enabled as _ts_queue_worker_enabled_impl,
)
from sandbox_agent_runtime.local_execution_service import (
    DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE as _DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE,
)
from sandbox_agent_runtime.local_execution_service import (
    process_claimed_input as _process_claimed_input_service,
)
from sandbox_agent_runtime.local_execution_service import (
    selected_harness as _selected_harness_impl,
)
from sandbox_agent_runtime.local_worker import (
    cron_scheduler_loop as _cron_scheduler_loop_impl,
)
from sandbox_agent_runtime.local_worker import (
    cronjob_check_interval_seconds as _cronjob_check_interval_seconds_impl,
)
from sandbox_agent_runtime.local_worker import (
    cronjob_is_due as _cronjob_is_due_impl,
)
from sandbox_agent_runtime.local_worker import (
    cronjob_next_run_at as _cronjob_next_run_at_impl,
)
from sandbox_agent_runtime.local_worker import (
    queue_local_cronjob_run as _queue_local_cronjob_run_impl,
)
from sandbox_agent_runtime.worker_service import (
    local_worker_loop as _local_worker_loop_impl,
)
from sandbox_agent_runtime.worker_service import (
    process_available_inputs_once as _process_available_inputs_once_impl,
)
from sandbox_agent_runtime.memory_api import register_memory_routes
from sandbox_agent_runtime.proactive_bridge import bridge_enabled
from sandbox_agent_runtime.product_config import (
    opencode_config_path,
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
from sandbox_agent_runtime.runner_api import (
    run_agent_request as _run_agent_request_impl,
    stream_agent_run_request as _stream_agent_run_request_impl,
)
from sandbox_agent_runtime.runner_backend import (
    RunnerExecutionResult as _RunnerExecutionResult,
)
from sandbox_agent_runtime.runner_backend import (
    TERMINAL_EVENT_TYPES as _TERMINAL_EVENT_TYPES,
)
from sandbox_agent_runtime.runner_backend import (
    agent_runner_command as _agent_runner_command_impl,
)
from sandbox_agent_runtime.runner_backend import (
    build_run_failed_event as _build_run_failed_event_impl,
)
from sandbox_agent_runtime.runner_backend import (
    execute_runner_request as _execute_runner_request_impl,
)
from sandbox_agent_runtime.runner_backend import (
    normalize_event as _normalize_event_impl,
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
)
from sandbox_agent_runtime.ts_api_proxy import TsApiProxySupport
from sandbox_agent_runtime.workspace_scope import WORKSPACE_ROOT, workspace_dir_for_id

logging.basicConfig(level=os.getenv("SANDBOX_AGENT_LOG_LEVEL", "INFO"))
logger = logging.getLogger("sandbox_agent_api")

app = FastAPI(title="holaboss-sandbox-agent", version="0.1.0")

_DEFAULT_OUTPUT_STREAM_POLL_INTERVAL_S = 0.05
def _output_stream_poll_interval_seconds() -> float:
    raw = (os.getenv("SANDBOX_OUTPUT_STREAM_POLL_INTERVAL_S") or "").strip()
    if not raw:
        return _DEFAULT_OUTPUT_STREAM_POLL_INTERVAL_S
    with suppress(ValueError):
        return min(max(float(raw), 0.01), 1.0)
    return _DEFAULT_OUTPUT_STREAM_POLL_INTERVAL_S


_ts_api_proxy = TsApiProxySupport(app=app, current_file=__file__)


def _ts_api_server_enabled() -> bool:
    return _ts_api_proxy.ts_api_server_enabled()


async def _ensure_managed_ts_api_server_ready() -> None:
    await _ts_api_proxy.ensure_managed_ts_api_server_ready()


async def _shutdown_managed_ts_api_server() -> None:
    await _ts_api_proxy.shutdown_managed_ts_api_server()


async def _proxy_ts_api_json(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
) -> Response:
    return await _ts_api_proxy.proxy_ts_api_json(method, path, params=params, json_body=json_body)


async def _proxy_ts_api_stream(
    path: str,
    *,
    params: dict[str, Any] | None = None,
) -> Response:
    return await _ts_api_proxy.proxy_ts_api_stream(path, params=params)


def _local_worker_state():
    return _local_worker_state_impl(app)


def _cron_scheduler_state():
    return _cron_scheduler_state_impl(app)


def _wake_local_worker() -> None:
    if _ts_queue_worker_enabled():
        return
    _local_worker_state().wake_event.set()


def _ts_queue_worker_enabled() -> bool:
    return _ts_queue_worker_enabled_impl(ts_api_server_enabled=_ts_api_server_enabled())


def _python_queue_worker_enabled() -> bool:
    return _python_queue_worker_enabled_impl(ts_api_server_enabled=_ts_api_server_enabled())


def _ts_cron_worker_enabled() -> bool:
    return _ts_cron_worker_enabled_impl(ts_api_server_enabled=_ts_api_server_enabled())


def _python_cron_worker_enabled() -> bool:
    return _python_cron_worker_enabled_impl(ts_api_server_enabled=_ts_api_server_enabled())


def _ts_bridge_worker_enabled() -> bool:
    return _ts_bridge_worker_enabled_impl(ts_api_server_enabled=_ts_api_server_enabled())


def _python_bridge_worker_enabled() -> bool:
    return _python_bridge_worker_enabled_impl(ts_api_server_enabled=_ts_api_server_enabled())


@app.on_event("startup")
async def startup_local_worker() -> None:
    await _startup_worker_control_plane_impl(
        app=app,
        local_worker_loop=_local_worker_loop,
        cron_scheduler_loop=_cron_scheduler_loop,
        ts_api_server_enabled=_ts_api_server_enabled(),
        logger=logger,
    )


@app.on_event("shutdown")
async def shutdown_local_worker() -> None:
    await _shutdown_worker_control_plane_impl(
        app=app,
        shutdown_managed_ts_api_server=_shutdown_managed_ts_api_server,
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


async def _process_claimed_input(record) -> None:
    await _process_claimed_input_service(record)


async def _process_available_inputs_once() -> int:
    return await _process_available_inputs_once_impl(
        claim_inputs=claim_inputs,
        process_claimed_input=_process_claimed_input,
    )


async def _local_worker_loop() -> None:
    await _local_worker_loop_impl(
        state=_local_worker_state(),
        process_available_inputs_once=_process_available_inputs_once,
    )


def _cronjob_check_interval_seconds() -> int:
    return _cronjob_check_interval_seconds_impl()


def _cronjob_next_run_at(*, cron_expression: str, now: datetime) -> str | None:
    return _cronjob_next_run_at_impl(cron_expression=cron_expression, now=now)


def _cronjob_is_due(job: dict[str, Any], *, now: datetime) -> bool:
    return _cronjob_is_due_impl(job, now=now)


def _queue_local_cronjob_run(job: dict[str, Any], *, now: datetime) -> None:
    _queue_local_cronjob_run_impl(
        job,
        now=now,
        get_workspace=get_workspace,
        ensure_runtime_state=ensure_runtime_state,
        enqueue_input=enqueue_input,
        insert_session_message=insert_session_message,
        update_runtime_state=update_runtime_state,
        wake_worker=_wake_local_worker,
    )


async def _cron_scheduler_loop() -> None:
    await _cron_scheduler_loop_impl(
        state=_cron_scheduler_state(),
        logger=logger,
        list_cronjobs=list_cronjobs,
        cronjob_is_due=_cronjob_is_due,
        queue_local_cronjob_run=_queue_local_cronjob_run,
        update_cronjob=update_cronjob,
        cronjob_next_run_at=_cronjob_next_run_at,
        interval=_cronjob_check_interval_seconds(),
    )


def _agent_runner_command(payload: RunnerRequest) -> str:
    return _agent_runner_command_impl(payload, default_command_template=_DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE)


def _build_run_failed_event(
    *,
    session_id: str,
    input_id: str,
    sequence: int,
    message: str,
    error_type: str = "RuntimeError",
) -> RunnerOutputEvent:
    return _build_run_failed_event_impl(
        session_id=session_id,
        input_id=input_id,
        sequence=sequence,
        message=message,
        error_type=error_type,
    )


def _sse_event(*, event: RunnerOutputEvent) -> bytes:
    event_name = event.event_type
    event_id = f"{event.input_id}:{event.sequence}"
    lines = [f"event: {event_name}", f"id: {event_id}", f"data: {event.model_dump_json()}"]
    return ("\n".join(lines) + "\n\n").encode("utf-8")


def _normalize_event(raw_event: Any) -> RunnerOutputEvent | None:
    return _normalize_event_impl(raw_event)


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
    return await _proxy_ts_api_json(
        "POST",
        "/api/v1/workspaces",
        json_body=payload.model_dump(mode="json"),
    )


@app.get("/api/v1/workspaces")
async def list_local_workspaces_endpoint(
    status: str | None = Query(None),
    include_deleted: bool = Query(False),
    limit: int = Query(50, ge=1),
    offset: int = Query(0, ge=0),
) -> LocalWorkspaceListResponse:
    return await _proxy_ts_api_json(
        "GET",
        "/api/v1/workspaces",
        params={
            "status": status,
            "include_deleted": include_deleted,
            "limit": limit,
            "offset": offset,
        },
    )


@app.get("/api/v1/workspaces/{workspace_id}")
async def get_local_workspace_endpoint(
    workspace_id: str,
    include_deleted: bool = Query(False),
) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "GET",
        f"/api/v1/workspaces/{workspace_id}",
        params={"include_deleted": include_deleted},
    )


@app.patch("/api/v1/workspaces/{workspace_id}")
async def update_local_workspace_endpoint(
    workspace_id: str,
    payload: LocalWorkspaceUpdateRequest,
) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "PATCH",
        f"/api/v1/workspaces/{workspace_id}",
        json_body=payload.model_dump(mode="json", exclude_unset=True),
    )


@app.delete("/api/v1/workspaces/{workspace_id}")
async def delete_local_workspace_endpoint(workspace_id: str) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "DELETE",
        f"/api/v1/workspaces/{workspace_id}",
    )


@app.post("/api/v1/sandbox/users/{holaboss_user_id}/workspaces/{workspace_id}/exec")
async def exec_local_workspace(
    holaboss_user_id: str,
    workspace_id: str,
    payload: ExecSandboxRequest,
) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "POST",
        f"/api/v1/sandbox/users/{holaboss_user_id}/workspaces/{workspace_id}/exec",
        json_body=payload.model_dump(mode="json"),
    )


@app.post("/api/v1/agent-sessions/queue")
async def queue_session_input(payload: QueueSessionInputRequest) -> QueueSessionInputResponse:
    response = await _proxy_ts_api_json(
        "POST",
        "/api/v1/agent-sessions/queue",
        json_body=payload.model_dump(mode="json"),
    )
    if response.status_code < 400:
        _wake_local_worker()
    return response


@app.get("/api/v1/agent-sessions/{session_id}/state")
async def get_local_session_state(
    session_id: str,
    workspace_id: str | None = Query(None),
    profile_id: str | None = Query(None),
) -> AgentSessionStateResponse:
    return await _proxy_ts_api_json(
        "GET",
        f"/api/v1/agent-sessions/{session_id}/state",
        params={
            "workspace_id": workspace_id,
            "profile_id": profile_id,
        },
    )


@app.get("/api/v1/agent-sessions/by-workspace/{workspace_id}/runtime-states")
async def list_workspace_runtime_states(
    workspace_id: str,
    limit: int = Query(100, ge=1),
    offset: int = Query(0, ge=0),
) -> SessionRuntimeStateListResponse:
    return await _proxy_ts_api_json(
        "GET",
        f"/api/v1/agent-sessions/by-workspace/{workspace_id}/runtime-states",
        params={"limit": limit, "offset": offset},
    )


@app.post("/api/v1/agent-sessions/{session_id}/artifacts")
async def create_local_session_artifact(
    session_id: str,
    payload: LocalSessionArtifactCreateRequest,
) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "POST",
        f"/api/v1/agent-sessions/{session_id}/artifacts",
        json_body=payload.model_dump(mode="json"),
    )


@app.get("/api/v1/agent-sessions/{session_id}/artifacts")
async def list_local_session_artifacts(
    session_id: str,
    workspace_id: str | None = Query(None),
    profile_id: str | None = Query(None),
) -> SessionArtifactListResponse:
    return await _proxy_ts_api_json(
        "GET",
        f"/api/v1/agent-sessions/{session_id}/artifacts",
        params={
            "workspace_id": workspace_id,
            "profile_id": profile_id,
        },
    )


@app.get("/api/v1/agent-sessions/by-workspace/{workspace_id}/with-artifacts")
async def list_local_sessions_with_artifacts(
    workspace_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> SessionWithArtifactsListResponse:
    return await _proxy_ts_api_json(
        "GET",
        f"/api/v1/agent-sessions/by-workspace/{workspace_id}/with-artifacts",
        params={"limit": limit, "offset": offset},
    )


@app.get("/api/v1/output-folders")
async def list_local_output_folders(workspace_id: str = Query(...)) -> LocalOutputFolderListResponse:
    return await _proxy_ts_api_json(
        "GET",
        "/api/v1/output-folders",
        params={"workspace_id": workspace_id},
    )


@app.post("/api/v1/output-folders")
async def create_local_output_folder(payload: LocalOutputFolderCreateRequest) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "POST",
        "/api/v1/output-folders",
        json_body=payload.model_dump(mode="json"),
    )


@app.get("/api/v1/output-folders/{folder_id}")
async def get_local_output_folder_endpoint(folder_id: str) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "GET",
        f"/api/v1/output-folders/{folder_id}",
    )


@app.patch("/api/v1/output-folders/{folder_id}")
async def update_local_output_folder_endpoint(
    folder_id: str,
    payload: LocalOutputFolderUpdateRequest,
) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "PATCH",
        f"/api/v1/output-folders/{folder_id}",
        json_body=payload.model_dump(mode="json", exclude_unset=True),
    )


@app.delete("/api/v1/output-folders/{folder_id}")
async def delete_local_output_folder_endpoint(folder_id: str) -> dict[str, bool]:
    return await _proxy_ts_api_json(
        "DELETE",
        f"/api/v1/output-folders/{folder_id}",
    )


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
    return await _proxy_ts_api_json(
        "GET",
        "/api/v1/outputs",
        params={
            "workspace_id": workspace_id,
            "output_type": output_type,
            "status": status,
            "platform": platform,
            "folder_id": folder_id,
            "limit": limit,
            "offset": offset,
        },
    )


@app.get("/api/v1/outputs/counts")
async def get_local_output_counts(workspace_id: str = Query(...)) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "GET",
        "/api/v1/outputs/counts",
        params={"workspace_id": workspace_id},
    )


@app.get("/api/v1/outputs/{output_id}")
async def get_local_output(output_id: str) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "GET",
        f"/api/v1/outputs/{output_id}",
    )


@app.post("/api/v1/outputs")
async def create_local_output_endpoint(payload: LocalOutputCreateRequest) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "POST",
        "/api/v1/outputs",
        json_body=payload.model_dump(mode="json"),
    )


@app.patch("/api/v1/outputs/{output_id}")
async def update_local_output_endpoint(output_id: str, payload: LocalOutputUpdateRequest) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "PATCH",
        f"/api/v1/outputs/{output_id}",
        json_body=payload.model_dump(mode="json", exclude_unset=True),
    )


@app.delete("/api/v1/outputs/{output_id}")
async def delete_local_output_endpoint(output_id: str) -> dict[str, bool]:
    return await _proxy_ts_api_json(
        "DELETE",
        f"/api/v1/outputs/{output_id}",
    )


@app.get("/api/v1/cronjobs")
async def list_local_cronjobs(
    workspace_id: str = Query(...),
    enabled_only: bool = Query(False),
) -> LocalCronjobListResponse:
    return await _proxy_ts_api_json(
        "GET",
        "/api/v1/cronjobs",
        params={"workspace_id": workspace_id, "enabled_only": enabled_only},
    )


@app.post("/api/v1/cronjobs")
async def create_local_cronjob_endpoint(payload: LocalCronjobCreateRequest) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "POST",
        "/api/v1/cronjobs",
        json_body=payload.model_dump(mode="json"),
    )


@app.get("/api/v1/cronjobs/{job_id}")
async def get_local_cronjob_endpoint(job_id: str) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "GET",
        f"/api/v1/cronjobs/{job_id}",
    )


@app.patch("/api/v1/cronjobs/{job_id}")
async def update_local_cronjob_endpoint(job_id: str, payload: LocalCronjobUpdateRequest) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "PATCH",
        f"/api/v1/cronjobs/{job_id}",
        json_body=payload.model_dump(mode="json", exclude_unset=True),
    )


@app.delete("/api/v1/cronjobs/{job_id}")
async def delete_local_cronjob_endpoint(job_id: str) -> dict[str, bool]:
    return await _proxy_ts_api_json(
        "DELETE",
        f"/api/v1/cronjobs/{job_id}",
    )


@app.get("/api/v1/task-proposals")
async def list_local_task_proposals(workspace_id: str = Query(...)) -> LocalTaskProposalListResponse:
    return await _proxy_ts_api_json(
        "GET",
        "/api/v1/task-proposals",
        params={"workspace_id": workspace_id},
    )


@app.get("/api/v1/task-proposals/unreviewed")
async def list_local_unreviewed_task_proposals(workspace_id: str = Query(...)) -> LocalTaskProposalListResponse:
    return await _proxy_ts_api_json(
        "GET",
        "/api/v1/task-proposals/unreviewed",
        params={"workspace_id": workspace_id},
    )


@app.get("/api/v1/task-proposals/unreviewed/stream")
async def stream_local_unreviewed_task_proposals(workspace_id: str = Query(...)) -> StreamingResponse:
    return await _proxy_ts_api_stream(
        "/api/v1/task-proposals/unreviewed/stream",
        params={"workspace_id": workspace_id},
    )


@app.post("/api/v1/task-proposals")
async def create_local_task_proposal_endpoint(payload: LocalTaskProposalCreateRequest) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "POST",
        "/api/v1/task-proposals",
        json_body=payload.model_dump(mode="json"),
    )


@app.get("/api/v1/task-proposals/{proposal_id}")
async def get_local_task_proposal_endpoint(proposal_id: str) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "GET",
        f"/api/v1/task-proposals/{proposal_id}",
    )


@app.patch("/api/v1/task-proposals/{proposal_id}")
async def update_local_task_proposal_state_endpoint(
    proposal_id: str, payload: LocalTaskProposalStateUpdateRequest
) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "PATCH",
        f"/api/v1/task-proposals/{proposal_id}",
        json_body=payload.model_dump(mode="json"),
    )


@app.get("/api/v1/agent-sessions/{session_id}/history")
async def get_local_session_history(
    session_id: str,
    workspace_id: str = Query(..., min_length=1),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    include_raw: bool = Query(False),
) -> SessionHistoryResponse:
    return await _proxy_ts_api_json(
        "GET",
        f"/api/v1/agent-sessions/{session_id}/history",
        params={
            "workspace_id": workspace_id,
            "limit": limit,
            "offset": offset,
            "include_raw": include_raw,
        },
    )


@app.get("/api/v1/agent-sessions/{session_id}/outputs/stream")
async def stream_local_session_outputs(
    session_id: str,
    request: Request,
    input_id: str | None = Query(None),
    include_history: bool = Query(True),
    stop_on_terminal: bool = Query(True),
) -> StreamingResponse:
    del request
    return await _proxy_ts_api_stream(
        f"/api/v1/agent-sessions/{session_id}/outputs/stream",
        params={
            "input_id": input_id,
            "include_history": include_history,
            "stop_on_terminal": stop_on_terminal,
        },
    )


@app.get("/api/v1/agent-sessions/{session_id}/outputs/events")
async def list_local_session_output_events(
    session_id: str,
    input_id: str | None = Query(None),
    include_history: bool = Query(True),
    after_event_id: int = Query(0, ge=0),
) -> dict[str, Any]:
    return await _proxy_ts_api_json(
        "GET",
        f"/api/v1/agent-sessions/{session_id}/outputs/events",
        params={
            "input_id": input_id,
            "include_history": include_history,
            "after_event_id": after_event_id,
        },
    )


@app.post("/api/v1/agent-runs")
async def run_agent(
    payload: RunnerRequest,
) -> WorkspaceAgentRunResponse:
    return await _run_agent_request_impl(
        payload,
        execute_runner_request=_execute_runner_request,
        build_run_failed_event=_build_run_failed_event,
    )


@app.post("/api/v1/agent-runs/stream")
async def stream_agent_run(
    payload: RunnerRequest,
) -> StreamingResponse:
    return await _stream_agent_run_request_impl(
        payload,
        agent_runner_command=_agent_runner_command,
        normalize_event=_normalize_event,
        build_run_failed_event=_build_run_failed_event,
        terminal_event_types=_TERMINAL_EVENT_TYPES,
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
    return await _execute_runner_request_impl(
        payload,
        on_event=on_event,
        default_command_template=_DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE,
        terminal_event_types=_TERMINAL_EVENT_TYPES,
    )


register_memory_routes(app)
