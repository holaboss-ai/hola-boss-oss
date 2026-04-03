# Holaboss - AI Worker Desktop for Business

<p align="center">
  <img src="desktop/public/logo.svg" alt="Holaboss logo" width="132" />
</p>

<p align="center"><strong>Build, run, and package AI workers with a desktop workspace and portable runtime.</strong></p>

<p align="center">
  <a href="https://github.com/holaboss-ai/hola-boss-oss/actions/workflows/oss-ci.yml"><img src="https://github.com/holaboss-ai/hola-boss-oss/actions/workflows/oss-ci.yml/badge.svg" alt="OSS CI" /></a>
  <img src="https://img.shields.io/badge/node-22%2B-43853d" alt="Node 22+" />
  <img src="https://img.shields.io/badge/platform-macOS%20supported,%20Windows%20%26%20Linux%20in%20progress-f28c28" alt="macOS supported, Windows and Linux in progress" />
  <img src="https://img.shields.io/badge/desktop-Electron-47848f" alt="Electron desktop" />
  <img src="https://img.shields.io/badge/runtime-TypeScript-3178c6" alt="TypeScript runtime" />
  <img src="https://img.shields.io/badge/license-MIT-0f7ae5" alt="MIT license" />
</p>

<p align="center">
  <a href="https://holaboss.ai/?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_nav_website">Website</a> ·
  <a href="https://docs.holaboss.ai/?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_nav_docs">Docs</a> ·
  <a href="https://app.holaboss.ai/signin?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_nav_signin">Sign in</a> ·
  <a href="#getting-started">Getting Started</a>
</p>

Holaboss enables you to build AI workers that go beyond one-off task execution—they operate continuously, taking initiative to drive real business outcomes. You can easily manage and coordinate multiple AI workers, each with its own dedicated workspace tailored to specific roles and responsibilities. These work environments are fully portable, meaning the AI workers you train—along with their context, tools, and skills—can be packaged and shared with others, unlocking true scalability and collaboration.

## Marketplace Experience

<p align="center">
  <a href="https://holaboss.ai/?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_marketplace_image">
    <img src="docs/images/marketplace.png" alt="Holaboss marketplace screenshot" width="1280" />
  </a>
</p>

## Desktop Workspace

<p align="center">
  <img src="docs/images/desktop-workspace.png" alt="Holaboss desktop workspace screenshot" width="1280" />
</p>

## Table of Contents

