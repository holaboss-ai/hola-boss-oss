from __future__ import annotations

import asyncio
import os
from pathlib import Path

from sandbox_agent_runtime.api_models import ShutdownResult
from sandbox_agent_runtime.executor_io import print_envelope
from sandbox_agent_runtime.lifecycle_api import (
    _find_lifecycle_compose_command,
    _resolve_apps_from_workspace_yaml,
)
from sandbox_agent_runtime.workspace_scope import WORKSPACE_ROOT


async def _run() -> int:
    stopped: list[str] = []
    failed: list[str] = []

    workspace_root = Path(WORKSPACE_ROOT)
    if not workspace_root.is_dir():
        print_envelope(
            status_code=200,
            payload=ShutdownResult(stopped=stopped, failed=failed).model_dump(mode="json"),
        )
        return 0

    for workspace_dir in workspace_root.iterdir():
        if not workspace_dir.is_dir():
            continue
        workspace_yaml = workspace_dir / "workspace.yaml"
        if not workspace_yaml.exists():
            continue

        try:
            apps = _resolve_apps_from_workspace_yaml(workspace_yaml)
        except Exception:
            continue

        for app_id, app_dir in apps:
            compose_file = app_dir / "docker-compose.yml"
            compose_file_yaml = app_dir / "docker-compose.yaml"
            if not (compose_file.exists() or compose_file_yaml.exists()):
                continue
            try:
                compose_cmd = await _find_lifecycle_compose_command()
                if compose_cmd is None:
                    continue
                proc = await asyncio.create_subprocess_exec(
                    *compose_cmd,
                    "down",
                    "--remove-orphans",
                    cwd=str(app_dir),
                    env={**os.environ},
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                returncode = await proc.wait()
                if returncode == 0:
                    stopped.append(app_id)
                else:
                    failed.append(app_id)
            except Exception:
                failed.append(app_id)

    print_envelope(
        status_code=200,
        payload=ShutdownResult(stopped=stopped, failed=failed).model_dump(mode="json"),
    )
    return 0


def main() -> int:
    return asyncio.run(_run())


if __name__ == "__main__":
    raise SystemExit(main())
