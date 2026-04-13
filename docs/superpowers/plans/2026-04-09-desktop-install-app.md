# Desktop Install-App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to install new apps into an existing workspace from the Holaboss desktop app, using pre-built `.tar.gz` archives downloaded from GitHub Releases or a local `hola-boss-apps/dist/` directory.

**Architecture:** Three layers change. (1) The Python backend extends `/api/v1/marketplace/app-templates` to include `version` and per-target `archives`. (2) The runtime gains a new `app_catalog` SQLite table, three new HTTP endpoints (`GET /apps/catalog`, `POST /apps/catalog/sync`, `POST /apps/install-archive`), and a `tar` dependency for extraction. (3) The desktop adds a **Templates | Apps** pill-segment sub-tab inside `MarketplacePane`, an `AppsGallery` component, electron IPC handlers for catalog list/sync/install, and context state. workspace.yaml + `ensureAppRunning` remain the source of truth for installed apps.

**Tech Stack:**
- Python 3.11, FastAPI, httpx, pydantic (backend)
- TypeScript, Fastify, better-sqlite3, `tar` npm package (runtime)
- React 18, Electron, Tailwind CSS (desktop)

**Reference spec:** `holaOS/docs/plans/2026-04-09-desktop-install-app-design.md`

---

## File Structure

### Backend (Python)

- **Modify** `backend/src/api/v1/marketplace/templates.py` — add `AppTemplateArchive` model, add `version` + `archives` fields to `AppTemplateMetadata`
- **Create** `backend/src/services/marketplace/app_archive_version.py` — version resolution (`resolve_app_archive_version`, `build_archive_urls`) with 5-minute TTL cache of GitHub's `releases/latest`
- **Modify** `backend/src/api/v1/marketplace/routes/templates.py` — extend `list_app_templates` to attach version + archives
- **Modify** `backend/src/config/environment.py` — add `app_archive_version: str = "latest"` to `EnvironmentSettings`
- **Create** `backend/test/api/v1/marketplace/test_app_templates.py` — endpoint tests (archives, caching, fallback)
- **Create** `backend/test/services/marketplace/test_app_archive_version.py` — version resolver tests

### Runtime state-store (TypeScript)

- **Modify** `runtime/state-store/src/store.ts` — add `AppCatalogEntryRecord` type, `upsertAppCatalogEntry`, `listAppCatalogEntries`, `clearAppCatalogSource`, `deleteAppCatalogEntry`, schema for `app_catalog` table
- **Modify** `runtime/state-store/src/store.test.ts` — tests for the four new methods

### Runtime api-server (TypeScript)

- **Modify** `runtime/api-server/package.json` — add `tar` dep and `@types/tar` dev dep
- **Modify** `runtime/api-server/src/app.ts` — add `isAllowedArchivePath` helper, `GET /api/v1/apps/catalog`, `POST /api/v1/apps/catalog/sync`, `POST /api/v1/apps/install-archive`
- **Create** `runtime/api-server/src/__fixtures__/minimal-app.tar.gz` — 2-file fixture (`app.runtime.yaml` + `package.json`) used by extraction tests
- **Create** `runtime/api-server/src/__fixtures__/build-fixture.mjs` — small script that (re)generates the fixture so it's reproducible
- **Modify** `runtime/api-server/src/app.test.ts` — tests for catalog + install-archive routes

### Desktop (Electron + React)

- **Modify** `desktop/electron/main.ts` — add `resolveLocalArchiveTarget`, `resolveLocalAppsRoot`, `scanLocalAppArchives`, `downloadAppArchive`, `listAppCatalog`, `syncAppCatalog`, `installAppFromCatalog`, `listAppTemplatesViaControlPlane`, and three `handleTrustedIpc` registrations
- **Modify** `desktop/electron/preload.ts` — expose `listAppCatalog`, `syncAppCatalog`, `installAppFromCatalog` on `electronAPI.workspace`
- **Modify** `desktop/src/types/electron.d.ts` — add `AppCatalogEntryPayload`, `AppCatalogListResponse`, `AppCatalogSyncResponse`, `InstallAppFromCatalogRequest`, `InstallAppFromCatalogResponse`, `AppTemplateArchivePayload`; extend `AppTemplateMetadataPayload` with `version` + `archives`
- **Modify** `desktop/src/lib/workspaceDesktop.tsx` — add context state (`appCatalog`, `appCatalogSource`, etc.) and methods (`refreshAppCatalog`, `setAppCatalogSource`, `installAppFromCatalog`)
- **Create** `desktop/src/components/marketplace/AppsGallery.tsx` — the tab body: header with source toggle + refresh, grid of cards, workspace gate
- **Create** `desktop/src/components/marketplace/AppCatalogCard.tsx` — individual card with three states (available/installing/installed)
- **Modify** `desktop/src/components/panes/MarketplacePane.tsx` — wrap existing view in a Templates tab + add Apps tab

---

## Section A — Backend (Python)

### Task A1: Add `app_archive_version` setting

**Files:**
- Modify: `backend/src/config/environment.py`

- [ ] **Step 1: Add the field to `EnvironmentSettings`**

Open `backend/src/config/environment.py` and find the `EnvironmentSettings` class. Add a new field right before `model_config`:

```python
class EnvironmentSettings(BaseSettings):
    """..."""

    openai_api_key: str
    # ... existing fields ...
    system_base_url: str
    app_archive_version: str = "latest"
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
```

- [ ] **Step 2: Verify the settings still load**

Run:
```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run python -c "from src.config.environment import environment_settings; print(environment_settings.app_archive_version)"
```
Expected: prints `latest` (or whatever `APP_ARCHIVE_VERSION` is set to in `.env`).

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
git add src/config/environment.py
git commit -m "feat(marketplace): add APP_ARCHIVE_VERSION setting for app archive publishing"
```

---

### Task A2: Add `AppTemplateArchive` model and extend `AppTemplateMetadata`

**Files:**
- Modify: `backend/src/api/v1/marketplace/templates.py` (around line 686 — the existing `AppTemplateMetadata` class)

- [ ] **Step 1: Add the new model and fields**

Locate the existing `AppTemplateMetadata` class. Add a new `AppTemplateArchive` model right above it and add two fields to `AppTemplateMetadata`:

```python
class AppTemplateArchive(BaseModel):
    target: str   # "darwin-arm64" | "linux-x64" | "win32-x64"
    url: str


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
    version: str | None = None
    archives: list[AppTemplateArchive] = Field(default_factory=list)
```

- [ ] **Step 2: Verify the module imports cleanly**

Run:
```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run python -c "from src.api.v1.marketplace.templates import AppTemplateMetadata, AppTemplateArchive; print(sorted(AppTemplateMetadata.model_fields.keys())); print(sorted(AppTemplateArchive.model_fields.keys()))"
```
Expected: `AppTemplateMetadata.model_fields` includes `version` and `archives`; `AppTemplateArchive.model_fields` includes `target` and `url`.

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
git add src/api/v1/marketplace/templates.py
git commit -m "feat(marketplace): add version and archives fields to AppTemplateMetadata"
```

---

### Task A3: Write failing test for version resolution — pinned tag

**Files:**
- Create: `backend/test/services/marketplace/test_app_archive_version.py`

- [ ] **Step 1: Create the test file**

```python
"""Tests for app archive version resolution."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from src.config.environment import EnvironmentSettings


def _make_settings(version: str) -> EnvironmentSettings:
    return EnvironmentSettings(
        openai_api_key="test",
        supabase_url="http://supabase.local",
        supabase_api_key="test",
        project_service_url="http://projects.local",
        cronjobs_service_url="http://cron.local",
        workspace_api_url="http://workspace.local",
        system_base_url="http://system.local",
        app_archive_version=version,
    )


@pytest.mark.asyncio
async def test_pinned_version_returned_as_is() -> None:
    from src.services.marketplace import app_archive_version as mod

    mod._cache = None  # ty:ignore[unresolved-attribute]

    settings = _make_settings("v0.1.0")
    result = await mod.resolve_app_archive_version(settings)
    assert result == "v0.1.0"
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run pytest test/services/marketplace/test_app_archive_version.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'src.services.marketplace.app_archive_version'`.

- [ ] **Step 3: Commit**

```bash
git add test/services/marketplace/test_app_archive_version.py
git commit -m "test(marketplace): add failing test for pinned app archive version"
```

---

### Task A4: Implement `app_archive_version.py`

**Files:**
- Create: `backend/src/services/marketplace/app_archive_version.py`

- [ ] **Step 1: Verify the target directory exists**

```bash
ls /Users/joshua/holaboss-ai/holaboss/backend/src/services/marketplace/
```
Expected: directory exists. If `__init__.py` is missing, create it empty first.

- [ ] **Step 2: Write the module**

```python
"""Resolve the app archive version used by the marketplace endpoint.

When `APP_ARCHIVE_VERSION=latest`, query GitHub's releases/latest once and
cache the resolved tag for 5 minutes. When a specific tag is configured
(e.g. `v0.1.0`), return it directly.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import httpx

from src.api.v1.marketplace.templates import AppTemplateArchive
from src.config.environment import EnvironmentSettings

logger = logging.getLogger(__name__)

_MODULES_REPO = "https://github.com/holaboss-ai/holaboss-modules"
_TARGETS: tuple[str, ...] = ("darwin-arm64", "linux-x64", "win32-x64")
_GITHUB_LATEST_RELEASE = "https://api.github.com/repos/holaboss-ai/holaboss-modules/releases/latest"
_LATEST_TTL_SECONDS = 300


@dataclass
class _Cached:
    version: str
    fetched_at: float


_cache: _Cached | None = None


async def resolve_app_archive_version(settings: EnvironmentSettings) -> str:
    """Return the pinned tag or resolve 'latest' via GitHub API with a short TTL cache."""
    configured = (settings.app_archive_version or "latest").strip()
    if configured != "latest":
        return configured

    global _cache
    now = time.monotonic()
    if _cache is not None and (now - _cache.fetched_at) < _LATEST_TTL_SECONDS:
        return _cache.version

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            _GITHUB_LATEST_RELEASE,
            headers={"Accept": "application/vnd.github+json"},
        )
        resp.raise_for_status()
        payload = resp.json()
    tag = payload["tag_name"]
    _cache = _Cached(version=tag, fetched_at=now)
    return tag


def build_archive_urls(app_name: str, version: str) -> list[AppTemplateArchive]:
    """Compose the GitHub release download URLs for all supported targets."""
    return [
        AppTemplateArchive(
            target=target,
            url=f"{_MODULES_REPO}/releases/download/{version}/{app_name}-module-{target}.tar.gz",
        )
        for target in _TARGETS
    ]
```

