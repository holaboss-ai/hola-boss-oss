# Troubleshooting

Use this page when `desktop:dev`, the embedded runtime, or a packaged runtime is not behaving the way the code says it should.

If you hit something that is not covered here, we always welcome issues. Real setup failures, unclear docs, and runtime edge cases are all useful signals for improving `holaOS` and Holaboss Desktop.

## First triage commands

For the desktop dev loop:

```bash
npm run desktop:typecheck
curl http://127.0.0.1:5060/healthz
bash desktop/scripts/check-runtime-status.sh
```

For a packaged or standalone runtime, use the port you actually bound, usually `8080`.

## `desktop:dev` exits before Electron starts

Most early failures happen in the desktop `predev` hook, before the app window exists.

- Verify that Node.js `22+` is installed.
- Re-run `npm run desktop:install` if the desktop dependency tree is incomplete.
- Check `desktop/.env`. `desktop/scripts/validate-dev-env.mjs` requires at least one configured remote base URL such as `HOLABOSS_BACKEND_BASE_URL`, `HOLABOSS_PROACTIVE_URL`, `HOLABOSS_CLI_PROACTIVE_URL`, or `HOLABOSS_DESKTOP_CONTROL_PLANE_BASE_URL`.
- If the failure happens during native module rebuild, re-run `npm run desktop:install` and then `npm run desktop:typecheck`.

## The embedded runtime does not pass health checks

In desktop dev, the embedded runtime is supposed to come up on `127.0.0.1:5060`, not `8080` or `3060`.

- Check `curl http://127.0.0.1:5060/healthz`.
- Inspect `runtime.log` under the Electron `userData` directory.
- Inspect the embedded sandbox root under `sandbox-host/`, especially `sandbox-host/state/runtime-config.json` and `sandbox-host/state/runtime.db`.
- If you set a custom user-data path, make sure you are looking in `HOLABOSS_DESKTOP_USER_DATA_PATH`. Otherwise `desktop:dev` defaults to an Electron `userData` directory derived from `HOLABOSS_DESKTOP_USER_DATA_DIR=holaboss-local-dev`.

## The runtime bundle is stale

The desktop dev loop only uses the staged bundle under `desktop/out/runtime-<platform>`.

- rerun `npm run desktop:prepare-runtime:local`
- verify that `desktop/out/runtime-<platform>/package-metadata.json` exists
- verify that the staged bundle contains `bin/sandbox-runtime`, `runtime/metadata.json`, and `runtime/api-server/dist/index.mjs`
- remember that `desktop/scripts/watch-runtime-bundle.mjs` only rebuilds when source inputs listed in `desktop/scripts/runtime-bundle-state.mjs` change

If you want to throw away the staged bundle entirely, delete `desktop/out/runtime-<platform>` and rerun the staging command.

## The standalone or packaged runtime is on the wrong port

The launch mode controls the default port:

- embedded desktop runtime: `5060`
- packaged launcher: `8080`
- raw `runtime/api-server/dist/index.mjs`: `3060`

If you override `SANDBOX_AGENT_BIND_PORT`, check that port instead. Do not debug route behavior against the wrong launch mode.

## Model configuration looks correct but requests still fail

Check the provider path first:

- verify that the provider base URL is reachable
- verify that the auth token is valid
- verify that the selected model name matches the provider contract
- verify that `runtime-config.json` is being read from the expected path

The runtime config parser merges values from `runtime`, `providers.holaboss_model_proxy`, `integrations.holaboss`, and `capabilities.desktop_browser`. The executable examples for this are in `runtime/api-server/src/runtime-config.test.ts`.

If you are using direct provider fallback instead of the Holaboss model proxy path, verify the corresponding direct-provider env vars such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`.

## App setup fails inside an isolated app environment or container

This usually means the install step is colliding with overlay filesystem behavior.

Use the same pattern the app templates recommend:

```bash
rm -rf node_modules && npm install --maxsockets 1 && npm run build
```

Also verify that:

- `apps/<app-id>/app.runtime.yaml` declares the expected setup and start commands
- the app manifest points at the expected MCP path, if the app exposes MCP tools
- the runtime can still resolve the app's assigned ports through `/api/v1/apps/ports`

## Browser tools are missing during agent runs

The browser tool surface is not always available.

- Confirm that runtime config enables the desktop browser capability and includes both the browser URL and auth token.
- Confirm that you are running a `workspace_session`. The harness registry only stages browser tools for workspace sessions.
- If the runtime reports browser unavailable, inspect `runtime-config.json` and `/api/v1/runtime/status` before you patch the harness.

## The runtime starts but workspace data looks wrong

Check these files first:

- `workspace.yaml`
- `AGENTS.md`
- `apps/<app-id>/app.runtime.yaml`
- `.holaboss/`
- `state/runtime.db`

If the workspace files are valid but the runtime still behaves unexpectedly, compare the current bundle against the source revision you used to stage it.

## Report an issue

If none of the fixes on this page help, submit an issue here:

- [Open a GitHub issue](https://github.com/holaboss-ai/holaOS/issues/new/choose)
