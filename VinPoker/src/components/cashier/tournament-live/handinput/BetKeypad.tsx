// Large numeric keypad — the only bet-sizing input on tablet (owner decision).
// Builds a "bet to" amount string; the dock feeds it to bet/raise/post actions.

import { Delete } from "lucide-react";
import { formatStack } from "./format";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "000", "back"];

interface BetKeypadProps {
  value: string;
  onChange: (v: string) => void;
  bigBlind?: number;
  disabled?: boolean;
}

export function BetKeypad({ value, onChange, bigBlind = 0, disabled }: BetKeypadProps) {
  const press = (k: string) => {
    if (disabled) return;
    if (k === "back") {
      onChange(value.slice(0, -1));
      return;
    }
    const raw = (value || "") + k;
    const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    if (digits.length > 9) return;
    onChange(digits);
  };

  const num = parseInt(value || "0", 10) || 0;
  const bb = bigBlind > 0 ? num / bigBlind : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-3 py-2 rounded-lg bg-secondary border border-primary/30">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Bet to</span>
        <span>
          <span className="text-2xl font-bold font-mono text-primary">{num ? formatStack(num) : "—"}</span>
          {bb !== null && num > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground font-mono">
              {bb.toFixed(1).replace(/\.0$/, "")} BB
            </span>
          )}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => press(k)}
            aria-label={k === "back" ? "Xoá" : k}
            className="py-3 rounded-lg bg-secondary border border-border text-lg font-mono font-medium text-foreground hover:border-primary/50 active:scale-95 transition disabled:opacity-40 disabled:active:scale-100"
          >
            {k === "back" ? <Delete className="w-5 h-5 mx-auto" aria-hidden="true" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}
