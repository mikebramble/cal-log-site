/* Calorie Logbook service worker: keeps the app's own files on the device so it opens without a
   connection. It never touches requests to GitHub, and it stores no log data. */
const CACHE = 'calorie-logbook-1.1.0';
const SHELL = [
  './', 'index.html', 'app.css?v=1.1.0', 'app.js?v=1.1.0', 'manifest.webmanifest',
  'fonts/archivo-latin-wdth-normal.woff2', 'fonts/ibm-plex-mono-latin-400-normal.woff2',
  'fonts/ibm-plex-mono-latin-500-normal.woff2', 'fonts/ibm-plex-mono-latin-600-normal.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('calorie-logbook-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* Own files: answer from the saved copy at once and refresh it in the background, so an update
   shows up the next time the app is opened. Everything else goes straight to the network. */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req) || (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
    const fresh = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; });
    if (hit) { fresh.catch(() => {}); return hit; }
    return fresh;
  }));
});
