// ============================================================
// GTO Range Tree — Core logic & heuristics
// ============================================================

import { handAt, combosOf as combosOfFromMath, TOTAL_COMBOS as TOTAL_COMBOS_MATH } from "./handMath";

// -------------------- TYPES --------------------

export type HandAction = { fold: number; call: number; raise: number; allin: number };
export type Range = Record<string, HandAction>;

export type ActionStep = {
  position: Position;
  action: "fold" | "call" | "raise" | "allin";
  raiseSize?: number; // bb
};

export const POSITIONS = ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"] as const;
export type Position = (typeof POSITIONS)[number];

export type TreePos = Position;
const ALL_POS: Position[] = [...POSITIONS];

export const STACK_DEPTHS = [10, 15, 20, 25, 40, 50, 75, 100, 200] as const;
export type StackDepth = (typeof STACK_DEPTHS)[number];

// -------------------- CONSTANTS --------------------

const STACK_BB = 50;
const TOTAL_COMBOS = TOTAL_COMBOS_MATH;
const combosOf = combosOfFromMath;

const OPEN_SIZE: Record<Position, number> = {
  UTG: 2.3, UTG1: 2.3, LJ: 2.3, HJ: 2.3, CO: 2.3, BTN: 2.3, SB: 3.5, BB: 0,
};

const HAND_ACTION_KEYS: (keyof HandAction)[] = ["fold", "call", "raise", "allin"];

// -------------------- SIZING --------------------

function isOOP(actor: Position, raiser: Position): boolean {
  if (actor === "SB" && raiser !== "BB") return true;
  if (actor === "BB" && raiser !== "SB") return true;
  if (raiser === "SB" || raiser === "BB") return false;
  return POSITIONS.indexOf(actor) < POSITIONS.indexOf(raiser);
}

function calcRaiseSize(
  prevRaiseSize: number,
  callerCount: number,
  actorPos: Position,
  raiserPos: Position,
  lastRaiseDelta: number = 0,
): number {
  const oopPremium = isOOP(actorPos, raiserPos) ? 0.5 : 0;
  const raw = prevRaiseSize * 3.0 + callerCount * 1.0 + oopPremium;
  const minRaise = prevRaiseSize + Math.max(lastRaiseDelta, 1);
  return Math.round(Math.max(raw, minRaise) * 10) / 10;
}

function calc4BetSize(prevRaiseSize: number, lastRaiseDelta: number = 0): number {
  const raw = prevRaiseSize * 2.5;
  const minRaise = prevRaiseSize + Math.max(lastRaiseDelta, 1);
  return Math.round(Math.max(raw, minRaise) * 10) / 10;
}

// -------------------- PATH UTILS --------------------

export function getFoldedPositions(path: ActionStep[]): Set<string> {
  const folded = new Set<string>();
  for (const step of path) if (step.action === "fold") folded.add(step.position);
  return folded;
}

export function getLastRaiser(path: ActionStep[]): ActionStep | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].action === "raise" || path[i].action === "allin") return path[i];
  }
  return null;
}

function getPrevRaiseSize(path: ActionStep[]): number {
  let count = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].action === "raise" || path[i].action === "allin") {
      count++;
      if (count === 2) return path[i].raiseSize ?? 0;
    }
  }
  return 0;
}

function getCallerCount(path: ActionStep[]): number {
  let lastRaiseIdx = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].action === "raise" || path[i].action === "allin") {
      lastRaiseIdx = i;
      break;
    }
  }
  if (lastRaiseIdx === -1) return 0;
  return path.slice(lastRaiseIdx + 1).filter((s) => s.action === "call").length;
}

// -------------------- AVAILABLE ACTIONS --------------------

export interface AvailableAction {
  label: string;
  action: ActionStep["action"];
  size?: number;
}

export function getAvailableActions(
  position: Position,
  path: ActionStep[],
  stackDepth: StackDepth,
): AvailableAction[] {
  const lastRaiser = getLastRaiser(path);
  const callerCount = getCallerCount(path);

  if (!lastRaiser) {
    const openSize = OPEN_SIZE[position];
    if (openSize === 0) return [{ label: "Check", action: "call", size: 0 }];
    return [
      { label: "Fold", action: "fold" },
      { label: `Raise ${openSize}`, action: "raise", size: openSize },
      { label: `Allin ${stackDepth}`, action: "allin", size: stackDepth },
    ];
  }

  const raiserPos = lastRaiser.position;
  const prevSize = lastRaiser.raiseSize ?? 2.3;
  const prevPrevSize = getPrevRaiseSize(path);
  const lastRaiseDelta = prevSize - prevPrevSize;
  const raiseCount = path.filter((s) => s.action === "raise" || s.action === "allin").length;
  const iWasLastRaiser = lastRaiser.position === position;

  let raiseSize: number;
  if (raiseCount === 1) {
    raiseSize = calcRaiseSize(prevSize, callerCount, position, raiserPos, lastRaiseDelta);
  } else if (raiseCount === 2) {
    raiseSize = calc4BetSize(prevSize, lastRaiseDelta);
  } else {
    raiseSize = stackDepth;
  }

  const actions: AvailableAction[] = [{ label: "Fold", action: "fold" }];
  if (!iWasLastRaiser) {
    actions.push({ label: `Call ${prevSize}`, action: "call", size: prevSize });
  }
  if (raiseSize < stackDepth * 0.85) {
    actions.push({ label: `Raise ${raiseSize}`, action: "raise", size: raiseSize });
  }
  actions.push({ label: `Allin ${stackDepth}`, action: "allin", size: stackDepth });
  return actions;
}

