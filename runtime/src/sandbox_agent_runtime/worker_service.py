from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Protocol


class LocalWorkerStateLike(Protocol):
    stop_event: asyncio.Event
    wake_event: asyncio.Event


async def process_available_inputs_once(
    *,
    claim_inputs: Callable[..., list[Any]],
    process_claimed_input: Callable[[Any], Awaitable[None]],
    claim_limit: int = 1,
    claimed_by: str = "sandbox-agent-local-worker",
    lease_seconds: int = 300,
) -> int:
    claimed = claim_inputs(limit=claim_limit, claimed_by=claimed_by, lease_seconds=lease_seconds)
    if not claimed:
        return 0
    for record in claimed:
        await process_claimed_input(record)
    return len(claimed)


async def local_worker_loop(
    *,
    state: LocalWorkerStateLike,
    process_available_inputs_once: Callable[[], Awaitable[int]],
    idle_timeout_seconds: float = 1.0,
) -> None:
    while not state.stop_event.is_set():
        processed = await process_available_inputs_once()
        if processed > 0:
            continue
        state.wake_event.clear()
        try:
            await asyncio.wait_for(state.wake_event.wait(), timeout=idle_timeout_seconds)
        except TimeoutError:
            continue
