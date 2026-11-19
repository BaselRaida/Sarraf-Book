/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// المسار الأساسي: "/" محلياً، و"/Sarraf-Book/" على GitHub Pages (يُمرَّر من سير العمل BASE_PATH)
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-v2.svg', 'favicon.ico', 'favicon-32.png', 'apple-touch-icon-v2.png'],
      manifest: {
        name: 'صرّاف بوك',
        short_name: 'صرّاف بوك',
        description: 'إدارة الزبائن والحوالات والعمولات',
        lang: 'ar',
        dir: 'rtl',
        theme_color: '#14503B',
        background_color: '#F3F0E4',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-v2.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  test: { environment: 'node' },
});
