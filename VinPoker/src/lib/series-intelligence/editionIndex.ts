// Series Intelligence — edition indexing (PURE, leakage-safe). A tournament brand runs across many
// editions (APT Main #1, #2, …); the review (P0-1/P1-4) wants an edition-trend feature + within-series
// grouping. This reuses the SAME name normalization as referenceDistribution so "APT Main 2024 #5" and
// "APT Main #6" group as one brand. Only PAST editions count toward an event's number (no leakage).

import type { SeriesEvent } from "./nativeData";
import { normalizeEventName } from "./referenceDistribution";

export interface EditionInfo {
  /** Normalized brand key (shared with referenceDistribution grouping). */
  normalizedName: string;
  /** 1-based edition number = (# same-brand editions strictly BEFORE this date) + 1. */
  edition: number;
  /** How many prior same-brand editions exist (edition − 1). */
  priorCount: number;
}

const time = (iso: string | null): number => {
  if (!iso) return NaN;
  const t = new Date(iso).getTime();
  return t;
};

/**
 * Edition number of a (name, date) within its brand, counting only STRICTLY-earlier same-brand events
 * (leakage-safe: never counts the event itself or anything on/after its date). Pure + deterministic.
 */
export function editionOf(events: SeriesEvent[], name: string | null, date: string | null): EditionInfo {
  const key = normalizeEventName(name);
  const cutoff = time(date);
  let prior = 0;
  for (const e of events) {
    if (normalizeEventName(e.event_name) !== key) continue;
    const t = time(e.event_date);
    if (!Number.isNaN(t) && !Number.isNaN(cutoff) && t < cutoff) prior += 1;
  }
  return { normalizedName: key, edition: prior + 1, priorCount: prior };
}

/**
 * Group events by normalized brand key → the events of that brand sorted oldest-first. Useful for
 * within-series analysis (TP4). Descriptive only.
 */
export function groupByBrand(events: SeriesEvent[]): Map<string, SeriesEvent[]> {
  const m = new Map<string, SeriesEvent[]>();
  for (const e of events) {
    const key = normalizeEventName(e.event_name);
    const list = m.get(key);
    if (list) list.push(e);
    else m.set(key, [e]);
  }
  for (const list of m.values()) {
    list.sort((a, b) => {
      const ta = time(a.event_date);
      const tb = time(b.event_date);
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return ta - tb;
    });
  }
  return m;
}
