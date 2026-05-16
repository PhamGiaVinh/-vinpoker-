import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { HandAction, Range } from "@/lib/gto/rangeTree";
import { useRangeTree } from "@/hooks/useRangeTree";

interface Props {
  range: Range | null;
}

const ACTIONS: { key: keyof HandAction; label: string; cls: string }[] = [
  { key: "allin", label: "Allin", cls: "bg-gto-allin" },
  { key: "raise", label: "Raise", cls: "bg-gto-raise" },
  { key: "call",  label: "Call",  cls: "bg-gto-call" },
  { key: "fold",  label: "Fold",  cls: "bg-gto-fold" },
];

export default function HandEditor({ range }: Props) {
  const { state, updateHand, resetNode, setSelectedHand } = useRangeTree();
  const selectedHand = state.selectedHand;

  if (!selectedHand) return null;
  const ha: HandAction = range?.[selectedHand] ?? { fold: 1, call: 0, raise: 0, allin: 0 };

  return (
    <Card className="p-4 space-y-3 bg-card/60 border-border/60">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold">{state.viewingPosition} · {selectedHand}</div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={resetNode}>Reset GTO</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedHand(null)}>×</Button>
        </div>
      </div>
      <div className="space-y-2">
        {ACTIONS.map(({ key, label, cls }) => {
          const pct = Math.round(ha[key] * 100);
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className={cn("w-3 h-3 rounded-sm inline-block", cls)} />
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
        Adjusting one slider redistributes the rest proportionally so the total stays 100%.
      </p>
    </Card>
  );
}
