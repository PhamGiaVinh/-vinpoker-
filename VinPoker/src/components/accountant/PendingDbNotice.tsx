import { Database, ShieldAlert, WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { CapabilityState } from "@/hooks/accountant/useAccountantCapabilities";

/**
 * Per-tab capability notice for the accountant workspace. Renders the reason a tab is
 * unavailable — distinguishing "DB migration not applied yet" from "no permission" from
 * a transient network problem (never inferred from empty data).
 */
export function PendingDbNotice({ state }: { state: CapabilityState }) {
  if (state === "not_installed") {
    return (
      <Card className="p-5 border-warning/40 bg-warning/10 text-[13px] text-warning flex items-start gap-2.5">
        <Database className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Chưa mở quyền kế toán cho mục này — chờ chủ CLB áp DB (migration
          <span className="font-mono"> 20261236000000</span>). Giao diện đã sẵn sàng, không cần cập nhật thêm.
        </span>
      </Card>
    );
  }
  if (state === "forbidden") {
    return (
      <Card className="p-5 border-destructive/40 bg-destructive/10 text-[13px] text-destructive flex items-start gap-2.5">
        <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Bạn chưa có quyền dùng mục này ở CLB đang chọn.</span>
      </Card>
    );
  }
  return (
    <Card className="p-5 border-border text-[13px] text-muted-foreground flex items-start gap-2.5">
      <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
      <span>Không kiểm tra được quyền (lỗi mạng). Thử tải lại trang.</span>
    </Card>
  );
}
