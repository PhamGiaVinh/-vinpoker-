import { describe, it, expect } from "vitest";
import {
  normalizeStatus, isUnpaid, agingBucket, daysBetween, margin,
  formatPct, monthKey, monthLabel, formatVndShort,
} from "./clubFinance";

describe("clubFinance helpers", () => {
  it("normalizeStatus maps known + unknown", () => {
    expect(normalizeStatus("LOCKED")).toBe("locked");
    expect(normalizeStatus(" paid ")).toBe("paid");
    expect(normalizeStatus("reconciled")).toBe("reconciled");
    expect(normalizeStatus(null)).toBe("other");
    expect(normalizeStatus("weird")).toBe("other");
  });

  it("isUnpaid covers owed statuses only", () => {
    expect(isUnpaid("locked")).toBe(true);
    expect(isUnpaid("approved")).toBe(true);
    expect(isUnpaid("payment_prepared")).toBe(true);
    expect(isUnpaid("paid")).toBe(false);
    expect(isUnpaid("reconciled")).toBe(false);
    expect(isUnpaid("draft")).toBe(false);
  });

  it("agingBucket boundaries", () => {
    expect(agingBucket(0)).toBe("d0_30");
    expect(agingBucket(30)).toBe("d0_30");
    expect(agingBucket(31)).toBe("d31_60");
    expect(agingBucket(60)).toBe("d31_60");
    expect(agingBucket(61)).toBe("d61_90");
    expect(agingBucket(90)).toBe("d61_90");
    expect(agingBucket(91)).toBe("d90p");
    expect(agingBucket(999)).toBe("d90p");
  });

  it("daysBetween is non-negative and floors", () => {
    const now = new Date("2026-06-14T00:00:00Z").getTime();
    expect(daysBetween("2026-06-04T00:00:00Z", now)).toBe(10);
    expect(daysBetween("2026-07-01T00:00:00Z", now)).toBe(0); // future → clamped 0
    expect(daysBetween("not-a-date", now)).toBe(0);
  });

  it("margin guards divide-by-zero", () => {
    expect(margin(50, 100)).toBe(0.5);
    expect(margin(50, 0)).toBe(0);
    expect(formatPct(0.61)).toBe("61%");
  });

  it("monthKey / monthLabel", () => {
    expect(monthKey("2026-06-14T10:00:00Z")).toBe("2026-06");
    expect(monthLabel("2026-06")).toBe("06/26");
  });

  it("formatVndShort compacts", () => {
    expect(formatVndShort(0)).toBe("0");
    expect(formatVndShort(950)).toBe("950");
    expect(formatVndShort(1_500)).toBe("2k");
    expect(formatVndShort(1_200_000)).toBe("1,2tr");
    expect(formatVndShort(2_000_000)).toBe("2tr");
    expect(formatVndShort(2_500_000_000)).toBe("2,5tỷ");
    expect(formatVndShort(-1_200_000)).toBe("-1,2tr");
  });
});
