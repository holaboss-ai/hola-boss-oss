import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import mdx from 'fumadocs-mdx/vite';
import * as MdxConfig from './source.config';

export default defineConfig({
  // The docs app is mounted under /docs on the same hostname as landing.
  // Setting `base` prefixes every asset URL in the build output so the
  // browser fetches from the right path; the Worker then rewrites those
  // requests to look them up in the Assets binding.
  // Vite requires a trailing slash; React Router basename matches prefix-wise.
  base: '/docs/',
  plugins: [mdx(MdxConfig), tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
});
