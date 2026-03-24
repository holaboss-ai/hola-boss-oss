# ruff: noqa: S101

from __future__ import annotations

import base64
import json

import pytest

from sandbox_agent_runtime import bridge_executor as bridge_executor_module
from sandbox_agent_runtime.proactive_bridge import ProactiveBridgeJobResult


@pytest.mark.asyncio
async def test_bridge_executor_run_returns_nonzero_for_invalid_payload(capsys: pytest.CaptureFixture[str]) -> None:
    rc = await bridge_executor_module._run("not-base64")

    captured = capsys.readouterr()
    assert rc == 1
    assert "invalid bridge job payload" in captured.err


@pytest.mark.asyncio
async def test_bridge_executor_run_executes_job_and_prints_json(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def _fake_execute(job):
        return ProactiveBridgeJobResult.model_validate(
            {
                "job_id": job.job_id,
                "status": "succeeded",
                "workspace_id": job.workspace_id,
                "job_type": job.job_type,
                "output": {"ok": True},
            }
        )

    monkeypatch.setattr(
        bridge_executor_module.LocalRuntimeProactiveBridgeExecutor,
        "execute",
        lambda self, job: _fake_execute(job),
    )

    payload = {
        "job_id": "job-1",
        "job_type": "task_proposal.create",
        "workspace_id": "workspace-1",
        "payload": {"workspace_id": "workspace-1", "task_name": "Review", "task_prompt": "Prompt", "task_generation_rationale": "Why"},
    }
    encoded = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")

    rc = await bridge_executor_module._run(encoded)

    captured = capsys.readouterr()
    assert rc == 0
    assert json.loads(captured.out)["job_id"] == "job-1"
