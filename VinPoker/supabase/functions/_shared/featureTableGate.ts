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

  const { data: ksRow } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "dealer_feature_tables_enabled")
    .maybeSingle();
  const killSwitchOn = (ksRow as { value?: unknown } | null)?.value === true
    || (ksRow as { value?: unknown } | null)?.value === "true";
  if (!killSwitchOn) return null; // inert when off

  const { data: profile } = await admin
    .from("dealer_table_profiles")
    .select("table_mode, is_final")
    .eq("table_id", tableId)
    .maybeSingle();
  const isSpecial = !!profile
    && ((profile as { table_mode?: string }).table_mode === "feature"
      || (profile as { is_final?: boolean }).is_final === true);
  if (!isSpecial) return null; // normal table → no pool filter

  const { data: poolRows } = await admin
    .from("dealer_table_pool_members")
    .select("dealer_id")
    .eq("table_id", tableId);
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

  const { data: ksRow } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "dealer_feature_tables_enabled")
    .maybeSingle();
  const killSwitchOn = (ksRow as { value?: unknown } | null)?.value === true
    || (ksRow as { value?: unknown } | null)?.value === "true";
  if (!killSwitchOn) return out; // inert when off

  const { data: profiles } = await admin
    .from("dealer_table_profiles")
    .select("table_id, table_mode, is_final")
    .in("table_id", uniq);
  const specialIds = (profiles ?? [])
    .filter((p: { table_mode?: string; is_final?: boolean }) =>
      p.table_mode === "feature" || p.is_final === true)
    .map((p: { table_id: string }) => p.table_id);
  if (specialIds.length === 0) return out;

  // Seed every special table with an empty pool first → "no member" = clean shortage.
  for (const id of specialIds) out.set(id, new Set<string>());

  const { data: members } = await admin
    .from("dealer_table_pool_members")
    .select("table_id, dealer_id")
    .in("table_id", specialIds);
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

  const { data: ksRow } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "dealer_feature_tables_enabled")
    .maybeSingle();
  const killSwitchOn = (ksRow as { value?: unknown } | null)?.value === true
    || (ksRow as { value?: unknown } | null)?.value === "true";
  if (!killSwitchOn) return out; // inert when off

  // Special tables only (push the predicate into the query).
  const { data: profiles } = await admin
    .from("dealer_table_profiles")
    .select("table_id")
    .or("table_mode.eq.feature,is_final.eq.true");
  const specialIds = (profiles ?? []).map((p: { table_id: string }) => p.table_id);
  if (specialIds.length === 0) return out;

  const { data: members } = await admin
    .from("dealer_table_pool_members")
    .select("dealer_id")
    .in("table_id", specialIds);
  for (const m of (members ?? []) as Array<{ dealer_id: string }>) out.add(m.dealer_id);
  return out;
}
