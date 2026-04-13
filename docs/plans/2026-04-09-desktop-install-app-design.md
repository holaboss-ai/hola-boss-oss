# Desktop Install-App Feature — Design

**Status:** Design approved, pending implementation plan
**Date:** 2026-04-09
**Scope:** `holaOS/desktop/`, `holaOS/runtime/`, `holaboss/backend/src/api/v1/marketplace/`

## Summary

The desktop application can list and remove workspace apps, but it has no way to **add a new app to an existing workspace**. This spec designs that feature end-to-end.

Because apps are now distributed as pre-built `.tar.gz` archives per platform target (see `hola-boss-apps/docs/publishing.md`), the install flow does not ship source code or run `npm install`. Instead, the desktop downloads a platform-matched archive from GitHub Releases, hands its local file path to the runtime, and the runtime extracts it into the workspace and starts the app.

## Goals

- Users can install any of the published apps into the currently selected workspace from inside the desktop app.
- Installed apps continue to use the existing post-install pipeline (`workspace.yaml` registration, `ensureAppRunning`, `app_builds` status tracking, `AppSurfacePane` display).
- Developers working against a local `hola-boss-apps/` checkout can install apps from their own `dist/*.tar.gz` without publishing.
- The catalog of installable apps is cached in the runtime SQLite state store so subsequent opens are instant and the desktop can work offline after a first sync.
- The feature lives inside the existing Marketplace surface as a new sub-tab — no new top-level navigation.

## Non-goals

- Changing the backend's workspace-provisioning install path (the existing `/api/v1/apps/install` files[]-based endpoint stays untouched — it is still used when templates materialize apps inline during workspace creation).
- Per-module versioning. All modules in a release share a single version, matching the publishing doc.
- An "Update available" UX. First release only tracks what's installed, not version drift. Reinstall (uninstall → install) picks up a newer version.
- Private-app distribution / authenticated archive downloads. The GitHub Releases URL is public.
- Running multiple versions of the same app in the same workspace.

## Architecture overview

```
┌───────────────── Desktop (Electron + React) ──────────────────┐
│  MarketplacePane                                               │
│   ├─ <pill-segment>  [Templates] [Apps]   ← NEW                │
│   │                                                             │
│   └─ Apps tab → AppsGallery (NEW)                               │
│        ├─ source toggle: [Marketplace] [Local]                 │
│        ├─ refresh button                                        │
│        └─ grid of AppCatalogCard                                │
│                                                                 │
│  workspaceDesktop context: + appCatalog + installAppFromCatalog│
│  electron main: + workspace:{listAppCatalog,syncAppCatalog,    │
│                             installAppFromCatalog}              │
└────────┬────────────────────────────────┬──────────────────────┘
         │ HTTPS                           │ HTTP (localhost)
         ▼                                 ▼
┌─── Python backend ─────────┐   ┌─── Local runtime (:8080) ──────┐
│  marketplace service        │   │  GET  /api/v1/apps/catalog      │
│                             │   │  POST /api/v1/apps/catalog/sync │
│  /api/v1/marketplace/       │   │  POST /api/v1/apps/install-     │
│  app-templates              │   │       archive  ← NEW            │
│    extended with:           │   │                                  │
│      version                │   │  state-store SQLite:             │
│      archives: [            │   │    app_catalog table  ← NEW      │
│        {target, url},       │   │                                  │
│        ...                  │   │                                  │
│      ]                      │   └──────────────────────────────────┘
└─────────────────────────────┘                │
                                                 ▼
                              workspace.yaml + apps/{appId}/
                              (extracted tarball contents)
```

### Sources of truth

- **Available apps (catalog).** Runtime SQLite table `app_catalog`, populated by the desktop from two sources: (a) the backend marketplace endpoint, or (b) a scan of a sibling `hola-boss-apps/dist/` directory for local development.
- **Installed apps per workspace.** Unchanged — `workspace.yaml` `applications:` array (authoritative), mirrored by `app_builds` for lifecycle status.

