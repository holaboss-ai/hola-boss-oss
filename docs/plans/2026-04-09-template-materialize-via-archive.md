# Template Materialization via Archives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the two existing app distribution paths — desktop `install-archive` (already prebuilt-archive-based) and backend template materialization (still git-clone + source-materialize) — so that both run through a single flow: download a prebuilt `.tar.gz` archive, extract it, register in `workspace.yaml`, and start via the normal lifecycle.

**Architecture:** The runtime's existing `POST /api/v1/apps/install-archive` endpoint gains an `archive_url` mode. The backend stops cloning the modules repo to bundle app source into materialized templates; instead, after the workspace shell is written, it calls `install-archive` with an archive URL for each required app. The `AppTemplateMetadata` catalog entry stores a `archive_url_template` string directly — no GitHub API calls, no TTL cache, no env var resolution. MCP tool name discovery moves from Python source-grep to authors declaring `mcp.tools` in `app.runtime.yaml`.

**Tech Stack:**
- Python 3.11, FastAPI, httpx, pydantic (backend)
- TypeScript, Fastify, `tar` npm package, Node 18+ `fetch` (runtime)
- No desktop changes (the renderer already uses the unified flow)

**Reference**
- Predecessor spec: `docs/plans/2026-04-09-desktop-install-app-design.md`
- Publishing doc: `../hola-boss-apps/docs/publishing.md`
- Current state analysis: the trace in the conversation thread that led to this plan

---

## Scope

### In scope
- `hola-boss-apps`: each module's `app.runtime.yaml` declares `mcp.tools` statically
- Runtime (`holaOS/runtime/api-server`): `install-archive` accepts `archive_url`; post-extract, MCP registry entries are written to `workspace.yaml` from the parsed `mcp.tools` list
- Backend (`holaboss/backend`): `AppTemplateMetadata` simplified to store `archive_url_template` directly; `app_archive_version.py` deleted; `_materialize_template_with_apps` no longer bundles app source; `_provision_workspace` calls `install-archive` per app
- Delete the now-unused `APP_ARCHIVE_VERSION` env var path and its tests

### Out of scope
- Changing the archive build process (`hola-boss-apps/scripts/build-archive.sh`)
- Removing the legacy `POST /api/v1/apps/install` (files[] path) — left in place, marked deprecated
- Version pinning for user-published submissions — user templates auto-upgrade with the catalog
- Changes to how apps surface in `AppSurfacePane` (iframe URL resolution, etc.)
- Desktop changes (already on the target path)

---

## File Structure

### `hola-boss-apps` (module apps repo)
- Modify: `twitter/app.runtime.yaml`
- Modify: `linkedin/app.runtime.yaml`
- Modify: `reddit/app.runtime.yaml`
- Modify: `gmail/app.runtime.yaml`
- Modify: `sheets/app.runtime.yaml`
- Modify: `github/app.runtime.yaml`
- Modify: `_template/app.runtime.yaml`

### `holaOS/runtime/api-server`
- Modify: `src/app.ts` — extend `install-archive` route; add `downloadArchiveToTemp`; add `isAllowedArchiveUrl`; extend `parseInstalledAppRuntime` signature
- Create helper file OR inline in `src/app.ts`: `writeWorkspaceMcpRegistryEntry` / `removeWorkspaceMcpRegistryEntry` in `src/workspace-apps.ts`
- Modify: `src/workspace-apps.ts` — add MCP registry writer/remover
- Modify: `src/app.test.ts` — tests for `archive_url`, MCP registry writer, allowlist

### `holaboss/backend`
- **Delete:** `src/services/marketplace/app_archive_version.py`
- **Delete:** `test/services/marketplace/test_app_archive_version.py`
- Modify: `src/config/environment.py` — drop `app_archive_version` field
- Modify: `src/api/v1/marketplace/templates.py` — `AppTemplateMetadata` drops `version`/`archives` fields and gains `archive_url_template: str` + `archive_version: str | None`; `_default_app_templates` updated
- Modify: `src/api/v1/marketplace/routes/templates.py` — `list_app_templates` does string substitution (no version resolver import)
- Modify: `test/api/v1/marketplace/test_app_templates.py` — updated to the new shape
- Modify: `src/services/workspaces/sandbox_runtime_client.py` — add `install_app_from_archive_via_runtime`; mark old `install_app_via_runtime` deprecated
- Modify: `src/api/v1/sandbox_runtime/routes/applications.py` — new proxy route for install-archive
- Modify: `src/services/workspaces/template_utils.py` — `_materialize_template_with_apps` gutted; `_extract_app_template_binding` deprecated
- Modify: `src/services/workspaces/workspace_service.py` — `_provision_workspace` calls `install_app_from_archive_via_runtime` per app; delete `_background_setup_template_apps` invocation
- Modify: `docs/work_log.md` — append entry

---

## Design Notes

### `AppTemplateMetadata` shape (target)

```python
class AppTemplateMetadata(BaseModel):
    name: str
    repo: str
    path: str = "."
    default_ref: str = "main"
    description: str | None = None
    readme: str | None = None
    is_hidden: bool = False
    is_coming_soon: bool = False
    allowed_user_ids: list[str] = Field(default_factory=list)
    icon: str | None = None
    category: str = "general"
    tags: list[str] = Field(default_factory=list)

    # New, replacing `version` + `archives`
    archive_url_template: str  # e.g. "https://github.com/holaboss-ai/holaboss-modules/releases/download/v0.1.0/twitter-module-{target}.tar.gz"
    archive_version: str | None = None  # display-only, e.g. "v0.1.0"
```

### Response contract stability

The `/api/v1/marketplace/app-templates` response shape **does not change**. The handler still returns each template with `version` and `archives: list[{target, url}]` fields — they are just computed by string substitution on the new `archive_url_template` instead of by `build_archive_urls(name, version)`. The desktop (which consumes this response) needs zero changes.

### MCP tools static declaration

Module authors declare the MCP tool list directly in `app.runtime.yaml`:

```yaml
mcp:
  enabled: true
  transport: http-sse
  port: 3099
  path: /mcp/sse
  tools:
    - create_post
    - list_posts
    - get_post
    - update_post
    - publish_post
```

The runtime's `parseInstalledAppRuntime` reads this list and passes it to `writeWorkspaceMcpRegistryEntry`, which prefixes each name with the `app_id` (e.g. `twitter.create_post`) and writes it to `workspace.yaml`'s `mcp_registry.allowlist.tool_ids`.

### `install-archive` dual mode

Request body accepts EITHER `archive_path` (existing, filesystem path) OR `archive_url` (new, HTTPS URL). Exactly one must be present. If `archive_url`, the runtime:
1. Validates URL via `isAllowedArchiveUrl`
2. Downloads to `os.tmpdir()/holaboss-app-archives/{appId}-{ts}.tar.gz` via Node `fetch`
3. Falls through to the existing extraction path with that temp file
4. Deletes the temp file in `finally`, regardless of success

URL allowlist: by default, only `https://github.com/holaboss-ai/holaboss-modules/releases/download/`. Overridable via `HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST` env var (comma-separated prefix list).

### `_provision_workspace` new shape

```python
async def _provision_workspace(self, workspace_id, payload, ...):
    # ... existing template materialize (now WITHOUT apps/* files) ...
    # ... existing workspace.yaml skeleton write ...

    # Resolve which apps to install
    final_app_names = validate_selected_apps(...)  # existing
    if final_app_names:
        target = _resolve_sandbox_target(provider)  # "linux-x64" for docker/fly, host arch for desktop
        for app_name in final_app_names:
            app_meta = self.app_template_resolver.resolve(name=app_name)
            archive_url = app_meta.archive_url_template.replace("{target}", target)
            try:
                await self.sandbox_runtime_client.install_app_from_archive_via_runtime(
                    user_id=payload.holaboss_user_id,
                    workspace_id=workspace_id,
                    app_id=app_name,
                    archive_url=archive_url,
                )
            except Exception as exc:
                # Mark workspace as errored but don't rollback — install-archive
                # already cleaned up appDir on extraction failure
                logger.exception("workspace.provision.app_install_failed",
                    extra={"event": "workspace.provision", "outcome": "error",
                           "workspace_id": workspace_id, "app_id": app_name})
                raise
```

Critical: this replaces the `_background_setup_template_apps` fire-and-forget pattern. Apps are now installed synchronously during workspace creation. If any app fails, the workspace is marked errored and the user gets immediate feedback instead of finding out later.

