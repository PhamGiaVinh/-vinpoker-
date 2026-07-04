import { useClubFinanceSummary } from "@/hooks/useClubFinanceSummary";
import { PAYROLL_STATUS_META } from "@/lib/clubFinance";
import { PayrollCostTab, type LivePayrollData } from "../tabs/PayrollCostTab";

const monthStartISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * W4 live wrapper — mounted ONLY when `accountingControlLivePayroll` is ON. Read-only; maps the
 * club finance summary's cost + per-period payroll into the real "Lương" view. Role split +
 * table-hour stay mock inside PayrollCostTab.
 */
export function LivePayrollTab() {
  const from = monthStartISO();
  const to = todayISO();
  const { loading, error, summary } = useClubFinanceSummary({ from, to, clubFilter: "all" });

  const data: LivePayrollData | null = summary
    ? {
        periodLabel: `Tháng này · ${dm(from)} → ${dm(to)}`,
        payrollNet: summary.cost.payrollNet,
        payrollGross: summary.cost.payrollGross,
        adjustments: summary.cost.adjustments,
        unpaidTotal: summary.unpaidTotal,
        reconciledTotal: summary.reconciledTotal,
        perPeriod: summary.perPeriod.map((p) => ({
          periodKey: p.periodKey,
          gross: p.gross,
          net: p.net,
          statusLabel: PAYROLL_STATUS_META[p.status].label,
          statusTone: PAYROLL_STATUS_META[p.status].tone,
        })),
      }
    : null;

  return <PayrollCostTab live={{ active: true, loading, error, data }} />;
}
