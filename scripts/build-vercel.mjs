// Builds the Vercel deployment with the Build Output API (.vercel/output), after `vite build`:
//   static/             the client (dist/client), served from Vercel's CDN
//   functions/api.func  the whole API bundled into one file, in Singapore next to the Neon database
//   config.json         routing (API rewrite, security headers, SPA fallback) and the daily cron
// Vercel uses .vercel/output as-is when the build command produces it.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { CRONS, FUNCTION_CONFIG, ROUTES } from './vercel-config.mjs';

const OUT = '.vercel/output';
const FUNC = `${OUT}/functions/api.func`;

if (!existsSync('dist/client/index.html')) throw new Error('Run `vite build` first (dist/client is missing).');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(FUNC, { recursive: true });

cpSync('dist/client', `${OUT}/static`, { recursive: true });

await build({
  entryPoints: ['src/vercel/handler.ts'],
  outfile: `${FUNC}/index.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Never loaded on Vercel: PGlite is the local-only database; pg's native and Workers bindings are optional.
  external: ['@electric-sql/pglite', 'pg-native', 'pg-cloudflare', 'cloudflare:sockets'],
  // CommonJS dependencies (pg) call require() for Node built-ins.
  banner: { js: "import { createRequire as __somm_createRequire } from 'node:module'; const require = __somm_createRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});
cpSync('src/server/db/migrations', `${FUNC}/migrations`, { recursive: true });
writeFileSync(`${FUNC}/package.json`, JSON.stringify({ type: 'module' }, null, 2));
writeFileSync(`${FUNC}/.vc-config.json`, JSON.stringify(FUNCTION_CONFIG, null, 2));
writeFileSync(`${OUT}/config.json`, JSON.stringify({ version: 3, routes: ROUTES, crons: CRONS }, null, 2));
console.log(`[somm] Vercel build output written to ${OUT}`);
