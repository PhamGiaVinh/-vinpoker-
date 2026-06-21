// PR-A — Tracker Racetrack Hand-Input UI: the felt + 9 physical seats + board + pot.
// Presentational only; decides nothing about pot/winner/stack/legality.
import {
  SEAT_LAYOUT_9MAX,
  DEALER_ANCHOR,
  betPuckPosition,
  FELT,
  CARD_FACE,
  formatChips,
  toBB,
  isRedCard,
} from './constants';
import type { SeatVM, TrackerRacetrackProps } from './types';

// App number identity (AppDigits-first per tailwind.config) — matches the rest of the app.
const NUM = 'font-display tabular-nums';

function PositionBadge({ position }: { position?: string }) {
  if (!position) return null;
  const p = position.toUpperCase();
  const isBtn = p === 'BTN' || p === 'BU';
  const isBlind = p === 'SB' || p === 'BB';
  const cls = isBtn
    ? 'bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]'
    : isBlind
      ? 'bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))]'
      : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]';
  return (
    <span className={`rounded px-1.5 py-px text-[8px] font-bold leading-none ${cls}`}>
      {position}
    </span>
  );
}

function CommunityCard({ card }: { card: string }) {
  if (!card) {
    return (
      <div
        className="flex h-[58px] w-[42px] items-center justify-center rounded-md text-sm"
        style={{ border: CARD_FACE.emptyBorder, color: CARD_FACE.emptyText }}
      >
        ?
      </div>
    );
  }
  return (
    <div
      className="font-display flex h-[58px] w-[42px] items-center justify-center rounded-md text-lg font-bold shadow-md"
      style={{ background: CARD_FACE.bg, color: isRedCard(card) ? CARD_FACE.red : CARD_FACE.text }}
    >
      {card}
    </div>
  );
}

