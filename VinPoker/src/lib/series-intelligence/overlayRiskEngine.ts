// Series Intelligence — Overlay-risk engine (single-event, PURE, client-only).
//
// A more honest Monte Carlo for ONE tournament vs a chosen GTD: a TWO-LAYER log-normal.
//   mu  = meanLog + N(0,1)·(sd/√n)   ← EPISTEMIC: uncertainty in the MEAN (standard error), shrinks with n
//   ent = clamp(exp(mu + N(0,1)·sd)) ← ALEATORIC: festival-to-festival turnout, does NOT shrink with n
// Total log-variance = sd²·(1/n + 1) → as n→∞ it floors at the aleatoric sd² (never a point). At n=1 the
// epistemic SD equals the aleatoric SD (widest — no false precision). `meanLog` = geometric mean of the
// observed entries (mean of logs). Money is by formula: overlay = max(0, GTD − ent·buyinPrize); rake = ent·fee.
//
// Output is a SCENARIO / risk decomposition, NOT a forecast. Deterministic seeded PRNG → stable tests.
// Pure: no DB, no localStorage, no imports of the multi-event engine (PRNG/stats duplicated to keep that
// engine decoupled + untouched).

export interface OverlayRiskInput {
  observedEntries: number[]; // observed total_entries across the group's series
  buyinPrize: number; // prize contribution per entry (> 0)
  fee: number; // rake per entry (>= 0)
  gtd: number; // committed guarantee (VND)
  n: number; // observation count driving the epistemic √n (or a what-if n)
  sd?: number; // aleatoric log-SD (default 0.55 — an assumption at small N)
  nSims?: number; // default 20000 (clamped to 50000)
  seed?: number; // absent ⇒ non-deterministic
  clampLo?: number; // entries floor (default 150)
  clampHi?: number; // entries ceiling (default 4600)
  bins?: number; // histogram bins (default 38)
}

export interface OverlayBin {
  lo: number;
  hi: number;
  count: number;
  overlayCount: number; // sims in this bin where prize < GTD (would need overlay)
}

export interface OverlayRiskResult {
  pOverlay: number; // P(prize < GTD)
  eOverlay: number; // E[max(0, GTD − prize)]
  entP5: number;
  entP50: number;
  entP95: number;
  rakeP5: number;
  rakeP95: number;
  bins: OverlayBin[]; // fixed-axis [clampLo, clampHi]
  thresholdEntries: number; // GTD / buyinPrize
  usable: boolean;
  meanLog: number;
}

const SD_DEFAULT = 0.55;
const N_SIMS_DEFAULT = 20000;
const MAX_SIMS = 50000;
const LO_DEFAULT = 150;
const HI_DEFAULT = 4600;
const BINS_DEFAULT = 38;

