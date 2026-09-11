import { describe, expect, it } from "vitest";
import {
  formatViewerBB,
  formatViewerBBOrUnavailable,
  resolveViewerHandBigBlind,
} from "./viewerAmounts";

describe("viewer BB amounts", () => {
  it("formats from raw chips with at most two decimals", () => {
    expect(formatViewerBB(500_000, 200_000)).toBe("2.5 BB");
    expect(formatViewerBB(83_700_000, 200_000)).toBe("418.5 BB");
    expect(formatViewerBB(25_000, 200_000)).toBe("0.13 BB");
    expect(formatViewerBB(0, 200_000)).toBe("0 BB");
  });

  it("fails closed when the hand blind is unavailable", () => {
    expect(formatViewerBB(500_000, 0)).toBeNull();
    expect(formatViewerBBOrUnavailable(500_000, 0)).toBe("— BB");
  });

  it("does not infer a level from a stack-consuming short BB post", () => {
    const actions = [{ player_id: "short", action_type: "post_bb", action_amount: 120_000 }];
    expect(resolveViewerHandBigBlind({
      actions,
      startingStacks: new Map([["short", 120_000]]),
    })).toBe(0);
    expect(resolveViewerHandBigBlind({ explicitBigBlind: 200_000, actions })).toBe(200_000);
  });

  it("uses a normal recorded BB when the player retained chips", () => {
    expect(resolveViewerHandBigBlind({
      actions: [{ player_id: "bb", action_type: "post_bb", action_amount: 200_000 }],
      startingStacks: new Map([["bb", 2_000_000]]),
    })).toBe(200_000);
  });
});
