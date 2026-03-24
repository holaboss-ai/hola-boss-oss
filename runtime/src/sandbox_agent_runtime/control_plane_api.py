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

TS_QUEUE_WORKER_FLAG_ENV = "HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER"
TS_CRON_WORKER_FLAG_ENV = "HOLABOSS_RUNTIME_USE_TS_CRON_WORKER"
TS_BRIDGE_WORKER_FLAG_ENV = "HOLABOSS_RUNTIME_USE_TS_BRIDGE_WORKER"
PROACTIVE_ENABLE_REMOTE_BRIDGE_ENV = "PROACTIVE_ENABLE_REMOTE_BRIDGE"


def local_worker_state(app: FastAPI) -> LocalWorkerState:
    return local_worker_state_for_app(app)


def cron_scheduler_state(app: FastAPI) -> CronSchedulerState:
    return cron_scheduler_state_for_app(app)


def _bridge_enabled() -> bool:
    raw = (os.getenv(PROACTIVE_ENABLE_REMOTE_BRIDGE_ENV) or "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


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
    if not _bridge_enabled():
        return False
    if raw in {"0", "false", "no", "off"}:
        return False
    return True


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
    await startup_local_control_plane(
        app=app,
        local_worker_loop=local_worker_loop,
        cron_scheduler_loop=cron_scheduler_loop,
        local_worker_enabled=lambda: python_queue_worker_enabled(ts_api_server_enabled=ts_api_server_enabled),
        cron_scheduler_enabled=lambda: python_cron_worker_enabled(ts_api_server_enabled=ts_api_server_enabled),
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
