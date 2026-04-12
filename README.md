# Holaboss - AI Workspace Desktop for Business

<p align="center">
  <img src="desktop/public/logo.svg" alt="Holaboss logo" width="132" />
</p>

<p align="center"><strong>Build, run, and package AI workspaces and workspace templates with a desktop app and portable runtime.</strong></p>

<p align="center">
  <a href="https://github.com/holaboss-ai/holaboss-ai/actions/workflows/oss-ci.yml"><img src="https://github.com/holaboss-ai/holaboss-ai/actions/workflows/oss-ci.yml/badge.svg" alt="OSS CI" /></a>
  <img src="https://img.shields.io/badge/node-22%2B-43853d" alt="Node 22+" />
  <img src="https://img.shields.io/badge/platform-macOS%20supported,%20Windows%20%26%20Linux%20in%20progress-f28c28" alt="macOS supported, Windows and Linux in progress" />
  <img src="https://img.shields.io/badge/desktop-Electron-47848f" alt="Electron desktop" />
  <img src="https://img.shields.io/badge/runtime-TypeScript-3178c6" alt="TypeScript runtime" />
  <img src="https://img.shields.io/badge/license-MIT-0f7ae5" alt="MIT license" />
</p>

<p align="center">
  <a href="https://www.holaboss.ai/?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_nav_website">Website</a> ·
  <a href="https://www.holaboss.ai/docs?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_nav_docs">Docs</a> ·
  <a href="https://www.holaboss.ai/signin?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_nav_signin">Sign in</a> ·
  <a href="#getting-started">Getting Started</a>
</p>

Holaboss enables you to build AI workspaces that go beyond one-off task execution. Each workspace packages instructions, tools, apps, memory, and runtime state for sustained long-horizon operation. You can manage multiple workspaces in parallel, and because workspaces and workspace templates are portable, they can be packaged, shared, resumed, and reused across the Holaboss ecosystem.



## Marketplace Experience

<p align="center">
  <a href="https://www.holaboss.ai/?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_marketplace_image">
    <img src="docs/images/marketplace.png" alt="Holaboss marketplace screenshot" width="1280" />
  </a>
</p>

## Desktop Workspace

<p align="center">
  <img src="docs/images/desktop-workspace.png" alt="Holaboss desktop workspace screenshot" width="1280" />
</p>

## Star the Repository

<p align="center">
  <img src="docs/images/star-the-repo.gif" alt="Animated preview from the Holaboss star-the-repo video" width="1280" />
</p>

<p align="center"><strong>If Holaboss is useful or interesting, a GitHub Star would be greatly appreciated.</strong></p>

## Table of Contents

- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [One-Line Agent Setup](#one-line-agent-setup)
  - [Quick install](#quick-install)
  - [Quick start](#quick-start)
- [Documentation](#documentation)
- [OSS Release Notes](#oss-release-notes)

## Getting Started

### Prerequisites

- Node.js 22+
- npm

### One-Line Agent Setup

If you use Codex, Claude Code, Cursor, Windsurf, or another coding agent, you can hand it the setup instructions in one sentence:

```text
Clone the Holaboss repo from https://github.com/holaboss-ai/holaboss-ai.git if needed, or use the current checkout if it is already open, then follow INSTALL.md exactly to bootstrap local desktop development. If the environment cannot open Electron, stop after verification and tell me the next manual step.
```

That prompt is meant for coding agents. It stays self-contained by naming the repo and clone URL, while leaving the actual installation details in the repo-local `INSTALL.md` runbook.

### Quick install

For a fresh-machine bootstrap on macOS, Linux, or WSL, you can let the repository clone and verify itself:

```bash
curl -fsSL https://raw.githubusercontent.com/holaboss-ai/holaboss-ai/main/scripts/install.sh | bash
```

That installer:

- clones the repository into `~/holaboss-ai` by default
- creates `desktop/.env` from `desktop/.env.example` if needed
- runs `npm run desktop:install`
- runs `npm run desktop:typecheck`

If you want the installer to continue directly into the desktop dev environment after verification:

```bash
curl -fsSL https://raw.githubusercontent.com/holaboss-ai/holaboss-ai/main/scripts/install.sh | bash -s -- --launch
```

### Quick start

This is the baseline installation flow for local desktop development.

Install the desktop dependencies:

```bash
npm run desktop:install
```

Copy the desktop env template and fill in the required values:

```bash
cp desktop/.env.example desktop/.env
```

If you want to verify the desktop code before launching the app, run:

```bash
npm run desktop:typecheck
```

Run the desktop app in development:

```bash
npm run desktop:dev
```

`npm run desktop:dev` already runs the desktop `predev` hook for you. That hook validates the dev environment, rebuilds native modules, and ensures a staged runtime bundle exists under `desktop/out/runtime-<platform>`. If the bundle is missing or older than your local runtime sources, it automatically runs `npm run desktop:prepare-runtime:local`.

If you want to stage the local runtime bundle from this repo explicitly ahead of time, you can still run:

```bash
npm run desktop:prepare-runtime:local
```

If you want to stage the latest released runtime bundle for your current host platform instead of rebuilding from local runtime sources:

```bash
npm run desktop:prepare-runtime
```

`desktop:prepare-runtime` pulls the latest published runtime bundle for the current platform from GitHub Releases and stages it into `desktop/out/runtime-<platform>`. `desktop:prepare-runtime:local` builds the runtime from your local source checkout and then stages that local bundle into the same location.

## Documentation

All deeper technical and product documentation lives at **[holaboss.ai/docs](https://www.holaboss.ai/docs/)**:

| Section | What's Covered |
| --- | --- |
| [holaOS Overview](https://www.holaboss.ai/docs/holaos/overview) | The technical foundation underneath Holaboss Desktop |
| [Environment Engineering](https://www.holaboss.ai/docs/holaos/environment-engineering) | The core thesis behind holaOS and why the environment defines the system |
| [Getting Started](https://www.holaboss.ai/docs/getting-started) | Technical onboarding and the docs entry path |
| [Desktop Quickstart](https://www.holaboss.ai/docs/desktop/quickstart) | Local desktop setup, runtime staging, and running the operator shell |
| [Workspace Model](https://www.holaboss.ai/docs/runtime/workspace-model) | Workspace contract, runtime-owned state, and filesystem layout |
| [Memory and Continuity](https://www.holaboss.ai/docs/runtime/memory-and-continuity) | Durable memory, recall, continuity writeback, and evolve |
| [Build Your First App](https://www.holaboss.ai/docs/app-development/first-app) | Building workspace apps on top of holaOS |
| [Model Configuration](https://www.holaboss.ai/docs/desktop/model-configuration) | Providers, defaults, config precedence, and runtime model selection |
| [Independent Deploy](https://www.holaboss.ai/docs/runtime/independent-deploy) | Running the portable runtime without the desktop app |
| [Technical Details](https://www.holaboss.ai/docs/reference/technical-details) | Repo layout, common commands, and development notes |
| [Desktop Packaging](https://www.holaboss.ai/docs/desktop/packaging) | macOS DMG build, signing, notarization, and validation |
| [Reference](https://www.holaboss.ai/docs/reference/environment-variables) | Environment variables, workspace files, and supporting reference material |

## OSS Release Notes

- License: MIT. See [LICENSE](LICENSE).
- Security issues: report privately to `admin@holaboss.ai`. See [SECURITY.md](SECURITY.md).
- macOS packaging and notarization flows are documented in [Desktop Packaging](https://www.holaboss.ai/docs/desktop/packaging).
