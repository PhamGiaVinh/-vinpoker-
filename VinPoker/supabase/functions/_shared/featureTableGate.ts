import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyPostgrestError } from "./postgrestError.ts";

/**
 * Patch 5b — feature/final pool gate (shared by pickNextDealer + process-swing emergency self-pick
 * + the shortage alert). Single source of truth so the TS picker, the SQL trigger
 * (`_assert_dealer_allowed_for_table`) and the WRAPPER self-pick can never disagree.
 *
 * Returns the set of allowed dealer_ids for `tableId` when the gate is ACTIVE, or `null` when the
 * gate is INACTIVE — callers MUST NOT filter on `null` (preserves today's behavior; INERT when off).
 *
 * Gate is ACTIVE only when BOTH:
 *   1. kill-switch app_settings('dealer_feature_tables_enabled') is ON
 *      (canonical truthiness: JSONB boolean → value === true || value === 'true'), AND
 *   2. the table has a feature/final profile (table_mode='feature' OR is_final=true).
 * When active, the returned set is the table's pool — it MAY BE EMPTY, meaning "special table with
 * no eligible pool dealer" → the caller must treat that as a CLEAN shortage (no candidate / no
 * emergency pick → the existing null→no_dealer keep-seat path, which preserves OT accrual), NOT a
 * fall-through that would let a non-pool dealer reach the seat trigger and trigger-rollback.
 *
 * Gated on app_settings, NOT on FEATURES (UI-only flag). When the kill-switch is off this returns
 * `null` on the first query, so callers behave exactly as before P5b.
 */
export async function getFeatureTablePoolIds(
  admin: SupabaseClient,
  tableId: string | null | undefined,
): Promise<Set<string> | null> {
  if (!tableId) return null;

  const { data: ksRow, error: ksErr } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "dealer_feature_tables_enabled")
    .maybeSingle();
  if (ksErr) {
    // Fail-CLOSED (P2 hardening, audit 2026-07-02): an unchecked query error here used to
    // silently default to killSwitchOn=false → gate INACTIVE → a genuinely-special table
    // could be treated as ungated for this pick, letting a non-pool dealer be proposed for
    // it (still blocked at the SQL seat trigger DT006, but a messier failure than an honest
    // shortage). Return an EMPTY Set, NOT null — an empty Set is truthy in JS, so the caller
    // takes the "gate active, zero eligible" branch → a clean shortage, never an ungated pick.
    const failure = classifyPostgrestError(ksErr);
    console.warn("[featureTableGate] single_pool_gate_failed", {
      stage: "app_settings",
      status: failure.status,
      code: failure.sanitizedCode,
    });
    return new Set<string>();
  }
  const killSwitchOn = (ksRow as { value?: unknown } | null)?.value === true
    || (ksRow as { value?: unknown } | null)?.value === "true";
  if (!killSwitchOn) return null; // inert when off

  const { data: profile, error: profErr } = await admin
    .from("dealer_table_profiles")
    .select("table_mode, is_final")
    .eq("table_id", tableId)
    .maybeSingle();
  if (profErr) {
    const failure = classifyPostgrestError(profErr);
    console.warn("[featureTableGate] single_pool_gate_failed", {
      stage: "dealer_table_profiles",
      status: failure.status,
      code: failure.sanitizedCode,
    });
    return new Set<string>();
  }
  const isSpecial = !!profile
    && ((profile as { table_mode?: string }).table_mode === "feature"
      || (profile as { is_final?: boolean }).is_final === true);
  if (!isSpecial) return null; // normal table → no pool filter

  const { data: poolRows, error: poolErr } = await admin
    .from("dealer_table_pool_members")
    .select("dealer_id")
    .eq("table_id", tableId);
  if (poolErr) {
    const failure = classifyPostgrestError(poolErr);
    console.warn("[featureTableGate] single_pool_gate_failed", {
      stage: "dealer_table_pool_members",
      status: failure.status,
      code: failure.sanitizedCode,
    });
    return new Set<string>();
  }
  return new Set((poolRows ?? []).map((p: { dealer_id: string }) => p.dealer_id)); // may be empty → caller = clean shortage
}

