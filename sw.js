const CACHE = 'rl-v96';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/style.css', './icons/icon.svg',
  './js/app.js', './js/config.js', './js/db.js', './js/files.js', './js/hotkeys.js',
  './js/search.js', './js/store.js', './js/sync.js', './js/timer.js',
  './js/week.js', './js/sheet.js', './js/contacts.js'
];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map(u => c.add(u)));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (navigator.onLine) {
      fetch(e.request).then(res => {
        if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(cc => cc.put(e.request, c)); }
      }).catch(() => {});
    }
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(cc => cc.put(e.request, c)); }
      return res;
    } catch {
      return hit || Response.error();
    }
  })());
});
