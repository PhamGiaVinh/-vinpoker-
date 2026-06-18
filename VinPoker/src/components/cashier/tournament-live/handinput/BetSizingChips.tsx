// Quick bet-sizing chips for the standalone operator console (+BB · 2.5BB · 3BB ·
// Pot · All-in), per the operator mockup. The numeric BetKeypad has no shortcuts;
// these fill that gap. Every chip writes an ABSOLUTE "bet to" street-total into the
// same `betAmount` string the keypad edits, so the value still flows through the
// engine's `betToAdded()` on submit — nothing here touches the write-path.
//
// Presentational + pure math only (math lives in betSizing.ts). No Supabase, no
// payloads. 2.5BB/3BB hide when the big blind is unknown.

import { formatStack } from "./format";
import { computeSizingChips, incrementByBB, type SizingContext } from "./betSizing";

interface BetSizingChipsProps {
  ctx: SizingContext;
  /** Current keypad value (the parent's betAmount). */
  value: string;
  /** Set betAmount to the chosen absolute "bet to" total (as a string). */
  onChange: (v: string) => void;
  disabled?: boolean;
}

function Chip({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex-1 min-w-0 min-h-[40px] rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 text-[13px] font-medium text-emerald-200 transition active:scale-95 hover:border-emerald-400/70 disabled:opacity-35 disabled:active:scale-100"
    >
      {label}
    </button>
  );
}

export function BetSizingChips({ ctx, value, onChange, disabled }: BetSizingChipsProps) {
  const chips = computeSizingChips(ctx);
  const current = value ? parseInt(value, 10) || 0 : null;
  const set = (n: number) => onChange(String(n));

  return (
    <div className="flex items-stretch gap-1.5">
      <Chip label="+BB" disabled={disabled || ctx.bigBlind <= 0} onClick={() => set(incrementByBB(current, ctx))} />
      {chips.bb2_5 != null && <Chip label="2.5BB" disabled={disabled} onClick={() => set(chips.bb2_5!)} />}
      {chips.bb3 != null && <Chip label="3BB" disabled={disabled} onClick={() => set(chips.bb3!)} />}
      <Chip label="Pot" disabled={disabled} onClick={() => set(chips.pot)} />
      <Chip label={`All-in ${formatStack(chips.allIn)}`} disabled={disabled} onClick={() => set(chips.allIn)} />
    </div>
  );
}
