from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.responses import Response, StreamingResponse

from sandbox_agent_runtime.api_models import (
    AgentSessionStateResponse,
    AppActionResult,
    AppSetupRequest,
    AppStartRequest,
    AppStopRequest,
    ApplyTemplateRequest,
    ExecSandboxRequest,
    InstallAppRequest,
    InstallAppResponse,
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
    RuntimeConfigUpdateRequest,
    SessionArtifactListResponse,
    SessionHistoryResponse,
    SessionRuntimeStateListResponse,
    SessionWithArtifactsListResponse,
    ShutdownResult,
    UninstallAppRequest,
    WriteFileRequest,
)
from sandbox_agent_runtime.runner import (
    RunnerRequest,
)
from sandbox_agent_runtime.workspace_scope import WORKSPACE_ROOT
from sandbox_agent_runtime.ts_api_proxy import TsApiProxySupport

logging.basicConfig(level=os.getenv("SANDBOX_AGENT_LOG_LEVEL", "INFO"))

@asynccontextmanager
async def _app_lifespan(_: FastAPI):
    try:
        yield
    finally:
        await _ts_api_proxy.shutdown_managed_ts_api_server()


app = FastAPI(title="holaboss-sandbox-agent", version="0.1.0", lifespan=_app_lifespan)


_ts_api_proxy = TsApiProxySupport(app=app, current_file=__file__)


@app.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/v1/runtime/config")
async def get_runtime_config() -> Response:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        "/api/v1/runtime/config",
    )


@app.get("/api/v1/runtime/status")
async def get_runtime_status() -> Response:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        "/api/v1/runtime/status",
    )


@app.put("/api/v1/runtime/config")
async def put_runtime_config(payload: RuntimeConfigUpdateRequest) -> Response:
    return await _ts_api_proxy.proxy_ts_api_json(
        "PUT",
        "/api/v1/runtime/config",
        json_body=payload.model_dump(mode="json"),
    )


@app.post("/api/v1/workspaces")
async def create_local_workspace_endpoint(payload: LocalWorkspaceCreateRequest) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
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
    return await _ts_api_proxy.proxy_ts_api_json(
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
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        f"/api/v1/workspaces/{workspace_id}",
        params={"include_deleted": include_deleted},
    )


@app.patch("/api/v1/workspaces/{workspace_id}")
async def update_local_workspace_endpoint(
    workspace_id: str,
    payload: LocalWorkspaceUpdateRequest,
) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "PATCH",
        f"/api/v1/workspaces/{workspace_id}",
        json_body=payload.model_dump(mode="json", exclude_unset=True),
    )


@app.delete("/api/v1/workspaces/{workspace_id}")
async def delete_local_workspace_endpoint(workspace_id: str) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "DELETE",
        f"/api/v1/workspaces/{workspace_id}",
    )


@app.post("/api/v1/sandbox/users/{holaboss_user_id}/workspaces/{workspace_id}/exec")
async def exec_local_workspace(
    holaboss_user_id: str,
    workspace_id: str,
    payload: ExecSandboxRequest,
) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        f"/api/v1/sandbox/users/{holaboss_user_id}/workspaces/{workspace_id}/exec",
        json_body=payload.model_dump(mode="json"),
    )


@app.post("/api/v1/agent-sessions/queue")
async def queue_session_input(payload: QueueSessionInputRequest) -> QueueSessionInputResponse:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/agent-sessions/queue",
        json_body=payload.model_dump(mode="json"),
    )


@app.post("/api/v1/internal/workspaces/{workspace_id}/opencode-apps/start")
async def start_opencode_workspace_apps_internal(workspace_id: str, request: Request) -> Response:
    payload = await request.json()
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        f"/api/v1/internal/workspaces/{workspace_id}/opencode-apps/start",
        json_body=payload,
    )


@app.get("/api/v1/agent-sessions/{session_id}/state")
async def get_local_session_state(
    session_id: str,
    workspace_id: str | None = Query(None),
    profile_id: str | None = Query(None),
) -> AgentSessionStateResponse:
    return await _ts_api_proxy.proxy_ts_api_json(
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
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        f"/api/v1/agent-sessions/by-workspace/{workspace_id}/runtime-states",
        params={"limit": limit, "offset": offset},
    )


@app.post("/api/v1/agent-sessions/{session_id}/artifacts")
async def create_local_session_artifact(
    session_id: str,
    payload: LocalSessionArtifactCreateRequest,
) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
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
    return await _ts_api_proxy.proxy_ts_api_json(
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
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        f"/api/v1/agent-sessions/by-workspace/{workspace_id}/with-artifacts",
        params={"limit": limit, "offset": offset},
    )


@app.get("/api/v1/output-folders")
async def list_local_output_folders(workspace_id: str = Query(...)) -> LocalOutputFolderListResponse:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        "/api/v1/output-folders",
        params={"workspace_id": workspace_id},
    )


@app.post("/api/v1/output-folders")
async def create_local_output_folder(payload: LocalOutputFolderCreateRequest) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/output-folders",
        json_body=payload.model_dump(mode="json"),
    )


