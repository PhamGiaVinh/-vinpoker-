// src/dev/TablePreview.tsx
// DEV-ONLY visual harness. Renders the REAL poker components (SeatRing / AllInRunout /
// ActionBar) with TYPED mock fixtures driven by URL params, inside the same chrome-less
// shell layout as OnlinePokerTable — so a screenshot looks like the real table.
//
// It NEVER imports the engine, the live hooks/store, or Supabase: pure props in. Reached
// ONLY via the dev-gated route /__dev/table (import.meta.env.DEV) — not linked anywhere,
// tree-shaken out of the prod bundle. Driven by e2e/table-shots.spec.ts to auto-screenshot
// every state.
//
// URL params:
//   seats = 2 | 6 | 9                          how many seated players
//   phase = preflop | flop | turn | river | showdown
//   allin = 0 | 1                              1 → render the AllInRunout cinematic
//   toAct = <seat>                             seat to act (default = my seat 1). Set to an
//                                              opponent seat to render an OFF-TURN state so
//                                              we can screenshot "no dock" + check felt jump.
//   skin  = emerald | premium                  felt skin
//
// 100% ADDITIVE: it consumes the components' public props verbatim (PublicHandView +
// WireLegalActions) — it does not modify any of them.

import { useSearchParams } from 'react-router-dom';
import { SeatRing } from '@/components/poker/SeatRing';
import { HeroHud } from '@/components/poker/HeroHud';
import { AllInRunout } from '@/components/poker/AllInRunout';
import { ActionBar } from '@/components/poker/ActionBar';
import type { FeltSkin } from '@/lib/onlinePoker/feltSkin';
import type { PublicHandResult, PublicHandView, PublicSeatView } from '@/lib/onlinePoker/types';
import type { WireLegalActions } from '@/lib/onlinePoker/wire';

const BB = '50';

