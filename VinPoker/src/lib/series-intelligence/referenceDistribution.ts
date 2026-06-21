// Series Intelligence — Reference Distribution (PATCH 2, pure, client-only, READ-ONLY).
//
// Groups the SAME tournament across the whole Series Library (multiple uploaded CSVs) by a
// NORMALIZED event name, then reports an honest entries range + a confidence tier that scales with
// N (how many observations of that tournament we have). This is descriptive only — "what we've
// observed", never a model/prediction. No DB, no localStorage (the panel passes the already-loaded
// library in); reuses the SeriesEvent / Series types unchanged.
//
// IMPORTANT: events are keyed by normalized event_name, NOT by event_id. event_id is series-local
// (`csv-<rowNo>`) and collides across series — see NOTE(PATCH 2) in seriesLibrary.ts.

import type { Series } from "./seriesLibrary";
import type { SeriesEvent } from "./nativeData";

export interface EventObservation {
  event: SeriesEvent; // the original CSV row
  seriesId: string;
  seriesName: string;
  obsKey: string; // stable per-observation id = seriesId::event_id (anchor for manual overrides)
  isOverridden: boolean; // true when a manual override placed this event into its group
}

export interface EventGroup {
  normalizedName: string; // effective grouping key: auto-normalized name OR a manual override label
  displayName: string; // representative original name (first seen)
  members: EventObservation[];
  n: number; // = members.length
  isOverridden: boolean; // true when this group's key came from a manual override
}

/** Stable per-observation id used to anchor manual grouping overrides (PATCH 2.5). */
export function obsKeyOf(seriesId: string, eventId: string): string {
  return `${seriesId}::${eventId}`;
}

export interface ConfidenceTier {
  level: "thấp" | "trung bình" | "cao";
  basis: string; // honest basis label
}

export interface GroupStats {
  n: number;
  entries: { low: number | null; base: number | null; high: number | null };
  medianBuyIn: number | null;
  medianFee: number | null;
  tier: ConfidenceTier;
  method: "minmax" | "p20p80"; // how low/high were derived
}

// ---------------------------------------------------------------------------
// name normalization
// ---------------------------------------------------------------------------

// Trailing version tokens to strip (applied repeatedly, right-to-left):
//  - a 4-digit year (19xx / 20xx)
//  - a #N marker
//  - a season/series keyword followed by a number (season 3, vol.4, mùa 2, lần 5)
// A BARE trailing number (no keyword, not a year, not #N) is KEPT — e.g. "Event 2", "Flight 1".
const YEAR_RE = /\s+(?:19|20)\d{2}$/;
const HASH_RE = /\s*#\s*\d+$/;
const SEASON_RE = /\s+(?:season|series|mùa|mua|vol|lần|lan)\.?\s*\d+$/;

/** lowercase → collapse whitespace → strip trailing version tokens (year / #N / season+N). */
export function normalizeEventName(name: string | null | undefined): string {
  let s = (name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  // strip repeatedly so "apt main event 2024 #5" → "apt main event"
  for (;;) {
    const before = s;
    s = s.replace(HASH_RE, "").trimEnd();
    s = s.replace(YEAR_RE, "").trimEnd();
    s = s.replace(SEASON_RE, "").trimEnd();
    if (s === before) break;
  }
  return s.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// grouping
// ---------------------------------------------------------------------------

/**
 * Group every event across the whole library by its EFFECTIVE key: a manual override label
 * (PATCH 2.5) when present for that observation, otherwise the auto-normalized name. Passing no
 * `overrideLabels` reproduces the pure auto-grouping exactly. Deterministic order: N desc, then name.
 */
export function groupEvents(series: Series[], overrideLabels?: Record<string, string>): EventGroup[] {
  const map = new Map<string, EventGroup>();
  for (const s of series) {
    for (const event of s.events) {
      const autoKey = normalizeEventName(event.event_name);
      const oKey = obsKeyOf(s.id, event.event_id);
      const manual = overrideLabels?.[oKey];
      const isManual = typeof manual === "string" && manual !== "";
      const key = isManual ? manual : autoKey;
      let group = map.get(key);
      if (!group) {
        group = {
          normalizedName: key,
          displayName: event.event_name?.trim() || "(không tên)",
          members: [],
          n: 0,
          isOverridden: false,
        };
        map.set(key, group);
      }
      group.members.push({ event, seriesId: s.id, seriesName: s.name, obsKey: oKey, isOverridden: isManual });
      if (isManual) group.isOverridden = true;
    }
  }
  const groups = Array.from(map.values());
  for (const g of groups) g.n = g.members.length;
  groups.sort((a, b) => b.n - a.n || a.displayName.localeCompare(b.displayName, "vi"));
  return groups;
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

/** Linear-interpolation percentile over a pre-sorted ascending array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 50);
}

const finiteNums = (vals: Array<number | null>): number[] =>
  vals.filter((v): v is number => v !== null && Number.isFinite(v));

/** Confidence tier from the number of observations N. Honest labels only (never "Model Estimate"). */
export function confidenceTier(n: number): ConfidenceTier {
  if (n <= 1) return { level: "thấp", basis: "Giả thuyết" };
  if (n <= 4) return { level: "trung bình", basis: "Quan sát min-max" };
  return { level: "cao", basis: "Quan sát p20-p80" };
}

/**
 * Entries range + confidence for one group. base = median; low/high = min/max (N<5) or p20/p80 (N≥5).
 * Percentiles are computed over the non-null total_entries actually present in the group. Counts are
 * rounded to integers; money medians rounded to whole VND. Missing data → null (never fabricated).
 */
export function computeGroupStats(group: EventGroup): GroupStats {
  const n = group.members.length;
  const entryVals = finiteNums(group.members.map((m) => m.event.total_entries)).sort((a, b) => a - b);
  const buyIns = finiteNums(group.members.map((m) => m.event.buy_in));
  const fees = finiteNums(group.members.map((m) => m.event.fee));
  const useP = n >= 5;

  let low: number | null = null;
  let base: number | null = null;
  let high: number | null = null;
  if (entryVals.length > 0) {
    base = Math.round(percentile(entryVals, 50));
    if (useP) {
      low = Math.round(percentile(entryVals, 20));
      high = Math.round(percentile(entryVals, 80));
    } else {
      low = entryVals[0];
      high = entryVals[entryVals.length - 1];
    }
  }

  const mBuy = median(buyIns);
  const mFee = median(fees);
  return {
    n,
    entries: { low, base, high },
    medianBuyIn: mBuy === null ? null : Math.round(mBuy),
    medianFee: mFee === null ? null : Math.round(mFee),
    tier: confidenceTier(n),
    method: useP ? "p20p80" : "minmax",
  };
}
