import { useState, type ReactNode } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Tiny progressive-disclosure "giải thích" toggle for technical terms (P5/P95, ρ, Risk-of-Ruin, epistemic…).
 * The default surface stays plain Vietnamese; the technical explanation lives behind one small click.
 * `tone="felt"` maps colors to the MonteCarloPanel's scoped green-felt CSS vars so it can live inside
 * that theme without breaking it.
 */
export function ExplainHint({
  term,
  children,
  tone = "default",
  className,
}: {
  /** Short label of what is being explained, shown in the trigger (e.g. "P5 · P50 · P95"). */
  term?: string;
  children: ReactNode;
  tone?: "default" | "felt";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const felt = tone === "felt";
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-sans underline-offset-2 hover:underline",
          felt ? "text-[var(--mut)]" : "text-muted-foreground",
        )}
        aria-label={term ? `Giải thích ${term}` : "Giải thích"}
      >
        <HelpCircle className="h-3 w-3 shrink-0" aria-hidden />
        giải thích{term ? ` ${term}` : ""}
        <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn(
          "mt-1 rounded-md border p-2 text-[10px] font-sans leading-relaxed",
          felt ? "border-[var(--line)] bg-[var(--card)] text-[var(--mut)]" : "border-border/60 bg-muted/20 text-muted-foreground",
        )}
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
