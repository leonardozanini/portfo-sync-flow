const CACHE = "folio-v2";
const STATIC = ["/", "/dashboard", "/transactions", "/proventos", "/settings"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Never cache API, auth, or server function calls
  const url = e.request.url;
  if (
    url.includes("/api/") ||
    url.includes("supabase") ||
    url.includes("/_serverFn/") ||
    url.includes("/auth/")
  ) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.status < 400) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
