/* Ticker&Tape service worker: makes the site installable as an app, keeps it usable on a flaky connection
   and shows the alert notifications sent by the API (Web Push). */
const CACHE = "tt-v1";
const SHELL = ["/", "/style.css", "/app.js", "/i18n.js", "/img/logo.svg", "/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                       // the API, fonts and CDNs go straight to the network
  if (req.mode === "navigate") {                                     // pages: always fresh, the cached app shell when offline
    e.respondWith(fetch(req).then(r => { if (r.ok && url.pathname === "/") { const c = r.clone(); caches.open(CACHE).then(x => x.put("/", c)); } return r; })
      .catch(() => caches.match(req).then(r => r || caches.match("/"))));
    return;
  }
  if (url.pathname.startsWith("/data/")) {                           // market data: network first, the last copy when offline
    e.respondWith(fetch(req).then(r => { if (r.ok && !url.pathname.endsWith("live.json")) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  if (/\.(js|css|svg|png|ico|webmanifest)$/.test(url.pathname)) {   // code and images: cached copy now, refreshed in the background
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })));
  }
});

self.addEventListener("push", e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { title: "Ticker&Tape", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(m.title || "Ticker&Tape", {
    body: m.body || "", tag: m.tag || undefined, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: m.url || "/" }, renotify: !!m.tag }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const w of list) { if (w.url.startsWith(location.origin) && "focus" in w) { w.navigate(url).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(url);
  }));
});
