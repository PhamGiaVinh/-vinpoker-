// C2 (trackerStreetRollback) — pure decision module. Owner-mandated pins:
//  1. Resumed hand + street HAS persisted actions → BLOCKED with the exact message
//     (undoStack can't mirror the deletes after a reload).
//  2. Resumed hand + NO street actions → shrink-only allowed (deletes = 0).
//  3. No board shrink is ever issued before every required delete: the step machine
//     the hook effect executes emits exactly N "delete" steps strictly before the
//     single "shrink" — proven by simulating the machine below.
import { describe, it, expect } from "vitest";
import {
  ROLLBACK_CLEAR_FROM,
  ROLLBACK_KEEP_COUNT,
  ROLLBACK_RESUMED_BLOCK_MSG,
  nextRollbackStep,
  planStreetRollback,
  rollbackTargetFrom,
  type StreetRollbackPlanInput,
  type StreetRollbackState,
} from "@/components/cashier/tournament-live/handinput/streetRollback";

const a = (street: string) => ({ street });

const base: StreetRollbackPlanInput = {
  persistedBoardCount: 3,
  actions: [a("preflop"), a("preflop"), a("flop"), a("flop")],
  undoStackLength: 4,
  isReadOnly: false,
  submitting: false,
  chainRunning: false,
  isRunout: false,
  currentStreet: "flop",
  isSummary: false,
  handId: "hand-1",
};

describe("rollbackTargetFrom (D1 — target derives from the PERSISTED board)", () => {
  it("maps 5→river, 4→turn, 3→flop, else null", () => {
    expect(rollbackTargetFrom(5)).toBe("river");
    expect(rollbackTargetFrom(4)).toBe("turn");
    expect(rollbackTargetFrom(3)).toBe("flop");
    expect(rollbackTargetFrom(2)).toBeNull();
    expect(rollbackTargetFrom(0)).toBeNull();
  });
});

describe("keep/clear constants (D3)", () => {
  it("keep = the board BELOW the street; clear = the street's own slots and above", () => {
    expect(ROLLBACK_KEEP_COUNT).toEqual({ flop: 0, turn: 3, river: 4 });
    expect(ROLLBACK_CLEAR_FROM).toEqual({ flop: 3, turn: 4, river: 5 });
  });
});

describe("planStreetRollback", () => {
  it("no rollback target (board still preflop) → null", () => {
    expect(planStreetRollback({ ...base, persistedBoardCount: 0 })).toBeNull();
  });

  it("happy path: counts ONLY the target street's actions", () => {
    expect(planStreetRollback(base)).toEqual({ street: "flop", deletes: 2 });
    // river rollback ignores earlier streets' actions
    expect(
      planStreetRollback({
        ...base,
        persistedBoardCount: 5,
        currentStreet: "river",
        actions: [a("preflop"), a("flop"), a("turn"), a("river")],
      }),
    ).toEqual({ street: "river", deletes: 1 });
  });

  it("blocked contexts (D6): no handId / readOnly / submitting / chain / summary / showdown / runout", () => {
    const cases: Array<[Partial<StreetRollbackPlanInput>, RegExp]> = [
      [{ handId: null }, /chưa được ghi/i],
      [{ isReadOnly: true }, /hết hạn/],
      [{ submitting: true }, /Đang gửi/],
      [{ chainRunning: true }, /Đang gửi/],
      [{ isSummary: true }, /tổng kết/],
      [{ currentStreet: "showdown" }, /showdown/],
      [{ isRunout: true }, /all-in/],
    ];
    for (const [patch, re] of cases) {
      const plan = planStreetRollback({ ...base, ...patch });
      expect(plan && "blocked" in plan, JSON.stringify(patch)).toBe(true);
      expect((plan as { blocked: string }).blocked).toMatch(re);
    }
  });

  it("OWNER P0 #1 — resumed hand + street HAS actions → blocked with the exact message", () => {
    const plan = planStreetRollback({ ...base, undoStackLength: 0 });
    expect(plan).toEqual({ blocked: ROLLBACK_RESUMED_BLOCK_MSG });
    expect(ROLLBACK_RESUMED_BLOCK_MSG).toBe(
      "Không thể hoàn tác cả vòng sau khi tải lại ván. Hãy hoàn tác từng hành động hoặc void hand.",
    );
  });

  it("OWNER P0 #2 — resumed hand + NO street actions → shrink-only allowed", () => {
    const plan = planStreetRollback({
      ...base,
      undoStackLength: 0,
      actions: [a("preflop"), a("preflop")], // street sent, nobody acted yet
    });
    expect(plan).toEqual({ street: "flop", deletes: 0 });
  });

  it("partial coverage (resume + new actions) is still blocked", () => {
    // 2 old flop actions replayed from the server + 1 new one → stack only covers 1.
    const plan = planStreetRollback({
      ...base,
      actions: [a("preflop"), a("flop"), a("flop"), a("flop")],
      undoStackLength: 1,
    });
    expect(plan).toEqual({ blocked: ROLLBACK_RESUMED_BLOCK_MSG });
  });
});

describe("nextRollbackStep machine (OWNER P0 #3 — no shrink before every delete)", () => {
  /** Simulate the machine exactly as the hook effect consumes it. */
  function runMachine(street: StreetRollbackState["street"], deletes: number): string[] {
    const steps: string[] = [];
    let s: StreetRollbackState | null = {
      street,
      phase: deletes === 0 ? "shrinking" : "deleting",
      deletesRemaining: deletes,
      total: deletes,
    };
    while (s) {
      const step = nextRollbackStep(s);
      steps.push(step.kind);
      if (step.kind === "delete") s = { ...s, deletesRemaining: s.deletesRemaining - 1 };
      else if (step.kind === "transition_to_shrink") s = { ...s, phase: "shrinking" };
      else s = null; // shrink is terminal
    }
    return steps;
  }

  it("N=3: exactly 3 deletes, then the transition, then ONE shrink — in that order", () => {
    expect(runMachine("turn", 3)).toEqual([
      "delete",
      "delete",
      "delete",
      "transition_to_shrink",
      "shrink",
    ]);
  });

  it("N=0 (shrink-only): the machine starts at shrink, no deletes", () => {
    expect(runMachine("flop", 0)).toEqual(["shrink"]);
  });

  it("a shrink step is unreachable while any delete remains", () => {
    for (let remaining = 1; remaining <= 5; remaining++) {
      const step = nextRollbackStep({
        street: "river",
        phase: "deleting",
        deletesRemaining: remaining,
        total: 5,
      });
      expect(step.kind).toBe("delete");
    }
  });

  it("shrink carries the street's keep/clear geometry (D3)", () => {
    expect(
      nextRollbackStep({ street: "turn", phase: "shrinking", deletesRemaining: 0, total: 2 }),
    ).toEqual({ kind: "shrink", keepCount: 3, clearFrom: 4 });
    expect(
      nextRollbackStep({ street: "flop", phase: "shrinking", deletesRemaining: 0, total: 0 }),
    ).toEqual({ kind: "shrink", keepCount: 0, clearFrom: 3 });
  });
});
