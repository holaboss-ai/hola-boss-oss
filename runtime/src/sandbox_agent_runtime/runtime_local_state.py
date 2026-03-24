from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from sandbox_agent_runtime.workspace_scope import SANDBOX_ROOT, WORKSPACE_ROOT, sanitize_workspace_id

_RUNTIME_DB_PATH_ENV = "HOLABOSS_RUNTIME_DB_PATH"
_WORKSPACE_RUNTIME_DIRNAME = ".holaboss"
_WORKSPACE_IDENTITY_FILENAME = "workspace_id"
_LEGACY_WORKSPACE_METADATA_FILENAME = "workspace.json"


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


_WORKSPACE_UPDATE_FIELDS = frozenset({
    "status",
    "main_session_id",
    "error_message",
    "deleted_at_utc",
    "onboarding_status",
    "onboarding_session_id",
    "onboarding_completed_at",
    "onboarding_completion_summary",
    "onboarding_requested_at",
    "onboarding_requested_by",
})

_INPUT_UPDATE_FIELDS = frozenset({
    "session_id",
    "workspace_id",
    "payload",
    "status",
    "priority",
    "available_at",
    "attempt",
    "idempotency_key",
    "claimed_by",
    "claimed_until",
})


def runtime_db_path() -> Path:
    explicit = (os.getenv(_RUNTIME_DB_PATH_ENV) or "").strip()
    if explicit:
        return Path(explicit).expanduser()
    return Path(SANDBOX_ROOT) / "state" / "runtime.db"


def _default_workspace_dir(workspace_id: str) -> Path:
    return Path(WORKSPACE_ROOT) / sanitize_workspace_id(workspace_id)


def workspace_dir(workspace_id: str) -> Path:
    _ensure_workspace_metadata_ready()
    registered = _workspace_path_from_registry(workspace_id)
    if registered is not None:
        path = Path(registered)
        if path.is_dir():
            return path

    discovered = _discover_workspace_path(workspace_id)
    if discovered is not None:
        _update_workspace_path(workspace_id, discovered)
        return discovered

    return _default_workspace_dir(workspace_id)


def workspace_identity_path(workspace_id: str) -> Path:
    return workspace_dir(workspace_id) / _WORKSPACE_RUNTIME_DIRNAME / _WORKSPACE_IDENTITY_FILENAME


def _ensure_workspace_metadata_ready() -> None:
    with runtime_db_connection():
        return


@contextmanager
def runtime_db_connection() -> Any:
    db_path = runtime_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        ensure_runtime_db_schema(conn)
        yield conn
        conn.commit()
    finally:
        conn.close()


