import { ClipboardCheck, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { InsightLabelBadge } from "./InsightLabelBadge";
import type { ReadinessResult } from "@/lib/series-intelligence/commandCenter";

/** Coverage score over owner-fillable fields + a plain-VN "what's missing" list. */
export function DataQualityCard({ readiness }: { readiness: ReadinessResult }) {
  const r = readiness;
  return (
    <Card className="p-4 gradient-card border-primary/40 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-primary" /> Chất lượng dữ liệu
        </h3>
        <InsightLabelBadge label={r.label} />
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">Mức độ sẵn sàng</span>
          <span className="font-display text-lg tabular-nums">{r.score}%</span>
        </div>
        <Progress value={r.score} className="h-2" />
        <p className="text-[11px] text-muted-foreground">
          Tính trên các trường owner có thể điền (GTD chưa có cột nên không tính vào điểm).
        </p>
      </div>

      {r.missingSummary.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {r.missingSummary.map((m, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
              <span>{m}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Đủ các trường cơ bản cho phân tích mô tả.</p>
      )}
    </Card>
  );
}
