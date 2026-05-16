import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { combosOf, TOTAL_COMBOS } from "@/lib/gto/handMath";
import { HandAction, Range } from "@/lib/gto/rangeTree";

interface Props {
  range: Range | null;
}

const ROWS: { key: keyof HandAction; label: string; cls: string }[] = [
  { key: "allin", label: "Allin", cls: "bg-gto-allin" },
  { key: "raise", label: "Raise", cls: "bg-gto-raise" },
  { key: "call",  label: "Call",  cls: "bg-gto-call" },
  { key: "fold",  label: "Fold",  cls: "bg-gto-fold" },
];

export default function RangeStatsBar({ range }: Props) {
  const stats = useMemo(() => {
    const acc: Record<keyof HandAction, number> = { fold: 0, call: 0, raise: 0, allin: 0 };
    if (!range) return acc;
    for (const hand of Object.keys(range)) {
      const ha = range[hand];
      const w = combosOf(hand);
      acc.fold  += ha.fold  * w;
      acc.call  += ha.call  * w;
      acc.raise += ha.raise * w;
      acc.allin += ha.allin * w;
    }
    return acc;
  }, [range]);

  const vpip = ((stats.call + stats.raise + stats.allin) / TOTAL_COMBOS) * 100;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2 text-[11px]">
        {ROWS.map(({ key, label, cls }) => {
          const pct = (stats[key] / TOTAL_COMBOS) * 100;
          return (
            <div key={key} className={cn("rounded px-2 py-1 text-white", cls)}>
              <span className="font-bold">{label}</span>{" "}
              <span className="font-black">{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-muted-foreground">
        VPIP <span className="font-bold text-foreground">{vpip.toFixed(1)}%</span>
      </div>
    </div>
  );
}
