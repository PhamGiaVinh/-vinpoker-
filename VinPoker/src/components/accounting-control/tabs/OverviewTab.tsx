import { Info, PlugZap, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatVND } from "@/lib/format";
import { MOCK_ENTRY_FORECAST, MOCK_OVERVIEW } from "../mock/mockData";
import { LiabilityCard } from "../shared/LiabilityCard";
import { MoneyCard } from "../shared/MoneyCard";
import { TabShell } from "../shared/TabShell";

/** Số thật (read-only) từ get_club_finance_summary cho khối "Tiền của club". */
export interface LiveOverviewData {
  periodLabel: string;
  retainedRevenue: number; // revenue.total — phí/rake club thực giữ
  directCosts: number; // cost.payrollNet — lương dealer đã lưu (CHƯA gồm PT)
  contribution: number; // net — còn lại sau lương (CHƯA gồm bù đắp GTD & CP vận hành)
}

export interface LiveOverviewState {
  active: boolean; // flag ON
  loading: boolean;
  error: string | null;
  data: LiveOverviewData | null;
}

/** Nhãn nhỏ "(mock — chưa nối)" cho các phần chưa nối số thật khi đang ở chế độ live. */
function MockTag() {
  return (
    <span className="ml-1.5 align-middle text-[10px] font-medium text-amber-400/80">(mock — chưa nối)</span>
  );
}

/**
 * Tổng quan tháng — tách BẮT BUỘC hai khối: tiền của club vs tiền giữ hộ.
 * W1: khi `live.active`, khối "Tiền của club" hiển thị SỐ THẬT (Tạm tính, tới hôm nay); phần
 * còn lại vẫn là mock, gắn nhãn rõ. Khi tắt flag → mock y như cũ.
 */
export function OverviewTab({
  onNavigate,
  data = MOCK_OVERVIEW,
  live,
}: {
  onNavigate: (id: string) => void;
  data?: typeof MOCK_OVERVIEW;
  live?: LiveOverviewState;
}) {
  const isLive = !!live?.active;
  const liveData = live?.data ?? null;
  const showLiveNumbers = isLive && !!liveData;

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

      {isLive && (
        <div className="flex items-start gap-2.5 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
          <PlugZap className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <p className="text-[12px] leading-relaxed text-foreground/85">
            <span className="font-semibold text-primary">Khối "Tiền của club" đang là SỐ THẬT</span>{" "}
            (đọc từ tài chính CLB, Tạm tính — tới hôm nay). Bù đắp GTD, "Tiền giữ hộ" và dự báo bên
            dưới vẫn là mock, sẽ nối ở các bước sau. Lương PT chưa có trong số này (chờ #656 R2).
          </p>
        </div>
      )}

      {isLive && live?.error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
          <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
          <p className="text-[12px] leading-relaxed text-foreground/85">
            Không tải được số thật ({live.error}). Đang hiển thị dữ liệu mẫu thay thế.
          </p>
        </div>
      )}

      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {showLiveNumbers ? liveData!.periodLabel : data.periodLabel}
        {isLive && live?.loading && !liveData && " · đang tải số thật…"}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground/80">
            Tiền của club {showLiveNumbers && <span className="text-primary/80 normal-case">· số thật</span>}
          </h3>
          <div className="grid gap-2">
            <MoneyCard
              label="Doanh thu giữ lại"
              amount={showLiveNumbers ? liveData!.retainedRevenue : data.retainedRevenue}
              state="provisional"
              kind="revenue"
              sub="Phí giải + phí staking club thực giữ — không gồm tiền pool"
            />
            <MoneyCard
              label={showLiveNumbers ? "Chi phí lương (đã lưu)" : "Chi phí trực tiếp"}
              amount={showLiveNumbers ? liveData!.directCosts : data.directCosts}
              state="provisional"
              kind="cost"
              sub="Chưa gồm lương PT (chờ #656 R2) — xem Cảnh báo"
            />
            {showLiveNumbers ? (
              <div className="rounded-lg border border-border bg-card/50 px-3 py-2 text-[11px] text-muted-foreground">
                Bù đắp GTD tính theo từng giải — xem tab Event P&amp;L. <MockTag />
              </div>
            ) : (
              <MoneyCard label="Bù đắp GTD" amount={data.gtdSubsidy} state="provisional" kind="cost" />
            )}
            <MoneyCard
              label={
                showLiveNumbers
                  ? "Còn lại sau lương (chưa trừ bù đắp GTD & CP vận hành chung)"
                  : "Biên đóng góp (chưa trừ chi phí vận hành chung)"
              }
              amount={showLiveNumbers ? liveData!.contribution : data.contribution}
              state="provisional"
            />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[#d4b46a]/90">
            Tiền giữ hộ (không phải của club) {isLive && <MockTag />}
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
              <span className="text-[12px] text-[#d4b46a]/90">Tổng đang giữ hộ / còn phải trả</span>
              <span className="text-sm font-semibold tabular-nums text-[#d4b46a]">
                {formatVND(data.liabilitiesHeld)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <MoneyCard
        label={isLive ? "Dự báo entries giải tới (mock — chưa nối)" : "Dự báo entries giải tới"}
        amount={MOCK_ENTRY_FORECAST}
        state="forecast"
        unit="count"
        sub="Số entries dự phóng (không phải tiền) — dùng để ước rủi ro GTD trước giải"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/60 px-3 py-2.5">
        <span className="text-sm text-foreground/90">
          Cảnh báo đang mở: <span className="font-semibold text-amber-400">{data.openAlerts}</span>
          {isLive && <MockTag />}
        </span>
        <Button variant="outline" size="sm" onClick={() => onNavigate("alerts")}>
          Xem Cảnh báo lệch số →
        </Button>
      </div>
    </TabShell>
  );
}
