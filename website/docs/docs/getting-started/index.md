# Quick Start

Quick Start is the shortest path to a working local Holaboss Desktop environment powered by ```holaOS```. Use the one-line repository installer on a fresh machine, or follow the manual path if you want to control each setup step yourself.

After the desktop boots, first-workspace creation can start from an empty workspace, a local template, or a marketplace template depending on the flow you choose in the app.

## One-line Install

For a fresh-machine bootstrap on macOS, Linux, or WSL, use the repository installer and continue directly into the desktop dev environment after verification:

```bash
curl -fsSL https://raw.githubusercontent.com/holaboss-ai/holaOS/main/scripts/install.sh | bash -s -- --launch
```

That installer:

- installs missing `git` and Node.js `22` / `npm` when needed
- clones the repository into `~/holaOS` by default
- creates `desktop/.env` from `desktop/.env.example` if needed
- runs `npm run desktop:install`
- runs `npm run desktop:prepare-runtime:local`
- runs `npm run desktop:typecheck`
- runs `npm run desktop:dev` when `--launch` is passed

On Linux, the prerequisite install path may use your system package manager and `sudo`. On macOS, it may use Homebrew if `git` is missing.

## Manual Install

### What you need

If you are using the manual path, make sure the machine has:

- `git`
- `node` version `22` or newer
- `npm`

You can verify that quickly with:

```bash
git --version
node --version
npm --version
```

### One-line agent setup

If you are using Codex, Claude Code, Cursor, Windsurf, or another coding agent, you can hand it the setup instructions in one sentence:

```text
Clone the holaOS repo from https://github.com/holaboss-ai/holaOS.git if needed, or use the current checkout if it is already open, then follow INSTALL.md exactly to bootstrap local desktop development. If the environment cannot open Electron, stop after verification and tell me the next manual step.
```

That handoff keeps the installation flow self-contained while leaving the detailed bootstrap steps in the repo-local `INSTALL.md` runbook.

This is the baseline installation flow for local desktop development.

<DocSteps>
  <DocStep title="Clone the repository">
Clone the holaOS repository and move into the project root:

```bash
git clone https://github.com/holaboss-ai/holaOS.git
cd holaOS
```
  </DocStep>

  <DocStep title="Install the desktop dependencies">
From the repository root, install the desktop workspace dependencies:

```bash
npm run desktop:install
```
  </DocStep>

  <DocStep title="Create your local environment file">
Copy the desktop environment template and fill in any values your setup requires:

```bash
cp desktop/.env.example desktop/.env
```

If you are following the repo exactly, keep the file close to the template and only change the values that your provider or machine needs.

The minimum value that makes `npm run desktop:dev` pass its preflight is a remote base URL such as `HOLABOSS_BACKEND_BASE_URL` or `HOLABOSS_PROACTIVE_URL`. The checked-in `desktop/.env.example` already includes `HOLABOSS_BACKEND_BASE_URL`, so copying that file is enough for the default local path.
  </DocStep>

  <DocStep title="Prepare the local runtime bundle">
Stage the local runtime bundle before launching Electron:

```bash
npm run desktop:prepare-runtime:local
```

Use this local path when you are developing against the current OSS runtime code.
  </DocStep>

  <DocStep title="Check the desktop build before launching">
If you want a quick validation pass before starting Electron, run the desktop typecheck:

```bash
npm run desktop:typecheck
```
  </DocStep>

  <DocStep title="Start the desktop app">
Launch the desktop experience in development mode:

```bash
npm run desktop:dev
```

The `predev` hook will validate the environment, rebuild native modules, and make sure a staged runtime bundle exists.

If you are driving setup through a coding agent or on a headless machine, stop after verification instead of opening Electron. `desktop:dev` is a headed interactive flow.
  </DocStep>
</DocSteps>

If you want to verify the desktop against the latest published runtime bundle instead of the local runtime code, use:

```bash
npm run desktop:prepare-runtime
```

Use `desktop:prepare-runtime:local` for active runtime development. Use `desktop:prepare-runtime` when you want to test against the published bundle path.

## Read next

<DocCards>
  <DocCard
    title="Learning Path"
    eyebrow="System Model"
    href="/getting-started/learning-path"
    description="Understand the environment, workspace, runtime, and harness model before changing internals."
  />
  <DocCard
    title="Start Developing"
    eyebrow="Local Developer Loop"
    href="/build-on-holaos/start-developing/"
    description="Move from bootstrap into the real desktop and runtime development loop used in this repo."
  />
  <DocCard
    title="Build on holaOS"
    eyebrow="Developer Map"
    href="/build-on-holaos/"
    description="Choose the right entrypoint for runtime work, app development, or template authoring."
  />
</DocCards>
