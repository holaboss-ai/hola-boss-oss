# Sentry Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sentry error tracking to the Electron desktop app and runtime API server, with CI source map upload.

**Architecture:** Two Sentry projects (`holaboss-desktop`, `holaboss-runtime`), three init points (Electron main, renderer, Fastify server). DSN injected at build time for desktop, at runtime for sandbox. Source maps uploaded in CI release workflows.

**Tech Stack:** `@sentry/electron` (desktop), `@sentry/node` (runtime), `@sentry/cli` (CI source map upload)

**Spec:** `docs/superpowers/specs/2026-04-11-sentry-integration-design.md`

---

### Task 1: Install @sentry/electron in desktop

**Files:**
- Modify: `desktop/package.json`

- [ ] **Step 1: Install the package**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop && npm install @sentry/electron
```

- [ ] **Step 2: Verify it installed**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop && node -e "require.resolve('@sentry/electron')" && echo "OK"
```

Expected: prints the resolved path and `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS && git add desktop/package.json desktop/package-lock.json && git commit -m "feat: add @sentry/electron dependency"
```

---

### Task 2: Initialize Sentry in Electron main process

**Files:**
- Modify: `desktop/electron/main.ts` (top of file, before all existing imports)

- [ ] **Step 1: Add Sentry init as the very first lines of main.ts**

The file currently starts with:

```typescript
import { electronClient } from "@better-auth/electron/client";
import { storage as electronAuthStorage } from "@better-auth/electron/storage";
```

Prepend these lines before all existing imports:

```typescript
import * as Sentry from "@sentry/electron/main";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.HOLABOSS_INTERNAL_DEV ? "development" : "production",
});
```

Note: `@sentry/electron/main` must be the very first import. It automatically captures `uncaughtException` and `unhandledRejection`. We omit `release` here because `app.getVersion()` requires `electron` to be imported first — Sentry will pick up the version from the Electron app automatically.

- [ ] **Step 2: Verify desktop builds**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop && npx tsup --config tsup.config.ts
```

Expected: builds successfully with no errors, output in `out/dist-electron/main.cjs`

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS && git add desktop/electron/main.ts && git commit -m "feat: initialize Sentry in Electron main process"
```

---

### Task 3: Initialize Sentry in renderer and enhance ErrorBoundary

**Files:**
- Modify: `desktop/src/main.tsx`
- Modify: `desktop/src/components/ui/ErrorBoundary.tsx`

- [ ] **Step 1: Add Sentry init to renderer entry**

The file currently contains:

```typescript
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
```

Replace with:

```typescript
import * as Sentry from "@sentry/electron/renderer";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

Sentry.init();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
```

`Sentry.init()` takes no arguments — the DSN, release, and environment are automatically synced from the main process.

- [ ] **Step 2: Add Sentry.captureException to ErrorBoundary**

In `desktop/src/components/ui/ErrorBoundary.tsx`, add the import and the capture call.

Add at the top of the file:

```typescript
import * as Sentry from "@sentry/electron/renderer";
```

Replace the existing `componentDidCatch` method:

```typescript
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }
```

With:

```typescript
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
    });
  }
```

- [ ] **Step 3: Verify renderer builds**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop && npx vite build
```

Expected: builds successfully, output in `out/dist/`

- [ ] **Step 4: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS && git add desktop/src/main.tsx desktop/src/components/ui/ErrorBoundary.tsx && git commit -m "feat: initialize Sentry in renderer and enhance ErrorBoundary"
```

---

### Task 4: Configure desktop build for DSN injection and source maps

**Files:**
- Modify: `desktop/vite.config.ts`
- Modify: `desktop/tsup.config.ts`
- Modify: `desktop/.env.example`

- [ ] **Step 1: Update vite.config.ts**

The current file:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "out/dist",
    emptyOutDir: true
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
```

Replace with:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "out/dist",
    emptyOutDir: true,
    sourcemap: "hidden"
  },
  define: {
    "process.env.SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN ?? "")
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
```

