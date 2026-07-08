// Phase G1 — pure resettle-forward engine. Proves the math and the stop conditions.
// The real (server-authoritative) reduceHand is injected — same reducer live settlement
// uses — so these tests exercise the exact chip arithmetic, not a re-implementation.
import { describe, it, expect } from "vitest";
import { reduceHand } from "@tracker-engine/handState.ts";
import {
  resettleForward,
  planEditedHandSettlement,
  type ResettleActionRow,
  type ResettleActionType,
  type ResettleHandSnapshot,
  type ResettlePlayerRecord,
  type ResettleOk,
  type ResettleForwardResult,
} from "@/lib/tracker-poker/resettleForward";

// ── tiny builders ─────────────────────────────────────────────────────────────
const A = (
  player_id: string,
  action_type: ResettleActionType,
  action_amount: number,
  action_order: number,
): ResettleActionRow => ({ player_id, street: "preflop", action_type, action_amount, action_order });

const P = (
  player_id: string,
  seat_number: number,
  starting_stack: number,
  ending_stack: number,
  is_eliminated = false,
): ResettlePlayerRecord => ({ player_id, seat_number, starting_stack, ending_stack, is_eliminated });

function hand(o: {
  hand_id: string;
  hand_number: number;
  table_id?: string;
  button_seat?: number;
  players: ResettlePlayerRecord[];
  actions: ResettleActionRow[];
  winner_player_ids?: string[];
}): ResettleHandSnapshot {
  return {
    hand_id: o.hand_id,
    hand_number: o.hand_number,
    table_id: o.table_id ?? "T1",
    button_seat: o.button_seat ?? 1,
    players: o.players,
    actions: o.actions,
    winner_player_ids: o.winner_player_ids ?? [],
  };
}

const BOARD5 = ["2c", "3d", "7h", "9s", "Jc"];
const stackOf = (r: ResettleOk, id: string) => r.finalStacks.find((s) => s.player_id === id)?.chip_count;
const mustOk = (r: ResettleForwardResult): ResettleOk => {
  if (!r.ok) throw new Error(`expected ok, got blocked: ${r.reason}`);
  return r;
};

// ── 1. Latest completed hand, auto-evaluate, stacks reverse ────────────────────
it("1) latest hand edit: auto-evaluates the true winner and reverses the stacks", () => {
  // Recorded (wrong): P2 won the 2000 pot, P1 busted. Edit → P1 (AA) actually wins.
  const target = hand({
    hand_id: "h1",
    hand_number: 1,
    players: [P("P1", 1, 1000, 0, true), P("P2", 2, 1000, 2000, false)],
    actions: [A("P1", "post_sb", 50, 1), A("P2", "post_bb", 100, 2), A("P1", "all_in", 950, 3), A("P2", "call", 900, 4)],
  });
  const r = resettleForward({
    hands: [target],
    editedTarget: { board: BOARD5, holeCardsBySeat: { P1: ["As", "Ac"], P2: ["Kd", "Kh"] } },
    reduceHand,
  });
  const ok = mustOk(r);
  expect(ok.targetWinnerIds).toEqual(["P1"]);
  expect(stackOf(ok, "P1")).toBe(2000);
  expect(stackOf(ok, "P2")).toBe(0);
});

// ── 2. Old hand edit with safe future hands (no all-in, no bust, same table) ────
it("2) old hand edit: future hands re-settle forward using stored winners", () => {
  // Target: winner flips P2→P1 (both keep >0). Later hand: tiny pot, nobody near a cap.
  const target = hand({
    hand_id: "h1",
    hand_number: 1,
    players: [P("P1", 1, 1000, 900, false), P("P2", 2, 1000, 1100, false)],
    actions: [A("P1", "post_sb", 50, 1), A("P2", "post_bb", 100, 2), A("P1", "call", 50, 3), A("P2", "check", 0, 4)],
  });
  // Recorded #2 starts from the ORIGINAL (pre-edit) stacks: P1 900, P2 1100.
  const h2 = hand({
    hand_id: "h2",
    hand_number: 2,
    players: [P("P1", 1, 900, 1000, false), P("P2", 2, 1100, 1000, false)],
    actions: [A("P1", "post_sb", 50, 1), A("P2", "post_bb", 100, 2), A("P1", "call", 50, 3), A("P2", "check", 0, 4)],
    winner_player_ids: ["P1"],
  });
  const r = resettleForward({
    hands: [target, h2],
    editedTarget: { board: BOARD5, holeCardsBySeat: { P1: ["As", "Ac"], P2: ["Kd", "Kh"] } },
    reduceHand,
  });
  const ok = mustOk(r);
  // Target swap: P1 900→1100, P2 1100→900. Then #2 net delta P1 +100 / P2 −100.
  expect(stackOf(ok, "P1")).toBe(1200);
  expect(stackOf(ok, "P2")).toBe(800);
  expect(ok.changes.filter((c) => c.hand_number === 2)).toHaveLength(2);
});

