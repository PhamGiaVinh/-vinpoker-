// Series Intelligence — GTD overlay ESTIMATE (Phase 3c-lite, read-only, PURE).
//
// Honest estimate of the prize-pool overlay for events that have a COMMITTED GTD:
//   estimatedActual = total_entries × buy_in   (buy_in is the prize contribution per
//                     entry; rake_amount / service_fee_amount are SEPARATE fees, not the
//                     prize pool — matches the "người chơi trả = buy-in + rake + service" model)
//   overlay = max(0, gtd − estimatedActual)    (the gap the club may have to cover)
//
// HONESTY (locked):
//  - This is an ESTIMATE FROM entry × buy-in, NOT actual collected prize pool. It EXCLUDES
//    add-ons, bounties, special re-entry pricing, and payout adjustments.
//  - `tournaments.prize_pool` is deliberately NOT used (it is stored / 0, never populated
//    from buy-ins). Never presented as "prize pool thực thu".
//  - Only events with a committed GTD are included; if GTD or entries/buy_in are missing,
//    the row degrades to null (no fabrication).

import type { SeriesEvent } from "./nativeData";

export interface GtdOverlayRow {
  event_id: string;
  event_name: string | null;
  gtd: number; // committed GTD (only events where gtd is set)
  estimatedActual: number | null; // total_entries × buy_in; null when either is missing
  overlay: number | null; // max(0, gtd − estimatedActual); null when not derivable
  covered: boolean | null; // estimatedActual >= gtd; null when not derivable
  basis: string; // e.g. "120 entry × buy-in" or the missing-data reason
}

export interface GtdOverlayResult {
  available: boolean; // at least one event has a committed GTD
  rows: GtdOverlayRow[];
  disclaimer: string;
}

const DISCLAIMER =
  "Ước tính từ entry × buy-in (CHƯA gồm add-on / bounty / re-entry đặc biệt / điều chỉnh payout) — KHÔNG phải prize pool thực thu. Overlay = phần CLB có thể phải bù nếu thực thu thấp hơn GTD.";

export function computeGtdOverlay(events: SeriesEvent[]): GtdOverlayResult {
  const rows: GtdOverlayRow[] = [];
  for (const e of events) {
    if (e.gtd === null) continue; // only events with a committed GTD
    const estimatedActual =
      e.total_entries !== null && e.buy_in !== null ? e.total_entries * e.buy_in : null;
    const overlay = estimatedActual !== null ? Math.max(0, e.gtd - estimatedActual) : null;
    const covered = estimatedActual !== null ? estimatedActual >= e.gtd : null;
    const basis =
      estimatedActual !== null
        ? `${e.total_entries} entry × buy-in`
        : "thiếu entry hoặc buy-in → chưa ước tính được";
    rows.push({
      event_id: e.event_id,
      event_name: e.event_name,
      gtd: e.gtd,
      estimatedActual,
      overlay,
      covered,
      basis,
    });
  }
  return { available: rows.length > 0, rows, disclaimer: DISCLAIMER };
}
