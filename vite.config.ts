import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.PORT ?? 8787);

// node:sqlite prints an ExperimentalWarning on Node 22; keep test output readable.
if (!process.env.NODE_OPTIONS?.includes('--disable-warning=ExperimentalWarning')) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --disable-warning=ExperimentalWarning`.trim();
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: false,
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
    testTimeout: 15000,
    pool: 'forks',
  },
});
