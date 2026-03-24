from __future__ import annotations

import json
import sys
from typing import Any


def print_envelope(*, status_code: int, payload: dict[str, Any] | None = None, detail: str | None = None) -> None:
    print(
        json.dumps(
            {
                "status_code": status_code,
                "payload": payload,
                "detail": detail,
            },
            ensure_ascii=True,
        ),
        end="",
    )


def read_json_stdin() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    loaded = json.loads(raw)
    if not isinstance(loaded, dict):
        raise ValueError("request body must be an object")
    return loaded
