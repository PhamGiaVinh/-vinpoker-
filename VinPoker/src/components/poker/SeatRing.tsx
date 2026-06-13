// src/components/poker/SeatRing.tsx
// GE-2D — the table felt + seats laid out around an ellipse. Pure presentation of
// a PublicHandView. The viewer's own seat (mySeat) is anchored at the bottom and
// shows its private hole cards; every other seat shows face-down cards (or its
// revealedCards at showdown, or a folded marker). Red felt is permitted here
// (poker-table visual component) per the app theme rules.

import { cn } from '@/lib/utils';
import type { PublicHandView, PublicSeatView } from '@/lib/onlinePoker/types';
import { PlayingCard } from './PlayingCard';

const fmtChips = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
};

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

function SeatChip({ seat, isMe, hole }: { seat: PublicSeatView; isMe: boolean; hole?: string[] }) {
  const empty = seat.status === 'empty';
  const folded = seat.status === 'folded';
  const sittingOut = seat.status === 'sitting_out';

  return (
    <div
      className={cn(
        'w-28 -translate-x-1/2 -translate-y-1/2 rounded-xl border p-2 text-center shadow-lg backdrop-blur-sm',
        empty ? 'border-dashed border-white/15 bg-black/30 text-white/40'
          : seat.isToAct ? 'border-primary bg-primary/15 ring-2 ring-primary/40'
          : 'border-white/15 bg-black/55',
        (folded || sittingOut) && 'opacity-50',
      )}
    >
      {empty ? (
        <div className="py-3 text-xs">Ghế {seat.seat} · trống</div>
      ) : (
        <>
          <div className="flex items-center justify-center gap-1">
            {isMe ? (
              (hole && hole.length ? hole : ['?', '?']).map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
            ) : folded ? (
              <span className="text-xs text-white/50 py-2">đã bỏ bài</span>
            ) : seat.revealedCards?.length ? (
              seat.revealedCards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
            ) : (
              <>
                <PlayingCard size="sm" />
                <PlayingCard size="sm" />
              </>
            )}
          </div>
          <div className="mt-1 truncate text-xs font-medium text-white">
            {seat.displayName ?? `Ghế ${seat.seat}`}
            {seat.isButton && <span className="ml-1 rounded-full bg-white px-1 text-[9px] font-bold text-black">D</span>}
          </div>
          <div className="text-[11px] tabular-nums text-primary">{fmtChips(seat.stack)}</div>
          {Number(seat.committed) > 0 && (
            <div className="text-[10px] tabular-nums text-amber-300">đặt {fmtChips(seat.committed)}</div>
          )}
          {sittingOut && <div className="text-[9px] uppercase tracking-wide text-white/40">sitting out</div>}
        </>
      )}
    </div>
  );
}

export function SeatRing({ hand }: { hand: PublicHandView }) {
  const pos = seatPositions(hand.seats, hand.mySeat);

  return (
    <div className="relative mx-auto aspect-[16/10] w-full max-w-3xl">
      {/* felt */}
      <div className="absolute inset-[8%] rounded-[48%] border-4 border-emerald-950/80 bg-[radial-gradient(ellipse_at_center,_#0f5132_0%,_#093b25_60%,_#06281a_100%)] shadow-[inset_0_0_60px_rgba(0,0,0,0.6)]">
        {/* board + pot */}
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
          <div className="rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white tabular-nums">
            Pot {fmtChips(hand.pot)}
          </div>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => <PlayingCard key={i} card={hand.board[i]} size="md" />)}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-white/60">{hand.street}</div>
        </div>
      </div>

      {/* seats */}
      {hand.seats.map((s) => (
        <div key={s.seat} className="absolute" style={{ left: `${pos[s.seat]?.x}%`, top: `${pos[s.seat]?.y}%` }}>
          <SeatChip seat={s} isMe={s.seat === hand.mySeat} hole={s.seat === hand.mySeat ? hand.myHoleCards : undefined} />
        </div>
      ))}
    </div>
  );
}
