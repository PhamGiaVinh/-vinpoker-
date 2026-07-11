import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { mockSalaryClubs, mockSalaryMonth } from "@/lib/staffSalary/mockSalary";
import type {
  SalaryClub,
  SalaryMonthView,
  SalaryPeriodStatus,
  SalaryRow,
  StaffSalarySource,
} from "@/lib/staffSalary/types";

const db = supabase as unknown as { from: (table: string) => any };
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

function mapRow(r: any, locked: boolean): SalaryRow {
  return {
    staffId: r.staff_id,
    fullName: r.full_name ?? "",
    department: r.department ?? "",
    employmentType: (r.employment_type ?? "full_time") as SalaryRow["employmentType"],
    workedDays: r.worked_days ?? null,
    workedMinutes: r.worked_minutes ?? null,
    grossVnd: Number(r.gross_vnd ?? 0),
    manualBhxhVnd: Number(r.manual_bhxh_vnd ?? 0),
    manualTaxVnd: Number(r.manual_tax_vnd ?? 0),
    netVnd: Number(r.net_vnd ?? 0),
    alreadyLocked: locked ? undefined : Boolean(r.already_locked),
    runId: locked ? (r.id ?? r.run_id ?? null) : null,
    status: locked ? (r.status ?? null) : null,
  };
}

export function useSalaryClubs(source: StaffSalarySource, enabled: boolean) {
  const { user, loading: authLoading, isAdmin, isClubAdmin } = useAuth();
  return useQuery({
    queryKey: ["staffSalary", "clubs", source, user?.id ?? "anon"],
    enabled: enabled && !authLoading && (source === "mock" || !!user),
    staleTime: 60_000,
    queryFn: async (): Promise<SalaryClub[]> => {
      if (source === "mock") return mockSalaryClubs();
      if (!user) return [];
      if (isAdmin || isClubAdmin) {
        const { data, error } = await db.from("clubs").select("id,name").order("name").limit(50);
        if (error) throw error;
        return (data ?? []).map((c: any) => ({ id: c.id, name: c.name ?? c.id, role: "admin" as const }));
      }
      const [{ data: owned, error: e1 }, { data: acctRows, error: e2 }] = await Promise.all([
        db.from("clubs").select("id,name").eq("owner_id", user.id),
        db.from("club_accountants").select("club_id").eq("user_id", user.id),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const clubs = new Map<string, SalaryClub>();
      for (const c of owned ?? []) clubs.set(c.id, { id: c.id, name: c.name ?? c.id, role: "owner" });
      const acctIds = (acctRows ?? [])
        .map((r: any) => r.club_id)
        .filter(Boolean)
        .filter((id: string) => !clubs.has(id));
      if (acctIds.length) {
        const { data: acctClubs, error } = await db.from("clubs").select("id,name").in("id", acctIds);
        if (error) throw error;
        for (const c of acctClubs ?? []) clubs.set(c.id, { id: c.id, name: c.name ?? c.id, role: "accountant" });
      }
      return Array.from(clubs.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export function useStaffSalaryMonth(
  source: StaffSalarySource,
  clubId: string | null,
  year: number,
  month: number,
) {
  return useQuery({
    queryKey: ["staffSalary", "month", source, clubId ?? "", year, month],
    enabled: !!clubId,
    staleTime: 20_000,
    queryFn: async (): Promise<SalaryMonthView> => {
      if (!clubId) return mockSalaryMonth("", year, month);
      if (source === "mock") return mockSalaryMonth(clubId, year, month);

      const { data: rep, error: e1 } = await rpc("get_staff_salary_report", {
        p_club_id: clubId,
        p_year: year,
        p_month: month,
      });
      if (e1) throw e1;
      const header = rep?.header ?? {};
      const lockedRows: SalaryRow[] = Array.isArray(rep?.rows) ? rep.rows.map((r: any) => mapRow(r, true)) : [];

      let previewRows: SalaryRow[] = [];
      if (lockedRows.length === 0) {
        const { data: prev, error: e2 } = await rpc("get_staff_salary_month", {
          p_club_id: clubId,
          p_year: year,
          p_month: month,
        });
        if (e2) throw e2;
        previewRows = Array.isArray(prev?.staff) ? prev.staff.map((r: any) => mapRow(r, false)) : [];
      }

      return {
        clubId,
        year,
        month,
        standardShifts: Number(rep?.standard_shifts_per_month ?? 26),
        status: (header.status ?? "prepared") as SalaryPeriodStatus,
        submittedAt: header.submitted_at ?? null,
        approvedAt: header.approved_at ?? null,
        rejectedReason: header.rejected_reason ?? null,
        hasRuns: lockedRows.length > 0,
        lockedRows,
        previewRows,
        totalGrossVnd: Number(rep?.total_gross_vnd ?? previewRows.reduce((s, r) => s + r.grossVnd, 0)),
        totalNetVnd: Number(rep?.total_net_vnd ?? previewRows.reduce((s, r) => s + r.netVnd, 0)),
      };
    },
  });
}

/** Chốt → gửi → duyệt/từ chối → đánh dấu trả. Live only; mock shows an info toast. */
export function useSalaryActions(
  source: StaffSalarySource,
  clubId: string | null,
  year: number,
  month: number,
) {
  const qc = useQueryClient();
  const key = ["staffSalary", "month", source, clubId ?? "", year, month];
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const guardMock = (): boolean => {
    if (source === "mock") {
      toast.info("Preview mock — bật cờ staffSalaryChot để chạy thật.");
      return true;
    }
    return false;
  };

  const run = async (fn: string, args: Record<string, unknown>, okMsg: string) => {
    const { data, error } = await rpc(fn, args);
    if (error) throw error;
    if (data?.error) throw new Error(data.detail ?? data.error);
    toast.success(okMsg);
    invalidate();
    return data;
  };

  const chot = useMutation({
    mutationFn: async () => {
      if (guardMock() || !clubId) return null;
      return run("chot_staff_salary_month", { p_club_id: clubId, p_year: year, p_month: month }, "Đã chốt lương tháng.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Không chốt được."),
  });

  const submit = useMutation({
    mutationFn: async (note?: string) => {
      if (guardMock() || !clubId) return null;
      return run(
        "submit_staff_salary_month",
        { p_club_id: clubId, p_year: year, p_month: month, p_note: note ?? null },
        "Đã gửi báo cáo cho chủ CLB.",
      );
    },
    onError: (e: any) => toast.error(e?.message ?? "Không gửi được."),
  });

  const approve = useMutation({
    mutationFn: async () => {
      if (guardMock() || !clubId) return null;
      return run("approve_staff_salary_month", { p_club_id: clubId, p_year: year, p_month: month }, "Đã duyệt bảng lương.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Không duyệt được."),
  });

  const reject = useMutation({
    mutationFn: async (reason?: string) => {
      if (guardMock() || !clubId) return null;
      return run(
        "reject_staff_salary_month",
        { p_club_id: clubId, p_year: year, p_month: month, p_reason: reason ?? null },
        "Đã từ chối bảng lương.",
      );
    },
    onError: (e: any) => toast.error(e?.message ?? "Không từ chối được."),
  });

  const markPaid = useMutation({
    mutationFn: async (runId: string) => {
      if (guardMock()) return null;
      return run(
        "mark_staff_salary_paid",
        { p_run_id: runId, p_payment_method: "cash", p_payment_reference: null },
        "Đã đánh dấu đã trả.",
      );
    },
    onError: (e: any) => toast.error(e?.message ?? "Không đánh dấu được."),
  });

  return { chot, submit, approve, reject, markPaid };
}
