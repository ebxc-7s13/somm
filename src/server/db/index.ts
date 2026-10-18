/**
 * PostgreSQL access with two interchangeable drivers:
 *   - production: `pg` (node-postgres) against DATABASE_URL (e.g. Neon);
 *   - local development and tests: PGlite — Postgres compiled to WebAssembly,
 *     running in-process with nothing to install (data in ./data/pglite or memory).
 *
 * Call sites use `all / get / run / tx` with `?` placeholders (or `:name` with an
 * object), which are rewritten to `$1…$n`. Inside `tx(db, fn)` every query is routed
 * to the transaction's connection automatically (AsyncLocalStorage), so code does not
 * need to pass a transaction handle around.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export type Param = string | number | boolean | null | undefined;
export type Params = Record<string, Param> | Param[];

interface Queryable {
  query(text: string, values: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
  /** Multi-statement SQL without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface DB extends Queryable {
  kind: 'pglite' | 'pg';
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** PGlite only. */
  dump?(): Promise<Blob>;
}

const INT8 = 20;
const NUMERIC = 1700;

// ------------------------------------------------------------------ drivers

async function openPglite(dataDir: string | null, snapshot?: Blob): Promise<DB> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  // Loaded on demand: production (node-postgres) never needs the WebAssembly build.
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(dataDir ?? undefined, {
    parsers: { [INT8]: (v: string) => Number(v), [NUMERIC]: (v: string) => Number(v) },
    ...(snapshot ? { loadDataDir: snapshot } : {}),
  });
  const wrap = (q: Pick<PGlite, 'query' | 'exec'>): Queryable => ({
    async query(text, values) {
      const r = await q.query(text, values);
      return { rows: r.rows as unknown[], rowCount: r.affectedRows ?? r.rows.length };
    },
    async exec(sql) {
      await q.exec(sql);
    },
  });
  const base = wrap(db);
  return {
    kind: 'pglite',
    ...base,
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
    dump: () => db.dumpDataDir('none'),
  };
}

let pgParsersSet = false;