### `_resolve_sandbox_target` — how to pick the right target

```python
def _resolve_sandbox_target(provider: str) -> str:
    if provider in ("docker_container", "fly"):
        return "linux-x64"
    if provider == "desktop":
        # Match the host's arch — the desktop already has a resolveLocalArchiveTarget
        # helper in TypeScript; mirror its logic here
        import platform
        system = platform.system()
        machine = platform.machine()
        if system == "Darwin" and machine == "arm64":
            return "darwin-arm64"
        if system == "Linux" and machine == "x86_64":
            return "linux-x64"
        if system == "Windows" and machine == "AMD64":
            return "win32-x64"
        raise RuntimeError(f"Unsupported desktop sandbox target: {system}/{machine}")
    raise RuntimeError(f"Unknown sandbox provider: {provider}")
```

---

## Phase 0 — `hola-boss-apps`: declare `mcp.tools` statically

### Task P0.1: Twitter module

**Files:**
- Modify: `hola-boss-apps/twitter/app.runtime.yaml`

- [ ] **Step 1: Inspect current YAML + source tool names**

```bash
cd /Users/joshua/holaboss-ai/holaboss/hola-boss-apps/twitter
cat app.runtime.yaml
grep -rn "tool(" src/server/mcp.ts 2>/dev/null | head -20
```

Record the exact tool names declared in `src/server/mcp.ts` via `tool("name", ...)` calls. These are the names you'll add to `mcp.tools`.

- [ ] **Step 2: Add `mcp.tools` list**

Open `hola-boss-apps/twitter/app.runtime.yaml`. Find the `mcp:` block. Add a `tools:` list as the last key under `mcp`:

```yaml
mcp:
  enabled: true
  transport: http-sse
  port: 3099
  path: /mcp/sse
  tools:
    - create_post
    - list_posts
    - get_post
    - update_post
    - publish_post
```

Use the EXACT names you recorded from Step 1. If the list you grep'd contains more than the 5 shown above, use all of them. If fewer, use what's there.

- [ ] **Step 3: Verify YAML parses**

```bash
python3 -c "import yaml; d = yaml.safe_load(open('app.runtime.yaml')); print(d['mcp']['tools'])"
```

Expected: prints the list of tool names.

- [ ] **Step 4: Commit once at the end of Phase 0** — do not commit per module; batch them all in Task P0.8.

### Tasks P0.2 – P0.6: Remaining modules

Repeat Task P0.1 for each of: `linkedin`, `reddit`, `gmail`, `sheets`, `github`. For each module:
- [ ] P0.2 — `linkedin/app.runtime.yaml`: `mcp.tools` list from `linkedin/src/server/mcp.ts`
- [ ] P0.3 — `reddit/app.runtime.yaml`: `mcp.tools` list from `reddit/src/server/mcp.ts`
- [ ] P0.4 — `gmail/app.runtime.yaml`: `mcp.tools` list from `gmail/src/server/mcp.ts`
- [ ] P0.5 — `sheets/app.runtime.yaml`: `mcp.tools` list from `sheets/src/server/mcp.ts`
- [ ] P0.6 — `github/app.runtime.yaml`: `mcp.tools` list from `github/src/server/mcp.ts`

### Task P0.7: Template module

**Files:**
- Modify: `hola-boss-apps/_template/app.runtime.yaml`

- [ ] **Step 1: Add an empty `tools:` list with a comment**

```yaml
mcp:
  enabled: true
  transport: http-sse
  port: 3099
  path: /mcp/sse
  tools: []  # List MCP tool names exposed by src/server/mcp.ts (e.g. "create_post")
```

- [ ] **Step 2: Commit with the rest in Task P0.8**

### Task P0.8: Commit Phase 0

- [ ] **Step 1: Verify all 7 files are modified**

```bash
cd /Users/joshua/holaboss-ai/holaboss/hola-boss-apps
git status --short
```

Expected: exactly 7 files modified — `{twitter,linkedin,reddit,gmail,sheets,github,_template}/app.runtime.yaml`.

- [ ] **Step 2: Stage and commit**

```bash
git add twitter/app.runtime.yaml linkedin/app.runtime.yaml reddit/app.runtime.yaml \
        gmail/app.runtime.yaml sheets/app.runtime.yaml github/app.runtime.yaml \
        _template/app.runtime.yaml
git commit -m "chore(modules): declare mcp.tools statically in app.runtime.yaml

Tool name discovery previously relied on grep'ing src/server/mcp.ts
source files, which broke once apps started shipping as prebuilt
archives without source. Authors now declare their MCP tool list
explicitly in app.runtime.yaml's mcp.tools: field. The runtime reads
this list when registering the app in workspace.yaml's mcp_registry."
```

- [ ] **Step 3: Build a twitter archive locally for later validation**

```bash
./scripts/build-archive.sh twitter
ls dist/twitter-module-*.tar.gz
tar tzf dist/twitter-module-*.tar.gz | head  # confirm app.runtime.yaml is present
```

This archive is used in Phase 4 validation. No commit needed — it's a build artifact.

---

## Phase 1 — Backend simplification: drop version resolver

This phase REVERTS most of the version-resolver plumbing that landed in `feat/desktop-install-app` and replaces it with direct URL storage. The `/app-templates` response shape stays the same; only the internals change.

**Important:** Phase 1 can land before Phase 2 without breaking the desktop. The desktop consumes `/app-templates`'s `version` + `archives` fields, which still exist (just computed differently).

### Task B1.1: Update `_default_app_templates` with `archive_url_template`

**Files:**
- Modify: `backend/src/api/v1/marketplace/templates.py`

- [ ] **Step 1: Update `AppTemplateMetadata` to add the new fields**

Find the `AppTemplateMetadata` class. Replace the `version` + `archives` fields with:

```python
class AppTemplateMetadata(BaseModel):
    name: str
    repo: str
    path: str = "."
    default_ref: str = "main"
    description: str | None = None
    readme: str | None = None
    is_hidden: bool = False
    is_coming_soon: bool = False
    allowed_user_ids: list[str] = Field(default_factory=list)
    icon: str | None = None
    category: str = "general"
    tags: list[str] = Field(default_factory=list)
    # Static URL template; `{target}` substituted at response time.
    archive_url_template: str = ""
    archive_version: str | None = None  # display-only, e.g. "v0.1.0"
```

The `archive_url_template` defaults to empty string so existing tests that construct `AppTemplateMetadata` without passing it don't break. Production entries in `_default_app_templates` must fill it in.

Keep the existing `AppTemplateArchive` class — it's still used in the response.

- [ ] **Step 2: Update `_default_app_templates` to set `archive_url_template` for each entry**

Find `_default_app_templates`. For each of the 6 apps (twitter, github, linkedin, reddit, gmail, sheets), add these two fields to the constructor call:

```python
AppTemplateMetadata(
    name="twitter",
    repo=_MODULES_REPO,
    path="twitter",
    description="...",
    readme=_README_TWITTER,
    icon=f"{_TWEMOJI_CDN}/1f426.svg",
    category="social",
    tags=["social media", "twitter", "content"],
    archive_url_template="https://github.com/holaboss-ai/holaboss-modules/releases/download/v0.1.0/twitter-module-{target}.tar.gz",
    archive_version="v0.1.0",
),
```

Use `v0.1.0` as the initial version for all six (this is the first release tag per the publishing doc). Version bumps after this are one-line edits in this file.

- [ ] **Step 3: Verify imports still work**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run python -c "from api.v1.marketplace.templates import AppTemplateMetadata, _default_app_templates; t = _default_app_templates(); print([(x.name, x.archive_url_template[:60]) for x in t])"
```

Expected: prints the six app names and their URL template prefixes.

- [ ] **Step 4: Commit**

```bash
git add src/api/v1/marketplace/templates.py
git commit -m "feat(marketplace): store archive_url_template on AppTemplateMetadata"
```

### Task B1.2: Rewrite `list_app_templates` route without version resolver

**Files:**
- Modify: `backend/src/api/v1/marketplace/routes/templates.py`

- [ ] **Step 1: Remove the version resolver import**

Find the imports added in the previous feature:

```python
from services.marketplace.app_archive_version import (
    build_archive_urls,
    resolve_app_archive_version,
)
```

Delete these imports. Also delete the `from config.environment import environment_settings` import if it was added only for this route (check if any other code in the file uses it; if yes, keep it).

Delete the `logger` declaration if it was added only for this route's warning log.

- [ ] **Step 2: Rewrite the handler body**

Replace the current `list_app_templates` handler with:

```python
_SUPPORTED_TARGETS: tuple[str, ...] = ("darwin-arm64", "linux-x64", "win32-x64")


