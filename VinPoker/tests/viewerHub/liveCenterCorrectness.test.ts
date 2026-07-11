import { describe, expect, it } from "vitest";
import { buildHandRankView } from "@/components/cashier/tournament-live/viewer-hub/handRankView";
import { isOpaqueViewerName, resolveViewerIdentity } from "@/components/cashier/tournament-live/viewer-hub/viewerIdentity";
import { defaultViewerTab, parseViewerTab } from "@/components/cashier/tournament-live/viewer-hub/viewerUrlState";
import { buildHandFeedItems, type RawHandAction, type RawHandPlayer } from "@/components/cashier/tournament-live/viewer-hub/handFeedDerive";

describe("Live Center viewer correctness", () => {
  it("defaults mobile to hand history while preserving desktop and explicit tabs", () => {
    expect(defaultViewerTab({ isMobile: true, hasDeepLinkedHand: false })).toBe("hands");
    expect(defaultViewerTab({ isMobile: false, hasDeepLinkedHand: false })).toBe("updates");
    expect(defaultViewerTab({ isMobile: false, hasDeepLinkedHand: true })).toBe("hands");
    expect(parseViewerTab("photos", "hands")).toBe("photos");
  });

  it("uses snapshot then inactive seat/profile fallback and never exposes opaque ids", () => {
    expect(resolveViewerIdentity({ playerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", seatNumber: 6, snapshotName: "Limitless", seatName: "Old name" }).name).toBe("Limitless");
    expect(resolveViewerIdentity({ playerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", seatNumber: 6, seatName: "Kayhan Mokri" }).name).toBe("Kayhan Mokri");
    expect(resolveViewerIdentity({ playerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", seatNumber: 6, profileName: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }).name).toBe("Người chơi ghế 6");
    expect(isOpaqueViewerName("#0")).toBe(true);
    expect(isOpaqueViewerName("Seat 0")).toBe(true);
  });

  it("ranks Hand #8 as the same trips J with A-Q kickers", () => {
    const board = ["As", "Jd", "Qh", "Jh", "8h"];
    const limitless = buildHandRankView(["Jc", "9d"], board);
    const kayhan = buildHandRankView(["Js", "Ts"], board);
    expect(limitless?.category).toBe("trips");
    expect(kayhan?.category).toBe("trips");
    expect(limitless?.primaryRanks).toEqual(["J"]);
    expect(limitless?.kickerRanks).toEqual(["A", "Q"]);
    expect(limitless?.score).toBe(kayhan?.score);
  });

  it("marks Hand #8 needs-resettle instead of inventing a winner and keeps every action", () => {
    const handId = "hand-8";
    const players: RawHandPlayer[] = [
      { hand_id: handId, player_id: "limitless", seat_number: 6, starting_stack: 8_700_000, ending_stack: 17_400_000, hole_cards: ["Jc", "9d"], is_eliminated: false, player_name: "Limitless" },
      { hand_id: handId, player_id: "kayhan", seat_number: 7, starting_stack: 47_400_000, ending_stack: 38_700_000, hole_cards: ["Js", "Ts"], is_eliminated: false, player_name: "Kayhan Mokri" },
    ];
    const actions: RawHandAction[] = [
      { id: "a1", hand_id: handId, player_id: "limitless", street: "preflop", action_type: "post_bb", action_amount: 200_000, action_order: 1 },
      { id: "a2", hand_id: handId, player_id: "kayhan", street: "preflop", action_type: "all_in", action_amount: 47_400_000, action_order: 2 },
      { id: "a3", hand_id: handId, player_id: "limitless", street: "preflop", action_type: "call", action_amount: 8_500_000, action_order: 3 },
    ];
    const item = buildHandFeedItems(
      [{ id: handId, hand_number: 8, created_at: "2026-07-11T00:00:00Z", community_cards: ["As", "Jd", "Qh", "Jh", "8h"], pot_size: 56_100_000, button_seat: 5, table_id: "felt" }],
      new Map([[handId, players]]), new Map([[handId, actions]]), new Map(), new Map(), { viewerPulseV2: true },
    )[0];
    expect(item.actions).toHaveLength(actions.length);
    expect(item.showdownResult).toBe("needs_resettle");
    expect(item.players.every((player) => !player.isWinner)).toBe(true);
  });
});
