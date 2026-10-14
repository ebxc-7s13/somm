/**
 * SQLite access via Node's built-in `node:sqlite` (no native build step).
 * The wrapper is intentionally thin so it can be swapped for better-sqlite3
 * (same synchronous API shape) or ported to PostgreSQL — see docs/ARCHITECTURE.md.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type DB = DatabaseSync;
export type Params = Record<string, SQLInputValue> | SQLInputValue[];

const statementCache = new WeakMap<DB, Map<string, ReturnType<DB['prepare']>>>();

function statement(db: DB, sql: string) {
  let cache = statementCache.get(db);
  if (!cache) {
    cache = new Map();
    statementCache.set(db, cache);
  }
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

function bind(params: Params | undefined): SQLInputValue[] | [Record<string, SQLInputValue>] {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}

export function all<T>(db: DB, sql: string, params?: Params): T[] {
  return statement(db, sql).all(...(bind(params) as SQLInputValue[])) as T[];
}

export function get<T>(db: DB, sql: string, params?: Params): T | undefined {
  return (statement(db, sql).get(...(bind(params) as SQLInputValue[])) as T | undefined) ?? undefined;
}

export function run(db: DB, sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
  const r = statement(db, sql).run(...(bind(params) as SQLInputValue[]));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

const depth = new WeakMap<DB, number>();

/** Run `fn` in a transaction; nested calls use savepoints. */
export function tx<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  const name = `sp${d}`;
  db.exec(d === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  depth.set(db, d + 1);
  try {
    const result = fn();
    db.exec(d === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw err;
  } finally {
    depth.set(db, d);
  }
}

export function newId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}

export function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Source layout: src/server/db/migrations. Bundled layout: dist/server/migrations.
  for (const candidate of [join(here, 'migrations'), join(here, 'db', 'migrations')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Migrations directory not found next to ${here}`);
}

export function migrate(db: DB): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(all<{ version: number }>(db, 'SELECT version FROM schema_migrations').map((r) => r.version));
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const ran: number[] = [];
  for (const file of files) {
    const version = Number(file.split('_')[0]);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    tx(db, () => {
      db.exec(sql);
      run(db, 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [version, nowIso()]);
    });
    ran.push(version);
  }
  return ran;
}

export function openDatabase(path: string, options: { migrate?: boolean } = {}): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  if (options.migrate !== false) migrate(db);
  return db;
}
