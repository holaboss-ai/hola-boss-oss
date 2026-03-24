from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
from pathlib import Path

import httpx

from sandbox_agent_runtime.runtime_config.models import ResolvedApplication

logger = logging.getLogger(__name__)

_COMPOSE_COMMANDS = (["docker", "compose"], ["docker-compose"])

# Port 8080 is reserved for the sandbox agent runtime uvicorn.
_SANDBOX_AGENT_PORT = 8080

# Port ranges for deterministic allocation.
# App HTTP ports: 18080, 18081, 18082, ...
_APP_HTTP_PORT_BASE = 18080
# MCP ports: 13100, 13101, 13102, ...
_MCP_PORT_BASE = 13100


def _patch_compose_ports(
    path: Path, *, container_http_port: int, host_http_port: int, container_mcp_port: int, host_mcp_port: int
) -> None:
    """Remap host ports in a docker-compose file to the allocated ports."""
    try:
        text = path.read_text()
        original = text

        text = re.sub(
            rf'(- (?:["\']?))\d+:{container_http_port}\b',
            rf"\g<1>{host_http_port}:{container_http_port}",
            text,
        )

        text = re.sub(
            rf'(- (?:["\']?))\d+:{container_mcp_port}\b',
            rf"\g<1>{host_mcp_port}:{container_mcp_port}",
            text,
        )

        if text != original:
            path.write_text(text)
            logger.info(
                "Patched ports in %s: HTTP %d→%d, MCP %d→%d",
                path,
                container_http_port,
                host_http_port,
                container_mcp_port,
                host_mcp_port,
            )
    except Exception as exc:
        logger.warning("Failed to patch docker-compose ports in %s: %s", path, exc)


async def _find_compose_command() -> list[str] | None:
    for cmd in _COMPOSE_COMMANDS:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                "version",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.wait()
            if proc.returncode == 0:
                return cmd
        except FileNotFoundError:
            continue
    return None


