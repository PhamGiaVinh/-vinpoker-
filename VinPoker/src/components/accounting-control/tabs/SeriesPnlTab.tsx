import { ArrowRightLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import { MOCK_EVENTS, MOCK_SERIES } from "../mock/mockData";
import type { EventPnlFixture } from "../mock/types";
import { DataStateBadge } from "../shared/DataStateBadge";
import { TabShell } from "../shared/TabShell";

export function SeriesPnlTab({
  series = MOCK_SERIES,
  events = MOCK_EVENTS,
}: {
  series?: typeof MOCK_SERIES;
  events?: EventPnlFixture[];
}) {
  const byId = (id: string) => events.find((e) => e.id === id);

  return (
    <TabShell
      title="Series P&L — Biên đóng góp theo chuỗi giải"
      question="Cả chuỗi giải cộng lại, club được gì?"
      doctrine={[
        "Chi phí cấp series phải nêu rõ quy tắc phân bổ — không được giấu bằng cách dồn hết vào một giải.",
        "Series Intelligence chỉ được dùng số Đã chốt — số dự báo không bao giờ ghi vào sổ.",
      ]}
    >
      <div className="flex items-start gap-2.5 rounded-lg border border-[#378ADD]/30 bg-[#378ADD]/[0.06] px-3 py-2.5">
        <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-[#378ADD]" />
        <p className="text-[12px] leading-relaxed text-foreground/85">
          Series Intelligence dự báo trước. Accounting Control chốt số thật sau event/series.
          Forecast không phải accounting truth.
        </p>
      </div>

      <Card className="gradient-card p-3 md:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
          <h3 className="text-sm font-semibold text-foreground">{series.name}</h3>
          <DataStateBadge state={series.state} />
        </div>

        {series.eventIds.map((id) => {
          const ev = byId(id);
          if (!ev) return null;
          return (
            <div key={id} className="border-b border-border/60 py-2">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex flex-wrap items-center gap-2 text-sm text-foreground/90">
                  {ev.name}
                  <DataStateBadge state={ev.state} />
                </span>
                <span className={`text-sm tabular-nums ${ev.contribution < 0 ? "text-red-400" : "text-primary"}`}>
                  {formatVND(ev.contribution)}
                </span>
              </div>
              {ev.state === "provisional" && (
                <p className="mt-0.5 text-[11px] text-amber-400/90">còn Tạm tính — tổng series chưa chốt</p>
              )}
            </div>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 py-2 font-medium">
          <span className="text-sm text-foreground/90">Tổng biên đóng góp các giải</span>
          <span
            className={`text-sm tabular-nums ${series.eventContributionTotal < 0 ? "text-red-400" : "text-primary"}`}
          >
            {formatVND(series.eventContributionTotal)}
          </span>
        </div>

        {series.allocations.map((a) => (
          <div key={a.label} className="border-b border-border/60 py-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-sm text-foreground/80">− {a.label}</span>
              <span className="text-sm tabular-nums text-foreground/80">−{formatVND(a.amount)}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{a.rule}</p>
            <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
              {a.perEvent.map((p) => `${byId(p.eventId)?.name ?? p.eventId}: ${formatVND(p.amount)}`).join(" · ")}
            </p>
          </div>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-2.5">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            Biên đóng góp sau phân bổ (chưa trừ chi phí vận hành chung)
            <DataStateBadge state={series.state} />
          </span>
          <span
            className={`text-base font-semibold tabular-nums ${
              series.contributionAfterAllocations < 0 ? "text-red-400" : "text-primary"
            }`}
          >
            {formatVND(series.contributionAfterAllocations)}
          </span>
        </div>
      </Card>

      <Card className="p-3 md:p-4">
        <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          Ghi chú: giải “mồi” trong chuỗi
        </p>
        <p className="text-[12px] leading-relaxed text-foreground/85">
          Một giải lỗ có thể hợp lý nếu tổng chuỗi tốt lên — nhưng khoản bù phải hiển thị rõ
          (Bù đắp GTD), không được giấu bằng cách dồn chi phí sang giải khác.
        </p>
      </Card>
    </TabShell>
  );
}
