from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping, Sequence, TypeVar

_RUNTIME_NODE_BIN_ENV = "HOLABOSS_RUNTIME_NODE_BIN"
_RUNTIME_ROOT_ENV = "HOLABOSS_RUNTIME_ROOT"


def runtime_root_dir(module_file: str) -> Path:
    configured_root = (os.getenv(_RUNTIME_ROOT_ENV) or "").strip()
    if configured_root:
        return Path(configured_root).resolve()
    module_path = Path(module_file).resolve()
    packaged_root = module_path.parents[1]
    if any((packaged_root / package_name).is_dir() for package_name in ("api-server", "harness-host", "state-store")):
        return packaged_root
    return module_path.parents[2]


def package_root_dir(*, module_file: str, package_name: str) -> Path:
    return runtime_root_dir(module_file) / package_name


def runtime_node_bin(*, env_name: str = _RUNTIME_NODE_BIN_ENV) -> str:
    configured = (os.getenv(env_name) or "").strip()
    return configured or "node"


def encode_request_base64(payload_json: str) -> str:
    return base64.b64encode(payload_json.encode("utf-8")).decode("utf-8")


def encode_json_base64(payload: Any) -> str:
    return encode_request_base64(json.dumps(payload))


def ts_exec_command_from_json(
    *,
    node_bin: str,
    entry_path: Path,
    payload_json: str,
    operation: str | None = None,
) -> tuple[str, ...]:
    command: list[str] = [node_bin, str(entry_path)]
    if operation:
        command.append(operation)
    command.extend(["--request-base64", encode_request_base64(payload_json)])
    return tuple(command)


async def run_async_command_capture(
    command: Sequence[str],
    *,
    cwd: str,
    create_process: Callable[..., Awaitable[Any]],
) -> tuple[int, str, str]:
    process = await create_process(
        *command,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    stdout_text = stdout.decode("utf-8", errors="replace").strip()
    stderr_text = stderr.decode("utf-8", errors="replace").strip()
    return int(process.returncode), stdout_text, stderr_text


def command_error_detail(*, returncode: int, stdout_text: str, stderr_text: str, fallback: str) -> str:
    return stderr_text or stdout_text or fallback.format(returncode=returncode)


_T = TypeVar("_T")


def validate_json_output(
    stdout_text: str,
    *,
    parser: Callable[[str], _T],
    invalid_message: str,
) -> _T:
    try:
        return parser(stdout_text)
    except Exception as exc:
        raise RuntimeError(f"{invalid_message}: {exc}") from exc


def ts_cli_command(
    *,
    module_file: str,
    package_name: str,
    dist_entry: str,
    source_entry: str,
    operation: str,
    payload: Mapping[str, Any] | None = None,
    node_bin_env: str = _RUNTIME_NODE_BIN_ENV,
) -> tuple[list[str], Path] | None:
    package_root = package_root_dir(module_file=module_file, package_name=package_name)
    dist_path = package_root / dist_entry
    if dist_path.is_file():
        command = [runtime_node_bin(env_name=node_bin_env), str(dist_path), operation]
    else:
        source_path = package_root / source_entry
        if not source_path.is_file():
            return None
        command = [runtime_node_bin(env_name=node_bin_env), "--import", "tsx", str(source_path), operation]

    if payload is not None:
        encoded = base64.b64encode(json.dumps(dict(payload)).encode("utf-8")).decode("utf-8")
        command.extend(["--request-base64", encoded])

    return command, package_root


def run_ts_json_cli(
    *,
    module_file: str,
    package_name: str,
    dist_entry: str,
    source_entry: str,
    operation: str,
    payload: Mapping[str, Any] | None = None,
    node_bin_env: str = _RUNTIME_NODE_BIN_ENV,
    missing_entry_message: str,
    empty_output_message: str | None = None,
) -> Any:
    resolved = ts_cli_command(
        module_file=module_file,
        package_name=package_name,
        dist_entry=dist_entry,
        source_entry=source_entry,
        operation=operation,
        payload=payload,
        node_bin_env=node_bin_env,
    )
    if resolved is None:
        raise RuntimeError(missing_entry_message)

    command, cwd = resolved
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            cwd=str(cwd),
        )
    except OSError as exc:
        raise RuntimeError(f"failed to invoke TypeScript {package_name} operation={operation}: {exc}") from exc

    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or (
            f"TypeScript {package_name} operation={operation} exited with code {completed.returncode}"
        )
        raise RuntimeError(detail)

    stdout = completed.stdout.strip()
    if not stdout:
        if empty_output_message is not None:
            raise RuntimeError(empty_output_message)
        return None
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid TypeScript {package_name} response operation={operation}: {exc}") from exc
