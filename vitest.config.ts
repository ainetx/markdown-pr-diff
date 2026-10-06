import { defineConfig } from 'vitest/config';
import { alias, define } from './vite.shared.ts';

export default defineConfig({
  resolve: { alias },
  define,
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
