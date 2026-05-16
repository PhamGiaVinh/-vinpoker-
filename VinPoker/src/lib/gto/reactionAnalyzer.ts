import { RANKS, classify, combosOf } from "./handMath";

export type Stage = "preflop" | "flop" | "turn" | "river";

export type ActionValue =
  | "raise_2.3" | "raise_3" | "raise_4" | "limp"
  | "check" | "bet_33" | "bet_50" | "bet_66" | "bet_75" | "bet_100";

export type ReactionValue =
  | "fold" | "call" | "raise" | "raise_6.9" | "raise_9" | "raise_12"
  | "raise_3x" | "raise_4" | "allin" | "check" | "bet_50" | "bet_75";

export interface ActionPreset { label: string; value: ActionValue; }
export interface ReactionMeta {
  label: string;
  bg: string;   // tailwind bg class
  text: string; // tailwind text class
  dot: string;  // tailwind bg dot class
}

export const STAGE_ACTIONS: Record<Stage, ActionPreset[]> = {
  preflop: [
    { label: "Raise 2.3x", value: "raise_2.3" },
    { label: "Raise 3x",   value: "raise_3" },
    { label: "Raise 4x",   value: "raise_4" },
    { label: "Limp",       value: "limp" },
  ],
  flop: [
    { label: "Check",       value: "check" },
    { label: "Bet 1/3 pot", value: "bet_33" },
    { label: "Bet 2/3 pot", value: "bet_66" },
    { label: "Bet pot",     value: "bet_100" },
  ],
  turn: [
    { label: "Check",       value: "check" },
    { label: "Bet 1/2 pot", value: "bet_50" },
    { label: "Bet 3/4 pot", value: "bet_75" },
    { label: "Bet pot",     value: "bet_100" },
  ],
  river: [
    { label: "Check",       value: "check" },
    { label: "Bet 1/2 pot", value: "bet_50" },
    { label: "Bet 3/4 pot", value: "bet_75" },
    { label: "Bet pot",     value: "bet_100" },
  ],
};

export const REACTION_META: Record<ReactionValue, ReactionMeta> = {
  fold:      { label: "Fold",     bg: "bg-sky-500/60",   text: "text-sky-400",     dot: "bg-sky-500/60" },
  call:      { label: "Call",     bg: "bg-emerald-500",  text: "text-emerald-500", dot: "bg-emerald-500" },
  raise:     { label: "Raise",    bg: "bg-rose-500",     text: "text-rose-500",    dot: "bg-rose-500" },
  raise_3x:  { label: "Raise 3x", bg: "bg-rose-500",     text: "text-rose-500",    dot: "bg-rose-500" },
  raise_4:   { label: "Raise 4x", bg: "bg-rose-500",     text: "text-rose-500",    dot: "bg-rose-500" },
  "raise_6.9": { label: "Raise 6.9x", bg: "bg-rose-500", text: "text-rose-500",    dot: "bg-rose-500" },
  raise_9:   { label: "Raise 9x", bg: "bg-rose-500",     text: "text-rose-500",    dot: "bg-rose-500" },
  raise_12:  { label: "Raise 12x",bg: "bg-rose-500",     text: "text-rose-500",    dot: "bg-rose-500" },
  allin:     { label: "All-in",   bg: "bg-red-700",      text: "text-red-500",     dot: "bg-red-700" },
  check:     { label: "Check",    bg: "bg-purple-500",   text: "text-purple-400",  dot: "bg-purple-500" },
  bet_50:    { label: "Bet 1/2",  bg: "bg-orange-500",   text: "text-orange-500",  dot: "bg-orange-500" },
  bet_75:    { label: "Bet 3/4",  bg: "bg-rose-500",     text: "text-rose-500",    dot: "bg-rose-500" },
};

const RANK_VAL: Record<string, number> = {
  A: 14, K: 13, Q: 12, J: 11, T: 10,
  "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2,
};

/** Deterministic 0..1 hand strength, preflop equity proxy. */
export function handStrength(hand: string): number {
  const cls = classify(hand);
  if (cls === "pair") {
    const r = RANK_VAL[hand[0]];
    // 22 -> 0.40, AA -> 1.0
    return 0.40 + ((r - 2) / 12) * 0.60;
  }
  const a = RANK_VAL[hand[0]];
  const b = RANK_VAL[hand[1]];
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  const gap = high - low;
  let s = (high / 14) * 0.5 + (low / 14) * 0.25;
  if (gap === 1) s += 0.06; // connector
  else if (gap === 2) s += 0.03;
  if (cls === "suited") s += 0.08;
  else s -= 0.05;
  if (high === 14) s += 0.04; // any Ax bonus
  return Math.max(0, Math.min(1, s));
}

/** Decide reaction for a hand vs an action. Deterministic. */
export function reactionFor(action: ActionValue, hand: string): ReactionValue {
  const s = handStrength(hand);
  if (action.startsWith("raise")) {
    const reraise: ReactionValue =
      action === "raise_2.3" ? "raise_6.9" :
      action === "raise_3"   ? "raise_9"   :
      action === "raise_4"   ? "raise_12"  : "raise";
    if (s > 0.88) return "allin";
    if (s > 0.72) return reraise;
    if (s > 0.55) return "call";
    return "fold";
  }
  if (action === "limp") {
    if (s > 0.85) return "raise_4";
    if (s > 0.62) return "raise_3x";
    if (s > 0.35) return "check";
    return "fold";
  }
  if (action === "check") {
    if (s > 0.82) return "bet_75";
    if (s > 0.55) return "bet_50";
    return "check";
  }
  // bet_*
  if (s > 0.88) return "allin";
  if (s > 0.72) return "raise_3x";
  if (s > 0.50) return "call";
  return "fold";
}

export function allHandsList(): string[] {
  const out: string[] = [];
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const a = RANKS[r], b = RANKS[c];
      if (r === c) out.push(`${a}${a}`);
      else if (r < c) out.push(`${a}${b}s`);
      else out.push(`${b}${a}o`);
    }
  }
  return out;
}

export interface ReactionSummary {
  reaction: ReactionValue;
  combos: number;
  pct: number; // % of in-range combos
}

export function summarize(hands: string[], action: ActionValue): ReactionSummary[] {
  const acc = new Map<ReactionValue, number>();
  let total = 0;
  for (const h of hands) {
    const r = reactionFor(action, h);
    const c = combosOf(h);
    acc.set(r, (acc.get(r) ?? 0) + c);
    total += c;
  }
  return Array.from(acc.entries())
    .map(([reaction, combos]) => ({ reaction, combos, pct: total ? (combos / total) * 100 : 0 }))
    .sort((a, b) => b.combos - a.combos);
}
