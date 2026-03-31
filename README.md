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

Copy the desktop env template and fill in the required values:

```bash
cp desktop/.env.example desktop/.env
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

## Model Configuration

The app ships with a default model setup. This section only covers how to override it with your own model configuration.

- default model: `openai/gpt-5.1`
- default provider id for unprefixed models: `openai`

### Customization Mode

#### Your Own Proxy

You can point the runtime at your own proxy.

- set `model_proxy_base_url` to your proxy root
- set `auth_token` to the token your proxy expects
- set `sandbox_id`
- set `default_model` to the model you want to use

Important behavior:

- for OpenAI-compatible models, the runtime uses `<base>/openai/v1`
- for Anthropic models, the runtime uses `<base>/anthropic/v1`
- the runtime passes `X-API-Key` and `X-Holaboss-Sandbox-Id`
- OpenCode provider config also persists `X-Holaboss-User-Id` when available

So a custom proxy is a good fit when it accepts that header contract directly, or at least safely ignores the extra Holaboss-specific headers.

One implementation detail: the internal provider key in `runtime-config.json` remains `holaboss_model_proxy` even when you point it at your own proxy.

#### Direct Provider Endpoint (No Proxy Rewriter)

You can also route directly to a provider endpoint (for example OpenAI) without a model-proxy rewriter.

- set `model_proxy_base_url` to the provider API base, for example `https://api.openai.com/v1`
- set `auth_token` to your provider API key
- set `default_model`, for example `openai/gpt-5.1` or `anthropic/claude-sonnet-4-20250514`

Runtime URL behavior:

- if `model_proxy_base_url` is a proxy root, runtime appends provider routes (`/openai/v1`, `/anthropic/v1`)
- direct mode is enabled when you provide a provider endpoint (recommended: include `/v1`, for example `https://api.openai.com/v1`)
- known provider hosts `api.openai.com` and `api.anthropic.com` also work without an explicit path; runtime normalizes them to `/v1`

### Where The Runtime Reads Model Config

The runtime resolves model settings from:

1. `runtime-config.json`
2. environment variables
3. built-in defaults

By default, `runtime-config.json` lives at:

- `${HB_SANDBOX_ROOT}/state/runtime-config.json`

You can override that path with:

- `HOLABOSS_RUNTIME_CONFIG_PATH`

### Important Settings

- `model_proxy_base_url`
  - base URL root for your proxy, for example `https://your-proxy.example/api/v1/model-proxy`
- `auth_token`
  - token sent as `X-API-Key`
- `sandbox_id`
  - sandbox identifier propagated into runtime execution context and proxy headers
- `default_model`
  - default model selection, for example `openai/gpt-5.1`
- `HOLABOSS_DEFAULT_MODEL`
  - environment override for `default_model`
- `OPENCODE_BOOT_MODEL`
  - fallback env if `HOLABOSS_DEFAULT_MODEL` is not set

### Model String Format

Use provider-prefixed model ids when you want to be explicit:

- `openai/gpt-5.1`
- `openai/gpt-4.1-mini-2025-04-14`
- `anthropic/claude-sonnet-4-20250514`

The runtime also treats unprefixed `claude...` model ids as Anthropic models:

- `claude-sonnet-4-20250514`

If a model id is unprefixed and does not start with `claude`, the runtime treats it as `openai/<model>`.

### `runtime-config.json` Universal Provider Example

```json
{
  "runtime": {
    "default_provider": "holaboss",
    "default_model": "holaboss/gpt-5.2",
    "sandbox_id": "local-sandbox"
  },
  "providers": {
    "holaboss": {
      "kind": "holaboss_proxy",
      "base_url": "https://your-proxy.example/api/v1/model-proxy",
      "api_key": "your-holaboss-proxy-token"
    },
    "openai_direct": {
      "kind": "openai_compatible",
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-your-openai-key"
    },
    "anthropic_direct": {
      "kind": "anthropic_native",
      "base_url": "https://api.anthropic.com/v1",
      "api_key": "sk-ant-your-anthropic-key"
    },
    "openrouter_direct": {
      "kind": "openrouter",
      "base_url": "https://openrouter.ai/api/v1",
      "api_key": "sk-or-your-openrouter-key"
    }
  },
  "models": {
    "holaboss/gpt-5.2": { "provider": "holaboss", "model": "gpt-5.2" },
    "holaboss/claude-sonnet-4-5": { "provider": "holaboss", "model": "claude-sonnet-4-5" },
    "openai_direct/gpt-5.2": { "provider": "openai_direct", "model": "gpt-5.2" },
    "anthropic_direct/claude-sonnet-4-5": { "provider": "anthropic_direct", "model": "claude-sonnet-4-5" },
    "openrouter_direct/deepseek/deepseek-chat-v3-0324": {
      "provider": "openrouter_direct",
      "model": "deepseek/deepseek-chat-v3-0324"
    }
  }
}
```

Provider `kind` values supported by the runtime resolver:

- `holaboss_proxy`
- `openai_compatible`
- `anthropic_native`
- `openrouter`

### Environment Overrides

```bash
export HOLABOSS_MODEL_PROXY_BASE_URL="https://your-proxy.example/api/v1/model-proxy"
export HOLABOSS_SANDBOX_AUTH_TOKEN="your-proxy-token"
export HOLABOSS_DEFAULT_MODEL="anthropic/claude-sonnet-4-20250514"
```

These env vars override the file-based values above. `sandbox_id` still needs to come from `runtime-config.json`.

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
cp desktop/.env.example desktop/.env
npm run desktop:prepare-runtime:local
npm run desktop:dev
```

For runtime-only work, the main command is:

```bash
npm run runtime:test
```
