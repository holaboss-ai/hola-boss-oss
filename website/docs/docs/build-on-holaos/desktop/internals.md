# Desktop Internals

Use this page when you are changing the Electron shell, renderer-to-main contracts, BrowserView behavior, or the embedded runtime launch path.

## Desktop execution model

`npm run desktop:dev` is a four-process loop:

- `vite` for the renderer
- `tsup --watch` for Electron main and preload output
- `node scripts/watch-runtime-bundle.mjs` to restage the embedded runtime when `runtime/` changes
- `electronmon out/dist-electron/main.cjs` to run the app and restart it when the built Electron entrypoint changes

That means desktop work is usually spread across four boundaries: React renderer code, preload bridge code, Electron main-process code, and the staged runtime bundle under `desktop/out/runtime-<platform>`.

## Main code seams

- `desktop/src/components/layout/AppShell.tsx`: the shell composition and top-level product routing. This is where the agent pane, browser panes, file explorer, app surfaces, operations drawer, notifications, settings overlays, and reported non-browser operator surfaces are coordinated.
- `desktop/shared/model-catalog.ts`: shipped fallback model metadata for direct providers and Holaboss Proxy model mapping, including reasoning support, allowed thinking values, and input modalities.
- `desktop/src/lib/workspaceDesktop.tsx` and `desktop/src/lib/workspaceSelection.tsx`: renderer-side workspace state and shell coordination.
- `desktop/src/components/auth/AuthPanel.tsx`: provider settings, catalog-backed defaults, background-task selection, recall embeddings, and image-generation configuration.
- `desktop/src/components/panes/ChatPane.tsx`: model picker, per-model reasoning-effort selector, queued chat inputs, and stream/timeline rendering.
- `desktop/src/components/panes/BrowserPane.tsx`, `SpaceBrowserExplorerPane.tsx`, and `SpaceBrowserDisplayPane.tsx`: the browser-space UI for the `user` and `agent` browser surfaces.
- `desktop/src/components/panes/FileExplorerPane.tsx`: workspace file explorer, previews, editing, bookmarking, and file-watch behavior.
- `desktop/src/components/layout/NotificationToastStack.tsx`: runtime-backed notification rendering and activation behavior.
- `desktop/electron/preload.ts`: the renderer-to-main bridge exposed on `window.electronAPI`.
- `desktop/src/types/electron.d.ts`: the typed source of truth for the preload bridge. If the renderer can call it, it should be declared here.
- `desktop/electron/main.ts`: the main-process implementation for IPC, BrowserView orchestration, embedded runtime startup, workspace actions, file system actions, and browser state.

## Embedded runtime lifecycle

The desktop does not talk to the runtime through a vague helper. `desktop/electron/main.ts` owns the launch path:

1. Resolve the staged runtime bundle under `desktop/out/runtime-<platform>` or an override such as `HOLABOSS_RUNTIME_ROOT`.
2. Validate that the bundle includes the executable, packaged Node runtime, packaged Python runtime, `package-metadata.json`, and `runtime/api-server/dist/index.mjs`.
3. Spawn `bin/sandbox-runtime` with desktop-owned env such as `HB_SANDBOX_ROOT`, `SANDBOX_AGENT_BIND_HOST=127.0.0.1`, `SANDBOX_AGENT_BIND_PORT=5160`, `SANDBOX_AGENT_HARNESS`, `HOLABOSS_RUNTIME_DB_PATH`, and the bridge settings.
4. Wait for the embedded runtime health check to pass.
5. Stream stdout and stderr into `runtime.log` under the Electron `userData` directory.
6. On app quit, block final Electron exit until desktop-owned cleanup tears down the embedded runtime and browser service.

If you are debugging runtime startup from desktop, inspect `runtime.log` and the `sandbox-host` directory under Electron `userData` before you change UI code.

Representative launch shape from `desktop/electron/main.ts`:

