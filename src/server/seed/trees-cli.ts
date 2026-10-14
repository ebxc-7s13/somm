/** Run Tree proposal clustering over discoverable listeners (`npm run trees:generate`). */
import { loadConfig, loadDotEnv } from '../config';
import { openDatabase } from '../db';
import { generateProposals } from '../services/communities';

loadDotEnv();
const config = loadConfig();
const db = await openDatabase({ url: config.databaseUrl, dataDir: config.pgliteDataDir });
try {
  const r = await generateProposals(db, config.matchWeights);
  console.log(`[somm] clusters: ${r.clusters}, new proposed Trees: ${r.created.length}, existing Trees extended: ${r.extended.length}`);
} finally {
  await db.close();
}
