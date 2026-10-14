import { createApp, createAppContext, type ContextOptions } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import type { AppContext } from '../../src/server/context';
import { openDatabase } from '../../src/server/db';

export const ORIGIN = 'http://127.0.0.1:5173';

export function testConfig(env: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    PUBLIC_URL: ORIGIN,
    MUSICBRAINZ_ENABLED: 'false',
    DEMO_MODE_ENABLED: 'true',
    ...env,
  } as NodeJS.ProcessEnv);
}

export function createTestServer(options: { env?: Record<string, string> } & ContextOptions = {}) {
  const config = testConfig(options.env);
  const ctx = createAppContext(config, { db: openDatabase(':memory:'), musicbrainz: options.musicbrainz ?? null, ...options });
  const app = createApp(ctx);
  return { app, ctx, client: () => new TestClient(app, ctx) };
}

type App = ReturnType<typeof createApp>;

export interface TestResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** Minimal cookie-carrying client around Hono's app.request(). */
export class TestClient {
  cookie: string | null = null;
  user: { id: string; handle: string } | null = null;

  constructor(
    private readonly app: App,
    readonly ctx: AppContext,
  ) {}

  async req<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<TestResponse<T>> {
    const h: Record<string, string> = { Origin: ORIGIN, ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h['Content-Type'] = h['Content-Type'] ?? 'application/json';
    const res = await this.app.request(path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = setCookie.match(/somm_session=([^;]*)/);
      if (m) this.cookie = m[1] ? `somm_session=${m[1]}` : null;
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.req<T>('GET', path);
  }
  post<T = any>(path: string, body?: unknown) {
    return this.req<T>('POST', path, body);
  }
  patch<T = any>(path: string, body?: unknown) {
    return this.req<T>('PATCH', path, body);
  }
  del<T = any>(path: string, body?: unknown) {
    return this.req<T>('DELETE', path, body);
  }

  async signup(handle: string, password = 'correct-horse-battery') {
    const r = await this.post('/api/auth/signup', { handle, password });
    if (r.status !== 201) throw new Error(`signup failed: ${JSON.stringify(r.body)}`);
    this.user = r.body.user;
    return r.body.user as { id: string; handle: string };
  }

  /** Preview + commit a CSV import; returns the job/playlist ids. */
  async importCsv(content: string, opts: { name?: string; visibility?: 'private' | 'shared' | 'public'; fileName?: string } = {}) {
    const preview = await this.post('/api/imports/preview', { source: 'csv', content, fileName: opts.fileName ?? 'test.csv' });
    if (preview.status !== 200) throw new Error(`preview failed: ${JSON.stringify(preview.body)}`);
    const commit = await this.post(`/api/imports/${preview.body.draftId}/commit`, { name: opts.name, visibility: opts.visibility ?? 'private' });
    if (commit.status !== 201) throw new Error(`commit failed: ${JSON.stringify(commit.body)}`);
    return { preview: preview.body, ...commit.body } as { preview: any; jobId: string; playlistId: string; imported: number };
  }
}

/** Build a CSV (title,artist,album,genre,year) from rows of fictional data. */
export function csv(rows: [string, string, string?, string?, string?][]): string {
  const esc = (v: string | undefined) => (v === undefined ? '' : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ['title,artist,album,genre,year', ...rows.map((r) => [r[0], r[1], r[2], r[3], r[4]].map(esc).join(','))].join('\n');
}

/** A fictional electronic/ambient library of n tracks across the given artists. */
export function electronicCsv(prefix: string, n: number, artists = ['Nova Lattice', 'Pulse Garden', 'Kilo Ray', 'Velvet Static', 'Orbit Choir']) {
  const genres = ['techno', 'ambient', 'synthwave', 'deep house'];
  return csv(Array.from({ length: n }, (_, i) => [`${prefix} ${i + 1}`, artists[i % artists.length]!, `${prefix} LP`, genres[i % genres.length], String(2015 + (i % 8))]));
}

export function jazzCsv(prefix: string, n: number, artists = ['Teo Vance', 'Blue Lantern', 'Mono Quartet']) {
  return csv(Array.from({ length: n }, (_, i) => [`${prefix} ${i + 1}`, artists[i % artists.length]!, `${prefix} Sessions`, i % 2 ? 'hard bop' : 'cool jazz', String(1958 + (i % 10))]));
}
