from __future__ import annotations

from pathlib import Path
from typing import Any

from sandbox_agent_runtime.application_lifecycle import ApplicationLifecycleManager


async def start_resolved_applications_via_python_lifecycle(
    *,
    workspace_id: str,
    workspace_dir: Path,
    holaboss_user_id: str,
    resolved_applications: tuple[Any, ...],
) -> tuple[dict[str, Any], ...]:
    lifecycle_manager = ApplicationLifecycleManager(
        workspace_dir=workspace_dir,
        holaboss_user_id=holaboss_user_id,
    )
    await lifecycle_manager.start_all(list(resolved_applications))
    return tuple(
        {
            "name": app.app_id,
            "config": {
                "type": "remote",
                "url": lifecycle_manager.get_mcp_url(app),
                "enabled": True,
                "headers": {"X-Workspace-Id": workspace_id},
                "timeout": app.health_check.timeout_s * 1000,
            },
        }
        for app in resolved_applications
    )
