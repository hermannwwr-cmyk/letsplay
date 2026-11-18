// Let's Play! service worker: keeps a copy of the hub and the three games so the Home Screen app
// opens without a network. Registered from index.html on https only.
//
// Bump VERSION on every release (any change to index.html, games/ or icons/), so the new files are
// fetched and the old copy is dropped.
const VERSION = 'lets-play-v1';
const FONTS = 'lets-play-fonts';            // the bus game's Google Font, cached the first time it loads

// Must all exist: if one is missing the install fails and the old copy stays in use.
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './games/bus/index.html',
  './games/bus/game.js',
  './games/bus/style.css',
  './games/grizzly/index.html',
  './games/mrt/index.html',
];
// Nice to have (the games' own icons and manifests); skipped quietly if missing.
const EXTRA = [
  './games/grizzly/manifest.webmanifest',
  './games/grizzly/icons/favicon-32.png',
  './games/grizzly/icons/apple-touch-icon.png',
  './games/mrt/manifest.webmanifest',
  './games/mrt/icons/icon-180.png',
  './games/mrt/icons/icon-192.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(EXTRA.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION && k !== FONTS).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Pages and code (html, js, css, manifest) come from the network first, so a change pushed to GitHub
// shows on the next launch with a connection; the cached copy is used offline or when the network is
// slower than a few seconds (the fresh copy still lands in the cache for next time).
// Everything else (icons, images) comes from the cache first.
const FRESH = /(\/|\.html|\.js|\.css|\.webmanifest)$/;
const NET_WAIT = 4000;

async function fromCache(req) {
  return (await caches.match(req, { ignoreSearch: true })) ||        // games load as index.html?hub=1
    (req.mode === 'navigate' ? caches.match('./index.html') : undefined);
}
async function store(cacheName, req, res) {
  if (!res || !(res.ok || res.type === 'opaque')) return;
  try {
    const cache = await caches.open(cacheName);
    const url = new URL(req.url); url.search = '';                     // one copy per file, whatever the query
    await cache.put(cacheName === VERSION ? url.href : req, res);
  } catch (e) { /* storage full or not allowed */ }
}

async function networkFirst(event) {
  const req = event.request;
  const net = fetch(req);
  event.waitUntil(net.then(res => store(VERSION, req, res.clone())).catch(() => {}));   // keep the fresh copy
  const cached = fromCache(req);
  let timer;
  const slow = new Promise(resolve => { timer = setTimeout(resolve, NET_WAIT); });
  try {
    const first = await Promise.race([net, slow.then(async () => (await cached) || net)]);
    return first || (await cached) || net;
  } catch (e) {
    const hit = await cached;
    if (hit) return hit;
    throw e;
  } finally { clearTimeout(timer); }
}

async function cacheFirst(event, cacheName) {
  const req = event.request;
  const hit = cacheName === FONTS ? await caches.match(req) : await fromCache(req);
  if (hit) return hit;
  // (fetch starts after the cache lookup; respondWith is still pending, so waitUntil is allowed)
  const res = fetch(req);
  event.waitUntil(res.then(r => store(cacheName, req, r.clone())).catch(() => {}));
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event, FONTS));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' || FRESH.test(url.pathname)) event.respondWith(networkFirst(event));
  else event.respondWith(cacheFirst(event, VERSION));
});
