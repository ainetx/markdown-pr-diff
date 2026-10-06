import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { alias, define } from './vite.shared.ts';

// The content script must be a single self-contained IIFE: Chrome loads it as a
// classic script, so no ESM imports and no code splitting are allowed.
export default defineConfig({
  resolve: { alias },
  define,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome114',
    minify: true,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/inject.ts'),
      formats: ['iife'],
      name: 'MarkdownPrDiff',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true, extend: true },
    },
  },
});
