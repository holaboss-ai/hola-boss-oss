# Runtime Self-Contained Operations — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the sandbox runtime fully self-contained — handle app installation, template application, file I/O, workspace snapshots, and export natively, eliminating backend shell command orchestration.

**Architecture:** Add new API endpoints to the runtime's FastAPI server that accept materialized file payloads and manage the full app lifecycle internally. Workspace file operations become native HTTP endpoints instead of `_exec_workspace` shell hacks. App build status tracked in SQLite instead of Redis. Backend simplifies to a thin business layer (auth, marketplace resolution, analytics) that delegates execution to runtime APIs.

**Tech Stack:** Python 3.12, FastAPI, SQLite (runtime_local_state), YAML, asyncio

**Repos:**
- Runtime changes: `hola-boss-oss/runtime/src/sandbox_agent_runtime/`
- Backend changes: `hola-boss-ai/src/services/workspaces/`

---

## Phase 1: App Lifecycle Management

### Task 1: Add app_builds table to SQLite

**Files:**
- Modify: `src/sandbox_agent_runtime/runtime_local_state.py`

**Step 1: Add the schema**

Add to `ensure_runtime_db_schema()` after the existing CREATE TABLE statements:

```sql
CREATE TABLE IF NOT EXISTS app_builds (
    workspace_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, app_id)
);
```

**Step 2: Add CRUD functions**

```python
def upsert_app_build(
    *,
    workspace_id: str,
    app_id: str,
    status: str,
    error: str | None = None,
) -> dict[str, Any]:
    """Insert or update app build status."""

def get_app_build(*, workspace_id: str, app_id: str) -> dict[str, Any] | None:
    """Get build status for an app."""

def delete_app_build(*, workspace_id: str, app_id: str) -> bool:
    """Remove build status entry."""
```

**Step 3: Commit**

```bash
git add src/sandbox_agent_runtime/runtime_local_state.py
git commit -m "feat: add app_builds table for tracking app setup status"
```

---

### Task 2: Add workspace.yaml manipulation helpers

**Files:**
- Create: `src/sandbox_agent_runtime/workspace_yaml.py`

**Step 1: Write the module**

Port `_append_application_to_workspace_yaml` and `_remove_application_from_workspace_yaml` from `backend/src/services/workspaces/workspace_service.py`. These are pure YAML manipulation functions.

```python
"""Helpers for reading and modifying workspace.yaml."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def read_workspace_yaml(workspace_dir: str | Path) -> str | None:
    """Read workspace.yaml content, return None if missing."""
    path = Path(workspace_dir) / "workspace.yaml"
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")


def write_workspace_yaml(workspace_dir: str | Path, content: str) -> None:
    """Write workspace.yaml content."""
    path = Path(workspace_dir) / "workspace.yaml"
    path.write_text(content, encoding="utf-8")


def parse_workspace_yaml(content: str | None) -> dict[str, Any]:
    """Parse workspace.yaml content into dict, return empty dict if None."""
    if not content:
        return {}
    loaded = yaml.safe_load(content)
    return loaded if isinstance(loaded, dict) else {}


def append_application(
    workspace_yaml: str | None,
    *,
    app_id: str,
    config_path: str,
    lifecycle: dict[str, str] | None = None,
) -> str:
    """Add an application entry to workspace.yaml. Returns updated YAML string."""
    data = parse_workspace_yaml(workspace_yaml)
    apps = data.get("applications", [])
    if not isinstance(apps, list):
        apps = []

    # Don't duplicate
    if any(a.get("app_id") == app_id for a in apps if isinstance(a, dict)):
        return yaml.dump(data, default_flow_style=False, sort_keys=False)

    entry: dict[str, Any] = {"app_id": app_id, "config_path": config_path}
    if lifecycle:
        entry["lifecycle"] = lifecycle
    apps.append(entry)
    data["applications"] = apps
    return yaml.dump(data, default_flow_style=False, sort_keys=False)


def remove_application(workspace_yaml: str | None, *, app_id: str) -> str:
    """Remove an application entry from workspace.yaml. Returns updated YAML string."""
    data = parse_workspace_yaml(workspace_yaml)
    apps = data.get("applications", [])
    if isinstance(apps, list):
        data["applications"] = [a for a in apps if not (isinstance(a, dict) and a.get("app_id") == app_id)]
    return yaml.dump(data, default_flow_style=False, sort_keys=False)


def list_application_ids(workspace_yaml: str | None) -> list[str]:
    """Extract app_id list from workspace.yaml."""
    data = parse_workspace_yaml(workspace_yaml)
    apps = data.get("applications", [])
    if not isinstance(apps, list):
        return []
    return [a["app_id"] for a in apps if isinstance(a, dict) and "app_id" in a]
```

