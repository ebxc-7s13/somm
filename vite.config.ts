import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: false,
    // Fonts are always separate files: the Content Security Policy allows fonts only from
    // this origin, so a small font subset inlined as a data: URI would be blocked.
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf)$/i.test(filePath) ? false : undefined),
  },
  server: {
    // Bind to the IPv4 loopback explicitly: on Windows "localhost" may resolve to ::1 only,
    // and Spotify requires loopback IP literals (127.0.0.1) in redirect URIs.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
      '/ws': { target: `ws://127.0.0.1:${API_PORT}`, ws: true },
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // PGlite (in-process Postgres) is slower per query than the production server.
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    // PGlite workers are CPU-bound; more workers than physical cores only slows
    // everything down and can starve new workers until they time out on start-up.
    maxWorkers: '50%',
  },
});
