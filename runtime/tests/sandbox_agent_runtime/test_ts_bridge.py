from pathlib import Path

from sandbox_agent_runtime.ts_bridge import runtime_root_dir


def test_runtime_root_dir_prefers_explicit_env(monkeypatch, tmp_path: Path) -> None:
    configured_root = tmp_path / "configured-runtime"
    configured_root.mkdir()
    monkeypatch.setenv("HOLABOSS_RUNTIME_ROOT", str(configured_root))

    assert runtime_root_dir("/ignored/module.py") == configured_root


def test_runtime_root_dir_uses_source_layout_root(tmp_path: Path) -> None:
    module_file = tmp_path / "runtime" / "src" / "sandbox_agent_runtime" / "runner.py"
    module_file.parent.mkdir(parents=True)
    module_file.write_text("# test\n")

    assert runtime_root_dir(str(module_file)) == tmp_path / "runtime"


def test_runtime_root_dir_uses_packaged_layout_root(tmp_path: Path) -> None:
    runtime_root = tmp_path / "app"
    module_file = runtime_root / "sandbox_agent_runtime" / "runner.py"
    module_file.parent.mkdir(parents=True)
    module_file.write_text("# test\n")
    (runtime_root / "api-server").mkdir()

    assert runtime_root_dir(str(module_file)) == runtime_root
