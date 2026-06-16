import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dealerKeys } from "@/lib/dealerApp/queryKeys";
import { dealerDataSource } from "@/lib/dealerApp/dataSource";

const db = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }> };

export type AvailabilityKind = "preferred" | "available";
export type LeaveKind = "leave" | "unavailable";

/**
 * Dealer self-service availability / leave wishes on the planner layer
 * (dealer_availability_requests via SECURITY-DEFINER RPCs). MOCK = success toast
 * only (no persistent list in the demo); LIVE = db.rpc + invalidate week.
 * NEVER touches the live Dealer Swing / attendance / payroll system.
 */
export function useDealerAvailability() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const source = dealerDataSource();

  const submitAvailability = useMutation({
    mutationFn: async (v: { dealerId: string; workDate: string; kind: AvailabilityKind; templateId?: string | null; note?: string | null }) => {
      if (source === "mock") {
        toast.success(t("dealer.toast.availabilitySaved", "Đã lưu lịch rảnh."));
        return { outcome: "submitted", mock: true } as const;
      }
      const { data, error } = await db.rpc("dealer_submit_availability", {
        p_dealer_id: v.dealerId,
        p_work_date: v.workDate,
        p_kind: v.kind,
        p_template_id: v.templateId ?? null,
        p_note: v.note ?? null,
      });
      if (error) {
        toast.error(t("dealer.toast.failed", "Thao tác không thành công. Vui lòng thử lại."));
        throw error;
      }
      toast.success(t("dealer.toast.availabilitySaved", "Đã lưu lịch rảnh."));
      await qc.invalidateQueries({ queryKey: dealerKeys.all });
      return data;
    },
  });

  const requestLeave = useMutation({
    mutationFn: async (v: { dealerId: string; workDate: string; kind?: LeaveKind; note?: string | null }) => {
      if (source === "mock") {
        toast.success(t("dealer.toast.leaveRequested", "Đã gửi yêu cầu nghỉ."));
        return { outcome: "requested", mock: true } as const;
      }
      const { data, error } = await db.rpc("dealer_request_leave_or_swap", {
        p_dealer_id: v.dealerId,
        p_work_date: v.workDate,
        p_kind: v.kind ?? "leave",
        p_note: v.note ?? null,
      });
      if (error) {
        toast.error(t("dealer.toast.failed", "Thao tác không thành công. Vui lòng thử lại."));
        throw error;
      }
      toast.success(t("dealer.toast.leaveRequested", "Đã gửi yêu cầu nghỉ."));
      await qc.invalidateQueries({ queryKey: dealerKeys.all });
      return data;
    },
  });

  return { submitAvailability, requestLeave, isPending: submitAvailability.isPending || requestLeave.isPending };
}
