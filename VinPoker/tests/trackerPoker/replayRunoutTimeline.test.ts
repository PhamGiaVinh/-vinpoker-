import { describe, expect, it } from "vitest";
import {
  ALL_IN_HOLE_REVEAL_HOLD_MS,
  BEST_FIVE_DIM_MS,
  BEST_FIVE_GLOW_MS,
  FLOP_READ_HOLD_MS,
  FLOP_REVEAL_TOTAL_MS,
  RESULT_HOLD_MS,
  RIVER_RESULT_HOLD_MS,
  RIVER_REVEAL_MS,
  SUMMARY_RANKING_DELAY_MS,
  TURN_READ_HOLD_MS,
  TURN_REVEAL_MS,
  createReplayRunoutPresentation,
  nextReplayRunoutPhase,
  replayRunoutFocusPhase,
  replayRunoutPhaseDuration,
  replayRunoutShowsSummary,
  type ReplayRunoutPhase,
} from "@/lib/tracker-poker/replayRunoutTimeline";

describe("viewer replay all-in runout timeline", () => {
  it("keeps the required river -> dim -> glow -> ranking order", () => {
    const resolved: ReplayRunoutPhase[] = ["hole_hold"];
    let phase: ReplayRunoutPhase = "hole_hold";
    while (true) {
      const next = nextReplayRunoutPhase(phase);
      if (!next) break;
      resolved.push(next);
      phase = next;
    }
    expect(resolved).toEqual([
      "hole_hold",
      "flop",
      "turn",
      "river",
      "dim",
      "glow",
      "summary_delay",
      "summary",
      "static",
    ]);
  });

  it("reveals board cards by street without changing their final footprint", () => {
    expect(createReplayRunoutPresentation("hand:4:verified", "hole_hold").visibleBoardCount).toBe(0);
    expect(createReplayRunoutPresentation("hand:4:verified", "flop").visibleBoardCount).toBe(3);
    expect(createReplayRunoutPresentation("hand:4:verified", "turn").visibleBoardCount).toBe(4);
    expect(createReplayRunoutPresentation("hand:4:verified", "river").visibleBoardCount).toBe(5);
  });

  it("uses the 1x viewer timing contract and scales it for every replay speed", () => {
    const beforeGlow = ALL_IN_HOLE_REVEAL_HOLD_MS
      + FLOP_REVEAL_TOTAL_MS + FLOP_READ_HOLD_MS
      + TURN_REVEAL_MS + TURN_READ_HOLD_MS
      + RIVER_REVEAL_MS + RIVER_RESULT_HOLD_MS
      + BEST_FIVE_DIM_MS;
    const glowCompletion = beforeGlow + BEST_FIVE_GLOW_MS;
    const full = glowCompletion + SUMMARY_RANKING_DELAY_MS + RESULT_HOLD_MS;
    expect(glowCompletion).toBe(4_450);
    expect(full).toBe(6_570);
    expect(replayRunoutPhaseDuration("river", 1)).toBe(850);
    expect(replayRunoutPhaseDuration("river", 2)).toBe(425);
    expect(replayRunoutPhaseDuration("river", 0.5)).toBe(1_700);
    expect(replayRunoutPhaseDuration("river", 99)).toBe(Math.round(850 / 8));
  });

  it("keeps ranking hidden until its explicit delay and restores static focus on direct jump", () => {
    expect(replayRunoutFocusPhase("hole_hold")).toBe("hidden");
    expect(replayRunoutFocusPhase("dim")).toBe("dim");
    expect(replayRunoutFocusPhase("glow")).toBe("glow");
    expect(replayRunoutFocusPhase("static")).toBe("static");
    expect(replayRunoutShowsSummary("glow")).toBe(false);
    expect(replayRunoutShowsSummary("summary")).toBe(true);
    expect(replayRunoutShowsSummary("static")).toBe(true);
  });
});
