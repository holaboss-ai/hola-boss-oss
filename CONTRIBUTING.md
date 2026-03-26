# Contributing

## Before opening a PR

- Open an issue first for large changes, product-surface changes, or workflow changes.
- Keep PRs narrow. Mixed refactors plus behavior changes are harder to review and harder to ship safely.
- Avoid checking in secrets, private backend endpoints, or internal-only credentials.

## Development setup

Prerequisites:

- Node.js 22+
- npm

Common local flow:

```bash
npm run desktop:install
npm run desktop:prepare-runtime:local
npm run desktop:dev
```

Common validation:

```bash
npm run desktop:typecheck
npm run runtime:test
```

## Pull requests

- Write a clear title and description.
- Explain user-visible behavior changes and any migration impact.
- Update docs when setup, runtime behavior, or public workflows change.
- Add or update tests when behavior changes in `runtime/`.

## Review expectations

- PRs should be mergeable, scoped, and pass required checks.
- Breaking changes should be called out explicitly.
- Maintainers may request follow-up cleanup before merge when repo-wide consistency is affected.