/**
 * Patch 5c — BATCHED feature/final pool gate for the PROACTIVE planner (Pass R).
 *
 * The reactive picker (`getFeatureTablePoolIds`) gates one table at a time via a
 * `currentTableId`. Pass R builds a GLOBAL supply (no currentTableId) and matches
 * dealers→tables in `solveRotationPlan`, so the per-table gate never fired there —
 * the planner could announce a NON-pool dealer to a feature/final table, whose seat
 * then fails the SQL trigger (DT006) every tick → the dealer is stuck. This returns,
 * for a batch of table_ids, the pool dealer-id Set of each SPECIAL table so the
 * solver can exclude non-pool dealers per table.
 *
 * Gate-aware, same as the single-table version:
 *   - kill-switch OFF → empty Map (no gating; planner behaves exactly as pre-5c).
 *   - only feature/final tables appear in the map; a special table with no pool
 *     members maps to an EMPTY Set → solver treats it as a clean shortage (keep-seat),
 *     never a non-pool substitution.
 * Normal tables are simply absent from the map (→ ungated in the solver).
 */
export interface FeatureTablePoolsSnapshot {
  status: "ok" | "dependency_unavailable" | "query_failed";
  errorCode?: string;
  pools: Map<string, Set<string>>;
}

export async function getFeatureTablePoolsByTableWithStatus(
  admin: SupabaseClient,
  tableIds: Array<string | null | undefined>,
): Promise<FeatureTablePoolsSnapshot> {
  const out = new Map<string, Set<string>>();
  const uniq = [...new Set(tableIds.filter(Boolean) as string[])];
  if (uniq.length === 0) return { status: "ok", pools: out };

  // Fail-CLOSED helper (P2 hardening, audit 2026-07-02): on an error before we know WHICH of
  // `uniq` are special, the safe assumption is "any of them might be" — map EVERY requested
  // table to an EMPTY pool (gated + zero eligible). Downstream (buildSolverTables →
  // rotationSolver.allowedByPool) that makes every table in this batch report a clean shortage
  // for this ONE planner tick (no lock/announce), instead of silently ungating a special table.
  const failClosedAll = (
    reason: string,
    error: unknown,
  ): FeatureTablePoolsSnapshot => {
    const failure = classifyPostgrestError(error);
    console.warn("[featureTableGate] batch_pool_gate_failed", {
      stage: reason,
      status: failure.status,
      code: failure.sanitizedCode,
    });
    const m = new Map<string, Set<string>>();
    for (const id of uniq) m.set(id, new Set<string>());
    return {
      status: failure.status,
      errorCode: `feature_table_pools_${reason.replace(/[^a-z]+/gi, "_").replace(/^_|_$/g, "")}_${failure.status}`,
      pools: m,
    };
  };

  const { data: ksRow, error: ksErr } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "dealer_feature_tables_enabled")
    .maybeSingle();
  if (ksErr) return failClosedAll("app_settings", ksErr);
  const killSwitchOn = (ksRow as { value?: unknown } | null)?.value === true
    || (ksRow as { value?: unknown } | null)?.value === "true";
  if (!killSwitchOn) return { status: "ok", pools: out }; // inert when off

  const { data: profiles, error: profErr } = await admin
    .from("dealer_table_profiles")
    .select("table_id, table_mode, is_final")
    .in("table_id", uniq);
  if (profErr) return failClosedAll("dealer_table_profiles", profErr);
  const specialIds = (profiles ?? [])
    .filter((p: { table_mode?: string; is_final?: boolean }) =>
      p.table_mode === "feature" || p.is_final === true)
    .map((p: { table_id: string }) => p.table_id);
  if (specialIds.length === 0) return { status: "ok", pools: out };

  // Seed every special table with an empty pool first → "no member" = clean shortage.
  for (const id of specialIds) out.set(id, new Set<string>());

  const { data: members, error: memErr } = await admin
    .from("dealer_table_pool_members")
    .select("table_id, dealer_id")
    .in("table_id", specialIds);
  if (memErr) {
    // We already know WHICH tables are special (the profiles query above succeeded) and have
    // already seeded them all with an empty pool — that seed IS the safe fail-closed state, so
    // just return it as-is rather than the broader failClosedAll (no need to also gate the
    // already-confirmed-normal tables in `uniq`).
    const failure = classifyPostgrestError(memErr);
    console.warn("[featureTableGate] batch_pool_gate_failed", {
      stage: "dealer_table_pool_members",
      status: failure.status,
      code: failure.sanitizedCode,
    });
    return {
      status: failure.status,
      errorCode: `feature_table_pools_members_${failure.status}`,
      pools: out,
    };
  }
  for (const m of (members ?? []) as Array<{ table_id: string; dealer_id: string }>) {
    out.get(m.table_id)?.add(m.dealer_id);
  }
  return { status: "ok", pools: out };
}

