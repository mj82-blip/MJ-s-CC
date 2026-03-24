const APP_VERSION = '1.0.0';
const CACHE_NAME = 'sg-mortgage-v1.0.0';
const ASSETS = [
  '/MJ-s-CC/',
  '/MJ-s-CC/index.html',
  '/MJ-s-CC/manifest.json',
  '/MJ-s-CC/icon-192.png',
  '/MJ-s-CC/icon-512.png',
  '/MJ-s-CC/icon-maskable-192.png',
  '/MJ-s-CC/icon-maskable-512.png'
];

// Install: precache all assets
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

// Activate: purge old caches, claim clients
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first, then network fallback; update cache in background
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

// Listen for skip-waiting message from client
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