// ── 3. Manual winner path (incomplete board) ───────────────────────────────────
it("3) manual winners: incomplete cards but operator provides winners → resettles", () => {
  const target = hand({
    hand_id: "h1",
    hand_number: 1,
    players: [P("P1", 1, 1000, 900, false), P("P2", 2, 1000, 1100, false)],
    actions: [A("P1", "post_sb", 50, 1), A("P2", "post_bb", 100, 2), A("P1", "call", 50, 3), A("P2", "check", 0, 4)],
  });
  const r = resettleForward({
    hands: [target],
    editedTarget: { board: ["2c", "3d", "7h"], holeCardsBySeat: {}, manualWinnerIds: ["P1"] },
    reduceHand,
  });
  const ok = mustOk(r);
  expect(ok.targetWinnerIds).toEqual(["P1"]);
  expect(stackOf(ok, "P1")).toBe(1100);
  expect(stackOf(ok, "P2")).toBe(900);
});

// ── 4. Missing manual winner → blocked ─────────────────────────────────────────
it("4) incomplete cards and NO manual winner → blocked needs_manual_winner", () => {
  const target = hand({
    hand_id: "h1",
    hand_number: 1,
    players: [P("P1", 1, 1000, 900, false), P("P2", 2, 1000, 1100, false)],
    actions: [A("P1", "post_sb", 50, 1), A("P2", "post_bb", 100, 2), A("P1", "call", 50, 3), A("P2", "check", 0, 4)],
  });
  const r = resettleForward({
    hands: [target],
    editedTarget: { board: ["2c", "3d", "7h"], holeCardsBySeat: { P1: ["As", "Ac"], P2: ["Kd", "Kh"] } },
    reduceHand,
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected block");
  expect(r.reason).toBe("needs_manual_winner");
  expect(r.safeToWrite).toBe(false);
});

// ── 5. All-in cap changed in a later hand → blocked at that hand ────────────────
it("5) later all-in caps lower after the edit → blocked all_in_cap_changed", () => {
  // Edit flips the target winner so P2 ends with 1000 instead of the recorded 3000.
  const target = hand({
    hand_id: "h1",
    hand_number: 1,
    players: [P("P1", 1, 2000, 1000, false), P("P2", 2, 2000, 3000, false)],
    actions: [A("P1", "post_sb", 50, 1), A("P2", "post_bb", 100, 2), A("P1", "raise", 950, 3), A("P2", "call", 900, 4)],
  });
  // #2 pits P2 (recorded 3000, now 1000) vs an unaffected P3.
  const h2 = hand({
    hand_id: "h2",
    hand_number: 2,
    players: [P("P2", 2, 3000, 4000, false), P("P3", 3, 1000, 0, true)],
    actions: [A("P2", "all_in", 3000, 1), A("P3", "call", 3000, 2)],
    winner_player_ids: ["P2"],
  });
  const r = resettleForward({
    hands: [target, h2],
    editedTarget: { board: BOARD5, holeCardsBySeat: { P1: ["As", "Ac"], P2: ["Kd", "Kh"] } },
    reduceHand,
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected block");
  expect(r.reason).toBe("all_in_cap_changed");
  expect(r.hand_number).toBe(2);
  expect(r.affected_player_ids).toContain("P2");
  expect(r.safeToWrite).toBe(false);
});

// ── 6. Elimination changed (recorded bust now survives) → blocked ──────────────
it("6) edit makes a busted player survive with later hands pending → elimination_changed", () => {
  // 3-way all-in for 500 each (main pot 1500). Recorded: P3 busts. Edit: P3 (AA) wins.
  const target = hand({
    hand_id: "h1",
    hand_number: 1,
    players: [P("P1", 1, 2000, 3000, false), P("P2", 2, 2000, 1500, false), P("P3", 3, 500, 0, true)],
    actions: [
      A("P1", "post_sb", 50, 1),
      A("P2", "post_bb", 100, 2),
      A("P3", "all_in", 500, 3),
      A("P1", "call", 450, 4),
      A("P2", "call", 400, 5),
    ],
  });
  const h2 = hand({
    hand_id: "h2",
    hand_number: 2,
    players: [P("P1", 1, 3000, 3000, false), P("P2", 2, 1500, 1500, false)],
    actions: [A("P1", "post_sb", 50, 1), A("P2", "post_bb", 100, 2), A("P1", "call", 50, 3), A("P2", "check", 0, 4)],
    winner_player_ids: ["P2"],
  });
  const r = resettleForward({
    hands: [target, h2],
    editedTarget: {
      board: BOARD5,
      holeCardsBySeat: { P1: ["Kd", "Kh"], P2: ["Td", "Th"], P3: ["As", "Ac"] },
    },
    reduceHand,
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected block");
  expect(r.reason).toBe("elimination_changed");
  expect(r.affected_player_ids).toContain("P3");
  expect(r.safeToWrite).toBe(false);
});

// ── 7. Eliminated player has future actions → blocked ──────────────────────────
it("7) edit busts a player who still acts in a later hand → eliminated_player_has_future_actions", () => {
  // Recorded: P2 (all-in for 1000) WON and survived. Edit: P1 (AA) wins → P2 busts.
  const target = hand({
    hand_id: "h1",
    hand_number: 1,
    players: [P("P1", 1, 2000, 1000, false), P("P2", 2, 1000, 2000, false)],
    actions: [A("P1", "post_sb", 50, 1), A("P2", "post_bb", 100, 2), A("P2", "all_in", 900, 3), A("P1", "call", 950, 4)],
  });
  const h2 = hand({
    hand_id: "h2",
    hand_number: 2,
    players: [P("P1", 1, 1000, 900, false), P("P2", 2, 2000, 2100, false)],
    actions: [A("P2", "post_bb", 100, 1), A("P1", "call", 100, 2)],
    winner_player_ids: ["P2"],
  });
  const r = resettleForward({
    hands: [target, h2],
    editedTarget: { board: BOARD5, holeCardsBySeat: { P1: ["As", "Ac"], P2: ["Kd", "Kh"] } },
    reduceHand,
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected block");
  expect(r.reason).toBe("eliminated_player_has_future_actions");
  expect(r.affected_player_ids).toContain("P2");
});

// ── 8. Affected player appears at another table later → blocked ────────────────
it("8) an affected player is recorded at a different table later → affected_player_table_changed", () => {
  const target = hand({
    hand_id: "h1",
    hand_number: 1,
    table_id: "T1",
    players: [P("P1", 1, 1000, 900, false), P("P2", 2, 1000, 1100, false)],
    actions: [A("P1", "post_sb", 50, 1), A("P2", "post_bb", 100, 2), A("P1", "call", 50, 3), A("P2", "check", 0, 4)],
  });
  const h2 = hand({
    hand_id: "h2",
    hand_number: 2,
    table_id: "T2", // P1 moved tables
    players: [P("P1", 1, 1100, 1100, false), P("PX", 2, 5000, 5000, false)],
    actions: [A("P1", "post_bb", 100, 1), A("PX", "call", 100, 2)],
    winner_player_ids: ["PX"],
  });
  const r = resettleForward({
    hands: [target, h2],
    editedTarget: { board: BOARD5, holeCardsBySeat: { P1: ["As", "Ac"], P2: ["Kd", "Kh"] } },
    reduceHand,
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected block");
  expect(r.reason).toBe("affected_player_table_changed");
  expect(r.hand_number).toBe(2);
  expect(r.affected_player_ids).toContain("P1");
});

// ── 9. No partial write semantics on a blocked result ──────────────────────────
it("9) a blocked result is explicitly not safe to write and carries no stacks", () => {
  const target = hand({
    hand_id: "h1",
    hand_number: 1,
    players: [P("P1", 1, 1000, 900, false), P("P2", 2, 1000, 1100, false)],
    actions: [A("P1", "post_sb", 50, 1), A("P2", "post_bb", 100, 2), A("P1", "call", 50, 3), A("P2", "check", 0, 4)],
  });
  const r = resettleForward({
    hands: [target],
    editedTarget: { board: ["2c", "3d", "7h"], holeCardsBySeat: {} }, // incomplete, no manual
    reduceHand,
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected block");
  expect(r.safeToWrite).toBe(false);
  expect((r as unknown as ResettleOk).finalStacks).toBeUndefined();
  expect((r as unknown as ResettleOk).changes).toBeUndefined();
});

// ── 10. Pot-math parity — side pot settles to the same numbers as settleShowdown ─
it("10) side-pot math: short all-in main pot + side pot settle correctly", () => {
  // P3 short all-in 300 → main pot 900 (P3 wins, AA). Side pot 3400 → P1 wins (KK>TT).
  const target = hand({
    hand_id: "h1",
    hand_number: 1,
    players: [P("P1", 1, 2000, 0, false), P("P2", 2, 2000, 0, true), P("P3", 3, 300, 0, true)],
    actions: [
      A("P1", "post_sb", 50, 1),
      A("P2", "post_bb", 100, 2),
      A("P3", "all_in", 300, 3),
      A("P1", "all_in", 1950, 4),
      A("P2", "all_in", 1900, 5),
    ],
  });
  const plan = planEditedHandSettlement(
    target,
    { board: BOARD5, holeCardsBySeat: { P1: ["Kd", "Kh"], P2: ["Td", "Th"], P3: ["As", "Ac"] } },
    reduceHand,
  );
  expect(plan.ok).toBe(true);
  expect(plan.endings.get("P3")).toBe(900);
  expect(plan.endings.get("P1")).toBe(3400);
  expect(plan.endings.get("P2")).toBe(0);
  // Chip conservation across the whole hand (2000 + 2000 + 300).
  const total = [...plan.endings.values()].reduce((s, v) => s + v, 0);
  expect(total).toBe(4300);
});
