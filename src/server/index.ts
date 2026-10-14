/**
 * SOMM server entrypoint: HTTP API + WebSocket + (in production) the built client.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp, createAppContext } from './app';
import { loadConfig, loadDotEnv } from './config';
import { attachWebSocket } from './realtime/ws';
import { seedDemo } from './seed/demo';
import { housekeeping } from './services/accounts';

loadDotEnv();
const config = loadConfig();
const ctx = createAppContext(config);
const app = createApp(ctx);

// Opt-in: populate the fictional demo community (idempotent) for demo deployments.
if (process.env.SEED_DEMO_ON_START === 'true') {
  const seeded = seedDemo(ctx.db, config);
  if (!seeded.skipped) console.log(`[somm] seeded ${seeded.listeners} fictional demo listeners and ${seeded.trees} Trees`);
}

const clientDir = resolve('dist/client');
if (existsSync(join(clientDir, 'index.html'))) {
  const indexHtml = readFileSync(join(clientDir, 'index.html'), 'utf8');
  app.use('/assets/*', serveStatic({ root: './dist/client' }));
  app.use('/favicon.svg', serveStatic({ root: './dist/client' }));
  app.use('/manifest.webmanifest', serveStatic({ root: './dist/client' }));
  // Single-page app: any other GET returns index.html.
  app.get('*', (c) => c.html(indexHtml));
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: process.env.HOST ?? '127.0.0.1' }, (info) => {
  console.log(`[somm] API listening on http://${info.address}:${info.port}`);
  console.log(`[somm] metadata enrichment: ${ctx.queue.enabled ? 'MusicBrainz enabled' : ctx.queue.disabledReason}`);
  if (ctx.providers.vaultIsEphemeral) console.log('[somm] TOKEN_ENCRYPTION_KEY not set — provider tokens are kept only until restart (development mode).');
}) as Server;

const wss = attachWebSocket(server, ctx);
ctx.queue.start();

const tidy = () => {
  try {
    const r = housekeeping(ctx.db);
    if (r.expiredPlaylists.length) ctx.refreshUsers(r.expiredPlaylists);
  } catch (err) {
    console.error('[somm] housekeeping failed', err instanceof Error ? err.message : err);
  }
};
tidy();
const housekeepingTimer = setInterval(tidy, 15 * 60 * 1000);
housekeepingTimer.unref();

async function shutdown(signal: string) {
  console.log(`[somm] ${signal} received, shutting down`);
  clearInterval(housekeepingTimer);
  ctx.hub.closeAll();
  wss.close();
  await ctx.queue.stop();
  server.close(() => {
    ctx.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
