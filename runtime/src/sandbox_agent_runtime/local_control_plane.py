from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Awaitable, Callable


@dataclass
class LocalWorkerState:
    stop_event: asyncio.Event
    wake_event: asyncio.Event
    task: asyncio.Task[Any] | None = None


@dataclass
class CronSchedulerState:
    stop_event: asyncio.Event
    task: asyncio.Task[Any] | None = None


def local_worker_state_for_app(app: Any) -> LocalWorkerState:
    state = getattr(app.state, "local_worker_state", None)
    if state is None:
        state = LocalWorkerState(stop_event=asyncio.Event(), wake_event=asyncio.Event())
        app.state.local_worker_state = state
    return state


def cron_scheduler_state_for_app(app: Any) -> CronSchedulerState:
    state = getattr(app.state, "cron_scheduler_state", None)
    if state is None:
        state = CronSchedulerState(stop_event=asyncio.Event())
        app.state.cron_scheduler_state = state
    return state


def wake_local_worker_for_app(app: Any) -> None:
    local_worker_state_for_app(app).wake_event.set()


async def startup_local_control_plane(
    *,
    app: Any,
    local_worker_loop: Callable[[], Awaitable[None]],
    cron_scheduler_loop: Callable[[], Awaitable[None]],
    local_worker_enabled: Callable[[], bool],
    cron_scheduler_enabled: Callable[[], bool],
    logger: Any,
) -> None:
    if local_worker_enabled():
        state = local_worker_state_for_app(app)
        state.stop_event.clear()
        if state.task is None or state.task.done():
            state.task = asyncio.create_task(local_worker_loop())

    if cron_scheduler_enabled():
        cron_state = cron_scheduler_state_for_app(app)
        cron_state.stop_event.clear()
        if cron_state.task is None or cron_state.task.done():
            cron_state.task = asyncio.create_task(cron_scheduler_loop())
    logger.info("Python proactive bridge fallback disabled; TS bridge worker owns remote bridge execution")


async def shutdown_local_control_plane(
    *,
    app: Any,
    shutdown_managed_ts_api_server: Callable[[], Awaitable[None]],
) -> None:
    await shutdown_managed_ts_api_server()

    state = getattr(app.state, "local_worker_state", None)
    if state is not None:
        state.stop_event.set()
        state.wake_event.set()
        task = state.task
        state.task = None
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    cron_state = getattr(app.state, "cron_scheduler_state", None)
    if cron_state is not None:
        cron_state.stop_event.set()
        cron_task = cron_state.task
        cron_state.task = None
        if cron_task is not None:
            cron_task.cancel()
            with suppress(asyncio.CancelledError):
                await cron_task
