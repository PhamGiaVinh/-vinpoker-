import { describe, it, expect } from "vitest";
import { estimatePaceFraction, nowcastBlend, PACE_HORIZON_DAYS, type PastEventPace } from "./nowcast";

const day = 86_400_000;
const iso = (base: number, offsetDays: number): string => new Date(base + offsetDays * day).toISOString();

describe("estimatePaceFraction", () => {
  it("median fraction registered by k days before start, over past events (leakage-safe cutoff)", () => {
    const start = new Date("2026-06-01T00:00:00Z").getTime();
    // 10 regs: 5 at T-10, 5 at T-2. finalTotal 10. At k=7 → only the T-10 ones count → 0.5.
    const past: PastEventPace[] = [
      {
        startTime: iso(start, 0),
        finalTotal: 10,
        registrationTimes: [...Array(5)].map(() => iso(start, -10)).concat([...Array(5)].map(() => iso(start, -2))),
      },
    ];
    expect(estimatePaceFraction(past, 7)).toBe(0.5);
    expect(estimatePaceFraction(past, 1)).toBe(1); // by T-1 all 10 registered
    expect(estimatePaceFraction(past, 15)).toBe(0); // nobody yet 15 days out
  });

  it("takes the MEDIAN across events + ignores finalTotal≤0", () => {
    const s = new Date("2026-06-01").getTime();
    const past: PastEventPace[] = [
      { startTime: iso(s, 0), finalTotal: 10, registrationTimes: [...Array(2)].map(() => iso(s, -10)) }, // 0.2
      { startTime: iso(s, 0), finalTotal: 10, registrationTimes: [...Array(6)].map(() => iso(s, -10)) }, // 0.6
      { startTime: iso(s, 0), finalTotal: 10, registrationTimes: [...Array(4)].map(() => iso(s, -10)) }, // 0.4
      { startTime: iso(s, 0), finalTotal: 0, registrationTimes: [] }, // ignored
    ];
    expect(estimatePaceFraction(past, 7)).toBe(0.4); // median of 0.2,0.4,0.6
  });

  it("no usable history → null", () => {
    expect(estimatePaceFraction([], 7)).toBeNull();
    expect(estimatePaceFraction([{ startTime: "2026-06-01", finalTotal: 0, registrationTimes: [] }], 7)).toBeNull();
  });
});

describe("nowcastBlend", () => {
  it("blends in log space; nearer the event weights pace more", () => {
    // paceImplied = R/τ = 40/0.5 = 80; model 120.
    const near = nowcastBlend({ registrationsSoFar: 40, daysToEvent: 1, paceFraction: 0.5, modelForecast: 120 });
    const far = nowcastBlend({ registrationsSoFar: 40, daysToEvent: 20, paceFraction: 0.5, modelForecast: 120 });
    expect(near.paceImplied).toBe(80);
    expect(near.weightPace).toBeGreaterThan(far.weightPace); // nearer → more pace weight
    expect(near.blended).toBeLessThan(far.blended); // near pulls toward the lower pace-implied 80
    expect(near.basis).toBe("blend");
  });

  it("weightPace rises with pace reliability (bigger τ)", () => {
    const thin = nowcastBlend({ registrationsSoFar: 5, daysToEvent: 7, paceFraction: 0.05, modelForecast: 120 });
    const solid = nowcastBlend({ registrationsSoFar: 60, daysToEvent: 7, paceFraction: 0.5, modelForecast: 120 });
    expect(thin.weightPace).toBeLessThan(solid.weightPace); // thin early pace can't dominate
  });

  it("no pace history → model-only", () => {
    const r = nowcastBlend({ registrationsSoFar: 40, daysToEvent: 7, paceFraction: null, modelForecast: 120 });
    expect(r.basis).toBe("model-only");
    expect(r.blended).toBe(120);
    expect(r.weightPace).toBe(0);
  });

  it("no model → pace-only", () => {
    const r = nowcastBlend({ registrationsSoFar: 40, daysToEvent: 3, paceFraction: 0.5, modelForecast: null });
    expect(r.basis).toBe("pace-only");
    expect(r.blended).toBe(80);
    expect(r.weightPace).toBe(1);
  });

  it("neither → unavailable", () => {
    const r = nowcastBlend({ registrationsSoFar: 0, daysToEvent: 5, paceFraction: null, modelForecast: null });
    expect(r.available).toBe(false);
    expect(r.basis).toBe("none");
  });

  it("k beyond the horizon → nearness 0 → weight ~0 (model dominates)", () => {
    const r = nowcastBlend({ registrationsSoFar: 40, daysToEvent: PACE_HORIZON_DAYS + 5, paceFraction: 0.5, modelForecast: 120 });
    expect(r.weightPace).toBe(0);
    expect(r.blended).toBe(120);
  });

  it("is deterministic", () => {
    const i = { registrationsSoFar: 33, daysToEvent: 4, paceFraction: 0.4, modelForecast: 100 };
    expect(nowcastBlend(i)).toEqual(nowcastBlend(i));
  });
});
