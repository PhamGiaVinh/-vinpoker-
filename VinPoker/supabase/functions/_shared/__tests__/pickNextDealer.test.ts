// Synthetic harness for buildDealerCandidates (A2). Deterministic — mocks the
// admin client so we can assert the hard/soft boundary without a live DB. This is
// the "mode 2" harness from the A0a preflight.
//
// A2 invariant under test: priority_break_flag is a PURE HARD GATE.
//   • under-rested flagged dealer  → excluded (diag.priority_break_excluded++)
//   • rested flagged dealer        → competes with NO residual penalty (no -500)
//   • non-flagged dealers          → unchanged scoring
//   • diag + ScoreBreakdown shape  → preserved for C1
//
// Run: deno test supabase/functions/_shared/__tests__/pickNextDealer.test.ts
import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { buildDealerCandidates } from "../pickNextDealer.ts";

type Row = Record<string, unknown>;

// ── Table-routed mock of the Supabase admin client ──────────────────────────
// from(table) → a thenable query builder that records its ops. The router returns
// fixtures by table: `dealers` → ids, `dealer_attendance` WITH `.or(` → the pool
// rows (every other dealer_attendance query — busy/restGuard/poolCooldown — has no
// `.or` → []), `dealer_shift_metrics` → metrics. Everything else (assignments,
// breaks, meal breaks) → [] so dealers flow straight to scoring.
function makeAdmin(fix: { dealerIds: string[]; poolRows: Row[]; metricsRows: Row[] }) {
  const CHAIN_METHODS = [
    "select", "eq", "in", "is", "or", "not", "gt", "gte", "lt", "lte", "neq", "order", "limit",
  ];
  function builder(table: string) {
    const ops: { method: string; args: unknown[] }[] = [];
    const resolve = (): { data: unknown; error: null } => {
      if (table === "dealers") {
        return { data: fix.dealerIds.map((id) => ({ id })), error: null };
      }
      if (table === "dealer_attendance") {
        // Only the candidate-pool query uses `.or(available/on_break)`.
        if (ops.some((o) => o.method === "or")) return { data: fix.poolRows, error: null };
        return { data: [], error: null }; // busy / restGuard / poolCooldown → empty
      }
      if (table === "dealer_shift_metrics") return { data: fix.metricsRows, error: null };
      return { data: [], error: null }; // dealer_assignments / dealer_breaks / dealer_meal_breaks
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {};
    for (const m of CHAIN_METHODS) {
      chain[m] = (...args: unknown[]) => { ops.push({ method: m, args }); return chain; };
    }
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    // deno-lint-ignore no-explicit-any
    chain.then = (onF: (v: any) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onF, onR);
    return chain;
  }
  return { from: (table: string) => builder(table) };
}

// ── Fixture builders ────────────────────────────────────────────────────────
function poolRow(id: string, dealerId: string, opts: { priorityBreak?: boolean; tier?: "A" | "B" | "C" } = {}): Row {
  return {
    id,
    dealer_id: dealerId,
    current_state: "available",
    status: "checked_in",
    worked_minutes_since_last_break: 0,
    priority_break_flag: opts.priorityBreak ?? false,
    last_released_at: null,
    check_in_time: "2026-06-18T00:00:00Z",
    dealers: {
      full_name: dealerId.toUpperCase(),
      telegram_username: null,
      telegram_user_id: null,
      tier: opts.tier ?? "C",
      skills: [],
    },
  };
}
function metric(attendanceId: string, minutesSinceRest: number): Row {
  return {
    attendance_id: attendanceId,
    minutes_since_rest: minutesSinceRest,
    total_assignments: 0,
    total_break_minutes: 0,
    total_worked_minutes: 0, // keeps avgBreakRatio null → no break-equity noise
  };
}

// restThreshold default = defaultClubBreakDurationMinutes(20) + buffer(5) = 25.
// Expected baseline score for an available tier-C dealer, no tourTier, restMin≥20:
//   rest_bonus(+200, restMin≥20) + tier_bonus(+20, LOW-branch tier C) = 220.
const EXPECTED_BASELINE_SCORE = 220;

Deno.test("baseline: a normal rested tier-C dealer scores exactly 220 (mock fidelity check)", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
  });
  const { candidates } = await buildDealerCandidates(admin, "club", { includeScoreBreakdown: true });
  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].score, EXPECTED_BASELINE_SCORE);
});

Deno.test("A2: under-rested priority-break dealer is EXCLUDED by the hard gate", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1", { priorityBreak: true })],
    metricsRows: [metric("a1", 10)], // 10 < 25 threshold → excluded
  });
  const { candidates, diag } = await buildDealerCandidates(admin, "club", {});
  assertEquals(candidates.length, 0);
  assertExists(diag);
  assertEquals(diag!.priority_break_excluded, 1);
});

Deno.test("A2: rested priority-break dealer competes with NO -500 penalty", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1", { priorityBreak: true })],
    metricsRows: [metric("a1", 30)], // 30 ≥ 25 → passes the hard gate
  });
  const { candidates, diag } = await buildDealerCandidates(admin, "club", { includeScoreBreakdown: true });
  assertEquals(candidates.length, 1);
  assertEquals(diag!.priority_break_excluded, 0);
  // No residual soft penalty: field is 0 and score equals the normal baseline.
  assertEquals(candidates[0].score_breakdown!.priority_break_penalty, 0);
  assertEquals(candidates[0].score, EXPECTED_BASELINE_SCORE);
});

Deno.test("A2: rested flagged dealer and identical normal dealer get EQUAL score", async () => {
  const admin = makeAdmin({
    dealerIds: ["dp", "dn"],
    poolRows: [
      poolRow("ap", "dp", { priorityBreak: true }),
      poolRow("an", "dn", { priorityBreak: false }),
    ],
    metricsRows: [metric("ap", 30), metric("an", 30)],
  });
  const { candidates } = await buildDealerCandidates(admin, "club", { includeScoreBreakdown: true });
  assertEquals(candidates.length, 2);
  const flagged = candidates.find((c) => c.dealer_id === "dp")!;
  const normal = candidates.find((c) => c.dealer_id === "dn")!;
  assertExists(flagged);
  assertExists(normal);
  assertEquals(flagged.score, normal.score); // proves no residual penalty
  assertEquals(flagged.score_breakdown!.priority_break_penalty, 0);
});

Deno.test("C1 compatibility: diag returned + ScoreBreakdown shape intact", async () => {
  const admin = makeAdmin({
    dealerIds: ["d1"],
    poolRows: [poolRow("a1", "d1")],
    metricsRows: [metric("a1", 30)],
  });
  const { candidates, diag } = await buildDealerCandidates(admin, "club", { includeScoreBreakdown: true });
  // diag still returned with the reject counters C1 renders.
  assertExists(diag);
  for (const k of ["priority_break_excluded", "busy_excluded", "min_rest_excluded", "candidates_count"]) {
    assertEquals(typeof (diag as unknown as Record<string, number>)[k], "number");
  }
  // ScoreBreakdown shape unchanged (priority_break_penalty field still present = 0).
  const bd = candidates[0].score_breakdown!;
  for (const k of [
    "rest_bonus", "tier_bonus", "back_to_back_penalty", "consecutive_penalty", "mixed_bonus",
    "skill_bonus", "priority_break_penalty", "heavy_worker_penalty", "consecutive_high_penalty",
    "tier_back_to_back_penalty", "break_equity_penalty", "priority_swing_bonus", "fatigue_penalty",
  ]) {
    assertEquals(typeof (bd as unknown as Record<string, number>)[k], "number");
  }
  assertEquals(bd.priority_break_penalty, 0);
});
