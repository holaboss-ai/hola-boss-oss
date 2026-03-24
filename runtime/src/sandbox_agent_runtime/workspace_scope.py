from __future__ import annotations

import os
import re
import shlex
from typing import Any


def _resolve_sandbox_root() -> str:
    raw = (os.getenv("HB_SANDBOX_ROOT") or "").strip()
    if not raw:
        return "/holaboss"
    normalized = raw.rstrip("/")
    return normalized or "/holaboss"


SANDBOX_ROOT = _resolve_sandbox_root()
WORKSPACE_ROOT = f"{SANDBOX_ROOT}/workspace"
_WORKSPACE_SEGMENT_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_DYNAMIC_SHELL_MARKERS = ("$(", "${", "$", "`", "~/")
_STATUS_PATH_KEYS = {"root_path", "workspace_path"}
_ABSOLUTE_PATH_PATTERN = re.compile(r"(?<![:/A-Za-z0-9_])/(?:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*)")


def sanitize_workspace_id(workspace_id: str) -> str:
    value = workspace_id.strip()
    if not value:
        raise ValueError("workspace_id is required")
    if "/" in value or "\\" in value:
        raise ValueError("workspace_id must not contain path separators")
    if not _WORKSPACE_SEGMENT_PATTERN.fullmatch(value):
        raise ValueError("workspace_id contains invalid characters")
    return value


def sanitize_app_id(app_id: str) -> str:
    """Validate app_id contains only safe characters (same rules as workspace_id)."""
    value = app_id.strip()
    if not value:
        raise ValueError("app_id is required")
    if "/" in value or "\\" in value:
        raise ValueError("app_id must not contain path separators")
    if not _WORKSPACE_SEGMENT_PATTERN.fullmatch(value):
        raise ValueError("app_id contains invalid characters")
    return value


def workspace_dir_for_id(workspace_id: str) -> str:
    segment = sanitize_workspace_id(workspace_id)
    return f"{WORKSPACE_ROOT}/{segment}"


def validate_workspace_command(command: str, workspace_id: str) -> None:
    if not command.strip():
        raise ValueError("command cannot be empty")

    for marker in _DYNAMIC_SHELL_MARKERS:
        if marker in command:
            raise ValueError(f"command contains unsupported shell expansion marker {marker!r}")

    try:
        tokens = shlex.split(command, posix=True)
    except ValueError as exc:
        raise ValueError(f"command could not be parsed safely: {exc}") from exc

    allowed_dir = workspace_dir_for_id(workspace_id)
    for path_literal in _ABSOLUTE_PATH_PATTERN.findall(command):
        if path_literal == allowed_dir or path_literal.startswith(f"{allowed_dir}/"):
            continue
        raise ValueError("command references absolute paths outside the active workspace")

    for token in tokens:
        normalized = _normalize_path_token(token)
        if _contains_parent_traversal(normalized):
            raise ValueError("command contains parent traversal path segments")
        if not normalized.startswith("/"):
            continue
        if normalized == allowed_dir or normalized.startswith(f"{allowed_dir}/"):
            continue
        raise ValueError("command references absolute paths outside the active workspace")


def build_workspace_scoped_command(command: str, workspace_id: str) -> str:
    validate_workspace_command(command=command, workspace_id=workspace_id)
    workspace_segment = sanitize_workspace_id(workspace_id)
    quoted_workspace_segment = shlex.quote(workspace_segment)
    return f"cd {WORKSPACE_ROOT} && mkdir -p {quoted_workspace_segment} && cd {quoted_workspace_segment} && {command}"


def redact_status_paths(status_payload: Any) -> Any:
    if not isinstance(status_payload, dict):
        return status_payload
    metadata = status_payload.get("metadata")
    if not isinstance(metadata, dict):
        return status_payload

    redacted_metadata = {key: value for key, value in metadata.items() if key not in _STATUS_PATH_KEYS}
    redacted_payload = dict(status_payload)
    redacted_payload["metadata"] = redacted_metadata
    return redacted_payload


def _normalize_path_token(token: str) -> str:
    value = token.strip().lstrip("<>").strip(",;")
    if not value:
        return value
    if "://" in value:
        return value

    if value.startswith("--") and "=" in value:
        value = value.split("=", 1)[1]
    elif "=" in value:
        key, maybe_path = value.split("=", 1)
        if key and all(char.isalnum() or char in {"_", "-"} for char in key):
            value = maybe_path

    return value.strip().strip(",;")


def _contains_parent_traversal(path_fragment: str) -> bool:
    if not path_fragment:
        return False
    return (
        path_fragment == ".."
        or path_fragment.startswith("../")
        or path_fragment.endswith("/..")
        or "/../" in path_fragment
    )


__all__ = [
    "SANDBOX_ROOT",
    "WORKSPACE_ROOT",
    "build_workspace_scoped_command",
    "redact_status_paths",
    "sanitize_app_id",
    "sanitize_workspace_id",
    "validate_workspace_command",
    "workspace_dir_for_id",
]
