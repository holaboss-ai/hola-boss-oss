from __future__ import annotations

import argparse
import asyncio
import sys

from sandbox_agent_runtime.local_execution_service import (
    process_claimed_input as process_claimed_input_record,
)
from sandbox_agent_runtime.runtime_local_state import get_input


async def _run(input_id: str) -> int:
    record = get_input(input_id)
    if record is None:
        print(f"input not found: {input_id}", file=sys.stderr)
        return 1
    await process_claimed_input_record(record)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Execute a claimed local runtime input")
    parser.add_argument("--input-id", required=True)
    args = parser.parse_args()
    return asyncio.run(_run(args.input_id))


if __name__ == "__main__":
    raise SystemExit(main())
