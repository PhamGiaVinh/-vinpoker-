// ═══════════════════════════════════════════════════════════════════════════════
// Close Report (Chốt giải) — pure, DB-free settlement reconciliation math.
// ═══════════════════════════════════════════════════════════════════════════════
//
// Money doctrine (VBacker 09-ACCOUNTING-CONTROL):
//   • Buy-in and prize are PASS-THROUGH — player money moving through the club,
//     NEVER counted as club revenue.
//   • Club revenue for a tournament = rake + service fee only.
//   • Free-rake waives the RAKE on an entry; the service fee always applies.
//     (mirrors getTournamentPrice in ./tournament.ts)
//
// This module recomputes NOTHING that is a saved value elsewhere (payroll, ledger).
// It only aggregates immutable per-entry figures + the recorded eliminations/cashouts
// and exposes every stream + the reconciliation delta transparently, so the operator
// sees WHY the drawer does or doesn't balance instead of a hidden pass/fail.

export type CloseReportSource = "online" | "offline" | "reentry";

/** One confirmed tournament_registrations row, reduced to its money-relevant fields. */
export interface CloseReportEntry {
  /** total_pay actually charged = buyIn + rakeCharged + serviceCharged. */
  totalPay: number;
  buyIn: number;
  /** rake CHARGED on this entry (0 when a free-rake slot waived it). */
  rakeCharged: number;
  /** service fee CHARGED on this entry (0 when the service-fee feature is off). */
  serviceCharged: number;
  source: CloseReportSource;
  usedFreeRake: boolean;
}

/** One recorded final placement (tournament_eliminations: position, prize). */
export interface CloseReportPayout {
  position: number;
  prize: number;
}

export interface CloseReportInput {
  /** confirmed entries only (status = 'confirmed'). */
  entries: CloseReportEntry[];
  /** final payouts by place (from tournament_eliminations). */
  payouts: CloseReportPayout[];
  /** manually-entered cash-outs (leaderboard_entries.cashout); optional side stream. */
  cashouts?: number[];
}

export interface CloseReportTotals {
  // ── entries ──
  entryCount: number;
  bySource: { online: number; offline: number; reentry: number };
  reentryCount: number;
  freeRakeUsed: number;

  // ── money IN (cash collected at the desk) ──
  buyInTotal: number; // pass-through
  rakeTotal: number; // club revenue
  serviceTotal: number; // club revenue
  cashInTotal: number; // = buyIn + rake + service

  // ── money OUT (cash disbursed) ──
  prizeTotal: number; // pass-through
  cashoutTotal: number; // manual side stream
  cashOutTotal: number; // = prize + cashout

  // ── derived ──
  clubRevenue: number; // = rake + service (what the club keeps)
  overlay: number; // = max(0, prize - buyIn): club topped the pool up beyond buy-ins
  surplusToPool: number; // = max(0, buyIn - prize): buy-ins exceeded prize paid
  cashierBalance: number; // = cashIn - cashOut: what should remain in the drawer

  /** cashierBalance - clubRevenue = (buyIn - prize) - cashout: 0 in the clean pass-through case. */
  reconcileDelta: number;
  /** true when the pass-through pool balances and there is no side cash-out (drawer == club revenue). */
  reconciled: boolean;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Aggregate a tournament's confirmed entries + recorded payouts into a settlement
 * summary. Pure and deterministic — no DB, no clock, no saved-value recompute.
 */
export function computeCloseReport(input: CloseReportInput): CloseReportTotals {
  const entries = input.entries ?? [];
  const payouts = input.payouts ?? [];
  const cashouts = input.cashouts ?? [];

  const bySource = { online: 0, offline: 0, reentry: 0 };
  for (const e of entries) bySource[e.source] += 1;

  const buyInTotal = sum(entries.map((e) => e.buyIn));
  const rakeTotal = sum(entries.map((e) => e.rakeCharged));
  const serviceTotal = sum(entries.map((e) => e.serviceCharged));
  const cashInTotal = buyInTotal + rakeTotal + serviceTotal;

  const prizeTotal = sum(payouts.map((p) => p.prize));
  const cashoutTotal = sum(cashouts);
  const cashOutTotal = prizeTotal + cashoutTotal;

  const clubRevenue = rakeTotal + serviceTotal;
  const overlay = Math.max(0, prizeTotal - buyInTotal);
  const surplusToPool = Math.max(0, buyInTotal - prizeTotal);
  const cashierBalance = cashInTotal - cashOutTotal;
  const reconcileDelta = cashierBalance - clubRevenue;

  return {
    entryCount: entries.length,
    bySource,
    reentryCount: bySource.reentry,
    freeRakeUsed: entries.filter((e) => e.usedFreeRake).length,
    buyInTotal,
    rakeTotal,
    serviceTotal,
    cashInTotal,
    prizeTotal,
    cashoutTotal,
    cashOutTotal,
    clubRevenue,
    overlay,
    surplusToPool,
    cashierBalance,
    reconcileDelta,
    reconciled: reconcileDelta === 0,
  };
}
