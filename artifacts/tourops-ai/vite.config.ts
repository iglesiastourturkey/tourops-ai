import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

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
    plugins: [react(), tailwindcss(), ...replitPlugins],
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
