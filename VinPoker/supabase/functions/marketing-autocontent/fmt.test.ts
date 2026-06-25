// deno test supabase/functions/marketing-autocontent/fmt.test.ts
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ddmm, fmtTimeVN, formatVND } from "./fmt.ts";

// P2-10: formatVND must match src/lib/format.ts (same Intl vi-VN currency call).
// vi-VN currency renders the symbol AFTER with a non-breaking space: "1.500.000 ₫".
Deno.test("formatVND: vi-VN currency, no decimals", () => {
  assertEquals(formatVND(1_500_000).replace(/ /g, " "), "1.500.000 ₫");
  assertEquals(formatVND(0).replace(/ /g, " "), "0 ₫");
  assertEquals(formatVND(500_000).replace(/ /g, " "), "500.000 ₫");
});

Deno.test("fmtTimeVN: HH:MM in Asia/Ho_Chi_Minh", () => {
  // 2026-06-25T03:30:00Z = 10:30 VN (+7)
  assertEquals(fmtTimeVN("2026-06-25T03:30:00Z"), "10:30");
  // 2026-06-25T19:00:00Z = 02:00 VN next day
  assertEquals(fmtTimeVN("2026-06-25T19:00:00Z"), "02:00");
});

Deno.test("ddmm: from YYYY-MM-DD", () => {
  assertEquals(ddmm("2026-06-26"), "26/06");
});

Deno.test("formatVND shape", () => {
  assertMatch(formatVND(12_345_678), /12\.345\.678/);
});
