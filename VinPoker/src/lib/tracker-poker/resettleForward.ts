// Resettle-Forward engine (Phase G1) — PURE. No DB, no Supabase, no IO, no flags.
//
// Given a corrected/edited COMPLETED hand plus the chronological completed hands
// that follow it, this module recomputes what every player's chip stack WOULD be
// if the edit had been recorded originally — by:
//   1. re-settling the edited (target) hand with the EXISTING showdown/pot logic
//      (`settleShowdown` → `evaluate7`, or operator-designated `settleSelectedWinners`),
//   2. carrying the corrected stacks forward through each later hand, re-running the
//      SAME recorded action stream against the new incoming stacks via the EXISTING
//      server reducer (`reduceHand`, injected — it is walled off from the client bundle),
//      and awarding each later pot to that hand's ALREADY-RECORDED winners.
//
// It NEVER re-ranks a later hand's cards. It STOPS (returns a blocked result, nothing
// marked safe to write) the moment a correction would change the physical shape of a
// later hand — an all-in cap moving, an elimination flipping, a busted player still
// acting, a table change, or an unreplayable stream. This module only DECIDES; it does
// not write anything. Wiring (Edge Function + atomic write + UI) is later phases.

import {
  type EngineSeat,
  type SettleResult,
  foldWinner,
  settleFoldWin,
  settleSelectedWinners,
} from "./trackerEngine";
import { settleShowdown } from "./trackerShowdown";

// ── Structural mirror of the server engine (avoids a cross-bundle import) ─────────
// These unions are byte-identical to `_shared/trackerEngine/types.ts` so the real
// `reduceHand` is assignable to `ReduceHandFn` with no cast.
export type ResettleStreet = "preflop" | "flop" | "turn" | "river" | "showdown";
export type ResettleActionType =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all_in"
  | "post_sb"
  | "post_bb"
  | "post_ante";

export interface ResettleActionRow {
  player_id: string;
  street: ResettleStreet;
  action_type: ResettleActionType;
  action_amount: number;
  action_order: number;
}

export interface ReduceSeed {
  player_id: string;
  seat_number: number;
  starting_stack: number;
}

/** The subset of the server `PlayerRuntime` this engine reads. */
export interface ReduceRuntimePlayer {
  player_id: string;
  seat_number: number;
  starting_stack: number;
  stack: number;
  street_bet: number;
  total_bet: number;
  is_folded: boolean;
  is_all_in: boolean;
}

export interface ReduceRuntimeLike {
  players: ReduceRuntimePlayer[];
}

/** Injected `reduceHand` from `_shared/trackerEngine/handState.ts` (server-authoritative). */
export type ReduceHandFn = (
  seeds: ReduceSeed[],
  actions: ResettleActionRow[],
  buttonSeat: number,
) => ReduceRuntimeLike;

// ── Recorded facts (what the DB already stored for each hand) ─────────────────────
/** One `hand_players` row as recorded (starting/ending stack + elimination). */
export interface ResettlePlayerRecord {
  player_id: string;
  seat_number: number;
  starting_stack: number;
  ending_stack: number;
  is_eliminated: boolean;
}

/** A completed hand snapshot: what was recorded, plus its table + button + winners. */
export interface ResettleHandSnapshot {
  hand_id: string;
  hand_number: number;
  table_id: string;
  button_seat: number;
  players: ResettlePlayerRecord[];
  actions: ResettleActionRow[];
  /** The winner(s) already stored for this hand (used verbatim for LATER hands). */
  winner_player_ids: string[];
}

/** The edit applied to the TARGET hand (hands[0]). */
export interface EditedTargetHand {
  /** Edited board (0/3/4/5 cards; nulls allowed for empty slots). */
  board: (string | null)[];
  /** Edited hole cards per player_id. */
  holeCardsBySeat: Record<string, (string | null)[]>;
  /** Edited action stream. Defaults to the target's recorded actions when omitted. */
  actions?: ResettleActionRow[];
  /** Operator-designated winners (rule C) — required when cards can't auto-evaluate. */
  manualWinnerIds?: string[];
  /** Players who mucked at showdown (skipped in auto-ranking). */
  muckedPlayerIds?: string[];
}

export interface ResettleForwardInput {
  /** [0] = target (edited) hand, then its later completed hands in chronological order. */
  hands: ResettleHandSnapshot[];
  editedTarget: EditedTargetHand;
  /** The real `reduceHand` (injected — walled off from the client bundle by design). */
  reduceHand: ReduceHandFn;
}

