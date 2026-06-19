import { useMemo, type ReactNode } from "react";
import {
  ArrowLeft,
  FileText,
  Sparkles,
  ShieldAlert,
  ClipboardList,
  ScrollText,
  AlertCircle,
  WifiOff,
  Inbox,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useNativeSeriesEvents } from "@/lib/series-intelligence/useNativeSeriesEvents";
import { buildSeriesReport, type ReportItem } from "@/lib/series-intelligence/seriesReport";
import { OverviewCards } from "./OverviewCards";
import { RiskInsightCards } from "./RiskInsightCards";
import { InsightLabelBadge } from "./InsightLabelBadge";

const SEVERITY_DOT: Record<string, string> = {
  risk: "bg-destructive",
  warning: "bg-warning",
  info: "bg-muted-foreground",
};

function ItemRow({ item }: { item: ReportItem }) {
  return (
    <li className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span>{item.text}</span>
        <InsightLabelBadge label={item.label} />
      </div>
      {item.detail && <p className="text-[11px] text-muted-foreground">{item.detail}</p>}
    </li>
  );
}

/**
 * Series Health Report (Owner Report / Pilot Pack). Reuses S1/S2 helpers via
 * buildSeriesReport — descriptive BI summary, screenshot-first. Not prediction.
 */
export function SeriesHealthReport({ onBack }: { onBack: () => void }) {
  const native = useNativeSeriesEvents();
  const report = useMemo(() => buildSeriesReport(native.events), [native.events]);
  // Display-only timestamp (component, not the pure helper). Stable at mount.
  const generatedAt = useMemo(() => new Date().toLocaleString("vi-VN"), []);

  const header = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={onBack} aria-label="Quay lại bảng" className="print:hidden">
        <ArrowLeft className="w-4 h-4" />
      </Button>
      <div className="min-w-0">
        <h2 className="font-display text-xl text-primary flex items-center gap-2">
          <FileText className="w-5 h-5 shrink-0" /> Báo cáo sức khỏe series
        </h2>
        <p className="text-[11px] text-muted-foreground">Tạo lúc {generatedAt} · dữ liệu VinPoker (chỉ đọc)</p>
      </div>
    </div>
  );

  let body: ReactNode;

  if (native.status === "loading") {
    body = <p className="text-xs text-muted-foreground">Đang đọc dữ liệu để lập báo cáo…</p>;
  } else if (native.status === "unavailable") {
    body = (
      <Card className="p-5 border-warning/40 gradient-card flex items-start gap-3">
        <WifiOff className="h-5 w-5 shrink-0 text-warning" aria-hidden />
        <div className="space-y-1 text-sm">
          <div className="font-medium">Chưa đọc được dữ liệu</div>
          <p className="text-xs text-muted-foreground">
            Hãy thử tải lại trang.
            {native.reason ? <span className="text-muted-foreground/70"> ({native.reason})</span> : null}
          </p>
        </div>
      </Card>
    );
  } else if (!report.available) {
    body = (
      <Card className="p-8 gradient-card border-primary/30 flex flex-col items-center text-center gap-3">
        <div className="grid place-items-center w-14 h-14 rounded-full bg-primary/10">
          <Inbox className="h-7 w-7 text-primary" aria-hidden />
        </div>
        <div className="space-y-1">
          <h3 className="font-display text-lg">Chưa có dữ liệu để lập báo cáo</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Khi CLB chạy giải, báo cáo sức khỏe series sẽ tổng hợp tại đây.
          </p>
        </div>
      </Card>
    );
  } else {
    body = (
      <div className="space-y-4">
        {/* Executive Summary */}
        <Card className="p-4 gradient-card border-primary/40 space-y-3">
          <h3 className="font-display text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Tóm tắt điều hành
          </h3>
          <div className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Mức độ sẵn sàng dữ liệu</span>
              <span className="font-display text-lg tabular-nums">{report.executive.readinessScore}%</span>
            </div>
            <Progress value={report.executive.readinessScore} className="h-2" />
            <p className="text-[11px] text-muted-foreground">{report.executive.dataQualityNote}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" /> Top 3 rủi ro
              </div>
              {report.executive.topRisks.length === 0 ? (
                <p className="text-xs text-muted-foreground">Chưa đủ dữ liệu để nêu rủi ro.</p>
              ) : (
                <ul className="space-y-1">
                  {report.executive.topRisks.map((r) => (
                    <li key={r.id} className="flex items-center gap-1.5 text-sm">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${SEVERITY_DOT[r.severity] ?? "bg-muted-foreground"}`} aria-hidden />
                      <span className="truncate">{r.title}</span>
                      <InsightLabelBadge label={r.label} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Top 3 cơ hội
              </div>
              {report.executive.topOpportunities.length === 0 ? (
                <p className="text-xs text-muted-foreground">Chưa đủ dữ liệu để nêu cơ hội.</p>
              ) : (
                <ul className="space-y-1">
                  {report.executive.topOpportunities.map((o, i) => (
                    <ItemRow key={i} item={o} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>

        {/* Economics Summary (reuse OverviewCards) */}
        <section className="space-y-2">
          <h3 className="font-display text-base">Kinh tế series</h3>
          <OverviewCards economics={report.economics} />
          <p className="text-[10px] text-muted-foreground/80">Volume tham khảo — không thay thế báo cáo kế toán.</p>
        </section>

        {/* Risk Register (reuse RiskInsightCards) */}
        <RiskInsightCards risks={report.riskRegister} />

        {/* Action Plan */}
        <Card className="p-4 gradient-card border-primary/40 space-y-3">
          <h3 className="font-display text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" /> Kế hoạch hành động
          </h3>
          <div className="space-y-3">
            {report.actionPlan.map((phase) => (
              <div key={phase.phase} className="space-y-1">
                <div className="text-xs font-semibold text-primary">{phase.phase}</div>
                <ul className="space-y-1.5 pl-1">
                  {phase.items.map((it, i) => (
                    <ItemRow key={i} item={it} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        {/* Honest Boundary */}
        <Card className="p-4 border-primary/30 space-y-3">
          <h3 className="font-display text-base flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-primary" /> Ranh giới trung thực
          </h3>
          <div className="flex flex-wrap gap-2">
            {report.honestBoundary.labelsLegend.map((l) => (
              <div key={l.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <InsightLabelBadge label={l.label} />
                <span>{l.meaning}</span>
              </div>
            ))}
          </div>
          {report.honestBoundary.missingData.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {report.honestBoundary.missingData.map((m, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground/80">{report.honestBoundary.disclaimer}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      {body}
    </div>
  );
}
