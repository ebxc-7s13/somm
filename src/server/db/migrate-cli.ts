import { loadConfig, loadDotEnv } from '../config';
import { migrate, openDatabase } from './index';

loadDotEnv();
const config = loadConfig();
const db = await openDatabase({ url: config.databaseUrl, dataDir: config.pgliteDataDir, migrate: false });
try {
  const ran = await migrate(db);
  console.log(ran.length ? `[somm] applied migrations: ${ran.join(', ')}` : '[somm] database schema is up to date');
} finally {
  await db.close();
}
