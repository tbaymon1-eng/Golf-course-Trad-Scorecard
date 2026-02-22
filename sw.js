// sw.js
// Better caching strategy for GitHub Pages + iOS Safari:
// - HTML: network-first (gets updates)
// - Assets: cache-first (fast)
// - Cleans old caches when version changes

const CACHE_VERSION = "v7"; // <--- BUMP THIS when you deploy changes (v8, v9...)
const CACHE_NAME = `cypresswood-scorecard-${CACHE_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./pwa.js",
  "./assets/cypresswood_header.png",
  "./assets/cypress_header.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET to our origin
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isHTML =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html") ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html");

  if (isHTML) {
    // NETWORK-FIRST for HTML (this is the key to no-hard-reset updates)
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // CACHE-FIRST for assets (images, css, js)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        });
    })
  );
});
