export const ALL_IN_HOLE_REVEAL_HOLD_MS = 650;
export const FLOP_CARD_STAGGER_MS = 90;
export const FLOP_REVEAL_TOTAL_MS = 450;
export const FLOP_READ_HOLD_MS = 900;
export const TURN_REVEAL_MS = 300;
export const TURN_READ_HOLD_MS = 800;
export const RIVER_REVEAL_MS = 500;
export const RIVER_RESULT_HOLD_MS = 350;
export const BEST_FIVE_DIM_MS = 180;
export const BEST_FIVE_GLOW_MS = 320;
export const SUMMARY_RANKING_DELAY_MS = 120;
export const RESULT_HOLD_MS = 2_000;

export type ReplayRunoutPhase =
  | "hole_hold"
  | "flop"
  | "turn"
  | "river"
  | "dim"
  | "glow"
  | "summary_delay"
  | "summary"
  | "static";

export type ReplayRunoutPresentation = {
  key: string;
  phase: ReplayRunoutPhase;
  visibleBoardCount: 0 | 3 | 4 | 5;
};

const NEXT_PHASE: Record<Exclude<ReplayRunoutPhase, "static">, ReplayRunoutPhase> = {
  hole_hold: "flop",
  flop: "turn",
  turn: "river",
  river: "dim",
  dim: "glow",
  glow: "summary_delay",
  summary_delay: "summary",
  summary: "static",
};

function visibleBoardCount(phase: ReplayRunoutPhase): 0 | 3 | 4 | 5 {
  if (phase === "flop") return 3;
  if (phase === "turn") return 4;
  if (phase === "hole_hold") return 0;
  return 5;
}

export function createReplayRunoutPresentation(key: string, phase: ReplayRunoutPhase): ReplayRunoutPresentation {
  return { key, phase, visibleBoardCount: visibleBoardCount(phase) };
}

export function nextReplayRunoutPhase(phase: ReplayRunoutPhase): ReplayRunoutPhase | null {
  return phase === "static" ? null : NEXT_PHASE[phase];
}

export function replayRunoutPhaseDuration(phase: ReplayRunoutPhase, speed: number): number {
  const base = phase === "hole_hold"
    ? ALL_IN_HOLE_REVEAL_HOLD_MS
    : phase === "flop"
      ? FLOP_REVEAL_TOTAL_MS + FLOP_READ_HOLD_MS
      : phase === "turn"
        ? TURN_REVEAL_MS + TURN_READ_HOLD_MS
        : phase === "river"
          ? RIVER_REVEAL_MS + RIVER_RESULT_HOLD_MS
          : phase === "dim"
            ? BEST_FIVE_DIM_MS
            : phase === "glow"
              ? BEST_FIVE_GLOW_MS
              : phase === "summary_delay"
                ? SUMMARY_RANKING_DELAY_MS
                : phase === "summary"
                  ? RESULT_HOLD_MS
                  : 0;
  const safeSpeed = Math.max(0.5, Math.min(8, speed));
  return Math.round(base / safeSpeed);
}

export function replayRunoutFocusPhase(phase: ReplayRunoutPhase | null): "hidden" | "dim" | "glow" | "static" {
  if (phase === "dim") return "dim";
  if (phase === "glow" || phase === "summary_delay" || phase === "summary") return "glow";
  return phase === "static" ? "static" : "hidden";
}

export function replayRunoutShowsSummary(phase: ReplayRunoutPhase | null): boolean {
  return phase === "summary" || phase === "static";
}
