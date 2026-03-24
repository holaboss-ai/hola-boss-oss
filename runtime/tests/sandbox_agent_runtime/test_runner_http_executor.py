# ruff: noqa: S101

from __future__ import annotations

import json

import pytest

from sandbox_agent_runtime import runner_http_executor as executor_module


@pytest.mark.asyncio
async def test_run_operation_prints_runner_payload(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def _fake_run_agent_request(payload, *, execute_runner_request, build_run_failed_event):
        del payload, execute_runner_request, build_run_failed_event
        return executor_module.WorkspaceAgentRunResponse.model_validate(
            {
                "session_id": "session-1",
                "input_id": "input-1",
                "events": [
                    {
                        "session_id": "session-1",
                        "input_id": "input-1",
                        "sequence": 1,
                        "event_type": "run_started",
                        "payload": {"instruction_preview": "hello"},
                    },
                    {
                        "session_id": "session-1",
                        "input_id": "input-1",
                        "sequence": 2,
                        "event_type": "run_completed",
                        "payload": {"status": "success"},
                    },
                ],
            }
        )

    monkeypatch.setattr(executor_module, "run_agent_request", _fake_run_agent_request)

    rc = await executor_module._run(
        operation="run",
        payload={
            "workspace_id": "workspace-1",
            "session_id": "session-1",
            "input_id": "input-1",
            "instruction": "hello",
            "context": {},
        },
    )

    captured = capsys.readouterr()
    assert rc == 0
    payload = json.loads(captured.out)
    assert payload["status_code"] == 200
    assert [event["event_type"] for event in payload["payload"]["events"]] == ["run_started", "run_completed"]


@pytest.mark.asyncio
async def test_stream_operation_writes_sse_bytes(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def _chunks():
        yield b"event: run_started\n\n"
        yield b"event: run_completed\n\n"

    class _FakeStreamingResponse:
        body_iterator = _chunks()

    async def _fake_stream_agent_run_request(payload, **kwargs):
        del payload, kwargs
        return _FakeStreamingResponse()

    monkeypatch.setattr(executor_module, "stream_agent_run_request", _fake_stream_agent_run_request)

    rc = await executor_module._run(
        operation="stream",
        payload={
            "workspace_id": "workspace-1",
            "session_id": "session-1",
            "input_id": "input-1",
            "instruction": "hello",
            "context": {},
        },
    )

    captured = capsys.readouterr()
    assert rc == 0
    assert "event: run_started" in captured.out
    assert "event: run_completed" in captured.out