### Install flow

1. User opens Marketplace → Apps tab.
2. On mount, the `AppsGallery` component calls `refreshAppCatalog()` which runs `syncAppCatalog({source})` then `listAppCatalog({source})`.
3. User clicks **Install** on a card.
4. Desktop downloads the archive (marketplace source) to `os.tmpdir()/holaboss-app-archives/<appId>-<timestamp>.tar.gz`, streaming with progress events, OR uses the local path directly (local source).
5. Desktop calls `POST /api/v1/apps/install-archive` with `{workspace_id, app_id, archive_path}`.
6. Runtime validates, extracts the tarball into `apps/{appId}/`, runs the existing `appendWorkspaceApplication` + `ensureAppRunning` pipeline.
7. Desktop refreshes installed apps via `refreshInstalledApps()`; the card transitions to "Installed" and `AppSurfacePane` shows the app booting up (or surfaces a start-up error like it already does).
8. Desktop cleans up the temp archive file (marketplace source only).

## Data models

### New table: `app_catalog` (runtime state-store)

```sql
CREATE TABLE IF NOT EXISTS app_catalog (
    app_id        TEXT NOT NULL,
    source        TEXT NOT NULL,         -- "marketplace" | "local"
    name          TEXT NOT NULL,
    description   TEXT,
    icon          TEXT,
    category      TEXT,
    tags_json     TEXT NOT NULL DEFAULT '[]',
    version       TEXT,                  -- marketplace only; null for local
    archive_url   TEXT,                  -- marketplace source
    archive_path  TEXT,                  -- local source
    target        TEXT NOT NULL,         -- "darwin-arm64" | "linux-x64" | "win32-x64"
    cached_at     TEXT NOT NULL,         -- ISO8601
    PRIMARY KEY (source, app_id)
);

CREATE INDEX IF NOT EXISTS idx_app_catalog_source ON app_catalog (source);
```

Invariants:
- `(source, app_id)` is the primary key — the same `app_id` may exist in both source rows simultaneously.
- Exactly one of `archive_url` / `archive_path` is non-null per row.
- `target` records which platform binary the row was resolved for. If the desktop is moved to a different arch, a re-sync overwrites the cached rows.

State-store methods (mirroring existing `app_builds` / `app_ports`):

```ts
interface AppCatalogEntryParams {
  appId: string;
  source: "marketplace" | "local";
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  tagsJson: string;
  version: string | null;
  archiveUrl: string | null;
  archivePath: string | null;
  target: string;
  cachedAt: string;
}

upsertAppCatalogEntry(params: AppCatalogEntryParams): void
listAppCatalogEntries(params?: { source?: "marketplace" | "local" }): AppCatalogEntryRecord[]
clearAppCatalogSource(source: "marketplace" | "local"): void
deleteAppCatalogEntry(params: { source: string; appId: string }): void
```

### Extended `AppTemplateMetadata` (Python backend)

**File:** `backend/src/api/v1/marketplace/templates.py`

```python
class AppTemplateArchive(BaseModel):
    target: str   # "darwin-arm64" | "linux-x64" | "win32-x64"
    url: str

class AppTemplateMetadata(BaseModel):
    # ... existing fields ...
    version: str | None = None
    archives: list[AppTemplateArchive] = Field(default_factory=list)
```

### Desktop payload types

**File:** `desktop/src/types/electron.d.ts`

```ts
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

interface InstallAppResponse {
  app_id: string;
  status: string;
  detail: string;
  ready: boolean;
  error: string | null;
}
```

## Runtime endpoints

### `POST /api/v1/apps/install-archive`

**File:** `runtime/api-server/src/app.ts`

Request:
```json
{
  "workspace_id": "wsp_abc",
  "app_id": "twitter",
  "archive_path": "/tmp/holaboss-app-archives/twitter-1712659200000.tar.gz"
}
```

