import { describe, expect, it } from "vitest";
import { canReadBuyinReceipt } from "../../../../supabase/functions/get-buyin-receipt/access";

describe("buy-in receipt actor access", () => {
  const playerId = "player-1";

  it("allows the player who owns the registration", () => {
    expect(canReadBuyinReceipt({ callerId: playerId, playerId, staffAuthorized: false })).toBe(true);
  });

  it("rejects another player even when they know a receipt code", () => {
    expect(canReadBuyinReceipt({ callerId: "other-player", playerId, staffAuthorized: false })).toBe(false);
  });

  it.each(["cashier", "club owner", "super admin"])("allows an authorized %s", () => {
    expect(canReadBuyinReceipt({ callerId: "staff-1", playerId, staffAuthorized: true })).toBe(true);
  });
});
