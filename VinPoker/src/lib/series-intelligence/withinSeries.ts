// Series Intelligence — within-series price sensitivity (TP4, P0-1). PURE, descriptive-only.
//
// For each tournament BRAND (normalizeEventName group) with >= MIN_EDITIONS editions AND >= MIN_BUYIN_LEVELS
// distinct buy-in levels, fit a 2-variable ordinary least squares in log space:
//
//     ln(entries) = c − γ·ln(buy_in) + δ·edition
//
// γ ("gamma") is the OWN-PRICE sensitivity: how entries move as buy-in rises, with the per-edition trend (δ)
// held out so γ is not just picking up "the brand grew over time". We report γ per qualifying brand plus a
// POOLED γ = median across brands. Brands that don't qualify are dropped with a plain reason. No external
// stats library — a hand-written normal-equation solve (Gaussian elimination + partial pivoting), which
// returns null when the system is singular (e.g. price is collinear with the edition trend).
//
// HONESTY (locked, P0-1): this is an OBSERVED correlation, NEVER a causal claim. Organizers set higher
// prices when they ALREADY expect a bigger field (endogeneity), so a downward price↔entries slope does NOT
// mean "raising the price loses players". Only a real price experiment could establish causation. The
// surfacing card is labeled Observed Pattern and carries the endogeneity disclaimer unconditionally.

import type { SeriesEvent } from "./nativeData";
import { editionOf, groupByBrand } from "./editionIndex";

const OLS_PARAMS = 3; // the fit has 3 parameters: intercept + ln(buy_in) + edition
// A brand needs strictly MORE editions than parameters, so the fit has >= 1 residual degree of freedom and is
// never a saturated interpolation (n == params passes exactly through every point → a noise-driven gamma).
export const MIN_EDITIONS = OLS_PARAMS + 1; // = 4
export const MIN_BUYIN_LEVELS = 2; // at least this many distinct buy-in levels (else price has no variation to read)
export const STABLE_EDITIONS = 6; // below this the estimate is thin — kept, but flagged to the owner as coarse
const MAX_PRICE_EDITION_CORR = 0.95; // if |corr(ln buy_in, edition)| exceeds this, price moved ~in lockstep with
// the edition trend and gamma cannot be identified (the club just raised price every edition) → drop the brand.

/** Bold honesty disclaimer — the card renders this unconditionally (with data or empty). */
export const ELASTICITY_DISCLAIMER =
  "QUAN SÁT, KHÔNG phải nhân quả — người tổ chức thường đặt giá cao khi ĐÃ BIẾT giải sẽ đông (endogeneity); " +
  "muốn biết giá thật sự ảnh hưởng thế nào thì phải làm thí nghiệm giá.";

export interface BrandElasticity {
  key: string; // normalized brand key
  displayName: string; // a human brand name (the group's earliest non-empty original event_name)
  gamma: number; // own-price sensitivity: entries fall as buy-in rises when gamma > 0
  delta: number; // per-edition log trend (a control, not reported prominently)
  editions: number; // rows used in the fit
  buyinLevels: number; // distinct buy-in levels among those rows
  thin: boolean; // editions < STABLE_EDITIONS → estimate is coarse (few residual dof); surfaced as a caveat
}

export interface DroppedBrand {
  key: string;
  displayName: string;
  reason: string;
}

export interface WithinSeriesElasticity {
  perBrand: BrandElasticity[]; // qualifying brands, most editions first
  pooledGamma: number | null; // median of perBrand gamma; null when none qualify
  dropped: DroppedBrand[]; // brands that didn't qualify, with plain reasons
  enough: boolean; // perBrand.length > 0
}