// -------------------- KEYS --------------------

function pathKey(path: ActionStep[]): string {
  if (path.length === 0) return "root";
  return path.map((s) => `${s.position}:${s.action}${s.raiseSize ? ":" + s.raiseSize : ""}`).join("|");
}

export function nodeKey(path: ActionStep[], viewingPosition: string, stackDepth?: StackDepth): string {
  const stackPart = stackDepth ? `s${stackDepth}|` : "";
  return `${stackPart}${pathKey(path)}__view:${viewingPosition}`;
}

// -------------------- HAND UTILS --------------------

export function allHands(): string[] {
  const out: string[] = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) out.push(handAt(r, c));
  return out;
}

export function emptyHandAction(): HandAction {
  return { fold: 1, call: 0, raise: 0, allin: 0 };
}

export function normalizeHandAction(ha: HandAction): HandAction {
  const total = ha.fold + ha.call + ha.raise + ha.allin;
  if (total === 0) return emptyHandAction();
  if (Math.abs(total - 1) < 0.001) return ha;
  return {
    fold: ha.fold / total,
    call: ha.call / total,
    raise: ha.raise / total,
    allin: ha.allin / total,
  };
}

// -------------------- HEURISTIC RANGES (Fallback) --------------------

const TIER_1 = ["AA", "KK", "QQ", "JJ", "AKs", "AKo"];
const TIER_2 = ["TT", "99", "AQs", "AQo", "AJs", "KQs"];
const TIER_3 = ["88", "77", "AJo", "ATs", "KJs", "KQo", "QJs"];
const TIER_4 = ["66", "55", "ATo", "A9s", "A8s", "A7s", "A5s", "KTs", "K9s", "QTs", "JTs", "T9s"];
const TIER_5 = ["44", "33", "22", "A6s", "A4s", "A3s", "A2s", "KJo", "K8s", "Q9s", "J9s", "T8s", "98s", "87s", "76s"];
const TIER_6 = ["KTo", "QJo", "K7s", "K6s", "Q8s", "J8s", "T7s", "97s", "86s", "75s", "65s", "54s", "A9o", "A8o"];
const TIER_7 = ["A7o", "A5o", "K9o", "Q9o", "J9o", "T9o", "98o", "K5s", "K4s", "K3s", "K2s", "Q7s", "Q6s", "J7s", "T6s", "96s", "85s", "64s", "53s"];
const TIER_8 = ["A6o", "A4o", "A3o", "A2o", "K8o", "Q8o", "J8o", "T8o", "97o", "87o", "76o", "Q5s", "Q4s", "J6s", "T5s", "95s", "74s", "43s"];

const ALL_TIERS = [TIER_1, TIER_2, TIER_3, TIER_4, TIER_5, TIER_6, TIER_7, TIER_8];

function buildRangeFromTiers(tiers: string[][]): Set<string> {
  const set = new Set<string>();
  for (const tier of tiers) for (const hand of tier) set.add(hand);
  return set;
}

const POSITION_OPENS: Record<Position, Set<string>> = {
  UTG: buildRangeFromTiers([TIER_1, TIER_2, TIER_3.slice(0, 4)]),
  UTG1: buildRangeFromTiers([TIER_1, TIER_2, TIER_3]),
  LJ: buildRangeFromTiers([TIER_1, TIER_2, TIER_3, TIER_4.slice(0, 6)]),
  HJ: buildRangeFromTiers([TIER_1, TIER_2, TIER_3, TIER_4]),
  CO: buildRangeFromTiers([TIER_1, TIER_2, TIER_3, TIER_4, TIER_5]),
  BTN: buildRangeFromTiers([TIER_1, TIER_2, TIER_3, TIER_4, TIER_5, TIER_6, TIER_7]),
  SB: buildRangeFromTiers([TIER_1, TIER_2, TIER_3, TIER_4, TIER_5, TIER_6.slice(0, 8)]),
  BB: new Set(),
};

