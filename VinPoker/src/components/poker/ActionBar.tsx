// src/components/poker/ActionBar.tsx
// GE-2D — the player action bar (GG-style). The buttons that appear, and their
// amounts, come ONLY from the server's WireLegalActions (types / toCall / canCheck
// / minRaiseTo / maxRaiseTo). The client NEVER decides legality — it renders the
// menu and, when live, POSTs an intent (op = submit_action) to the online-poker-action
// Edge function, which runs the engine and returns the authoritative next state.
//
// While the runtime is dark (RUNTIME_LIVE === false) every control is rendered but
// DISABLED — a preview of the live bar, never a way to act. The %-pot quick sizes +
// slider are display conveniences clamped to [minRaiseTo, maxRaiseTo]; the server
// re-validates every submitted amount. N8-style flat tiles: Fold + Check/Call are neutral
// dark-gray; Tố lên/Cược carries the amber accent; All-in is the deep-red danger affordance.
// Off-turn the bar renders nothing (the felt owns the screen).

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { RUNTIME_LIVE, type ActionType, type PublicHandView } from '@/lib/onlinePoker/types';
import type { WireLegalActions } from '@/lib/onlinePoker/wire';
import { betSizingOptions, clampRaiseTo, fmtBB, fmtChips } from '@/lib/onlinePoker/sizing';
import { Clock } from 'lucide-react';

/** "X BB" if bb known, else raw chips — for inline labels. */
function bbLabel(chips: string, bb?: string): string {
  const inBB = bb ? fmtBB(chips, bb) : '';
  return inBB ? `${inBB} BB` : fmtChips(chips);
}

/** Compact N8 button label: ACTION + amount on ONE inline line (small rectangle, no stack). */
function BtnLabel({ action, chips, bb }: { action: string; chips: string; bb?: string }) {
  const inBB = bb ? fmtBB(chips, bb) : '';
  return (
    <span className="flex items-baseline justify-center gap-1 leading-none">
      <span className="text-[12px] font-semibold uppercase tracking-wide">{action}</span>
      <span className="whitespace-nowrap text-[11px] font-bold tabular-nums opacity-90">{inBB ? `${inBB} BB` : fmtChips(chips)}</span>
    </span>
  );
}

