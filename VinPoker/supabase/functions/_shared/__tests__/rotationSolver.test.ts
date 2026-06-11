// Deterministic pure-function tests for solveRotationPlan (Forward Rotation Scheduler).
// HARD GATE: all cases must be green before any DB/edge integration goes live.
// Run: deno test supabase/functions/_shared/__tests__/rotationSolver.test.ts

import { solveRotationPlan } from "../rotationSolver.ts";
import type {
  RotationPlanCandidate,
  RotationPlanOptions,
  RotationPlanTable,
} from "../rotationTypes.ts";

const MIN = 60_000;
const NOW = 1_750_000_000_000; // fixed epoch — the solver never reads Date.now()

const OPTS: RotationPlanOptions = {
  nowMs: NOW,
  announceLeadMs: 3 * MIN,
  preAnnounceMs: 6 * MIN,
  restMs: 10 * MIN,
  forecastSlots: 0,
  solverVersion: "rotation-v1-test",
};

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`ASSERT FAILED: ${msg} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

function mkTable(p: Partial<RotationPlanTable> & { tableId: string }): RotationPlanTable {
  return {
    tableName: p.tableId,
    assignmentId: `asg-${p.tableId}`,
    outAttendanceId: `out-${p.tableId}`,
    outDealerName: `Out ${p.tableId}`,
    assignedAtMs: NOW - 30 * MIN,
    swingDueAtMs: NOW,
    swingDurationMs: 30 * MIN,
    requiredTier: null,
    tournamentId: null,
    tournamentName: null,
    gameTypes: [],
    ...p,
  };
}

function mkDealer(p: Partial<RotationPlanCandidate> & { attendanceId: string }): RotationPlanCandidate {
  return {
    dealerId: `dlr-${p.attendanceId}`,
    fullName: `Dealer ${p.attendanceId}`,
    tier: "B",
    skills: [],
    prevSessionMinutes: 0,
    eligibleAtMs: NOW - 20 * MIN, // fully rested by default
    score: 0,
    ...p,
  };
}

Deno.test("1. 3 OT tables + 2 rested dealers → 2 longest-dealt CHỐT at now+3m, third honest shortage", () => {
  const tables = [
    mkTable({ tableId: "T3", assignedAtMs: NOW - 40 * MIN, swingDueAtMs: NOW - 5 * MIN }),
    mkTable({ tableId: "T1", assignedAtMs: NOW - 80 * MIN, swingDueAtMs: NOW - 13 * MIN }),
    mkTable({ tableId: "T2", assignedAtMs: NOW - 70 * MIN, swingDueAtMs: NOW - 8 * MIN }),
  ];
  const dealers = [mkDealer({ attendanceId: "d1" }), mkDealer({ attendanceId: "d2" })];

  const plan = solveRotationPlan(tables, dealers, OPTS);
  const bySlot0 = new Map(plan.rows.filter((r) => r.slotIndex === 0).map((r) => [r.tableId, r]));

  const t1 = bySlot0.get("T1")!;
  const t2 = bySlot0.get("T2")!;
  const t3 = bySlot0.get("T3")!;

  // R4: longest-dealt tables relieved first, at the 3-min emergency lead.
  assert(t1.inAttendanceId !== null, "T1 (longest dealt) must get a dealer");
  assert(t2.inAttendanceId !== null, "T2 (second longest) must get a dealer");
  assertEq(t1.plannedReliefAtMs, NOW + 3 * MIN, "T1 relief = now+3m");
  assertEq(t2.plannedReliefAtMs, NOW + 3 * MIN, "T2 relief = now+3m");
  assert(t1.isEmergency && t2.isEmergency, "overdue tables are emergency");

  // Shortage table: honest future relief = first out-dealer back from rest (+3m+10m+3m).
  assertEq(t3.inAttendanceId, null, "T3 has no dealer yet");
  assertEq(t3.isShortage, true, "T3 is shortage");
  assertEq(t3.plannedReliefAtMs, NOW + 16 * MIN, "T3 honest relief = now+3m relief +10m rest +3m announce");
});

Deno.test("2. dealer released 5 min ago → entry only after full rest (release+13m), never early despite OT", () => {
  const tables = [mkTable({ tableId: "T1", swingDueAtMs: NOW - 10 * MIN })]; // overdue 10m
  // Released 5 min ago → eligibleAt = release + 10m = now + 5m.
  const dealers = [mkDealer({ attendanceId: "d1", eligibleAtMs: NOW + 5 * MIN })];

  const plan = solveRotationPlan(tables, dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;

  // entry = eligibleAt + 3m announce = now+8m → release-to-entry = 13m total (R2).
  assertEq(row.inAttendanceId, "d1", "dealer is planned (honestly, in the future)");
  assertEq(row.plannedReliefAtMs, NOW + 8 * MIN, "relief = eligibleAt + 3m, NOT now+3m");
  assertEq(row.isShortage, true, "later than ideal → flagged shortage");
});

Deno.test("3. rested dealer, table due in 1m → planned relief still >= now+3m (announce lead enforced)", () => {
  const tables = [mkTable({ tableId: "T1", swingDueAtMs: NOW + 1 * MIN })];
  const dealers = [mkDealer({ attendanceId: "d1", eligibleAtMs: NOW - 2 * MIN })];

  const plan = solveRotationPlan(tables, dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;

  assert(row.plannedReliefAtMs >= NOW + 3 * MIN, "relief >= now+3m");
  assert(row.announceAtMs !== null, "announce scheduled");
  assert(
    row.plannedReliefAtMs - (row.announceAtMs as number) >= 3 * MIN,
    "announce→entry gap >= 3 min"
  );
  assertEq(row.isEmergency, false, "due in future → not emergency");
});

Deno.test("4. prev sessions 20/35/50 → shortest previous session called first (R3)", () => {
  const tables = [mkTable({ tableId: "T1", swingDueAtMs: NOW - 1 * MIN })];
  const dealers = [
    mkDealer({ attendanceId: "d50", prevSessionMinutes: 50 }),
    mkDealer({ attendanceId: "d20", prevSessionMinutes: 20 }),
    mkDealer({ attendanceId: "d35", prevSessionMinutes: 35 }),
  ];

  const plan = solveRotationPlan(tables, dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;
  assertEq(row.inAttendanceId, "d20", "20-min dealer wins");
});

Deno.test("5. high buy-in table prefers tier A; without A, B/C still staff it (flagged unmatched)", () => {
  const tableA = [mkTable({ tableId: "TH", swingDueAtMs: NOW - 1 * MIN, requiredTier: "A" })];

  // A available (longer prev session) vs C (shorter): tier fit outranks fairness on tiered tables.
  const withA = solveRotationPlan(
    tableA,
    [
      mkDealer({ attendanceId: "dA", tier: "A", prevSessionMinutes: 35 }),
      mkDealer({ attendanceId: "dC", tier: "C", prevSessionMinutes: 10 }),
    ],
    OPTS
  );
  const rowA = withA.rows.find((r) => r.tableId === "TH" && r.slotIndex === 0)!;
  assertEq(rowA.inAttendanceId, "dA", "tier A preferred on >10M table");
  assertEq(rowA.tierMatched, true, "tier matched");

  // No A in pool → closest tier still staffs the table (shortage flexibility).
  const withoutA = solveRotationPlan(
    tableA,
    [
      mkDealer({ attendanceId: "dB", tier: "B", prevSessionMinutes: 40 }),
      mkDealer({ attendanceId: "dC", tier: "C", prevSessionMinutes: 5 }),
    ],
    OPTS
  );
  const rowB = withoutA.rows.find((r) => r.tableId === "TH" && r.slotIndex === 0)!;
  assertEq(rowB.inAttendanceId, "dB", "B (adjacent) beats C (distant) when no A");
  assertEq(rowB.tierMatched, false, "flagged as tier-unmatched (penalty visible)");
});

Deno.test("6. no-show locked dealer excluded → replacement planned, swing_due_at input untouched", () => {
  const table = mkTable({ tableId: "T1", swingDueAtMs: NOW - 4 * MIN });
  const originalDue = table.swingDueAtMs;
  // Caller excluded the no-show dealer from candidates (planner re-plan after no_show).
  const dealers = [mkDealer({ attendanceId: "replacement", prevSessionMinutes: 15 })];

  const plan = solveRotationPlan([table], dealers, OPTS);
  const row = plan.rows.find((r) => r.tableId === "T1" && r.slotIndex === 0)!;

  assertEq(row.inAttendanceId, "replacement", "replacement locked in");
  assertEq(row.plannedReliefAtMs, NOW + 3 * MIN, "replacement at emergency 3-min lead");
  assertEq(table.swingDueAtMs, originalDue, "solver never mutates swing_due_at");
});

Deno.test("7. sticky CHỐT: locked table is skipped for slot 0 and its dealer is consumed from the pool", () => {
  const tables = [
    mkTable({
      tableId: "TL",
      swingDueAtMs: NOW + 2 * MIN,
      lockedInAttendanceId: "dLocked",
      lockedPlannedReliefAtMs: NOW + 5 * MIN,
    }),
    mkTable({ tableId: "T2", swingDueAtMs: NOW - 1 * MIN }),
  ];
  const dealers = [
    mkDealer({ attendanceId: "dLocked" }),
    mkDealer({ attendanceId: "dFree", prevSessionMinutes: 25 }),
  ];

  const plan = solveRotationPlan(tables, dealers, OPTS);
  const slot0 = plan.rows.filter((r) => r.slotIndex === 0);

  assert(!slot0.some((r) => r.tableId === "TL"), "locked table gets no new slot-0 row");
  assert(plan.lockedTableIds.includes("TL"), "locked table reported");
  const t2 = slot0.find((r) => r.tableId === "T2")!;
  assertEq(t2.inAttendanceId, "dFree", "locked dealer not reused for another table");
});

Deno.test("8. forecast slots are emitted and never carry an assignmentId (predicted-never-locks contract)", () => {
  const tables = [mkTable({ tableId: "T1", swingDueAtMs: NOW + 5 * MIN })];
  const dealers = [
    mkDealer({ attendanceId: "d1", prevSessionMinutes: 10 }),
    mkDealer({ attendanceId: "d2", prevSessionMinutes: 20 }),
  ];

  const plan = solveRotationPlan(tables, dealers, { ...OPTS, forecastSlots: 2 });
  const slots = plan.rows.filter((r) => r.tableId === "T1").map((r) => r.slotIndex).sort();
  assertEq(JSON.stringify(slots), JSON.stringify([0, 1, 2]), "slots 0..2 emitted");
  for (const r of plan.rows.filter((x) => x.slotIndex > 0)) {
    assertEq(r.assignmentId, null, `forecast slot ${r.slotIndex} carries no assignmentId`);
  }
});
