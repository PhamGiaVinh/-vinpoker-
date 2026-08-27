import test from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "../../supabase/functions/_shared/mapWithConcurrency.ts";
import {
  isFreshDealerPoolAttendance,
  requiresStaleCheckoutCleanup,
} from "../../supabase/functions/_shared/checkoutSafety.ts";
import { summarizeDealerCheckoutBatch } from "../../src/lib/dealerCheckoutResults.ts";

test("27 dealer never exceed three concurrent workers", async () => {
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

  assert.equal(maxActive, 3);
  assert.deepEqual(results, ids);
});

test("missing Edge results are counted and explained", () => {
  const summary = summarizeDealerCheckoutBatch({ results: [] }, 27);
  assert.equal(summary.failedCount, 27);
  assert.match(summary.failureMessage, /Thiếu 27 kết quả từ máy chủ/);
});

test("server reasons are grouped for the operator", () => {
  const summary = summarizeDealerCheckoutBatch({
    results: [
      { success: false, error: "DB unavailable" },
      { success: false, error: "DB unavailable" },
      { success: false, error: "Invalid transition" },
    ],
  }, 3);
  assert.match(summary.failureMessage, /2× DB unavailable/);
  assert.match(summary.failureMessage, /Invalid transition/);
});

test("normal checkout fails closed for stale or invalid check-in time", () => {
  const now = Date.parse("2026-08-24T02:00:00Z");
  assert.equal(requiresStaleCheckoutCleanup("2026-08-23T18:00:00Z", now), false);
  assert.equal(requiresStaleCheckoutCleanup("2026-08-23T02:00:01Z", now), false);
  assert.equal(requiresStaleCheckoutCleanup("2026-08-23T02:00:00Z", now), true);
  assert.equal(requiresStaleCheckoutCleanup("2026-08-22T01:59:59Z", now), true);
  assert.equal(requiresStaleCheckoutCleanup(null, now), true);
  assert.equal(requiresStaleCheckoutCleanup("not-a-date", now), true);
  assert.equal(requiresStaleCheckoutCleanup("2026-08-24T03:00:00Z", now), true);
});

test("dealer pool only accepts valid check-ins strictly newer than 24 hours", () => {
  const now = Date.parse("2026-08-24T02:00:00Z");
  assert.equal(isFreshDealerPoolAttendance("2026-08-23T02:00:01Z", now), true);
  assert.equal(isFreshDealerPoolAttendance("2026-08-23T02:00:00Z", now), false);
  assert.equal(isFreshDealerPoolAttendance("2026-08-23T01:59:59Z", now), false);
  assert.equal(isFreshDealerPoolAttendance(null, now), false);
  assert.equal(isFreshDealerPoolAttendance("not-a-date", now), false);
  assert.equal(isFreshDealerPoolAttendance("2026-08-24T03:00:00Z", now), false);
});