**Step 2: Commit**

```bash
git add src/sandbox_agent_runtime/workspace_yaml.py
git commit -m "feat: add workspace.yaml manipulation helpers"
```

---

### Task 3: Add app install endpoint

**Files:**
- Modify: `src/sandbox_agent_runtime/api.py`

**Step 1: Add request/response models**

```python
class InstallAppRequest(BaseModel):
    app_id: str = Field(..., min_length=1)
    workspace_id: str = Field(..., min_length=1)
    files: list[dict[str, Any]]  # [{path, content_base64, executable?}]

class InstallAppResponse(BaseModel):
    app_id: str
    status: str  # "installed" or "setup_started"
    detail: str
```

**Step 2: Add the endpoint**

```python
@app.post("/api/v1/apps/install")
async def install_app(payload: InstallAppRequest) -> InstallAppResponse:
    """Install an app from materialized files.

    1. Write files to apps/{app_id}/
    2. Parse app.runtime.yaml for lifecycle config
    3. Register in workspace.yaml
    4. Start background setup if lifecycle.setup exists
    5. Track build status in SQLite
    """
```

Implementation:
- Resolve workspace dir from `workspace_id` via `workspace_dir_for_id()`
- Create `apps/{app_id}/` directory
- Write each file from `files` list (base64 decode, mkdir parents, chmod if executable)
- Parse `apps/{app_id}/app.runtime.yaml` using `_parse_app_runtime_yaml()`
- Read workspace.yaml, append application entry with lifecycle, write back
- If `lifecycle.setup` exists, spawn background task + track in `app_builds` table
- Return immediately with status

**Step 3: Add the background setup runner**

```python
async def _run_app_setup(
    *,
    workspace_dir: str,
    workspace_id: str,
    app_id: str,
    setup_command: str,
) -> None:
    """Execute lifecycle.setup in background, track status in SQLite."""
    upsert_app_build(workspace_id=workspace_id, app_id=app_id, status="building")
    try:
        proc = await asyncio.create_subprocess_shell(
            setup_command,
            cwd=f"{workspace_dir}/apps/{app_id}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        if proc.returncode != 0:
            error_detail = stderr.decode("utf-8", errors="replace")[:2000]
            upsert_app_build(workspace_id=workspace_id, app_id=app_id, status="failed", error=error_detail)
            return
        upsert_app_build(workspace_id=workspace_id, app_id=app_id, status="completed")
    except asyncio.TimeoutError:
        upsert_app_build(workspace_id=workspace_id, app_id=app_id, status="failed", error="setup timed out after 300s")
    except Exception as exc:
        upsert_app_build(workspace_id=workspace_id, app_id=app_id, status="failed", error=str(exc)[:2000])
```

**Step 4: Commit**

```bash
git add src/sandbox_agent_runtime/api.py
git commit -m "feat: add POST /api/v1/apps/install endpoint"
```

---

### Task 4: Add app uninstall endpoint

**Files:**
- Modify: `src/sandbox_agent_runtime/api.py`

**Step 1: Add the endpoint**

