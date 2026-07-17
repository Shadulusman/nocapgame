const CACHE = "nocap-v11";
const ASSETS = [
  "./",
  "./index.html",
  "./online.html",
  "./gsap.min.js",
  "./manifest.json",
  "./icons/nocap-logo.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // live data (the open-rooms list) must never be cached — cache-first below
  // would otherwise freeze it at whatever it was on the very first fetch
  if (new URL(req.url).pathname === "/rooms") { e.respondWith(fetch(req)); return; }
  // network-first for navigation, cache-first for the rest
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        // only cache real successes — caching a 404/opaque error would otherwise
        // "stick" (e.g. a logo requested before it deployed showed as broken forever)
        if (res && res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached)
    )
  );
});
