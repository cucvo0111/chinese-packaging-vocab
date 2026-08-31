// Minimal offline-first service worker: caches the app shell + base vocab
// data on install, serves cache-first with a network fallback/update.
// AI generation calls (api.anthropic.com) are never cached - they pass
// straight through to the network.
const CACHE_NAME = 'cpv-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/db.js',
  './js/srs.js',
  './js/tts.js',
  './js/importer.js',
  './js/quiz.js',
  './js/charts.js',
  './js/ai.js',
  './js/app.js',
  './data/vocab-base.json',
  './data/categories.json',
  './data/dialogues.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(ASSETS); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // never intercept AI/API calls
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      const networkFetch = fetch(event.request).then(function (res) {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || networkFetch;
    })
  );
});