- [ ] **Step 3: Run the pinned-version test**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run pytest test/services/marketplace/test_app_archive_version.py::test_pinned_version_returned_as_is -v
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/services/marketplace/app_archive_version.py
git commit -m "feat(marketplace): add app archive version resolver with TTL cache"
```

---

### Task A5: Add `latest` caching test + `build_archive_urls` test

**Files:**
- Modify: `backend/test/services/marketplace/test_app_archive_version.py`

- [ ] **Step 1: Append two more tests**

```python
@pytest.mark.asyncio
async def test_latest_fetches_github_and_caches() -> None:
    from src.services.marketplace import app_archive_version as mod

    mod._cache = None  # ty:ignore[unresolved-attribute]

    class _FakeResponse:
        def __init__(self, data: dict) -> None:
            self._data = data

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self._data

    fake_get_calls: list[str] = []

    class _FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            self._response = _FakeResponse({"tag_name": "v0.2.0"})

        async def __aenter__(self) -> "_FakeClient":
            return self

        async def __aexit__(self, *_) -> None:
            return None

        async def get(self, url: str, **_) -> _FakeResponse:
            fake_get_calls.append(url)
            return self._response

    settings = _make_settings("latest")
    with patch("src.services.marketplace.app_archive_version.httpx.AsyncClient", _FakeClient):
        first = await mod.resolve_app_archive_version(settings)
        second = await mod.resolve_app_archive_version(settings)
    assert first == "v0.2.0"
    assert second == "v0.2.0"
    assert len(fake_get_calls) == 1


def test_build_archive_urls_returns_three_targets() -> None:
    from src.services.marketplace.app_archive_version import build_archive_urls

    urls = build_archive_urls("twitter", "v0.1.0")
    assert len(urls) == 3
    targets = {a.target for a in urls}
    assert targets == {"darwin-arm64", "linux-x64", "win32-x64"}
    for archive in urls:
        assert archive.url == (
            f"https://github.com/holaboss-ai/holaboss-modules/releases/download/v0.1.0/"
            f"twitter-module-{archive.target}.tar.gz"
        )
