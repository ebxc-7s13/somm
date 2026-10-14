/*
 * SOMM service worker. Makes the app installable and lets it open offline with a
 * clear message. It never caches /api or /ws responses, so no library, profile
 * or chat data is stored by the worker — only the public app shell and assets.
 */
const SHELL_CACHE = 'somm-shell-v1';
const ASSET_CACHE = 'somm-assets-v1';
const MAX_ASSETS = 80;
const SHELL_FILES = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname.startsWith('/icons/') || url.pathname === '/favicon.svg' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// Pages: always try the network so a deploy is picked up immediately.
async function navigate(request) {
  try {
    const response = await fetch(request);
    if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put('/', response.clone());
    }
    return response;
  } catch {
    return offlinePage();
  }
}

// Hashed build files never change, so a cached copy is always correct.
async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(old);
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit);
  return hit || update;
}

function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#071A52"><title>SOMM — offline</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #071A52; color: #fff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; text-align: center; }
  main { padding: 24px; max-width: 30rem; display: grid; gap: 12px; justify-items: center; }
  p { margin: 0; color: #C9D3F5; line-height: 1.5; }
  button { min-height: 48px; padding: 0 28px; border: 0; border-radius: 999px; background: #FFD83D; color: #071A52; font: inherit; font-weight: 700; }
  button:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
</style></head><body><main>
<img src="/favicon.svg" alt="" width="64" height="64">
<h1 style="margin:0;font-size:1.4rem">You’re offline</h1>
<p>SOMM needs a connection to load your library, Music Mind and Trees. Nothing personal is stored on this device for offline use.</p>
<button type="button" onclick="location.reload()">Try again</button>
</main></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
