// Payout "Engine 3-neo" — pure, deterministic tournament-payout curve.
//
// Server-authoritative by design: this same module runs on the Edge (authoritative compute) and on
// the client (preview only). It has NO dependencies, NO side effects, and NO Date/random — same
// input always yields the same output, so the Edge↔client parity guard can prove they never drift.
//
// Source of truth for the α slope table + small-N behaviour: VINPOKER_PAYOUT_ENGINE_1.xlsx
// (owner-validated). See payoutEngineAlpha.ts (auto-generated, versioned).
//
// Money model (caller decides the pool — see P0-2 of the plan):
//   pool  = the distributable prize pool in VND (e.g. paid_entries × buy_in, or an operator override
//           to match a guarantee / real cage number). The engine NEVER recomputes entries × buyIn.
//   floor = the min-cash amount in VND = minCashX × (buy_in + rake). Rank N lands exactly on floor.

import {
  ALPHA,
  ALPHA_MAX_N,
  ALPHA_VERSION,
  type PayoutArchetype,
} from "./payoutEngineAlpha";

export const ENGINE_VERSION = "engine3neo-v1";
export { ALPHA_VERSION };
export type { PayoutArchetype };

/** Default min-cash multiplier per archetype. The caller may override by passing its own `floor`. */
export const MIN_CASH_X: Record<PayoutArchetype, number> = {
  DAILY: 2,
  INTL: 2,
  MULTI: 1.5,
  TRITON: 1.6,
};

export type PayoutWarning =
  | "POOL_BELOW_MIN_CASH" // pool can't cover even one min-cash → 1st takes the whole pool
  | "N_CLAMPED" // paid places reduced below ceil(entries×itm) (pool too small / entries too few)
  | "ALPHA_CLAMP_450" // N beyond the α table (entries ≳ 3000) → α clamped to N=450
  | "ROUNDING_ADJUSTED"; // nearest rounding inverted rank1<rank2 → re-rounded down deterministically

export interface PayoutRow {
  position: number;
  amount: number;
  /** Derived for display only (amount / prizePool × 100). Never authoritative. */
  percentage: number;
}

export interface PayoutTier {
  fromPosition: number;
  toPosition: number;
  amount: number;
  percentage: number;
}

export interface PayoutInput {
  /** Field size — number of paid entrants (re-entries each count as an entry). */
  entries: number;
  /** Distributable prize pool in VND (caller-decided; never recomputed here). */
  prizePool: number;
  /** Min-cash amount in VND = minCashX × (buy_in + rake). */
  floor: number;
  /** In-the-money fraction, e.g. 0.125 for 12.5%. */
  itmPercent: number;
  archetype: PayoutArchetype;
  /** Rounding unit in VND (e.g. 100000 or 1000000). See `defaultRoundingUnit`. */
  roundingUnit: number;
}

export interface PayoutResult {
  rows: PayoutRow[];
  tiers: PayoutTier[];
  prizePool: number;
  /** Paid places (N). */
  itmPlaces: number;
  /** The floor actually used (= input.floor, or = prizePool when POOL_BELOW_MIN_CASH). */
  effectiveFloor: number;
  alpha: number;
  archetype: PayoutArchetype | "CUSTOM";
  warnings: PayoutWarning[];
  engineVersion: string;
  alphaVersion: string;
  /** Σ rows.amount === prizePool (always true on success; surfaced for callers/tests). */
  sumCheck: boolean;
}

// ---- convenience helpers (caller side) -------------------------------------------------------

export function poolFromFixedBuyin(paidEntries: number, buyIn: number): number {
  return paidEntries * buyIn;
}

export function floorFor(minCashX: number, buyIn: number, rake: number): number {
  return minCashX * (buyIn + rake);
}

/** Curve was calibrated at 100k granularity for sub-2M buy-ins, 1M for larger. */
export function defaultRoundingUnit(buyIn: number): number {
  return buyIn < 2_000_000 ? 100_000 : 1_000_000;
}

// ---- core ------------------------------------------------------------------------------------

function alphaFor(arch: PayoutArchetype, n: number, warnings: PayoutWarning[]): number {
  const table = ALPHA[arch];
  if (n > ALPHA_MAX_N) {
    warnings.push("ALPHA_CLAMP_450");
    return table[ALPHA_MAX_N];
  }
  return table[n];
}

function makeRow(position: number, amount: number, prizePool: number): PayoutRow {
  return { position, amount, percentage: prizePool > 0 ? (amount / prizePool) * 100 : 0 };
}

function buildTiers(rows: PayoutRow[]): PayoutTier[] {
  const tiers: PayoutTier[] = [];
  for (const r of rows) {
    const last = tiers[tiers.length - 1];
    if (last && last.amount === r.amount) {
      last.toPosition = r.position;
    } else {
      tiers.push({ fromPosition: r.position, toPosition: r.position, amount: r.amount, percentage: r.percentage });
    }
  }
  return tiers;
}

