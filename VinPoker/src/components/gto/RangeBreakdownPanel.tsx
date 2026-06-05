import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { combosOf, TOTAL_COMBOS } from "@/lib/gto/handMath";
import { HandAction, Range } from "@/lib/gto/rangeTree";
import { Slider } from "@/components/ui/slider";
import { useRangeTree } from "@/hooks/useRangeTree";

interface Props {
  range: Range;
}

const ROWS: { key: keyof HandAction; label: string; bg: string }[] = [
  { key: "allin", label: "Allin", bg: "bg-gto-allin" },
  { key: "raise", label: "Raise", bg: "bg-gto-raise" },
  { key: "call",  label: "Call",  bg: "bg-gto-call"  },
  { key: "fold",  label: "Fold",  bg: "bg-gto-fold"  },
];

function RangeBreakdownPanel({ range }: Props) {
  const { state, updateHand } = useRangeTree();
  const selectedHand = state.selectedHand;

  const stats = useMemo(() => {
    const acc: Record<keyof HandAction, number> = { fold: 0, call: 0, raise: 0, allin: 0 };
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

  return (
    <div className="space-y-3">
      {/* Action breakdown blocks */}
      <div className="space-y-1.5">
        {ROWS.map(({ key, label, bg }) => {
          const combos = stats[key];
          const pct = (combos / TOTAL_COMBOS) * 100;
          return (
            <div
              key={key}
              className={cn(
                "rounded-md px-3 py-2 text-white flex items-center justify-between",
                bg,
              )}
            >
              <span className="text-sm font-bold tracking-wide">{label}</span>
              <span className="text-xs font-mono opacity-90">
                {combos.toFixed(2)} <span className="opacity-70">·</span>{" "}
                <span className="font-bold">{pct.toFixed(1)}%</span>
              </span>
            </div>
          );
        })}

        {/* Combined progress bar */}
        <div className="h-2 w-full rounded-full overflow-hidden flex">
          {ROWS.map(({ key, bg }) => {
            const pct = (stats[key] / TOTAL_COMBOS) * 100;
            if (pct < 0.1) return null;
            return <div key={key} className={cn("h-full", bg)} style={{ width: `${pct}%` }} />;
          })}
        </div>
      </div>

      {/* Hand detail editor */}
      {selectedHand && (
        <div className="rounded-md border border-border/60 bg-card/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold">
              <span className="text-primary">{state.viewingPosition}</span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              {selectedHand}
            </div>
          </div>

          <div className="space-y-2">
            {ROWS.map(({ key, label, bg }) => {
              const ha: HandAction = range[selectedHand] ?? { fold: 1, call: 0, raise: 0, allin: 0 };
              const pct = Math.round(ha[key] * 100);
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("w-2.5 h-2.5 rounded-sm inline-block", bg)} />
                      {label}
                    </span>
                    <span className="font-mono">{pct}%</span>
                  </div>
                  <Slider
                    value={[pct]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) => updateHand(selectedHand, key, (v[0] ?? 0) / 100)}
                  />
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Adjusting one slider redistributes the rest proportionally.
          </p>
        </div>
      )}
    </div>
  );
}
