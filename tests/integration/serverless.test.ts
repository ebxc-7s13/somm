/**
 * Serverless (Vercel) mode: the same API as the Node server, behind Vercel's
 * routing, with enrichment in bursts, polling instead of WebSockets, compressed
 * uploads, a shared worker lease and the internal hand-over and cron endpoints.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { all } from '../../src/server/db';
import { EnrichmentQueue } from '../../src/server/enrich/queue';
import { internalToken } from '../../src/server/routes/internal';
import { createFetchHandler, createNodeHandler, originalRequest } from '../../src/vercel/handler';
import { CRONS, FUNCTION_CONFIG, ROUTES, SECURITY_HEADERS } from '../../scripts/vercel-config.mjs';
import { createTestServer, csv, testConfig, testDatabase } from '../helpers/server';

const SITE = 'https://somm.example.app';
const VERCEL_ENV = {
  NODE_ENV: 'test',
  VERCEL: '1',
  VERCEL_PROJECT_PRODUCTION_URL: 'somm.example.app',
  TOKEN_ENCRYPTION_KEY: 'a-long-random-secret-for-tests-only-0123456789',
  MUSICBRAINZ_ENABLED: 'false',
} as NodeJS.ProcessEnv;

describe('Vercel routing', () => {
  it('restores the API path from the rewrite, keeping the query and the body', async () => {
    const r = await originalRequest(
      new Request(`${SITE}/api?__path=trees/night-owls/messages&after=5`, { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } }),
    );
    const url = new URL(r.url);
    expect(url.pathname).toBe('/api/trees/night-owls/messages');
    expect(url.searchParams.get('after')).toBe('5');
    expect(url.searchParams.has('__path')).toBe(false);
    expect(await r.text()).toBe('{"a":1}');
    const direct = new Request(`${SITE}/api/health`);
    expect(await originalRequest(direct)).toBe(direct);
  });

  it('serves the client from the CDN with security headers, the API from one function in Singapore', () => {
    const api = ROUTES.findIndex((r) => 'src' in r && r.src === '^/api/(.*)$');
    const fs = ROUTES.findIndex((r) => 'handle' in r && r.handle === 'filesystem');
    const spa = ROUTES.findIndex((r) => 'dest' in r && r.dest === '/index.html');
    expect(api).toBeGreaterThan(-1);
    expect(api).toBeLessThan(fs);
    expect(fs).toBeLessThan(spa);
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("default-src 'self'");
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("font-src 'self'");
    expect(FUNCTION_CONFIG).toMatchObject({ runtime: 'nodejs22.x', launcherType: 'Nodejs', regions: ['sin1'] });
    expect(FUNCTION_CONFIG.maxDuration).toBeLessThanOrEqual(300); // Hobby plan maximum
    // Hobby plans reject cron jobs that run more than once a day.
    for (const cron of CRONS) expect(cron.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });
});

describe('Vercel function', () => {
  it('reports polling and no calls, and accepts requests from the production origin', async () => {
    const handler = createFetchHandler(VERCEL_ENV, { db: await testDatabase(), musicbrainz: null });
    const cfg = await (await handler(new Request(`${SITE}/api?__path=client-config`))).json();
    expect(cfg).toEqual({ realtime: 'poll', calls: false, compressAboveBytes: 1024 * 1024, maxRequestBytes: 4 * 1024 * 1024 });
    const health = await (await handler(new Request(`${SITE}/api?__path=health`))).json();
    expect(health).toMatchObject({ ok: true, realtime: 'poll' });
    const signup = await handler(
      new Request(`${SITE}/api?__path=auth/signup`, {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'cloud_listener', password: 'correct-horse-battery' }),
      }),
    );
    expect(signup.status).toBe(201);
    expect(signup.headers.get('set-cookie')).toMatch(/somm_session=/);
    const foreign = await handler(new Request(`${SITE}/api?__path=auth/signup`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }));
    expect(foreign.status).toBe(403);
  });

  it('says what is missing when no database is configured', async () => {
    const r = await createFetchHandler({ NODE_ENV: 'test', VERCEL: '1' } as NodeJS.ProcessEnv)(new Request(`${SITE}/api?__path=health`));
    expect(r.status).toBe(503);
    expect((await r.json()).error.message).toMatch(/DATABASE_URL/);
  });

  it('works as a Node (req, res) handler, as Vercel calls it', async () => {
    const server = createServer(createNodeHandler(VERCEL_ENV, { db: await testDatabase(), musicbrainz: null }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const r = await fetch(`http://127.0.0.1:${port}/api?__path=client-config`);
      expect(r.status).toBe(200);
      expect((await r.json()).realtime).toBe('poll');
    } finally {
      server.close();
    }
  });

  it('accepts gzip-compressed uploads and applies the size and type checks to the real body', async () => {
    const { app } = await createTestServer({ env: { VERCEL: '1' } });
    const send = (body: Uint8Array | string, type = 'application/json') =>
      app.request('/api/convert', { method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': type, 'Content-Encoding': 'gzip' }, body: body as BodyInit });
    const content = Array.from({ length: 2000 }, (_, i) => `Nova Lattice - Glass Orbit ${i}`).join('\n');
    const gz = gzipSync(JSON.stringify({ source: 'text', content, name: 'Big list' }));
    expect(gz.length).toBeLessThan(content.length / 5);
    const r = await send(new Uint8Array(gz));
    expect(r.status).toBe(200);
    expect((await r.json()).playlists[0].rows).toHaveLength(2000);
    const broken = await send('not gzip at all');
    expect(broken.status).toBe(400);
    expect((await broken.json()).error.code).toBe('bad_encoding');
    expect((await send(new Uint8Array(gzipSync('title,artist')), 'text/csv')).status).toBe(415);
  });
});

describe('enrichment without a long-running process', () => {
  const pendingTracks = async (db: Awaited<ReturnType<typeof testDatabase>>) =>
    (await all<{ n: number }>(db, "SELECT COUNT(*) AS n FROM tracks WHERE enrichment_status = 'pending'"))[0]!.n;

  it('enriches in a burst after the import responds, then saves the results', async () => {
    const work: Promise<unknown>[] = [];
    const { client: makeClient, ctx } = await createTestServer({ env: { VERCEL: '1', TOKEN_ENCRYPTION_KEY: VERCEL_ENV.TOKEN_ENCRYPTION_KEY! }, background: (p) => void work.push(p) });
    const client = makeClient();
    await client.signup('burst-listener');
    const { jobId } = await client.importCsv(csv([['Glass Orbit', 'Nova Lattice'], ['Blue Hour', 'Teo Vance'], ['Quiet Engine', 'Mono Quartet']]));
    expect(work).toHaveLength(1);
    expect(await work[0]).toBe(3);
    expect(await pendingTracks(ctx.db)).toBe(0);
    const job = (await client.get(`/api/imports/jobs/${jobId}`)).body.job;
    expect(job.status).not.toBe('enriching');
  });

  it('hands over to a fresh invocation when the time limit approaches', async () => {
    const work: Promise<unknown>[] = [];
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return new Response(null, { status: 202 });
    });
    const { client: makeClient } = await createTestServer({
      env: { VERCEL: '1', TOKEN_ENCRYPTION_KEY: VERCEL_ENV.TOKEN_ENCRYPTION_KEY! },
      background: (p) => void work.push(p),
      // Already inside the 25-second safety margin: no time for even one track.
      deadline: () => Date.now() + 20_000,
      fetchImpl: fetchImpl as never,
    });
    const client = makeClient();
    await client.signup('handover-listener');
    await client.importCsv(csv([['Glass Orbit', 'Nova Lattice'], ['Blue Hour', 'Teo Vance']]));
    expect(await work[0]).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:5173/api/internal/enrich');
    const token = calls[0]!.headers['x-somm-internal'];
    expect(token).toBe(internalToken(testConfig({ VERCEL: '1', TOKEN_ENCRYPTION_KEY: VERCEL_ENV.TOKEN_ENCRYPTION_KEY! })));

    // The hand-over endpoint only accepts the derived token.
    expect((await client.req('POST', '/api/internal/enrich', undefined, { 'x-somm-internal': 'guess' })).status).toBe(403);
    expect((await client.req('POST', '/api/internal/enrich', undefined, { 'x-somm-internal': token! })).status).toBe(202);
    expect(work).toHaveLength(2);
  });

  it('lets only one process enrich at a time when they share a database', async () => {
    const db = await testDatabase();
    const deps = { musicbrainz: null, itunes: null, disabledReason: null, onUsersChanged: async () => undefined, useLease: true, background: () => undefined };
    const a = new EnrichmentQueue(db, deps);
    const b = new EnrichmentQueue(db, deps);
    let release!: () => void;
    const holding = new Promise<void>((r) => (release = r));
    const aNext = vi.spyOn(a, 'processNext').mockImplementationOnce(async () => {
      await holding;
      return false;
    });
    const bNext = vi.spyOn(b, 'processNext').mockResolvedValue(false);
    const first = a.drainBurst();
    await vi.waitFor(() => expect(aNext).toHaveBeenCalled());
    expect(await b.drainBurst()).toBe(0);
    expect(bNext).not.toHaveBeenCalled();
    release();
    await first;
    await b.drainBurst();
    expect(bNext).toHaveBeenCalledTimes(1);
    expect(await all(db, 'SELECT * FROM worker_leases')).toEqual([]);
  });

  it('runs daily housekeeping from the cron endpoint, only with the cron secret when one is set', async () => {
    const { client: makeClient } = await createTestServer({ env: { VERCEL: '1', CRON_SECRET: 'cron-secret-for-tests' }, background: () => undefined });
    const client = makeClient();
    expect((await client.get('/api/internal/cron')).status).toBe(403);
    const ok = await client.req('GET', '/api/internal/cron', undefined, { Authorization: 'Bearer cron-secret-for-tests' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, demoAccountsRemoved: 0 });
  });
});
