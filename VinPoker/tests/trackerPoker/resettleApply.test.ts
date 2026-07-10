// Đợt G3 — pins the pure glue between the completed-hand editor and the
// apply_resettle_forward RPC: snapshot/entry mapping, the exact RPC arg object, and an
// end-to-end run of the G1 engine with the CLIENT reduceHand injected.
import { describe, it, expect } from "vitest";
import {
  buildApplyResettleArgs,
  buildEditedTarget,
  buildResettleSnapshots,
  contenders,
  manualWinnerUnsafe,
  reentryPlayers,
  resettleChipChanges,
  runClientResettle,
  type ResettleHandRow,
} from "@/components/cashier/tournament-live/resettleApply";
import type { ResettleOk } from "@/lib/tracker-poker/resettleForward";

const BOARD5 = ["2c", "3d", "7h", "9s", "Jc"];

const rp = (
  player_id: string,
  seat_number: number,
  starting_stack: number,
  ending_stack: number,
  is_eliminated = false,
  entry_number = 1,
) => ({ player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated });

const ra = (player_id: string, action_type: string, action_amount: number, action_order: number, street = "preflop") => ({
  player_id,
  street,
  action_type,
  action_amount,
  action_order,
});

const row = (o: Partial<ResettleHandRow> & Pick<ResettleHandRow, "id" | "hand_number" | "players" | "actions">): ResettleHandRow => ({
  id: o.id,
  hand_number: o.hand_number,
  table_id: o.table_id ?? "T1",
  button_seat: o.button_seat ?? 1,
  created_at: o.created_at ?? "2026-01-01T00:00:00Z",
  players: o.players,
  actions: o.actions,
});

// Winner flips P2→P1, both keep >0, and one safe later hand re-settles forward.
const target = row({
  id: "h1",
  hand_number: 1,
  players: [rp("P1", 1, 1000, 900), rp("P2", 2, 1000, 1100)],
  actions: [ra("P1", "post_sb", 50, 1), ra("P2", "post_bb", 100, 2), ra("P1", "call", 50, 3), ra("P2", "check", 0, 4)],
});
const h2 = row({
  id: "h2",
  hand_number: 2,
  created_at: "2026-01-01T00:05:00Z",
  players: [rp("P1", 1, 900, 1000), rp("P2", 2, 1100, 1000)],
  actions: [ra("P1", "post_sb", 50, 1), ra("P2", "post_bb", 100, 2), ra("P1", "call", 50, 3), ra("P2", "check", 0, 4)],
});
const editedTarget = buildEditedTarget({
  board: BOARD5,
  holeCardsByPlayer: { P1: ["As", "Ac"], P2: ["Kd", "Kh"] },
  actions: target.actions,
});

describe("buildResettleSnapshots", () => {
  it("orders target-first and builds entry lookups", () => {
    const { snapshots, entryByPlayer, entryByHandPlayer } = buildResettleSnapshots(target, [h2]);
    expect(snapshots.map((s) => s.hand_id)).toEqual(["h1", "h2"]);
    expect(snapshots[0].winner_player_ids).toEqual([]); // unused by engine math
    expect(entryByPlayer.get("P1")).toBe(1);
    expect(entryByHandPlayer.get("h2:P2")).toBe(1);
  });

  it("keeps a non-1 entry_number and lets the target's entry win per player", () => {
    const t = row({ id: "h1", hand_number: 1, players: [rp("P1", 1, 1000, 900, false, 2)], actions: [] });
    const l = row({ id: "h2", hand_number: 2, players: [rp("P1", 1, 900, 1000, false, 2)], actions: [] });
    const { entryByPlayer, entryByHandPlayer } = buildResettleSnapshots(t, [l]);
    expect(entryByPlayer.get("P1")).toBe(2);
    expect(entryByHandPlayer.get("h1:P1")).toBe(2);
    expect(entryByHandPlayer.get("h2:P1")).toBe(2);
  });
});