function Seat({
  seat,
  isActing,
  isDealerButton,
  bigBlind,
  onTap,
}: {
  seat: SeatVM;
  isActing: boolean;
  isDealerButton: boolean;
  bigBlind: number;
  onTap?: () => void;
}) {
  const pos = SEAT_LAYOUT_9MAX[seat.seatNumber];
  if (!pos) return null;
  const tapProps = onTap ? { role: 'button' as const, tabIndex: 0, onClick: onTap } : {};

  if (seat.isEmpty) {
    return (
      <div
        {...tapProps}
        className={`absolute w-24 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/0.4)] px-2 py-3 text-center${onTap ? ' cursor-pointer' : ''}`}
        style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
      >
        <div className={`flex items-center justify-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] ${NUM}`}>
          Ghế {seat.seatNumber}
          {isDealerButton && (
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[hsl(var(--warning))] text-[7px] font-bold text-[hsl(var(--warning-foreground))]">
              D
            </span>
          )}
        </div>
        <div className="text-[10px] text-[hsl(var(--muted-foreground))]">trống</div>
      </div>
    );
  }

  return (
    <div
      {...tapProps}
      className={`absolute w-24 -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-[hsl(var(--card)/0.94)] px-2 py-1.5 ${
        isActing ? 'z-20 border-[hsl(var(--primary))]' : 'z-10 border-[hsl(var(--border))]'
      } ${seat.isFolded ? 'opacity-40 grayscale' : ''}${onTap ? ' cursor-pointer' : ''}`}
      style={{
        left: `${pos.left}%`,
        top: `${pos.top}%`,
        boxShadow: isActing
          ? '0 0 0 1.5px hsl(var(--primary)), 0 0 30px -6px hsl(var(--primary))'
          : undefined,
      }}
    >
      {isActing && (
        <span className="pointer-events-none absolute -inset-1 rounded-xl border-[1.5px] border-[hsl(var(--primary))] opacity-40 motion-safe:animate-ping" />
      )}
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[10px] font-bold text-[hsl(var(--foreground))] ${NUM}`}>
          Ghế {seat.seatNumber}
        </span>
        <div className="flex items-center gap-1">
          {isDealerButton && (
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[hsl(var(--warning))] text-[7px] font-bold text-[hsl(var(--warning-foreground))]">
              D
            </span>
          )}
          <PositionBadge position={seat.position} />
        </div>
      </div>
      <div className="truncate text-xs font-semibold text-[hsl(var(--foreground))]">{seat.name}</div>
      <div className={`text-sm font-bold leading-tight text-[hsl(var(--primary))] ${NUM}`}>
        {formatChips(seat.stack)}
      </div>
      <div className={`text-[9px] text-[hsl(var(--primary)/0.6)] ${NUM}`}>
        {toBB(seat.stack, bigBlind)} BB
      </div>
      {seat.isAllIn ? (
        <div className="mt-0.5 inline-block rounded bg-[hsl(var(--destructive)/0.18)] px-1 text-[8px] font-bold text-[hsl(var(--destructive))]">
          ALL-IN
        </div>
      ) : seat.isFolded ? (
        <div className={`text-[9px] text-[hsl(var(--muted-foreground))] ${NUM}`}>FOLD</div>
      ) : null}
    </div>
  );
}

export function TrackerRacetrack({
  seats,
  actingSeatNumber,
  dealerSeatNumber,
  boardCards,
  pot,
  bigBlind,
  onSeatTap,
}: TrackerRacetrackProps) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-[9999px] aspect-[13/6] min-h-[360px]"
      style={FELT}
    >
      {/* Center: pot + board */}
      <div
        className="absolute w-[320px] -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ left: '50%', top: '40%' }}
      >
        <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">Tổng Pot</div>
        <div
          className={`text-[27px] font-bold leading-tight text-[hsl(var(--primary))] ${NUM}`}
          style={{ textShadow: '0 0 22px hsl(var(--primary) / 0.3)' }}
        >
          {formatChips(pot)}
        </div>
        <div className="mt-2.5 flex justify-center gap-1.5">
          {boardCards.map((card, i) => (
            <CommunityCard key={i} card={card} />
          ))}
        </div>
      </div>

      {/* Committed-chip pucks (behind seats) */}
      {seats.map((seat) => {
        const anchor = SEAT_LAYOUT_9MAX[seat.seatNumber];
        if (!anchor || seat.isEmpty || seat.isFolded || !seat.committed) return null;
        const puck = betPuckPosition(anchor);
        return (
          <div
            key={`bet-${seat.seatNumber}`}
            className={`absolute z-[4] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.14)] px-2 py-px text-[10px] font-bold text-[hsl(var(--warning))] ${NUM}`}
            style={{ left: `${puck.left}%`, top: `${puck.top}%` }}
          >
            {formatChips(seat.committed)}
          </div>
        );
      })}

      {/* Seats */}
      {seats.map((seat) => (
        <Seat
          key={seat.seatNumber}
          seat={seat}
          isActing={seat.seatNumber === actingSeatNumber}
          isDealerButton={seat.seatNumber === dealerSeatNumber}
          bigBlind={bigBlind}
          onTap={onSeatTap ? () => onSeatTap(seat.seatNumber) : undefined}
        />
      ))}

      {/* Human dealer station — fixed bottom-center */}
      <div
        className="absolute z-[7] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-xl border border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--warning)/0.1)] px-3.5 py-1.5"
        style={{ left: `${DEALER_ANCHOR.left}%`, top: `${DEALER_ANCHOR.top}%` }}
      >
        <div className="leading-tight">
          <b className="block text-xs font-bold tracking-[0.1em] text-[hsl(var(--warning))]">
            DEALER
          </b>
          <span className="text-[8px] text-[hsl(var(--muted-foreground))]">người chia · cố định</span>
        </div>
      </div>

      {/* Tracker cue */}
      <div className="absolute bottom-1.5 left-1/2 z-[7] -translate-x-1/2 text-center">
        <div className="text-xs leading-none text-[hsl(var(--primary))]">▲</div>
        <div className="text-[8.5px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--primary))]">
          Tracker đứng đây
        </div>
      </div>
    </div>
  );
}
