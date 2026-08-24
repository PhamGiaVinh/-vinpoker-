import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../supabase/functions/_shared/mapWithConcurrency.ts";
import { summarizeDealerCheckoutBatch } from "../src/lib/dealerCheckoutResults";
import { requiresStaleCheckoutCleanup } from "../supabase/functions/_shared/checkoutSafety.ts";

describe("checkout-dealer bounded concurrency", () => {
  it("keeps a 27-dealer batch at or below the configured concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const ids = Array.from({ length: 27 }, (_, index) => `attendance-${index}`);

    const results = await mapWithConcurrency(ids, 3, async (id) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return id;
    });

    expect(maxActive).toBe(3);
    expect(results).toEqual(ids);
  });

  it("keeps result order stable", async () => {
    const results = await mapWithConcurrency([30, 1, 20], 2, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return delay;
    });

    expect(results).toEqual([30, 1, 20]);
  });

  it("rejects an invalid concurrency instead of silently running unbounded", async () => {
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(
      "concurrency must be a positive integer",
    );
  });
});

describe("checkout-dealer result reporting", () => {
  it("shows grouped server reasons instead of only the failed count", () => {
    const summary = summarizeDealerCheckoutBatch({
      results: [
        { attendance_id: "a", success: false, error: "DB unavailable" },
        { attendance_id: "b", success: false, error: "DB unavailable" },
        { attendance_id: "c", success: false, error: "Invalid transition" },
      ],
    }, 3);

    expect(summary.successCount).toBe(0);
    expect(summary.failedCount).toBe(3);
    expect(summary.failureMessage).toContain("2× DB unavailable");
    expect(summary.failureMessage).toContain("Invalid transition");
  });

  it("treats missing result rows as failures", () => {
    const summary = summarizeDealerCheckoutBatch({ results: [] }, 27);

    expect(summary.failedCount).toBe(27);
    expect(summary.failureMessage).toContain("Thiếu 27 kết quả từ máy chủ");
  });
});

describe("checkout-dealer stale attendance guard", () => {
  const now = Date.parse("2026-08-24T02:00:00Z");

  it("allows a normal current shift", () => {
    expect(requiresStaleCheckoutCleanup("2026-08-23T18:00:00Z", now)).toBe(false);
  });

  it("routes an attendance older than 24 hours to cleanup", () => {
    expect(requiresStaleCheckoutCleanup("2026-08-22T01:59:59Z", now)).toBe(true);
  });

  it("fails closed for missing, invalid, or future check-in times", () => {
    expect(requiresStaleCheckoutCleanup(null, now)).toBe(true);
    expect(requiresStaleCheckoutCleanup("not-a-date", now)).toBe(true);
    expect(requiresStaleCheckoutCleanup("2026-08-24T03:00:00Z", now)).toBe(true);
  });
});
