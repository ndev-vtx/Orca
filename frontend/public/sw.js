/*
 * Orca service worker — smart offline caching.
 *
 * Layers:
 *   - App shell: "/" + index.html + manifest + icon precached at install;
 *     navigations go network-first and fall back to the cached shell so
 *     reopening Orca never shows a blank flash.
 *   - Hashed build assets (/assets/*): cache-first — filenames are
 *     content-hashed, so a cache hit is always correct and instant.
 *   - Cover thumbnails (i.ytimg.com): stale-while-revalidate with a size
 *     cap, so a familiar library paints its artwork offline.
 *   - Reads (GET /api/lyrics, /api/library/playlists, /api/library/favorites):
 *     network-first with a cache fallback; stale data is better than a
 *     broken offline screen.
 *   - Everything else (streaming, resolve, auth POSTs, mutations): pure
 *     network passthrough — never cached, never intercepted.
 */

/* Bump VERSION whenever SHELL_URLS or the caching strategy changes — the
   activate handler deletes every cache whose name does not start with it. */
const VERSION = "orca-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const IMG_CACHE = `${VERSION}-img`;
const DATA_CACHE = `${VERSION}-data`;
const IMG_CACHE_MAX = 160;

const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/orca-icon.svg"];

const OFFLINE_PAGE =
  "<!doctype html><title>Orca — offline</title><meta charset='utf-8'>" +
  "<meta name='viewport' content='width=device-width, initial-scale=1'>" +
  "<body style='background:#05070c;color:#b3b3b3;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0'>" +
  "<div style='text-align:center'><h1 style='color:#fff'>Orca is offline</h1>" +
  "<p>Reconnect to keep the current flowing.</p></div></body>";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => undefined) // best-effort precache
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (fallbackUrl) {
      const shell = await caches.match(fallbackUrl);
      if (shell) return shell;
    }
    return new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).then(() => trimCache(cacheName, IMG_CACHE_MAX));
      }
      return response;
    })
    .catch(() => undefined);
  return hit || (await network) || Response.error();
}

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const key of keys.slice(0, keys.length - max)) {
    await cache.delete(key);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // auth, playlists mutations, resolve → network

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Navigations: network-first, cached shell as instant fallback.
  if (request.mode === "navigate" || (url.origin === self.location.origin && url.pathname === "/")) {
    event.respondWith(networkFirst(request, SHELL_CACHE, "/index.html"));
    return;
  }

  if (url.origin === self.location.origin) {
    // Hashed Vite build output — immutable, cache forever.
    if (url.pathname.startsWith("/assets/")) {
      event.respondWith(cacheFirst(request, ASSET_CACHE));
      return;
    }
    // Read-only API data worth surviving offline.
    if (
      url.pathname.startsWith("/api/lyrics/") ||
      url.pathname.startsWith("/api/library/playlists") ||
      url.pathname.startsWith("/api/library/favorites")
    ) {
      event.respondWith(networkFirst(request, DATA_CACHE));
      return;
    }
    return; // everything else (resolve, stream, doctor, POSTs) → network
  }

  // Cover thumbnails from YouTube's image CDN.
  if (/(^|\.)ytimg\.com$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, IMG_CACHE));
  }
});
