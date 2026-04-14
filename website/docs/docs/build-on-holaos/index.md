# Build on holaOS

This section is the developer map for the OSS repo.

Use it when you are:

- developing inside the `holaOS` codebase
- building runtime-managed workspace apps
- authoring reusable workspace templates
- changing desktop, runtime, or harness internals

The source of truth for this section is the code, not a conceptual product story.

## About vs Build

Use the docs split deliberately:

- `About holaOS` explains the system model, boundaries, and why the layers exist.
- `Build on holaOS` explains the code seams, request shapes, scripts, ports, and validation paths that developers change in practice.

If a page needs exact commands, routes, payload fields, or source-file ownership, it belongs here rather than in the conceptual `holaOS` section.

## How To Use This Section

The practical builder flow is:

1. get the local desktop and runtime loop working
2. choose the subsystem you are changing
3. validate with the repo scripts for that subsystem

If you skip step one, later runtime or app failures are harder to interpret because the local environment is not yet trustworthy.

## Choose Your Track

<DocCards>
  <DocCard
    title="Start Developing"
    eyebrow="Local Loop"
    href="/build-on-holaos/start-developing/"
    description="Set up the real desktop dev loop, staged runtime bundle, local ports, and contributor workflow."
  />
  <DocCard
    title="Runtime APIs"
    eyebrow="Server Surface"
    href="/build-on-holaos/runtime/apis"
    description="Work from the actual Fastify routes, streaming endpoints, and runtime tests instead of inferred API summaries."
  />
  <DocCard
    title="Run Compilation"
    eyebrow="Execution Prep"
    href="/build-on-holaos/runtime/run-compilation"
    description="Trace how `workspace.yaml`, app manifests, MCP allowlists, prompt layers, and runtime context become the reduced harness request."
  />
  <DocCard
    title="App Anatomy"
    eyebrow="Runtime-Managed Apps"
    href="/app-development/applications/app-anatomy"
    description="Build apps from the real workspace contract: `workspace.yaml`, `app.runtime.yaml`, lifecycle, health, and MCP registry behavior."
  />
  <DocCard
    title="Template Materialization"
    eyebrow="Workspace Scaffolds"
    href="/templates/materialization"
    description="Understand how local folders, marketplace templates, apply-template routes, and exports behave in code."
  />
  <DocCard
    title="Troubleshooting"
    eyebrow="Operational Recovery"
    href="/build-on-holaos/troubleshooting"
    description="Use the repo’s actual diagnostics and known failure modes when the local runtime, desktop, or workspace flow breaks."
  />
</DocCards>

## Common Validation Paths

Use the narrowest validation that matches your change:

```bash
npm run docs:test
npm run docs:build
npm run desktop:typecheck
npm run runtime:test
npm run sdk:bridge:test
```

## Read By Subsystem

- desktop contributors should start with [Start Developing](/build-on-holaos/start-developing/) and [Desktop Internals](/build-on-holaos/desktop/internals)
- runtime contributors should start with [Runtime APIs](/build-on-holaos/runtime/apis), [Run Compilation](/build-on-holaos/runtime/run-compilation), [Runtime State Store](/build-on-holaos/runtime/state-store), and [Independent Deploy](/build-on-holaos/runtime/independent-deploy)
- app developers should start with [App Anatomy](/app-development/applications/app-anatomy), [Build Your First App](/app-development/applications/first-app), and [app.runtime.yaml](/app-development/applications/app-runtime-yaml)
- template authors should start with [Template Materialization](/templates/materialization), [Template Structure](/templates/structure), and [Template Versioning](/templates/versioning)
