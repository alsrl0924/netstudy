const CACHE_NAME = "network-manager-study-v4";
const APP_SHELL = "./";
const CORE_ASSETS = [
  "./manifest.webmanifest",
  "./favicon.svg",
  "./data/question-bank.json",
  "./data/explanations.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(CORE_ASSETS.map((url) => new Request(url, { cache: "reload" }))),
      ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      );
      await self.clients.claim();

      // v3의 캐시 우선 HTML을 보고 있는 기존 탭을 최신 문서로 한 번 전환합니다.
      const clients = await self.clients.matchAll({ type: "window" });
      await Promise.all(
        clients.map((client) =>
          "navigate" in client ? client.navigate(client.url).catch(() => undefined) : undefined,
        ),
      );
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, APP_SHELL));
    return;
  }

  if (url.pathname.includes("/data/")) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.pathname.includes("/_next/static/")) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request, cacheKey = request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(cacheKey);
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}
