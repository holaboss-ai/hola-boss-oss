# Install Guide For Coding Agents

This file is a deterministic setup runbook for an agent working from a fresh machine or workspace.

## Goal

Clone the Holaboss OSS repository and complete the same baseline desktop setup flow described in the README quick start.

## Repository

Use this repository URL:

```bash
https://github.com/holaboss-ai/hola-boss-oss.git
```

## Prerequisites

Before running any project commands, ensure the machine has:

- `git`
- `node` version `22` or newer
- `npm`

Validate prerequisites:

```bash
git --version
node --version
npm --version
```

If `node --version` reports a major version lower than `22`, stop and upgrade Node.js before continuing.

## Clone The Repository

If the repository is not already present locally, clone it:

```bash
git clone https://github.com/holaboss-ai/hola-boss-oss.git
cd hola-boss-oss
```

If the repository already exists locally, enter the repository root instead:

```bash
cd hola-boss-oss
```

All commands below must be run from the repository root.

## Install Dependencies

Use the root wrapper script so installation stays aligned with the repo:

```bash
npm run desktop:install
```

This installs the dependencies for the Electron desktop app under `desktop/`.

## Create The Desktop Environment File

If `desktop/.env` does not exist yet, create it from the example file:

```bash
cp desktop/.env.example desktop/.env
```

The public OSS repository already includes default values in `desktop/.env.example`. Copy it as-is unless a human operator gives you replacement environment values.

## Stage The Local Runtime Bundle

Build and stage the runtime bundle from the local source tree:

```bash
npm run desktop:prepare-runtime:local
```

This prepares a platform-specific runtime bundle under `desktop/out/runtime-<platform>`.

## Verify The Desktop Setup

Run the non-interactive desktop verification step before launching the app:

```bash
npm run desktop:typecheck
```

If it fails, stop and report the failure instead of continuing.

## Optional Runtime Validation

If you also need to validate the runtime packages on a fresh clone, prepare them first and then run the runtime test suite:

```bash
npm run runtime:state-store:install
npm run runtime:state-store:build
npm run runtime:harness-host:install
npm run runtime:harness-host:build
npm run runtime:api-server:install
npm run runtime:test
```

## Launch The Desktop App

Start the local desktop development environment with:

```bash
npm run desktop:dev
```

This launches:

- the Vite renderer dev server
- the Electron main/preload watcher
- the Electron app

Important:

- `npm run desktop:dev` is an interactive long-running process.
- It may fail in headless or GUI-less environments.
- If the execution environment cannot open Electron windows, stop after the desktop verification step and report that installation succeeded but interactive launch was not attempted.

## Optional Alternative

If local runtime staging from source is not wanted and the environment should use the latest released runtime bundle for the current host platform instead, run:

```bash
npm run desktop:prepare-runtime
```

Use that command instead of `npm run desktop:prepare-runtime:local`.

## Minimal Command Sequence

For a standard fresh setup, the expected command sequence is:

```bash
git clone https://github.com/holaboss-ai/hola-boss-oss.git
cd hola-boss-oss
npm run desktop:install
cp desktop/.env.example desktop/.env
npm run desktop:prepare-runtime:local
npm run desktop:typecheck
npm run desktop:dev
```
