# Template Structure

A template should be a valid workspace skeleton, not a marketing shell.

For local template folders, the one hard requirement in code is `workspace.yaml`. `materializeLocalTemplate()` rejects the folder if that file is missing.

## Minimal Shape

```text
<template-root>/
  workspace.yaml
  AGENTS.md
  ONBOARD.md
  README.md
  skills/
    <skill-id>/
      SKILL.md
  apps/
    <app-id>/
      app.runtime.yaml
      ...
```

Not every template needs every file, but production-ready templates should make the runtime contract obvious at the root.

## Files That Matter Most

<DocDefinition term="workspace.yaml" meta="required for local folders">
  The runtime plan for the materialized workspace. Local template selection fails without it.
</DocDefinition>

<DocDefinition term="AGENTS.md" meta="workspace policy">
  The standing instruction surface that shapes day-to-day behavior in the materialized workspace.
</DocDefinition>

<DocDefinition term="ONBOARD.md" meta="optional onboarding trigger">
  If this file exists and has content after materialization, the desktop marks the workspace onboarding status as pending and creates an onboarding session id.
</DocDefinition>

<DocDefinition term="skills/" meta="workspace-local skills">
  Local template metadata derives tags from the names of subdirectories under `skills/`.
</DocDefinition>

<DocDefinition term="apps/" meta="workspace-local apps">
  Apps should live under `apps/my_app/` with their own `app.runtime.yaml`. Template apps become normal workspace apps after materialization.
</DocDefinition>

<DocDefinition term="README.md" meta="template metadata source">
  For local folder templates, the first non-empty line of `README.md` becomes the template description. If `README.md` is absent, the desktop falls back to the first non-empty line of `AGENTS.md`.
</DocDefinition>

## How Local Template Metadata Is Derived

`parseLocalTemplateMetadata()` in `desktop/electron/main.ts` currently derives:

- template display name from `workspace.yaml` `name:` or the folder basename
- description from the first non-empty line of `README.md`, else `AGENTS.md`
- tags from subdirectory names under `skills/`
- source metadata with `repo: "local"` and `default_ref: "local"`

That means local template quality depends heavily on root-file clarity. If the root is vague, the template picker is vague too.

## Structure Rules That Hold Up in Production

- keep `workspace.yaml` valid on its own
- keep app manifests next to their app code
- keep root docs short and explicit so metadata derivation works
- keep setup files rerunnable after copy
- avoid machine-local files, secrets, and caches

## What Not to Ship in a Template

Do not treat a template like a live workspace snapshot. Keep these out:

- `.holaboss/`
- `.git/`
- `node_modules/`
- build artifacts such as `dist/` and `build/`
- Python caches and virtualenvs
- local logs
- secrets and `.env*`

The runtime export path also excludes:

- `__pycache__/`
- `.venv/`
- `.hb_template_bootstrap_tmp/`
- `.hb_app_template_tmp/`

## Empty Workspace Fallbacks

When the desktop creates `empty` or `empty_onboarding` workspaces, it uses built-in scaffolds from `renderEmptyWorkspaceYaml()` and `renderEmptyOnboardingGuide()`.

That is useful as a baseline when deciding whether a reusable template genuinely adds value. If your template does not improve on the empty scaffold with real apps, skills, or policy, it probably should not exist yet.

## Validation

Before publishing or sharing a template, verify:

- the template folder contains `workspace.yaml`
- materialization produces the files you expect
- any included apps still resolve from `workspace.yaml`
- `ONBOARD.md` is either intentionally empty or intentionally actionable
- no transient runtime files are present