// ── Results ───────────────────────────────────────────────────────────────────────
export type ResettleBlockReason =
  | "needs_manual_winner"
  | "affected_player_table_changed"
  | "all_in_cap_changed"
  | "elimination_changed"
  | "eliminated_player_has_future_actions"
  | "action_replay_invalid"
  // The engine carries chips forward keyed by player_id ONLY (ResettlePlayerRecord has no
  // entry_number), so a re-entry — the same player_id appearing under a DIFFERENT
  // entry_number later in the chain — cannot be re-settled soundly. The caller detects it
  // from the entry_number-bearing rows and blocks with this reason (the engine never sees
  // two entries for one id in a safe chain).
  | "reentry_boundary";

export interface ResettleChange {
  hand_id: string;
  hand_number: number;
  player_id: string;
  before_ending: number;
  after_ending: number;
  /** Starting stack before/after the re-settle. Unchanged for the target hand; for a LATER
   *  hand the new starting = the corrected incoming stack. Lets the write keep hand_players
   *  internally consistent (see G3 server-guards migration, finding #11). */
  before_starting: number;
  after_starting: number;
}

export interface ResettleBlock {
  ok: false;
  /** A blocked result is NEVER safe to write, partially or otherwise. */
  safeToWrite: false;
  reason: ResettleBlockReason;
  hand_id: string | null;
  hand_number: number | null;
  affected_player_ids: string[];
  /** Human-readable Vietnamese message for the operator. */
  message: string;
}

export interface ResettleFinalStack {
  player_id: string;
  chip_count: number;
}

export interface ResettleOk {
  ok: true;
  safeToWrite: true;
  /** Winners computed for the TARGET hand (auto-evaluated or manual). */
  targetWinnerIds: string[];
  /** Per-hand, per-player before/after ending stacks (audit-ready). */
  changes: ResettleChange[];
  /** Final chip count per player after the whole forward re-settle. */
  finalStacks: ResettleFinalStack[];
  /** Players whose chips changed anywhere in the chain. */
  changedPlayerIds: string[];
  /** One-line Vietnamese audit summary. */
  summary: string;
}

export type ResettleForwardResult = ResettleOk | ResettleBlock;

// ── Helpers ───────────────────────────────────────────────────────────────────────
function toEngineSeats(players: ReduceRuntimePlayer[]): EngineSeat[] {
  return players.map((p) => ({
    player_id: p.player_id,
    seat_number: p.seat_number,
    starting_stack: p.starting_stack,
    stack: p.stack,
    street_committed: p.street_bet,
    total_committed: p.total_bet,
    folded: p.is_folded,
    all_in: p.is_all_in,
  }));
}

function endingMap(results: SettleResult[]): Map<string, number> {
  return new Map(results.map((r) => [r.player_id, r.ending_stack]));
}

function seedsFrom(
  players: ResettlePlayerRecord[],
  stackOf: (p: ResettlePlayerRecord) => number,
): ReduceSeed[] {
  return players.map((p) => ({
    player_id: p.player_id,
    seat_number: p.seat_number,
    starting_stack: stackOf(p),
  }));
}

function block(
  reason: ResettleBlockReason,
  hand: { hand_id: string; hand_number: number } | null,
  affected: string[],
  message: string,
): ResettleBlock {
  return {
    ok: false,
    safeToWrite: false,
    reason,
    hand_id: hand?.hand_id ?? null,
    hand_number: hand?.hand_number ?? null,
    affected_player_ids: affected,
    message,
  };
}

// ── Target-hand settlement (rule 1 + rule C) ──────────────────────────────────────
export interface EditedHandSettlement {
  ok: boolean;
  /** True when the target hand needs cards it doesn't have and no manual winners. */
  needsManualWinner: boolean;
  winnerIds: string[];
  /** player_id → new ending_stack for the target hand. */
  endings: Map<string, number>;
}

/**
 * Settle the edited TARGET hand using the EXISTING engine only:
 *  - manual winners provided        → `settleSelectedWinners`,
 *  - exactly one player left (fold) → `settleFoldWin` (no cards needed),
 *  - full board + revealed holes    → `settleShowdown` (`evaluate7`),
 *  - otherwise                      → needsManualWinner (caller must supply winners).
 */
export function planEditedHandSettlement(
  target: ResettleHandSnapshot,
  edited: EditedTargetHand,
  reduceHand: ReduceHandFn,
): EditedHandSettlement {
  const seeds = seedsFrom(target.players, (p) => p.starting_stack);
  const actions = edited.actions ?? target.actions;
  const runtime = reduceHand(seeds, actions, target.button_seat);
  const seats = toEngineSeats(runtime.players);

  if (edited.manualWinnerIds && edited.manualWinnerIds.length > 0) {
    const results = settleSelectedWinners(seats, edited.manualWinnerIds);
    return { ok: true, needsManualWinner: false, winnerIds: edited.manualWinnerIds, endings: endingMap(results) };
  }

  const lone = foldWinner(seats);
  if (lone) {
    const results = settleFoldWin(seats);
    return { ok: true, needsManualWinner: false, winnerIds: [lone.player_id], endings: endingMap(results) };
  }

  const board = edited.board.filter((c): c is string => !!c);
  const mucked = new Set(edited.muckedPlayerIds ?? []);
  const showdown = settleShowdown(seats, edited.holeCardsBySeat, board, mucked);
  if (!showdown) {
    return { ok: false, needsManualWinner: true, winnerIds: [], endings: new Map() };
  }
  const winnerIds = [...new Set(showdown.layers.flatMap((l) => l.winner_player_ids))];
  return { ok: true, needsManualWinner: false, winnerIds, endings: endingMap(showdown.results) };
}

