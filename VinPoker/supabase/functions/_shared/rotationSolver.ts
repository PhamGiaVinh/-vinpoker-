import type {
  RotationTable,
  RotationCandidate,
  RotationPair,
  RotationResult,
  RotationTier,
  MissedTableReason,
  ScoreCandidateInput,
  DealerTier,
  RotationPlan,
  RotationPlanCandidate,
  RotationPlanOptions,
  RotationPlanRow,
  RotationPlanTable,
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

// ============================================================
// Forward Rotation Scheduler — solveRotationPlan (PURE FUNCTION)
//
// Zero I/O. Clock injected via opts.nowMs. Same inputs → same plan.
//
// Hard invariants (by construction, never by escalation):
//   R1  a dealer enters no table before eligibleAt (release + restMs). restMs is
//       supplied by the caller = SWING_POLICY.rest.executeMinRestFloorMinutes (15),
//       so eligibleAt == the execute-time rest gate and a locked dealer always
//       passes it (see passR restMs + pickNextDealer buildRotationSupply floor).
//   R2  plannedReliefAt >= max(eligibleAt, now) + announceLead
//       → every dealer has >= restMs + announceLead from release to entry.
//   swing_due_at is INPUT ONLY — the solver never proposes changing it.
//       Shortage = honest later plannedReliefAt, visible OT.
//
// Ordering:
//   R4  tables: overdue first by dealing duration DESC, then by need time ASC.
//   R3  dealers: earliest achievable relief first; then tier fit when the
//       table demands a tier (R5); then prevSessionMinutes ASC (shorter
//       previous session → called back first); then health score DESC.
// ============================================================

interface PoolEntry extends RotationPlanCandidate {
  /** True for dealers who only re-enter supply via the simulation (not yet
   *  released in reality). They can never be CHỐT in slot 0 — only forecast
   *  rounds and shortage estimates may use them. */
  simulated?: boolean;
}

interface SimTable {
  src: RotationPlanTable;
  /** Dealer currently simulated on the table (changes across forecast rounds). */
  simOutAttendanceId: string | null;
  simOutName: string | null;
  /** When the simulated current dealer sat in. */
  simAssignedAtMs: number;
  /** When the simulated current session is due to end. */
  simDueAtMs: number;
}

function tierFitRank(required: DealerTier | null, tier: DealerTier): number {
  if (!required) return 0;
  if (required === tier) return 0;
  const order: Record<DealerTier, number> = { A: 0, B: 1, C: 2 };
  return Math.abs(order[required] - order[tier]);
}

function skillsMatch(table: RotationPlanTable, c: RotationPlanCandidate): boolean {
  if (table.gameTypes.length === 0) return true;
  // Generalist dealers (no specialty skills tracked) can deal the standard
  // game. Skills are an ADDITIVE specialty whitelist, never a hard requirement
  // — an empty skills array must never starve the pool. This mirrors the
  // supply-side game-type filter in buildDealerCandidates, which only excludes
  // a dealer who HAS skills listed but matches none of the required types.
  // Without this, a table carrying the default game_type (e.g. "NLH") rejects
  // every dealer in a club that doesn't track skills → 100% false shortage.
  if (c.skills.length === 0) return true;
  const wanted = table.gameTypes.map((g) => g.toLowerCase());
  return c.skills.some((s) => wanted.includes(s.toLowerCase()));
}

export function solveRotationPlan(
  tables: RotationPlanTable[],
  candidates: RotationPlanCandidate[],
  opts: RotationPlanOptions
): RotationPlan {
  const { nowMs, announceLeadMs, preAnnounceMs, restMs, forecastSlots } = opts;
  // Patch 5d — dealers reserved to a feature/final pool: exclusive to their special
  // table, never planned onto a normal table. Empty = no reservation (kill-switch off).
  const reserved = new Set(opts.reservedDealerIds ?? []);
  const rows: RotationPlanRow[] = [];
  const lockedTableIds: string[] = [];

  // Dedup candidates by dealer (a dealer may surface twice via stale attendance rows).
  const dedup = new Map<string, PoolEntry>();
  for (const c of candidates) {
    const key = c.dealerId || c.attendanceId;
    const prev = dedup.get(key);
    if (!prev || c.eligibleAtMs < prev.eligibleAtMs) dedup.set(key, { ...c });
  }
  let pool: PoolEntry[] = [...dedup.values()];

  // Simulation state: every table carries its current (simulated) session.
  const sims: SimTable[] = tables.map((t) => ({
    src: t,
    simOutAttendanceId: t.outAttendanceId,
    simOutName: t.outDealerName,
    simAssignedAtMs: t.assignedAtMs,
    simDueAtMs: t.swingDueAtMs,
  }));

  // PRE-PASS — sticky CHỐT consumes its dealer from the pool BEFORE any table
  // is planned, so an earlier-ordered overdue table can never steal a locked dealer.
  const lockedSims = new Set<SimTable>();
  for (const sim of sims) {
    const t = sim.src;
    if (!t.lockedInAttendanceId) continue;
    lockedSims.add(sim);
    lockedTableIds.push(t.tableId);
    const reliefMs = t.lockedPlannedReliefAtMs ?? Math.max(t.swingDueAtMs, nowMs);
    pool = pool.filter((c) => c.attendanceId !== t.lockedInAttendanceId);
    // Out-dealer re-enters supply after rest (simulation only).
    pool.push({
      attendanceId: t.outAttendanceId,
      dealerId: `sim-${t.outAttendanceId}`,
      fullName: t.outDealerName,
      tier: "B",
      skills: [],
      prevSessionMinutes: Math.max(0, Math.round((reliefMs - t.assignedAtMs) / 60_000)),
      eligibleAtMs: reliefMs + restMs,
      score: 0,
      simulated: true,
    });
    sim.simOutAttendanceId = t.lockedInAttendanceId;
    sim.simOutName = null;
    sim.simAssignedAtMs = reliefMs;
    sim.simDueAtMs = reliefMs + t.swingDurationMs;
  }

  for (let slot = 0; slot <= forecastSlots; slot++) {
    // R4 ordering against the simulated state of this round.
    const ordered = [...sims].sort((a, b) => {
      const aOver = a.simDueAtMs <= nowMs;
      const bOver = b.simDueAtMs <= nowMs;
      if (aOver !== bOver) return aOver ? -1 : 1;
      if (aOver && bOver) {
        // Both overdue: longest-dealt relieved first.
        const durDiff = (nowMs - b.simAssignedAtMs) - (nowMs - a.simAssignedAtMs);
        if (durDiff !== 0) return durDiff > 0 ? 1 : -1;
        return a.simDueAtMs - b.simDueAtMs;
      }
      // Both upcoming: earlier need first; tie → longer-dealt first.
      if (a.simDueAtMs !== b.simDueAtMs) return a.simDueAtMs - b.simDueAtMs;
      return a.simAssignedAtMs - b.simAssignedAtMs;
    });

    const usedThisRound = new Set<string>();

    for (const sim of ordered) {
      const t = sim.src;
      const isSlot0 = slot === 0;

      // Sticky CHỐT was consumed in the pre-pass — emit nothing for its slot 0.
      if (isSlot0 && lockedSims.has(sim)) continue;

      const needAtMs = Math.max(sim.simDueAtMs, nowMs);
      const isEmergency = isSlot0 && sim.simDueAtMs <= nowMs;
      // The ideal relief if a fully-rested dealer existed right now.
      const idealReliefMs = Math.max(needAtMs, nowMs + announceLeadMs);

      // Patch 5c — feature/final pool gate. A special table (poolDealerIds non-null)
      // may only be relieved by a pool dealer; a non-pool dealer would be rejected by
      // the seat trigger (DT006) → the proactive planner must never propose one. null
      // = ungated. Simulated re-entrants (forecast rounds only — excluded from slot 0
      // by the rule below) are not restricted: their real dealer_id is not carried, so
      // they can't be pool-checked, and they are never locked.
      const tablePool: Set<string> | null = t.poolDealerIds == null ? null : new Set(t.poolDealerIds);
      // Patch 5c: a SPECIAL table only accepts its own pool. Patch 5d: a NORMAL table
      // (tablePool === null) must EXCLUDE any dealer reserved to a feature/final pool
      // → reserved dealers stay exclusive to their special table. Simulated forecast
      // re-entrants (never locked at slot 0) carry no real dealer_id → unrestricted.
      const allowedByPool = (c: PoolEntry) =>
        c.simulated === true
          ? true
          : tablePool === null
            ? !reserved.has(c.dealerId)
            : tablePool.has(c.dealerId);

      const eligible = pool.filter(
        (c) =>
          !usedThisRound.has(c.attendanceId) &&
          c.attendanceId !== sim.simOutAttendanceId &&
          // Slot 0 becomes a real CHỐT — a dealer not yet released in reality
          // (simulation re-entry) can never be locked; forecast rounds may use them.
          (!isSlot0 || !c.simulated) &&
          allowedByPool(c) &&
          skillsMatch(t, c)
      );

      if (eligible.length === 0) {
        // Honest shortage placeholder: relief at the earliest future supply event, if any.
        // skillsMatch mirrors the eligible filter above — relief can only come
        // from a dealer who can actually deal this table. Without it, a
        // skill-mismatched dealer's rest completion becomes a phantom relief
        // promise, and the sim advance below anchors every later forecast
        // round for this table to an impossible event.
        const futureSupply = pool
          .filter(
            (c) =>
              !usedThisRound.has(c.attendanceId) &&
              c.attendanceId !== sim.simOutAttendanceId &&
              allowedByPool(c) &&
              skillsMatch(t, c)
          )
          .map((c) => Math.max(c.eligibleAtMs, nowMs) + announceLeadMs);
        const reliefMs = futureSupply.length > 0
          ? Math.max(needAtMs, Math.min(...futureSupply))
          : idealReliefMs;
        rows.push({
          tableId: t.tableId,
          assignmentId: isSlot0 ? t.assignmentId : null,
          slotIndex: slot,
          outAttendanceId: sim.simOutAttendanceId,
          inAttendanceId: null,
          inDealerName: null,
          plannedReliefAtMs: reliefMs,
          announceAtMs: null,
          isShortage: true,
          isEmergency,
          requiredTier: t.requiredTier,
          tierMatched: false,
          score: null,
          reason: { shortage: "no_eligible_dealer", needAtMs },
        });
        // Simulate the relief happening anyway so later rounds stay coherent.
        sim.simAssignedAtMs = reliefMs;
        sim.simDueAtMs = reliefMs + t.swingDurationMs;
        continue;
      }

      // Entry cannot precede: table need, announce-after-rest + 3-min lead.
      const entryFor = (c: PoolEntry) =>
        Math.max(needAtMs, Math.max(c.eligibleAtMs, nowMs) + announceLeadMs);

      eligible.sort((a, b) => {
        const ea = entryFor(a);
        const eb = entryFor(b);
        if (ea !== eb) return ea - eb;
        const fitA = tierFitRank(t.requiredTier, a.tier);
        const fitB = tierFitRank(t.requiredTier, b.tier);
        if (fitA !== fitB) return fitA - fitB;
        if (a.prevSessionMinutes !== b.prevSessionMinutes) {
          return a.prevSessionMinutes - b.prevSessionMinutes;
        }
        if (a.score !== b.score) return b.score - a.score;
        return a.attendanceId.localeCompare(b.attendanceId);
      });

      const best = eligible[0];
      const reliefMs = entryFor(best);
      const lead = isEmergency ? announceLeadMs : Math.max(preAnnounceMs, announceLeadMs);
      const announceMs = Math.max(nowMs, best.eligibleAtMs, reliefMs - lead);

      rows.push({
        tableId: t.tableId,
        assignmentId: isSlot0 ? t.assignmentId : null,
        slotIndex: slot,
        outAttendanceId: sim.simOutAttendanceId,
        inAttendanceId: best.attendanceId,
        inDealerName: best.fullName,
        plannedReliefAtMs: reliefMs,
        announceAtMs: announceMs,
        isShortage: reliefMs > idealReliefMs,
        isEmergency,
        requiredTier: t.requiredTier,
        tierMatched: tierFitRank(t.requiredTier, best.tier) === 0,
        score: best.score,
        reason: {
          prevSessionMinutes: best.prevSessionMinutes,
          eligibleAtMs: best.eligibleAtMs,
          tier: best.tier,
          needAtMs,
        },
      });

      // Advance the simulation: incoming dealer takes over, outgoing rests then re-enters.
      usedThisRound.add(best.attendanceId);
      pool = pool.filter((c) => c.attendanceId !== best.attendanceId);
      if (sim.simOutAttendanceId) {
        pool.push({
          attendanceId: sim.simOutAttendanceId,
          dealerId: `sim-${sim.simOutAttendanceId}`,
          fullName: sim.simOutName ?? "",
          tier: "B",
          skills: [],
          prevSessionMinutes: Math.max(0, Math.round((reliefMs - sim.simAssignedAtMs) / 60_000)),
          eligibleAtMs: reliefMs + restMs,
          score: 0,
          simulated: true,
        });
      }
      sim.simOutAttendanceId = best.attendanceId;
      sim.simOutName = best.fullName;
      sim.simAssignedAtMs = reliefMs;
      sim.simDueAtMs = reliefMs + t.swingDurationMs;
    }
  }

  return { rows, solverVersion: opts.solverVersion, lockedTableIds };
}
