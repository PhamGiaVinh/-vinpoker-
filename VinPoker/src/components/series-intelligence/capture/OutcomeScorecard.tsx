import { CheckCircle2, AlertTriangle, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatVND } from "@/lib/format";
import { scoreOutcome } from "@/lib/series-intelligence/captureScoring";
import { HORIZON_LABEL } from "@/lib/series-intelligence/captureTypes";
import type { DecisionLog, ForecastSnapshot } from "@/lib/series-intelligence/captureTypes";
import { InsightLabelBadge } from "@/components/series-intelligence/InsightLabelBadge";

type Verdict = "good" | "warn" | "neutral";

function Row({ label, verdict, value, note }: { label: string; verdict: Verdict; value: string; note?: string }) {
  const Icon = verdict === "good" ? CheckCircle2 : verdict === "warn" ? AlertTriangle : Minus;
  const color =
    verdict === "good" ? "text-primary" : verdict === "warn" ? "text-warning" : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", color)}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {value}
        {note && <span className="text-[10px] font-normal text-muted-foreground">({note})</span>}
      </span>
    </div>
  );
}

/**
 * Forecast-vs-actual scorecard — MEASURED facts (Observed Pattern), never implied model accuracy. The scoring
 * basis snapshot is stated explicitly so the score is never ambiguous. Reads post-event actuals for scoring
 * only (they are never fed back as a forecast input).
 */
export function OutcomeScorecard({
  snapshot,
  scored,
}: {
  snapshot: ForecastSnapshot | null;
  scored: DecisionLog | null;
}) {
  const s = scoreOutcome(snapshot, scored);

  if (!s.hasActuals) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
        Chưa có kết quả sau giải. Mở quyết định mốc <strong>Sau giải</strong> và nhập <em>số thực tế</em> để chấm
        điểm dự báo.
      </div>
    );
  }

  const basis = snapshot
    ? `${HORIZON_LABEL[snapshot.horizon] ?? snapshot.horizon}` +
      (snapshot.forecast_base != null ? ` · dự báo ${snapshot.forecast_base}` : "")
    : "không có snapshot để chấm";

  return (
    <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/5 to-card p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Chấm kết quả</span>
        <InsightLabelBadge label="Observed Pattern" />
      </div>
      <p className="mb-2 text-[10px] text-muted-foreground">Đang chấm theo snapshot: {basis}</p>

      <div className="divide-y divide-border/40">
        {s.inBand != null && (
          <Row
            label="Số lượt (entries)"
            verdict={s.inBand ? "good" : "warn"}
            value={`${s.actualEntries} ${s.inBand ? "· trong khoảng" : "· ngoài khoảng"}`}
            note={
              s.bandLow != null && s.bandHigh != null
                ? `dự báo ${s.bandLow}–${s.bandHigh}${s.entriesDelta != null ? `, lệch ${s.entriesDelta > 0 ? "+" : ""}${s.entriesDelta}` : ""}`
                : undefined
            }
          />
        )}
        {s.gtdCovered != null && (
          <Row
            label="Phủ GTD"
            verdict={s.gtdCovered ? "good" : "warn"}
            value={s.gtdCovered ? "Đã phủ" : "Chưa phủ"}
            note={
              s.candidateGtd != null && s.actualPrizePool != null
                ? `${formatVND(s.actualPrizePool)} / GTD ${formatVND(s.candidateGtd)}`
                : undefined
            }
          />
        )}
        {s.hadOverlay != null && (
          <Row
            label="Overlay"
            verdict={s.hadOverlay ? "warn" : "good"}
            value={s.hadOverlay ? "Có overlay" : "Không overlay"}
            note={s.overlayAmount != null && s.overlayAmount > 0 ? formatVND(s.overlayAmount) : undefined}
          />
        )}
      </div>
    </div>
  );
}
