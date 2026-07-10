import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { staffDataSource } from "@/lib/staffApp/dataSource";
import { staffKeys } from "@/lib/staffApp/queryKeys";
import { readMockSalary } from "@/lib/staffApp/mockStaffData";
import type { StaffProfileView, StaffSalaryView } from "@/types/staffApp";

const rpcClient = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

function mapSalary(raw: any, profile: StaffProfileView): StaffSalaryView {
  const r = raw ?? {};
  return {
    staffId: profile.staffId,
    employmentType: (r.employment_type as StaffSalaryView["employmentType"]) ?? profile.employmentType,
    hourlyRateVnd: Number(r.hourly_rate_vnd ?? profile.hourlyRateVnd ?? 0),
    accruedMinutes: Number(r.accrued_minutes ?? 0),
    balanceVnd: Number(r.balance_vnd ?? 0),
    lastResetAt: r.last_reset_at ?? null,
    currentShiftOpen: Boolean(r.current_shift_open),
    currentShiftStart: r.current_shift_start ?? null,
    monthlySalaryVnd: r.monthly_salary_vnd ?? profile.monthlySalaryVnd ?? null,
    recentPayments: Array.isArray(r.recent_payments)
      ? r.recent_payments.map((p: any) => ({
          id: String(p.id),
          amountVnd: Number(p.amount_vnd ?? 0),
          minutesPaid: Number(p.minutes_paid ?? 0),
          paidAt: p.paid_at,
          coveredFrom: p.covered_from ?? null,
          coveredTo: p.covered_to ?? null,
          paymentMethod: p.payment_method ?? null,
          paymentReference: p.payment_reference ?? null,
        }))
      : [],
  };
}

/**
 * Read-only "Lương của tôi" data for the signed-in staff member. Live source calls the
 * SECURITY DEFINER RPC get_my_staff_salary (self-scoped, binds auth.uid() via staff.user_id);
 * mock source (staffApp flag OFF) returns preview data. Never writes.
 */
export function useStaffSalary(profile: StaffProfileView | null) {
  const source = staffDataSource();
  const q = useQuery({
    queryKey: staffKeys.salary(profile?.staffId ?? undefined),
    enabled: !!profile,
    staleTime: 20_000,
    queryFn: async (): Promise<StaffSalaryView | null> => {
      if (!profile) return null;
      if (source === "mock") return readMockSalary(profile);
      const { data, error } = await rpcClient.rpc("get_my_staff_salary", { p_staff_id: profile.staffId });
      if (error) throw error;
      return mapSalary(data, profile);
    },
  });

  return { ...q, salary: q.data ?? null };
}
