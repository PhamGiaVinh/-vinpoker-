import { ListChecks, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { InsightLabelBadge } from "./InsightLabelBadge";
import type { OwnerAction } from "@/lib/series-intelligence/commandCenter";

/** Rules-derived "what to do next" list. Concrete actions — never a guarantee of results. */
export function OwnerActionChecklist({ actions }: { actions: OwnerAction[] }) {
  return (
    <Card className="p-4 gradient-card border-primary/40 space-y-3">
      <h3 className="font-display text-base flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-primary" /> Việc nên làm
      </h3>
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.id} className="flex items-start gap-2">
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="font-medium">{a.text}</span>
                <InsightLabelBadge label={a.label} />
              </div>
              <p className="text-[11px] text-muted-foreground">{a.rationale}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground/70">
        Gợi ý dựa trên quy tắc &amp; dữ liệu quan sát — không đảm bảo kết quả.
      </p>
    </Card>
  );
}
