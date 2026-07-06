import { cn } from "@/lib/utils";
import type { MockTable } from "../mock/opsData";

/**
 * RoomGrid — sơ đồ bàn tổng thể (mock B1): cả phòng trong 1 màn, lưới ô 4 cột,
 * số bàn to, màu = trạng thái, sĩ số nhỏ bên dưới. Dùng chung cho /ops/tables và
 * cockpit giải (pill "Bàn"). Read-only — onTap mở sheet bàn.
 */
const NUM_CLS: Record<MockTable["status"], string> = {
  running: "text-emerald-300",
  paused: "text-amber-300",
  open: "text-[#6b6172]",
  closed: "text-[#6b6172]",
};

export function RoomGrid({ tables, onTap }: { tables: MockTable[]; onTap?: (t: MockTable) => void }) {
  const counts = {
    running: tables.filter((t) => t.status === "running").length,
    paused: tables.filter((t) => t.status === "paused").length,
    open: tables.filter((t) => t.status === "open").length,
  };
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 px-1 text-[12px] text-[#9b8e97]">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />{counts.running} chạy</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />{counts.paused} dừng</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#5a5062]" />{counts.open} trống</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {tables.map((t) => (
          <button
            key={t.tableNo}
            onClick={() => onTap?.(t)}
            className={cn(
              "ios-press ios-card px-1 py-2.5 text-center",
              t.needsFloor && "ring-1 ring-amber-400/40",
              t.status === "open" && "opacity-55",
            )}
          >
            <div className={cn("text-[20px] font-bold leading-none", t.needsFloor ? "text-[#d8bc85]" : NUM_CLS[t.status])}>
              {t.tableNo}
            </div>
            <div className="mt-1 font-mono text-[11px] text-[#9b8e97]">{t.occ}/{t.max}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
