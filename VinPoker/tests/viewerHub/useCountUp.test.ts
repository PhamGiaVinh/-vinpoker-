// Phase 3 — useCountUp contract: display-only tween that must NEVER desync a static
// render (first render = target), must respect enabled/reduced-motion (snap), and must
// settle to the LATEST target under rapid updates (mid-tween update starts from the
// currently displayed value, never snaps backward).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCountUp } from "@/hooks/useCountUp";

// Deterministic rAF: queue callbacks, flush manually with a controlled clock.
let now = 0;
let queue: FrameRequestCallback[] = [];
function flushFrames(ms: number, stepMs = 16) {
  for (let t = 0; t < ms; t += stepMs) {
    now += stepMs;
    const cbs = queue;
    queue = [];
    cbs.forEach((cb) => cb(now));
  }
}

beforeEach(() => {
  now = 0;
  queue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCountUp", () => {
  it("first render returns the target synchronously", () => {
    const { result } = renderHook(() => useCountUp(1000, { enabled: true }));
    expect(result.current).toBe(1000);
  });

  it("enabled:false always returns the target (no rAF scheduled)", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, { enabled: false }), {
      initialProps: { v: 100 },
    });
    rerender({ v: 900 });
    expect(result.current).toBe(900);
    expect(queue.length).toBe(0);
  });

  it("tweens toward a new target and settles exactly on it", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, { enabled: true, duration: 200 }), {
      initialProps: { v: 0 },
    });
    rerender({ v: 1000 });
    act(() => flushFrames(96));
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(1000);
    act(() => flushFrames(200));
    expect(result.current).toBe(1000);
  });

  it("rapid updates settle to the LATEST target", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, { enabled: true, duration: 200 }), {
      initialProps: { v: 0 },
    });
    rerender({ v: 500 });
    act(() => flushFrames(48)); // mid-tween
    rerender({ v: 2000 }); // new target arrives mid-flight
    act(() => flushFrames(400));
    expect(result.current).toBe(2000);
  });

  it("prefers-reduced-motion snaps to the target", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addListener: () => {}, removeListener: () => {} }));
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, { enabled: true }), {
      initialProps: { v: 10 },
    });
    rerender({ v: 999 });
    expect(result.current).toBe(999);
    expect(queue.length).toBe(0);
  });
});
