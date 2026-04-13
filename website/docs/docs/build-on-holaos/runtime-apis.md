# Runtime APIs

Use this page when you are changing the runtime HTTP surface rather than only the desktop shell.

The source of truth is code:

- `runtime/api-server/src/index.ts`: binds the HTTP server host and port
- `runtime/api-server/src/app.ts`: registers every route
- `runtime/api-server/src/app.test.ts`: executable examples for request and response behavior
- `runtime/state-store/src/store.ts`: durable records returned or mutated by many routes

These APIs are used by the desktop app and by surrounding platform services. They are operational surfaces for running a workspace, not a generic third-party developer platform.

If a route change also changes durable records, continue to [Runtime State Store](/build-on-holaos/runtime/state-store). If it changes how a run is compiled or which tools/context the harness receives, continue to [Run Compilation](/build-on-holaos/runtime/run-compilation).

## Launch modes and ports

The same API server shows up under different ports depending on how you started it:

- Running `runtime/api-server/dist/index.mjs` directly defaults to `0.0.0.0:3060` unless `SANDBOX_RUNTIME_API_PORT`, `SANDBOX_AGENT_BIND_PORT`, or `PORT` is set.
- The packaged runtime launcher defaults to `0.0.0.0:8080` through `runtime/deploy/bootstrap/shared.sh`.
- The embedded desktop runtime binds to `127.0.0.1:5060` because `desktop/electron/main.ts` launches it that way.

Use the right port before you assume a route is broken.

## Common endpoint families

| Area | Representative routes | Backing modules and usual change points |
| --- | --- | --- |
| Health, config, and profile | `/healthz`, `/api/v1/runtime/config`, `/api/v1/runtime/status`, `/api/v1/runtime/profile` | `runtime-config.ts` and the runtime-config service tests |
| Browser and runtime tools | `/api/v1/capabilities/browser`, `/api/v1/capabilities/browser/tools/:toolId`, `/api/v1/capabilities/runtime-tools/*` | `desktop-browser-tools.ts`, `runtime-agent-tools.ts`, and harness/tool projection code |
| Workspaces and files | `/api/v1/workspaces`, `/api/v1/workspaces/:workspaceId/files/*`, `/apply-template`, `/export`, `/snapshot` | `workspace-apps.ts`, `workspace-snapshot.ts`, and workspace materialization helpers |
| Agent runs and sessions | `/api/v1/agent-runs`, `/api/v1/agent-runs/stream`, `/api/v1/agent-sessions/*` | `runner-worker.ts`, `ts-runner.ts`, `turn-result-summary.ts`, and state-store session tables |
| Integrations and auth flows | `/api/v1/integrations/*`, `/api/v1/integrations/oauth/*`, `/api/v1/integrations/broker/*` | `integrations.ts`, `integration-broker.ts`, `oauth-service.ts`, and `composio-service.ts` |
| Memory and post-run system state | `/api/v1/memory/*`, `/api/v1/memory-update-proposals*`, `/api/v1/task-proposals*` | `memory.js`, `user-memory-proposals.js`, `turn-memory-writeback.js`, and queue or evolve workers |
| Apps and resolved-app orchestration | `/api/v1/apps/*`, `/api/v1/internal/workspaces/:workspaceId/resolved-apps/start` | `workspace-apps.ts`, `app-lifecycle-worker.ts`, and `resolved-app-bootstrap.ts` |
| Outputs, notifications, and cronjobs | `/api/v1/outputs*`, `/api/v1/output-folders*`, `/api/v1/notifications*`, `/api/v1/cronjobs*` | `cron-worker.ts`, state-store output tables, and the desktop surfaces that render this state |

## Streaming surfaces

The runtime has several streaming endpoints. If you change event shape or long-running execution behavior, trace these paths first:

- `POST /api/v1/agent-runs/stream`
- `GET /api/v1/task-proposals/unreviewed/stream`
- `GET /api/v1/agent-sessions/:sessionId/outputs/events`
- `GET /api/v1/agent-sessions/:sessionId/outputs/stream`

Execution usually crosses `runtime/api-server/src/ts-runner.ts`, the harness registry, the harness host, and the state store before the desktop sees the result.

## How to change the API safely

1. Add or update the route in `runtime/api-server/src/app.ts`.
2. Keep the backing service, worker, or state-store contract in sync.
3. Add or adjust tests in `runtime/api-server/src/app.test.ts` or the focused package test file.
4. If the desktop consumes the route, update the Electron IPC bridge and renderer call site too.

## Minimal smoke checks

For a local embedded desktop runtime:

```bash
curl http://127.0.0.1:5060/healthz
curl http://127.0.0.1:5060/api/v1/runtime/status
```

For standalone runtime debugging, change the port to the one you actually bound, usually `8080` or `3060`.

## Validation

```bash
npm run runtime:api-server:typecheck
npm run runtime:api-server:test
npm run runtime:test
```

Use `runtime/api-server/src/app.test.ts` as the fastest executable reference when you are unsure what an endpoint is expected to accept or return.