```ts
const child = spawn(launchSpec.command, launchSpec.args, {
  cwd: runtimeRoot,
  env: {
    ...process.env,
    HB_SANDBOX_ROOT: sandboxRoot,
    SANDBOX_AGENT_BIND_HOST: "127.0.0.1",
    SANDBOX_AGENT_BIND_PORT: String(RUNTIME_API_PORT),
    HOLABOSS_EMBEDDED_RUNTIME: "1",
    SANDBOX_AGENT_HARNESS: harness,
    HOLABOSS_RUNTIME_DB_PATH: runtimeDatabasePath(),
    PROACTIVE_ENABLE_REMOTE_BRIDGE: "1",
    HOLABOSS_AUTH_COOKIE: authCookieHeader() ?? "",
  },
});
```

`HOLABOSS_RUNTIME_ROOT` can override the staged bundle location when you need the desktop to boot a different packaged runtime tree.

## Renderer-to-main contract

The desktop renderer does not talk to Electron internals directly. It goes through namespaced bridge contracts exposed by `electronAPI`.

Important namespaces include:

- `fs`: directory listing, previews, writes, file watches, and bookmarks
- `browser`: browser workspace selection, tab state, navigation, history, downloads, suggestions, and bounds syncing
- `workspace`: workspace lifecycle, sessions, apps, outputs, cronjobs, notifications, memory proposals, integrations, packaging flows, and reported operator-surface context
- `runtime`: runtime status, runtime config, profile, binding exchange, and restart flows
- `auth`: desktop sign-in and runtime binding exchange
- `billing`: subscription and usage surfaces
- `diagnostics`: local runtime and environment inspection helpers
- `appUpdate`: desktop update state and install flow
- `appSurface`: embedded app-surface navigation and bounds control
- `ui`: theme, settings routing, and external-link helpers
- `workbench`: browser-opening handoff from workbench surfaces into the main shell

If you change the desktop contract, update all three layers together:

1. `desktop/electron/preload.ts`
2. `desktop/src/types/electron.d.ts`
3. the `ipcMain` handler in `desktop/electron/main.ts`, usually wired through `handleTrustedIpc(...)`

Minimal bridge example:

```ts
// preload
runtime: {
  getConfig: () => ipcRenderer.invoke("runtime:getConfig"),
  setConfig: (payload) => ipcRenderer.invoke("runtime:setConfig", payload),
},
workspace: {
  queueSessionInput: (payload) =>
    ipcRenderer.invoke("workspace:queueSessionInput", payload),
}
```

```ts
// main
handleTrustedIpc("runtime:getConfig", ["main", "auth-popup"], () =>
  getRuntimeConfig(),
);
handleTrustedIpc(
  "runtime:setConfig",
  ["main", "auth-popup"],
  async (_event, payload) => {
    const currentConfig = await readRuntimeConfigFile();
    const nextConfig = await writeRuntimeConfigFile(payload);
    await restartEmbeddedRuntimeIfNeeded(currentConfig, nextConfig);
    return getRuntimeConfig();
  },
);
handleTrustedIpc("workspace:queueSessionInput", ["main"], async (_event, payload) =>
  queueSessionInput(payload),
);
```

## Browser protocol

The browser system is not just a webview dropped into React. The current path uses BrowserView orchestration in the main process and synchronizes the visible viewport from the renderer using `browser.setBounds`.

Important behavior to understand:

- browser state is workspace-aware
- browser spaces are explicit: `user` and `agent`
- the renderer activates tabs and navigation through `electronAPI.browser`
- the main process owns actual BrowserView attachment, persistence, downloads, history, popup windows, and the desktop browser service

The desktop browser service is now more than a browser-tool bridge. In addition to page and tab routes, it exposes `/api/v1/browser/operator-surface-context`, which lets the embedded runtime load the current active operator surfaces for the workspace. That payload combines browser-owned surfaces with the non-browser surfaces `AppShell` reports through `workspace.setOperatorSurfaceContext(...)`.

