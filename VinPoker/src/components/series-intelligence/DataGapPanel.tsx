import { AlertCircle, DatabaseZap } from "lucide-react";
import type { DataGapV1 } from "@/lib/series-intelligence/seriesCopilotContextV1";

export function DataGapPanel({ gaps }: { gaps: readonly DataGapV1[] }) {
  return (
    <section aria-labelledby="data-gap-title" className="space-y-2">
      <div>
        <h3 id="data-gap-title" className="text-sm font-semibold text-foreground">Dữ liệu còn thiếu</h3>
        <p className="text-xs text-muted-foreground">V nêu phần thiếu thay vì điền số giả.</p>
      </div>
      {gaps.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
          <DatabaseZap className="h-4 w-4 text-primary" aria-hidden /> Không có khoảng trống đã biết trong context này.
        </div>
      ) : (
        <div className="divide-y divide-border/60 rounded-md border border-border/70">
          {gaps.map((gap) => (
            <div key={gap.dataGapId} className="flex items-start gap-2.5 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">{gap.titleVi}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{gap.detailVi}</p>
                <p className="mt-1 text-[10px] text-muted-foreground/80">Cần: {gap.requiredSourceVi}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