@templates_router.get(
    "/app-templates",
    response_model=AppTemplateListResponse,
    status_code=status.HTTP_200_OK,
    operation_id="listAppTemplates",
)
async def list_app_templates(request: Request) -> AppTemplateListResponse:
    resolver: AppTemplateResolver = request.app.state.app_template_resolver
    templates: list[AppTemplateMetadata] = []
    for tmpl in resolver.list_templates():
        archives = _expand_archives(tmpl.archive_url_template)
        templates.append(
            tmpl.model_copy(
                update={
                    "version": tmpl.archive_version,
                    "archives": archives,
                }
            )
        )
    return AppTemplateListResponse(templates=templates)


def _expand_archives(url_template: str) -> list[AppTemplateArchive]:
    if not url_template or "{target}" not in url_template:
        return []
    return [
        AppTemplateArchive(target=target, url=url_template.replace("{target}", target))
        for target in _SUPPORTED_TARGETS
    ]
```

Note: the response still has a `version` field because the desktop expects it. Sourced from `archive_version`. `archives` is computed via substitution.

But wait — `AppTemplateMetadata` itself no longer has `version` or `archives` fields. The `model_copy(update={"version": ..., "archives": ...})` call will fail because the model doesn't have those fields.

Solution: keep `version` + `archives` on `AppTemplateMetadata` as derived/optional fields that can be set via `model_copy`, OR introduce a separate `AppTemplateMetadataResponse` model that has those fields for the wire.

**Cleaner:** separate response model. Add this above the route handler:

```python
class AppTemplateMetadataResponse(AppTemplateMetadata):
    version: str | None = None
    archives: list[AppTemplateArchive] = Field(default_factory=list)


class AppTemplateListResponse(BaseModel):
    templates: list[AppTemplateMetadataResponse]
```

Move `AppTemplateListResponse` import or re-definition here. Check where it lives currently:

```bash
grep -n "class AppTemplateListResponse" src/api/v1/marketplace/templates.py src/api/v1/marketplace/routes/templates.py
```

If it's in `templates.py`, update the definition there:

```python
class AppTemplateMetadataResponse(AppTemplateMetadata):
    version: str | None = None
    archives: list[AppTemplateArchive] = Field(default_factory=list)


class AppTemplateListResponse(BaseModel):
    templates: list[AppTemplateMetadataResponse]
```

And the route handler becomes:

```python
from api.v1.marketplace.templates import (
    AppTemplateArchive,
    AppTemplateListResponse,
    AppTemplateMetadataResponse,
    AppTemplateResolver,
    # ... existing imports
)

async def list_app_templates(request: Request) -> AppTemplateListResponse:
    resolver: AppTemplateResolver = request.app.state.app_template_resolver
    templates: list[AppTemplateMetadataResponse] = []
    for tmpl in resolver.list_templates():
        archives = _expand_archives(tmpl.archive_url_template)
        templates.append(
            AppTemplateMetadataResponse(
                **tmpl.model_dump(),
                version=tmpl.archive_version,
                archives=archives,
            )
        )
    return AppTemplateListResponse(templates=templates)
```

- [ ] **Step 3: Run the existing endpoint tests (they'll fail because they patch `resolve_app_archive_version`)**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run pytest test/api/v1/marketplace/test_app_templates.py -v
```

Expected: BOTH tests fail because they patch `api.v1.marketplace.routes.templates.resolve_app_archive_version` which no longer exists.

- [ ] **Step 4: Commit (WIP — tests are red)**

```bash
git add src/api/v1/marketplace/templates.py src/api/v1/marketplace/routes/templates.py
git commit -m "refactor(marketplace): compute archives from archive_url_template

Replaces the runtime-version-resolution path (GitHub API + TTL cache +
env var) with a direct string-substitution approach. The
archive_url_template lives statically on AppTemplateMetadata; the route
handler substitutes {target} per platform at response time.

Existing tests are temporarily red; they will be updated in the next
commit."
```

### Task B1.3: Update the `/app-templates` tests

**Files:**
- Modify: `backend/test/api/v1/marketplace/test_app_templates.py`

- [ ] **Step 1: Rewrite both tests**

Replace the entire file body with:

```python
"""Tests for GET /api/v1/marketplace/app-templates."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1.marketplace.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_list_app_templates_expands_archives_for_all_targets(client: TestClient) -> None:
    resp = client.get("/api/v1/marketplace/app-templates")
    assert resp.status_code == 200
    payload = resp.json()

    twitter = next(t for t in payload["templates"] if t["name"] == "twitter")
    assert twitter["version"] == "v0.1.0"
    assert len(twitter["archives"]) == 3

    targets = {a["target"] for a in twitter["archives"]}
    assert targets == {"darwin-arm64", "linux-x64", "win32-x64"}

    darwin = next(a for a in twitter["archives"] if a["target"] == "darwin-arm64")
    assert darwin["url"] == (
        "https://github.com/holaboss-ai/holaboss-modules/releases/download/"
        "v0.1.0/twitter-module-darwin-arm64.tar.gz"
    )


def test_list_app_templates_handles_empty_url_template(client: TestClient, monkeypatch) -> None:
    """A template without an archive_url_template should report empty archives."""
    from api.v1.marketplace.templates import AppTemplateMetadata, AppTemplateResolver

    stub = AppTemplateMetadata(
        name="stub",
        repo="https://example.test/repo",
        path="stub",
        description="stub",
        archive_url_template="",
    )

    class _StubResolver(AppTemplateResolver):
        def list_templates(self, *, include_hidden: bool = False):
            return [stub]

    app = create_app()
    app.state.app_template_resolver = _StubResolver([stub])
    local_client = TestClient(app)

    resp = local_client.get("/api/v1/marketplace/app-templates")
    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload["templates"]) == 1
    assert payload["templates"][0]["version"] is None
    assert payload["templates"][0]["archives"] == []
```

The first test is an integration test against the real default templates — no patching needed, because there's no longer any network involved.

The second test replaces the old "falls back on version error" test. With the new model there is no network error to fall back from, but an empty URL template is still a valid degenerate case.

- [ ] **Step 2: Run the tests**

```bash
uv run pytest test/api/v1/marketplace/test_app_templates.py -v
```

Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add test/api/v1/marketplace/test_app_templates.py
git commit -m "test(marketplace): update app-templates tests to archive_url_template"
```

### Task B1.4: Delete `app_archive_version.py` and its tests

**Files:**
- **Delete:** `backend/src/services/marketplace/app_archive_version.py`
- **Delete:** `backend/test/services/marketplace/test_app_archive_version.py`

- [ ] **Step 1: Verify nothing else imports from the module**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
grep -rn "app_archive_version\|resolve_app_archive_version\|build_archive_urls" src/ test/ 2>/dev/null
```

Expected: no matches. If there are matches, investigate each one before deleting — something else is still referencing the module.

- [ ] **Step 2: Delete the files**

```bash
rm src/services/marketplace/app_archive_version.py
rm test/services/marketplace/test_app_archive_version.py
```

- [ ] **Step 3: Run the marketplace tests to confirm nothing broke**

```bash
uv run pytest test/api/v1/marketplace/test_app_templates.py test/services/marketplace/ -v 2>&1 | tail -20
```

Expected: all pass. If pytest complains about a missing file from a collection config, there might be an `__init__.py` or `conftest.py` that references the deleted test file — update that.

- [ ] **Step 4: Commit**

```bash
git add -A src/services/marketplace/ test/services/marketplace/
git status --short
git commit -m "chore(marketplace): delete app_archive_version module and tests

No longer needed — URL template substitution replaces the runtime
version resolver."
```

### Task B1.5: Delete `app_archive_version` setting from `EnvironmentSettings`

**Files:**
- Modify: `backend/src/config/environment.py`

- [ ] **Step 1: Remove the field**

Open `backend/src/config/environment.py`. Delete the line:

```python
app_archive_version: str = "latest"
```

- [ ] **Step 2: Verify the settings still construct**

```bash
uv run python -c "from config.environment import EnvironmentSettings; print(sorted(EnvironmentSettings.model_fields.keys()))"
```

Expected: `app_archive_version` is NOT in the list.

