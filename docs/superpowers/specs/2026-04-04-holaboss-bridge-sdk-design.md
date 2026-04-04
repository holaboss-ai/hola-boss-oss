# @holaboss/bridge SDK Design

## Summary

Extract the copy-pasted `holaboss-bridge.ts` from every module app into a standalone npm package `@holaboss/bridge` under `sdk/bridge/`. Published to npm so module apps install it instead of maintaining their own copy.

## Scope

This spec covers the first SDK package only. Future packages (`@holaboss/mcp`, etc.) follow the same pattern in sibling directories under `sdk/`.

## Directory structure

```
hola-boss-oss/
  sdk/
    bridge/
      package.json          # @holaboss/bridge, bun for deps + test
      tsconfig.json
      tsdown.config.ts
      src/
        index.ts            # Public entry — re-exports all API
        types.ts            # All public interfaces
        env.ts              # Internal: resolveBrokerUrl, resolveWorkspaceApiUrl, canPublishAppOutputs
        integration-proxy.ts  # createIntegrationClient
        workspace-outputs.ts  # createAppOutput, updateAppOutput
        presentation.ts       # buildAppResourcePresentation
      test/
        integration-proxy.test.ts
        workspace-outputs.test.ts
        presentation.test.ts
```

## Public API surface

Extracted from `_template/src/server/holaboss-bridge.ts` without changes to behavior.

### Functions

| Function | Module | Purpose |
|----------|--------|---------|
| `createIntegrationClient(provider)` | `integration-proxy.ts` | Returns an `IntegrationClient` that proxies calls through the Holaboss broker |
| `createAppOutput(request)` | `workspace-outputs.ts` | Creates a workspace output record, returns null if publishing unavailable |
| `updateAppOutput(outputId, request)` | `workspace-outputs.ts` | Patches an existing workspace output |
| `buildAppResourcePresentation({ view, path })` | `presentation.ts` | Builds an `app_resource` presentation object |

### Types

| Type | Kind |
|------|------|
| `ProxyRequest` | interface |
| `ProxyResponse<T>` | interface |
| `IntegrationClient` | interface |
| `AppOutputPresentationInput` | interface |
| `WorkspaceOutputPayload` | interface |
| `CreateAppOutputRequest` | interface |
| `UpdateAppOutputRequest` | interface |

### Internal (not exported)

| Function | Module | Purpose |
|----------|--------|---------|
| `resolveBrokerUrl()` | `env.ts` | Resolves broker URL from env vars |
| `resolveWorkspaceApiUrl()` | `env.ts` | Derives workspace API URL from broker URL |
| `canPublishAppOutputs()` | `env.ts` | Checks if both workspace API URL and workspace ID are available |

`integration-client.ts` (getProviderToken) from module apps is NOT included.

## Build

- **Bundler**: tsdown
- **Output**: ESM (`.mjs`) + CJS (`.cjs`) dual format
- **Types**: `dts: true` for automatic `.d.ts` generation
- **Target**: ES2022 (matches runtime tsconfig)
- **Package exports map**:
  ```json
  {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  }
  ```

## Tooling

- **Package manager**: bun
- **Test runner**: `bun test` (built-in, vitest-compatible)
- **Build**: `bunx tsdown`

## Root integration

OSS root `package.json` gets `sdk:bridge:*` scripts:

```json
{
  "sdk:bridge:install": "bun install --cwd sdk/bridge",
  "sdk:bridge:build": "bun --cwd sdk/bridge run build",
  "sdk:bridge:test": "bun --cwd sdk/bridge test"
}
```

## Testing strategy

Mock `globalThis.fetch` to test:
- `createIntegrationClient` — proxy request formatting, error handling, missing config
- `createAppOutput` / `updateAppOutput` — request construction, null when publishing unavailable
- `buildAppResourcePresentation` — path normalization

## Migration path (future, not in this spec)

Module apps delete `src/server/holaboss-bridge.ts` and replace with:

```ts
import {
  createIntegrationClient,
  createAppOutput,
  updateAppOutput,
  buildAppResourcePresentation,
} from "@holaboss/bridge"
```

## What is NOT included

- `integration-client.ts` / `getProviderToken` — not part of bridge SDK
- Module app migration — separate task after SDK is published
- Python SDK — future `sdk/python/bridge/` directory, separate spec
- npm org registration — handled separately by user
