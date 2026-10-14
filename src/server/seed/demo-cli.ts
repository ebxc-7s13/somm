import { loadConfig, loadDotEnv } from '../config';
import { openDatabase } from '../db';
import { seedDemo } from './demo';

loadDotEnv();
const config = loadConfig();
const db = await openDatabase({ url: config.databaseUrl, dataDir: config.pgliteDataDir });
try {
  const result = await seedDemo(db, config, { reset: process.argv.includes('--reset') });
  if (result.skipped) {
    console.log('[somm] demo data already present — run `npm run seed:demo -- --reset` to rebuild it.');
  } else {
    console.log(`[somm] seeded ${result.listeners} fictional demo listeners and ${result.trees} Trees:`);
    for (const t of result.treeNames ?? []) console.log(`  • ${t.name} (${t.member_count} members)`);
  }
} finally {
  await db.close();
}
