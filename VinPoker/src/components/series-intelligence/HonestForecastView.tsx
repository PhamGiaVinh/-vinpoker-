import { BarChart3, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { CapabilityReason } from "@/lib/series-intelligence/modelCapability";
import type { HonestForecastResult } from "@/lib/series-intelligence/honestForecast";
import { BASELINE_LABEL } from "./BaselineBatteryCard";
import { EmptyExplainer } from "./EmptyExplainer";

// A4b — machine-readable capability reasons → plain-Vietnamese owner copy (WHY unavailable · WHAT is needed).
// No fabricated numbers, no "độ bất định tối đa", no causal / guaranteed-accuracy language.
const REASON_COPY: Record<CapabilityReason, { why: string; need: string }> = {
  NO_HISTORY: {
    why: "Chưa đủ dữ liệu lịch sử để dự báo.",
    need: "Nạp thêm các giải đã chạy ở Bước ① (cần ≥2 giải có số khách).",
  },
  INSUFFICIENT_TRAINING_ROWS: {
    why: "Cần thêm dữ liệu trước khi dùng mô hình đầy đủ.",
    need: "Thêm giải đã chạy để đủ mẫu kiểm chứng (walk-forward).",
  },
  FULL_FEATURE_THRESHOLD_NOT_MET: {
    why: "Cần thêm dữ liệu trước khi dùng mô hình đầy đủ.",
    need: "Cần ≥8 giải để mô hình tách được từng yếu tố.",
  },
  OVERLAY_INPUT_INCOMPLETE: {
    why: "Thiếu thông số đầu vào để tính.",
    need: "Nhập đủ số liệu (buy-in, số khách quan sát).",
  },
};
const FALLBACK = { why: "Chưa đủ dữ liệu để dự báo.", need: "Nạp thêm các giải đã chạy ở Bước ①." };
function reasonCopy(reasons: readonly CapabilityReason[]) {
  return (reasons.length > 0 && REASON_COPY[reasons[0]]) || FALLBACK;
}

/**
 * A4b — renders the honest insufficient-data states (unavailable · baseline_only). full_model is rendered by
 * the panel's existing forecast card, so this returns null for it. Never a fabricated 0, never "max uncertainty".
 */
export function HonestForecastView({ result }: { result: HonestForecastResult }) {
  const copy = reasonCopy(result.reasons);

  if (result.status === "unavailable") {
    return (
      <EmptyExplainer
        tone="warning"
        className="h-full min-h-[220px]"
        what="Dự báo lượng khách cho giải sắp tới"
        why={copy.why}
        how={copy.need}
      />
    );
  }

  if (result.status === "baseline_only") {
    const b = result.baseline;
    return (
      <Card className="flex h-full min-h-[220px] flex-col justify-center gap-2 border-border/60 bg-card/40 p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Mốc tham khảo
          </span>
          <span className="text-muted-foreground">Hiện chỉ hiển thị mốc tham khảo đơn giản.</span>
        </div>

        <div className="rounded-md border border-border/60 bg-card/40 p-2">
          <div className="text-[10px] text-muted-foreground">{BASELINE_LABEL[b.baselineId]}</div>
          <div className="flex items-baseline gap-1.5">
            {/* modest size — deliberately NOT the primary forecast's big number */}
            <span className="font-display text-2xl tabular-nums text-foreground">{Math.round(b.forecast)}</span>
            <span className="text-[11px] text-muted-foreground">khách</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {b.foldCount > 0 ? `${b.foldCount} lần kiểm chứng walk-forward` : "chưa kiểm chứng (chưa đủ giải)"}
          </div>
        </div>

        <p className="flex items-start gap-1.5 text-[10px] leading-snug text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>Mốc này chưa phải dự báo từ mô hình. {copy.need}</span>
        </p>
      </Card>
    );
  }

  return null; // full_model — the panel renders the existing forecast card
}