- [ ] **Step 3: Grep for any remaining references**

```bash
grep -rn "app_archive_version\|APP_ARCHIVE_VERSION" src/ test/ 2>/dev/null
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add src/config/environment.py
git commit -m "chore(config): remove APP_ARCHIVE_VERSION setting (unused)"
```

---

## Phase 2 — Runtime changes

### Task R2.1: Extend `parseInstalledAppRuntime` to extract `mcp.tools`

**Files:**
- Modify: `runtime/api-server/src/workspace-apps.ts` (or wherever `parseInstalledAppRuntime` lives)
- Modify: `runtime/api-server/src/app.test.ts`

- [ ] **Step 1: Locate `parseInstalledAppRuntime`**

```bash
grep -n "function parseInstalledAppRuntime\|ParsedInstalledApp" runtime/api-server/src/*.ts
```

Note its current signature and the `ParsedInstalledApp` interface shape.

- [ ] **Step 2: Write a failing test**

Append to `runtime/api-server/src/app.test.ts`:

```ts
test("parseInstalledAppRuntime extracts mcp.tools list", () => {
  const yamlBody = `
app_id: "twitter"
name: "Twitter"
slug: "twitter"

lifecycle:
  setup: "true"
  start: "true"
  stop: "true"

mcp:
  enabled: true
  transport: http-sse
  port: 3099
  path: /mcp/sse
  tools:
    - create_post
    - list_posts
    - publish_post
`;
  const parsed = parseInstalledAppRuntime(yamlBody, "twitter", "apps/twitter/app.runtime.yaml");
  assert.deepEqual(parsed.mcpTools, ["create_post", "list_posts", "publish_post"]);
});

test("parseInstalledAppRuntime returns empty mcpTools when not declared", () => {
  const yamlBody = `
app_id: "twitter"
name: "Twitter"
slug: "twitter"

lifecycle:
  setup: "true"
`;
  const parsed = parseInstalledAppRuntime(yamlBody, "twitter", "apps/twitter/app.runtime.yaml");
  assert.deepEqual(parsed.mcpTools, []);
});
```

Import `parseInstalledAppRuntime` at the top of the test file if not already imported.

- [ ] **Step 3: Run — expect failure**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server
npm test 2>&1 | tail -20
```

Expected: both new tests fail because `parsed.mcpTools` is undefined.

- [ ] **Step 4: Update `ParsedInstalledApp` interface**

In `workspace-apps.ts`, find the `ParsedInstalledApp` interface. Add:

```ts
export interface ParsedInstalledApp {
  // ... existing fields
  mcpTools: string[];
}
```

- [ ] **Step 5: Update `parseInstalledAppRuntime` implementation**

Find the function body. Where it parses the `mcp:` section, add extraction of `tools`:

```ts
function parseInstalledAppRuntime(
  yamlBody: string,
  appId: string,
  configPath: string,
): ParsedInstalledApp {
  // ... existing parsing ...

  const mcpBlock = isRecord(parsed.mcp) ? parsed.mcp : {};
  const rawTools = Array.isArray(mcpBlock.tools) ? mcpBlock.tools : [];
  const mcpTools = rawTools.filter((t): t is string => typeof t === "string" && t.trim().length > 0);

  return {
    // ... existing fields ...
    mcpTools,
  };
}
```

- [ ] **Step 6: Run tests**

```bash
npm test 2>&1 | tail -15
```

Expected: new tests pass; all pre-existing tests still pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/workspace-apps.ts runtime/api-server/src/app.test.ts
git commit -m "feat(runtime): parse mcp.tools from app.runtime.yaml"
```

### Task R2.2: Add `writeWorkspaceMcpRegistryEntry` and `removeWorkspaceMcpRegistryEntry`

**Files:**
- Modify: `runtime/api-server/src/workspace-apps.ts`
- Modify: `runtime/api-server/src/app.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `app.test.ts`:

```ts
test("writeWorkspaceMcpRegistryEntry adds server and tool_ids to workspace.yaml", async () => {
  const tmpWorkspace = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), "wmcp-test-"));
  try {
    // Seed a minimal workspace.yaml
    fsSync.writeFileSync(
      pathSync.join(tmpWorkspace, "workspace.yaml"),
      "template_id: test\nname: Test\n",
    );

    writeWorkspaceMcpRegistryEntry(tmpWorkspace, "twitter", {
      mcpEnabled: true,
      mcpTools: ["create_post", "list_posts"],
      mcpPath: "/mcp/sse",
      mcpTimeoutMs: 30000,
      mcpPort: 13100,
    });

    const yamlText = fsSync.readFileSync(pathSync.join(tmpWorkspace, "workspace.yaml"), "utf8");
    assert.match(yamlText, /mcp_registry:/);
    assert.match(yamlText, /servers:/);
    assert.match(yamlText, /twitter:/);
    assert.match(yamlText, /allowlist:/);
    assert.match(yamlText, /twitter\.create_post/);
    assert.match(yamlText, /twitter\.list_posts/);
  } finally {
    fsSync.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});

