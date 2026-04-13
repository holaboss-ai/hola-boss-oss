# holaOS - The Agent Envionrment Built for Long-Horizon Work and Self-Evolution

<p align="center">
  <img src="desktop/public/logo.svg" alt="Holaboss logo" width="132" />
</p>

<p align="center"><strong>The agent environment for long-horizon work, continuity, and self-evolution.</strong></p>

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
  <a href="#quick-start">Quick Start</a>
</p>

holaOS is the agent environment for long-horizon work. It gives agents a structured operating system made of runtime, memory, tools, apps, and durable state so they can work continuously, evolve over time, and stay inspectable across runs instead of resetting back to one-off task execution.


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

- [Quick Start](#quick-start)
    - [What you need](#what-you-need)
    - [One-Line Install](#one-line-install)
- [Documentation](#documentation)
- [Manual Install](#manual-install)
    - [One-Line Agent Setup](#one-line-agent-setup)
- [Contributing](#contributing)
- [OSS Release Notes](#oss-release-notes)

## Quick Start

Quick Start is the shortest path to a working local Holaboss Desktop environment powered by `holaOS`. Use the one-line repository installer on a fresh machine, or follow the manual path if you want to control each setup step yourself.

### What you need

- `curl`
- `bash`
- macOS, Linux, or WSL

The installer bootstraps `git`, Node.js `22`, and `npm` if they are missing. On Linux it may use `sudo` to install `git`.


### One-Line Install

For a fresh-machine bootstrap on macOS, Linux, or WSL, use the repository installer:

```bash
curl -fsSL https://raw.githubusercontent.com/holaboss-ai/holaboss-ai/main/scripts/install.sh | bash -s -- --launch
```

That installer:

- installs `git` if it is missing
- installs Node.js `22` plus `npm` if they are missing
- clones the repository into `~/holaboss-ai` by default
- creates `desktop/.env` from `desktop/.env.example` if needed
- runs `npm run desktop:install`
- runs `npm run desktop:prepare-runtime:local`
- runs `npm run desktop:typecheck`
- only runs `npm run desktop:dev` when you pass `--launch`

## Documentation

All deeper technical and product documentation lives at **[holaboss.ai/docs](https://www.holaboss.ai/docs/)**:

| Section | What's Covered |
| --- | --- |
| [Overview](https://www.holaboss.ai/docs/) | The merged entry page for the environment-engineering thesis and system model |
| [Quick Start](https://www.holaboss.ai/docs/getting-started/) | The fastest path to a working local desktop environment |
| [Learning Path](https://www.holaboss.ai/docs/getting-started/learning-path) | The technical path through the docs after setup |
| [Environment Engineering](https://www.holaboss.ai/docs/holaos/environment-engineering) | The core thesis behind holaOS and why the environment defines the system |
| [Concepts](https://www.holaboss.ai/docs/holaos/concepts) | Core system vocabulary for workspaces, runtime, memory, and outputs |
| [Workspace Model](https://www.holaboss.ai/docs/holaos/workspace-model) | Workspace contract, authored surfaces, and runtime-owned state |
| [Memory and Continuity](https://www.holaboss.ai/docs/holaos/memory-and-continuity/) | Durable memory, continuity artifacts, and long-horizon resume behavior |
| [Start Developing](https://www.holaboss.ai/docs/build-on-holaos/start-developing/) | The local developer path for desktop and runtime validation |
| [Contributing](https://www.holaboss.ai/docs/build-on-holaos/start-developing/contributing) | The contributor workflow, validation expectations, and review guidance |
| [Runtime APIs](https://www.holaboss.ai/docs/build-on-holaos/runtime-apis) | The runtime operational surface for workspaces, runs, and app lifecycle |
| [Independent Deploy](https://www.holaboss.ai/docs/build-on-holaos/independent-deploy) | Running the portable runtime without the desktop app |
| [Agent Harness](https://www.holaboss.ai/docs/holaos/agent-harness/) | The stable harness boundary inside the runtime and how executors fit into it |
| [Build Your First App](https://www.holaboss.ai/docs/app-development/applications/first-app) | Building workspace apps on top of holaOS |
| [Troubleshooting](https://www.holaboss.ai/docs/build-on-holaos/troubleshooting) | The common local runtime and desktop failure modes |
| [Workspace Experience](https://www.holaboss.ai/docs/desktop/workspace-experience) | The desktop workspace surface built on top of holaOS |
| [Model Configuration](https://www.holaboss.ai/docs/desktop/model-configuration) | Providers, defaults, config precedence, and runtime model selection |
| [Reference](https://www.holaboss.ai/docs/reference/environment-variables) | Environment variables and supporting reference material |

## Manual Install

You really shouldn't need this as the one line install is doing the exact same thing. But oh well it's here in case you need it. If you are using the manual path instead, you can verify the usual prerequisites with:

```bash
git --version
node --version
npm --version
```

### One-Line Agent Setup

If you use Codex, Claude Code, Cursor, Windsurf, or another coding agent, you can hand it the setup instructions in one sentence:

```text
Run the Holaboss install script from https://raw.githubusercontent.com/holaboss-ai/holaboss-ai/main/scripts/install.sh. It should install git and Node.js 22/npm if they are missing, clone or update the repo into ~/holaboss-ai unless I specify another --dir, run desktop:install, create desktop/.env from desktop/.env.example if needed, run desktop:prepare-runtime:local and desktop:typecheck, and only run desktop:dev if I ask for --launch. If Electron cannot open, stop after verification and tell me the next manual step.
```

That handoff keeps the installation flow self-contained while leaving the detailed bootstrap steps in the repo-local [INSTALL.md](INSTALL.md) runbook.

This is the baseline installation flow for local desktop development.

1. Install the desktop dependencies from the repository root:

```bash
npm run desktop:install
```

2. Create your local environment file:

```bash
cp desktop/.env.example desktop/.env
```

If you are following the repo exactly, keep the file close to the template and only change the values that your provider or machine needs.

3. Prepare the local runtime bundle:

```bash
npm run desktop:prepare-runtime:local
```

4. If you want a quick validation pass before launching Electron, run:

```bash
npm run desktop:typecheck
```

5. Start the desktop app in development mode:

```bash
npm run desktop:dev
```

The `predev` hook will validate the environment, rebuild native modules, and make sure a staged runtime bundle exists.

If you want to stage the runtime before opening the desktop app, there are two common paths:

Build from local runtime:

```bash
npm run desktop:prepare-runtime:local
```

Fetch the latest published runtime:

```bash
npm run desktop:prepare-runtime
```

Use the local path when you are actively changing runtime code. Use the published bundle when you want to verify the desktop against a known release artifact.

Use `One-Line Install` when you want the fastest path to a working local desktop environment. Use `Manual Install` when you need to inspect or control each setup step yourself.

## Contributing

To learn more about how to contribute and how the system is structured, review [Contributing](https://www.holaboss.ai/docs/build-on-holaos/start-developing/contributing). It is the canonical page for the contributor workflow and the build-on-holaOS development path.

## OSS Release Notes

- License: MIT. See [LICENSE](LICENSE).
- Security issues: report privately to `admin@holaboss.ai`. See [SECURITY.md](SECURITY.md).
