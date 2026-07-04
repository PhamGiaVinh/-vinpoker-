import { toast } from "sonner";
import { AlertQueueItem } from "@/components/ops/shared/AlertQueueItem";
import { FinancialWarningCard } from "@/components/ops/shared/FinancialWarningCard";
import { RoleLockedAction } from "@/components/ops/shared/RoleLockedAction";
import { MOCK_OP_ALERTS, MOCK_FIN_LINES } from "@/components/ops/mock/opsData";

/**
 * Cảnh báo (mobileOpsV2) — hàng đợi sự cố + cảnh báo Tài chính READ-ONLY, phong cách iOS.
 * Floor KHÔNG thao tác tiền. DỮ LIỆU MẪU. docs/design/ios-floor-ux-spec.md §10–11.
 */
export default function OpsAlerts() {
  return (
    <div className="ios-in space-y-6 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Cảnh báo</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">{MOCK_OP_ALERTS.length} việc cần xử lý</p>
      </header>

      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Cần xử lý</h3>
        <div className="ios-group">
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

      <section className="space-y-2.5">
        <h3 className="px-1 text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Cảnh báo tài chính (đọc)</h3>
        <FinancialWarningCard lines={MOCK_FIN_LINES} />
        <RoleLockedAction label="Mở Tài chính &amp; Đối soát" mode="desktopOnly" reason="trên máy tính" />
      </section>
    </div>
  );
}
