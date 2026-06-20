// Tracker Phase-2: exact showdown settlement (auto-rank + per-side-pot payout).
//
// Reuses the existing pure pieces — `evaluate7` (the hand evaluator) and
// `computePotBreakdown` (the side-pot layering) — so this module only GLUES them:
// rank each revealed hand, award each POST-REFUND pot layer to its best eligible
// hand, refund the uncalled bet to its bettor.
//
// 🔴 P1-1 (the subtle trap): winnings are summed ONLY from
// `computePotBreakdown.pots` (the POST-refund layers); the uncalled bet is added
// SEPARATELY to its bettor. We must NEVER award `potOf` / Σtotal_committed, which
// double-counts the uncalled (the winner gets it AND the bettor is refunded) — that
// still passes Σ-conservation but corrupts INDIVIDUAL stacks. So conservation is
// necessary but NOT sufficient; the per-player test is the real guard.
//
// Operator stays the authority: this AUTO-SUGGESTS the settlement; the operator
// confirms/overrides, and the manual `settleSelectedWinners` remains the fallback.

import { evaluate7 } from "@/lib/poker/handEval";
import { computePotBreakdown, type PotContributor, type PotLayer } from "./potEngine";
import type { EngineSeat, SettleResult } from "./trackerEngine";

const SYMBOL_TO_LETTER: Record<string, string> = { "♠": "s", "♥": "h", "♦": "d", "♣": "c" };

/**
 * Normalize a tracker card to `evaluate7`'s `"Rs"` (rank letter + suit letter),
 * accepting either the stored form ("Ah", "Td") or a display form ("A♥", "10♦").
 * A single wrong card silently corrupts the rank → wrong winner → wrong stack, so
 * this is round-trip tested over all 52 cards.
 */
export function toEvalCard(card: string): string {
  let s = (card ?? "").trim();
  for (const [sym, letter] of Object.entries(SYMBOL_TO_LETTER)) s = s.split(sym).join(letter);
  s = s.replace(/^10/, "T");
  if (s.length < 2) return s;
  const rank = s[0].toUpperCase();
  const suit = s[s.length - 1].toLowerCase();
  return `${rank}${suit}`;
}

export interface ShowdownLayerResult {
  /** 0 = main pot, 1+ = side pots (in `computePotBreakdown.pots` order). */
  index: number;
  amount: number;
  eligible_player_ids: string[];
  winner_player_ids: string[];
}

export interface ShowdownSettlement {
  results: SettleResult[]; // ending_stack per player
  layers: ShowdownLayerResult[]; // who won which pot (for the Review per-layer view)
  uncalled: { player_id: string; amount: number } | null;
}

function hole2(holeCardsBySeat: Record<string, (string | null)[]>, pid: string): string[] | null {
  const hole = (holeCardsBySeat[pid] ?? []).filter((c): c is string => !!c);
  return hole.length === 2 ? hole : null;
}

/**
 * Exact showdown settlement. Returns `null` when it CANNOT auto-resolve (the board
 * isn't 5 cards yet, or a non-mucked eligible player hasn't revealed a 2-card hand)
 * — the caller then falls back to the manual winner-pick.
 */
export function settleShowdown(
  seats: EngineSeat[],
  holeCardsBySeat: Record<string, (string | null)[]>,
  board: string[],
  muckedPlayerIds: Set<string> = new Set(),
): ShowdownSettlement | null {
  const boardCards = board.filter((c): c is string => !!c);
  if (boardCards.length !== 5) return null; // river not complete → can't auto-rank
  const evalBoard = boardCards.map(toEvalCard);

  const breakdown = computePotBreakdown(
    seats.map<PotContributor>((s) => ({
      player_id: s.player_id,
      total_bet: s.total_committed,
      is_folded: s.folded,
    })),
  );

  // Not ready to auto-settle unless every still-contending (eligible, non-folded)
  // player is either explicitly mucked or has revealed a 2-card hand. Otherwise the
  // operator still has cards to enter (or a muck to mark) → fall back to manual.
  const contenders = new Set(breakdown.pots.flatMap((l) => l.eligible_player_ids));
  for (const pid of contenders) {
    if (!muckedPlayerIds.has(pid) && !hole2(holeCardsBySeat, pid)) return null;
  }

  const seatById = new Map(seats.map((s) => [s.player_id, s]));
  const scoreCache = new Map<string, number | null>();
  const scoreOf = (pid: string): number | null => {
    if (scoreCache.has(pid)) return scoreCache.get(pid)!;
    let score: number | null = null;
    if (!muckedPlayerIds.has(pid)) {
      const hole = hole2(holeCardsBySeat, pid);
      if (hole) score = evaluate7([...hole.map(toEvalCard), ...evalBoard]);
    }
    scoreCache.set(pid, score);
    return score;
  };

  const won = new Map<string, number>();
  const layers: ShowdownLayerResult[] = [];

  const pots: PotLayer[] = breakdown.pots;
  for (let i = 0; i < pots.length; i++) {
    const layer = pots[i];
    const ranked = layer.eligible_player_ids
      .map((pid) => ({ pid, score: scoreOf(pid) }))
      .filter((x): x is { pid: string; score: number } => x.score != null);
    if (ranked.length === 0) return null; // no revealed hand eligible here → manual

    const best = Math.max(...ranked.map((x) => x.score));
    const winners = ranked.filter((x) => x.score === best).map((x) => x.pid);
    // Split evenly; odd chip(s) go to the earliest seat first (mirror settleSelectedWinners).
    const ordered = [...winners].sort(
      (a, b) => (seatById.get(a)?.seat_number ?? 0) - (seatById.get(b)?.seat_number ?? 0),
    );
    const share = Math.floor(layer.amount / ordered.length);
    let remainder = layer.amount - share * ordered.length;
    for (const pid of ordered) {
      won.set(pid, (won.get(pid) ?? 0) + share + (remainder > 0 ? 1 : 0));
      if (remainder > 0) remainder -= 1;
    }
    layers.push({
      index: i,
      amount: layer.amount,
      eligible_player_ids: layer.eligible_player_ids,
      winner_player_ids: ordered,
    });
  }

  // 🔴 P1-1: the uncalled bet is refunded SEPARATELY to its bettor — never part of a layer.
  if (breakdown.uncalled) {
    won.set(breakdown.uncalled.player_id, (won.get(breakdown.uncalled.player_id) ?? 0) + breakdown.uncalled.amount);
  }

  const results: SettleResult[] = seats.map((s) => ({
    player_id: s.player_id,
    ending_stack: s.stack + (won.get(s.player_id) ?? 0),
  }));

  return { results, layers, uncalled: breakdown.uncalled };
}

/** Chip conservation: Σ starting === Σ ending. Necessary, NOT sufficient (see P1-1). */
export function showdownConserves(seats: EngineSeat[], results: SettleResult[]): boolean {
  const start = seats.reduce((s, p) => s + p.starting_stack, 0);
  const end = results.reduce((s, r) => s + r.ending_stack, 0);
  return start === end;
}
