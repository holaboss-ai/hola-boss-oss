# ruff: noqa: S101

from __future__ import annotations

import sqlite3
from pathlib import Path

from sandbox_agent_runtime import runtime_local_state as state_module


def _runtime_db_row(db_path: Path, query: str, params: tuple[object, ...] = ()) -> sqlite3.Row | None:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(query, params).fetchone()
    finally:
        conn.close()


def _runtime_db_tables(db_path: Path) -> set[str]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    finally:
        conn.close()
    return {str(row["name"]) for row in rows}


def test_runtime_root_dir_resolves_app_parent(monkeypatch) -> None:
    fake_file = "/runtime-root/app/sandbox_agent_runtime/runtime_local_state.py"
    monkeypatch.setattr(state_module, "__file__", fake_file)

    assert state_module._runtime_root_dir() == Path("/runtime-root")


def test_ts_state_store_is_enabled_by_default_and_can_be_disabled(monkeypatch) -> None:
    monkeypatch.delenv("HOLABOSS_RUNTIME_USE_TS_STATE_STORE", raising=False)
    monkeypatch.delenv("HOLABOSS_RUNTIME_DISABLE_TS_STATE_STORE", raising=False)

    assert state_module._ts_state_store_enabled() is True

    monkeypatch.setenv("HOLABOSS_RUNTIME_DISABLE_TS_STATE_STORE", "1")

    assert state_module._ts_state_store_enabled() is False


