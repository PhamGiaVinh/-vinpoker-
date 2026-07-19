import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fillOpenOperation,
  rankOpenOperationCandidates,
  type OpenOperationTable,
} from "../fillOpenOperation.ts";
import type { DealerCandidate } from "../pickNextDealer.ts";

function candidate(index: number, score = 100): DealerCandidate {
  const suffix = String(index).padStart(12, "0");
  return {
    id: `10000000-0000-4000-8000-${suffix}`,
    dealer_id: `20000000-0000-4000-8000-${suffix}`,
    full_name: `Dealer ${index}`,
    tier: index % 3 === 0 ? "A" : "B",
    skills: ["NLH"],
    worked_minutes_since_last_break: 0,
    consecutive_assignments: 0,
    rest_minutes: 60,
    priority_break_flag: false,
    current_state: "available",
    last_tour_tier: "LOW",
    score,
    score_breakdown: {
      rest_bonus: 100,
      tier_bonus: 0,
      back_to_back_penalty: 0,
      consecutive_penalty: 0,
      mixed_bonus: 0,
      skill_bonus: 0,
      priority_break_penalty: 0,
      heavy_worker_penalty: 0,
      consecutive_high_penalty: 0,
      tier_back_to_back_penalty: 0,
      break_equity_penalty: 0,
      priority_swing_bonus: 0,
      fatigue_penalty: 0,
    },
  };
}

Deno.test("rankOpenOperationCandidates applies pool exclusivity and UUID tie-break", () => {
  const table: OpenOperationTable = {
    id: "30000000-0000-4000-8000-000000000001",
    table_name: "Table 1",
    game_type: "NLH",
    tour_tier: "MEDIUM",
  };
  const first = candidate(1);
  const second = candidate(2);
  const pool = new Map([[table.id, new Set([first.dealer_id, second.dealer_id])]]);

  const ranked = rankOpenOperationCandidates(
    [second, first],
    table,
    pool,
    new Set(),
    new Set(),
  );
  assertEquals(ranked.map((item) => item.dealer_id), [first.dealer_id, second.dealer_id]);

  const normalTable = { ...table, id: "30000000-0000-4000-8000-000000000002" };
  const normalRanked = rankOpenOperationCandidates(
    [first, second],
    normalTable,
    pool,
    new Set([first.dealer_id]),
    new Set(),
  );
  assertEquals(normalRanked.map((item) => item.dealer_id), [second.dealer_id]);
});

async function exerciseBatch(total: number, candidateCount: number) {
  const operationId = "40000000-0000-4000-8000-000000000001";
  const clubId = "50000000-0000-4000-8000-000000000001";
  const candidates = Array.from(
    { length: candidateCount },
    (_, index) => candidate(index + 1, 100 - index),
  );
  const targets = Array.from({ length: total }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    const id = `30000000-0000-4000-8000-${suffix}`;
    return {
      table_id: id,
      target_state: "pending",
      game_tables: {
        id,
        table_name: `Table ${index + 1}`,
        game_type: "NLH",
        tour_tier: "MEDIUM",
      },
    };
  });

  let snapshotBuilds = 0;
  let snapshotAvailableOnly = false;
  let assignmentCalls = 0;
  let refreshCalls = 0;

  class Query {
    constructor(private table: string) {}
    select() { return this; }
    eq() { return this; }
    update() { return this; }
    async maybeSingle() {
      if (this.table === "dealer_open_operations") {
        return {
          data: {
            id: operationId,
            club_id: clubId,
            status: "waiting_for_dealer",
            requested_count: total,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
          error: null,
        };
      }
      return {
        data: {
          enabled: true,
          all_clubs_enabled: false,
          allowed_club_ids: [clubId],
        },
        error: null,
      };
    }
    async order() {
      return { data: targets, error: null };
    }
  }

  const admin = {
    from: (table: string) => new Query(table),
    rpc: async (name: string) => {
      if (name === "assign_dealer_to_table") {
        assignmentCalls++;
        return { data: { outcome: "ok" }, error: null };
      }
      refreshCalls++;
      return {
        data: refreshCalls > 1
          ? {
            requested: total,
            assigned: candidateCount,
            remaining: total - candidateCount,
            operation_status: candidateCount === total ? "completed" : "waiting_for_dealer",
          }
          : null,
        error: null,
      };
    },
  };

  const result = await fillOpenOperation(admin, operationId, {
    swingDueAt: new Date(Date.now() + 45 * 60_000).toISOString(),
    candidateBuilder: async (_admin, _clubId, options) => {
      snapshotBuilds++;
      snapshotAvailableOnly = options?.availableOnly === true;
      return { candidates, avgBreakRatio: null };
    },
    poolBuilder: async () => new Map(),
    reservedBuilder: async () => new Set(),
  });

  return { result, snapshotBuilds, snapshotAvailableOnly, assignmentCalls };
}

Deno.test("fillOpenOperation builds one eligibility snapshot for 30 tables", async () => {
  const { result, snapshotBuilds, snapshotAvailableOnly, assignmentCalls } = await exerciseBatch(30, 30);
  assertEquals(snapshotBuilds, 1);
  assertEquals(snapshotAvailableOnly, true);
  assertEquals(result.candidate_snapshot_builds, 1);
  assertEquals(assignmentCalls, 30);
  assertEquals(result.assigned, 30);
  assertEquals(result.remaining, 0);
  assertEquals(result.operation_status, "completed");
});

Deno.test("fillOpenOperation completes the maximum 50-table batch", async () => {
  const { result, snapshotBuilds, assignmentCalls } = await exerciseBatch(50, 50);
  assertEquals(snapshotBuilds, 1);
  assertEquals(assignmentCalls, 50);
  assertEquals(result.assigned, 50);
  assertEquals(result.remaining, 0);
  assertEquals(result.operation_status, "completed");
});

Deno.test("fillOpenOperation leaves a 25-of-30 batch waiting for continuation", async () => {
  const { result, snapshotBuilds, assignmentCalls } = await exerciseBatch(30, 25);
  assertEquals(snapshotBuilds, 1);
  assertEquals(assignmentCalls, 25);
  assertEquals(result.assigned, 25);
  assertEquals(result.remaining, 5);
  assertEquals(result.operation_status, "waiting_for_dealer");
  assertEquals(result.outcomes.filter((outcome) => outcome.code === "assigned").length, 25);
  assertEquals(result.outcomes.filter((outcome) => outcome.code === "no_eligible_dealer").length, 5);
});
