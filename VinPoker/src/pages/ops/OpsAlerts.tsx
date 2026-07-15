import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AlertQueueItem } from "@/components/ops/shared/AlertQueueItem";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import {
  useActiveAssignmentsWithTimeline,
  useActiveTables,
  type DealerAssignment,
} from "@/hooks/useDealerSwing";

type EnrichedAssignment = DealerAssignment & { isOverdue: boolean };

/** Real, club-scoped Floor alert queue. No financial or fixture data is rendered here. */
export default function OpsAlerts() {
  const navigate = useNavigate();
  const { loading: clubsLoading, clubs, clubIds, dealerClubIds, error: clubsError } = useOperatorClubs();
  const scopedIds = Array.from(new Set([...clubIds, ...dealerClubIds]));
  const tablesQ = useActiveTables(scopedIds);
  const assignmentsQ = useActiveAssignmentsWithTimeline(scopedIds);

  const alerts = useMemo(() => {
    const rows: Array<{
      id: string;
      icon: string;
      subject: string;
      detail: string;
      status: "late" | "noDealer";
    }> = [];
    const assignments = (assignmentsQ.data ?? []) as EnrichedAssignment[];

    for (const assignment of assignments) {
      if (assignment.isOverdue) {
        rows.push({
          id: `late-${assignment.id}`,
          icon: "⏱",
          subject: `${assignment.game_tables?.table_name ?? "Bàn"} quá giờ xoay dealer`,
          detail: assignment.dealer_attendance?.dealers?.full_name ?? "Kiểm tra Dealer Swing",
          status: "late",
        });
      }
    }

    const staffedTableIds = new Set(assignments.map((assignment) => assignment.table_id));
    for (const table of (tablesQ.data ?? []).filter((row) => (row.status ?? "active") === "active")) {
      if (!staffedTableIds.has(table.id)) {
        rows.push({
          id: `missing-${table.id}`,
          icon: "♠",
          subject: `${table.table_name} chưa có dealer`,
          detail: "Cần gán dealer đang check-in",
          status: "noDealer",
        });
      }
    }

    return rows;
  }, [assignmentsQ.data, tablesQ.data]);

  const loading = clubsLoading || tablesQ.loading || assignmentsQ.loading;
  const error = clubsError ?? tablesQ.error ?? assignmentsQ.error;

  return (
    <div className="ios-in space-y-6 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Cảnh báo</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">
          {loading ? "Đang đồng bộ…" : `${alerts.length} việc cần xử lý`}
        </p>
      </header>

      {error ? (
        <section className="ios-card px-5 py-7 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-rose-300" />
          <p className="mt-2 text-[15px] font-semibold text-[#f2ece6]">Không tải được cảnh báo thật</p>
          <p className="mt-1 text-[13px] text-[#9b8e97]">Không dùng dữ liệu mẫu thay thế.</p>
          <button
            onClick={() => { tablesQ.refetch(); assignmentsQ.refetch(); }}
            className="ios-press-sm ios-tinted mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[14px]"
          >
            <RefreshCw className="h-4 w-4" /> Thử lại
          </button>
        </section>
      ) : loading ? (
        <section className="ios-card grid place-items-center py-12">
          <Loader2 className="h-7 w-7 animate-spin text-[#c9a86a]" />
        </section>
      ) : clubs?.length === 0 ? (
        <section className="ios-card py-9 text-center text-[14px] text-[#9b8e97]">Chưa được phân công CLB.</section>
      ) : alerts.length === 0 ? (
        <section className="ios-card py-9 text-center">
          <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-300" />
          <p className="mt-2 text-[15px] font-semibold text-[#f2ece6]">Sàn đang ổn</p>
          <p className="mt-1 text-[13px] text-[#9b8e97]">Không có bàn thiếu dealer hoặc quá giờ xoay.</p>
        </section>
      ) : (
        <section>
          <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Cần xử lý</h2>
          <div className="ios-group">
            {alerts.map((alert) => (
              <AlertQueueItem
                key={alert.id}
                icon={alert.icon}
                subject={alert.subject}
                detail={alert.detail}
                status={alert.status}
                onTap={() => navigate("/ops/dealer-swing")}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
