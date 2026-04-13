# Contributing

Use this page after the local dev loop is already running. It is the repo-specific checklist for making changes that are easy to review, safe to ship, and aligned with the way this monorepo is actually structured.

## Change by subsystem

| Area | Usual files | Minimum validation |
| --- | --- | --- |
| Desktop shell, renderer, preload, or Electron main process | `desktop/src/**`, `desktop/electron/**` | `npm run desktop:typecheck`; also run `npm run desktop:e2e` when browser panes, IPC, or runtime launch behavior changes |
| Runtime HTTP APIs, workers, or workspace-app lifecycle | `runtime/api-server/src/**`, `runtime/state-store/src/**` | `npm run runtime:api-server:typecheck` and `npm run runtime:test` |
| Harness host, adapter, or run projection | `runtime/harness-host/src/**`, `runtime/harnesses/src/**`, `runtime/api-server/src/ts-runner.ts`, `runtime/api-server/src/agent-runtime-config.ts` | `npm run runtime:harness-host:test`, `npm run runtime:api-server:test`, and `npm run runtime:test` |
| SDK or bridge contracts | `sdk/app-sdk/**`, `sdk/bridge/**` | Run the matching `build`, `typecheck`, and `test` scripts for the package you changed |
| Docs or VitePress config | `website/docs/**` | `npm run docs:test` |

## Cross-cutting rules

- If you change the Electron bridge, update all of `desktop/electron/preload.ts`, `desktop/src/types/electron.d.ts`, and the `ipcMain` handler in `desktop/electron/main.ts`.
- If you add or change a runtime route, update `runtime/api-server/src/app.ts`, the backing service or worker, and the relevant tests in `runtime/api-server/src/*.test.ts`.
- If you change runtime bundle layout, launcher behavior, or required packaged files, update both `runtime/deploy/**` and the desktop staging logic in `desktop/scripts/runtime-bundle*.mjs`.
- If you change developer workflow, setup, or debugging steps, update the docs page that owns that flow instead of leaving the behavior implicit in code.

## Default validation matrix

For mixed desktop and runtime changes, the safe default is:

```bash
npm run desktop:typecheck
npm run runtime:test
npm run docs:test
```

Add `npm run desktop:e2e` when the change crosses renderer, preload, main-process, or embedded-runtime boundaries.

## Commit and PR format

- Commit history uses Conventional Commits such as `feat:`, `fix:`, `docs:`, and `chore:`.
- Keep each commit scoped to one cohesive concern.
- Use the structured commit body format from the repo guidelines: a blank line followed by flat bullets describing what changed and why.
- Include the validation commands you ran in the commit body when they are important to understanding the change.
- PRs should call out user-visible behavior changes, migrations, workspace-format changes, new env vars, and any required follow-up deploy steps.

## Review expectations

- Keep PRs narrow enough that reviewers can reason about behavior changes without reconstructing the entire system.
- Do not hide behavior changes inside broad refactors. If something user-visible changes, say so directly.
- Update docs and tests in the same PR when public workflow, setup, runtime API behavior, or desktop operator flows change.
- Breaking changes, migration work, and env tweaks should be explicit in both the PR description and the review summary.
