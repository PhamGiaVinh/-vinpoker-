// Series Intelligence — manual grouping overrides (PATCH 2.5, pure + persistence, client-only).
//
// The auto reference-distribution groups events by normalized name; sometimes that's wrong (two
// different tournaments share a name, or the same tournament is spelled too differently to merge).
// This module lets the owner override grouping MANUALLY: a map of obsKey → manual group label.
// `referenceDistribution.groupEvents(series, labels)` then groups by that label instead of the auto
// name. A single primitive covers both merge AND split: "assign the selected observations a shared
// new label" merges them together (and splits them away from whatever they were in).
//
// SAFETY: client-only, localStorage only, never touches the DB. The stored JSON is untrusted — here
// we DO iterate its keys (they are obsKeys), so `isSafeKey` is genuinely load-bearing (unlike the
// fixed-shape seriesLibrary validator). Labels are coerced to non-empty strings; everything else dropped.

export const GROUPING_OVERRIDES_STORAGE_KEY = "vinpoker.seriesGroupingOverrides.v1";
export const GROUPING_OVERRIDES_VERSION = 1;
export const MAX_OVERRIDES_BYTES = 500_000; // ~0.5MB cap (labels are tiny)
export const MANUAL_LABEL_PREFIX = "manual::";

export interface GroupingOverrides {
  version: number;
  labels: Record<string, string>; // obsKey → manual group label
}

export function emptyOverrides(): GroupingOverrides {
  return { version: GROUPING_OVERRIDES_VERSION, labels: {} };
}

/** Reject dangerous property names — load-bearing here because we iterate untrusted stored keys. */
export function isSafeKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

/**
 * Deterministic manual group label for a set of observations (the smallest obsKey, prefixed).
 * Stable across reloads for the same selection; unique enough to not collide with auto names.
 */
export function makeManualLabel(obsKeys: string[]): string {
  const min = [...obsKeys].sort()[0] ?? "";
  return MANUAL_LABEL_PREFIX + min;
}

// --- reducers (immutable) ---------------------------------------------------

/** Assign every obsKey the same label (merge selected together / split them away from their group). */
export function mergeUnderLabel(overrides: GroupingOverrides, obsKeys: string[], label: string): GroupingOverrides {
  if (obsKeys.length === 0 || label === "") return overrides;
  const labels = { ...overrides.labels };
  for (const k of obsKeys) if (isSafeKey(k)) labels[k] = label;
  return { ...overrides, labels };
}

/** Drop overrides for the given obsKeys → they revert to auto grouping. */
export function resetKeys(overrides: GroupingOverrides, obsKeys: string[]): GroupingOverrides {
  if (obsKeys.length === 0) return overrides;
  const labels = { ...overrides.labels };
  let changed = false;
  for (const k of obsKeys) {
    if (k in labels) {
      delete labels[k];
      changed = true;
    }
  }
  return changed ? { ...overrides, labels } : overrides;
}

export function clearOverrides(): GroupingOverrides {
  return emptyOverrides();
}

/** Drop labels whose obsKey is no longer in the loaded library (orphan prune). Same ref if unchanged. */
export function pruneOverrides(overrides: GroupingOverrides, validObsKeys: Set<string>): GroupingOverrides {
  const labels: Record<string, string> = {};
  let changed = false;
  for (const k of Object.keys(overrides.labels)) {
    if (validObsKeys.has(k)) labels[k] = overrides.labels[k];
    else changed = true;
  }
  return changed ? { ...overrides, labels } : overrides;
}

// --- persistence + validator ------------------------------------------------

/** Validate + sanitize a parsed envelope → clean overrides. Never throws. Prototype-pollution-safe. */
export function validateOverrides(parsed: unknown): GroupingOverrides {
  if (parsed === null || typeof parsed !== "object") return emptyOverrides();
  const env = parsed as Record<string, unknown>;
  if (env.version !== GROUPING_OVERRIDES_VERSION) return emptyOverrides();
  const rawLabels = env.labels;
  const labels: Record<string, string> = {};
  if (rawLabels !== null && typeof rawLabels === "object") {
    for (const k of Object.keys(rawLabels as object)) {
      if (!isSafeKey(k)) continue; // skip __proto__ / constructor / prototype
      const v = (rawLabels as Record<string, unknown>)[k];
      if (typeof v === "string" && v !== "") labels[k] = v;
    }
  }
  return { version: GROUPING_OVERRIDES_VERSION, labels };
}

export function loadOverrides(): GroupingOverrides {
  if (typeof localStorage === "undefined") return emptyOverrides();
  try {
    const raw = localStorage.getItem(GROUPING_OVERRIDES_STORAGE_KEY);
    if (!raw) return emptyOverrides();
    return validateOverrides(JSON.parse(raw));
  } catch {
    return emptyOverrides();
  }
}

export function saveOverrides(overrides: GroupingOverrides): boolean {
  const serialized = JSON.stringify({ version: GROUPING_OVERRIDES_VERSION, labels: overrides.labels });
  if (serialized.length > MAX_OVERRIDES_BYTES) return false;
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(GROUPING_OVERRIDES_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearStoredOverrides(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(GROUPING_OVERRIDES_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
