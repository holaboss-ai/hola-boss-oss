# Holaboss Local - Neon AI Workspace Prototype

Desktop prototype inspired by a futuristic dark neon-green AI operating workspace with three docked panes:

1. File Explorer (left)
2. In-app Browser panel (center)
3. AI Chat assistant (right)

Built with Electron + React + TypeScript + Vite + Tailwind CSS.

## Features

- Electron main/preload/renderer separation with secure preload bridge
- Full-window dark neon-green visual system
- Global top tab bar with workspace controls
- Three-pane layout with draggable split handles
- Pane widths persist in local storage
- Real local file explorer (reads your filesystem via secure IPC)
- Real embedded Chromium browser (`<webview>`) with URL/home/back/forward/refresh
- AI chat panel with suggestion pills, composer, user/assistant bubbles, and local rule-based responses

## Tech Stack

- Electron
- React 19
- TypeScript
- Vite
- Tailwind CSS
- Lucide React icons

## Run

```bash
npm install
cp .env.example .env
GITHUB_TOKEN="$(gh auth token)" npm run prepare:runtime
npm run dev
```

This launches:
- Vite dev server for the renderer (`http://localhost:5173`)
- TS build watcher for Electron main/preload (`out/dist-electron/*.cjs`)
- Electron desktop window with live restarts on main/preload changes

Internal backend preset entrypoints:

```bash
# internal-only preset hook for local backend env
npm run dev:cp:local

# internal-only preset hook for shared dev backend env
npm run dev:cp:dev

# production/default env
npm run dev:cp:prod
```

The repo does not ship remote endpoint URLs. Remote auth/backend access is configured entirely through environment variables outside the public repo. Local/dev backend overrides are only honored when `HOLABOSS_INTERNAL_DEV=1` is set or when running the unpackaged dev app through the internal preset scripts above.

Before running `npm run dev`, copy `desktop/.env.example` to `desktop/.env` and fill in the required remote values:

```bash
cp .env.example .env
```

`prepare:runtime` downloads the latest runtime-channel bundle for the current host platform from GitHub Releases and stages it into `out/runtime-<platform>/`.

## Build

```bash
npm run build
```

This creates:
- Renderer production bundle in `out/dist/`
- Electron main/preload bundles in `out/dist-electron/`

## Runtime Bundle

Packaged desktop builds expect a staged runtime bundle at `out/runtime-<platform>/`:

```bash
npm run prepare:runtime
```

That stages the bundle for the current host platform. If you need to target a specific platform explicitly:

```bash
GITHUB_TOKEN="$(gh auth token)" npm run prepare:runtime:macos
GITHUB_TOKEN="$(gh auth token)" npm run prepare:runtime:linux
GITHUB_TOKEN="$(gh auth token)" npm run prepare:runtime:windows
```

For local development against unreleased `hola-boss-oss` runtime changes:

```bash
# optional when your OSS repo is not ../hola-boss-oss
export HOLABOSS_OSS_ROOT=/absolute/path/to/hola-boss-oss

# builds the runtime bundle for the current host platform and stages it into out/runtime-<platform>
npm run prepare:runtime:local
```

After `npm run prepare:runtime:local`, a normal `npm run dev` uses that staged local runtime bundle. Set `HOLABOSS_RUNTIME_PLATFORM=macos|linux|windows` if you need to override platform detection.

Or package directly with local runtime in one step:

```bash
npm run dist:mac:local
npm run dist:win:local
```

The staging script accepts one of:
- `HOLABOSS_RUNTIME_DIR=/absolute/path/to/runtime-<platform>`
- `HOLABOSS_RUNTIME_TARBALL=/absolute/path/to/holaboss-runtime-<platform>-<sha>.tar.gz`
- `HOLABOSS_RUNTIME_BUNDLE_URL=https://.../holaboss-runtime-<platform>-<sha>.tar.gz`
- `HOLABOSS_GITHUB_TOKEN=...` or `GITHUB_TOKEN=...` to fetch the latest runtime-channel release asset from GitHub Releases
- `HOLABOSS_RUNTIME_PLATFORM=macos|linux|windows` to override the auto-detected target platform when needed

If none are set, it falls back to the host temp directory, for example `${TMPDIR:-/tmp}/holaboss-runtime-<platform>-full`.

To build a mac app bundle with the runtime embedded in Electron resources:

```bash
GITHUB_TOKEN="$(gh auth token)" npm run dist:mac
```

Use `dist:mac` when you want the latest released macOS runtime. Use `dist:mac:local` for local unreleased runtime code.

This produces an unsigned local mac app bundle with `runtime-macos` embedded in `Contents/Resources/`.

For Windows packaging:

```bash
GITHUB_TOKEN="$(gh auth token)" npm run dist:win
npm run dist:win:local
```

Use `dist:win` with a staged or downloaded `out/runtime-windows/` bundle. Use `dist:win:local` on a Windows host to build and stage a native local runtime bundle first, then produce a Windows NSIS installer.

Output:
- [Holaboss Workspace.app](/Users/jeffrey/Desktop/hola-boss-oss/desktop/out/release/mac-arm64/Holaboss%20Workspace.app)

Run packaged app with endpoint presets:

```bash
# internal-only local override
npm run packaged:run:local

# internal-only dev override
npm run packaged:run:dev

# production default
npm run packaged:run:prod
```

