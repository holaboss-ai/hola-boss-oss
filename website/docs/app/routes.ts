import { route, type RouteConfig } from '@react-router/dev/routes';

// The docs app is mounted at /docs/* on the same hostname as the landing
// site. Every route explicitly carries the /docs prefix (no RR basename)
// so incoming URLs match directly.
export default [
  route('docs', 'routes/docs-home.tsx'),
  route('docs/api/search', 'routes/search.ts'),
  route('docs/og/*', 'routes/og.docs.tsx'),

  route('docs/llms.txt', 'llms/index.ts'),
  route('docs/llms-full.txt', 'llms/full.ts'),
  route('docs/llms.mdx/*', 'llms/mdx.ts'),

  route('docs/*', 'routes/docs.tsx'),

  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
