from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import HTTPException

from sandbox_agent_runtime.input_orchestrator import (
    process_claimed_input as _process_claimed_input_impl,
)
from sandbox_agent_runtime.product_config import resolve_product_runtime_config
from sandbox_agent_runtime.runner_backend import (
    build_run_failed_event,
    execute_runner_request,
)
from sandbox_agent_runtime.runtime_local_state import (
    append_output_event,
    get_binding,
    get_workspace,
    insert_session_message,
    update_input,
    update_runtime_state,
    upsert_binding,
)
from sandbox_agent_runtime.workspace_scope import WORKSPACE_ROOT

DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE = (
    "cd {runtime_app_root} && {runtime_python} -m sandbox_agent_runtime.runner --request-base64 {request_base64}"
)
ONBOARD_PROMPT_HEADER = "[Holaboss Workspace Onboarding v1]"
RUNTIME_EXEC_CONTEXT_KEY = "_sandbox_runtime_exec_v1"
RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY = "model_proxy_api_key"
RUNTIME_EXEC_SANDBOX_ID_KEY = "sandbox_id"


def selected_harness() -> str:
    import os

    configured = (os.getenv("SANDBOX_AGENT_HARNESS") or "").strip().lower()
    if configured:
        return configured
    return "opencode"


def build_onboarding_instruction(*, workspace_id: str, session_id: str, text: str, workspace: Any) -> str:
    trimmed = text.strip()
    if not trimmed:
        raise HTTPException(status_code=422, detail="text is required")
    onboarding_status = (workspace.onboarding_status or "").strip().lower()
    onboarding_session_id = (workspace.onboarding_session_id or "").strip()
    if onboarding_status not in {"pending", "awaiting_confirmation"} or onboarding_session_id != session_id:
        return trimmed

    onboard_path = Path(WORKSPACE_ROOT) / workspace_id / "ONBOARD.md"
    if not onboard_path.exists():
        return trimmed
    onboard_prompt = onboard_path.read_text(encoding="utf-8").strip()
    if not onboard_prompt or trimmed.startswith(ONBOARD_PROMPT_HEADER):
        return trimmed
    return "\n".join([
        ONBOARD_PROMPT_HEADER,
        "- You are in onboarding mode for this workspace.",
        f"- The workspace directory is ./{workspace_id} relative to the current working directory.",
        f"- The onboarding guide file is ./{workspace_id}/ONBOARD.md (absolute path: {onboard_path}).",
        "- Use that workspace-scoped ONBOARD.md to drive the conversation and gather required details.",
        "- ONBOARD.md content is already included below; do not re-read it unless needed.",
        f"- If file reads are needed, use ./{workspace_id}/... paths rather than files directly under {WORKSPACE_ROOT}.",
        "- Ask concise questions and collect durable facts/preferences.",
        "- Do not start regular execution work until onboarding is complete.",
        "- When all onboarding requirements are satisfied and the user confirms, invoke the `hb` CLI tool with `onboarding request-complete`.",
        "- Do not merely output or quote the command as text; actually execute the tool.",
        "",
        "[ONBOARD.md]",
        onboard_prompt,
        "[/ONBOARD.md]",
        "",
        trimmed,
    ]).strip()


def ensure_local_binding(*, workspace_id: str, session_id: str, harness: str) -> str:
    existing = get_binding(workspace_id=workspace_id, session_id=session_id)
    if existing is not None and existing.harness_session_id.strip():
        return existing.harness_session_id
    binding = upsert_binding(
        workspace_id=workspace_id,
        session_id=session_id,
        harness=harness,
        harness_session_id=session_id,
    )
    return binding.harness_session_id


async def execute_local_runner_request(payload, *, on_event=None):
    return await execute_runner_request(
        payload,
        on_event=on_event,
        default_command_template=DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE,
    )


async def process_claimed_input(record) -> None:
    await _process_claimed_input_impl(
        record,
        get_workspace=get_workspace,
        update_input=update_input,
        update_runtime_state=update_runtime_state,
        selected_harness=selected_harness,
        ensure_local_binding=ensure_local_binding,
        build_onboarding_instruction=build_onboarding_instruction,
        resolve_product_runtime_config=resolve_product_runtime_config,
        runtime_exec_context_key=RUNTIME_EXEC_CONTEXT_KEY,
        runtime_exec_model_proxy_api_key_key=RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY,
        runtime_exec_sandbox_id_key=RUNTIME_EXEC_SANDBOX_ID_KEY,
        execute_runner_request=execute_local_runner_request,
        append_output_event=append_output_event,
        insert_session_message=insert_session_message,
        build_run_failed_event=build_run_failed_event,
    )
