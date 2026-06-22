import { cn } from "@/lib/utils";

/**
 * Stepper — a horizontal 5-step legend for the Series Intelligence owner flow. Presentational + a click
 * scrolls to the matching StepSection (by id). `current` = the step to emphasise (the first the owner should
 * look at). Wraps on mobile. PokerVN / Stitch Dark.
 */
export interface StepperItem {
  n: number;
  label: string;
  targetId: string;
}

export function Stepper({ items, current }: { items: StepperItem[]; current?: number }) {
  const go = (id: string): void => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <nav aria-label="Các bước" className="flex flex-wrap items-center gap-1.5">
      {items.map((it, i) => {
        const active = it.n === current;
        return (
          <div key={it.n} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => go(it.targetId)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary",
              )}
            >
              <span
                className={cn(
                  "grid place-items-center h-4 w-4 rounded-full text-[9px] font-semibold",
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {it.n}
              </span>
              {it.label}
            </button>
            {i < items.length - 1 && <span className="text-muted-foreground/40" aria-hidden>›</span>}
          </div>
        );
      })}
    </nav>
  );
}
