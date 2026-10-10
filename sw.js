// BlockVerse service worker - caches the app shell, and handles periodic
// sync, background sync and push notifications. It deliberately does NOT
// cache Firebase traffic or the three.js CDN script (live network needed).

// bump this string to force-invalidate old cached copies
const CACHE_NAME = "blockverse-shell-v5";
const SHELL_FILES = [
  "./Index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // add one by one so a single missing file can't fail the whole install
      Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => {})))
    )
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

// network-first: fresh copy when online, cached copy when offline
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if(event.request.method !== "GET" || url.origin !== self.location.origin){
    return;
  }
  // anything with a query string (connection probes, cache-busters, ?launch= links) goes
  // straight to the network and is never cached
  if(url.search){
    return;
  }
  // "no-cache" = always re-check with the server first, so a new Index.html shows up right away
  // instead of waiting for the browser's own 10 minute cache
  event.respondWith(
    fetch(event.request.url, { cache: "no-cache" })
      .then((response) => {
        if(response && response.status === 200){
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("./Index.html")))
  );
});

// re-download the shell files so the offline copy stays fresh
async function refreshShell(){
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(SHELL_FILES.map((f) =>
    fetch(f, { cache: "no-store" })
      .then((r) => { if(r && r.status === 200) return cache.put(f, r); })
      .catch(() => {})
  ));
}

// Periodic Background Sync
self.addEventListener("periodicsync", (event) => {
  if(event.tag === "blockverse-refresh"){
    event.waitUntil(refreshShell());
  }
});

// Background Sync - runs once the connection comes back
self.addEventListener("sync", (event) => {
  if(event.tag === "blockverse-sync"){
    event.waitUntil(refreshShell());
  }
});

// Push Notifications
self.addEventListener("push", (event) => {
  let data = {};
  try{ data = event.data ? event.data.json() : {}; }catch(e){ data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "BlockVerse";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "You have a new notification",
      icon: "icon-192.png",
      badge: "icon-192.png",
      data: { url: data.url || "./Index.html" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./Index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for(const c of list){
        if("focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

// Widgets (Windows 11 widgets board)
async function updateWidget(widget){
  try{
    const tpl = await (await fetch("widgets/quick.json")).text();
    const data = await (await fetch("widgets/quick-data.json")).text();
    await self.widgets.updateByTag(widget.definition.tag, { template: tpl, data: data });
  }catch(e){}
}
self.addEventListener("widgetinstall", (event) => { if(self.widgets) event.waitUntil(updateWidget(event.widget)); });
self.addEventListener("widgetresume", (event) => { if(self.widgets) event.waitUntil(updateWidget(event.widget)); });
self.addEventListener("widgetclick", (event) => {
  if(event.action === "open") event.waitUntil(self.clients.openWindow("./Index.html"));
});