```python
class UninstallAppRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)

@app.delete("/api/v1/apps/{app_id}")
async def uninstall_app(app_id: str, payload: UninstallAppRequest) -> AppActionResult:
    """Uninstall an app.

    1. Stop app process if running
    2. Remove files from apps/{app_id}/
    3. Remove from workspace.yaml
    4. Clean up build status
    """
```

Implementation:
- Resolve workspace dir
- Try to stop via `ApplicationLifecycleManager` (best effort)
- `shutil.rmtree(apps/{app_id}/)` to remove files
- Read workspace.yaml, remove application entry, write back
- `delete_app_build()` to clean up SQLite
- Return result

**Step 2: Commit**

```bash
git add src/sandbox_agent_runtime/api.py
git commit -m "feat: add DELETE /api/v1/apps/{app_id} endpoint"
```

---

### Task 5: Add app build-status and list endpoints

**Files:**
- Modify: `src/sandbox_agent_runtime/api.py`

**Step 1: Add build-status endpoint**

```python
@app.get("/api/v1/apps/{app_id}/build-status")
async def app_build_status(app_id: str, workspace_id: str = Query(...)) -> dict[str, Any]:
    """Get app build/setup status from SQLite."""
    record = get_app_build(workspace_id=workspace_id, app_id=app_id)
    if record is None:
        return {"status": "unknown"}
    return record
```

**Step 2: Add list apps endpoint**

```python
@app.get("/api/v1/apps")
async def list_apps(workspace_id: str = Query(...)) -> dict[str, Any]:
    """List installed apps from workspace.yaml with build status."""
```

Implementation:
- Read workspace.yaml, parse applications list
- For each app, fetch build status from SQLite
- Return combined list

**Step 3: Commit**

```bash
git add src/sandbox_agent_runtime/api.py
git commit -m "feat: add app list and build-status endpoints"
```

---

### Task 6: Add app setup (re-run) endpoint

**Files:**
- Modify: `src/sandbox_agent_runtime/api.py`

**Step 1: Add endpoint**

```python
class AppSetupRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)

@app.post("/api/v1/apps/{app_id}/setup")
async def setup_app(app_id: str, payload: AppSetupRequest) -> AppActionResult:
    """Re-run lifecycle.setup for an app."""
```

Implementation:
- Resolve workspace dir, read app.runtime.yaml
- Extract lifecycle.setup command
- If empty, return {"status": "no_setup_command"}
- Spawn `_run_app_setup()` background task
- Return {"status": "setup_started"}

**Step 2: Commit**

```bash
git add src/sandbox_agent_runtime/api.py
git commit -m "feat: add POST /api/v1/apps/{app_id}/setup endpoint"
```

---

## Phase 2: Template Application (Atomic)

### Task 7: Add apply-template endpoint

**Files:**
- Modify: `src/sandbox_agent_runtime/api.py`

**Step 1: Add request model and endpoint**

```python
class ApplyTemplateRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    files: list[dict[str, Any]]  # [{path, content_base64, executable?}]
    replace_existing: bool = False

@app.post("/api/v1/workspaces/{workspace_id}/apply-template")
async def apply_template(workspace_id: str, payload: ApplyTemplateRequest) -> dict[str, Any]:
    """Atomically apply a materialized template to a workspace.

    If replace_existing=True, clears workspace first (preserving .holaboss/ and workspace.json).
    Writes all files in a single operation.
    """
```

Implementation:
- Resolve workspace dir via `workspace_dir_for_id(workspace_id)`
- If `replace_existing`, remove all top-level entries except `.holaboss` and `workspace.json`
- For each file in `files`:
  - base64 decode content
  - create parent directories
  - write file
  - set executable bit if flagged
- Return `{"status": "applied", "files_written": len(files)}`

**Step 2: Commit**

```bash
git add src/sandbox_agent_runtime/api.py
git commit -m "feat: add POST /workspaces/{id}/apply-template endpoint"
```

