import { Gauge, TrendingDown, Activity, TrendingUp, Info, AlertCircle, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import { InsightLabelBadge } from "./InsightLabelBadge";
import type {
  Range,
  Scenario,
  ScenarioConfidence,
  ScenarioKind,
  ScenarioOutlookResult,
} from "@/lib/series-intelligence/scenarioOutlook";
import type { OwnerAction } from "@/lib/series-intelligence/commandCenter";

const countFmt = new Intl.NumberFormat("vi-VN");

const KIND_ICON: Record<ScenarioKind, typeof Activity> = {
  conservative: TrendingDown,
  base: Activity,
  upside: TrendingUp,
};

const CONFIDENCE: Record<ScenarioConfidence, { label: string; cls: string }> = {
  low: { label: "Tin cậy thấp", cls: "border-border text-muted-foreground bg-secondary" },
  medium: { label: "Tin cậy trung bình", cls: "border-warning/40 text-warning bg-warning/10" },
  high: { label: "Tin cậy cao", cls: "border-primary/40 text-primary bg-primary/10" },
};

function ConfidenceChip({ confidence }: { confidence: ScenarioConfidence }) {
  const c = CONFIDENCE[confidence];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none", c.cls)}>
      {c.label}
    </span>
  );
}

function countRange(r: Range): string {
  return `${countFmt.format(Math.round(r.low))}–${countFmt.format(Math.round(r.high))}`;
}

function moneyRange(r: Range | null): string {
  if (r === null) return "—";
  return `${formatVndShort(r.low)}–${formatVndShort(r.high)}`;
}

function ScenarioCard({ s }: { s: Scenario }) {
  const Icon = KIND_ICON[s.kind];
  return (
    <Card className="p-3 gradient-card border-primary/40 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          {s.label}
        </div>
        <InsightLabelBadge label={s.insightLabel} />
      </div>

      <div>
        <div className="text-[11px] text-muted-foreground">Khoảng entry/event</div>
        <div className="font-display text-lg tabular-nums">{countRange(s.entryRange)}</div>
      </div>

      <div className="space-y-0.5 text-xs">
        <div className="text-[11px] text-muted-foreground">Volume tham khảo/event</div>
        <div className="flex justify-between tabular-nums">
          <span className="text-muted-foreground">Buy-in</span>
          <span>{moneyRange(s.buyInVolumeRange)}</span>
        </div>
        <div className="flex justify-between tabular-nums">
          <span className="text-muted-foreground">Fee (rake)</span>
          <span>{moneyRange(s.feeVolumeRange)}</span>
        </div>
        <div className="flex justify-between tabular-nums">
          <span className="text-muted-foreground">Prize pool (đã nhập)</span>
          <span>{moneyRange(s.prizePoolRange)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <ConfidenceChip confidence={s.confidence} />
      </div>
      <p className="text-[11px] text-muted-foreground">{s.copy}</p>
    </Card>
  );
}

/**
 * Scenario Outlook Lite — Conservative / Base / Upside ranges for ONE comparable
 * event (per-event, not a series total). Rules-based, not prediction.
 */
export function ScenarioOutlook({
  outlook,
  actions,
}: {
  outlook: ScenarioOutlookResult;
  actions: OwnerAction[];
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-display text-base flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" /> Kịch bản vận hành
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Theo các event tương tự đã ghi nhận — khoảng cho MỘT event, không phải tổng series.
        </p>
      </div>

      {!outlook.available ? (
        <Card className="p-5 border-primary/30 gradient-card flex items-start gap-3">
          <Info className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="space-y-1 text-sm">
            <div className="font-medium">Chưa đủ dữ liệu cho kịch bản</div>
            <p className="text-xs text-muted-foreground">
              Cần thêm dữ liệu GTD / cấu trúc / kết quả (số entry) để mở kịch bản mạnh hơn.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {outlook.scenarios.map((s) => (
              <ScenarioCard key={s.kind} s={s} />
            ))}
          </div>

          {outlook.missingDataNotes.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {outlook.missingDataNotes.map((m, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          )}

          {actions.length > 0 && (
            <Card className="p-3 gradient-card border-primary/40 space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Gợi ý theo kịch bản</div>
              <ul className="space-y-1.5">
                {actions.map((a) => (
                  <li key={a.id} className="flex items-start gap-2">
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span>{a.text}</span>
                      <InsightLabelBadge label={a.label} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="text-[10px] text-muted-foreground/80">{outlook.disclaimer}</p>
        </>
      )}
    </section>
  );
}
