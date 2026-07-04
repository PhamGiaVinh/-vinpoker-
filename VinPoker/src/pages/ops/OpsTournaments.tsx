import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { OperationStatusChip, type OpStatus } from "@/components/ops/shared/OperationStatusChip";
import { MOCK_TOURNAMENTS } from "@/components/ops/mock/opsData";

/**
 * Giải đấu (mobileOpsV2) — danh sách giải đang chạy/sắp tới. Tap → điều khiển nhanh (mock: về Bàn).
 * DỮ LIỆU MẪU, read-only. docs/design/ios-floor-ux-spec.md §4.
 */
const STATUS: Record<string, OpStatus> = { "Đang chạy": "running", "Late reg": "todo", "Sắp tới": "provisional" };

export default function OpsTournaments() {
  const navigate = useNavigate();
  return (
    <div className="space-y-3">
      <h1 className="text-base font-semibold text-foreground">Giải đấu</h1>
      <div className="space-y-2">
        {MOCK_TOURNAMENTS.map((t) => (
          <button
            key={t.name}
            onClick={() => navigate("/ops/tables")}
            className="flex w-full items-center gap-2 rounded-xl border border-border bg-card p-3.5 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-foreground">{t.name}</span>
                <OperationStatusChip status={STATUS[t.status] ?? "provisional"} />
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t.level ? `Level ${t.level} · ${t.blinds}` : "Chưa bắt đầu"}
                {t.total ? ` · còn ${t.remaining}/${t.total}` : ""}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
