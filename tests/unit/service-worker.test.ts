/**
 * Runs public/sw.js in a sandbox with in-memory caches and a fake network, so
 * its routing rules are checked without a browser: personal data (/api, /ws) is
 * never intercepted or cached, pages are network-first with an offline page,
 * and hashed assets are cache-first.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://somm.example';

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

type Handler = (event: Record<string, unknown>) => void;

interface FakeWindow {
  url: string;
  focus: () => Promise<FakeWindow>;
  navigate: (url: string) => Promise<FakeWindow>;
}

function loadWorker(network: (url: string) => Promise<Response>, windows: FakeWindow[] = [], opened: string[] = []) {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (r: string | FakeRequest) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
  const calls: string[] = [];
  const fetchImpl = (r: string | FakeRequest) => {
    calls.push(keyOf(r));
    return network(keyOf(r));
  };
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        async addAll(urls: string[]) {
          for (const u of urls) m.set(keyOf(u), await fetchImpl(u));
        },
        async put(r: string | FakeRequest, res: Response) {
          m.set(keyOf(r), res);
        },
        async match(r: string | FakeRequest) {
          return m.get(keyOf(r))?.clone();
        },
        async keys() {
          return [...m.keys()].map((url) => ({ url, method: 'GET', mode: 'cors' }));
        },
        async delete(r: string | FakeRequest) {
          return m.delete(keyOf(r));
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (url: string) => void opened.push(url),
    },
  };
  vm.runInContext(readFileSync('public/sw.js', 'utf8'), vm.createContext({ self, caches, fetch: fetchImpl, URL, Response, Promise, console }));

  const lifecycle = async (type: 'install' | 'activate') => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers[type]!({ waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  const request = (path: string, init: Partial<FakeRequest> = {}): Promise<Response> | null => {
    let responded: Promise<Response> | null = null;
    handlers.fetch!({ request: { url: new URL(path, ORIGIN).href, method: 'GET', mode: 'cors', ...init }, respondWith: (p: Promise<Response>) => (responded = p) });
    return responded;
  };
  const tapNotification = async (data: unknown) => {
    let pending: Promise<unknown> = Promise.resolve();
    let closed = false;
    handlers.notificationclick!({ notification: { data, close: () => (closed = true) }, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
    return closed;
  };
  return { stores, calls, lifecycle, request, tapNotification };
}

const online = async (url: string) =>
  new Response(`body of ${new URL(url).pathname}`, { status: 200, headers: { 'Content-Type': url.endsWith('/') ? 'text/html' : 'text/plain' } });
const offline = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch');
};

describe('service worker', () => {
  it('never intercepts API, WebSocket, cross-origin or non-GET requests', () => {
    const sw = loadWorker(online);
    expect(sw.request('/api/me')).toBeNull();
    expect(sw.request('/api/trees/abc/messages')).toBeNull();
    expect(sw.request('/ws')).toBeNull();
    expect(sw.request('/assets/app.js', { method: 'POST' })).toBeNull();
    expect(sw.request('https://i.scdn.co/image/1')).toBeNull();
  });

  it('serves pages from the network and shows an offline page without a connection', async () => {
    let network = online;
    const sw = loadWorker((u) => network(u));
    const page = await sw.request('/library', { mode: 'navigate' })!;
    expect(page.status).toBe(200);
    network = offline;
    const down = await sw.request('/library', { mode: 'navigate' })!;
    expect(down.status).toBe(503);
    expect(await down.text()).toContain('You’re offline');
  });

  it('caches hashed assets and reuses them', async () => {
    const sw = loadWorker(online);
    await sw.request('/assets/index-abc.js')!;
    const before = sw.calls.length;
    expect(await (await sw.request('/assets/index-abc.js')!).text()).toBe('body of /assets/index-abc.js');
    expect(sw.calls.length).toBe(before);
  });

  it('precaches only the public shell and drops caches from older versions', async () => {
    const sw = loadWorker(online);
    await sw.lifecycle('install');
    await sw.request('/assets/x.js')!;
    sw.stores.set('somm-shell-v0', new Map());
    await sw.lifecycle('activate');
    expect([...sw.stores.keys()].sort()).toEqual(['somm-assets-v1', 'somm-shell-v1']);
    const cached = [...sw.stores.values()].flatMap((m) => [...m.keys()].map((u) => new URL(u).pathname));
    expect(cached.some((p) => p.startsWith('/api'))).toBe(false);
    expect(cached).toContain('/');
  });

  it('opens the Tree chat when a message notification is tapped, reusing an open window', async () => {
    const opened: string[] = [];
    const sw = loadWorker(online, [], opened);
    expect(await sw.tapNotification({ url: '/trees/neon-garden/chat' })).toBe(true);
    expect(opened).toEqual([`${ORIGIN}/trees/neon-garden/chat`]);

    const visited: string[] = [];
    const win: FakeWindow = { url: `${ORIGIN}/map`, focus: async () => win, navigate: async (u) => (visited.push(u), win) };
    const reuse = loadWorker(online, [win], opened);
    await reuse.tapNotification({ url: '/trees/neon-garden/chat' });
    expect(visited).toEqual([`${ORIGIN}/trees/neon-garden/chat`]);
    expect(opened).toHaveLength(1);

    // A notification can never send the app to another site.
    await reuse.tapNotification({ url: 'https://evil.example/phish' });
    expect(visited).toHaveLength(1);
    expect(opened).toHaveLength(1);
  });
});
