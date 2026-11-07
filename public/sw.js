// Brixy service worker: caches the app shell and anonymous community reads only.
// Personal data (/api/accounts, transactions, budgets, goals, messages, notifications, profile) is never stored.
const SHELL = "saviny-shell-v2";
const PUBLIC = "saviny-public-v1";
const PUBLIC_API = ["/api/community/rules", "/api/community/trending", "/api/posts"];
const SHELL_FILES = ["/", "/manifest.webmanifest", "/favicon.svg", "/assets/saviny-logo.png", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, PUBLIC].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    if (PUBLIC_API.some((p) => url.pathname.startsWith(p))) event.respondWith(publicRead(request));
    return;
  }
  event.respondWith(shell(request));
});

async function publicRead(request) {
  const cache = await caches.open(PUBLIC);
  const key = new Request(request.url); // anonymous key: a signed-in response is never reused for other viewers
  try {
    const response = await fetch(request);
    if (response.ok && !request.headers.get("authorization")) cache.put(key, response.clone());
    return response;
  } catch {
    return (await cache.match(key)) || Response.error();
  }
}

// Network first, so a new deploy is seen on the next reload; the cache is the offline fallback.
async function shell(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(SHELL)).put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") return (await caches.match("/")) || Response.error();
    return Response.error();
  }
}
