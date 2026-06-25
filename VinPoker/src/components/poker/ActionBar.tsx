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
import { betSizingOptions, betSizingOptionsBB, clampRaiseTo, fmtBB, fmtChips } from '@/lib/onlinePoker/sizing';
import { Clock, Grid3x3, ChevronDown, ChevronUp } from 'lucide-react';

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

  // Hybrid sizing (owner spec): PREFLOP shows BB multiples (2/2.5/3/4× the current bet level —
  // scales to a re-raise); POSTFLOP shows %-pot. The current bet level = the largest committed
  // this street (preflop ≥ the BB).
  const isPreflop = hand.street === 'preflop';
  const betLevel = useMemo(() => {
    const maxC = hand.seats.reduce((m, s) => { const c = BigInt(s.committed || '0'); return c > m ? c : m; }, 0n);
    const bbN = bb && /^\d+$/.test(bb) ? BigInt(bb) : 0n;
    return (maxC > bbN ? maxC : bbN).toString();
  }, [hand.seats, bb]);
  const sizes = useMemo(
    () => (!legal || !showSizing ? []
      : isPreflop ? betSizingOptionsBB(legal, { betLevel })
      : betSizingOptions(legal, { pot: hand.pot })),
    [legal, showSizing, isPreflop, betLevel, hand.pot],
  );

  // Selected "raise to" — defaults to the minimum legal raise; chips/slider move it.
  const [raiseTo, setRaiseTo] = useState<string>(legal?.minRaiseTo ?? '0');
  useEffect(() => { setRaiseTo(legal?.minRaiseTo ?? '0'); }, [legal?.minRaiseTo, legal?.maxRaiseTo]);
  // ⊞ reveals the custom-amount slider; ^ collapses the %-sizing column (N8 chevrons).
  const [showCustom, setShowCustom] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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

  // The raise column, top→bottom: All-in (ALWAYS present when legal — independent of the preset
  // list, so a short stack that can't min-raise still sees the shove), then the generator's presets
  // (high→low), then a Min-raise floor. De-duped so no amount repeats.
  const raiseTiles: { key: string; label: string; allin: boolean; amount: string }[] = [];
  const seenTile = new Set<string>();
  if (canAllin) { raiseTiles.push({ key: 'allin', label: '', allin: true, amount: legal.maxRaiseTo }); seenTile.add(legal.maxRaiseTo); }
  for (const s of [...sizes].reverse()) {
    if (seenTile.has(s.amount)) continue;
    seenTile.add(s.amount);
    raiseTiles.push({ key: s.key, label: s.label, allin: false, amount: s.amount });
  }
  if (showSizing && !seenTile.has(legal.minRaiseTo)) {
    raiseTiles.push({ key: 'min', label: 'Min', allin: false, amount: legal.minRaiseTo });
  }

  return (
    // N8 fixed layout: a transparent column — the %-sizing tiles stack on the RIGHT, the
    // Fold/Call row pins to the bottom, and the empty centre stays pointer-events-none so the
    // felt (and the bottom-left hero HUD) are never blocked. Each control group re-enables taps.
    <div className="pointer-events-none mx-auto flex w-full max-w-md flex-col items-stretch gap-1.5">
      {/* (a) bet-sizing — a VERTICAL column on the RIGHT (N8). Preflop tiles are BB multiples
          (2×…4×), postflop are %-pot; All-in sits on top as its OWN tile (never hidden), Min on
          the bottom. Each tile is a DIRECT raise-to; the All-in tile fires the shove. */}
      {raiseTiles.length > 0 && !collapsed && (
        <div className="pointer-events-auto flex w-[8.5rem] flex-col gap-1.5 self-end">
          {raiseTiles.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={disabled}
              onClick={() => (t.allin ? act('allin', t.amount) : act(canRaise ? 'raise' : 'bet', t.amount))}
              className="op-press flex items-center justify-between gap-2 rounded-xl bg-black/85 px-3 py-2 ring-1 ring-white/10 transition-colors hover:bg-black/70 disabled:opacity-50"
            >
              <span className="text-[11px] font-semibold tabular-nums text-white/55">{t.label}</span>
              <span className="flex flex-col items-end leading-none">
                <span className={cn('text-[9px] font-medium uppercase tracking-wide', t.allin ? 'text-red-400' : 'text-white/50')}>{t.allin ? 'Tất tay' : 'Tăng cược'}</span>
                <span className="text-[13px] font-bold tabular-nums text-amber-300">{bb && fmtBB(t.amount, bb) ? `${fmtBB(t.amount, bb)} BB` : fmtChips(t.amount)}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* (b) custom-amount panel — revealed by ⊞: the fine-control slider + a confirm button
          (the slider is inert without it). Right-aligned, same width as the %-column. */}
      {showSizing && showCustom && (
        <div className="pointer-events-auto w-[8.5rem] space-y-1.5 self-end rounded-xl bg-black/85 p-2 ring-1 ring-white/10">
          <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>{bbLabel(legal.minRaiseTo, bb)}</span>
            <span>{bbLabel(legal.maxRaiseTo, bb)}</span>
          </div>
          <Slider
            value={[sliderVal]}
            min={sliderMin}
            max={sliderMax}
            step={sliderStep}
            disabled={disabled}
            onValueChange={(v) => setRaiseTo(clampRaiseTo(legal, String(v[0] ?? sliderMin)))}
            aria-label="Raise to"
          />
          <Button
            disabled={disabled}
            onClick={() => act(canRaise ? 'raise' : 'bet', raiseTo)}
            className="op-press h-9 w-full rounded-md bg-amber-400 text-amber-950 hover:bg-amber-300"
          >
            <BtnLabel action={canRaise ? 'Tố lên' : 'Cược'} chips={raiseTo} bb={bb} />
          </Button>
        </div>
      )}

      {/* (c) bottom action row — pinned to the very bottom: Bỏ bài + Theo bài/Check, then the
          ⊞ custom + ^ collapse toggles. Raises come from the column above (All-in = its own tile). */}
      <div className="pointer-events-auto flex items-stretch gap-2">
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

        {showSizing && (
          <>
            <Button
              disabled={disabled}
              onClick={() => setShowCustom((v) => !v)}
              aria-label="Tự nhập mức cược"
              title="Tự nhập mức cược"
              className={cn('op-press h-11 w-11 shrink-0 rounded-md bg-zinc-800/80 p-0 text-white/80 hover:bg-zinc-700', showCustom && 'ring-1 ring-amber-400/60')}
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              disabled={disabled}
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? 'Hiện mức cược' : 'Ẩn mức cược'}
              title={collapsed ? 'Hiện mức cược' : 'Ẩn mức cược'}
              className="op-press h-11 w-11 shrink-0 rounded-md bg-zinc-800/80 p-0 text-white/80 hover:bg-zinc-700"
            >
              {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
