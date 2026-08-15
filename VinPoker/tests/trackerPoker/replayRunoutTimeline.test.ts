import { describe, expect, it } from "vitest";
import {
  ALL_IN_HOLE_REVEAL_HOLD_MS,
  BEST_FIVE_DIM_MS,
  BEST_FIVE_GLOW_MS,
  FLOP_READ_HOLD_MS,
  FLOP_REVEAL_TOTAL_MS,
  POT_AWARD_MS,
  POT_COLLECT_MS,
  RESULT_HOLD_MS,
  RIVER_RESULT_HOLD_MS,
  RIVER_REVEAL_MS,
  SUMMARY_RANKING_DELAY_MS,
  TURN_READ_HOLD_MS,
  TURN_REVEAL_MS,
  createReplayRunoutPresentation,
  nextReplayRunoutPresentation,
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

  it("shows only the active verified pot result while that three-second award is presented", () => {
    expect(replayRunoutFocusPhase("hole_hold")).toBe("hidden");
    expect(replayRunoutFocusPhase("dim")).toBe("dim");
    expect(replayRunoutFocusPhase("glow")).toBe("glow");
    expect(replayRunoutFocusPhase("pot_award")).toBe("glow");
    expect(replayRunoutFocusPhase("static")).toBe("static");
    expect(replayRunoutShowsSummary("glow")).toBe(false);
    expect(replayRunoutShowsSummary("summary")).toBe(true);
    expect(replayRunoutShowsSummary("pot_award")).toBe(true);
    expect(replayRunoutShowsSummary("static")).toBe(true);
  });

  it("collects once, then awards Main Pot before each Side Pot", () => {
    const phases: Array<{ phase: ReplayRunoutPhase; potAwardIndex: number | null }> = [];
    let presentation = createReplayRunoutPresentation("hand:7:verified", "river");
    while (true) {
      const next = nextReplayRunoutPresentation(presentation, 3);
      if (!next) break;
      phases.push({ phase: next.phase, potAwardIndex: next.potAwardIndex });
      presentation = next;
    }
    expect(phases).toEqual([
      { phase: "pot_collect", potAwardIndex: null },
      { phase: "pot_award", potAwardIndex: 0 },
      { phase: "pot_award", potAwardIndex: 1 },
      { phase: "pot_award", potAwardIndex: 2 },
      { phase: "static", potAwardIndex: 2 },
    ]);
    expect(replayRunoutPhaseDuration("pot_collect", 1)).toBe(POT_COLLECT_MS);
    expect(replayRunoutPhaseDuration("pot_award", 1)).toBe(POT_AWARD_MS);
    expect(POT_AWARD_MS).toBe(3_000);
    expect(replayRunoutPhaseDuration("pot_award", 2)).toBe(1_500);
    expect(replayRunoutPhaseDuration("pot_award", 0.5)).toBe(6_000);
    // A single verified Main Pot finishes its three-second award hold before
    // best-five focus begins. Extra side pots each receive the same hold.
    expect(4_450 + POT_COLLECT_MS + POT_AWARD_MS).toBe(7_870);
  });
});
