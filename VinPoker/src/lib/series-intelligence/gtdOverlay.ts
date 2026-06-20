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

// ----------------------------------------------------------------------------
// GTD #2 — server-authoritative TRUE prize pool (two-state).
// ----------------------------------------------------------------------------

/** Result of the read-only RPC get_tournament_prize_pool (server is the source of truth). */
export interface TruePrizePool {
  prizePool: number; // SUM(buy_in) over CONFIRMED (cashier-paid) registrations
  confirmedEntryCount: number;
}

export type OverlaySource = "true" | "estimate";

export interface ResolvedOverlay {
  source: OverlaySource;
  prizeValue: number | null; // true prize pool, or the estimate
  overlay: number | null; // max(0, gtd − prizeValue)
  covered: boolean | null;
  label: string; // honest source label
}

export const TRUE_LABEL = "thực thu (cashier-confirmed)";
export const ESTIMATE_LABEL = "ước tính (entry × buy-in)";

/**
 * Pick the honest overlay per row. Uses the SERVER's true prize pool ONLY when it exists AND
 * there is at least one confirmed (cashier-paid) entry; otherwise falls back to the #415
 * estimate. The client never recomputes the true number — it only reads `truePrize` from the RPC.
 */
export function resolveOverlay(row: GtdOverlayRow, truePrize: TruePrizePool | null): ResolvedOverlay {
  if (truePrize !== null && truePrize.confirmedEntryCount > 0) {
    return {
      source: "true",
      prizeValue: truePrize.prizePool,
      overlay: Math.max(0, row.gtd - truePrize.prizePool),
      covered: truePrize.prizePool >= row.gtd,
      label: TRUE_LABEL,
    };
  }
  return {
    source: "estimate",
    prizeValue: row.estimatedActual,
    overlay: row.overlay,
    covered: row.covered,
    label: ESTIMATE_LABEL,
  };
}