/** Solve a small square system A·x = b by Gaussian elimination with partial pivoting. null if ~singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const scale = A.reduce((m, row) => Math.max(m, ...row.map((v) => Math.abs(v))), 1); // matrix magnitude
  const M = A.map((row, i) => [...row, b[i]]); // augmented copy
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    // scale-RELATIVE singularity: an absolute 1e-12 threshold misses near-collinear designs whose XtX entries
    // are large, letting gamma explode while staying finite.
    if (Math.abs(M[piv][col]) < 1e-9 * scale) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]); // diagonalised → x[i] = aug / diagonal
}

function median(v: number[]): number | null {
  const s = [...v].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Pearson correlation of two equal-length series. 0 when either axis has ~no variance (caller gates that). */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const mx = xs.reduce((a, c) => a + c, 0) / n;
  const my = ys.reduce((a, c) => a + c, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx < 1e-12 || syy < 1e-12) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Compute per-brand within-series price sensitivity (γ) + pooled median across the club's own event history.
 * Descriptive only; leakage is not a concern here (this is a retrospective correlation over completed
 * events, not a forecast). Returns qualifying brands, dropped brands with reasons, and a pooled γ.
 */
export function computeWithinSeriesElasticity(events: SeriesEvent[]): WithinSeriesElasticity {
  const groups = groupByBrand(events);
  const perBrand: BrandElasticity[] = [];
  const dropped: DroppedBrand[] = [];

  for (const [key, list] of groups) {
    const displayName = list.find((e) => e.event_name && e.event_name.trim() !== "")?.event_name?.trim() || key || "(không tên)";

    // Usable rows: real entries + real buy-in + a date (edition needs the date). Result fields are never used.
    const rows = list
      .filter((e) => e.total_entries != null && e.total_entries > 0 && e.buy_in != null && e.buy_in > 0 && e.event_date)
      .map((e) => ({
        y: Math.log(e.total_entries as number),
        lnBuyin: Math.log(e.buy_in as number),
        edition: editionOf(events, e.event_name, e.event_date).edition, // >= 1
      }));

    if (rows.length < MIN_EDITIONS) {
      dropped.push({ key, displayName, reason: `chỉ ${rows.length} kỳ có đủ số liệu (cần ≥${MIN_EDITIONS})` });
      continue;
    }
    const distinctBuyins = new Set(rows.map((r) => Math.round(r.lnBuyin * 1e6))).size;
    if (distinctBuyins < MIN_BUYIN_LEVELS) {
      dropped.push({ key, displayName, reason: `giá buy-in gần như không đổi qua các kỳ (cần ≥${MIN_BUYIN_LEVELS} mức giá khác nhau)` });
      continue;
    }
    // Identification: if price moved almost perfectly in lockstep with the edition number, the OLS cannot
    // separate the price effect from the time trend (a monotone price schedule is confounded with the trend).
    const priceEditionCorr = Math.abs(pearson(rows.map((r) => r.lnBuyin), rows.map((r) => r.edition)));
    if (priceEditionCorr > MAX_PRICE_EDITION_CORR) {
      dropped.push({ key, displayName, reason: "giá gần như tăng/giảm đều theo từng kỳ — không tách được ảnh hưởng giá khỏi xu hướng thời gian" });
      continue;
    }

    // Normal equations for X = [1, lnBuyin, edition], y = ln(entries).
    const XtX = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const Xty = [0, 0, 0];
    for (const r of rows) {
      const v = [1, r.lnBuyin, r.edition];
      for (let j = 0; j < 3; j++) {
        Xty[j] += v[j] * r.y;
        for (let k = 0; k < 3; k++) XtX[j][k] += v[j] * v[k];
      }
    }
    const beta = solveLinear(XtX, Xty); // [c, bBuyin, bEdition]
    if (!beta || !beta.every((x) => Number.isFinite(x))) {
      dropped.push({ key, displayName, reason: "không tách được ảnh hưởng giá khỏi xu hướng qua các kỳ (dữ liệu cộng tuyến)" });
      continue;
    }
    perBrand.push({ key, displayName, gamma: -beta[1], delta: beta[2], editions: rows.length, buyinLevels: distinctBuyins, thin: rows.length < STABLE_EDITIONS });
  }

  perBrand.sort((a, b) => b.editions - a.editions);
  return { perBrand, pooledGamma: perBrand.length ? median(perBrand.map((b) => b.gamma)) : null, dropped, enough: perBrand.length > 0 };
}
