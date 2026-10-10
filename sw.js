// Service worker : l'app fonctionne entièrement hors ligne. Changer CACHE à chaque nouvelle version.
const CACHE = "hanzi-v2.0";
const FILES = ["./", "./index.html", "./app.js", "./data.js", "./hanzi-writer.min.js", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const store = (c, req, r) => { if (r && r.ok && !r.redirected) c.put(req, r.clone()); return r; };
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    // La page : réseau d'abord (récupère les mises à jour), cache si hors ligne
    if (e.request.mode === "navigate") {
      try { return store(c, "./index.html", await fetch(e.request)); }
      catch (err) { return (await c.match("./index.html")) || (await c.match("./")); }
    }
    // Le reste : cache d'abord (rapide, hors ligne), mise à jour en arrière-plan
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => store(c, e.request, r)).catch(() => hit);
    return hit || net;
  }));
});