---

## Phase 3: File I/O, Snapshot, Export

### Task 8: Add workspace file read/write endpoints

**Files:**
- Modify: `src/sandbox_agent_runtime/api.py`

**Step 1: Add read endpoint**

```python
@app.get("/api/v1/workspaces/{workspace_id}/files/{file_path:path}")
async def read_workspace_file(workspace_id: str, file_path: str) -> dict[str, Any]:
    """Read a file from the workspace. Returns content as string or base64."""
```

Implementation:
- Validate path (no traversal, no absolute)
- Resolve full path: `workspace_dir / file_path`
- If file doesn't exist, 404
- Try UTF-8 decode; if fails, return base64
- Return `{"path": file_path, "content": ..., "encoding": "utf-8"|"base64"}`

**Step 2: Add write endpoint**

```python
class WriteFileRequest(BaseModel):
    content_base64: str
    executable: bool = False

@app.put("/api/v1/workspaces/{workspace_id}/files/{file_path:path}")
async def write_workspace_file(workspace_id: str, file_path: str, payload: WriteFileRequest) -> dict[str, Any]:
    """Write a file to the workspace."""
```

Implementation:
- Validate path
- Create parent dirs
- Base64 decode and write
- Set executable if flagged
- Return `{"path": file_path, "status": "written"}`

**Step 3: Commit**

```bash
git add src/sandbox_agent_runtime/api.py
git commit -m "feat: add workspace file read/write endpoints"
```

---

### Task 9: Add workspace snapshot endpoint

**Files:**
- Modify: `src/sandbox_agent_runtime/api.py`

**Step 1: Add endpoint**

```python
@app.get("/api/v1/workspaces/{workspace_id}/snapshot")
async def workspace_snapshot(workspace_id: str) -> dict[str, Any]:
    """Return workspace filesystem metadata + git state.

    Replaces the 150-line embedded Python script in sandbox_runtime_client.
    """
```

Implementation (native Python, no subprocess):
- Walk workspace directory tree
- Collect: file paths, sizes, modification times
- Count file extensions
- Read preview of key files (workspace.yaml, README.md, AGENTS.md — first 500 bytes)
- Check git state: `subprocess.run(["git", "rev-parse", ...])` for branch, dirty state
- Return structured dict

This replaces `sandbox_runtime_client.read_workspace_runtime_snapshot()` which embeds 150 lines of Python in a shell command.

**Step 2: Commit**

```bash
git add src/sandbox_agent_runtime/api.py
git commit -m "feat: add native workspace snapshot endpoint"
```

---

### Task 10: Add workspace export endpoint

**Files:**
- Modify: `src/sandbox_agent_runtime/api.py`

**Step 1: Add endpoint**

```python
@app.get("/api/v1/workspaces/{workspace_id}/export")
async def export_workspace(workspace_id: str) -> StreamingResponse:
    """Export workspace as streaming tar.gz (no base64 encoding)."""
```

Implementation:
- Resolve workspace dir
- Create tar.gz in memory or temp file, excluding: `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.venv`, `.hb_*`
- Return `StreamingResponse` with `media_type="application/gzip"`

This replaces `sandbox_runtime_client.export_workspace_files()` which shells out `tar | base64`.

**Step 2: Commit**

```bash
git add src/sandbox_agent_runtime/api.py
git commit -m "feat: add streaming workspace export endpoint"
```

---

## Phase 4: Backend Simplification

### Task 11: Add runtime client methods for new endpoints

**Files:**
- Modify: `backend/src/services/workspaces/sandbox_runtime_client.py`

**Step 1: Add new client methods**

