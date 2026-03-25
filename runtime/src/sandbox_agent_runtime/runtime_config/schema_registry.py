from __future__ import annotations

import importlib
import inspect
from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel

from .errors import WorkspaceRuntimeConfigError
from .models import WorkspaceGeneralConfig, WorkspaceGeneralMemberConfig, WorkspaceGeneralTeamConfig


class WorkspaceOutputSchemaResolver:
    def resolve(
        self,
        *,
        schema_aliases: Mapping[str, str],
        general_config: WorkspaceGeneralConfig,
        module_prefixes: tuple[str, ...],
    ) -> dict[str, type[BaseModel]]:
        resolved: dict[str, type[BaseModel]] = {}

        members = _ordered_members(general_config)
        for member in members:
            if member.schema_id is None and member.schema_module_path is None:
                continue

            member_config_path = member.config_path or f"agents[{member.id}]"
            if member.schema_id is not None:
                module_path = schema_aliases.get(member.schema_id)
                if module_path is None:
                    raise WorkspaceRuntimeConfigError(
                        code="workspace_schema_id_unknown",
                        path=f"{member_config_path}.schema_id",
                        message=f"unknown schema alias '{member.schema_id}'",
                        hint="add schema_registry.aliases entry or use schema_module_path",
                    )
                schema_model = _load_schema_model(
                    module_path=module_path,
                    prefixes=module_prefixes,
                    error_path=f"{member_config_path}.schema_id",
                )
                resolved[member.id] = schema_model
                continue

            if member.schema_module_path is None:
                continue
            schema_model = _load_schema_model(
                module_path=member.schema_module_path,
                prefixes=module_prefixes,
                error_path=f"{member_config_path}.schema_module_path",
            )
            resolved[member.id] = schema_model

        return resolved
def _load_schema_model(
    *,
    module_path: str,
    prefixes: tuple[str, ...],
    error_path: str,
) -> type[BaseModel]:
    module_name, symbol_name = _parse_module_path(module_path=module_path)
    if not _has_allowed_prefix(module_name=module_name, prefixes=prefixes):
        raise WorkspaceRuntimeConfigError(
            code="workspace_schema_module_prefix_blocked",
            path=error_path,
            message=f"module '{module_name}' is not in allowlisted prefixes {list(prefixes)}",
        )
    try:
        module = importlib.import_module(module_name)
    except Exception as exc:
        raise WorkspaceRuntimeConfigError(
            code="workspace_schema_load_failed",
            path=error_path,
            message=f"failed to import schema module '{module_name}': {exc}",
        ) from exc

    try:
        model = _resolve_schema_symbol(module=module, symbol_name=symbol_name)
    except WorkspaceRuntimeConfigError:
        raise
    except Exception as exc:
        raise WorkspaceRuntimeConfigError(
            code="workspace_schema_load_failed",
            path=error_path,
            message=f"failed to resolve schema from '{module_path}': {exc}",
        ) from exc

    if not inspect.isclass(model) or not issubclass(model, BaseModel):
        raise WorkspaceRuntimeConfigError(
            code="workspace_schema_type_invalid",
            path=error_path,
            message=f"symbol '{model.__name__ if inspect.isclass(model) else type(model).__name__}' is not BaseModel",
        )
    return model


def _parse_module_path(*, module_path: str) -> tuple[str, str | None]:
    value = module_path.strip()
    if ":" in value:
        module_name, symbol_name = value.split(":", 1)
        return module_name.strip(), symbol_name.strip() or None
    if "." in value:
        module_name, symbol_name = value.rsplit(".", 1)
        # `x.y.z` can either mean module path or module.symbol.
        # Try treating suffix as symbol only when it looks identifier-like.
        if symbol_name.isidentifier():
            return module_name, symbol_name
    return value, None


def _resolve_schema_symbol(*, module: Any, symbol_name: str | None) -> Any:
    if symbol_name:
        if not hasattr(module, symbol_name):
            raise WorkspaceRuntimeConfigError(
                code="workspace_schema_load_failed",
                message=f"module '{module.__name__}' has no symbol '{symbol_name}'",
            )
        return getattr(module, symbol_name)

    candidates: list[type[BaseModel]] = []
    for _, value in vars(module).items():
        if not inspect.isclass(value):
            continue
        if not issubclass(value, BaseModel):
            continue
        if value is BaseModel:
            continue
        if value.__module__ != module.__name__:
            continue
        candidates.append(value)

    if len(candidates) == 1:
        return candidates[0]
    raise WorkspaceRuntimeConfigError(
        code="workspace_schema_load_failed",
        message=(
            f"module '{module.__name__}' must expose exactly one BaseModel subclass "
            "or schema_module_path must include ':SymbolName'"
        ),
    )


def _has_allowed_prefix(*, module_name: str, prefixes: tuple[str, ...]) -> bool:
    if not prefixes:
        return True
    return any(module_name == prefix or module_name.startswith(f"{prefix}.") for prefix in prefixes)


def _ordered_members(general_config: WorkspaceGeneralConfig) -> tuple[WorkspaceGeneralMemberConfig, ...]:
    if isinstance(general_config, WorkspaceGeneralTeamConfig):
        return (general_config.coordinator, *general_config.members)
    return (general_config.agent,)
