/**
 * DealerSwingSummaryStrip — full-width room-status strip for the Dealer Swing
 * operator panel (UI Phase 4). Glance-first KPIs + a live freshness indicator.
 *
 * PRESENTATION ONLY: receives already-derived counts as props (computed in
 * SwingPanel from existing data — no new query). Stitch Dark / neon-green,
 * generous spacing, no overlapping text.
 */

interface Tile {
  label: string;
  value: string | number;
  color: string;
  border?: string;
}

export interface DealerSwingSummaryStripProps {
  activeTables: number;
  assignedTables: number;
  onBreak: number;
  predictedPending: number;
  overdue: number;
  warnings: number;
  /** Live clock ms — drives the "cập nhật HH:MM:SS" freshness label. */
  nowMs: number;
}

export default function DealerSwingSummaryStrip({
  activeTables, assignedTables, onBreak, predictedPending, overdue, warnings, nowMs,
}: DealerSwingSummaryStripProps) {
  const tiles: Tile[] = [
    { label: "Bàn hoạt động", value: activeTables, color: "text-zinc-100" },
    { label: "Đã gán", value: `${assignedTables}/${activeTables}`, color: assignedTables === activeTables && activeTables > 0 ? "text-primary" : "text-amber-400" },
    { label: "Đang nghỉ", value: onBreak, color: "text-zinc-100" },
    { label: "Dự kiến chờ", value: predictedPending, color: predictedPending > 0 ? "text-amber-400" : "text-zinc-500" },
    { label: "Quá hạn", value: overdue, color: overdue > 0 ? "text-red-400" : "text-zinc-500", border: overdue > 0 ? "border border-red-500/40" : "" },
    { label: "Cảnh báo", value: warnings, color: warnings > 0 ? "text-amber-400" : "text-zinc-500", border: warnings > 0 ? "border border-amber-500/40" : "" },
  ];
  const hhmmss = new Date(nowMs).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  return (
    <div className="bg-zinc-900/70 border border-primary/20 rounded-xl p-4 mb-4">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-sm font-medium text-primary tracking-wide">Đài điều hành Dealer</span>
        <span className="ml-auto inline-flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-full px-3 py-1.5 text-xs text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
          Trực tiếp · cập nhật {hhmmss}
        </span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
        {tiles.map((tile) => (
          <div key={tile.label} className={["bg-zinc-800/50 rounded-xl px-3.5 py-3", tile.border ?? ""].join(" ")}>
            <div className={["text-2xl font-semibold tabular-nums leading-none", tile.color].join(" ")}>{tile.value}</div>
            <div className="text-xs text-zinc-400 mt-1.5 leading-tight">{tile.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