Behavior:
1. Validate `app_id` via `sanitizeAppId`; validate workspace via `store.getWorkspace`.
2. Validate `archive_path` is absolute, exists on disk, and sits under an allowlisted root (see "Path allowlisting" below). Return `400` otherwise.
3. Compute `appDir = workspaceDir/apps/{appId}`. If already non-empty, return `409` with `"app already installed — uninstall first"`. Do not silently overwrite.
4. `fs.mkdirSync(appDir, { recursive: true })`.
5. Extract via `tar.x({ file: archivePath, cwd: appDir, strict: true })`. On failure, `rm -rf appDir` and return `400` with the extraction error.
6. Verify `apps/{appId}/app.runtime.yaml` exists. If not, `rm -rf appDir` and return `400`.
7. Parse the manifest via existing `parseInstalledAppRuntime`.
8. Call existing `appendWorkspaceApplication(workspaceDir, { appId, configPath, lifecycle })`.
9. Call existing `ensureAppRunning(workspaceId, appId)`.
10. Return the same response shape as the legacy install endpoint:
    - Success: `{ app_id, status: "enabled", detail, ready: true, error: null }`
    - Lifecycle error: `{ app_id, status: "enabled", detail: msg, ready: false, error: msg }`

The runtime does **not** delete `archive_path`; the caller owns the file's lifetime.

### Path allowlisting

```ts
function isAllowedArchivePath(p: string): boolean {
  const abs = path.resolve(p);
  const roots = [
    os.tmpdir(),
    process.env.HOLABOSS_APP_ARCHIVE_DIR,
    path.join(holabossHome(), "downloads"),
  ].filter((r): r is string => Boolean(r)).map(r => path.resolve(r));
  return roots.some(r => abs === r || abs.startsWith(r + path.sep));
}
```

The desktop writes downloads under `os.tmpdir()/holaboss-app-archives/`, which is covered by the first root. `HOLABOSS_APP_ARCHIVE_DIR` is an optional escape hatch for dev / testing.

### `GET /api/v1/apps/catalog`

Query parameters:
- `source` (optional) — `"marketplace"` or `"local"`; omitted returns both sources.

Response:
```json
{ "entries": [ /* AppCatalogEntryPayload[] */ ], "count": 6 }
```

Behavior: `store.listAppCatalogEntries({ source })`. The route parses `tags_json` into `tags: string[]` before returning, so the wire shape matches `AppCatalogEntryPayload` (the `tags_json` column is a storage detail, not a client-visible field).

### `POST /api/v1/apps/catalog/sync`

Request body:
```json
{
  "source": "marketplace",
  "target": "darwin-arm64",
  "entries": [
    {
      "app_id": "twitter",
      "name": "Twitter / X",
      "description": "...",
      "icon": "...",
      "category": "social",
      "tags": ["social media", "twitter"],
      "version": "v0.1.0",
      "archive_url": "https://github.com/.../twitter-module-darwin-arm64.tar.gz",
      "archive_path": null
    }
  ]
}
```

Behavior:
1. Validate `source` is `"marketplace"` or `"local"`; return `400` otherwise.
2. `store.clearAppCatalogSource(source)`.
3. For each entry: validate + `store.upsertAppCatalogEntry`, setting `cached_at = now`.
4. Return `{ synced, source, target }`.

Full-replace per source (as opposed to incremental upsert) keeps semantics simple: the desktop is authoritative for which apps exist in each source at sync time. A ~6-row table makes the cost trivial.

The runtime does no network I/O — the desktop is the only thing that fetches from backend or scans local FS. This keeps the runtime testable and network-free.

### Dependency addition

`runtime/api-server/package.json`:

```json
"dependencies": {
  "tar": "^7.4.3"
},
"devDependencies": {
  "@types/tar": "^6.1.13"
}
```

