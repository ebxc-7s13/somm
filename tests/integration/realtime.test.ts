/**
 * Realtime chat + call signalling over a real HTTP/WebSocket server on an
 * ephemeral port. Media (getUserMedia / RTCPeerConnection) is not exercised
 * here — only SOMM's signalling and authorisation logic.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, createAppContext } from '../../src/server/app';
import { openDatabase } from '../../src/server/db';
import { attachWebSocket } from '../../src/server/realtime/ws';
import { electronicCsv, testConfig } from '../helpers/server';

interface Running {
  base: string;
  wsUrl: string;
  close: () => Promise<void>;
}

const running: Running[] = [];
afterEach(async () => {
  while (running.length) await running.pop()!.close();
});

async function start(env: Record<string, string> = {}, ringTimeoutMs?: number) {
  const config = testConfig({ PUBLIC_URL: 'http://127.0.0.1:5173', ...env });
  const ctx = createAppContext(config, { db: openDatabase(':memory:'), musicbrainz: null, ringTimeoutMs });
  const app = createApp(ctx);
  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s as Server)) as Server;
  });
  const wss = attachWebSocket(server, ctx);
  const port = (server.address() as AddressInfo).port;
  const r: Running = {
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    close: () =>
      new Promise<void>((resolve) => {
        ctx.hub.closeAll();
        wss.close();
        server.close(() => resolve());
      }),
  };
  running.push(r);
  return { ...r, ctx };
}

class HttpUser {
  cookie = '';
  id = '';
  constructor(private readonly base: string) {}
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Origin: 'http://127.0.0.1:5173', ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }
  async signup(handle: string) {
    const r = await this.req('POST', '/api/auth/signup', { handle, password: 'correct-horse-battery' });
    this.id = r.body.user.id;
  }
  async importShared(content: string) {
    const p = await this.req('POST', '/api/imports/preview', { source: 'csv', content });
    await this.req('POST', `/api/imports/${p.body.draftId}/commit`, { visibility: 'shared' });
    await this.req('PATCH', '/api/me', { discoverable: true });
  }
}

class WsClient {
  messages: any[] = [];
  private waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
  }
  static open(url: string, cookie: string) {
    return new Promise<WsClient>((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' } });
      const client = new WsClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  next(pred: (m: any) => boolean, timeoutMs = 2000): Promise<any> {
    const existing = this.messages.find(pred);
    if (existing) {
      this.messages.splice(this.messages.indexOf(existing), 1);
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(t);
          this.messages.splice(this.messages.indexOf(m), 1);
          resolve(m);
        },
      });
    });
  }
  close() {
    this.ws.close();
  }
}

async function setup(env: Record<string, string> = {}, ringTimeoutMs?: number) {
  const srv = await start(env, ringTimeoutMs);
  const users = await Promise.all(['rt-alpha', 'rt-bravo', 'rt-charlie', 'rt-outsider'].map(async (h, i) => {
    const u = new HttpUser(srv.base);
    await u.signup(h);
    await u.importShared(i < 3 ? electronicCsv(`RT${i}`, 14) : electronicCsv('Out', 4, ['Someone Else']));
    return u;
  }));
  const [a, b, c, outsider] = users as [HttpUser, HttpUser, HttpUser, HttpUser];
  const tree = (await a.req('POST', '/api/trees', { name: 'Realtime Grove' })).body.tree;
  await b.req('POST', `/api/trees/${tree.slug}/join`);
  await c.req('POST', `/api/trees/${tree.slug}/join`);
  return { srv, a, b, c, outsider, tree };
}

describe('WebSocket chat', () => {
  it('rejects unauthenticated and cross-origin upgrades', async () => {
    const srv = await start();
    await expect(WsClient.open(srv.wsUrl, '')).rejects.toThrow(/401/);
    const u = new HttpUser(srv.base);
    await u.signup('rt-origin');
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(srv.wsUrl, { headers: { Cookie: u.cookie, Origin: 'https://evil.example' } });
        ws.once('open', resolve);
        ws.once('unexpected-response', (_q, res) => reject(new Error(`HTTP ${res.statusCode}`)));
        ws.once('error', reject);
      }),
    ).rejects.toThrow(/403/);
  });

  it('delivers messages to subscribed members only and respects blocks', async () => {
    const { srv, a, b, c, outsider, tree } = await setup();
    const wa = await WsClient.open(srv.wsUrl, a.cookie);
    const wb = await WsClient.open(srv.wsUrl, b.cookie);
    const wc = await WsClient.open(srv.wsUrl, c.cookie);
    const wo = await WsClient.open(srv.wsUrl, outsider.cookie);
    for (const w of [wa, wb, wc]) {
      w.send({ type: 'subscribe', treeId: tree.id });
      await w.next((m) => m.type === 'subscribed');
    }
    wo.send({ type: 'subscribe', treeId: tree.id });
    expect((await wo.next((m) => m.type === 'error')).code).toBe('not_member');

    await c.req('POST', '/api/blocks', { handle: 'rt-alpha', kind: 'mute' });
    const sent = await a.req('POST', `/api/trees/${tree.slug}/messages`, { body: 'hello grove' });
    expect(sent.status).toBe(201);
    const got = await wb.next((m) => m.type === 'message');
    expect(got.message).toMatchObject({ body: 'hello grove', mine: false });
    expect((await wa.next((m) => m.type === 'message')).message.mine).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(wc.messages.some((m) => m.type === 'message')).toBe(false);
    expect(wo.messages.some((m) => m.type === 'message')).toBe(false);

    // Leaving the Tree stops delivery.
    await b.req('POST', `/api/trees/${tree.slug}/leave`);
    await a.req('POST', `/api/trees/${tree.slug}/messages`, { body: 'after leave' });
    await wa.next((m) => m.type === 'message' && m.message.body === 'after leave');
    await new Promise((r) => setTimeout(r, 100));
    expect(wb.messages.some((m) => m.type === 'message')).toBe(false);
    [wa, wb, wc, wo].forEach((w) => w.close());
  });

  it('recovers missed messages after a reconnect via ?after=', async () => {
    const { srv, a, b, tree } = await setup();
    let wb = await WsClient.open(srv.wsUrl, b.cookie);
    wb.send({ type: 'subscribe', treeId: tree.id });
    await wb.next((m) => m.type === 'subscribed');
    const first = (await a.req('POST', `/api/trees/${tree.slug}/messages`, { body: 'one' })).body.message;
    await wb.next((m) => m.type === 'message');
    wb.close();
    await a.req('POST', `/api/trees/${tree.slug}/messages`, { body: 'two (missed)' });
    await a.req('POST', `/api/trees/${tree.slug}/messages`, { body: 'three (missed)' });
    wb = await WsClient.open(srv.wsUrl, b.cookie);
    wb.send({ type: 'subscribe', treeId: tree.id });
    await wb.next((m) => m.type === 'subscribed');
    const gap = await b.req('GET', `/api/trees/${tree.slug}/messages?after=${first.id}`);
    expect(gap.body.messages.map((m: any) => m.body)).toEqual(['two (missed)', 'three (missed)']);
    wb.close();
  });

  it('answers pings and rejects malformed frames', async () => {
    const { srv, a } = await setup();
    const w = await WsClient.open(srv.wsUrl, a.cookie);
    w.send({ type: 'ping', t: 1 });
    expect((await w.next((m) => m.type === 'pong')).t).toBe(1);
    w.ws.send('not json');
    expect((await w.next((m) => m.type === 'error')).code).toBe('bad_json');
    w.close();
  });
});

describe('call signalling', () => {
  it('relays a full 1:1 call between Tree members', async () => {
    const { srv, a, b, tree } = await setup();
    const wa = await WsClient.open(srv.wsUrl, a.cookie);
    const wb = await WsClient.open(srv.wsUrl, b.cookie);
    wa.send({ type: 'call:invite', to: b.id, media: 'video', treeId: tree.id });
    const ringing = await wa.next((m) => m.type === 'call:ringing');
    const incoming = await wb.next((m) => m.type === 'call:incoming');
    expect(incoming).toMatchObject({ callId: ringing.callId, media: 'video', peer: { handle: 'rt-alpha' } });
    expect(incoming.ice.iceServers[0].urls[0]).toMatch(/^stun:/);
    // No SDP before the call is answered.
    wa.send({ type: 'call:signal', callId: ringing.callId, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
    expect((await wa.next((m) => m.type === 'error')).code).toBe('bad_state');
    // Only the callee can answer.
    wa.send({ type: 'call:accept', callId: ringing.callId });
    expect((await wa.next((m) => m.type === 'error')).code).toBe('bad_state');
    wb.send({ type: 'call:accept', callId: ringing.callId });
    await wa.next((m) => m.type === 'call:accepted');
    wa.send({ type: 'call:signal', callId: ringing.callId, data: { sdp: { type: 'offer', sdp: 'v=0 offer' } } });
    expect((await wb.next((m) => m.type === 'call:signal')).data.sdp.sdp).toBe('v=0 offer');
    wb.send({ type: 'call:signal', callId: ringing.callId, data: { sdp: { type: 'answer', sdp: 'v=0 answer' } } });
    expect((await wa.next((m) => m.type === 'call:signal')).data.sdp.type).toBe('answer');
    wb.send({ type: 'call:signal', callId: ringing.callId, data: { candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host' } } });
    expect((await wa.next((m) => m.type === 'call:signal')).data.candidate).toBeDefined();
    wa.send({ type: 'call:signal', callId: ringing.callId, data: { evil: true } });
    expect((await wa.next((m) => m.type === 'error')).code).toBe('bad_signal');
    wa.send({ type: 'call:end', callId: ringing.callId });
    expect((await wb.next((m) => m.type === 'call:ended')).reason).toBe('caller_hung_up');
    const row = srv.ctx.db.prepare('SELECT status, answered_at FROM calls WHERE id = ?').get(ringing.callId) as { status: string; answered_at: string };
    expect(row.status).toBe('ended');
    expect(row.answered_at).toBeTruthy();
    wa.close();
    wb.close();
  });

  it('refuses calls to non-members, blocked users and offline users, and handles decline/timeout', async () => {
    const { srv, a, b, c, outsider, tree } = await setup({}, 200);
    const wa = await WsClient.open(srv.wsUrl, a.cookie);
    const wo = await WsClient.open(srv.wsUrl, outsider.cookie);
    wa.send({ type: 'call:invite', to: outsider.id, media: 'audio' });
    expect((await wa.next((m) => m.type === 'error')).message).toMatch(/share/);
    wa.send({ type: 'call:invite', to: c.id, media: 'audio', treeId: tree.id });
    expect((await wa.next((m) => m.type === 'error')).code).toBe('callee_offline');
    await b.req('POST', '/api/blocks', { handle: 'rt-alpha', kind: 'block' });
    const wb = await WsClient.open(srv.wsUrl, b.cookie);
    wa.send({ type: 'call:invite', to: b.id, media: 'audio' });
    expect((await wa.next((m) => m.type === 'error')).code).toBe('call_denied');
    await b.req('DELETE', '/api/blocks/rt-alpha');
    wa.send({ type: 'call:invite', to: b.id, media: 'audio' });
    const ring1 = await wb.next((m) => m.type === 'call:incoming');
    wb.send({ type: 'call:reject', callId: ring1.callId });
    expect((await wa.next((m) => m.type === 'call:ended')).status).toBe('rejected');
    wa.send({ type: 'call:invite', to: b.id, media: 'audio' });
    await wb.next((m) => m.type === 'call:incoming');
    expect((await wa.next((m) => m.type === 'call:ended', 3000)).status).toBe('missed');
    // Outsider cannot inject signals into someone else's call.
    wo.send({ type: 'call:signal', callId: ring1.callId, data: { candidate: {} } });
    expect((await wo.next((m) => m.type === 'error')).code).toBe('no_call');
    [wa, wb, wo].forEach((w) => w.close());
  });

  it('ends the call when a participant disconnects', async () => {
    const { srv, a, b } = await setup();
    const wa = await WsClient.open(srv.wsUrl, a.cookie);
    const wb = await WsClient.open(srv.wsUrl, b.cookie);
    wa.send({ type: 'call:invite', to: b.id, media: 'audio' });
    const inc = await wb.next((m) => m.type === 'call:incoming');
    wb.send({ type: 'call:accept', callId: inc.callId });
    await wa.next((m) => m.type === 'call:accepted');
    wb.close();
    expect((await wa.next((m) => m.type === 'call:ended')).reason).toBe('peer_disconnected');
    wa.close();
  });

  it('honours CALLS_ENABLED=false', async () => {
    const { srv, a, b } = await setup({ CALLS_ENABLED: 'false' });
    const wa = await WsClient.open(srv.wsUrl, a.cookie);
    await WsClient.open(srv.wsUrl, b.cookie);
    wa.send({ type: 'call:invite', to: b.id, media: 'audio' });
    expect((await wa.next((m) => m.type === 'error')).code).toBe('calls_disabled');
    wa.close();
  });
});
