import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * StepSection — presentational wrapper for ONE step of the Series Intelligence owner flow.
 * A numbered neon badge + plain-language title + (optional) jargon subtitle, then the step's content.
 * Pure layout: no state, no behavior. PokerVN / Stitch Dark (neon-green on dark).
 */
export interface StepSectionProps {
  id: string;
  n: number;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  /** small muted note under the header (e.g. an honest hint) */
  note?: ReactNode;
  children: ReactNode;
}

export function StepSection({ id, n, title, subtitle, icon, note, children }: StepSectionProps) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid place-items-center h-8 w-8 shrink-0 rounded-full text-sm font-semibold",
            "bg-primary/15 text-primary ring-1 ring-primary/40",
          )}
          aria-hidden
        >
          {n}
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg leading-tight flex items-center gap-2">
            {icon}
            {title}
          </h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {note && <div className="text-xs text-muted-foreground sm:pl-11">{note}</div>}
      <div className="space-y-4 sm:pl-11">{children}</div>
    </section>
  );
}
