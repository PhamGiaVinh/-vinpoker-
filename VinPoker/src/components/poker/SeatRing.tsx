// src/components/poker/SeatRing.tsx
// GE-2D — the table felt + seats (GG-style), pure presentation of a PublicHandView.
// Each seat is an avatar (initials) + nameplate with stack in BB + chips; the
// committed bet shows as a chip on the felt toward the pot; the to-act seat gets a
// neon ring. The viewer's own seat (mySeat) is anchored at the bottom, larger, and
// shows its private hole cards; every other seat shows face-down cards (or
// revealedCards at showdown, or a folded marker). Sizes scale up on desktop so the
// game state (board / pot / seats) reads as the focal point, not the chrome. Red
// felt is permitted here (poker-table visual). Visual only — no logic.

import { cn } from '@/lib/utils';
import type { PublicHandView, PublicSeatView } from '@/lib/onlinePoker/types';
import { fmtBB, fmtChips } from '@/lib/onlinePoker/sizing';
import { PlayingCard } from './PlayingCard';
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

function SeatChip({ seat, isMe, hole, bb }: { seat: PublicSeatView; isMe: boolean; hole?: string[]; bb?: string }) {
  const empty = seat.status === 'empty';
  const folded = seat.status === 'folded';
  const sittingOut = seat.status === 'sitting_out';

  if (empty) {
    return (
      <div className="w-16 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashed border-white/15 bg-black/30 py-2.5 text-center text-[10px] text-white/35 sm:w-20 sm:text-[11px]">
        Ghế {seat.seat}
      </div>
    );
  }

  const cards = isMe
    ? (hole && hole.length ? hole : ['?', '?']).map((c, i) => <PlayingCard key={i} card={c} size="md" />)
    : folded
      ? <span className="px-2 py-1 text-[11px] text-white/50">đã bỏ</span>
      : seat.revealedCards?.length
        ? seat.revealedCards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
        : <><PlayingCard size="sm" /><PlayingCard size="sm" /></>;

  return (
    <div className={cn(
      'flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 sm:w-24 lg:w-28',
      (folded || sittingOut) && 'opacity-55',
    )}>
      <div className={cn('flex items-end gap-0.5', isMe && 'scale-110 origin-bottom lg:scale-125')}>{cards}</div>

      <div className="relative">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white shadow-lg sm:h-11 sm:w-11 sm:text-sm lg:h-12 lg:w-12',
            AVATAR_BG[seat.seat % AVATAR_BG.length],
            seat.isToAct
              ? 'ring-2 ring-primary ring-offset-2 ring-offset-black shadow-[0_0_18px_rgba(0,224,122,0.45)]'
              : isMe ? 'ring-2 ring-white/40' : 'ring-1 ring-white/15',
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
      </div>

      <div className={cn(
        'w-full rounded-lg border px-1.5 py-0.5 text-center',
        seat.isToAct ? 'border-primary/60 bg-primary/10'
          : isMe ? 'border-white/25 bg-black/65' : 'border-white/10 bg-black/55',
      )}>
        <div className="truncate text-[11px] font-medium text-white sm:text-xs">{seat.displayName ?? `Ghế ${seat.seat}`}</div>
        <div className="text-[11px] font-semibold tabular-nums text-primary sm:text-xs">{bbOrChips(seat.stack, bb)}</div>
      </div>

      {sittingOut && <div className="text-[9px] uppercase tracking-wide text-white/40">sitting out</div>}
    </div>
  );
}

export function SeatRing({ hand, bb }: { hand: PublicHandView; bb?: string }) {
  const pos = seatPositions(hand.seats, hand.mySeat);

  return (
    <div className="relative mx-auto aspect-[5/4] w-full max-w-3xl sm:aspect-[16/10]">
      {/* rail + felt (depth: rail border, inner rim, inset shadow, faint felt texture) */}
      <div className="absolute inset-[6%] rounded-[46%] border-[6px] border-emerald-950 bg-[radial-gradient(ellipse_at_center,_#127a46_0%,_#0c5836_46%,_#06301f_100%)] shadow-[inset_0_0_70px_rgba(0,0,0,0.65),0_14px_44px_rgba(0,0,0,0.55)]">
        <div className="pointer-events-none absolute inset-0 rounded-[44%] opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)', backgroundSize: '15px 15px' }} />
        <div className="pointer-events-none absolute inset-[6%] rounded-[44%] ring-1 ring-inset ring-emerald-200/10" />

        {/* board + pot — the focal point, scaled up on larger screens */}
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 scale-105 flex-col items-center gap-1.5 sm:scale-110 sm:gap-2 lg:scale-125">
          <div className="rounded-full bg-black/55 px-3 py-1 text-center shadow-md">
            <span className="text-xs font-bold tabular-nums text-white sm:text-sm">Pot {bbOrChips(hand.pot, bb)}</span>
            {bb && fmtBB(hand.pot, bb) && <span className="ml-1.5 text-[10px] tabular-nums text-white/55">{fmtChips(hand.pot)}</span>}
          </div>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => <PlayingCard key={i} card={hand.board[i]} size="md" />)}
          </div>
          <div className="text-[9px] uppercase tracking-[0.2em] text-white/55 sm:text-[10px]">{hand.street}</div>
        </div>
      </div>

      {/* committed-bet chips on the felt (toward the pot) */}
      {hand.seats.map((s) => {
        if (!(Number(s.committed) > 0)) return null;
        const bp = towardCenter(pos[s.seat] ?? { x: 50, y: 50 });
        return (
          <div key={`bet-${s.seat}`} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${bp.x}%`, top: `${bp.y}%` }}>
            <span className="flex items-center gap-1 rounded-full border border-amber-400/40 bg-black/75 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-300 shadow sm:text-[11px]">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              {bbOrChips(s.committed, bb)}
            </span>
          </div>
        );
      })}

      {/* seats */}
      {hand.seats.map((s) => (
        <div key={s.seat} className={cn('absolute', s.seat === hand.mySeat && 'z-20')} style={{ left: `${pos[s.seat]?.x}%`, top: `${pos[s.seat]?.y}%` }}>
          <SeatChip seat={s} isMe={s.seat === hand.mySeat} hole={s.seat === hand.mySeat ? hand.myHoleCards : undefined} bb={bb} />
        </div>
      ))}
    </div>
  );
}
