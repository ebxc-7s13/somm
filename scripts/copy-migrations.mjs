// Copies SQL migrations next to the bundled server (dist/server/migrations).
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/server/migrations', { recursive: true });
cpSync('src/server/db/migrations', 'dist/server/migrations', { recursive: true });
console.log('[somm] copied migrations to dist/server/migrations');