/**
 * Round ranks 2..N−1 to the unit and let rank 1 absorb the residual so Σ = pool EXACTLY.
 *  - rank N is pinned to `floor` (the min-cash invariant: last paid = floor).
 *  - nearest rounding is order-preserving, so ranks 2..N−1 stay non-increasing; each is clamped
 *    ≥ floor (no paid place below min-cash).
 *  - if rank1 < rank2 (a flat/tiny-pool top inversion), re-round ranks 2..N−1 DOWN: this provably
 *    yields rank1 ≥ raw1 + raw2 > rank2 while keeping Σ = pool (warning ROUNDING_ADJUSTED).
 *  - final asserts: monotone non-increasing AND Σ = pool, else throw ENGINE_INVARIANT.
 */
function roundAndBalance(
  raw: number[],
  pool: number,
  floor: number,
  unit: number,
  warnings: PayoutWarning[],
): number[] {
  const N = raw.length;
  const nearest = (x: number) => Math.round(x / unit) * unit;
  const down = (x: number) => Math.floor(x / unit) * unit;

  const build = (roundFn: (x: number) => number): number[] => {
    const a = new Array<number>(N);
    a[N - 1] = floor; // rank N pinned exactly to min-cash
    for (let i = 1; i < N - 1; i++) a[i] = Math.max(roundFn(raw[i]), floor); // ranks 2..N−1
    let mid = 0;
    for (let i = 1; i < N; i++) mid += a[i];
    a[0] = pool - mid; // rank 1 absorbs the residual
    return a;
  };

  let a = build(nearest);
  if (N >= 2 && a[0] < a[1]) {
    a = build(down);
    warnings.push("ROUNDING_ADJUSTED");
  }

  for (let i = 0; i < N - 1; i++) {
    if (a[i] < a[i + 1]) throw new Error(`ENGINE_INVARIANT_MONOTONE at rank ${i + 1}<${i + 2}`);
  }
  let sum = 0;
  for (const x of a) sum += x;
  if (sum !== pool) throw new Error(`ENGINE_INVARIANT_SUM ${sum} !== ${pool}`);
  return a;
}

function finalize(
  amounts: number[],
  prizePool: number,
  itmPlaces: number,
  effectiveFloor: number,
  alpha: number,
  archetype: PayoutArchetype,
  warnings: PayoutWarning[],
): PayoutResult {
  const rows = amounts.map((a, i) => makeRow(i + 1, a, prizePool));
  let sum = 0;
  for (const r of rows) sum += r.amount;
  return {
    rows,
    tiers: buildTiers(rows),
    prizePool,
    itmPlaces,
    effectiveFloor,
    alpha,
    archetype,
    warnings,
    engineVersion: ENGINE_VERSION,
    alphaVersion: ALPHA_VERSION,
    sumCheck: sum === prizePool,
  };
}

/**
 * Compute the full payout table. Deterministic; throws on impossible inputs (caught by callers).
 * The DB `apply_payout_run` re-verifies every structural invariant — this is the source of the
 * numbers, not the only guard.
 */
export function computePayouts(input: PayoutInput): PayoutResult {
  const { entries, prizePool, floor, itmPercent, archetype, roundingUnit } = input;
  const warnings: PayoutWarning[] = [];

  if (!Number.isFinite(entries) || entries < 1) throw new Error("PAYOUT_NO_ENTRIES");
  if (!Number.isFinite(prizePool) || prizePool <= 0) throw new Error("PAYOUT_BAD_POOL");
  if (!Number.isFinite(floor) || floor <= 0) throw new Error("PAYOUT_BAD_FLOOR");
  if (!Number.isFinite(itmPercent) || itmPercent <= 0) throw new Error("PAYOUT_BAD_ITM");
  if (!Number.isFinite(roundingUnit) || roundingUnit <= 0) throw new Error("PAYOUT_BAD_UNIT");

  // Pool can't cover a single min-cash → one winner takes the whole pool.
  if (prizePool < floor) {
    warnings.push("POOL_BELOW_MIN_CASH");
    return finalize([prizePool], prizePool, 1, prizePool, 0, archetype, warnings);
  }

  // Paid places N = ceil(entries × itm%), clamped to the field and to what the pool can cover.
  const target = Math.ceil(entries * itmPercent);
  let N = target;
  if (N < 1) N = 1;
  if (N > entries) N = entries;
  const maxByPool = Math.floor(prizePool / floor);
  if (N > maxByPool) N = maxByPool;
  if (N < 1) N = 1;
  if (N < target) warnings.push("N_CLAMPED");

  if (N === 1) {
    // Single payout: winner takes the whole pool (no remainder to a non-existent 2nd place).
    return finalize([prizePool], prizePool, 1, floor, 0, archetype, warnings);
  }
  if (N === 2) {
    const a = roundAndBalance([prizePool - floor, floor], prizePool, floor, roundingUnit, warnings);
    return finalize(a, prizePool, 2, floor, alphaFor(archetype, 2, warnings), archetype, warnings);
  }

  // Power-law weights wᵢ = i^(−α); affine-shift vᵢ = wᵢ − w_N so rank N → floor exactly.
  const alpha = alphaFor(archetype, N, warnings);
  const wN = Math.pow(N, -alpha);
  const v = new Array<number>(N);
  let sumV = 0;
  for (let i = 1; i <= N; i++) {
    v[i - 1] = Math.pow(i, -alpha) - wN;
    sumV += v[i - 1];
  }
  const distributable = prizePool - N * floor;
  const raw = v.map((vi) => floor + (sumV > 0 ? distributable * (vi / sumV) : 0));

  const a = roundAndBalance(raw, prizePool, floor, roundingUnit, warnings);
  return finalize(a, prizePool, N, floor, alpha, archetype, warnings);
}

