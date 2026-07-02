import { describe, it, expect } from "vitest";
import {
  computeCloseReport,
  type CloseReportEntry,
  type CloseReportInput,
} from "./closeReport";

// Build N confirmed entries with a shared shape. The first `freeRake` entries have
// their rake waived (rakeCharged = 0, usedFreeRake = true) to mirror the live free-rake path.
function entries(opts: {
  n: number;
  buyIn: number;
  rake: number;
  service: number;
  freeRake?: number;
  source?: CloseReportEntry["source"];
}): CloseReportEntry[] {
  const { n, buyIn, rake, service, freeRake = 0, source = "online" } = opts;
  return Array.from({ length: n }, (_, i) => {
    const waived = i < freeRake;
    const rakeCharged = waived ? 0 : rake;
    const serviceCharged = service;
    return {
      totalPay: buyIn + rakeCharged + serviceCharged,
      buyIn,
      rakeCharged,
      serviceCharged,
      source,
      usedFreeRake: waived,
    };
  });
}

describe("computeCloseReport — conservation & reconciliation", () => {
  it("clean pass-through case (mockup): drawer == club revenue, reconciled", () => {
    const input: CloseReportInput = {
      entries: entries({ n: 60, buyIn: 500_000, rake: 50_000, service: 20_000, freeRake: 5 }),
      // prize pool == total buy-ins (fully funded by players), split across places
      payouts: [
        { position: 1, prize: 12_000_000 },
        { position: 2, prize: 7_500_000 },
        { position: 3, prize: 4_500_000 },
        { position: 4, prize: 3_000_000 },
        { position: 5, prize: 1_500_000 },
        { position: 6, prize: 1_500_000 },
      ],
    };
    const r = computeCloseReport(input);

    expect(r.buyInTotal).toBe(30_000_000); // 60 × 500k, pass-through
    expect(r.rakeTotal).toBe(2_750_000); // 55 paying × 50k (5 free-rake)
    expect(r.serviceTotal).toBe(1_200_000); // 60 × 20k (service always applies)
    expect(r.cashInTotal).toBe(33_950_000);
    expect(r.prizeTotal).toBe(30_000_000);
    expect(r.clubRevenue).toBe(3_950_000); // rake + service only
    expect(r.cashierBalance).toBe(3_950_000); // cashIn − cashOut
    expect(r.reconcileDelta).toBe(0);
    expect(r.reconciled).toBe(true);
    expect(r.freeRakeUsed).toBe(5);
    expect(r.overlay).toBe(0);
  });

  it("sum-in = sum-out identities always hold", () => {
    const r = computeCloseReport({
      entries: entries({ n: 23, buyIn: 300_000, rake: 40_000, service: 0, freeRake: 3 }),
      payouts: [{ position: 1, prize: 4_000_000 }, { position: 2, prize: 2_000_000 }],
      cashouts: [123_456],
    });
    expect(r.cashInTotal).toBe(r.buyInTotal + r.rakeTotal + r.serviceTotal);
    expect(r.cashOutTotal).toBe(r.prizeTotal + r.cashoutTotal);
    expect(r.cashierBalance).toBe(r.cashInTotal - r.cashOutTotal);
    expect(r.reconcileDelta).toBe(r.cashierBalance - r.clubRevenue);
    expect(r.clubRevenue).toBe(r.rakeTotal + r.serviceTotal);
  });

  it("overlay: club topped up the pool beyond buy-ins → not reconciled, overlay > 0", () => {
    const r = computeCloseReport({
      entries: entries({ n: 10, buyIn: 1_000_000, rake: 100_000, service: 0 }),
      payouts: [{ position: 1, prize: 15_000_000 }], // GTD overlay: 15M paid on 10M buy-ins
    });
    expect(r.buyInTotal).toBe(10_000_000);
    expect(r.prizeTotal).toBe(15_000_000);
    expect(r.overlay).toBe(5_000_000);
    expect(r.surplusToPool).toBe(0);
    expect(r.reconciled).toBe(false);
    expect(r.reconcileDelta).toBe(-5_000_000); // drawer short by the overlay
  });

  it("surplus: buy-ins exceeded prize paid → not reconciled, surplusToPool > 0", () => {
    const r = computeCloseReport({
      entries: entries({ n: 10, buyIn: 1_000_000, rake: 100_000, service: 0 }),
      payouts: [{ position: 1, prize: 8_000_000 }], // only 8M paid on 10M buy-ins
    });
    expect(r.surplusToPool).toBe(2_000_000);
    expect(r.overlay).toBe(0);
    expect(r.reconciled).toBe(false);
    expect(r.reconcileDelta).toBe(2_000_000);
  });

  it("cash-out side stream reduces the drawer and breaks the clean reconcile", () => {
    const base = entries({ n: 10, buyIn: 1_000_000, rake: 100_000, service: 0 });
    const payouts = [{ position: 1, prize: 10_000_000 }]; // pass-through balanced
    expect(computeCloseReport({ entries: base, payouts }).reconciled).toBe(true);
    const withCashout = computeCloseReport({ entries: base, payouts, cashouts: [500_000, 250_000] });
    expect(withCashout.cashoutTotal).toBe(750_000);
    expect(withCashout.reconciled).toBe(false);
    expect(withCashout.reconcileDelta).toBe(-750_000);
  });

  it("service fee off → club revenue is rake only", () => {
    const r = computeCloseReport({
      entries: entries({ n: 8, buyIn: 500_000, rake: 50_000, service: 0 }),
      payouts: [{ position: 1, prize: 4_000_000 }],
    });
    expect(r.serviceTotal).toBe(0);
    expect(r.clubRevenue).toBe(r.rakeTotal);
    expect(r.clubRevenue).toBe(400_000);
  });

  it("free-rake waives rake only, never the service fee", () => {
    const r = computeCloseReport({
      entries: entries({ n: 4, buyIn: 500_000, rake: 50_000, service: 20_000, freeRake: 4 }),
      payouts: [],
    });
    expect(r.rakeTotal).toBe(0); // all 4 waived
    expect(r.serviceTotal).toBe(80_000); // 4 × 20k service still charged
    expect(r.freeRakeUsed).toBe(4);
    expect(r.clubRevenue).toBe(80_000);
  });

  it("counts entries by source (online / offline / reentry)", () => {
    const r = computeCloseReport({
      entries: [
        ...entries({ n: 5, buyIn: 500_000, rake: 50_000, service: 0, source: "online" }),
        ...entries({ n: 3, buyIn: 500_000, rake: 50_000, service: 0, source: "offline" }),
        ...entries({ n: 2, buyIn: 500_000, rake: 50_000, service: 0, source: "reentry" }),
      ],
      payouts: [],
    });
    expect(r.entryCount).toBe(10);
    expect(r.bySource).toEqual({ online: 5, offline: 3, reentry: 2 });
    expect(r.reentryCount).toBe(2);
  });

  it("empty tournament → all zeros, trivially reconciled", () => {
    const r = computeCloseReport({ entries: [], payouts: [] });
    expect(r.entryCount).toBe(0);
    expect(r.cashInTotal).toBe(0);
    expect(r.cashOutTotal).toBe(0);
    expect(r.clubRevenue).toBe(0);
    expect(r.reconcileDelta).toBe(0);
    expect(r.reconciled).toBe(true);
  });
});
