// payoutSuggest — PURE, client-only helpers that SUGGEST a CUSTOM payout ladder (basis points) to
// pre-fill the editable rows in PayoutEnginePanel. It never persists and never runs on the Edge;
// the authoritative money computation stays `computeCustomPayouts` (server + client) on the frozen
// bp, and the DB `apply_payout_run` re-verifies every invariant. This file is a CONSUMER of
// payoutEngine.ts (imports `computePayouts` + `bandBoundaries`) — it does NOT modify the engine, so
// the byte-mirror drift guard (payoutEngine.drift.test.ts) is unaffected.
//
// Two entry points (owner picked "cả hai"):
//   • seedCustomLadder      — pick a shape (DAILY/INTL/MULTI) → reuse the validated α engine.
//   • suggestLadderFromRank1 — type the top-prize % → bisect a power-law α to hit that rank-1 %.
// Both return a SuggestedLadder whose `percentsBp` satisfies the CUSTOM contract EXACTLY:
// integer bp > 0, non-increasing, Σ = 10000, and equal within the house 10+ bands (so the grouped
// payout display stays grouped). Feeds `computeCustomPayouts` without any downstream change.

import { computePayouts, bandBoundaries, type PayoutArchetype } from "./payoutEngine";

export const BP_TOTAL = 10000;

export type SuggestShape = "DAILY" | "INTL" | "MULTI"; // Top nặng / Cân bằng / Phẳng
export type SuggestSource = "PRESET_SHAPE" | "RANK1_TARGET";

export interface RankBand {
  from: number;
  to: number;
}

export type SuggestWarning =
  | "PLACES_REDUCED_BY_ENGINE" // engine trả ít suất hơn yêu cầu (pool/min-cash chặn) — không âm thầm
  | "TARGET_BELOW_FLAT_MIN" // % hạng 1 < mức phẳng 10000/N → nâng lên
  | "TARGET_ABOVE_MAX" // % hạng 1 > 10000−(N−1)·floor → hạ xuống
  | "FLOOR_ABOVE_FEASIBLE_MAX" // min-cash × N > 100% → hạ floor cho khả thi
  | "FLOOR_NOT_APPLIED_NO_POOL" // chưa có entry → không quy được min-cash ra %, chạy pure-%
  | "TAIL_BELOW_GUIDANCE" // hạng chót < min-cash tham khảo (CUSTOM vốn bỏ sàn — chỉ báo)
  | "TARGET_SHIFTED_BY_INTEGER_ROUNDING"; // làm tròn bp đẩy hạng 1 lệch target > dung sai

export interface SuggestedLadder {
  /** length = effectivePlaces; Σ = 10000, integer, non-increasing, each ≥ 1, equal within 10+ bands. */
  percentsBp: number[];
  bands: RankBand[];
  requestedPlaces: number;
  effectivePlaces: number;
  effectiveRank1Bp: number;
  /** RANK1_TARGET only — the % the operator asked for (before clamp/rounding). */
  targetRank1Bp?: number;
  floorGuidanceBp?: number;
  source: SuggestSource;
  warnings: SuggestWarning[];
}

// ── Band-safe apportionment ────────────────────────────────────────────────────────────────────
/**
 * Turn a per-rank weight vector into integer basis points: Σ = total, non-increasing, EACH ≥ 1,
 * and equal for ranks sharing an identical weight (the 10+ bands). Band equality is preserved WITHOUT
 * needing band metadata: (a) equal weights → equal floored bp, and (b) the entire rounding residual
 * is dropped on RANK 1 only (never distributed across ranks, which is what would break a band). Rank 1
 * only ever grows (residual ≥ 0) so monotonicity can't invert — no down-repair needed.
 *
 * Contract (throws, never silently distorts): weights finite & ≥ 0; length ≥ 1; total integer ≥ N;
 * input non-increasing (equal allowed). All-zero weights → equal split (documented fallback).
 */
