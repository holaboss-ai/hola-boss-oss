import { route, type RouteConfig } from '@react-router/dev/routes';

// The docs app is mounted at /docs/* on the same hostname as the landing
// site. Every route explicitly carries the /docs prefix (no RR basename)
// so incoming URLs match directly.
//
// `/docs` (exact) is intentionally not registered: the docs landing now
// lives in apps/web (the frontend worker). CF workers routes only claim
// `/docs/*` for this worker, so a bare `/docs` — whether typed, bookmarked,
// or arrived at via browser back/forward — falls through to the frontend.
export default [
  route('docs/api/search', 'routes/search.ts'),
  route('docs/og/*', 'routes/og.docs.tsx'),

  route('docs/llms.txt', 'llms/index.ts'),
  route('docs/llms-full.txt', 'llms/full.ts'),
  route('docs/llms.mdx/*', 'llms/mdx.ts'),

  route('docs/*', 'routes/docs.tsx'),

  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
