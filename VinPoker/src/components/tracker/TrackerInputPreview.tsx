// PR-A — Tracker Racetrack Hand-Input UI: standalone PREVIEW (mock data only).
//
// This PR intentionally does NOT wire the tracker into the router/nav. To preview
// locally, temporarily render <TrackerInputPreview /> from any route (e.g. drop it
// into a scratch page) and run `npm run dev` — then revert that temporary mount.
// All callbacks only console.log the emitted ActionIntent; nothing hits Supabase.
import { useRef, useState } from 'react';
import { TrackerRacetrack } from './TrackerRacetrack';
import { ActionDock } from './ActionDock';
import { formatChips } from './constants';
import type { ActionIntent, SeatVM } from './types';

const BIG_BLIND = 400;
const DEALER_SEAT = 9;

// Mock matching vinpoker-tracker-racetrack.html (seat 5 acting, SB/BB committed, 3 & 7 folded).
const SEATS: SeatVM[] = [
  { seatNumber: 1, name: 'Wilson Ng', position: 'SB', stack: 19800, committed: 200 },
  { seatNumber: 2, name: 'linh@cr1', position: 'BB', stack: 19600, committed: 400 },
  { seatNumber: 3, name: 'zznhatlezz', position: 'UTG', stack: 20000, isFolded: true },
  { seatNumber: 4, name: 'teagbs', position: 'UTG+1', stack: 33000 },
  { seatNumber: 5, name: 'Karma 123', position: 'MP', stack: 29800 },
  { seatNumber: 6, name: 'DVC2205', position: 'LJ', stack: 28900 },
  { seatNumber: 7, name: 'player_07', position: 'HJ', stack: 14000, isFolded: true },
  { seatNumber: 8, name: 'Minh Tuan', position: 'CO', stack: 28900 },
  { seatNumber: 9, name: 'Hung 88', position: 'BTN', stack: 9900 },
];
const BOARD = ['5♦', '6♦', 'K♠', '10♠', 'A♦'];
const POT = 4250;

const isActable = (s?: SeatVM) => !!s && !s.isEmpty && !s.isFolded && !s.isAllIn;

/** Next physical seat (by seatNumber, wrapping 1..9) that can act. */
function nextActing(seats: SeatVM[], from: number): number {
  for (let i = 1; i <= 9; i++) {
    const n = ((from - 1 + i) % 9) + 1;
    if (isActable(seats.find((s) => s.seatNumber === n))) return n;
  }
  return from;
}

export function TrackerInputPreview() {
  const [actingSeatNumber, setActingSeatNumber] = useState<number | null>(5);
  const [flash, setFlash] = useState<string | null>(null);
  const history = useRef<number[]>([]);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFlash = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1300);
  };

  const actingSeat = SEATS.find((s) => s.seatNumber === actingSeatNumber) ?? null;

  // Mock "to call" for the demo: highest committed this street minus the actor's own.
  const highestCommitted = Math.max(
    0,
    ...SEATS.filter((s) => !s.isFolded && !s.isEmpty).map((s) => s.committed ?? 0),
  );
  const toCall = actingSeat ? Math.max(0, highestCommitted - (actingSeat.committed ?? 0)) : 0;

  const handleIntent = (intent: ActionIntent) => {
    console.log('[tracker intent]', intent);
    if (actingSeatNumber != null) history.current.push(actingSeatNumber);
    setActingSeatNumber((cur) => (cur == null ? null : nextActing(SEATS, cur)));
    showFlash('✓ đã ghi · → ghế kế');
  };

  const handleUndo = () => {
    console.log('[tracker undo]');
    const prev = history.current.pop();
    if (prev != null) {
      setActingSeatNumber(prev);
      showFlash('↶ hoàn tác · ← ghế trước');
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-3 p-3">
      {/* Status header (mock) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="font-display text-base font-bold text-[hsl(var(--primary))]">
            Hand #14 · Bàn 1
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-2 py-0.5 text-[10px] font-bold text-[hsl(var(--primary-foreground))]">
            <span className="h-1.5 w-1.5 rounded-full bg-current" /> LIVE
          </span>
          <span className="font-display text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
            Lv.3 · 200/400 · pot {formatChips(POT)}
          </span>
        </div>
        <span className="rounded border border-dashed border-[hsl(var(--warning)/0.4)] px-2 py-0.5 text-[10px] text-[hsl(var(--warning))]">
          PREVIEW · mock data · intents → console
        </span>
      </div>

      <TrackerRacetrack
        seats={SEATS}
        actingSeatNumber={actingSeatNumber}
        dealerSeatNumber={DEALER_SEAT}
        boardCards={BOARD}
        pot={POT}
        bigBlind={BIG_BLIND}
      />

      <div className="relative">
        {flash && (
          <div className="absolute -top-6 right-1 text-[11px] font-semibold text-[hsl(var(--primary))]">
            {flash}
          </div>
        )}
        <ActionDock
          actingSeat={actingSeat}
          toCall={toCall}
          bigBlind={BIG_BLIND}
          onIntent={handleIntent}
          onUndo={handleUndo}
        />
      </div>
    </div>
  );
}
