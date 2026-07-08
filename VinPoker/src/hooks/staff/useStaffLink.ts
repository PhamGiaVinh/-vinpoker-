import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { staffDataSource } from "@/lib/staffApp/dataSource";
import { staffKeys } from "@/lib/staffApp/queryKeys";
import { mockStaffMemberships } from "@/lib/staffApp/mockStaffData";
import { setSelectedStaffId, useSelectedStaffId } from "@/lib/staffApp/selectedClub";
import type { StaffDataSource, StaffEmploymentType, StaffProfileView } from "@/types/staffApp";

const db = supabase as unknown as { from: (table: string) => any };

function embeddedName(clubs: any): string {
  if (!clubs) return "";
  return Array.isArray(clubs) ? (clubs[0]?.name ?? "") : (clubs.name ?? "");
}

export interface UseStaffLinkResult {
  staff: StaffProfileView | null;
  memberships: StaffProfileView[];
  selectedStaffId: string | null;
  setSelectedStaffId: (id: string) => void;
  isStaff: boolean;
  loading: boolean;
  source: StaffDataSource;
}

export function useStaffLink(): UseStaffLinkResult {
  const { user, loading: authLoading } = useAuth();
  const source = staffDataSource();
  const selectedId = useSelectedStaffId();

  const q = useQuery({
    queryKey: staffKeys.link(user?.id),
    enabled: !authLoading && (source === "mock" || !!user),
    staleTime: 60_000,
    queryFn: async (): Promise<StaffProfileView[]> => {
      if (source === "mock") return mockStaffMemberships();
      if (!user) return [];

      const { data, error } = await db
        .from("staff")
        .select(
          "id, club_id, user_id, full_name, phone, department, employment_type, monthly_salary_vnd, hourly_rate_vnd, standard_hours_per_shift, status, clubs(name)"
        )
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("full_name");
      if (error) throw error;

      return (data ?? []).map(
        (s: any): StaffProfileView => ({
          staffId: s.id,
          userId: s.user_id,
          clubId: s.club_id,
          clubName: embeddedName(s.clubs),
          fullName: s.full_name,
          phone: s.phone ?? null,
          department: s.department,
          employmentType: (s.employment_type ?? "full_time") as StaffEmploymentType,
          monthlySalaryVnd: s.monthly_salary_vnd ?? null,
          hourlyRateVnd: s.hourly_rate_vnd ?? null,
          standardHoursPerShift: s.standard_hours_per_shift ?? null,
          status: s.status,
        })
      );
    },
  });

  const memberships = q.data ?? [];
  const staff = memberships.find((m) => m.staffId === selectedId) ?? memberships[0] ?? null;

  useEffect(() => {
    if (memberships.length === 0) return;
    if (!selectedId || !memberships.some((m) => m.staffId === selectedId)) {
      setSelectedStaffId(memberships[0].staffId);
    }
  }, [memberships, selectedId]);

  return {
    staff,
    memberships,
    selectedStaffId: staff?.staffId ?? null,
    setSelectedStaffId,
    isStaff: memberships.length > 0,
    loading: authLoading || q.isLoading,
    source,
  };
}

