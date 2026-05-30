import { useState, useEffect } from "react";

// ── Module-level singleton: 1 interval cho toàn app ──────────
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _currentTime: number = Date.now();
const _listeners: Set<(t: number) => void> = new Set();

function _startClock(): void {
  if (_intervalId !== null) return;
  _intervalId = setInterval(() => {
    _currentTime = Date.now();
    _listeners.forEach((fn) => fn(_currentTime));
  }, 1000);
}

function _stopClock(): void {
  if (_intervalId === null) return;
  if (_listeners.size > 0) return;
  clearInterval(_intervalId);
  _intervalId = null;
}

// HMR safety: clear on module dispose (Vite-specific)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
  });
}

/**
 * Singleton live clock hook.
 * All components using this hook share ONE setInterval(1000).
 * Avoids N intervals when N table cards are mounted.
 */
export function useLiveClock(): number {
  const [, rerender] = useState(0);

  useEffect(() => {
    const listener = (t: number) => rerender((n) => n + 1);
    _listeners.add(listener);
    _startClock();

    // Sync immediately (avoid stale initial value)
    rerender((n) => n + 1);

    return () => {
      _listeners.delete(listener);
      _stopClock();
    };
  }, []);

  return _currentTime;
}
