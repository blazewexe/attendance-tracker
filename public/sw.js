// Cache name updated to 'attendance-tracker-shell-v2' so stale 'daybook-shell-*' caches
// from the previous branding are evicted on next activation.
const VERSION = 'attendance-tracker-shell-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => (key.startsWith('daybook-shell-') || key.startsWith('attendance-tracker-shell-')) && key !== VERSION)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) void caches.open(VERSION).then((cache) => cache.put('./index.html', response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? (await caches.match('./index.html')) ?? Response.error())
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) =>
      cached ?? fetch(request).then((response) => {
        if (response.ok) void caches.open(VERSION).then((cache) => cache.put(request, response.clone()));
        return response;
      })
    )
  );
});
self.addEventListener('message', (event) => { if (event.data === 'SKIP_WAITING') void self.skipWaiting(); });
