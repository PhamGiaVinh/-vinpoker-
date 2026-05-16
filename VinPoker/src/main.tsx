import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { initButtonSounds } from "./lib/sound";
import { registerServiceWorker } from "./lib/registerSW";
import { initOneSignal } from "./lib/onesignal";
import { initWebVitals } from "./lib/webVitals";
import { RootErrorFallback } from "./components/RootErrorFallback";

initButtonSounds();
registerServiceWorker();
initOneSignal();
initWebVitals();

// Lazy-load Sentry only in production when a DSN is configured.
// Keeps dev bundles slim and avoids any runtime cost when monitoring is off.
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  import("@sentry/react").then((Sentry) => {
    Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN as string });
  });
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <ErrorBoundary
    FallbackComponent={RootErrorFallback}
    onError={(error, info) => console.error("Root ErrorBoundary:", error, info)}
    onReset={() => window.location.reload()}
  >
    <App />
  </ErrorBoundary>
);

// Hide the inline boot splash once React has mounted, and signal the boot
// watchdog in index.html that we're alive.
requestAnimationFrame(() => {
  try {
    window.dispatchEvent(new Event("vp:react-mounted"));
    sessionStorage.removeItem("vp:just-updated");
    sessionStorage.removeItem("vp:auto-reloaded");
    sessionStorage.removeItem("vp:reloaded-after-preload-error");
  } catch {}
  const splash = document.getElementById("boot-splash");
  if (!splash) return;
  splash.classList.add("boot-splash--hide");
  setTimeout(() => splash.remove(), 500);
});

// Recover from Vite chunk-load failures (common right after an update when
// caches were cleared but the module graph still references old hashes).
window.addEventListener("vite:preloadError", (e) => {
  try {
    if (sessionStorage.getItem("vp:reloaded-after-preload-error")) return;
    sessionStorage.setItem("vp:reloaded-after-preload-error", "1");
  } catch {}
  e.preventDefault?.();
  window.location.reload();
});

