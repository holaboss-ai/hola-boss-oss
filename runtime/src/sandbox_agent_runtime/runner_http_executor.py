from __future__ import annotations

import argparse
import asyncio
import sys

from pydantic import ValidationError

from sandbox_agent_runtime.api_models import WorkspaceAgentRunResponse
from sandbox_agent_runtime.executor_io import print_envelope, read_json_stdin
from sandbox_agent_runtime.local_execution_service import DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE
from sandbox_agent_runtime.runner import RunnerRequest
from sandbox_agent_runtime.runner_api import run_agent_request, stream_agent_run_request
from sandbox_agent_runtime.runner_backend import (
    TERMINAL_EVENT_TYPES,
    agent_runner_command,
    build_run_failed_event,
    execute_runner_request,
    normalize_event,
)


async def _run_json(payload: dict[str, Any]) -> int:
    try:
        request = RunnerRequest.model_validate(payload)
        result = await run_agent_request(
            request,
            execute_runner_request=lambda request: execute_runner_request(
                request,
                default_command_template=DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE,
                terminal_event_types=TERMINAL_EVENT_TYPES,
            ),
            build_run_failed_event=build_run_failed_event,
        )
    except (ValidationError, ValueError) as exc:
        print_envelope(status_code=400, detail=str(exc))
        return 0
    except Exception as exc:
        print_envelope(status_code=400, detail=str(exc))
        return 0

    print_envelope(status_code=200, payload=result.model_dump(mode="json"))
    return 0


async def _run_stream(payload: dict[str, Any]) -> int:
    try:
        request = RunnerRequest.model_validate(payload)
        response = await stream_agent_run_request(
            request,
            agent_runner_command=lambda payload: agent_runner_command(
                payload,
                default_command_template=DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE,
            ),
            normalize_event=normalize_event,
            build_run_failed_event=build_run_failed_event,
            terminal_event_types=TERMINAL_EVENT_TYPES,
        )
    except (ValidationError, ValueError) as exc:
        sys.stderr.write(str(exc))
        return 1
    except Exception as exc:
        sys.stderr.write(str(exc))
        return 1

    async for chunk in response.body_iterator:
        data = chunk.encode("utf-8") if isinstance(chunk, str) else chunk
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    return 0


async def _run(*, operation: str, payload: dict[str, Any]) -> int:
    if operation == "run":
        return await _run_json(payload)
    if operation == "stream":
        return await _run_stream(payload)
    _print_envelope(status_code=400, detail=f"unsupported runner operation: {operation}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--operation", required=True)
    args = parser.parse_args()
    return asyncio.run(_run(operation=args.operation, payload=read_json_stdin()))


if __name__ == "__main__":
    raise SystemExit(main())
