// Đợt G3 — PURE glue between the completed-hand editor and the resettle-forward
// money-path. No supabase, no React: it (1) turns fetched hand rows into the engine's
// ResettleHandSnapshot[], (2) runs the pure G1 engine with the CLIENT reduceHand copy
// injected (the server reducer is walled off from the client bundle), and (3) maps a
// safe ResettleOk into the exact `apply_resettle_forward` RPC arg object.
//
// entry_number is NOT carried by the engine (it works in player_id only), but the RPC
// keys tournament_chip_counts / hand_players by (player_id, entry_number). We re-attach
// it from the fetched rows. An APPLIED resettle is a conserved chip re-attribution, so
// we send ONLY the players whose chips changed — their deltas net to zero, which keeps
// the RPC's conservation guard satisfied without dragging in unaffected (possibly
// drifted) rows. The RPC re-validates everything server-side and refuses otherwise.
import { reduceHand } from "@/lib/tracker-poker/handState";
import {
  resettleForward,
  type EditedTargetHand,
  type ResettleActionRow,
  type ResettleActionType,
  type ResettleForwardResult,
  type ResettleHandSnapshot,
  type ResettleOk,
  type ResettleStreet,
} from "@/lib/tracker-poker/resettleForward";

/** A completed hand as HandHistoryPanel fetches it (target + each later hand). */
export interface ResettleHandRow {
  id: string;
  hand_number: number;
  table_id: string;
  button_seat: number;
  created_at: string;
  players: {
    player_id: string;
    entry_number: number;
    seat_number: number;
    starting_stack: number;
    ending_stack: number;
    is_eliminated: boolean;
  }[];
  actions: {
    player_id: string;
    street: string;
    action_type: string;
    action_amount: number;
    action_order: number;
  }[];
}

/** The exact rpc("apply_resettle_forward", …) arg object (pinned by test). NO actor arg —
 *  the RPC binds auth.uid() itself. */
export interface ApplyResettleArgs {
  p_tournament_id: string;
  p_target_hand_id: string;
  p_reason: string;
  p_hand_changes: { hand_id: string; player_id: string; entry_number: number; ending_stack: number }[];
  p_final_stacks: { player_id: string; entry_number: number; chip_count: number }[];
  p_target_winner_ids: string[];
}

function toActions(actions: ResettleHandRow["actions"]): ResettleActionRow[] {
  // Recorded rows are server-trusted (the write path validated them), so the string
  // street/type are already valid engine unions; narrow without re-validating.
  return actions.map((a) => ({
    player_id: a.player_id,
    street: a.street as ResettleStreet,
    action_type: a.action_type as ResettleActionType,
    action_amount: a.action_amount,
    action_order: a.action_order,
  }));
}

function toSnapshot(row: ResettleHandRow): ResettleHandSnapshot {
  return {
    hand_id: row.id,
    hand_number: row.hand_number,
    table_id: row.table_id,
    button_seat: row.button_seat,
    players: row.players.map((p) => ({
      player_id: p.player_id,
      seat_number: p.seat_number,
      starting_stack: p.starting_stack,
      ending_stack: p.ending_stack,
      is_eliminated: p.is_eliminated,
    })),
    actions: toActions(row.actions),
    // Unused by the engine math (later pots transfer via recorded net delta); kept [].
    winner_player_ids: [],
  };
}

export interface ResettleSnapshots {
  snapshots: ResettleHandSnapshot[];
  /** player_id → entry_number (target wins; later hands only add new players). */
  entryByPlayer: Map<string, number>;
  /** `${hand_id}:${player_id}` → entry_number (exact per hand, for hand_changes). */
  entryByHandPlayer: Map<string, number>;
}

/** Build the engine input (target first, then later hands in chronological order) plus
 *  the entry_number lookups the RPC mapping needs. */