const MIXED_FREQ_HANDS: Record<Position, string[]> = {
  UTG: ["77", "ATs", "AJo"],
  UTG1: ["66", "A9s", "ATo"],
  LJ: ["55", "K9s", "QTs"],
  HJ: ["44", "A6s", "T9s"],
  CO: ["33", "A4s", "65s", "98o"],
  BTN: ["A2o", "K5o", "J7s", "53s"],
  SB: ["64s", "T9o", "K9o"],
  BB: [],
};

function getOpenRange(position: Position): Range {
  const range: Range = {};
  const opens = POSITION_OPENS[position];
  const mixed = new Set(MIXED_FREQ_HANDS[position]);

  for (const hand of allHands()) {
    if (opens.has(hand)) {
      if (mixed.has(hand)) {
        range[hand] = { fold: 0.5, call: 0, raise: 0.5, allin: 0 };
      } else {
        range[hand] = { fold: 0, call: 0, raise: 1, allin: 0 };
      }
    } else {
      range[hand] = { fold: 1, call: 0, raise: 0, allin: 0 };
    }
  }
  return range;
}

function getDefendRange(position: Position): Range {
  const range: Range = {};
  const isBlind = position === "BB" || position === "SB";

  for (const hand of allHands()) {
    const inOpen = POSITION_OPENS[position].has(hand) || POSITION_OPENS.BTN.has(hand);
    const isPremium = TIER_1.includes(hand);
    const isStrong = TIER_2.includes(hand) || TIER_3.includes(hand);

    if (isPremium) {
      range[hand] = { fold: 0, call: 0.2, raise: 0.8, allin: 0 };
    } else if (isStrong) {
      range[hand] = { fold: 0.1, call: 0.6, raise: 0.3, allin: 0 };
    } else if (inOpen) {
      range[hand] = isBlind
        ? { fold: 0.3, call: 0.6, raise: 0.1, allin: 0 }
        : { fold: 0.5, call: 0.4, raise: 0.1, allin: 0 };
    } else {
      range[hand] = { fold: 1, call: 0, raise: 0, allin: 0 };
    }
  }
  return range;
}

/** Fallback heuristic range. Use precomputed GTO when available. */
export function defaultRange(position: Position, facingRaiser: boolean): Range {
  return facingRaiser ? getDefendRange(position) : getOpenRange(position);
}

// -------------------- HAND UPDATES --------------------

export function updateHandAction(
  range: Range,
  hand: string,
  action: keyof HandAction,
  freq: number,
): Range {
  const cur = range[hand] ?? emptyHandAction();
  const f = Math.max(0, Math.min(1, freq));
  const remaining = 1 - f;
  const others = HAND_ACTION_KEYS.filter((k) => k !== action);
  const otherTotal = others.reduce((s, k) => s + cur[k], 0);
  const updated: HandAction = { ...cur, [action]: f };

  for (const k of others) {
    updated[k] = otherTotal > 0 ? (cur[k] / otherTotal) * remaining : remaining / others.length;
  }
  return { ...range, [hand]: normalizeHandAction(updated) };
}

// -------------------- POSITION HELPERS --------------------

function posIndex(p: Position): number {
  return POSITIONS.indexOf(p);
}

function defaultOpenSize(p: Position): number {
  return OPEN_SIZE[p] ?? 2.3;
}

export function getNextToAct(path: ActionStep[]): Position | null {
  const acted = new Set(path.map((s) => s.position));
  const folded = getFoldedPositions(path);
  const lastRaiser = getLastRaiser(path);

  if (!lastRaiser) {
    for (const pos of POSITIONS) {
      if (!acted.has(pos)) return pos;
    }
    return null;
  }

  const lastIdx = POSITIONS.indexOf(path[path.length - 1].position);
  for (let i = 1; i <= POSITIONS.length; i++) {
    const idx = (lastIdx + i) % POSITIONS.length;
    const pos = POSITIONS[idx];
    if (folded.has(pos)) continue;
    if (pos === lastRaiser.position) {
      const allActed = POSITIONS.every(
        (p) => folded.has(p) || p === lastRaiser.position || acted.has(p)
      );
      return allActed ? null : pos;
    }
    return pos;
  }
  return null;
}

function isPathValid(path: ActionStep[]): { valid: boolean; reason?: string } {
  const seen = new Map<Position, ActionStep>();
  for (const step of path) {
    const prev = seen.get(step.position);
    if (prev && prev.action === "fold") {
      return { valid: false, reason: `${step.position} already folded` };
    }
    seen.set(step.position, step);
  }
  return { valid: true };
}
