// Series Intelligence — Forward layer: Monte Carlo EV/Risk engine (PATCH 3, PURE, client-only).
//
// Turns the OBSERVED reference distribution (PATCH 2/2.5) into a SCENARIO / what-if: pick a festival's
// events, assume a common-factor correlation ρ, a GTD aggressiveness α, and a cost, then simulate the
// entries → rake / overlay → EV distribution, P(loss), Risk-of-Ruin, P(overlay). This is NOT a forecast.
//
// HONESTY (locked): the engine ONLY projects `total_entries` (log-normal from the reference group); ALL
// money downstream is COMPUTED by formula (Data Contract §4). Confidence is INHERITED — an N=1 event is a
// 'hypothesis' tier with a wide σ, and the festival's aggregate tier is the WEAKEST across its events.
// No DB, no Supabase, no localStorage here — a pure math kernel. Seeded PRNG ⇒ deterministic output.

import type { EventGroup } from "./referenceDistribution";
import { computeGroupStats } from "./referenceDistribution";

export type AggregateTier = "hypothesis" | "observed-minmax" | "observed-p20p80";

export interface LogNormalParams {
  mu: number; // ln(base entries)
  sigma: number; // per-tier dispersion of log-entries
  tier: AggregateTier;
}

/** One simulable event: log-normal entries + the money drivers (all from GroupStats). */
export interface EventLogNormal {
  name: string;
  mu: number;
  sigma: number;
  fee: number; // medianFee — rake per entry (>= 0)
  buyin: number; // medianBuyIn — prize contribution per entry (> 0)
  lowEntries: number; // entries.low — conservative GTD proxy (> 0)
  tier: AggregateTier;
}

export interface CostDrivers {
  festival_days?: number | null;
  dealers_per_day?: number | null;
  dealer_wage_per_day?: number | null;
  staff_cost_per_day?: number | null;
  venue_cost?: number | null;
  equipment_setup_cost?: number | null;
  other_fixed_cost?: number | null;
  marketing_budget?: number | null;
}

export interface CostBreakdown {
  fixed: number;
  variable: number;
  marketing: number;
  total: number; // 0 ⇒ caller treats as "no cost"
}

export interface SimInput {
  rho: number; // 0..1 common-factor weight (correlation of standardized log-entries)
  alpha: number; // GTD aggressiveness multiplier on safeGTD
  cost?: number; // total festival cost; absent/<=0 ⇒ gross-only mode
  bankroll?: number; // required for ruin; absent ⇒ ruin omitted
  nSims?: number; // default 20000 (clamped to 50000)
  seed?: number; // absent ⇒ non-deterministic
}

export interface HistogramBin {
  lo: number;
  hi: number;
  count: number;
}

export interface SimResult {
  usable: boolean; // false when no usable events
  mode: "gross" | "profit"; // 'profit' only when cost > 0
  eGross: number; // E[Σrake − Σoverlay]
  eEV: number | null; // E[profit] = eGross − cost; null in gross mode
  p5: number;
  p50: number;
  p95: number; // percentiles of the festival metric in effect
  eRake: number;
  eOverlay: number;
  pLoss: number; // P(metric < 0)
  ruin: number | null; // P(metric < −bankroll); null unless cost>0 && bankroll
  pOverlayAny: number; // P(any event overlay > 0)
  bins: HistogramBin[];
  aggregateTier: AggregateTier; // WEAKEST tier across events
}

// --- constants --------------------------------------------------------------
const SIGMA_FLOOR = 0.35;
const SIGMA_N1 = 0.6; // wide default for N=1 (assumption, not observation)
const Z80 = 0.84; // z at the 80th percentile; p20↔p80 ≈ 2·0.84 σ
const ENTRIES_MIN = 5; // a tournament with <5 entries is not a tournament
const ENTRIES_UPPER_FLOOR = 50_000; // hard cap floor; per-event cap = max(this, base×20)
const ENTRIES_UPPER_MULT = 20;
const BIN_COUNT = 24;
const MAX_SIMS = 50_000;
const TIER_RANK: Record<AggregateTier, number> = { hypothesis: 0, "observed-minmax": 1, "observed-p20p80": 2 };

