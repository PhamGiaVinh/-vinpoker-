import type {
  RotationTable,
  RotationCandidate,
  RotationPair,
  RotationResult,
  RotationTier,
  MissedTableReason,
  ScoreCandidateInput,
} from "./rotationTypes.ts";

const TIER_PRIORITY: Record<string, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};
const KNOWN_TIERS = new Set(Object.keys(TIER_PRIORITY));

export interface SolverOptions {
  avgBreakRatio: number | null;
  clubBreakDurationMinutes: number;
  skipPriorityBreakGuard?: boolean;
  skipFatigueHardCap?: boolean;
}

export function solveGreedyLazy(
  tables: RotationTable[],
  candidates: RotationCandidate[],
  opts: SolverOptions
): RotationResult {
  const solvedAt = new Date().toISOString();
  const pairs: RotationPair[] = [];
  const unassignedTables: Array<{ tableId: string; reason: MissedTableReason }> = [];

  const sortedTables = [...tables].sort((a, b) => {
    const tierDiff = (TIER_PRIORITY[a.tourTier] ?? 2) - (TIER_PRIORITY[b.tourTier] ?? 2);
    if (tierDiff !== 0) return tierDiff;
    return a.id.localeCompare(b.id);
  });

  for (const t of sortedTables) {
    if (!KNOWN_TIERS.has(t.tourTier)) {
      console.error(`[rotation-solver] Unknown tier: "${t.tourTier}" on table ${t.id}`);
    }
  }

  const dedupedMap = new Map<string, RotationCandidate>();
  for (const c of candidates) {
    const key = c.dealerId || c.attendanceId;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, c);
    }
  }
  const uniqueCandidates = [...dedupedMap.values()];

  const usedDealerIds = new Set<string>();

  for (const table of sortedTables) {
    const eligible = uniqueCandidates.filter(c => {
      if (usedDealerIds.has(c.dealerId)) return false;
      if (table.currentAttendanceId && c.attendanceId === table.currentAttendanceId) return false;
      if (table.tourTier === "HIGH" && c.tier === "C") return false;
      if (table.gameTypes.length > 0) {
        const normalizedTableTypes = table.gameTypes.map(g => g.toLowerCase());
        const hasMatch = c.skills.some(s => normalizedTableTypes.includes(s));
        if (!hasMatch) return false;
      }
      return true;
    });

    if (eligible.length === 0) {
      const hasAnyCandidate = uniqueCandidates.some(c =>
        !usedDealerIds.has(c.dealerId) &&
        (!table.currentAttendanceId || c.attendanceId !== table.currentAttendanceId)
      );
      let reason: MissedTableReason;
      if (!hasAnyCandidate) {
        reason = "all_busy";
      } else if (table.tourTier === "HIGH") {
        const hasNonC = uniqueCandidates.some(c =>
        !usedDealerIds.has(c.dealerId) &&
        c.tier !== "C" &&
        (!table.currentAttendanceId || c.attendanceId !== table.currentAttendanceId)
      );
        reason = hasNonC ? "game_type_excluded" : "tier_excluded";
      } else if (table.gameTypes.length > 0) {
        const normalizedTableTypes = table.gameTypes.map(g => g.toLowerCase());
        const hasMatchingSkill = uniqueCandidates.some(c =>
        !usedDealerIds.has(c.dealerId) &&
        c.skills.some(s => normalizedTableTypes.includes(s))
      );
        reason = hasMatchingSkill ? "no_candidates" : "game_type_excluded";
      } else {
        reason = "no_candidates";
      }
      unassignedTables.push({ tableId: table.id, reason });
      console.warn(
        `[rotation-solver] Missed table ${table.id} (tier=${table.tourTier}, ` +
        `gameTypes=[${table.gameTypes.join(",")}]): ${reason}`
      );
      continue;
    }

    eligible.sort((a, b) => b.score - a.score);

    const best = eligible[0];
    usedDealerIds.add(best.dealerId);
    pairs.push({
      tableId: table.id,
      attendanceId: best.attendanceId,
      candidateName: best.fullName,
      score: best.score,
    });
  }

  return {
    pairs,
    unassignedTables,
    solverVersion: "greedy-v1",
    solvedAt,
  };
}
