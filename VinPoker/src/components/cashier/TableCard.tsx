import { motion } from "framer-motion";
import { useTableTimer } from "./TableCard.utils";
import { DealerRow } from "./DealerRow";
import type { TableCardProps } from "./TableCard.types";
import {
  MODE_TO_CARD_STYLE,
  MODE_TO_TIMER_COLOR,
  MODE_TO_PROGRESS_COLOR,
} from "./TableCard.types";

function estimateMinutesSince(isoString: string): number {
  return Math.floor((Date.now() - new Date(isoString).getTime()) / 60000);
}

export function TableCard({ data, onAssign, onSwing, className }: TableCardProps) {
  const timer = useTableTimer(data.assignment, data.swing_config);
  const mode = timer.mode;

  if (!data.current_dealer || !data.assignment) {
    return (
      <div
        className={[
          "relative flex flex-col items-center justify-center p-8",
          "border-2 border-dashed border-zinc-700/40 rounded-xl",
          "bg-zinc-900/20 min-h-[220px]",
          className ?? "",
        ].join(" ")}
      >
        <div className="w-14 h-14 rounded-full bg-zinc-800/50 flex items-center justify-center mb-4">
          <svg className="w-7 h-7 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-zinc-400 mb-1">{data.table_name}</h3>
        <p className="text-[11px] text-zinc-600 mb-4">Chưa có dealer</p>
        {onAssign && (
          <button
            onClick={() => onAssign(data.table_id)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-all active:scale-[0.97]"
          >
            Gán Dealer
          </button>
        )}
      </div>
    );
  }

  const isOtMode = mode === "ot";
  const showSwingButton = timer.remainingSec <= 0;
  const workedMin = data.current_dealer.worked_minutes ?? estimateMinutesSince(data.assignment.assigned_at);
  const tableType = data.table_type;
  const isHighTable = tableType === "high";

  const nextDealerVisible =
    (data.next_dealer?.source === "confirmed") ||
    (data.next_dealer?.source === "predicted" && timer.remainingSec <= 300);

  const otGlow = isOtMode ? "ring-1 ring-red-500/20" : "";

  return (
    <div
      className={[
        "relative flex flex-col p-4 rounded-xl border transition-all duration-300",
        "min-h-[260px]",
        MODE_TO_CARD_STYLE[mode],
        otGlow,
        className ?? "",
      ].join(" ")}
    >
      {/* Progress bar (top edge) with spring animation */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-zinc-800/60 rounded-t-xl overflow-hidden">
        <motion.div
          className={[
            "h-full",
            MODE_TO_PROGRESS_COLOR[mode],
          ].join(" ")}
          layout
          transition={{ type: "spring", stiffness: 120, damping: 20, mass: 0.5 }}
          style={{ width: `${Math.min(100, timer.progress)}%` }}
        />
        {timer.glowIntensity > 0 && (
          <motion.div
            className={[
              "absolute top-0 right-0 h-full blur-md",
              MODE_TO_PROGRESS_COLOR[mode],
            ].join(" ")}
            initial={false}
            animate={{ width: `${Math.min(100, timer.progress)}%`, opacity: Math.min(0.8, timer.glowIntensity * 0.8) }}
            transition={{ type: "spring", stiffness: 120, damping: 20, mass: 0.5 }}
          />
        )}
      </div>

      {/* Header: table name + table type badge + timer */}
      <div className="flex justify-between items-start mb-4 mt-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-bold tracking-tight text-zinc-300 truncate">
            {data.table_name}
          </h3>
          {isHighTable && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20 leading-none mt-0.5">
              High
            </span>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <div
            className={[
              "text-3xl font-mono font-bold tracking-tight tabular-nums leading-none",
              MODE_TO_TIMER_COLOR[mode],
              mode === "overdue" ? "animate-pulse" : "",
            ].join(" ")}
          >
            {timer.label}
          </div>
          <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-mono">
            {isOtMode ? "OT" : "còn lại"}
          </span>
        </div>
      </div>

      {/* Swing now button (overdue) */}
      {showSwingButton && onSwing && (
        <button
          onClick={() => onSwing(data.assignment.id)}
          className="mb-3 w-full py-2 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xs font-bold rounded-lg transition-all active:scale-[0.98] shadow-lg shadow-red-900/30 animate-pulse"
        >
          ⚡ Swing ngay
        </button>
      )}

      {/* Current dealer */}
      <div className="mb-3 flex-1">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Đang deal
          </span>
        </div>
        <DealerRow
          dealer={data.current_dealer}
          variant="primary"
          workDuration={`${workedMin} phút`}
          accentColor={isOtMode ? "#ef4444" : undefined}
        />
      </div>

      {/* Divider */}
      <div className="border-t border-zinc-800 mb-3" />

      {/* Next dealer */}
      {data.next_dealer ? (
        <div
          className={[
            "transition-all duration-500 ease-out",
            nextDealerVisible
              ? "opacity-100 translate-y-0 max-h-20"
              : "opacity-0 translate-y-3 max-h-0 pointer-events-none overflow-hidden",
          ].join(" ")}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={[
              "w-1.5 h-1.5 rounded-full",
              data.next_dealer.source === "confirmed" ? "bg-emerald-500/70" : "bg-amber-500/50",
            ].join(" ")} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Tiếp theo
            </span>
            {data.next_dealer.source === "confirmed" && (
              <span className="text-[9px] text-emerald-500/70 ml-auto">✓ Xác nhận</span>
            )}
          </div>
          <DealerRow
            dealer={data.next_dealer}
            variant="secondary"
            badge={
              data.next_dealer.source === "confirmed"
                ? { label: "Sẵn sàng", color: "green" }
                : { label: "Dự kiến", color: "yellow" }
            }
            accentColor={data.next_dealer.source === "confirmed" ? "#10b981" : "#f59e0b"}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-[10px] text-zinc-700">Chờ pre-assign...</span>
        </div>
      )}
    </div>
  );
}
