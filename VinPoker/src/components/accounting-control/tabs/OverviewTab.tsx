import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatVND } from "@/lib/format";
import { MOCK_ENTRY_FORECAST, MOCK_OVERVIEW } from "../mock/mockData";
import { LiabilityCard } from "../shared/LiabilityCard";
import { MoneyCard } from "../shared/MoneyCard";
import { TabShell } from "../shared/TabShell";

/**
 * Tổng quan tháng — tách BẮT BUỘC hai khối: tiền của club vs tiền giữ hộ.
 * Pass-through/liability không bao giờ đứng chung khối (hay chung màu) với doanh thu.
 */
export function OverviewTab({
  onNavigate,
  data = MOCK_OVERVIEW,
}: {
  onNavigate: (id: string) => void;
  data?: typeof MOCK_OVERVIEW;
}) {
  return (
    <TabShell
      title="Tổng quan tháng"
      question="Tháng này club thực giữ lại bao nhiêu — và đang giữ hộ/nợ ai bao nhiêu?"
      doctrine={[
        "Tiền pool giải và ký quỹ là tiền pass-through/khoản phải trả — không bao giờ được tính là doanh thu của club.",
        "Kỳ chưa chốt sổ thì mọi con số đều là Tạm tính; chỉ thành Đã chốt sau sự kiện đóng sổ, sửa bằng bút toán điều chỉnh.",
      ]}
    >
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2.5">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-400/80" />
        <p className="text-[12px] leading-relaxed text-foreground/85">
          Doanh thu giữ lại ≠ tổng buy-in. Prize pool và escrow là tiền pass-through/liability,
          không phải doanh thu.
        </p>
      </div>

      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{data.periodLabel}</p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground/80">
            Tiền của club
          </h3>
          <div className="grid gap-2">
            <MoneyCard
              label="Doanh thu giữ lại"
              amount={data.retainedRevenue}
              state="provisional"
              kind="revenue"
              sub="Phí giải club thực giữ — không gồm tiền pool"
            />
            <MoneyCard
              label="Chi phí trực tiếp"
              amount={data.directCosts}
              state="provisional"
              kind="cost"
              sub="Chưa gồm lương PT — xem Cảnh báo"
            />
            <MoneyCard label="Bù đắp GTD" amount={data.gtdSubsidy} state="provisional" kind="cost" />
            <MoneyCard
              label="Biên đóng góp (chưa trừ chi phí vận hành chung)"
              amount={data.contribution}
              state="provisional"
            />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[#d4b46a]/90">
            Tiền giữ hộ (không phải của club)
          </h3>
          <div className="grid gap-2">
            <LiabilityCard
              label="Tiền pool giải (pass-through)"
              amount={data.passThroughPool}
              state="provisional"
              note="Tiền của người chơi — chảy qua club để trả thưởng"
            />
            <LiabilityCard label="Còn phải trả giải" amount={data.payoutOwed} state="provisional" />
            <LiabilityCard label="Ký quỹ staking" amount={data.escrowHeld} state="provisional" />
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#d4b46a]/30 bg-[#d4b46a]/[0.06] px-3 py-2">
              <span className="text-[12px] text-[#d4b46a]/90">
                Tổng đang giữ hộ / còn phải trả
              </span>
              <span className="text-sm font-semibold tabular-nums text-[#d4b46a]">
                {formatVND(data.liabilitiesHeld)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <MoneyCard
        label="Dự báo entries giải tới"
        amount={MOCK_ENTRY_FORECAST}
        state="forecast"
        sub="Số entries dự phóng (không phải tiền) — dùng để ước rủi ro GTD trước giải"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/60 px-3 py-2.5">
        <span className="text-sm text-foreground/90">
          Cảnh báo đang mở: <span className="font-semibold text-amber-400">{data.openAlerts}</span>
        </span>
        <Button variant="outline" size="sm" onClick={() => onNavigate("alerts")}>
          Xem Cảnh báo lệch số →
        </Button>
      </div>
    </TabShell>
  );
}
