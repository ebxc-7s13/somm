// Vercel deployment settings shared by scripts/build-vercel.mjs and the tests.
/** Same policy the API sends (src/server/app.ts), for the static pages. */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://i.scdn.co https://*.mzstatic.com",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '),
};

export const ROUTES = [
  { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
  { src: '^/sw\\.js$', headers: { 'Cache-Control': 'no-cache' }, continue: true },
  { src: '^/(?!api/).*$', headers: SECURITY_HEADERS, continue: true },
  // One function serves the whole API; it restores the path from __path (src/vercel/handler.ts).
  { src: '^/api/(.*)$', dest: '/api?__path=$1' },
  { handle: 'filesystem' },
  // Single-page app: every other path is the client.
  { src: '^/(.*)$', dest: '/index.html' },
];

/** Hobby plans allow one run a day; timing within the hour is not guaranteed. */
export const CRONS = [{ path: '/api/internal/cron', schedule: '17 21 * * *' }];

export const FUNCTION_CONFIG = {
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  maxDuration: 300,
  // Singapore: the same region as the Neon database (aws-ap-southeast-1).
  regions: ['sin1'],
};
