import { describe, expect, it } from "vitest";
import {
  entryKey,
  orderClockwiseAfterButton,
} from "../../supabase/functions/_shared/trackerSettlement/participantIdentity.ts";

describe("settlement participant identity and odd-chip order", () => {
  it("starts strictly after the button, wraps, and leaves the button last", () => {
    const participants = [
      { id: "button", seat_number: 8 },
      { id: "wrapped", seat_number: 1 },
      { id: "after", seat_number: 9 },
      { id: "middle", seat_number: 4 },
    ];
    expect(orderClockwiseAfterButton(participants, 8).map((row) => row.id))
      .toEqual(["after", "wrapped", "middle", "button"]);
  });

  it("is deterministic across input permutations and only orders eligible winners", () => {
    const eligible = [
      { id: "seat-7", seat_number: 7 },
      { id: "seat-2", seat_number: 2 },
    ];
    const expected = ["seat-7", "seat-2"];
    expect(orderClockwiseAfterButton(eligible, 5).map((row) => row.id)).toEqual(expected);
    expect(orderClockwiseAfterButton([...eligible].reverse(), 5).map((row) => row.id)).toEqual(expected);
  });

  it("distinguishes re-entries for the same player", () => {
    expect(entryKey({ player_id: "player", entry_number: 1 })).toBe("player#1");
    expect(entryKey({ player_id: "player", entry_number: 2 })).toBe("player#2");
  });
});