// ---- CUSTOM mode (native server-authoritative; club-specified basis points) -------------------

export const CUSTOM_ENGINE_VERSION = "custom3neo-v1";

export interface CustomPayoutPercent {
  position: number;
  /** Basis points (1/100 of a percent). Σ over all ranks MUST equal 10000 (= 100%). */
  percentBp: number;
}

export interface CustomPayoutInput {
  /** Locked distributable prize pool in VND. */
  prizePool: number;
  /** One entry per paid rank, in basis points; Σ = 10000, non-increasing, each > 0. */
  percents: CustomPayoutPercent[];
  roundingUnit: number;
}

/**
 * Native CUSTOM payout: distribute the (locked) prize pool by club-specified basis points.
 * Deterministic; throws on invalid input (caught by callers). BYPASSES the min-cash floor
 * (effectiveFloor = 0) — protection is purely structural: each bp > 0, non-increasing, Σ bp =
 * 10000, every computed amount > 0, amounts non-increasing, Σ amount = prizePool EXACTLY. The DB
 * `apply_payout_run` CUSTOM branch re-verifies the amounts; this is the source, not the only guard.
 * Same rounding discipline as the α engine: ranks 2..K rounded to the unit, rank 1 absorbs the
 * residual; if rank1 < rank2, re-round 2..K DOWN (ROUNDING_ADJUSTED) so Σ stays exact + ordered.
 */
export function computeCustomPayouts(input: CustomPayoutInput): PayoutResult {
  const { prizePool, roundingUnit } = input;
  const percents = [...input.percents].sort((a, b) => a.position - b.position);
  const K = percents.length;
  const warnings: PayoutWarning[] = [];

  if (K < 1) throw new Error("CUSTOM_EMPTY");
  if (!Number.isFinite(prizePool) || prizePool <= 0) throw new Error("CUSTOM_BAD_POOL");
  if (!Number.isFinite(roundingUnit) || roundingUnit <= 0) throw new Error("CUSTOM_BAD_UNIT");

  let bpSum = 0;
  for (let i = 0; i < K; i++) {
    const p = percents[i];
    if (p.position !== i + 1) throw new Error("CUSTOM_RANK_GAP");
    if (!Number.isInteger(p.percentBp) || p.percentBp <= 0) throw new Error("CUSTOM_BP_NONPOS");
    if (i > 0 && p.percentBp > percents[i - 1].percentBp) throw new Error("CUSTOM_BP_NOT_DESC");
    bpSum += p.percentBp;
  }
  if (bpSum !== 10000) throw new Error("CUSTOM_BP_SUM");

  const nearest = (x: number) => Math.round(x / roundingUnit) * roundingUnit;
  const down = (x: number) => Math.floor(x / roundingUnit) * roundingUnit;
  const rawAt = (i: number) => (prizePool * percents[i].percentBp) / 10000;

  const build = (roundFn: (x: number) => number): number[] => {
    const a = new Array<number>(K);
    for (let i = 1; i < K; i++) a[i] = roundFn(rawAt(i)); // ranks 2..K
    let rest = 0;
    for (let i = 1; i < K; i++) rest += a[i];
    a[0] = prizePool - rest; // rank 1 absorbs the residual so Σ = pool exactly
    return a;
  };

  let a = build(nearest);
  if (K >= 2 && a[0] < a[1]) {
    a = build(down);
    warnings.push("ROUNDING_ADJUSTED");
  }

  for (let i = 0; i < K; i++) if (!(a[i] > 0)) throw new Error("CUSTOM_ZERO_AMOUNT");
  for (let i = 0; i < K - 1; i++) if (a[i] < a[i + 1]) throw new Error("CUSTOM_INVARIANT_MONOTONE");
  let sum = 0;
  for (const x of a) sum += x;
  if (sum !== prizePool) throw new Error("CUSTOM_INVARIANT_SUM");

  const rows = a.map((amt, i) => makeRow(i + 1, amt, prizePool));
  return {
    rows,
    tiers: buildTiers(rows),
    prizePool,
    itmPlaces: K,
    effectiveFloor: 0,
    alpha: 0,
    archetype: "CUSTOM",
    warnings,
    engineVersion: CUSTOM_ENGINE_VERSION,
    alphaVersion: ALPHA_VERSION,
    sumCheck: sum === prizePool,
  };
}
