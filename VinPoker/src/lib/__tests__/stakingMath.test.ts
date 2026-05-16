import { describe, it, expect } from "vitest";
import { computeStakingPayouts, computeAskingPrice, ARCHIVE_FEE_VND } from "../stakingMath";

describe("stakingMath (Formula B: fixed archive fee 199K)", () => {
  it("asking price: 10M buy-in, 20%, 1.2 markup => 2.4M (markup priced into escrow)", () => {
    expect(computeAskingPrice(10_000_000, 20, 1.2)).toBe(2_400_000);
  });

  it("payouts: prize=0 => zeros (no fee charged)", () => {
    expect(computeStakingPayouts(0, 20)).toEqual({ player: 0, backer: 0, fee: 0 });
  });

  it("payouts: 100M prize, 30% sold => fee 199K, distributable 99.801M", () => {
    const r = computeStakingPayouts(100_000_000, 30);
    expect(r.fee).toBe(ARCHIVE_FEE_VND);
    expect(r.backer).toBe(Math.round(99_801_000 * 0.3));
    expect(r.player + r.backer + r.fee).toBe(100_000_000);
  });

  it("payouts: small prize (100K) capped at prize, never negative", () => {
    const r = computeStakingPayouts(100_000, 50);
    expect(r.fee).toBe(100_000);
    expect(r.player).toBe(0);
    expect(r.backer).toBe(0);
  });

  it("markup does NOT affect prize split", () => {
    const a = computeStakingPayouts(100_000_000, 20, 1.0);
    const b = computeStakingPayouts(100_000_000, 20, 2.0);
    expect(a).toEqual(b);
  });

  it("custom archive fee override works", () => {
    const r = computeStakingPayouts(100_000_000, 20, 1.0, undefined, 0);
    expect(r.fee).toBe(0);
    expect(r.backer).toBe(20_000_000);
  });
});
