# ruff: noqa: S101

from __future__ import annotations

import json

import pytest

from sandbox_agent_runtime import memory_executor as executor_module


def test_search_operation_prints_memory_payload(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        executor_module,
        "memory_search",
        lambda *, workspace_id, query, max_results, min_score: {
            "workspace_id": workspace_id,
            "query": query,
            "max_results": max_results,
            "min_score": min_score,
        },
    )

    rc = executor_module._run(
        operation="search",
        payload={
            "workspace_id": "workspace-1",
            "query": "durable preferences",
            "max_results": 5,
            "min_score": 0.1,
        },
    )

    captured = capsys.readouterr()
    assert rc == 0
    payload = json.loads(captured.out)
    assert payload["status_code"] == 200
    assert payload["payload"] == {
        "workspace_id": "workspace-1",
        "query": "durable preferences",
        "max_results": 5,
        "min_score": 0.1,
    }


def test_get_operation_returns_empty_text_when_file_missing(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    def _missing(*, workspace_id: str, path: str, from_line: int | None, lines: int | None) -> dict[str, object]:
        del workspace_id, path, from_line, lines
        raise FileNotFoundError("memory/preferences.md")

    monkeypatch.setattr(executor_module, "memory_get", _missing)

    rc = executor_module._run(
        operation="get",
        payload={"workspace_id": "workspace-1", "path": "memory/preferences.md"},
    )

    captured = capsys.readouterr()
    assert rc == 0
    payload = json.loads(captured.out)
    assert payload["status_code"] == 200
    assert payload["payload"] == {"path": "memory/preferences.md", "text": ""}


def test_status_operation_returns_validation_error_for_bad_workspace(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    def _boom(*, workspace_id: str) -> dict[str, object]:
        del workspace_id
        raise ValueError("bad workspace")

    monkeypatch.setattr(executor_module, "memory_status", _boom)

    rc = executor_module._run(
        operation="status",
        payload={"workspace_id": "workspace-1"},
    )

    captured = capsys.readouterr()
    assert rc == 0
    payload = json.loads(captured.out)
    assert payload["status_code"] == 400
    assert "bad workspace" in payload["detail"]
