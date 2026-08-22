// BlockVerse service worker - caches just the app shell (this file + the
// page itself) so the app can still launch instantly on a flaky
// connection. It deliberately does NOT try to cache Firebase traffic or
// the three.js CDN script - those need a live network anyway for
// multiplayer to work, so caching them would just risk serving stale data.

const CACHE_NAME = "blockverse-shell-v1";
const SHELL_FILES = [
  "./Index.html",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // only handle same-origin GET requests for the shell files themselves -
  // everything else (Firebase, three.js CDN, etc.) goes straight to the
  // network untouched
  if(event.request.method !== "GET" || url.origin !== self.location.origin){
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if(response && response.status === 200){
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached); // offline - fall back to whatever's cached
      // stale-while-revalidate: show the cached shell instantly if we have
      // one, but always fetch a fresh copy in the background too
      return cached || network;
    })
  );
});
