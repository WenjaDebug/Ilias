import { defineConfig } from 'vite';

// base './' so the build works from any sub-path (GitHub Pages, artifact preview, local file server)
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
