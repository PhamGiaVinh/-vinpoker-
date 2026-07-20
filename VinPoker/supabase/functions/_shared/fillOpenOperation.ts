import { buildDealerCandidates, type DealerCandidate } from "./pickNextDealer.ts";
import {
  getFeatureTablePoolsByTable,
  getReservedDealerIds,
} from "./featureTableGate.ts";
import { OPEN_TABLE_GRACE_MINUTES, bulkOpenStaggerMs } from "./openTableGrace.ts";
import { SWING_POLICY } from "./swingPolicy.ts";

export type SupabaseAdmin = any;

export interface OpenOperationTable {
  id: string;
  table_name: string;
  game_type: string | null;
  tour_tier: "HIGH" | "MEDIUM" | "LOW" | null;
}

interface OpenOperationRow {
  id: string;
  club_id: string;
  requested_by: string;
  status: string;
  requested_count: number;
  expires_at: string;
}

interface OpenTargetRow {
  table_id: string;
  target_state: string;
  game_tables: {
    id: string;
    table_name: string;
    game_type: string | null;
    tour_tier: "HIGH" | "MEDIUM" | "LOW" | null;
  };
}

export interface OpenOperationAssignment {
  table_id: string;
  table_name: string;
  attendance_id: string;
  full_name: string;
  telegram_username?: string | null;
}

export interface OpenOperationTableOutcome {
  table_id: string;
  code: "assigned" | "already_occupied" | "no_eligible_dealer" | "conflict" | "failed";
  attendance_id?: string;
}

export interface FillOpenOperationResult {
  operation_id: string;
  requested: number;
  assigned: number;
  remaining: number;
  operation_status: string;
  assignments: OpenOperationAssignment[];
  outcomes: OpenOperationTableOutcome[];
  candidate_snapshot_builds: number;
}

interface FillOpenOperationOptions {
  expectedClubId?: string;
  actorId?: string;
  swingDueAt?: string;
  minInterSwingRestMinutes?: number;
  deadlineMs?: number;
  candidateBuilder?: typeof buildDealerCandidates;
  poolBuilder?: typeof getFeatureTablePoolsByTable;
  reservedBuilder?: typeof getReservedDealerIds;
}

function operationFailure(error: unknown, stage: string): Error {
  const value = error && typeof error === "object"
    ? error as { code?: string | null; message?: string | null }
    : {};
  const code = String(value.code ?? "").toUpperCase();
  const message = String(value.message ?? error ?? "").toLowerCase();
  const dependencyUnavailable = [
    "42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204",
  ].includes(code)
    || /schema cache|does not exist|could not find the (table|column|function|relationship)/.test(message);
  return new Error(
    `${dependencyUnavailable ? "OPEN_OPERATION_DEPENDENCY_UNAVAILABLE" : "OPEN_OPERATION_QUERY_FAILED"}:${stage}`,
  );
}

function tableTierBonus(candidate: DealerCandidate, tier: OpenOperationTable["tour_tier"]): number {
  if (tier === "HIGH") {
    if (candidate.tier === "A") return SWING_POLICY.scoring.tierBonusHighA;
    if (candidate.tier === "B") return SWING_POLICY.scoring.tierBonusHighB;
    return 0;
  }
  if (tier === "MEDIUM") {
    return candidate.tier === "B" ? SWING_POLICY.scoring.tierBonusMediumB : 0;
  }
  return candidate.tier === "C" ? SWING_POLICY.scoring.tierBonusLowC : 0;
}

export function rankOpenOperationCandidates(
  snapshot: DealerCandidate[],
  table: OpenOperationTable,
  featurePools: Map<string, Set<string>>,
  reservedDealerIds: Set<string>,
  excludedAttendanceIds: Set<string>,
): DealerCandidate[] {
  const tablePool = featurePools.get(table.id);

  return snapshot
    .filter((candidate) => !excludedAttendanceIds.has(candidate.id))
    .filter((candidate) => {
      if (tablePool) return tablePool.has(candidate.dealer_id);
      return !reservedDealerIds.has(candidate.dealer_id);
    })
    .filter((candidate) => table.tour_tier !== "HIGH" || candidate.tier !== "C")
    .map((candidate) => {
      const baseTierBonus = candidate.score_breakdown?.tier_bonus ?? 0;
      let score = (candidate.score ?? 0) - baseTierBonus;
      score += tableTierBonus(candidate, table.tour_tier);

      if (table.game_type && candidate.skills.includes(table.game_type)) {
        score += SWING_POLICY.scoring.skillBonusPerMatch;
      }
      if (table.tour_tier === "HIGH" && candidate.last_tour_tier === "HIGH") {
        score += SWING_POLICY.scoring.consecutiveHighPenalty;
      }
      if (candidate.last_table_id === table.id) {
        score += candidate.last_tour_tier === table.tour_tier
          ? SWING_POLICY.scoring.backToBackSameTierPenalty
          : SWING_POLICY.scoring.backToBackDiffTierPenalty;
      }

      return { ...candidate, score };
    })
    .sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      return scoreDiff !== 0 ? scoreDiff : a.dealer_id.localeCompare(b.dealer_id);
    });
}

