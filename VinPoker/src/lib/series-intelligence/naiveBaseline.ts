// Series Intelligence — W5 naive baseline (PURE). The quant rule: always show a forecast next to the
// dumbest honest guess, so the owner can feel whether the model earns its complexity. Here that guess =
// the mean turnout of the last N SAME-TYPE events that happened BEFORE the forecast date (leakage-safe:
// only past events, never the one being forecast). Falls back to all recent events when the type can't
// be pinned. Measured fact only — no model, no prediction.

import type { SeriesEvent } from "./nativeData";
import { typeOf, TYPE_LABEL, type SeriesEventType } from "./seriesEventType";

export interface NaiveBaseline {
  /** Mean total_entries of the last N qualifying events, or null when none qualify. */
  value: number | null;
  /** How many events actually went into the mean (≤ n). */
  count: number;
  /** true = restricted to the forecast's own event type; false = fell back to all types. */
  sameType: boolean;
  /** Plain label of the type used (when sameType), for the copy. */
  typeLabel: string | null;
}

const mean = (xs: number[]): number => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Last-N-average turnout baseline for a forecast. `typeKeyword` picks the event type (same helper the
 * forecast uses); `beforeDate` is the forecast's own event date — only STRICTLY earlier events count.
 * Deterministic + pure.
 */
export function naiveBaseline(
  events: SeriesEvent[],
  typeKeyword: string | null,
  beforeDate: string | null,
  n = 3,
): NaiveBaseline {
  const cutoff = beforeDate ? new Date(beforeDate).getTime() : null;
  const past = events.filter((e) => {
    if (e.total_entries === null || !e.event_date) return false;
    const t = new Date(e.event_date).getTime();
    if (Number.isNaN(t)) return false;
    return cutoff === null || t < cutoff; // strictly earlier → no leakage of the forecast event itself
  });

  const targetType: SeriesEventType = typeOf("", typeKeyword);
  const trimmed = typeKeyword?.trim();
  const sameTypePool = trimmed ? past.filter((e) => typeOf(e.event_name) === targetType) : [];
  const useSameType = sameTypePool.length > 0;
  const pool = useSameType ? sameTypePool : past;

  const lastN = [...pool]
    .sort((a, b) => new Date(b.event_date as string).getTime() - new Date(a.event_date as string).getTime())
    .slice(0, n);
  const entries = lastN.map((e) => e.total_entries as number);

  return {
    value: entries.length > 0 ? mean(entries) : null,
    count: entries.length,
    sameType: useSameType,
    typeLabel: useSameType ? TYPE_LABEL[targetType] : null,
  };
}

/** Model-vs-baseline gap in %, positive = model forecasts HIGHER than the naive guess. null when N/A. */
export function baselineDeltaPct(forecastBase: number | null, baseline: number | null): number | null {
  if (forecastBase === null || baseline === null || baseline <= 0) return null;
  return Math.round(((forecastBase - baseline) / baseline) * 100);
}
