from __future__ import annotations

import argparse
import asyncio
import base64
import json
import sys

from sandbox_agent_runtime.proactive_bridge import (
    LocalRuntimeProactiveBridgeExecutor,
    ProactiveBridgeJob,
)


async def _run(job_base64: str) -> int:
    try:
        payload = base64.b64decode(job_base64.encode("utf-8")).decode("utf-8")
        job = ProactiveBridgeJob.model_validate_json(payload)
    except Exception as exc:
        print(f"invalid bridge job payload: {exc}", file=sys.stderr)
        return 1

    result = await LocalRuntimeProactiveBridgeExecutor().execute(job)
    print(json.dumps(result.model_dump(mode="json"), ensure_ascii=True), end="")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Execute a proactive bridge job")
    parser.add_argument("--job-base64", required=True)
    args = parser.parse_args()
    return asyncio.run(_run(args.job_base64))


if __name__ == "__main__":
    raise SystemExit(main())
