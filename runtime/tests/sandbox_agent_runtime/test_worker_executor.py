# ruff: noqa: S101

from __future__ import annotations

from types import SimpleNamespace

import pytest

from sandbox_agent_runtime import worker_executor as worker_executor_module


@pytest.mark.asyncio
async def test_run_returns_nonzero_when_input_missing(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(worker_executor_module, "get_input", lambda input_id: None)

    exit_code = await worker_executor_module._run("input-missing")

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "input not found: input-missing" in captured.err


@pytest.mark.asyncio
async def test_run_processes_claimed_input_when_record_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = SimpleNamespace(input_id="input-1")
    seen: list[object] = []

    async def _fake_process_claimed_input(input_record) -> None:
        seen.append(input_record)

    monkeypatch.setattr(worker_executor_module, "get_input", lambda input_id: record if input_id == "input-1" else None)
    monkeypatch.setattr(worker_executor_module, "process_claimed_input_record", _fake_process_claimed_input)

    exit_code = await worker_executor_module._run("input-1")

    assert exit_code == 0
    assert seen == [record]