@app.get("/api/v1/output-folders/{folder_id}")
async def get_local_output_folder_endpoint(folder_id: str) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        f"/api/v1/output-folders/{folder_id}",
    )


@app.patch("/api/v1/output-folders/{folder_id}")
async def update_local_output_folder_endpoint(
    folder_id: str,
    payload: LocalOutputFolderUpdateRequest,
) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "PATCH",
        f"/api/v1/output-folders/{folder_id}",
        json_body=payload.model_dump(mode="json", exclude_unset=True),
    )


@app.delete("/api/v1/output-folders/{folder_id}")
async def delete_local_output_folder_endpoint(folder_id: str) -> dict[str, bool]:
    return await _ts_api_proxy.proxy_ts_api_json(
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
    return await _ts_api_proxy.proxy_ts_api_json(
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
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        "/api/v1/outputs/counts",
        params={"workspace_id": workspace_id},
    )


@app.get("/api/v1/outputs/{output_id}")
async def get_local_output(output_id: str) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        f"/api/v1/outputs/{output_id}",
    )


@app.post("/api/v1/outputs")
async def create_local_output_endpoint(payload: LocalOutputCreateRequest) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/outputs",
        json_body=payload.model_dump(mode="json"),
    )


@app.patch("/api/v1/outputs/{output_id}")
async def update_local_output_endpoint(output_id: str, payload: LocalOutputUpdateRequest) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "PATCH",
        f"/api/v1/outputs/{output_id}",
        json_body=payload.model_dump(mode="json", exclude_unset=True),
    )


@app.delete("/api/v1/outputs/{output_id}")
async def delete_local_output_endpoint(output_id: str) -> dict[str, bool]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "DELETE",
        f"/api/v1/outputs/{output_id}",
    )


@app.get("/api/v1/cronjobs")
async def list_local_cronjobs(
    workspace_id: str = Query(...),
    enabled_only: bool = Query(False),
) -> LocalCronjobListResponse:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        "/api/v1/cronjobs",
        params={"workspace_id": workspace_id, "enabled_only": enabled_only},
    )


@app.post("/api/v1/cronjobs")
async def create_local_cronjob_endpoint(payload: LocalCronjobCreateRequest) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/cronjobs",
        json_body=payload.model_dump(mode="json"),
    )


@app.get("/api/v1/cronjobs/{job_id}")
async def get_local_cronjob_endpoint(job_id: str) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        f"/api/v1/cronjobs/{job_id}",
    )


@app.patch("/api/v1/cronjobs/{job_id}")
async def update_local_cronjob_endpoint(job_id: str, payload: LocalCronjobUpdateRequest) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "PATCH",
        f"/api/v1/cronjobs/{job_id}",
        json_body=payload.model_dump(mode="json", exclude_unset=True),
    )


@app.delete("/api/v1/cronjobs/{job_id}")
async def delete_local_cronjob_endpoint(job_id: str) -> dict[str, bool]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "DELETE",
        f"/api/v1/cronjobs/{job_id}",
    )


@app.get("/api/v1/task-proposals")
async def list_local_task_proposals(workspace_id: str = Query(...)) -> LocalTaskProposalListResponse:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        "/api/v1/task-proposals",
        params={"workspace_id": workspace_id},
    )


@app.get("/api/v1/task-proposals/unreviewed")
async def list_local_unreviewed_task_proposals(workspace_id: str = Query(...)) -> LocalTaskProposalListResponse:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        "/api/v1/task-proposals/unreviewed",
        params={"workspace_id": workspace_id},
    )


@app.get("/api/v1/task-proposals/unreviewed/stream")
async def stream_local_unreviewed_task_proposals(workspace_id: str = Query(...)) -> StreamingResponse:
    return await _ts_api_proxy.proxy_ts_api_stream(
        "/api/v1/task-proposals/unreviewed/stream",
        params={"workspace_id": workspace_id},
    )


@app.post("/api/v1/task-proposals")
async def create_local_task_proposal_endpoint(payload: LocalTaskProposalCreateRequest) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/task-proposals",
        json_body=payload.model_dump(mode="json"),
    )


@app.get("/api/v1/task-proposals/{proposal_id}")
async def get_local_task_proposal_endpoint(proposal_id: str) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        f"/api/v1/task-proposals/{proposal_id}",
    )


@app.patch("/api/v1/task-proposals/{proposal_id}")
async def update_local_task_proposal_state_endpoint(
    proposal_id: str, payload: LocalTaskProposalStateUpdateRequest
) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
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
    return await _ts_api_proxy.proxy_ts_api_json(
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
    return await _ts_api_proxy.proxy_ts_api_stream(
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
    return await _ts_api_proxy.proxy_ts_api_json(
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
) -> Response:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/agent-runs",
        json_body=payload.model_dump(mode="json"),
    )


@app.post("/api/v1/agent-runs/stream")
async def stream_agent_run(
    payload: RunnerRequest,
) -> Response:
    return await _ts_api_proxy.proxy_ts_api_stream(
        "/api/v1/agent-runs/stream",
        method="POST",
        json_body=payload.model_dump(mode="json"),
    )


@app.post("/api/v1/lifecycle/shutdown")
async def lifecycle_shutdown() -> ShutdownResult:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/lifecycle/shutdown",
    )


