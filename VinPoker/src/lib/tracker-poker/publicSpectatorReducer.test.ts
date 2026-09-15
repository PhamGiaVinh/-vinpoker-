import { describe, expect, it } from "vitest";
import { reducePublicSpectatorPayload } from "../../../supabase/functions/_shared/publicSpectatorReducer";

describe("reducePublicSpectatorPayload", () => {
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
