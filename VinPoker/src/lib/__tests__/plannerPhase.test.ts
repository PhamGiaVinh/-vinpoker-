import { describe, expect, it } from "vitest";
import { chipStates, ctaFor, initialStep, type PlannerFlags } from "@/lib/shiftPlanner/plannerPhase";

const base: PlannerFlags = { draftExists: false, dirty: false, saved: false, published: false, shortage: 0 };

describe("plannerPhase (V2 flow derivation)", () => {
  it("fresh day: step 1 active, CTA = Tạo nháp AI", () => {
    expect(chipStates(1, base)[1]).toBe("active");
    expect(chipStates(1, base)[4]).toBe("todo");
    expect(ctaFor(1, base).action).toBe("generate");
    expect(initialStep(base)).toBe(1);
  });

  it("draft exists + dirty: step 1 done, review CTA saves", () => {
    const f: PlannerFlags = { ...base, draftExists: true, dirty: true };
    expect(chipStates(3, f)[1]).toBe("done");
    expect(chipStates(3, f)[3]).toBe("active");
    expect(ctaFor(2, f).action).toBe("goReview");
    expect(ctaFor(3, f).action).toBe("save");
    expect(initialStep(f)).toBe(3);
  });

  it("saved: steps 1–3 done, step 4 CTA publishes", () => {
    const f: PlannerFlags = { ...base, draftExists: true, saved: true };
    expect(chipStates(4, f)[3]).toBe("done");
    expect(ctaFor(3, f).action).toBe("publish");
    expect(ctaFor(4, f).action).toBe("publish");
    expect(initialStep(f)).toBe(4);
  });

  it("published: everything done, no CTA", () => {
    const f: PlannerFlags = { ...base, draftExists: true, saved: true, published: true };
    const states = chipStates(2, f);
    expect(states[1]).toBe("done");
    expect(states[4]).toBe("done");
    expect(ctaFor(2, f).action).toBe("none");
    expect(initialStep(f)).toBe(4);
  });
});
