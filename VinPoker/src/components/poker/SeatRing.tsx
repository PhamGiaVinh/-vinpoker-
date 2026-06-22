// src/components/poker/SeatRing.tsx
// GE-2D/2E — the table felt + seats (GG-style), pure presentation of a
// PublicHandView. GE-2E polish: a premium, slightly-darker felt with a soft centre
// glow + vignette, a layered rail for depth, a very subtle desktop-only "VinPoker"
// watermark, a stronger hero spotlight, and a gentle to-act ring pulse. Face-up
// cards (board / hero / showdown) flip in; face-down cards use the Royal Guilloché
// back. GE-2F: staggered showdown reveal, a soft gold winner glow (pot + winning
// seats via `winnerSeats`), and chip-to-pot collection (`collecting`). Red/burgundy
// felt is permitted here (poker-table visual). Visual only.

import { cn } from '@/lib/utils';
import type { PublicHandView, PublicSeatView } from '@/lib/onlinePoker/types';
import type { FeltSkin } from '@/lib/onlinePoker/feltSkin';
import { fmtBB, fmtChips } from '@/lib/onlinePoker/sizing';
import { PlayingCard } from './PlayingCard';
import { DeckStack } from './DeckStack';
import { DealAnimation } from './DealAnimation';
import './pokerTable.css';
import { Clock } from 'lucide-react';

const AVATAR_BG = [
  'bg-sky-700', 'bg-rose-700', 'bg-emerald-700', 'bg-violet-700', 'bg-amber-700',
  'bg-cyan-700', 'bg-fuchsia-700', 'bg-lime-700', 'bg-orange-700',
];

function initials(name: string | undefined, seat: number): string {
  if (!name) return String(seat);
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase() || String(seat);
}

/** "X BB" if bb is known, else the raw chip count. */
function bbOrChips(chips: string, bb?: string): string {
  const inBB = bb ? fmtBB(chips, bb) : '';
  return inBB ? `${inBB} BB` : fmtChips(chips);
}

/** Seat-center positions around an ellipse, with `mySeat` rotated to the bottom. */
function seatPositions(seats: PublicSeatView[], mySeat?: number): Record<number, { x: number; y: number }> {
  const ordered = [...seats].sort((a, b) => a.seat - b.seat);
  const n = ordered.length || 1;
  const myIdx = Math.max(0, ordered.findIndex((s) => s.seat === mySeat));
  const out: Record<number, { x: number; y: number }> = {};
  // percent radii. rx<=38 keeps an ~88px name-plate centred at x≈12/88% fully on-screen once
  // the felt fills the full width. ry<=36 keeps the lower-side seats clear of the bottom action
  // dock / hero HUD on the now-tall fill felt (the felt-fill itself, not ry, gives the size).
  const rx = 38, ry = 36;
  ordered.forEach((s, i) => {
    // bottom = 90deg; step clockwise so my seat sits at the bottom center.
    const ang = (Math.PI / 2) + ((i - myIdx) / n) * 2 * Math.PI;
    out[s.seat] = { x: 50 + rx * Math.cos(ang), y: 50 + ry * Math.sin(ang) };
  });
  return out;
}

/** A point 36% of the way from a seat toward the table centre (where bets sit). */
function towardCenter(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x + (50 - p.x) * 0.36, y: p.y + (50 - p.y) * 0.36 };
}

