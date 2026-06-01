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

export interface PayrollAdjustmentRow {
  id: string;
  payroll_id: string;
  adjustment_type: string;
  amount_vnd: number;
  reason: string;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
}

export interface SavedPayrollRecord {
  id: string;
  dealer_id: string;
  club_id: string;
  period_id: string;
  employment_type: string;
  monthly_salary_vnd: number | null;
  hourly_rate_vnd: number | null;
  ot_multiplier: number | null;
  total_shifts: number | null;
  total_hours: number | null;
  regular_hours: number | null;
  ot_hours: number | null;
  base_salary_vnd: number | null;
  regular_pay_vnd: number | null;
  ot_pay_vnd: number | null;
  gross_pay_vnd: number | null;
  total_adjustments_vnd: number | null;
  net_pay_vnd: number | null;
  status: string | null;
  calculated_at: string | null;
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
      const allRows = Object.values(result.dealers ?? {});
      // Filter out error objects (inactive dealers return {error: "..."})
      const dealerRows = allRows.filter((r: any) => r.dealer_id && r.full_name) as DealerPayrollRow[];
      // Sort: FT first, then PT; within each group by name
      dealerRows.sort((a, b) => {
        if (a.employment_type !== b.employment_type) {
          return a.employment_type === "full_time" ? -1 : 1;
        }
        return (a.full_name || "").localeCompare(b.full_name || "");
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

// ── Save / Approve helpers ────────────────────────────────────────────────────

/**
 * Save payroll to DB: creates/gets payroll_period, then upserts dealer_payroll rows.
 * Returns the period_id.
 */
export async function savePayroll(
  clubId: string,
  year: number,
  month: number,
  payrollRows: DealerPayrollRow[],
  userId: string
): Promise<{ periodId: string; savedCount: number }> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

  // 1. Upsert payroll_period
  const { data: periodData, error: periodError } = await supabase
    .from("payroll_periods")
    .upsert(
      { club_id: clubId, period_year: year, period_month: month, period_start: startDate, period_end: endDate, status: "draft" },
      { onConflict: "club_id,period_year,period_month" }
    )
    .select("id")
    .single();
  if (periodError) throw periodError;
  const periodId = periodData.id;

  // 2. Upsert dealer_payroll rows
  const rows = payrollRows.map((r) => ({
    dealer_id: r.dealer_id,
    club_id: clubId,
    period_id: periodId,
    employment_type: r.employment_type,
    monthly_salary_vnd: r.monthly_salary_vnd || null,
    hourly_rate_vnd: r.hourly_rate_vnd || null,
    ot_multiplier: r.ot_multiplier || null,
    total_shifts: r.total_shifts,
    total_hours: r.total_hours,
    regular_hours: r.regular_hours,
    ot_hours: r.ot_hours,
    base_salary_vnd: r.base_salary_vnd,
    regular_pay_vnd: r.regular_pay_vnd,
    ot_pay_vnd: r.ot_pay_vnd,
    gross_pay_vnd: r.gross_pay_vnd,
    net_pay_vnd: r.net_pay_vnd,
    status: "draft",
    calculated_by: userId,
  }));

  // Delete existing rows for this period first (to handle updates)
  const { error: delError } = await supabase
    .from("dealer_payroll")
    .delete()
    .eq("period_id", periodId);
  if (delError) throw delError;

  const { error: insertError } = await supabase
    .from("dealer_payroll")
    .insert(rows);
  if (insertError) throw insertError;

  return { periodId, savedCount: rows.length };
}

/**
 * Add a payroll adjustment to a saved dealer_payroll record.
 */
export async function addPayrollAdjustment(
  payrollId: string,
  adjustmentType: string,
  amountVnd: number,
  reason: string,
  createdBy: string
): Promise<PayrollAdjustmentRow> {
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
  return data as PayrollAdjustmentRow;
}

/**
 * Load saved payroll adjustments for a given period.
 * Returns map of dealer_id → PayrollAdjustmentRow[]
 */
export async function loadPayrollAdjustments(
  periodId: string
): Promise<Record<string, PayrollAdjustmentRow[]>> {
  const { data, error } = await supabase
    .from("dealer_payroll")
    .select("id, dealer_id, payroll_adjustments:id(*)")
    .eq("period_id", periodId);
  if (error) throw error;

  const map: Record<string, PayrollAdjustmentRow[]> = {};
  for (const row of (data ?? []) as any[]) {
    map[row.dealer_id] = row.payroll_adjustments ?? [];
  }
  return map;
}

/**
 * Get saved payroll records for a period.
 */
export async function getSavedPayroll(
  clubId: string,
  year: number,
  month: number
): Promise<{ periodId: string | null; records: SavedPayrollRecord[] }> {
  const { data: periods } = await supabase
    .from("payroll_periods")
    .select("id")
    .eq("club_id", clubId)
    .eq("period_year", year)
    .eq("period_month", month)
    .maybeSingle();

  if (!periods) return { periodId: null, records: [] };

  const { data: records, error } = await supabase
    .from("dealer_payroll")
    .select("*")
    .eq("period_id", periods.id);
  if (error) throw error;

  return { periodId: periods.id, records: (records ?? []) as SavedPayrollRecord[] };
}

/**
 * Delete a payroll adjustment.
 */
export async function deletePayrollAdjustment(
  adjustmentId: string
): Promise<void> {
  const { error } = await supabase
    .from("payroll_adjustments")
    .delete()
    .eq("id", adjustmentId);
  if (error) throw error;
}