import { GTOPosition } from "./openRanges50bb";

export type CfrFacing = "open" | "raise" | "3bet" | "4bet" | "5bet";

export interface HandStrategy {
  hand: string;
  index: number;
  combos: number;
  fold: number;
  call: number;   // limp when open
  raise: number;  // 3-bet/4-bet/5-bet depending on facing
  allin: number;
}

/**
 * One step in the action history that led to the current decision point.
 * Used so the solver / cache can distinguish e.g. "UTG open 2.5 → CO 3bet 8" vs
 * "UTG open 2.5 → BTN 3bet 7.5".
 */
export interface ActionStep {
  pos: GTOPosition;
  action: "open" | "call" | "raise" | "allin" | "fold";
  size: number; // BB
}

export interface ScenarioKey {
  pos: GTOPosition;             // hero position
  facing: CfrFacing;
  betSize: number;              // BB the hero is currently facing (last raise size)
  raiserPos?: GTOPosition;      // most recent aggressor
  history?: ActionStep[];       // optional full history (stack/pot reconstruction)
}

function scenarioKeyToString(k: ScenarioKey): string {
  const h = (k.history ?? []).map((s) => `${s.pos}:${s.action}:${s.size.toFixed(2)}`).join(">");
  return `${k.pos}|${k.facing}|${k.betSize.toFixed(2)}|${k.raiserPos ?? "-"}|${h}`;
}
