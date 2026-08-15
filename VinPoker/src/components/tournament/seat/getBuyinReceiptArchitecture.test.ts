import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const handler = readFileSync(
  resolve(process.cwd(), "supabase/functions/get-buyin-receipt/index.ts"),
  "utf8",
);

describe("get-buyin-receipt boundary", () => {
  it("accepts exactly one receipt lookup and preserves the server-issued QR code", () => {
    expect(handler).toContain("Provide exactly one lookup key");
    expect(handler).toContain("registration_id");
    expect(handler).toContain("receipt_code");
    expect(handler).toContain("qr_value: receipt?.receipt_code ?? null");
    expect(handler).toContain("reference_code: registration?.reference_code ?? null");
  });

  it("requires caller ownership or a scoped staff authorization and remains read-only", () => {
    expect(handler).toContain("canReadBuyinReceipt");
    expect(handler).toContain('admin.rpc("is_club_owner"');
    expect(handler).toContain('admin.rpc("is_club_cashier"');
    expect(handler).toContain('.eq("role", "super_admin")');
    expect(handler).not.toMatch(/\.(?:insert|update|delete|upsert)\s*\(/);
    expect(handler).not.toContain("tournament-register");
    expect(handler).not.toContain("tournament-reentry");
  });
});
