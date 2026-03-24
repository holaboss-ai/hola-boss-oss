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


@dataclass
class RemoteBridgeState:
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


def remote_bridge_state_for_app(app: Any) -> RemoteBridgeState:
    state = getattr(app.state, "remote_bridge_state", None)
    if state is None:
        state = RemoteBridgeState(stop_event=asyncio.Event())
        app.state.remote_bridge_state = state
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
    remote_bridge_enabled: Callable[[], bool],
    create_remote_bridge_runner: Callable[[asyncio.Event], Awaitable[Any]],
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

    bridge_state = remote_bridge_state_for_app(app)
    bridge_state.stop_event.clear()
    if remote_bridge_enabled() and (bridge_state.task is None or bridge_state.task.done()):
        bridge_state.task = asyncio.create_task(create_remote_bridge_runner(bridge_state.stop_event))
    elif not remote_bridge_enabled():
        logger.info("Remote proactive bridge disabled in local runtime")


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

    bridge_state = remote_bridge_state_for_app(app)
    bridge_state.stop_event.set()
    bridge_task = bridge_state.task
    bridge_state.task = None
    if bridge_task is not None:
        bridge_task.cancel()
        with suppress(asyncio.CancelledError):
            await bridge_task
