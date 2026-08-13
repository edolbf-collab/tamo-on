const SW_BUILD = 142;
const CACHE = "tamo-on-beta-1.0-build-142-r1";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css?v=beta142r1",
  "/app.js?v=beta142r1",
  "/pwa-bootstrap.js?v=beta142r1",
  "/supabase-config.js?v=0.3.3",
  "/group-avatars-data.js?v=beta142r1",
  "/assets/group-avatars-build-142/badge-01.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-02.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-03.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-04.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-05.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-06.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-07.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-08.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-09.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-10.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-11.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-12.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-13.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-14.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-15.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-16.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-17.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-18.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-19.png?v=beta142r1",
  "/assets/group-avatars-build-142/badge-20.png?v=beta142r1",
  "/manifest.json",
  "/offline.html",
  "/version.json",
  "/brand/tamo-on-logo-horizontal-negative.svg",
  "/tamo-on-icon-192.png",
  "/tamo-on-icon-512.png",
  "/tamo-on-maskable-192.png",
  "/tamo-on-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(ASSETS.map(async asset => {
    try { await cache.add(asset); }
    catch (error) { console.warn("Asset não armazenado no cache:", asset, error); }
  }));
  await self.skipWaiting();
})()));

self.addEventListener("activate", event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Igual à Build 115: recursos externos não são interceptados pelo service worker.
  // O navegador carrega diretamente Google, Supabase CDN e demais origens permitidas pelo CSP.
  if (url.origin !== self.location.origin) return;

  const navigation = event.request.mode === "navigate";
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response?.ok) {
          caches.open(CACHE).then(cache => cache.put(event.request, response.clone())).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then(hit =>
        hit || (navigation
          ? caches.match("/index.html", { ignoreSearch: true })
          : caches.match("/offline.html", { ignoreSearch: true }))
      ))
  );
});

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data?.json() || {}; }
  catch { payload = { body: event.data?.text() || "Novo aviso do grupo." }; }

  const title = payload.title || "Tâmo On";
  const options = {
    body: payload.body || "Novo aviso do grupo.",
    icon: payload.icon || "/tamo-on-icon-192.png",
    badge: payload.badge || "/icons/icon-64.png",
    tag: payload.tag || "tamo-on-aviso",
    renotify: true,
    data: payload.data || { url: payload.url || "./?page=home" },
    vibrate: [120, 60, 120],
    timestamp: payload.timestamp || Date.now()
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    try { await self.registration.setAppBadge?.(1); } catch {}
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./?page=home", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("navigate" in client) await client.navigate(target);
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") {
    event.source?.postMessage?.({ type: "TAMOON_SW_VERSION", build: SW_BUILD, cache: CACHE });
  }
});