Changes: added `sourcemap: "hidden"` (generates .map files without referencing them in output bundles) and `define` block to replace `process.env.SENTRY_DSN` at build time.

- [ ] **Step 2: Update tsup.config.ts**

The current file:

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "electron/main.ts",
    "electron/preload.ts",
    "electron/authPopupPreload.ts",
    "electron/downloadsPopupPreload.ts",
    "electron/historyPopupPreload.ts",
    "electron/overflowPopupPreload.ts",
    "electron/addressSuggestionsPopupPreload.ts"
  ],
  format: ["cjs"],
  outDir: "out/dist-electron",
  clean: false,
  splitting: false,
  platform: "node",
  external: ["electron", "better-sqlite3"],
  sourcemap: true,
  outExtension() {
    return {
      js: ".cjs"
    };
  }
});
```

Replace with:

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "electron/main.ts",
    "electron/preload.ts",
    "electron/authPopupPreload.ts",
    "electron/downloadsPopupPreload.ts",
    "electron/historyPopupPreload.ts",
    "electron/overflowPopupPreload.ts",
    "electron/addressSuggestionsPopupPreload.ts"
  ],
  format: ["cjs"],
  outDir: "out/dist-electron",
  clean: false,
  splitting: false,
  platform: "node",
  external: ["electron", "better-sqlite3"],
  sourcemap: true,
  env: {
    SENTRY_DSN: process.env.SENTRY_DSN ?? ""
  },
  outExtension() {
    return {
      js: ".cjs"
    };
  }
});
```

Change: added `env` block. tsup replaces `process.env.SENTRY_DSN` with the literal value at build time.

- [ ] **Step 3: Update .env.example**

The current file:

```
HOLABOSS_AUTH_BASE_URL=https://api.holaboss.ai
HOLABOSS_AUTH_SIGN_IN_URL=https://www.holaboss.ai/signin
HOLABOSS_BACKEND_BASE_URL=http://35.160.37.189
```

Append:

```
# Sentry error tracking (optional, leave empty to disable)
# SENTRY_DSN=
```

- [ ] **Step 4: Verify both builds work**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop && npx tsup --config tsup.config.ts && npx vite build
```

Expected: both build successfully. Vite output should include `.map` files in `out/dist/`.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS && git add desktop/vite.config.ts desktop/tsup.config.ts desktop/.env.example && git commit -m "feat: configure desktop build for Sentry DSN injection and source maps"
```

---

### Task 5: Install @sentry/node in runtime API server

**Files:**
- Modify: `runtime/api-server/package.json`

- [ ] **Step 1: Install the package**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server && npm install @sentry/node
```

- [ ] **Step 2: Verify it installed**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server && node -e "import('@sentry/node').then(() => console.log('OK'))"
```

Expected: prints `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS && git add runtime/api-server/package.json runtime/api-server/package-lock.json && git commit -m "feat: add @sentry/node dependency to runtime API server"
```

---

### Task 6: Initialize Sentry in runtime API server entry point

**Files:**
- Modify: `runtime/api-server/src/index.ts`

- [ ] **Step 1: Add Sentry init to top of index.ts**

The file currently contains:

```typescript
import { buildRuntimeApiServer } from "./app.js";

async function main(): Promise<void> {
  const port = Number.parseInt(
    process.env.SANDBOX_RUNTIME_API_PORT ?? process.env.SANDBOX_AGENT_BIND_PORT ?? process.env.PORT ?? "3060",
    10
  );
  const host =
    (process.env.SANDBOX_RUNTIME_API_HOST ?? process.env.SANDBOX_AGENT_BIND_HOST ?? "0.0.0.0").trim() || "0.0.0.0";
  const app = buildRuntimeApiServer({ logger: true });

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

await main();
```

Replace with:

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

import { buildRuntimeApiServer } from "./app.js";

