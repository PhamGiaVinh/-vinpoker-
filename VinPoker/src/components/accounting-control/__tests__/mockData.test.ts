// Khóa doctrine cho fixtures của "Tài chính & Đối soát" — sửa mockData.ts phải giữ các test này xanh.
// Nguồn công thức: VBacker/09-ACCOUNTING-CONTROL + skill vinpoker-business-quant.
import { describe, expect, it } from "vitest";
import {
  MOCK_ALERTS,
  MOCK_CASH_CHANNELS,
  MOCK_DAILY_CLOSE,
  MOCK_ENTRY_FORECAST,
  MOCK_ESCROW,
  MOCK_EVENTS,
  MOCK_FNB_NOT_WIRED,
  MOCK_MONTHLY,
  MOCK_OVERVIEW,
  MOCK_PAYOUT,
  MOCK_PAYROLL,
  MOCK_SERIES,
  MOCK_TABLE_HOUR,
} from "../mock/mockData";
import type { RangeForecast } from "../mock/types";

const sumCosts = (ev: (typeof MOCK_EVENTS)[number]) =>
  ev.costs.filter((c) => !c.missing).reduce((s, c) => s + c.amount, 0);

describe("Event P&L fixtures obey the canonical formulas", () => {
  it.each(MOCK_EVENTS.map((e) => [e.name, e] as const))("%s", (_name, ev) => {
    expect(ev.feePerEntry + ev.poolPerEntry).toBe(ev.buyInPerEntry);
    expect(ev.playerFundedPool).toBe(ev.entries * ev.poolPerEntry);
    expect(ev.retainedFee).toBe(ev.entries * ev.feePerEntry);
    expect(ev.gtdSubsidy).toBe(Math.max(0, (ev.gtd ?? 0) - ev.playerFundedPool));
    expect(ev.contribution).toBe(ev.retainedFee + ev.otherRevenue - ev.gtdSubsidy - sumCosts(ev));
  });

  it("Deepstack: dual break-even — GTD 100 vs contribution 104, recomputed from inputs", () => {
    const ds = MOCK_EVENTS.find((e) => e.id === "deepstack-500")!;
    expect(ds.breakEvenGtdEntries).toBe(Math.ceil(ds.gtd! / ds.poolPerEntry)); // = 100
    expect(ds.breakEvenGtdEntries).toBe(100);
    const directCosts = sumCosts(ds);
    expect(ds.breakEvenContributionEntries).toBe(
      Math.ceil((ds.gtd! + directCosts - ds.otherRevenue) / ds.poolPerEntry), // = 104
    );
    expect(ds.breakEvenContributionEntries).toBe(104);
    expect(ds.contribution).toBeLessThan(0); // giải overlay phải âm — không tô hồng
  });

  it("non-GTD event carries NO break-even numbers (no formula drift)", () => {
    const tb = MOCK_EVENTS.find((e) => e.id === "daily-turbo")!;
    expect(tb.breakEvenGtdEntries).toBeNull();
    expect(tb.breakEvenContributionEntries).toBeNull();
  });

  it("every event models the missing PT wage line as missing:true, never as 0-cost truth", () => {
    for (const ev of MOCK_EVENTS) {
      const pt = ev.costs.find((c) => c.missing);
      expect(pt, ev.id).toBeDefined();
      expect(pt!.note).toMatch(/#656 R2/);
    }
  });
});

describe("Overview roll-up is consistent by construction", () => {
  it("retained / costs / subsidy / contribution equal the event sums", () => {
    const retained = MOCK_EVENTS.reduce((s, e) => s + e.retainedFee, 0);
    const costs = MOCK_EVENTS.reduce((s, e) => s + sumCosts(e), 0);
    const subsidy = MOCK_EVENTS.reduce((s, e) => s + e.gtdSubsidy, 0);
    const contribution = MOCK_EVENTS.reduce((s, e) => s + e.contribution, 0);
    expect(MOCK_OVERVIEW.retainedRevenue).toBe(retained);
    expect(MOCK_OVERVIEW.directCosts).toBe(costs);
    expect(MOCK_OVERVIEW.gtdSubsidy).toBe(subsidy);
    expect(MOCK_OVERVIEW.contribution).toBe(contribution);
    expect(MOCK_OVERVIEW.passThroughPool).toBe(
      MOCK_EVENTS.reduce((s, e) => s + e.playerFundedPool, 0),
    );
  });

  it("liabilities held = payout owed + escrow balance; openAlerts = non-explained queue items", () => {
    expect(MOCK_OVERVIEW.liabilitiesHeld).toBe(MOCK_OVERVIEW.payoutOwed + MOCK_OVERVIEW.escrowHeld);
    expect(MOCK_OVERVIEW.payoutOwed).toBe(MOCK_PAYOUT.owedTotal);
    expect(MOCK_OVERVIEW.escrowHeld).toBe(MOCK_ESCROW.balance);
    expect(MOCK_OVERVIEW.openAlerts).toBe(MOCK_ALERTS.filter((a) => a.status !== "explained").length);
  });
});

describe("Liability fixtures", () => {
  it("payout: paid + owed settle exactly the pool + GTD subsidy (nothing vanishes)", () => {
    const ds = MOCK_EVENTS.find((e) => e.id === "deepstack-500")!;
    expect(MOCK_PAYOUT.totalPrizes).toBe(ds.playerFundedPool + ds.gtdSubsidy);
    expect(MOCK_PAYOUT.paidTotal + MOCK_PAYOUT.owedTotal).toBe(MOCK_PAYOUT.totalPrizes);
    expect(MOCK_PAYOUT.owedRows.reduce((s, r) => s + r.amount, 0)).toBe(MOCK_PAYOUT.owedTotal);
  });

  it("escrow control invariant: in = released + refunded + balance; held rows = balance", () => {
    const e = MOCK_ESCROW;
    expect(e.totalIn).toBe(e.released + e.refunded + e.balance);
    const heldRows = e.rows.filter((r) => r.status === "held" || r.status === "refund_pending_repair");
    expect(heldRows.reduce((s, r) => s + r.amount, 0)).toBe(e.balance);
  });
});

describe("Cash / series / payroll consistency", () => {
  it("SePay variance buckets explain exactly the bank-vs-app difference", () => {
    const sepay = MOCK_CASH_CHANNELS.find((c) => c.channel === "sepay")!;
    const bucketSum = sepay.buckets.reduce((s, b) => s + b.amount, 0);
    expect(bucketSum).toBe(sepay.actual - sepay.expected);
  });

  it("series allocations state their rule and sum per-event exactly; roll-up matches", () => {
    for (const alloc of MOCK_SERIES.allocations) {
      expect(alloc.rule.length).toBeGreaterThan(10);
      expect(alloc.perEvent.reduce((s, p) => s + p.amount, 0)).toBe(alloc.amount);
    }
    const allocTotal = MOCK_SERIES.allocations.reduce((s, a) => s + a.amount, 0);
    expect(MOCK_SERIES.contributionAfterAllocations).toBe(
      MOCK_SERIES.eventContributionTotal - allocTotal,
    );
    expect(MOCK_SERIES.eventContributionTotal).toBe(MOCK_OVERVIEW.contribution);
  });

  it("table-hour cost derives from payroll totals (excluding the missing PT line)", () => {
    const staffCost = MOCK_PAYROLL.filter((l) => typeof l.amount === "number").reduce(
      (s, l) => s + (l.amount as number),
      0,
    );
    expect(MOCK_TABLE_HOUR.staffCost).toBe(staffCost);
    expect(MOCK_TABLE_HOUR.costPerTableHour).toBe(
      Math.round(staffCost / MOCK_TABLE_HOUR.tableHours / 1000) * 1000,
    );
  });
});

describe("Doctrine guards", () => {
  it("the 3 repair-wave sample warnings exist, labeled sample, and not silently explained away", () => {
    for (const bucket of ["payroll", "payout", "staking"] as const) {
      const item = MOCK_ALERTS.find((a) => a.bucket === bucket && a.sample);
      expect(item, bucket).toBeDefined();
      expect(item!.status).not.toBe("explained");
      expect(`${item!.title} ${item!.detail}`).toMatch(/mẫu|MODULE_STATUS/i);
    }
  });

  it("every forecast is a range (never a point number presented as truth)", () => {
    const ranges: RangeForecast[] = [MOCK_ENTRY_FORECAST];
    for (const line of MOCK_PAYROLL) {
      if (line.state === "forecast") {
        expect(typeof line.amount).toBe("object");
        ranges.push(line.amount as RangeForecast);
      }
    }
    for (const r of ranges) {
      expect(r.min).toBeLessThan(r.max);
      expect(r.typical).toBeGreaterThanOrEqual(r.min);
      expect(r.typical).toBeLessThanOrEqual(r.max);
      expect(r.baselineNote.length).toBeGreaterThan(5);
    }
  });

  it('banned wording never appears in fixtures ("lợi nhuận", "lãi ròng", "net profit")', () => {
    const all = JSON.stringify({
      MOCK_EVENTS, MOCK_OVERVIEW, MOCK_ENTRY_FORECAST, MOCK_SERIES, MOCK_CASH_CHANNELS,
      MOCK_PAYOUT, MOCK_PAYROLL, MOCK_TABLE_HOUR, MOCK_ESCROW, MOCK_ALERTS, MOCK_MONTHLY,
      MOCK_DAILY_CLOSE, MOCK_FNB_NOT_WIRED,
    });
    expect(all).not.toMatch(/lợi nhuận|loi nhuan|lãi ròng|lai rong|net profit/i);
  });

  it("only truly-closed things carry Đã chốt (final): the Turbo event and paid payout rows", () => {
    expect(MOCK_EVENTS.find((e) => e.id === "daily-turbo")!.state).toBe("final");
    expect(MOCK_EVENTS.find((e) => e.id === "deepstack-500")!.state).toBe("provisional");
    expect(MOCK_SERIES.state).toBe("provisional");
    for (const ch of MOCK_CASH_CHANNELS) expect(ch.state).not.toBe("final");
  });
});
