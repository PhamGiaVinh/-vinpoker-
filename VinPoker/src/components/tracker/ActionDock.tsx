// PR-A — Tracker Racetrack Hand-Input UI: fixed bottom action dock.
// Emits ActionIntent upward per the AMOUNT CONTRACT in types.ts. Owns the
// ForcedAmountPad (open state) and the keyboard shortcuts. No legality logic.
import { useEffect, useState } from 'react';
import { formatChips, toBB, GTO_COLORS } from './constants';
import type { ActionDockProps, TrackerAction } from './types';
import { ForcedAmountPad } from './ForcedAmountPad';

const NUM = 'font-display tabular-nums';

function ActionButton({
  label,
  sub,
  color,
  hotkey,
  filled,
  onClick,
}: {
  label: string;
  sub?: string;
  color: string;
  hotkey: string;
  filled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex min-h-[62px] flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-base font-bold text-[hsl(var(--foreground))] transition-transform active:scale-95"
      style={{ borderColor: color, background: filled ? `${color}24` : 'transparent' }}
    >
      <span className={`absolute right-2 top-1.5 text-[9px] opacity-50 ${NUM}`}>{hotkey}</span>
      {label}
      {sub && <span className={`text-[11px] font-medium opacity-85 ${NUM}`}>{sub}</span>}
    </button>
  );
}

export function ActionDock({ actingSeat, toCall, bigBlind, onIntent, onUndo }: ActionDockProps) {
  const [padOpen, setPadOpen] = useState(false);

  const committed = actingSeat?.committed ?? 0;
  const stack = actingSeat?.stack ?? 0;
  const isCheck = toCall <= 0;

  // Close the pad whenever the acting seat changes (auto-forward to the next seat).
  useEffect(() => {
    setPadOpen(false);
  }, [actingSeat?.seatNumber]);

  const emit = (action: TrackerAction, amount: number) => {
    if (!actingSeat) return;
    onIntent({ seatNumber: actingSeat.seatNumber, action, amount });
  };

  const onFold = () => {
    setPadOpen(false);
    emit('fold', 0);
  };
  const onCallCheck = () => {
    setPadOpen(false);
    if (isCheck) emit('check', 0);
    else emit('call', committed + toCall); // TOTAL after call (contract)
  };
  const onAllIn = () => {
    setPadOpen(false);
    emit('all_in', committed + stack); // TOTAL after shoving everything (contract)
  };
  const onPadConfirm = (total: number) => {
    setPadOpen(false);
    emit(isCheck ? 'bet' : 'raise', total); // pad returns the TOTAL ("raise to")
  };

  // Keyboard shortcuts while the pad is CLOSED (the pad owns keys while open).
  useEffect(() => {
    if (padOpen || !actingSeat) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'f') onFold();
      else if (k === 'c') onCallCheck();
      else if (k === 'r') setPadOpen(true);
      else if (k === 'a') onAllIn();
      else if (e.key === 'Backspace') {
        e.preventDefault();
        onUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padOpen, actingSeat, toCall, committed, stack, isCheck]);

  if (!actingSeat) {
    return (
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Chưa có ghế tới lượt.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
      {/* Actor block */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[hsl(var(--primary))]">
            <span className={`text-xs font-bold text-[hsl(var(--primary))] ${NUM}`}>
              {actingSeat.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-[hsl(var(--foreground))]">
              {actingSeat.name}
            </div>
            <div className={`text-[11px] text-[hsl(var(--muted-foreground))] ${NUM}`}>
              Ghế {actingSeat.seatNumber}
              {actingSeat.position ? ` · ${actingSeat.position}` : ''} · stack {formatChips(stack)} (
              {toBB(stack, bigBlind)} BB)
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
            Cần theo
          </div>
          <div className={`text-xl font-bold text-[hsl(var(--warning))] ${NUM}`}>
            {formatChips(toCall)}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-4 gap-2.5">
        <ActionButton label="BỎ BÀI" hotkey="F" color={GTO_COLORS.fold} onClick={onFold} />
        <ActionButton
          label={isCheck ? 'CHECK' : 'THEO'}
          sub={isCheck ? undefined : formatChips(toCall)}
          hotkey="C"
          color={GTO_COLORS.call}
          onClick={onCallCheck}
        />
        <ActionButton
          label="TỐ"
          sub="nhập tổng →"
          hotkey="R"
          color={GTO_COLORS.raise}
          filled={padOpen}
          onClick={() => setPadOpen(true)}
        />
        <ActionButton
          label="ALL-IN"
          sub={formatChips(committed + stack)}
          hotkey="A"
          color={GTO_COLORS.all_in}
          filled
          onClick={onAllIn}
        />
      </div>

      {/* Forced amount pad (inline) */}
      {padOpen && (
        <ForcedAmountPad
          stack={stack}
          committedThisStreet={committed}
          minTotal={committed + toCall + bigBlind}
          onConfirm={onPadConfirm}
          onCancel={() => setPadOpen(false)}
        />
      )}

      {/* Undo */}
      <div className="mt-2.5 flex items-center justify-between text-[11px] text-[hsl(var(--muted-foreground))]">
        <div>
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">F</kbd> Bỏ{' '}
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">C</kbd> Theo{' '}
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">R</kbd> Tố{' '}
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">A</kbd> All-in{' '}
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">↵</kbd> Xác nhận{' '}
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">⌫</kbd> Undo
        </div>
        <button
          type="button"
          onClick={onUndo}
          className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 font-semibold hover:border-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]"
        >
          ↶ Hoàn tác
        </button>
      </div>
    </div>
  );
}