def test_workspace_registry_round_trip_uses_hidden_identity_file(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "runtime.db"
    workspace_root = tmp_path / "workspace"
    monkeypatch.setenv("HOLABOSS_RUNTIME_DB_PATH", str(db_path))
    monkeypatch.setattr(state_module, "WORKSPACE_ROOT", str(workspace_root))

    created = state_module.create_workspace(
        workspace_id="workspace-1",
        name="Acme",
        harness="opencode",
        status="active",
    )

    identity_path = workspace_root / "workspace-1" / ".holaboss" / "workspace_id"
    assert identity_path.is_file()
    assert identity_path.read_text(encoding="utf-8").strip() == "workspace-1"
    assert created.id == "workspace-1"
    assert state_module.get_workspace("workspace-1") == created
    assert [record.id for record in state_module.list_workspaces()] == ["workspace-1"]

    tables = _runtime_db_tables(db_path)
    row = _runtime_db_row(db_path, "SELECT workspace_path FROM workspaces WHERE id = ?", ("workspace-1",))
    assert "workspaces" in tables
    assert row is not None
    assert Path(str(row["workspace_path"])) == workspace_root / "workspace-1"


def test_runtime_schema_migrates_workspace_rows_to_registry_and_identity_file(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "runtime.db"
    workspace_root = tmp_path / "workspace"
    monkeypatch.setenv("HOLABOSS_RUNTIME_DB_PATH", str(db_path))
    monkeypatch.setattr(state_module, "WORKSPACE_ROOT", str(workspace_root))

    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """
        CREATE TABLE workspaces (
            id TEXT PRIMARY KEY,
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
        )
        """
    )
    conn.execute(
        """
        INSERT INTO workspaces (
            id, name, status, harness, main_session_id, error_message,
            onboarding_status, onboarding_session_id, onboarding_completed_at,
            onboarding_completion_summary, onboarding_requested_at, onboarding_requested_by,
            created_at, updated_at, deleted_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "workspace-legacy",
            "Legacy",
            "active",
            "opencode",
            "session-1",
            None,
            "not_required",
            None,
            None,
            None,
            None,
            None,
            "2026-01-01T00:00:00+00:00",
            "2026-01-02T00:00:00+00:00",
            None,
        ),
    )
    conn.commit()
    conn.close()

    rows = state_module.list_workspaces()

    assert [record.id for record in rows] == ["workspace-legacy"]
    identity_path = workspace_root / "workspace-legacy" / ".holaboss" / "workspace_id"
    assert identity_path.is_file()
    assert identity_path.read_text(encoding="utf-8").strip() == "workspace-legacy"

    tables = _runtime_db_tables(db_path)
    row = _runtime_db_row(db_path, "SELECT workspace_path FROM workspaces WHERE id = ?", ("workspace-legacy",))
    assert "workspaces" in tables
    assert row is not None
    assert Path(str(row["workspace_path"])) == workspace_root / "workspace-legacy"


def test_workspace_dir_recovers_when_folder_is_renamed(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "runtime.db"
    workspace_root = tmp_path / "workspace"
    monkeypatch.setenv("HOLABOSS_RUNTIME_DB_PATH", str(db_path))
    monkeypatch.setattr(state_module, "WORKSPACE_ROOT", str(workspace_root))

    state_module.create_workspace(workspace_id="workspace-1", name="Acme", harness="opencode", status="active")
    original_path = workspace_root / "workspace-1"
    renamed_path = workspace_root / "workspace-renamed"
    original_path.rename(renamed_path)

    resolved = state_module.workspace_dir("workspace-1")

    assert resolved == renamed_path
    row = _runtime_db_row(db_path, "SELECT workspace_path FROM workspaces WHERE id = ?", ("workspace-1",))
    assert row is not None
    assert Path(str(row["workspace_path"])) == renamed_path


def test_get_workspace_recovers_missing_row_from_identity_file(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "runtime.db"
    workspace_root = tmp_path / "workspace"
    monkeypatch.setenv("HOLABOSS_RUNTIME_DB_PATH", str(db_path))
    monkeypatch.setenv("SANDBOX_AGENT_HARNESS", "opencode")
    monkeypatch.setattr(state_module, "WORKSPACE_ROOT", str(workspace_root))

    state_module.create_workspace(workspace_id="workspace-1", name="Acme", harness="opencode", status="active")
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("DELETE FROM workspaces WHERE id = ?", ("workspace-1",))
        conn.commit()
    finally:
        conn.close()

    recovered = state_module.get_workspace("workspace-1")

    assert recovered is not None
    assert recovered.id == "workspace-1"
    assert recovered.name == "workspace-1"
    assert recovered.harness == "opencode"
    assert recovered.status == "active"
    row = _runtime_db_row(
        db_path,
        "SELECT id, workspace_path, harness, status FROM workspaces WHERE id = ?",
        ("workspace-1",),
    )
    assert row is not None
    assert str(row["id"]) == "workspace-1"
    assert Path(str(row["workspace_path"])) == workspace_root / "workspace-1"
    assert str(row["harness"]) == "opencode"
    assert str(row["status"]) == "active"


def test_upsert_binding_delegates_to_ts_state_store_when_enabled(monkeypatch) -> None:
    def _fake_call(*, operation, payload):
        assert operation == "upsert-binding"
        assert payload == {
            "workspace_id": "workspace-1",
            "session_id": "session-main",
            "harness": "opencode",
            "harness_session_id": "harness-1",
        }
        return {
            "workspace_id": "workspace-1",
            "session_id": "session-main",
            "harness": "opencode",
            "harness_session_id": "harness-1",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }

    monkeypatch.setattr(state_module, "_ts_state_store_call", _fake_call)

    record = state_module.upsert_binding(
        workspace_id="workspace-1",
        session_id="session-main",
        harness="opencode",
        harness_session_id="harness-1",
    )

    assert record.workspace_id == "workspace-1"
    assert record.session_id == "session-main"
    assert record.harness_session_id == "harness-1"


def test_list_session_messages_delegates_to_ts_state_store_when_enabled(monkeypatch) -> None:
    def _fake_call(*, operation, payload):
        assert operation == "list-session-messages"
        assert payload == {
            "workspace_id": "workspace-1",
            "session_id": "session-main",
        }
        return [
            {
                "id": "m-1",
                "role": "user",
                "text": "hello",
                "created_at": "2026-01-01T00:00:00+00:00",
                "metadata": {},
            },
            {
                "id": "m-2",
                "role": "assistant",
                "text": "hi",
                "created_at": "2026-01-01T00:00:01+00:00",
                "metadata": {},
            },
        ]

    monkeypatch.setattr(state_module, "_ts_state_store_call", _fake_call)

    messages = state_module.list_session_messages(workspace_id="workspace-1", session_id="session-main")

    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[1]["text"] == "hi"


def test_output_event_functions_delegate_to_ts_state_store_when_enabled(monkeypatch) -> None:
    captured: list[tuple[str, dict[str, object]]] = []

    def _fake_call(*, operation, payload):
        captured.append((operation, payload))
        if operation == "append-output-event":
            return {"ok": True}
        if operation == "latest-output-event-id":
            return 7
        if operation == "list-output-events":
            return [
                {
                    "id": 7,
                    "workspace_id": "workspace-1",
                    "session_id": "session-main",
                    "input_id": "input-1",
                    "sequence": 2,
                    "event_type": "output_delta",
                    "payload": {"delta": "hi"},
                    "created_at": "2026-01-01T00:00:01+00:00",
                }
            ]
        raise AssertionError(f"unexpected operation: {operation}")

    monkeypatch.setattr(state_module, "_ts_state_store_call", _fake_call)

    state_module.append_output_event(
        workspace_id="workspace-1",
        session_id="session-main",
        input_id="input-1",
        sequence=2,
        event_type="output_delta",
        payload={"delta": "hi"},
    )
    latest_id = state_module.latest_output_event_id(session_id="session-main", input_id="input-1")
    events = state_module.list_output_events(session_id="session-main", input_id="input-1", after_event_id=6)

    assert captured[0][0] == "append-output-event"
    assert latest_id == 7
    assert events == [
        {
            "id": 7,
            "workspace_id": "workspace-1",
            "session_id": "session-main",
            "input_id": "input-1",
            "sequence": 2,
            "event_type": "output_delta",
            "payload": {"delta": "hi"},
            "created_at": "2026-01-01T00:00:01+00:00",
        }
    ]


def test_workspace_crud_delegates_to_ts_state_store_when_enabled(monkeypatch) -> None:
    captured: list[tuple[str, dict[str, object]]] = []

    def _fake_call(*, operation, payload):
        captured.append((operation, payload))
        if operation == "create-workspace":
            return {
                "id": "workspace-1",
                "name": "Workspace 1",
                "status": "provisioning",
                "harness": "opencode",
                "main_session_id": "session-main",
                "error_message": None,
                "onboarding_status": "not_required",
                "onboarding_session_id": None,
                "onboarding_completed_at": None,
                "onboarding_completion_summary": None,
                "onboarding_requested_at": None,
                "onboarding_requested_by": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
                "deleted_at_utc": None,
            }
        if operation == "list-workspaces":
            return [
                {
                    "id": "workspace-1",
                    "name": "Workspace 1",
                    "status": "provisioning",
                    "harness": "opencode",
                    "main_session_id": "session-main",
                    "error_message": None,
                    "onboarding_status": "not_required",
                    "onboarding_session_id": None,
                    "onboarding_completed_at": None,
                    "onboarding_completion_summary": None,
                    "onboarding_requested_at": None,
                    "onboarding_requested_by": None,
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                    "deleted_at_utc": None,
                }
            ]
        if operation == "get-workspace":
            return {
                "id": "workspace-1",
                "name": "Workspace 1",
                "status": "active",
                "harness": "opencode",
                "main_session_id": "session-main",
                "error_message": None,
                "onboarding_status": "pending",
                "onboarding_session_id": None,
                "onboarding_completed_at": None,
                "onboarding_completion_summary": None,
                "onboarding_requested_at": None,
                "onboarding_requested_by": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-02T00:00:00+00:00",
                "deleted_at_utc": None,
            }
        if operation == "update-workspace":
            return {
                "id": "workspace-1",
                "name": "Workspace 1",
                "status": "active",
                "harness": "opencode",
                "main_session_id": "session-main",
                "error_message": None,
                "onboarding_status": "pending",
                "onboarding_session_id": None,
                "onboarding_completed_at": None,
                "onboarding_completion_summary": None,
                "onboarding_requested_at": None,
                "onboarding_requested_by": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-02T00:00:00+00:00",
                "deleted_at_utc": None,
            }
        if operation == "delete-workspace":
            return {
                "id": "workspace-1",
                "name": "Workspace 1",
                "status": "deleted",
                "harness": "opencode",
                "main_session_id": "session-main",
                "error_message": None,
                "onboarding_status": "pending",
                "onboarding_session_id": None,
                "onboarding_completed_at": None,
                "onboarding_completion_summary": None,
                "onboarding_requested_at": None,
                "onboarding_requested_by": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-03T00:00:00+00:00",
                "deleted_at_utc": "2026-01-03T00:00:00+00:00",
            }
        raise AssertionError(f"unexpected operation: {operation}")

    monkeypatch.setattr(state_module, "_ts_state_store_call", _fake_call)

    created = state_module.create_workspace(
        workspace_id="workspace-1",
        name="Workspace 1",
        harness="opencode",
        status="provisioning",
        main_session_id="session-main",
    )
    listed = state_module.list_workspaces()
    fetched = state_module.get_workspace("workspace-1")
    updated = state_module.update_workspace("workspace-1", status="active", onboarding_status="pending")
    deleted = state_module.delete_workspace("workspace-1")

    assert created.id == "workspace-1"
    assert [item.id for item in listed] == ["workspace-1"]
    assert fetched is not None
    assert fetched.status == "active"
    assert updated.onboarding_status == "pending"
    assert deleted.status == "deleted"
    assert [item[0] for item in captured] == [
        "create-workspace",
        "list-workspaces",
        "get-workspace",
        "update-workspace",
        "delete-workspace",
    ]


def test_workspace_dir_delegates_to_ts_state_store_when_enabled(monkeypatch) -> None:
    def _fake_call(*, operation, payload):
        assert operation == "workspace-dir"
        assert payload == {"workspace_id": "workspace-1"}
        return "/tmp/workspace-1"

    monkeypatch.setattr(state_module, "_ts_state_store_call", _fake_call)

    assert state_module.workspace_dir("workspace-1") == Path("/tmp/workspace-1")


def test_outputs_and_artifacts_delegate_to_ts_state_store_when_enabled(monkeypatch) -> None:
    def _fake_call(*, operation, payload):
        if operation == "create-output-folder":
            return {
                "id": "folder-1",
                "workspace_id": "workspace-1",
                "name": "Drafts",
                "position": 0,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        if operation == "create-output":
            return {
                "id": "output-1",
                "workspace_id": "workspace-1",
                "output_type": "document",
                "title": "Spec Draft",
                "status": "draft",
                "module_id": None,
                "module_resource_id": None,
                "file_path": None,
                "html_content": None,
                "session_id": "session-main",
                "artifact_id": None,
                "folder_id": "folder-1",
                "platform": None,
                "metadata": {},
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        if operation == "create-session-artifact":
            return {
                "id": "artifact-1",
                "session_id": "session-main",
                "workspace_id": "workspace-1",
                "artifact_type": "document",
                "external_id": "doc-1",
                "platform": "notion",
                "title": "Generated Doc",
                "metadata": {},
                "created_at": "2026-01-01T00:00:00+00:00",
            }
        if operation == "list-outputs":
            return [
                {
                    "id": "output-1",
                    "workspace_id": "workspace-1",
                    "output_type": "document",
                    "title": "Spec Draft",
                    "status": "draft",
                    "module_id": None,
                    "module_resource_id": None,
                    "file_path": None,
                    "html_content": None,
                    "session_id": "session-main",
                    "artifact_id": None,
                    "folder_id": "folder-1",
                    "platform": None,
                    "metadata": {},
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                }
            ]
        if operation == "get-output-counts":
            return {
                "total": 1,
                "by_status": {"draft": 1},
                "by_platform": {},
                "by_folder": {"folder-1": 1},
            }
        if operation == "list-session-artifacts":
            return [
                {
                    "id": "artifact-1",
                    "session_id": "session-main",
                    "workspace_id": "workspace-1",
                    "artifact_type": "document",
                    "external_id": "doc-1",
                    "platform": "notion",
                    "title": "Generated Doc",
                    "metadata": {},
                    "created_at": "2026-01-01T00:00:00+00:00",
                }
            ]
        if operation == "list-sessions-with-artifacts":
            return [
                {
                    "session_id": "session-main",
                    "status": "WAITING_USER",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:01+00:00",
                    "artifacts": [{"artifact_type": "document", "external_id": "doc-1", "platform": "notion", "title": "Generated Doc"}],
                }
            ]
        raise AssertionError(f"unexpected operation: {operation}")

    monkeypatch.setattr(state_module, "_ts_state_store_call", _fake_call)

    folder = state_module.create_output_folder(workspace_id="workspace-1", name="Drafts")
    output = state_module.create_output(
        workspace_id="workspace-1",
        output_type="document",
        title="Spec Draft",
        folder_id="folder-1",
        session_id="session-main",
    )
    artifact = state_module.create_session_artifact(
        session_id="session-main",
        workspace_id="workspace-1",
        artifact_type="document",
        external_id="doc-1",
        platform="notion",
        title="Generated Doc",
    )
    outputs = state_module.list_outputs(workspace_id="workspace-1")
    counts = state_module.get_output_counts(workspace_id="workspace-1")
    artifacts = state_module.list_session_artifacts(session_id="session-main", workspace_id="workspace-1")
    sessions = state_module.list_sessions_with_artifacts(workspace_id="workspace-1")

    assert folder["id"] == "folder-1"
    assert output["folder_id"] == "folder-1"
    assert artifact["external_id"] == "doc-1"
    assert counts["total"] == 1
    assert outputs[0]["title"] == "Spec Draft"
    assert artifacts[0]["platform"] == "notion"
    assert sessions[0]["artifacts"][0]["external_id"] == "doc-1"


def test_cronjobs_and_task_proposals_delegate_to_ts_state_store_when_enabled(monkeypatch) -> None:
    def _fake_call(*, operation, payload):
        if operation == "create-cronjob":
            return {
                "id": "job-1",
                "workspace_id": "workspace-1",
                "initiated_by": "workspace_agent",
                "name": "",
                "cron": "0 9 * * *",
                "description": "Daily check",
                "enabled": True,
                "delivery": {"mode": "announce", "channel": "session_run", "to": None},
                "metadata": {},
                "last_run_at": None,
                "next_run_at": None,
                "run_count": 0,
                "last_status": None,
                "last_error": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        if operation == "list-cronjobs":
            return [
                {
                    "id": "job-1",
                    "workspace_id": "workspace-1",
                    "initiated_by": "workspace_agent",
                    "name": "",
                    "cron": "0 9 * * *",
                    "description": "Daily check",
                    "enabled": True,
                    "delivery": {"mode": "announce", "channel": "session_run", "to": None},
                    "metadata": {},
                    "last_run_at": None,
                    "next_run_at": None,
                    "run_count": 0,
                    "last_status": None,
                    "last_error": None,
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                }
            ]
        if operation == "update-cronjob":
            return {
                "id": "job-1",
                "workspace_id": "workspace-1",
                "initiated_by": "workspace_agent",
                "name": "",
                "cron": "0 9 * * *",
                "description": "Updated check",
                "enabled": True,
                "delivery": {"mode": "announce", "channel": "session_run", "to": None},
                "metadata": {},
                "last_run_at": None,
                "next_run_at": None,
                "run_count": 0,
                "last_status": None,
                "last_error": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:01+00:00",
            }
        if operation == "delete-cronjob":
            return True
        if operation == "create-task-proposal":
            return {
                "proposal_id": "proposal-1",
                "workspace_id": "workspace-1",
                "task_name": "Follow up",
                "task_prompt": "Write a follow-up message",
                "task_generation_rationale": "User has not replied",
                "source_event_ids": ["evt-1"],
                "created_at": "2026-01-01T00:00:00+00:00",
                "state": "not_reviewed",
            }
        if operation == "list-task-proposals":
            return [
                {
                    "proposal_id": "proposal-1",
                    "workspace_id": "workspace-1",
                    "task_name": "Follow up",
                    "task_prompt": "Write a follow-up message",
                    "task_generation_rationale": "User has not replied",
                    "source_event_ids": ["evt-1"],
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "state": "not_reviewed",
                }
            ]
        if operation == "list-unreviewed-task-proposals":
            return [
                {
                    "proposal_id": "proposal-1",
                    "workspace_id": "workspace-1",
                    "task_name": "Follow up",
                    "task_prompt": "Write a follow-up message",
                    "task_generation_rationale": "User has not replied",
                    "source_event_ids": ["evt-1"],
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "state": "not_reviewed",
                }
            ]
        if operation == "update-task-proposal-state":
            return {
                "proposal_id": "proposal-1",
                "workspace_id": "workspace-1",
                "task_name": "Follow up",
                "task_prompt": "Write a follow-up message",
                "task_generation_rationale": "User has not replied",
                "source_event_ids": ["evt-1"],
                "created_at": "2026-01-01T00:00:00+00:00",
                "state": "accepted",
            }
        raise AssertionError(f"unexpected operation: {operation}")

    monkeypatch.setattr(state_module, "_ts_state_store_call", _fake_call)

    job = state_module.create_cronjob(
        workspace_id="workspace-1",
        initiated_by="workspace_agent",
        cron="0 9 * * *",
        description="Daily check",
        delivery={"mode": "announce", "channel": "session_run", "to": None},
    )
    jobs = state_module.list_cronjobs(workspace_id="workspace-1")
    updated_job = state_module.update_cronjob(job_id="job-1", description="Updated check")
    deleted_job = state_module.delete_cronjob("job-1")
    proposal = state_module.create_task_proposal(
        proposal_id="proposal-1",
        workspace_id="workspace-1",
        task_name="Follow up",
        task_prompt="Write a follow-up message",
        task_generation_rationale="User has not replied",
        source_event_ids=["evt-1"],
        created_at="2026-01-01T00:00:00+00:00",
    )
    proposals = state_module.list_task_proposals(workspace_id="workspace-1")
    unreviewed = state_module.list_unreviewed_task_proposals(workspace_id="workspace-1")
    updated_proposal = state_module.update_task_proposal_state(proposal_id="proposal-1", state="accepted")

    assert job["id"] == "job-1"
    assert jobs[0]["description"] == "Daily check"
    assert updated_job is not None
    assert updated_job["description"] == "Updated check"
    assert deleted_job is True
    assert proposal["proposal_id"] == "proposal-1"
    assert proposals[0]["task_name"] == "Follow up"
    assert unreviewed[0]["state"] == "not_reviewed"
    assert updated_proposal is not None
    assert updated_proposal["state"] == "accepted"
