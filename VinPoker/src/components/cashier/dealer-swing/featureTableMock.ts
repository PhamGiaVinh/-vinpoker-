/**
 * featureTableMock — Patch 1 (UI mock ONLY) local store for the Dealer Swing
 * Feature/Final table experiment. NO DB, NO RPC: an in-memory map keyed by
 * game_tables.id, lost on reload. Replaced in Salary-/Patch 6 by the real
 * `get_table_dealer_rules` read + `set_table_dealer_mode/pool` writes once the
 * backend (ADR 012) is applied. Gated everywhere by FEATURES.dealerFeatureTables.
 *
 * Mirrors ADR-012 semantics for visual UAT: base mode (normal|feature) + a
 * separate `is_final` flag; "special" = feature OR final; FINAL takes precedence
 * over FEATURE for the badge/border (DR-8a).
 */
import { useSyncExternalStore } from "react";

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
