import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000, target: 'es2022' },
  esbuild: { target: 'es2022' },
  logLevel: 'warn',
});
