/* Physical AI 개념 지도 — service worker
 * shell (index.html, assets/*, data/version.json): network-first, cache fallback (offline)
 * versioned data (?v=<hash>): cache-first; older versions of the same file are pruned */
const SHELL = 'pai-shell-v1', DATA = 'pai-data-v1';
const SHELL_FILES = ['./', 'index.html', 'assets/app.css', 'assets/app.js', 'data/version.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.searchParams.has('v')) { e.respondWith(cacheFirst(req, url)); return; }
  e.respondWith(networkFirst(req));
});
async function cacheFirst(req, url) {
  const c = await caches.open(DATA);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await c.put(req, res.clone());
    for (const k of await c.keys()) {               // drop older versions of this file
      const u = new URL(k.url);
      if (u.pathname === url.pathname && u.search !== url.search) c.delete(k);
    }
  }
  return res;
}
async function networkFirst(req) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