// --- deterministic PRNG + normal -------------------------------------------
/** mulberry32 — fast deterministic 32-bit PRNG, uniform in [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal sampler via Box-Muller (two uniforms per draw → predictable seed→output). */
function makeNormal(rng: () => number): () => number {
  return function () {
    let u1 = rng();
    const u2 = rng();
    if (u1 < 1e-12) u1 = 1e-12; // avoid log(0)
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const num = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// --- public pure functions --------------------------------------------------

/**
 * Map a reference-distribution group → log-normal entries params + inherited tier.
 * μ = ln(base). N=1 → σ=0.6 'hypothesis'; N=2–4 → σ=max(0.35,(ln high−ln low)/2) 'observed-minmax';
 * N≥5 → σ=max(0.35,(ln high−ln low)/(2·0.84)) 'observed-p20p80'. Returns null when base is unusable.
 */
export function referenceGroupToLogNormal(group: EventGroup): LogNormalParams | null {
  const s = computeGroupStats(group);
  const base = s.entries.base;
  if (base === null || base <= 0) return null;
  const mu = Math.log(base);
  if (s.n <= 1) return { mu, sigma: SIGMA_N1, tier: "hypothesis" };
  const low = s.entries.low;
  const high = s.entries.high;
  if (low === null || high === null || low <= 0 || high <= 0) {
    return { mu, sigma: SIGMA_N1, tier: "hypothesis" }; // defensive: can't derive σ → widest, honest
  }
  const logRange = Math.log(high) - Math.log(low);
  if (s.n <= 4) return { mu, sigma: Math.max(SIGMA_FLOOR, logRange / 2), tier: "observed-minmax" };
  return { mu, sigma: Math.max(SIGMA_FLOOR, logRange / (2 * Z80)), tier: "observed-p20p80" };
}

/** Cost from operator drivers (Data Contract §4.5). Missing driver → 0; total 0 ⇒ "no cost". */
export function computeCostFromDrivers(d: CostDrivers): CostBreakdown {
  const variable =
    num(d.festival_days) * (num(d.dealers_per_day) * num(d.dealer_wage_per_day) + num(d.staff_cost_per_day));
  const fixed = num(d.venue_cost) + num(d.equipment_setup_cost) + num(d.other_fixed_cost);
  const marketing = num(d.marketing_budget);
  return { fixed, variable, marketing, total: fixed + variable + marketing };
}

function weakestTier(events: EventLogNormal[]): AggregateTier {
  return events.reduce<AggregateTier>(
    (w, e) => (TIER_RANK[e.tier] < TIER_RANK[w] ? e.tier : w),
    "observed-p20p80",
  );
}

function percentileSorted(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function makeBins(metric: Float64Array, count: number): HistogramBin[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < metric.length; i++) {
    if (metric[i] < lo) lo = metric[i];
    if (metric[i] > hi) hi = metric[i];
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const width = (hi - lo) / count;
  const bins: HistogramBin[] = [];
  for (let i = 0; i < count; i++) bins.push({ lo: lo + i * width, hi: lo + (i + 1) * width, count: 0 });
  for (let i = 0; i < metric.length; i++) {
    let idx = Math.floor((metric[i] - lo) / width);
    if (idx < 0) idx = 0;
    else if (idx >= count) idx = count - 1;
    bins[idx].count++;
  }
  return bins;
}

function deriveSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

const EMPTY_RESULT: SimResult = {
  usable: false,
  mode: "gross",
  eGross: 0,
  eEV: null,
  p5: 0,
  p50: 0,
  p95: 0,
  eRake: 0,
  eOverlay: 0,
  pLoss: 0,
  ruin: null,
  pOverlayAny: 0,
  bins: [],
  aggregateTier: "observed-p20p80",
};

/**
 * Monte Carlo over a festival. Common-factor one-factor model:
 *   logEntries_e = μ_e + √ρ·σ_e·F + √(1−ρ)·σ_e·Z_e   (F shared per sim, Z_e idiosyncratic)
 * ⇒ Var(logEntries_e)=σ_e² (ρ-independent → mean unchanged); pairwise corr of standardized log-entries = ρ
 * (→ higher ρ fattens the festival-total tail / ruin without moving the mean). Money is by formula only.
 */
export function simulateFestival(events: EventLogNormal[], input: SimInput): SimResult {
  if (events.length === 0) return EMPTY_RESULT;

  const nSims = Math.min(Math.max(1, Math.floor(input.nSims ?? 20000)), MAX_SIMS);
  const rng = mulberry32(input.seed ?? deriveSeed());
  const normal = makeNormal(rng);
  const rho = clamp(input.rho, 0, 1);
  const sqrtRho = Math.sqrt(rho);
  const sqrtOneMinusRho = Math.sqrt(1 - rho);
  const alpha = input.alpha;
  const cost = typeof input.cost === "number" && input.cost > 0 ? input.cost : 0;
  const mode: "gross" | "profit" = cost > 0 ? "profit" : "gross";
  const hasBankroll = mode === "profit" && typeof input.bankroll === "number" && input.bankroll > 0;
  const bankroll = hasBankroll ? (input.bankroll as number) : 0;

  // pre-compute per-event upper clamp = max(50k, base×20) where base = exp(mu)
  const uppers = events.map((e) => Math.max(ENTRIES_UPPER_FLOOR, Math.exp(e.mu) * ENTRIES_UPPER_MULT));

  const metric = new Float64Array(nSims);
  let sumGross = 0;
  let sumRake = 0;
  let sumOverlay = 0;
  let lossCount = 0;
  let ruinCount = 0;
  let overlayAnyCount = 0;

  for (let i = 0; i < nSims; i++) {
    const F = normal();
    let rake = 0;
    let overlay = 0;
    let overlayAny = false;
    for (let j = 0; j < events.length; j++) {
      const e = events[j];
      const Z = normal();
      const logE = e.mu + sqrtRho * e.sigma * F + sqrtOneMinusRho * e.sigma * Z;
      const entries = clamp(Math.exp(logE), ENTRIES_MIN, uppers[j]);
      rake += entries * e.fee;
      const ov = Math.max(0, alpha * (e.lowEntries * e.buyin) - entries * e.buyin);
      if (ov > 0) overlayAny = true;
      overlay += ov;
    }
    const gross = rake - overlay;
    const m = mode === "profit" ? gross - cost : gross;
    metric[i] = m;
    sumGross += gross;
    sumRake += rake;
    sumOverlay += overlay;
    if (m < 0) lossCount++;
    if (hasBankroll && m < -bankroll) ruinCount++;
    if (overlayAny) overlayAnyCount++;
  }

  const sorted = Float64Array.from(metric).sort();
  const eGross = sumGross / nSims;
  return {
    usable: true,
    mode,
    eGross,
    eEV: mode === "profit" ? eGross - cost : null,
    p5: percentileSorted(sorted, 5),
    p50: percentileSorted(sorted, 50),
    p95: percentileSorted(sorted, 95),
    eRake: sumRake / nSims,
    eOverlay: sumOverlay / nSims,
    pLoss: lossCount / nSims,
    ruin: hasBankroll ? ruinCount / nSims : null,
    pOverlayAny: overlayAnyCount / nSims,
    bins: makeBins(metric, BIN_COUNT),
    aggregateTier: weakestTier(events),
  };
}
