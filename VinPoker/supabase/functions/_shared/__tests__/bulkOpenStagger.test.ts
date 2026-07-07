// F1 — tests for the manual bulk-open centered stagger (pure helper).
// Run: deno test supabase/functions/_shared/__tests__/bulkOpenStagger.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { bulkOpenStaggerMs } from "../openTableGrace.ts";
import { SWING_POLICY } from "../swingPolicy.ts";

const STEP_MS = SWING_POLICY.bulkOpen.staggerStepMinutes * 60_000;   // 2 min
const CAP_MS = SWING_POLICY.bulkOpen.maxStaggerMinutes * 60_000;     // 20 min

Deno.test("single / empty / non-finite → 0 (no stagger)", () => {
  assertEquals(bulkOpenStaggerMs(0, 1), 0);
  assertEquals(bulkOpenStaggerMs(0, 0), 0);
  assertEquals(bulkOpenStaggerMs(0, -3), 0);
  assertEquals(bulkOpenStaggerMs(NaN, 20), 0);
  assertEquals(bulkOpenStaggerMs(0, Infinity), 0);
});

Deno.test("n=20 → symmetric 2-min fan-out, mean 0", () => {
  const n = 20;
  const offsets = Array.from({ length: n }, (_, i) => bulkOpenStaggerMs(i, n));
  // centered: i=0 → −(19/2)*step, i=19 → +(19/2)*step
  assertEquals(offsets[0], Math.round(-9.5 * STEP_MS));   // −19 min
  assertEquals(offsets[19], Math.round(9.5 * STEP_MS));   // +19 min
  // symmetric (sum ≈ 0) + strictly increasing
  assertEquals(offsets.reduce((s, o) => s + o, 0), 0);
  for (let i = 1; i < n; i++) {
    if (!(offsets[i] > offsets[i - 1])) throw new Error(`not monotonic at ${i}`);
  }
  // within cap
  for (const o of offsets) {
    if (Math.abs(o) > CAP_MS) throw new Error(`offset ${o} exceeds cap ${CAP_MS}`);
  }
});

Deno.test("n=30 → widest offset still within the ±20-min cap", () => {
  const n = 30;
  const first = bulkOpenStaggerMs(0, n);
  const last = bulkOpenStaggerMs(n - 1, n);
  // raw would be ±(29/2)*2 = ±29 min → clamped to ±20.
  assertEquals(first, -CAP_MS);
  assertEquals(last, CAP_MS);
});

Deno.test("large batch (n=50) → offsets clamped, not silently pushed far", () => {
  const n = 50;
  for (let i = 0; i < n; i++) {
    const o = bulkOpenStaggerMs(i, n);
    if (Math.abs(o) > CAP_MS) throw new Error(`n=50 offset ${o} exceeds cap`);
  }
  // ends are exactly clamped
  assertEquals(bulkOpenStaggerMs(0, n), -CAP_MS);
  assertEquals(bulkOpenStaggerMs(n - 1, n), CAP_MS);
});

Deno.test("worst first-stint (grace 6 + duration 45 + max offset) stays under 90 for n=20/30", () => {
  const graceMin = 6;
  const durationMin = 45;
  for (const n of [20, 30]) {
    const maxOffsetMin = bulkOpenStaggerMs(n - 1, n) / 60_000;
    const worstStint = graceMin + durationMin + maxOffsetMin;
    if (worstStint > 90) throw new Error(`n=${n} worst stint ${worstStint} > 90`);
  }
});
