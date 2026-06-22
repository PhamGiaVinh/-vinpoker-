// Series Intelligence — Scenario what-if simulator (Phase 4, PURE, client-only).
//
// Interactive layer over the read-only Scenario Outlook: the owner picks comparable events + sets
// TRANSPARENT assumptions (marketing push, slot factor, candidate GTD), and the tool shows the three
// Conservative / Base / Upside ENTRY ranges shifted by the owner-set factor, plus a per-band GTD overlay
// (now that native GTD is live). Rules-based + deterministic — NOT a model, NOT a prediction, NOT a
// commitment. Reuses the shared quantile bands (`buildScenarioEntryBands`) and the overlay math
// (overlay = max(0, GTD − entries × buy-in)). Money is by formula; no DB, no Supabase here.

import type { SeriesEvent } from "./nativeData";
import { buildScenarioEntryBands, type Range, type ScenarioConfidence } from "./scenarioOutlook";

export interface ComparableFilter {
  dayOfWeek?: number | null; // 0..6 (Sun..Sat) from event_date local time; null = any
  hourFrom?: number | null; // inclusive start hour 0..23; null = any
  hourTo?: number | null; // inclusive end hour 0..23; null = any
  typeKeyword?: string | null; // case-insensitive substring of event_name; null/empty = any
}

export interface WhatIfAssumptions {
  marketingPushPct: number; // 0..100 → +% uplift to the band (owner-set, shown)
  slotFactorPct: number; // -50..50 → ± calendar/slot factor (owner-set, shown)
  candidateGtd: number | null; // VND the owner is considering committing; null = no overlay
}

export type ScenarioKind = "conservative" | "base" | "upside";

export interface ScenarioWhatIfBand {
  kind: ScenarioKind;
  label: string;
  entryRange: Range; // entry band AFTER the assumption factor (+ widen when noisy)
  prizeBand: Range | null; // entryRange × median buy-in (prize-contribution estimate); null when buy-in missing
  overlay: Range | null; // per-band overlay vs candidateGtd = max(0, GTD − prizeBand); null when not derivable
}

export interface ScenarioWhatIfResult {
  available: boolean;
  bands: ScenarioWhatIfBand[];
  confidence: ScenarioConfidence;
  noisy: boolean; // sampleSize < 4 → band widened + flagged Noisy
  sampleSize: number; // comparables with an entry count
  assumptionFactor: number; // net factor applied to the bands (shown to the owner)
  basisEventNames: string[]; // the comparables feeding the bands (transparency)
  missingDataNotes: string[];
  disclaimer: string;
}

const DISCLAIMER =
  "Kịch bản what-if tham khảo cho MỘT event tương tự — dải tính từ entry quan sát × hệ số bạn đặt, KHÔNG phải dự đoán/cam kết. Overlay là ƯỚC TÍNH (entry × buy-in), chưa gồm add-on / bounty / re-entry đặc biệt / điều chỉnh payout.";
const WIDEN_FACTOR = 0.15; // < 4 comparables → widen each band by ±15%
const r0 = (x: number): number => Math.round(x);

