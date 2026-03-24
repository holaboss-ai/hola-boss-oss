from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException

from sandbox_agent_runtime.api_models import (
    MemoryGetRequest,
    MemorySearchRequest,
    MemoryStatusRequest,
    MemorySyncRequest,
    MemoryUpsertRequest,
)
from sandbox_agent_runtime.memory.operations import (
    memory_get,
    memory_search,
    memory_status,
    memory_sync,
    memory_upsert,
)


def register_memory_routes(app: FastAPI) -> None:
    @app.post("/api/v1/memory/search")
    async def memory_search_endpoint(payload: MemorySearchRequest) -> dict[str, Any]:
        try:
            return memory_search(
                workspace_id=payload.workspace_id,
                query=payload.query,
                max_results=payload.max_results,
                min_score=payload.min_score,
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/v1/memory/get")
    async def memory_get_endpoint(payload: MemoryGetRequest) -> dict[str, Any]:
        try:
            return memory_get(
                workspace_id=payload.workspace_id,
                path=payload.path,
                from_line=payload.from_line,
                lines=payload.lines,
            )
        except FileNotFoundError:
            return {"path": payload.path, "text": ""}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/v1/memory/upsert")
    async def memory_upsert_endpoint(payload: MemoryUpsertRequest) -> dict[str, Any]:
        try:
            return memory_upsert(
                workspace_id=payload.workspace_id,
                path=payload.path,
                content=payload.content,
                append=payload.append,
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/v1/memory/status")
    async def memory_status_endpoint(payload: MemoryStatusRequest) -> dict[str, Any]:
        try:
            return memory_status(workspace_id=payload.workspace_id)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/v1/memory/sync")
    async def memory_sync_endpoint(payload: MemorySyncRequest) -> dict[str, Any]:
        try:
            return memory_sync(
                workspace_id=payload.workspace_id,
                reason=payload.reason,
                force=payload.force,
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
