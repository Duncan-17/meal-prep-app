import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // A personal single-user app: a silent update is friendlier than an
      // "update available" prompt nobody wants to think about mid-meal.
      registerType: 'autoUpdate',
      // No includeAssets: globPatterns below already covers png/svg, and
      // listing them twice puts duplicate entries in the precache manifest.

      manifest: {
        name: 'Meal Prep',
        short_name: 'Meal Prep',
        description: 'Plan batch cooking, track fridge stock, log meals.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f6f3',
        theme_color: '#f7f6f3',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            // Android crops this to whatever shape the launcher uses, so the
            // mark sits inside the middle 80%.
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],

        // The lazy chart chunk (~370 kB) IS precached, deliberately. Precaching
        // happens in the background after first paint, so it costs nothing at
        // load — and without it, opening Specific mode on a train would fail.
        // Lazy-loading still earns its place: the initial parse skips Recharts.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,

        // Client-side routes fall back to the shell — but /api must NEVER be
        // answered with index.html, which is what turns an offline API call
        // into a baffling HTML parse error instead of a clean failure.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],

        runtimeCaching: [
          {
            // USDA lookups through our proxy. Network first so a fresh result
            // wins, falling back to cache when there is no signal.
            urlPattern: /^\/api\/usda\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'usda-proxy',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Never cache the health check — a stale "key configured" would be
            // actively misleading when the proxy is down.
            urlPattern: /^\/api\/health$/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
        ],
      },

      devOptions: {
        // Off by default: a service worker caching a dev server is a reliable
        // way to spend an afternoon debugging stale code.
        enabled: false,
      },
    }),
  ],

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
