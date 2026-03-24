from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable, Protocol
from uuid import uuid4

from croniter import croniter

from sandbox_agent_runtime.input_orchestrator import (
    process_claimed_input as _process_claimed_input_impl,
)


class CronSchedulerStateLike(Protocol):
    stop_event: asyncio.Event


async def process_claimed_input(
    record: Any,
    *,
    get_workspace: Callable[[str], Any | None],
    update_input: Callable[..., Any],
    update_runtime_state: Callable[..., Any],
    selected_harness: Callable[[], str],
    ensure_local_binding: Callable[..., str],
    build_onboarding_instruction: Callable[..., str],
    resolve_product_runtime_config: Callable[..., Any],
    runtime_exec_context_key: str,
    runtime_exec_model_proxy_api_key_key: str,
    runtime_exec_sandbox_id_key: str,
    execute_runner_request: Callable[..., Awaitable[Any]],
    append_output_event: Callable[..., Any],
    insert_session_message: Callable[..., Any],
    build_run_failed_event: Callable[..., Any],
) -> None:
    await _process_claimed_input_impl(
        record,
        get_workspace=get_workspace,
        update_input=update_input,
        update_runtime_state=update_runtime_state,
        selected_harness=selected_harness,
        ensure_local_binding=ensure_local_binding,
        build_onboarding_instruction=build_onboarding_instruction,
        resolve_product_runtime_config=resolve_product_runtime_config,
        runtime_exec_context_key=runtime_exec_context_key,
        runtime_exec_model_proxy_api_key_key=runtime_exec_model_proxy_api_key_key,
        runtime_exec_sandbox_id_key=runtime_exec_sandbox_id_key,
        execute_runner_request=execute_runner_request,
        append_output_event=append_output_event,
        insert_session_message=insert_session_message,
        build_run_failed_event=build_run_failed_event,
    )
def cronjob_check_interval_seconds() -> int:
    raw = (os.getenv("CRONJOB_RUNNER_CHECK_INTERVAL_SECONDS") or "60").strip()
    try:
        value = int(raw)
    except ValueError:
        return 60
    return max(5, value)


def cronjob_next_run_at(*, cron_expression: str, now: datetime) -> str | None:
    try:
        return croniter(cron_expression, now).get_next(datetime).astimezone(UTC).isoformat()
    except Exception:
        return None


def cronjob_is_due(job: dict[str, Any], *, now: datetime) -> bool:
    if not bool(job.get("enabled")):
        return False
    try:
        last_scheduled = croniter(str(job["cron"]), now).get_prev(datetime)
    except Exception:
        return False
    last_run_at_raw = job.get("last_run_at")
    if last_run_at_raw is None:
        return True
    try:
        normalized = str(last_run_at_raw).replace("Z", "+00:00")
        last_run_at = datetime.fromisoformat(normalized)
        if last_run_at.tzinfo is None:
            last_run_at = last_run_at.replace(tzinfo=UTC)
    except Exception:
        return True
    return last_run_at < last_scheduled


def cronjob_instruction(*, description: str, metadata: dict[str, Any]) -> str:
    cleaned_description = description.strip()
    execution_metadata = {
        key: value
        for key, value in (metadata or {}).items()
        if key not in {"model", "session_id", "priority", "idempotency_key"}
    }
    if not execution_metadata:
        return cleaned_description
    return f"{cleaned_description}\n\n[Cronjob Metadata]\n{execution_metadata}"


def queue_local_cronjob_run(
    job: dict[str, Any],
    *,
    now: datetime,
    get_workspace: Callable[[str], Any | None],
    ensure_runtime_state: Callable[..., Any],
    enqueue_input: Callable[..., Any],
    insert_session_message: Callable[..., Any],
    update_runtime_state: Callable[..., Any],
    wake_worker: Callable[[], None],
) -> None:
    workspace_id = str(job["workspace_id"])
    workspace = get_workspace(workspace_id)
    if workspace is None:
        raise RuntimeError(f"workspace not found for cronjob {job['id']}")
    metadata = job.get("metadata")
    resolved_metadata = metadata if isinstance(metadata, dict) else {}
    resolved_session_id = str(resolved_metadata.get("session_id") or uuid4())
    model = resolved_metadata.get("model")
    priority = resolved_metadata.get("priority") if isinstance(resolved_metadata.get("priority"), int) else 0
    idempotency_key = resolved_metadata.get("idempotency_key")
    ensure_runtime_state(
        workspace_id=workspace_id,
        session_id=resolved_session_id,
        status="QUEUED",
    )
    instruction = cronjob_instruction(description=str(job["description"]), metadata=resolved_metadata)
    record = enqueue_input(
        workspace_id=workspace_id,
        session_id=resolved_session_id,
        priority=priority,
        idempotency_key=idempotency_key if isinstance(idempotency_key, str) else None,
        payload={
            "text": instruction,
            "image_urls": [],
            "model": model if isinstance(model, str) else None,
            "context": {
                "source": "cronjob",
                "cronjob_id": str(job["id"]),
            },
        },
    )
    insert_session_message(
        workspace_id=workspace_id,
        session_id=resolved_session_id,
        role="user",
        text=instruction,
        message_id=f"cronjob-{job['id']}-{record.input_id}",
    )
    update_runtime_state(
        workspace_id=workspace_id,
        session_id=resolved_session_id,
        status="QUEUED",
        current_input_id=record.input_id,
        current_worker_id=None,
        lease_until=None,
        heartbeat_at=now.isoformat(),
        last_error=None,
    )
    wake_worker()


async def cron_scheduler_loop(
    *,
    state: CronSchedulerStateLike,
    logger: Any,
    list_cronjobs: Callable[..., list[dict[str, Any]]],
    cronjob_is_due: Callable[..., bool],
    queue_local_cronjob_run: Callable[..., None],
    update_cronjob: Callable[..., Any],
    cronjob_next_run_at: Callable[..., str | None],
    interval: int,
) -> None:
    while not state.stop_event.is_set():
        now = datetime.now(UTC)
        for job in list_cronjobs(enabled_only=True):
            if not cronjob_is_due(job, now=now):
                continue
            status = "success"
            error: str | None = None
            try:
                delivery = job.get("delivery")
                channel = delivery.get("channel") if isinstance(delivery, dict) else None
                if channel == "session_run":
                    queue_local_cronjob_run(job, now=now)
                elif channel == "system_notification":
                    logger.info(
                        "Cronjob system_notification delivery is currently a no-op placeholder",
                        extra={
                            "event": "cronjob.delivery.system_notification",
                            "outcome": "noop",
                            "cronjob_id": str(job["id"]),
                            "workspace_id": str(job["workspace_id"]),
                        },
                    )
                else:
                    raise ValueError(f"unsupported cronjob delivery channel: {channel}")
            except Exception as exc:
                status = "failed"
                error = str(exc)
                logger.exception(
                    "Cronjob execution failed",
                    extra={
                        "event": "cronjob.execution",
                        "outcome": "error",
                        "cronjob_id": str(job["id"]),
                        "workspace_id": str(job["workspace_id"]),
                    },
                )
            update_cronjob(
                job_id=str(job["id"]),
                last_run_at=now.isoformat(),
                next_run_at=cronjob_next_run_at(cron_expression=str(job["cron"]), now=now),
                run_count=int(job.get("run_count") or 0) + (1 if status == "success" else 0),
                last_status=status,
                last_error=error,
            )
        try:
            await asyncio.wait_for(state.stop_event.wait(), timeout=interval)
        except TimeoutError:
            continue
