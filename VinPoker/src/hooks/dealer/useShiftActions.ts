import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dealerKeys } from "@/lib/dealerApp/queryKeys";
import { dealerDataSource } from "@/lib/dealerApp/dataSource";
import { formatHm } from "@/lib/dealerApp/selectors";
import type { DealerShiftView } from "@/types/dealerApp";
import type { ShiftStatus } from "@/types/shiftPlanner";

// dealer_* RPCs aren't in the generated types yet (same as useShiftPlanner) — use
// an untyped client for the .rpc() calls. Reads still go through the typed hooks.
const db = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }> };

export type ShiftAction = "confirm" | "checkIn" | "checkOut";

const RPC: Record<ShiftAction, string> = {
  confirm: "dealer_confirm_shift",
  checkIn: "dealer_check_in",
  checkOut: "dealer_check_out",
};

/** The status a shift advances to for each action, in MOCK mode (optimistic). */
function mockNextStatus(action: ShiftAction): ShiftStatus {
  return action === "confirm" ? "confirmed" : action === "checkIn" ? "checked_in" : "closed";
}

/** Patch every cached today/week query that holds the shift with `shiftId`.
 *  Handles both the single-object `today` cache and the array `week` cache so the
 *  preview demo advances live with no DB. */
function patchShiftInCaches(qc: QueryClient, shiftId: string, patch: Partial<DealerShiftView>) {
  qc.setQueriesData<any>({ queryKey: dealerKeys.all }, (prev) => {
    if (!prev) return prev;
    if (Array.isArray(prev)) {
      return prev.map((s) => (s && s.id === shiftId ? { ...s, ...patch } : s));
    }
    if (typeof prev === "object" && prev.id === shiftId) {
      return { ...prev, ...patch };
    }
    return prev;
  });
}

function successToast(action: ShiftAction, late: boolean, t: (k: string, d?: string) => string) {
  if (action === "confirm") return t("dealer.toast.confirmed", "Đã xác nhận ca");
  if (action === "checkIn")
    return late
      ? t("dealer.toast.checkedInLate", "Đã check-in (muộn)")
      : t("dealer.toast.checkedIn", "Đã check-in. Chúc ca làm việc suôn sẻ!");
  return t("dealer.toast.checkedOut", "Đã check-out. Kết thúc ca.");
}

/**
 * Confirm / ROSTER check-in / check-out for the dealer's OWN shift.
 * - MOCK (flag OFF): optimistic local advance + success toast (no DB).
 * - LIVE (both flags ON): calls the planner-only SECURITY-DEFINER RPC
 *   (dealer_confirm_shift / dealer_check_in / dealer_check_out), maps the jsonb
 *   outcome to a toast, then invalidates the dealer queries.
 * NEVER touches the live Dealer Swing / attendance / payroll system.
 */
export function useShiftActions() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const source = dealerDataSource();

  const mutation = useMutation({
    mutationFn: async ({ action, shift }: { action: ShiftAction; shift: DealerShiftView }) => {
      if (source === "mock") {
        const patch: Partial<DealerShiftView> = { status: mockNextStatus(action) };
        if (action === "checkIn") patch.checkedInAt = new Date().toISOString();
        if (action === "checkOut") patch.checkedOutAt = new Date().toISOString();
        patchShiftInCaches(qc, shift.id, patch);
        toast.success(successToast(action, false, t));
        return { outcome: mockNextStatus(action), mock: true } as const;
      }

      const { data, error } = await db.rpc(RPC[action], { p_assignment_id: shift.id });
      if (error) {
        toast.error(t("dealer.toast.failed", "Thao tác không thành công. Vui lòng thử lại."));
        throw error;
      }
      const outcome = (data as any)?.outcome as string | undefined;

      if (outcome === "too_early") {
        toast.error(t("dealer.toast.tooEarly", "Chưa tới giờ check-in (mở 30 phút trước ca)."));
        return data;
      }
      if (outcome === "invalid_state") {
        toast.error(t("dealer.toast.invalidState", "Trạng thái ca đã thay đổi. Đã làm mới."));
        await qc.invalidateQueries({ queryKey: dealerKeys.all });
        return data;
      }
      if (outcome === "not_found") {
        toast.error(t("dealer.toast.failed", "Thao tác không thành công. Vui lòng thử lại."));
        return data;
      }

      // Scheduled-pool bridge: an early check-in records arrival but enters the
      // pool at the scheduled start — reflect that instead of a generic success.
      if (action === "checkIn" && (data as any)?.pending_pool) {
        toast.success(
          t("dealer.pool.pendingToast", "Đã check-in. Vào pool lúc {{time}}.", {
            time: formatHm((data as any).pool_entry_at),
          })
        );
      } else {
        toast.success(successToast(action, !!(data as any)?.late, t));
      }
      await qc.invalidateQueries({ queryKey: dealerKeys.all });
      return data;
    },
  });

  return {
    confirm: (shift: DealerShiftView) => mutation.mutateAsync({ action: "confirm", shift }),
    checkIn: (shift: DealerShiftView) => mutation.mutateAsync({ action: "checkIn", shift }),
    checkOut: (shift: DealerShiftView) => mutation.mutateAsync({ action: "checkOut", shift }),
    isPending: mutation.isPending,
  };
}