describe("runClientResettle (engine with client reduceHand injected)", () => {
  it("re-settles a safe winner flip forward through the later hand", () => {
    const { result } = runClientResettle({ target, later: [h2], editedTarget });
    expect(result.ok).toBe(true);
    const ok = result as ResettleOk;
    expect(ok.targetWinnerIds).toEqual(["P1"]);
    expect(ok.finalStacks.find((s) => s.player_id === "P1")?.chip_count).toBe(1200);
    expect(ok.finalStacks.find((s) => s.player_id === "P2")?.chip_count).toBe(800);
    expect(new Set(ok.changedPlayerIds)).toEqual(new Set(["P1", "P2"]));
  });

  it("passes an engine BLOCK straight through (no throw, not ok)", () => {
    // Later hand all-in cap depends on the edited stack → engine blocks all_in_cap_changed.
    const t = row({
      id: "h1",
      hand_number: 1,
      players: [rp("P1", 1, 2000, 1000), rp("P2", 2, 2000, 3000)],
      actions: [ra("P1", "post_sb", 50, 1), ra("P2", "post_bb", 100, 2), ra("P1", "raise", 950, 3), ra("P2", "call", 900, 4)],
    });
    const l = row({
      id: "h2",
      hand_number: 2,
      players: [rp("P2", 2, 3000, 4000), rp("P3", 3, 1000, 0, true)],
      actions: [ra("P2", "all_in", 3000, 1), ra("P3", "call", 3000, 2)],
    });
    const { result } = runClientResettle({
      target: t,
      later: [l],
      editedTarget: buildEditedTarget({ board: BOARD5, holeCardsByPlayer: { P1: ["As", "Ac"], P2: ["Kd", "Kh"] }, actions: t.actions }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected block");
    expect(result.reason).toBe("all_in_cap_changed");
    expect(result.safeToWrite).toBe(false);
  });
});

describe("buildApplyResettleArgs", () => {
  const { result, entryByPlayer, entryByHandPlayer } = runClientResettle({ target, later: [h2], editedTarget });
  const ok = result as ResettleOk;
  const args = buildApplyResettleArgs({
    tournamentId: "TOURN",
    targetHandId: "h1",
    reason: "nhập nhầm người thắng",
    result: ok,
    entryByPlayer,
    entryByHandPlayer,
  });

  it("emits the exact RPC arg object with entry_number attached", () => {
    expect(args.p_tournament_id).toBe("TOURN");
    expect(args.p_target_hand_id).toBe("h1");
    expect(args.p_reason).toBe("nhập nhầm người thắng");
    expect(args.p_target_winner_ids).toEqual(["P1"]);
    // final stacks: changed players only, each with entry_number + baseline (expected_current).
    expect(args.p_final_stacks).toEqual(
      expect.arrayContaining([
        { player_id: "P1", entry_number: 1, chip_count: 1200, expected_current: 1000 },
        { player_id: "P2", entry_number: 1, chip_count: 800, expected_current: 1000 },
      ]),
    );
    expect(args.p_final_stacks).toHaveLength(2);
  });

  it("final stacks are conserved (chip re-attribution, sum unchanged)", () => {
    const sumNew = args.p_final_stacks.reduce((s, f) => s + f.chip_count, 0);
    expect(sumNew).toBe(2000); // == current P1 1000 + P2 1000
  });

  it("hand_changes carry only rows that actually changed, each keyed by hand+entry", () => {
    // target: P1 900→1100, P2 1100→900 ; h2: P1 1000→1200, P2 1000→800 → 4 changed rows.
    expect(args.p_hand_changes).toHaveLength(4);
    expect(args.p_hand_changes).toEqual(
      expect.arrayContaining([
        // target: starting unchanged; later hand h2: new starting = corrected incoming.
        { hand_id: "h1", player_id: "P1", entry_number: 1, ending_stack: 1100, starting_stack: 1000 },
        { hand_id: "h2", player_id: "P2", entry_number: 1, ending_stack: 800, starting_stack: 900 },
      ]),
    );
    for (const c of args.p_hand_changes) expect(c.entry_number).toBe(1);
  });

  it("server-guard fields present: expected_current baseline + later-hand starting_stack", () => {
    for (const f of args.p_final_stacks) expect(typeof f.expected_current).toBe("number");
    for (const c of args.p_hand_changes) expect(typeof c.starting_stack).toBe("number");
    // A later hand (h2) whose incoming changed must carry the NEW starting stack.
    const h2p1 = args.p_hand_changes.find((c) => c.hand_id === "h2" && c.player_id === "P1");
    expect(h2p1?.starting_stack).toBe(1100);
  });
});

describe("resettleChipChanges", () => {
  it("shows current→new per changed player (last recorded ending → resettled final)", () => {
    const { result } = runClientResettle({ target, later: [h2], editedTarget });
    const changes = resettleChipChanges(result as ResettleOk);
    expect(changes).toEqual(
      expect.arrayContaining([
        { player_id: "P1", before: 1000, after: 1200, delta: 200 },
        { player_id: "P2", before: 1000, after: 800, delta: -200 },
      ]),
    );
  });
});

describe("contenders", () => {
  it("lists non-folded players in seat order", () => {
    const players = [
      { player_id: "P3", seat_number: 3 },
      { player_id: "P1", seat_number: 1 },
      { player_id: "P2", seat_number: 2 },
    ];
    const actions = [{ player_id: "P2", action_type: "fold" }];
    expect(contenders(players, actions)).toEqual(["P1", "P3"]);
  });
});

describe("reentryPlayers + re-entry guard (finding [4])", () => {
  it("flags a player_id that spans two entry_numbers across the chain", () => {
    const t = row({ id: "h1", hand_number: 1, players: [rp("P1", 1, 1000, 900, false, 1), rp("P2", 2, 1000, 1100)], actions: [] });
    const l = row({ id: "h2", hand_number: 2, players: [rp("P1", 1, 900, 1000, false, 2)], actions: [] });
    expect(reentryPlayers(t, [l])).toEqual(["P1"]);
    expect(reentryPlayers(t, [])).toEqual([]);
  });

  it("runClientResettle refuses a re-entry chain with reason reentry_boundary (no engine run)", () => {
    const t = row({
      id: "h1",
      hand_number: 1,
      players: [rp("P1", 1, 1000, 900, false, 1), rp("P2", 2, 1000, 1100)],
      actions: [ra("P1", "post_sb", 50, 1), ra("P2", "post_bb", 100, 2), ra("P1", "call", 50, 3), ra("P2", "check", 0, 4)],
    });
    const l = row({
      id: "h2",
      hand_number: 2,
      players: [rp("P1", 1, 900, 1000, false, 2), rp("P2", 2, 1100, 1000)],
      actions: [ra("P1", "post_sb", 50, 1), ra("P2", "post_bb", 100, 2), ra("P1", "call", 50, 3), ra("P2", "check", 0, 4)],
    });
    const et = buildEditedTarget({ board: BOARD5, holeCardsByPlayer: { P1: ["As", "Ac"], P2: ["Kd", "Kh"] }, actions: t.actions });
    const { result } = runClientResettle({ target: t, later: [l], editedTarget: et });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected block");
    expect(result.reason).toBe("reentry_boundary");
    expect(result.affected_player_ids).toContain("P1");
  });
});

describe("manualWinnerUnsafe (finding [10]/[3] side-pot guard)", () => {
  it("true when a contender is all-in for less than the top commitment (side pot)", () => {
    const t = row({
      id: "h1",
      hand_number: 1,
      players: [rp("P1", 1, 2000, 0), rp("P2", 2, 2000, 0), rp("P3", 3, 300, 0)],
      actions: [
        ra("P1", "post_sb", 50, 1),
        ra("P2", "post_bb", 100, 2),
        ra("P3", "all_in", 300, 3),
        ra("P1", "all_in", 1950, 4),
        ra("P2", "all_in", 1900, 5),
      ],
    });
    expect(manualWinnerUnsafe(t)).toBe(true);
  });

  it("false for a flat pot with no short all-in", () => {
    const t = row({
      id: "h1",
      hand_number: 1,
      players: [rp("P1", 1, 1000, 900), rp("P2", 2, 1000, 1100)],
      actions: [ra("P1", "post_sb", 50, 1), ra("P2", "post_bb", 100, 2), ra("P1", "call", 50, 3), ra("P2", "check", 0, 4)],
    });
    expect(manualWinnerUnsafe(t)).toBe(false);
  });
});

describe("manual-winner path", () => {
  const t = row({
    id: "h1",
    hand_number: 1,
    players: [rp("P1", 1, 1000, 900), rp("P2", 2, 1000, 1100)],
    actions: [ra("P1", "post_sb", 50, 1), ra("P2", "post_bb", 100, 2), ra("P1", "call", 50, 3), ra("P2", "check", 0, 4)],
  });

  it("incomplete board + no winner → blocks needs_manual_winner (picker trigger)", () => {
    const et = buildEditedTarget({ board: ["2c", "3d", "7h"], holeCardsByPlayer: {}, actions: t.actions });
    const { result } = runClientResettle({ target: t, later: [], editedTarget: et });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected block");
    expect(result.reason).toBe("needs_manual_winner");
  });

  it("re-run with manualWinnerIds → resettles to the picked winner", () => {
    const et = buildEditedTarget({ board: ["2c", "3d", "7h"], holeCardsByPlayer: {}, actions: t.actions, manualWinnerIds: ["P1"] });
    const { result } = runClientResettle({ target: t, later: [], editedTarget: et });
    expect(result.ok).toBe(true);
    const ok = result as ResettleOk;
    expect(ok.targetWinnerIds).toEqual(["P1"]);
    expect(ok.finalStacks.find((s) => s.player_id === "P1")?.chip_count).toBe(1100);
    expect(ok.finalStacks.find((s) => s.player_id === "P2")?.chip_count).toBe(900);
  });
});
