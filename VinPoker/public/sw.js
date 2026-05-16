// Rescue service worker: clears stale PWA caches, navigates every open tab to a
// fresh URL, then unregisters itself. Keep this at /sw.js so already-installed
// devices can recover from older workers that served a broken cached shell.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      await Promise.all(
        clients.map((client) => {
          const url = new URL(client.url);
          url.searchParams.set("sw-cleanup", Date.now().toString());
          return client.navigate(url.toString()).catch(() => undefined);
        }),
      );
      await self.registration.unregister();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
