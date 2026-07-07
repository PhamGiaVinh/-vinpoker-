import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dealerKeys } from "@/lib/dealerApp/queryKeys";
import { dealerDataSource } from "@/lib/dealerApp/dataSource";

const db = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }> };

export type ShiftPreference = "som" | "muon" | "linh_hoat";

/**
 * Dealer self-service: set the dealer's OWN auto-fill shift preference via the
 * dealer_set_shift_preference SECURITY-DEFINER RPC (dealers write is otherwise
 * locked to operators). MOCK = success toast only; LIVE = db.rpc + invalidate the
 * dealer-link query so the account screen reflects the new value. Only touches
 * dealers.shift_preference — never swing / attendance / payroll.
 */
export function useDealerPreference() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const source = dealerDataSource();

  const setPreference = useMutation({
    mutationFn: async (v: { dealerId: string; preference: ShiftPreference }) => {
      if (source === "mock") {
        toast.success(t("dealer.toast.preferenceSaved", "Đã lưu ca ưa thích."));
        return { outcome: "updated", mock: true } as const;
      }
      const { data, error } = await db.rpc("dealer_set_shift_preference", {
        p_dealer_id: v.dealerId,
        p_preference: v.preference,
      });
      if (error) {
        toast.error(t("dealer.toast.failed", "Thao tác không thành công. Vui lòng thử lại."));
        throw error;
      }
      // Soft-failure outcome with error=null (e.g. not_found) — surface it instead
      // of a false success toast (mirrors useDealerAvailability).
      const outcome = (data as { outcome?: string } | null)?.outcome;
      if (outcome && outcome !== "updated") {
        toast.error(
          outcome === "not_found"
            ? t("dealer.toast.noClub", "Hồ sơ dealer chưa gắn câu lạc bộ — liên hệ quản lý.")
            : t("dealer.toast.failed", "Thao tác không thành công. Vui lòng thử lại."),
        );
        throw new Error(`dealer_set_shift_preference outcome=${outcome}`);
      }
      toast.success(t("dealer.toast.preferenceSaved", "Đã lưu ca ưa thích."));
      await qc.invalidateQueries({ queryKey: dealerKeys.all });
      return data;
    },
  });

  return { setPreference, isPending: setPreference.isPending };
}
