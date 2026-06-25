// src/lib/onlinePoker/sizing.ts
// GE-2D — PURE bet-sizing + display helpers for the player action bar. These are
// DISPLAY conveniences only: compute the GG-style %-pot "raise to" amounts and
// CLAMP every value into the server's legal window [minRaiseTo, maxRaiseTo]. They
// never widen what the server allows; the server (engine, in the Edge) is the sole
// source of truth for legality and re-validates every submitted amount. No engine
// rule is duplicated here — only pot-fraction arithmetic + clamping, fail-closed.

import { isChipString, type ChipString, type WireLegalActions } from './wire';

export type BetSizingKey = '33' | '50' | '75' | '100';

export interface BetSizingOption {
  /** stable React key — a pot-% key ('33'…) or a preflop multiple ('2x'…). */
  key: string;
  /** UI label, e.g. "33%" (postflop) or "2.5×" (preflop multiple of the bet). */
  label: string;
  /** canonical chip string, GUARANTEED within [minRaiseTo, maxRaiseTo] */
  amount: ChipString;
}

// GG-style quick sizes: a "raise to" of `toCall + pct·(pot + toCall)` (pot after the
// call), expressed as exact num/den so the math stays integer (no float drift).
// N8-style: 33 / 50 / 75 / 100% of the pot-after-call, ascending (the bar reverses
// for top-down display); 100% replaces "Pot" and reads "Tối đa" once it clamps to max.
const PERCENTS: { key: BetSizingKey; label: string; num: bigint; den: bigint }[] = [
  { key: '33', label: '33%', num: 33n, den: 100n },
  { key: '50', label: '50%', num: 50n, den: 100n },
  { key: '75', label: '75%', num: 75n, den: 100n },
  { key: '100', label: '100%', num: 100n, den: 100n },
];

const clamp = (v: bigint, lo: bigint, hi: bigint): bigint => (v < lo ? lo : v > hi ? hi : v);

/**
 * Quick "raise to" sizing chips for the bar, every amount CLAMPED to the legal
 * window. Returns [] (fail-closed) when the menu has no bet/raise OR any chip
 * string is malformed OR the window is degenerate — never a NaN/negative amount.
 * `pot` is the public pot; a %-chip is `clamp(toCall + pct·(pot + toCall))`.
 */
export function betSizingOptions(legal: WireLegalActions, opts: { pot: ChipString }): BetSizingOption[] {
  if (!legal.types.includes('raise') && !legal.types.includes('bet')) return [];
  if (![legal.toCall, legal.minRaiseTo, legal.maxRaiseTo, opts.pot].every(isChipString)) return [];

  const toCall = BigInt(legal.toCall);
  const lo = BigInt(legal.minRaiseTo);
  const hi = BigInt(legal.maxRaiseTo);
  if (hi < lo) return [];
  const potAfterCall = BigInt(opts.pot) + toCall;

  const candidates: BetSizingOption[] = PERCENTS.map((p) => ({
    key: p.key,
    label: p.label,
    amount: clamp(toCall + (potAfterCall * p.num) / p.den, lo, hi).toString(),
  }));

  // De-dup amounts that collapse to the same clamped value (tiny windows), keeping
  // the first (lowest %) so the bar never shows two chips with the same amount.
  const seen = new Set<string>();
  const out: BetSizingOption[] = [];
  for (const c of candidates) {
    if (seen.has(c.amount)) continue;
    seen.add(c.amount);
    out.push(c);
  }
  return out;
}

// Preflop multiples of the CURRENT bet level (the largest committed this street): 2× / 2.5× /
// 3× / 4×. On an open the level is the BB → 2/2.5/3/4 BB; facing a 3-bet to 6 BB the level is
// 6 BB → 12/15/18/24 BB. This is what makes "BB sizing" scale to a re-raise (owner spec:
// BB preflop, %-pot postflop). Labelled by the multiple; the bar shows the resulting BB amount.
const BB_MULTS: { key: string; label: string; num: bigint; den: bigint }[] = [
  { key: '2x', label: '2×', num: 2n, den: 1n },
  { key: '2.5x', label: '2.5×', num: 5n, den: 2n },
  { key: '3x', label: '3×', num: 3n, den: 1n },
  { key: '4x', label: '4×', num: 4n, den: 1n },
];

/**
 * Preflop "raise to" sizing chips: `multiple × betLevel`, KEPT ONLY when the result lands inside
 * the legal window `[minRaiseTo, maxRaiseTo]` — an out-of-window multiple is DROPPED, never
 * silently clamped under a wrong label (so a tile's amount always matches its multiple). Returns
 * [] (fail-closed) when the menu has no bet/raise, any chip string is malformed, the window is
 * degenerate, or the bet level is non-positive. `betLevel` is the max committed this street.
 */
export function betSizingOptionsBB(legal: WireLegalActions, opts: { betLevel: ChipString }): BetSizingOption[] {
  if (!legal.types.includes('raise') && !legal.types.includes('bet')) return [];
  if (![legal.minRaiseTo, legal.maxRaiseTo, opts.betLevel].every(isChipString)) return [];

  const lo = BigInt(legal.minRaiseTo);
  const hi = BigInt(legal.maxRaiseTo);
  if (hi < lo) return [];
  const level = BigInt(opts.betLevel);
  if (level <= 0n) return [];

  const seen = new Set<string>();
  const out: BetSizingOption[] = [];
  for (const m of BB_MULTS) {
    const to = (level * m.num) / m.den; // raise-to in chips (integer; 2.5× via num/den = 5n/2n)
    if (to < lo || to > hi) continue;   // out of window → drop (no misleading clamp)
    const amount = to.toString();
    if (seen.has(amount)) continue;     // de-dup multiples that collapse to the same chips
    seen.add(amount);
    out.push({ key: m.key, label: m.label, amount });
  }
  return out;
}

/**
 * Clamp an arbitrary "raise to" (e.g. a slider value) into the legal window.
 * Returns '' (fail-closed) on any malformed chip string — callers must treat ''
 * as "no valid amount" and not submit it.
 */
export function clampRaiseTo(legal: WireLegalActions, amount: string): ChipString {
  if (![amount, legal.minRaiseTo, legal.maxRaiseTo].every(isChipString)) return '';
  return clamp(BigInt(amount), BigInt(legal.minRaiseTo), BigInt(legal.maxRaiseTo)).toString();
}

// ── display helpers ──────────────────────────────────────────────────────────

/** Group a chip string with thousands separators ("1875" → "1,875"). */
export function fmtChips(s: string): string {
  return isChipString(s) ? BigInt(s).toLocaleString('en-US') : s;
}

/**
 * Chip string → big-blind count for display, floored to one decimal and with a
 * trailing ".0" stripped ("150"/"50" → "3", "75"/"50" → "1.5"). Returns ''
 * (caller shows chips only) on a malformed chip string or a zero/invalid bb.
 */
export function fmtBB(chips: string, bb: string): string {
  if (!isChipString(chips) || !isChipString(bb) || bb === '0') return '';
  const tenths = (BigInt(chips) * 10n) / BigInt(bb); // floor to 0.1 BB
  const whole = tenths / 10n;
  const frac = tenths % 10n;
  return frac === 0n ? whole.toString() : `${whole}.${frac}`;
}