// ── Structural-divergence detection for a LATER hand (rule 3) ──────────────────────
export interface Divergence {
  reason: ResettleBlockReason;
  affected_player_ids: string[];
}

/**
 * Compare the recorded replay of a later hand against the replay with the corrected
 * incoming stacks. Any physical difference blocks the whole resettle:
 *  - a player already eliminated earlier still has actions here,
 *  - an action references a player not seated in the hand,
 *  - a committed amount / all-in status differs (an all-in cap moved),
 *  - a fold outcome differs (stream cannot be reproduced).
 * Returns null only when the later hand plays out physically identically.
 */
export function detectStructuralDivergence(args: {
  hand: ResettleHandSnapshot;
  recordedRun: ReduceRuntimeLike;
  newRun: ReduceRuntimeLike;
  eliminatedSoFar: Set<string>;
}): Divergence | null {
  const { hand, recordedRun, newRun, eliminatedSoFar } = args;
  const actorIds = [...new Set(hand.actions.map((a) => a.player_id))];

  const ghosts = actorIds.filter((pid) => eliminatedSoFar.has(pid));
  if (ghosts.length > 0) {
    return { reason: "eliminated_player_has_future_actions", affected_player_ids: ghosts };
  }

  const seatIds = new Set(hand.players.map((p) => p.player_id));
  const unknown = actorIds.filter((pid) => !seatIds.has(pid));
  if (unknown.length > 0) {
    return { reason: "action_replay_invalid", affected_player_ids: unknown };
  }

  const recById = new Map(recordedRun.players.map((p) => [p.player_id, p]));
  const capChanged: string[] = [];
  const foldChanged: string[] = [];
  for (const nw of newRun.players) {
    const rec = recById.get(nw.player_id);
    if (!rec) {
      foldChanged.push(nw.player_id);
      continue;
    }
    if (nw.total_bet !== rec.total_bet || nw.is_all_in !== rec.is_all_in) capChanged.push(nw.player_id);
    else if (nw.is_folded !== rec.is_folded) foldChanged.push(nw.player_id);
  }
  if (capChanged.length > 0) return { reason: "all_in_cap_changed", affected_player_ids: capChanged };
  if (foldChanged.length > 0) return { reason: "action_replay_invalid", affected_player_ids: foldChanged };

  return null;
}

