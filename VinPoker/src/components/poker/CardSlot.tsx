import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";

export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
export const SUITS = ["s", "h", "d", "c"] as const;
export const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
export const SUIT_COLOR: Record<string, string> = {
  s: "text-foreground",
  c: "text-foreground",
  h: "text-rose-500",
  d: "text-rose-500",
};

export type CardCode = string; // e.g. "As", "Kh"

export const ALL_CARDS: CardCode[] = (() => {
  const out: CardCode[] = [];
  for (const r of RANKS) for (const s of SUITS) out.push(`${r}${s}`);
  return out;
})();

/** Convert "As" → { rank: "A", suit: "♠" } */
export function cardToSymbol(c: CardCode): { rank: string; suit: string } {
  return { rank: c[0], suit: SUIT_SYMBOL[c[1]] ?? c[1] };
}

export function CardSlot({
  value,
  used,
  onChange,
  size = "md",
}: {
  value: CardCode | null;
  used: Set<CardCode>;
  onChange: (c: CardCode | null) => void;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [rank, setRank] = useState<string>(value ? value[0] : "");

  const dims = size === "sm"
    ? "h-12 w-9 sm:h-14 sm:w-10"
    : "h-14 w-11 sm:h-16 sm:w-12";

  const pick = (r: string, s: string) => {
    const c = `${r}${s}`;
    if (used.has(c) && c !== value) return;
    onChange(c);
    setOpen(false);
    setRank("");
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          dims,
          "rounded-lg border-2 border-dashed border-border bg-muted/40 hover:bg-muted/70 hover:border-primary/50 transition flex items-center justify-center font-bold",
          value && "border-solid border-border bg-card"
        )}
      >
        {value ? (
          <span className={cn("text-base sm:text-lg flex flex-col items-center leading-tight", SUIT_COLOR[value[1]])}>
            <span>{value[0]}</span>
            <span className="text-sm">{SUIT_SYMBOL[value[1]]}</span>
          </span>
        ) : (
          <Plus className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen(false); setRank(""); }}
        className={cn(dims, "rounded-lg border-2 border-primary bg-card flex items-center justify-center")}
      >
        <X className="w-4 h-4 text-muted-foreground" />
      </button>
      <div className="absolute z-50 top-full left-0 mt-1 p-2 rounded-lg border border-border bg-popover shadow-xl min-w-[200px]">
        {!rank ? (
          <div className="grid grid-cols-7 gap-1">
            {RANKS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRank(r)}
                className="h-8 w-8 rounded text-xs font-bold bg-muted hover:bg-primary/20"
              >
                {r}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[11px] text-muted-foreground">
              Chọn chất cho <b>{rank}</b>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {SUITS.map((s) => {
                const c = `${rank}${s}`;
                const taken = used.has(c) && c !== value;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={taken}
                    onClick={() => pick(rank, s)}
                    className={cn(
                      "h-10 rounded font-bold text-base bg-muted hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed",
                      SUIT_COLOR[s]
                    )}
                  >
                    {SUIT_SYMBOL[s]}
                  </button>
                );
              })}
            </div>
            <Button type="button" size="sm" variant="ghost" className="w-full h-7 text-xs" onClick={() => setRank("")}>Đổi rank</Button>
            {value && (
              <Button type="button" size="sm" variant="ghost" className="w-full h-7 text-xs text-rose-500" onClick={() => { onChange(null); setOpen(false); setRank(""); }}>
                Xoá lá
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