export function allocateLadderBp(weights: number[], total = BP_TOTAL): number[] {
  const N = weights.length;
  if (N < 1) throw new Error("SUGGEST_EMPTY_WEIGHTS");
  if (!Number.isInteger(total) || total < N) throw new Error("SUGGEST_INVALID_TOTAL");
  for (const w of weights) if (!Number.isFinite(w) || w < 0) throw new Error("SUGGEST_NON_FINITE_WEIGHT");
  for (let i = 1; i < N; i++) if (weights[i] > weights[i - 1] + 1e-6) throw new Error("SUGGEST_WEIGHTS_NOT_DESC");
  if (N === 1) return [total];

  let W = 0;
  for (const w of weights) W += w;
  const eff = W > 0 ? weights : weights.map(() => 1); // all-zero → equal split
  let Weff = 0;
  for (const w of eff) Weff += w;

  const base = total - N; // reserve 1 bp per rank → each final ≥ 1
  const floored = eff.map((w) => Math.floor((base * w) / Weff));
  let used = 0;
  for (const f of floored) used += f;
  floored[0] += base - used; // residual (≥ 0) entirely to rank 1 — band-safe
  const bp = floored.map((f) => f + 1);

  // invariants (defensive — should always hold)
  let s = 0;
  for (const x of bp) s += x;
  if (s !== total) throw new Error("SUGGEST_ALLOC_SUM");
  for (let i = 1; i < N; i++) if (bp[i] > bp[i - 1]) throw new Error("SUGGEST_ALLOC_MONOTONE");
  for (const x of bp) if (x < 1) throw new Error("SUGGEST_ALLOC_ZERO");
  return bp;
}

/** Group a smooth per-rank vector into equal-per-band means using the house band layout (ranks
 *  1–9 individual, 10+ in 3-place bands). Output band members are EXACTLY equal → the allocator
 *  then keeps them equal in bp. Reuses `bandBoundaries` from the engine (single source of truth). */
function bandMeanWeights(perRank: number[]): { weights: number[]; bands: RankBand[] } {
  const N = perRank.length;
  const bands = bandBoundaries(N).map(([from, to]) => ({ from, to }));
  const out = new Array<number>(N);
  for (const { from, to } of bands) {
    let sum = 0;
    for (let r = from; r <= to; r++) sum += perRank[r - 1];
    const mean = sum / (to - from + 1);
    for (let r = from; r <= to; r++) out[r - 1] = mean;
  }
  return { weights: out, bands };
}

/** Pick an ITM fraction whose `ceil(entries × itm)` === places, robust to floating point (aims at
 *  the midpoint of the ((p−1)/e, p/e] interval, safely inside → ceil = p). The engine may still
 *  reduce N via the pool/field caps; the caller reads back `result.itmPlaces` as the truth. */
export function itmPercentForPlaces(entries: number, places: number): number {
  if (entries < 1) return 0;
  const p = Math.max(1, Math.min(Math.floor(places), entries));
  return ((p - 1) / entries + p / entries) / 2;
}

// ── Design A: preset shape seed (reuse the validated α engine) ──────────────────────────────────
export interface SeedLadderInput {
  entries: number;
  prizePool: number;
  floor: number; // min-cash VND = minCashX × (buyIn + rake); must be > 0
  requestedPlaces: number;
  roundingUnit: number;
  shape: SuggestShape;
}

export function seedCustomLadder(input: SeedLadderInput): SuggestedLadder {
  const warnings: SuggestWarning[] = [];
  const itmPercent = itmPercentForPlaces(input.entries, input.requestedPlaces);
  const res = computePayouts({
    entries: input.entries,
    prizePool: input.prizePool,
    floor: input.floor,
    itmPercent,
    archetype: input.shape as PayoutArchetype,
    roundingUnit: input.roundingUnit,
  });
  const effectivePlaces = res.itmPlaces;
  if (effectivePlaces !== input.requestedPlaces) warnings.push("PLACES_REDUCED_BY_ENGINE");

  // res.rows is PER-POSITION (banded ranks appear as separate rows with EQUAL amounts) → weights
  // are already band-equal; the grouped view lives in res.tiers, not res.rows.
  const weights = res.rows.map((r) => r.amount);
  const percentsBp = allocateLadderBp(weights, BP_TOTAL);
  const bands = bandBoundaries(effectivePlaces).map(([from, to]) => ({ from, to }));
  return {
    percentsBp,
    bands,
    requestedPlaces: input.requestedPlaces,
    effectivePlaces,
    effectiveRank1Bp: percentsBp[0],
    source: "PRESET_SHAPE",
    warnings,
  };
}

