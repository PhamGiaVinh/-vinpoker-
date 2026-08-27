import { BadgeCheck, Building2, CalendarDays, Landmark, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PayrollStatementOnlinePreview } from "@/lib/payrollStatementUi";
import vinpokerLogo from "@/assets/vinpoker-logo.svg";

export function PayrollStatementPreviewDialog(props: {
  preview: PayrollStatementOnlinePreview | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { preview, onOpenChange } = props;
  const status = preview?.draft ? "CHƯA CHỐT" : "PHIẾU ĐÃ CHỐT";

  return (
    <Dialog open={preview !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(94dvh,1000px)] max-w-[min(98vw,1120px)] flex-col gap-0 overflow-hidden p-0 sm:rounded-lg">
        <DialogHeader className="border-b border-border bg-card px-4 py-3 text-left sm:px-5">
          <DialogTitle className="text-base">{preview?.draft ? "Bản nháp phiếu lương" : "Phiếu lương đã chốt"}</DialogTitle>
          <DialogDescription className="mt-0.5">
            {preview?.draft
              ? "Bản xem trực tiếp từ snapshot server. Chưa tạo PDF hoặc bản ghi bất biến."
              : "Bản xem trực tiếp từ snapshot bất biến của server; số liệu không được tính lại trên trình duyệt."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/70 p-2 sm:p-5">
          {preview ? <PayslipPaper preview={preview} status={status} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PayslipPaper({ preview, status }: { preview: PayrollStatementOnlinePreview; status: string }) {
  return (
    <article className="mx-auto w-full max-w-[900px] bg-white p-5 text-[#172019] shadow-sm sm:p-8 lg:p-10" aria-label="Phiếu lương xem trực tiếp">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#176b38] pb-4">
        <div className="flex items-center gap-3">
          <img src={vinpokerLogo} alt="VINPOKER" className="h-10 w-10 object-contain" />
          <div>
            <div className="text-xl font-extrabold tracking-wide text-[#0b3b20]">{preview.brand_name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#59675e]"><Building2 className="h-3.5 w-3.5" />{preview.club_name}</div>
          </div>
        </div>
        <div className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-bold ${preview.draft ? "border-[#b7892e] bg-[#fff8e7] text-[#8a5a0a]" : "border-[#4e9d68] bg-[#f2fbf4] text-[#176b38]"}`}>
          <BadgeCheck className="h-4 w-4" /> {status}
        </div>
      </header>

      <div className="py-6 text-center">
        <h2 className="font-serif text-3xl font-bold tracking-wide text-[#101510] sm:text-4xl">PHIẾU LƯƠNG</h2>
        <p className="mt-1 text-lg text-[#313c33]">{preview.period_label}</p>
        <div className="mx-auto mt-2 h-1 w-44 bg-[#176b38]" />
      </div>

      <section className="grid gap-x-10 gap-y-2 border-y border-[#c6d1c8] py-4 text-sm sm:grid-cols-2">
        <Identity icon={UserRound} label="Họ và tên" value={preview.dealer.full_name} />
        <Identity icon={Landmark} label="STK" value={preview.dealer.bank_account_number} />
        <Identity label="Bộ phận" value={preview.dealer.department} />
        <Identity label="Ngân hàng" value={preview.dealer.bank_name} />
        <Identity label="Chức danh" value={preview.dealer.job_title} />
        <Identity icon={CalendarDays} label="Ngày vào làm" value={preview.dealer.hire_date} />
        <Identity label="Mã phiếu" value={shortStatementId(preview.statement_id)} />
        <Identity label="Loại hợp đồng" value={preview.dealer.employment_type} />
      </section>

      <SectionHeading label="I. Thông tin nhân sự" />
      <section className="grid grid-cols-2 border border-[#b9c5bb] sm:grid-cols-4">
        {preview.metrics.map((metric, index) => (
          <div key={metric.label} className={`min-w-0 px-3 py-3 text-center ${index > 0 ? "border-l border-[#d2dcd4]" : ""}`}>
            <div className="text-[11px] text-[#59675e]">{metric.label}</div>
            <div className="mt-1 text-sm font-bold tabular-nums text-[#172019]">{metric.value}</div>
          </div>
        ))}
      </section>

      <SectionHeading label="II. Thu nhập" />
      <PayslipTable
        headers={["STT", "Khoản mục", "Cách tính", "Số lượng", "Đơn giá (đ)", "Thành tiền (đ)"]}
        rows={preview.income_lines.map((line, index) => [String(index + 1), line.label, line.method, line.quantity, line.unit_rate, line.amount])}
      />
      <TotalRow label="TỔNG THU NHẬP" value={preview.gross_amount} />

      <div className="mt-7 grid gap-6 lg:grid-cols-2">
        <section>
          <SectionHeading label="III. Phân đoạn đơn giá" compact />
          <PayslipTable
            headers={["STT", "Khoảng thời gian hiệu lực", "Đơn giá (đ/giờ)", "Giờ công"]}
            rows={preview.rate_segments.map((line, index) => [String(index + 1), line.range, line.unit_rate, line.quantity])}
          />
        </section>
        <section>
          <SectionHeading label="IV. Giảm trừ" compact />
          <PayslipTable
            headers={["STT", "Khoản mục", "Số tiền (đ)"]}
            rows={preview.deduction_lines.map((line, index) => [String(index + 1), line.label, line.amount])}
          />
          <TotalRow label="TỔNG GIẢM TRỪ" value={preview.deduction_amount} />
        </section>
      </div>

      <section className="mt-8 flex flex-wrap items-center justify-between gap-4 border border-[#176b38] bg-[#f7fcf8] px-5 py-4">
        <span className="font-serif text-xl font-bold text-[#172019]">THỰC LĨNH</span>
        <span className="text-3xl font-extrabold tabular-nums text-[#0b5429] sm:text-4xl">{preview.net_amount} đ</span>
      </section>

      <footer className="mt-7 flex flex-wrap justify-between gap-2 border-t border-[#b9c5bb] pt-3 text-[10px] text-[#59675e]">
        <span>{preview.draft ? "Bản xem nháp, chưa tạo phiếu bất biến." : `Ngày chốt: ${preview.finalized_label}`}</span>
        <span>Mã hash: {preview.statement_hash}</span>
      </footer>
    </article>
  );
}

function Identity(props: { icon?: typeof UserRound; label: string; value: string }) {
  const Icon = props.icon;
  return (
    <div className="grid min-w-0 grid-cols-[auto_94px_minmax(0,1fr)] items-baseline gap-x-2">
      {Icon ? <Icon className="h-3.5 w-3.5 text-[#176b38]" aria-hidden="true" /> : <span className="h-3.5 w-3.5" />}
      <span className="font-semibold text-[#313c33]">{props.label}:</span>
      <span className="truncate font-medium text-[#172019]" title={props.value}>{props.value}</span>
    </div>
  );
}

function SectionHeading({ label, compact = false }: { label: string; compact?: boolean }) {
  return <h3 className={`border-b border-[#176b38] font-serif font-bold text-[#0b5429] ${compact ? "mb-2 mt-0 pb-1 text-base" : "mb-3 mt-7 pb-1.5 text-xl"}`}>{label}</h3>;
}

function PayslipTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto border-x border-t border-[#b9c5bb]">
      <table className="w-full min-w-[560px] border-collapse text-[11px]">
        <thead className="bg-[#0b5429] text-white">
          <tr>{headers.map((header) => <th key={header} className="border-r border-[#3a7650] px-2 py-2 text-center font-bold last:border-r-0">{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className={index % 2 ? "bg-[#f6faf6]" : "bg-white"}>
              {row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`} className={`border-b border-r border-[#c9d3cb] px-2 py-2 last:border-r-0 ${cellIndex === 0 ? "text-center" : cellIndex >= row.length - 2 ? "text-right tabular-nums" : ""}`}>{cell}</td>)}
            </tr>
          )) : <tr><td colSpan={headers.length} className="border-b border-[#c9d3cb] px-2 py-3 text-center text-[#59675e]">Không có dòng dữ liệu.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-end gap-8 border border-t-0 border-[#b9c5bb] bg-[#eaf5ec] px-4 py-2 text-sm font-bold text-[#0b5429]"><span>{label}</span><span className="tabular-nums">{value} đ</span></div>;
}

function shortStatementId(statementId: string): string {
  return `PAY-${statementId.slice(0, 8).toUpperCase()}`;
}
