# Hola Boss OSS

This repo now contains both the local desktop app and the runtime it embeds.

## What This Repo Is

- `desktop/`: Electron desktop workspace app
- `runtime/`: packaged TypeScript runtime, tests, and bundle tooling
- `.github/workflows/`: release and publishing workflows

This repository is public OSS. It supports local development and local runtime packaging without requiring login.

Backend-connected Holaboss product behavior is separate from the baseline local OSS workflow.

## What Works Without Login

- local desktop development
- local runtime packaging
- local workspace/runtime flows
- local typechecking and runtime tests

## What May Require Holaboss Backend Access

- hosted sign-in flows
- auth-backed product features
- backend-connected Holaboss services

## Prerequisites

- Node.js 22+
- npm

## Quick Start

Install desktop dependencies:

```bash
npm run desktop:install
```

Build and stage a local runtime bundle from this repo into `desktop/out/runtime-macos`:

```bash
npm run desktop:prepare-runtime:local
```

Run the desktop app in development:

```bash
npm run desktop:dev
```

This starts:

- the Vite renderer dev server
- the Electron main/preload watcher
- the Electron app itself

## Common Commands

Run the desktop typecheck:

```bash
npm run desktop:typecheck
```

Run runtime tests:

```bash
npm run runtime:test
```

Build a local macOS desktop bundle with the locally built runtime embedded:

```bash
npm run desktop:dist:mac:local
```

Stage the latest released runtime bundle for your current host platform:

```bash
npm run desktop:prepare-runtime
```

## Independent Runtime Deploy

The runtime bundle can be deployed independently of the Electron desktop app.

The standalone deploy shape is:

- build a platform-specific runtime bundle directory under `out/runtime-<platform>/`
- archive it as a `tar.gz`
- extract it on the target machine
- launch `bin/sandbox-runtime`

The launcher environment should stay consistent with how the desktop app starts the runtime:

- `HB_SANDBOX_ROOT`: runtime workspace/state root
- `SANDBOX_AGENT_BIND_HOST`: runtime API bind host
- `SANDBOX_AGENT_BIND_PORT`: runtime API bind port
- `OPENCODE_SERVER_HOST`: local OpenCode sidecar host
- `OPENCODE_SERVER_PORT`: local OpenCode sidecar port
- `SANDBOX_AGENT_HARNESS`: harness selector, defaults to `opencode`
- `HOLABOSS_RUNTIME_WORKFLOW_BACKEND`: workflow backend selector, desktop uses `remote_api`
- `HOLABOSS_RUNTIME_DB_PATH`: SQLite runtime DB path
- `PROACTIVE_ENABLE_REMOTE_BRIDGE`: desktop enables this with `1`
- `PROACTIVE_BRIDGE_BASE_URL`: remote bridge base URL when bridge flows are enabled

Health check:

```bash
curl http://127.0.0.1:8080/healthz
```

### Linux

Build the Linux runtime bundle:

```bash
bash runtime/deploy/package_linux_runtime.sh out/runtime-linux
tar -C out -czf out/holaboss-runtime-linux.tar.gz runtime-linux
```

Install it on a target Linux machine:

```bash
sudo mkdir -p /opt/holaboss
sudo tar -C /opt/holaboss -xzf holaboss-runtime-linux.tar.gz
sudo ln -sf /opt/holaboss/runtime-linux/bin/sandbox-runtime /usr/local/bin/holaboss-runtime
sudo mkdir -p /var/lib/holaboss
```

Run it with desktop-compatible environment variables:

```bash
HB_SANDBOX_ROOT=/var/lib/holaboss \
SANDBOX_AGENT_BIND_HOST=127.0.0.1 \
SANDBOX_AGENT_BIND_PORT=8080 \
OPENCODE_SERVER_HOST=127.0.0.1 \
OPENCODE_SERVER_PORT=4096 \
SANDBOX_AGENT_HARNESS=opencode \
HOLABOSS_RUNTIME_WORKFLOW_BACKEND=remote_api \
HOLABOSS_RUNTIME_DB_PATH=/var/lib/holaboss/state/runtime.db \
PROACTIVE_ENABLE_REMOTE_BRIDGE=1 \
PROACTIVE_BRIDGE_BASE_URL=https://your-bridge.example \
holaboss-runtime
```

If the runtime should accept connections from other machines, use `SANDBOX_AGENT_BIND_HOST=0.0.0.0` instead of `127.0.0.1`.

### macOS

Build the macOS runtime bundle:

```bash
bash runtime/deploy/package_macos_runtime.sh out/runtime-macos
tar -C out -czf out/holaboss-runtime-macos.tar.gz runtime-macos
```

Install it on a target macOS machine:

```bash
sudo mkdir -p /opt/holaboss
sudo tar -C /opt/holaboss -xzf holaboss-runtime-macos.tar.gz
sudo ln -sf /opt/holaboss/runtime-macos/bin/sandbox-runtime /usr/local/bin/holaboss-runtime
mkdir -p "$HOME/Library/Application Support/HolabossRuntime"
```

Run it with the same environment contract:

```bash
HB_SANDBOX_ROOT="$HOME/Library/Application Support/HolabossRuntime" \
SANDBOX_AGENT_BIND_HOST=127.0.0.1 \
SANDBOX_AGENT_BIND_PORT=8080 \
OPENCODE_SERVER_HOST=127.0.0.1 \
OPENCODE_SERVER_PORT=4096 \
SANDBOX_AGENT_HARNESS=opencode \
HOLABOSS_RUNTIME_WORKFLOW_BACKEND=remote_api \
HOLABOSS_RUNTIME_DB_PATH="$HOME/Library/Application Support/HolabossRuntime/state/runtime.db" \
PROACTIVE_ENABLE_REMOTE_BRIDGE=1 \
PROACTIVE_BRIDGE_BASE_URL=https://your-bridge.example \
holaboss-runtime
```

### Notes

- The packaged bundle includes the runtime app and its packaged runtime dependencies.
- The current bootstrap still expects a working `node` binary on the host machine at runtime. Install Node.js 22+ on the target machine before starting the runtime.
- The desktop app launches the same `bin/sandbox-runtime` entrypoint and passes the same bind host, bind port, sandbox root, and sidecar-related environment variables.

## Development Notes

The root `package.json` is just a thin command wrapper for the desktop app. The actual desktop project still lives in `desktop/package.json`.

`runtime/` remains independently buildable and testable. The desktop app consumes its packaged output rather than importing runtime source files directly.

For local desktop work, the default flow is:

```bash
npm run desktop:install
npm run desktop:prepare-runtime:local
npm run desktop:dev
```

For runtime-only work, the main command is:

```bash
npm run runtime:test
```
