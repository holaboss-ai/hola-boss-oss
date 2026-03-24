# ruff: noqa: S101
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sandbox_agent_runtime.application_lifecycle import (
    ApplicationLifecycleManager,
    _patch_compose_ports,
)
from sandbox_agent_runtime.runtime_config.models import (
    ResolvedApplication,
    ResolvedApplicationHealthCheck,
    ResolvedApplicationMcp,
)


def _make_app(app_id: str = "test-mcp") -> ResolvedApplication:
    return ResolvedApplication(
        app_id=app_id,
        mcp=ResolvedApplicationMcp(transport="http-sse", port=3099, path="/mcp"),
        health_check=ResolvedApplicationHealthCheck(path="/mcp/health", timeout_s=10, interval_s=1),
        env_contract=("HOLABOSS_USER_ID",),
        start_command="python3 server.py",
    )


def _make_app_without_holaboss_env(app_id: str = "test-mcp-no-user") -> ResolvedApplication:
    return ResolvedApplication(
        app_id=app_id,
        mcp=ResolvedApplicationMcp(transport="http-sse", port=3099, path="/mcp"),
        health_check=ResolvedApplicationHealthCheck(path="/mcp/health", timeout_s=10, interval_s=1),
        env_contract=(),
        start_command="python3 server.py",
    )


def test_build_app_env_only_injects_holaboss_user_id_when_contracted() -> None:
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws", holaboss_user_id="user-1")

    with_user_env = manager._build_app_env(_make_app())
    without_user_env = manager._build_app_env(_make_app_without_holaboss_env())

    assert with_user_env["HOLABOSS_USER_ID"] == "user-1"
    assert "HOLABOSS_USER_ID" not in without_user_env


@pytest.mark.asyncio
async def test_compose_images_exist_injects_holaboss_user_id_and_allocated_ports() -> None:
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws", holaboss_user_id="user-1")
    app = _make_app("compose-app")
    manager._port_allocations = {"compose-app": (18081, 13101)}
    seen_envs: list[dict[str, str]] = []

    def _proc(stdout: bytes):
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(stdout, b""))
        return proc

    with patch("asyncio.create_subprocess_exec", new=AsyncMock(side_effect=[_proc(b"image-1\n"), _proc(b"app\n")])) as mock_exec:
        exists = await manager._compose_images_exist(["docker", "compose"], app, Path("/workspace/test-ws/apps/compose-app"))

    assert exists is True
    assert mock_exec.await_count == 2
    for call in mock_exec.await_args_list:
        seen_envs.append(call.kwargs["env"])
    for env in seen_envs:
        assert env["HOLABOSS_USER_ID"] == "user-1"
        assert env["PORT"] == "18081"
        assert env["MCP_PORT"] == "13101"


@pytest.mark.asyncio
async def test_start_subprocess_app_injects_holaboss_user_id_and_allocated_ports() -> None:
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws", holaboss_user_id="user-1")
    app = _make_app("subprocess-app")
    manager._port_allocations = {"subprocess-app": (18082, 13102)}

    proc = AsyncMock()
    proc.pid = 1234

    with patch("asyncio.create_subprocess_shell", new=AsyncMock(return_value=proc)) as mock_shell:
        await manager._start_subprocess_app(app, Path("/workspace/test-ws/apps/subprocess-app"))

    assert mock_shell.await_args.kwargs["env"]["HOLABOSS_USER_ID"] == "user-1"
    assert mock_shell.await_args.kwargs["env"]["PORT"] == "18082"
    assert mock_shell.await_args.kwargs["env"]["MCP_PORT"] == "13102"


@pytest.mark.asyncio
async def test_start_all_calls_start_then_health() -> None:
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    app = _make_app()

    with (
        patch.object(manager, "_start_app", new=AsyncMock()) as mock_start,
        patch.object(manager, "_wait_healthy", new=AsyncMock()) as mock_health,
    ):
        await manager.start_all([app])

    mock_start.assert_called_once_with(app)
    mock_health.assert_called_once_with(app)


@pytest.mark.asyncio
async def test_get_mcp_url_returns_allocated_port() -> None:
    """After start_all, get_mcp_url should use the allocated port, not the declared one."""
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    app = _make_app()

    with (
        patch.object(manager, "_start_app", new=AsyncMock()),
        patch.object(manager, "_wait_healthy", new=AsyncMock()),
    ):
        await manager.start_all([app])

    url = manager.get_mcp_url(app)
    # Should use allocated port (13100+), not the declared 3099
    assert ":3099/" not in url
    assert "/mcp" in url