class ApplicationLifecycleManager:
    def __init__(self, *, workspace_dir: str | Path, holaboss_user_id: str = "") -> None:
        self._workspace_dir = Path(workspace_dir)
        self._holaboss_user_id = holaboss_user_id
        self._procs: dict[str, asyncio.subprocess.Process] = {}
        self._compose_apps: set[str] = set()
        # Maps app_id → allocated (http_host_port, mcp_host_port)
        self._port_allocations: dict[str, tuple[int, int]] = {}

    def assign_deterministic_ports(self, apps: list[ResolvedApplication]) -> None:
        """Set port allocations deterministically based on app list order.

        Uses the index of each app in the list (which matches workspace.yaml order)
        to compute stable ports: HTTP = 18080 + index, MCP = 13100 + index.
        This ensures the same app always gets the same port across runs.
        """
        self._port_allocations = {
            app.app_id: (_APP_HTTP_PORT_BASE + index, _MCP_PORT_BASE + index)
            for index, app in enumerate(apps)
        }

    async def start_all(self, apps: list[ResolvedApplication], *, max_retries: int = 2) -> None:
        # Assign deterministic ports so the same app always gets the same port.
        self.assign_deterministic_ports(apps)

        for app in apps:
            mcp_host_port = self._get_mcp_host_port(app)
            if await self._is_app_healthy(app):
                logger.info("App '%s' already healthy on port %d, skipping start", app.app_id, mcp_host_port)
                self._compose_apps.add(app.app_id)
                continue
            # Kill any stale process on this port from a previous sandbox lifecycle.
            with contextlib.suppress(Exception):
                await self._kill_allocated_port_listeners(app)
            await self._start_app(app)
            await self._wait_healthy_with_retry(app, max_retries=max_retries)

    def _get_mcp_host_port(self, app: ResolvedApplication) -> int:
        """Return the allocated MCP host port for this app."""
        if app.app_id in self._port_allocations:
            return self._port_allocations[app.app_id][1]
        return app.mcp.port

    def _get_http_host_port(self, app: ResolvedApplication) -> int:
        """Return the allocated HTTP host port for this app."""
        if app.app_id in self._port_allocations:
            return self._port_allocations[app.app_id][0]
        return _APP_HTTP_PORT_BASE

    @staticmethod
    def _is_http_health_status(status_code: int) -> bool:
        return 200 <= status_code < 400

    def _health_probe_urls(self, app: ResolvedApplication) -> list[tuple[str, str]]:
        http_port = self._get_http_host_port(app)
        mcp_port = self._get_mcp_host_port(app)
        return [
            ("http", f"http://localhost:{http_port}/"),
            ("mcp", f"http://localhost:{mcp_port}{app.health_check.path}"),
        ]

    async def _is_app_healthy(self, app: ResolvedApplication) -> bool:
        """Return True if the app's health endpoint is already responding successfully."""
        async with httpx.AsyncClient() as client:
            for probe_kind, probe_url in self._health_probe_urls(app):
                try:
                    resp = await client.get(probe_url, timeout=3, follow_redirects=False)
                except Exception as exc:
                    logger.debug("Health probe for %s via %s not ready: %s", app.app_id, probe_kind, exc)
                    continue
                if probe_kind == "http" and self._is_http_health_status(resp.status_code):
                    return True
                if probe_kind == "mcp" and resp.status_code == 200:
                    return True
        return False

    async def _stop_app(self, app: ResolvedApplication) -> None:
        """Stop an app using its lifecycle.stop command, falling back to SIGTERM or docker compose."""
        # Priority 1: lifecycle.stop command declared by the module
        if app.lifecycle.stop:
            app_dir = self._resolve_app_dir(app)
            logger.info("Stopping app '%s' via lifecycle.stop: %s", app.app_id, app.lifecycle.stop)
            proc = await asyncio.create_subprocess_shell(
                app.lifecycle.stop,
                cwd=str(app_dir),
                env=self._build_app_env(app),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                await asyncio.wait_for(proc.wait(), timeout=30)
            except TimeoutError:
                logger.warning("lifecycle.stop for '%s' timed out, killing", app.app_id)
                with contextlib.suppress(Exception):
                    proc.kill()
            await self._kill_allocated_port_listeners(app)
            self._procs.pop(app.app_id, None)
            self._compose_apps.discard(app.app_id)
            return

        # Priority 2: SIGTERM a tracked subprocess
        tracked_proc = self._procs.pop(app.app_id, None)
        if tracked_proc is not None:
            try:
                tracked_proc.terminate()
                await asyncio.wait_for(tracked_proc.wait(), timeout=10)
            except Exception:
                logger.warning("Failed to stop app %s — killing", app.app_id)
                with contextlib.suppress(Exception):
                    tracked_proc.kill()
            await self._kill_allocated_port_listeners(app)
            return

        # Priority 3: docker compose down (legacy fallback)
        if app.app_id in self._compose_apps:
            await self._stop_compose_app(app)
            await self._kill_allocated_port_listeners(app)

    def get_mcp_url(self, app: ResolvedApplication) -> str:
        port = self._get_mcp_host_port(app)
        return f"http://localhost:{port}{app.mcp.path}"

    def _resolve_app_dir(self, app: ResolvedApplication) -> Path:
        if app.base_dir:
            return self._workspace_dir / app.base_dir
        return self._workspace_dir / "apps" / app.app_id

    def _build_app_env(self, app: ResolvedApplication | None = None) -> dict[str, str]:
        env = {**os.environ}
        if self._holaboss_user_id and app is not None and "HOLABOSS_USER_ID" in set(app.env_contract):
            env["HOLABOSS_USER_ID"] = self._holaboss_user_id
        # Inject allocated ports so lifecycle commands use the right ports
        if app is not None and app.app_id in self._port_allocations:
            http_port, mcp_port = self._port_allocations[app.app_id]
            env["PORT"] = str(http_port)
            env["MCP_PORT"] = str(mcp_port)
        return env

    async def _start_app(self, app: ResolvedApplication) -> None:
        app_dir = self._resolve_app_dir(app)

        # Priority 1: lifecycle.start command declared by the module
        if app.lifecycle.start:
            await self._start_lifecycle_app(app, app_dir)
            return

        # Priority 2: legacy start_command field
        if app.start_command:
            await self._start_subprocess_app(app, app_dir)
            return

        # Priority 3: docker-compose fallback
        compose_file = app_dir / "docker-compose.yml"
        compose_file_yaml = app_dir / "docker-compose.yaml"
        if compose_file.exists() or compose_file_yaml.exists():
            await self._start_compose_app(app, app_dir)
            return

        raise RuntimeError(
            f"App '{app.app_id}' has no lifecycle.start, no start_command, and no docker-compose.yml; cannot launch"
        )

    async def _start_lifecycle_app(self, app: ResolvedApplication, app_dir: Path) -> None:
        """Start an app using its lifecycle.start command.

        PORT and MCP_PORT are injected into the environment from the allocated
        port table so the module listens on the correct host ports.
        """
        app_env = self._build_app_env(app)
        logger.info(
            "Starting app '%s' via lifecycle.start (PORT=%s, MCP_PORT=%s): %s",
            app.app_id,
            app_env.get("PORT"),
            app_env.get("MCP_PORT"),
            app.lifecycle.start,
        )
        proc = await asyncio.create_subprocess_shell(
            app.lifecycle.start,
            cwd=str(app_dir),
            env=app_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._procs[app.app_id] = proc
        logger.info("Started app '%s' via lifecycle (pid=%s)", app.app_id, proc.pid)

    async def _compose_images_exist(self, compose_cmd: list[str], app: ResolvedApplication, app_dir: Path) -> bool:
        """Check whether all compose services already have local images."""
        compose_env = self._build_app_env(app)

        images_proc = await asyncio.create_subprocess_exec(
            *compose_cmd,
            "images",
            "-q",
            cwd=str(app_dir),
            env=compose_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        images_stdout, _ = await images_proc.communicate()

        services_proc = await asyncio.create_subprocess_exec(
            *compose_cmd,
            "config",
            "--services",
            cwd=str(app_dir),
            env=compose_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        services_stdout, _ = await services_proc.communicate()

        images_out = images_stdout.decode(errors="replace").strip()
        services_out = services_stdout.decode(errors="replace").strip()
        image_count = len(images_out.splitlines()) if images_out else 0
        service_count = len(services_out.splitlines()) if services_out else 0

        if service_count == 0:
            return False
        return image_count >= service_count

    async def _start_compose_app(self, app: ResolvedApplication, app_dir: Path) -> None:
        compose_cmd = await _find_compose_command()
        if compose_cmd is None:
            raise RuntimeError(f"App '{app.app_id}' requires docker compose but it is not available")

        # Remap host ports in docker-compose to allocated ports (avoids conflicts between modules).
        http_host_port, mcp_host_port = self._port_allocations.get(app.app_id, (_APP_HTTP_PORT_BASE, app.mcp.port))
        for compose_filename in ("docker-compose.yml", "docker-compose.yaml"):
            compose_path = app_dir / compose_filename
            if compose_path.exists():
                _patch_compose_ports(
                    compose_path,
                    container_http_port=_SANDBOX_AGENT_PORT,
                    host_http_port=http_host_port,
                    container_mcp_port=app.mcp.port,
                    host_mcp_port=mcp_host_port,
                )
                break

        has_images = await self._compose_images_exist(compose_cmd, app, app_dir)
        if has_images:
            cmd = [*compose_cmd, "up", "-d"]
            logger.info("Starting app '%s' via docker compose (images cached) in %s", app.app_id, app_dir)
        else:
            cmd = [*compose_cmd, "up", "--build", "-d"]
            logger.info("Starting app '%s' via docker compose (building) in %s", app.app_id, app_dir)

        compose_env = self._build_app_env(app)
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(app_dir),
            env=compose_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        returncode = await proc.wait()
        if returncode != 0:
            stderr = (await proc.stderr.read()).decode(errors="replace") if proc.stderr else ""
            raise RuntimeError(f"App '{app.app_id}' docker compose up failed (rc={returncode}): {stderr[:500]}")
        self._compose_apps.add(app.app_id)
        logger.info("Started app '%s' via docker compose", app.app_id)

    async def _start_subprocess_app(self, app: ResolvedApplication, app_dir: Path) -> None:
        proc = await asyncio.create_subprocess_shell(
            app.start_command,
            cwd=str(app_dir),
            env=self._build_app_env(app),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._procs[app.app_id] = proc
        logger.info("Started app '%s' (pid=%s)", app.app_id, proc.pid)

    async def _stop_compose_app(self, app: ResolvedApplication) -> None:
        app_dir = self._resolve_app_dir(app)
        compose_cmd = await _find_compose_command()
        if compose_cmd is None:
            return
        self._compose_apps.discard(app.app_id)
        proc = await asyncio.create_subprocess_exec(
            *compose_cmd,
            "down",
            "--remove-orphans",
            cwd=str(app_dir),
            env=self._build_app_env(app),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
        logger.info("Stopped app '%s' via docker compose", app.app_id)

    async def _wait_healthy_with_retry(self, app: ResolvedApplication, *, max_retries: int = 2) -> None:
        """Poll health endpoint, retrying with a restart on failure."""
        last_error: RuntimeError | None = None
        for attempt in range(max_retries + 1):
            try:
                await self._wait_healthy(app)
            except RuntimeError as exc:
                last_error = exc
                if attempt < max_retries:
                    logger.warning(
                        "App '%s' health check failed (attempt %d/%d), retrying",
                        app.app_id,
                        attempt + 1,
                        max_retries + 1,
                    )
                    await self._retry_start_app(app)
            else:
                return
        raise last_error  # type: ignore[misc]

    async def _retry_start_app(self, app: ResolvedApplication) -> None:
        """Restart an app as a retry fallback after health check failure."""
        # For lifecycle and subprocess apps, stop then start again
        if app.lifecycle.start or app.start_command:
            await self._stop_app(app)
            await self._start_app(app)
            return

        # For compose apps, force rebuild
        if app.app_id in self._compose_apps:
            await self._rebuild_compose_app(app)

    async def _rebuild_compose_app(self, app: ResolvedApplication) -> None:
        """Force a rebuild of a compose app (used as retry fallback)."""
        app_dir = self._resolve_app_dir(app)
        compose_cmd = await _find_compose_command()
        if compose_cmd is None:
            return
        cmd = [*compose_cmd, "up", "--build", "-d"]
        compose_env = self._build_app_env(app)
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(app_dir),
            env=compose_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        returncode = await proc.wait()
        if returncode != 0:
            stderr = (await proc.stderr.read()).decode(errors="replace") if proc.stderr else ""
            logger.warning("Rebuild of app '%s' failed (rc=%d): %s", app.app_id, returncode, stderr[:500])

    async def _wait_healthy(self, app: ResolvedApplication) -> None:
        hc = app.health_check
        loop = asyncio.get_event_loop()
        deadline = loop.time() + hc.timeout_s

        async with httpx.AsyncClient() as client:
            while loop.time() < deadline:
                for probe_kind, probe_url in self._health_probe_urls(app):
                    try:
                        resp = await client.get(probe_url, timeout=5, follow_redirects=False)
                    except Exception as exc:
                        logger.debug("Health check for %s via %s not ready: %s", app.app_id, probe_kind, exc)
                        continue
                    if probe_kind == "http" and self._is_http_health_status(resp.status_code):
                        logger.info("App '%s' is healthy via http", app.app_id)
                        return
                    if probe_kind == "mcp" and resp.status_code == 200:
                        logger.info("App '%s' is healthy via mcp", app.app_id)
                        return
                await asyncio.sleep(hc.interval_s)

        raise RuntimeError(f"App '{app.app_id}' did not become healthy within {hc.timeout_s}s")

    async def _kill_allocated_port_listeners(self, app: ResolvedApplication) -> None:
        ports: list[int] = []
        if app.app_id in self._port_allocations:
            http_port, mcp_port = self._port_allocations[app.app_id]
            ports.extend([http_port, mcp_port])
        if not ports:
            return
        kill_terms = [f"kill $(lsof -t -i :{port} 2>/dev/null) 2>/dev/null || true" for port in ports]
        proc = await asyncio.create_subprocess_shell(
            " ; ".join(kill_terms),
            cwd=str(self._resolve_app_dir(app)),
            env=self._build_app_env(app),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        with contextlib.suppress(Exception):
            await asyncio.wait_for(proc.wait(), timeout=10)