```python
async def install_app(
    self, *, holaboss_user_id: str, workspace_id: str, app_id: str, files: list[dict],
) -> dict:
    """Call runtime POST /api/v1/apps/install"""

async def uninstall_app(
    self, *, holaboss_user_id: str, workspace_id: str, app_id: str,
) -> dict:
    """Call runtime DELETE /api/v1/apps/{app_id}"""

async def get_app_build_status_from_runtime(
    self, *, holaboss_user_id: str, workspace_id: str, app_id: str,
) -> dict:
    """Call runtime GET /api/v1/apps/{app_id}/build-status"""

async def setup_app(
    self, *, holaboss_user_id: str, workspace_id: str, app_id: str,
) -> dict:
    """Call runtime POST /api/v1/apps/{app_id}/setup"""

async def apply_template_atomic(
    self, *, holaboss_user_id: str, workspace_id: str, files: list[dict], replace_existing: bool,
) -> dict:
    """Call runtime POST /api/v1/workspaces/{id}/apply-template"""

async def read_file(
    self, *, holaboss_user_id: str, workspace_id: str, file_path: str,
) -> dict | None:
    """Call runtime GET /api/v1/workspaces/{id}/files/{path}"""

async def write_file(
    self, *, holaboss_user_id: str, workspace_id: str, file_path: str, content_base64: str, executable: bool = False,
) -> dict:
    """Call runtime PUT /api/v1/workspaces/{id}/files/{path}"""

async def get_workspace_snapshot(
    self, *, holaboss_user_id: str, workspace_id: str,
) -> dict:
    """Call runtime GET /api/v1/workspaces/{id}/snapshot"""

async def export_workspace_stream(
    self, *, holaboss_user_id: str, workspace_id: str,
) -> bytes:
    """Call runtime GET /api/v1/workspaces/{id}/export"""
```

**Step 2: Commit**

```bash
git add src/services/workspaces/sandbox_runtime_client.py
git commit -m "feat: add runtime client methods for new self-contained endpoints"
```

---

### Task 12: Simplify workspace_service app methods

**Files:**
- Modify: `backend/src/services/workspaces/workspace_service.py`

**Step 1: Simplify add_application()**

Replace the current multi-step orchestration:

```python
async def add_application(self, *, workspace_id, holaboss_user_id, app_id, template_name, template_ref=None):
    workspace = await self.manager.get_workspace(workspace_id, holaboss_user_id=holaboss_user_id)

    # Resolve template → materialized files (business logic stays in backend)
    template = self.app_template_resolver.resolve(name=template_name)
    effective_ref = template_ref or template.default_ref
    resolved = ResolvedTemplate(
        name=template.name, repo=template.repo, path=template.path,
        effective_ref=effective_ref, effective_commit=None, source="app_template",
    )
    materialized = await asyncio.to_thread(self.template_materializer.materialize, resolved)

    # Delegate execution to runtime
    result = await self.sandbox_runtime_client.install_app(
        holaboss_user_id=holaboss_user_id,
        workspace_id=workspace.id,
        app_id=app_id,
        files=[
            {"path": f.path, "content_base64": f.content_base64, "executable": f.executable}
            for f in materialized.files
        ],
    )
    return {"app_id": app_id, "status": result.get("status", "installed")}
```

**Step 2: Simplify remove_application()**

```python
async def remove_application(self, *, workspace_id, holaboss_user_id, app_id):
    workspace = await self.manager.get_workspace(workspace_id, holaboss_user_id=holaboss_user_id)
    return await self.sandbox_runtime_client.uninstall_app(
        holaboss_user_id=holaboss_user_id,
        workspace_id=workspace.id,
        app_id=app_id,
    )
```

**Step 3: Simplify setup_application()**

```python
async def setup_application(self, *, workspace_id, holaboss_user_id, app_id):
    workspace = await self.manager.get_workspace(workspace_id, holaboss_user_id=holaboss_user_id)
    return await self.sandbox_runtime_client.setup_app(
        holaboss_user_id=holaboss_user_id,
        workspace_id=workspace.id,
        app_id=app_id,
    )
```

**Step 4: Simplify get_app_build_status()**

