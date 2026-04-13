# Template Materialization

This page covers the code paths that turn a template into a workspace developers can actually run.

The source of truth is:

- `desktop/electron/main.ts`
- `runtime/api-server/src/app.ts`

## Desktop Creation Flow

`createWorkspace()` in `desktop/electron/main.ts` supports four modes:

1. `empty`
2. `empty_onboarding`
3. local folder template via `template_root_path`
4. marketplace template via `template_name` plus optional `template_ref` and `template_commit`

The important implementation detail is that desktop always materializes templates locally. It does not delegate template file writes to a remote service.

## Local Folder Templates

`materializeLocalTemplate()` does three important things:

1. resolves the selected folder to an absolute path
2. rejects it if `workspace.yaml` is missing
3. collects the tracked template files and returns them as materialized content

For local templates, the returned template metadata is currently:

- `repo: "local"`
- `effective_ref: "local"`
- `source: "template_folder"`

When `HOLABOSS_INTERNAL_DEV=1`, local template enrichment can also pull in local app dependencies. Treat that as an internal development path, not the normal template contract.

## Marketplace Templates

`materializeMarketplaceTemplate()` delegates to `sdkMaterializeMarketplaceTemplate()` from `@holaboss/app-sdk`.

Inputs that matter:

- `holaboss_user_id`
- `template_name`
- optional `template_ref`
- optional `template_commit`

That is the path to use when you need a versioned and shareable template source instead of a local folder.

## What Happens After Materialization

After the template files are materialized, `createWorkspace()`:

1. creates the workspace record through the runtime API
2. writes the materialized files into the local workspace directory
3. writes a minimal `workspace.yaml` if the template did not provide one
4. initializes the workspace as a git repo
5. checks `ONBOARD.md` and marks onboarding as pending if the file has content

That means a template is not finished when it can be downloaded. It is finished when the materialized workspace can be opened and used without repair.

## Applying Templates Through the Runtime API

The runtime exposes two workspace template application routes:

- `POST /api/v1/workspaces/:workspaceId/apply-template`
- `POST /api/v1/workspaces/:workspaceId/apply-template-from-url`

### `apply-template`

This route accepts an explicit file list. For each file, the runtime:

- resolves the target path under the workspace root
- rejects path traversal
- writes the decoded file content
- preserves executable bits when requested

If `replace_existing` is `true`, the runtime clears the workspace first but preserves:

- `.holaboss`
- `workspace.json`

### `apply-template-from-url`

This route downloads a zip archive, optionally with `X-API-Key`, then extracts it into the workspace. It uses the same `replace_existing` preservation rules and rejects invalid archives.

Use this route when you already have a zip-distribution path for templates and want the runtime to apply it directly.

## Export Behavior

`GET /api/v1/workspaces/:workspaceId/export` creates a tarball of the current workspace while excluding common non-portable residue:

- `node_modules`
- `.git`
- `dist`
- `build`
- `__pycache__`
- `.venv`
- `.hb_template_bootstrap_tmp`
- `.hb_app_template_tmp`

This is the practical portability contract for workspaces today. If your template or workspace depends on excluded files, the export is not reproducible.

## Developer Rules

- local folder templates must always contain `workspace.yaml`
- marketplace templates should be pinned with `template_ref` or `template_commit`
- treat `ONBOARD.md` as operational state, not decorative copy
- keep template outputs clean enough that export still represents a portable workspace
- do not rely on preserved `.holaboss` state when validating a fresh template

## Validation

Use these checks after changing the template flow:

```bash
npm run desktop:typecheck
npm run runtime:api-server:test
npm run docs:test
```
