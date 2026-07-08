import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { staffDataSource } from "@/lib/staffApp/dataSource";
import { staffKeys } from "@/lib/staffApp/queryKeys";
import { mockStaffCheckIn, mockStaffCheckOut } from "@/lib/staffApp/mockStaffData";

export function useStaffAttendanceActions(staffId?: string | null) {
  const queryClient = useQueryClient();
  const source = staffDataSource();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: staffKeys.attendance(staffId ?? undefined) });

  const checkIn = useMutation({
    mutationFn: async () => {
      if (!staffId) throw new Error("Chưa chọn hồ sơ nhân viên.");
      if (source === "mock") return mockStaffCheckIn(staffId);
      const { data, error } = await (supabase.rpc as any)("staff_check_in", { p_staff_id: staffId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Đã check-in.");
      invalidate();
    },
    onError: (error: any) => toast.error(error?.message ?? "Không thể check-in."),
  });

  const checkOut = useMutation({
    mutationFn: async () => {
      if (!staffId) throw new Error("Chưa chọn hồ sơ nhân viên.");
      if (source === "mock") return mockStaffCheckOut(staffId);
      const { data, error } = await (supabase.rpc as any)("staff_check_out", { p_staff_id: staffId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Đã check-out.");
      invalidate();
    },
    onError: (error: any) => toast.error(error?.message ?? "Không thể check-out."),
  });

  return {
    checkIn,
    checkOut,
    isPending: checkIn.isPending || checkOut.isPending,
  };
}