// ── Design B: solve a power-law α to hit a target top-prize % ───────────────────────────────────
// Shape family (explicit, feasible): qᵢ(α) = i^(−α) / Σⱼ j^(−α); pᵢ(α) = floorBp + R·qᵢ(α),
// R = 10000 − N·floorBp. rank1Bp(α=0) = 10000/N (flat); → 10000−(N−1)·floorBp as α→∞; strictly
// increasing in α → bisection converges. Then band ranks 10+ and integerize (band-safe).
export interface Rank1LadderInput {
  targetRank1Bp: number;
  places: number;
  /** min-cash as bp-of-pool = round(minCashX·(buyIn+rake)/pool·10000); 0 = pure-% (no pool yet). */
  floorBp: number;
}

export function suggestLadderFromRank1(input: Rank1LadderInput): SuggestedLadder {
  const warnings: SuggestWarning[] = [];
  const N = Math.max(1, Math.floor(input.places));
  let floorBp = Number.isFinite(input.floorBp) ? Math.max(0, Math.floor(input.floorBp)) : 0;

  if (N === 1) {
    return {
      percentsBp: [BP_TOTAL],
      bands: [{ from: 1, to: 1 }],
      requestedPlaces: 1,
      effectivePlaces: 1,
      effectiveRank1Bp: BP_TOTAL,
      targetRank1Bp: input.targetRank1Bp,
      floorGuidanceBp: floorBp,
      source: "RANK1_TARGET",
      warnings,
    };
  }

  // Floor feasibility: N floors must fit under 100% (leave the top ≥ the flat share).
  if (floorBp * N > BP_TOTAL) {
    floorBp = Math.floor(BP_TOTAL / N);
    warnings.push("FLOOR_ABOVE_FEASIBLE_MAX");
  }

  const flatMin = Math.ceil(BP_TOTAL / N);
  const maxRank1 = BP_TOTAL - (N - 1) * floorBp; // ≥ flatMin because floorBp ≤ 10000/N
  let target = Math.round(input.targetRank1Bp);
  if (target < flatMin) {
    target = flatMin;
    warnings.push("TARGET_BELOW_FLAT_MIN");
  } else if (target > maxRank1) {
    target = maxRank1;
    warnings.push("TARGET_ABOVE_MAX");
  }

  const R = BP_TOTAL - N * floorBp;
  const rank1BpAt = (alpha: number): number => {
    let denom = 0;
    for (let i = 1; i <= N; i++) denom += Math.pow(i, -alpha);
    return floorBp + R / denom; // q₁ = 1^(−α)/denom = 1/denom
  };

  // Bisection α ∈ [0, 40]; rank1BpAt increasing. α=40 → denom≈1 → rank1≈maxRank1.
  let lo = 0;
  let hi = 40;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (rank1BpAt(mid) < target) lo = mid;
    else hi = mid;
  }
  const alpha = (lo + hi) / 2;

  let denom = 0;
  for (let i = 1; i <= N; i++) denom += Math.pow(i, -alpha);
  const smooth = new Array<number>(N);
  for (let i = 1; i <= N; i++) smooth[i - 1] = floorBp + (R * Math.pow(i, -alpha)) / denom;

  const { weights, bands } = bandMeanWeights(smooth);
  const percentsBp = allocateLadderBp(weights, BP_TOTAL);

  if (Math.abs(percentsBp[0] - target) > 25) warnings.push("TARGET_SHIFTED_BY_INTEGER_ROUNDING");
  if (floorBp > 0 && percentsBp[N - 1] < floorBp) warnings.push("TAIL_BELOW_GUIDANCE");

  return {
    percentsBp,
    bands,
    requestedPlaces: N,
    effectivePlaces: N,
    effectiveRank1Bp: percentsBp[0],
    targetRank1Bp: input.targetRank1Bp,
    floorGuidanceBp: floorBp,
    source: "RANK1_TARGET",
    warnings,
  };
}
