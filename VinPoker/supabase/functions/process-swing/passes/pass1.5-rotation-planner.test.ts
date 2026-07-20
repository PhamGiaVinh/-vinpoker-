import { assertEquals } from "jsr:@std/assert@1";
import { pass15RotationPlanner } from "./pass1.5-rotation-planner.ts";

const CLUB_ID = "22222222-2222-2222-2222-222222222222";

function makeAdmin() {
  let rpcCalls = 0;
  const upcoming = [{
    id: "assignment-1",
    table_id: "table-1",
    attendance_id: "outgoing-attendance",
    version: 1,
    pre_assigned_attendance_id: null,
    game_tables: {
      id: "table-1",
      table_name: "Table 1",
      table_type: "cash",
      game_type: "holdem",
      tour_tier: "LOW",
    },
  }];
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    gte: () => chain,
    lt: () => chain,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: upcoming, error: null }).then(resolve),
  };

  return {
    admin: {
      from: () => chain,
      rpc: () => {
        rpcCalls++;
        return Promise.resolve({ data: null, error: null });
      },
    },
    rpcCalls: () => rpcCalls,
  };
}

const options = () => ({
  dryRun: false,
  preAnnounceMinutes: 5,
  requiredGameTypes: [],
  cycleExcludedIds: new Set<string>(),
  clubId: CLUB_ID,
});

Deno.test("Pass 1.5 fails closed before solver or pre-assignment when metrics dependency is absent", async () => {
  const { admin, rpcCalls } = makeAdmin();
  let solverCalls = 0;

  const result = await pass15RotationPlanner(admin, CLUB_ID, options(), {
    candidateBuilder: async () => ({
      candidates: [],
      avgBreakRatio: null,
      status: "dependency_unavailable",
      errorCode: "candidate_assignment_metrics_dependency_unavailable",
    }),
    solver: (() => {
      solverCalls++;
      throw new Error("solver must not run");
    }) as any,
  });

  assertEquals(result.candidateStatus, "dependency_unavailable");
  assertEquals(result.candidateErrorCode, "candidate_assignment_metrics_dependency_unavailable");
  assertEquals(solverCalls, 0);
  assertEquals(rpcCalls(), 0);
});

Deno.test("Pass 1.5 propagates a candidate runtime query failure instead of a clean shortage", async () => {
  const { admin, rpcCalls } = makeAdmin();
  let solverCalls = 0;

  const result = await pass15RotationPlanner(admin, CLUB_ID, options(), {
    candidateBuilder: async () => ({
      candidates: [],
      avgBreakRatio: null,
      status: "query_failed",
      errorCode: "candidate_assignment_metrics_query_failed",
    }),
    solver: (() => {
      solverCalls++;
      throw new Error("solver must not run");
    }) as any,
  });

  assertEquals(result.candidateStatus, "query_failed");
  assertEquals(result.candidateErrorCode, "candidate_assignment_metrics_query_failed");
  assertEquals(result.unassigned, 0);
  assertEquals(solverCalls, 0);
  assertEquals(rpcCalls(), 0);
});

Deno.test("Pass 1.5 keeps a valid zero-candidate snapshot as an honest shortage", async () => {
  const { admin, rpcCalls } = makeAdmin();
  let solverCalls = 0;

  const result = await pass15RotationPlanner(admin, CLUB_ID, options(), {
    candidateBuilder: async () => ({
      candidates: [],
      avgBreakRatio: null,
      status: "ok",
    }),
    solver: (() => {
      solverCalls++;
      return {
        pairs: [],
        unassignedTables: [{ tableId: "table-1", reason: "no_candidates" }],
        solverVersion: "test",
      };
    }) as any,
  });

  assertEquals(result.candidateStatus, undefined);
  assertEquals(result.unassigned, 1);
  assertEquals(result.missReasons, { no_candidates: 1 });
  assertEquals(solverCalls, 1);
  assertEquals(rpcCalls(), 0);
});
