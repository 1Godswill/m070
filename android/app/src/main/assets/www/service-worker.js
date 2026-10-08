/* St Stephen's Report Card System — service worker.
   Keeps the app working offline. Strategy:
   - App files: try the internet FIRST (so a new version is picked up straight
     away), fall back to the saved copy if offline or the connection is slow.
   - The Excel library from the CDN: saved copy first (it never changes).
   The cache name comes from version.js, so bumping the version there is all
   that is needed to make every device fetch and announce the update. */

importScripts("version.js");

const CACHE_VERSION = "ststephens-reportcard-" + APP_VERSION;
const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const SLOW_NETWORK_MS = 4000; // after this, use the saved copy if we have one

const APP_SHELL = [
  "./",
  "./index.html",
  "./version.js",
  "./app.js",
  "./history.js",
  "./ui.js",
  "./login.js",
  "./sync.js",
  "./qr.js",
  "./qrdec.js",
  "./localsync.js",
  "./admin.js",
  "./promote.js",
  "./export.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/logo.png",
  "./icons/school-bg.jpg"
];

/* Hosts such as Cloudflare Pages redirect /index.html to /. A redirected response
   must never be handed to a page navigation (the browser refuses it and the app
   hangs on its opening screen, especially inside an installed APK), so every copy
   we store or serve is rebuilt as a plain, non-redirected response. */
async function cleanResponse(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // cache: "reload" skips the browser's own cache so we never store stale files
    await Promise.all(APP_SHELL.map(async (u) => {
      const res = await fetch(new Request(u, { cache: "reload" }));
      if (!res.ok) throw new Error("Could not cache " + u);
      await cache.put(u, await cleanResponse(res));
    }));
    // The CDN file is optional at install time: if it can't be reached, the
    // app still installs (it gets saved the first time it's used online).
    try { await cache.add(XLSX_URL); } catch (e) { /* ignore */ }
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (!settled) { settled = true; resolve(res); } };

    const timer = setTimeout(async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) done(cached); // slow connection: show what we have; the download keeps going and refreshes the cache
    }, SLOW_NETWORK_MS);

    fetch(request, { cache: "no-cache" })
      .then((res) => {
        clearTimeout(timer);
        if (res && res.status === 200) {
          cleanResponse(res.clone()).then((copy) => caches.open(CACHE_VERSION).then((c) => c.put(request, copy)));
        }
        done(res);
      })
      .catch(async () => {
        clearTimeout(timer);
        const cached = (await caches.match(request, { ignoreSearch: true })) ||
          (request.mode === "navigate" ? (await caches.match("./")) || (await caches.match("./index.html")) : null);
        done(cached || Response.error());
      });
  });
}

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
      }
      return res;
    });
  });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = event.request.url;

  // The sync backend (any other domain) always goes straight to the network.
  if (url.startsWith(self.location.origin)) {
    event.respondWith(networkFirst(event.request));
  } else if (url === XLSX_URL) {
    event.respondWith(cacheFirst(event.request));
  }
});
