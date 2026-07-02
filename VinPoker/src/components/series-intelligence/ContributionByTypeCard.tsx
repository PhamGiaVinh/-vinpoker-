import { Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import { avgContributionPerEvent, type ContributionByTypeResult } from "@/lib/series-intelligence/commandCenter";
import { InsightLabelBadge } from "./InsightLabelBadge";
import { ExplainHint } from "./ExplainHint";

const toTr = (v: number) => Math.round(v / 1e5) / 10; // VND → triệu (1 decimal)

/**
 * "Biên đóng góp theo loại giải" — quant-mockup layout: horizontal green/red bars per type (which types feed
 * the club, which bleed it) + 2 headline KPIs. DELIBERATELY not profit: fee kept − observed GTD overlay cost,
 * excluding staff/marketing/operations (subtitle always says so). Measured only (Observed Pattern).
 */
export function ContributionByTypeCard({
  result,
  overlayRatePct = null,
}: {
  result: ContributionByTypeResult;
  /** % of GTD events that needed overlay (from the existing gtdOverlay rows) — null when not derivable. */
  overlayRatePct?: number | null;
}) {
  if (result.rows.length === 0) return null;

  const measured = result.rows.filter((r) => r.margin !== null);
  const maxAbs = Math.max(1, ...measured.map((r) => Math.abs(r.margin as number)));
  const avgMargin = avgContributionPerEvent(result).value;

  return (
    <Card className="p-4 gradient-card border-primary/40 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" /> Biên đóng góp theo loại giải
          <span className="text-[10px] font-sans font-normal text-muted-foreground">(triệu đồng)</span>
        </h3>
        <InsightLabelBadge label={result.label} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Fee giữ lại − chi phí bù GTD · <strong>CHƯA gồm nhân sự, marketing, vận hành</strong> — không phải lợi nhuận.
      </p>

      {/* headline KPIs (đo được — Observed Pattern) */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-border/60 bg-card/40 p-2">
          <div className="text-[10px] text-muted-foreground">Tỷ lệ giải bị overlay (trong giải có GTD)</div>
          <div className={cn("font-display text-lg tabular-nums", (overlayRatePct ?? 0) > 0 ? "text-warning" : "")}>
            {overlayRatePct === null ? "—" : `${overlayRatePct.toFixed(1)}%`}
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-card/40 p-2">
          <div className="text-[10px] text-muted-foreground">Biên đóng góp TB / giải (đã đo)</div>
          <div className={cn("font-display text-lg tabular-nums", avgMargin !== null && avgMargin < 0 ? "text-destructive" : "text-primary")}>
            {avgMargin === null ? "—" : formatVndShort(Math.round(avgMargin))}
          </div>
        </div>
      </div>

      {!result.available ? (
        <p className="text-xs text-muted-foreground">Chưa có loại giải nào đủ dữ liệu fee + entries để đo.</p>
      ) : (
        <ul className="space-y-1.5">
          {result.rows.map((r) => {
            const m = r.margin;
            const pct = m === null ? 0 : Math.max(6, (Math.abs(m) / maxAbs) * 100);
            return (
              <li key={r.type} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate" title={`${r.typeLabel} · ${r.eventCount} giải`}>
                    {r.typeLabel}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded-sm bg-muted/30">
                    {m !== null && (
                      <div
                        className={cn("h-full rounded-sm", m >= 0 ? "bg-primary/80" : "bg-destructive/80")}
                        style={{ width: `${pct}%` }}
                        aria-label={`${r.typeLabel}: ${formatVndShort(m)}`}
                      />
                    )}
                  </div>
                  <span
                    className={cn(
                      "w-14 shrink-0 text-right font-semibold tabular-nums",
                      m === null ? "text-muted-foreground" : m >= 0 ? "text-primary" : "text-destructive",
                    )}
                  >
                    {m === null ? "—" : `${m >= 0 ? "+" : "−"}${Math.abs(toTr(m)).toLocaleString("vi-VN")}`}
                  </span>
                </div>
                {r.notes.map((n, i) => (
                  <div key={i} className="ml-[7.5rem] mt-0.5 text-[10px] text-muted-foreground">• {n}</div>
                ))}
              </li>
            );
          })}
        </ul>
      )}

      <ExplainHint term="biên đóng góp">
        Lời/lỗ <b>đo được</b> của mỗi loại giải: tiền fee CLB giữ lại trừ tiền (ước tính) phải bù GTD.
        Chưa trừ lương nhân sự, marketing, mặt bằng — nên dương ở đây chưa chắc lãi thật. ÂM ở đây là
        <b> tín hiệu xấu đáng xem lại GTD/cấu trúc</b> — nhưng đọc ghi chú thiếu dữ liệu trước: giải thiếu fee
        vẫn bị tính chi phí bù, nên số âm có thể do thiếu dữ liệu chứ chưa chắc lỗ thật.
      </ExplainHint>
      <p className="text-[10px] text-muted-foreground/80">{result.disclaimer}</p>
    </Card>
  );
}
