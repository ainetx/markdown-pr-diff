import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { alias, define } from './vite.shared.ts';

// Service worker (ESM) plus the options and popup pages.
export default defineConfig({
  resolve: { alias },
  define,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome114',
    minify: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        sw: resolve(import.meta.dirname, 'src/background/sw.ts'),
        options: resolve(import.meta.dirname, 'src/options/options.html'),
        popup: resolve(import.meta.dirname, 'src/popup/popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