type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
const PHASES: Phase[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

const NAMES = ['Bạn', 'Wilson Ng', 'zznhatlezz', 'karma 123', 'teagbs', 'Ngồi Ngoài', 'linh', 'davinci', 'pgv'];

// All cards across board + reveals are DISTINCT so AllInRunout's heads-up equity calc is valid.
const BOARD: Record<Phase, string[]> = {
  preflop: [],
  flop: ['9d', '3c', '4h'],
  turn: ['9d', '3c', '4h', 'Ks'],
  river: ['9d', '3c', '4h', 'Ks', '8c'],
  showdown: ['9d', '3c', '4h', 'Ks', '8c'],
};

function mkSeat(n: number, over: Partial<PublicSeatView> = {}): PublicSeatView {
  return {
    seat: n,
    playerId: `p${n}`,
    displayName: NAMES[(n - 1) % NAMES.length],
    stack: '5000',
    committed: '0',
    status: 'active',
    ...over,
  };
}

/**
 * Build a typed PublicHandView (+ optional legal menu) for one state. Chips are decimal
 * strings (server contract); cards are distinct 2-char strings. The all-in fixture mirrors
 * the proven onlinePoker test shape so AllInRunout's plan + equity never throw.
 */
function buildFixture(seatsN: number, phase: Phase, allin: boolean, toAct?: number): { hand: PublicHandView; legal?: WireLegalActions } {
  const mySeat = 1;
  const n = Math.max(2, Math.min(9, seatsN));

  // ── all-in cinematic: a COMPLETED heads-up showdown (seats 1+2 all-in, others folded) ──
  if (allin) {
    const seats: PublicSeatView[] = [];
    for (let i = 1; i <= n; i++) {
      if (i === 1) seats.push(mkSeat(1, { displayName: 'Bạn', stack: '0', status: 'allin', revealedCards: ['8s', 'Tc'] }));
      else if (i === 2) seats.push(mkSeat(2, { stack: '20000', status: 'allin', revealedCards: ['Ac', '5d'] }));
      else seats.push(mkSeat(i, { status: 'folded' }));
    }
    seats[n - 1].isButton = true;
    const result: PublicHandResult = {
      endedBy: 'showdown',
      potTotal: '20000',
      potAwards: [{ potIndex: 0, amount: '20000', winners: [2] }],
      payouts: { 2: '20000' },
    };
    const hand: PublicHandView = {
      handId: 'fx-allin', tableId: 'fx', handNo: 7, street: 'showdown',
      board: ['2s', 'Qd', 'Ad', '3d', '4h'], pot: '0', toActSeat: null,
      buttonSeat: n, status: 'complete', seats, result, mySeat, myHoleCards: ['8s', 'Tc'],
    };
    return { hand };
  }

  // ── normal betting / showdown ──
  const complete = phase === 'showdown';
  const seats: PublicSeatView[] = [];
  for (let i = 1; i <= n; i++) {
    const s = mkSeat(i, i === 1 ? { displayName: 'Bạn' } : {});
    if (complete) {
      if (i === 1) s.revealedCards = ['As', 'Kh'];
      else if (i === 2) s.revealedCards = ['Qd', 'Qc'];
      else s.status = 'folded';
    } else {
      // mid-betting: an opponent has a live bet, one folded, one sitting out (≥6 seats)
      if (i === 2) s.committed = phase === 'preflop' ? '50' : '300';
      if (i === 3) s.status = 'folded';
      if (i === 5 && n >= 6) s.status = 'sitting_out';
    }
    seats.push(s);
  }
  seats[n - 1].isButton = true;
  // `toAct` (default = my seat) lets the harness render an OFF-TURN state (actor != mySeat)
  // so we can screenshot "no dock" + check the felt doesn't jump between turns.
  const actor = toAct && toAct >= 1 && toAct <= n ? toAct : mySeat;
  if (!complete) seats[actor - 1].isToAct = true; // my turn → ActionBar dock; off-turn → no dock

  const result: PublicHandResult | undefined = complete
    ? { endedBy: 'showdown', potTotal: '10000', potAwards: [{ potIndex: 0, amount: '10000', winners: [1] }], payouts: { 1: '10000' } }
    : undefined;

  const hand: PublicHandView = {
    handId: 'fx', tableId: 'fx', handNo: 7,
    street: phase,
    board: BOARD[phase],
    pot: complete ? '10000' : phase === 'preflop' ? '175' : '1250',
    toActSeat: complete ? null : actor,
    buttonSeat: n,
    status: complete ? 'complete' : 'betting',
    seats,
    ...(result ? { result } : {}),
    myHoleCards: ['As', 'Kh'],
    mySeat,
  };

  // Legal menu exists ONLY when it is my turn — off-turn the server sends none, so the dock
  // collapses (mirrors the live contract). This is what drives the #2 "no off-turn dock" shot.
  const legal: WireLegalActions | undefined = complete || actor !== mySeat
    ? undefined
    : {
        seat: mySeat,
        types: ['fold', 'call', 'raise', 'allin'],
        toCall: phase === 'preflop' ? '50' : '300',
        canCheck: false,
        minRaiseTo: phase === 'preflop' ? '100' : '600',
        maxRaiseTo: '5000',
      };
  return { hand, legal };
}

export default function TablePreview() {
  const [params] = useSearchParams();
  const seatsN = Number(params.get('seats')) || 6;
  const phaseParam = params.get('phase') as Phase | null;
  const phase: Phase = phaseParam && PHASES.includes(phaseParam) ? phaseParam : 'flop';
  const allin = params.get('allin') === '1';
  const toAct = Number(params.get('toAct')) || undefined; // default → my seat (on-turn)
  const skin: FeltSkin = params.get('skin') === 'premium' ? 'premium' : 'emerald';
  const immersive = params.get('immersive') === '1'; // preview the edge-to-edge full-screen shell

  const { hand, legal } = buildFixture(seatsN, phase, allin, toAct);
  const winnerSeats = hand.result?.potAwards.flatMap((a) => a.winners);

  // Mirror OnlinePokerTable's chrome-less shell (void room + flex-1 felt + dock) so the
  // screenshot reads like the real table.
  return (
    <div
      data-dev-table-preview
      className={immersive
        ? 'fixed inset-0 z-[60] flex h-[100dvh] w-full flex-col overflow-hidden bg-background [padding-bottom:env(safe-area-inset-bottom)]'
        : 'mx-auto flex min-h-[100dvh] w-full max-w-4xl flex-col gap-2 bg-background p-3 sm:p-4 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] [padding-top:max(0.75rem,env(safe-area-inset-top))]'}
      style={{ background: 'radial-gradient(130% 85% at 50% 26%, #0b1410 0%, #07090b 72%)' }}
    >
      <header className={immersive
        ? 'absolute inset-x-0 top-0 z-50 flex items-center gap-1 bg-gradient-to-b from-black/60 via-black/30 to-transparent px-2 pb-3 text-white/80 [padding-top:max(0.25rem,env(safe-area-inset-top))]'
        : 'flex items-center gap-2 rounded-xl bg-black/25 px-2 py-1 text-white/80'}>
        <span className="text-base font-semibold">Bàn 1 · DEV</span>
        <span className="rounded-md border border-white/15 px-1.5 py-0.5 text-[11px] tabular-nums">25/50</span>
        <span className="ml-auto text-[11px] text-white/45">seats={seatsN} · {allin ? 'all-in' : phase} · {skin}</span>
      </header>

      {/* `relative` + floating dock mirror OnlinePokerTable exactly: the felt keeps full size
          every turn; the dock floats over its bottom edge ONLY when it's my turn. */}
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
        {allin
          ? <AllInRunout hand={hand} bb={BB} skin={skin} />
          : <SeatRing hand={hand} bb={BB} winnerSeats={winnerSeats} skin={skin} heroAsHud />}

        {/* hero HUD — own cards + stack pinned to the SCREEN's bottom-left corner (N8); mirrors
            OnlinePokerTable. FIXED — never lifts. */}
        {!allin && (
          <HeroHud hand={hand} bb={BB} />
        )}

        {/* action dock — ONLY when it's my turn (off-turn fixture → no dock, felt owns the
            screen). Scrim fades the felt under it. Same structure as OnlinePokerTable. */}
        {!allin && legal && hand.toActSeat === hand.mySeat && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-1 pb-1 pt-12 bg-gradient-to-t from-black/80 via-black/45 to-transparent">
            <ActionBar hand={hand} legal={legal} bb={BB} onAction={() => { /* dev no-op */ }} />
          </div>
        )}
      </div>
    </div>
  );
}
