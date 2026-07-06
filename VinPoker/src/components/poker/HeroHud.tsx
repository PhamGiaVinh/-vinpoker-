// src/components/poker/HeroHud.tsx
// N8/GG-style hero HUD: the player's own two hole cards + a compact stack plate,
// pinned to the SCREEN's bottom-left corner (NOT inside the felt ellipse). Pulling
// the hero out of the seat ring kills the lower-left seat overlap (no hero plate to
// collide with seat 1) and puts the cards in the real screen corner the way Natural8
// /GGPoker mobile does. Pure presentation of a PublicHandView; visual only.
//
// FIXED position (N8): the HUD is pinned at a constant bottom-left offset that clears
// the bottom Fold/Call row — it never lifts or jumps between turns, so the cards stay
// put whether or not the action bar is showing.

import { cn } from '@/lib/utils';
import type { PublicHandView } from '@/lib/onlinePoker/types';
import { fmtBB, fmtChips } from '@/lib/onlinePoker/sizing';
import { PlayingCard } from './PlayingCard';

export function HeroHud({ hand, bb }: { hand: PublicHandView; bb?: string }) {
  if (hand.mySeat == null) return null;
  const me = hand.seats.find((s) => s.seat === hand.mySeat);
  if (!me || me.status === 'empty') return null;

  const cards = hand.myHoleCards && hand.myHoleCards.length ? hand.myHoleCards : ['?', '?'];
  // Same uniform size as the board + opponents (SeatRing) so every in-play card reads EQUAL —
  // `mc` at ≤6 seats, `sm` at 7–9 max so the crowded table declutters without breaking equality.
  const cardSize: 'sm' | 'mc' = hand.seats.length >= 7 ? 'sm' : 'mc';
  const allin = me.status === 'allin';
  const folded = me.status === 'folded';
  const stack = bb && fmtBB(me.stack, bb) ? `${fmtBB(me.stack, bb)} BB` : fmtChips(me.stack);

  return (
    <div
      className={cn(
        // Constant bottom offset (clears the 44px Fold/Call row) — fixed, never lifts.
        // MOBILE ONLY: on desktop / tablet (sm:) the hero is a real bottom-centre ring seat
        // (SeatRing HERO_RING_DESKTOP), so the corner HUD hides — exactly one hero per breakpoint.
        'pointer-events-none absolute bottom-[3.25rem] left-2 z-40 flex flex-col items-start gap-1 sm:hidden',
        folded && 'opacity-50',
      )}
    >
      {/* the hero's two cards — same uniform size as the board + opponents, soft drop shadow */}
      <div className="flex items-end gap-0.5 origin-bottom-left [filter:drop-shadow(0_10px_16px_rgba(0,0,0,0.7))]">
        {cards.map((c, i) => (
          <PlayingCard key={i} card={c} size={cardSize} reveal={!!c && c !== '?'} />
        ))}
      </div>

      {/* compact stack plate ([D] · Bạn · stack) */}
      <div className="flex items-center gap-1 rounded-md border border-primary/40 bg-black/75 px-1.5 py-0.5 backdrop-blur-sm">
        {me.isButton && (
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gradient-to-b from-[#f6d27a] to-[#b9892f] text-[7px] font-bold text-[#412402]">D</span>
        )}
        <span className="text-[10px] font-medium text-white/85">Bạn</span>
        <span className={cn('text-[11px] font-semibold tabular-nums', allin ? 'text-amber-300' : 'text-primary')}>
          {allin ? 'ALL-IN' : folded ? <span className="font-normal text-white/45">đã bỏ</span> : stack}
        </span>
      </div>
    </div>
  );
}
