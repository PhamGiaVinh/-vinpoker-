import { Card } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatVND } from "@/lib/format";
import { MOCK_ESCROW } from "../mock/mockData";
import type { EscrowFixture, EscrowRow } from "../mock/types";
import { LiabilityCard } from "../shared/LiabilityCard";
import { TabShell } from "../shared/TabShell";

const STATUS_CHIP: Record<EscrowRow["status"], { label: string; chipClass: string }> = {
  held: { label: "Đang giữ", chipClass: "border-[#d4b46a]/50 text-[#d4b46a] bg-transparent" },
  released: { label: "Đã trả", chipClass: "border-border text-muted-foreground bg-transparent" },
  refunded: { label: "Đã hoàn", chipClass: "border-border text-muted-foreground bg-transparent" },
  refund_pending_repair: {
    label: "Chờ hoàn — đường hoàn đang sửa",
    chipClass: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  },
};

export function StakingEscrowTab({ escrow = MOCK_ESCROW }: { escrow?: EscrowFixture }) {
  const balanced = escrow.totalIn === escrow.released + escrow.refunded + escrow.balance;
  return (
    <TabShell
      title="Ký quỹ Staking / VBacker"
      question="Tiền của backer đang nằm ở đâu và có đủ không?"
      doctrine={[
        "Mọi khoản vào có đúng một lối ra: trả cho backer hoặc hoàn lại — không có lối thứ ba.",
        "Lịch sử chỉ ghi thêm, không sửa — hoàn tiền là bút toán mới, không xoá bút toán cũ.",
        "Nghi ngờ kẹt tiền = sự cố money-path — báo chủ CLB ngay, không tự xử lý im lặng.",
      ]}
    >
      {/* (a) Khung nhìn giữ hộ */}
      <p className="text-[12px] text-muted-foreground">
        Đây là tiền của player/backer — club chỉ giữ hộ, KHÔNG BAO GIỜ là doanh thu của club.
      </p>

      {/* (b) Bất biến kiểm soát */}
      <Card
        className={`p-3 md:p-4 ${
          balanced ? "border-primary/30 bg-primary/[0.04]" : "border-red-500/40 bg-red-500/[0.06]"
        }`}
      >
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
          Bất biến: tiền vào = đã trả + đã hoàn + đang giữ
        </p>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm tabular-nums">
          <span className="text-foreground font-semibold">{formatVND(escrow.totalIn)}</span>
          <span className="text-muted-foreground">vào =</span>
          <span className="text-foreground/90">{formatVND(escrow.released)}</span>
          <span className="text-muted-foreground">đã trả +</span>
          <span className="text-foreground/90">{formatVND(escrow.refunded)}</span>
          <span className="text-muted-foreground">đã hoàn +</span>
          <span className="text-[#d4b46a] font-semibold">{formatVND(escrow.balance)}</span>
          <span className="text-muted-foreground">đang giữ</span>
          {balanced ? (
            <CheckCircle2 className="w-4 h-4 text-primary" aria-label="Cân bằng" />
          ) : (
            <span className="text-[11px] font-semibold text-red-400">KHÔNG CÂN — kiểm tra ngay</span>
          )}
        </div>
      </Card>

      {/* (c) Số đang giữ hộ */}
      <LiabilityCard
        label="Đang giữ hộ"
        amount={escrow.balance}
        state="provisional"
        note="Tiền của backer đang nằm trong club — phải trả hoặc hoàn, không bao giờ ghi nhận là doanh thu."
      />

      {/* (d) Từng khoản ký quỹ */}
      <Card className="p-3 md:p-4 gradient-card">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          Từng khoản ký quỹ
        </p>
        {escrow.rows.map((row) => {
          const chip = STATUS_CHIP[row.status];
          const warning = row.status === "refund_pending_repair";
          return (
            <div
              key={row.id}
              className={`py-2 border-b border-border/60 last:border-b-0 ${
                warning ? "bg-amber-500/[0.06] -mx-2 px-2 rounded" : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {warning && <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />}
                <span
                  className={`text-sm flex-1 min-w-[140px] ${
                    warning ? "text-amber-200/90" : "text-foreground/90"
                  }`}
                >
                  {row.label}
                </span>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    row.status === "held" || warning ? "text-[#d4b46a]" : "text-muted-foreground"
                  }`}
                >
                  {formatVND(row.amount)}
                </span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${chip.chipClass}`}>
                  {chip.label}
                </span>
                {warning && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-dashed border-amber-500/50 text-amber-400 whitespace-nowrap">
                    Cảnh báo mẫu
                  </span>
                )}
              </div>
              {warning && row.note && (
                <p className="mt-1 text-[11px] leading-relaxed text-amber-200/80">{row.note}</p>
              )}
            </div>
          );
        })}
      </Card>
    </TabShell>
  );
}
