// Adapters that map the console's local hand state onto the SHARED LiveFelt props.
// These only feed LiveFelt's additive operator-only inputs; the felt itself stays
// byte-identical for the public viewer. Pin the mapping so a field never silently
// drops or gets renamed.

import { describe, it, expect } from "vitest";
import {
  playersToSeatInfo,
  lastActorIdOf,
  latestActionLogOf,
  selectedSeatOf,
  type FeltPlayer,
  type FeltAction,
} from "@/components/cashier/tournament-live/handinput/standaloneFelt";

function player(over: Partial<FeltPlayer>): FeltPlayer {
  return {
    player_id: over.player_id ?? "p",
    display_name: over.display_name ?? "Player",
    seat_number: over.seat_number ?? 1,
    current_stack: over.current_stack ?? 1000,
    current_bet: over.current_bet ?? 0,
    is_folded: over.is_folded ?? false,
    is_all_in: over.is_all_in ?? false,
    avatar_url: over.avatar_url,
  };
}

const actions: FeltAction[] = [
  { street: "preflop", player_id: "a", display_name: "An", seat_number: 1, action_type: "call", amount: 100, action_order: 1 },
  { street: "flop", player_id: "b", display_name: "Bình", seat_number: 2, action_type: "bet", amount: 300, action_order: 2 },
];

describe("standaloneFelt adapters", () => {
  it("playersToSeatInfo maps stack→chip_count, marks dealt-in, resolves position from the map", () => {
    const positionsBySeat = new Map<number, string>([[1, "BTN"], [2, "BB"]]);
    const seats = playersToSeatInfo(
      [player({ player_id: "a", seat_number: 1, current_stack: 18200, current_bet: 0, is_folded: true }),
       player({ player_id: "b", seat_number: 2, current_stack: 5000, current_bet: 300, is_all_in: true })],
      { tableId: "TB8", positionsBySeat }
    );
    expect(seats[0]).toMatchObject({
      player_id: "a",
      seat_number: 1,
      chip_count: 18200,
      is_active: true,
      table_id: "TB8",
      position: "BTN",
      is_folded: true,
      is_all_in: false,
      current_bet: 0,
    });
    expect(seats[1]).toMatchObject({ position: "BB", is_all_in: true, current_bet: 300, chip_count: 5000 });
  });

  it("empty tableId becomes null table_id; missing position becomes empty string", () => {
    const seats = playersToSeatInfo([player({ seat_number: 4 })], { tableId: "", positionsBySeat: new Map() });
    expect(seats[0].table_id).toBeNull();
    expect(seats[0].position).toBe("");
  });

  it("lastActorIdOf returns the last action's player, or null when empty", () => {
    expect(lastActorIdOf(actions)).toBe("b");
    expect(lastActorIdOf([])).toBeNull();
  });

  it("latestActionLogOf renames local `amount` → `action_amount`", () => {
    const log = latestActionLogOf(actions)!;
    expect(log).toEqual({
      street: "flop",
      player_id: "b",
      display_name: "Bình",
      seat_number: 2,
      action_type: "bet",
      action_amount: 300,
      action_order: 2,
    });
    expect(latestActionLogOf([])).toBeNull();
  });

  it("selectedSeatOf resolves an actor id to its seat, null otherwise", () => {
    const players = [player({ player_id: "a", seat_number: 1 }), player({ player_id: "b", seat_number: 2 })];
    expect(selectedSeatOf(players, "b")).toBe(2);
    expect(selectedSeatOf(players, "ghost")).toBeNull();
    expect(selectedSeatOf(players, null)).toBeNull();
  });
});