// ── The forward re-settle (rule 2 + rules 3 + 4) ──────────────────────────────────
export function resettleForward(input: ResettleForwardInput): ResettleForwardResult {
  const { hands, editedTarget, reduceHand } = input;
  if (hands.length === 0) {
    return block("action_replay_invalid", null, [], "Không có ván nào để tính lại.");
  }

  const target = hands[0];
  const targetTableId = target.table_id;
  const later = hands.slice(1);

  // 1) Settle the edited target hand.
  const plan = planEditedHandSettlement(target, editedTarget, reduceHand);
  if (!plan.ok) {
    return block(
      "needs_manual_winner",
      target,
      [],
      `Ván #${target.hand_number} chưa đủ bài để tự chấm người thắng — cần chọn người thắng bằng tay.`,
    );
  }

  const changes: ResettleChange[] = [];
  const changedPlayerIds = new Set<string>();
  const carried = new Map<string, number>();

  for (const p of target.players) {
    const after = plan.endings.get(p.player_id) ?? p.ending_stack;
    carried.set(p.player_id, after);
    changes.push({
      hand_id: target.hand_id,
      hand_number: target.hand_number,
      player_id: p.player_id,
      before_ending: p.ending_stack,
      after_ending: after,
      // The edit changes the target's OUTCOME, not its starting stacks.
      before_starting: p.starting_stack,
      after_starting: p.starting_stack,
    });
    if (after !== p.ending_stack) changedPlayerIds.add(p.player_id);
  }

  // Elimination bookkeeping at the target.
  const recTargetElim = new Set(target.players.filter((p) => p.is_eliminated).map((p) => p.player_id));
  const newTargetElim = new Set(
    target.players.filter((p) => (plan.endings.get(p.player_id) ?? p.ending_stack) === 0).map((p) => p.player_id),
  );
  const eliminatedSoFar = new Set(newTargetElim);

  // (rule 3) A player newly busted by the edit must not still be acting in a later hand.
  const newlyBusted = [...newTargetElim].filter((pid) => !recTargetElim.has(pid));
  if (newlyBusted.length > 0) {
    for (const h of later) {
      const actors = new Set(h.actions.map((a) => a.player_id));
      const ghost = newlyBusted.find((pid) => actors.has(pid));
      if (ghost) {
        return block(
          "eliminated_player_has_future_actions",
          h,
          [ghost],
          `Sửa ván #${target.hand_number} khiến người chơi hết chip, nhưng họ vẫn có hành động ở ván #${h.hand_number} — không thể tự dời chip.`,
        );
      }
    }
  }

  // (rule 3) A player recorded busted in the target but now surviving would be alive
  // for later hands that never included them → unsound to auto-resettle. This only
  // matters when later hands exist; on the LATEST hand a bust flip is perfectly safe.
  const nowSurviving = [...recTargetElim].filter((pid) => !newTargetElim.has(pid));
  if (nowSurviving.length > 0 && later.length > 0) {
    return block(
      "elimination_changed",
      target,
      nowSurviving,
      `Sửa ván #${target.hand_number} khiến người trước đây bị loại nay còn sống — các ván sau không có họ nên không thể tự dời chip. Cần chỉnh tay.`,
    );
  }

  // 2) Forward re-settle the later hands.
  for (const h of later) {
    // (rule 3 / B) An affected player recorded at a different table later.
    const changedHere = h.players.filter((p) => changedPlayerIds.has(p.player_id)).map((p) => p.player_id);
    if (h.table_id !== targetTableId && changedHere.length > 0) {
      return block(
        "affected_player_table_changed",
        h,
        changedHere,
        `Người chơi bị ảnh hưởng đã chuyển sang bàn khác ở ván #${h.hand_number} — cần chỉnh tay, không thể tự dời chip.`,
      );
    }

    const recordedRun = reduceHand(seedsFrom(h.players, (p) => p.starting_stack), h.actions, h.button_seat);
    const newRun = reduceHand(
      seedsFrom(h.players, (p) => carried.get(p.player_id) ?? p.starting_stack),
      h.actions,
      h.button_seat,
    );

    const div = detectStructuralDivergence({ hand: h, recordedRun, newRun, eliminatedSoFar });
    if (div) return block(div.reason, h, div.affected_player_ids, divergenceMessage(div.reason, h));

    // Physically identical → the recorded net delta transfers verbatim onto the new baseline.
    for (const p of h.players) {
      const incoming = carried.get(p.player_id) ?? p.starting_stack;
      const after = incoming + (p.ending_stack - p.starting_stack);
      carried.set(p.player_id, after);
      changes.push({
        hand_id: h.hand_id,
        hand_number: h.hand_number,
        player_id: p.player_id,
        before_ending: p.ending_stack,
        after_ending: after,
        // A later hand's new starting stack = the corrected incoming (carried) stack.
        before_starting: p.starting_stack,
        after_starting: incoming,
      });
      if (after !== p.ending_stack) changedPlayerIds.add(p.player_id);
      if (after === 0) eliminatedSoFar.add(p.player_id);
    }
  }

  const finalStacks: ResettleFinalStack[] = [...carried].map(([player_id, chip_count]) => ({ player_id, chip_count }));
  const changedList = [...changedPlayerIds];
  const summary =
    `Sửa ván #${target.hand_number}: người thắng mới ${plan.winnerIds.join(", ") || "(không có)"}. ` +
    `${changedList.length} người đổi chip qua ${hands.length} ván.`;

  return {
    ok: true,
    safeToWrite: true,
    targetWinnerIds: plan.winnerIds,
    changes,
    finalStacks,
    changedPlayerIds: changedList,
    summary,
  };
}

function divergenceMessage(reason: ResettleBlockReason, hand: ResettleHandSnapshot): string {
  switch (reason) {
    case "all_in_cap_changed":
      return `Ở ván #${hand.hand_number}, số chip mới làm thay đổi mức all-in/đặt cược — kết quả ván này sẽ khác, không thể tự dời. Cần chỉnh tay.`;
    case "eliminated_player_has_future_actions":
      return `Ở ván #${hand.hand_number} có người chơi đáng lẽ đã hết chip trước đó — không thể tự dời chip. Cần chỉnh tay.`;
    case "action_replay_invalid":
      return `Không tua lại được chuỗi hành động của ván #${hand.hand_number} — cần chỉnh tay.`;
    default:
      return `Ván #${hand.hand_number} bị lệch khi tính lại — cần chỉnh tay.`;
  }
}
