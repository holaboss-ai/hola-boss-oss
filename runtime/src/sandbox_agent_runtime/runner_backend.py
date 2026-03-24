from __future__ import annotations

import asyncio
import base64
import inspect
import json
import os
import shlex
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Container

from fastapi import HTTPException

from sandbox_agent_runtime.runner import RunnerOutputEvent, RunnerRequest


TERMINAL_EVENT_TYPES = {"run_completed", "run_failed"}


@dataclass(frozen=True)
class RunnerExecutionResult:
    events: list[RunnerOutputEvent]
    skipped_lines: list[str]
    stderr: str
    return_code: int
    saw_terminal: bool


def agent_runner_timeout_seconds() -> int:
    raw = os.getenv("SANDBOX_AGENT_RUN_TIMEOUT_S", "1800").strip()
    try:
        value = int(raw)
    except ValueError:
        return 1800
    return max(1, min(value, 7200))


def agent_runner_command(
    payload: RunnerRequest,
    *,
    default_command_template: str,
) -> str:
    request_json = payload.model_dump_json(exclude_none=False)
    encoded = base64.b64encode(request_json.encode("utf-8")).decode("utf-8")
    runtime_app_root = os.getenv("HOLABOSS_RUNTIME_APP_ROOT", "/app")
    runtime_python = os.getenv("HOLABOSS_RUNTIME_PYTHON", "/opt/venv/bin/python")
    template = os.getenv("SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE", default_command_template)
    try:
        return template.format(
            request_base64=shlex.quote(encoded),
            runtime_app_root=shlex.quote(runtime_app_root),
            runtime_python=shlex.quote(runtime_python),
        )
    except Exception as exc:  # pragma: no cover - defensive env misconfiguration path
        raise HTTPException(status_code=500, detail=f"invalid SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE: {exc}") from exc


def build_run_failed_event(
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


def normalize_event(raw_event: Any) -> RunnerOutputEvent | None:
    if not isinstance(raw_event, dict):
        return None
    try:
        return RunnerOutputEvent.model_validate(raw_event)
    except Exception:
        return None


def parse_runner_output_lines(stdout: str) -> tuple[list[RunnerOutputEvent], list[str]]:
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
        normalized = normalize_event(payload)
        if normalized is None:
            skipped_lines.append(line)
            continue
        events.append(normalized)
    return events, skipped_lines


async def execute_runner_request(
    payload: RunnerRequest,
    *,
    on_event: Callable[[RunnerOutputEvent], Awaitable[None] | None] | None = None,
    default_command_template: str,
    terminal_event_types: Container[str] = TERMINAL_EVENT_TYPES,
) -> RunnerExecutionResult:
    runner_command = agent_runner_command(payload, default_command_template=default_command_template)
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
    timeout_s = max(1, requested_timeout) if isinstance(requested_timeout, int) else agent_runner_timeout_seconds()
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

            event = normalize_event(parsed)
            if event is None:
                if len(skipped_lines) < 20:
                    skipped_lines.append(text)
                continue

            events.append(event)
            if on_event is not None:
                callback_result = on_event(event)
                if inspect.isawaitable(callback_result):
                    await callback_result
            if event.event_type in terminal_event_types:
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

    return RunnerExecutionResult(
        events=events,
        skipped_lines=skipped_lines,
        stderr=stderr_text,
        return_code=return_code,
        saw_terminal=saw_terminal,
    )
