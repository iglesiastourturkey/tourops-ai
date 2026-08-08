import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// PORT and BASE_PATH are injected by Replit at runtime.
// Outside Replit (local dev, CI, Vercel builds) we fall back to safe defaults
// so that `vite build` and `vite dev` work without those variables.
const port = Number(process.env.PORT) || 5173;
const basePath = process.env.BASE_PATH || '/';

// Replit-specific plugins are only loaded when running inside Replit (REPL_ID present).
// They are skipped entirely in production builds and in non-Replit environments,
// so the build succeeds without them.
const isReplit = process.env.REPL_ID !== undefined;
const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig(async () => {
  const replitPlugins =
    isDev && isReplit
      ? await Promise.all([
          import('@replit/vite-plugin-runtime-error-modal').then((m) => m.default()),
          import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({ root: path.resolve(import.meta.dirname, '..') }),
          ),
          import('@replit/vite-plugin-dev-banner').then((m) => m.devBanner()),
        ])
      : [];

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'logo.svg', 'robots.txt'],
        manifest: {
          name: 'TourPilot',
          short_name: 'TourPilot',
          description: 'Tur operasyonları yönetim platformu',
          theme_color: '#0B1F3A',
          background_color: '#0B1F3A',
          display: 'standalone',
          start_url: '/',
          orientation: 'any',
          icons: [
            { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
            {
              src: 'logo.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          // Precache all Vite build outputs
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          // Navigation fallback → serve cached SPA shell when offline
          navigateFallback: 'index.html',
          // Never intercept /api/* navigations with the SW
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            // Field & guide read endpoints — NetworkFirst with 5-min stale window
            //
            // Anchored at `^` (with an optional scheme+host prefix) rather than a
            // bare `/api/...` match: Workbox's RegExpRoute only honors a match
            // against a cross-origin URL (e.g. the Render API host, distinct from
            // the Vercel-hosted app) when the match starts at index 0 of the full
            // href. An unanchored pattern silently stops matching once frontend
            // and backend are split across origins. See
            // https://github.com/GoogleChrome/workbox/issues/281
            {
              urlPattern: /^(?:https?:\/\/[^/]+)?\/api\/(field|guide)\/.+/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'field-guide-api',
                expiration: { maxEntries: 80, maxAgeSeconds: 300 },
                networkTimeoutSeconds: 6,
                // Only cache GET responses — mutations go through the offline queue
                matchOptions: { ignoreMethod: false },
              },
            },
            // Notifications & dashboard — NetworkFirst, 2-min stale
            {
              urlPattern: /^(?:https?:\/\/[^/]+)?\/api\/(notifications|dashboard)\b/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'app-api',
                expiration: { maxEntries: 30, maxAgeSeconds: 120 },
                networkTimeoutSeconds: 6,
              },
            },
            // Explicitly exclude accounting / storage / AI / documents
            // (no entry = NetworkOnly by default for unmatched routes)
          ],
        },
        // Disable the SW entirely in dev to avoid cache interference
        devOptions: { enabled: false },
      }),
      ...replitPlugins,
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(import.meta.dirname, '..', '..', 'attached_assets'),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: false, // allow fallback port outside Replit
      host: '0.0.0.0',
      allowedHosts: true,
      fs: { strict: true },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
