// Smoke test for the Vercel build (.vercel/output): loads the bundled function the way
// Vercel's Node.js launcher does — a (req, res) handler — and checks that it answers.
//   Without DATABASE_URL: it must load and explain that the database is missing (503).
//   With DATABASE_URL:    health and client-config must work against that database
//                         (start-up applies any pending migrations).
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const OUT = '.vercel/output';
const FUNC = `${OUT}/functions/api.func`;
const fail = (message) => {
  console.error(`[smoke] FAILED: ${message}`);
  process.exit(1);
};

for (const file of [`${OUT}/config.json`, `${OUT}/static/index.html`, `${FUNC}/.vc-config.json`, `${FUNC}/migrations`]) {
  if (!existsSync(file)) fail(`${file} is missing — run npm run build:vercel first`);
}
const vc = JSON.parse(readFileSync(`${FUNC}/.vc-config.json`, 'utf8'));
process.env.VERCEL = '1';
const withDatabase = !!process.env.DATABASE_URL;

const { default: handler } = await import(pathToFileURL(`${FUNC}/${vc.handler}`).href);
if (typeof handler !== 'function') fail('the function does not export a (req, res) handler');

const server = createServer(handler);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const health = await fetch(`${base}/api?__path=health`);
  const body = await health.json();
  if (!withDatabase) {
    if (health.status !== 503 || !/DATABASE_URL/.test(body.error?.message ?? '')) fail(`expected a 503 about DATABASE_URL, got ${health.status} ${JSON.stringify(body)}`);
    console.log('[smoke] bundle loads; without a database it answers 503 with a clear message');
  } else {
    if (health.status !== 200 || body.realtime !== 'poll') fail(`health: ${health.status} ${JSON.stringify(body)}`);
    const cfg = await (await fetch(`${base}/api?__path=client-config`)).json();
    if (cfg.realtime !== 'poll' || cfg.calls !== false) fail(`client-config: ${JSON.stringify(cfg)}`);
    const me = await fetch(`${base}/api?__path=me`);
    if (me.status !== 401) fail(`/api/me without a session should be 401, got ${me.status}`);
    console.log('[smoke] bundle works against the database: health, client-config and auth checks passed');
  }
} finally {
  server.close();
}
process.exit(0);
