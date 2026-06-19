// B2.1 — tests for the scaled lock-lease timeout (pure helper).
// Run: deno test supabase/functions/_shared/__tests__/lockTimeout.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { scaleLockTimeoutSeconds } from "../lockTimeout.ts";

// Mirrors process-swing SWING_THRESHOLDS (BASE=120, PER_TABLE=10, MAX=300).
const C = { baseSeconds: 120, perTableSeconds: 10, maxSeconds: 300 };

Deno.test("scaleLockTimeoutSeconds: worked examples", () => {
  assertEquals(scaleLockTimeoutSeconds(0, C), 120);   // no tables → base
  assertEquals(scaleLockTimeoutSeconds(5, C), 170);   // 120 + 50
  assertEquals(scaleLockTimeoutSeconds(10, C), 220);  // 120 + 100
  assertEquals(scaleLockTimeoutSeconds(18, C), 300);  // 120 + 180 = 300 (cap reached exactly)
  assertEquals(scaleLockTimeoutSeconds(20, C), 300);  // 120 + 200 = 320 → capped at 300
});

Deno.test("scaleLockTimeoutSeconds: cap is never exceeded for large counts", () => {
  assertEquals(scaleLockTimeoutSeconds(1000, C), 300);
});

Deno.test("scaleLockTimeoutSeconds: bad counts fall back to base (never below floor)", () => {
  assertEquals(scaleLockTimeoutSeconds(-3, C), 120);       // negative → 0 → base
  assertEquals(scaleLockTimeoutSeconds(NaN, C), 120);      // NaN → base
  assertEquals(scaleLockTimeoutSeconds(Infinity, C), 120); // non-finite → base
});

Deno.test("scaleLockTimeoutSeconds: fractional counts floor", () => {
  assertEquals(scaleLockTimeoutSeconds(5.9, C), 170); // floor(5.9)=5 → 120+50
});
