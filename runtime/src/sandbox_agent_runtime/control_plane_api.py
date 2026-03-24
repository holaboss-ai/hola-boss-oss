from __future__ import annotations

import asyncio
import os
from logging import Logger

from fastapi import FastAPI

from sandbox_agent_runtime.local_control_plane import (
    CronSchedulerState,
    LocalWorkerState,
    cron_scheduler_state_for_app,
    local_worker_state_for_app,
    shutdown_local_control_plane,
    startup_local_control_plane,
)
from sandbox_agent_runtime.proactive_bridge import (
    HttpPollingLocalBridgeReceiver,
    LocalRuntimeProactiveBridgeExecutor,
    RemoteBridgeWorker,
    bridge_enabled,
    bridge_max_items,
    bridge_poll_interval_seconds,
)

TS_QUEUE_WORKER_FLAG_ENV = "HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER"
TS_CRON_WORKER_FLAG_ENV = "HOLABOSS_RUNTIME_USE_TS_CRON_WORKER"
TS_BRIDGE_WORKER_FLAG_ENV = "HOLABOSS_RUNTIME_USE_TS_BRIDGE_WORKER"


def local_worker_state(app: FastAPI) -> LocalWorkerState:
    return local_worker_state_for_app(app)


def cron_scheduler_state(app: FastAPI) -> CronSchedulerState:
    return cron_scheduler_state_for_app(app)


def ts_queue_worker_enabled(*, ts_api_server_enabled: bool) -> bool:
    raw = (os.getenv(TS_QUEUE_WORKER_FLAG_ENV) or "").strip().lower()
    if not ts_api_server_enabled:
        return False
    if raw in {"0", "false", "no", "off"}:
        return False
    return True


def python_queue_worker_enabled(*, ts_api_server_enabled: bool) -> bool:
    return not ts_queue_worker_enabled(ts_api_server_enabled=ts_api_server_enabled)


def ts_cron_worker_enabled(*, ts_api_server_enabled: bool) -> bool:
    raw = (os.getenv(TS_CRON_WORKER_FLAG_ENV) or "").strip().lower()
    if not ts_api_server_enabled:
        return False
    if raw in {"0", "false", "no", "off"}:
        return False
    return True


def python_cron_worker_enabled(*, ts_api_server_enabled: bool) -> bool:
    return not ts_cron_worker_enabled(ts_api_server_enabled=ts_api_server_enabled)


def ts_bridge_worker_enabled(*, ts_api_server_enabled: bool) -> bool:
    raw = (os.getenv(TS_BRIDGE_WORKER_FLAG_ENV) or "").strip().lower()
    if not ts_api_server_enabled:
        return False
    if not bridge_enabled():
        return False
    if raw in {"0", "false", "no", "off"}:
        return False
    return True


def python_bridge_worker_enabled(*, ts_api_server_enabled: bool) -> bool:
    return bridge_enabled() and not ts_bridge_worker_enabled(ts_api_server_enabled=ts_api_server_enabled)


def wake_local_worker(app: FastAPI, *, ts_queue_worker_enabled: bool) -> None:
    if ts_queue_worker_enabled:
        return
    local_worker_state(app).wake_event.set()


async def startup_worker_control_plane(
    *,
    app: FastAPI,
    local_worker_loop,
    cron_scheduler_loop,
    ts_api_server_enabled: bool,
    logger: Logger,
) -> None:
    async def _create_remote_bridge_runner(stop_event: asyncio.Event) -> None:
        receiver = HttpPollingLocalBridgeReceiver.from_environment()
        await RemoteBridgeWorker(
            receiver=receiver,
            executor=LocalRuntimeProactiveBridgeExecutor(),
            stop_event=stop_event,
            poll_interval_seconds=bridge_poll_interval_seconds(),
            max_items=bridge_max_items(),
        ).run_forever()

    await startup_local_control_plane(
        app=app,
        local_worker_loop=local_worker_loop,
        cron_scheduler_loop=cron_scheduler_loop,
        local_worker_enabled=lambda: python_queue_worker_enabled(ts_api_server_enabled=ts_api_server_enabled),
        cron_scheduler_enabled=lambda: python_cron_worker_enabled(ts_api_server_enabled=ts_api_server_enabled),
        remote_bridge_enabled=lambda: python_bridge_worker_enabled(ts_api_server_enabled=ts_api_server_enabled),
        create_remote_bridge_runner=_create_remote_bridge_runner,
        logger=logger,
    )


async def shutdown_worker_control_plane(
    *,
    app: FastAPI,
    shutdown_managed_ts_api_server,
) -> None:
    await shutdown_local_control_plane(
        app=app,
        shutdown_managed_ts_api_server=shutdown_managed_ts_api_server,
    )
