import type { ReactNode } from "react";
import { Target, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { collectOutcomeScores } from "@/lib/series-intelligence/captureScoring";
import { computeCalibration, type CalibrationVerdict } from "@/lib/series-intelligence/calibration";
import type { DecisionLog, ForecastSnapshot } from "@/lib/series-intelligence/captureTypes";
import { InsightLabelBadge } from "../InsightLabelBadge";
import { ExplainHint } from "../ExplainHint";

const VERDICT_TONE: Record<CalibrationVerdict, string> = {
  "not-enough": "border-border bg-card/40",
  "band-too-narrow": "border-destructive/40 bg-destructive/5",
  "band-too-wide": "border-warning/40 bg-warning/5",
  "well-calibrated": "border-primary/40 bg-primary/5",
};

/**
 * "Hiệu chỉnh dự báo" (G7) — closes the learning loop: were past forecasts honest? Reads the ⑥ CAPTURE
 * snapshots + decisions (client-side, no new DB), scores each via captureScoring, and reports in-band
 * rate vs the 90% target + systematic bias. UNDER-POWERED until ≥10 scored pairs → shows an honest
 * "chưa đủ dữ liệu" state and makes NO calibration claim. Measured facts only (Observed Pattern).
 */
export function CalibrationCard({
  decisions,
  snapshots,
}: {
  decisions: DecisionLog[];
  snapshots: ForecastSnapshot[];
}) {
  const cal = computeCalibration(collectOutcomeScores(decisions, snapshots));
  const pct = (v: number | null): string => (v === null ? "—" : `${Math.round(v * 100)}%`);
  const BiasIcon = cal.biasDirection === "under" ? TrendingUp : cal.biasDirection === "over" ? TrendingDown : Minus;

  return (
    <Card className={cn("p-3 space-y-2.5", VERDICT_TONE[cal.verdict])}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-sm flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" /> Hiệu chỉnh dự báo
        </h3>
        <InsightLabelBadge label="Observed Pattern" />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Đèn &amp; hiệu chỉnh để HỌC, KHÔNG phải KPI thưởng/phạt; đọc metric theo cặp đối trọng (vd tỷ lệ khách mới ↔ retention của họ).
      </p>

      {!cal.enough ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">
            Chưa đủ dữ liệu để chấm độ chính xác dự báo — cần ít nhất {cal.minPairs} giải vừa CÓ dự báo vừa CÓ
            kết quả thật.
          </p>
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, (cal.scoredPairs / cal.minPairs) * 100)}%` }} />
            </div>
            <span className="tabular-nums text-[11px] text-muted-foreground">{cal.scoredPairs}/{cal.minPairs}</span>
          </div>
          <p className="text-[10px] text-muted-foreground/80">
            Ghi thêm <strong>kết quả thật</strong> (lượt entry, prize pool) ở các giải đã dự báo trong Bước ⑥ để mở khóa.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Tile
              label={`Trong dải (mục tiêu ${Math.round(cal.targetBandRate * 100)}%)`}
              value={pct(cal.inBandRate)}
              sub={`${cal.bandedPairs} giải có dải`}
            />
            <Tile
              label="Xu hướng lệch"
              value={
                cal.biasDirection === "none"
                  ? "≈ cân"
                  : `${cal.biasDirection === "under" ? "thấp" : "cao"} ~${Math.round(Math.abs(cal.meanBias ?? 0))}`
              }
              icon={<BiasIcon className="h-3 w-3" />}
            />
            <Tile
              label="Sai số TB"
              value={cal.mae === null ? "—" : `±${Math.round(cal.mae)}`}
              sub={cal.mapePct === null ? undefined : `~${Math.round(cal.mapePct)}%`}
            />
          </div>
          <ul className="space-y-0.5">
            {cal.notes.map((n, i) => (
              <li key={i} className="text-[10px] text-muted-foreground">• {n}</li>
            ))}
          </ul>
        </>
      )}

      <ExplainHint term="hiệu chỉnh dự báo">
        So từng dự báo <b>cũ</b> (đã ghi TRƯỚC giải) với <b>kết quả thật</b> sau giải. <b>Tỷ lệ trong dải</b>:
        thực tế rơi trong khoảng P5–P95 bao nhiêu lần — dải trung thực thì ~90%. <b>Xu hướng lệch</b>: có hay
        đoán thấp/cao hơn thực tế đều đặn không. <b>Sai số TB</b>: lệch điển hình bao nhiêu lượt entry. Không
        dùng kết quả để "sửa lại" dự báo cũ — chỉ để chỉnh cách dự báo lần sau.
      </ExplainHint>
    </Card>
  );
}

function Tile({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2 text-center">
      <div className="flex items-center justify-center gap-1 font-display text-base tabular-nums text-primary">
        {icon}
        {value}
      </div>
      <div className="text-[9.5px] leading-tight text-muted-foreground">{label}</div>
      {sub && <div className="text-[9px] text-muted-foreground/70">{sub}</div>}
    </div>
  );
}
