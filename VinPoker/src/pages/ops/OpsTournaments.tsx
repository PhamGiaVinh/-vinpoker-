import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { OperationStatusChip, type OpStatus } from "@/components/ops/shared/OperationStatusChip";
import { MOCK_TOURNAMENTS } from "@/components/ops/mock/opsData";

/**
 * Giải đấu (mobileOpsV2) — danh sách giải đang chạy/sắp tới (grouped list iOS). Tap → điều khiển nhanh
 * (mock: về Bàn). DỮ LIỆU MẪU, read-only. docs/design/ios-floor-ux-spec.md §4.
 */
const STATUS: Record<string, OpStatus> = { "Đang chạy": "running", "Late reg": "todo", "Sắp tới": "provisional" };

export default function OpsTournaments() {
  const navigate = useNavigate();
  return (
    <div className="ios-in space-y-6 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Giải đấu</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">{MOCK_TOURNAMENTS.length} giải hôm nay</p>
      </header>

      <div className="ios-group">
        {MOCK_TOURNAMENTS.map((t) => (
          <button
            key={t.name}
            onClick={() => navigate("/ops/tables")}
            className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[16px] font-semibold text-[#f2ece6]">{t.name}</span>
                <OperationStatusChip status={STATUS[t.status] ?? "provisional"} />
              </span>
              <span className="mt-0.5 block text-[13px] text-[#9b8e97]">
                {t.level ? `Level ${t.level} · ${t.blinds}` : "Chưa bắt đầu"}
                {t.total ? ` · còn ${t.remaining}/${t.total}` : ""}
              </span>
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#5f545c]" />
          </button>
        ))}
      </div>
    </div>
  );
}
