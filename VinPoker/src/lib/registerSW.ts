// Registers the service worker safely (skips iframe + Lovable preview hosts)
// and exposes lifecycle events for an update banner.

type UpdateListener = (worker: ServiceWorker | null) => void;

let waitingWorker: ServiceWorker | null = null;
let pendingNotice = false;
const listeners = new Set<UpdateListener>();

export function onSWUpdateAvailable(cb: UpdateListener): () => void {
  listeners.add(cb);
  if (waitingWorker || pendingNotice) cb(waitingWorker);
  return () => {
    listeners.delete(cb);
  };
}

function emitWaiting(worker: ServiceWorker | null) {
  waitingWorker = worker;
  if (!worker) pendingNotice = true;
  listeners.forEach((cb) => cb(worker));
  scheduleAutoApply();
}

// --- Auto-update: silently apply when the user is idle / tab not visible ---
let autoApplyTimer: number | null = null;
function scheduleAutoApply() {
  if (!waitingWorker && !pendingNotice) return;
  // If the tab is currently hidden, apply immediately (next open will be fresh).
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    applyUpdate();
    return;
  }
  // Otherwise, wait a short while; if user becomes idle / hides tab we apply.
  if (autoApplyTimer !== null) return;
  autoApplyTimer = window.setTimeout(() => {
    autoApplyTimer = null;
    if (waitingWorker || pendingNotice) applyUpdate();
  }, 8000);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "hidden" &&
      (waitingWorker || pendingNotice)
    ) {
      applyUpdate();
    }
  });
}

/** Manually surface the update banner (e.g. when version polling detects a new build). */
function notifyUpdateAvailable() {
  emitWaiting(waitingWorker);
}

/** Tell the waiting SW to activate and reload once it takes control. */
export function applyUpdate() {
  // Surface branded overlay (UpdateOverlay listens for this event).
  try {
    window.dispatchEvent(new Event("vinpoker:applying-update"));
    sessionStorage.setItem("vp:just-updated", "1");
    sessionStorage.removeItem("vp:auto-reloaded");
  } catch {
    /* ignore */
  }
  if (!waitingWorker) {
    // No SW update waiting (or version-poll triggered): bust caches + reload.
    (async () => {
      try {
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch {
        /* ignore */
      }
      window.location.reload();
    })();
    return;
  }
  let reloaded = false;
  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
}

/**
 * Manually check the server for a newer build by comparing the asset
 * hashes embedded in the live `index.html` against the ones currently
 * loaded in the page.
 *
 * Returns `true` if a new build was detected (and triggers `applyUpdate`),
 * `false` if the user is already on the latest version, or `null` if the
 * check could not be performed (e.g. offline).
 */
export async function checkForUpdateNow(): Promise<boolean | null> {
  // Hash signature of currently loaded assets
  const currentAssets = Array.from(
    document.querySelectorAll<HTMLElement>(
      'script[src*="/assets/"], link[href*="/assets/"]',
    ),
  )
    .map((el) => el.getAttribute("src") || el.getAttribute("href") || "")
    .filter((u) => /\/assets\/[^"']+\.(?:js|css)/.test(u))
    .map((u) => {
      const m = u.match(/\/assets\/[A-Za-z0-9_\-./]+\.(?:js|css)/);
      return m ? m[0] : "";
    })
    .filter(Boolean);
  const currentSig = Array.from(new Set(currentAssets)).sort().join("|");

  // Fetch fresh index.html
  let html: string;
  try {
    const res = await fetch(`/?_v=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Accept: "text/html" },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }
  const matches = html.match(/\/assets\/[A-Za-z0-9_\-./]+\.(?:js|css)/g);
  if (!matches || !matches.length) return null;
  const remoteSig = Array.from(new Set(matches)).sort().join("|");

  // Also ask any registered SW to re-check (best-effort)
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    /* ignore */
  }

  if (currentSig && remoteSig === currentSig) return false;

  applyUpdate();
  return true;
}

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const isInIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host === "localhost" ||
    host === "127.0.0.1";

  if (isInIframe || isPreviewHost) {
    // Clean up any leftover SW in editor/preview contexts
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        // Do not create a new service worker registration anymore. If an older
        // installed PWA already has one, update it to the rescue /sw.js, which
        // clears caches, refreshes open tabs, and unregisters itself.
        if (!reg) return null;
        return reg.update().then(() => reg);
      })
      .then((reg) => {
        if (!reg) return;
        // Already a waiting worker? Surface immediately.
        if (reg.waiting && navigator.serviceWorker.controller) {
          emitWaiting(reg.waiting);
        }

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New version installed, waiting to activate
              emitWaiting(installing);
            }
          });
        });

        // Periodically check for updates (every 60s + on focus)
        const check = () => reg.update().catch(() => {});
        window.setInterval(check, 60_000);
        window.addEventListener("focus", check);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
      })
      .catch(() => {
        // ignore registration errors
      });
  });
}
