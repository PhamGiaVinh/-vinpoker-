import { FnbReportPanel } from "@/components/fnb/FnbReportPanel";
import { Card } from "@/components/ui/card";

/**
 * F&B thu chi — read-only wrapper around the live F&B report (doanh thu − giá vốn − lãi
 * gộp, theo bàn/người chơi, tồn kho thấp). Server authz: fnb_get_report's LOCAL accountant
 * scope (20261236000000) — the F&B write surfaces stay untouched. No write controls here.
 */
export function AccountantFnbTab({ clubId }: { clubId: string | null }) {
  if (!clubId) {
    return (
      <Card className="p-5 border-border text-[13px] text-muted-foreground">Chưa chọn CLB.</Card>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Báo cáo thu chi F&amp;B (chỉ xem) — cùng nguồn số với trang F&amp;B của chủ CLB.
      </p>
      <FnbReportPanel clubId={clubId} />
    </div>
  );
}