@app.post("/api/v1/memory/search")
async def memory_search_endpoint(payload: MemorySearchRequest) -> Response:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/memory/search",
        json_body=payload.model_dump(mode="json"),
    )


@app.post("/api/v1/memory/get")
async def memory_get_endpoint(payload: MemoryGetRequest) -> Response:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/memory/get",
        json_body=payload.model_dump(mode="json"),
    )


@app.post("/api/v1/memory/upsert")
async def memory_upsert_endpoint(payload: MemoryUpsertRequest) -> Response:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/memory/upsert",
        json_body=payload.model_dump(mode="json"),
    )


@app.post("/api/v1/memory/status")
async def memory_status_endpoint(payload: MemoryStatusRequest) -> Response:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/memory/status",
        json_body=payload.model_dump(mode="json"),
    )


@app.post("/api/v1/memory/sync")
async def memory_sync_endpoint(payload: MemorySyncRequest) -> Response:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/memory/sync",
        json_body=payload.model_dump(mode="json"),
    )


# ---------------------------------------------------------------------------
# Per-app start / stop endpoints
# ---------------------------------------------------------------------------
@app.get("/api/v1/apps/ports")
async def list_app_ports(workspace_id: str | None = None) -> dict[str, dict[str, int]]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        "/api/v1/apps/ports",
        params={"workspace_id": workspace_id},
    )


@app.post("/api/v1/apps/{app_id}/start")
async def start_app_endpoint(app_id: str, payload: AppStartRequest) -> AppActionResult:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        f"/api/v1/apps/{app_id}/start",
        json_body=payload.model_dump(),
    )


@app.post("/api/v1/apps/{app_id}/stop")
async def stop_app_endpoint(app_id: str, payload: AppStopRequest) -> AppActionResult:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        f"/api/v1/apps/{app_id}/stop",
        json_body=payload.model_dump(),
    )


# ---------------------------------------------------------------------------
# App install / uninstall / build-status / list / setup endpoints
# ---------------------------------------------------------------------------

@app.post("/api/v1/apps/install")
async def install_app(payload: InstallAppRequest) -> InstallAppResponse:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        "/api/v1/apps/install",
        json_body=payload.model_dump(),
    )


@app.delete("/api/v1/apps/{app_id}")
async def uninstall_app(app_id: str, payload: UninstallAppRequest) -> AppActionResult:
    return await _ts_api_proxy.proxy_ts_api_json(
        "DELETE",
        f"/api/v1/apps/{app_id}",
        json_body=payload.model_dump(),
    )


@app.get("/api/v1/apps/{app_id}/build-status")
async def app_build_status(app_id: str, workspace_id: str = Query(...)) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        f"/api/v1/apps/{app_id}/build-status",
        params={"workspace_id": workspace_id},
    )


@app.get("/api/v1/apps")
async def list_installed_apps(workspace_id: str = Query(...)) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        "/api/v1/apps",
        params={"workspace_id": workspace_id},
    )


@app.post("/api/v1/apps/{app_id}/setup")
async def setup_app_endpoint(app_id: str, payload: AppSetupRequest) -> AppActionResult:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        f"/api/v1/apps/{app_id}/setup",
        json_body=payload.model_dump(),
    )

@app.post("/api/v1/workspaces/{workspace_id}/apply-template")
async def apply_template(workspace_id: str, payload: ApplyTemplateRequest) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "POST",
        f"/api/v1/workspaces/{workspace_id}/apply-template",
        json_body=payload.model_dump(mode="json"),
    )


@app.get("/api/v1/workspaces/{workspace_id}/files/{file_path:path}")
async def read_file_endpoint(workspace_id: str, file_path: str) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        f"/api/v1/workspaces/{workspace_id}/files/{file_path}",
    )

@app.put("/api/v1/workspaces/{workspace_id}/files/{file_path:path}")
async def write_file_endpoint(workspace_id: str, file_path: str, payload: WriteFileRequest) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "PUT",
        f"/api/v1/workspaces/{workspace_id}/files/{file_path}",
        json_body=payload.model_dump(mode="json"),
    )


@app.get("/api/v1/workspaces/{workspace_id}/snapshot")
async def workspace_snapshot(workspace_id: str) -> dict[str, Any]:
    return await _ts_api_proxy.proxy_ts_api_json(
        "GET",
        f"/api/v1/workspaces/{workspace_id}/snapshot",
    )


@app.get("/api/v1/workspaces/{workspace_id}/export")
async def export_workspace(workspace_id: str):
    return await _ts_api_proxy.proxy_ts_api_stream(
        f"/api/v1/workspaces/{workspace_id}/export",
    )
