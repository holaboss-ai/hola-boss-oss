from __future__ import annotations

import asyncio
import os
import socket
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.responses import Response, StreamingResponse

_TS_API_SERVER_URL_ENV = "HOLABOSS_RUNTIME_TS_API_URL"
_TS_API_SERVER_PORT_ENV = "HOLABOSS_RUNTIME_TS_API_PORT"
_DEFAULT_TS_API_SERVER_URL = "http://127.0.0.1:3061"
_TS_API_PROXY_TIMEOUT_S = 30.0
_TS_API_READY_TIMEOUT_S = 5.0
_TS_API_READY_POLL_S = 0.1
_TS_API_NODE_BIN_ENV = "HOLABOSS_RUNTIME_NODE_BIN"


@dataclass
class TsApiServerState:
    lock: asyncio.Lock
    process: asyncio.subprocess.Process | None = None
    base_url: str | None = None


class TsApiProxySupport:
    def __init__(self, *, app: FastAPI, current_file: str) -> None:
        self._app = app
        self._current_file = current_file

    def ts_api_server_enabled(self) -> bool:
        return True

    def ts_api_base_url(self) -> str:
        managed_state = getattr(self._app.state, "ts_api_server_state", None)
        managed_base_url = getattr(managed_state, "base_url", None)
        if self.should_manage_ts_api_server() and isinstance(managed_base_url, str) and managed_base_url.strip():
            return managed_base_url.rstrip("/")
        raw = (os.getenv(_TS_API_SERVER_URL_ENV) or "").strip()
        return raw.rstrip("/") or _DEFAULT_TS_API_SERVER_URL

    def runtime_root_dir(self) -> Path:
        return Path(self._current_file).resolve().parents[2]

    def ts_api_server_entry_path(self) -> Path:
        return self.runtime_root_dir() / "api-server" / "dist" / "index.mjs"

    def ts_api_server_node_bin(self) -> str:
        configured = (os.getenv(_TS_API_NODE_BIN_ENV) or "").strip()
        return configured or "node"

    def should_manage_ts_api_server(self) -> bool:
        return self.ts_api_server_enabled() and not bool((os.getenv(_TS_API_SERVER_URL_ENV) or "").strip())

    def ts_api_server_port(self) -> int:
        configured = (os.getenv(_TS_API_SERVER_PORT_ENV) or "").strip()
        if configured:
            with suppress(ValueError):
                return max(1, int(configured))
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
            handle.bind(("127.0.0.1", 0))
            return int(handle.getsockname()[1])

    def ts_api_server_state(self) -> TsApiServerState:
        state = getattr(self._app.state, "ts_api_server_state", None)
        if state is None:
            state = TsApiServerState(lock=asyncio.Lock())
            self._app.state.ts_api_server_state = state
        return state

    async def ts_api_healthz_ok(self) -> bool:
        try:
            async with httpx.AsyncClient(base_url=self.ts_api_base_url(), timeout=1.0, trust_env=False) as client:
                response = await client.get("/healthz")
            payload = response.json()
            return response.status_code == 200 and isinstance(payload, dict) and bool(payload.get("ok"))
        except Exception:
            return False

    async def wait_for_ts_api_server_ready(self, process: asyncio.subprocess.Process) -> None:
        deadline = asyncio.get_running_loop().time() + _TS_API_READY_TIMEOUT_S
        while asyncio.get_running_loop().time() < deadline:
            if process.returncode is not None:
                raise RuntimeError(f"ts api server exited prematurely with code {process.returncode}")
            if await self.ts_api_healthz_ok():
                return
            await asyncio.sleep(_TS_API_READY_POLL_S)
        raise RuntimeError("timed out waiting for ts api server readiness")

    async def ensure_managed_ts_api_server_ready(self) -> None:
        if not self.should_manage_ts_api_server():
            return

        state = self.ts_api_server_state()
        async with state.lock:
            process = state.process
            if process is not None and process.returncode is None and await self.ts_api_healthz_ok():
                return
            if process is not None and process.returncode is not None:
                state.process = None
                state.base_url = None

            entry_path = self.ts_api_server_entry_path()
            if not entry_path.is_file():
                raise RuntimeError(f"ts api server entrypoint not found: {entry_path}")

            port = self.ts_api_server_port()
            env = os.environ.copy()
            env["SANDBOX_RUNTIME_API_PORT"] = str(port)
            env.setdefault("SANDBOX_RUNTIME_API_HOST", "127.0.0.1")
            process = await asyncio.create_subprocess_exec(
                self.ts_api_server_node_bin(),
                str(entry_path),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                env=env,
            )
            state.process = process
            state.base_url = f"http://127.0.0.1:{port}"
            try:
                await self.wait_for_ts_api_server_ready(process)
            except Exception:
                if process.returncode is None:
                    process.terminate()
                    with suppress(ProcessLookupError, asyncio.TimeoutError):
                        await asyncio.wait_for(process.wait(), timeout=1.0)
                state.process = None
                state.base_url = None
                raise

    async def shutdown_managed_ts_api_server(self) -> None:
        state = self.ts_api_server_state()
        process = state.process
        state.process = None
        state.base_url = None
        if process is None or process.returncode is not None:
            return
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            process.kill()
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(process.wait(), timeout=2.0)

    @staticmethod
    def proxy_response_headers(response: httpx.Response, *, streaming: bool = False) -> dict[str, str]:
        allowed = {"content-type"}
        if streaming:
            allowed.update({"cache-control", "connection", "x-accel-buffering"})
        headers: dict[str, str] = {}
        for key in allowed:
            value = response.headers.get(key)
            if value:
                headers[key] = value
        return headers

    @staticmethod
    def clean_proxy_params(params: dict[str, Any] | None) -> dict[str, Any] | None:
        if params is None:
            return None
        cleaned = {key: value for key, value in params.items() if value is not None}
        return cleaned or None

    async def ts_api_request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> httpx.Response:
        await self.ensure_managed_ts_api_server_ready()
        async with httpx.AsyncClient(
            base_url=self.ts_api_base_url(),
            timeout=_TS_API_PROXY_TIMEOUT_S,
            follow_redirects=True,
            trust_env=False,
        ) as client:
            return await client.request(method, path, params=self.clean_proxy_params(params), json=json_body)

    async def proxy_ts_api_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Response:
        response = await self.ts_api_request(method, path, params=params, json_body=json_body)
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=self.proxy_response_headers(response),
        )

    async def proxy_ts_api_stream(
        self,
        path: str,
        *,
        method: str = "GET",
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Response:
        await self.ensure_managed_ts_api_server_ready()
        client = httpx.AsyncClient(
            base_url=self.ts_api_base_url(),
            timeout=None,
            follow_redirects=True,
            trust_env=False,
        )
        stream_context = client.stream(
            method,
            path,
            params=self.clean_proxy_params(params),
            json=json_body,
        )
        upstream = await stream_context.__aenter__()
        if upstream.status_code >= 400:
            body = await upstream.aread()
            await stream_context.__aexit__(None, None, None)
            await client.aclose()
            return Response(
                content=body,
                status_code=upstream.status_code,
                headers=self.proxy_response_headers(upstream),
            )

        async def _iterator():
            try:
                async for chunk in upstream.aiter_bytes():
                    if chunk:
                        yield chunk
            finally:
                await stream_context.__aexit__(None, None, None)
                await client.aclose()

        return StreamingResponse(
            _iterator(),
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type"),
            headers=self.proxy_response_headers(upstream, streaming=True),
        )
