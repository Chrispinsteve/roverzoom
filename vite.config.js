import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5200,
    proxy: {
      // Dev convenience: forward API calls to the Express server.
      '/api': 'http://localhost:4000',
    },
  },
});
