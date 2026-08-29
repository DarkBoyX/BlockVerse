// BlockVerse service worker - caches just the app shell (this file + the
// page itself) so the app can still launch instantly on a flaky
// connection. It deliberately does NOT try to cache Firebase traffic or
// the three.js CDN script - those need a live network anyway for
// multiplayer to work, so caching them would just risk serving stale data.

// bump this string every time you want to force-invalidate old cached
// copies (e.g. if you notice updates aren't showing up) - the activate
// handler below deletes any cache whose name doesn't match this one
const CACHE_NAME = "blockverse-shell-v2";
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

  // network-first, not stale-while-revalidate: try the live copy first so
  // a fresh Index.html shows up on THIS load (not "next time"), and only
  // fall back to the cached copy if the network request actually fails
  // (offline). This is what stale-while-revalidate was getting wrong -
  // it always served the OLD cached copy immediately regardless of
  // whether a newer one was reachable, so every update needed an extra
  // reopen before it became visible.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if(response && response.status === 200){
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request)) // offline - fall back to whatever's cached
  );
});