This split is why browser behavior belongs to desktop internals, not to generic UI code alone.

The non-browser half of that context comes from the renderer:

```ts
await window.electronAPI.workspace.setOperatorSurfaceContext(
  workspaceId,
  reportedOperatorSurfaceContext,
);
// runtime later reads GET /api/v1/browser/operator-surface-context
```

## Model catalog and reasoning controls

The desktop model path is now catalog-driven rather than a flat model string list.

- `desktop/electron/main.ts` refreshes a managed runtime model catalog from the control plane when a signed-in Holaboss session is active, caches that catalog, and merges it with the locally persisted `runtime-config.json`.
- The merged runtime-config snapshot exposes `providerModelGroups`, `catalogVersion`, and managed defaults for background tasks, embeddings, and image generation.
- `AuthPanel.tsx` uses that snapshot to show the actual configured provider/model surface instead of a blind text field.
- `ChatPane.tsx` uses the same provider groups plus the local fallback catalog to decide whether the selected model supports reasoning and which `thinking_value` choices to show.
- The selected `thinking_value` is a chat-composer preference, not a `runtime-config.json` field. On submit the renderer queues it with the session input so the runtime can apply it per run.

Representative catalog metadata and queue handoff:

```ts
const entry = {
  model_id: "gpt-5.4",
  reasoning: true,
  thinking_values: ["none", "low", "medium", "high", "xhigh"],
  default_thinking_value: "medium",
  input_modalities: ["text", "image"],
};
```

```ts
const selectedModelSupportsReasoning = selectedConfiguredModel
  ? selectedConfiguredModel.reasoning === true
  : Boolean(selectedFallbackModelMetadata?.reasoning);

await window.electronAPI.workspace.queueSessionInput({
  model: resolvedChatModel || null,
  thinking_value: effectiveThinkingValue,
});
```

## File explorer contract

The file explorer goes through the `fs:*` IPC namespace rather than reading files directly from the renderer.

The current contract includes:

- `fs:listDirectory`
- `fs:readFilePreview`
- `fs:writeTextFile`
- `fs:writeTableFile`
- `fs:watchFile`
- `fs:createPath`
- `fs:renamePath`
- `fs:movePath`
- `fs:deletePath`
- bookmark and file-change events

That keeps file access centralized in the main process and makes workspace-relative behavior auditable.

## Notification and runtime-backed product state

Desktop notifications are runtime-backed, not purely renderer-local.

The current path is:

1. runtime persists notification records in `runtime/state-store`
2. runtime exposes them through `/api/v1/notifications`
3. Electron routes that through `workspace:listNotifications` and `workspace:updateNotification`
4. `AppShell` polls and hydrates the toast stack
5. `NotificationToastStack` renders activation and dismissal behavior

So if you are changing notification behavior, inspect both the desktop shell and the runtime notification model.

## Display-surface model

The shell maintains a central display surface that can project:

- browser content
- app content
- internal surfaces

That routing currently lives in `AppShell.tsx` through `spaceDisplayView`. If you are adding a new display mode, start there and trace the corresponding pane/component path.

## Verification after desktop changes

- `npm run desktop:typecheck` is the minimum validation for every desktop change.
- Run `npm run desktop:e2e` when the change crosses renderer, preload, main-process, or embedded-runtime boundaries.
- Use `desktop/electron/browser-operator-surface-context.test.mjs` and `desktop/electron/runtime-quit-cleanup.test.mjs` as the fastest regression checks when you are touching browser-service context or app-quit cleanup.
- Use `bash desktop/scripts/check-runtime-status.sh` when the embedded runtime fails to start, a workspace looks corrupted, or app lifecycle behavior diverges from the desktop UI.
- Preserve the renderer/main boundary. Do not move file system access, BrowserView ownership, or runtime process management back into React state.
