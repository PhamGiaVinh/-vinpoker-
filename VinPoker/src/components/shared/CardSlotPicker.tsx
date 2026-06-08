import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export type Card = string;

export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
export const SUITS = ["s", "h", "d", "c"] as const;
export const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
export const SUIT_COLOR: Record<string, string> = {
  s: "text-foreground",
  c: "text-foreground",
  h: "text-rose-500",
  d: "text-rose-500",
};

export function isRedCard(card: string): boolean {
  if (!card) return false;
  const last = card.slice(-1);
  return last === "h" || last === "d" || last === "♥" || last === "♦";
}

export function displayCard(card: string): string {
  if (!card || card.length < 2) return "";
  const rank = card.slice(0, -1);
  const suit = SUIT_SYMBOL[card.slice(-1)] || card.slice(-1);
  return rank + suit;
}

export function CardSlotPicker({
  value,
  used,
  onChange,
}: {
  value: Card | null;
  used: Set<Card>;
  onChange: (c: Card | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [rank, setRank] = useState<string>(value ? value[0] : "");

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
          "h-14 w-11 sm:h-16 sm:w-12 rounded-lg border-2 border-dashed border-border bg-muted/40 hover:bg-muted/70 hover:border-primary/50 transition flex items-center justify-center font-bold",
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
        className="h-14 w-11 sm:h-16 sm:w-12 rounded-lg border-2 border-primary bg-card flex items-center justify-center"
      >
        <X className="w-4 h-4 text-muted-foreground" />
      </button>
      <div className="absolute z-50 top-full left-0 mt-1 p-2 rounded-lg border border-border bg-popover shadow-xl min-w-[200px]">
        {!rank ? (
          <div className="grid grid-cols-7 gap-1">
            {RANKS.map((r) => (
              <button
                key={r}
                onClick={() => setRank(r)}
                className="h-8 w-8 rounded text-xs font-bold bg-muted hover:bg-primary/20"
              >
                {r}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[11px] text-muted-foreground" dangerouslySetInnerHTML={{ __html: t("equityCalc.pickRank", { rank: `<b>${rank}</b>` }) }} />
            <div className="grid grid-cols-4 gap-1">
              {SUITS.map((s) => {
                const c = `${rank}${s}`;
                const taken = used.has(c) && c !== value;
                return (
                  <button
                    key={s}
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
            <Button size="sm" variant="ghost" className="w-full h-7 text-xs" onClick={() => setRank("")}>{t("equityCalc.changeRank")}</Button>
            {value && (
              <Button size="sm" variant="ghost" className="w-full h-7 text-xs text-rose-500" onClick={() => { onChange(null); setOpen(false); setRank(""); }}>
                {t("equityCalc.removeCard")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}