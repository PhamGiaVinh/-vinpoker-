import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { StaffDepartment, StaffEmploymentType } from "@/types/staffApp";

const db = supabase as unknown as { from: (table: string) => any };
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

export interface DirectoryStaff {
  id: string;
  fullName: string;
  phone: string | null;
  department: StaffDepartment;
  employmentType: StaffEmploymentType;
  monthlySalaryVnd: number | null;
  hourlyRateVnd: number | null;
  standardHoursPerShift: number | null;
  manualBhxhVnd: number | null;
  manualTaxVnd: number | null;
  status: string;
  userId: string | null;
}

export interface StaffUpsertInput {
  staffId?: string | null;
  fullName: string;
  phone?: string | null;
  department: StaffDepartment;
  employmentType: StaffEmploymentType;
  monthlySalaryVnd?: number | null;
  hourlyRateVnd?: number | null;
  standardHoursPerShift?: number | null;
  manualBhxhVnd?: number | null;
  manualTaxVnd?: number | null;
  status: "active" | "inactive";
}

export interface LinkCandidate {
  userId: string;
  displayName: string;
  phoneMasked: string | null;
}

/** Directory list — reads the staff table (RLS: operator today; accountant via 20261236000000). */
export function useStaffDirectory(clubId: string | null) {
  const q = useQuery({
    queryKey: ["accountant", "staffDirectory", clubId ?? ""],
    enabled: !!clubId,
    staleTime: 30_000,
    queryFn: async (): Promise<DirectoryStaff[]> => {
      const { data, error } = await db
        .from("staff")
        .select(
          "id, full_name, phone, department, employment_type, monthly_salary_vnd, hourly_rate_vnd, standard_hours_per_shift, manual_bhxh_vnd, manual_tax_vnd, status, user_id"
        )
        .eq("club_id", clubId)
        .is("deleted_at", null)
        .order("department")
        .order("full_name");
      if (error) throw error;
      return (data ?? []).map(
        (s: any): DirectoryStaff => ({
          id: s.id,
          fullName: s.full_name,
          phone: s.phone ?? null,
          department: s.department,
          employmentType: (s.employment_type ?? "full_time") as StaffEmploymentType,
          monthlySalaryVnd: s.monthly_salary_vnd ?? null,
          hourlyRateVnd: s.hourly_rate_vnd ?? null,
          standardHoursPerShift: s.standard_hours_per_shift ?? null,
          manualBhxhVnd: s.manual_bhxh_vnd ?? null,
          manualTaxVnd: s.manual_tax_vnd ?? null,
          status: s.status,
          userId: s.user_id ?? null,
        })
      );
    },
  });
  return { ...q, staff: q.data ?? [] };
}

/** Create/update a staff profile via the staff_upsert RPC (server validates + authorizes). */
export function useStaffUpsert(clubId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StaffUpsertInput) => {
      if (!clubId) throw new Error("Chưa chọn CLB.");
      const { data, error } = await rpc("staff_upsert", {
        p_club_id: clubId,
        p_full_name: input.fullName,
        p_department: input.department,
        p_employment_type: input.employmentType,
        p_staff_id: input.staffId ?? null,
        p_phone: input.phone || null,
        p_monthly_salary_vnd: input.monthlySalaryVnd ?? null,
        p_hourly_rate_vnd: input.hourlyRateVnd ?? null,
        p_standard_hours_per_shift: input.standardHoursPerShift ?? null,
        p_manual_bhxh_vnd: input.manualBhxhVnd ?? null,
        p_manual_tax_vnd: input.manualTaxVnd ?? null,
        p_status: input.status,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.detail ?? data.error);
      return data;
    },
    onSuccess: (_d, input) => {
      toast.success(input.staffId ? "Đã cập nhật nhân viên." : "Đã thêm nhân viên.");
      qc.invalidateQueries({ queryKey: ["accountant", "staffDirectory", clubId ?? ""] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Không lưu được nhân viên."),
  });
}

/**
 * Minimal masked account lookup via search_staff_link_candidates — the UI never queries
 * the profiles table directly (review P0-2). Server enforces >=2 chars + cap 10.
 */
export function useLinkCandidates(clubId: string | null, query: string) {
  const trimmed = query.trim();
  const q = useQuery({
    queryKey: ["accountant", "linkCandidates", clubId ?? "", trimmed],
    enabled: !!clubId && trimmed.length >= 2,
    staleTime: 15_000,
    queryFn: async (): Promise<LinkCandidate[]> => {
      const { data, error } = await rpc("search_staff_link_candidates", {
        p_club_id: clubId,
        p_query: trimmed,
        p_limit: 10,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.detail ?? data.error);
      return (Array.isArray(data) ? data : []).map((r: any) => ({
        userId: r.user_id,
        displayName: r.display_name ?? "Không tên",
        phoneMasked: r.phone_masked ?? null,
      }));
    },
  });
  return { ...q, candidates: q.data ?? [] };
}

/** Link an auth account to a staff profile (first-link-wins; server is the arbiter). */
export function useStaffLinkUser(clubId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ staffId, userId }: { staffId: string; userId: string }) => {
      const { data, error } = await rpc("staff_link_user", { p_staff_id: staffId, p_user_id: userId });
      if (error) throw error;
      if (data?.error) throw new Error(data.detail ?? data.error);
      return data as { status: "ok" | "already_linked"; user_id?: string };
    },
    onSuccess: (data) => {
      if (data?.status === "already_linked") {
        toast.warning("Hồ sơ đã liên kết với tài khoản khác — chỉ chủ CLB xử lý gỡ liên kết.");
      } else {
        toast.success("Đã liên kết tài khoản cho nhân viên.");
      }
      qc.invalidateQueries({ queryKey: ["accountant", "staffDirectory", clubId ?? ""] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Không liên kết được."),
  });
}