/**
 * Compatibility wrapper for legacy callers. Unknown gate data still becomes
 * an empty gated pool; snapshot callers use the strict result above.
 */
export async function getFeatureTablePoolsByTable(
  admin: SupabaseClient,
  tableIds: Array<string | null | undefined>,
): Promise<Map<string, Set<string>>> {
  return (await getFeatureTablePoolsByTableWithStatus(admin, tableIds)).pools;
}

/**
 * Patch 5d — RESERVED dealers: every dealer who is a member of ANY feature/final
 * table's pool. These dealers are EXCLUSIVE to their special table and must NOT be
 * assigned to any normal table (owner rule 2026-06-28: "các dealer được pick tại bàn
 * tâm điểm và final sẽ không chia các bàn thường khác"). Callers exclude this set when
 * picking for a NON-special table; the special table itself still restricts to its own
 * pool via getFeatureTablePoolIds / poolDealerIds. Combined, a reserved dealer can only
 * ever land on the special table they belong to → the closed in-pool rotation holds
 * (2 dealers ping-pong; 3+ rotate among themselves) instead of leaking to normal tables.
 *
 * Gate-aware: empty Set when the kill-switch is OFF → no reservation (pre-5d behavior).
 */
export async function getReservedDealerIds(admin: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();

  const { data: ksRow, error: ksErr } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "dealer_feature_tables_enabled")
    .maybeSingle();
  if (ksErr) {
    // Fail-CLOSED (P2 hardening, audit 2026-07-02): unlike the other two gate helpers, this
    // function has no "inert" data shape that ALSO means "gate active but unknown" — an empty
    // Set here is indistinguishable from "genuinely zero reserved dealers", which would let a
    // special-pool dealer be silently picked for a NORMAL table (the exact leak Patch 5d
    // closed). With no data-level way to fail closed, THROW so the caller's own error handling
    // applies. Every current call site (pickNextDealer.ts's non-special-table branch,
    // passRRotationPlanner, replanSingleTable) already wraps this in a try/catch that fails
    // safe (returns no candidates / skips this tick) rather than proceeding on uncertain data.
    const failure = classifyPostgrestError(ksErr);
    console.warn("[featureTableGate] reserved_dealers_gate_failed", {
      stage: "app_settings",
      status: failure.status,
      code: failure.sanitizedCode,
    });
    throw new Error(`getReservedDealerIds_app_settings_${failure.status}`);
  }
  const killSwitchOn = (ksRow as { value?: unknown } | null)?.value === true
    || (ksRow as { value?: unknown } | null)?.value === "true";
  if (!killSwitchOn) return out; // inert when off

  // Special tables only (push the predicate into the query).
  const { data: profiles, error: profErr } = await admin
    .from("dealer_table_profiles")
    .select("table_id")
    .or("table_mode.eq.feature,is_final.eq.true");
  if (profErr) {
    const failure = classifyPostgrestError(profErr);
    console.warn("[featureTableGate] reserved_dealers_gate_failed", {
      stage: "dealer_table_profiles",
      status: failure.status,
      code: failure.sanitizedCode,
    });
    throw new Error(`getReservedDealerIds_dealer_table_profiles_${failure.status}`);
  }
  const specialIds = (profiles ?? []).map((p: { table_id: string }) => p.table_id);
  if (specialIds.length === 0) return out;

  const { data: members, error: memErr } = await admin
    .from("dealer_table_pool_members")
    .select("dealer_id")
    .in("table_id", specialIds);
  if (memErr) {
    const failure = classifyPostgrestError(memErr);
    console.warn("[featureTableGate] reserved_dealers_gate_failed", {
      stage: "dealer_table_pool_members",
      status: failure.status,
      code: failure.sanitizedCode,
    });
    throw new Error(`getReservedDealerIds_dealer_table_pool_members_${failure.status}`);
  }
  for (const m of (members ?? []) as Array<{ dealer_id: string }>) out.add(m.dealer_id);
  return out;
}
