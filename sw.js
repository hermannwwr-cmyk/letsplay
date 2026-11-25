// Let's Play! service worker: keeps a copy of the hub and the three games so the Home Screen app
// opens without a network. Registered from index.html on https only.
//
// Bump VERSION on every release (any change to index.html, games/ or icons/), so the new files are
// fetched and the old copy is dropped.
const VERSION = 'lets-play-v6';
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
  './games/bus3d/index.html',
  './games/bus3d/vendor/three.min.js',
  './games/bus3d/js/core.js',
  './games/bus3d/js/fleet.js',
  './games/bus3d/js/world.js',
  './games/bus3d/js/bus.js',
  './games/bus3d/js/jobs.js',
  './games/bus3d/js/depot.js',
  './games/bus3d/js/ui.js',
  './games/bus3d/js/main.js',
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
    const existed = await caches.has(VERSION);
    const cache = await caches.open(VERSION);
    try {
      await cache.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    } catch (e) {
      if (!existed) await caches.delete(VERSION);       // don't leave an empty cache behind a failed install
      throw e;
    }
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

// A request that hangs (a captive Wi-Fi page, a blocked host) is given up after a while, so it can't
// keep this worker busy and hold back the next version.
function fetchWithin(req, ms, init = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), ms) : 0;
  return fetch(req, ctl ? { ...init, signal: ctl.signal } : init).finally(() => clearTimeout(t));
}
async function fromCache(req) {
  return (await caches.match(req, { ignoreSearch: true })) ||        // games load as index.html?hub=1
    (req.mode === 'navigate' ? caches.match('./index.html') : undefined);
}
// the response is for the file that was asked for (opaque responses have no URL to check)
function samePath(res, req) {
  if (!res.url) return res.type !== 'opaqueredirect';
  const a = new URL(res.url), b = new URL(req.url);
  return a.origin + a.pathname === b.origin + b.pathname;
}
async function store(cacheName, req, res) {
  if (!res || !(res.ok || res.type === 'opaque')) return;
  // never keep a page we were sent to instead (a Wi-Fi login page) under this file's name
  if (res.redirected || !samePath(res, req)) return;
  // an old worker still finishing a request must not bring back the cache a newer version deleted
  if (cacheName === VERSION && !(await caches.has(VERSION))) return;
  try {
    const cache = await caches.open(cacheName);
    const url = new URL(req.url); url.search = '';                     // one copy per file, whatever the query
    await cache.put(cacheName === VERSION ? url.href : req, res);
  } catch (e) { /* storage full or not allowed */ }
}

async function networkFirst(event) {
  const req = event.request;
  // no-cache: check with the server every time (GitHub Pages sends max-age=600; an unchanged file is a cheap 304)
  const raw = fetchWithin(req, 30000, { cache: 'no-cache' });
  event.waitUntil(raw.then(res => store(VERSION, req, res.clone())).catch(() => {}));   // keep the fresh copy
  // an error page (404, 503) counts as no answer when there is a good copy
  // (and so does a redirect or a different page, e.g. a Wi-Fi login page): the cached copy is used instead
  const net = raw.then(res => (res.ok && !res.redirected && samePath(res, req)) ? res : Promise.reject(res));
  const cached = fromCache(req);
  let timer;
  const slow = new Promise(resolve => { timer = setTimeout(resolve, NET_WAIT); });
  try {
    const first = await Promise.race([net, slow.then(async () => (await cached) || net)]);
    return first || (await cached) || net;
  } catch (e) {
    const hit = await cached;
    if (hit) return hit;
    if (e instanceof Response) return e;               // no copy: show the server's own answer
    throw e;
  } finally { clearTimeout(timer); }
}

async function cacheFirst(event, cacheName) {
  const req = event.request;
  const hit = cacheName === FONTS ? await caches.match(req) : await fromCache(req);
  if (hit) return hit;
  const res = fetchWithin(req, cacheName === FONTS ? 8000 : 30000);
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