test("removeWorkspaceMcpRegistryEntry strips server and tool_ids", async () => {
  const tmpWorkspace = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), "wmcp-rm-test-"));
  try {
    fsSync.writeFileSync(
      pathSync.join(tmpWorkspace, "workspace.yaml"),
      `template_id: test
name: Test
mcp_registry:
  allowlist:
    tool_ids:
      - twitter.create_post
      - twitter.list_posts
      - linkedin.create_post
  servers:
    twitter:
      type: remote
      url: http://localhost:13100/mcp/sse
      enabled: true
    linkedin:
      type: remote
      url: http://localhost:13101/mcp/sse
      enabled: true
`,
    );

    removeWorkspaceMcpRegistryEntry(tmpWorkspace, "twitter");

    const yamlText = fsSync.readFileSync(pathSync.join(tmpWorkspace, "workspace.yaml"), "utf8");
    assert.doesNotMatch(yamlText, /twitter\.create_post/);
    assert.doesNotMatch(yamlText, /twitter\.list_posts/);
    assert.match(yamlText, /linkedin\.create_post/);
    assert.match(yamlText, /linkedin:/);
  } finally {
    fsSync.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server
npm test 2>&1 | tail -20
```

Expected: fails because the functions don't exist.

- [ ] **Step 3: Implement the writer**

In `workspace-apps.ts`, add a new exported function:

```ts
export interface McpRegistryEntryParams {
  mcpEnabled: boolean;
  mcpTools: string[];
  mcpPath: string | null;
  mcpTimeoutMs: number;
  mcpPort: number | null;
}

export function writeWorkspaceMcpRegistryEntry(
  workspaceDir: string,
  appId: string,
  params: McpRegistryEntryParams,
): void {
  if (!params.mcpEnabled) {
    return;
  }
  const yamlPath = path.join(workspaceDir, "workspace.yaml");
  const raw = fs.existsSync(yamlPath) ? fs.readFileSync(yamlPath, "utf8") : "";
  const data = (raw ? yaml.load(raw) : {}) as Record<string, unknown>;

  const registry = (data.mcp_registry as Record<string, unknown>) || {};
  const servers = (registry.servers as Record<string, unknown>) || {};
  const allowlist = (registry.allowlist as Record<string, unknown>) || {};
  const toolIds: string[] = Array.isArray(allowlist.tool_ids)
    ? (allowlist.tool_ids as unknown[]).filter((t): t is string => typeof t === "string")
    : [];

  // Add server entry
  const port = params.mcpPort ?? 13100;
  const mcpPath = params.mcpPath || "/mcp/sse";
  servers[appId] = {
    type: "remote",
    url: `http://localhost:${port}${mcpPath}`,
    enabled: true,
    timeout_ms: params.mcpTimeoutMs,
  };

  // Add tool ids (prefixed with appId.)
  const existingOther = toolIds.filter((id) => !id.startsWith(`${appId}.`));
  const newToolIds = [
    ...existingOther,
    ...params.mcpTools.map((name) => `${appId}.${name}`),
  ];

  allowlist.tool_ids = newToolIds;
  registry.servers = servers;
  registry.allowlist = allowlist;
  data.mcp_registry = registry;

  fs.writeFileSync(yamlPath, yaml.dump(data), "utf8");
}

export function removeWorkspaceMcpRegistryEntry(
  workspaceDir: string,
  appId: string,
): void {
  const yamlPath = path.join(workspaceDir, "workspace.yaml");
  if (!fs.existsSync(yamlPath)) {
    return;
  }
  const raw = fs.readFileSync(yamlPath, "utf8");
  const data = (yaml.load(raw) as Record<string, unknown>) || {};
  const registry = data.mcp_registry as Record<string, unknown> | undefined;
  if (!registry) {
    return;
  }
  const servers = registry.servers as Record<string, unknown> | undefined;
  if (servers && appId in servers) {
    delete servers[appId];
  }
  const allowlist = registry.allowlist as Record<string, unknown> | undefined;
  if (allowlist && Array.isArray(allowlist.tool_ids)) {
    allowlist.tool_ids = (allowlist.tool_ids as unknown[]).filter(
      (id) => typeof id === "string" && !(id as string).startsWith(`${appId}.`),
    );
  }
  fs.writeFileSync(yamlPath, yaml.dump(data), "utf8");
}
```

Verify `yaml` and `fs` and `path` are already imported in the file. If not, add `import yaml from "js-yaml";`, etc.

- [ ] **Step 4: Run tests**

```bash
npm test 2>&1 | tail -15
```

Expected: both new tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/workspace-apps.ts runtime/api-server/src/app.test.ts
git commit -m "feat(runtime): add MCP registry writer/remover in workspace-apps"
```

### Task R2.3: Wire MCP registry writer into `install-archive`

**Files:**
- Modify: `runtime/api-server/src/app.ts`
- Modify: `runtime/api-server/src/app.test.ts`

- [ ] **Step 1: Write a failing test**

Append to `app.test.ts`:

```ts
test("install-archive writes mcp_registry from declared mcp.tools", async () => {
  const { app, createWorkspace, store } = await buildTestRuntimeApiServer(/* ... */);
  const workspaceId = await createWorkspace();

  // Build a fixture archive with mcp.tools declared
  const stageDir = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), "mcp-fixture-"));
  fsSync.writeFileSync(
    pathSync.join(stageDir, "app.runtime.yaml"),
    `app_id: "twitter"
name: "Twitter"
slug: "twitter"

lifecycle:
  setup: "true"
  start: "true"
  stop: "true"

mcp:
  enabled: true
  transport: http-sse
  port: 3099
  path: /mcp/sse
  tools:
    - create_post
    - list_posts
`,
  );
  fsSync.writeFileSync(pathSync.join(stageDir, "package.json"), "{}");

  const archivePath = pathSync.join(osSync.tmpdir(), `mcp-test-${Date.now()}.tar.gz`);
  await tar.c(
    { gzip: true, file: archivePath, cwd: stageDir, portable: true, noMtime: true },
    ["app.runtime.yaml", "package.json"],
  );

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install-archive",
    payload: {
      workspace_id: workspaceId,
      app_id: "twitter",
      archive_path: archivePath,
    },
  });
  assert.equal(res.statusCode, 200);

  const yamlBody = fsSync.readFileSync(
    pathSync.join(store.workspaceDir(workspaceId), "workspace.yaml"),
    "utf8",
  );
  assert.match(yamlBody, /mcp_registry/);
  assert.match(yamlBody, /twitter\.create_post/);
  assert.match(yamlBody, /twitter\.list_posts/);

  fsSync.rmSync(stageDir, { recursive: true, force: true });
  fsSync.rmSync(archivePath, { force: true });
});
```

Note: this test imports `tar` — add `import * as tar from "tar";` at the top of the test file if not already there.

- [ ] **Step 2: Run — expect failure**

```bash
npm test 2>&1 | tail -15
```

Expected: the new test fails because `install-archive` doesn't yet call the MCP registry writer.

- [ ] **Step 3: Update `install-archive` handler**

In `app.ts`, find the `app.post("/api/v1/apps/install-archive", ...)` handler. After the `appendWorkspaceApplication(...)` call, add:

```ts
const mcpPort = /* look up the allocated MCP port for this app */;
writeWorkspaceMcpRegistryEntry(workspaceDir, appId, {
  mcpEnabled: /* true if parsed.mcpEnabled or wherever that field lives */,
  mcpTools: parsed.mcpTools,
  mcpPath: parsed.mcpPath ?? "/mcp/sse",
  mcpTimeoutMs: parsed.mcpTimeoutMs ?? 30000,
  mcpPort,
});
```

The exact field names depend on what `parseInstalledAppRuntime` returns. Check the existing `ParsedInstalledApp` interface (look at where the handler already uses `parsed.lifecycle.setup`, etc.) and use the correct field names.

For `mcpPort`: port allocation happens in `ensureAppRunning` via `portsForWorkspaceApp`. If `install-archive` writes the MCP registry entry BEFORE `ensureAppRunning`, the port isn't allocated yet. Two options:
- Allocate the port eagerly before writing the registry entry
- Compute the "expected" port using `store.allocateAppPort({ workspaceId, appId: ${appId}__mcp })` at this point in the handler

Pick one and implement it consistently with how the code elsewhere computes ports. Look at `portsForWorkspaceApp` in `workspace-apps.ts` and reuse its logic.

Import `writeWorkspaceMcpRegistryEntry` at the top of `app.ts`:

```ts
import {
  // ... existing imports
  writeWorkspaceMcpRegistryEntry,
  removeWorkspaceMcpRegistryEntry,
} from "./workspace-apps";
```

- [ ] **Step 4: Run test**

```bash
npm test 2>&1 | tail -15
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/app.ts runtime/api-server/src/app.test.ts
git commit -m "feat(runtime): wire mcp_registry writer into install-archive flow"
```

### Task R2.4: Wire MCP registry remover into `DELETE /apps/:appId`

**Files:**
- Modify: `runtime/api-server/src/app.ts`
- Modify: `runtime/api-server/src/app.test.ts`

- [ ] **Step 1: Write a failing test**

```ts
test("DELETE /apps/:appId removes mcp_registry entry", async () => {
  const { app, createWorkspace, store } = await buildTestRuntimeApiServer(/* ... */);
  const workspaceId = await createWorkspace();

  // Pre-seed workspace.yaml with an mcp_registry entry
  const workspaceDir = store.workspaceDir(workspaceId);
  fsSync.writeFileSync(
    pathSync.join(workspaceDir, "workspace.yaml"),
    `template_id: test
name: Test
applications:
  - app_id: twitter
    config_path: apps/twitter/app.runtime.yaml
    lifecycle:
      setup: "true"
mcp_registry:
  allowlist:
    tool_ids:
      - twitter.create_post
  servers:
    twitter:
      type: remote
      url: http://localhost:13100/mcp/sse
      enabled: true
`,
  );
  // Create an empty apps/twitter dir so the DELETE handler proceeds
  fsSync.mkdirSync(pathSync.join(workspaceDir, "apps", "twitter"), { recursive: true });
  fsSync.writeFileSync(
    pathSync.join(workspaceDir, "apps", "twitter", "app.runtime.yaml"),
    `app_id: twitter\nname: Twitter\nlifecycle:\n  stop: "true"\nmcp:\n  enabled: false\n`,
  );

  const res = await app.inject({
    method: "DELETE",
    url: "/api/v1/apps/twitter",
    payload: { workspace_id: workspaceId },
  });
  assert.equal(res.statusCode, 200);

  const yamlBody = fsSync.readFileSync(pathSync.join(workspaceDir, "workspace.yaml"), "utf8");
  assert.doesNotMatch(yamlBody, /twitter\.create_post/);
  assert.doesNotMatch(yamlBody, /servers:\s*\n\s*twitter:/);
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test 2>&1 | tail -15
```

- [ ] **Step 3: Update the DELETE handler**

Find `app.delete("/api/v1/apps/:appId", ...)` in `app.ts`. After the existing `removeWorkspaceApplication(workspaceDir, appId)` call, add:

```ts
removeWorkspaceMcpRegistryEntry(workspaceDir, appId);
```

- [ ] **Step 4: Run test**

```bash
npm test 2>&1 | tail -15
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/app.ts runtime/api-server/src/app.test.ts
git commit -m "feat(runtime): clean mcp_registry on app uninstall"
```

### Task R2.5: `install-archive` accepts `archive_url`

**Files:**
- Modify: `runtime/api-server/src/app.ts`
- Modify: `runtime/api-server/src/app.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `app.test.ts`:

```ts
test("isAllowedArchiveUrl accepts github release URLs", async () => {
  const { isAllowedArchiveUrl } = await import("./app.ts");
  assert.equal(
    isAllowedArchiveUrl("https://github.com/holaboss-ai/holaboss-modules/releases/download/v0.1.0/twitter-module-darwin-arm64.tar.gz"),
    true,
  );
  assert.equal(isAllowedArchiveUrl("https://evil.test/twitter.tar.gz"), false);
  assert.equal(isAllowedArchiveUrl("http://github.com/..."), false); // http rejected
  assert.equal(isAllowedArchiveUrl(""), false);
});

test("POST /apps/install-archive rejects url outside allowlist", async () => {
  const { app, createWorkspace } = await buildTestRuntimeApiServer(/* ... */);
  const workspaceId = await createWorkspace();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install-archive",
    payload: {
      workspace_id: workspaceId,
      app_id: "evil",
      archive_url: "https://evil.test/twitter.tar.gz",
    },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.match(String(body.error || body.detail || ""), /allowlist|archive_url/);
});

test("POST /apps/install-archive with archive_url downloads and installs", async () => {
  // This test starts a tiny local HTTP server that serves the fixture tarball,
  // then points install-archive at it.
  const http = await import("node:http");
  const { app, createWorkspace, store } = await buildTestRuntimeApiServer(/* ... */);
  const workspaceId = await createWorkspace();

  const fixtureBuf = fsSync.readFileSync(MINIMAL_APP_FIXTURE);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/gzip" });
    res.end(fixtureBuf);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no server address");
  const url = `http://127.0.0.1:${addr.port}/minimal.tar.gz`;

  // Temporarily allowlist http://127.0.0.1 via env override
  const savedEnv = process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST;
  process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST = `${savedEnv ?? ""},http://127.0.0.1/`;

  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/apps/install-archive",
      payload: {
        workspace_id: workspaceId,
        app_id: "minimal",
        archive_url: url,
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.app_id, "minimal");

    const installed = pathSync.join(store.workspaceDir(workspaceId), "apps", "minimal", "app.runtime.yaml");
    assert.equal(fsSync.existsSync(installed), true);
  } finally {
    server.close();
    if (savedEnv === undefined) {
      delete process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST;
    } else {
      process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST = savedEnv;
    }
  }
});

