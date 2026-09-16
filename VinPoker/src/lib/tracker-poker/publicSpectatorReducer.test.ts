import { describe, expect, it } from "vitest";
import { reducePublicSpectatorPayload } from "../../../supabase/functions/_shared/publicSpectatorReducer";

describe("reducePublicSpectatorPayload", () => {
  it("moves committed chips from live stacks into pot without changing ranking or input", () => {
    const payload = { items: [{ trackerState: "live", buttonSeat: 1, pot: 0,
      players: [
        { playerId: "A", entryNumber: 2, seatNumber: 1, startingStack: 1000, stack: 1000 },
        { playerId: "B", entryNumber: 1, seatNumber: 2, startingStack: 1000, stack: 1000 },
      ], actions: [
        { playerId: "A", entryNumber: 2, street: "preflop", actionType: "post_sb", amount: 50, order: 1 },
        { playerId: "B", entryNumber: 1, street: "preflop", actionType: "post_bb", amount: 100, order: 2 },
        { playerId: "A", entryNumber: 2, street: "preflop", actionType: "all_in", amount: 950, order: 3 },
        { playerId: "B", entryNumber: 1, street: "preflop", actionType: "call", amount: 900, order: 4 },
      ] }] };
    const result = reducePublicSpectatorPayload("tables", payload) as typeof payload;
    expect(result.items[0].pot).toBe(2000);
    expect(result.items[0].players.map(p => p.stack)).toEqual([0, 0]);
    expect(result.items[0]).not.toHaveProperty("actions");
    expect(payload.items[0].pot).toBe(0);
    expect(reducePublicSpectatorPayload("ranking", payload)).toBe(payload);
    expect(reducePublicSpectatorPayload("tables", payload)).toEqual(result);
    payload.items[0].actions[0].entryNumber = 1;
    expect((reducePublicSpectatorPayload("tables", payload) as typeof payload).items[0].pot).toBeNull();
  });

  it("groups adjacent open payout bands without turning prize into a total", () => {
    const result = reducePublicSpectatorPayload("payout", { published: true, items: [
      { fromPlace: 3, toPlace: 3, amountPerPlayer: 100, playerName: null, avatarUrl: null, resultStatus: "open" },
      { fromPlace: 4, toPlace: 4, amountPerPlayer: 100, playerName: null, avatarUrl: null, resultStatus: "open" },
      { fromPlace: 5, toPlace: 5, amountPerPlayer: 80, playerName: null, avatarUrl: null, resultStatus: "open" },
    ] }) as { items: Array<{ fromPlace: number; toPlace: number; amountPerPlayer: number }> };
    expect(result.items).toEqual([
      expect.objectContaining({ fromPlace: 3, toPlace: 4, amountPerPlayer: 100 }),
      expect.objectContaining({ fromPlace: 5, toPlace: 5, amountPerPlayer: 80 }),
    ]);
  });

  it("does not group confirmed recipients", () => {
    const item = { fromPlace: 1, toPlace: 1, amountPerPlayer: 100, playerName: "A", avatarUrl: null, resultStatus: "official" } as const;
    const result = reducePublicSpectatorPayload("payout", { items: [item] }) as { items: unknown[] };
    expect(result.items).toEqual([item]);
  });
});
