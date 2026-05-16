import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from "web-vitals";

interface VitalPayload {
  name: Metric["name"];
  value: number;
  rating: Metric["rating"];
  id: string;
  delta: number;
  navigationType?: Metric["navigationType"];
  page: string;
  ts: number;
}

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/report-vitals`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const queue: VitalPayload[] = [];
let flushScheduled = false;

function logDev(p: VitalPayload) {
  const color =
    p.rating === "good" ? "color:#10b981"
    : p.rating === "needs-improvement" ? "color:#f59e0b"
    : "color:#ef4444";
  // eslint-disable-next-line no-console
  console.log(
    `%c[web-vitals] ${p.name} = ${p.value.toFixed(2)} (${p.rating})`,
    `${color};font-weight:bold`,
    { id: p.id, delta: p.delta, page: p.page },
  );
}

function flush() {
  flushScheduled = false;
  if (queue.length === 0) return;
  const body = JSON.stringify(queue.splice(0, queue.length));
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      if (ok) return;
    }
  } catch {
    // fall through to fetch
  }
  // Fallback
  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body,
    keepalive: true,
  }).catch(() => {});
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(flush, 1500);
}

function handleMetric(m: Metric) {
  const payload: VitalPayload = {
    name: m.name,
    value: m.value,
    rating: m.rating,
    id: m.id,
    delta: m.delta,
    navigationType: m.navigationType,
    page: location.pathname,
    ts: Date.now(),
  };

  if (import.meta.env.DEV) {
    logDev(payload);
    return;
  }

  queue.push(payload);
  scheduleFlush();
}

export function initWebVitals() {
  try {
    onLCP(handleMetric);
    onINP(handleMetric);
    onCLS(handleMetric);
    onFCP(handleMetric);
    onTTFB(handleMetric);

    if (!import.meta.env.DEV) {
      // Flush remaining metrics on page hide (sendBeacon-friendly)
      addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
      });
      addEventListener("pagehide", flush);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[web-vitals] init failed:", err);
  }
}