Rationale: `yauzl` (zip) is already in the runtime but there is no tar library. Shelling out to system `tar` was considered; the isaacs `tar` npm package was chosen for portability across all three desktop targets and for clean JS errors we can surface in the install UI. `strict: true` rejects paths escaping `cwd` via `..` or absolute paths as a defense-in-depth measure.

## Backend changes

### Extended `/api/v1/marketplace/app-templates`

**File:** `backend/src/api/v1/marketplace/routes/templates.py`

```python
@router.get("/app-templates", response_model=AppTemplateListResponse, operation_id="listAppTemplates")
async def list_app_templates(request: Request) -> AppTemplateListResponse:
    resolver: AppTemplateResolver = request.app.state.app_template_resolver
    settings: Settings = request.app.state.settings
    try:
        version = await resolve_app_archive_version(settings)
    except Exception:
        logger.warning("app_templates.version_resolve_failed", exc_info=True,
                       extra={"event": "app_templates.version_resolve", "outcome": "error"})
        version = None
    templates = []
    for tmpl in resolver.list_templates():
        archives = build_archive_urls(tmpl.name, version) if version else []
        templates.append(tmpl.model_copy(update={"version": version, "archives": archives}))
    return AppTemplateListResponse(templates=templates)
```

If version resolution fails (GitHub API down, network error), the endpoint degrades gracefully: `version=None, archives=[]`. The desktop's local-source mode still works, and a retry via the Refresh button recovers once the upstream is reachable.

### Version resolution

**New file:** `backend/src/services/marketplace/app_archive_version.py`

```python
_MODULES_REPO = "https://github.com/holaboss-ai/holaboss-modules"
_TARGETS = ("darwin-arm64", "linux-x64", "win32-x64")
_GITHUB_LATEST_RELEASE = "https://api.github.com/repos/holaboss-ai/holaboss-modules/releases/latest"
_LATEST_TTL_SECONDS = 300

@dataclass
class _Cached:
    version: str
    fetched_at: float

_cache: _Cached | None = None

async def resolve_app_archive_version(settings: Settings) -> str:
    configured = (settings.app_archive_version or "latest").strip()
    if configured != "latest":
        return configured
    global _cache
    now = time.monotonic()
    if _cache and (now - _cache.fetched_at) < _LATEST_TTL_SECONDS:
        return _cache.version
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(_GITHUB_LATEST_RELEASE,
                                headers={"Accept": "application/vnd.github+json"})
        resp.raise_for_status()
        tag = resp.json()["tag_name"]
    _cache = _Cached(version=tag, fetched_at=now)
    return tag

def build_archive_urls(app_name: str, version: str) -> list[AppTemplateArchive]:
    return [
        AppTemplateArchive(
            target=target,
            url=f"{_MODULES_REPO}/releases/download/{version}/{app_name}-module-{target}.tar.gz",
        )
        for target in _TARGETS
    ]
```

### Settings

`backend/src/config/settings.py` (or the equivalent marketplace settings):

```python
class Settings(BaseSettings):
    # ... existing
    app_archive_version: str = "latest"
```

Env var: `APP_ARCHIVE_VERSION=latest` or `APP_ARCHIVE_VERSION=v0.1.0`.

## Desktop changes

### Electron main process (`desktop/electron/main.ts`)

**New functions:**

```ts
async function listAppCatalog(params: { source?: "marketplace" | "local" }): Promise<AppCatalogListResponse>
async function syncAppCatalog(params: { source: "marketplace" | "local" }): Promise<AppCatalogSyncResponse>
async function installAppFromCatalog(params: {
  workspaceId: string;
  appId: string;
  source: "marketplace" | "local";
}): Promise<InstallAppResponse>
```

