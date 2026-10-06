import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'vendor/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Browser and extension surface, shared by every source file.
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        history: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        chrome: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        indexedDB: 'readonly',
        matchMedia: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        ResizeObserver: 'readonly',
        MutationObserver: 'readonly',
        CSSStyleSheet: 'readonly',
        URLSearchParams: 'readonly',
        URL: 'readonly',
        Headers: 'readonly',
        Intl: 'readonly',
        NodeFilter: 'readonly',
        Node: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Build and test tooling runs in Node, not in a page.
    files: ['scripts/**', '*.config.ts', 'vite.shared.ts', 'test/**'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        globalThis: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
);
