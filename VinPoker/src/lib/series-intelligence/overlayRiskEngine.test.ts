import { describe, it, expect } from "vitest";
import { simulateOverlayRisk, type OverlayRiskInput } from "./overlayRiskEngine";

const DEMO = { observedEntries: [795, 2350], buyinPrize: 31_428_571, fee: 4_571_428, sd: 0.55, nSims: 20000, seed: 42 };
const inp = (over: Partial<OverlayRiskInput>): OverlayRiskInput => ({ ...DEMO, gtd: 25e9, n: 2, ...over });

describe("simulateOverlayRisk — overlay vs GTD", () => {
  it("P(overlay) is non-decreasing as GTD rises", () => {
    const p = [10e9, 20e9, 30e9, 40e9].map((gtd) => simulateOverlayRisk(inp({ gtd })).pOverlay);
    expect(p[0]).toBeLessThanOrEqual(p[1]);
    expect(p[1]).toBeLessThanOrEqual(p[2]);
    expect(p[2]).toBeLessThanOrEqual(p[3]);
    expect(p[0]).toBeLessThan(p[3]); // strictly rising overall
  });

  it("threshold entries = GTD / buyin (≈795 at GTD 25b)", () => {
    const r = simulateOverlayRisk(inp({ gtd: 25e9 }));
    expect(r.thresholdEntries).toBeCloseTo(25e9 / DEMO.buyinPrize, 6);
    expect(Math.round(r.thresholdEntries)).toBe(795);
  });

  it("E[overlay] ≥ 0", () => {
    expect(simulateOverlayRisk(inp({ gtd: 30e9 })).eOverlay).toBeGreaterThanOrEqual(0);
  });
});

describe("simulateOverlayRisk — epistemic shrink (2-layer)", () => {
  it("higher n → tighter entries band, but band > 0 (aleatoric floor) and P5<P50<P95", () => {
    const band = (n: number) => {
      const r = simulateOverlayRisk(inp({ n }));
      return { w: r.entP95 - r.entP5, r };
    };
    const b2 = band(2);
    const b6 = band(6);
    const b20 = band(20);
    expect(b6.w).toBeLessThan(b2.w);
    expect(b20.w).toBeLessThan(b6.w);
    expect(b20.w).toBeGreaterThan(0); // never collapses to a point
    expect(b20.r.entP5).toBeLessThan(b20.r.entP50);
    expect(b20.r.entP50).toBeLessThan(b20.r.entP95);
  });

  it("center = geometric mean (entP50 ≈ exp(meanLog) ≈ 1367 for [795,2350])", () => {
    const r = simulateOverlayRisk(inp({ n: 20 })); // tight band → median near the geomean
    expect(Math.round(Math.exp(r.meanLog))).toBe(1367);
    expect(r.entP50).toBeGreaterThan(1200);
    expect(r.entP50).toBeLessThan(1550);
  });
});

describe("simulateOverlayRisk — bins + guards + determinism", () => {
  it("Σ bins.count = nSims and overlayCount ≤ count per bin", () => {
    const r = simulateOverlayRisk(inp({ gtd: 25e9, nSims: 5000 }));
    expect(r.bins.reduce((s, b) => s + b.count, 0)).toBe(5000);
    for (const b of r.bins) expect(b.overlayCount).toBeLessThanOrEqual(b.count);
  });

  it("empty observations / non-positive buy-in → unusable", () => {
    expect(simulateOverlayRisk(inp({ observedEntries: [] })).usable).toBe(false);
    expect(simulateOverlayRisk(inp({ buyinPrize: 0 })).usable).toBe(false);
  });

  it("a single observation still works (n=1 = widest)", () => {
    const r = simulateOverlayRisk(inp({ observedEntries: [1000], n: 1 }));
    expect(r.usable).toBe(true);
    expect(r.entP95 - r.entP5).toBeGreaterThan(0);
  });

  it("deterministic for a fixed seed; differs for another", () => {
    expect(JSON.stringify(simulateOverlayRisk(inp({ seed: 7 })))).toBe(JSON.stringify(simulateOverlayRisk(inp({ seed: 7 }))));
    expect(simulateOverlayRisk(inp({ seed: 7 })).entP50).not.toBe(simulateOverlayRisk(inp({ seed: 8 })).entP50);
  });

  it("demo sanity: obs [795,2350], GTD 25b, n=6 → P(overlay) in 0.14–0.22", () => {
    const r = simulateOverlayRisk(inp({ gtd: 25e9, n: 6 }));
    expect(r.pOverlay).toBeGreaterThan(0.14);
    expect(r.pOverlay).toBeLessThan(0.22);
  });
});
