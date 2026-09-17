import { describe, expect, it } from "vitest";
import { normalizeCashierScan } from "./cashierScan";

describe("normalizeCashierScan", () => {
  it("keeps free text and transfer references", () => {
    expect(normalizeCashierScan("  Phạm Gia Vinh  ")).toBe("Phạm Gia Vinh");
    expect(normalizeCashierScan(" VINREG1234ABCD ")).toBe("VINREG1234ABCD");
  });
  it("uses known registration, member and receipt QR wrappers", () => {
    expect(normalizeCashierScan('{"registration_id":"22222222-2222-4222-8222-222222222222"}'))
      .toBe("22222222-2222-4222-8222-222222222222");
    expect(normalizeCashierScan("vinpoker://user/22222222-2222-4222-8222-222222222222"))
      .toBe("22222222-2222-4222-8222-222222222222");
    expect(normalizeCashierScan("https://example.test/qr?member_card_id=CP-123"))
      .toBe("CP-123");
  });
  it("does not invent a lookup from an unknown or malformed QR", () => {
    expect(normalizeCashierScan("{broken")).toBe("{broken");
    expect(normalizeCashierScan("https://example.test/other/path")).toBe("https://example.test/other/path");
  });
});
