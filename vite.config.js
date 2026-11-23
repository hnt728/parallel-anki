import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), cloudflare()],
  environments: {
    client: {
      // Avoid a development reload when the file picker first starts the APKG worker.
      optimizeDeps: { include: ['@sqlite.org/sqlite-wasm', '@zip.js/zip.js', 'fzstd'] },
    },
  },
});
