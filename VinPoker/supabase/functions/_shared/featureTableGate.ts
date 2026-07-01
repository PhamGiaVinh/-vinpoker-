import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    console.warn(`[featureTableGate] getFeatureTablePoolIds: app_settings query error for table ${tableId} — failing closed (empty pool): ${ksErr.message}`);
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
    console.warn(`[featureTableGate] getFeatureTablePoolIds: dealer_table_profiles query error for table ${tableId} — failing closed (empty pool): ${profErr.message}`);
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
    console.warn(`[featureTableGate] getFeatureTablePoolIds: dealer_table_pool_members query error for table ${tableId} — failing closed (empty pool): ${poolErr.message}`);
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
export async function getFeatureTablePoolsByTable(
  admin: SupabaseClient,
  tableIds: Array<string | null | undefined>,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const uniq = [...new Set(tableIds.filter(Boolean) as string[])];
  if (uniq.length === 0) return out;

  // Fail-CLOSED helper (P2 hardening, audit 2026-07-02): on an error before we know WHICH of
  // `uniq` are special, the safe assumption is "any of them might be" — map EVERY requested
  // table to an EMPTY pool (gated + zero eligible). Downstream (buildSolverTables →
  // rotationSolver.allowedByPool) that makes every table in this batch report a clean shortage
  // for this ONE planner tick (no lock/announce), instead of silently ungating a special table.
  const failClosedAll = (reason: string, detail: string): Map<string, Set<string>> => {
    console.warn(`[featureTableGate] getFeatureTablePoolsByTable: ${reason} — failing closed, every requested table treated as gated+empty this tick: ${detail}`);
    const m = new Map<string, Set<string>>();
    for (const id of uniq) m.set(id, new Set<string>());
    return m;
  };

  const { data: ksRow, error: ksErr } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "dealer_feature_tables_enabled")
    .maybeSingle();
  if (ksErr) return failClosedAll("app_settings query error", ksErr.message);
  const killSwitchOn = (ksRow as { value?: unknown } | null)?.value === true
    || (ksRow as { value?: unknown } | null)?.value === "true";
  if (!killSwitchOn) return out; // inert when off

  const { data: profiles, error: profErr } = await admin
    .from("dealer_table_profiles")
    .select("table_id, table_mode, is_final")
    .in("table_id", uniq);
  if (profErr) return failClosedAll("dealer_table_profiles query error", profErr.message);
  const specialIds = (profiles ?? [])
    .filter((p: { table_mode?: string; is_final?: boolean }) =>
      p.table_mode === "feature" || p.is_final === true)
    .map((p: { table_id: string }) => p.table_id);
  if (specialIds.length === 0) return out;

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
    console.warn(`[featureTableGate] getFeatureTablePoolsByTable: dealer_table_pool_members query error — failing closed (special tables already seeded empty): ${memErr.message}`);
    return out;
  }
  for (const m of (members ?? []) as Array<{ table_id: string; dealer_id: string }>) {
    out.get(m.table_id)?.add(m.dealer_id);
  }
  return out;
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
    console.warn(`[featureTableGate] getReservedDealerIds: app_settings query error — failing closed (throwing): ${ksErr.message}`);
    throw new Error(`getReservedDealerIds: app_settings query failed: ${ksErr.message}`);
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
    console.warn(`[featureTableGate] getReservedDealerIds: dealer_table_profiles query error — failing closed (throwing): ${profErr.message}`);
    throw new Error(`getReservedDealerIds: dealer_table_profiles query failed: ${profErr.message}`);
  }
  const specialIds = (profiles ?? []).map((p: { table_id: string }) => p.table_id);
  if (specialIds.length === 0) return out;

  const { data: members, error: memErr } = await admin
    .from("dealer_table_pool_members")
    .select("dealer_id")
    .in("table_id", specialIds);
  if (memErr) {
    console.warn(`[featureTableGate] getReservedDealerIds: dealer_table_pool_members query error — failing closed (throwing): ${memErr.message}`);
    throw new Error(`getReservedDealerIds: dealer_table_pool_members query failed: ${memErr.message}`);
  }
  for (const m of (members ?? []) as Array<{ dealer_id: string }>) out.add(m.dealer_id);
  return out;
}