@pytest.mark.asyncio
async def test_get_mcp_url_falls_back_to_declared_port_without_allocation() -> None:
    """Before start_all, get_mcp_url should fall back to the declared port."""
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    app = _make_app()
    url = manager.get_mcp_url(app)
    assert url == "http://localhost:3099/mcp"


@pytest.mark.asyncio
async def test_wait_healthy_polls_allocated_port() -> None:
    """_wait_healthy should accept the allocated HTTP port as healthy."""
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    app = _make_app()
    # Simulate port allocation
    manager._port_allocations = {"test-mcp": (18080, 13100)}
    captured_urls: list[str] = []

    async def fake_get(url: str, timeout: float, follow_redirects: bool = False) -> MagicMock:
        del timeout, follow_redirects
        captured_urls.append(url)
        resp = MagicMock()
        resp.status_code = 307
        return resp

    with patch("httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=fake_get)
        await manager._wait_healthy(app)

    assert len(captured_urls) == 1
    assert captured_urls[0] == "http://localhost:18080/"


@pytest.mark.asyncio
async def test_wait_healthy_falls_back_to_mcp_when_http_probe_fails() -> None:
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    app = _make_app()
    manager._port_allocations = {"test-mcp": (18080, 13100)}
    captured_urls: list[str] = []

    async def fake_get(url: str, timeout: float, follow_redirects: bool = False) -> MagicMock:
        del timeout, follow_redirects
        captured_urls.append(url)
        if url.endswith(":18080/"):
            raise httpx.ConnectError("connection refused")
        resp = MagicMock()
        resp.status_code = 200
        return resp

    with patch("httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=fake_get)
        await manager._wait_healthy(app)

    assert captured_urls == [
        "http://localhost:18080/",
        "http://localhost:13100/mcp/health",
    ]


@pytest.mark.asyncio
async def test_stop_app_with_lifecycle_stop_kills_allocated_http_and_mcp_ports() -> None:
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    app = ResolvedApplication(
        app_id="twitter",
        mcp=ResolvedApplicationMcp(transport="http-sse", port=3099, path="/mcp"),
        health_check=ResolvedApplicationHealthCheck(path="/mcp/health", timeout_s=10, interval_s=1),
        lifecycle=MagicMock(setup="", start="npm run start", stop="kill $(lsof -t -i :${MCP_PORT:-3099})"),
    )
    manager._port_allocations = {"twitter": (18080, 13100)}

    proc = AsyncMock()
    proc.wait = AsyncMock()

    with patch("asyncio.create_subprocess_shell", new=AsyncMock(return_value=proc)) as mock_shell:
        await manager._stop_app(app)

    assert mock_shell.await_count == 2
    cleanup_cmd = mock_shell.await_args_list[1].args[0]
    assert "lsof -t -i :18080" in cleanup_cmd
    assert "lsof -t -i :13100" in cleanup_cmd


@pytest.mark.asyncio
async def test_wait_healthy_raises_after_timeout() -> None:
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    app = ResolvedApplication(
        app_id="slow-app",
        mcp=ResolvedApplicationMcp(transport="http-sse", port=3099, path="/mcp"),
        health_check=ResolvedApplicationHealthCheck(path="/health", timeout_s=1, interval_s=1),
        start_command="python3 server.py",
    )

    with patch("httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_client.get = AsyncMock(return_value=mock_resp)

        with pytest.raises(RuntimeError, match="did not become healthy"):
            await manager._wait_healthy(app)


@pytest.mark.asyncio
async def test_start_app_raises_when_no_start_command() -> None:
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    app = ResolvedApplication(
        app_id="no-cmd-app",
        mcp=ResolvedApplicationMcp(transport="http-sse", port=3099, path="/mcp"),
        health_check=ResolvedApplicationHealthCheck(path="/health"),
        start_command="",  # empty
    )

    with pytest.raises(RuntimeError, match="no start_command"):
        await manager._start_app(app)


# --- Deterministic port allocation tests ---


def test_assign_deterministic_ports_assigns_unique_ports_per_app() -> None:
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    apps = [
        _make_app("twitter-module"),
        _make_app("linkedin-module"),
        _make_app("reddit-module"),
    ]
    manager.assign_deterministic_ports(apps)

    assert len(manager._port_allocations) == 3
    http_ports = [v[0] for v in manager._port_allocations.values()]
    mcp_ports = [v[1] for v in manager._port_allocations.values()]

    # All ports must be unique
    assert len(set(http_ports)) == 3
    assert len(set(mcp_ports)) == 3

    # No overlap between http and mcp ports
    assert not set(http_ports) & set(mcp_ports)


def test_assign_deterministic_ports_stable_across_calls() -> None:
    """Same app list order always produces the same port assignments."""
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    apps = [_make_app(f"app-{i}") for i in range(5)]

    manager.assign_deterministic_ports(apps)
    first = dict(manager._port_allocations)

    manager.assign_deterministic_ports(apps)
    second = dict(manager._port_allocations)

    assert first == second


def test_assign_deterministic_ports_index_based() -> None:
    """Ports are derived from list index: HTTP=18080+i, MCP=13100+i."""
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    apps = [_make_app("app-a"), _make_app("app-b")]
    manager.assign_deterministic_ports(apps)

    assert manager._port_allocations["app-a"] == (18080, 13100)
    assert manager._port_allocations["app-b"] == (18081, 13101)


def test_patch_compose_ports_rewrites_both_ports(tmp_path: object) -> None:
    from pathlib import Path

    tmp = Path(str(tmp_path))
    compose = tmp / "docker-compose.yml"
    compose.write_text(
        """services:
  app:
    ports:
      - "8080:8080"
      - "3099:3099"
  redis:
    image: redis:7-alpine
"""
    )

    _patch_compose_ports(
        compose,
        container_http_port=8080,
        host_http_port=18082,
        container_mcp_port=3099,
        host_mcp_port=13105,
    )

    result = compose.read_text()
    assert "18082:8080" in result
    assert "13105:3099" in result
    # Container-side ports unchanged
    assert ":8080" in result
    assert ":3099" in result


def test_patch_compose_ports_idempotent(tmp_path: object) -> None:
    from pathlib import Path

    tmp = Path(str(tmp_path))
    compose = tmp / "docker-compose.yml"
    compose.write_text(
        """services:
  app:
    ports:
      - "8080:8080"
      - "3099:3099"
"""
    )

    # Patch twice with same values
    for _ in range(2):
        _patch_compose_ports(
            compose,
            container_http_port=8080,
            host_http_port=18080,
            container_mcp_port=3099,
            host_mcp_port=13100,
        )

    result = compose.read_text()
    assert result.count("18080:8080") == 1
    assert result.count("13100:3099") == 1


def test_patch_compose_ports_handles_re_patch(tmp_path: object) -> None:
    """Re-patching with different ports should update to the new values."""
    from pathlib import Path

    tmp = Path(str(tmp_path))
    compose = tmp / "docker-compose.yml"
    compose.write_text(
        """services:
  app:
    ports:
      - "8080:8080"
      - "3099:3099"
"""
    )

    # First patch
    _patch_compose_ports(
        compose,
        container_http_port=8080,
        host_http_port=18080,
        container_mcp_port=3099,
        host_mcp_port=13100,
    )

    # Second patch with different ports (e.g. after restart with new allocation)
    _patch_compose_ports(
        compose,
        container_http_port=8080,
        host_http_port=18085,
        container_mcp_port=3099,
        host_mcp_port=13107,
    )

    result = compose.read_text()
    assert "18085:8080" in result
    assert "13107:3099" in result
    assert "18080" not in result
    assert "13100" not in result


@pytest.mark.asyncio
async def test_start_all_pre_allocates_ports() -> None:
    """start_all must allocate ports before starting apps."""
    manager = ApplicationLifecycleManager(workspace_dir="/workspace/test-ws")
    apps = [_make_app("app-a"), _make_app("app-b")]

    with (
        patch.object(manager, "_start_app", new=AsyncMock()),
        patch.object(manager, "_wait_healthy", new=AsyncMock()),
    ):
        await manager.start_all(apps)

    # Both apps should have port allocations
    assert "app-a" in manager._port_allocations
    assert "app-b" in manager._port_allocations

    # Ports should differ
    mcp_a = manager._port_allocations["app-a"][1]
    mcp_b = manager._port_allocations["app-b"][1]
    assert mcp_a != mcp_b

    # MCP URLs should use allocated ports
    url_a = manager.get_mcp_url(apps[0])
    url_b = manager.get_mcp_url(apps[1])
    assert f":{mcp_a}/" in url_a
    assert f":{mcp_b}/" in url_b
