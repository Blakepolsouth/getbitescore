// Bite Score service worker: offline app shell, cached forecasts, and bite alerts.
const SHELL = "bitescore-shell-v6";
const DATA = "bitescore-data-v1";
const FILES = ["/", "/app.css", "/app.js", "/engine.js", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;

  // Forecasts and tides: network first, fall back to the last copy when there's no signal.
  if (url.hostname.endsWith("open-meteo.com") || url.hostname === "api.tidesandcurrents.noaa.gov") {
    e.respondWith(
      fetch(req)
        .then(r => { if (r.ok) { const copy = r.clone(); caches.open(DATA).then(c => c.put(req, copy)); } return r; })
        .catch(() => caches.match(req))
    );
    return;
  }

  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // Pages: network first so shared links get fresh previews; cached copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put(url.pathname, copy)); return r; })
        .catch(() => caches.match(url.pathname).then(hit => hit || caches.match("/")))
    );
    return;
  }

  // Static files: cached copy right away, refreshed in the background.
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(req, copy)); } return r; }).catch(() => hit);
      return hit || net;
    })
  );
});

// Bite alerts
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Bite Score", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Bite Score", {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.tag || "bite-alert",
    data: { url: d.url || "/" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) { if ("focus" in c && c.url.startsWith(self.location.origin)) { c.navigate(target); return c.focus(); } }
      return self.clients.openWindow(target);
    })
  );
});
