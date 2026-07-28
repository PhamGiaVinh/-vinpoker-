import { useEffect, useRef } from "react";

/**
 * Detects when a new build of the app has been deployed and calls onNewVersion().
 *
 * The build writes one version to both `/version.json` and `__APP_VERSION__`.
 * Comparing them on the first check catches a stale mobile bundle immediately,
 * instead of accepting the server version as the initial baseline. Hashed assets
 * in index.html remain a compatibility fallback while the marker is unavailable.
 */

type VersionMarker = {
  source: "build" | "assets";
  value: string;
};

/** Public seam for the stale-mobile-build regression test. */
export function isRemoteBuildNewer(
  loadedBuildVersion: string | null,
  remoteBuildVersion: string | null,
): boolean {
  return Boolean(
    loadedBuildVersion &&
      remoteBuildVersion &&
      loadedBuildVersion !== remoteBuildVersion,
  );
}

function currentBuildVersion(): string | null {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : null;
}

export function useVersionCheck(
  onNewVersion: () => void,
  intervalMs: number = 60_000,
) {
  const initialVersionRef = useRef<string | null>(null);
  const notifiedRef = useRef(false);
  const cbRef = useRef(onNewVersion);
  cbRef.current = onNewVersion;

  useEffect(() => {
    const host = window.location.hostname;
    const isPreviewOrDev =
      host.includes("id-preview--") ||
      host.includes("lovableproject.com") ||
      host === "localhost" ||
      host === "127.0.0.1";

    // Lovable preview URLs can be pinned to a specific build via query params.
    // Polling `/` without that context can look like a new deploy and cause a
    // reload loop while the user simply navigates between lazy-loaded routes.
    if (isPreviewOrDev) return;

    let cancelled = false;

    const fetchVersion = async (): Promise<VersionMarker | null> => {
      // 1) Exact deployment marker. It is also compiled into the running bundle,
      // so it can detect an already-stale client on the very first check.
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (res.ok) {
          const data = await res.json();
          if (typeof data?.version === "string") {
            return { source: "build", value: data.version };
          }
        }
      } catch {
        // fall through
      }

      // 2) Compatibility fallback: Vite asset names change every build.
      try {
        const url = new URL(window.location.href);
        url.pathname = "/";
        url.searchParams.set("_v", Date.now().toString());
        const res = await fetch(url.toString(), {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache", Accept: "text/html" },
        });
        if (!res.ok) return null;

        const html = await res.text();
        const matches = html.match(/\/assets\/[A-Za-z0-9_\-./]+\.(?:js|css)/g);
        if (!matches?.length) return null;

        return {
          source: "assets",
          value: Array.from(new Set(matches)).sort().join("|"),
        };
      } catch {
        return null;
      }
    };

    const check = async () => {
      const marker = await fetchVersion();
      if (cancelled || !marker) return;

      const markerKey = `${marker.source}:${marker.value}`;
      if (initialVersionRef.current === null) {
        initialVersionRef.current = markerKey;
        if (
          marker.source === "build" &&
          isRemoteBuildNewer(currentBuildVersion(), marker.value) &&
          !notifiedRef.current
        ) {
          notifiedRef.current = true;
          cbRef.current();
        }
        return;
      }

      if (markerKey !== initialVersionRef.current && !notifiedRef.current) {
        notifiedRef.current = true;
        cbRef.current();
      }
    };

    check();
    const id = window.setInterval(check, intervalMs);

    const onVis = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [intervalMs]);
}
