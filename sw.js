// Service worker: offline app shell, offline OCR engine after first use, and "Share to UPC Finder".
const VERSION = 'upc-finder-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/db.js', 'js/repo.js', 'js/scorer.js', 'js/text.js', 'js/gtin.js', 'js/parser.js', 'js/barcode.js',
  'js/providers.js', 'js/ocr.js', 'js/scanner.js',
];
// OCR/scanner engines (WASM + English model) are cached the first time they load, so OCR then works offline.
const ENGINE_HOSTS = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('upc-finder-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Image shared from another app → stash it, then open the app on the crop screen.
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const file = form.get('image');
      if (file) await (await caches.open('shared')).put('shared-image', new Response(file));
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;

  // App shell: serve from cache, refresh in the background.
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit ?? net;
    }));
    return;
  }

  // OCR / barcode engines: cache-first.
  if (ENGINE_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(`${VERSION}-engines`).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
  }
  // Product APIs and images: always network (lookups are cached in IndexedDB by the app itself).
});