test("POST /apps/install-archive rejects both archive_path and archive_url", async () => {
  const { app, createWorkspace } = await buildTestRuntimeApiServer(/* ... */);
  const workspaceId = await createWorkspace();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install-archive",
    payload: {
      workspace_id: workspaceId,
      app_id: "twitter",
      archive_path: "/tmp/x.tar.gz",
      archive_url: "https://github.com/holaboss-ai/holaboss-modules/releases/download/v0.1.0/twitter-module-darwin-arm64.tar.gz",
    },
  });
  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: Run — expect failures**

```bash
npm test 2>&1 | tail -25
```

Expected: the 4 new tests fail.

- [ ] **Step 3: Implement `isAllowedArchiveUrl`**

In `app.ts`, near `isAllowedArchivePath`, add:

```ts
export function isAllowedArchiveUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    // Default allowlist: https only (except when overridden by env var)
  } catch {
    return false;
  }

  const defaultPrefixes = [
    "https://github.com/holaboss-ai/holaboss-modules/releases/download/",
  ];
  const envOverride = process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST;
  const extraPrefixes = envOverride
    ? envOverride.split(",").map((p) => p.trim()).filter((p) => p.length > 0)
    : [];
  const allPrefixes = [...defaultPrefixes, ...extraPrefixes];

  // For http:// entries to pass, they must be explicitly in the override list
  if (url.startsWith("http://") && !extraPrefixes.some((p) => url.startsWith(p))) {
    return false;
  }

  return allPrefixes.some((prefix) => url.startsWith(prefix));
}
```

- [ ] **Step 4: Add the download helper**

Still in `app.ts`:

