// src/components/poker/SeatRing.tsx
// GE-2D — the table felt + seats (GG-style), pure presentation of a PublicHandView.
// Each seat is an avatar (initials) + nameplate with stack in BB + chips; the
// committed bet shows as a chip on the felt toward the pot; the to-act seat gets a
// neon ring. The viewer's own seat (mySeat) is anchored at the bottom and shows its
// private hole cards; every other seat shows face-down cards (or revealedCards at
// showdown, or a folded marker). Red felt is permitted here (poker-table visual).

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
  const rx = 44, ry = 40; // percent radii
  ordered.forEach((s, i) => {
    // bottom = 90deg; step clockwise so my seat sits at the bottom center.
    const ang = (Math.PI / 2) + ((i - myIdx) / n) * 2 * Math.PI;
    out[s.seat] = { x: 50 + rx * Math.cos(ang), y: 50 + ry * Math.sin(ang) };
  });
  return out;
}

/** A point 38% of the way from a seat toward the table centre (where bets sit). */
function towardCenter(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x + (50 - p.x) * 0.38, y: p.y + (50 - p.y) * 0.38 };
}

function SeatChip({ seat, isMe, hole, bb }: { seat: PublicSeatView; isMe: boolean; hole?: string[]; bb?: string }) {
  const empty = seat.status === 'empty';
  const folded = seat.status === 'folded';
  const sittingOut = seat.status === 'sitting_out';

  if (empty) {
    return (
      <div className="w-20 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashed border-white/15 bg-black/30 py-3 text-center text-[11px] text-white/40">
        Ghế {seat.seat}
      </div>
    );
  }

  const cards = isMe
    ? (hole && hole.length ? hole : ['?', '?']).map((c, i) => <PlayingCard key={i} card={c} size={isMe ? 'md' : 'sm'} />)
    : folded
      ? <span className="px-2 py-1 text-[11px] text-white/50">đã bỏ</span>
      : seat.revealedCards?.length
        ? seat.revealedCards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
        : <><PlayingCard size="sm" /><PlayingCard size="sm" /></>;

  return (
    <div className={cn('flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1', (folded || sittingOut) && 'opacity-55')}>
      <div className="flex items-end gap-0.5">{cards}</div>

      <div className="relative">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white shadow-lg',
            AVATAR_BG[seat.seat % AVATAR_BG.length],
            seat.isToAct ? 'ring-2 ring-primary ring-offset-2 ring-offset-black' : 'ring-1 ring-white/20',
          )}
        >
          {initials(seat.displayName, seat.seat)}
        </div>
        {seat.isButton && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold text-black shadow">D</span>
        )}
        {seat.isToAct && (
          <span className="absolute -bottom-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-black shadow">
            <Clock className="h-2.5 w-2.5" />
          </span>
        )}
      </div>

      <div className={cn(
        'w-full rounded-lg border px-1.5 py-0.5 text-center',
        seat.isToAct ? 'border-primary/60 bg-primary/10' : 'border-white/10 bg-black/55',
      )}>
        <div className="truncate text-[11px] font-medium text-white">{seat.displayName ?? `Ghế ${seat.seat}`}</div>
        <div className="text-[11px] font-semibold tabular-nums text-primary">{bbOrChips(seat.stack, bb)}</div>
      </div>

      {sittingOut && <div className="text-[9px] uppercase tracking-wide text-white/40">sitting out</div>}
    </div>
  );
}

export function SeatRing({ hand, bb }: { hand: PublicHandView; bb?: string }) {
  const pos = seatPositions(hand.seats, hand.mySeat);

  return (
    <div className="relative mx-auto aspect-[16/10] w-full max-w-3xl">
      {/* felt */}
      <div className="absolute inset-[8%] rounded-[48%] border-4 border-emerald-950/80 bg-[radial-gradient(ellipse_at_center,_#0f5132_0%,_#093b25_60%,_#06281a_100%)] shadow-[inset_0_0_60px_rgba(0,0,0,0.6)]">
        {/* board + pot */}
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
          <div className="rounded-full bg-black/45 px-3 py-1 text-center text-white">
            <span className="text-xs font-semibold tabular-nums">Pot {bbOrChips(hand.pot, bb)}</span>
            {bb && fmtBB(hand.pot, bb) && <span className="ml-1.5 text-[10px] tabular-nums text-white/50">{fmtChips(hand.pot)}</span>}
          </div>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => <PlayingCard key={i} card={hand.board[i]} size="md" />)}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-white/60">{hand.street}</div>
        </div>
      </div>

      {/* committed-bet chips on the felt (toward the pot) */}
      {hand.seats.map((s) => {
        if (!(Number(s.committed) > 0)) return null;
        const bp = towardCenter(pos[s.seat] ?? { x: 50, y: 50 });
        return (
          <div key={`bet-${s.seat}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${bp.x}%`, top: `${bp.y}%` }}>
            <span className="flex items-center gap-1 rounded-full border border-amber-400/30 bg-black/70 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              {bbOrChips(s.committed, bb)}
            </span>
          </div>
        );
      })}

      {/* seats */}
      {hand.seats.map((s) => (
        <div key={s.seat} className="absolute" style={{ left: `${pos[s.seat]?.x}%`, top: `${pos[s.seat]?.y}%` }}>
          <SeatChip seat={s} isMe={s.seat === hand.mySeat} hole={s.seat === hand.mySeat ? hand.myHoleCards : undefined} bb={bb} />
        </div>
      ))}
    </div>
  );
}
