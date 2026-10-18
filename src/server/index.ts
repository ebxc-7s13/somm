/**
 * SOMM server entrypoint: HTTP API + WebSocket + (in production) the built client.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp, createAppContext } from './app';
import { keepAwakeUrl, startKeepAwake } from './keepawake';
import { loadConfig, loadDotEnv } from './config';
import { attachWebSocket } from './realtime/ws';
import { seedDemo } from './seed/demo';
import { housekeeping } from './services/accounts';

loadDotEnv();
const config = loadConfig();
const ctx = await createAppContext(config);
const app = createApp(ctx);
console.log(`[somm] database: ${ctx.db.kind === 'pg' ? 'PostgreSQL (DATABASE_URL)' : `PGlite (${config.pgliteDataDir})`}`);

const clientDir = resolve('dist/client');
if (existsSync(join(clientDir, 'index.html'))) {
  const indexHtml = readFileSync(join(clientDir, 'index.html'), 'utf8');
  // Hashed build output can be cached forever; everything else must revalidate.
  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('/sw.js', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-cache');
  });
  for (const path of ['/assets/*', '/icons/*', '/favicon.svg', '/manifest.webmanifest', '/sw.js', '/robots.txt']) {
    app.use(path, serveStatic({ root: './dist/client' }));
  }
  // Single-page app: any other GET returns index.html.
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: process.env.HOST ?? '127.0.0.1' }, (info) => {
  console.log(`[somm] API listening on http://${info.address}:${info.port}`);
  console.log(`[somm] metadata enrichment: ${ctx.queue.enabled ? 'MusicBrainz enabled' : ctx.queue.disabledReason}`);
  if (ctx.providers.vaultIsEphemeral) console.log('[somm] TOKEN_ENCRYPTION_KEY not set — provider tokens are kept only until restart (development mode).');
}) as Server;

const wss = attachWebSocket(server, ctx);
ctx.queue.start();

// Opt-in: populate the fictional demo community (idempotent) for demo deployments.
// Runs after the server is listening so health checks pass during a cold start.
if (process.env.SEED_DEMO_ON_START === 'true') {
  void seedDemo(ctx.db, config)
    .then((seeded) => {
      if (!seeded.skipped) console.log(`[somm] seeded ${seeded.listeners} fictional demo listeners and ${seeded.trees} Trees`);
    })
    .catch((err: unknown) => console.error('[somm] demo seeding failed', err instanceof Error ? err.message : err));
}

const tidy = async () => {
  try {
    const r = await housekeeping(ctx.db);
    if (r.expiredPlaylists.length) await ctx.refreshUsers(r.expiredPlaylists);
  } catch (err) {
    console.error('[somm] housekeeping failed', err instanceof Error ? err.message : err);
  }
};
void tidy();
// Every 6 hours: expiry is also enforced on each request, and a rarer sweep lets a
// serverless database scale to zero while the server itself stays awake.
const housekeepingTimer = setInterval(() => void tidy(), 6 * 3600 * 1000);
housekeepingTimer.unref();

// Free Render services sleep after 15 idle minutes; keep this one available (see keepawake.ts).
const awakeOrigin = keepAwakeUrl(process.env);
const stopKeepAwake = awakeOrigin ? startKeepAwake(awakeOrigin) : () => undefined;
if (awakeOrigin) console.log(`[somm] keep-awake: pinging ${awakeOrigin}/api/health every 10 minutes`);

async function shutdown(signal: string) {
  console.log(`[somm] ${signal} received, shutting down`);
  setTimeout(() => process.exit(0), 8000).unref();
  clearInterval(housekeepingTimer);
  stopKeepAwake();
  await ctx.hub.closeAll();
  wss.close();
  await ctx.queue.stop();
  server.close(() => {
    void ctx.db.close().finally(() => process.exit(0));
  });
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
