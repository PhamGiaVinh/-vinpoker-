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
    return (
      <div className="w-16 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashed border-white/15 bg-black/30 py-2.5 text-center text-[10px] text-white/35 sm:w-20 sm:text-[11px]">
        Ghế {seat.seat}
      </div>
    );
  }

  const cards = isMe
    ? (hole && hole.length ? hole : ['?', '?']).map((c, i) => <PlayingCard key={i} card={c} size="md" reveal={!!c && c !== '?'} />)
    : folded
      ? <span className="px-2 py-1 text-[11px] text-white/50">đã bỏ</span>
      : sittingOut
        ? <span className="px-2 py-1 text-[11px] text-white/45">chờ ván</span>
        : seat.revealedCards?.length
          ? seat.revealedCards.map((c, i) => <PlayingCard key={i} card={c} size="sm" reveal revealDelayMs={i * 130} />)
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
            seat.isToAct ? 'op-to-act-pulse' : isMe ? 'ring-2 ring-white/40' : 'ring-1 ring-white/15',
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
        isWinner ? 'op-winner-glow border-amber-300/70 bg-amber-300/10'
          : seat.isToAct ? 'border-primary/60 bg-primary/10'
          : isMe ? 'border-white/25 bg-black/65' : 'border-white/10 bg-black/55',
      )}>
        <div className="truncate text-[11px] font-medium text-white sm:text-xs">{seat.displayName ?? `Ghế ${seat.seat}`}</div>
        <div className="text-[11px] font-semibold tabular-nums text-primary sm:text-xs">{bbOrChips(seat.stack, bb)}</div>
      </div>

      {sittingOut && <div className="text-[9px] uppercase tracking-wide text-white/40">sitting out</div>}
    </div>
  );
}

export function SeatRing({
  hand,
  bb,
  winnerSeats,
  collecting = false,
  onEmptySeatClick,
}: {
  hand: PublicHandView;
  bb?: string;
  /** seats to highlight with the soft gold winner glow (live runtime supplies them) */
  winnerSeats?: number[];
  /** when true, committed bets ease toward the pot (end-of-street collection) */
  collecting?: boolean;
  /** when set, empty seats become "+ Ngồi" buttons that call this with the seat number */
  onEmptySeatClick?: (seatNo: number) => void;
}) {
  const pos = seatPositions(hand.seats, hand.mySeat);

  return (
    <div className="relative mx-auto aspect-[5/4] w-full max-w-3xl sm:aspect-[16/10]">
      {/* rail (outer band for depth) */}
      <div className="absolute inset-[4%] rounded-[47%] bg-gradient-to-b from-[#13241c] to-[#070d0a] shadow-[0_16px_46px_rgba(0,0,0,0.6)]" />

      {/* felt — slightly darker, soft centre glow + vignette, thin neon rim */}
      <div
        className="absolute inset-[7%] rounded-[46%] border border-[#0a3a25] shadow-[inset_0_0_80px_rgba(0,0,0,0.72),inset_0_0_0_2px_rgba(0,224,122,0.14)]"
        style={{ background: 'radial-gradient(ellipse at 50% 42%, #15784a 0%, #0c5234 44%, #06301f 78%, #04200f 100%)' }}
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
          <div className={cn('rounded-full bg-black/55 px-3 py-1 text-center shadow-md', winnerSeats?.length && 'op-winner-glow')}>
            <span className="text-xs font-bold tabular-nums text-white sm:text-sm">Pot {bbOrChips(hand.pot, bb)}</span>
            {bb && fmtBB(hand.pot, bb) && <span className="ml-1.5 text-[10px] tabular-nums text-white/55">{fmtChips(hand.pot)}</span>}
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
