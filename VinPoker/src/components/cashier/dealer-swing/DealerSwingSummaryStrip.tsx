/**
 * DealerSwingSummaryStrip — KPI header for the Dealer Swing operator panel
 * (UI Phase 4). Three grouped cards (Hoạt động · Rủi ro · Hiệu suất) + a live
 * freshness indicator, matching the approved dashboard mockup.
 *
 * PRESENTATION ONLY: receives already-derived counts/metrics as props (computed
 * in SwingPanel from existing data — no new query). Stitch Dark / neon-green,
 * generous spacing, no overlapping text.
 */

interface Metric {
  label: string;
  value: string | number;
  color: string;
}

interface GroupCard {
  title: string;
  metrics: Metric[];
}

export interface DealerSwingSummaryStripProps {
  activeTables: number;
  assignedTables: number;
  /**
   * Assignments still flagged 'assigned' but on a closed/inactive table
   * (ghosts). Operator/admin diagnostic only — pass 0 for non-admins to hide.
   */
  ghostAssignments?: number;
  onBreak: number;
  predictedPending: number;
  overdue: number;
  warnings: number;
  /** Successful-swing rate %, or null when there are no swings today. */
  stabilityPct: number | null;
  /** "Thiếu dealer sớm nhất" — HH:mm label, or null when no shortage forecast. */
  earliestShortageLabel: string | null;
  /** Live clock ms — drives the "cập nhật HH:MM:SS" freshness label. */
  nowMs: number;
}

export default function DealerSwingSummaryStrip({
  activeTables, assignedTables, ghostAssignments = 0, onBreak, predictedPending, overdue, warnings,
  stabilityPct, earliestShortageLabel, nowMs,
}: DealerSwingSummaryStripProps) {
  const allAssigned = assignedTables === activeTables && activeTables > 0;

  const cards: GroupCard[] = [
    {
      title: "Tổng quan hoạt động",
      metrics: [
        { label: "Bàn đang mở", value: activeTables, color: "text-zinc-100" },
        { label: "Bàn có dealer / mở", value: `${assignedTables}/${activeTables}`, color: allAssigned ? "text-primary" : "text-amber-400" },
        { label: "Đang nghỉ", value: onBreak, color: "text-zinc-100" },
      ],
    },
    {
      title: "Quản lý rủi ro",
      metrics: [
        { label: "Dự kiến chờ", value: predictedPending, color: predictedPending > 0 ? "text-sky-400" : "text-zinc-500" },
        { label: "Cảnh báo", value: warnings, color: warnings > 0 ? "text-amber-400" : "text-zinc-500" },
        { label: "Quá hạn", value: overdue, color: overdue > 0 ? "text-red-400" : "text-zinc-500" },
      ],
    },
    {
      title: "Hiệu suất",
      metrics: [
        { label: "Tỷ lệ ổn định", value: stabilityPct != null ? `${stabilityPct}%` : "—", color: stabilityPct != null && stabilityPct >= 90 ? "text-primary" : stabilityPct != null ? "text-amber-400" : "text-zinc-500" },
        { label: "Thiếu sớm nhất", value: earliestShortageLabel ?? "—", color: earliestShortageLabel ? "text-amber-400" : "text-zinc-500" },
      ],
    },
  ];

  const hhmmss = new Date(nowMs).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-sm font-medium text-primary tracking-wide">Đài điều hành Dealer</span>
        <span className="ml-auto inline-flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-full px-3 py-1.5 text-xs text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
          Trực tiếp · cập nhật {hhmmss}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map((card) => (
          <div key={card.title} className="bg-zinc-900/70 border border-primary/20 rounded-xl px-4 py-3.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2.5">{card.title}</div>
            <div className="flex items-stretch">
              {card.metrics.map((m, i) => (
                <div key={m.label} className={["min-w-0", i > 0 ? "ml-3 border-l border-zinc-700/40 pl-3" : ""].join(" ")}>
                  <div className={["text-2xl font-semibold tabular-nums leading-none", m.color].join(" ")}>{m.value}</div>
                  <div className="text-[11px] text-zinc-400 mt-1.5 leading-tight">{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {ghostAssignments > 0 && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400">
          <span aria-hidden="true">⚠️</span>
          Phát hiện {ghostAssignments} assignment trên bàn đã đóng (cần dọn).
        </div>
      )}
    </div>
  );
}