```python
async def get_app_build_status(self, *, workspace_id, holaboss_user_id, app_id):
    workspace = await self.manager.get_workspace(workspace_id, holaboss_user_id=holaboss_user_id)
    return await self.sandbox_runtime_client.get_app_build_status_from_runtime(
        holaboss_user_id=holaboss_user_id,
        workspace_id=workspace.id,
        app_id=app_id,
    )
```

**Step 5: Simplify apply_materialized_template()**

In `create_workspace()`, replace:
```python
await self.sandbox_runtime_client.apply_materialized_template(...)
```
with:
```python
await self.sandbox_runtime_client.apply_template_atomic(...)
```

**Step 6: Commit**

```bash
git add src/services/workspaces/workspace_service.py
git commit -m "feat: simplify workspace_service to delegate to runtime API"
```

---

### Task 13: Simplify sandbox_runtime_client file operations

**Files:**
- Modify: `backend/src/services/workspaces/sandbox_runtime_client.py`

**Step 1: Replace read_workspace_yaml()**

```python
async def read_workspace_yaml(self, *, holaboss_user_id, workspace_id):
    result = await self.read_file(
        holaboss_user_id=holaboss_user_id,
        workspace_id=workspace_id,
        file_path="workspace.yaml",
    )
    return result["content"] if result else None
```

**Step 2: Replace write_workspace_yaml()**

```python
async def write_workspace_yaml(self, *, holaboss_user_id, workspace_id, content):
    await self.write_file(
        holaboss_user_id=holaboss_user_id,
        workspace_id=workspace_id,
        file_path="workspace.yaml",
        content_base64=base64.b64encode(content.encode("utf-8")).decode("ascii"),
    )
```

**Step 3: Replace read_workspace_file()**

```python
async def read_workspace_file(self, *, holaboss_user_id, workspace_id, relative_path):
    result = await self.read_file(
        holaboss_user_id=holaboss_user_id,
        workspace_id=workspace_id,
        file_path=relative_path,
    )
    return result["content"] if result else None
```

**Step 4: Replace read_workspace_runtime_snapshot()**

```python
async def read_workspace_runtime_snapshot(self, *, holaboss_user_id, workspace_id):
    return await self.get_workspace_snapshot(
        holaboss_user_id=holaboss_user_id,
        workspace_id=workspace_id,
    )
```

**Step 5: Remove deprecated methods**

Delete:
- `bootstrap_app_from_template()` (replaced by `install_app`)
- `_build_template_clone_command()` app-related usage
- Old `apply_materialized_template()` (replaced by `apply_template_atomic`)
- Old `write_workspace_file_base64()` (replaced by `write_file`)
- The 150-line embedded Python in `read_workspace_runtime_snapshot` (replaced by `get_workspace_snapshot`)

**Step 6: Commit**

```bash
git add src/services/workspaces/sandbox_runtime_client.py
git commit -m "feat: replace shell command orchestration with runtime API calls"
```

---

### Task 14: Remove _background_install_template_apps

**Files:**
- Modify: `backend/src/services/workspaces/workspace_service.py`

**Step 1: Update create_workspace()**

With the new materialize flow (`3e3a39f`), app files are already written during `apply_template_atomic()`. The workspace.yaml already has application entries. All that's needed is to run setup for each app.

Replace:
```python
if template_meta and template_meta.apps:
    task = asyncio.create_task(
        self._background_install_template_apps(...)
    )
```

With:
```python
if template_meta and template_meta.apps:
    task = asyncio.create_task(
        self._background_setup_template_apps(
            workspace_id=created_workspace.id,
            holaboss_user_id=payload.holaboss_user_id,
            app_names=list(template_meta.apps),
        )
    )
```

Where `_background_setup_template_apps` simply calls `setup_app()` for each app (no more `add_application` loop):