export function buildResettleSnapshots(target: ResettleHandRow, later: ResettleHandRow[]): ResettleSnapshots {
  const rows = [target, ...later];
  const entryByPlayer = new Map<string, number>();
  const entryByHandPlayer = new Map<string, number>();
  for (const row of rows) {
    for (const p of row.players) {
      entryByHandPlayer.set(`${row.id}:${p.player_id}`, p.entry_number);
      // Target's entry_number wins (row order puts it first); a re-settle chain is
      // single-entry per player because the engine blocks any re-entry boundary.
      if (!entryByPlayer.has(p.player_id)) entryByPlayer.set(p.player_id, p.entry_number);
    }
  }
  return { snapshots: rows.map(toSnapshot), entryByPlayer, entryByHandPlayer };
}

/** Assemble the engine's edited-target from the editor's raw state (holes already keyed
 *  by player_id — within one hand a player_id is unique). */
export function buildEditedTarget(input: {
  board: (string | null)[];
  holeCardsByPlayer: Record<string, (string | null)[]>;
  actions: ResettleHandRow["actions"];
  manualWinnerIds?: string[];
  muckedPlayerIds?: string[];
}): EditedTargetHand {
  return {
    board: input.board,
    holeCardsBySeat: input.holeCardsByPlayer,
    actions: toActions(input.actions),
    manualWinnerIds: input.manualWinnerIds,
    muckedPlayerIds: input.muckedPlayerIds,
  };
}

export interface ClientResettle extends ResettleSnapshots {
  result: ResettleForwardResult;
}

/** Run the pure G1 engine with the client reduceHand injected. Returns the result plus
 *  the entry lookups (needed to map an OK result to RPC args). */
export function runClientResettle(input: {
  target: ResettleHandRow;
  later: ResettleHandRow[];
  editedTarget: EditedTargetHand;
}): ClientResettle {
  const built = buildResettleSnapshots(input.target, input.later);
  const result = resettleForward({
    hands: built.snapshots,
    editedTarget: input.editedTarget,
    reduceHand,
  });
  return { ...built, result };
}

/** Map a SAFE (ok) engine result to the apply_resettle_forward RPC arg object. Sends the
 *  historical ending corrections that actually changed and the CHANGED players' final
 *  live stacks (conservation-safe subset). */
export function buildApplyResettleArgs(input: {
  tournamentId: string;
  targetHandId: string;
  reason: string;
  result: ResettleOk;
  entryByPlayer: Map<string, number>;
  entryByHandPlayer: Map<string, number>;
}): ApplyResettleArgs {
  const { result, entryByPlayer, entryByHandPlayer } = input;
  const changed = new Set(result.changedPlayerIds);
  return {
    p_tournament_id: input.tournamentId,
    p_target_hand_id: input.targetHandId,
    p_reason: input.reason,
    p_hand_changes: result.changes
      .filter((c) => c.after_ending !== c.before_ending)
      .map((c) => ({
        hand_id: c.hand_id,
        player_id: c.player_id,
        entry_number: entryByHandPlayer.get(`${c.hand_id}:${c.player_id}`) ?? 1,
        ending_stack: c.after_ending,
      })),
    p_final_stacks: result.finalStacks
      .filter((f) => changed.has(f.player_id))
      .map((f) => ({
        player_id: f.player_id,
        entry_number: entryByPlayer.get(f.player_id) ?? 1,
        chip_count: f.chip_count,
      })),
    p_target_winner_ids: result.targetWinnerIds,
  };
}

export interface ChipChange {
  player_id: string;
  before: number;
  after: number;
  delta: number;
}

/** Per-player current→new chip preview (last recorded ending → resettled final). Pure —
 *  the caller adds display names. */
export function resettleChipChanges(result: ResettleOk): ChipChange[] {
  const last = new Map<string, { before: number; after: number }>();
  for (const c of result.changes) last.set(c.player_id, { before: c.before_ending, after: c.after_ending });
  const changed = new Set(result.changedPlayerIds);
  const out: ChipChange[] = [];
  for (const [player_id, v] of last) {
    if (changed.has(player_id)) out.push({ player_id, before: v.before, after: v.after, delta: v.after - v.before });
  }
  return out;
}
