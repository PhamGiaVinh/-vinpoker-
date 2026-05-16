// Same rescue worker as /sw.js for devices that may have installed an older
// worker under this legacy path. It clears stale caches, refreshes tabs, and
// removes itself.
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