async function openPg(connectionString: string, onPool?: (pool: pg.Pool) => void): Promise<DB> {
  if (!pgParsersSet) {
    pg.types.setTypeParser(INT8, (v) => Number(v));
    pg.types.setTypeParser(NUMERIC, (v) => Number(v));
    pgParsersSet = true;
  }
  const url = new URL(connectionString);
  // node-postgres expresses channel binding as an option rather than a URL parameter.
  const channelBinding = url.searchParams.get('channel_binding') === 'require';
  url.searchParams.delete('channel_binding');
  // node-postgres already treats prefer/require/verify-ca as verify-full; say so explicitly
  // (keeps certificate verification and silences its deprecation warning).
  if (['prefer', 'require', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? '')) url.searchParams.set('sslmode', 'verify-full');
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    enableChannelBinding: channelBinding,
  });
  // Serverless Postgres (e.g. Neon) closes idle connections when it suspends; never crash on that.
  pool.on('error', (err) => console.error('[somm] idle database connection closed:', err.message));
  onPool?.(pool);
  const wrap = (q: { query: (text: string, values?: unknown[]) => Promise<pg.QueryResult> }): Queryable => ({
    async query(text, values) {
      const r = await q.query(text, values);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async exec(sql) {
      await q.query(sql);
    },
  });
  const base = wrap(pool);
  return {
    kind: 'pg',
    ...base,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// ------------------------------------------------------------------ helpers

const txContext = new AsyncLocalStorage<Queryable>();
const converted = new Map<string, { text: string; names: string[] | null }>();

/** Rewrite `?` (positional) or `:name` (named) placeholders to `$n`. `::casts` are left alone. */
function convert(sql: string, named: boolean): { text: string; names: string[] | null } {
  const key = `${named ? 'n' : 'p'}${sql}`;
  const hit = converted.get(key);
  if (hit) return hit;
  let result: { text: string; names: string[] | null };
  if (named) {
    const names: string[] = [];
    const text = sql.replace(/(?<![:\w]):([A-Za-z_]\w*)/g, (_m, name: string) => {
      let i = names.indexOf(name);
      if (i < 0) {
        names.push(name);
        i = names.length - 1;
      }
      return `$${i + 1}`;
    });
    result = { text, names };
  } else {
    let i = 0;
    result = { text: sql.replace(/\?/g, () => `$${++i}`), names: null };
  }
  converted.set(key, result);
  return result;
}

function bind(sql: string, params: Params | undefined): { text: string; values: unknown[] } {
  if (params === undefined || Array.isArray(params)) {
    const { text } = convert(sql, false);
    return { text, values: (params ?? []).map((v) => (v === undefined ? null : v)) };
  }
  const { text, names } = convert(sql, true);
  return { text, values: names!.map((n) => (params[n] === undefined ? null : params[n])) };
}

function target(db: DB): Queryable {
  return txContext.getStore() ?? db;
}

export async function all<T>(db: DB, sql: string, params?: Params): Promise<T[]> {
  const { text, values } = bind(sql, params);
  return (await target(db).query(text, values)).rows as T[];
}

export async function get<T>(db: DB, sql: string, params?: Params): Promise<T | undefined> {
  return (await all<T>(db, sql, params))[0];
}

export async function run(db: DB, sql: string, params?: Params): Promise<{ changes: number }> {
  const { text, values } = bind(sql, params);
  return { changes: (await target(db).query(text, values)).rowCount };
}

/** Run `fn` in a transaction. Nested calls join the outer transaction. */
export async function tx<T>(db: DB, fn: () => Promise<T>): Promise<T> {
  if (txContext.getStore()) return fn();
  return db.transaction((q) => txContext.run(q, fn));
}

export function newId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}

export function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

// --------------------------------------------------------------- migrations

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Source layout: src/server/db/migrations. Bundled layout: dist/server/migrations.
  for (const candidate of [join(here, 'migrations'), join(here, 'db', 'migrations')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Migrations directory not found next to ${here}`);
}

export async function migrate(db: DB): Promise<number[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const ran: number[] = [];
  for (const file of files) {
    const version = Number(file.split('_')[0]);
    const sql = readFileSync(join(dir, file), 'utf8');
    const applied = await db.transaction(async (q) => {
      // Serialise concurrent starts (e.g. two instances booting at once).
      await q.query('SELECT pg_advisory_xact_lock(5766000)', []);
      const done = await q.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (done.rows.length) return false;
      await q.exec(sql);
      await q.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [version, nowIso()]);
      return true;
    });
    if (applied) ran.push(version);
  }
  return ran;
}

export interface OpenOptions {
  /** postgres:// URL → node-postgres; otherwise PGlite. */
  url?: string | null;
  /** PGlite data directory; null or "memory://" for an in-memory database. */
  dataDir?: string | null;
  migrate?: boolean;
  /** PGlite only: start from a `dumpDataDir()` snapshot instead of running initdb (tests). */
  snapshot?: Blob;
  /** node-postgres only: called with the pool once created (serverless hosts manage idle clients). */
  onPool?: (pool: pg.Pool) => void;
}

export async function openDatabase(options: OpenOptions = {}): Promise<DB> {
  const url = options.url?.trim();
  const db =
    url && /^postgres(ql)?:\/\//.test(url)
      ? await openPg(url, options.onPool)
      : await openPglite(!options.dataDir || options.dataDir === 'memory://' ? null : options.dataDir, options.snapshot);
  if (options.migrate !== false) await migrate(db);
  return db;
}

/** Empty every application table (tests). */
/** PGlite only: a tarball of the data directory, restorable with `snapshot`. */
export async function dumpDatabase(db: DB): Promise<Blob> {
  if (!db.dump) throw new Error('Only PGlite databases can be dumped.');
  return db.dump();
}

export async function resetDatabase(db: DB): Promise<void> {
  const tables = await all<{ tablename: string }>(
    db,
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'",
  );
  if (tables.length) await db.exec(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}
