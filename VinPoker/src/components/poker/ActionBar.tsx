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
// re-validates every submitted amount. Visual hierarchy: Raise is the primary CTA
// (neon), Call is positive (green), All-in is a muted/danger affordance (amber tint).

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

/** Stacked button label: ACTION / "X BB" / chips (BB never wraps alone). */
function BtnLabel({ action, chips, bb }: { action: string; chips: string; bb?: string }) {
  const inBB = bb ? fmtBB(chips, bb) : '';
  return (
    <span className="flex flex-col items-center gap-0.5 leading-none">
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">{action}</span>
      {inBB ? (
        <>
          <span className="whitespace-nowrap text-[13px] font-bold tabular-nums">{inBB} BB</span>
          <span className="text-[9px] tabular-nums opacity-75">{fmtChips(chips)}</span>
        </>
      ) : (
        <span className="whitespace-nowrap text-[13px] font-bold tabular-nums">{fmtChips(chips)}</span>
      )}
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

  // Not the viewer's turn (or menu not yet loaded): a slim placeholder so the surface is
  // stable. When it IS my turn but the legal menu hasn't arrived yet, say so explicitly so
  // it never reads as a frozen "waiting" bar — the poll loop fills it within ~1 round-trip.
  if (!isMySeatToAct || !legal) {
    // Off-turn: a slim, collapsed dock so the felt keeps the screen. When it IS my turn but
    // the menu hasn't arrived yet, say so explicitly (the poll fills it within ~1 round-trip)
    // so it never reads as a frozen bar.
    return (
      <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-muted-foreground">
        <Clock className="h-3.5 w-3.5 opacity-60" />
        {isMySeatToAct ? 'Đang tải lựa chọn…' : 'Đang chờ tới lượt bạn…'}
      </div>
    );
  }

  const sliderMin = Number(legal.minRaiseTo);
  const sliderMax = Number(legal.maxRaiseTo);
  const sliderVal = Math.min(sliderMax, Math.max(sliderMin, Number(raiseTo) || sliderMin));
  const sliderStep = Math.max(1, Number(bb) || 1);

  const act = (type: ActionType, amount?: string) => { if (!disabled) onAction?.({ type, amount }); };

  return (
    <div className="mx-auto w-full max-w-md space-y-2.5 rounded-2xl border border-white/10 bg-black/45 p-3 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
      {/* turn / preview header */}
      <div className="flex items-center justify-between gap-2">
        <span className={cn(
          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
          interactive ? 'bg-primary/15 text-primary' : 'bg-white/10 text-muted-foreground',
        )}>
          <Clock className="h-3 w-3" />
          {busy ? 'Đang gửi…' : interactive ? 'Lượt của bạn' : 'Xem trước · đã khóa'}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {canCheck ? `Pot ${bbLabel(hand.pot, bb)}` : `Cược ${bbLabel(legal.toCall, bb)} · Pot ${bbLabel(hand.pot, bb)}`}
        </span>
      </div>

      {/* thin turn-timer bar (purely visual while dark) */}
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <div className={cn('h-full rounded-full', interactive ? 'bg-primary' : 'bg-white/20')} style={{ width: interactive ? '62%' : '100%' }} />
      </div>

      {/* %-pot sizing strip — quick chips (label + amount) + slider with min/max */}
      {showSizing && (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            {sizes.map((s) => (
              <button
                key={s.key}
                type="button"
                disabled={disabled}
                onClick={() => setRaiseTo(s.amount)}
                className={cn(
                  'flex h-12 flex-1 flex-col items-center justify-center rounded-lg border leading-none transition-colors disabled:opacity-50',
                  s.amount === raiseTo
                    ? 'border-primary/60 bg-primary/15 text-primary'
                    : 'border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08]',
                )}
              >
                <span className="text-[11px] font-semibold">{s.label}</span>
                <span className="mt-px text-[8px] tabular-nums opacity-55">{bb && fmtBB(s.amount, bb) ? `${fmtBB(s.amount, bb)} BB` : fmtChips(s.amount)}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-12 text-[10px] tabular-nums text-muted-foreground">{bbLabel(legal.minRaiseTo, bb)}</span>
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
            <span className="w-12 text-right text-[10px] tabular-nums text-muted-foreground">{bbLabel(legal.maxRaiseTo, bb)}</span>
          </div>
        </div>
      )}

      {/* primary actions — big thumb-zone row; hierarchy by weight + colour:
          Fold = quiet ghost · Check/Call = green (positive) · Bet/Raise = gold + widest CTA */}
      <div className="flex items-stretch gap-2">
        {canFold && (
          <Button
            disabled={disabled}
            onClick={() => act('fold')}
            className="op-press min-h-[3.5rem] flex-[0.8] rounded-xl border border-white/15 bg-white/[0.05] text-sm font-semibold text-white/85 shadow-none hover:bg-white/10 hover:text-white"
          >
            Fold
          </Button>
        )}

        {canCheck ? (
          <Button
            disabled={disabled}
            onClick={() => act('check')}
            className="op-press min-h-[3.5rem] flex-1 rounded-xl bg-emerald-500 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
          >
            Check
          </Button>
        ) : canCall ? (
          <Button
            disabled={disabled}
            onClick={() => act('call', legal.toCall)}
            className="op-press min-h-[3.5rem] flex-1 rounded-xl bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          >
            <BtnLabel action="Call" chips={legal.toCall} bb={bb} />
          </Button>
        ) : null}

        {(canRaise || canBet) && (
          <Button
            disabled={disabled}
            onClick={() => act(canRaise ? 'raise' : 'bet', raiseTo)}
            className="op-press min-h-[3.5rem] flex-[1.5] rounded-xl bg-amber-400 text-amber-950 hover:bg-amber-300"
          >
            <BtnLabel action={canRaise ? 'Raise to' : 'Bet'} chips={raiseTo} bb={bb} />
          </Button>
        )}
      </div>

      {/* all-in — a clear deep-red danger affordance, full width, below the primary row */}
      {canAllin && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => act('allin', legal.maxRaiseTo)}
          className="op-press flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#991B1B] text-amber-100 hover:bg-[#7d1515] disabled:opacity-50"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide opacity-85">All-in</span>
          <span className="whitespace-nowrap text-[13px] font-bold tabular-nums">
            {bb && fmtBB(legal.maxRaiseTo, bb) ? `${fmtBB(legal.maxRaiseTo, bb)} BB · ${fmtChips(legal.maxRaiseTo)}` : fmtChips(legal.maxRaiseTo)}
          </span>
        </button>
      )}
    </div>
  );
}
