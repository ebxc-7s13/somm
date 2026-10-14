import { loadConfig, loadDotEnv } from '../config';
import { migrate, openDatabase } from './index';

loadDotEnv();
const config = loadConfig();
const db = openDatabase(config.databasePath, { migrate: false });
const ran = migrate(db);
console.log(ran.length ? `[somm] applied migrations: ${ran.join(', ')}` : '[somm] database schema is up to date');
db.close();
