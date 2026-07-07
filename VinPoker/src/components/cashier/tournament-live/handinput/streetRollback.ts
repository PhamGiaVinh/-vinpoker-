// C2 (trackerStreetRollback) — "Hoàn tác cả vòng": pure decision module for rolling
// back a SENT street (flop/turn/river). Deletes all of that street's actions
// server-side (delete_last_action ×N, mirrored locally by one snapshot pop per
// confirmed delete), THEN shrinks the persisted board (update_community_cards with
// the shorter slice), landing the operator back on enter_{street}.
//
// Everything decision-shaped lives HERE so the owner's guards are unit-tested:
//  • D1 — the rollback target derives from the PERSISTED board, not currentStreet
//    (which auto-advances the instant a round completes).
//  • D4 — deletes strictly BEFORE the board shrink: resume derives its street from
//    MAX(board, actions), so shrink-first + crash would leave phantom street actions
//    on a shorter board. nextRollbackStep() encodes the ordering; the hook effect is
//    a thin executor, so the pinned machine property transfers to the real chain.
//  • D5 + OWNER P0 — one confirmed delete ↔ one undo-stack pop keeps local == server
//    at every step. A resumed hand starts with an EMPTY undo stack, so when the
//    target street has persisted actions the stack cannot mirror the deletes —
//    blocked with the owner's exact message. Shrink-only (zero street actions)
//    needs no snapshots and stays available after a resume.
//  • D6 — blocked contexts: read-only, submitting/chain running, all-in runout
//    (multi-street reveal semantics a per-street rewind would corrupt — Void is the
//    escape hatch), showdown, review/summary, no server hand.

export type RollbackStreet = "flop" | "turn" | "river";

export interface StreetRollbackState {
  street: RollbackStreet;
  /** "deleting" until every street action is confirmed deleted, then "shrinking". */
  phase: "deleting" | "shrinking";
  /** Decremented once per CONFIRMED server delete (never optimistically). */
  deletesRemaining: number;
  /** For the "k/N" progress label. */
  total: number;
}

/** Board length that remains after rolling back the street. */
export const ROLLBACK_KEEP_COUNT: Record<RollbackStreet, number> = { flop: 0, turn: 3, river: 4 };
/** First card-slot index to CLEAR (D3: keep the undone street's slots filled for a
    1-tap resend; clear HIGHER slots so a stacked rollback can't resend extra cards). */
export const ROLLBACK_CLEAR_FROM: Record<RollbackStreet, number> = { flop: 3, turn: 4, river: 5 };
export const ROLLBACK_STREET_LABELS: Record<RollbackStreet, string> = {
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

/** D1 — the street a rollback would undo, from the PERSISTED board length. */
export function rollbackTargetFrom(persistedBoardCount: number): RollbackStreet | null {
  if (persistedBoardCount >= 5) return "river";
  if (persistedBoardCount === 4) return "turn";
  if (persistedBoardCount === 3) return "flop";
  return null;
}

export interface StreetRollbackPlanInput {
  persistedBoardCount: number;
  actions: { street: string }[];
  undoStackLength: number;
  isReadOnly: boolean;
  submitting: boolean;
  /** Any other effect-chain in flight (the rollback itself, the A1 blind chain). */
  chainRunning: boolean;
  isRunout: boolean;
  currentStreet: string;
  isSummary: boolean;
  handId: string | null;
}

export type StreetRollbackPlan =
  | { street: RollbackStreet; deletes: number }
  | { blocked: string }
  | null;

/** Owner P0 message — a resumed hand cannot mirror the street's deletes locally. */
export const ROLLBACK_RESUMED_BLOCK_MSG =
  "Không thể hoàn tác cả vòng sau khi tải lại ván. Hãy hoàn tác từng hành động hoặc void hand.";

/**
 * null = no rollback target (board still preflop). Otherwise either an executable
 * plan {street, deletes} or {blocked: <plain-VN reason>}.
 */
export function planStreetRollback(i: StreetRollbackPlanInput): StreetRollbackPlan {
  const street = rollbackTargetFrom(i.persistedBoardCount);
  if (!street) return null;
  if (!i.handId) return { blocked: "Ván chưa được ghi trên server — không có gì để hoàn tác" };
  if (i.isReadOnly) return { blocked: "Phiên làm việc đã hết hạn" };
  if (i.submitting || i.chainRunning) return { blocked: "Đang gửi dữ liệu — chờ xong đã" };
  if (i.isSummary) return { blocked: "Đang ở bước tổng kết — không hoàn tác vòng được" };
  if (i.currentStreet === "showdown") return { blocked: "Đang ở showdown — không hoàn tác vòng được" };
  if (i.isRunout) return { blocked: "Đang chia bài all-in — không hoàn tác vòng được. Dùng Void nếu cần." };
  const deletes = i.actions.filter((a) => a.street === street).length;
  // OWNER P0 — the undo stack must cover every delete (one pop per confirmed delete).
  // After a resume the stack is empty, so a street WITH persisted actions is blocked;
  // shrink-only (deletes === 0) is allowed.
  if (deletes > i.undoStackLength) return { blocked: ROLLBACK_RESUMED_BLOCK_MSG };
  return { street, deletes };
}

export type RollbackStep =
  | { kind: "transition_to_shrink" }
  | { kind: "delete" }
  | { kind: "shrink"; keepCount: number; clearFrom: number };

/**
 * D4 — the next chain step for a state. The hook effect executes exactly ONE step
 * per render (the A1 pattern: each confirmed delete pops a FRESH snapshot closure).
 * Pinned by test: from {deleting, N} the machine emits exactly N "delete" steps and
 * a "shrink" is unreachable while any delete remains.
 */
export function nextRollbackStep(s: StreetRollbackState): RollbackStep {
  if (s.phase === "deleting") {
    return s.deletesRemaining === 0 ? { kind: "transition_to_shrink" } : { kind: "delete" };
  }
  return {
    kind: "shrink",
    keepCount: ROLLBACK_KEEP_COUNT[s.street],
    clearFrom: ROLLBACK_CLEAR_FROM[s.street],
  };
}
