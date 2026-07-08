import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { staffDataSource } from "@/lib/staffApp/dataSource";
import { staffKeys } from "@/lib/staffApp/queryKeys";
import { readMockAttendance } from "@/lib/staffApp/mockStaffData";
import type { StaffAttendanceView } from "@/types/staffApp";

const db = supabase as unknown as { from: (table: string) => any };

function mapAttendance(row: any): StaffAttendanceView {
  return {
    id: row.id,
    staffId: row.staff_id,
    shiftDate: row.shift_date,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time ?? null,
    status: row.status,
    totalWorkedMinutesToday: row.total_worked_minutes_today ?? null,
  };
}

export function useStaffAttendance(staffId?: string | null) {
  const source = staffDataSource();
  const q = useQuery({
    queryKey: staffKeys.attendance(staffId ?? undefined),
    enabled: !!staffId,
    staleTime: 30_000,
    queryFn: async (): Promise<StaffAttendanceView[]> => {
      if (!staffId) return [];
      if (source === "mock") return readMockAttendance(staffId);

      const { data, error } = await db
        .from("staff_attendance")
        .select("id, staff_id, shift_date, check_in_time, check_out_time, status, total_worked_minutes_today")
        .eq("staff_id", staffId)
        .order("check_in_time", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []).map(mapAttendance);
    },
  });

  const rows = q.data ?? [];
  const openAttendance = rows.find((r) => r.status === "checked_in" && !r.checkOutTime) ?? null;
  return { ...q, rows, openAttendance };
}