- [Marketplace Experience](#marketplace-experience)
- [Desktop Workspace](#desktop-workspace)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [One-Line Agent Setup](#one-line-agent-setup)
  - [Quick start](#quick-start)
- [Architecture Overview](#architecture-overview)
  - [Execution And Continuity](#execution-and-continuity)
  - [Current Workspace Structure](#current-workspace-structure)
  - [Memory](#memory)
- [AI Labour Market](#ai-labour-market)
- [Capability Hub](#capability-hub)
  - [Apps and Integrations](#apps-and-integrations)
  - [Skills and MCP](#skills-and-mcp)
- [Hosted Features](#hosted-features)
  - [What works in OSS](#what-works-in-oss)
  - [What may require Holaboss backend access](#what-may-require-holaboss-backend-access)
- [Technical Details](#technical-details)
  - [Repository layout](#repository-layout)
  - [Common commands](#common-commands)
  - [Development notes](#development-notes)
- [Model Configuration](#model-configuration)
- [Independent Runtime Deploy](#independent-runtime-deploy)
  - [Linux](#linux)
  - [macOS](#macos)
  - [Notes](#notes)
- [OSS Release Notes](#oss-release-notes)
- [macOS DMG Bundling](#macos-dmg-bundling)
  - [Local DMG For Testing (Ad-Hoc Signed, Not Notarized)](#local-dmg-for-testing-ad-hoc-signed-not-notarized)
  - [Local Production Signing And Notarization (Mac)](#local-production-signing-and-notarization-mac)
  - [Signed And Notarized Product DMG (GitHub Actions)](#signed-and-notarized-product-dmg-github-actions)
  - [Validate A Signed Build](#validate-a-signed-build)

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

## Architecture Overview

Holaboss is split into three cooperating layers:

- `desktop/` provides the operator UI, workspace management, and the local packaged-runtime experience
- `runtime/` owns agent execution, queueing, harness integration, apps, MCP orchestration, runtime APIs, and durable state
- the sandbox root stores the live workspace tree, runtime state, request artifacts, and memory bodies used by the runtime

Those layers are intentionally separated by authority:

- human-authored workspace policy lives in files like `AGENTS.md`, `workspace.yaml`, skills, and app manifests
- runtime-owned execution truth lives in `state/runtime.db` plus streamed output events
- runtime-owned operator profile data lives in `state/runtime.db`
- durable memory bodies live under `memory/`, while their governance and recall metadata live in `state/runtime.db`

Two runtime control surfaces also stay explicit rather than being flattened away:

- capability evaluation is a pipeline from static registry, to model-visible projection, to permission, to execution readiness; the current runtime only exposes callable tools today, but the typed registry already reserves future non-tool surfaces such as MCP resources, MCP prompt or command surfaces, and trust-sensitive plugin or local capabilities
- prompt assembly is section-based and channel-aware; the runtime keeps explicit section ids, precedence bands, volatility, and channel metadata, then renders compatibility outputs back to `system_prompt` and ordered `context_messages` for the active harness

At a high level, one run follows this path:

1. the desktop or API queues work for a workspace session
2. the runtime resolves the workspace plan, capability surface, prompt sections, and request snapshot
   - prompt sections keep base runtime doctrine, session policy, capability policy, workspace policy, and runtime continuity context distinct even when the harness ultimately receives only `system_prompt` plus `context_messages`
3. the selected harness executes the run and streams output events
4. the runtime persists normalized turn artifacts, updates compaction continuity, writes session/runtime memory projections, and performs durable memory writeback
5. future runs restore continuity from durable runtime artifacts first (including the session-memory projection), then add a small recalled durable-memory context selected from markdown memory manifests

### Execution And Continuity

The runtime keeps four different kinds of state on purpose:

- raw streamed events for replay and live UI updates
- normalized turn artifacts for querying, debugging, and continuity
- runtime-owned operator profile state for canonical user identity
- markdown memory projections for human-readable runtime state and durable recalled knowledge

The most important runtime continuity artifacts are:

- `turn_results`
  - one normalized record per run with status, stop reason, token usage, prompt-section ids, request fingerprint, capability fingerprint, and assistant output
- compaction boundaries
  - durable handoff artifacts that summarize a run boundary, record recent runtime context, preserve selected turn ids, and define explicit restoration ordering
- session-memory projections
  - per-session markdown continuity snapshots under `memory/workspace/<workspace-id>/runtime/session-memory/` used for fast resume context in later runs
- request snapshots
  - sanitized exact request-state artifacts used for replay, debugging, and future cache diagnostics
- runtime user profile
  - canonical operator identity fields such as the persisted display name used by the runtime and agent prompt context

This split avoids overloading transcript history with too many jobs. Raw history is still the replay truth, but resume, compaction, and memory promotion work from durable higher-level artifacts rather than repeatedly scraping prior messages.

### Current Workspace Structure

Holaboss workspaces live under the runtime sandbox root. In the desktop app, that root is the local `sandbox-host` data directory; in standalone runtime deploys it defaults to `/holaboss`.

```text
<sandbox-root>/
  state/
    runtime-config.json
    runtime.db

  workspace/
    .holaboss/
      workspace-mcp-sidecar-state.json
      <server>.workspace-mcp-sidecar.stdout.log
      <server>.workspace-mcp-sidecar.stderr.log

    <workspace-id>/
      .git/
      AGENTS.md
      workspace.yaml
      ONBOARD.md
      skills/
        <skill-id>/
          SKILL.md
      apps/
        <app-id>/
          app.runtime.yaml
      .holaboss/
        workspace_id
        harness-session-state.json
        input-attachments/<batch-id>/*
        pi-agent/auth.json
        pi-agent/models.json
        pi-sessions/...
      ...

  memory/
    MEMORY.md
    workspace/
      <workspace-id>/
        MEMORY.md
        runtime/
          latest-turn.md
          session-state/
          session-memory/
          recent-turns/
          blockers/
          permission-blockers/
        knowledge/
          facts/
          procedures/
          blockers/
          references/
    preference/
      MEMORY.md
      *.md
```

- `workspace.yaml` is the root runtime plan for the workspace. It defines the single active agent, skill enablement/order, MCP registry, and any installed workspace apps.
- `AGENTS.md` is the root prompt file. Workspace instructions are expected there rather than inline in `workspace.yaml`.
- each new workspace is initialized as a local git repository after its scaffold or template is materialized. That repository is intended for agent-owned local version control checkpoints rather than remote sync.
- `skills/` is the fixed workspace-local skill directory. Workspace skills are always discovered from `<workspace-root>/skills`, and each skill directory must contain `SKILL.md`.
- `apps/` contains workspace-local apps. Each installed app lives under `apps/<app-id>/` and must provide `app.runtime.yaml`.
- `<workspace-id>/.holaboss/` stores runtime-managed workspace state such as the identity marker, persisted harness session mapping, staged input attachments, and Pi harness state.
- `workspace/.holaboss/` is separate from the per-workspace `.holaboss/` directory. It stores shared workspace-root state for MCP sidecars and their logs.
- `state/runtime.db` is the durable runtime registry for workspaces, sessions, bindings, queue state, turn results, compaction boundaries, request snapshots, and durable memory catalog metadata. The `workspace_id` file exists mainly as an on-disk identity marker for workspace discovery and migration.
- `memory/` is sandbox-global, not inside a single workspace directory. It stores workspace-scoped and user-scoped markdown memory files used by the runtime memory service.

### Memory

The memory system is intentionally split by purpose and by authority. Human-authored workspace instructions stay in `AGENTS.md`, runtime-owned continuity stays in `state/runtime.db`, and durable memory bodies stay in markdown under `memory/`.

#### Memory Layers

Holaboss currently has four memory layers:

- session continuity lives in runtime-owned artifacts such as `turn_results` and compaction boundaries in `state/runtime.db`
- session-memory continuity projections live under `memory/workspace/<workspace-id>/runtime/session-memory/`
- operational projections live under `memory/workspace/<workspace-id>/runtime/`
- durable recalled memory lives under `memory/workspace/<workspace-id>/knowledge/` and `memory/preference/`

Alongside those layers, the runtime also keeps a canonical operator profile in `state/runtime.db`. That profile is not treated as markdown memory. It is runtime-owned identity state used first for things like the current user's name, with auth-provided identity only acting as a non-destructive fallback when the local profile is empty.

The runtime also keeps pending user-memory proposals in `state/runtime.db`. These are input-scoped candidates such as inferred user preferences. They can shape the current run ephemerally, but they are not promoted into durable memory or into the canonical runtime profile until the user explicitly accepts them.

That means short-horizon execution state, canonical operator identity, and long-lived recalled memory are not mixed together.

Compaction boundaries are the durable handoff point for session continuity. Each boundary stores a compact summary, recent runtime context, preserved turn ids, and explicit restoration ordering so later runs can rebuild continuity from durable artifacts before falling back to broader transcript history.

`runtime/` memory files are volatile operational snapshots. They describe the latest turn, recent turns, active blockers, and permission blockers. They are useful for inspection and debugging, but they are not treated as durable knowledge.

`knowledge/` and `preference/` are the durable memory surfaces. These files are indexed by `MEMORY.md` files:

- `memory/MEMORY.md` is the root durable-memory index
- `memory/workspace/<workspace-id>/MEMORY.md` indexes durable workspace knowledge
- `memory/preference/MEMORY.md` indexes durable user preference memory

Runtime files are intentionally excluded from the `MEMORY.md` indexes. The runtime recalls durable memory from the indexed knowledge and preference files, while resume or compaction context comes from runtime-owned session artifacts instead of from markdown memory alone.

#### Source Of Truth

The source-of-truth boundary is deliberate:

- runtime execution truth lives in `state/runtime.db`
- canonical operator profile data lives in `state/runtime.db`
- durable memory content lives in markdown under `memory/`
- durable memory metadata and governance live in the runtime catalog in `state/runtime.db`

In practice, that means:

- `turn_results`, compaction boundaries, request snapshots, and the runtime user profile are runtime-owned canonical artifacts
- markdown memory files are the canonical readable bodies for durable memory
- the durable memory catalog controls recall, freshness, and verification policy

Holaboss does not auto-write runtime state into `AGENTS.md`. `AGENTS.md` stays as the workspace's canonical human-authored instruction surface.

#### Memory Lifecycle

The current memory lifecycle is:

1. User input is queued, and strong-signal user-scoped proposals can be captured into runtime-owned pending proposal records in `state/runtime.db`.
2. The current run can use those pending proposals as ephemeral prompt context without treating them as durable memory yet.
3. A run finishes and the runtime persists `turn_results`.
4. Post-turn writeback updates the current compaction boundary and records ordered restoration inputs for later resume.
5. Post-turn writeback generates volatile runtime projections under `memory/workspace/<workspace-id>/runtime/`, including `session-memory/`.
6. Model-assisted durable extraction attempts to promote selected workspace-scoped items into `knowledge/` using recent turn context.
7. Deterministic durable extraction remains as a fallback safety path when model extraction is unavailable or sparse.
8. Accepted user-scoped proposals are promoted into durable preference memory or into the canonical runtime profile, depending on what they target.
9. `MEMORY.md` indexes are refreshed for durable memory only.
10. Future runs restore session continuity from the latest compaction boundary first, then enrich continuity with the current session-memory snapshot.
11. Future runs recall a small durable subset from markdown memory manifests (model-selected when available, deterministic fallback otherwise) and inject it as prompt context.

This keeps replay, inspection, and durable recall separate instead of overloading one mechanism for all three jobs.

#### Current Durable Memory Types

The durable memory catalog currently supports these memory classes:

- `preference`
  - example: response style such as concise vs detailed
- `identity`
  - reserved for durable identity facts beyond the canonical runtime profile, such as role, signing identity, or other reusable identity context
- `fact`
  - examples: workspace command facts such as which command to use for verification, or business facts such as meeting cadence and approval rules
- `procedure`
  - examples: numbered release or onboarding steps, or business workflows such as follow-up, reporting, handoff, escalation, and review processes
- `blocker`
  - example: recurring permission blockers that appear across multiple turns
- `reference`
  - reserved for durable references that should usually be reconfirmed before use

Current writeback is intentionally conservative. The runtime only promotes facts and procedures that are explicit enough to survive beyond a single turn, and it keeps transient runtime state out of durable knowledge.

User-scoped inferred preferences and other behavioral updates now flow through the pending proposal lane first. Workspace facts and procedures can still be persisted automatically, but user-scoped changes that affect future behavior are designed to wait for explicit confirmation before promotion.

#### Recall And Governance

Durable recall is governed separately from storage:

- every durable memory entry carries a scope, type, verification policy, and staleness policy
- every durable memory entry also carries provenance metadata such as source type, observation time, verification time, and confidence
- recall prefers user preferences first, then query-matched workspace procedures, facts, blockers, and references
- stale references are penalized more aggressively than stable or workspace-sensitive memories
- recalled durable memory is injected as context, not merged into the base system prompt

Recall selection is manifest-based at query time. The runtime scans durable markdown memory files, reads frontmatter and compact summaries, and builds a bounded manifest. A model selector can choose a small relevant subset from that manifest; if model selection is unavailable, the runtime falls back to deterministic keyword-and-metadata ranking. Recalled entries include a compact selection trace and optional excerpt snippets for debugging and operator visibility. Retrieval stays separate from storage so alternate indexes can be added later without changing canonical markdown memory files.

#### What Lives Where

Use these rules of thumb when reasoning about the system:

- `AGENTS.md`
  - human-authored workspace policy and operating instructions
- `state/runtime.db`
  - execution truth, session continuity, canonical runtime profile, memory catalog metadata
- `memory/workspace/<workspace-id>/runtime/`
  - volatile runtime projections for inspection and debugging
- `memory/workspace/<workspace-id>/runtime/session-memory/`
  - session-scoped continuity snapshots consumed during resume/compaction restoration
- `memory/workspace/<workspace-id>/knowledge/`
  - durable workspace memory that may be recalled in later runs
- `memory/preference/`
  - durable user preference memory

If a piece of information is only needed to resume the latest session, it belongs in runtime continuity. If it is the canonical current-user identity used by the runtime, it belongs in the runtime profile. If it should be recalled later without replaying the full session, it belongs in durable memory. If it is a standing workspace rule, it belongs in `AGENTS.md`.

## AI Labour Market

The richer labour-market and marketplace experience lives in the Holaboss product after login, but the OSS desktop already includes a browsable kit gallery and local fallback templates so you can understand the model.

| Worker | Description |
| --- | --- |
| Social Operator | AI social media content creation and scheduling across X, LinkedIn, and Reddit. |
| Gmail Assistant | Minimal Gmail workspace for inbox search, thread reading, and draft creation via MCP. |
| Build in Public | Turns GitHub activity into social posts automatically. |
| Starter Workspace | A minimal blank canvas for building your own workflows from scratch. |

<p align="center"><strong>Ready to publish your worker or explore the hosted marketplace?</strong></p>

<p align="center">
  <a href="https://app.holaboss.ai/signin?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_publish_badge"><img src="https://img.shields.io/badge/Open%20Holaboss-Sign%20in%20to%20publish%20or%20browse-e08a6b?style=for-the-badge" alt="Open Holaboss: sign in to publish or browse" /></a>
</p>

## Capability Hub

### Apps and Integrations

- Workspace apps can be installed, started, stopped, set up, and kept running through the runtime API.
- Integration endpoints cover catalog browsing, connections, bindings, OAuth flows, and broker proxy/token helpers.
- Browser capability endpoints let workers operate on a browser surface when that capability is enabled.

### Skills and MCP

- Workspace skills are staged from workspace directories and merged with embedded runtime skills.
- Workspace and app MCP servers can be prepared and exposed to agent runs through sidecars and resolved tool references.
- Runtime tools already expose onboarding and cronjob helpers to the agent layer.

## Hosted Features

Signing in adds the hosted Holaboss layer on top of the OSS foundation. That includes product-authenticated marketplace templates, remote control-plane services, richer integration flows, and backend-connected collaboration surfaces.

If you only want the open-source local workflow, you can ignore those services and stay on the baseline desktop + runtime path above.

### What works in OSS

- local desktop development
- local runtime packaging
- local workspace and runtime flows
- local typechecking and runtime tests
- local model/provider overrides through `runtime-config.json` or environment variables

### What may require Holaboss backend access

- hosted sign-in flows
- authenticated marketplace template materialization
- auth-backed product features
- backend-connected Holaboss services

## Technical Details

### Repository layout

- `desktop/` - Electron desktop app
- `runtime/api-server/` - Fastify runtime API server
- `runtime/harness-host/` - harness host for agent and tool execution
- `runtime/state-store/` - SQLite-backed runtime state store
- `runtime/harnesses/` - harness packaging scaffold
- `.github/workflows/` - release and publishing workflows

### Common commands

Run the desktop typecheck:

```bash
npm run desktop:typecheck
```

Run runtime tests:

```bash
npm run runtime:test
```

On a fresh clone, prepare the runtime packages first:

```bash
npm run runtime:state-store:install
npm run runtime:state-store:build
npm run runtime:harness-host:install
npm run runtime:harness-host:build
npm run runtime:api-server:install
npm run runtime:test
```

Run desktop end-to-end tests:

```bash
npm run desktop:e2e
```

Build a local macOS desktop bundle with the locally built runtime embedded:

```bash
npm run desktop:dist:mac:local
```

Stage the latest released runtime bundle for your current host platform:

```bash
npm run desktop:prepare-runtime
```

### Development notes

The root `package.json` is a thin command wrapper for the desktop app. The actual desktop project still lives in `desktop/package.json`.

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
npm run runtime:state-store:install
npm run runtime:state-store:build
npm run runtime:harness-host:install
npm run runtime:harness-host:build
npm run runtime:api-server:install
npm run runtime:test
```

## Model Configuration

The app ships with a default model setup. In most cases, you do not need to edit `runtime-config.json` by hand.

- default model: `openai/gpt-5.4`
- default provider id for unprefixed models: `openai`

### In-App Setup

Holaboss already provides model configuration in the desktop app.

- Open `Settings` -> `Model Providers`.
- Connect a provider such as OpenAI, Anthropic, OpenRouter, Gemini, or Ollama.
- Enter your API key and use the built-in provider defaults or edit the model list for that provider.
- Changes autosave to `runtime-config.json`, and the chat model picker will use the configured provider models.

### Customization Mode

#### Provider Configurations

You can route the runtime directly to a provider endpoint (for example OpenAI) without a model-proxy rewriter.

- set `model_proxy_base_url` to the provider API base, for example `https://api.openai.com/v1`
- set `auth_token` to your provider API key
- set `default_model`, for example `openai/gpt-5.4` or `anthropic/claude-sonnet-4-20250514`

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
  - default model selection, for example `openai/gpt-5.4`
- `HOLABOSS_DEFAULT_MODEL`
  - environment override for `default_model`
- `SANDBOX_AGENT_DEFAULT_MODEL`
  - fallback env if `HOLABOSS_DEFAULT_MODEL` is not set

### Model String Format

Use provider-prefixed model ids when you want to be explicit:

- `openai/gpt-5.4`
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
    },
    "ollama_direct": {
      "kind": "openai_compatible",
      "base_url": "http://localhost:11434/v1",
      "api_key": "ollama"
    }
  },
  "models": {
    "holaboss/gpt-5.2": { "provider": "holaboss", "model": "gpt-5.2" },
    "holaboss/gpt-5-mini": { "provider": "holaboss", "model": "gpt-5-mini" },
    "holaboss/gpt-4.1-mini": { "provider": "holaboss", "model": "gpt-4.1-mini" },
    "holaboss/claude-sonnet-4-5": { "provider": "holaboss", "model": "claude-sonnet-4-5" },
    "holaboss/claude-opus-4-1": { "provider": "holaboss", "model": "claude-opus-4-1" },
    "openai_direct/gpt-5.2": { "provider": "openai_direct", "model": "gpt-5.2" },
    "openai_direct/gpt-5-mini": { "provider": "openai_direct", "model": "gpt-5-mini" },
    "openai_direct/gpt-5-nano": { "provider": "openai_direct", "model": "gpt-5-nano" },
    "openai_direct/gpt-4.1": { "provider": "openai_direct", "model": "gpt-4.1" },
    "openai_direct/gpt-4.1-mini": { "provider": "openai_direct", "model": "gpt-4.1-mini" },
    "anthropic_direct/claude-sonnet-4-5": { "provider": "anthropic_direct", "model": "claude-sonnet-4-5" },
    "anthropic_direct/claude-opus-4-1": { "provider": "anthropic_direct", "model": "claude-opus-4-1" },
    "openrouter_direct/deepseek/deepseek-chat-v3-0324": {
      "provider": "openrouter_direct",
      "model": "deepseek/deepseek-chat-v3-0324"
    },
    "openrouter_direct/openai/gpt-5.2": {
      "provider": "openrouter_direct",
      "model": "openai/gpt-5.2"
    },
    "openrouter_direct/anthropic/claude-sonnet-4-5": {
      "provider": "openrouter_direct",
      "model": "anthropic/claude-sonnet-4-5"
    },
    "ollama_direct/qwen2.5:0.5b": {
      "provider": "ollama_direct",
      "model": "qwen2.5:0.5b"
    }
  }
}
```

Provider `kind` values supported by the runtime resolver:

- `holaboss_proxy`
- `openai_compatible`
- `anthropic_native`
- `openrouter`

### Verify Ollama Through The Desktop UI

This is the simplest end-to-end check for the local `ollama_direct` path.

1. Install and start Ollama on your machine.
2. Pull a minimal local model:

```bash
ollama pull qwen2.5:0.5b
```

3. Launch the desktop app.
4. Open `Settings -> Models`.
5. Connect `Ollama` with:
   - base URL: `http://localhost:11434/v1`
   - API key: `ollama`
   - models: `qwen2.5:0.5b`
6. Open a workspace chat and select `ollama_direct/qwen2.5:0.5b`.
7. Send this prompt:

```text
Reply with exactly: OK
```

Expected result:

- the run starts with provider `ollama_direct`
- the model resolves to `qwen2.5:0.5b`
- the assistant replies with `OK`

If the model does not show up or the request fails, verify Ollama directly first:

```bash
curl http://localhost:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer ollama' \
  -d '{"model":"qwen2.5:0.5b","messages":[{"role":"user","content":"Reply with exactly: OK"}],"temperature":0}'
```

### Environment Overrides

```bash
export HOLABOSS_MODEL_PROXY_BASE_URL="https://your-proxy.example/api/v1/model-proxy"
export HOLABOSS_SANDBOX_AUTH_TOKEN="your-proxy-token"
export HOLABOSS_DEFAULT_MODEL="anthropic/claude-sonnet-4-20250514"
```

These env vars override the file-based values above. `sandbox_id` still needs to come from `runtime-config.json`.

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
- `SANDBOX_AGENT_HARNESS`: harness selector, defaults to `pi`
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
SANDBOX_AGENT_HARNESS=pi \
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
SANDBOX_AGENT_HARNESS=pi \
HOLABOSS_RUNTIME_WORKFLOW_BACKEND=remote_api \
HOLABOSS_RUNTIME_DB_PATH="$HOME/Library/Application Support/HolabossRuntime/state/runtime.db" \
PROACTIVE_ENABLE_REMOTE_BRIDGE=1 \
PROACTIVE_BRIDGE_BASE_URL=https://your-bridge.example \
holaboss-runtime
```

### Notes

- The packaged bundle includes the runtime app and its packaged runtime dependencies.
- The current bootstrap still expects a working `node` binary on the host machine at runtime. Install Node.js 22+ on the target machine before starting the runtime.
- The desktop app launches the same `bin/sandbox-runtime` entrypoint and passes the same bind host, bind port, sandbox root, and workflow-related environment variables.

## OSS Release Notes

- License: MIT. See `LICENSE`.
- Security issues: report privately to `security@holaboss.ai`. See `SECURITY.md`.

## macOS DMG Bundling

This section is the canonical flow for producing Holaboss macOS DMG installers.

### Local DMG For Testing (Ad-Hoc Signed, Not Notarized)

Run from the repository root:

```bash
npm run desktop:install
GITHUB_TOKEN="$(gh auth token)" npm --prefix desktop run dist:mac:dmg
```

If you want to package an unreleased runtime built from your local source tree instead of downloading the latest released runtime:

```bash
npm run desktop:install
npm --prefix desktop run dist:mac:dmg:local
```

Output location:

- `desktop/out/release/*.dmg`

Notes:

- Local DMG commands force ad-hoc signing via `--config.mac.identity=-`.
- Local artifacts are intended for smoke tests and are not notarized for distribution.

### Local Production Signing And Notarization (Mac)

If you want to ship a DMG built locally on your Mac with Developer ID signing and Apple notarization, run:

```bash
npm run desktop:install
npm --prefix desktop run prepare:runtime:local
npm --prefix desktop run prepare:packaged-config
npm --prefix desktop run build

CSC_LINK="file:///absolute/path/to/Certificates.p12" \
CSC_KEY_PASSWORD="your_p12_password" \
APPLE_ID="your_apple_id_email" \
APPLE_APP_SPECIFIC_PASSWORD="your_app_specific_password" \
APPLE_TEAM_ID="YOURTEAMID" \
npm --prefix desktop exec -- node scripts/run-electron-builder.mjs --mac dmg --arm64
```

Behavior:

- with `CSC_LINK` + `CSC_KEY_PASSWORD`, the app is signed with your Developer ID certificate
- with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`, electron-builder submits for notarization and staples the result
- if you omit `APPLE_*`, signing can still happen but notarization does not

### Signed And Notarized Product DMG (GitHub Actions)

Use the manual workflow `.github/workflows/release-macos-desktop.yml` (`Release macOS Desktop`).

Required GitHub repository secrets:

- `MAC_CERTIFICATE` (base64-encoded Developer ID Application `.p12`)
- `MAC_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Trigger the release from the GitHub UI or with GitHub CLI:

```bash
gh workflow run "Release macOS Desktop" \
  --ref main \
  -f ref=main \
  -f release_tag=holaboss-desktop-v0.1.0 \
  -f release_title="Holaboss Desktop v0.1.0" \
  -f prerelease=false
```

What this workflow does:

- creates or updates the specified GitHub release and tag
- builds the matching macOS runtime bundle from the selected ref
- builds, signs, and notarizes the desktop DMG
- uploads `Holaboss-macos-arm64.dmg` to the release

### Validate A Signed Build

After downloading the built app, run:

```bash
codesign --verify --deep --strict --verbose=2 /path/to/Holaboss.app
spctl -a -vv -t exec /path/to/Holaboss.app
xcrun stapler validate /path/to/Holaboss.app
```
