import { useEffect } from "react";

type WakeLockSentinelLike = { release: () => Promise<void> };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

/**
 * Keeps the screen awake while the component is mounted and visible.
 * Silent no-op where the Wake Lock API is unsupported (older TV WebViews);
 * re-acquires after tab/display wake because the OS auto-releases the lock.
 */
export function useWakeLock(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;

    const acquire = async () => {
      try {
        const lock = await nav.wakeLock!.request("screen");
        if (disposed) {
          lock.release().catch(() => {});
        } else {
          sentinel = lock;
        }
      } catch {
        // Denied (battery saver, permissions) — screen timeout applies.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}
