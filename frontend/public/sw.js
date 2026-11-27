/*
 * Orca service worker — deliberately minimal.
 *
 * It exists only to make the app installable as a PWA. It performs a plain
 * fetch passthrough (network-first for everything, offline only when the
 * network is unreachable) so there is NO risk of serving stale app assets or
 * stale /api responses. Background audio is owned by the page's YouTube
 * iframe + MediaSession, which keeps working while the SW merely sits idle.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // let POSTs (auth, playlists) go straight to the network

  event.respondWith(
    fetch(request).catch(
      () =>
        new Response(
          "<!doctype html><title>Orca — offline</title><meta charset='utf-8'><body style='background:#05070c;color:#b3b3b3;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0'><div style='text-align:center'><h1 style='color:#fff'>Orca is offline</h1><p>Reconnect to keep the current flowing.</p></div>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
    ),
  );
});