```

- [ ] **Step 2: Run all tests in the file**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run pytest test/services/marketplace/test_app_archive_version.py -v
```
Expected: all three tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/services/marketplace/test_app_archive_version.py
git commit -m "test(marketplace): cover latest caching and build_archive_urls"
```

---

### Task A6: Write failing tests for extended `/app-templates` endpoint

**Files:**
- Create: `backend/test/api/v1/marketplace/test_app_templates.py`

- [ ] **Step 1: Inspect existing marketplace test patterns**

```bash
ls /Users/joshua/holaboss-ai/holaboss/backend/test/api/v1/marketplace/ 2>/dev/null
```
Open any existing file in that dir (or the closest sibling) to confirm how the FastAPI marketplace app is instantiated for tests. The `create_app` factory is at `src/api/v1/marketplace/main.py`.

- [ ] **Step 2: Write the tests**

```python
"""Tests for GET /api/v1/marketplace/app-templates."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.api.v1.marketplace.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_list_app_templates_includes_archives_for_all_targets(client: TestClient) -> None:
    async def _fake_resolve(_settings):
        return "v0.1.0"

    with patch(
        "src.api.v1.marketplace.routes.templates.resolve_app_archive_version",
        side_effect=_fake_resolve,
    ):
        resp = client.get("/api/v1/marketplace/app-templates")

    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload["templates"]) >= 1
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


def test_list_app_templates_falls_back_on_version_error(client: TestClient) -> None:
    async def _boom(_settings):
        raise RuntimeError("github down")

    with patch(
        "src.api.v1.marketplace.routes.templates.resolve_app_archive_version",
        side_effect=_boom,
    ):
        resp = client.get("/api/v1/marketplace/app-templates")

    assert resp.status_code == 200
    payload = resp.json()
    for template in payload["templates"]:
        assert template["version"] is None
        assert template["archives"] == []
```

- [ ] **Step 3: Run tests — expect failure**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run pytest test/api/v1/marketplace/test_app_templates.py -v
```
Expected: FAIL because the route doesn't yet attach `version`/`archives` (or because `resolve_app_archive_version` isn't imported in the route module — the patch target won't exist yet).

- [ ] **Step 4: Commit**

```bash
git add test/api/v1/marketplace/test_app_templates.py
git commit -m "test(marketplace): add failing tests for extended app-templates endpoint"
```

---

### Task A7: Extend `list_app_templates` route

**Files:**
- Modify: `backend/src/api/v1/marketplace/routes/templates.py` (around lines 203–211)

- [ ] **Step 1: Add imports at the top of the file**

Ensure these imports are present (add them near the existing imports):

```python
import logging

from src.config.environment import environment_settings
from src.services.marketplace.app_archive_version import (
    build_archive_urls,
    resolve_app_archive_version,
)

logger = logging.getLogger(__name__)
```

- [ ] **Step 2: Replace the `list_app_templates` handler body**

Replace the existing handler body with:

```python
@templates_router.get(
    "/app-templates",
    response_model=AppTemplateListResponse,
    status_code=status.HTTP_200_OK,
    operation_id="listAppTemplates",
)
async def list_app_templates(request: Request) -> AppTemplateListResponse:
    resolver: AppTemplateResolver = request.app.state.app_template_resolver
    try:
        version = await resolve_app_archive_version(environment_settings)
    except Exception:
        logger.warning(
            "app_templates.version_resolve_failed",
            extra={"event": "app_templates.version_resolve", "outcome": "error"},
            exc_info=True,
        )
        version = None

    templates = []
    for tmpl in resolver.list_templates():
        archives = build_archive_urls(tmpl.name, version) if version else []
        templates.append(tmpl.model_copy(update={"version": version, "archives": archives}))
    return AppTemplateListResponse(templates=templates)
```

- [ ] **Step 3: Run the endpoint tests**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run pytest test/api/v1/marketplace/test_app_templates.py -v
```
Expected: both tests PASS.

- [ ] **Step 4: Run the full marketplace test directory to catch regressions**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
uv run pytest test/api/v1/marketplace/ -v
```
Expected: all previously passing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/v1/marketplace/routes/templates.py
git commit -m "feat(marketplace): attach version and archives to app-templates response"
```

---

### Task A8: Run backend quality checks + update work log

**Files:**
- Modify: `backend/docs/work_log.md`

- [ ] **Step 1: Run backend checks**

```bash
cd /Users/joshua/holaboss-ai/holaboss/backend
make check
```
Expected: PASS. If ruff flags formatting, run `uv run ruff format .` and re-run.

- [ ] **Step 2: Append a work log entry**

Append at the bottom of `backend/docs/work_log.md`:

```markdown
## 2026-04-09 – Extended marketplace app-templates endpoint

- Added `AppTemplateArchive` model and `version` + `archives` fields to `AppTemplateMetadata`.
- Added `APP_ARCHIVE_VERSION` env setting; new `app_archive_version` module resolves `latest` via GitHub API with a 5-minute TTL cache.
- `/api/v1/marketplace/app-templates` now returns per-target archive URLs for all three desktop targets. Falls back to `version=None, archives=[]` when version resolution fails.
```

- [ ] **Step 3: Commit**

```bash
git add docs/work_log.md
git commit -m "docs(marketplace): log app-templates archive extension"
```

---

## Section B — Runtime state-store (TypeScript)

### Task B1: Add `AppCatalogEntryRecord` interface and schema

**Files:**
- Modify: `runtime/state-store/src/store.ts` (types block around line 263–280; schema init block around line 3542)

- [ ] **Step 1: Add the record interface**

Right after the existing `AppPortRecord` interface (around line 280), add:

```ts
export interface AppCatalogEntryRecord {
  appId: string;
  source: "marketplace" | "local";
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  tags: string[];
  version: string | null;
  archiveUrl: string | null;
  archivePath: string | null;
  target: string;
  cachedAt: string;
}
```

- [ ] **Step 2: Add the schema**

Find the `CREATE TABLE IF NOT EXISTS app_ports (...)` block. After its accompanying `CREATE INDEX IF NOT EXISTS idx_app_ports_workspace ON app_ports (workspace_id);`, add:

```ts
      CREATE TABLE IF NOT EXISTS app_catalog (
          app_id        TEXT NOT NULL,
          source        TEXT NOT NULL,
          name          TEXT NOT NULL,
          description   TEXT,
          icon          TEXT,
          category      TEXT,
          tags_json     TEXT NOT NULL DEFAULT '[]',
          version       TEXT,
          archive_url   TEXT,
          archive_path  TEXT,
          target        TEXT NOT NULL,
          cached_at     TEXT NOT NULL,
          PRIMARY KEY (source, app_id)
      );

      CREATE INDEX IF NOT EXISTS idx_app_catalog_source
          ON app_catalog (source);
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/state-store
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/state-store/src/store.ts
git commit -m "feat(state-store): add app_catalog table and AppCatalogEntryRecord type"
```

---

### Task B2: Write failing tests for state-store catalog methods

**Files:**
- Modify: `runtime/state-store/src/store.test.ts`

- [ ] **Step 1: Find the test harness pattern**

```bash
grep -n "upsertAppBuild\|app build" /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/state-store/src/store.test.ts | head
```
Use whatever helper the existing `app_builds` tests use to instantiate a fresh store (likely a function like `createEphemeralStore()` or an inline construction). Reuse that same helper for the new tests below.

- [ ] **Step 2: Append four new tests**

```ts
test("app_catalog upserts and lists entries for a given source", () => {
  const store = createEphemeralStore();

  store.upsertAppCatalogEntry({
    appId: "twitter",
    source: "marketplace",
    name: "Twitter / X",
    description: "Post tweets",
    icon: "https://example.test/twitter.svg",
    category: "social",
    tags: ["social media"],
    version: "v0.1.0",
    archiveUrl: "https://example.test/twitter-module-darwin-arm64.tar.gz",
    archivePath: null,
    target: "darwin-arm64",
    cachedAt: "2026-04-09T00:00:00Z",
  });

  const entries = store.listAppCatalogEntries({ source: "marketplace" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].appId, "twitter");
  assert.equal(entries[0].source, "marketplace");
  assert.deepEqual(entries[0].tags, ["social media"]);
  assert.equal(entries[0].archiveUrl, "https://example.test/twitter-module-darwin-arm64.tar.gz");
});

test("app_catalog clearAppCatalogSource wipes only the given source", () => {
  const store = createEphemeralStore();
  const base = {
    name: "Sample",
    description: null,
    icon: null,
    category: null,
    tags: [] as string[],
    version: null,
    target: "darwin-arm64",
    cachedAt: "2026-04-09T00:00:00Z",
  };
  store.upsertAppCatalogEntry({
    ...base, appId: "twitter", source: "marketplace",
    archiveUrl: "https://a.test/x.tar.gz", archivePath: null,
  });
  store.upsertAppCatalogEntry({
    ...base, appId: "twitter", source: "local",
    archiveUrl: null, archivePath: "/tmp/x.tar.gz",
  });

  const cleared = store.clearAppCatalogSource("marketplace");
  assert.equal(cleared, 1);
  const remaining = store.listAppCatalogEntries();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].source, "local");
});

test("app_catalog deleteAppCatalogEntry removes a single row", () => {
  const store = createEphemeralStore();
  store.upsertAppCatalogEntry({
    appId: "twitter", source: "marketplace", name: "X",
    description: null, icon: null, category: null, tags: [],
    version: "v0.1.0", archiveUrl: "https://a.test", archivePath: null,
    target: "darwin-arm64", cachedAt: "2026-04-09T00:00:00Z",
  });
  const deleted = store.deleteAppCatalogEntry({ source: "marketplace", appId: "twitter" });
  assert.equal(deleted, true);
  assert.equal(store.listAppCatalogEntries().length, 0);
});

test("app_catalog composite PK allows same appId in both sources", () => {
  const store = createEphemeralStore();
  const base = {
    appId: "twitter",
    name: "X",
    description: null,
    icon: null,
    category: null,
    tags: [] as string[],
    version: null,
    target: "darwin-arm64",
    cachedAt: "2026-04-09T00:00:00Z",
  };
  store.upsertAppCatalogEntry({
    ...base, source: "marketplace",
    archiveUrl: "https://a.test/x.tar.gz", archivePath: null,
  });
  store.upsertAppCatalogEntry({
    ...base, source: "local",
    archiveUrl: null, archivePath: "/tmp/x.tar.gz",
  });
  const all = store.listAppCatalogEntries();
  assert.equal(all.length, 2);
});
```

- [ ] **Step 3: Run the tests — expect failure**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/state-store
npm test
```
Expected: FAIL with `store.upsertAppCatalogEntry is not a function` or similar.

- [ ] **Step 4: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/state-store/src/store.test.ts
git commit -m "test(state-store): add failing tests for app_catalog CRUD"
```

---

### Task B3: Implement state-store app_catalog methods

**Files:**
- Modify: `runtime/state-store/src/store.ts` (after `deleteAppPort`, around line 2620)

- [ ] **Step 1: Add the four methods and a row mapper inside `RuntimeStateStore`**

Add this block after `deleteAppPort`:

```ts
  // --- App Catalog ---

  upsertAppCatalogEntry(params: {
    appId: string;
    source: "marketplace" | "local";
    name: string;
    description: string | null;
    icon: string | null;
    category: string | null;
    tags: string[];
    version: string | null;
    archiveUrl: string | null;
    archivePath: string | null;
    target: string;
    cachedAt: string;
  }): AppCatalogEntryRecord {
    const tagsJson = JSON.stringify(params.tags ?? []);
    this.db().prepare(`
      INSERT INTO app_catalog (
        app_id, source, name, description, icon, category,
        tags_json, version, archive_url, archive_path, target, cached_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, app_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        icon = excluded.icon,
        category = excluded.category,
        tags_json = excluded.tags_json,
        version = excluded.version,
        archive_url = excluded.archive_url,
        archive_path = excluded.archive_path,
        target = excluded.target,
        cached_at = excluded.cached_at
    `).run(
      params.appId,
      params.source,
      params.name,
      params.description,
      params.icon,
      params.category,
      tagsJson,
      params.version,
      params.archiveUrl,
      params.archivePath,
      params.target,
      params.cachedAt,
    );
    return {
      appId: params.appId,
      source: params.source,
      name: params.name,
      description: params.description,
      icon: params.icon,
      category: params.category,
      tags: [...(params.tags ?? [])],
      version: params.version,
      archiveUrl: params.archiveUrl,
      archivePath: params.archivePath,
      target: params.target,
      cachedAt: params.cachedAt,
    };
  }

  listAppCatalogEntries(
    params: { source?: "marketplace" | "local" } = {},
  ): AppCatalogEntryRecord[] {
    const rows = params.source
      ? this.db()
          .prepare<[string], Record<string, unknown>>(
            "SELECT * FROM app_catalog WHERE source = ? ORDER BY app_id",
          )
          .all(params.source)
      : this.db()
          .prepare<[], Record<string, unknown>>(
            "SELECT * FROM app_catalog ORDER BY source, app_id",
          )
          .all();
    return rows.map((row) => this.rowToAppCatalog(row));
  }

  clearAppCatalogSource(source: "marketplace" | "local"): number {
    const result = this.db()
      .prepare("DELETE FROM app_catalog WHERE source = ?")
      .run(source);
    return result.changes;
  }

  deleteAppCatalogEntry(params: { source: string; appId: string }): boolean {
    const result = this.db()
      .prepare("DELETE FROM app_catalog WHERE source = ? AND app_id = ?")
      .run(params.source, params.appId);
    return result.changes > 0;
  }

  private rowToAppCatalog(row: Record<string, unknown>): AppCatalogEntryRecord {
    let tags: string[] = [];
    const tagsRaw = row.tags_json;
    if (typeof tagsRaw === "string" && tagsRaw.length > 0) {
      try {
        const parsed = JSON.parse(tagsRaw);
        if (Array.isArray(parsed)) {
          tags = parsed.filter((t): t is string => typeof t === "string");
        }
      } catch {
        tags = [];
      }
    }
    const sourceRaw = row.source == null ? "" : String(row.source);
    const source: "marketplace" | "local" =
      sourceRaw === "marketplace" || sourceRaw === "local" ? sourceRaw : "marketplace";
    return {
      appId: String(row.app_id ?? ""),
      source,
      name: String(row.name ?? ""),
      description: row.description == null ? null : String(row.description),
      icon: row.icon == null ? null : String(row.icon),
      category: row.category == null ? null : String(row.category),
      tags,
      version: row.version == null ? null : String(row.version),
      archiveUrl: row.archive_url == null ? null : String(row.archive_url),
      archivePath: row.archive_path == null ? null : String(row.archive_path),
      target: String(row.target ?? ""),
      cachedAt: String(row.cached_at ?? ""),
    };
  }
```

- [ ] **Step 2: Run the state-store tests**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/state-store
npm test
```
Expected: all four new `app_catalog` tests pass; prior tests still pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/state-store/src/store.ts
git commit -m "feat(state-store): implement app_catalog CRUD methods"
```

---

## Section C — Runtime api-server (TypeScript)

### Task C1: Add `tar` dependency

**Files:**
- Modify: `runtime/api-server/package.json`

- [ ] **Step 1: Install tar + types**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server
npm install --save tar@^7.4.3
npm install --save-dev @types/tar@^6.1.13
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/package.json runtime/api-server/package-lock.json
git commit -m "feat(runtime): add tar dependency for app archive extraction"
```

---

### Task C2: Create the test fixture tarball

**Files:**
- Create: `runtime/api-server/src/__fixtures__/build-fixture.mjs`
- Create: `runtime/api-server/src/__fixtures__/minimal-app.tar.gz` (generated)

- [ ] **Step 1: Ensure the fixtures directory exists**

```bash
mkdir -p /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server/src/__fixtures__
```

- [ ] **Step 2: Write the fixture builder script**

```js
// Builds runtime/api-server/src/__fixtures__/minimal-app.tar.gz deterministically.
// Run: node src/__fixtures__/build-fixture.mjs
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as tar from "tar";

const here = path.dirname(new URL(import.meta.url).pathname);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "holaboss-fixture-"));

fs.writeFileSync(
  path.join(stage, "app.runtime.yaml"),
  `app_id: "minimal"
name: "Minimal"
slug: "minimal"

lifecycle:
  setup: "true"
  start: "true"
  stop: "true"

healthchecks:
  mcp:
    path: /mcp/health
    timeout_s: 5

mcp:
  enabled: false
  transport: http-sse
  port: 3099
  path: /mcp/sse
`,
);
fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify({ name: "minimal-module", version: "0.0.0" }, null, 2),
);

const out = path.join(here, "minimal-app.tar.gz");
await tar.c(
  { gzip: true, file: out, cwd: stage, portable: true, noMtime: true },
  ["app.runtime.yaml", "package.json"],
);
console.log(`wrote ${out}`);

fs.rmSync(stage, { recursive: true, force: true });
```

- [ ] **Step 3: Generate the fixture**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server
node src/__fixtures__/build-fixture.mjs
```
Expected: `wrote .../minimal-app.tar.gz`. Verify:

```bash
tar tzf src/__fixtures__/minimal-app.tar.gz
```
Expected: `app.runtime.yaml` and `package.json`.

- [ ] **Step 4: Commit both files**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/__fixtures__/build-fixture.mjs \
        runtime/api-server/src/__fixtures__/minimal-app.tar.gz
git commit -m "test(runtime): add minimal-app fixture tarball"
```

---

### Task C3: Write failing test for `GET /api/v1/apps/catalog`

**Files:**
- Modify: `runtime/api-server/src/app.test.ts`

- [ ] **Step 1: Find the existing test harness**

```bash
grep -n "app.inject\|makeApp\|createTestServer\|createAppUnderTest" /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server/src/app.test.ts | head -20
```
Note the helper name (likely `createAppUnderTest` or similar). Reuse it in the new tests below — **replace `createAppUnderTest` with whatever name the existing tests use** if different.

- [ ] **Step 2: Add a new test**

```ts
test("GET /api/v1/apps/catalog returns entries filtered by source", async () => {
  const { app, store } = await createAppUnderTest();
  store.upsertAppCatalogEntry({
    appId: "twitter",
    source: "marketplace",
    name: "Twitter / X",
    description: null, icon: null, category: null, tags: ["social"],
    version: "v0.1.0",
    archiveUrl: "https://example.test/twitter-module-darwin-arm64.tar.gz",
    archivePath: null,
    target: "darwin-arm64",
    cachedAt: "2026-04-09T00:00:00Z",
  });
  store.upsertAppCatalogEntry({
    appId: "linkedin",
    source: "local",
    name: "LinkedIn",
    description: null, icon: null, category: null, tags: [],
    version: null, archiveUrl: null,
    archivePath: "/tmp/linkedin-module-darwin-arm64.tar.gz",
    target: "darwin-arm64",
    cachedAt: "2026-04-09T00:00:00Z",
  });

  const res = await app.inject({ method: "GET", url: "/api/v1/apps/catalog?source=marketplace" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.count, 1);
  assert.equal(body.entries[0].app_id, "twitter");
  assert.deepEqual(body.entries[0].tags, ["social"]);
});
```

- [ ] **Step 3: Run the test — expect failure**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server
npm test
```
Expected: FAIL with 404 on the new test.

- [ ] **Step 4: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/app.test.ts
git commit -m "test(runtime): add failing test for GET /apps/catalog"
```

---

### Task C4: Implement `GET /api/v1/apps/catalog`

**Files:**
- Modify: `runtime/api-server/src/app.ts` (add helper near line 1089 where `sanitizeAppId` lives; add route near the existing `/api/v1/apps` routes around line 3279)

- [ ] **Step 1: Import `AppCatalogEntryRecord`**

In the existing import block for `@holaboss/runtime-state-store`, add `AppCatalogEntryRecord` to the named imports. Example:

```ts
import type {
  AppBuildRecord,
  AppCatalogEntryRecord,
  // ... existing imports
} from "@holaboss/runtime-state-store";
```

- [ ] **Step 2: Add the wire-mapping helper**

Near `sanitizeAppId`, add:

```ts
function appCatalogEntryToWire(record: AppCatalogEntryRecord): Record<string, unknown> {
  return {
    app_id: record.appId,
    source: record.source,
    name: record.name,
    description: record.description,
    icon: record.icon,
    category: record.category,
    tags: record.tags,
    version: record.version,
    archive_url: record.archiveUrl,
    archive_path: record.archivePath,
    target: record.target,
    cached_at: record.cachedAt,
  };
}
```

- [ ] **Step 3: Register the route right before `app.get("/api/v1/apps", ...)`**

```ts
app.get("/api/v1/apps/catalog", async (request) => {
  const query = isRecord(request.query) ? request.query : {};
  const rawSource = typeof query.source === "string" ? query.source.trim() : "";
  const source =
    rawSource === "marketplace" || rawSource === "local" ? rawSource : undefined;
  const entries = store.listAppCatalogEntries(source ? { source } : undefined);
  return { entries: entries.map(appCatalogEntryToWire), count: entries.length };
});
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server
npm test
```
Expected: the new `GET /apps/catalog` test passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/app.ts
git commit -m "feat(runtime): add GET /api/v1/apps/catalog route"
```

---

### Task C5: Write failing tests for `POST /api/v1/apps/catalog/sync`

**Files:**
- Modify: `runtime/api-server/src/app.test.ts`

- [ ] **Step 1: Append tests**

```ts
test("POST /api/v1/apps/catalog/sync replaces all entries for a source", async () => {
  const { app, store } = await createAppUnderTest();
  store.upsertAppCatalogEntry({
    appId: "old", source: "marketplace", name: "Old",
    description: null, icon: null, category: null, tags: [],
    version: "v0.0.1",
    archiveUrl: "https://example.test/old.tar.gz", archivePath: null,
    target: "darwin-arm64",
    cachedAt: "2026-04-08T00:00:00Z",
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/catalog/sync",
    payload: {
      source: "marketplace",
      target: "darwin-arm64",
      entries: [
        {
          app_id: "twitter",
          name: "Twitter / X",
          description: "Tweet stuff",
          icon: null,
          category: "social",
          tags: ["social"],
          version: "v0.1.0",
          archive_url: "https://example.test/twitter.tar.gz",
          archive_path: null,
        },
      ],
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.synced, 1);
  assert.equal(body.source, "marketplace");

  const remaining = store.listAppCatalogEntries({ source: "marketplace" });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].appId, "twitter");
});

test("POST /api/v1/apps/catalog/sync rejects invalid source", async () => {
  const { app } = await createAppUnderTest();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/catalog/sync",
    payload: { source: "bogus", target: "darwin-arm64", entries: [] },
  });
  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server
npm test
```
Expected: both new tests fail.

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/app.test.ts
git commit -m "test(runtime): add failing tests for POST /apps/catalog/sync"
```

---

### Task C6: Implement `POST /api/v1/apps/catalog/sync`

**Files:**
- Modify: `runtime/api-server/src/app.ts`

- [ ] **Step 1: Add the route right below `GET /api/v1/apps/catalog`**

```ts
app.post("/api/v1/apps/catalog/sync", async (request, reply) => {
  if (!isRecord(request.body)) {
    return sendError(reply, 400, "request body must be an object");
  }
  const rawSource = requiredString(request.body.source, "source");
  if (rawSource !== "marketplace" && rawSource !== "local") {
    return sendError(reply, 400, "source must be 'marketplace' or 'local'");
  }
  const source: "marketplace" | "local" = rawSource;
  const target = requiredString(request.body.target, "target");
  const entries = Array.isArray(request.body.entries) ? request.body.entries : [];

  store.clearAppCatalogSource(source);
  const now = new Date().toISOString();
  let synced = 0;
  for (const raw of entries) {
    if (!isRecord(raw)) continue;
    let appId: string;
    try {
      appId = sanitizeAppId(requiredString(raw.app_id, "app_id"));
    } catch {
      continue;
    }
    const tagsRaw = raw.tags;
    const tags = Array.isArray(tagsRaw)
      ? tagsRaw.filter((t): t is string => typeof t === "string")
      : [];
    store.upsertAppCatalogEntry({
      appId,
      source,
      name: requiredString(raw.name, "name"),
      description: typeof raw.description === "string" ? raw.description : null,
      icon: typeof raw.icon === "string" ? raw.icon : null,
      category: typeof raw.category === "string" ? raw.category : null,
      tags,
      version: typeof raw.version === "string" ? raw.version : null,
      archiveUrl: typeof raw.archive_url === "string" ? raw.archive_url : null,
      archivePath: typeof raw.archive_path === "string" ? raw.archive_path : null,
      target,
      cachedAt: now,
    });
    synced += 1;
  }
  return { synced, source, target };
});
```

- [ ] **Step 2: Run the tests**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server
npm test
```
Expected: both new tests pass. No regressions.

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/app.ts
git commit -m "feat(runtime): add POST /api/v1/apps/catalog/sync route"
```

---

### Task C7: Add `isAllowedArchivePath` helper with a unit test

**Files:**
- Modify: `runtime/api-server/src/app.ts`
- Modify: `runtime/api-server/src/app.test.ts`

- [ ] **Step 1: Add the helper near `sanitizeAppId`**

```ts
export function isAllowedArchivePath(p: string): boolean {
  if (!p) return false;
  const abs = path.resolve(p);
  const candidates: string[] = [];
  candidates.push(path.resolve(os.tmpdir()));
  const envOverride = process.env.HOLABOSS_APP_ARCHIVE_DIR;
  if (envOverride && envOverride.trim().length > 0) {
    candidates.push(path.resolve(envOverride.trim()));
  }
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && home.trim().length > 0) {
    candidates.push(path.resolve(home.trim(), ".holaboss", "downloads"));
  }
  for (const root of candidates) {
    if (abs === root || abs.startsWith(root + path.sep)) {
      return true;
    }
  }
  return false;
}
```

Verify `os` is already imported at the top of the file (look for `import * as os from "node:os"`). If not, add it.

- [ ] **Step 2: Add a unit test**

```ts
test("isAllowedArchivePath accepts tmpdir and rejects arbitrary paths", async () => {
  const { isAllowedArchivePath } = await import("./app.ts");
  const tmp = pathSync.join(osSync.tmpdir(), "holaboss-test-archive.tar.gz");
  assert.equal(isAllowedArchivePath(tmp), true);
  assert.equal(isAllowedArchivePath("/etc/passwd"), false);
  assert.equal(isAllowedArchivePath(""), false);
});
```

(The `pathSync`/`osSync` identifiers are added in Task C8; if they don't yet exist in the file, temporarily inline `import("node:os").then(o => o.tmpdir())` or add the imports now.)

- [ ] **Step 3: Run the test**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server
npm test
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/app.ts runtime/api-server/src/app.test.ts
git commit -m "feat(runtime): add isAllowedArchivePath helper with tests"
```

---

### Task C8: Write failing tests for `POST /api/v1/apps/install-archive`

**Files:**
- Modify: `runtime/api-server/src/app.test.ts`

- [ ] **Step 1: Add fs/os/path imports + fixture path at the top**

If the test file doesn't already have them, add near its top:

```ts
import * as fsSync from "node:fs";
import * as osSync from "node:os";
import * as pathSync from "node:path";

const MINIMAL_APP_FIXTURE = pathSync.join(
  pathSync.dirname(new URL(import.meta.url).pathname),
  "__fixtures__",
  "minimal-app.tar.gz",
);
```

- [ ] **Step 2: Add the install-archive tests**

```ts
test("POST /apps/install-archive rejects path outside allowed roots", async () => {
  const { app, createWorkspace } = await createAppUnderTest();
  const workspaceId = await createWorkspace();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install-archive",
    payload: {
      workspace_id: workspaceId,
      app_id: "minimal",
      archive_path: "/etc/passwd",
    },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.match(body.error || body.detail || "", /outside allowed roots/);
});

test("POST /apps/install-archive rejects missing file", async () => {
  const { app, createWorkspace } = await createAppUnderTest();
  const workspaceId = await createWorkspace();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install-archive",
    payload: {
      workspace_id: workspaceId,
      app_id: "minimal",
      archive_path: pathSync.join(osSync.tmpdir(), "does-not-exist.tar.gz"),
    },
  });
  assert.equal(res.statusCode, 400);
});

test("POST /apps/install-archive extracts tarball and registers in workspace.yaml", async () => {
  const { app, createWorkspace, workspaceDir } = await createAppUnderTest();
  const workspaceId = await createWorkspace();

  const stagedArchive = pathSync.join(osSync.tmpdir(), `install-archive-test-${Date.now()}.tar.gz`);
  fsSync.copyFileSync(MINIMAL_APP_FIXTURE, stagedArchive);

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install-archive",
    payload: {
      workspace_id: workspaceId,
      app_id: "minimal",
      archive_path: stagedArchive,
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.app_id, "minimal");
  assert.equal(body.status, "enabled");

  const dir = pathSync.join(workspaceDir(workspaceId), "apps", "minimal");
  assert.equal(fsSync.existsSync(pathSync.join(dir, "app.runtime.yaml")), true);
  assert.equal(fsSync.existsSync(pathSync.join(dir, "package.json")), true);

  const yamlBody = fsSync.readFileSync(pathSync.join(workspaceDir(workspaceId), "workspace.yaml"), "utf8");
  assert.match(yamlBody, /app_id:\s*["']?minimal["']?/);

  fsSync.rmSync(stagedArchive, { force: true });
});

test("POST /apps/install-archive rejects re-install when apps/{id} already exists", async () => {
  const { app, createWorkspace, workspaceDir } = await createAppUnderTest();
  const workspaceId = await createWorkspace();
  const preDir = pathSync.join(workspaceDir(workspaceId), "apps", "minimal");
  fsSync.mkdirSync(preDir, { recursive: true });
  fsSync.writeFileSync(pathSync.join(preDir, "sentinel.txt"), "existing");

  const stagedArchive = pathSync.join(osSync.tmpdir(), `install-archive-reinstall-${Date.now()}.tar.gz`);
  fsSync.copyFileSync(MINIMAL_APP_FIXTURE, stagedArchive);

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install-archive",
    payload: {
      workspace_id: workspaceId,
      app_id: "minimal",
      archive_path: stagedArchive,
    },
  });
  assert.equal(res.statusCode, 409);
  fsSync.rmSync(stagedArchive, { force: true });
});
```

> If the existing test harness helper (`createAppUnderTest`) doesn't currently return `createWorkspace` and `workspaceDir`, extend it so it does. The minimum surface the install-archive tests need is: `app`, `store`, `createWorkspace()` (returns a string), `workspaceDir(id)` (returns an absolute path).

- [ ] **Step 3: Run the tests — expect failure**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server
npm test
```
Expected: the four new install-archive tests fail (404 on the route).

- [ ] **Step 4: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/app.test.ts
git commit -m "test(runtime): add failing tests for POST /apps/install-archive"
```

---

### Task C9: Implement `POST /api/v1/apps/install-archive`

**Files:**
- Modify: `runtime/api-server/src/app.ts`

- [ ] **Step 1: Add `tar` import at the top of the file**

```ts
import * as tar from "tar";
```

- [ ] **Step 2: Add the route right before the existing `POST /api/v1/apps/install`**

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

  const archivePath = requiredString(request.body.archive_path, "archive_path");
  if (!isAllowedArchivePath(archivePath)) {
    return sendError(reply, 400, "archive_path outside allowed roots");
  }
  if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
    return sendError(reply, 400, "archive_path does not exist");
  }

  const workspaceDir = store.workspaceDir(workspaceId);
  const appDir = path.join(workspaceDir, "apps", appId);
  if (fs.existsSync(appDir) && fs.readdirSync(appDir).length > 0) {
    return sendError(reply, 409, "app already installed — uninstall first");
  }
  fs.mkdirSync(appDir, { recursive: true });

  try {
    await tar.x({ file: archivePath, cwd: appDir, strict: true });
  } catch (error) {
    fs.rmSync(appDir, { recursive: true, force: true });
    return sendError(
      reply,
      400,
      `archive extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const appYamlPath = path.join(appDir, "app.runtime.yaml");
  if (!fs.existsSync(appYamlPath)) {
    fs.rmSync(appDir, { recursive: true, force: true });
    return sendError(reply, 400, "app.runtime.yaml not found in archive root");
  }

  let parsed: ParsedInstalledApp;
  try {
    parsed = parseInstalledAppRuntime(
      fs.readFileSync(appYamlPath, "utf8"),
      appId,
      `apps/${appId}/app.runtime.yaml`,
    );
  } catch (error) {
    fs.rmSync(appDir, { recursive: true, force: true });
    return sendError(
      reply,
      400,
      error instanceof Error ? error.message : "invalid app.runtime.yaml",
    );
  }

  const lifecycle: Record<string, string> = {};
  if (parsed.lifecycle.setup) lifecycle.setup = parsed.lifecycle.setup;
  if (parsed.lifecycle.start) lifecycle.start = parsed.lifecycle.start;
  if (parsed.lifecycle.stop) lifecycle.stop = parsed.lifecycle.stop;
  appendWorkspaceApplication(workspaceDir, {
    appId,
    configPath: parsed.configPath,
    lifecycle: Object.keys(lifecycle).length > 0 ? lifecycle : null,
  });

  try {
    await ensureAppRunning(workspaceId, appId);
    return {
      app_id: appId,
      status: "enabled",
      detail: "App installed and running",
      ready: true,
      error: null,
    };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    return {
      app_id: appId,
      status: "enabled",
      detail: message,
      ready: false,
      error: message,
    };
  }
});
```

- [ ] **Step 3: Run install-archive tests**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server
npm test
```
Expected: all four new install-archive tests pass. The "extracts tarball" test expects `statusCode === 200` regardless of whether `ensureAppRunning` succeeds (the fixture's `lifecycle.start: "true"` should return cleanly).

- [ ] **Step 4: Run the entire api-server test suite**

```bash
npm test
```
Expected: all tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add runtime/api-server/src/app.ts
git commit -m "feat(runtime): add POST /api/v1/apps/install-archive route"
```

---

### Task C10: Runtime test sweep

- [ ] **Step 1: Run the top-level runtime test script**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
npm run runtime:test
```
Expected: all runtime tests (state-store + api-server) green.

- [ ] **Step 2: Typecheck both packages**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server && npm run typecheck
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/state-store && npx tsc --noEmit
```
Expected: no errors.

---

## Section D — Desktop (Electron main + preload + renderer)

### Task D1: Extend TypeScript payload types

**Files:**
- Modify: `desktop/src/types/electron.d.ts`

- [ ] **Step 1: Locate existing payload interfaces**

```bash
grep -n "AppTemplateMetadata\|InstalledWorkspaceApp\|electronAPI" /Users/joshua/holaboss-ai/holaboss/holaOS/desktop/src/types/electron.d.ts | head -20
```
Note the line numbers for the `InstalledWorkspaceAppPayload` and the `workspace:` block inside the `electronAPI` surface.

- [ ] **Step 2: Add new payload types near `InstalledWorkspaceAppPayload`**

```ts
interface AppTemplateArchivePayload {
  target: string;
  url: string;
}

interface AppCatalogEntryPayload {
  app_id: string;
  source: "marketplace" | "local";
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  tags: string[];
  version: string | null;
  archive_url: string | null;
  archive_path: string | null;
  target: string;
  cached_at: string;
}

interface AppCatalogListResponse {
  entries: AppCatalogEntryPayload[];
  count: number;
}

interface AppCatalogSyncResponse {
  synced: number;
  source: "marketplace" | "local";
  target: string;
}

interface InstallAppFromCatalogRequest {
  workspaceId: string;
  appId: string;
  source: "marketplace" | "local";
}

interface InstallAppFromCatalogResponse {
  app_id: string;
  status: string;
  detail: string;
  ready: boolean;
  error: string | null;
}
```

- [ ] **Step 3: Extend the existing app-template payload**

Find `AppTemplateMetadataPayload` (or `AppTemplateListResponsePayload` if it wraps templates). Add two optional fields:

```ts
interface AppTemplateMetadataPayload {
  // ... existing fields ...
  version?: string | null;
  archives?: AppTemplateArchivePayload[];
}
```

If no such interface currently exists in the desktop types, create one here that mirrors the backend's shape.

- [ ] **Step 4: Extend the `electronAPI.workspace` interface**

Inside the `workspace` object (the block that contains `listInstalledApps`, `removeInstalledApp`), add:

```ts
listAppCatalog: (params: { source?: "marketplace" | "local" }) => Promise<AppCatalogListResponse>;
syncAppCatalog: (params: { source: "marketplace" | "local" }) => Promise<AppCatalogSyncResponse>;
installAppFromCatalog: (params: InstallAppFromCatalogRequest) => Promise<InstallAppFromCatalogResponse>;
```

- [ ] **Step 5: Typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add desktop/src/types/electron.d.ts
git commit -m "feat(desktop): add app catalog and install payload types"
```

---

### Task D2: Add local target + `hola-boss-apps/dist` scanner helpers

**Files:**
- Modify: `desktop/electron/main.ts` (near `localModulesRootCandidates` around line 6892)

- [ ] **Step 1: Add the target resolver near `collectLocalTrackedFiles`**

```ts
function resolveLocalArchiveTarget(): "darwin-arm64" | "linux-x64" | "win32-x64" {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "win32" && arch === "x64") return "win32-x64";
  throw new Error(`Unsupported app archive target: ${platform}/${arch}`);
}
```

- [ ] **Step 2: Add `localAppsRootCandidates` and `resolveLocalAppsRoot` (mirror existing template helpers)**

Below `resolveLocalModulesRoot`:

```ts
function localAppsRootCandidates() {
  return [
    internalOverride("HOLABOSS_APPS_ROOT"),
    path.resolve(process.cwd(), "..", "..", "hola-boss-apps"),
    path.resolve(process.cwd(), "..", "hola-boss-apps"),
    path.resolve(app.getAppPath(), "..", "..", "..", "..", "hola-boss-apps"),
  ].filter(Boolean) as string[];
}

function resolveLocalAppsRoot(): string | null {
  for (const candidate of localAppsRootCandidates()) {
    const resolved = path.resolve(candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}
```

- [ ] **Step 3: Add the dist scanner**

```ts
interface LocalAppArchiveScanEntry {
  appId: string;
  filePath: string;
  target: string;
}

async function scanLocalAppArchives(): Promise<LocalAppArchiveScanEntry[]> {
  const root = resolveLocalAppsRoot();
  if (!root) return [];
  const distDir = path.join(root, "dist");
  if (!existsSync(distDir)) return [];
  let target: string;
  try {
    target = resolveLocalArchiveTarget();
  } catch {
    return [];
  }
  const files = await fs.readdir(distDir);
  const pattern = new RegExp(`^(.+)-module-${target}\\.tar\\.gz$`);
  const out: LocalAppArchiveScanEntry[] = [];
  for (const name of files) {
    const match = name.match(pattern);
    if (!match) continue;
    out.push({ appId: match[1], filePath: path.join(distDir, name), target });
  }
  return out;
}
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop
npm run typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add desktop/electron/main.ts
git commit -m "feat(desktop): add local hola-boss-apps dist scanner helpers"
```

---

### Task D3: Add `listAppTemplatesViaControlPlane` and `downloadAppArchive`

**Files:**
- Modify: `desktop/electron/main.ts`

- [ ] **Step 1: Add control-plane fetch function below `listMarketplaceTemplates`**

```ts
interface AppTemplateListResponsePayload {
  templates: AppTemplateMetadataPayload[];
}

async function listAppTemplatesViaControlPlane(): Promise<AppTemplateListResponsePayload> {
  const baseUrl = marketplaceBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/api/v1/marketplace/app-templates`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      return (await res.json()) as AppTemplateListResponsePayload;
    }
  } catch {
    // Fall through to authenticated path.
  }
  await ensureRuntimeBindingReadyForWorkspaceFlow("marketplace_app_templates", {
    allowProvisionWhenUnmanaged: true,
    waitForStartupSync: true,
  });
  return requestControlPlaneJson<AppTemplateListResponsePayload>({
    service: "marketplace",
    method: "GET",
    path: "/api/v1/marketplace/app-templates",
  });
}
```

- [ ] **Step 2: Add the download helper**

```ts
async function downloadAppArchive(url: string, appId: string): Promise<string> {
  const dir = path.join(os.tmpdir(), "holaboss-app-archives");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${appId}-${Date.now()}.tar.gz`);

  const res = await fetch(url, { method: "GET" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number.parseInt(totalHeader, 10) : 0;
  let received = 0;

  const fileStream = fs.createWriteStream(filePath);
  const reader = res.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        fileStream.write(value);
        received += value.byteLength;
        mainWindow?.webContents.send("app-install-progress", {
          appId,
          phase: "downloading",
          bytes: received,
          total,
        });
      }
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

Verify `os` is imported near the top of the file. If not, add `import * as os from "node:os";`.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add desktop/electron/main.ts
git commit -m "feat(desktop): add app template fetch and archive download helpers"
```

---

### Task D4: Implement `listAppCatalog` and `syncAppCatalog`

**Files:**
- Modify: `desktop/electron/main.ts`

- [ ] **Step 1: Add a local static catalog metadata table**

Main-process code cannot import from `src/` (renderer). Inline a minimal copy of the display metadata for the 6 known modules next to the existing app helpers:

```ts
const STATIC_APP_CATALOG: Record<string, {
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  tags: string[];
}> = {
  twitter: {
    name: "Twitter / X",
    description: "Short-form post drafting and thread editing.",
    icon: null,
    category: "social",
    tags: ["social media", "twitter"],
  },
  linkedin: {
    name: "LinkedIn",
    description: "Long-form post drafting and professional publishing.",
    icon: null,
    category: "social",
    tags: ["social media", "linkedin"],
  },
  reddit: {
    name: "Reddit",
    description: "Subreddit posts, comments and community replies.",
    icon: null,
    category: "social",
    tags: ["social media", "reddit"],
  },
  gmail: {
    name: "Gmail",
    description: "Email drafts, replies, and thread management.",
    icon: null,
    category: "communication",
    tags: ["email", "gmail"],
  },
  sheets: {
    name: "Google Sheets",
    description: "Spreadsheet data as a lightweight database.",
    icon: null,
    category: "productivity",
    tags: ["spreadsheet", "google sheets"],
  },
  github: {
    name: "GitHub",
    description: "Repository activity tracking and release notes.",
    icon: null,
    category: "developer",
    tags: ["github", "developer"],
  },
};

function staticCatalogMeta(appId: string) {
  return (
    STATIC_APP_CATALOG[appId] ?? {
      name: appId,
      description: null,
      icon: null,
      category: null,
      tags: [] as string[],
    }
  );
}
```

- [ ] **Step 2: Add `listAppCatalog`**

```ts
async function listAppCatalog(params: {
  source?: "marketplace" | "local";
}): Promise<AppCatalogListResponse> {
  const query: Record<string, string> = {};
  if (params.source) query.source = params.source;
  return requestRuntimeJson<AppCatalogListResponse>({
    method: "GET",
    path: "/api/v1/apps/catalog",
    params: query,
  });
}
```

- [ ] **Step 3: Add `syncAppCatalog`**

```ts
async function syncAppCatalog(params: {
  source: "marketplace" | "local";
}): Promise<AppCatalogSyncResponse> {
  const target = resolveLocalArchiveTarget();

  if (params.source === "marketplace") {
    const resp = await listAppTemplatesViaControlPlane();
    const entries: Array<Record<string, unknown>> = [];
    for (const tmpl of resp.templates) {
      const archives = Array.isArray(tmpl.archives) ? tmpl.archives : [];
      const matching = archives.find((a) => a?.target === target);
      if (!matching) continue;
      const meta = staticCatalogMeta(tmpl.name);
      entries.push({
        app_id: tmpl.name,
        name: meta.name,
        description: tmpl.description ?? meta.description,
        icon: tmpl.icon ?? meta.icon,
        category: tmpl.category ?? meta.category,
        tags: Array.isArray(tmpl.tags) && tmpl.tags.length > 0 ? tmpl.tags : meta.tags,
        version: tmpl.version ?? null,
        archive_url: matching.url,
        archive_path: null,
      });
    }
    return requestRuntimeJson<AppCatalogSyncResponse>({
      method: "POST",
      path: "/api/v1/apps/catalog/sync",
      payload: { source: "marketplace", target, entries },
    });
  }

  const scanned = await scanLocalAppArchives();
  const entries = scanned.map((row) => {
    const meta = staticCatalogMeta(row.appId);
    return {
      app_id: row.appId,
      name: meta.name,
      description: meta.description,
      icon: meta.icon,
      category: meta.category,
      tags: meta.tags,
      version: null,
      archive_url: null,
      archive_path: row.filePath,
    };
  });
  return requestRuntimeJson<AppCatalogSyncResponse>({
    method: "POST",
    path: "/api/v1/apps/catalog/sync",
    payload: { source: "local", target, entries },
  });
}
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop
npm run typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add desktop/electron/main.ts
git commit -m "feat(desktop): add listAppCatalog and syncAppCatalog"
```

---

### Task D5: Implement `installAppFromCatalog`

**Files:**
- Modify: `desktop/electron/main.ts`

- [ ] **Step 1: Add the install function after `syncAppCatalog`**

```ts
async function installAppFromCatalog(params: {
  workspaceId: string;
  appId: string;
  source: "marketplace" | "local";
}): Promise<InstallAppFromCatalogResponse> {
  const listing = await listAppCatalog({ source: params.source });
  const entry = listing.entries.find((e) => e.app_id === params.appId);
  if (!entry) {
    throw new Error(`App '${params.appId}' not found in ${params.source} catalog`);
  }

  let archivePath: string;
  let cleanupTempFile = false;
  if (params.source === "marketplace") {
    if (!entry.archive_url) {
      throw new Error(`Catalog entry for '${params.appId}' is missing archive_url`);
    }
    mainWindow?.webContents.send("app-install-progress", {
      appId: params.appId,
      phase: "downloading",
      bytes: 0,
      total: 0,
    });
    archivePath = await downloadAppArchive(entry.archive_url, params.appId);
    cleanupTempFile = true;
  } else {
    if (!entry.archive_path) {
      throw new Error(`Catalog entry for '${params.appId}' is missing archive_path`);
    }
    archivePath = entry.archive_path;
  }

  mainWindow?.webContents.send("app-install-progress", {
    appId: params.appId,
    phase: "installing",
    bytes: 0,
    total: 0,
  });

  try {
    const resp = await requestRuntimeJson<InstallAppFromCatalogResponse>({
      method: "POST",
      path: "/api/v1/apps/install-archive",
      payload: {
        workspace_id: params.workspaceId,
        app_id: params.appId,
        archive_path: archivePath,
      },
      timeoutMs: 300_000,
    });
    return resp;
  } finally {
    if (cleanupTempFile) {
      try {
        fs.rmSync(archivePath, { force: true });
      } catch {
        /* best effort */
      }
    }
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add desktop/electron/main.ts
git commit -m "feat(desktop): add installAppFromCatalog with download + extract flow"
```

---

### Task D6: Register IPC handlers + preload exposure

**Files:**
- Modify: `desktop/electron/main.ts` (near `handleTrustedIpc("workspace:removeInstalledApp", ...)` around line 13624)
- Modify: `desktop/electron/preload.ts`

- [ ] **Step 1: Add IPC registrations in `main.ts`**

Directly after the `workspace:removeInstalledApp` registration:

```ts
handleTrustedIpc(
  "workspace:listAppCatalog",
  ["main"],
  async (_event, params: { source?: "marketplace" | "local" }) => listAppCatalog(params),
);

handleTrustedIpc(
  "workspace:syncAppCatalog",
  ["main"],
  async (_event, params: { source: "marketplace" | "local" }) => syncAppCatalog(params),
);

handleTrustedIpc(
  "workspace:installAppFromCatalog",
  ["main"],
  async (_event, params: InstallAppFromCatalogRequest) =>
    installAppFromCatalog({
      workspaceId: params.workspaceId,
      appId: params.appId,
      source: params.source,
    }),
);
```

- [ ] **Step 2: Add preload bindings**

```bash
grep -n "workspace:" /Users/joshua/holaboss-ai/holaboss/holaOS/desktop/electron/preload.ts | head -20
```
Inside the `workspace:` object passed to `contextBridge.exposeInMainWorld("electronAPI", { workspace: { ... } })`, add:

```ts
listAppCatalog: (params: { source?: "marketplace" | "local" }) =>
  ipcRenderer.invoke("workspace:listAppCatalog", params),
syncAppCatalog: (params: { source: "marketplace" | "local" }) =>
  ipcRenderer.invoke("workspace:syncAppCatalog", params),
installAppFromCatalog: (params: {
  workspaceId: string;
  appId: string;
  source: "marketplace" | "local";
}) => ipcRenderer.invoke("workspace:installAppFromCatalog", params),
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add desktop/electron/main.ts desktop/electron/preload.ts
git commit -m "feat(desktop): expose app catalog and install IPC handlers"
```

---

### Task D7: Extend `workspaceDesktop` context with catalog state

**Files:**
- Modify: `desktop/src/lib/workspaceDesktop.tsx` (interface at line 43; state declarations near line 157; methods near `removeInstalledApp` around line 483)

- [ ] **Step 1: Extend the interface**

Inside `WorkspaceDesktopContextValue`, next to `removeInstalledApp`:

```tsx
appCatalog: AppCatalogEntryPayload[];
isLoadingAppCatalog: boolean;
appCatalogError: string;
appCatalogSource: "marketplace" | "local";
setAppCatalogSource: (source: "marketplace" | "local") => void;
refreshAppCatalog: () => Promise<void>;
installingAppId: string | null;
installAppFromCatalog: (appId: string) => Promise<void>;
```

- [ ] **Step 2: Add state hooks inside `WorkspaceDesktopProvider`**

Next to the existing `setInstalledApps` declaration:

```tsx
const [appCatalog, setAppCatalog] = useState<AppCatalogEntryPayload[]>([]);
const [isLoadingAppCatalog, setIsLoadingAppCatalog] = useState(false);
const [appCatalogError, setAppCatalogError] = useState("");
const [appCatalogSource, setAppCatalogSource] = useState<"marketplace" | "local">("marketplace");
const [installingAppId, setInstallingAppId] = useState<string | null>(null);
```

- [ ] **Step 3: Add the methods next to `removeInstalledApp`**

```tsx
async function refreshAppCatalog() {
  setIsLoadingAppCatalog(true);
  setAppCatalogError("");
  try {
    await window.electronAPI.workspace.syncAppCatalog({ source: appCatalogSource });
    const response = await window.electronAPI.workspace.listAppCatalog({
      source: appCatalogSource,
    });
    setAppCatalog(response.entries);
  } catch (error) {
    setAppCatalog([]);
    setAppCatalogError(normalizeErrorMessage(error));
  } finally {
    setIsLoadingAppCatalog(false);
  }
}

async function installAppFromCatalog(appId: string) {
  if (!selectedWorkspaceId) {
    setAppCatalogError("Select a workspace first.");
    return;
  }
  if (installingAppId) {
    return;
  }
  setInstallingAppId(appId);
  setAppCatalogError("");
  try {
    await window.electronAPI.workspace.installAppFromCatalog({
      workspaceId: selectedWorkspaceId,
      appId,
      source: appCatalogSource,
    });
    await refreshInstalledApps();
  } catch (error) {
    setAppCatalogError(normalizeErrorMessage(error));
  } finally {
    setInstallingAppId(null);
  }
}
```

- [ ] **Step 4: Add the new values to the `value` object**

Add to the `value = { ... }` literal passed to `WorkspaceDesktopContext.Provider`:

```tsx
appCatalog,
isLoadingAppCatalog,
appCatalogError,
appCatalogSource,
setAppCatalogSource,
refreshAppCatalog,
installingAppId,
installAppFromCatalog,
```

- [ ] **Step 5: Typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add desktop/src/lib/workspaceDesktop.tsx
git commit -m "feat(desktop): add app catalog state and installAppFromCatalog to workspaceDesktop"
```

---

### Task D8: Create `AppCatalogCard` component

**Files:**
- Create: `desktop/src/components/marketplace/AppCatalogCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Check, Download, LoaderCircle } from "lucide-react";

type AppCardState = "available" | "installing" | "installed";

interface AppCatalogCardProps {
  entry: AppCatalogEntryPayload;
  state: AppCardState;
  disabled: boolean;
  onInstall: () => void;
}

export function AppCatalogCard({ entry, state, disabled, onInstall }: AppCatalogCardProps) {
  const label = entry.name || entry.app_id;
  const description = entry.description ?? "";
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/40 text-sm font-semibold uppercase text-muted-foreground">
          {label.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{label}</div>
          {entry.version ? (
            <div className="truncate text-[11px] text-muted-foreground">{entry.version}</div>
          ) : null}
        </div>
      </div>
      {description ? (
        <p className="mt-3 line-clamp-3 text-[12px] leading-5 text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-4 flex items-center justify-end">
        {state === "installed" ? (
          <button
            type="button"
            disabled
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-xs font-medium text-muted-foreground"
          >
            <Check size={13} />
            Installed
          </button>
        ) : state === "installing" ? (
          <button
            type="button"
            disabled
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-xs font-medium text-muted-foreground"
          >
            <LoaderCircle size={13} className="animate-spin" />
            Installing…
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={onInstall}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-[rgba(247,90,84,0.38)] bg-[rgba(247,90,84,0.9)] px-3 text-xs font-medium text-white transition-colors hover:bg-[rgba(247,90,84,1)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={13} />
            Install
          </button>
        )}
      </div>
    </div>
  );
}

export type { AppCardState };
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add desktop/src/components/marketplace/AppCatalogCard.tsx
git commit -m "feat(desktop): add AppCatalogCard component"
```

---

### Task D9: Create `AppsGallery` component

**Files:**
- Create: `desktop/src/components/marketplace/AppsGallery.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useMemo } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { AppCatalogCard } from "./AppCatalogCard";

function SourceToggle({
  value,
  onChange,
  disabled,
}: {
  value: "marketplace" | "local";
  onChange: (next: "marketplace" | "local") => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border bg-muted/30 p-0.5">
      {(["marketplace", "local"] as const).map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option)}
            className={[
              "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
              active
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground",
              disabled ? "cursor-not-allowed opacity-60" : "",
            ].join(" ")}
          >
            {option === "marketplace" ? "Marketplace" : "Local"}
          </button>
        );
      })}
    </div>
  );
}

export function AppsGallery() {
  const {
    appCatalog,
    isLoadingAppCatalog,
    appCatalogError,
    appCatalogSource,
    setAppCatalogSource,
    refreshAppCatalog,
    installingAppId,
    installAppFromCatalog,
    installedApps,
    selectedWorkspace,
  } = useWorkspaceDesktop();

  useEffect(() => {
    void refreshAppCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appCatalogSource]);

  const installedIds = useMemo(
    () => new Set(installedApps.map((app) => app.id)),
    [installedApps],
  );
  const workspaceGated = !selectedWorkspace;
  const anyInstalling = Boolean(installingAppId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Apps</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Install pre-built modules into your workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SourceToggle
            value={appCatalogSource}
            onChange={setAppCatalogSource}
            disabled={isLoadingAppCatalog || anyInstalling}
          />
          <button
            type="button"
            onClick={() => void refreshAppCatalog()}
            disabled={isLoadingAppCatalog || anyInstalling}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      {workspaceGated ? (
        <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          Select a workspace to install apps.
        </div>
      ) : null}

      {appCatalogError ? (
        <div className="mb-3 rounded-lg border border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.06)] p-3 text-xs text-[rgba(255,153,102,0.92)]">
          {appCatalogError}
        </div>
      ) : null}

      {isLoadingAppCatalog && appCatalog.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <LoaderCircle size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : appCatalog.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          No {appCatalogSource === "marketplace" ? "published" : "local"} apps available.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {appCatalog.map((entry) => {
            const isInstalled = installedIds.has(entry.app_id);
            const isInstalling = installingAppId === entry.app_id;
            const state = isInstalled
              ? "installed"
              : isInstalling
                ? "installing"
                : "available";
            return (
              <AppCatalogCard
                key={`${entry.source}:${entry.app_id}`}
                entry={entry}
                state={state}
                disabled={workspaceGated || (anyInstalling && !isInstalling)}
                onInstall={() => void installAppFromCatalog(entry.app_id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add desktop/src/components/marketplace/AppsGallery.tsx
git commit -m "feat(desktop): add AppsGallery tab body"
```

---

### Task D10: Wire Templates/Apps sub-tab into `MarketplacePane`

**Files:**
- Modify: `desktop/src/components/panes/MarketplacePane.tsx` (main content block around line 117)

- [ ] **Step 1: Import `AppsGallery`**

Add at the top:

```tsx
import { AppsGallery } from "@/components/marketplace/AppsGallery";
```

- [ ] **Step 2: Add tab state**

Inside `MarketplacePane`, near `const [view, setView] = useState<View>("gallery")`:

```tsx
const [marketplaceTab, setMarketplaceTab] = useState<"templates" | "apps">("templates");
```

- [ ] **Step 3: Wrap existing content with the pill-segment + branch**

Replace the contents of `<div className="mx-auto max-w-5xl"> ... </div>` so that the existing view-state-machine JSX renders only when `marketplaceTab === "templates"`, and `<AppsGallery />` renders when `marketplaceTab === "apps"`. Preserve every existing branch (`view === "gallery"` / `"detail"` / `"creating"` / `"connect_integrations"`) verbatim — move them inside the Templates branch.

Template for the modified block:

```tsx
<div className="mx-auto max-w-5xl">
  <div className="mb-4 flex items-center gap-0.5 rounded-full border border-border bg-muted/30 p-0.5 w-fit">
    <button
      type="button"
      onClick={() => setMarketplaceTab("templates")}
      className={[
        "rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
        marketplaceTab === "templates"
          ? "bg-card text-foreground"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      Templates
    </button>
    <button
      type="button"
      onClick={() => setMarketplaceTab("apps")}
      className={[
        "rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
        marketplaceTab === "apps"
          ? "bg-card text-foreground"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      Apps
    </button>
  </div>

  {marketplaceTab === "templates" ? (
    <>
      {/* Existing view state machine stays exactly as it is — do NOT delete any branch */}
      {view === "gallery" ? (
        /* existing MarketplaceGallery JSX */
      ) : view === "detail" && detailTemplate ? (
        /* existing KitDetail JSX */
      ) : view === "creating" ? (
        /* existing creating JSX */
      ) : view === "connect_integrations" ? (
        /* existing connect_integrations JSX */
      ) : null}
    </>
  ) : (
    <AppsGallery />
  )}
</div>
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop
npm run typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
git add desktop/src/components/panes/MarketplacePane.tsx
git commit -m "feat(desktop): add Templates/Apps sub-tab to MarketplacePane"
```

---

### Task D11: End-to-end smoke test (local source)

- [ ] **Step 1: Start the desktop against the local runtime**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
npm run desktop:prepare-runtime:local
npm run desktop:install
npm run desktop:dev
```
Expected: desktop launches. If no workspace exists, create one through the normal flow.

- [ ] **Step 2: Build a local app archive**

```bash
cd /Users/joshua/holaboss-ai/holaboss/hola-boss-apps
./scripts/build-archive.sh twitter
ls dist/twitter-module-darwin-arm64.tar.gz
```
(Replace `darwin-arm64` with your host's target if not on Apple Silicon.)

- [ ] **Step 3: Exercise the Apps tab**

Inside the running desktop:
- Open **Marketplace** → click **Apps** sub-tab
- Flip source toggle to **Local**
- Click **Refresh**
- Expected: the `twitter` card appears
- Click **Install**
- Expected: card shows "Installing…" spinner then flips to "Installed"
- Switch to the workspace view — the Twitter app surface should appear and boot up

- [ ] **Step 4: Verify `workspace.yaml` was updated**

```bash
# Find the workspace dir printed by runtime logs.
cat <workspace_dir>/workspace.yaml | grep -A3 twitter
```
Expected: a `twitter` entry appears under `applications:` with a `config_path`.

- [ ] **Step 5: Uninstall and reinstall**

- In the `AppSurfacePane` for Twitter, click **Remove app** and confirm
- Switch back to the Apps tab; the card should flip back to "Install"
- Click **Install** again; expected: succeeds

- [ ] **Step 6: Record results (no commit)**

If any step failed, fix the underlying task and re-run this smoke test.

---

### Task D12: Final checks + documentation

**Files:**
- Modify: `desktop/CLAUDE.md`

- [ ] **Step 1: Run desktop lint/typecheck/build**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop
npm run lint
npm run typecheck
npm run build
```
Expected: all pass.

- [ ] **Step 2: Append a short note to `desktop/CLAUDE.md`**

```markdown
### Installing apps from the Marketplace

The `Marketplace → Apps` sub-tab lists installable modules from either the
marketplace (extended `/api/v1/marketplace/app-templates` with per-target
`archives`) or a local `hola-boss-apps/dist/` checkout. Install flow: the
desktop downloads the tarball to `os.tmpdir()/holaboss-app-archives/`, then
POSTs to the runtime's `/api/v1/apps/install-archive`, which extracts under
`apps/{appId}/`, registers the app in `workspace.yaml`, and starts it through
the normal lifecycle. See `docs/plans/2026-04-09-desktop-install-app-design.md`.
```

- [ ] **Step 3: Run the runtime sweep once more**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS
npm run runtime:test
```
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add desktop/CLAUDE.md
git commit -m "docs(desktop): note the app install flow in CLAUDE.md"
```

---

## Self-Review

| Spec requirement | Task(s) |
|---|---|
| `AppTemplateArchive` + `version`/`archives` on `AppTemplateMetadata` | A2 |
| `APP_ARCHIVE_VERSION` setting | A1 |
| `resolve_app_archive_version` + TTL cache + `build_archive_urls` | A3, A4, A5 |
| Extended `/app-templates` route with fallback | A6, A7 |
| `app_catalog` schema + `AppCatalogEntryRecord` type | B1 |
| State-store CRUD (upsert, list, clear, delete) with composite PK | B2, B3 |
| `tar` dependency | C1 |
| `isAllowedArchivePath` | C7 |
| `GET /api/v1/apps/catalog` | C3, C4 |
| `POST /api/v1/apps/catalog/sync` | C5, C6 |
| `POST /api/v1/apps/install-archive` | C2 (fixture), C8, C9 |
| Legacy `/api/v1/apps/install` untouched | Never modified |
| Desktop payload types + extended `AppTemplateMetadataPayload` | D1 |
| `resolveLocalArchiveTarget` + `scanLocalAppArchives` | D2 |
| `listAppTemplatesViaControlPlane` + `downloadAppArchive` with progress | D3 |
| `listAppCatalog`, `syncAppCatalog`, `installAppFromCatalog` main process functions | D4, D5 |
| IPC registration + preload | D6 |
| Context state + methods (single-flight install) | D7 |
| `AppCatalogCard` with three states | D8 |
| `AppsGallery` (source toggle, refresh, workspace gate, grid) | D9 |
| Templates/Apps pill segment in `MarketplacePane` | D10 |
| End-to-end smoke test | D11 |
| Documentation | A8, D12 |
| Error handling (path rejection, missing yaml, reinstall conflict, lifecycle failure = 200+ready:false) | C9 (runtime), D5 (temp-file cleanup), D7 (single-flight + error display) |

**Placeholder scan:** searched for TBD / TODO / "add appropriate" / "similar to Task N" / generic "handle edge cases". None found.

**Type consistency:**
- `AppCatalogEntryPayload` (wire, snake_case) and `AppCatalogEntryRecord` (store, camelCase) are mapped by `appCatalogEntryToWire` in C4 and by the sync route in C6.
- `source` is typed as `"marketplace" | "local"` everywhere.
- `installAppFromCatalog` signature matches across main process (D5), IPC (D6), preload (D6), and context (D7).
- `resolveLocalArchiveTarget` outputs match `_TARGETS` in the backend version resolver (A4) and the filename regex in `scanLocalAppArchives` (D2).
- `AppTemplateMetadataPayload` is extended (D1) with fields that match the backend model (A2).

No inconsistencies.

---

## Execution Handoff

**Plan complete and saved to `holaOS/docs/superpowers/plans/2026-04-09-desktop-install-app.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
