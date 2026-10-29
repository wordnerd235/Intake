// sw.js - offline support. After changing any app file run `python scripts/update-precache.py`: it refreshes the PRECACHE list
// and stamps a new CACHE_VERSION, which is what makes installed copies show the "Update available" bar. (Bumping CACHE_VERSION by hand also works.)
// Strategy: the app shell is precached in a versioned cache and served cache-first (so every page load is internally
// consistent); data/foods.json is cached separately and refreshed in the background; CDN scripts for sync / barcode
// scanning are runtime-cached. API calls (Firebase, Open Food Facts, USDA) are never touched by this worker.
const CACHE_VERSION = '9fd9dd93';
const SHELL = `intake-v${CACHE_VERSION}`;
const DATA = 'intake-data';
const CDN = 'intake-cdn';

const PRECACHE = [
  './',
  './css/components.css',
  './css/layout.css',
  './css/tokens.css',
  './data/exercises.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  './icons/maskable-512.png',
  './index.html',
  './js/backup.js',
  './js/barcode.js',
  './js/bus.js',
  './js/charts.js',
  './js/cloud.js',
  './js/components.js',
  './js/dates.js',
  './js/day.js',
  './js/db.js',
  './js/default-serving.js',
  './js/facts.js',
  './js/firebase-backend.js',
  './js/firebase-config.js',
  './js/foods-db.js',
  './js/foods-search.js',
  './js/icons.js',
  './js/import-file.js',
  './js/main.js',
  './js/normalize.js',
  './js/nutrition.js',
  './js/online-foods.js',
  './js/overlay.js',
  './js/platform.js',
  './js/quick-sheets.js',
  './js/router.js',
  './js/state.js',
  './js/store-foods.js',
  './js/store.js',
  './js/sync-core.js',
  './js/sync.js',
  './js/tabsync.js',
  './js/theme.js',
  './js/ui.js',
  './js/units.js',
  './js/version.js',
  './js/views/account.js',
  './js/views/add-food.js',
  './js/views/diary.js',
  './js/views/exercise.js',
  './js/views/food-detail.js',
  './js/views/food-editor.js',
  './js/views/foods.js',
  './js/views/onboarding.js',
  './js/views/progress.js',
  './js/views/recipe-editor.js',
  './js/views/settings-data.js',
  './js/views/settings-targets.js',
  './js/views/settings.js',
  './js/views/today.js',
  './manifest.webmanifest',
];
const DATA_FILES = ['./data/foods.json'];
const CDN_HOSTS = ['www.gstatic.com', 'unpkg.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    // cache: 'reload' bypasses the HTTP cache so a new version never precaches stale files.
    await shell.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
    const data = await caches.open(DATA);
    await Promise.allSettled(DATA_FILES.map((u) => data.add(new Request(u, { cache: 'reload' })))); // best effort: 1.5 MB
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('intake-v') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (CDN_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(req, CDN));
    return; // everything else (APIs) goes straight to the network
  }
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html', { cacheName: SHELL }).then((r) => r || fetch(req)));
    return;
  }
  if (DATA_FILES.some((f) => url.pathname.endsWith(f.slice(1)))) {
    event.respondWith(staleWhileRevalidate(req, DATA));
    return;
  }
  event.respondWith(caches.match(req, { cacheName: SHELL, ignoreSearch: true }).then((r) => r || fetch(req)));
});