- `listAppCatalog` — thin wrapper around `GET /api/v1/apps/catalog`.
- `syncAppCatalog` — for `"marketplace"`: fetches the extended `/api/v1/marketplace/app-templates` via the existing control-plane path, resolves the local target via `resolveLocalArchiveTarget()`, picks the matching `archive.url` from each template, and POSTs the full set to the runtime. For `"local"`: scans `hola-boss-apps/dist/*-module-<target>.tar.gz` via `scanLocalAppArchives()`, joining filename-derived `app_id` to the static display metadata already in `desktop/src/lib/workspaceApps.ts` (`APP_CATALOG`).
- `installAppFromCatalog` — loads the catalog entry, downloads the tarball (marketplace) or reuses the path (local), POSTs to `/api/v1/apps/install-archive`, cleans up the temp file.

**Helpers:**

```ts
function resolveLocalArchiveTarget(): "darwin-arm64" | "linux-x64" | "win32-x64" {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "linux"  && arch === "x64")   return "linux-x64";
  if (platform === "win32"  && arch === "x64")   return "win32-x64";
  throw new Error(`Unsupported app archive target: ${platform}/${arch}`);
}

async function scanLocalAppArchives(): Promise<LocalAppArchiveEntry[]> {
  // Walk up to find sibling hola-boss-apps/ (mirrors localModulesRootCandidates for templates)
  // Look for hola-boss-apps/dist/*-module-<target>.tar.gz
  // Return { appId, filePath }
}

async function downloadAppArchive(url: string, appId: string): Promise<string> {
  const dir = path.join(os.tmpdir(), "holaboss-app-archives");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${appId}-${Date.now()}.tar.gz`);
  // streaming fetch → file, emit progress via mainWindow.webContents.send("app-install-progress", ...)
  return filePath;
}
```

**IPC registrations** (near the existing `workspace:removeInstalledApp`):

```ts
handleTrustedIpc("workspace:listAppCatalog", ["main"],
  async (_e, params) => listAppCatalog(params));
handleTrustedIpc("workspace:syncAppCatalog", ["main"],
  async (_e, params) => syncAppCatalog(params));
handleTrustedIpc("workspace:installAppFromCatalog", ["main"],
  async (_e, params) => installAppFromCatalog(params));
```

**Preload + typings:** add the three methods to `electronAPI.workspace` in `desktop/electron/preload.ts` and `desktop/src/types/electron.d.ts`.

### Renderer — `workspaceDesktop` context (`desktop/src/lib/workspaceDesktop.tsx`)

New state and methods, sitting alongside `installedApps` and `removeInstalledApp`:

```tsx
interface WorkspaceDesktopContextValue {
  // ... existing
  appCatalog: AppCatalogEntryPayload[];
  isLoadingAppCatalog: boolean;
  appCatalogError: string;
  appCatalogSource: "marketplace" | "local";
  setAppCatalogSource: (source: "marketplace" | "local") => void;
  refreshAppCatalog: () => Promise<void>;
  installingAppId: string | null;
  installAppFromCatalog: (appId: string) => Promise<void>;
}
```

Behavior:
- `refreshAppCatalog()` — calls `syncAppCatalog({ source: appCatalogSource })` then `listAppCatalog({ source: appCatalogSource })`, writes result to state.
- `installAppFromCatalog(appId)` — guards on `selectedWorkspaceId`, enforces single-flight via `installingAppId`, delegates to `window.electronAPI.workspace.installAppFromCatalog`, then `refreshInstalledApps()` on success.
- `setAppCatalogSource` — also triggers `refreshAppCatalog()` via a `useEffect` keyed on the source.

### Renderer — `MarketplacePane.tsx` (sub-tab)

Add a pill-segment control at the top of the pane:

```tsx
const [marketplaceTab, setMarketplaceTab] = useState<"templates" | "apps">("templates");

