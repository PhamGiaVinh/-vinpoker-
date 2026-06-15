// src/components/poker/ActionBar.tsx
// GE-2D — the player action bar (GG-style). The buttons that appear, and their
// amounts, come ONLY from the server's WireLegalActions (types / toCall / canCheck
// / minRaiseTo / maxRaiseTo). The client NEVER decides legality — it renders the
// menu and, when live, POSTs an intent (op = submit_action) to the online-poker-action
// Edge function, which runs the engine and returns the authoritative next state.
//
// While the runtime is dark (RUNTIME_LIVE === false) every control is rendered but
// DISABLED — this is a preview of the live bar, never a way to act. The %-pot quick
// sizes + slider are display conveniences clamped to [minRaiseTo, maxRaiseTo]; the
// server re-validates every submitted amount.

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { RUNTIME_LIVE, type ActionType, type PublicHandView } from '@/lib/onlinePoker/types';
import type { WireLegalActions } from '@/lib/onlinePoker/wire';
import { betSizingOptions, clampRaiseTo, fmtBB, fmtChips } from '@/lib/onlinePoker/sizing';
import { Clock } from 'lucide-react';

/** Two-line amount: big "X BB" + small raw chips (falls back to chips-only). */
function Amt({ chips, bb, className }: { chips: string; bb?: string; className?: string }) {
  const inBB = bb ? fmtBB(chips, bb) : '';
  if (!inBB) return <span className={cn('tabular-nums', className)}>{fmtChips(chips)}</span>;
  return (
    <span className={cn('flex flex-col items-center leading-none', className)}>
      <span className="text-[13px] font-semibold tabular-nums">{inBB} BB</span>
      <span className="text-[10px] tabular-nums opacity-75">{fmtChips(chips)}</span>
    </span>
  );
}

export function ActionBar({
  hand,
  legal,
  bb,
  onAction,
}: {
  hand: PublicHandView;
  legal?: WireLegalActions;
  bb?: string;
  onAction?: (a: { type: ActionType; amount?: string }) => void;
}) {
  // Visual turn (drives what the bar SHOWS) vs interactive (drives whether it can act).
  const isMySeatToAct = hand.toActSeat != null && hand.toActSeat === hand.mySeat;
  const interactive = RUNTIME_LIVE && isMySeatToAct;
  const disabled = !interactive;

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

  // Not the viewer's turn (or no menu): a slim placeholder so the surface is stable.
  if (!isMySeatToAct || !legal) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center text-sm text-muted-foreground">
        Đang chờ lượt của bạn…
      </div>
    );
  }

  const sliderMin = Number(legal.minRaiseTo);
  const sliderMax = Number(legal.maxRaiseTo);
  const sliderVal = Math.min(sliderMax, Math.max(sliderMin, Number(raiseTo) || sliderMin));
  const sliderStep = Math.max(1, Number(bb) || 1);

  const act = (type: ActionType, amount?: string) => { if (!disabled) onAction?.({ type, amount }); };

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-3">
      {/* turn-timer bar (purely visual while dark) */}
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-primary/80" />
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-primary" style={{ width: interactive ? '62%' : '100%' }} />
        </div>
        {!RUNTIME_LIVE && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-muted-foreground">Xem trước</span>
        )}
      </div>

      {/* %-pot sizing strip — shown when bet/raise is legal */}
      {showSizing && (
        <div className="space-y-2 rounded-lg bg-white/[0.03] p-2">
          <div className="flex items-center gap-1.5">
            {sizes.map((s) => (
              <button
                key={s.key}
                type="button"
                disabled={disabled}
                onClick={() => setRaiseTo(s.amount)}
                className={cn(
                  'h-9 flex-1 rounded-md border text-xs font-medium tabular-nums transition-colors',
                  s.amount === raiseTo
                    ? 'border-primary/60 bg-primary/15 text-primary'
                    : 'border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08]',
                  'disabled:opacity-50',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
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
            <div className="min-w-[88px] text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Raise to</div>
              <div className="text-sm font-semibold tabular-nums text-primary">
                {bb && fmtBB(raiseTo, bb) ? `${fmtBB(raiseTo, bb)} BB` : fmtChips(raiseTo)}
              </div>
              {bb && fmtBB(raiseTo, bb) && (
                <div className="text-[10px] tabular-nums text-muted-foreground">{fmtChips(raiseTo)}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* primary actions: Fold · Check/Call · Bet/Raise */}
      <div className="flex items-stretch gap-2">
        {canFold && (
          <Button
            disabled={disabled}
            onClick={() => act('fold')}
            className="min-h-[3.25rem] flex-1 bg-rose-800/90 text-rose-50 hover:bg-rose-700"
          >
            Fold
          </Button>
        )}

        {canCheck ? (
          <Button
            disabled={disabled}
            onClick={() => act('check')}
            className="min-h-[3.25rem] flex-1 bg-emerald-600 text-emerald-50 hover:bg-emerald-500"
          >
            Check
          </Button>
        ) : canCall ? (
          <Button
            disabled={disabled}
            onClick={() => act('call', legal.toCall)}
            className="min-h-[3.25rem] flex-1 flex-col gap-0 bg-emerald-600 text-emerald-50 hover:bg-emerald-500"
          >
            <span className="text-[11px] uppercase tracking-wide opacity-80">Call</span>
            <Amt chips={legal.toCall} bb={bb} />
          </Button>
        ) : null}

        {(canRaise || canBet) && (
          <Button
            disabled={disabled}
            onClick={() => act(canRaise ? 'raise' : 'bet', raiseTo)}
            className="min-h-[3.25rem] flex-1 flex-col gap-0 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <span className="text-[11px] uppercase tracking-wide opacity-80">{canRaise ? 'Raise to' : 'Bet'}</span>
            <Amt chips={raiseTo} bb={bb} />
          </Button>
        )}
      </div>

      {/* all-in (full width) */}
      {canAllin && (
        <Button
          disabled={disabled}
          onClick={() => act('allin', legal.maxRaiseTo)}
          className="h-11 w-full bg-amber-500/90 text-amber-950 hover:bg-amber-500"
        >
          <span className="mr-2 text-[11px] uppercase tracking-wide opacity-80">All-in</span>
          <Amt chips={legal.maxRaiseTo} bb={bb} className="flex-row items-baseline gap-1" />
        </Button>
      )}
    </div>
  );
}
