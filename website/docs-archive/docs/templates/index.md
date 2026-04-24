# Workspace Templates

A workspace template is a reusable starting state for a workspace.

In `holaOS`, a template is not an abstract concept. It is a file set that the desktop or runtime materializes into a workspace directory, then turns into a normal workspace with:

- `workspace.yaml`
- `AGENTS.md`
- optional `ONBOARD.md`
- optional `skills/`
- optional `apps/`

## Why Templates Matter

Templates exist so workspace creation is reproducible and developer-controlled.

They let you:

- start from a known runtime plan instead of an empty folder
- package apps, skills, and policy together
- keep onboarding material next to the workspace contract
- pin marketplace templates to a ref or commit
- export a clean workspace without bundling transient runtime residue

## The Four Creation Modes in Code

The desktop workspace flow in `desktop/electron/main.ts` currently supports:

1. `empty`
2. `empty_onboarding`
3. local template folder via `template_root_path`
4. marketplace template via `template_name` plus optional `template_ref` and `template_commit`

The important behavior is this:

- desktop always materializes template files locally
- local folders must contain `workspace.yaml`
- marketplace templates are materialized through `@holaboss/app-sdk`
- the resulting workspace is then initialized as a normal git-backed workspace directory

## Template vs Workspace vs App

| Surface | Role |
| --- | --- |
| Template | Reusable starting file set |
| Workspace | Live materialized environment |
| App | Capability installed inside a workspace |

A template can include apps, but it is not itself an app.

## What Developers Should Optimize For

A production-ready template should:

- materialize cleanly without manual repair
- produce a valid `workspace.yaml`
- avoid shipping transient runtime files
- make its starting policy obvious from the root files
- document whether it is meant for local use, marketplace use, or both

## Read Next

<DocCards>
  <DocCard
    title="Template Materialization"
    eyebrow="Creation Flow"
    href="/templates/materialization"
    description="See how local folders, marketplace templates, apply-template routes, and exports behave in code."
  />
  <DocCard
    title="Template Structure"
    eyebrow="Workspace Shape"
    href="/templates/structure"
    description="See the files and conventions a template must include to materialize cleanly."
  />
  <DocCard
    title="Template Versioning"
    eyebrow="Release Policy"
    href="/templates/versioning"
    description="See how to pin templates so workspace creation stays reproducible across time."
  />
</DocCards>
