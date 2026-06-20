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
  const rx = 45, ry = 42; // percent radii
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

  // Hero (my own) cards are the strongest object after the pot: larger, lifted, shadowed.
  const cards = isMe
    ? (hole && hole.length ? hole : ['?', '?']).map((c, i) => <PlayingCard key={i} card={c} size="lg" reveal={!!c && c !== '?'} />)
    : folded
      ? <span className="px-2 py-1 text-[11px] text-white/45">đã bỏ</span>
      : sittingOut
        ? <span className="px-2 py-1 text-[11px] text-white/40">chờ ván</span>
        : seat.revealedCards?.length
          ? seat.revealedCards.map((c, i) => <PlayingCard key={i} card={c} size="sm" reveal revealDelayMs={i * 130} />)
          : <><PlayingCard size="sm" /><PlayingCard size="sm" /></>;

  return (
    <div className={cn(
      'flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-[opacity,transform] duration-300 ease-out sm:w-24 lg:w-28',
      // Non-contesting seats drop contrast so the eye finds the live players first.
      folded && 'opacity-40',
      sittingOut && 'opacity-55',
      // The actor is gently lifted toward the viewer.
      seat.isToAct && 'scale-105',
    )}>
      <div className={cn(
        'flex items-end gap-0.5',
        isMe && 'origin-bottom -translate-y-1 scale-110 [filter:drop-shadow(0_8px_14px_rgba(0,0,0,0.6))] lg:scale-125',
      )}>{cards}</div>

      <div className="relative">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white shadow-lg sm:h-11 sm:w-11 sm:text-sm lg:h-12 lg:w-12',
            folded ? 'bg-zinc-700 grayscale' : AVATAR_BG[seat.seat % AVATAR_BG.length],
            seat.isToAct ? 'op-to-act-pulse'
              : allin ? 'op-allin-pulse'
              : isMe ? 'ring-2 ring-white/40'
              : 'ring-1 ring-white/15',
          )}
        >
          {initials(seat.displayName, seat.seat)}
        </div>
        {seat.isButton && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold text-black shadow sm:h-5 sm:w-5 sm:text-[10px]">D</span>
        )}
        {seat.isToAct && (
          <span className="absolute -bottom-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-black shadow sm:h-5 sm:w-5">
            <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          </span>
        )}
        {allin && (
          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-[#991B1B] px-1.5 text-[8px] font-bold uppercase tracking-wide text-amber-200 shadow sm:text-[9px]">All-in</span>
        )}
      </div>

      <div className={cn(
        'w-full rounded-lg border px-1.5 py-0.5 text-center transition-colors duration-300',
        isWinner ? 'op-winner-glow border-amber-300/70 bg-amber-300/10'
          : seat.isToAct ? 'border-primary/60 bg-primary/15'
          : allin ? 'border-amber-300/50 bg-amber-300/[0.06]'
          : isMe ? 'border-white/25 bg-black/65' : 'border-white/10 bg-black/55',
      )}>
        <div className="truncate text-[11px] font-medium text-white sm:text-xs">{seat.displayName ?? `Ghế ${seat.seat}`}</div>
        <div className={cn('text-[11px] font-semibold tabular-nums sm:text-xs', allin ? 'text-amber-300' : 'text-primary')}>{bbOrChips(seat.stack, bb)}</div>
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
}) {
  const pos = seatPositions(hand.seats, hand.mySeat);

  // Portrait-leaning square felt on phones (fills more of the screen); wider oval on larger
  // viewports. Seats sit on a near-circular ellipse (rx≈ry) so the square box spreads them
  // evenly without crowding.
  return (
    <div className="relative mx-auto aspect-square w-full max-w-3xl sm:aspect-[16/10]">
      {/* outer halo — lifts the table off the near-black room */}
      <div className="pointer-events-none absolute inset-0 rounded-[48%] shadow-[0_30px_80px_rgba(0,0,0,0.65)]" />

      {/* rail (outer band for depth) + a thin lit top edge */}
      <div className="absolute inset-[3%] rounded-[48%] bg-gradient-to-b from-[#11221a] to-[#030806] shadow-[0_22px_60px_rgba(0,0,0,0.72)]" />
      <div className="pointer-events-none absolute inset-[3%] rounded-[48%] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(0,224,122,0.10)]" />

      {/* felt — deep emerald, soft centre glow + strong vignette, thin neon rim */}
      <div
        className="absolute inset-[6.5%] rounded-[47%] border border-[#0a3a25] shadow-[inset_0_0_90px_rgba(0,0,0,0.78),inset_0_0_0_2px_rgba(0,224,122,0.12)]"
        style={{ background: 'radial-gradient(ellipse at 50% 40%, #157a4b 0%, #0c5234 40%, #062f1e 74%, #03180c 100%)' }}
      >
        {/* center glow */}
        <div className="pointer-events-none absolute inset-0 rounded-[46%]" style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(0,224,122,0.16), transparent 55%)' }} />
        {/* faint felt texture */}
        <div className="pointer-events-none absolute inset-0 rounded-[44%] opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)', backgroundSize: '15px 15px' }} />
        {/* very subtle desktop/tablet-only watermark (hidden on mobile; never competes with board) */}
        <div className="pointer-events-none absolute inset-0 hidden items-center justify-center sm:flex">
          <span className="text-2xl font-extrabold tracking-[0.2em] lg:text-3xl" style={{ color: 'rgba(0,224,122,0.06)' }}>VinPoker</span>
        </div>
        {/* inner rim */}
        <div className="pointer-events-none absolute inset-[6%] rounded-[44%] ring-1 ring-inset ring-emerald-200/10" />

        {/* board + pot — the focal point, scaled up on larger screens */}
        <div className="absolute left-1/2 top-1/2 z-[1] flex -translate-x-1/2 -translate-y-1/2 scale-105 flex-col items-center gap-1.5 sm:scale-110 sm:gap-2 lg:scale-125">
          <div className={cn('flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-black/60 px-3.5 py-1 shadow-md', winnerSeats?.length && 'op-winner-glow')}>
            <span className="text-[9px] font-semibold uppercase tracking-wider text-white/55">Pot</span>
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
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,224,122,0.18), transparent 70%)' }}
      />

      {/* committed-bet chips on the felt (toward the pot) */}
      {hand.seats.map((s) => {
        if (!(Number(s.committed) > 0)) return null;
        const bp = towardCenter(pos[s.seat] ?? { x: 50, y: 50 });
        const target = collecting ? { x: 50, y: 50 } : bp;
        return (
          <div key={`bet-${s.seat}`} className="op-chip absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${target.x}%`, top: `${target.y}%`, opacity: collecting ? 0.2 : 1 }}>
            <span className="flex items-center gap-1 rounded-full border border-amber-400/40 bg-black/75 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-300 shadow sm:text-[11px]">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
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

      {/* seats */}
      {hand.seats.map((s) => (
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
      ))}
    </div>
  );
}
