import { toast } from "sonner";
import { AlertQueueItem } from "@/components/ops/shared/AlertQueueItem";
import { FinancialWarningCard } from "@/components/ops/shared/FinancialWarningCard";
import { RoleLockedAction } from "@/components/ops/shared/RoleLockedAction";
import { MOCK_OP_ALERTS, MOCK_FIN_LINES } from "@/components/ops/mock/opsData";

/**
 * Cảnh báo (mobileOpsV2) — hàng đợi sự cố thao tác + cảnh báo Tài chính READ-ONLY (doctrine).
 * Floor KHÔNG thao tác tiền. DỮ LIỆU MẪU. docs/design/ios-floor-ux-spec.md §10–11 · WF8/WF10.
 */
export default function OpsAlerts() {
  return (
    <div className="space-y-4">
      <section>
        <h1 className="mb-1.5 text-base font-semibold text-foreground">Cần xử lý ({MOCK_OP_ALERTS.length})</h1>
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {MOCK_OP_ALERTS.map((a) => (
            <AlertQueueItem
              key={a.id}
              icon={a.icon}
              subject={a.subject}
              detail={a.detail}
              status={a.status}
              onTap={() => toast("Mở luồng xử lý (bản mẫu)")}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Cảnh báo tài chính (đọc)
        </h2>
        <FinancialWarningCard lines={MOCK_FIN_LINES} />
        <RoleLockedAction label="Mở Tài chính &amp; Đối soát" mode="desktopOnly" reason="trên máy tính" />
      </section>
    </div>
  );
}
