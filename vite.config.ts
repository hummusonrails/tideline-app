/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Project pages need `base: '/<REPO>/'`. Override with VITE_BASE
// (e.g. `/` for a custom domain or user/org page).
const base = '/tideline-app/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'fonts/*.woff2',
      ],
      manifest: {
        name: 'Tideline',
        short_name: 'Tideline',
        description: 'Personal companion app',
        theme_color: '#EEF3EC',
        background_color: '#EEF3EC',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Adds `push` / `notificationclick` handlers to the generated service
        // worker without switching to injectManifest — precaching, navigation
        // fallback and the api.github.com rule below stay exactly as they are.
        // Resolved relative to the SW, i.e. `${base}push-sw.js`.
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        runtimeCaching: [
          {
            // The data backend is always network-only; content is mirrored
            // into IndexedDB by the sync engine, not the SW cache.
            urlPattern: ({ url }: { url: URL }) => url.hostname === 'api.github.com',
            handler: 'NetworkOnly',
          },
        ],
        navigateFallback: `${base}index.html`,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['dexie', 'dexie-react-hooks'],
          ui: ['motion', 'lucide-react'],
          media: ['browser-image-compression', 'exifr'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
