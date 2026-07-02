import { Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import type { ContributionByTypeResult } from "@/lib/series-intelligence/commandCenter";
import { InsightLabelBadge } from "./InsightLabelBadge";
import { ExplainHint } from "./ExplainHint";

/**
 * "Biên đóng góp theo loại giải" (quant spec Fig 2 — which event types feed the club, which bleed it).
 * DELIBERATELY not called profit/gross margin: fee kept − observed GTD overlay cost, excluding
 * staff/marketing/operations (subtitle says so, always). Green rows ≥ 0, red rows < 0. Measured only.
 */
export function ContributionByTypeCard({ result }: { result: ContributionByTypeResult }) {
  if (result.rows.length === 0) return null;
  return (
    <Card className="p-4 gradient-card border-primary/40 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" /> Biên đóng góp theo loại giải
        </h3>
        <InsightLabelBadge label={result.label} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Fee giữ lại − chi phí bù GTD · <strong>CHƯA gồm nhân sự, marketing, vận hành</strong> — không phải lợi nhuận.
      </p>

      {!result.available ? (
        <p className="text-xs text-muted-foreground">Chưa có loại giải nào đủ dữ liệu fee + entries để đo.</p>
      ) : (
        <ul className="space-y-1.5">
          {result.rows.map((r) => (
            <li key={r.type} className="rounded-md border border-border/60 bg-card/40 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{r.typeLabel}</span>
                <span className="text-[10px] text-muted-foreground">{r.eventCount} giải</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  fee {formatVndShort(r.feeRevenue.value)}
                  {r.feeRevenue.partial && <span className="text-warning"> (≈)</span>}
                  {" · bù GTD "}
                  {formatVndShort(r.overlayCost.value)}
                </span>
                <span
                  className={cn(
                    "ml-auto font-semibold tabular-nums",
                    r.margin === null ? "text-muted-foreground" : r.margin >= 0 ? "text-primary" : "text-destructive",
                  )}
                >
                  {r.margin === null ? "— chưa đo được" : formatVndShort(r.margin)}
                </span>
              </div>
              {r.notes.map((n, i) => (
                <div key={i} className="mt-0.5 text-[10px] text-muted-foreground">• {n}</div>
              ))}
            </li>
          ))}
        </ul>
      )}

      <ExplainHint term="biên đóng góp">
        Lời/lỗ <b>đo được</b> của mỗi loại giải: tiền fee CLB giữ lại trừ tiền đã (ước tính) phải bù GTD.
        Chưa trừ lương nhân sự, marketing, mặt bằng — nên dương ở đây chưa chắc lãi thật, nhưng ÂM ở đây thì
        chắc chắn loại giải đó đang bào tiền, đáng xem lại GTD/cấu trúc.
      </ExplainHint>
      <p className="text-[10px] text-muted-foreground/80">{result.disclaimer}</p>
    </Card>
  );
}
