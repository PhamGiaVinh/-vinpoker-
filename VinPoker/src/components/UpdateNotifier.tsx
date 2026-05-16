import { useRef } from "react";
import { useVersionCheck } from "@/hooks/useVersionCheck";

/**
 * Polls for new deployments. When a new build is detected, force a hard
 * refresh so users immediately get new features.
 *
 * Visual feedback is handled by <UpdateOverlay/>, which listens for the
 * "vinpoker:applying-update" custom event we dispatch here.
 */
export const UpdateNotifier = () => {
  const triggeredRef = useRef(false);

  useVersionCheck(async () => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    await forceHardRefresh();
  }, 30_000);

  return null;
};

async function forceHardRefresh() {
  // Show the branded overlay (mounted at root via <UpdateOverlay/>).
  try {
    window.dispatchEvent(new Event("vinpoker:applying-update"));
    sessionStorage.setItem("vp:just-updated", "1");
    sessionStorage.removeItem("vp:auto-reloaded");
  } catch {
    /* ignore */
  }

  // 1) Unregister all service workers
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
  } catch {
    /* ignore */
  }

  // 2) Clear all caches
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    }
  } catch {
    /* ignore */
  }

  // 3) Hard reload with cache-busting query so the HTML itself is refetched
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString());
  window.location.replace(url.toString());
}
