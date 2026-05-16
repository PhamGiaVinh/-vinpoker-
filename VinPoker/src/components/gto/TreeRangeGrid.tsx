import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { allHands, HandAction, Range } from "@/lib/gto/rangeTree";
import { useRangeTree } from "@/hooks/useRangeTree";

interface Props {
  range: Range | null;
  loading: boolean;
}

const ACTION_HSL: Record<keyof HandAction, string> = {
  fold: "hsl(var(--gto-fold))",
  call: "hsl(var(--gto-call))",
  raise: "hsl(var(--gto-raise))",
  allin: "hsl(var(--gto-allin))",
};

function gradientFor(h: HandAction): string {
  const order: (keyof HandAction)[] = ["allin", "raise", "call", "fold"];
  const segs = order.filter((k) => h[k] >= 0.005);
  if (segs.length === 0) return ACTION_HSL.fold;
  // Build linear gradient stops
  let acc = 0;
  const parts: string[] = [];
  for (const k of segs) {
    const start = acc * 100;
    acc += h[k];
    const end = acc * 100;
    parts.push(`${ACTION_HSL[k]} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

export default function RangeGrid({ range, loading }: Props) {
  const { state, setSelectedHand } = useRangeTree();
  const selectedHand = state.selectedHand;
  const hands = useMemo(() => allHands(), []);

  if (loading || !range) {
    return <Skeleton className="w-full aspect-square" />;
  }

  return (
    <div
      className="grid gap-[2px] select-none w-full"
      style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
    >
      {hands.map((hand) => {
        const ha = range[hand];
        if (!ha) return <div key={hand} className="aspect-square rounded-sm bg-muted" />;
        const tip = `${hand} · A ${(ha.allin * 100).toFixed(0)}% · R ${(ha.raise * 100).toFixed(0)}% · C ${(ha.call * 100).toFixed(0)}% · F ${(ha.fold * 100).toFixed(0)}%`;
        const isSel = hand === selectedHand;
        return (
          <button
            key={hand}
            type="button"
            title={tip}
            onClick={() => setSelectedHand(isSel ? null : hand)}
            className={cn(
              "relative aspect-square rounded-sm overflow-hidden text-[9px] sm:text-[11px] font-semibold text-white transition-transform",
              isSel && "ring-2 ring-primary scale-105 z-10",
            )}
            style={{ background: gradientFor(ha) }}
          >
            <span className="absolute inset-0 flex items-center justify-center drop-shadow">{hand}</span>
          </button>
        );
      })}
    </div>
  );
}
