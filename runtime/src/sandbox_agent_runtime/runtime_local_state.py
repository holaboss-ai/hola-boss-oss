from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sandbox_agent_runtime.ts_bridge import run_ts_json_cli, runtime_root_dir
from sandbox_agent_runtime.workspace_scope import SANDBOX_ROOT, WORKSPACE_ROOT

_RUNTIME_DB_PATH_ENV = "HOLABOSS_RUNTIME_DB_PATH"
_TS_STATE_STORE_FLAG_ENV = "HOLABOSS_RUNTIME_USE_TS_STATE_STORE"
_TS_STATE_STORE_DISABLE_ENV = "HOLABOSS_RUNTIME_DISABLE_TS_STATE_STORE"
_WORKSPACE_RUNTIME_DIRNAME = ".holaboss"
_WORKSPACE_IDENTITY_FILENAME = "workspace_id"


@dataclass(frozen=True)
class WorkspaceRecord:
    id: str
    name: str
    status: str
    harness: str | None
    main_session_id: str | None
    error_message: str | None
    onboarding_status: str
    onboarding_session_id: str | None
    onboarding_completed_at: str | None
    onboarding_completion_summary: str | None
    onboarding_requested_at: str | None
    onboarding_requested_by: str | None
    created_at: str | None
    updated_at: str | None
    deleted_at_utc: str | None


@dataclass(frozen=True)
class SessionBindingRecord:
    workspace_id: str
    session_id: str
    harness: str
    harness_session_id: str
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class SessionInputRecord:
    input_id: str
    session_id: str
    workspace_id: str
    payload: dict[str, Any]
    status: str
    priority: int
    available_at: str
    attempt: int
    idempotency_key: str | None
    claimed_by: str | None
    claimed_until: str | None
    created_at: str
    updated_at: str


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _env_flag(name: str) -> bool | None:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return None
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return None


def _ts_state_store_enabled() -> bool:
    disabled = _env_flag(_TS_STATE_STORE_DISABLE_ENV)
    if disabled is True:
        return False

    explicit = _env_flag(_TS_STATE_STORE_FLAG_ENV)
    if explicit is not None:
        return explicit

    return True


def _runtime_root_dir() -> Path:
    return runtime_root_dir(__file__)


def _state_store_root_dir() -> Path:
    return _runtime_root_dir() / "state-store"


def _ts_state_store_request_options() -> dict[str, Any]:
    harness = (os.getenv("SANDBOX_AGENT_HARNESS") or "").strip()
    return {
        "dbPath": str(runtime_db_path()),
        "workspaceRoot": str(WORKSPACE_ROOT),
        "sandboxRoot": str(SANDBOX_ROOT),
        "sandboxAgentHarness": harness or None,
    }


def _ts_state_store_call(*, operation: str, payload: dict[str, Any]) -> Any:
    if not _ts_state_store_enabled():
        raise RuntimeError(
            "TypeScript state-store is required; unset HOLABOSS_RUNTIME_DISABLE_TS_STATE_STORE "
            "or enable HOLABOSS_RUNTIME_USE_TS_STATE_STORE"
        )

    return run_ts_json_cli(
        module_file=__file__,
        package_name="state-store",
        dist_entry="dist/cli.mjs",
        source_entry="src/cli.ts",
        operation=operation,
        payload={
            "options": _ts_state_store_request_options(),
            **payload,
        },
        missing_entry_message="TypeScript state-store entrypoint is required but was not found",
    )


def runtime_db_path() -> Path:
    explicit = (os.getenv(_RUNTIME_DB_PATH_ENV) or "").strip()
    if explicit:
        return Path(explicit).expanduser()
    return Path(SANDBOX_ROOT) / "state" / "runtime.db"


def workspace_dir(workspace_id: str) -> Path:
    resolved = _ts_state_store_call(operation="workspace-dir", payload={"workspace_id": workspace_id})
    if not isinstance(resolved, str):
        raise RuntimeError("invalid TypeScript state-store workspace_dir response")
    return Path(resolved)


def workspace_identity_path(workspace_id: str) -> Path:
    return workspace_dir(workspace_id) / _WORKSPACE_RUNTIME_DIRNAME / _WORKSPACE_IDENTITY_FILENAME


