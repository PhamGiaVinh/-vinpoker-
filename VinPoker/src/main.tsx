import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import "./index.css";

const root = createRoot(document.getElementById("root")!);
const isCenterPointPokerMastersRoute = window.location.pathname.replace(/\/+$/, "") === "/center-point-poker-masters";

function finishBootTransition() {
  // Signal boot synchronously after React accepts the root render. Background tabs
  // can throttle requestAnimationFrame for longer than the watchdog timeout.
  window.dispatchEvent(new Event("vp:react-mounted"));

  // Keep the visual splash transition on the next frame.
  requestAnimationFrame(() => {
    try {
      sessionStorage.removeItem("vp:just-updated");
      sessionStorage.removeItem("vp:auto-reloaded");
      sessionStorage.removeItem("vp:reloaded-after-preload-error");
    } catch {
      // Session storage is best-effort on privacy-restricted browsers.
    }
    const splash = document.getElementById("boot-splash");
    if (!splash) return;
    splash.classList.add("boot-splash--hide");
    setTimeout(() => splash.remove(), 500);
  });
}

if (isCenterPointPokerMastersRoute) {
  void import("./pages/CenterPointPokerMastersApp").then(({ default: CenterPointPokerMastersApp }) => {
    root.render(<CenterPointPokerMastersApp />);
    finishBootTransition();
  });
} else {
  void Promise.all([
    import("./PlayerApp"),
    import("./components/RootErrorFallback"),
    import("./i18n"),
    import("./lib/sound"),
    import("./lib/registerSW"),
    import("./lib/onesignal"),
    import("./lib/webVitals"),
  ]).then(([{ default: PlayerApp }, { RootErrorFallback }, , { initButtonSounds }, { registerServiceWorker }, { initOneSignal }, { initWebVitals }]) => {
    initButtonSounds();
    registerServiceWorker();
    initOneSignal();
    initWebVitals();

    // Lazy-load Sentry only in production when a DSN is configured.
    if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
      void import("@sentry/react").then((Sentry) => Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN as string }));
    }

    root.render(
      <ErrorBoundary
        FallbackComponent={RootErrorFallback}
        onError={(error, info) => console.error("Root ErrorBoundary:", error, info)}
        onReset={() => window.location.reload()}
      >
        <PlayerApp />
      </ErrorBoundary>,
    );
    finishBootTransition();
  });
}

// Recover from Vite chunk-load failures (common right after an update when
// caches were cleared but the module graph still references old hashes).
window.addEventListener("vite:preloadError", (e) => {
  try {
    if (sessionStorage.getItem("vp:reloaded-after-preload-error")) return;
    sessionStorage.setItem("vp:reloaded-after-preload-error", "1");
  } catch {
    // Session storage is best-effort on privacy-restricted browsers.
  }
  e.preventDefault?.();
  window.location.reload();
});

window.addEventListener("error", (e) => {
  const msg = (e.message || "").toLowerCase();
  if (
    msg.includes("is not defined") ||
    msg.includes("cannot read properties of undefined") ||
    msg.includes("is not a function")
  ) {
    try {
      if (sessionStorage.getItem("vp:chunk-reloaded")) return;
      sessionStorage.setItem("vp:chunk-reloaded", "1");
    } catch {
      // Session storage is best-effort on privacy-restricted browsers.
    }
    const url = new URL(location.href);
    url.searchParams.set("recover", Date.now().toString());
    location.replace(url.toString());
  }
});

