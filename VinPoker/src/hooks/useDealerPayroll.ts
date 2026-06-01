import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DealerPayrollRow {
  dealer_id: string;
  full_name: string;
  employment_type: "full_time" | "part_time";
  monthly_salary_vnd: number;
  hourly_rate_vnd: number;
  standard_hours_per_shift: number;
  ot_multiplier: number;
  total_shifts: number;
  total_hours: number;
  regular_hours: number;
  ot_hours: number;
  base_salary_vnd: number;
  regular_pay_vnd: number;
  ot_pay_vnd: number;
  gross_pay_vnd: number;
  total_adjustments_vnd: number;
  net_pay_vnd: number;
  shifts: Array<{
    attendance_id: string;
    check_in_time: string;
    check_out_time: string | null;
    total_worked_minutes: number;
    overtime_minutes: number;
    regular_minutes: number;
  }>;
}

export interface ClubPayrollResult {
  club_id: string;
  period_start: string;
  period_end: string;
  dealers: Record<string, DealerPayrollRow>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDealerPayroll(clubIds: string[]): {
  data: DealerPayrollRow[];
  period: { start: string; end: string };
  loading: boolean;
  error: string | null;
  fetchPayroll: (clubId: string, start: string, end: string) => Promise<void>;
} {
  const [rows, setRows] = useState<DealerPayrollRow[]>([]);
  const [period, setPeriod] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPayroll = useCallback(async (clubId: string, start: string, end: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("calculate_club_payroll", {
        p_club_id: clubId,
        p_start_date: start,
        p_end_date: end,
      });
      if (rpcError) throw rpcError;
      const result = data as ClubPayrollResult;
      setPeriod({ start: result.period_start, end: result.period_end });
      const dealerRows = Object.values(result.dealers ?? {});
      // Sort: FT first, then PT; within each group by name
      dealerRows.sort((a, b) => {
        if (a.employment_type !== b.employment_type) {
          return a.employment_type === "full_time" ? -1 : 1;
        }
        return a.full_name.localeCompare(b.full_name);
      });
      setRows(dealerRows);
    } catch (e: any) {
      setError(e?.message ?? "Lỗi tính lương");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { data: rows, period, loading, error, fetchPayroll };
}

// ── Adjustments ──────────────────────────────────────────────────────────────

export interface PayrollAdjustment {
  id: string;
  payroll_id: string;
  adjustment_type: string;
  amount_vnd: number;
  reason: string;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
}

export async function addPayrollAdjustment(
  payrollId: string,
  adjustmentType: string,
  amountVnd: number,
  reason: string,
  createdBy: string
): Promise<PayrollAdjustment | null> {
  const { data, error } = await supabase
    .from("payroll_adjustments")
    .insert({
      payroll_id: payrollId,
      adjustment_type: adjustmentType,
      amount_vnd: amountVnd,
      reason,
      created_by: createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PayrollAdjustment;
}