// --- deterministic PRNG + normal (duplicated from monteCarloEngine to keep it untouched) ---
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNormal(rng: () => number): () => number {
  return function () {
    let u1 = rng();
    const u2 = rng();
    if (u1 < 1e-12) u1 = 1e-12;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
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
function deriveSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

/**
 * Simulate the overlay risk of one tournament vs a GTD. `n` drives ONLY the epistemic √n term (so a what-if
 * n shows how the band would tighten); the aleatoric `sd` is held. Returns a SCENARIO, not a forecast.
 */
export function simulateOverlayRisk(input: OverlayRiskInput): OverlayRiskResult {
  const sd = input.sd ?? SD_DEFAULT;
  const lo = input.clampLo ?? LO_DEFAULT;
  const hi = input.clampHi ?? HI_DEFAULT;
  const binCount = Math.max(1, Math.floor(input.bins ?? BINS_DEFAULT));
  const nSims = Math.min(Math.max(1, Math.floor(input.nSims ?? N_SIMS_DEFAULT)), MAX_SIMS);
  const buyin = input.buyinPrize;
  const fee = input.fee;
  const gtd = input.gtd;

  const obs = input.observedEntries.filter((x) => typeof x === "number" && Number.isFinite(x) && x > 0);
  const thresholdEntries = buyin > 0 ? gtd / buyin : 0;
  if (obs.length === 0 || !(buyin > 0)) {
    return { pOverlay: 0, eOverlay: 0, entP5: 0, entP50: 0, entP95: 0, rakeP5: 0, rakeP95: 0, bins: [], thresholdEntries, usable: false, meanLog: 0 };
  }

  const meanLog = obs.reduce((acc, c) => acc + Math.log(c), 0) / obs.length;
  const nEff = Math.max(1, input.n);
  const epi = sd / Math.sqrt(nEff);

  const rng = mulberry32(input.seed ?? deriveSeed());
  const normal = makeNormal(rng);

  const ents = new Float64Array(nSims);
  const rakes = new Float64Array(nSims);
  const bw = (hi - lo) / binCount;
  const bins: OverlayBin[] = [];
  for (let i = 0; i < binCount; i++) bins.push({ lo: lo + i * bw, hi: lo + (i + 1) * bw, count: 0, overlayCount: 0 });

  let ovSum = 0;
  let ovCnt = 0;
  for (let i = 0; i < nSims; i++) {
    const mu = meanLog + normal() * epi;
    const ent = clamp(Math.exp(mu + normal() * sd), lo, hi);
    ents[i] = ent;
    rakes[i] = ent * fee;
    const prize = ent * buyin;
    const overlay = gtd - prize;
    if (overlay > 0) {
      ovSum += overlay;
      ovCnt++;
    }
    let bi = Math.floor((ent - lo) / bw);
    if (bi < 0) bi = 0;
    else if (bi >= binCount) bi = binCount - 1;
    bins[bi].count++;
    if (prize < gtd) bins[bi].overlayCount++;
  }

  const sortedE = Float64Array.from(ents).sort();
  const sortedR = Float64Array.from(rakes).sort();
  return {
    pOverlay: ovCnt / nSims,
    eOverlay: ovSum / nSims,
    entP5: percentileSorted(sortedE, 5),
    entP50: percentileSorted(sortedE, 50),
    entP95: percentileSorted(sortedE, 95),
    rakeP5: percentileSorted(sortedR, 5),
    rakeP95: percentileSorted(sortedR, 95),
    bins,
    thresholdEntries,
    usable: true,
    meanLog,
  };
}

// ----------------------------------------------------------------------------
// Forecast-centered overlay (explicit adapter — NO synthetic n).
// ----------------------------------------------------------------------------

export interface ForecastOverlayInput {
  baseEntries: number; // the forecast's (or owner-overridden) central entries — becomes exp(meanLog)
  logSd: number; // the FORECAST's own log-space uncertainty (recovered from its band) — NOT the group sd
  buyinPrize: number; // prize contribution per entry of the event being forecast
  fee: number; // rake per entry (>= 0)
  gtd: number; // committed guarantee (VND)
  nSims?: number;
  seed?: number;
  clampLo?: number;
  clampHi?: number;
  bins?: number;
}

/**
 * Simulate overlay risk CENTERED ON A FORECAST instead of an observed-entries group. ONE layer only:
 * `ent = clamp(exp(ln(base) + N(0,1)·logSd))`. There is NO epistemic √n term here — a forecast is not
 * "n observations"; its uncertainty already arrives whole in `logSd` (recovered from the forecast band).
 * This replaces the earlier trick of feeding the two-layer engine a synthetic huge n to zero-out the
 * epistemic layer — same math, honest name, nothing fake to display. Returns the same OverlayRiskResult
 * shape so histograms/cards work unchanged. SCENARIO, not a forecast guarantee.
 */
export function simulateOverlayFromForecast(input: ForecastOverlayInput): OverlayRiskResult {
  const lo = input.clampLo ?? LO_DEFAULT;
  const hi = input.clampHi ?? HI_DEFAULT;
  const binCount = Math.max(1, Math.floor(input.bins ?? BINS_DEFAULT));
  const nSims = Math.min(Math.max(1, Math.floor(input.nSims ?? N_SIMS_DEFAULT)), MAX_SIMS);
  const buyin = input.buyinPrize;
  const fee = input.fee;
  const gtd = input.gtd;
  const sd = input.logSd;

  const thresholdEntries = buyin > 0 ? gtd / buyin : 0;
  if (!(input.baseEntries > 0) || !(buyin > 0) || !(sd > 0)) {
    return { pOverlay: 0, eOverlay: 0, entP5: 0, entP50: 0, entP95: 0, rakeP5: 0, rakeP95: 0, bins: [], thresholdEntries, usable: false, meanLog: 0 };
  }

  const meanLog = Math.log(input.baseEntries);
  const rng = mulberry32(input.seed ?? deriveSeed());
  const normal = makeNormal(rng);

  const ents = new Float64Array(nSims);
  const rakes = new Float64Array(nSims);
  const bw = (hi - lo) / binCount;
  const bins: OverlayBin[] = [];
  for (let i = 0; i < binCount; i++) bins.push({ lo: lo + i * bw, hi: lo + (i + 1) * bw, count: 0, overlayCount: 0 });

  let ovSum = 0;
  let ovCnt = 0;
  for (let i = 0; i < nSims; i++) {
    const ent = clamp(Math.exp(meanLog + normal() * sd), lo, hi);
    ents[i] = ent;
    rakes[i] = ent * fee;
    const prize = ent * buyin;
    const overlay = gtd - prize;
    if (overlay > 0) {
      ovSum += overlay;
      ovCnt++;
    }
    let bi = Math.floor((ent - lo) / bw);
    if (bi < 0) bi = 0;
    else if (bi >= binCount) bi = binCount - 1;
    bins[bi].count++;
    if (prize < gtd) bins[bi].overlayCount++;
  }

  const sortedE = Float64Array.from(ents).sort();
  const sortedR = Float64Array.from(rakes).sort();
  return {
    pOverlay: ovCnt / nSims,
    eOverlay: ovSum / nSims,
    entP5: percentileSorted(sortedE, 5),
    entP50: percentileSorted(sortedE, 50),
    entP95: percentileSorted(sortedE, 95),
    rakeP5: percentileSorted(sortedR, 5),
    rakeP95: percentileSorted(sortedR, 95),
    bins,
    thresholdEntries,
    usable: true,
    meanLog,
  };
}
