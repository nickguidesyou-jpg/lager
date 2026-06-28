const CACHE = 'sesu-lager-v1';
const SHELL = ['/lager/', '/lager/index.html', '/lager/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // Netværkskald til Apps Script og eksterne API'er bypasses altid
  if (e.request.url.includes('script.google') || e.request.url.includes('upcitemdb') || e.request.url.includes('qrserver')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then(r => r || caches.match('/lager/')))
  );
});
