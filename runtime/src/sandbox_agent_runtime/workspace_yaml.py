"""Helpers for reading and modifying workspace.yaml."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def read_workspace_yaml(workspace_dir: str | Path) -> str | None:
    """Read workspace.yaml content, return None if missing."""
    path = Path(workspace_dir) / "workspace.yaml"
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")


def write_workspace_yaml(workspace_dir: str | Path, content: str) -> None:
    """Write workspace.yaml content."""
    path = Path(workspace_dir) / "workspace.yaml"
    path.write_text(content, encoding="utf-8")


def parse_workspace_yaml(content: str | None) -> dict[str, Any]:
    """Parse workspace.yaml content into dict, return empty dict if None."""
    if not content:
        return {}
    loaded = yaml.safe_load(content)
    return loaded if isinstance(loaded, dict) else {}


def append_application(
    workspace_yaml: str | None,
    *,
    app_id: str,
    config_path: str,
    lifecycle: dict[str, str] | None = None,
) -> str:
    """Add an application entry to workspace.yaml. Returns updated YAML string."""
    data = parse_workspace_yaml(workspace_yaml)
    apps = data.get("applications", [])
    if not isinstance(apps, list):
        apps = []

    # Don't duplicate
    if any(a.get("app_id") == app_id for a in apps if isinstance(a, dict)):
        return yaml.dump(data, default_flow_style=False, sort_keys=False)

    entry: dict[str, Any] = {"app_id": app_id, "config_path": config_path}
    if lifecycle:
        entry["lifecycle"] = lifecycle
    apps.append(entry)
    data["applications"] = apps
    return yaml.dump(data, default_flow_style=False, sort_keys=False)


def remove_application(workspace_yaml: str | None, *, app_id: str) -> str:
    """Remove an application entry from workspace.yaml. Returns updated YAML string."""
    data = parse_workspace_yaml(workspace_yaml)
    apps = data.get("applications", [])
    if isinstance(apps, list):
        data["applications"] = [
            a for a in apps if not (isinstance(a, dict) and a.get("app_id") == app_id)
        ]
    return yaml.dump(data, default_flow_style=False, sort_keys=False)


def list_application_ids(workspace_yaml: str | None) -> list[str]:
    """Extract app_id list from workspace.yaml."""
    data = parse_workspace_yaml(workspace_yaml)
    apps = data.get("applications", [])
    if not isinstance(apps, list):
        return []
    return [a["app_id"] for a in apps if isinstance(a, dict) and "app_id" in a]
