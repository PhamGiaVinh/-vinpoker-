// Visual count-up tween for numeric displays (pot / stacks on the tracker felt).
// DISPLAY ONLY — the tweened value must never feed game/financial logic; callers keep
// using the raw prop for anything but rendering text.
//
// Contract (pinned by tests/viewerHub/useCountUp.test.ts):
//  • First render returns the target SYNCHRONOUSLY (so renderToStaticMarkup and the
//    operator/TV byte-identity render tests never see an intermediate value).
//  • `enabled: false` or prefers-reduced-motion → always the target, no rAF.
//  • Rapid target changes settle to the LATEST target (each tween starts from the
//    currently displayed value, so a mid-tween update never snaps backwards).

import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, opts?: { duration?: number; enabled?: boolean }): number {
  const duration = opts?.duration ?? 260;
  const enabled = opts?.enabled ?? true;
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [display, setDisplay] = useState(safeTarget);
  const displayRef = useRef(safeTarget);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!enabled || reduced || typeof window === "undefined") {
      displayRef.current = safeTarget;
      setDisplay(safeTarget);
      return;
    }
    const from = displayRef.current;
    if (from === safeTarget) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const v = Math.round(from + (safeTarget - from) * eased);
      displayRef.current = v;
      setDisplay(v);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [safeTarget, duration, enabled]);

  return enabled ? display : safeTarget;
}