```python
async def _background_setup_template_apps(self, *, workspace_id, holaboss_user_id, app_names):
    for app_name in app_names:
        try:
            await self.sandbox_runtime_client.setup_app(
                holaboss_user_id=holaboss_user_id,
                workspace_id=workspace_id,
                app_id=app_name,
            )
        except Exception:
            self.logger.warning("Failed to setup template app %s", app_name, exc_info=True)
```

**Step 2: Delete old methods**

- `_background_install_template_apps()` — no longer needed
- `_background_setup_app()` — replaced by runtime-internal setup
- `_read_app_lifecycle_config()` — runtime reads this internally now
- `_get_app_lifecycle_from_workspace_yaml()` — runtime handles this

**Step 3: Commit**

```bash
git add src/services/workspaces/workspace_service.py
git commit -m "feat: replace background app install with runtime setup delegation"
```

---

## Phase 5: Tests & Verification

### Task 15: Add runtime tests

**Files:**
- Create: `tests/sandbox_agent_runtime/test_app_lifecycle.py`
- Create: `tests/sandbox_agent_runtime/test_workspace_yaml.py`
- Create: `tests/sandbox_agent_runtime/test_file_endpoints.py`

**Step 1: Test workspace_yaml helpers**

```python
def test_append_application_to_empty_yaml():
    result = append_application(None, app_id="twitter", config_path="apps/twitter/app.runtime.yaml")
    data = yaml.safe_load(result)
    assert len(data["applications"]) == 1
    assert data["applications"][0]["app_id"] == "twitter"

def test_append_application_no_duplicate():
    yaml_str = append_application(None, app_id="twitter", config_path="apps/twitter/app.runtime.yaml")
    result = append_application(yaml_str, app_id="twitter", config_path="apps/twitter/app.runtime.yaml")
    data = yaml.safe_load(result)
    assert len(data["applications"]) == 1

def test_remove_application():
    yaml_str = append_application(None, app_id="twitter", config_path="apps/twitter/app.runtime.yaml")
    result = remove_application(yaml_str, app_id="twitter")
    data = yaml.safe_load(result)
    assert len(data["applications"]) == 0
```

**Step 2: Test app install endpoint (integration)**

```python
@pytest.mark.asyncio
async def test_install_app(test_client, tmp_workspace):
    # Create minimal app.runtime.yaml content
    app_yaml = base64.b64encode(b"""
app_id: test-app
mcp:
  port: 3099
  path: /mcp
lifecycle:
  setup: "echo setup done"
  start: "echo started"
""".strip()).decode()

    response = await test_client.post("/api/v1/apps/install", json={
        "app_id": "test-app",
        "workspace_id": tmp_workspace,
        "files": [
            {"path": "app.runtime.yaml", "content_base64": app_yaml},
        ],
    })
    assert response.status_code == 200
    assert response.json()["status"] in ("installed", "setup_started")
    # Verify files written
    # Verify workspace.yaml updated
```

**Step 3: Run tests**

```bash
cd runtime && uv run pytest tests/ -v
```

**Step 4: Commit**

```bash
git add tests/
git commit -m "test: add runtime app lifecycle and file endpoint tests"
```

---

### Task 16: Final verification

**Step 1: Rebuild and deploy**

```bash
cd backend && bash scripts/local_deploy.sh start --rebuild-sandbox-base
```

**Step 2: Manual testing checklist**

- [ ] Install an app via new runtime API
- [ ] Verify files written to workspace
- [ ] Verify workspace.yaml updated
- [ ] Verify build-status endpoint returns progress
- [ ] Verify setup completes successfully
- [ ] Start and stop the app
- [ ] Uninstall the app
- [ ] Create workspace with social_media template — apps auto-setup
- [ ] Apply template atomically — files written in one call
- [ ] Read/write workspace files via new endpoints
- [ ] Get workspace snapshot via native endpoint
- [ ] Export workspace as streaming tarball

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete runtime self-contained operations migration"
```
