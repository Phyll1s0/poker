const CACHE_NAME = "rangecraft-v10";
const APP_SCOPE = new URL("./", self.registration.scope);
const appAsset = (path) => new URL(path, APP_SCOPE).href;
const STATIC_ASSETS = [
  appAsset("./"),
  appAsset("manifest.webmanifest"),
  appAsset("favicon.svg"),
  appAsset("icon-192.png"),
  appAsset("icon-512.png"),
  appAsset("apple-touch-icon.png"),
];
const CACHEABLE_DESTINATIONS = new Set(["font", "image", "script", "style"]);
const PRIVATE_PATH_PREFIXES = [
  "/api",
  "/multiplayer",
  "/account",
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
  "/callback",
];

function isPrivatePath(pathname) {
  return PRIVATE_PATH_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(STATIC_ASSETS.map(async (asset) => {
        try {
          const response = await fetch(asset, { cache: "reload" });
          if (response.ok) await cache.put(asset, response);
        } catch {
          // An optional asset failure must not keep an obsolete worker active.
        }
      })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("rangecraft-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Authentication, account and multiplayer responses are personalized. Let
  // the network handle them directly so no private page or API response can
  // enter the shared app-shell cache.
  if (isPrivatePath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) return response;
          return caches.open(CACHE_NAME)
            .then((cache) => cache.put(appAsset("./"), response.clone()))
            .then(() => response);
        })
        .catch(() => caches.match(appAsset("./")).then((cached) => cached || new Response(
          "RangeCraft 暂时无法连接，请恢复网络后重试。",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
        ))),
    );
    return;
  }

  if (!STATIC_ASSETS.includes(request.url) && !CACHEABLE_DESTINATIONS.has(request.destination)) return;

  // An installed app must prefer the newest deployed interface. Cached code
  // remains available only as an offline fallback.
  if (request.destination === "script" || request.destination === "style") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) return response;
          return caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, response.clone()))
            .then(() => response);
        })
        .catch(() => caches.match(request).then((cached) => cached || new Response(
          "RangeCraft 资源暂时无法连接，请恢复网络后重试。",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
        ))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (!response.ok) return response;
      return caches.open(CACHE_NAME)
        .then((cache) => cache.put(request, response.clone()))
        .then(() => response);
    })),
  );
});
