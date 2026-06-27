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
