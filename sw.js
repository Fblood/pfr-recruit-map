// Offline support: after one visit online, the whole app (map, data, fonts)
// is cached on the device and keeps working with no signal. Nothing here
// needs maintaining -- the install step reads index.html and caches whatever
// it references.
//
//   pages  -> network first (so a deploy shows up right away), 4s timeout,
//             then the saved copy
//   assets -> saved copy first, refreshed in the background
const CACHE = "pfr-mdt";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const html = await (await fetch("index.html", { cache: "reload" })).text();
    const urls = new Set(["./", "index.html"]);
    for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (!/^(?:[a-z]+:)?\/\//i.test(m[1])) urls.add(m[1]);
    }
    // Fonts are named in fonts.css, not index.html, so pull them in too.
    const css = await (await fetch("fonts/fonts.css", { cache: "reload" })).text();
    for (const m of css.matchAll(/url\(([^)]+\.woff2)\)/g)) urls.add("fonts/" + m[1]);
    await Promise.all([...urls].map(async (u) => {
      const res = await fetch(u, { cache: "reload" });
      if (res.ok) await cache.put(new Request(u, { credentials: "same-origin" }), res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Keep one copy of each file: when index.html moves to a new ?v=, drop the
// older ?v of the same path so the cache doesn't grow with every release.
async function putAndPrune(cache, request, response) {
  await cache.put(request, response);
  const url = new URL(request.url);
  for (const key of await cache.keys()) {
    const k = new URL(key.url);
    if (k.pathname === url.pathname && k.search !== url.search) await cache.delete(key);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 4000)),
        ]);
        if (res.ok) cache.put("index.html", res.clone());
        return res;
      } catch (e) {
        return (await cache.match("index.html")) || (await cache.match("./")) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const refresh = fetch(req).then((res) => {
      if (res.ok) return putAndPrune(cache, req, res.clone()).then(() => res);
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(refresh); return cached; }
    return (await refresh) || Response.error();
  })());
});