async function main(): Promise<void> {
  const port = Number.parseInt(
    process.env.SANDBOX_RUNTIME_API_PORT ?? process.env.SANDBOX_AGENT_BIND_PORT ?? process.env.PORT ?? "3060",
    10
  );
  const host =
    (process.env.SANDBOX_RUNTIME_API_HOST ?? process.env.SANDBOX_AGENT_BIND_HOST ?? "0.0.0.0").trim() || "0.0.0.0";
  const app = buildRuntimeApiServer({ logger: true });

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

await main();
```

`Sentry.init` must be before all other imports so it can monkey-patch Node.js modules for automatic error capture.

- [ ] **Step 2: Verify build**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server && npx tsup --config tsup.config.ts
```

Expected: builds successfully

- [ ] **Step 3: Verify tests still pass**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server && node --import tsx --test src/index.test.ts 2>/dev/null; echo "exit: $?"
```

If there's no `index.test.ts`, just verify the build output is valid:

```bash
node -e "import('./dist/index.mjs')" 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS && git add runtime/api-server/src/index.ts && git commit -m "feat: initialize Sentry in runtime API server"
```

---

### Task 7: Add Fastify error handler and captureException at critical points

**Files:**
- Modify: `runtime/api-server/src/app.ts` (three locations)

- [ ] **Step 1: Add Sentry import to app.ts**

At the top of `runtime/api-server/src/app.ts`, after the existing imports (after line 12 `import yauzl from "yauzl";`), add:

```typescript
import * as Sentry from "@sentry/node";
```

- [ ] **Step 2: Add Fastify global error handler**

In the `buildRuntimeApiServer` function, after the service initialization block (after line 1704 `const bridgeWorker = resolveBridgeWorker(options, app, store, memoryService);`), add:

```typescript
  app.setErrorHandler((error, request, reply) => {
    Sentry.captureException(error, {
      extra: {
        method: request.method,
        url: request.url,
      },
    });
    app.log.error(error);
    reply.status(500).send({ error: "Internal Server Error" });
  });
```

- [ ] **Step 3: Add captureException at health monitor max restart failure**

At line 2089 in `app.ts`, the existing code is:

```typescript
          app.log.error({ workspaceId: ws.id, appId, attempts: attempts - 1 }, "health monitor: max restart attempts exceeded");
          store.upsertAppBuild({
```

After the `app.log.error` line and before `store.upsertAppBuild`, add:

```typescript
          Sentry.captureException(new Error(`App ${appId} crashed and failed to recover after ${MAX_AUTO_RESTART_ATTEMPTS} attempts`), {
            extra: { workspaceId: ws.id, appId, attempts: attempts - 1 },
          });
```

- [ ] **Step 4: Add captureException at app setup failure**

At line 1787 in `app.ts`, the existing code is:

```typescript
        const afterSetup = store.getAppBuild({ workspaceId, appId });
        if (afterSetup?.status === "failed") {
          throw new Error(afterSetup.error ?? "setup failed");
        }
```

Replace with:

```typescript
        const afterSetup = store.getAppBuild({ workspaceId, appId });
        if (afterSetup?.status === "failed") {
          const setupError = new Error(afterSetup.error ?? "setup failed");
          Sentry.captureException(setupError, {
            extra: { workspaceId, appId },
          });
          throw setupError;
        }
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server && npx tsup --config tsup.config.ts
```

Expected: builds successfully

- [ ] **Step 6: Run existing tests**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server && node --import tsx --test src/app.test.ts
```

Expected: all existing tests pass (Sentry is a no-op without DSN)

- [ ] **Step 7: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS && git add runtime/api-server/src/app.ts && git commit -m "feat: add Sentry error handler and captureException at critical failure points"
```

---

### Task 8: Add source map upload to desktop release CI workflows

**Files:**
- Modify: `.github/workflows/release-macos-desktop.yml`
- Modify: `.github/workflows/release-windows-desktop.yml`

- [ ] **Step 1: Add source map upload step to macOS workflow**

In `.github/workflows/release-macos-desktop.yml`, in the `build-signed-macos-app` job, after the "Build signed macOS app bundle" step (after line 209 which ends that step), add a new step:

```yaml
      - name: Upload Sentry source maps
        if: ${{ secrets.SENTRY_AUTH_TOKEN != '' }}
        working-directory: desktop
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: holaboss-desktop
        run: |
          npx @sentry/cli releases files "${{ env.RELEASE_TAG }}" \
            upload-sourcemaps out/dist out/dist-electron \
            --url-prefix "~/"
```

Also add `SENTRY_DSN: ${{ secrets.SENTRY_DSN }}` to the "Build signed macOS app bundle" step's env block (after line 177 `HOLABOSS_PROACTIVE_URL`):

```yaml
          SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
```

- [ ] **Step 2: Add source map upload step to Windows workflow**

In `.github/workflows/release-windows-desktop.yml`, in the `release-windows-desktop` job, after the "Build Windows desktop installer" step (after line 179), add a new step:

```yaml
      - name: Upload Sentry source maps
        if: ${{ secrets.SENTRY_AUTH_TOKEN != '' }}
        working-directory: desktop
        shell: bash
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: holaboss-desktop
        run: |
          npx @sentry/cli releases files "${{ env.RELEASE_TAG }}" \
            upload-sourcemaps out/dist out/dist-electron \
            --url-prefix "~/"
```

Also add `SENTRY_DSN: ${{ secrets.SENTRY_DSN }}` to the "Build Windows desktop installer" step's env block (after line 152 `HOLABOSS_PROACTIVE_URL`):

```yaml
          SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
```

Note: Windows step uses `shell: bash` explicitly since the default is `pwsh`.

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS && git add .github/workflows/release-macos-desktop.yml .github/workflows/release-windows-desktop.yml && git commit -m "feat: add Sentry source map upload to desktop release workflows"
```

---

### Task 9: Add source map upload to runtime release CI workflow

**Files:**
- Modify: `.github/workflows/publish-runtime-bundles.yml`

- [ ] **Step 1: Add source map upload step to macOS runtime job**

In `.github/workflows/publish-runtime-bundles.yml`, in the `publish-macos-runtime` job, after the "Build macOS runtime bundle" step (after line 134) and before the "Archive macOS runtime bundle" step, add:

```yaml
      - name: Upload Sentry source maps
        if: ${{ secrets.SENTRY_AUTH_TOKEN != '' }}
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: holaboss-runtime
          RELEASE_TAG: ${{ needs.ensure-runtime-release.outputs.release_tag }}
        run: |
          npx @sentry/cli releases files "${RELEASE_TAG}" \
            upload-sourcemaps runtime/api-server/dist \
            --url-prefix "~/"
```

- [ ] **Step 2: Add source map upload step to Linux runtime job**

In the same file, in the `publish-linux-runtime` job, after the "Build Linux runtime bundle" step (after line 179) and before the "Archive Linux runtime bundle" step, add the same step:

```yaml
      - name: Upload Sentry source maps
        if: ${{ secrets.SENTRY_AUTH_TOKEN != '' }}
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: holaboss-runtime
          RELEASE_TAG: ${{ needs.ensure-runtime-release.outputs.release_tag }}
        run: |
          npx @sentry/cli releases files "${RELEASE_TAG}" \
            upload-sourcemaps runtime/api-server/dist \
            --url-prefix "~/"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS && git add .github/workflows/publish-runtime-bundles.yml && git commit -m "feat: add Sentry source map upload to runtime release workflow"
```

---

### Task 10: Verify full build and typecheck

**Files:** None (verification only)

- [ ] **Step 1: Run desktop typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 2: Run desktop full build**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/desktop && npm run build
```

Expected: builds successfully (both renderer and electron)

- [ ] **Step 3: Run runtime typecheck**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 4: Run runtime build**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server && npx tsup --config tsup.config.ts
```

Expected: builds successfully

- [ ] **Step 5: Run runtime tests**

```bash
cd /Users/joshua/holaboss-ai/holaboss/holaOS/runtime/api-server && node --import tsx --test src/**/*.test.ts
```

Expected: all tests pass
