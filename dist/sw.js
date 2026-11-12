const CACHE_NAME = 'brickrat-shell-v5';
const OLD_CACHES = ['brickrat-v1', 'brickrat-model-v1'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => OLD_CACHES.includes(key) || (key.startsWith('brickrat-shell-') && key !== CACHE_NAME))
          .map(key => caches.delete(key))
      ))
      .catch(() => {}) // Restricted/full storage must not prevent the worker updating.
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') return;

  // Let the browser and Cloudflare handle large cross-origin assets directly.
  // The GLB should be cached with R2/Cloudflare response headers, not Cache Storage.
  if (!request.url.startsWith(self.registration.scope)) return;

  event.respondWith(networkFirst(request, event));
});

async function networkFirst(request, event) {
  // Unhashed scripts and customer links change in place on deployment. Check
  // the server before using the shell cache, including on repeat visits.
  // Never fall back to an old registry: that can incorrectly reject new slugs.
  const noStore = request.cache === 'no-store' || new URL(request.url).pathname === '/customers.json';
  try {
    const response = await fetch(request, { cache: noStore ? 'no-store' : 'no-cache' });
    if (response.ok && !noStore) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {}));
    }
    return response;
  } catch {
    if (!noStore) {
      try {
        const cached = await (await caches.open(CACHE_NAME)).match(request);
        if (cached) return cached;
      } catch { /* Browsing must still work when Cache Storage is unavailable. */ }
    }
    // Return a response instead of rejecting FetchEvent on a cache miss/offline
    // navigation. The viewer handles a failed registry request as a load error.
    return new Response('Unable to connect. Check your internet connection and reload this page.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
