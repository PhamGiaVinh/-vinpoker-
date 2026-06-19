// src/lib/onlinePoker/immersive.ts
// P0 mobile table mode — best-effort browser fullscreen + a persisted CSS-immersive
// preference. Native fullscreen can ONLY be requested from a user gesture and is not
// supported everywhere (iOS Safari has no Element.requestFullscreen), so these helpers
// NEVER throw: the page always falls back to the CSS-immersive overlay even if the native
// request is rejected or unavailable.

export const IMMERSIVE_KEY = 'vinpoker:poker:immersive-mode';

/** Read the saved immersive-mode preference (default off). */
export function readImmersivePref(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(IMMERSIVE_KEY) === '1'; }
  catch { return false; }
}

/** Persist the immersive-mode preference. */
export function writeImmersivePref(on: boolean): void {
  try { localStorage.setItem(IMMERSIVE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

/** True when the document is in native fullscreen (cross-browser). */
export function isFullscreenActive(): boolean {
  if (typeof document === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = document as any;
  return !!(document.fullscreenElement || d.webkitFullscreenElement);
}

/** Request native fullscreen — MUST be called inside a user-gesture handler. Never throws;
 *  if unavailable/blocked the caller's CSS-immersive overlay still applies. Best-effort
 *  landscape orientation lock is attempted and its failure is ignored. */
export function requestFullscreenBestEffort(el?: HTMLElement | null): void {
  if (typeof document === 'undefined') return;
  try {
    const target = el ?? document.documentElement;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyEl = target as any;
    const req = target.requestFullscreen || anyEl.webkitRequestFullscreen || anyEl.msRequestFullscreen;
    if (req) Promise.resolve(req.call(target)).catch(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orient = (typeof screen !== 'undefined' ? (screen as any).orientation : null);
    if (orient?.lock) Promise.resolve(orient.lock('landscape')).catch(() => {});
  } catch { /* ignore — CSS immersive still applies */ }
}

/** Exit native fullscreen (if active) + unlock orientation. Never throws. */
export function exitFullscreenBestEffort(): void {
  if (typeof document === 'undefined') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = document as any;
    if (isFullscreenActive()) {
      const exit = document.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen;
      if (exit) Promise.resolve(exit.call(document)).catch(() => {});
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orient = (typeof screen !== 'undefined' ? (screen as any).orientation : null);
    if (orient?.unlock) { try { orient.unlock(); } catch { /* ignore */ } }
  } catch { /* ignore */ }
}
