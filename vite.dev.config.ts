import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { alias, define } from './vite.shared.ts';

// Standalone harness: renders the test fixtures with no GitHub and no extension APIs.
export default defineConfig({
  root: resolve(import.meta.dirname, 'dev'),
  resolve: { alias },
  define,
  server: { open: true },
});
