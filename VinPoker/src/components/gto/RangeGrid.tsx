import { useMemo } from "react";
import { RANKS, handAt, classify } from "@/lib/gto/handMath";
import { cn } from "@/lib/utils";

interface Props {
  selected: Set<string>;
  onToggle: (hand: string) => void;
}

export default function RangeGrid({ selected, onToggle }: Props) {
  const cells = useMemo(() => {
    const rows: { hand: string; r: number; c: number }[][] = [];
    for (let r = 0; r < 13; r++) {
      const row: { hand: string; r: number; c: number }[] = [];
      for (let c = 0; c < 13; c++) row.push({ hand: handAt(r, c), r, c });
      rows.push(row);
    }
    return rows;
  }, []);

  return (
    <div className="grid grid-cols-13 gap-[2px] select-none w-full" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
      {cells.flat().map(({ hand }) => {
        const k = classify(hand);
        const isSel = selected.has(hand);
        return (
          <button
            key={hand}
            type="button"
            onClick={() => onToggle(hand)}
            className={cn(
              "aspect-square border border-border rounded-sm text-[10px] sm:text-xs font-semibold flex items-center justify-center transition-colors",
              "hover:ring-1 hover:ring-primary",
              k === "pair" && (isSel ? "bg-emerald-500 text-white" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"),
              k === "suited" && (isSel ? "bg-rose-500 text-white" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"),
              k === "offsuit" && (isSel ? "bg-sky-500 text-white" : "bg-sky-500/10 text-sky-700 dark:text-sky-300"),
            )}
            aria-pressed={isSel}
          >
            {hand}
          </button>
        );
      })}
    </div>
  );
}
