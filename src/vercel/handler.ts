/**
 * Vercel Function entry: the same Hono app the Node server runs, created once per
 * function instance and reused across requests (Vercel Fluid compute).
 *
 * Differences from the long-running server (see AppConfig.serverless):
 *   - no WebSocket hub: the client polls for chat messages and calls are off;
 *   - enrichment runs in bursts after responses (waitUntil) and hands over to a
 *     fresh invocation when the 5-minute limit approaches;
 *   - housekeeping runs from Vercel Cron (/api/internal/cron) once a day.
 *
 * scripts/build-vercel.mjs bundles this file into .vercel/output (Build Output API).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { attachDatabasePool, getDeadline, waitUntil } from '@vercel/functions';
import { createApp, createAppContext, type ContextOptions } from '../server/app';
import { loadConfig } from '../server/config';

type App = ReturnType<typeof createApp>;

/**
 * The routing config rewrites /api/<path> to the function as /api?__path=<path>;
 * restore the original URL (other query parameters are kept).
 */
export async function originalRequest(request: Request): Promise<Request> {
  const url = new URL(request.url);
  const path = url.searchParams.get('__path');
  if (path === null) return request;
  url.searchParams.delete('__path');
  url.pathname = `/api/${path.replace(/^\/+/, '')}`;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return new Request(url, { method: request.method, headers: request.headers, body: hasBody ? await request.arrayBuffer() : undefined });
}

const unavailable = (message: string) =>
  new Response(JSON.stringify({ error: { code: 'unavailable', message } }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** A Web fetch handler for the app. `context` overrides are for tests. */
export function createFetchHandler(env: NodeJS.ProcessEnv = process.env, context: ContextOptions = {}) {
  let app: Promise<App> | null = null;
  const getApp = () => {
    app ??= (async () => {
      const config = loadConfig(env);
      const ctx = await createAppContext(config, {
        background: (work) => waitUntil(work),
        deadline: () => getDeadline()?.getTime() ?? null,
        onPool: (pool) => attachDatabasePool(pool),
        ...context,
      });
      return createApp(ctx);
    })().catch((err: unknown) => {
      app = null; // try again on the next request
      throw err;
    });
    return app;
  };
  return async (request: Request): Promise<Response> => {
    if (!env.DATABASE_URL && !context.db) return unavailable('This deployment has no database. Set DATABASE_URL in the project settings.');
    let handler: App;
    try {
      handler = await getApp();
    } catch (err) {
      console.error('[somm] start-up failed:', err instanceof Error ? err.message : err);
      return unavailable('SOMM could not start. Try again in a moment.');
    }
    return handler.fetch(await originalRequest(request));
  };
}

/** Node (req, res) handler, as Vercel's Node.js launcher calls it. */
export function createNodeHandler(env: NodeJS.ProcessEnv = process.env, context: ContextOptions = {}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return getRequestListener(createFetchHandler(env, context)) as (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

export default createNodeHandler();
