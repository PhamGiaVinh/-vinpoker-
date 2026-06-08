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
  standard_shifts_per_month: number;
  total_shifts: number;
  total_hours: number;
  regular_hours: number;
  ot_hours: number;
  base_salary_vnd: number;
  regular_pay_vnd: number;
  ot_pay_vnd: number;
  gross_pay_vnd: number;
  total_adjustments_vnd: number;
  tips_amount_vnd: number;
  bhxh_deduction_vnd: number;
  bhyt_deduction_vnd: number;
  bhtn_deduction_vnd: number;
  pit_deduction_vnd: number;
  net_pay_vnd: number;
  net_pay_after_tax_vnd: number;
  shifts: Array<{
    attendance_id: string;
    check_in_time: string;
    check_out_time: string | null;
    total_worked_minutes: number;
    overtime_minutes: number;
    regular_minutes: number;
    shift_hours: number;
    regular_hours: number;
    ot_hours: number;
    is_overnight: boolean;
  }>;
}

export interface ClubPayrollResult {
  club_id: string;
  period_start: string;
  period_end: string;
  standard_shifts_per_month: number;
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
  tips_amount_vnd: number | null;
  bhxh_deduction_vnd: number | null;
  bhyt_deduction_vnd: number | null;
  bhtn_deduction_vnd: number | null;
  pit_deduction_vnd: number | null;
  net_pay_vnd: number | null;
  net_pay_after_tax_vnd: number | null;
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
 * Save payroll to DB via transaction-safe RPC.
 * Replaces old 3-call sequence (upsert + delete + insert).
 * Uses ON CONFLICT (period_id, dealer_id) DO UPDATE so adjustments are preserved.
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

  const { data: periodId, error } = await supabase.rpc("save_payroll_period", {
    p_club_id: clubId,
    p_year: year,
    p_month: month,
    p_start_date: startDate,
    p_end_date: endDate,
    p_payroll_rows: payrollRows,
    p_user_id: userId,
  });

  if (error) throw error;
  return { periodId, savedCount: payrollRows.length };
}

/**
 * Submit payroll period for approval (draft → submitted).
 */
export async function submitPayroll(
  periodId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("transition_payroll_status", {
    p_period_id: periodId,
    p_expected_status: "draft",
    p_new_status: "submitted",
    p_user_id: userId,
  });
  if (error) throw error;
  return data as boolean;
}

/**
 * Approve payroll period (submitted → approved).
 */
export async function approvePayroll(
  periodId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("transition_payroll_status", {
    p_period_id: periodId,
    p_expected_status: "submitted",
    p_new_status: "approved",
    p_user_id: userId,
  });
  if (error) throw error;
  return data as boolean;
}

/**
 * Lock payroll period (approved → locked). No more edits allowed.
 */
export async function lockPayroll(
  periodId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("transition_payroll_status", {
    p_period_id: periodId,
    p_expected_status: "approved",
    p_new_status: "locked",
    p_user_id: userId,
  });
  if (error) throw error;
  return data as boolean;
}

/**
 * Reject payroll period (submitted → rejected). Records rejecter + reason.
 */
export async function rejectPayroll(
  periodId: string,
  userId: string,
  reason: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("transition_payroll_status", {
    p_period_id: periodId,
    p_expected_status: "submitted",
    p_new_status: "rejected",
    p_user_id: userId,
    p_rejection_reason: reason,
  });
  if (error) throw error;
  return data as boolean;
}

/**
 * Resubmit rejected payroll (rejected → draft). Clears reject metadata.
 */
export async function resubmitPayroll(
  periodId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("transition_payroll_status", {
    p_period_id: periodId,
    p_expected_status: "rejected",
    p_new_status: "draft",
    p_user_id: userId,
  });
  if (error) throw error;
  return data as boolean;
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
 * Get saved payroll records for a period, including status.
 */
export async function getSavedPayroll(
  clubId: string,
  year: number,
  month: number
): Promise<{
  periodId: string | null;
  status: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  records: SavedPayrollRecord[];
}> {
  const { data: period } = await supabase
    .from("payroll_periods")
    .select("id, status, submitted_by, submitted_at, approved_by, approved_at, locked_by, locked_at, rejected_by, rejected_at, rejection_reason")
    .eq("club_id", clubId)
    .eq("period_year", year)
    .eq("period_month", month)
    .maybeSingle();

  if (!period) {
    return {
      periodId: null,
      status: null,
      submittedBy: null,
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
      lockedBy: null,
      lockedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      records: [],
    };
  }

  const { data: records, error } = await supabase
    .from("dealer_payroll")
    .select("*")
    .eq("period_id", period.id);
  if (error) throw error;

  return {
    periodId: period.id,
    status: period.status,
    submittedBy: period.submitted_by,
    submittedAt: period.submitted_at,
    approvedBy: period.approved_by,
    approvedAt: period.approved_at,
    lockedBy: period.locked_by,
    lockedAt: period.locked_at,
    rejectedBy: period.rejected_by,
    rejectedAt: period.rejected_at,
    rejectionReason: period.rejection_reason,
    records: (records ?? []) as SavedPayrollRecord[],
  };
}

/**
 * Get audit log for a period.
 */
export async function getPayrollAuditLog(
  periodId: string,
  limit: number = 100
): Promise<any[]> {
  const { data, error } = await supabase.rpc("get_payroll_audit_log", {
    p_period_id: periodId,
    p_limit: limit,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Get audit log for a payroll period.
 */
async function getAuditLog(
  periodId: string,
  limit = 100
): Promise<Array<{
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  old_values: any;
  new_values: any;
  changed_by: string | null;
  changed_at: string;
}>> {
  const { data, error } = await supabase.rpc("get_payroll_audit_log", {
    p_period_id: periodId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as any[];
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