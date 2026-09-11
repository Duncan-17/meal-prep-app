import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Lets you open the dev server from your phone on the same Wi-Fi.
    host: true,
    proxy: {
      // Vite knows nothing about `functions/` — those run on workerd, not Node.
      // So `npm run dev:api` serves them separately and this forwards to it,
      // which keeps hot reload on the app while the real proxy handles /api.
      // Without dev:api running, /api calls fail; the UI says so explicitly.
      '/api': {
        target: 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