function normalizeRpcOutcome(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "outcome" in data) {
    return String((data as { outcome?: unknown }).outcome ?? "");
  }
  return null;
}

export async function fillOpenOperation(
  admin: SupabaseAdmin,
  operationId: string,
  options: FillOpenOperationOptions = {},
): Promise<FillOpenOperationResult> {
  const candidateBuilder = options.candidateBuilder ?? buildDealerCandidates;
  const poolBuilder = options.poolBuilder ?? getFeatureTablePoolsByTable;
  const reservedBuilder = options.reservedBuilder ?? getReservedDealerIds;
  const deadline = Date.now() + Math.min(Math.max(options.deadlineMs ?? 45_000, 1_000), 50_000);

  const { error: initialRefreshError } = await admin.rpc(
    "_refresh_dealer_open_operation",
    { p_operation_id: operationId },
  );
  if (initialRefreshError) throw operationFailure(initialRefreshError, "initial_refresh");

  const { data: operation, error: operationError } = await admin
    .from("dealer_open_operations")
    .select("id, club_id, requested_by, status, requested_count, expires_at")
    .eq("id", operationId)
    .maybeSingle();
  if (operationError || !operation) {
    if (operationError) throw operationFailure(operationError, "operation");
    throw new Error("OPEN_OPERATION_NOT_FOUND");
  }

  const op = operation as OpenOperationRow;
  if (options.expectedClubId && op.club_id !== options.expectedClubId) {
    throw new Error("OPEN_OPERATION_CLUB_MISMATCH");
  }
  if (options.actorId && op.requested_by !== options.actorId) {
    throw new Error("OPEN_OPERATION_ACTOR_MISMATCH");
  }
  const { data: rollout, error: rolloutError } = await admin
    .from("dealer_mass_open_rollout")
    .select("enabled, all_clubs_enabled, allowed_club_ids")
    .eq("id", true)
    .maybeSingle();
  if (rolloutError) throw operationFailure(rolloutError, "rollout");
  if (!rollout) throw new Error("MASS_OPEN_ROLLOUT_UNAVAILABLE");
  const allowed = rollout.enabled === true
    && (rollout.all_clubs_enabled === true || (rollout.allowed_club_ids ?? []).includes(op.club_id));
  if (!allowed) throw new Error("MASS_OPEN_ROLLOUT_DISABLED");

  if (!["pending", "running", "waiting_for_dealer"].includes(op.status)
      || new Date(op.expires_at).getTime() <= Date.now()) {
    const { data: summary } = await admin.rpc("_refresh_dealer_open_operation", {
      p_operation_id: operationId,
    });
    return {
      operation_id: operationId,
      requested: Number(summary?.requested ?? op.requested_count),
      assigned: Number(summary?.assigned ?? 0),
      remaining: Number(summary?.remaining ?? 0),
      operation_status: String(summary?.operation_status ?? op.status),
      assignments: [],
      outcomes: [],
      candidate_snapshot_builds: 0,
    };
  }

  const { data: targetRows, error: targetError } = await admin
    .from("dealer_open_operation_targets")
    .select("table_id, target_state, game_tables!inner(id, table_name, game_type, tour_tier)")
    .eq("operation_id", operationId)
    .eq("target_state", "pending")
    .order("table_id", { ascending: true });
  if (targetError) throw operationFailure(targetError, "targets");

  const targets = (targetRows ?? []) as OpenTargetRow[];
  if (targets.length === 0) {
    const { data: summary } = await admin.rpc("_refresh_dealer_open_operation", {
      p_operation_id: operationId,
    });
    return {
      operation_id: operationId,
      requested: Number(summary?.requested ?? op.requested_count),
      assigned: Number(summary?.assigned ?? 0),
      remaining: Number(summary?.remaining ?? 0),
      operation_status: String(summary?.operation_status ?? op.status),
      assignments: [],
      outcomes: [],
      candidate_snapshot_builds: 0,
    };
  }

  const tables: OpenOperationTable[] = targets.map((target) => ({
    id: target.game_tables.id,
    table_name: target.game_tables.table_name,
    game_type: target.game_tables.game_type,
    tour_tier: target.game_tables.tour_tier,
  }));

  // All expensive eligibility queries are built once. Feature/final pools are
  // fetched in one batch, then every table is ranked from this immutable snapshot.
  let snapshotResult: Awaited<ReturnType<typeof buildDealerCandidates>>;
  let featurePools: Awaited<ReturnType<typeof getFeatureTablePoolsByTable>>;
  let reservedDealerIds: Awaited<ReturnType<typeof getReservedDealerIds>>;
  try {
    [snapshotResult, featurePools, reservedDealerIds] = await Promise.all([
      candidateBuilder(admin, op.club_id, {
        includeScoreBreakdown: true,
        minInterSwingRestMinutes:
          options.minInterSwingRestMinutes ?? SWING_POLICY.rest.minInterSwingRestMinutes,
        availableOnly: true,
      }),
      poolBuilder(admin, tables.map((table) => table.id)),
      reservedBuilder(admin),
    ]);
  } catch (error) {
    throw operationFailure(error, "candidate_snapshot");
  }
  if (snapshotResult.status !== "ok") {
    throw new Error(
      `${snapshotResult.status === "dependency_unavailable"
        ? "OPEN_OPERATION_DEPENDENCY_UNAVAILABLE"
        : "OPEN_OPERATION_QUERY_FAILED"}:candidate_snapshot`,
    );
  }
  const snapshot = snapshotResult.candidates;
  const usedAttendanceIds = new Set<string>();
  const assignments: OpenOperationAssignment[] = [];
  const outcomes: OpenOperationTableOutcome[] = [];
  const now = Date.now();

  for (const [index, table] of tables.entries()) {
    if (Date.now() >= deadline) break;

    const attempted = new Set<string>();
    let finalCode: OpenOperationTableOutcome["code"] = "no_eligible_dealer";
    let assignedAttendanceId: string | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      const excluded = new Set([...usedAttendanceIds, ...attempted]);
      const candidate = rankOpenOperationCandidates(
        snapshot,
        table,
        featurePools,
        reservedDealerIds,
        excluded,
      )[0];
      if (!candidate) break;
      attempted.add(candidate.id);

      const graceMs = OPEN_TABLE_GRACE_MINUTES * 60_000;
      const staggerMs = bulkOpenStaggerMs(index, op.requested_count);
      const baseDueMs = options.swingDueAt
        ? new Date(options.swingDueAt).getTime() + graceMs + staggerMs
        : now + graceMs + SWING_POLICY.bulkOpen.minFirstStintMinutes * 60_000 + staggerMs;
      const minimumDueMs = now + graceMs
        + SWING_POLICY.bulkOpen.minFirstStintMinutes * 60_000;
      const tableSwingDueAt = new Date(Math.max(baseDueMs, minimumDueMs)).toISOString();

      const { data, error } = await admin.rpc("assign_dealer_to_table", {
        p_table_id: table.id,
        p_attendance_id: candidate.id,
        p_swing_due_at: tableSwingDueAt,
        p_idempotency_key: `open_operation_${operationId}_${table.id}`,
      });

      if (error) {
        const classified = operationFailure(error, "assign_dealer_to_table");
        if (classified.message.startsWith("OPEN_OPERATION_DEPENDENCY_UNAVAILABLE")) throw classified;
        finalCode = "conflict";
        continue;
      }

      const rpcOutcome = normalizeRpcOutcome(data);
      if (rpcOutcome === "ok") {
        usedAttendanceIds.add(candidate.id);
        assignedAttendanceId = candidate.id;
        finalCode = "assigned";
        assignments.push({
          table_id: table.id,
          table_name: table.table_name,
          attendance_id: candidate.id,
          full_name: candidate.full_name,
          telegram_username: candidate.telegram_username ?? null,
        });
        break;
      }
      if (rpcOutcome === "table_occupied") {
        finalCode = "already_occupied";
        break;
      }
      finalCode = rpcOutcome === "conflict" ? "conflict" : "failed";
    }

    outcomes.push({
      table_id: table.id,
      code: finalCode,
      ...(assignedAttendanceId ? { attendance_id: assignedAttendanceId } : {}),
    });
  }

  const { data: summary, error: refreshError } = await admin.rpc(
    "_refresh_dealer_open_operation",
    { p_operation_id: operationId },
  );
  if (refreshError || !summary) {
    if (refreshError) throw operationFailure(refreshError, "final_refresh");
    throw new Error("OPEN_OPERATION_QUERY_FAILED:empty_refresh");
  }

  for (const outcome of outcomes) {
    if (outcome.code === "assigned" || outcome.code === "already_occupied") continue;
    const { error: outcomeError } = await admin
      .from("dealer_open_operation_targets")
      .update({ outcome_code: outcome.code, updated_at: new Date().toISOString() })
      .eq("operation_id", operationId)
      .eq("table_id", outcome.table_id)
      .eq("target_state", "pending");
    if (outcomeError) throw operationFailure(outcomeError, "target_outcome");
  }

  return {
    operation_id: operationId,
    requested: Number(summary.requested ?? op.requested_count),
    assigned: Number(summary.assigned ?? 0),
    remaining: Number(summary.remaining ?? 0),
    operation_status: String(summary.operation_status ?? "waiting_for_dealer"),
    assignments,
    outcomes,
    candidate_snapshot_builds: 1,
  };
}