def _require_dict(value: Any, *, operation: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeError(f"invalid TypeScript state-store {operation} response")
    return value


def _require_list(value: Any, *, operation: str) -> list[Any]:
    if not isinstance(value, list):
        raise RuntimeError(f"invalid TypeScript state-store {operation} response")
    return value


def _workspace_record_from_payload(data: dict[str, Any]) -> WorkspaceRecord:
    return WorkspaceRecord(
        id=str(data["id"]),
        name=str(data["name"]),
        status=str(data["status"]),
        harness=str(data["harness"]) if data.get("harness") is not None else None,
        main_session_id=str(data["main_session_id"]) if data.get("main_session_id") is not None else None,
        error_message=str(data["error_message"]) if data.get("error_message") is not None else None,
        onboarding_status=str(data["onboarding_status"]),
        onboarding_session_id=str(data["onboarding_session_id"]) if data.get("onboarding_session_id") is not None else None,
        onboarding_completed_at=str(data["onboarding_completed_at"]) if data.get("onboarding_completed_at") is not None else None,
        onboarding_completion_summary=(
            str(data["onboarding_completion_summary"]) if data.get("onboarding_completion_summary") is not None else None
        ),
        onboarding_requested_at=str(data["onboarding_requested_at"]) if data.get("onboarding_requested_at") is not None else None,
        onboarding_requested_by=str(data["onboarding_requested_by"]) if data.get("onboarding_requested_by") is not None else None,
        created_at=str(data["created_at"]) if data.get("created_at") is not None else None,
        updated_at=str(data["updated_at"]) if data.get("updated_at") is not None else None,
        deleted_at_utc=str(data["deleted_at_utc"]) if data.get("deleted_at_utc") is not None else None,
    )


def _session_binding_record_from_payload(data: dict[str, Any]) -> SessionBindingRecord:
    return SessionBindingRecord(
        workspace_id=str(data["workspace_id"]),
        session_id=str(data["session_id"]),
        harness=str(data["harness"]),
        harness_session_id=str(data["harness_session_id"]),
        created_at=str(data["created_at"]),
        updated_at=str(data["updated_at"]),
    )


def _session_input_record_from_payload(data: dict[str, Any]) -> SessionInputRecord:
    payload = data.get("payload")
    if not isinstance(payload, dict):
        payload = {}
    return SessionInputRecord(
        input_id=str(data["input_id"]),
        session_id=str(data["session_id"]),
        workspace_id=str(data["workspace_id"]),
        payload=payload,
        status=str(data["status"]),
        priority=int(data["priority"]),
        available_at=str(data["available_at"]),
        attempt=int(data["attempt"]),
        idempotency_key=str(data["idempotency_key"]) if data.get("idempotency_key") is not None else None,
        claimed_by=str(data["claimed_by"]) if data.get("claimed_by") is not None else None,
        claimed_until=str(data["claimed_until"]) if data.get("claimed_until") is not None else None,
        created_at=str(data["created_at"]),
        updated_at=str(data["updated_at"]),
    )


def _runtime_state_from_payload(data: dict[str, Any]) -> dict[str, Any]:
    last_error = data.get("last_error")
    if not isinstance(last_error, dict):
        last_error = None if last_error is None else {"message": str(last_error)}
    return {
        "workspace_id": str(data["workspace_id"]),
        "session_id": str(data["session_id"]),
        "status": str(data["status"]),
        "current_input_id": str(data["current_input_id"]) if data.get("current_input_id") is not None else None,
        "current_worker_id": str(data["current_worker_id"]) if data.get("current_worker_id") is not None else None,
        "lease_until": str(data["lease_until"]) if data.get("lease_until") is not None else None,
        "heartbeat_at": str(data["heartbeat_at"]) if data.get("heartbeat_at") is not None else None,
        "last_error": last_error,
        "created_at": str(data["created_at"]),
        "updated_at": str(data["updated_at"]),
    }


def _session_artifact_from_payload(data: dict[str, Any]) -> dict[str, Any]:
    metadata = data.get("metadata")
    return {
        "id": str(data["id"]),
        "session_id": str(data["session_id"]),
        "workspace_id": str(data["workspace_id"]),
        "artifact_type": str(data["artifact_type"]),
        "external_id": str(data["external_id"]),
        "platform": str(data["platform"]) if data.get("platform") is not None else None,
        "title": str(data["title"]) if data.get("title") is not None else None,
        "metadata": metadata if isinstance(metadata, dict) else {},
        "created_at": str(data["created_at"]),
    }


def _output_folder_from_payload(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(data["id"]),
        "workspace_id": str(data["workspace_id"]),
        "name": str(data["name"]),
        "position": int(data["position"]),
        "created_at": str(data["created_at"]) if data.get("created_at") is not None else None,
        "updated_at": str(data["updated_at"]) if data.get("updated_at") is not None else None,
    }


def _output_from_payload(data: dict[str, Any]) -> dict[str, Any]:
    metadata = data.get("metadata")
    return {
        "id": str(data["id"]),
        "workspace_id": str(data["workspace_id"]),
        "output_type": str(data["output_type"]),
        "title": str(data["title"]) if data.get("title") is not None else "",
        "status": str(data["status"]) if data.get("status") is not None else "draft",
        "module_id": str(data["module_id"]) if data.get("module_id") is not None else None,
        "module_resource_id": str(data["module_resource_id"]) if data.get("module_resource_id") is not None else None,
        "file_path": str(data["file_path"]) if data.get("file_path") is not None else None,
        "html_content": str(data["html_content"]) if data.get("html_content") is not None else None,
        "session_id": str(data["session_id"]) if data.get("session_id") is not None else None,
        "artifact_id": str(data["artifact_id"]) if data.get("artifact_id") is not None else None,
        "folder_id": str(data["folder_id"]) if data.get("folder_id") is not None else None,
        "platform": str(data["platform"]) if data.get("platform") is not None else None,
        "metadata": metadata if isinstance(metadata, dict) else {},
        "created_at": str(data["created_at"]) if data.get("created_at") is not None else None,
        "updated_at": str(data["updated_at"]) if data.get("updated_at") is not None else None,
    }


def _cronjob_from_payload(data: dict[str, Any]) -> dict[str, Any]:
    delivery = data.get("delivery")
    metadata = data.get("metadata")
    return {
        "id": str(data["id"]),
        "workspace_id": str(data["workspace_id"]),
        "initiated_by": str(data["initiated_by"]),
        "name": str(data["name"]),
        "cron": str(data["cron"]),
        "description": str(data["description"]),
        "enabled": bool(data["enabled"]),
        "delivery": delivery if isinstance(delivery, dict) else {},
        "metadata": metadata if isinstance(metadata, dict) else {},
        "last_run_at": str(data["last_run_at"]) if data.get("last_run_at") is not None else None,
        "next_run_at": str(data["next_run_at"]) if data.get("next_run_at") is not None else None,
        "run_count": int(data["run_count"]),
        "last_status": str(data["last_status"]) if data.get("last_status") is not None else None,
        "last_error": str(data["last_error"]) if data.get("last_error") is not None else None,
        "created_at": str(data["created_at"]),
        "updated_at": str(data["updated_at"]),
    }


def _task_proposal_from_payload(data: dict[str, Any]) -> dict[str, Any]:
    source_event_ids = data.get("source_event_ids")
    if not isinstance(source_event_ids, list):
        source_event_ids = []
    return {
        "proposal_id": str(data["proposal_id"]),
        "workspace_id": str(data["workspace_id"]),
        "task_name": str(data["task_name"]),
        "task_prompt": str(data["task_prompt"]),
        "task_generation_rationale": str(data["task_generation_rationale"]),
        "source_event_ids": [str(item) for item in source_event_ids],
        "created_at": str(data["created_at"]),
        "state": str(data["state"]),
    }


def list_workspaces(*, include_deleted: bool = False) -> list[WorkspaceRecord]:
    result = _require_list(
        _ts_state_store_call(operation="list-workspaces", payload={"include_deleted": bool(include_deleted)}),
        operation="list_workspaces",
    )
    return [_workspace_record_from_payload(_require_dict(item, operation="list_workspaces")) for item in result]


def get_workspace(workspace_id: str, *, include_deleted: bool = False) -> WorkspaceRecord | None:
    result = _ts_state_store_call(
        operation="get-workspace",
        payload={"workspace_id": workspace_id, "include_deleted": bool(include_deleted)},
    )
    if result is None:
        return None
    return _workspace_record_from_payload(_require_dict(result, operation="get_workspace"))


def create_workspace(
    *,
    workspace_id: str | None = None,
    name: str,
    harness: str,
    status: str = "provisioning",
    main_session_id: str | None = None,
    onboarding_status: str = "not_required",
    onboarding_session_id: str | None = None,
    error_message: str | None = None,
) -> WorkspaceRecord:
    result = _require_dict(
        _ts_state_store_call(
            operation="create-workspace",
            payload={
                "workspace_id": workspace_id,
                "name": name,
                "harness": harness,
                "status": status,
                "main_session_id": main_session_id,
                "onboarding_status": onboarding_status,
                "onboarding_session_id": onboarding_session_id,
                "error_message": error_message,
            },
        ),
        operation="create_workspace",
    )
    return _workspace_record_from_payload(result)


def update_workspace(workspace_id: str, **fields: Any) -> WorkspaceRecord:
    result = _require_dict(
        _ts_state_store_call(operation="update-workspace", payload={"workspace_id": workspace_id, "fields": fields}),
        operation="update_workspace",
    )
    return _workspace_record_from_payload(result)


def delete_workspace(workspace_id: str) -> WorkspaceRecord:
    result = _require_dict(
        _ts_state_store_call(operation="delete-workspace", payload={"workspace_id": workspace_id}),
        operation="delete_workspace",
    )
    return _workspace_record_from_payload(result)


def upsert_binding(
    *,
    workspace_id: str,
    session_id: str,
    harness: str,
    harness_session_id: str,
) -> SessionBindingRecord:
    result = _require_dict(
        _ts_state_store_call(
            operation="upsert-binding",
            payload={
                "workspace_id": workspace_id,
                "session_id": session_id,
                "harness": harness,
                "harness_session_id": harness_session_id,
            },
        ),
        operation="upsert_binding",
    )
    return _session_binding_record_from_payload(result)


def get_binding(*, workspace_id: str, session_id: str) -> SessionBindingRecord | None:
    result = _ts_state_store_call(
        operation="get-binding",
        payload={"workspace_id": workspace_id, "session_id": session_id},
    )
    if result is None:
        return None
    return _session_binding_record_from_payload(_require_dict(result, operation="get_binding"))


def enqueue_input(
    *,
    workspace_id: str,
    session_id: str,
    payload: dict[str, Any],
    priority: int = 0,
    idempotency_key: str | None = None,
) -> SessionInputRecord:
    result = _require_dict(
        _ts_state_store_call(
            operation="enqueue-input",
            payload={
                "workspace_id": workspace_id,
                "session_id": session_id,
                "payload": payload,
                "priority": priority,
                "idempotency_key": idempotency_key,
            },
        ),
        operation="enqueue_input",
    )
    return _session_input_record_from_payload(result)


def get_input(input_id: str) -> SessionInputRecord | None:
    result = _ts_state_store_call(operation="get-input", payload={"input_id": input_id})
    if result is None:
        return None
    return _session_input_record_from_payload(_require_dict(result, operation="get_input"))


def get_input_by_idempotency_key(idempotency_key: str) -> SessionInputRecord | None:
    result = _ts_state_store_call(
        operation="get-input-by-idempotency-key",
        payload={"idempotency_key": idempotency_key},
    )
    if result is None:
        return None
    return _session_input_record_from_payload(_require_dict(result, operation="get_input_by_idempotency_key"))


def update_input(input_id: str, **fields: Any) -> SessionInputRecord | None:
    result = _ts_state_store_call(operation="update-input", payload={"input_id": input_id, "fields": fields})
    if result is None:
        return None
    return _session_input_record_from_payload(_require_dict(result, operation="update_input"))


def claim_inputs(*, limit: int, claimed_by: str, lease_seconds: int) -> list[SessionInputRecord]:
    result = _require_list(
        _ts_state_store_call(
            operation="claim-inputs",
            payload={"limit": limit, "claimed_by": claimed_by, "lease_seconds": lease_seconds},
        ),
        operation="claim_inputs",
    )
    return [_session_input_record_from_payload(_require_dict(item, operation="claim_inputs")) for item in result]


def has_available_inputs_for_session(*, session_id: str, workspace_id: str | None = None) -> bool:
    result = _ts_state_store_call(
        operation="has-available-inputs-for-session",
        payload={"session_id": session_id, "workspace_id": workspace_id},
    )
    return bool(result)


def ensure_runtime_state(
    *,
    workspace_id: str,
    session_id: str,
    status: str = "QUEUED",
    current_input_id: str | None = None,
) -> dict[str, Any]:
    result = _require_dict(
        _ts_state_store_call(
            operation="ensure-runtime-state",
            payload={
                "workspace_id": workspace_id,
                "session_id": session_id,
                "status": status,
                "current_input_id": current_input_id,
            },
        ),
        operation="ensure_runtime_state",
    )
    return _runtime_state_from_payload(result)


def update_runtime_state(
    *,
    workspace_id: str,
    session_id: str,
    status: str,
    current_input_id: str | None = None,
    current_worker_id: str | None = None,
    lease_until: str | None = None,
    heartbeat_at: str | None = None,
    last_error: dict[str, Any] | str | None = None,
) -> dict[str, Any]:
    result = _require_dict(
        _ts_state_store_call(
            operation="update-runtime-state",
            payload={
                "workspace_id": workspace_id,
                "session_id": session_id,
                "status": status,
                "current_input_id": current_input_id,
                "current_worker_id": current_worker_id,
                "lease_until": lease_until,
                "heartbeat_at": heartbeat_at,
                "last_error": last_error,
            },
        ),
        operation="update_runtime_state",
    )
    return _runtime_state_from_payload(result)


def list_runtime_states(workspace_id: str) -> list[dict[str, Any]]:
    result = _require_list(
        _ts_state_store_call(operation="list-runtime-states", payload={"workspace_id": workspace_id}),
        operation="list_runtime_states",
    )
    return [_runtime_state_from_payload(_require_dict(item, operation="list_runtime_states")) for item in result]


def get_runtime_state(*, session_id: str, workspace_id: str | None = None) -> dict[str, Any] | None:
    result = _ts_state_store_call(
        operation="get-runtime-state",
        payload={"session_id": session_id, "workspace_id": workspace_id},
    )
    if result is None:
        return None
    return _runtime_state_from_payload(_require_dict(result, operation="get_runtime_state"))


def insert_session_message(
    *,
    workspace_id: str,
    session_id: str,
    role: str,
    text: str,
    message_id: str | None = None,
    created_at: str | None = None,
) -> None:
    _ts_state_store_call(
        operation="insert-session-message",
        payload={
            "workspace_id": workspace_id,
            "session_id": session_id,
            "role": role,
            "text": text,
            "message_id": message_id,
            "created_at": created_at,
        },
    )


def list_session_messages(*, workspace_id: str, session_id: str) -> list[dict[str, Any]]:
    result = _require_list(
        _ts_state_store_call(
            operation="list-session-messages",
            payload={"workspace_id": workspace_id, "session_id": session_id},
        ),
        operation="list_session_messages",
    )
    return [_require_dict(item, operation="list_session_messages") for item in result]


def append_output_event(
    *,
    workspace_id: str,
    session_id: str,
    input_id: str,
    sequence: int,
    event_type: str,
    payload: dict[str, Any],
    created_at: str | None = None,
) -> None:
    _ts_state_store_call(
        operation="append-output-event",
        payload={
            "workspace_id": workspace_id,
            "session_id": session_id,
            "input_id": input_id,
            "sequence": sequence,
            "event_type": event_type,
            "payload": payload,
            "created_at": created_at,
        },
    )


def latest_output_event_id(*, session_id: str, input_id: str | None = None) -> int:
    result = _ts_state_store_call(
        operation="latest-output-event-id",
        payload={"session_id": session_id, "input_id": input_id},
    )
    return int(result or 0)


def list_output_events(
    *,
    session_id: str,
    input_id: str | None = None,
    include_history: bool = True,
    after_event_id: int = 0,
) -> list[dict[str, Any]]:
    result = _require_list(
        _ts_state_store_call(
            operation="list-output-events",
            payload={
                "session_id": session_id,
                "input_id": input_id,
                "include_history": include_history,
                "after_event_id": after_event_id,
            },
        ),
        operation="list_output_events",
    )
    return [_require_dict(item, operation="list_output_events") for item in result]


def create_session_artifact(
    *,
    session_id: str,
    workspace_id: str,
    artifact_type: str,
    external_id: str,
    platform: str | None = None,
    title: str | None = None,
    metadata: dict[str, Any] | None = None,
    artifact_id: str | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    result = _require_dict(
        _ts_state_store_call(
            operation="create-session-artifact",
            payload={
                "session_id": session_id,
                "workspace_id": workspace_id,
                "artifact_type": artifact_type,
                "external_id": external_id,
                "platform": platform,
                "title": title,
                "metadata": metadata or {},
                "artifact_id": artifact_id,
                "created_at": created_at,
            },
        ),
        operation="create_session_artifact",
    )
    return _session_artifact_from_payload(result)


def list_session_artifacts(*, session_id: str, workspace_id: str | None = None) -> list[dict[str, Any]]:
    result = _require_list(
        _ts_state_store_call(
            operation="list-session-artifacts",
            payload={"session_id": session_id, "workspace_id": workspace_id},
        ),
        operation="list_session_artifacts",
    )
    return [_session_artifact_from_payload(_require_dict(item, operation="list_session_artifacts")) for item in result]


def list_sessions_with_artifacts(*, workspace_id: str, limit: int = 20, offset: int = 0) -> list[dict[str, Any]]:
    result = _require_list(
        _ts_state_store_call(
            operation="list-sessions-with-artifacts",
            payload={"workspace_id": workspace_id, "limit": limit, "offset": offset},
        ),
        operation="list_sessions_with_artifacts",
    )
    return [_require_dict(item, operation="list_sessions_with_artifacts") for item in result]


def create_output_folder(*, workspace_id: str, name: str) -> dict[str, Any]:
    result = _require_dict(
        _ts_state_store_call(
            operation="create-output-folder",
            payload={"workspace_id": workspace_id, "name": name},
        ),
        operation="create_output_folder",
    )
    return _output_folder_from_payload(result)


def list_output_folders(*, workspace_id: str) -> list[dict[str, Any]]:
    result = _require_list(
        _ts_state_store_call(operation="list-output-folders", payload={"workspace_id": workspace_id}),
        operation="list_output_folders",
    )
    return [_output_folder_from_payload(_require_dict(item, operation="list_output_folders")) for item in result]


def update_output_folder(
    *,
    folder_id: str,
    name: str | None = None,
    position: int | None = None,
) -> dict[str, Any] | None:
    result = _ts_state_store_call(
        operation="update-output-folder",
        payload={"folder_id": folder_id, "name": name, "position": position},
    )
    if result is None:
        return None
    return _output_folder_from_payload(_require_dict(result, operation="update_output_folder"))


def get_output_folder(folder_id: str) -> dict[str, Any] | None:
    result = _ts_state_store_call(operation="get-output-folder", payload={"folder_id": folder_id})
    if result is None:
        return None
    return _output_folder_from_payload(_require_dict(result, operation="get_output_folder"))


def delete_output_folder(folder_id: str) -> bool:
    return bool(_ts_state_store_call(operation="delete-output-folder", payload={"folder_id": folder_id}))


def create_output(
    *,
    workspace_id: str,
    output_type: str,
    title: str = "",
    module_id: str | None = None,
    module_resource_id: str | None = None,
    file_path: str | None = None,
    html_content: str | None = None,
    session_id: str | None = None,
    artifact_id: str | None = None,
    folder_id: str | None = None,
    platform: str | None = None,
    metadata: dict[str, Any] | None = None,
    output_id: str | None = None,
) -> dict[str, Any]:
    result = _require_dict(
        _ts_state_store_call(
            operation="create-output",
            payload={
                "workspace_id": workspace_id,
                "output_type": output_type,
                "title": title,
                "module_id": module_id,
                "module_resource_id": module_resource_id,
                "file_path": file_path,
                "html_content": html_content,
                "session_id": session_id,
                "artifact_id": artifact_id,
                "folder_id": folder_id,
                "platform": platform,
                "metadata": metadata or {},
                "output_id": output_id,
            },
        ),
        operation="create_output",
    )
    return _output_from_payload(result)


def list_outputs(
    *,
    workspace_id: str,
    output_type: str | None = None,
    status: str | None = None,
    platform: str | None = None,
    folder_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    result = _require_list(
        _ts_state_store_call(
            operation="list-outputs",
            payload={
                "workspace_id": workspace_id,
                "output_type": output_type,
                "status": status,
                "platform": platform,
                "folder_id": folder_id,
                "limit": limit,
                "offset": offset,
            },
        ),
        operation="list_outputs",
    )
    return [_output_from_payload(_require_dict(item, operation="list_outputs")) for item in result]


def get_output(output_id: str) -> dict[str, Any] | None:
    result = _ts_state_store_call(operation="get-output", payload={"output_id": output_id})
    if result is None:
        return None
    return _output_from_payload(_require_dict(result, operation="get_output"))


def update_output(
    *,
    output_id: str,
    title: str | None = None,
    status: str | None = None,
    module_resource_id: str | None = None,
    file_path: str | None = None,
    html_content: str | None = None,
    metadata: dict[str, Any] | None = None,
    folder_id: str | None = None,
) -> dict[str, Any] | None:
    result = _ts_state_store_call(
        operation="update-output",
        payload={
            "output_id": output_id,
            "title": title,
            "status": status,
            "module_resource_id": module_resource_id,
            "file_path": file_path,
            "html_content": html_content,
            "metadata": metadata,
            "folder_id": folder_id,
        },
    )
    if result is None:
        return None
    return _output_from_payload(_require_dict(result, operation="update_output"))


def delete_output(output_id: str) -> bool:
    return bool(_ts_state_store_call(operation="delete-output", payload={"output_id": output_id}))


def get_output_counts(*, workspace_id: str) -> dict[str, Any]:
    result = _require_dict(
        _ts_state_store_call(operation="get-output-counts", payload={"workspace_id": workspace_id}),
        operation="get_output_counts",
    )
    return result


def create_cronjob(
    *,
    workspace_id: str,
    initiated_by: str,
    cron: str,
    description: str,
    delivery: dict[str, Any],
    enabled: bool = True,
    metadata: dict[str, Any] | None = None,
    name: str = "",
    job_id: str | None = None,
    next_run_at: str | None = None,
) -> dict[str, Any]:
    result = _require_dict(
        _ts_state_store_call(
            operation="create-cronjob",
            payload={
                "workspace_id": workspace_id,
                "initiated_by": initiated_by,
                "name": name,
                "cron": cron,
                "description": description,
                "enabled": enabled,
                "delivery": delivery,
                "metadata": metadata or {},
                "job_id": job_id,
                "next_run_at": next_run_at,
            },
        ),
        operation="create_cronjob",
    )
    return _cronjob_from_payload(result)


def create_task_proposal(
    *,
    proposal_id: str,
    workspace_id: str,
    task_name: str,
    task_prompt: str,
    task_generation_rationale: str,
    source_event_ids: list[str],
    created_at: str,
    state: str = "not_reviewed",
) -> dict[str, Any]:
    result = _require_dict(
        _ts_state_store_call(
            operation="create-task-proposal",
            payload={
                "proposal_id": proposal_id,
                "workspace_id": workspace_id,
                "task_name": task_name,
                "task_prompt": task_prompt,
                "task_generation_rationale": task_generation_rationale,
                "source_event_ids": source_event_ids,
                "created_at": created_at,
                "state": state,
            },
        ),
        operation="create_task_proposal",
    )
    return _task_proposal_from_payload(result)


def get_task_proposal(proposal_id: str) -> dict[str, Any] | None:
    result = _ts_state_store_call(operation="get-task-proposal", payload={"proposal_id": proposal_id})
    if result is None:
        return None
    return _task_proposal_from_payload(_require_dict(result, operation="get_task_proposal"))


def list_task_proposals(*, workspace_id: str) -> list[dict[str, Any]]:
    result = _require_list(
        _ts_state_store_call(operation="list-task-proposals", payload={"workspace_id": workspace_id}),
        operation="list_task_proposals",
    )
    return [_task_proposal_from_payload(_require_dict(item, operation="list_task_proposals")) for item in result]


def list_unreviewed_task_proposals(*, workspace_id: str) -> list[dict[str, Any]]:
    result = _require_list(
        _ts_state_store_call(operation="list-unreviewed-task-proposals", payload={"workspace_id": workspace_id}),
        operation="list_unreviewed_task_proposals",
    )
    return [
        _task_proposal_from_payload(_require_dict(item, operation="list_unreviewed_task_proposals")) for item in result
    ]


def update_task_proposal_state(*, proposal_id: str, state: str) -> dict[str, Any] | None:
    result = _ts_state_store_call(
        operation="update-task-proposal-state",
        payload={"proposal_id": proposal_id, "state": state},
    )
    if result is None:
        return None
    return _task_proposal_from_payload(_require_dict(result, operation="update_task_proposal_state"))


def get_cronjob(job_id: str) -> dict[str, Any] | None:
    result = _ts_state_store_call(operation="get-cronjob", payload={"job_id": job_id})
    if result is None:
        return None
    return _cronjob_from_payload(_require_dict(result, operation="get_cronjob"))


def list_cronjobs(*, workspace_id: str | None = None, enabled_only: bool = False) -> list[dict[str, Any]]:
    result = _require_list(
        _ts_state_store_call(
            operation="list-cronjobs",
            payload={"workspace_id": workspace_id, "enabled_only": enabled_only},
        ),
        operation="list_cronjobs",
    )
    return [_cronjob_from_payload(_require_dict(item, operation="list_cronjobs")) for item in result]


def update_cronjob(
    *,
    job_id: str,
    name: str | None = None,
    cron: str | None = None,
    description: str | None = None,
    enabled: bool | None = None,
    delivery: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    last_run_at: str | None = None,
    next_run_at: str | None = None,
    run_count: int | None = None,
    last_status: str | None = None,
    last_error: str | None = None,
) -> dict[str, Any] | None:
    result = _ts_state_store_call(
        operation="update-cronjob",
        payload={
            "job_id": job_id,
            "name": name,
            "cron": cron,
            "description": description,
            "enabled": enabled,
            "delivery": delivery,
            "metadata": metadata,
            "last_run_at": last_run_at,
            "next_run_at": next_run_at,
            "run_count": run_count,
            "last_status": last_status,
            "last_error": last_error,
        },
    )
    if result is None:
        return None
    return _cronjob_from_payload(_require_dict(result, operation="update_cronjob"))


def delete_cronjob(job_id: str) -> bool:
    return bool(_ts_state_store_call(operation="delete-cronjob", payload={"job_id": job_id}))


def upsert_app_build(
    *,
    workspace_id: str,
    app_id: str,
    status: str,
    error: str | None = None,
) -> dict[str, Any]:
    result = _require_dict(
        _ts_state_store_call(
            operation="upsert-app-build",
            payload={"workspace_id": workspace_id, "app_id": app_id, "status": status, "error": error},
        ),
        operation="upsert_app_build",
    )
    return result


def get_app_build(*, workspace_id: str, app_id: str) -> dict[str, Any] | None:
    result = _ts_state_store_call(
        operation="get-app-build",
        payload={"workspace_id": workspace_id, "app_id": app_id},
    )
    if result is None:
        return None
    return _require_dict(result, operation="get_app_build")


def delete_app_build(*, workspace_id: str, app_id: str) -> bool:
    return bool(
        _ts_state_store_call(
            operation="delete-app-build",
            payload={"workspace_id": workspace_id, "app_id": app_id},
        )
    )


__all__ = [
    "SessionBindingRecord",
    "SessionInputRecord",
    "WorkspaceRecord",
    "append_output_event",
    "claim_inputs",
    "create_cronjob",
    "create_output",
    "create_output_folder",
    "create_session_artifact",
    "create_task_proposal",
    "create_workspace",
    "delete_app_build",
    "delete_cronjob",
    "delete_output",
    "delete_output_folder",
    "delete_workspace",
    "enqueue_input",
    "ensure_runtime_db_schema",
    "ensure_runtime_state",
    "get_app_build",
    "get_binding",
    "get_cronjob",
    "get_input",
    "get_input_by_idempotency_key",
    "get_output",
    "get_output_counts",
    "get_output_folder",
    "get_runtime_state",
    "get_task_proposal",
    "get_workspace",
    "has_available_inputs_for_session",
    "insert_session_message",
    "latest_output_event_id",
    "list_cronjobs",
    "list_output_events",
    "list_output_folders",
    "list_outputs",
    "list_runtime_states",
    "list_session_artifacts",
    "list_session_messages",
    "list_sessions_with_artifacts",
    "list_task_proposals",
    "list_unreviewed_task_proposals",
    "list_workspaces",
    "runtime_db_connection",
    "runtime_db_path",
    "update_cronjob",
    "update_input",
    "update_output",
    "update_output_folder",
    "update_runtime_state",
    "update_task_proposal_state",
    "update_workspace",
    "upsert_app_build",
    "upsert_binding",
    "utc_now_iso",
    "workspace_dir",
    "workspace_identity_path",
]
