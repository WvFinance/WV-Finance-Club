// Simple Street app helper. It lets phones install the site as an app and
// shows the last saved copy of the page if the internet drops.
// It always asks the network first, so updates show up right away.
// It never touches logins, trades or the news server (/api), or other sites.
const CACHE = "ss-app-v2";
const SHELL = ["./", "index.html", "manifest.webmanifest", "assets/app/favicon-32.png", "assets/app/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/data/")) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" })
      .then(hit => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined))
      .then(hit => hit || Response.error()))
  );
});
