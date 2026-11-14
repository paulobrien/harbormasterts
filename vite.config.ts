import { defineConfig } from 'vite';

export default defineConfig({
  // The normal build copies the public shell separately, excluding game files.
  build: { copyPublicDir: false },
});
