import { Card } from "@/components/ui/card";
import { AlertTriangle, Landmark, NotebookPen, Wallet } from "lucide-react";
import { formatVND } from "@/lib/format";
import { MOCK_CASH_CHANNELS } from "../mock/mockData";
import { VARIANCE_BUCKET_LABEL, type CashChannelFixture } from "../mock/types";
import { DataStateBadge } from "../shared/DataStateBadge";
import { VarianceRow } from "../shared/VarianceRow";
import { TabShell } from "../shared/TabShell";

const SOURCES = [
  {
    icon: Landmark,
    label: "Bank (SePay)",
    role: "Bằng chứng tiền chuyển động mạnh nhất — dòng tiền thật vào/ra tài khoản.",
  },
  {
    icon: NotebookPen,
    label: "Sổ hệ thống",
    role: "Ý định ghi nhận — buy-in, payout, lương mà hệ thống đã ghi.",
  },
  {
    icon: Wallet,
    label: "Két tiền mặt",
    role: "Đếm thực tế — tiền mặt đếm được cuối ca, không phải số trên giấy.",
  },
] as const;

export function CashBankTab({ channels = MOCK_CASH_CHANNELS }: { channels?: CashChannelFixture[] }) {
  return (
    <TabShell
      title="Tiền mặt / SePay / Bank"
      question="Tiền trong bank và trong két có khớp với sổ không?"
      doctrine={[
        "Bank là sự thật về TIỀN (cash truth) — tiền đã thực sự chuyển động hay chưa.",
        "Sổ hệ thống là sự thật về GHI NHẬN (recognition truth) — hệ thống định ghi cái gì.",
        "Không bao giờ sửa records để ép hai bên khớp nhau — chênh lệch được ghi nhận và giải thích, không bị xoá.",
      ]}
    >
      {/* (a) Ba nguồn sự thật */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {SOURCES.map((s) => (
          <Card key={s.label} className="p-3 gradient-card">
            <div className="flex items-center gap-2">
              <s.icon className="w-4 h-4 text-muted-foreground" />
              <span className="text-[12px] font-semibold text-foreground">{s.label}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{s.role}</p>
          </Card>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Tiền chuyển động ≠ ghi nhận doanh thu — một dòng bank khớp chứng minh tiền đã đến, không
        chứng minh doanh thu đã phát sinh.
      </p>

      {/* (b) Đối soát từng kênh */}
      {channels.map((ch) => (
        <Card key={ch.channel} className="p-3 md:p-4 gradient-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-foreground">{ch.label}</span>
            <DataStateBadge state={ch.state} />
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{ch.description}</p>
          <div className="mt-1">
            <VarianceRow label="Tổng" expected={ch.expected} actual={ch.actual} />
          </div>
          {ch.buckets.length > 0 ? (
            <div className="mt-1 space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Giải thích chênh lệch
              </p>
              {ch.buckets.map((b) => (
                <div key={`${b.bucket}-${b.amount}`} className="flex flex-wrap items-start gap-x-2 gap-y-0.5">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-amber-500/40 text-amber-400 bg-amber-500/10 whitespace-nowrap">
                    {VARIANCE_BUCKET_LABEL[b.bucket]}
                  </span>
                  <span className="text-[12px] tabular-nums text-foreground/90">{formatVND(b.amount)}</span>
                  <span className="basis-full md:basis-auto text-[11px] text-muted-foreground">{b.note}</span>
                </div>
              ))}
            </div>
          ) : (
            ch.actual !== ch.expected && (
              <p className="mt-1 text-[11px] text-amber-400/90">
                Chưa giải thích được sau kiểm đếm — giữ nguyên là chênh lệch chưa giải thích, không
                tự xoá.
              </p>
            )
          )}
        </Card>
      ))}

      {/* (c) Hazard đã biết của SePay */}
      <Card className="p-3 border-amber-500/30 bg-amber-500/[0.06]">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
          <p className="text-[12px] leading-relaxed text-amber-200/90">
            <span className="font-semibold">Rủi ro cấu hình SePay đã biết:</span> mỗi club chỉ nên
            có MỘT tài khoản escrow đang hoạt động. Màn hình cấu hình sửa dòng CŨ NHẤT nhưng edge
            function đọc dòng MỚI NHẤT — nếu tồn tại nhiều dòng active, hai bên có thể trỏ về 2 tài
            khoản khác nhau.
          </p>
        </div>
      </Card>
    </TabShell>
  );
}
