# Sentry Integration Design

## Overview

Integrate Sentry error tracking into the hola-boss-oss project across two components: the Electron desktop app and the runtime API server. No performance tracing — error tracking only.

## Architecture

Two separate Sentry projects, three initialization points:

```
Sentry Project: holaboss-desktop
├── Electron main process  →  @sentry/electron (main)
└── Renderer process       →  @sentry/electron (renderer)

Sentry Project: holaboss-runtime
└── Fastify API server     →  @sentry/node
```

### Package Selection

| Component | Package | Reason |
|-----------|---------|--------|
| Desktop (main + renderer) | `@sentry/electron` | Single package handles both processes, auto-correlates events across main/renderer |
| Runtime API server | `@sentry/node` | Standard Node.js SDK, Fastify compatible |

### DSN Management (Open Source)

DSN is a write-only key (can only send events, not read). Management strategy:

- **Desktop**: DSN injected at build time via `process.env.SENTRY_DSN`, replaced to a string constant by tsup/vite `define`. No DSN = Sentry disabled. Official releases get DSN from CI secrets; fork builds and local dev have no DSN.
- **Runtime**: DSN read at runtime from `SENTRY_DSN` environment variable. Backend injects it when launching sandboxes. Self-hosted users can set their own DSN or leave it unset.

## Desktop Integration

### Electron Main Process

File: `desktop/electron/main.ts` — must be the very first import to capture startup errors.

```typescript
import * as Sentry from "@sentry/electron/main";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  release: app.getVersion(),
  environment: process.env.HOLABOSS_INTERNAL_DEV ? "development" : "production",
});
```

This automatically registers global `uncaughtException` and `unhandledRejection` handlers.

### Renderer Process

File: `desktop/src/main.tsx` — before React render.

```typescript
import * as Sentry from "@sentry/electron/renderer";

Sentry.init(); // DSN syncs automatically from main process
```

### ErrorBoundary Enhancement

File: `desktop/src/components/ui/ErrorBoundary.tsx` — add Sentry reporting to existing `componentDidCatch`.

```typescript
componentDidCatch(error: Error, info: ErrorInfo) {
  console.error("[ErrorBoundary]", error, info.componentStack);
  Sentry.captureException(error, {
    contexts: { react: { componentStack: info.componentStack } },
  });
}
```

### Build Configuration

**`desktop/vite.config.ts`** — enable source maps for renderer:

```typescript
build: {
  outDir: "out/dist",
  emptyOutDir: true,
  sourcemap: "hidden",  // generates .map files but doesn't reference them in output
},
define: {
  "process.env.SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN ?? ""),
},
```

**`desktop/tsup.config.ts`** — add build-time DSN replacement (sourcemap already enabled):

```typescript
env: {
  SENTRY_DSN: process.env.SENTRY_DSN ?? "",
},
```

## Runtime API Server Integration

### Entry Point

File: `runtime/api-server/src/index.ts` — top of file, before any other code.

```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  release: process.env.HOLABOSS_RUNTIME_VERSION,
  environment: process.env.SENTRY_ENVIRONMENT ?? "production",
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
      delete event.request.headers["x-api-key"];
    }
    return event;
  },
});
```

### Fastify Global Error Handler

File: `runtime/api-server/src/app.ts` — inside `buildRuntimeApiServer`, after Fastify instance creation.

```typescript
app.setErrorHandler((error, request, reply) => {
  Sentry.captureException(error, {
    extra: {
      method: request.method,
      url: request.url,
      params: request.params,
    },
  });
  app.log.error(error);
  reply.status(500).send({ error: "Internal Server Error" });
});
```

### Critical Background Task Error Capture

Add `Sentry.captureException` at these existing catch/error points (no logic changes, just one extra line each):

| Location | Error scenario |
|----------|---------------|
| `app.ts:2089` | Health monitor: max restart attempts exceeded |
| `app.ts:1787` | App setup failed |
| `app-lifecycle-worker.ts` startup failures | App process failed to start |

## CI: Source Map Upload

### GitHub Secrets/Variables Required

| Name | Type | Purpose |
|------|------|---------|
| `SENTRY_AUTH_TOKEN` | Secret | Authenticates source map uploads |
| `SENTRY_ORG` | Variable | Sentry organization slug |
| `SENTRY_DSN` | Secret | Desktop DSN, injected at build time |

### Desktop Release Workflows

Files: `release-macos-desktop.yml`, `release-windows-desktop.yml`

Add after the build step in `build-signed-macos-app` job:

```yaml
- name: Upload Sentry source maps
  if: ${{ env.SENTRY_AUTH_TOKEN != '' }}
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
    SENTRY_ORG: ${{ vars.SENTRY_ORG }}
    SENTRY_PROJECT: holaboss-desktop
  working-directory: desktop
  run: |
    npx @sentry/cli releases files "${{ env.RELEASE_TAG }}" \
      upload-sourcemaps out/dist out/dist-electron \
      --url-prefix "~/"
```

`if` guard ensures fork builds without the token don't fail.

### Runtime Release Workflow

File: `publish-runtime-bundles.yml`

Add after each platform's build step:

```yaml
- name: Upload Sentry source maps
  if: ${{ env.SENTRY_AUTH_TOKEN != '' }}
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
    SENTRY_ORG: ${{ vars.SENTRY_ORG }}
    SENTRY_PROJECT: holaboss-runtime
  run: |
    npx @sentry/cli releases files "runtime-$(date -u +'%Y.%-m.%-d')" \
      upload-sourcemaps runtime/api-server/dist \
      --url-prefix "~/"
```

## File Change Summary

```
Modified files:
  desktop/package.json                              — add @sentry/electron
  desktop/electron/main.ts                          — Sentry.init (main process)
  desktop/src/main.tsx                              — Sentry.init (renderer)
  desktop/src/components/ui/ErrorBoundary.tsx        — captureException
  desktop/vite.config.ts                            — sourcemap + define SENTRY_DSN
  desktop/tsup.config.ts                            — env SENTRY_DSN
  desktop/.env.example                              — add SENTRY_DSN example
  runtime/api-server/package.json                   — add @sentry/node
  runtime/api-server/src/index.ts                   — Sentry.init
  runtime/api-server/src/app.ts                     — setErrorHandler + captureException at key points
  .github/workflows/release-macos-desktop.yml       — source map upload step
  .github/workflows/release-windows-desktop.yml     — source map upload step
  .github/workflows/publish-runtime-bundles.yml     — source map upload step
```

## Prerequisites (Manual)

1. Create Sentry organization at sentry.io
2. Create two projects: `holaboss-desktop` (Electron platform) and `holaboss-runtime` (Node.js platform)
3. Copy DSNs from each project's settings
4. Generate an Auth Token with `project:releases` and `org:read` scopes
5. Configure GitHub repo: add `SENTRY_AUTH_TOKEN` (secret), `SENTRY_ORG` (variable), `SENTRY_DSN` (secret)

## What This Does NOT Include

- Performance tracing / transaction monitoring
- Session replay
- Changes to existing logging or error handling logic
- Sentry for module apps (twitter, linkedin, etc.) — out of scope
