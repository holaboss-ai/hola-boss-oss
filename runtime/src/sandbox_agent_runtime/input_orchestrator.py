from __future__ import annotations

from typing import Any, Awaitable, Callable, Protocol

from sandbox_agent_runtime.runner import RunnerOutputEvent, RunnerRequest


class RunnerExecutionResultLike(Protocol):
    skipped_lines: list[str]
    stderr: str
    return_code: int
    saw_terminal: bool


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
    execute_runner_request: Callable[
        [RunnerRequest, Callable[[RunnerOutputEvent], Awaitable[None]] | None],
        Awaitable[RunnerExecutionResultLike],
    ],
    append_output_event: Callable[..., Any],
    insert_session_message: Callable[..., Any],
    build_run_failed_event: Callable[..., RunnerOutputEvent],
) -> None:
    workspace = get_workspace(record.workspace_id)
    if workspace is None:
        update_input(record.input_id, status="FAILED")
        update_runtime_state(
            workspace_id=record.workspace_id,
            session_id=record.session_id,
            status="ERROR",
            current_input_id=None,
            last_error={"message": "workspace not found"},
        )
        return

    harness = (workspace.harness or selected_harness()).strip().lower() or selected_harness()
    harness_session_id = ensure_local_binding(
        workspace_id=record.workspace_id,
        session_id=record.session_id,
        harness=harness,
    )
    instruction = build_onboarding_instruction(
        workspace_id=record.workspace_id,
        session_id=record.session_id,
        text=str(record.payload.get("text") or ""),
        workspace=workspace,
    )
    update_runtime_state(
        workspace_id=record.workspace_id,
        session_id=record.session_id,
        status="BUSY",
        current_input_id=record.input_id,
        current_worker_id="sandbox-agent-local-worker",
        heartbeat_at=None,
        last_error=None,
    )

    runtime_context = dict(record.payload.get("context") or {})
    prior_runtime_context = dict(runtime_context.get(runtime_exec_context_key) or {})
    runtime_binding = resolve_product_runtime_config(
        require_auth=False,
        require_user=False,
        require_base_url=False,
    )
    if (
        not str(prior_runtime_context.get(runtime_exec_model_proxy_api_key_key) or "").strip()
        and runtime_binding.auth_token
    ):
        prior_runtime_context[runtime_exec_model_proxy_api_key_key] = runtime_binding.auth_token
    if (
        not str(prior_runtime_context.get(runtime_exec_sandbox_id_key) or "").strip()
        and runtime_binding.sandbox_id
    ):
        prior_runtime_context[runtime_exec_sandbox_id_key] = runtime_binding.sandbox_id
    prior_runtime_context["harness"] = harness
    prior_runtime_context["harness_session_id"] = harness_session_id
    runtime_context[runtime_exec_context_key] = prior_runtime_context

    payload = RunnerRequest(
        workspace_id=record.workspace_id,
        session_id=record.session_id,
        input_id=record.input_id,
        instruction=instruction,
        context=runtime_context,
        model=str(record.payload.get("model")) if record.payload.get("model") is not None else None,
        debug=False,
    )

    assistant_parts: list[str] = []
    try:
        terminal_status = "WAITING_USER"
        last_error: dict[str, Any] | None = None
        last_sequence = 0

        async def _handle_event(event: RunnerOutputEvent) -> None:
            nonlocal terminal_status, last_error, last_sequence
            event_sequence = int(event.sequence)
            last_sequence = max(last_sequence, event_sequence)
            append_output_event(
                workspace_id=record.workspace_id,
                session_id=record.session_id,
                input_id=record.input_id,
                sequence=event_sequence,
                event_type=event.event_type,
                payload=event.payload,
                created_at=event.timestamp.isoformat(),
            )
            if event.event_type == "output_delta":
                delta = event.payload.get("delta")
                if isinstance(delta, str):
                    assistant_parts.append(delta)
            if event.event_type == "run_failed":
                terminal_status = "ERROR"
                last_error = event.payload

        execution = await execute_runner_request(payload, on_event=_handle_event)
        if not execution.saw_terminal:
            if execution.return_code != 0:
                failure_event = build_run_failed_event(
                    session_id=record.session_id,
                    input_id=record.input_id,
                    sequence=last_sequence + 1,
                    message=execution.stderr.strip()
                    or f"runner command failed with exit_code={execution.return_code}",
                    error_type="RunnerCommandError",
                )
            else:
                details = "; ".join(execution.skipped_lines[:3]) if execution.skipped_lines else ""
                suffix = f" (skipped output: {details})" if details else ""
                failure_event = build_run_failed_event(
                    session_id=record.session_id,
                    input_id=record.input_id,
                    sequence=last_sequence + 1,
                    message=f"runner ended before terminal event{suffix}",
                )
            await _handle_event(failure_event)

        update_input(record.input_id, status="DONE" if terminal_status != "ERROR" else "FAILED", claimed_until=None)
        update_runtime_state(
            workspace_id=record.workspace_id,
            session_id=record.session_id,
            status=terminal_status,
            current_input_id=None,
            current_worker_id=None,
            heartbeat_at=None,
            last_error=last_error,
        )
        assistant_text = "".join(assistant_parts).strip()
        if assistant_text:
            insert_session_message(
                workspace_id=record.workspace_id,
                session_id=record.session_id,
                role="assistant",
                text=assistant_text,
                message_id=f"assistant-{record.input_id}",
            )
    except Exception as exc:
        update_input(record.input_id, status="FAILED", claimed_until=None)
        failure_payload = {"message": str(exc)}
        append_output_event(
            workspace_id=record.workspace_id,
            session_id=record.session_id,
            input_id=record.input_id,
            sequence=1,
            event_type="run_failed",
            payload=failure_payload,
        )
        update_runtime_state(
            workspace_id=record.workspace_id,
            session_id=record.session_id,
            status="ERROR",
            current_input_id=None,
            current_worker_id=None,
            heartbeat_at=None,
            last_error=failure_payload,
        )
