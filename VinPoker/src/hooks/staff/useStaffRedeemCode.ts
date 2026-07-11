import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { staffKeys } from "@/lib/staffApp/queryKeys";

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

const ERRORS: Record<string, string> = {
  NOT_FOUND: "Mã không đúng hoặc đã dùng. Kiểm tra lại với chủ CLB.",
  ALREADY_LINKED: "Hồ sơ này đã liên kết với tài khoản khác.",
  EXPIRED: "Mã đã hết hạn — nhờ chủ CLB tạo mã mới.",
  INVALID_INPUT: "Mã không hợp lệ (tối thiểu 6 ký tự).",
  Unauthorized: "Bạn cần đăng nhập trước.",
};

/**
 * Staff self-link: the signed-in user redeems an invite code to bind their OWN account to a
 * staff row (staff_redeem_link_code — server binds auth.uid(), first-link-wins, one-time).
 * On success, invalidate the staff link query so the portal re-reads as linked.
 */
export function useStaffRedeemCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await rpc("staff_redeem_link_code", { p_code: code.trim() });
      if (error) {
        if (error.code === "42883" || `${error.message ?? ""}`.toLowerCase().includes("could not find the function")) {
          throw new Error("Tính năng mã mời chưa mở — báo chủ CLB.");
        }
        throw error;
      }
      if (data?.error) throw new Error(ERRORS[data.error] ?? data.detail ?? data.error);
      return data as { status: "ok"; staff_id: string; club_id: string };
    },
    onSuccess: () => {
      toast.success("Đã liên kết! Đang mở cổng nhân viên…");
      qc.invalidateQueries({ queryKey: staffKeys.all });
    },
    onError: (e: any) => toast.error(e?.message ?? "Không liên kết được."),
  });
}
