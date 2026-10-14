/**
 * Runs once per `vitest` invocation. Starting PGlite from scratch runs initdb
 * (~7–9 s); restoring a dumped data directory takes ~1 s. So build one migrated
 * snapshot, cache it under node_modules/.cache keyed by the PGlite version and
 * the migration files, and let every test worker start from it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TestProject } from 'vitest/node';
import { dumpDatabase, openDatabase } from '../src/server/db';

declare module 'vitest' {
  export interface ProvidedContext {
    pgliteSnapshot: string;
  }
}

export default async function setup(project: TestProject) {
  const migrations = resolve('src/server/db/migrations');
  const hash = createHash('sha256');
  hash.update(JSON.parse(readFileSync(resolve('node_modules/@electric-sql/pglite/package.json'), 'utf8')).version as string);
  for (const file of readdirSync(migrations).sort()) hash.update(file).update(readFileSync(join(migrations, file)));
  const cacheDir = resolve('node_modules/.cache/somm');
  const name = `pglite-${hash.digest('hex').slice(0, 16)}.tar`;
  const path = join(cacheDir, name);
  if (!existsSync(path)) {
    mkdirSync(cacheDir, { recursive: true });
    for (const old of readdirSync(cacheDir)) if (old.startsWith('pglite-')) rmSync(join(cacheDir, old));
    const db = await openDatabase({ dataDir: null });
    const snapshot = await dumpDatabase(db);
    await db.close();
    writeFileSync(path, Buffer.from(await snapshot.arrayBuffer()));
  }
  project.provide('pgliteSnapshot', path);
}
