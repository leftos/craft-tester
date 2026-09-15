import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const dataDir = fileURLToPath(new URL('../data', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  base: '/craft-tester/',
  resolve: {
    alias: {
      '@data': dataDir,
      '@': srcDir,
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