function localDow(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getDay();
}
function localHour(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getHours();
}
function median(values: Array<number | null>): number | null {
  const s = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Filter events to "comparable" by day-of-week / hour window / name keyword. Pure. */
export function filterComparableEvents(events: SeriesEvent[], f: ComparableFilter): SeriesEvent[] {
  return events.filter((e) => {
    if (f.dayOfWeek != null) {
      const d = localDow(e.event_date);
      if (d === null || d !== f.dayOfWeek) return false;
    }
    if (f.hourFrom != null || f.hourTo != null) {
      const h = localHour(e.event_date);
      if (h === null) return false;
      if (f.hourFrom != null && h < f.hourFrom) return false;
      if (f.hourTo != null && h > f.hourTo) return false;
    }
    const k = (f.typeKeyword ?? "").trim().toLowerCase();
    if (k && !(e.event_name ?? "").toLowerCase().includes(k)) return false;
    return true;
  });
}

/** Net multiplier from the owner's assumptions — multiplicative + transparent (shown in the UI). */
export function netAssumptionFactor(a: WhatIfAssumptions): number {
  const m = Number.isFinite(a.marketingPushPct) ? a.marketingPushPct : 0;
  const s = Number.isFinite(a.slotFactorPct) ? a.slotFactorPct : 0;
  return (1 + m / 100) * (1 + s / 100);
}

export interface WhatIfOpts {
  selectedIds?: string[] | null; // explicit comparable selection; empty/absent → use filter, else all
  filter?: ComparableFilter;
  assumptions: WhatIfAssumptions;
}

function notesFor(pool: SeriesEvent[], sampleSize: number, factor: number, medBuyIn: number | null, hasGtd: boolean): string[] {
  const notes: string[] = [];
  const n = pool.length;
  if (sampleSize < 4) notes.push(`Chỉ ${sampleSize} giải tương đương có số entry — dải bị nới rộng, độ tin cậy thấp (Noisy).`);
  const mEntries = pool.filter((e) => e.total_entries === null).length;
  if (mEntries > 0) notes.push(`${mEntries}/${n} giải thiếu số entry — không vào cơ sở kịch bản.`);
  if (medBuyIn === null) notes.push("Thiếu buy-in ở các giải tương đương — chưa tính được prize/overlay.");
  if (hasGtd && medBuyIn === null) notes.push("Có đặt GTD nhưng thiếu buy-in nên chưa ước tính được overlay.");
  if (Math.abs(factor - 1) > 1e-9) {
    const pct = Math.round((factor - 1) * 100);
    notes.push(`Dải đã nhân hệ số giả định ${pct >= 0 ? "+" : ""}${pct}% — đây là what-if bạn đặt, có thể vượt vùng quan sát.`);
  }
  return notes;
}

/**
 * Build the three what-if entry bands (+ prize + overlay) from the selected/filtered comparables and the
 * owner's assumptions. Deterministic. Returns `available:false` when no comparable has an entry count.
 */
export function simulateScenarioWhatIf(events: SeriesEvent[], opts: WhatIfOpts): ScenarioWhatIfResult {
  const assumptions = opts.assumptions;
  const factor = netAssumptionFactor(assumptions);

  let pool = events;
  if (opts.selectedIds && opts.selectedIds.length > 0) {
    const set = new Set(opts.selectedIds);
    pool = events.filter((e) => set.has(e.event_id));
  } else if (opts.filter) {
    pool = filterComparableEvents(events, opts.filter);
  }

  const withEntries = pool.filter((e) => e.total_entries !== null);
  const entries = withEntries.map((e) => e.total_entries as number).sort((a, b) => a - b);
  const sampleSize = entries.length;
  const noisy = sampleSize > 0 && sampleSize < 4;
  const confidence: ScenarioConfidence = sampleSize >= 8 ? "high" : sampleSize >= 4 ? "medium" : "low";
  const basisEventNames = withEntries.map((e) => e.event_name ?? "(không tên)");
  const medBuyIn = median(pool.map((e) => e.buy_in));
  const hasGtd = assumptions.candidateGtd !== null && assumptions.candidateGtd > 0;
  const missingDataNotes = notesFor(pool, sampleSize, factor, medBuyIn, hasGtd);

  if (sampleSize === 0) {
    return { available: false, bands: [], confidence: "low", noisy: false, sampleSize: 0, assumptionFactor: factor, basisEventNames, missingDataNotes, disclaimer: DISCLAIMER };
  }

  const raw = buildScenarioEntryBands(entries);

  const shape = (r: Range): Range => {
    let low = r.low * factor;
    let high = r.high * factor;
    if (noisy) {
      low *= 1 - WIDEN_FACTOR;
      high *= 1 + WIDEN_FACTOR;
    }
    return { low: r0(Math.max(0, low)), high: r0(Math.max(0, high)) };
  };

  const mkBand = (kind: ScenarioKind, label: string, base: Range): ScenarioWhatIfBand => {
    const entryRange = shape(base);
    const prizeBand: Range | null = medBuyIn !== null ? { low: r0(entryRange.low * medBuyIn), high: r0(entryRange.high * medBuyIn) } : null;
    let overlay: Range | null = null;
    if (hasGtd && prizeBand !== null) {
      const g = assumptions.candidateGtd as number;
      // overlay is larger when the prize pool is smaller → low-entry edge gives the high overlay
      overlay = { low: r0(Math.max(0, g - prizeBand.high)), high: r0(Math.max(0, g - prizeBand.low)) };
    }
    return { kind, label, entryRange, prizeBand, overlay };
  };

  const bands: ScenarioWhatIfBand[] = [
    mkBand("conservative", "Thận trọng", raw.conservative),
    mkBand("base", "Cơ sở", raw.base),
    mkBand("upside", "Tích cực", raw.upside),
  ];

  return { available: true, bands, confidence, noisy, sampleSize, assumptionFactor: factor, basisEventNames, missingDataNotes, disclaimer: DISCLAIMER };
}
