from __future__ import annotations

import importlib
import inspect
import sys
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, Callable, Iterator

from sandbox_agent_runtime.runtime_config.errors import WorkspaceRuntimeConfigError
from sandbox_agent_runtime.runtime_config.models import WorkspaceMcpCatalogEntry


@dataclass(slots=True, frozen=True)
class LoadedWorkspaceTool:
    tool_name: str
    callable_obj: Callable[..., Any]


def load_workspace_tools(
    *,
    workspace_dir: Path,
    catalog: tuple[WorkspaceMcpCatalogEntry, ...],
) -> tuple[LoadedWorkspaceTool, ...]:
    loaded: list[LoadedWorkspaceTool] = []
    with _workspace_import_scope(workspace_dir=workspace_dir):
        for entry in catalog:
            _validate_module_path(entry.module_path, tool_id=entry.tool_id)
            module = _import_workspace_module(
                workspace_dir=workspace_dir,
                module_path=entry.module_path,
                tool_id=entry.tool_id,
            )
            symbol = _resolve_symbol(module=module, symbol_name=entry.symbol_name, tool_id=entry.tool_id)
            loaded.append(
                LoadedWorkspaceTool(
                    tool_name=entry.tool_name,
                    callable_obj=symbol,
                )
            )
    return tuple(loaded)


def _validate_module_path(module_path: str, *, tool_id: str) -> None:
    if not module_path.startswith("tools."):
        raise WorkspaceRuntimeConfigError(
            code="workspace_mcp_catalog_entry_invalid",
            path=f"mcp_registry.catalog.{tool_id}.module_path",
            message="workspace local tool modules must be under 'tools.'",
        )
    parts = module_path.split(".")
    if not all(part.isidentifier() for part in parts):
        raise WorkspaceRuntimeConfigError(
            code="workspace_mcp_catalog_entry_invalid",
            path=f"mcp_registry.catalog.{tool_id}.module_path",
            message=f"module path '{module_path}' is not a valid dotted Python module",
        )


def _import_workspace_module(*, workspace_dir: Path, module_path: str, tool_id: str) -> ModuleType:
    _evict_cached_workspace_modules(module_path)
    importlib.invalidate_caches()
    try:
        module = importlib.import_module(module_path)
    except Exception as exc:
        raise WorkspaceRuntimeConfigError(
            code="workspace_mcp_catalog_entry_invalid",
            path=f"mcp_registry.catalog.{tool_id}",
            message=f"failed to import module '{module_path}': {exc}",
        ) from exc

    origin = _module_origin(module)
    workspace_root = workspace_dir.resolve()
    if origin is not None and workspace_root != origin and workspace_root not in origin.parents:
        raise WorkspaceRuntimeConfigError(
            code="workspace_mcp_catalog_entry_invalid",
            path=f"mcp_registry.catalog.{tool_id}.module_path",
            message=f"module '{module_path}' resolves outside workspace root",
        )
    return module


def _evict_cached_workspace_modules(module_path: str) -> None:
    prefixes = {
        module_path,
        *( ".".join(module_path.split(".")[:index]) for index in range(1, len(module_path.split("."))) )
    }
    for name in list(sys.modules.keys()):
        if name in prefixes or any(name.startswith(f"{prefix}.") for prefix in prefixes):
            sys.modules.pop(name, None)


def _module_origin(module: ModuleType) -> Path | None:
    module_file = getattr(module, "__file__", None)
    if isinstance(module_file, str) and module_file:
        return Path(module_file).resolve()
    module_path = getattr(module, "__path__", None)
    if module_path:
        with suppress(Exception):
            first = next(iter(module_path))
            return Path(first).resolve()
    return None


def _resolve_symbol(*, module: ModuleType, symbol_name: str, tool_id: str) -> Callable[..., Any]:
    if not hasattr(module, symbol_name):
        raise WorkspaceRuntimeConfigError(
            code="workspace_mcp_catalog_entry_invalid",
            path=f"mcp_registry.catalog.{tool_id}.symbol",
            message=f"module '{module.__name__}' has no symbol '{symbol_name}'",
        )
    symbol = getattr(module, symbol_name)
    if inspect.isclass(symbol):
        raise WorkspaceRuntimeConfigError(
            code="workspace_mcp_catalog_entry_invalid",
            path=f"mcp_registry.catalog.{tool_id}.symbol",
            message=f"symbol '{module.__name__}.{symbol_name}' must be callable, not a class",
        )
    if symbol is None or not callable(symbol):
        raise WorkspaceRuntimeConfigError(
            code="workspace_mcp_catalog_entry_invalid",
            path=f"mcp_registry.catalog.{tool_id}.symbol",
            message=f"symbol '{module.__name__}.{symbol_name}' is not callable",
        )
    return symbol


@contextmanager
def _workspace_import_scope(*, workspace_dir: Path) -> Iterator[None]:
    workspace_path = str(workspace_dir.resolve())
    added = False
    if workspace_path not in sys.path:
        sys.path.insert(0, workspace_path)
        added = True
    try:
        yield
    finally:
        if added:
            with suppress(ValueError):
                sys.path.remove(workspace_path)