```ts
async function downloadArchiveToTemp(url: string, appId: string): Promise<string> {
  const dir = path.join(os.tmpdir(), "holaboss-app-archives");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${appId}-${Date.now()}.tar.gz`);

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const fileStream = fs.createWriteStream(filePath);
  const reader = res.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) fileStream.write(value);
    }
  } finally {
    fileStream.end();
    await new Promise<void>((resolve, reject) => {
      fileStream.on("finish", () => resolve());
      fileStream.on("error", reject);
    });
  }
  return filePath;
}
```

- [ ] **Step 5: Update the `install-archive` handler**

Replace the beginning of the handler body with:

```ts
app.post("/api/v1/apps/install-archive", async (request, reply) => {
  if (!isRecord(request.body)) {
    return sendError(reply, 400, "request body must be an object");
  }
  const workspaceId = requiredString(request.body.workspace_id, "workspace_id");
  const workspace = store.getWorkspace(workspaceId);
  if (!workspace) {
    return sendError(reply, 404, "workspace not found");
  }

  let appId: string;
  try {
    appId = sanitizeAppId(requiredString(request.body.app_id, "app_id"));
  } catch (error) {
    return sendError(reply, 400, error instanceof Error ? error.message : "invalid app_id");
  }

  const rawArchivePath = typeof request.body.archive_path === "string" ? request.body.archive_path : "";
  const rawArchiveUrl = typeof request.body.archive_url === "string" ? request.body.archive_url : "";

  if (rawArchivePath && rawArchiveUrl) {
    return sendError(reply, 400, "provide either archive_path or archive_url, not both");
  }
  if (!rawArchivePath && !rawArchiveUrl) {
    return sendError(reply, 400, "archive_path or archive_url is required");
  }

  let archivePath: string;
  let cleanupTempFile = false;

  if (rawArchiveUrl) {
    if (!isAllowedArchiveUrl(rawArchiveUrl)) {
      return sendError(reply, 400, "archive_url outside allowlist");
    }
    try {
      archivePath = await downloadArchiveToTemp(rawArchiveUrl, appId);
      cleanupTempFile = true;
    } catch (error) {
      return sendError(
        reply,
        400,
        `archive download failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    archivePath = rawArchivePath;
    if (!isAllowedArchivePath(archivePath)) {
      return sendError(reply, 400, "archive_path outside allowed roots");
    }
    if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
      return sendError(reply, 400, "archive_path does not exist");
    }
  }

  try {
    // ... existing extraction + validation + appendWorkspaceApplication + ensureAppRunning logic
    //     (unchanged — the rest of the handler runs exactly as before)
  } finally {
    if (cleanupTempFile) {
      try { fs.rmSync(archivePath, { force: true }); } catch { /* best effort */ }
    }
  }
});
```

Make sure the existing extraction logic is inside the `try` block so the temp file is cleaned up even on failure.

- [ ] **Step 6: Run tests**

```bash
npm test 2>&1 | tail -20
```

Expected: all 4 new tests pass, all pre-existing pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/app.ts runtime/api-server/src/app.test.ts
git commit -m "feat(runtime): install-archive accepts archive_url for remote fetch"
```

### Task R2.6: Runtime sweep

- [ ] **Step 1: Full runtime test run**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
npm run runtime:test
```

Expected: all tests pass (>298).

- [ ] **Step 2: Typecheck**

```bash
cd runtime/api-server && npm run typecheck
cd ../state-store && npx tsc --noEmit
```

Expected: clean.

---

## Phase 3 — Backend refactor: template materialization via archives

### Task B3.1: Add `install_app_from_archive_via_runtime` to client

**Files:**
- Modify: `backend/src/services/workspaces/sandbox_runtime_client.py`
- Modify: `backend/test/services/workspaces/test_sandbox_runtime_client.py` (if it exists)

- [ ] **Step 1: Inspect the existing client**

```bash
grep -n "install_app_via_runtime\|uninstall_app_via_runtime\|async def" backend/src/services/workspaces/sandbox_runtime_client.py | head -30
```

Find the existing `install_app_via_runtime` method (line ~1820). Note its signature and how it routes to the sandbox runtime service.

- [ ] **Step 2: Add the new method**

Near the existing `install_app_via_runtime`, add:

```python
async def install_app_from_archive_via_runtime(
    self,
    *,
    holaboss_user_id: str,
    workspace_id: str,
    app_id: str,
    archive_url: str,
    timeout_s: float = 300.0,
) -> dict[str, Any]:
    """Install an app by URL. Runtime downloads and extracts the archive.

    Supersedes install_app_via_runtime for workspace provisioning.
    """
    payload = {
        "workspace_id": workspace_id,
        "app_id": app_id,
        "archive_url": archive_url,
    }
    return await self._sandbox_agent_json_request(
        user_id=holaboss_user_id,
        method="POST",
        path="/api/v1/apps/install-archive",
        json=payload,
        timeout_s=timeout_s,
    )
```

Exact helper name (`_sandbox_agent_json_request`) depends on the existing client — match whatever `install_app_via_runtime` uses.

- [ ] **Step 3: Mark the old method deprecated**

Above `install_app_via_runtime`, add a deprecation comment:

```python
# DEPRECATED: use install_app_from_archive_via_runtime instead.
# This method uses the legacy files[] install endpoint and bundles app
# source code into the request body, which wastes bandwidth now that
# apps are distributed as prebuilt archives.
async def install_app_via_runtime(...):
    ...
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run python -c "from services.workspaces.sandbox_runtime_client import SandboxRuntimeClient; print([m for m in dir(SandboxRuntimeClient) if 'install' in m])"
```

Expected: prints both methods.

- [ ] **Step 5: Commit**

```bash
git add src/services/workspaces/sandbox_runtime_client.py
git commit -m "feat(workspaces): add install_app_from_archive_via_runtime client"
```

### Task B3.2: Add sandbox_runtime proxy route for install-archive

**Files:**
- Modify: `backend/src/api/v1/sandbox_runtime/routes/applications.py`
- Modify: `backend/test/api/v1/sandbox_runtime/` (if tests exist)

- [ ] **Step 1: Inspect existing proxy routes**

```bash
grep -n "install\b\|apps/" backend/src/api/v1/sandbox_runtime/routes/applications.py | head -20
```

If there's already a proxy for `POST /apps/install` (files[]), mirror its structure. If there is one for `POST /apps/install-archive`, check whether it just forwards `archive_path` or also handles `archive_url`.

- [ ] **Step 2: Add or update the install-archive proxy**

Add a new route (or update the existing one) that accepts both `archive_path` and `archive_url`, and forwards to the in-sandbox runtime:

```python
class InstallArchiveRequest(BaseModel):
    workspace_id: str
    app_id: str
    archive_path: str | None = None
    archive_url: str | None = None


@router.post("/users/{user_id}/apps/install-archive")
async def install_app_from_archive(
    user_id: str,
    payload: InstallArchiveRequest,
    request: Request,
) -> dict[str, Any]:
    service: SandboxRuntimeService = request.app.state.sandbox_runtime_service
    return await service.proxy_json_request(
        user_id=user_id,
        method="POST",
        path="/api/v1/apps/install-archive",
        json=payload.model_dump(exclude_none=True),
    )
```

Match the exact pattern used by sibling routes in the file (the service accessor name may be different).

- [ ] **Step 3: Commit**

```bash
git add src/api/v1/sandbox_runtime/routes/applications.py
git commit -m "feat(sandbox_runtime): add install-archive proxy route"
```

### Task B3.3: Gut `_materialize_template_with_apps`

**Files:**
- Modify: `backend/src/services/workspaces/template_utils.py`
- Modify: `backend/test/services/workspaces/test_workspace_yaml_apps.py` (if it tests this function)

- [ ] **Step 1: Find the current function**

```bash
grep -n "_materialize_template_with_apps\|_append_application_to_workspace_yaml\|_extract_app_template_binding" backend/src/services/workspaces/template_utils.py
```

- [ ] **Step 2: Rewrite `_materialize_template_with_apps`**

Replace the function body with a no-op that just returns the input materialized template unchanged (and optionally validates that the selected apps exist in the catalog):

```python
def _materialize_template_with_apps(
    *,
    materialized: MaterializedTemplate,
    template_meta: TemplateMetadata,
    app_template_resolver: AppTemplateResolver,
    materializer: TemplateMaterializer,  # kept for signature compatibility; unused
    app_names_override: Sequence[str] | None = None,
) -> MaterializedTemplate:
    """Validate that all referenced apps exist in the catalog.

    As of 2026-04-09, this function no longer bundles app source code into
    the template. Apps are installed separately via install-archive during
    workspace provisioning (see workspace_service._provision_workspace).
    """
    app_names = list(app_names_override) if app_names_override else [a.name for a in template_meta.apps]
    for app_name in app_names:
        # Raises if the app isn't in the catalog
        app_template_resolver.resolve(name=app_name)
    return materialized
```

Keep the function signature stable so callers in `workspace_service.py` don't need to be updated yet.

- [ ] **Step 3: Mark `_extract_app_template_binding` and `_append_application_to_workspace_yaml` deprecated**

Add a comment at the top of each function:

```python
# DEPRECATED: this function was used by the legacy template materialization
# flow that bundled app source code into MaterializedTemplate. As of
# 2026-04-09 the flow is superseded by install-archive, and this function
# is no longer called. Kept for reference until confirmed unused; delete
# in a follow-up.
def _extract_app_template_binding(...):
    ...
```

- [ ] **Step 4: Update any tests that break**

Run:

```bash
uv run pytest test/services/workspaces/test_workspace_yaml_apps.py -v
```

If any test fails because `_materialize_template_with_apps` no longer bundles files, update the test to expect the new behavior (no `apps/*` entries in the returned MaterializedTemplate). If a test is specifically about the deprecated functions, mark it skipped with `@pytest.mark.skip(reason="legacy bundling path deprecated 2026-04-09")`.

- [ ] **Step 5: Commit**

```bash
git add src/services/workspaces/template_utils.py test/services/workspaces/test_workspace_yaml_apps.py
git commit -m "refactor(workspaces): decouple template materialization from app sources"
```

### Task B3.4: Update `_provision_workspace` to call install-archive

**Files:**
- Modify: `backend/src/services/workspaces/workspace_service.py`

- [ ] **Step 1: Find the current provisioning function**

```bash
grep -n "_provision_workspace\|_background_setup_template_apps\|final_app_names\|_materialize_template_with_apps" backend/src/services/workspaces/workspace_service.py
```

- [ ] **Step 2: Add `_resolve_sandbox_target` helper**

Near the top of `workspace_service.py` (after imports), add:

```python
def _resolve_sandbox_target(provider: str) -> str:
    """Map a sandbox provider to the app archive target triple."""
    if provider in ("docker_container", "fly"):
        return "linux-x64"
    if provider == "desktop":
        import platform
        system = platform.system()
        machine = platform.machine()
        if system == "Darwin" and machine == "arm64":
            return "darwin-arm64"
        if system == "Linux" and machine in ("x86_64", "amd64"):
            return "linux-x64"
        if system == "Windows" and machine in ("AMD64", "x86_64"):
            return "win32-x64"
        raise RuntimeError(f"Unsupported desktop sandbox target: {system}/{machine}")
    raise RuntimeError(f"Unknown sandbox provider: {provider}")
```

- [ ] **Step 3: Inject app installation into `_provision_workspace`**

Find the part of `_provision_workspace` where the materialized template has been applied and the workspace.yaml has been written. After that, and BEFORE any `_background_setup_template_apps` call, add:

```python
# Install each required app via install-archive
if final_app_names:
    provider = payload.provider or self._default_provider  # adapt to actual field name
    target = _resolve_sandbox_target(provider)
    for app_name in final_app_names:
        try:
            app_meta = self.app_template_resolver.resolve(name=app_name)
        except Exception as exc:
            logger.exception(
                "workspace.provision.app_not_found",
                extra={
                    "event": "workspace.provision",
                    "outcome": "error",
                    "workspace_id": workspace_id,
                    "app_id": app_name,
                },
            )
            raise WorkspaceValidationError(f"App '{app_name}' not in catalog") from exc

        if not app_meta.archive_url_template:
            raise WorkspaceValidationError(
                f"App '{app_name}' has no archive_url_template; cannot install"
            )
        archive_url = app_meta.archive_url_template.replace("{target}", target)

        try:
            await self.sandbox_runtime_client.install_app_from_archive_via_runtime(
                holaboss_user_id=payload.holaboss_user_id,
                workspace_id=workspace_id,
                app_id=app_name,
                archive_url=archive_url,
            )
        except Exception as exc:
            logger.exception(
                "workspace.provision.app_install_failed",
                extra={
                    "event": "workspace.provision",
                    "outcome": "error",
                    "workspace_id": workspace_id,
                    "app_id": app_name,
                    "archive_url": archive_url,
                },
            )
            raise
```

- [ ] **Step 4: Delete the `_background_setup_template_apps` invocation**

Find the call site (search for `_background_setup_template_apps`). Delete the call and any associated task scheduling. The function definition itself can be deleted or marked deprecated.

- [ ] **Step 5: Update any callers that depended on the old flow**

Run:

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
grep -rn "_background_setup_template_apps\|bootstrap_app_from_template\|setup_app_via_runtime" src/ 2>/dev/null
```

Any remaining callers of the old flow need to be updated or removed.

- [ ] **Step 6: Run the workspace service tests**

```bash
uv run pytest test/services/workspaces/test_workspace_service.py -v 2>&1 | tail -30
```

Many tests will fail because the provisioning flow changed. Update them to expect the new flow — mock `sandbox_runtime_client.install_app_from_archive_via_runtime` to return a success payload, and assert it was called with the right URL.

- [ ] **Step 7: Commit**

```bash
git add src/services/workspaces/workspace_service.py test/services/workspaces/test_workspace_service.py
git commit -m "feat(workspaces): install apps via install-archive during provisioning

Replaces the legacy path of bundling app source into the template
MaterializedTemplate and running npm install inside the sandbox with a
direct call to install-archive per app. Archive URLs come from
AppTemplateMetadata.archive_url_template with {target} substituted per
the workspace's provider."
```

### Task B3.5: Backend sweep + work log

- [ ] **Step 1: Targeted test run**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run pytest test/api/v1/marketplace/ test/services/marketplace/ test/services/workspaces/ -v 2>&1 | tail -30
```

Expected: new tests pass. Pre-existing failures in `test_templates_api.py` and `test_template_registry.py` may remain — those are unrelated.

- [ ] **Step 2: Ruff on touched files**

```bash
uv run ruff check src/api/v1/marketplace/templates.py \
                  src/api/v1/marketplace/routes/templates.py \
                  src/api/v1/sandbox_runtime/routes/applications.py \
                  src/services/workspaces/sandbox_runtime_client.py \
                  src/services/workspaces/template_utils.py \
                  src/services/workspaces/workspace_service.py \
                  src/config/environment.py
uv run ruff format --check src/api/v1/marketplace/templates.py \
                           src/api/v1/marketplace/routes/templates.py \
                           src/api/v1/sandbox_runtime/routes/applications.py \
                           src/services/workspaces/sandbox_runtime_client.py \
                           src/services/workspaces/template_utils.py \
                           src/services/workspaces/workspace_service.py \
                           src/config/environment.py
```

Expected: clean.

- [ ] **Step 3: Append work log entry**

Append to `backend/docs/work_log.md`:

```markdown
## 2026-04-09 – Template materialization unified via install-archive

- `AppTemplateMetadata` now stores `archive_url_template` directly; the
  runtime version resolver + TTL cache + `APP_ARCHIVE_VERSION` env var
  path is deleted.
- Template materialization no longer bundles app source code. After the
  workspace shell is written, `_provision_workspace` calls
  `install_app_from_archive_via_runtime` for each required app; the
  runtime downloads the archive, extracts, writes `workspace.yaml`
  entries (including `mcp_registry`), and starts the app via the normal
  lifecycle.
- MCP tool name discovery moved from Python source-grep to authors
  declaring `mcp.tools` statically in `app.runtime.yaml`. The runtime
  reads this list when registering the app.
- Legacy `install_app_via_runtime` (files[]) is marked deprecated but
  kept for now.
```

- [ ] **Step 4: Commit**

```bash
git add docs/work_log.md
git commit -m "docs(workspaces): log template materialization unification"
```

---

## Phase 4 — Validation (manual, by you)

All phases committed and ready to test together.

### 4.1: Desktop local-source install (regression)

```bash
# Rebuild archive with new mcp.tools field present
cd /Users/joshua/holaboss-ai/holaboss/hola-boss-apps
./scripts/build-archive.sh twitter

export HOLABOSS_APP_ARCHIVE_DIR="$(realpath dist)"

cd ../holaOS
npm run desktop:prepare-runtime:local
npm run desktop:dev
```

Expected:
- Marketplace → Apps → Local → Refresh → twitter card appears
- Install → installing spinner → Installed
- Open the workspace in AppSurfacePane → iframe loads at `http://localhost:{port}`
- Open `workspace.yaml` (find the workspace dir in runtime logs) and verify:
  - `applications:` has `twitter` entry
  - `mcp_registry.servers.twitter` has url pointing at the allocated MCP port
  - `mcp_registry.allowlist.tool_ids` has entries `twitter.create_post`, `twitter.list_posts`, etc.

### 4.2: Desktop marketplace install via archive_url (regression + new URL path)

The desktop itself still POSTs `archive_path` (not `archive_url`) — it downloads to tmpdir and passes the path. But the runtime now ALSO supports `archive_url`; testing this confirms it works end-to-end.

You can test the URL path via curl:

```bash
curl -sS -X POST http://127.0.0.1:8080/api/v1/apps/install-archive \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "<your_workspace_id>",
    "app_id": "linkedin",
    "archive_url": "https://github.com/holaboss-ai/holaboss-modules/releases/download/v0.1.0/linkedin-module-darwin-arm64.tar.gz"
  }'
```

Expected: 200 response with `ready: true` (or `ready: false` + an error if network/lifecycle issues occur). Check `workspace.yaml` shows `linkedin` in applications and mcp_registry.

### 4.3: Full template-based workspace creation (new flow, end-to-end)

```bash
# Start the full local stack
cd /Users/joshua/holaboss-ai/holaboss/backend
scripts/local_deploy.sh start

# Via the web frontend or desktop, create a new workspace from a template
# (e.g. social_operator). Observe backend logs during creation.
```

Expected:
- Template materialize step completes in milliseconds (no git clone, no source bundling)
- After materialize, you should see log lines like `workspace.provision.app_install` → `install_app_from_archive_via_runtime` → runtime downloads → extracts → app starts
- Total workspace creation time should be significantly faster than before (seconds instead of minutes, because no `npm install && npm run build` inside the sandbox)
- Workspace ends up with all selected apps installed, `workspace.yaml` has `applications:` + `mcp_registry:` populated
- Agent messages work; MCP tools callable

### 4.4: Submit a custom template + create workspace from it

- From the frontend or desktop, publish a custom template that references existing apps
- Create a workspace from the published template
- Verify the apps install via the new archive path (same logs as 4.3)

### 4.5: Uninstall an app and verify cleanup

```bash
# In the running desktop, remove an installed app via AppSurfacePane's "Remove app"
```

Expected:
- The app entry disappears from `workspace.yaml` `applications:`
- `mcp_registry.servers.<app_id>` is removed
- `mcp_registry.allowlist.tool_ids` entries prefixed with `<app_id>.` are removed
- Other apps' entries are unchanged

### 4.6: Version bump drill

Edit `backend/src/api/v1/marketplace/templates.py`:
- Change one app's `archive_url_template` from `v0.1.0` to `v0.2.0`
- Change its `archive_version` to `"v0.2.0"`
- Restart the backend
- In the desktop, refresh the Apps catalog → verify the version displays as `v0.2.0`
- Install → verify the runtime fetches the new URL

---

## Rollback

Phases are designed to be independently revertable:

- **Phase 3 revert (backend refactor):** Revert the commits in `B3.*`. Template materialization falls back to the old git-clone + files[] path. Runtime's new `archive_url` support is unused but harmless.
- **Phase 2 revert (runtime):** Revert the commits in `R2.*`. Desktop's existing install-archive (archive_path only) still works; templates still bundle source via the old path.
- **Phase 1 revert (backend simplification):** Revert the commits in `B1.*`. Restores the version resolver plumbing. Phase 2+3 changes in the runtime and workspace service are independent and unaffected.
- **Phase 0 revert:** The `mcp.tools` declarations are additive and harmless; leave them in place even on full rollback.

---

## Summary

| Phase | Repo | Files touched | Commits | Approx tasks |
|---|---|---|---|---|
| 0: mcp.tools decl | `hola-boss-apps` | 7 | 1 | 8 |
| 1: backend simplify | `backend` | 4 + 2 deletions | 5 | 5 |
| 2: runtime | `holaOS` | 3 | 5 | 6 |
| 3: backend refactor | `backend` | 5 | 5 | 5 |
| 4: validation | — | — | 0 | 6 |
| **Total** | 3 repos | ~19 files | 16 | 30 |

All commits stay on the existing `feat/desktop-install-app` branches in both repos (since this is a natural continuation). If you prefer a separate branch for this phase, branch off `feat/desktop-install-app` as `feat/template-materialize-via-archive` before starting.
