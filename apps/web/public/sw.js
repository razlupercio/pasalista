// SPDX-License-Identifier: AGPL-3.0-or-later
// PasaLista service worker: keeps the scanner usable without network (ADR-0005, ADR-0010).
// Hand-written on purpose (no build plugin): it only caches the scanner page and its static
// assets. API responses are never cached; offline data lives in IndexedDB.

const STATIC_CACHE = "pasalista-static-v1";
const PAGE_CACHE = "pasalista-pages-v1";

const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.startsWith("/zxing/") ||
  url.pathname.startsWith("/icon") ||
  url.pathname.startsWith("/apple-icon") ||
  url.pathname === "/manifest.webmanifest";

const isScannerPage = (url) => /^\/[A-Za-z-]+\/scan\/[0-9a-f-]{36}\/?$/.test(url.pathname);

/** Needed by the scanner even if the camera was never opened while online. */
const PRECACHE = ["/zxing/zxing_reader.wasm", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE).catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("pasalista-") && key !== STATIC_CACHE && key !== PAGE_CACHE) {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (isStatic(url)) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate" && isScannerPage(url)) {
    event.respondWith(networkFirstPage(request));
  }
});

// The scanner page loads before this worker controls it; it sends the URLs it already used
// (page and static assets) so they are available offline right away.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "cache-urls" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      for (const raw of data.urls) {
        try {
          const url = new URL(raw, self.location.origin);
          if (url.origin !== self.location.origin) continue;
          if (isStatic(url)) await cacheFirst(new Request(url));
          else if (isScannerPage(url)) await networkFirstPage(new Request(url));
        } catch {
          // Best effort: a missing asset only matters if the device goes offline.
        }
      }
    })(),
  );
});
