import { useState, useCallback, useRef } from "react";

/**
 * Singleton-level animation tracker — prevents duplicate animations
 * for the same table across re-renders.
 */
const animTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function useSwingAnimation() {
  const [animating, setAnimating] = useState<Set<string>>(new Set());

  const triggerSwingAnimation = useCallback((tableId: string) => {
    // Debounce: if already animating or a timer is pending, skip
    if (animTimers.has(tableId)) return;

    animTimers.set(tableId, setTimeout(() => {
      animTimers.delete(tableId);
    }, 1200));

    setAnimating((prev) => new Set(prev).add(tableId));

    // Auto-clear after animation duration
    setTimeout(() => {
      setAnimating((prev) => {
        const next = new Set(prev);
        next.delete(tableId);
        return next;
      });
    }, 1200);
  }, []);

  const isAnimating = useCallback(
    (tableId: string) => animating.has(tableId),
    [animating]
  );

  return { triggerSwingAnimation, isAnimating };
}
