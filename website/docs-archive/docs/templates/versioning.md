# Template Versioning

Templates should be versioned like reproducible build inputs, not like loose example folders.

The important code path is marketplace materialization in `desktop/electron/main.ts`, which accepts:

- `template_name`
- optional `template_ref`
- optional `template_commit`

Those values determine what file set gets materialized into the workspace.

## What to Pin

| Reference | Best for | Recommendation |
| --- | --- | --- |
| tag | stable shared releases | good default |
| commit SHA | exact reproducibility and audits | best when environment drift matters |
| branch | active development | avoid for long-lived shared workspaces |

If you need a workspace to be reconstructible later, pin a tag or commit. Do not rely on a moving branch name.

## Marketplace Templates

Marketplace templates should be treated as immutable release inputs.

Recommended policy:

1. develop on a normal branch
2. cut a tag for a stable template release
3. pass `template_ref` when you want that tagged release
4. pass `template_commit` when you need an exact snapshot

If both a ref and commit are available in your workflow, prefer storing both in the workspace metadata for auditability.

## Local Folder Templates

Local folder templates are useful for iteration, but they are not reproducible by themselves.

In the local-folder path the desktop records template metadata with:

- `repo: "local"`
- `ref: "local"`
- `path` set to the local folder path during materialization

That makes local templates good for development, not for externally reproducible distribution. If a local template matters long-term, put it under git and cut a proper release path.

## Workspace Metadata Written at Creation Time

When a template materializes into a workspace and `workspace.yaml` does not already exist, `renderMinimalWorkspaceYaml()` can write template metadata such as:

- `template_id`
- `template.name`
- `template.repo`
- `template.path`
- `template.ref`
- optional `template.commit`
- `template.imported_at`

That metadata is the runtime-visible record of which template initialized the workspace.

## Release-Worthy Changes

Cut a new template release when the materialized workspace changes in a meaningful way, including:

- root policy changes in `AGENTS.md`
- `workspace.yaml` behavior changes
- included app manifests or app wiring changes
- onboarding flow changes in `ONBOARD.md`
- skill changes that materially change workspace behavior

Do not cut a release just because of small copy edits in optional docs.

## Practical Rule

If a fresh workspace created from the template would behave differently, version it like a real artifact.