Remote configuration:
- `HOLABOSS_AUTH_BASE_URL` for Better Auth session endpoint
- `HOLABOSS_AUTH_SIGN_IN_URL` for the hosted sign-in page
- `HOLABOSS_BACKEND_BASE_URL` for the Holaboss backend base URL used by the desktop
- `HOLABOSS_INTERNAL_DEV=1` to allow non-production backend overrides in packaged runs
- `HOLABOSS_PACKAGED_APP_BIN` for an explicit packaged binary path

Start by copying the template:

```bash
cp .env.example .env
```

Optional internal-only overrides:
- `HOLABOSS_PROJECTS_URL`
- `HOLABOSS_MARKETPLACE_URL`
- `HOLABOSS_PROACTIVE_URL`

The preset scripts no longer embed concrete URLs. Internal developers are expected to source the backend URL from a private shell profile, `.envrc`, CI secret, or another non-public config mechanism before running the preset scripts.

To build a mac installer image:

```bash
GITHUB_TOKEN="$(gh auth token)" npm run dist:mac:dmg
```

This produces a local-use `.dmg` installer in `out/release/`.

Notes:
- `dist:mac` builds an unpacked `.app`
- `dist:mac:dmg` builds a `.dmg` installer
- both local mac packaging commands force ad-hoc signing for local smoke testing via `--config.mac.identity=-`
- production signing and notarization are handled in GitHub Actions once the Apple secrets are configured

### Signed Product Release

Signed macOS distribution is handled by the manual `.github/workflows/release-macos-desktop.yml` workflow. Normal pushes continue to run CI and publish runtime bundles separately; the signed DMG is only built when you explicitly trigger the desktop release workflow.

Release channel policy:
- runtime-only bundle releases publish under `holaboss-runtime-*` and are treated as prereleases
- desktop-shippable stable releases stay under `holaboss-*`
- the in-app desktop update notice is intended to track desktop-shippable releases, not runtime-only bundle releases

The desktop release workflow requires these repository secrets and fails fast when any of them are missing:

- `MAC_CERTIFICATE`: base64-encoded `Developer ID Application` `.p12`
- `MAC_CERTIFICATE_PASSWORD`: password for the `.p12`
- `APPLE_ID`: Apple Developer account email
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password from Apple ID settings
- `APPLE_TEAM_ID`: Apple Developer Team ID

When triggering the workflow, provide:

- `ref`: the branch, tag, or commit you want to ship
- `release_tag`: the GitHub release tag to create or update
- `release_title`: optional display title for the GitHub release
- `prerelease`: whether the GitHub release should be marked as a prerelease when first created

The workflow builds a matching macOS runtime bundle from that ref, maps the Apple secrets to `electron-builder`'s `CSC_LINK`, `CSC_KEY_PASSWORD`, and Apple notarization environment variables, then uploads the signed DMG to the chosen GitHub release. The desktop build config uses `hardenedRuntime` plus an explicit mac entitlements plist at `resources/entitlements.mac.plist`.

After a signed build, validate the produced app locally with:

```bash
codesign --verify --deep --strict --verbose=2 /path/to/Holaboss.app
spctl -a -vv -t exec /path/to/Holaboss.app
xcrun stapler validate /path/to/Holaboss.app
```

## Project Structure

```text
electron/
  main.ts
  preload.ts
src/
  components/
    layout/
      AppShell.tsx
      TopTabsBar.tsx
      SplitPaneLayout.tsx
    panes/
      FileExplorerPane.tsx
      BrowserPane.tsx
      ChatPane.tsx
    ui/
      PaneCard.tsx
      IconButton.tsx
  data/
    mockFiles.ts
    mockBrowser.ts
  utils/
    mockAssistant.ts
  types/
    electron.d.ts
    webview.d.ts
  App.tsx
  main.tsx
  index.css
```

## Browser Notes

The center pane uses a real Electron `webview`:
- Source is set in `src/components/panes/BrowserPane.tsx`
- Navigation controls call real webview methods (`goBack`, `goForward`, `reload`, `loadURL`)
- Main process enables and guards webview attachment in `electron/main.ts`

If you later want a multi-tab browser architecture, keep the current `BrowserPane` control surface and swap to a tab manager that creates one webview per tab.

## File Explorer Notes

The left pane reads real directories from your machine:
- IPC handler lives in `electron/main.ts` (`fs:listDirectory`)
- Renderer call lives in preload bridge (`window.electronAPI.fs.listDirectory`)
- UI and navigation are in `src/components/panes/FileExplorerPane.tsx`

The explorer currently supports:
- folder open (double-click or “Open Selected Folder”)
- back/forward/up/home navigation
- search/filter in current directory
- grouped rendering by modified date (Today / This Week / This Year / Earlier)

### AI assistant

Current chat replies are local rule-based mocks (no backend/LLM):
- Rules and canned responses live in `src/utils/mockAssistant.ts`
- `ChatPane.tsx` handles message rendering and send flow

Replace point for real AI backend:
- Hook send flow in `src/components/panes/ChatPane.tsx` where `generateMockReply` is called
- Replace timeout mock with API call and stream/append tokens as needed

## Security

Renderer runs with:
- `contextIsolation: true`
- `nodeIntegration: false`
- `webviewTag: true` (enabled intentionally for embedded browser pane)

Preload bridge exposes runtime info and a constrained filesystem API via `window.electronAPI`.

## Stretch Goals Ready

Codebase is structured to support later additions such as:
- draggable top tabs
- command palette
- collapsible icon rail
- tokenized theme switching
