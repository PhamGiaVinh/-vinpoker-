// deriveReplayPlaybackFx — the pure brain behind liveTableFx replay-playback sound
// + chip-push. Locks: forward-only (no machine-gun on backward scrub), the
// street->deal mapping, fold->muck, chip clink/push only for chip actions, and the
// seat guard. The audio/visual side effects live in TournamentLiveView; this is the
// decision they dispatch on.
import { describe, it, expect } from "vitest";
import { deriveReplayPlaybackFx } from "@/lib/tracker-poker/replayFx";

const base = { prevIndex: 0, prevBoard: 0, index: 1, board: 0, actionType: null as string | null, seatNumber: 0 };

describe("deriveReplayPlaybackFx — forward-only", () => {
  it("fires nothing on first entry (prevIndex null)", () => {
    expect(deriveReplayPlaybackFx({ ...base, prevIndex: null, index: 0, actionType: "bet", seatNumber: 3 }))
      .toEqual({ deal: null, action: null, chipClink: false, chipPush: false });
  });
  it("fires nothing on a backward scrub (index <= prevIndex)", () => {
    expect(deriveReplayPlaybackFx({ ...base, prevIndex: 9, index: 4, actionType: "raise", board: 5, prevBoard: 0, seatNumber: 2 }))
      .toEqual({ deal: null, action: null, chipClink: false, chipPush: false });
  });
  it("fires nothing when the frame did not move (index === prevIndex)", () => {
    expect(deriveReplayPlaybackFx({ ...base, prevIndex: 3, index: 3, actionType: "bet", seatNumber: 1 }))
      .toEqual({ deal: null, action: null, chipClink: false, chipPush: false });
  });
  it("B1: a multi-frame forward JUMP (scrub / jump-to-end) is navigation → silent", () => {
    expect(deriveReplayPlaybackFx({ ...base, prevIndex: 2, index: 9, actionType: "all_in", board: 5, prevBoard: 0, seatNumber: 4 }))
      .toEqual({ deal: null, action: null, chipClink: false, chipPush: false });
  });
});

describe("deriveReplayPlaybackFx — actions", () => {
  it("a bet forward → bet sound + chip clink + chip-push", () => {
    expect(deriveReplayPlaybackFx({ ...base, actionType: "bet", seatNumber: 3 }))
      .toEqual({ deal: null, action: "bet", chipClink: true, chipPush: true });
  });
  it("fold → card-muck swoosh, no chip", () => {
    expect(deriveReplayPlaybackFx({ ...base, actionType: "fold", seatNumber: 3 }))
      .toEqual({ deal: null, action: "fold_muck", chipClink: false, chipPush: false });
  });
  it("check → sound, no chip", () => {
    expect(deriveReplayPlaybackFx({ ...base, actionType: "check", seatNumber: 3 }))
      .toEqual({ deal: null, action: "check", chipClink: false, chipPush: false });
  });
  it("a chip action with no real seat → clink but no chip-push", () => {
    expect(deriveReplayPlaybackFx({ ...base, actionType: "call", seatNumber: 0 }))
      .toEqual({ deal: null, action: "call", chipClink: true, chipPush: false });
  });
  it("an unknown action type → no sound, no chip", () => {
    expect(deriveReplayPlaybackFx({ ...base, actionType: "muck", seatNumber: 3 }))
      .toEqual({ deal: null, action: null, chipClink: false, chipPush: false });
  });
});

describe("deriveReplayPlaybackFx — board reveals (deal swoosh)", () => {
  it("board 0->3 → deal_flop", () => {
    expect(deriveReplayPlaybackFx({ ...base, prevBoard: 0, board: 3, actionType: "check", seatNumber: 1 }).deal)
      .toBe("deal_flop");
  });
  it("board 3->4 → deal_turn", () => {
    expect(deriveReplayPlaybackFx({ ...base, prevBoard: 3, board: 4, actionType: "bet", seatNumber: 1 }).deal)
      .toBe("deal_turn");
  });
  it("board 4->5 → deal_river", () => {
    expect(deriveReplayPlaybackFx({ ...base, prevBoard: 4, board: 5, actionType: "check", seatNumber: 1 }).deal)
      .toBe("deal_river");
  });
  it("board unchanged → no deal", () => {
    expect(deriveReplayPlaybackFx({ ...base, prevBoard: 3, board: 3, actionType: "bet", seatNumber: 1 }).deal)
      .toBeNull();
  });
  it("a flop bet fires BOTH the deal swoosh and the action (same boundary frame)", () => {
    expect(deriveReplayPlaybackFx({ ...base, prevBoard: 0, board: 3, actionType: "bet", seatNumber: 4 }))
      .toEqual({ deal: "deal_flop", action: "bet", chipClink: true, chipPush: true });
  });
});
