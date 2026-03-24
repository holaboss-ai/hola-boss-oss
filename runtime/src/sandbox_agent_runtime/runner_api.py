from __future__ import annotations

import asyncio
import json
from contextlib import suppress
from typing import Any, Callable

from fastapi.responses import StreamingResponse

from sandbox_agent_runtime.api_models import WorkspaceAgentRunResponse
from sandbox_agent_runtime.runner import RunnerOutputEvent, RunnerRequest


def _sse_event(*, event: RunnerOutputEvent) -> bytes:
    event_name = event.event_type
    event_id = f"{event.input_id}:{event.sequence}"
    lines = [f"event: {event_name}", f"id: {event_id}", f"data: {event.model_dump_json()}"]
    return ("\n".join(lines) + "\n\n").encode("utf-8")


async def run_agent_request(
    payload: RunnerRequest,
    *,
    execute_runner_request,
    build_run_failed_event,
) -> WorkspaceAgentRunResponse:
    execution = await execute_runner_request(payload)
    events = list(execution.events)
    skipped_lines = execution.skipped_lines
    stderr = execution.stderr.strip()
    exit_code = int(execution.return_code)
    last_sequence = max((int(event.sequence) for event in events), default=0)

    if not execution.saw_terminal and exit_code != 0:
        events.append(
            build_run_failed_event(
                session_id=payload.session_id,
                input_id=payload.input_id,
                sequence=last_sequence + 1,
                message=stderr or f"runner command failed with exit_code={exit_code}",
                error_type="RunnerCommandError",
            )
        )
    elif not execution.saw_terminal:
        details = "; ".join(skipped_lines[:3]) if skipped_lines else ""
        suffix = f" (skipped output: {details})" if details else ""
        events.append(
            build_run_failed_event(
                session_id=payload.session_id,
                input_id=payload.input_id,
                sequence=last_sequence + 1,
                message=f"runner ended before terminal event{suffix}",
            )
        )

    return WorkspaceAgentRunResponse(
        session_id=payload.session_id,
        input_id=payload.input_id,
        events=events,
    )


async def stream_agent_run_request(
    payload: RunnerRequest,
    *,
    agent_runner_command: Callable[[RunnerRequest], str],
    normalize_event: Callable[[Any], RunnerOutputEvent | None],
    build_run_failed_event: Callable[..., RunnerOutputEvent],
    terminal_event_types: set[str],
) -> StreamingResponse:
    runner_command = agent_runner_command(payload)

    async def _event_stream():
        process = await asyncio.create_subprocess_exec(
            "/bin/bash",
            "-lc",
            runner_command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        if process.stdout is None or process.stderr is None:
            raise RuntimeError("sandbox runner subprocess streams were not initialized")

        stderr_task = asyncio.create_task(process.stderr.read())
        saw_terminal = False
        last_sequence = 0
        skipped_lines: list[str] = []
        heartbeat_every = 5.0
        last_heartbeat = asyncio.get_running_loop().time()

        try:
            yield b": connected\n\n"
            while True:
                try:
                    line = await asyncio.wait_for(process.stdout.readline(), timeout=1.0)
                except TimeoutError:
                    if process.returncode is not None:
                        break
                    now = asyncio.get_running_loop().time()
                    if now - last_heartbeat >= heartbeat_every:
                        last_heartbeat = now
                        yield b": ping\n\n"
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

                last_sequence = max(last_sequence, int(event.sequence))
                if event.event_type in terminal_event_types:
                    saw_terminal = True
                yield _sse_event(event=event)
                last_heartbeat = asyncio.get_running_loop().time()

                if saw_terminal:
                    return

            stderr_text = (await stderr_task).decode("utf-8", errors="replace").strip()
            return_code = int(process.returncode or 0)
            if not saw_terminal and return_code != 0:
                failure = build_run_failed_event(
                    session_id=payload.session_id,
                    input_id=payload.input_id,
                    sequence=last_sequence + 1,
                    message=stderr_text or f"runner command failed with exit_code={return_code}",
                    error_type="RunnerCommandError",
                )
                yield _sse_event(event=failure)
                return

            if not saw_terminal:
                details = "; ".join(skipped_lines[:3]) if skipped_lines else ""
                suffix = f" (skipped output: {details})" if details else ""
                failure = build_run_failed_event(
                    session_id=payload.session_id,
                    input_id=payload.input_id,
                    sequence=last_sequence + 1,
                    message=f"runner stream ended before terminal event{suffix}",
                )
                yield _sse_event(event=failure)
        finally:
            if not stderr_task.done():
                stderr_task.cancel()
                with suppress(asyncio.CancelledError):
                    await stderr_task
            if process.returncode is None:
                process.kill()
                with suppress(Exception):
                    await process.wait()

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
