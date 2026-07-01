// src/components/poker/AllInRunout.tsx
// Cinematic ALL-IN RUNOUT replay. The hand is ALREADY decided by the server — this only
// re-stages the completed snapshot for drama: reveal hands → flop → equity → turn →
// equity → river → result. The client never decides the winner/pot/stacks; equity is a
// display-only exact heads-up calc (postflop, real or hidden). No action buttons here.

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { PublicHandView } from '@/lib/onlinePoker/types';
import { fmtChips } from '@/lib/onlinePoker/sizing';
import {
  ALLIN_CINEMATIC_PHASES, planAllInCinematic, type CinematicPhase,
} from '@/lib/onlinePoker/allinCinematic';
import { headsUpEquity, type HeadsUpEquity } from '@/lib/poker/handEval';
import type { FeltSkin } from '@/lib/onlinePoker/feltSkin';
import { SeatRing } from './SeatRing';
import { ShowdownResult } from './ShowdownResult';
import { PlayingCard } from './PlayingCard';

const LAST = ALLIN_CINEMATIC_PHASES.length - 1;

const PHASE_TITLE: Record<string, string> = {
  allin_banner: 'All-in!',
  flop: 'Flop',
  flop_equity: 'Tỷ lệ thắng',
  turn: 'Turn',
  turn_equity: 'Tỷ lệ thắng',
  river: 'River',
  final_result: 'Kết quả',
};

/** A staged copy of the completed hand: board sliced, reveals masked to the current phase. */
function stagedView(hand: PublicHandView, revealOrder: number[], phase: CinematicPhase): PublicHandView {
  const revealedSet = new Set(revealOrder.slice(0, phase.revealCount));
  const seats = hand.seats.map((s) => (revealedSet.has(s.seat) ? s : { ...s, revealedCards: undefined }));
  const myRevealed = hand.mySeat != null && revealedSet.has(hand.mySeat);
  return {
    ...hand,
    board: (hand.board ?? []).slice(0, phase.boardVisible),
    seats,
    myHoleCards: myRevealed ? hand.myHoleCards : undefined,
  };
}

export function AllInRunout({
  hand,
  bb,
  onDone,
  skin = 'emerald',
}: {
  hand: PublicHandView;
  bb?: string;
  /** called once the replay (incl. the final result hold) finishes. */
  onDone?: () => void;
  /** felt skin, passed straight through to the staged felt. */
  skin?: FeltSkin;
}) {
  const plan = useMemo(() => planAllInCinematic(hand), [hand]);
  const winnerSeats = useMemo(
    () => Array.from(new Set((hand.result?.potAwards ?? []).flatMap((a) => a.winners))),
    [hand.result],
  );

  // Exact heads-up equity at flop/turn/river (cheap). Preflop is intentionally hidden.
  const equityByLen = useMemo(() => {
    if (!plan.headsUp || plan.revealOrder.length < 2) return {} as Record<number, HeadsUpEquity | null>;
    const a = hand.seats.find((s) => s.seat === plan.revealOrder[0])?.revealedCards;
    const b = hand.seats.find((s) => s.seat === plan.revealOrder[1])?.revealedCards;
    const board = hand.board ?? [];
    if (!a || !b || board.length !== 5) return {} as Record<number, HeadsUpEquity | null>;
    return {
      3: headsUpEquity(a, b, board.slice(0, 3)),
      4: headsUpEquity(a, b, board.slice(0, 4)),
      5: headsUpEquity(a, b, board.slice(0, 5)),
    } as Record<number, HeadsUpEquity | null>;
  }, [hand, plan]);

  // Respect reduced-motion: jump straight to the result.
  const reduced = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [idx, setIdx] = useState(reduced ? LAST : 0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const dur = ALLIN_CINEMATIC_PHASES[idx].durationMs;
    if (idx >= LAST) {
      const id = setTimeout(() => onDoneRef.current?.(), dur);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setIdx((i) => i + 1), dur);
    return () => clearTimeout(id);
  }, [idx]);

  const phase = ALLIN_CINEMATIC_PHASES[idx];
  const isFinal = phase.key === 'final_result';
  const view = stagedView(hand, plan.revealOrder, phase);

  const nameOf = (seat: number): string =>
    seat === hand.mySeat ? 'Bạn' : hand.seats.find((s) => s.seat === seat)?.displayName ?? `Ghế ${seat}`;

  const title =
    phase.key === 'reveal_first' ? `Ghế ${plan.revealOrder[0]} lật bài`
    : phase.key === 'reveal_second' ? `Ghế ${plan.revealOrder[1]} lật bài`
    : PHASE_TITLE[phase.key] ?? '';

  const equity = phase.equityBoardLen > 0 ? equityByLen[phase.equityBoardLen] : undefined;
  const showEquityStrip = phase.equityBoardLen > 0 && !isFinal;

  return (
    // Fill the parent's width + height so the staged felt is full-size and vertically
    // centered. Without w-full this block shrank to the banner's width inside OnlinePokerTable's
    // `items-center justify-center` row → the cinematic read as a tiny box floating in black.
    <div className="flex h-full w-full flex-col justify-center gap-3">
      {/* phase banner */}
      <div className="flex items-center justify-center">
        <span
          key={phase.key}
          className={cn(
            'op-allin-banner inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-extrabold uppercase tracking-[0.15em]',
            phase.key === 'allin_banner'
              ? 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40'
              : isFinal
                ? 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-300/40'
                : 'bg-primary/15 text-primary ring-1 ring-primary/30',
          )}
        >
          {title}
        </span>
      </div>

      {/* the felt — board + reveals staged to this phase; winner glow only at the end */}
      <div className="overflow-hidden rounded-xl bg-black/20 p-2 sm:p-3">
        <SeatRing hand={view} bb={bb} winnerSeats={isFinal ? winnerSeats : undefined} skin={skin} />
      </div>

      {/* equity strip — exact heads-up %, from the flop on (real or hidden) */}
      {showEquityStrip && plan.headsUp && equity && (
        <div className="grid grid-cols-2 gap-2">
          {plan.revealOrder.slice(0, 2).map((seat, i) => {
            const pct = i === 0 ? equity.a : equity.b;
            const cards = hand.seats.find((s) => s.seat === seat)?.revealedCards ?? [];
            return (
              <div key={seat} className="rounded-lg border border-white/10 bg-black/40 p-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[11px] font-medium text-white/80">{nameOf(seat)}</span>
                  <div className="flex gap-0.5">{cards.map((c, k) => <PlayingCard key={k} card={c} size="sm" reveal />)}</div>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-10 text-right text-xs font-bold tabular-nums text-primary">{pct}%</span>
                </div>
                {equity.tie > 0 && <div className="mt-0.5 text-[10px] text-muted-foreground">Hòa {equity.tie}%</div>}
              </div>
            );
          })}
        </div>
      )}
      {showEquityStrip && !plan.headsUp && (
        <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-center text-xs text-muted-foreground">
          Tỷ lệ thắng nhiều người sẽ được bổ sung sau
        </div>
      )}

      {/* pot ticker during the runout */}
      {!isFinal && hand.result && (
        <div className="text-center text-xs text-muted-foreground">
          Pot <span className="font-semibold tabular-nums text-primary">{fmtChips(hand.result.potTotal)}</span>
        </div>
      )}

      {/* final result — server-authoritative winner / pot / refund */}
      {isFinal && hand.result && (
        <ShowdownResult result={hand.result} handNo={hand.handNo} seats={hand.seats} mySeat={hand.mySeat} bb={bb} />
      )}
    </div>
  );
}