function SeatChip({ seat, isMe, hole, bb, isWinner, onSit }: { seat: PublicSeatView; isMe: boolean; hole?: string[]; bb?: string; isWinner?: boolean; onSit?: () => void }) {
  const empty = seat.status === 'empty';
  const folded = seat.status === 'folded';
  const sittingOut = seat.status === 'sitting_out';
  const allin = seat.status === 'allin';

  if (empty) {
    if (onSit) {
      return (
        <button
          type="button"
          onClick={onSit}
          className="group w-16 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashed border-primary/40 bg-primary/5 py-2.5 text-center text-[10px] font-medium text-primary/80 transition-colors hover:border-primary hover:bg-primary/15 hover:text-primary sm:w-20 sm:text-[11px]"
        >
          <span className="block leading-tight">Ghế {seat.seat}</span>
          <span className="block text-[8px] uppercase tracking-wide opacity-70 group-hover:opacity-100 sm:text-[9px]">+ Ngồi</span>
        </button>
      );
    }
    // Spectator view of an empty chair — kept very quiet so the live hand dominates.
    return (
      <div className="w-16 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashed border-white/10 bg-black/20 py-2.5 text-center text-[10px] text-white/25 sm:w-20 sm:text-[11px]">
        Ghế {seat.seat}
      </div>
    );
  }

  // Cards float ABOVE the N8 name-plate. All cards (hero, opponents, board) use ONE uniform
  // size `md` so the table reads consistently; folded / sitting-out seats show no cards.
  const cards = isMe
    ? (hole && hole.length ? hole : ['?', '?']).map((c, i) => <PlayingCard key={i} card={c} size="md" reveal={!!c && c !== '?'} />)
    : folded || sittingOut
      ? null
      : seat.revealedCards?.length
        ? seat.revealedCards.map((c, i) => <PlayingCard key={i} card={c} size="md" reveal revealDelayMs={i * 130} />)
        : <><PlayingCard size="md" /><PlayingCard size="md" /></>;

  return (
    <div className={cn(
      'flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-[opacity,transform] duration-300 ease-out',
      // Non-contesting seats drop contrast so the eye finds the live players first.
      folded && 'opacity-45',
      sittingOut && 'opacity-60',
      // The actor is gently lifted toward the viewer.
      seat.isToAct && 'scale-105',
    )}>
      {cards && (
        <div className={cn(
          // No scale multipliers — every card renders at its native `md` size so hero,
          // opponents and board are equal in ratio AND size.
          'flex items-end gap-0.5',
          isMe && 'origin-bottom -translate-y-0.5 [filter:drop-shadow(0_8px_14px_rgba(0,0,0,0.6))]',
        )}>{cards}</div>
      )}

      {/* N8-style horizontal name-plate: [avatar (+dealer D) │ name / stack] */}
      <div className={cn(
        'flex items-center gap-1.5 rounded-lg border px-1 py-1 pr-1.5 transition-colors duration-300',
        !isMe && 'gap-1', // opponent plates a touch tighter; hero keeps gap-1.5
        isWinner ? 'op-winner-glow border-amber-300/70 bg-black/75'
          : seat.isToAct ? 'op-to-act-pulse border-transparent bg-black/80'
          : allin ? 'op-allin-pulse border-transparent bg-black/80'
          : isMe ? 'border-primary/40 bg-black/72'
          : 'border-white/10 bg-black/62',
      )}>
        <div className="relative shrink-0">
          <div className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold text-white sm:h-8 sm:w-8',
            !isMe && 'h-6 w-6 text-[10px] sm:h-7 sm:w-7', // opponents smaller than the hero
            folded ? 'bg-zinc-700 grayscale' : AVATAR_BG[seat.seat % AVATAR_BG.length],
          )}>
            {initials(seat.displayName, seat.seat)}
          </div>
          {seat.isButton && (
            <span className="absolute -bottom-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-b from-[#f6d27a] to-[#b9892f] text-[8px] font-bold text-[#412402] shadow sm:h-[18px] sm:w-[18px] sm:text-[9px]">D</span>
          )}
        </div>

        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-1">
            <span className="max-w-[48px] truncate text-[11px] font-medium text-white sm:max-w-[64px] sm:text-xs">{seat.displayName ?? `Ghế ${seat.seat}`}</span>
            {seat.isToAct && <Clock className="h-2.5 w-2.5 shrink-0 text-primary" />}
          </div>
          <div className={cn('text-[11px] font-semibold tabular-nums sm:text-xs', allin ? 'text-amber-300' : 'text-primary')}>
            {folded ? <span className="font-normal text-white/45">đã bỏ</span>
              : sittingOut ? <span className="font-normal text-white/40">chờ ván</span>
              : allin ? <span>ALL-IN</span>
              : bbOrChips(seat.stack, bb)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SeatRing({
  hand,
  bb,
  winnerSeats,
  collecting = false,
  onEmptySeatClick,
  dealSignal = 0,
  dealSeats,
  skin = 'emerald',
  heroAnchor,
  heroAsHud = false,
  fill = false,
}: {
  hand: PublicHandView;
  bb?: string;
  /** seats to highlight with the soft gold winner glow (live runtime supplies them) */
  winnerSeats?: number[];
  /** when true, committed bets ease toward the pot (end-of-street collection) */
  collecting?: boolean;
  /** when set, empty seats become "+ Ngồi" buttons that call this with the seat number */
  onEmptySeatClick?: (seatNo: number) => void;
  /** deal-animation trigger (from useTableHand); a bump plays one deal flourish. */
  dealSignal?: number;
  /** seats the deal animation flies to (occupied seats); falls back to seated players. */
  dealSeats?: number[];
  /** felt skin — 'emerald' (default, identity) or 'premium' (burgundy + gold, opt-in). */
  skin?: FeltSkin;
  /** where the hero (my own seat) anchors on the felt, in percent. Defaults to the bottom-
   *  left corner {15,85}; the live table lifts it (e.g. y:75) so the floating N8 action dock
   *  never covers the hero's cards/plate. */
  heroAnchor?: { x: number; y: number };
  /** N8 layout: when true the hero (my own seat) is NOT drawn on the ring — it lives in a
   *  screen-corner <HeroHud> instead. This frees the lower-left so seat 1 no longer collides
   *  with the hero, and lets the hero's cards sit in the true screen corner. The hero keeps a
   *  natural bottom-centre ring position only for its committed-bet chip + deal flourish.
   *  Default false → legacy in-ring hero (cinematic / spectator) is unchanged. */
  heroAsHud?: boolean;
  /** When true the felt FILLS its parent (mobile: `absolute inset-0` → screen-tall oval; the
   *  parent MUST be position:relative). Desktop (sm:) reverts to the centred aspect oval.
   *  Default false keeps the legacy centred `aspect-[3/5]` box (cinematic / spectator). */
  fill?: boolean;
}) {
  const pos = seatPositions(hand.seats, hand.mySeat);
  // Legacy (non-HUD) layout — drop the hero into the bottom-LEFT corner. With heroAsHud the
  // hero leaves the ring entirely (rendered as a screen-corner <HeroHud>), so its natural
  // bottom-centre position is kept here ONLY for the committed-bet chip + deal target.
  if (!heroAsHud && hand.mySeat != null && pos[hand.mySeat]) pos[hand.mySeat] = heroAnchor ?? { x: 15, y: 85 };

  // UI-4 — optional Premium Felt skin (burgundy + gold). Default emerald preserves the
  // PokerVN identity; the warm palette lives ONLY inside this felt, never the app theme.
  const premium = skin === 'premium';
  const feltBg = premium
    ? 'radial-gradient(ellipse at 50% 40%, #7a1f1f 0%, #561414 46%, #320c0c 80%, #1c0707 100%)'
    : 'radial-gradient(ellipse at 50% 40%, #157a4b 0%, #0c5234 40%, #062f1e 74%, #03180c 100%)';
  const centerGlowBg = premium
    ? 'radial-gradient(ellipse at 50% 40%, rgba(245,194,96,0.14), transparent 55%)'
    : 'radial-gradient(ellipse at 50% 40%, rgba(0,224,122,0.16), transparent 55%)';
  const heroSpotBg = premium
    ? 'radial-gradient(ellipse at 50% 100%, rgba(245,194,96,0.16), transparent 70%)'
    : 'radial-gradient(ellipse at 50% 100%, rgba(0,224,122,0.18), transparent 70%)';

  // Portrait-leaning square felt on phones (fills more of the screen); wider oval on larger
  // viewports. Seats sit on a near-circular ellipse (rx≈ry) so the square box spreads them
  // evenly without crowding.
  return (
    <div className={fill
      // fill: mobile fills the (relative) felt-area wrapper edge-to-edge; desktop reverts to
      // the centred aspect oval. Default keeps the legacy centred box (cinematic / spectator).
      ? 'absolute inset-0 sm:relative sm:inset-auto sm:mx-auto sm:aspect-[16/10] sm:h-auto sm:w-full sm:max-w-3xl'
      : 'relative mx-auto aspect-[3/5] max-h-full w-full max-w-3xl sm:aspect-[16/10]'}>
      {/* outer halo — lifts the table off the near-black room */}
      <div className="pointer-events-none absolute inset-0 rounded-[48%] shadow-[0_30px_80px_rgba(0,0,0,0.65)]" />

      {/* rail (outer band for depth) + a thin lit top edge (gold on the premium skin) */}
      <div className={cn('absolute inset-[3%] rounded-[48%] bg-gradient-to-b shadow-[0_22px_60px_rgba(0,0,0,0.72)]', premium ? 'from-[#2a1208] to-[#0d0604]' : 'from-[#11221a] to-[#030806]')} />
      <div className={cn('pointer-events-none absolute inset-[3%] rounded-[48%]', premium ? 'shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(245,194,96,0.28)]' : 'shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(0,224,122,0.10)]')} />

      {/* felt — emerald (default) or burgundy (premium), soft centre glow + strong vignette */}
      <div
        className={cn('absolute inset-[6.5%] rounded-[47%] border', premium
          ? 'border-[#b9892f] shadow-[inset_0_0_90px_rgba(0,0,0,0.78),inset_0_0_0_2px_rgba(245,194,96,0.25)]'
          : 'border-[#0a3a25] shadow-[inset_0_0_90px_rgba(0,0,0,0.78),inset_0_0_0_2px_rgba(0,224,122,0.12)]')}
        style={{ background: feltBg }}
      >
        {/* center glow */}
        <div className="pointer-events-none absolute inset-0 rounded-[46%]" style={{ background: centerGlowBg }} />
        {/* faint felt texture */}
        <div className="pointer-events-none absolute inset-0 rounded-[44%] opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)', backgroundSize: '15px 15px' }} />
        {/* very subtle desktop/tablet-only watermark (hidden on mobile; never competes with board) */}
        <div className="pointer-events-none absolute inset-0 hidden items-center justify-center sm:flex">
          <span className="text-2xl font-extrabold tracking-[0.2em] lg:text-3xl" style={{ color: premium ? 'rgba(245,194,96,0.07)' : 'rgba(0,224,122,0.06)' }}>VinPoker</span>
        </div>
        {/* inner rim */}
        <div className={cn('pointer-events-none absolute inset-[6%] rounded-[44%] ring-1 ring-inset', premium ? 'ring-amber-200/15' : 'ring-emerald-200/10')} />

        {/* board + pot. The board CARDS stay at native `md` (equal to hero + opponents); the
            pot pill keeps its own prominence via text size + a small pill-only scale, so
            equalising the cards never shrinks them below the seats' cards. */}
        <div className="absolute left-1/2 top-1/2 z-[1] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 sm:gap-2">
          <div className={cn('flex scale-105 items-center gap-1.5 rounded-full border border-amber-300/30 bg-black/60 px-3.5 py-1 shadow-md sm:scale-110', winnerSeats?.length && 'op-winner-glow')}>
            <span className="text-[9px] font-semibold uppercase tracking-wider text-white/55">Tổng Pot</span>
            <span className="text-sm font-bold tabular-nums text-primary sm:text-base">{bbOrChips(hand.pot, bb)}</span>
            {bb && fmtBB(hand.pot, bb) && <span className="text-[10px] tabular-nums text-white/45">{fmtChips(hand.pot)}</span>}
          </div>
          {/* Pre-flop (no community card yet) → the 3D V deck at centre; once the flop
              opens, the real board takes over. */}
          {hand.board.some(Boolean) ? (
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4].map((i) => <PlayingCard key={i} card={hand.board[i]} size="md" reveal={!!hand.board[i]} />)}
            </div>
          ) : (
            <DeckStack size="lg" />
          )}
          <div className="text-[9px] uppercase tracking-[0.2em] text-white/55 sm:text-[10px]">{hand.street}</div>
        </div>
      </div>

      {/* hero spotlight (bottom centre, behind the seats) */}
      <div
        className="pointer-events-none absolute bottom-0 left-1/2 z-0 h-[40%] w-[46%] -translate-x-1/2"
        style={{ background: heroSpotBg }}
      />

      {/* committed-bet chips on the felt (toward the pot) */}
      {hand.seats.map((s) => {
        if (!(Number(s.committed) > 0)) return null;
        const bp = towardCenter(pos[s.seat] ?? { x: 50, y: 50 });
        const target = collecting ? { x: 50, y: 50 } : bp;
        return (
          <div key={`bet-${s.seat}`} className="op-chip absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${target.x}%`, top: `${target.y}%`, opacity: collecting ? 0.2 : 1 }}>
            <span className="flex items-center gap-1 rounded-full border border-amber-400/40 bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-amber-300 shadow sm:text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {bbOrChips(s.committed, bb)}
            </span>
          </div>
        );
      })}

      {/* deal flourish — transient cards fly from the centre deck to the OCCUPIED seats on
          a new hand (driven by the live dealSignal; never to empty chairs) */}
      <DealAnimation
        signal={dealSignal}
        seats={dealSeats ?? hand.seats.filter((s) => s.playerId && s.status !== 'empty' && s.status !== 'sitting_out').map((s) => s.seat)}
        pos={pos}
      />

      {/* seats — with heroAsHud the hero is skipped here (drawn as a screen-corner <HeroHud>),
          so the lower-left no longer stacks the hero on top of seat 1. */}
      {hand.seats.map((s) => {
        if (heroAsHud && s.seat === hand.mySeat) return null;
        return (
          <div key={s.seat} className={cn('absolute z-10', s.seat === hand.mySeat && 'z-20')} style={{ left: `${pos[s.seat]?.x}%`, top: `${pos[s.seat]?.y}%` }}>
            <SeatChip
              seat={s}
              isMe={s.seat === hand.mySeat}
              hole={s.seat === hand.mySeat ? hand.myHoleCards : undefined}
              bb={bb}
              isWinner={winnerSeats?.includes(s.seat)}
              onSit={onEmptySeatClick && s.status === 'empty' ? () => onEmptySeatClick(s.seat) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}
