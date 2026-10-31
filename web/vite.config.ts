/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const dataDir = fileURLToPath(new URL('../data', import.meta.url));
const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  base: '/craft-tester/',
  resolve: {
    alias: {
      '@data': dataDir,
      '@fixtures': fixturesDir,
      '@': srcDir,
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  test: {
    // Hang guards, never budgets: no test asserts on time, and a passing run under a loaded machine
    // can be stopped for tens of seconds, so these fire only on a test that never finishes.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
