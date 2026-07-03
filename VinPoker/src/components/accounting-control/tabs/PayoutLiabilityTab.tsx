import { Card } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { formatVND } from "@/lib/format";
import { MOCK_PAYOUT } from "../mock/mockData";
import type { PayoutRow } from "../mock/types";
import { LiabilityCard } from "../shared/LiabilityCard";
import { MoneyCard } from "../shared/MoneyCard";
import { TabShell } from "../shared/TabShell";

function OwedRow({ row }: { row: PayoutRow }) {
  return (
    <div className="py-2 border-b border-border/60 last:border-b-0 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-[11px] w-12 text-muted-foreground">Hạng {row.rank}</span>
      <span className="text-sm text-foreground/90 flex-1 min-w-[90px]">{row.playerMasked}</span>
      <span className="text-sm font-semibold tabular-nums text-[#d4b46a]">{formatVND(row.amount)}</span>
      {row.agingDays !== undefined && (
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
            row.agingDays >= 2
              ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
              : "border-border text-muted-foreground bg-transparent"
          }`}
        >
          {row.agingDays} ngày
        </span>
      )}
    </div>
  );
}

export function PayoutLiabilityTab({ payout = MOCK_PAYOUT }: { payout?: typeof MOCK_PAYOUT }) {
  return (
    <TabShell
      title="Phải trả giải (Payout liability)"
      question="Club còn nợ người chơi bao nhiêu tiền thưởng?"
      doctrine={[
        "Tiền giải là tiền của người chơi — club chỉ giữ hộ cho đến khi trả xong.",
        "Giải thưởng chưa nhận vẫn là khoản phải trả, dù đã qua bao nhiêu ngày.",
      ]}
    >
      {/* (a) Tổng còn nợ / đã trả */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <LiabilityCard label="Còn phải trả" amount={payout.owedTotal} state="provisional" />
        <MoneyCard label="Đã trả" amount={payout.paidTotal} state="reconciled" kind="neutral" />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Tổng giải thưởng {formatVND(payout.totalPrizes)} = pool người chơi 440.000.000 ₫ + Bù đắp
        GTD 60.000.000 ₫ — GTD giữ đúng cam kết.
      </p>

      {/* (b) Danh sách còn nợ */}
      <Card className="p-3 md:p-4 gradient-card">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          Còn nợ người chơi
        </p>
        {payout.owedRows.map((r) => (
          <OwedRow key={r.rank} row={r} />
        ))}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Giải thưởng chưa nhận vẫn là khoản phải trả — không bao giờ tự biến thành tiền club.
        </p>
      </Card>

      {/* (c) Đã trả (mẫu) */}
      <Card className="p-3 md:p-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          Đã trả (3 dòng gần nhất)
        </p>
        {payout.paidRowsSample.map((r) => (
          <div
            key={r.rank}
            className="py-1.5 border-b border-border/40 last:border-b-0 flex items-center gap-3 text-muted-foreground"
          >
            <span className="text-[11px] w-12">Hạng {r.rank}</span>
            <span className="text-[12px] flex-1">{r.playerMasked}</span>
            <span className="text-[12px] tabular-nums">{formatVND(r.amount)}</span>
          </div>
        ))}
        <p className="text-[12px] text-muted-foreground/60 pt-1">…</p>
      </Card>

      {/* (d) Cảnh báo mẫu — repair-wave #656 R1 */}
      <Card className="p-3 border-amber-500/30 bg-amber-500/[0.06]">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
          <div className="space-y-1">
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-dashed border-amber-500/50 text-amber-400">
              Cảnh báo mẫu
            </span>
            <p className="text-[12px] leading-relaxed text-amber-200/90">
              Payout Edge v1 → v1.1: sửa lỗi đã merge (#656 R1), chờ deploy — số liability coi là
              Tạm tính, xác minh thủ công trước khi trả. Trạng thái thật xác minh qua MODULE_STATUS.
            </p>
          </div>
        </div>
      </Card>

      {/* (e) Bảng thưởng dự kiến vs đóng băng */}
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">
          <span className="text-foreground/80 font-medium">Đang mở đăng ký:</span> bảng thưởng là
          dự kiến (Tạm tính) — thay đổi theo số người vào thêm.
        </p>
        <p className="text-[11px] text-muted-foreground">
          <span className="text-foreground/80 font-medium">Đóng đăng ký:</span> bảng thưởng ĐÓNG
          BĂNG theo snapshot — dữ liệu về sau không xáo lại giải.
        </p>
      </div>
    </TabShell>
  );
}
