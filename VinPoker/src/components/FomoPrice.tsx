import { Badge } from "@/components/ui/badge";
import { formatVND, formatBuyInShort } from "@/lib/format";
import { getTournamentPrice } from "@/lib/tournament";
import { cn } from "@/lib/utils";

interface FomoPriceProps {
  tournament: {
    buy_in: number;
    rake_amount?: number | null;
    free_rake_enabled?: boolean | null;
    free_rake_slots?: number | null;
    free_rake_used?: number | null;
  };
  compact?: boolean;
  formatter?: (n: number) => string;
}

export const FomoPrice = ({ tournament, compact, formatter }: FomoPriceProps) => {
  const p = getTournamentPrice(tournament);
  const fmt = formatter ?? (compact ? formatBuyInShort : formatVND);

  if (!p.promotionEnabled) {
    return <span>{fmt(p.displayPrice)}</span>;
  }

  if (p.hasDiscount) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="line-through text-muted-foreground/60 text-xs sm:text-sm">{fmt(p.originalPrice)}</span>
        <span className={cn("font-bold", compact ? "text-success text-xs sm:text-sm" : "text-success text-base sm:text-lg")}>
          {fmt(p.displayPrice)}
        </span>
        <Badge className="bg-warning/10 text-warning border-warning/20 rounded-full text-[10px] font-semibold px-2 py-0">
          🎉 Còn {p.remainingSlots} suất miễn phí DV CLB
        </Badge>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{fmt(p.displayPrice)}</span>
      <Badge className="bg-muted/10 text-muted-foreground/60 border-muted/30 rounded-full text-[10px] font-semibold px-2 py-0">
        Suất miễn phí DV CLB đã hết
      </Badge>
    </span>
  );
};