def ensure_runtime_db_schema(conn: sqlite3.Connection) -> None:
    _ensure_workspaces_table_schema(conn)
    _migrate_sandbox_run_tokens_table(conn)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            workspace_path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            harness TEXT,
            main_session_id TEXT,
            error_message TEXT,
            onboarding_status TEXT NOT NULL,
            onboarding_session_id TEXT,
            onboarding_completed_at TEXT,
            onboarding_completion_summary TEXT,
            onboarding_requested_at TEXT,
            onboarding_requested_by TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at_utc TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_workspaces_updated
            ON workspaces (updated_at DESC, created_at DESC);

        CREATE TABLE IF NOT EXISTS agent_runtime_sessions (
            workspace_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            harness TEXT NOT NULL,
            harness_session_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_id, session_id),
            UNIQUE (workspace_id, harness, harness_session_id)
        );

        CREATE INDEX IF NOT EXISTS idx_agent_runtime_sessions_workspace_updated
            ON agent_runtime_sessions (workspace_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS agent_session_inputs (
            input_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL,
            priority INTEGER NOT NULL DEFAULT 0,
            available_at TEXT NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0,
            idempotency_key TEXT,
            claimed_by TEXT,
            claimed_until TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_session_inputs_workspace_created
            ON agent_session_inputs (workspace_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_agent_session_inputs_session_status
            ON agent_session_inputs (session_id, status, available_at);

        CREATE TABLE IF NOT EXISTS session_runtime_state (
            workspace_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('IDLE', 'BUSY', 'WAITING_USER', 'ERROR', 'QUEUED')),
            current_input_id TEXT,
            current_worker_id TEXT,
            lease_until TEXT,
            heartbeat_at TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_id, session_id)
        );

        CREATE INDEX IF NOT EXISTS session_runtime_state_workspace_session_idx
            ON session_runtime_state (workspace_id, session_id);

        CREATE INDEX IF NOT EXISTS session_runtime_state_session_id_idx
            ON session_runtime_state (session_id);

        CREATE TABLE IF NOT EXISTS sandbox_run_tokens (
            token TEXT PRIMARY KEY,
            run_id TEXT NOT NULL UNIQUE,
            workspace_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            input_id TEXT NOT NULL,
            scopes TEXT NOT NULL DEFAULT '[]',
            expires_at TEXT NOT NULL,
            revoked_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS session_messages (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_messages_workspace_session_created
            ON session_messages (workspace_id, session_id, created_at ASC);

        CREATE TABLE IF NOT EXISTS session_output_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            input_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_output_events_session_input_sequence
            ON session_output_events (session_id, input_id, sequence ASC);

        CREATE INDEX IF NOT EXISTS idx_session_output_events_workspace_session_created
            ON session_output_events (workspace_id, session_id, created_at ASC);

        CREATE TABLE IF NOT EXISTS session_artifacts (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            artifact_type TEXT NOT NULL,
            external_id TEXT NOT NULL,
            platform TEXT,
            title TEXT,
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_artifacts_workspace_session_created
            ON session_artifacts (workspace_id, session_id, created_at ASC);

        CREATE TABLE IF NOT EXISTS task_proposals (
            proposal_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            task_name TEXT NOT NULL,
            task_prompt TEXT NOT NULL,
            task_generation_rationale TEXT NOT NULL,
            source_event_ids TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'not_reviewed'
        );

        CREATE INDEX IF NOT EXISTS idx_task_proposals_workspace_created
            ON task_proposals (workspace_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_task_proposals_workspace_state_created
            ON task_proposals (workspace_id, state, created_at DESC);

        CREATE TABLE IF NOT EXISTS output_folders (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            name TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_output_folders_workspace_position
            ON output_folders (workspace_id, position ASC, created_at ASC);

        CREATE TABLE IF NOT EXISTS outputs (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            output_type TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            module_id TEXT,
            module_resource_id TEXT,
            file_path TEXT,
            html_content TEXT,
            session_id TEXT,
            artifact_id TEXT,
            folder_id TEXT,
            platform TEXT,
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_outputs_workspace_created
            ON outputs (workspace_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_outputs_workspace_folder_created
            ON outputs (workspace_id, folder_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS cronjobs (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            initiated_by TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            cron TEXT NOT NULL,
            description TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            delivery TEXT NOT NULL,
            metadata TEXT NOT NULL DEFAULT '{}',
            last_run_at TEXT,
            next_run_at TEXT,
            run_count INTEGER NOT NULL DEFAULT 0,
            last_status TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_cronjobs_workspace_created
            ON cronjobs (workspace_id, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_cronjobs_enabled_next_run
            ON cronjobs (enabled, next_run_at);

        CREATE TABLE IF NOT EXISTS app_builds (
            workspace_id TEXT NOT NULL,
            app_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            started_at TEXT,
            completed_at TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_id, app_id)
        );

        CREATE INDEX IF NOT EXISTS idx_app_builds_workspace
            ON app_builds (workspace_id);
        """
    )


def _migrate_sandbox_run_tokens_table(conn: sqlite3.Connection) -> None:
    tables = {
        str(row["name"]) for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    }
    if "sandbox_run_tokens" not in tables:
        return

    columns = {str(row["name"]) for row in conn.execute("PRAGMA table_info(sandbox_run_tokens)").fetchall()}
    if "holaboss_user_id" not in columns:
        return

    conn.executescript(
        """
        ALTER TABLE sandbox_run_tokens RENAME TO sandbox_run_tokens_legacy_with_user;

        CREATE TABLE sandbox_run_tokens (
            token TEXT PRIMARY KEY,
            run_id TEXT NOT NULL UNIQUE,
            workspace_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            input_id TEXT NOT NULL,
            scopes TEXT NOT NULL DEFAULT '[]',
            expires_at TEXT NOT NULL,
            revoked_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        INSERT INTO sandbox_run_tokens (
            token,
            run_id,
            workspace_id,
            session_id,
            input_id,
            scopes,
            expires_at,
            revoked_at,
            created_at,
            updated_at
        )
        SELECT
            token,
            run_id,
            workspace_id,
            session_id,
            input_id,
            scopes,
            expires_at,
            revoked_at,
            created_at,
            updated_at
        FROM sandbox_run_tokens_legacy_with_user;

        DROP TABLE sandbox_run_tokens_legacy_with_user;
        """
    )


def _ensure_workspaces_table_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            workspace_path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            harness TEXT,
            main_session_id TEXT,
            error_message TEXT,
            onboarding_status TEXT NOT NULL,
            onboarding_session_id TEXT,
            onboarding_completed_at TEXT,
            onboarding_completion_summary TEXT,
            onboarding_requested_at TEXT,
            onboarding_requested_by TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at_utc TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_workspaces_updated
            ON workspaces (updated_at DESC, created_at DESC);
        """
    )
    table_names = {
        str(row["name"]) for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    }
    if "workspaces" in table_names:
        columns = {str(row["name"]) for row in conn.execute("PRAGMA table_info(workspaces)").fetchall()}
        if "workspace_path" not in columns:
            conn.executescript(
                """
                ALTER TABLE workspaces RENAME TO workspaces_legacy_no_path;

                CREATE TABLE workspaces (
                    id TEXT PRIMARY KEY,
                    workspace_path TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    harness TEXT,
                    main_session_id TEXT,
                    error_message TEXT,
                    onboarding_status TEXT NOT NULL,
                    onboarding_session_id TEXT,
                    onboarding_completed_at TEXT,
                    onboarding_completion_summary TEXT,
                    onboarding_requested_at TEXT,
                    onboarding_requested_by TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    deleted_at_utc TEXT
                );

                INSERT INTO workspaces (
                    id,
                    workspace_path,
                    name,
                    status,
                    harness,
                    main_session_id,
                    error_message,
                    onboarding_status,
                    onboarding_session_id,
                    onboarding_completed_at,
                    onboarding_completion_summary,
                    onboarding_requested_at,
                    onboarding_requested_by,
                    created_at,
                    updated_at,
                    deleted_at_utc
                )
                SELECT
                    id,
                    '' AS workspace_path,
                    name,
                    status,
                    harness,
                    main_session_id,
                    error_message,
                    onboarding_status,
                    onboarding_session_id,
                    onboarding_completed_at,
                    onboarding_completion_summary,
                    onboarding_requested_at,
                    onboarding_requested_by,
                    created_at,
                    updated_at,
                    deleted_at_utc
                FROM workspaces_legacy_no_path;

                DROP TABLE workspaces_legacy_no_path;
                """
            )
    _migrate_workspaces_table(conn)


def _migrate_workspaces_table(conn: sqlite3.Connection) -> None:
    table_names = {
        str(row["name"]) for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    }
    for table_name in ("workspaces", "workspaces_legacy_with_owner"):
        if table_name not in table_names:
            continue
        if table_name == "workspaces":
            rows = conn.execute("SELECT * FROM workspaces").fetchall()
            for row in rows:
                payload = dict(row)
                workspace_id = str(payload["id"])
                workspace_path = str(payload.get("workspace_path") or "").strip()
                path_obj = Path(workspace_path) if workspace_path else None
                if path_obj is None or not path_obj.is_dir():
                    discovered = _discover_workspace_path(workspace_id)
                    workspace_path = str(discovered or _default_workspace_dir(workspace_id))
                    conn.execute(
                        "UPDATE workspaces SET workspace_path = ? WHERE id = ?", (workspace_path, workspace_id)
                    )
                _write_workspace_identity_file(Path(workspace_path), workspace_id)
            continue
        rows = conn.execute(f"SELECT * FROM {table_name}").fetchall()  # noqa: S608
        for row in rows:
            record = _row_to_workspace(row)
            _upsert_workspace_row(
                conn,
                record=record,
                workspace_path=str(_discover_workspace_path(record.id) or _default_workspace_dir(record.id)),
            )
        conn.execute(f"DROP TABLE {table_name}")
        conn.execute("DROP INDEX IF EXISTS idx_workspaces_user_updated")

    for child in Path(WORKSPACE_ROOT).iterdir() if Path(WORKSPACE_ROOT).is_dir() else []:
        if not child.is_dir():
            continue
        legacy_metadata_path = child / _LEGACY_WORKSPACE_METADATA_FILENAME
        if not legacy_metadata_path.is_file():
            continue
        payload = json.loads(legacy_metadata_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            continue
        record = _workspace_record_from_payload(payload)
        _upsert_workspace_row(conn, record=record, workspace_path=str(child))
        _write_workspace_identity_file(child, record.id)
        legacy_metadata_path.unlink(missing_ok=True)


def list_workspaces(*, include_deleted: bool = False) -> list[WorkspaceRecord]:
    _ensure_workspace_metadata_ready()
    with runtime_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, name, status, harness, main_session_id, error_message,
                   onboarding_status, onboarding_session_id, onboarding_completed_at,
                   onboarding_completion_summary, onboarding_requested_at, onboarding_requested_by,
                   created_at, updated_at, deleted_at_utc
            FROM workspaces
            ORDER BY updated_at DESC, created_at DESC, id DESC
            """
        ).fetchall()
    items = [_row_to_workspace(row) for row in rows]
    if include_deleted:
        return items
    return [record for record in items if not record.deleted_at_utc]


def get_workspace(workspace_id: str, *, include_deleted: bool = False) -> WorkspaceRecord | None:
    _ensure_workspace_metadata_ready()
    with runtime_db_connection() as conn:
        row = conn.execute(
            """
            SELECT id, name, status, harness, main_session_id, error_message,
                   onboarding_status, onboarding_session_id, onboarding_completed_at,
                   onboarding_completion_summary, onboarding_requested_at, onboarding_requested_by,
                   created_at, updated_at, deleted_at_utc
            FROM workspaces
            WHERE id = ?
            LIMIT 1
            """,
            (workspace_id,),
        ).fetchone()
    if row is None:
        record = _recover_missing_workspace_record(workspace_id)
        if record is None:
            return None
        if record.deleted_at_utc and not include_deleted:
            return None
        return record
    record = _row_to_workspace(row)
    if record.deleted_at_utc and not include_deleted:
        return None
    return record


def _recover_missing_workspace_record(workspace_id: str) -> WorkspaceRecord | None:
    discovered = _discover_workspace_path(workspace_id)
    if discovered is None:
        return None

    now = utc_now_iso()
    record = WorkspaceRecord(
        id=workspace_id,
        name=workspace_id,
        status="active",
        harness=(os.getenv("SANDBOX_AGENT_HARNESS") or "").strip() or None,
        main_session_id=None,
        error_message=None,
        onboarding_status="not_required",
        onboarding_session_id=None,
        onboarding_completed_at=None,
        onboarding_completion_summary=None,
        onboarding_requested_at=None,
        onboarding_requested_by=None,
        created_at=now,
        updated_at=now,
        deleted_at_utc=None,
    )
    with runtime_db_connection() as conn:
        _upsert_workspace_row(conn, record=record, workspace_path=str(discovered))
    return record


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
    _ensure_workspace_metadata_ready()
    resolved_workspace_id = workspace_id or str(uuid4())
    now = utc_now_iso()
    if get_workspace(resolved_workspace_id, include_deleted=True) is not None:
        raise FileExistsError(f"workspace {resolved_workspace_id} already exists")
    record = WorkspaceRecord(
        id=resolved_workspace_id,
        name=name,
        status=status,
        harness=harness,
        main_session_id=main_session_id,
        error_message=error_message,
        onboarding_status=onboarding_status,
        onboarding_session_id=onboarding_session_id,
        onboarding_completed_at=None,
        onboarding_completion_summary=None,
        onboarding_requested_at=None,
        onboarding_requested_by=None,
        created_at=now,
        updated_at=now,
        deleted_at_utc=None,
    )
    workspace_path = _default_workspace_dir(resolved_workspace_id)
    workspace_path.mkdir(parents=True, exist_ok=True)
    _write_workspace_identity_file(workspace_path, resolved_workspace_id)
    with runtime_db_connection() as conn:
        _upsert_workspace_row(conn, record=record, workspace_path=str(workspace_path))
    return record


def update_workspace(workspace_id: str, **fields: Any) -> WorkspaceRecord:
    _ensure_workspace_metadata_ready()
    existing = get_workspace(workspace_id, include_deleted=True)
    if existing is None:
        raise KeyError(f"workspace {workspace_id} not found")
    if not fields:
        return existing
    non_nullable_fields = {"status", "onboarding_status"}
    assignments: list[str] = []
    values: list[Any] = []
    for key, value in fields.items():
        if key not in _WORKSPACE_UPDATE_FIELDS:
            raise ValueError(f"unsupported workspace update field: {key}")
        if value is None and key in non_nullable_fields:
            continue
        assignments.append(key)
        values.append(value)
    if not assignments:
        return existing
    payload = _workspace_record_to_payload(existing)
    for key, value in zip(assignments, values, strict=True):
        payload[key] = value
    payload["updated_at"] = utc_now_iso()
    updated = _workspace_record_from_payload(payload)
    with runtime_db_connection() as conn:
        existing_path = _workspace_path_from_registry(workspace_id, conn=conn) or str(
            _default_workspace_dir(workspace_id)
        )
        _upsert_workspace_row(conn, record=updated, workspace_path=existing_path)
    _write_workspace_identity_file(workspace_dir(workspace_id), workspace_id)
    return updated


def delete_workspace(workspace_id: str) -> WorkspaceRecord:
    return update_workspace(workspace_id, status="deleted", deleted_at_utc=utc_now_iso(), error_message=None)


def upsert_binding(
    *,
    workspace_id: str,
    session_id: str,
    harness: str,
    harness_session_id: str,
) -> SessionBindingRecord:
    now = utc_now_iso()
    with runtime_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO agent_runtime_sessions (
                workspace_id, session_id, harness, harness_session_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, session_id) DO UPDATE SET
                harness = excluded.harness,
                harness_session_id = excluded.harness_session_id,
                updated_at = excluded.updated_at
            """,
            (workspace_id, session_id, harness, harness_session_id, now, now),
        )
        row = conn.execute(
            """
            SELECT workspace_id, session_id, harness, harness_session_id, created_at, updated_at
            FROM agent_runtime_sessions
            WHERE workspace_id = ? AND session_id = ?
            LIMIT 1
            """,
            (workspace_id, session_id),
        ).fetchone()
    if row is None:  # pragma: no cover
        raise RuntimeError("failed to load session binding")
    data = dict(row)
    return SessionBindingRecord(
        workspace_id=str(data["workspace_id"]),
        session_id=str(data["session_id"]),
        harness=str(data["harness"]),
        harness_session_id=str(data["harness_session_id"]),
        created_at=str(data["created_at"]),
        updated_at=str(data["updated_at"]),
    )


def get_binding(*, workspace_id: str, session_id: str) -> SessionBindingRecord | None:
    with runtime_db_connection() as conn:
        row = conn.execute(
            """
            SELECT workspace_id, session_id, harness, harness_session_id, created_at, updated_at
            FROM agent_runtime_sessions
            WHERE workspace_id = ? AND session_id = ?
            LIMIT 1
            """,
            (workspace_id, session_id),
        ).fetchone()
    if row is None:
        return None
    data = dict(row)
    return SessionBindingRecord(
        workspace_id=str(data["workspace_id"]),
        session_id=str(data["session_id"]),
        harness=str(data["harness"]),
        harness_session_id=str(data["harness_session_id"]),
        created_at=str(data["created_at"]),
        updated_at=str(data["updated_at"]),
    )


def enqueue_input(
    *,
    workspace_id: str,
    session_id: str,
    payload: dict[str, Any],
    priority: int = 0,
    idempotency_key: str | None = None,
) -> SessionInputRecord:
    if idempotency_key:
        existing = get_input_by_idempotency_key(idempotency_key)
        if existing is not None:
            return existing
    input_id = str(uuid4())
    now = utc_now_iso()
    with runtime_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO agent_session_inputs (
                input_id, session_id, workspace_id, payload, status, priority, available_at,
                attempt, idempotency_key, claimed_by, claimed_until, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?)
            """,
            (
                input_id,
                session_id,
                workspace_id,
                json.dumps(payload, ensure_ascii=True),
                "QUEUED",
                int(priority),
                now,
                idempotency_key,
                now,
                now,
            ),
        )
    record = get_input(input_id)
    if record is None:  # pragma: no cover
        raise RuntimeError("failed to load queued input")
    return record


def get_input(input_id: str) -> SessionInputRecord | None:
    with runtime_db_connection() as conn:
        row = conn.execute("SELECT * FROM agent_session_inputs WHERE input_id = ? LIMIT 1", (input_id,)).fetchone()
    return _row_to_input(row)


def get_input_by_idempotency_key(idempotency_key: str) -> SessionInputRecord | None:
    with runtime_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM agent_session_inputs WHERE idempotency_key = ? LIMIT 1",
            (idempotency_key,),
        ).fetchone()
    return _row_to_input(row)


def update_input(input_id: str, **fields: Any) -> SessionInputRecord | None:
    if not fields:
        return get_input(input_id)
    assignments: list[str] = []
    values: list[Any] = []
    for key, value in fields.items():
        if key not in _INPUT_UPDATE_FIELDS:
            raise ValueError(f"unsupported session input update field: {key}")
        assignments.append(f"{key} = ?")
        values.append(value)
    assignments.append("updated_at = ?")
    values.append(utc_now_iso())
    values.append(input_id)
    with runtime_db_connection() as conn:
        sql = "UPDATE agent_session_inputs SET " + ", ".join(assignments) + " WHERE input_id = ?"  # noqa: S608
        conn.execute(sql, values)
    return get_input(input_id)


def claim_inputs(*, limit: int, claimed_by: str, lease_seconds: int) -> list[SessionInputRecord]:
    now = datetime.now(UTC)
    now_iso = now.isoformat()
    claimed_until_iso = now.replace(microsecond=0).isoformat()
    if lease_seconds > 0:
        claimed_until_iso = (now + timedelta(seconds=lease_seconds)).isoformat()
    with runtime_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT input_id
            FROM agent_session_inputs
            WHERE status = 'QUEUED'
              AND datetime(available_at) <= datetime(?)
              AND (claimed_until IS NULL OR datetime(claimed_until) <= datetime(?))
            ORDER BY priority DESC, datetime(created_at) ASC
            LIMIT ?
            """,
            (now_iso, now_iso, max(1, int(limit))),
        ).fetchall()
        claimed_ids = [str(row["input_id"]) for row in rows]
        claimed_records: list[SessionInputRecord] = []
        for input_id in claimed_ids:
            conn.execute(
                """
                UPDATE agent_session_inputs
                SET status = 'CLAIMED',
                    claimed_by = ?,
                    claimed_until = ?,
                    updated_at = ?
                WHERE input_id = ?
                """,
                (claimed_by, claimed_until_iso, now_iso, input_id),
            )
            row = conn.execute("SELECT * FROM agent_session_inputs WHERE input_id = ? LIMIT 1", (input_id,)).fetchone()
            record = _row_to_input(row)
            if record is not None:
                claimed_records.append(record)
    return claimed_records


def has_available_inputs_for_session(*, session_id: str, workspace_id: str | None = None) -> bool:
    now_iso = utc_now_iso()
    query = """
        SELECT input_id FROM agent_session_inputs
        WHERE session_id = ?
          AND status = 'QUEUED'
          AND datetime(available_at) <= datetime(?)
    """
    params: list[Any] = [session_id, now_iso]
    if workspace_id is not None:
        query += " AND workspace_id = ?"
        params.append(workspace_id)
    query += " LIMIT 1"
    with runtime_db_connection() as conn:
        row = conn.execute(query, params).fetchone()
    return row is not None


def ensure_runtime_state(
    *,
    workspace_id: str,
    session_id: str,
    status: str = "QUEUED",
    current_input_id: str | None = None,
) -> dict[str, Any]:
    now = utc_now_iso()
    with runtime_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO session_runtime_state (
                workspace_id, session_id, status, current_input_id, current_worker_id,
                lease_until, heartbeat_at, last_error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
            ON CONFLICT(workspace_id, session_id) DO UPDATE SET
                status = excluded.status,
                current_input_id = excluded.current_input_id,
                updated_at = excluded.updated_at
            """,
            (workspace_id, session_id, status, current_input_id, now, now),
        )
        row = conn.execute(
            "SELECT * FROM session_runtime_state WHERE workspace_id = ? AND session_id = ? LIMIT 1",
            (workspace_id, session_id),
        ).fetchone()
    return _row_to_runtime_state(row)


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
    if heartbeat_at is None:
        heartbeat_at = utc_now_iso()
    serialized_last_error = (
        None
        if last_error is None
        else json.dumps(last_error, ensure_ascii=True)
        if isinstance(last_error, dict)
        else str(last_error)
    )
    with runtime_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO session_runtime_state (
                workspace_id, session_id, status, current_input_id, current_worker_id,
                lease_until, heartbeat_at, last_error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, session_id) DO UPDATE SET
                status = excluded.status,
                current_input_id = excluded.current_input_id,
                current_worker_id = excluded.current_worker_id,
                lease_until = excluded.lease_until,
                heartbeat_at = excluded.heartbeat_at,
                last_error = excluded.last_error,
                updated_at = excluded.updated_at
            """,
            (
                workspace_id,
                session_id,
                status,
                current_input_id,
                current_worker_id,
                lease_until,
                heartbeat_at,
                serialized_last_error,
                heartbeat_at,
                heartbeat_at,
            ),
        )
        row = conn.execute(
            "SELECT * FROM session_runtime_state WHERE workspace_id = ? AND session_id = ? LIMIT 1",
            (workspace_id, session_id),
        ).fetchone()
    return _row_to_runtime_state(row)


def list_runtime_states(workspace_id: str) -> list[dict[str, Any]]:
    with runtime_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM session_runtime_state
            WHERE workspace_id = ?
            ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
            """,
            (workspace_id,),
        ).fetchall()
    return [_row_to_runtime_state(row) for row in rows]


def get_runtime_state(*, session_id: str, workspace_id: str | None = None) -> dict[str, Any] | None:
    query = """
        SELECT * FROM session_runtime_state
        WHERE session_id = ?
    """
    params: list[Any] = [session_id]
    if workspace_id is not None:
        query += " AND workspace_id = ?"
        params.append(workspace_id)
    query += " ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT 1"
    with runtime_db_connection() as conn:
        row = conn.execute(query, params).fetchone()
    if row is None:
        return None
    return _row_to_runtime_state(row)


def insert_session_message(
    *,
    workspace_id: str,
    session_id: str,
    role: str,
    text: str,
    message_id: str | None = None,
    created_at: str | None = None,
) -> None:
    resolved_id = message_id or str(uuid4())
    resolved_created_at = created_at or utc_now_iso()
    with runtime_db_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO session_messages (
                id, workspace_id, session_id, role, text, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (resolved_id, workspace_id, session_id, role, text, resolved_created_at),
        )


def list_session_messages(*, workspace_id: str, session_id: str) -> list[dict[str, Any]]:
    with runtime_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, role, text, created_at
            FROM session_messages
            WHERE workspace_id = ? AND session_id = ?
            ORDER BY datetime(created_at) ASC, id ASC
            """,
            (workspace_id, session_id),
        ).fetchall()
    return [
        {
            "id": str(row["id"]),
            "role": str(row["role"]),
            "text": str(row["text"]),
            "created_at": str(row["created_at"]),
            "metadata": {},
        }
        for row in rows
    ]


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
    resolved_created_at = created_at or utc_now_iso()
    with runtime_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO session_output_events (
                workspace_id, session_id, input_id, sequence, event_type, payload, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workspace_id,
                session_id,
                input_id,
                int(sequence),
                event_type,
                json.dumps(payload, ensure_ascii=True),
                resolved_created_at,
            ),
        )


def latest_output_event_id(
    *,
    session_id: str,
    input_id: str | None = None,
) -> int:
    query = """
        SELECT MAX(id) AS max_id
        FROM session_output_events
        WHERE session_id = ?
    """
    params: list[Any] = [session_id]
    if input_id is not None:
        query += " AND input_id = ?"
        params.append(input_id)
    with runtime_db_connection() as conn:
        row = conn.execute(query, params).fetchone()
    if row is None:
        return 0
    value = row["max_id"]
    return int(value) if value is not None else 0


def list_output_events(
    *,
    session_id: str,
    input_id: str | None = None,
    include_history: bool = True,
    after_event_id: int = 0,
) -> list[dict[str, Any]]:
    query = """
        SELECT id, workspace_id, session_id, input_id, sequence, event_type, payload, created_at
        FROM session_output_events
        WHERE session_id = ?
          AND id > ?
    """
    params: list[Any] = [session_id, int(after_event_id)]
    if input_id is not None:
        query += " AND input_id = ?"
        params.append(input_id)
    if not include_history:
        query += " AND 1 = 0"
    query += " ORDER BY id ASC"
    with runtime_db_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    events: list[dict[str, Any]] = []
    for row in rows:
        data = dict(row)
        payload_raw = data.get("payload")
        payload: dict[str, Any]
        try:
            parsed = json.loads(str(payload_raw))
            payload = parsed if isinstance(parsed, dict) else {"value": parsed}
        except Exception:
            payload = {"message": str(payload_raw)}
        events.append({
            "id": int(data["id"]),
            "workspace_id": str(data["workspace_id"]),
            "session_id": str(data["session_id"]),
            "input_id": str(data["input_id"]),
            "sequence": int(data["sequence"]),
            "event_type": str(data["event_type"]),
            "payload": payload,
            "created_at": str(data["created_at"]),
        })
    return events


def _row_to_workspace(row: sqlite3.Row) -> WorkspaceRecord:
    data = dict(row)
    return _workspace_record_from_payload(data)


def _workspace_record_to_payload(record: WorkspaceRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "name": record.name,
        "status": record.status,
        "harness": record.harness,
        "main_session_id": record.main_session_id,
        "error_message": record.error_message,
        "onboarding_status": record.onboarding_status,
        "onboarding_session_id": record.onboarding_session_id,
        "onboarding_completed_at": record.onboarding_completed_at,
        "onboarding_completion_summary": record.onboarding_completion_summary,
        "onboarding_requested_at": record.onboarding_requested_at,
        "onboarding_requested_by": record.onboarding_requested_by,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "deleted_at_utc": record.deleted_at_utc,
    }


def _workspace_record_from_payload(data: dict[str, Any]) -> WorkspaceRecord:
    return WorkspaceRecord(
        id=str(data["id"]),
        name=str(data["name"]),
        status=str(data["status"]),
        harness=str(data["harness"]) if data.get("harness") is not None else None,
        main_session_id=str(data["main_session_id"]) if data.get("main_session_id") is not None else None,
        error_message=str(data["error_message"]) if data.get("error_message") is not None else None,
        onboarding_status=str(data["onboarding_status"]),
        onboarding_session_id=(
            str(data["onboarding_session_id"]) if data.get("onboarding_session_id") is not None else None
        ),
        onboarding_completed_at=(
            str(data["onboarding_completed_at"]) if data.get("onboarding_completed_at") is not None else None
        ),
        onboarding_completion_summary=(
            str(data["onboarding_completion_summary"])
            if data.get("onboarding_completion_summary") is not None
            else None
        ),
        onboarding_requested_at=(
            str(data["onboarding_requested_at"]) if data.get("onboarding_requested_at") is not None else None
        ),
        onboarding_requested_by=(
            str(data["onboarding_requested_by"]) if data.get("onboarding_requested_by") is not None else None
        ),
        created_at=str(data["created_at"]) if data.get("created_at") is not None else None,
        updated_at=str(data["updated_at"]) if data.get("updated_at") is not None else None,
        deleted_at_utc=str(data["deleted_at_utc"]) if data.get("deleted_at_utc") is not None else None,
    )


def _workspace_path_from_registry(workspace_id: str, *, conn: sqlite3.Connection | None = None) -> str | None:
    query = "SELECT workspace_path FROM workspaces WHERE id = ? LIMIT 1"
    if conn is not None:
        row = conn.execute(query, (workspace_id,)).fetchone()
    else:
        with runtime_db_connection() as managed_conn:
            row = managed_conn.execute(query, (workspace_id,)).fetchone()
    if row is None:
        return None
    raw = row["workspace_path"]
    return str(raw).strip() if raw is not None else None


def _upsert_workspace_row(conn: sqlite3.Connection, *, record: WorkspaceRecord, workspace_path: str) -> None:
    conn.execute(
        """
        INSERT INTO workspaces (
            id, workspace_path, name, status, harness, main_session_id, error_message,
            onboarding_status, onboarding_session_id, onboarding_completed_at,
            onboarding_completion_summary, onboarding_requested_at, onboarding_requested_by,
            created_at, updated_at, deleted_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            workspace_path = excluded.workspace_path,
            name = excluded.name,
            status = excluded.status,
            harness = excluded.harness,
            main_session_id = excluded.main_session_id,
            error_message = excluded.error_message,
            onboarding_status = excluded.onboarding_status,
            onboarding_session_id = excluded.onboarding_session_id,
            onboarding_completed_at = excluded.onboarding_completed_at,
            onboarding_completion_summary = excluded.onboarding_completion_summary,
            onboarding_requested_at = excluded.onboarding_requested_at,
            onboarding_requested_by = excluded.onboarding_requested_by,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at_utc = excluded.deleted_at_utc
        """,
        (
            record.id,
            workspace_path,
            record.name,
            record.status,
            record.harness,
            record.main_session_id,
            record.error_message,
            record.onboarding_status,
            record.onboarding_session_id,
            record.onboarding_completed_at,
            record.onboarding_completion_summary,
            record.onboarding_requested_at,
            record.onboarding_requested_by,
            record.created_at,
            record.updated_at,
            record.deleted_at_utc,
        ),
    )


def _write_workspace_identity_file(workspace_path: Path, workspace_id: str) -> None:
    runtime_dir = workspace_path / _WORKSPACE_RUNTIME_DIRNAME
    runtime_dir.mkdir(parents=True, exist_ok=True)
    identity_path = runtime_dir / _WORKSPACE_IDENTITY_FILENAME
    temp_path = identity_path.with_name(f"{identity_path.name}.tmp")
    temp_path.write_text(f"{workspace_id}\n", encoding="utf-8")
    temp_path.replace(identity_path)


def _discover_workspace_path(workspace_id: str) -> Path | None:
    root = Path(WORKSPACE_ROOT)
    if not root.is_dir():
        return None
    for child in root.iterdir():
        if not child.is_dir():
            continue
        identity_path = child / _WORKSPACE_RUNTIME_DIRNAME / _WORKSPACE_IDENTITY_FILENAME
        if not identity_path.is_file():
            continue
        try:
            raw = identity_path.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if raw == workspace_id:
            return child
    return None


def _update_workspace_path(workspace_id: str, workspace_path: Path) -> None:
    with runtime_db_connection() as conn:
        conn.execute("UPDATE workspaces SET workspace_path = ? WHERE id = ?", (str(workspace_path), workspace_id))


def _row_to_input(row: sqlite3.Row | None) -> SessionInputRecord | None:
    if row is None:
        return None
    data = dict(row)
    try:
        payload = json.loads(str(data["payload"]))
    except Exception:
        payload = {}
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


def _row_to_runtime_state(row: sqlite3.Row | None) -> dict[str, Any]:
    if row is None:
        raise RuntimeError("runtime state row not found")
    data = dict(row)
    last_error = data.get("last_error")
    parsed_last_error: dict[str, Any] | None
    if last_error is None:
        parsed_last_error = None
    else:
        try:
            parsed_value = json.loads(str(last_error))
            parsed_last_error = parsed_value if isinstance(parsed_value, dict) else {"message": str(last_error)}
        except Exception:
            parsed_last_error = {"message": str(last_error)}
    return {
        "workspace_id": str(data["workspace_id"]),
        "session_id": str(data["session_id"]),
        "status": str(data["status"]),
        "current_input_id": str(data["current_input_id"]) if data.get("current_input_id") is not None else None,
        "current_worker_id": str(data["current_worker_id"]) if data.get("current_worker_id") is not None else None,
        "lease_until": str(data["lease_until"]) if data.get("lease_until") is not None else None,
        "heartbeat_at": str(data["heartbeat_at"]) if data.get("heartbeat_at") is not None else None,
        "last_error": parsed_last_error,
        "created_at": str(data["created_at"]),
        "updated_at": str(data["updated_at"]),
    }


def _parse_json_dict(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(str(raw))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_json_list(raw: Any) -> list[Any]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    try:
        parsed = json.loads(str(raw))
    except Exception:
        return []
    return parsed if isinstance(parsed, list) else []


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
    resolved_id = artifact_id or str(uuid4())
    resolved_created_at = created_at or utc_now_iso()
    resolved_metadata = metadata or {}
    with runtime_db_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO session_artifacts (
                id, session_id, workspace_id, artifact_type, external_id, platform, title, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                resolved_id,
                session_id,
                workspace_id,
                artifact_type,
                external_id,
                platform,
                title,
                json.dumps(resolved_metadata, ensure_ascii=True),
                resolved_created_at,
            ),
        )
        row = conn.execute(
            "SELECT * FROM session_artifacts WHERE id = ? LIMIT 1",
            (resolved_id,),
        ).fetchone()
    if row is None:
        raise RuntimeError("artifact row not found after insert")
    return _row_to_session_artifact(row)


def list_session_artifacts(*, session_id: str, workspace_id: str | None = None) -> list[dict[str, Any]]:
    query = """
        SELECT * FROM session_artifacts
        WHERE session_id = ?
    """
    params: list[Any] = [session_id]
    if workspace_id is not None:
        query += " AND workspace_id = ?"
        params.append(workspace_id)
    query += " ORDER BY datetime(created_at) ASC, id ASC"
    with runtime_db_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_session_artifact(row) for row in rows]


def list_sessions_with_artifacts(*, workspace_id: str, limit: int = 20, offset: int = 0) -> list[dict[str, Any]]:
    with runtime_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT session_id, status, created_at, updated_at
            FROM session_runtime_state
            WHERE workspace_id = ?
            ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
            LIMIT ? OFFSET ?
            """,
            (workspace_id, int(limit), int(offset)),
        ).fetchall()
        session_ids = [str(row["session_id"]) for row in rows]
        artifacts_by_session: dict[str, list[dict[str, Any]]] = {session_id: [] for session_id in session_ids}
        if session_ids:
            artifact_rows = conn.execute(
                """
                SELECT session_id, artifact_type, external_id, platform, title
                FROM session_artifacts
                WHERE workspace_id = ?
                ORDER BY datetime(created_at) ASC, id ASC
                """,
                (workspace_id,),
            ).fetchall()
            for artifact_row in artifact_rows:
                artifact_session_id = str(artifact_row["session_id"])
                if artifact_session_id not in artifacts_by_session:
                    continue
                artifacts_by_session.setdefault(artifact_session_id, []).append({
                    "artifact_type": str(artifact_row["artifact_type"]),
                    "external_id": str(artifact_row["external_id"]),
                    "platform": str(artifact_row["platform"]) if artifact_row["platform"] is not None else None,
                    "title": str(artifact_row["title"]) if artifact_row["title"] is not None else None,
                })
    items: list[dict[str, Any]] = []
    for row in rows:
        session_id = str(row["session_id"])
        items.append({
            "session_id": session_id,
            "status": str(row["status"]),
            "created_at": str(row["created_at"]) if row["created_at"] is not None else None,
            "updated_at": str(row["updated_at"]) if row["updated_at"] is not None else None,
            "artifacts": artifacts_by_session.get(session_id, []),
        })
    return items


def create_output_folder(*, workspace_id: str, name: str) -> dict[str, Any]:
    resolved_id = str(uuid4())
    now = utc_now_iso()
    with runtime_db_connection() as conn:
        count_row = conn.execute(
            "SELECT COUNT(*) AS count FROM output_folders WHERE workspace_id = ?",
            (workspace_id,),
        ).fetchone()
        position = int(count_row["count"]) if count_row is not None else 0
        conn.execute(
            """
            INSERT INTO output_folders (
                id, workspace_id, name, position, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (resolved_id, workspace_id, name, position, now, now),
        )
        row = conn.execute("SELECT * FROM output_folders WHERE id = ? LIMIT 1", (resolved_id,)).fetchone()
    if row is None:
        raise RuntimeError("output folder row not found after insert")
    return _row_to_output_folder(row)


def list_output_folders(*, workspace_id: str) -> list[dict[str, Any]]:
    with runtime_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM output_folders
            WHERE workspace_id = ?
            ORDER BY position ASC, datetime(created_at) ASC, id ASC
            """,
            (workspace_id,),
        ).fetchall()
    return [_row_to_output_folder(row) for row in rows]


def update_output_folder(
    *, folder_id: str, name: str | None = None, position: int | None = None
) -> dict[str, Any] | None:
    existing = get_output_folder(folder_id)
    if existing is None:
        return None
    resolved_name = name if name is not None else str(existing["name"])
    resolved_position = int(position) if position is not None else int(existing["position"])
    resolved_updated_at = utc_now_iso()
    with runtime_db_connection() as conn:
        conn.execute(
            """
            UPDATE output_folders
            SET name = ?, position = ?, updated_at = ?
            WHERE id = ?
            """,
            (resolved_name, resolved_position, resolved_updated_at, folder_id),
        )
        row = conn.execute("SELECT * FROM output_folders WHERE id = ? LIMIT 1", (folder_id,)).fetchone()
    return _row_to_output_folder(row) if row is not None else None


def get_output_folder(folder_id: str) -> dict[str, Any] | None:
    with runtime_db_connection() as conn:
        row = conn.execute("SELECT * FROM output_folders WHERE id = ? LIMIT 1", (folder_id,)).fetchone()
    return _row_to_output_folder(row) if row is not None else None


def delete_output_folder(folder_id: str) -> bool:
    with runtime_db_connection() as conn:
        conn.execute(
            "UPDATE outputs SET folder_id = NULL, updated_at = ? WHERE folder_id = ?", (utc_now_iso(), folder_id)
        )
        cursor = conn.execute("DELETE FROM output_folders WHERE id = ?", (folder_id,))
    return cursor.rowcount > 0


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
    resolved_id = output_id or str(uuid4())
    now = utc_now_iso()
    with runtime_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO outputs (
                id, workspace_id, output_type, title, status, module_id, module_resource_id, file_path,
                html_content, session_id, artifact_id, folder_id, platform, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                resolved_id,
                workspace_id,
                output_type,
                title,
                module_id,
                module_resource_id,
                file_path,
                html_content,
                session_id,
                artifact_id,
                folder_id,
                platform,
                json.dumps(metadata or {}, ensure_ascii=True),
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM outputs WHERE id = ? LIMIT 1", (resolved_id,)).fetchone()
    if row is None:
        raise RuntimeError("output row not found after insert")
    return _row_to_output(row)


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
    query = "SELECT * FROM outputs WHERE workspace_id = ?"
    params: list[Any] = [workspace_id]
    if output_type:
        query += " AND output_type = ?"
        params.append(output_type)
    if status:
        query += " AND status = ?"
        params.append(status)
    if platform:
        query += " AND platform = ?"
        params.append(platform)
    if folder_id:
        query += " AND folder_id = ?"
        params.append(folder_id)
    query += " ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?"
    params.extend([int(limit), int(offset)])
    with runtime_db_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_output(row) for row in rows]


def get_output(output_id: str) -> dict[str, Any] | None:
    with runtime_db_connection() as conn:
        row = conn.execute("SELECT * FROM outputs WHERE id = ? LIMIT 1", (output_id,)).fetchone()
    return _row_to_output(row) if row is not None else None


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
    existing = get_output(output_id)
    if existing is None:
        return None
    resolved_updated_at = utc_now_iso()
    with runtime_db_connection() as conn:
        conn.execute(
            """
            UPDATE outputs
            SET title = ?,
                status = ?,
                module_resource_id = ?,
                file_path = ?,
                html_content = ?,
                metadata = ?,
                folder_id = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                title if title is not None else str(existing["title"]),
                status if status is not None else str(existing["status"]),
                module_resource_id if module_resource_id is not None else existing["module_resource_id"],
                file_path if file_path is not None else existing["file_path"],
                html_content if html_content is not None else existing["html_content"],
                json.dumps(metadata if metadata is not None else existing["metadata"], ensure_ascii=True),
                folder_id if folder_id is not None else existing["folder_id"],
                resolved_updated_at,
                output_id,
            ),
        )
        row = conn.execute("SELECT * FROM outputs WHERE id = ? LIMIT 1", (output_id,)).fetchone()
    return _row_to_output(row) if row is not None else None


def delete_output(output_id: str) -> bool:
    with runtime_db_connection() as conn:
        cursor = conn.execute("DELETE FROM outputs WHERE id = ?", (output_id,))
    return cursor.rowcount > 0


def get_output_counts(*, workspace_id: str) -> dict[str, Any]:
    with runtime_db_connection() as conn:
        rows = conn.execute(
            "SELECT status, platform, folder_id FROM outputs WHERE workspace_id = ?",
            (workspace_id,),
        ).fetchall()
    by_status: dict[str, int] = {}
    by_platform: dict[str, int] = {}
    by_folder: dict[str, int] = {}
    for row in rows:
        status = str(row["status"]) if row["status"] is not None else ""
        platform = str(row["platform"]) if row["platform"] is not None else ""
        folder = str(row["folder_id"]) if row["folder_id"] is not None else ""
        if status:
            by_status[status] = by_status.get(status, 0) + 1
        if platform:
            by_platform[platform] = by_platform.get(platform, 0) + 1
        if folder:
            by_folder[folder] = by_folder.get(folder, 0) + 1
    return {
        "total": len(rows),
        "by_status": by_status,
        "by_platform": by_platform,
        "by_folder": by_folder,
    }


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
    resolved_id = job_id or str(uuid4())
    now = utc_now_iso()
    with runtime_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO cronjobs (
                id, workspace_id, initiated_by, name, cron, description, enabled, delivery, metadata,
                last_run_at, next_run_at, run_count, last_status, last_error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, NULL, NULL, ?, ?)
            """,
            (
                resolved_id,
                workspace_id,
                initiated_by,
                name,
                cron,
                description,
                1 if enabled else 0,
                json.dumps(delivery, ensure_ascii=True),
                json.dumps(metadata or {}, ensure_ascii=True),
                next_run_at,
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM cronjobs WHERE id = ? LIMIT 1", (resolved_id,)).fetchone()
    if row is None:
        raise RuntimeError("cronjob row not found after insert")
    return _row_to_cronjob(row)


def create_task_proposal(
    *,
    proposal_id: str,
    workspace_id: str,
    task_name: str,
    task_prompt: str,
    task_generation_rationale: str,
    source_event_ids: list[str] | None = None,
    created_at: str,
    state: str = "not_reviewed",
) -> dict[str, Any]:
    with runtime_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO task_proposals (
                proposal_id,
                workspace_id,
                task_name,
                task_prompt,
                task_generation_rationale,
                source_event_ids,
                created_at,
                state
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                proposal_id,
                workspace_id,
                task_name,
                task_prompt,
                task_generation_rationale,
                json.dumps(source_event_ids or [], ensure_ascii=True),
                created_at,
                state,
            ),
        )
        row = conn.execute("SELECT * FROM task_proposals WHERE proposal_id = ? LIMIT 1", (proposal_id,)).fetchone()
    if row is None:
        raise RuntimeError("task proposal row not found after insert")
    return _row_to_task_proposal(row)


def get_task_proposal(proposal_id: str) -> dict[str, Any] | None:
    with runtime_db_connection() as conn:
        row = conn.execute("SELECT * FROM task_proposals WHERE proposal_id = ? LIMIT 1", (proposal_id,)).fetchone()
    return _row_to_task_proposal(row) if row is not None else None


def list_task_proposals(*, workspace_id: str) -> list[dict[str, Any]]:
    with runtime_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM task_proposals
            WHERE workspace_id = ?
            ORDER BY datetime(created_at) DESC, proposal_id DESC
            """,
            (workspace_id,),
        ).fetchall()
    return [_row_to_task_proposal(row) for row in rows]


def list_unreviewed_task_proposals(*, workspace_id: str) -> list[dict[str, Any]]:
    with runtime_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM task_proposals
            WHERE workspace_id = ? AND state = 'not_reviewed'
            ORDER BY datetime(created_at) DESC, proposal_id DESC
            """,
            (workspace_id,),
        ).fetchall()
    return [_row_to_task_proposal(row) for row in rows]


def update_task_proposal_state(*, proposal_id: str, state: str) -> dict[str, Any] | None:
    with runtime_db_connection() as conn:
        cursor = conn.execute("UPDATE task_proposals SET state = ? WHERE proposal_id = ?", (state, proposal_id))
        if cursor.rowcount <= 0:
            return None
        row = conn.execute("SELECT * FROM task_proposals WHERE proposal_id = ? LIMIT 1", (proposal_id,)).fetchone()
    return _row_to_task_proposal(row) if row is not None else None


def get_cronjob(job_id: str) -> dict[str, Any] | None:
    with runtime_db_connection() as conn:
        row = conn.execute("SELECT * FROM cronjobs WHERE id = ? LIMIT 1", (job_id,)).fetchone()
    return _row_to_cronjob(row) if row is not None else None


def list_cronjobs(*, workspace_id: str | None = None, enabled_only: bool = False) -> list[dict[str, Any]]:
    query = "SELECT * FROM cronjobs"
    params: list[Any] = []
    filters: list[str] = []
    if workspace_id:
        filters.append("workspace_id = ?")
        params.append(workspace_id)
    if enabled_only:
        filters.append("enabled = 1")
    if filters:
        query += " WHERE " + " AND ".join(filters)
    query += " ORDER BY datetime(created_at) ASC, id ASC"
    with runtime_db_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_cronjob(row) for row in rows]


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
    existing = get_cronjob(job_id)
    if existing is None:
        return None
    with runtime_db_connection() as conn:
        conn.execute(
            """
            UPDATE cronjobs
            SET name = ?,
                cron = ?,
                description = ?,
                enabled = ?,
                delivery = ?,
                metadata = ?,
                last_run_at = ?,
                next_run_at = ?,
                run_count = ?,
                last_status = ?,
                last_error = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                name if name is not None else str(existing["name"]),
                cron if cron is not None else str(existing["cron"]),
                description if description is not None else str(existing["description"]),
                (1 if enabled else 0) if enabled is not None else (1 if existing["enabled"] else 0),
                json.dumps(delivery if delivery is not None else existing["delivery"], ensure_ascii=True),
                json.dumps(metadata if metadata is not None else existing["metadata"], ensure_ascii=True),
                last_run_at if last_run_at is not None else existing["last_run_at"],
                next_run_at if next_run_at is not None else existing["next_run_at"],
                run_count if run_count is not None else int(existing["run_count"]),
                last_status if last_status is not None else existing["last_status"],
                last_error if last_error is not None else existing["last_error"],
                utc_now_iso(),
                job_id,
            ),
        )
        row = conn.execute("SELECT * FROM cronjobs WHERE id = ? LIMIT 1", (job_id,)).fetchone()
    return _row_to_cronjob(row) if row is not None else None


def delete_cronjob(job_id: str) -> bool:
    with runtime_db_connection() as conn:
        cursor = conn.execute("DELETE FROM cronjobs WHERE id = ?", (job_id,))
    return cursor.rowcount > 0


def _row_to_cronjob(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    return {
        "id": str(data["id"]),
        "workspace_id": str(data["workspace_id"]),
        "initiated_by": str(data["initiated_by"]),
        "name": str(data.get("name") or ""),
        "cron": str(data["cron"]),
        "description": str(data["description"]),
        "enabled": bool(int(data["enabled"])),
        "delivery": _parse_json_dict(data.get("delivery")),
        "metadata": _parse_json_dict(data.get("metadata")),
        "last_run_at": str(data["last_run_at"]) if data.get("last_run_at") is not None else None,
        "next_run_at": str(data["next_run_at"]) if data.get("next_run_at") is not None else None,
        "run_count": int(data.get("run_count") or 0),
        "last_status": str(data["last_status"]) if data.get("last_status") is not None else None,
        "last_error": str(data["last_error"]) if data.get("last_error") is not None else None,
        "created_at": str(data["created_at"]),
        "updated_at": str(data["updated_at"]),
    }


def _row_to_task_proposal(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    parsed_source_event_ids = _parse_json_list(data.get("source_event_ids"))
    return {
        "proposal_id": str(data["proposal_id"]),
        "workspace_id": str(data["workspace_id"]),
        "task_name": str(data["task_name"]),
        "task_prompt": str(data["task_prompt"]),
        "task_generation_rationale": str(data["task_generation_rationale"]),
        "source_event_ids": [str(item) for item in parsed_source_event_ids if isinstance(item, str)],
        "created_at": str(data["created_at"]),
        "state": str(data["state"]),
    }


def _row_to_session_artifact(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    return {
        "id": str(data["id"]),
        "session_id": str(data["session_id"]),
        "workspace_id": str(data["workspace_id"]),
        "artifact_type": str(data["artifact_type"]),
        "external_id": str(data["external_id"]),
        "platform": str(data["platform"]) if data.get("platform") is not None else None,
        "title": str(data["title"]) if data.get("title") is not None else None,
        "metadata": _parse_json_dict(data.get("metadata")),
        "created_at": str(data["created_at"]),
    }


def _row_to_output_folder(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    return {
        "id": str(data["id"]),
        "workspace_id": str(data["workspace_id"]),
        "name": str(data["name"]),
        "position": int(data["position"]),
        "created_at": str(data["created_at"]) if data.get("created_at") is not None else None,
        "updated_at": str(data["updated_at"]) if data.get("updated_at") is not None else None,
    }


def _row_to_output(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    return {
        "id": str(data["id"]),
        "workspace_id": str(data["workspace_id"]),
        "output_type": str(data["output_type"]),
        "title": str(data["title"]) if data.get("title") is not None else "",
        "status": str(data["status"]) if data.get("status") is not None else "draft",
        "module_id": str(data["module_id"]) if data.get("module_id") is not None else None,
        "module_resource_id": (str(data["module_resource_id"]) if data.get("module_resource_id") is not None else None),
        "file_path": str(data["file_path"]) if data.get("file_path") is not None else None,
        "html_content": str(data["html_content"]) if data.get("html_content") is not None else None,
        "session_id": str(data["session_id"]) if data.get("session_id") is not None else None,
        "artifact_id": str(data["artifact_id"]) if data.get("artifact_id") is not None else None,
        "folder_id": str(data["folder_id"]) if data.get("folder_id") is not None else None,
        "platform": str(data["platform"]) if data.get("platform") is not None else None,
        "metadata": _parse_json_dict(data.get("metadata")),
        "created_at": str(data["created_at"]) if data.get("created_at") is not None else None,
        "updated_at": str(data["updated_at"]) if data.get("updated_at") is not None else None,
    }


# ---------------------------------------------------------------------------
# App build status
# ---------------------------------------------------------------------------


def upsert_app_build(
    *,
    workspace_id: str,
    app_id: str,
    status: str,
    error: str | None = None,
) -> dict[str, Any]:
    """Insert or update app build status."""
    now = utc_now_iso()
    with runtime_db_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM app_builds WHERE workspace_id = ? AND app_id = ?",
            (workspace_id, app_id),
        ).fetchone()
        if row:
            fields: dict[str, Any] = {"status": status, "updated_at": now}
            if status == "building":
                fields["started_at"] = now
                fields["error"] = None
            elif status == "completed":
                fields["completed_at"] = now
                fields["error"] = None
            elif status == "failed":
                fields["completed_at"] = now
                fields["error"] = error
            set_clause = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(
                f"UPDATE app_builds SET {set_clause} WHERE workspace_id = ? AND app_id = ?",
                (*fields.values(), workspace_id, app_id),
            )
        else:
            conn.execute(
                "INSERT INTO app_builds (workspace_id, app_id, status, started_at, completed_at, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (workspace_id, app_id, status, now if status == "building" else None, None, error, now, now),
            )
        result_row = conn.execute(
            "SELECT workspace_id, app_id, status, started_at, completed_at, error, created_at, updated_at FROM app_builds WHERE workspace_id = ? AND app_id = ?",
            (workspace_id, app_id),
        ).fetchone()
    if result_row is None:
        return {}
    return dict(result_row)


def get_app_build(*, workspace_id: str, app_id: str) -> dict[str, Any] | None:
    """Get build status for an app."""
    with runtime_db_connection() as conn:
        row = conn.execute(
            "SELECT workspace_id, app_id, status, started_at, completed_at, error, created_at, updated_at FROM app_builds WHERE workspace_id = ? AND app_id = ?",
            (workspace_id, app_id),
        ).fetchone()
    if row is None:
        return None
    return dict(row)


def delete_app_build(*, workspace_id: str, app_id: str) -> bool:
    """Remove build status entry."""
    with runtime_db_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM app_builds WHERE workspace_id = ? AND app_id = ?",
            (workspace_id, app_id),
        )
    return cursor.rowcount > 0