<div className="mb-4 flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1 w-fit">
  <button
    type="button"
    onClick={() => setMarketplaceTab("templates")}
    className={cn("rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
      marketplaceTab === "templates" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground")}
  >Templates</button>
  <button
    type="button"
    onClick={() => setMarketplaceTab("apps")}
    className={cn("rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
      marketplaceTab === "apps" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground")}
  >Apps</button>
</div>
```

The existing templates view state machine (`gallery | detail | creating | connect_integrations`) stays intact — it renders when `marketplaceTab === "templates"`. The Apps tab renders `<AppsGallery />`. Default tab = `"templates"` to preserve current behavior.

Hand-rolled rather than importing shadcn `Tabs`: the desktop's `components/ui/` does not ship a `tabs.tsx` and adding a new component file for two options is disproportionate.

### Renderer — `AppsGallery` component (new)

**File:** `desktop/src/components/marketplace/AppsGallery.tsx`

Responsibilities:
- Auto-refreshes catalog on mount and whenever `appCatalogSource` changes.
- Renders header: title, source toggle (2-button pill), refresh button, empty/loading/error states.
- If no workspace is selected, shows a muted banner — "Select a workspace to install apps." — and disables install buttons.
- Renders a responsive grid (1/2/3 cols) of `AppCatalogCard`.
- Cross-references `installedApps` (from the same context) to mark cards as "Installed".
- Respects the desktop design rules in `CLAUDE.md`: solid backgrounds, fine borders, `hover:bg-accent` only, **no gradients, no shadow-lift hover**, `transition-colors` only.

`AppCatalogCard` (same file or sibling) states:
| State | CTA | Interaction |
|---|---|---|
| `available` | Orange primary **Install** | `onInstall` |
| `installing` | Disabled, spinner, "Installing…" | — |
| `installed` | Disabled, checkmark, "Installed" | — |

Disabling rules:
- No workspace selected → all cards disabled with banner.
- Another install in progress (`installingAppId !== null`) → all other cards disabled.

### Static local metadata

Local-source archives carry no registry info. `desktop/src/lib/workspaceApps.ts` already has `APP_CATALOG` with `label`, `summary`, and `accentClassName` for the 6 known modules. The local scan path joins parsed filenames to this static metadata. Unknown app ids fall back to `labelFromAppId(...)` and a neutral accent, same as the existing hydration logic.

## Error handling

| Where | Failure | User-visible behavior |
|---|---|---|
| Backend `/app-templates` GitHub rate-limit / outage | `version` resolution raises | Endpoint returns `version=null, archives=[]`; desktop surfaces "No marketplace apps available right now" in AppsGallery; local source still works |
| Desktop download | Network error, 404, corrupt stream | Toast + inline error on the card; temp file is deleted; card returns to `available` |
| Runtime `install-archive` — path outside allowed roots | `400` | Desktop surfaces "Archive path rejected by runtime" and logs; single-flight lock released |
| Runtime `install-archive` — tar extraction fails | `400` + `appDir` cleaned up | Desktop surfaces the extraction error; single-flight released |
| Runtime `install-archive` — missing `app.runtime.yaml` | `400` + `appDir` cleaned up | Desktop surfaces "Archive is missing app.runtime.yaml"; single-flight released |
| Runtime `install-archive` — app already installed | `409` | Desktop surfaces "Already installed — remove it first"; card stays in `available` state |
| Runtime `install-archive` — lifecycle start fails after successful extract | `200` with `ready:false, error:msg` | `workspace.yaml` entry is kept (same as today's install); `AppSurfacePane` shows the error state and offers retry/remove like it already does |

Single-flight install (only one install in progress at a time) avoids port allocation races in the lifecycle executor and simplifies the UI state machine.

## Testing

### State-store tests (`runtime/state-store/src/store.test.ts`)

- `upsertAppCatalogEntry + listAppCatalogEntries returns entries for requested source`
- `clearAppCatalogSource wipes only the given source`
- `composite PK allows same appId in both marketplace and local sources`
- `listAppCatalogEntries with no source returns all rows`

### Runtime API tests (`runtime/api-server/src/app.test.ts`)

- `GET /api/v1/apps/catalog filters by source`
- `POST /api/v1/apps/catalog/sync replaces all marketplace entries`
- `POST /api/v1/apps/catalog/sync rejects invalid source`
- `POST /api/v1/apps/install-archive rejects archive_path outside allowed roots (400)`
- `POST /api/v1/apps/install-archive rejects missing file (400)`
- `POST /api/v1/apps/install-archive extracts a fixture tarball and registers in workspace.yaml`
- `POST /api/v1/apps/install-archive rejects archive missing app.runtime.yaml (400 + cleanup)`
- `POST /api/v1/apps/install-archive rejects when apps/{id} already exists (409)`
- `POST /api/v1/apps/install-archive returns ready:false when ensureAppRunning throws`

Fixture tarball: a pre-built 2-file archive containing `app.runtime.yaml` + a tiny `package.json` placed in `runtime/api-server/src/__fixtures__/minimal-app.tar.gz`.

### Backend tests (`backend/test/api/v1/marketplace/test_app_templates.py`)

- `test_list_app_templates_includes_archives_for_all_targets` — with `APP_ARCHIVE_VERSION=v0.1.0`, each template has three archives with the correct URL shape
- `test_list_app_templates_resolves_latest_from_github` — mocked httpx; verify GitHub API is called, the tag is cached, second call reuses cache
- `test_list_app_templates_falls_back_on_version_error` — mocked httpx raising; response has `version=None` and `archives=[]`

### Desktop tests

The desktop has light test coverage (mainly `*.test.mjs` for a few components). At minimum:
- `workspaceDesktop.test` — unit-test `installAppFromCatalog` success + error paths with a mocked `electronAPI`.
- A small smoke test for `AppsGallery` that verifies the three card states render.

## Rollout

1. **Backend first.** Extend `AppTemplateMetadata`, add version resolution, update the route, land tests. This is backward-compatible: existing clients that ignore the new fields continue to work.
2. **Runtime second.** Add `app_catalog` table + state-store methods + three new routes + `tar` dep. Land tests. Still backward-compatible with the desktop — the new endpoints are additive.
3. **Desktop third.** Add the IPC handlers, context methods, `AppsGallery`, and the Marketplace sub-tab. End-to-end validation on a desktop dev build with a locally-built tarball in `hola-boss-apps/dist/`, then against a real published release.
4. **Docs.** Update `holaOS/desktop/CLAUDE.md` and `hola-boss-apps/docs/publishing.md` with the install flow from the client's perspective.

Each stage can be merged and deployed independently — a desktop without the new feature still works against a newer backend, and a desktop with the feature still works against an older backend (the `archives` array is empty → marketplace source is empty → user falls back to local source).

## Open items deliberately deferred

- **Update detection.** No "new version available" UX. Users reinstall to pick up a new version.
- **Archive checksums.** No SHA verification of downloaded tarballs; GitHub serves over HTTPS which is sufficient for v1.
- **Multi-arch coexistence.** One machine = one target; we don't store all three for the same desktop.
- **Authenticated archive downloads.** Public GitHub release assets only.
- **Source toggle in catalog sync.** The sync call takes one source at a time; no "sync both" shortcut.

## References

- `hola-boss-apps/docs/publishing.md` — archive format, naming, targets, versioning
- `holaOS/runtime/api-server/src/app.ts` — existing `/api/v1/apps/install` (files[] path), referenced patterns: `appendWorkspaceApplication`, `ensureAppRunning`, `parseInstalledAppRuntime`, `sanitizeAppId`
- `holaOS/runtime/state-store/src/store.ts` — existing `app_builds` / `app_ports` patterns to mirror
- `holaOS/desktop/src/lib/workspaceDesktop.tsx` — `removeInstalledApp` as the shape to mirror for `installAppFromCatalog`
- `holaOS/desktop/src/components/panes/MarketplacePane.tsx` — the surface the sub-tab is added to
- `backend/src/api/v1/marketplace/templates.py` — `AppTemplateMetadata`, `_default_app_templates`
