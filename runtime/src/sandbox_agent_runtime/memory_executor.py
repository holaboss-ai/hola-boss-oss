from __future__ import annotations

import argparse
from typing import Any

from pydantic import ValidationError

from sandbox_agent_runtime.api_models import (
    MemoryGetRequest,
    MemorySearchRequest,
    MemoryStatusRequest,
    MemorySyncRequest,
    MemoryUpsertRequest,
)
from sandbox_agent_runtime.executor_io import print_envelope, read_json_stdin
from sandbox_agent_runtime.memory.operations import (
    memory_get,
    memory_search,
    memory_status,
    memory_sync,
    memory_upsert,
)


def _run(*, operation: str, payload: dict[str, Any]) -> int:
    try:
        if operation == "search":
            request = MemorySearchRequest.model_validate(payload)
            result = memory_search(
                workspace_id=request.workspace_id,
                query=request.query,
                max_results=request.max_results,
                min_score=request.min_score,
            )
        elif operation == "get":
            request = MemoryGetRequest.model_validate(payload)
            try:
                result = memory_get(
                    workspace_id=request.workspace_id,
                    path=request.path,
                    from_line=request.from_line,
                    lines=request.lines,
                )
            except FileNotFoundError:
                result = {"path": request.path, "text": ""}
        elif operation == "upsert":
            request = MemoryUpsertRequest.model_validate(payload)
            result = memory_upsert(
                workspace_id=request.workspace_id,
                path=request.path,
                content=request.content,
                append=request.append,
            )
        elif operation == "status":
            request = MemoryStatusRequest.model_validate(payload)
            result = memory_status(workspace_id=request.workspace_id)
        elif operation == "sync":
            request = MemorySyncRequest.model_validate(payload)
            result = memory_sync(
                workspace_id=request.workspace_id,
                reason=request.reason,
                force=request.force,
            )
        else:
            print_envelope(status_code=400, detail=f"unsupported memory operation: {operation}")
            return 0
    except (ValidationError, ValueError) as exc:
        print_envelope(status_code=400, detail=str(exc))
        return 0
    except Exception as exc:
        print_envelope(status_code=400, detail=str(exc))
        return 0

    print_envelope(status_code=200, payload=result)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--operation", required=True)
    args = parser.parse_args()
    return _run(operation=args.operation, payload=read_json_stdin())


if __name__ == "__main__":
    raise SystemExit(main())
