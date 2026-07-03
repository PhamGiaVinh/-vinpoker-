import { describe, it, expect } from "vitest";
import { computeKellyHint, type KellyHintInput } from "./kellyHint";

// Base: μ=10tr, σ from P5–P95 span. Choose p5/p95 so σ is a round number:
// σ = (p95−p5)/3.29. Want σ=20tr ⇒ span=65.8tr ⇒ p5=−22.9tr, p95=42.9tr (μ≈10tr in between).
// Then B* = σ²/μ = (20tr)²/10tr = 40tr; half=80tr; quarter=160tr.
const base = (over: Partial<KellyHintInput> = {}): KellyHintInput => ({
  eEV: 10_000_000,
  p5: -22_900_000,
  p95: 42_900_000,
  bankroll: 100_000_000,
  mode: "profit",
  ...over,
});

const TR = 1_000_000;
const near = (a: number, b: number, tolTr = 1) => Math.abs(a - b) < tolTr * TR;

describe("computeKellyHint", () => {
  it("computes B* = σ²/μ, half=2B*, quarter=4B* (σ from P5–P95 span)", () => {
    const r = computeKellyHint(base());
    expect(r.available).toBe(true);
    expect(near(r.sigmaApprox!, 20 * TR)).toBe(true);
    expect(near(r.fullKellyBankroll!, 40 * TR)).toBe(true);
    expect(near(r.halfKellyBankroll!, 80 * TR)).toBe(true);
    expect(near(r.quarterKellyBankroll!, 160 * TR)).toBe(true);
  });

  it("bankroll ≥ 4·B* → conservative", () => {
    expect(computeKellyHint(base({ bankroll: 200 * TR })).verdict).toBe("conservative");
  });

  it("2·B* ≤ bankroll < 4·B* → acceptable", () => {
    expect(computeKellyHint(base({ bankroll: 100 * TR })).verdict).toBe("acceptable");
  });

  it("B* ≤ bankroll < 2·B* → aggressive", () => {
    expect(computeKellyHint(base({ bankroll: 50 * TR })).verdict).toBe("aggressive");
  });

  it("bankroll < B* → over-committed (ruin risk)", () => {
    const r = computeKellyHint(base({ bankroll: 30 * TR }));
    expect(r.verdict).toBe("over-committed");
    expect(r.headline).toMatch(/quá tay/);
  });

  it("negative EV → negative-ev, no bankroll figures, 'không nên cam kết'", () => {
    const r = computeKellyHint(base({ eEV: -5 * TR }));
    expect(r.available).toBe(true);
    expect(r.verdict).toBe("negative-ev");
    expect(r.fullKellyBankroll).toBeNull();
    expect(r.headline).toMatch(/KHÔNG nên cam kết/);
  });

  it("zero EV is treated as no-edge → negative-ev", () => {
    expect(computeKellyHint(base({ eEV: 0 })).verdict).toBe("negative-ev");
  });

  it("gross mode → insufficient-data (unavailable)", () => {
    const r = computeKellyHint(base({ mode: "gross", eEV: null }));
    expect(r.available).toBe(false);
    expect(r.verdict).toBe("insufficient-data");
  });

  it("no / zero / negative bankroll → insufficient-data (never inferred)", () => {
    expect(computeKellyHint(base({ bankroll: null })).available).toBe(false);
    expect(computeKellyHint(base({ bankroll: 0 })).available).toBe(false);
    expect(computeKellyHint(base({ bankroll: -1 })).available).toBe(false);
  });

  it("zero spread (p5==p95) → insufficient-data (can't speak about risk)", () => {
    const r = computeKellyHint(base({ p5: 10 * TR, p95: 10 * TR }));
    expect(r.available).toBe(false);
    expect(r.verdict).toBe("insufficient-data");
  });

  it("is deterministic (pure) for identical input", () => {
    const a = computeKellyHint(base());
    const b = computeKellyHint(base());
    expect(a).toEqual(b);
  });

  it("always carries the approximation caveat", () => {
    expect(computeKellyHint(base()).caveat).toMatch(/giả định phân phối gần chuẩn/);
    expect(computeKellyHint(base({ mode: "gross", eEV: null })).caveat).toMatch(/tham khảo/);
  });

  it("bankroll exactly at a boundary is inclusive on the safer side (≥)", () => {
    // B*=40tr → bankroll exactly 40tr should be 'aggressive' (≥ full, < half), not over-committed.
    expect(computeKellyHint(base({ bankroll: 40 * TR })).verdict).toBe("aggressive");
    // exactly 80tr → 'acceptable' (≥ half); exactly 160tr → 'conservative' (≥ quarter).
    expect(computeKellyHint(base({ bankroll: 80 * TR })).verdict).toBe("acceptable");
    expect(computeKellyHint(base({ bankroll: 160 * TR })).verdict).toBe("conservative");
  });
});
