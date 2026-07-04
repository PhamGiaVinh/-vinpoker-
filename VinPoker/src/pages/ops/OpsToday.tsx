import { useNavigate } from "react-router-dom";
import { ChevronRight, ListChecks, LayoutGrid } from "lucide-react";
import { RealtimeStaleBanner } from "@/components/ops/shared/RealtimeStaleBanner";
import { OperationStatusChip, type OpStatus } from "@/components/ops/shared/OperationStatusChip";
import { TournamentStatusCard } from "@/components/ops/today/TournamentStatusCard";
import { TodayTaskCard } from "@/components/ops/today/TodayTaskCard";
import {
  MOCK_TOURNAMENT,
  MOCK_TABLE_COUNTS,
  MOCK_NEXT_TASK,
  MOCK_ALERTS,
  MOCK_LAST_UPDATED,
} from "@/components/ops/mock/floorToday";

/**
 * "Floor hôm nay" — cockpit mở đầu mobileOpsV2 (WF1). Trả lời 6 câu trong 5 giây (spec §1).
 * READ-ONLY, DỮ LIỆU MẪU, KHÔNG thao tác tiền. Prototype behind FEATURES.mobileOpsV2 (OFF).
 */
const COUNTS: { key: keyof typeof MOCK_TABLE_COUNTS; label: string; tone: string }[] = [
  { key: "running", label: "Chạy", tone: "text-emerald-400" },
  { key: "open", label: "Mở", tone: "text-primary" },
  { key: "paused", label: "Dừng", tone: "text-amber-400" },
  { key: "closed", label: "Đóng", tone: "text-muted-foreground" },
];

const ALERT_STATUS: Record<string, OpStatus> = { todo: "todo", late: "late", provisional: "provisional" };

export default function OpsToday() {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <RealtimeStaleBanner lastUpdated={MOCK_LAST_UPDATED} onRefresh={() => {}} />

      <section>
        <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Giải đang chạy
        </h2>
        <TournamentStatusCard t={MOCK_TOURNAMENT} />
      </section>

      <section>
        <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bàn</h2>
        <div className="grid grid-cols-4 gap-2">
          {COUNTS.map((c) => (
            <div key={c.key} className="rounded-xl bg-muted/40 p-2 text-center">
              <div className={`font-mono text-xl font-semibold leading-none ${c.tone}`}>
                {MOCK_TABLE_COUNTS[c.key]}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{c.label}</div>
            </div>
          ))}
        </div>
      </section>

      <TodayTaskCard
        severity={MOCK_NEXT_TASK.severity}
        title={MOCK_NEXT_TASK.title}
        context={MOCK_NEXT_TASK.context}
        onPress={() => navigate("/ops/alerts")}
      />

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Cần xử lý ({MOCK_ALERTS.length})
          </h2>
          <button onClick={() => navigate("/ops/alerts")} className="text-[11px] text-primary">
            tất cả
          </button>
        </div>
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {MOCK_ALERTS.map((a) => (
            <button
              key={a.id}
              onClick={() => navigate("/ops/alerts")}
              className="flex w-full items-center gap-2 px-3 py-3 text-left"
            >
              <span className="text-sm">{a.icon}</span>
              <span className="flex-1 truncate text-sm text-foreground">{a.subject}</span>
              <OperationStatusChip status={ALERT_STATUS[a.status]} />
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </section>

      {/* Bottom action row (thumb-zone) — read-only prototype điều hướng */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => navigate("/ops/alerts")}
          className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          <ListChecks className="h-4 w-4" /> Xem việc cần làm ({MOCK_ALERTS.length})
        </button>
        <button
          onClick={() => navigate("/ops/tables")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-3 text-sm font-medium"
        >
          <LayoutGrid className="h-4 w-4" /> Sơ đồ bàn
        </button>
      </div>
    </div>
  );
}