export function ActionBar({
  hand,
  legal,
  bb,
  busy,
  onAction,
}: {
  hand: PublicHandView;
  legal?: WireLegalActions;
  bb?: string;
  /** True while a submitted action is in flight — locks every control so a double-tap
   *  cannot fire a second attempt. */
  busy?: boolean;
  onAction?: (a: { type: ActionType; amount?: string }) => void;
}) {
  // Visual turn (drives what the bar SHOWS) vs interactive (drives whether it can act).
  const isMySeatToAct = hand.toActSeat != null && hand.toActSeat === hand.mySeat;
  const interactive = RUNTIME_LIVE && isMySeatToAct; // drives the label (still my turn)
  const disabled = !interactive || !!busy;           // drives clickability (locked while busy)

  const types = legal?.types ?? [];
  const canFold = types.includes('fold');
  const canCheck = types.includes('check') && !!legal?.canCheck;
  const canCall = types.includes('call');
  const canRaise = types.includes('raise');
  const canBet = types.includes('bet');
  const canAllin = types.includes('allin');
  const showSizing = canRaise || canBet;

  const sizes = useMemo(
    () => (legal && showSizing ? betSizingOptions(legal, { pot: hand.pot }) : []),
    [legal, showSizing, hand.pot],
  );

  // Selected "raise to" — defaults to the minimum legal raise; chips/slider move it.
  const [raiseTo, setRaiseTo] = useState<string>(legal?.minRaiseTo ?? '0');
  useEffect(() => { setRaiseTo(legal?.minRaiseTo ?? '0'); }, [legal?.minRaiseTo, legal?.maxRaiseTo]);

  // Off-turn: render NOTHING (N8). When it isn't your turn the felt owns the whole screen —
  // no "waiting" strip. The dock reappears the instant the turn returns to you.
  if (!isMySeatToAct) return null;

  // My turn, but the legal menu hasn't arrived yet: a slim "loading" strip so it never reads
  // as a frozen bar — the poll loop fills it within ~1 round-trip.
  if (!legal) {
    return (
      <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-muted-foreground">
        <Clock className="h-3.5 w-3.5 opacity-60" />
        Đang tải lựa chọn…
      </div>
    );
  }

  const sliderMin = Number(legal.minRaiseTo);
  const sliderMax = Number(legal.maxRaiseTo);
  const sliderVal = Math.min(sliderMax, Math.max(sliderMin, Number(raiseTo) || sliderMin));
  const sliderStep = Math.max(1, Number(bb) || 1);

  const act = (type: ActionType, amount?: string) => { if (!disabled) onAction?.({ type, amount }); };

  return (
    <div className="mx-auto w-full max-w-md space-y-1.5 rounded-xl border border-white/10 bg-black/60 p-1.5 shadow-[0_-8px_24px_rgba(0,0,0,0.45)] backdrop-blur-sm">
      {/* No header row — the felt already shows whose turn it is (to-act pulse) and the pot
          (Tổng Pot); the Call button shows the amount owed. Keeps the dock a short N8 strip
          so the hero's cards/plate stay clear above it. */}

      {/* N8 bet-size strip — a COMPACT horizontal row of quick-raise chips (each a DIRECT
          raise-to) + a thin slider for fine control confirmed by the "Tố lên" button. Only
          when raising is legal; every amount re-validated server-side (client never decides). */}
      {showSizing && (
        <div className="space-y-1.5">
          <div className="flex items-stretch gap-1.5">
            {sizes.map((s) => {
              const isMax = s.amount === legal.maxRaiseTo;
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => act(canRaise ? 'raise' : 'bet', s.amount)}
                  className="op-press flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md bg-amber-400/90 px-1 py-1 leading-none text-amber-950 transition-colors hover:bg-amber-300 disabled:opacity-50"
                >
                  <span className="text-[11px] font-bold">{isMax ? 'Max' : s.label}</span>
                  <span className="text-[10px] font-semibold tabular-nums opacity-80">{bb && fmtBB(s.amount, bb) ? `${fmtBB(s.amount, bb)} BB` : fmtChips(s.amount)}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-[10px] tabular-nums text-muted-foreground">{bbLabel(legal.minRaiseTo, bb)}</span>
            <Slider
              value={[sliderVal]}
              min={sliderMin}
              max={sliderMax}
              step={sliderStep}
              disabled={disabled}
              onValueChange={(v) => setRaiseTo(clampRaiseTo(legal, String(v[0] ?? sliderMin)))}
              className="flex-1"
              aria-label="Raise to"
            />
            <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{bbLabel(legal.maxRaiseTo, bb)}</span>
          </div>
        </div>
      )}

      {/* bottom action row — N8 flat rectangular tiles in ONE row: Bỏ bài + Theo bài/Check
          neutral dark-gray · Tố lên/Cược amber · All-in deep-red. One short row keeps the
          dock a thin strip the hero's cards stay clear above. */}
      <div className="flex items-stretch gap-2">
        {canFold && (
          <Button
            disabled={disabled}
            onClick={() => act('fold')}
            className="op-press h-11 flex-[0.7] rounded-md bg-zinc-700/80 text-sm font-semibold text-zinc-100 shadow-none hover:bg-zinc-600"
          >
            Bỏ bài
          </Button>
        )}

        {canCheck ? (
          <Button
            disabled={disabled}
            onClick={() => act('check')}
            className="op-press h-11 flex-1 rounded-md bg-zinc-600/85 text-sm font-semibold text-zinc-50 hover:bg-zinc-500"
          >
            Check
          </Button>
        ) : canCall ? (
          <Button
            disabled={disabled}
            onClick={() => act('call', legal.toCall)}
            className="op-press h-11 flex-1 rounded-md bg-zinc-600/85 text-zinc-50 hover:bg-zinc-500"
          >
            <BtnLabel action="Theo bài" chips={legal.toCall} bb={bb} />
          </Button>
        ) : null}

        {(canRaise || canBet) && (
          <Button
            disabled={disabled}
            onClick={() => act(canRaise ? 'raise' : 'bet', raiseTo)}
            className="op-press h-11 flex-[1.2] rounded-md bg-amber-400 text-amber-950 hover:bg-amber-300"
          >
            <BtnLabel action={canRaise ? 'Tố lên' : 'Cược'} chips={raiseTo} bb={bb} />
          </Button>
        )}

        {canAllin && (
          <Button
            disabled={disabled}
            onClick={() => act('allin', legal.maxRaiseTo)}
            className="op-press h-11 flex-[0.9] rounded-md bg-[#991B1B] text-amber-100 hover:bg-[#7d1515]"
          >
            <BtnLabel action="All-in" chips={legal.maxRaiseTo} bb={bb} />
          </Button>
        )}
      </div>
    </div>
  );
}
