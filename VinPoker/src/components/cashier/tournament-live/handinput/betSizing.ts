// Pure bet-sizing math for the standalone operator console's quick-sizing chips
// (+BB · 2.5BB · 3BB · Pot · All-in). The engine uses "Bet to" (street-total)
// semantics, so every value here is an ABSOLUTE target street-total for the
// actor — exactly what the BetKeypad expects when `betIsTotal` is on. The keypad
// value then flows through `betToAdded()` (in trackerEngine) before persist, so
// nothing here changes the write-path or `action_amount`.
//
// PURE: no React, no Supabase, no Date. Easy to unit-test.

export interface SizingContext {
  /** Current big-blind amount (post_bb). 0 when unknown → BB chips disabled. */
  bigBlind: number;
  /** Current pot total (the panel's `potSize`). */
  pot: number;
  /** Chips the actor still needs to call (engine ActorView.toCall). */
  toCall: number;
  /** Actor's chips already committed this street. */
  actorCurrentBet: number;
  /** Actor's remaining stack. */
  actorCurrentStack: number;
}

export interface SizingChips {
  /** Round(2.5 × BB) as a street-total, clamped. null when BB unknown. */
  bb2_5: number | null;
  /** Round(3 × BB) as a street-total, clamped. null when BB unknown. */
  bb3: number | null;
  /** Pot-sized raise "to": current_bet + pot + 2×toCall (→ pot when toCall=0). */
  pot: number;
  /** All-in "to": current_bet + current_stack (consumes the whole stack). */
  allIn: number;
}

/** Highest legal "bet to" = everything the actor can put in = current_bet + stack. */
export function maxBetTo(ctx: SizingContext): number {
  return ctx.actorCurrentBet + ctx.actorCurrentStack;
}

/** Round to an integer chip value and clamp into [0, maxBetTo]. */
export function clampBetTo(value: number, ctx: SizingContext): number {
  const v = Math.round(value);
  if (v < 0) return 0;
  const max = maxBetTo(ctx);
  return v > max ? max : v;
}

/** Absolute "bet to" targets for the 2.5BB / 3BB / Pot / All-in chips. */
export function computeSizingChips(ctx: SizingContext): SizingChips {
  const bbKnown = ctx.bigBlind > 0;
  return {
    bb2_5: bbKnown ? clampBetTo(2.5 * ctx.bigBlind, ctx) : null,
    bb3: bbKnown ? clampBetTo(3 * ctx.bigBlind, ctx) : null,
    // Pot-sized raise total: call amount + (pot after the call) on top of what the
    // actor already has in. Reduces to `current_bet + pot` (≈ pot) when toCall = 0.
    pot: clampBetTo(ctx.actorCurrentBet + ctx.pot + 2 * ctx.toCall, ctx),
    allIn: maxBetTo(ctx),
  };
}

/**
 * "+BB" nudge: add one big blind to whatever is currently in the amount box. An
 * empty/invalid box starts from the actor's current commitment so the first nudge
 * lands at `current_bet + BB` (the minimum meaningful raise-to step).
 */
export function incrementByBB(current: number | null, ctx: SizingContext): number {
  if (ctx.bigBlind <= 0) return clampBetTo(current ?? ctx.actorCurrentBet, ctx);
  const base = current != null && Number.isFinite(current) ? current : ctx.actorCurrentBet;
  return clampBetTo(base + ctx.bigBlind, ctx);
}
