import { Clock, LayoutGrid, Radio, Lock } from "lucide-react";
import { OperationStatusChip } from "../shared/OperationStatusChip";
import type { MockTournament } from "../mock/floorToday";

/**
 * TournamentStatusCard — tóm tắt 1 giải đang chạy. KHÔNG có nút sửa tiền/level (tránh mis-tap P0);
 * sửa = "trên máy tính". docs/design/ios-operations-components.md §5. Read-only.
 */
export function TournamentStatusCard({ t }: { t: MockTournament }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[15px] font-semibold text-foreground">{t.name}</div>
        <OperationStatusChip status="running" />
      </div>
      <div className="mt-1 text-sm text-primary">
        Level {t.level} · {t.blinds} <span className="text-muted-foreground">· ante {t.ante}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div className="text-muted-foreground">
          Còn <span className="font-mono text-foreground">{t.remaining}/{t.total}</span>
        </div>
        <div className="text-muted-foreground">
          TB <span className="font-mono text-foreground">{t.avgStack}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> <span className="font-mono text-foreground">{t.timeToBreak}</span> tới nghỉ
        </div>
        <div className="text-muted-foreground">Prize <span className="text-foreground">(đọc)</span></div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 py-2 text-sm font-medium text-primary">
          <LayoutGrid className="h-4 w-4" /> Sơ đồ bàn
        </button>
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card py-2 text-sm">
          <Radio className="h-4 w-4 text-sky-400" /> Live tracker
        </button>
      </div>
      <div className="mt-2 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
        <Lock className="h-3 w-3" /> Sửa blind/level — mở trên máy tính
      </div>
    </div>
  );
}
