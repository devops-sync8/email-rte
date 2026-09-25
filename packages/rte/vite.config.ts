import { defineConfig } from 'vite';
import { stripCdnUrls } from '../../tools/vite-plugin-strip-cdn.mjs';

export default defineConfig({
  plugins: [stripCdnUrls()],
  build: {
    lib: {
      // `render` is DOM-free (usable on servers); `index` is the editor.
      entry: { index: 'src/index.ts', render: 'src/render.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: 'style',
    },
    sourcemap: false,
    // Quill is bundled so this editor's format registrations never affect
    // another Quill instance on the same page.
    rollupOptions: { external: [] },
  },
});
