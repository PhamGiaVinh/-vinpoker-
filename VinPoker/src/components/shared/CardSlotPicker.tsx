import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setRank("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={value ? `Đổi lá ${displayCard(value)}` : "Chọn lá bài"}
          className={cn(
            "flex h-14 w-11 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/40 font-bold transition hover:border-primary/50 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:h-16 sm:w-12",
            value && "border-solid border-border bg-card",
            open && "border-primary bg-card",
          )}
        >
          {open ? (
            <X className="h-4 w-4 text-muted-foreground" />
          ) : value ? (
            <span className={cn("flex flex-col items-center text-base leading-tight sm:text-lg", SUIT_COLOR[value[1]])}>
              <span>{value[0]}</span>
              <span className="text-sm">{SUIT_SYMBOL[value[1]]}</span>
            </span>
          ) : (
            <Plus className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(17rem,calc(100vw-1.5rem))] p-2"
      >
        {!rank ? (
          <div className="grid grid-cols-7 gap-1" aria-label="Chọn hạng bài">
            {RANKS.map((r) => (
              <button
                key={r}
                type="button"
                aria-label={`Chọn hạng ${r}`}
                onClick={() => setRank(r)}
                className="min-h-11 min-w-0 rounded bg-muted text-sm font-bold hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                    type="button"
                    aria-label={`Chọn ${rank}${SUIT_SYMBOL[s]}`}
                    disabled={taken}
                    onClick={() => pick(rank, s)}
                    className={cn(
                      "min-h-11 rounded bg-muted text-base font-bold hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-30",
                      SUIT_COLOR[s]
                    )}
                  >
                    {SUIT_SYMBOL[s]}
                  </button>
                );
              })}
            </div>
            <Button size="sm" variant="ghost" className="min-h-11 w-full text-xs" onClick={() => setRank("")}>{t("equityCalc.changeRank")}</Button>
            {value && (
              <Button size="sm" variant="ghost" className="min-h-11 w-full text-xs text-rose-500" onClick={() => { onChange(null); setOpen(false); setRank(""); }}>
                {t("equityCalc.removeCard")}
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
