import { ShieldAlert, Info, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { InsightLabelBadge } from "./InsightLabelBadge";
import type { RiskFlag, RiskSeverity } from "@/lib/series-intelligence/commandCenter";

const SEVERITY: Record<RiskSeverity, { cls: string; Icon: typeof Info }> = {
  info: { cls: "border-border", Icon: Info },
  warning: { cls: "border-warning/40", Icon: AlertTriangle },
  risk: { cls: "border-destructive/40", Icon: ShieldAlert },
};

export function RiskInsightCards({ risks }: { risks: RiskFlag[] }) {
  return (
    <section className="space-y-2">
      <h3 className="font-display text-base flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-primary" /> Rủi ro &amp; insight
      </h3>
      {risks.length === 0 ? (
        <Card className="p-4 border-primary/30 text-xs text-muted-foreground">
          Chưa đủ dữ liệu để nêu rủi ro nổi bật. Bổ sung thêm giải/entry để có insight rõ hơn.
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {risks.map((r) => {
            const s = SEVERITY[r.severity];
            return (
              <Card key={r.id} className={cn("p-3 gradient-card space-y-1.5", s.cls)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <s.Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    {r.title}
                  </div>
                  <InsightLabelBadge label={r.label} />
                </div>
                <p className="text-xs text-muted-foreground">{r.message}</p>
                <p className="text-[10px] text-muted-foreground/70">
                  {r.provenance} · {r.basis}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
