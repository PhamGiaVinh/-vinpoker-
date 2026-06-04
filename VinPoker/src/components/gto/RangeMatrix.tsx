import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { allHands, HandAction, Range } from "@/lib/gto/rangeTree";
import { useRangeTree } from "@/hooks/useRangeTree";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  range: Range;
  editable?: boolean;
}

const COLOR: Record<keyof HandAction, string> = {
  allin: "hsl(var(--gto-allin))",
  raise: "hsl(var(--gto-raise))",
  call:  "hsl(var(--gto-call))",
  fold:  "hsl(var(--gto-fold))",
};

/** Build a vertical-strip background like GTO Wizard:
 *  left → right: allin | raise | call | fold (each strip width = freq) */
function stripBackground(h: HandAction): string {
  const order: (keyof HandAction)[] = ["allin", "raise", "call", "fold"];
  const segs = order.filter((k) => h[k] >= 0.005);
  if (segs.length === 0) return COLOR.fold;
  if (segs.length === 1) return COLOR[segs[0]];
  let acc = 0;
  const stops: string[] = [];
  for (const k of segs) {
    const start = acc * 100;
    acc += h[k];
    const end = acc * 100;
    stops.push(`${COLOR[k]} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function RangeMatrix({ range, editable }: Props) {
  const { state, setSelectedHand, updateHand } = useRangeTree();
  const { isAdmin } = useAuth();
  const selectedHand = state.selectedHand;
  const hands = useMemo(() => allHands(), []);
  const canEdit = editable ?? isAdmin;

  return (
    <div
      className="grid gap-[2px] select-none w-full"
      style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
    >
      {hands.map((hand) => {
        const ha = range[hand] ?? { fold: 1, call: 0, raise: 0, allin: 0 };
        const isSel = hand === selectedHand;
        const tip = `${hand}\nAllin ${(ha.allin * 100).toFixed(0)}%  Raise ${(ha.raise * 100).toFixed(0)}%  Call ${(ha.call * 100).toFixed(0)}%  Fold ${(ha.fold * 100).toFixed(0)}%`;
        const handleClick = () => {
          setSelectedHand(hand);
          if (canEdit) {
            const target: keyof HandAction = ha.raise >= 0.999 ? "fold" : "raise";
            updateHand(hand, target, 1);
          } else {
            setSelectedHand(isSel ? null : hand);
          }
        };
        return (
          <button
            key={hand}
            type="button"
            title={tip}
            onClick={handleClick}
            className={cn(
              "relative aspect-square rounded-[3px] overflow-hidden text-[9px] sm:text-[11px] font-semibold text-white transition-[transform,box-shadow] hover:brightness-110",
              isSel && "ring-2 ring-white z-10",
            )}
            style={{ background: stripBackground(ha) }}
          >
            <span className="absolute inset-0 flex items-center justify-center px-0.5 leading-none [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
              {hand}
            </span>
          </button>
        );
      })}
    </div>
  );
}
