import { describe, expect, it } from "vitest";
import { buildPayrollPreviewHtml } from "@/lib/exportPayrollPdf";
import type { DealerPayrollRow } from "@/hooks/useDealerPayroll";

const row: DealerPayrollRow = {
  dealer_id: "11111111-1111-4111-8111-111111111111",
  full_name: "<script>not-a-name</script>",
  employment_type: "part_time",
  monthly_salary_vnd: 0,
  hourly_rate_vnd: 50_000,
  standard_hours_per_shift: 8,
  ot_multiplier: 1.5,
  standard_shifts_per_month: 26,
  total_shifts: 3,
  total_hours: 24,
  regular_hours: 24,
  ot_hours: 0,
  base_salary_vnd: 0,
  regular_pay_vnd: 1_200_000,
  ot_pay_vnd: 0,
  gross_pay_vnd: 1_200_000,
  total_adjustments_vnd: 0,
  tips_amount_vnd: 0,
  bhxh_deduction_vnd: 0,
  bhyt_deduction_vnd: 0,
  bhtn_deduction_vnd: 0,
  pit_deduction_vnd: 0,
  net_pay_vnd: 1_200_000,
  net_pay_after_tax_vnd: 1_200_000,
  shifts: [],
};

describe("legacy payroll preview", () => {
  it("uses a complete A4 Times-style payslip and escapes staff values", () => {
    const html = buildPayrollPreviewHtml([row], "<b>HSOP</b>", "Tháng 08/2026", row.dealer_id);

    expect(html).toContain("background: #fff");
    expect(html).toContain("width: 210mm");
    expect(html).toContain("min-height: 297mm");
    expect(html).toContain('font-family: "Times New Roman", Times, serif');
    expect(html).toContain("border: 1px solid #b9c5bb");
    expect(html).toContain("BẢN TẠM TÍNH");
    expect(html).toContain("payroll-brand__lockup");
    expect(html).toContain("payroll-table--single");
    expect(html).toContain("THỰC LĨNH");
    expect(html).not.toContain("<th>Tên</th>");
    expect(html).not.toContain("Arial, Helvetica, sans-serif; font-size: 13px");
    expect(html).toContain("&lt;script&gt;not-a-name&lt;/script&gt;");
    expect(html).not.toContain("<script>not-a-name</script>");
    expect(html).toContain("&lt;b&gt;HSOP&lt;/b&gt;");
  });
});
