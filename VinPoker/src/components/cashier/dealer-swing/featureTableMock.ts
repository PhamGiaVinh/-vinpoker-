/**
 * featureTableStore (filename kept as featureTableMock.ts for import stability) —
 * Dealer Swing Feature/Final table dealer-pool store.
 *
 * Patch 6: now RPC-BACKED (was an in-memory mock in Patch 1). The same getProfile /
 * useFeatureTableVersion / pure-derivation API surface is preserved so consumers
 * (badge, border, box, dialog) barely change; only the data source moved from a local
 * Map to the live Patch-3 RPCs:
 *   - READ:  get_table_dealer_rules(p_club_id)  → hydrateFromRules() fills the cache
 *            (P1-B: NEVER select dealer_table_profiles/_pool_members directly — RLS blocks floor)
 *   - WRITE: set_table_dealer_mode + set_table_dealer_pool  (saveProfileToDb), then refetch
 * The enforcement kill-switch app_settings('dealer_feature_tables_enabled') is read separately
 * (useFeatureEnforcementEnabled) for the honest "config saved but enforcement OFF" banner.
 *
 * Mirrors ADR-012: base mode (normal|feature) + a separate is_final flag; "special" =
 * feature OR final; FINAL takes precedence over FEATURE for the badge/border (DR-8a).
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DealerTableMode = "normal" | "feature";

export interface FeatureTablePoolMember {
  dealerId: string;
  name: string;
  isPrimary: boolean;
}

export interface FeatureTableProfile {
  tableMode: DealerTableMode;
  isFinal: boolean;
  allowOverride: boolean;
  pool: FeatureTablePoolMember[];
}

const EMPTY: FeatureTableProfile = {
  tableMode: "normal",
  isFinal: false,
  allowOverride: false,
  pool: [],
};

const store = new Map<string, FeatureTableProfile>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

export function getProfile(tableId: string): FeatureTableProfile {
  return store.get(tableId) ?? EMPTY;
}

/** Local cache write (kept for optimistic use). Patch 6 writes go through saveProfileToDb. */
export function setProfile(tableId: string, p: FeatureTableProfile): void {
  const isDefault = p.tableMode === "normal" && !p.isFinal && !p.allowOverride && p.pool.length === 0;
  if (isDefault) store.delete(tableId);
  else store.set(tableId, p);
  emit();
}

export function isSpecial(p: FeatureTableProfile): boolean {
  return p.tableMode === "feature" || p.isFinal;
}

export function modeLabel(p: FeatureTableProfile): string {
  return p.isFinal ? "Final" : p.tableMode === "feature" ? "Tâm điểm" : "Thường";
}

/** Filter category for the right-rail box + future grid filter. */
export type FeatureFilter = "all" | "normal" | "feature" | "final";
export function matchesFilter(p: FeatureTableProfile, f: FeatureFilter): boolean {
  switch (f) {
    case "all": return true;
    case "final": return p.isFinal;
    case "feature": return p.tableMode === "feature" && !p.isFinal;
    case "normal": return !isSpecial(p);
  }
}

export interface FeatureBadgeStyle {
  key: "final" | "feature";
  label: string;
  /** badge pill classes */
  badgeClass: string;
  /** card border + glow accent */
  borderClass: string;
}

/** FINAL precedence over FEATURE (ADR-012 DR-8a). Returns null for normal tables. */
export function featureBadgeFor(p: FeatureTableProfile): FeatureBadgeStyle | null {
  if (p.isFinal) {
    return {
      key: "final",
      label: "Final",
      badgeClass: "border-amber-400/40 bg-amber-400/10 text-amber-400",
      borderClass: "border-amber-400/60 shadow-[0_0_22px_hsl(var(--warning)/0.18)]",
    };
  }
  if (p.tableMode === "feature") {
    return {
      key: "feature",
      label: "Tâm điểm",
      badgeClass: "border-success/40 bg-success/10 text-success",
      borderClass: "border-success/55 shadow-[0_0_22px_hsl(var(--success)/0.16)]",
    };
  }
  return null;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function getVersion(): number { return version; }

/** Re-render hook: bumps when any profile changes. */
export function useFeatureTableVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch 6 — RPC wiring (P1-B: reads ONLY via get_table_dealer_rules)
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of one table from get_table_dealer_rules.tables[] (see migration 20261105000000). */
interface RulesTable {
  table_id: string;
  table_mode: string;
  is_final: boolean;
  allow_override: boolean;
  display_label: string | null;
  pool: { dealer_id: string; name: string; priority: number; is_primary: boolean }[];
}
interface RulesResult {
  club_id: string;
  as_of: string;
  tables: RulesTable[];
}

/** Replace the cache from a get_table_dealer_rules result. Tables without a profile row are
 *  absent → getProfile() returns EMPTY (= normal), matching the DB. */
export function hydrateFromRules(rules: RulesResult | null): void {
  store.clear();
  for (const t of rules?.tables ?? []) {
    store.set(t.table_id, {
      tableMode: t.table_mode === "feature" ? "feature" : "normal",
      isFinal: !!t.is_final,
      allowOverride: !!t.allow_override,
      pool: (t.pool ?? []).map((pm) => ({ dealerId: pm.dealer_id, name: pm.name, isPrimary: !!pm.is_primary })),
    });
  }
  emit();
}

async function fetchAndHydrate(clubId: string): Promise<void> {
  const { data, error } = await supabase.rpc("get_table_dealer_rules", { p_club_id: clubId });
  if (error) throw new Error(error.message);
  hydrateFromRules(data as unknown as RulesResult | null);
}

/** Load this club's feature/final rules into the cache (on mount + clubId change). */
export function useFeatureTableRules(clubId: string | null | undefined): {
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    setError(null);
    try {
      await fetchAndHydrate(clubId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { void refetch(); }, [refetch]);

  return { loading, error, refetch };
}

/** Persist a table profile via the live RPCs, then re-hydrate the cache. Throws on RPC error. */
export async function saveProfileToDb(tableId: string, clubId: string, p: FeatureTableProfile): Promise<void> {
  const { error: e1 } = await supabase.rpc("set_table_dealer_mode", {
    p_table_id: tableId,
    p_table_mode: p.tableMode,
    p_is_final: p.isFinal,
    p_allow_override: p.allowOverride,
  });
  if (e1) throw new Error(e1.message);

  // pool order encodes priority (index): get_table_dealer_rules returns pool ordered by priority asc.
  const members = p.pool.map((m, i) => ({ dealer_id: m.dealerId, is_primary: m.isPrimary, priority: i }));
  const { error: e2 } = await supabase.rpc("set_table_dealer_pool", {
    p_table_id: tableId,
    p_members: members,
  });
  if (e2) throw new Error(e2.message);

  await fetchAndHydrate(clubId); // refresh cache → emit → badge/box/dialog reflect saved state
}

/** Read the enforcement kill-switch app_settings('dealer_feature_tables_enabled') for the honest
 *  "config saved but enforcement OFF" banner. Readable by floor (app_settings "public read" RLS).
 *  Canonical truthiness: JSONB boolean → value === true || value === 'true'. */
export function useFeatureEnforcementEnabled(): { enabled: boolean | null; loading: boolean } {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "dealer_feature_tables_enabled")
        .maybeSingle();
      if (!alive) return;
      const v = (data as { value?: unknown } | null)?.value;
      setEnabled(v === true || v === "true");
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);
  return { enabled, loading };
}
