import { useMemo, useState } from "react";
import { CalendarRange, FileText } from "lucide-react";
import {
  FtPayrollStatementActions,
  FtPayrollStatementBadge,
  FtPayrollStatementSummary,
} from "@/components/cashier/FtPayrollStatementControls";
import type { useFtPayrollStatements } from "@/hooks/useFtPayrollStatements";
import type { FtPayrollStatementStatus, PayrollStatementOnlinePreview } from "@/lib/payrollStatementUi";

type Controller = ReturnType<typeof useFtPayrollStatements>;

const DEALERS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Nguyễn Minh Anh", net: "17.726.250 đ" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Phạm Gia Vinh", net: "12.400.000 đ" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Trần Thảo My", net: "9.850.000 đ" },
];

const PREVIEW: PayrollStatementOnlinePreview = {
  statement_id: DEALERS[0].id,
  statement_hash: "a".repeat(64),
  draft: true,
  brand_name: "VINPOKER",
  club_name: "HSOP",
  period_label: "Tháng 08/2026",
  dealer: {
    full_name: DEALERS[0].name,
    department: "Dealer",
    job_title: "Dealer poker tournament",
    bank_account_number: "0338356589",
    bank_name: "VPBank",
    hire_date: "15/04/2024",
    employment_type: "Chính thức",
  },
  metrics: [
    { label: "Ngày công chuẩn", value: "27 ngày" },
    { label: "Tổng giờ công", value: "168,5 giờ" },
    { label: "Tổng giờ OT", value: "44,5 giờ" },
    { label: "Đơn giá cơ bản", value: "100.000 đ/giờ" },
  ],
  income_lines: [
    { label: "Giờ thường", method: "Giờ công", quantity: "124 giờ", unit_rate: "100.000", amount: "12.400.000" },
    { label: "OT 150%", method: "Theo snapshot", quantity: "20 giờ", unit_rate: "150.000", amount: "3.000.000" },
    { label: "Phụ cấp ăn", method: "Theo quy định", quantity: "27 ngày", unit_rate: "80.000", amount: "2.160.000" },
  ],
  rate_segments: [
    { range: "01/08/2026 - 15/08/2026", unit_rate: "95.000", quantity: "72 giờ" },
    { range: "16/08/2026 - 31/08/2026", unit_rate: "100.000", quantity: "96,5 giờ" },
  ],
  deduction_lines: [
    { label: "Tạm ứng", amount: "5.000.000" },
    { label: "Thuế TNCN", amount: "2.500.000" },
  ],
  gross_amount: "25.726.250",
  deduction_amount: "8.000.000",
  net_amount: "17.726.250",
  finalized_label: "31/08/2026",
};

export default function PayrollStatementPreview() {
  const [statuses, setStatuses] = useState<Record<string, FtPayrollStatementStatus>>({
    [DEALERS[0].id]: "DRAFT",
    [DEALERS[1].id]: "FINALIZED",
    [DEALERS[2].id]: "PDF_READY",
  });

  const controller = useMemo(() => ({
    availability: "ready" as const,
    error: null,
    records: {},
    counts: {
      draft: Object.values(statuses).filter((value) => value === "DRAFT").length,
      finalized: Object.values(statuses).filter((value) => value === "FINALIZED" || value === "PDF_FAILED").length,
      generating: Object.values(statuses).filter((value) => value === "PDF_GENERATING").length,
      ready: Object.values(statuses).filter((value) => value === "PDF_READY").length,
    },
    statusFor: (dealerId: string) => statuses[dealerId] ?? "UNKNOWN",
    refresh: async () => undefined,
    finalize: async (dealerId: string) => {
      setStatuses((current) => ({ ...current, [dealerId]: "FINALIZED" }));
      return true;
    },
    previewDraft: async () => PREVIEW,
    previewFinal: async () => ({ ...PREVIEW, draft: false, filename: "phieu-luong-da-chot.pdf" }),
    generatePdf: async (dealerId: string) => {
      setStatuses((current) => ({ ...current, [dealerId]: "PDF_READY" }));
      return true;
    },
    canFinalize: true,
  }), [statuses]) as Controller;

  return (
    <main className="min-h-screen bg-background px-3 py-5 text-foreground sm:px-6" data-testid="payroll-statement-preview">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-success">
              <FileText className="h-4 w-4" /> Phiếu lương FT
            </div>
            <h1 className="text-xl font-semibold sm:text-2xl">HSOP · Tháng 08/2026</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarRange className="h-4 w-4" /> Kỳ lương đã khóa
          </div>
        </header>

        <FtPayrollStatementSummary controller={controller} totalDealers={DEALERS.length} />

        <section className="mt-4 overflow-hidden border-y border-border" aria-label="Danh sách phiếu lương FT">
          <div className="hidden grid-cols-[minmax(180px,1fr)_140px_160px_52px] bg-muted/50 px-3 py-2 text-[11px] uppercase text-muted-foreground md:grid">
            <span>Dealer</span><span>Trạng thái</span><span className="text-right">Thực lãnh</span><span />
          </div>
          {DEALERS.map((dealer) => (
            <div
              key={dealer.id}
              className="grid min-h-16 grid-cols-[minmax(0,1fr)_44px] items-center gap-2 border-t border-border px-2 py-3 first:border-t-0 md:grid-cols-[minmax(180px,1fr)_140px_160px_52px] md:px-3"
              data-testid={`payroll-row-${dealer.id}`}
              data-statement-status={controller.statusFor(dealer.id)}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{dealer.name}</div>
                <div className="mt-1 md:hidden"><FtPayrollStatementBadge controller={controller} dealerId={dealer.id} /></div>
              </div>
              <div className="hidden md:block"><FtPayrollStatementBadge controller={controller} dealerId={dealer.id} /></div>
              <div className="hidden text-right font-mono text-sm font-semibold text-success md:block">{dealer.net}</div>
              <FtPayrollStatementActions
                controller={controller}
                dealerId={dealer.id}
                dealerName={dealer.name}
                clubName="HSOP"
                periodLabel="Tháng 08/2026"
              />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
