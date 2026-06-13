/**
 * SwingTableCard — one battle-map table card for the Dealer Swing operator
 * panel (UI Phase 4 operator-panel recompose).
 *
 * Extracted verbatim from the TableGrid `.map` body: all timing/label/guard
 * computation is lifted unchanged (now sharing deriveTableSwingView so the card
 * and the status-filter chip counts can never diverge) and the JSX is preserved
 * 1:1. PRESENTATION ONLY — receives raw row data + parent-supplied guarded
 * handlers; never changes swing/timer/RPC logic. Stitch Dark / neon-green.
 */

import { Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TableCardKebab } from "../TableCardKebab";
import SwingTableActions from "./SwingTableActions";
import { deriveTableSwingView, formatTimeHHmm, type TableTimeline } from "./swingTableView";
import { getPreAssignStatusLabel } from "@/lib/dealerSwingState";
import { OPEN_TABLE_GRACE_MINUTES } from "@/lib/breakPoolState";
import type {
  DealerAssignment, DealerAttendance, PreAssignedInfo, NextDealerPrediction, SwingConfig,
} from "@/hooks/useDealerSwing";
import type { RotationScheduleRow, RotationTableSlots } from "@/hooks/useRotationSchedule";
import type { TournamentWithTables } from "@/types/tournament";

/** Payload the card hands to the parent to open the final-handoff confirm dialog. */
export interface ConfirmSwingRequest {
  assignmentId: string;
  tableName: string;
  outName: string;
  inName: string | null;
  isOt: boolean;
}

export interface SwingTableCardProps {
  table: any;
  assignment: DealerAssignment | null;
  timeline: TableTimeline | undefined;
  slots: RotationTableSlots | undefined;
  pred: NextDealerPrediction | undefined;
  preAssigned: PreAssignedInfo | null;
  tournaments: TournamentWithTables[] | undefined;
  swingConfigs: SwingConfig[];
  dealers: DealerAttendance[];
  nowMs: number;
  restMinCfg: number;
  processing: string | null;
  swingingAssignmentId: string | null;
  isAnimating?: (tableId: string) => boolean;
  focused: boolean;
  closeConfirm: boolean;
  closingTable: boolean;
  wrongTableEnabled: boolean;
  // Handlers (parent-owned)
  onAssign: (tableId: string) => void;
  onSendToBreak: (attendanceId: string) => void;
  onManualSwing?: (tableId: string) => void;
  onForceClose?: (tableId: string) => void;
  onCloseTableClick: (tableId: string) => void;
  onCloseTableConfirm: () => void;
  onCloseTableCancel: () => void;
  onChangePredicted: (tableId: string) => void;
  onCorrectWrongTable: (tableId: string) => void;
  onRequestConfirmSwing: (req: ConfirmSwingRequest) => void;
}

export default function SwingTableCard({
  table: t,
  assignment: a,
  timeline: tl,
  slots,
  pred,
  preAssigned,
  tournaments,
  swingConfigs,
  dealers,
  nowMs,
  restMinCfg,
  processing,
  swingingAssignmentId,
  isAnimating,
  focused,
  closeConfirm,
  closingTable,
  wrongTableEnabled,
  onAssign,
  onSendToBreak,
  onManualSwing,
  onForceClose,
  onCloseTableClick,
  onCloseTableConfirm,
  onCloseTableCancel,
  onChangePredicted,
  onCorrectWrongTable,
  onRequestConfirmSwing,
}: SwingTableCardProps) {
  const dealer = a ? (a as any).dealer_attendance?.dealers : null;

  // ── Shared timing/status view (single source of truth — see swingTableView) ──
  const {
    swingDurationMs, swingDueMs, actualDueMs, isOt, isPastDue, canSwing, status: tableStatus,
  } = deriveTableSwingView(t, a, tl, tournaments, swingConfigs, nowMs);

  const preAssignStatus = a?.pre_assign_status ?? "none";
  const preAssignLabel = getPreAssignStatusLabel(preAssignStatus);

  // Open-table warmup: show "Vào swing sau M:SS" ONLY if swing_due_at actually
  // encodes the open-table grace (open-path: swing_due_at = assigned_at + grace + duration).
  // perform_swing rotation handoffs set swing_due_at = assigned_at + duration (no grace) —
  // inWarmup must NOT trigger for them, so we detect grace by checking whether the
  // scheduled window is longer than the nominal swing duration.
  const assignedMs = a?.assigned_at ? new Date(a.assigned_at).getTime() : 0;
  const hasGrace = a?.swing_due_at != null && assignedMs > 0
    && (swingDueMs - assignedMs) > swingDurationMs;
  const warmupUntilMs = hasGrace ? assignedMs + OPEN_TABLE_GRACE_MINUTES * 60_000 : 0;
  const inWarmup = !!a && !isOt && !a.swing_processed_at && hasGrace && nowMs < warmupUntilMs;

  // ── Rotation schedule (source of truth for relief plans) ──
  const slot0 = slots?.slot0;
  const slot0HasDealer = !!slot0?.in_attendance_id;
  const slot0Locked = !!slot0 && (slot0.status === "announced" || slot0.status === "executing");
  const slot0Name = slot0?.in_dealer_name ?? "dealer";
  const slot0ReliefLabel = slot0?.planned_relief_at
    ? formatTimeHHmm(new Date(slot0.planned_relief_at).getTime())
    : null;
  const forecastSlots = [slots?.slot1, slots?.slot2].filter(
    (s): s is RotationScheduleRow => !!s?.in_attendance_id,
  );
  const isTableOverdue = !!tl?.isOverdue;

  // Honest overdue states — driven by the rotation schedule.
  let overdueState: { label: string; className: string } | null = null;
  if (isTableOverdue && a) {
    if (slot0 && slot0Locked && slot0HasDealer) {
      overdueState = {
        label: `✓ CHỐT ${slot0Name}${slot0ReliefLabel ? ` vào ${slot0ReliefLabel}` : ""}`,
        className: "text-emerald-400",
      };
    } else if (slot0 && slot0.status === "predicted" && !slot0.is_shortage && slot0HasDealer) {
      overdueState = {
        label: `~ DỰ ĐOÁN ${slot0Name}${slot0ReliefLabel ? ` ${slot0ReliefLabel}` : ""}`,
        className: "text-amber-400",
      };
    } else {
      const shortageTime = slot0?.is_shortage && slot0.planned_relief_at
        ? formatTimeHHmm(new Date(slot0.planned_relief_at).getTime())
        : null;
      overdueState = {
        label: shortageTime ? `⚠ THIẾU DEALER · dự kiến ${shortageTime}` : "⚠ THIẾU DEALER",
        className: "text-red-400",
      };
    }
  }

  let otLabel = "";
  if (isOt && a?.overtime_started_at) {
    const otStartMs = new Date(a.overtime_started_at).getTime();
    const otSec = Math.max(0, Math.floor((nowMs - otStartMs) / 1000));
    otLabel = `+${String(Math.floor(otSec / 60)).padStart(2, "0")}:${String(otSec % 60).padStart(2, "0")}`;
  }

  let timerLabel = "--:--";
  let timerColor = preAssignStatus === "in_progress" ? "text-purple-400" : preAssignLabel ? "text-amber-400" : "text-emerald-400";
  if (a && !isOt) {
    const remainingMs = swingDueMs - nowMs;
    if (remainingMs > 0) {
      const secs = Math.floor(remainingMs / 1000);
      timerLabel = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
      if (secs <= 60) timerColor = "text-red-400";
      else if (secs <= 180) timerColor = "text-orange-400";
      else if (secs <= 300) timerColor = "text-amber-400";
    } else if (isPastDue) {
      const overdueSec = Math.floor(Math.abs(remainingMs) / 1000);
      timerLabel = `+${String(Math.floor(overdueSec / 60)).padStart(2, "0")}:${String(overdueSec % 60).padStart(2, "0")}`;
      timerColor = preAssignLabel ? "text-amber-400" : "text-red-400";
    }
  }
  // Warmup overrides the swing countdown for the first grace window.
  if (inWarmup) {
    const warmSec = Math.max(0, Math.floor((warmupUntilMs - nowMs) / 1000));
    timerLabel = `${String(Math.floor(warmSec / 60)).padStart(2, "0")}:${String(warmSec % 60).padStart(2, "0")}`;
    timerColor = "text-sky-400";
  }
  const statusLabel = inWarmup ? "Vào swing sau" : isOt ? "OT" : preAssignLabel ?? (isPastDue ? "Quá hạn" : "còn lại");

  // Status-tone top strip color (UI Phase 4 mockup) — strongest signal wins so
  // the card edge reads at a glance and matches the status-filter chips.
  const topStripColor = isOt ? "bg-red-500"
    : inWarmup ? "bg-sky-500"
    : preAssignStatus === "in_progress" ? "bg-purple-500"
    : tableStatus.tone === "destructive" ? "bg-red-500"
    : tableStatus.tone === "warning" ? "bg-amber-500"
    : tableStatus.tone === "primary" ? "bg-primary"
    : "bg-zinc-600";

  const tableTypeLabel = t.table_type === "high" ? "HIGH" : t.table_type === "tournament" ? "TOUR" : "MED";

  const statusToneClass =
    tableStatus.tone === "destructive" ? "text-red-400 bg-red-500/15 border-red-500/30"
    : tableStatus.tone === "warning" ? "text-amber-400 bg-amber-500/15 border-amber-500/30"
    : tableStatus.tone === "primary" ? "text-primary bg-primary/10 border-primary/30"
    : "text-zinc-400 bg-zinc-800 border-zinc-700";

  // ── Final-handoff guards (lifted verbatim from the action-row IIFE) ──
  const slot0Att = slot0HasDealer ? dealers.find((d) => d.id === slot0!.in_attendance_id) : undefined;
  const slot0EligibleMs = slot0Att?.last_released_at
    ? new Date(slot0Att.last_released_at).getTime() + restMinCfg * 60_000
    : null;
  const replacementNotRested = slot0Locked && slot0EligibleMs != null && slot0EligibleMs > nowMs;
  const swingDisabled = !a || !canSwing || replacementNotRested || swingingAssignmentId === a.id;
  const swingDisabledReason = !canSwing
    ? `Chưa thể chốt đổi: bàn chưa tới giờ đổi (${formatTimeHHmm(actualDueMs)})`
    : replacementNotRested
      ? `Chưa thể chốt đổi: dealer thay chưa đủ thời gian nghỉ — đủ điều kiện lúc ${formatTimeHHmm(slot0EligibleMs)}`
      : undefined;
  const changePredictedTitle = slot0?.status === "executing"
    ? "Đang thực hiện đổi dealer — không thể sửa kế hoạch lúc này"
    : "Đổi dealer thay thế dự kiến cho bàn này (không thực hiện swing)";

  return (
    <div id={`table-card-${t.id}`} className={[
      "relative overflow-hidden border rounded-xl transition-all duration-300",
      isOt ? "border-red-500/60 bg-red-950/20 shadow-[0_0_24px_-8px_rgba(239,68,68,0.35)]" : "border-zinc-700/60 bg-zinc-900/70",
      isAnimating?.(t.id) ? "table-card--swinging" : "",
      focused ? "table-card--focused" : "",
    ].join(" ")}>
      {/* ── Status-tone top strip (replaces progress bar; reads at a glance) ── */}
      <div className={["h-1 w-full", topStripColor].join(" ")} aria-hidden="true" />

      {/* ── Card body ── */}
      <div className="p-3.5 space-y-2.5">
        {/* Header: status chip + table name + type tag + kebab + close */}
        <div className="flex items-center gap-2">
          <span className={["shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border leading-none whitespace-nowrap", statusToneClass].join(" ")}>
            {tableStatus.label}
          </span>
          <span className="text-base font-medium text-zinc-100 truncate">{t.table_name}</span>
          <span className={[
            "shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded leading-none",
            t.table_type === "high"
              ? "bg-rose-500/15 text-rose-400 border border-rose-500/20"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700",
          ].join(" ")}>
            {tableTypeLabel}
          </span>
          <div className="ml-auto flex items-center gap-1 shrink-0">
            {onManualSwing && onForceClose && (
              <TableCardKebab
                tableId={t.id}
                tableName={t.table_name}
                hasActiveAssign={!!a}
                onManualSwing={() => onManualSwing(t.id)}
                onForceClose={() => onForceClose(t.id)}
              />
            )}
            {closeConfirm ? (
              <div className="flex items-center gap-1">
                <button className="text-destructive text-[10px] hover:underline" onClick={onCloseTableConfirm} disabled={closingTable}>
                  Xác nhận
                </button>
                <button className="text-muted-foreground text-[10px] hover:underline" onClick={onCloseTableCancel}>
                  Huỷ
                </button>
              </div>
            ) : (
              <button className="text-zinc-600 hover:text-red-400 p-1" title="Đóng bàn"
                onClick={() => onCloseTableClick(t.id)}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ── Dealer → big countdown (dealer present) / pre-assign / empty ── */}
        {dealer ? (
          <>
            <div className="flex items-center gap-2">
              <div className={["w-2 h-2 rounded-full flex-shrink-0", isOt ? "bg-red-500" : "bg-emerald-500"].join(" ")} />
              <span className="text-sm font-medium text-zinc-100 truncate">{dealer.full_name}</span>
              <span className={[
                "shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded leading-none",
                dealer.tier === "A" ? "bg-amber-500/20 text-amber-400" : dealer.tier === "B" ? "bg-blue-500/20 text-blue-400" : "bg-zinc-800 text-zinc-400",
              ].join(" ")}>
                {dealer.tier}
              </span>
            </div>

            {a && a.assigned_at && (
              <div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className={[
                    "font-serif text-[30px] font-semibold tabular-nums leading-none",
                    isOt ? "text-red-400" : timerColor,
                  ].join(" ")}>
                    {isOt ? otLabel : timerLabel}
                  </span>
                  {overdueState ? (
                    <span className={["text-[10px] uppercase tracking-wider font-medium", overdueState.className].join(" ")}>
                      {overdueState.label}
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                      {statusLabel}
                    </span>
                  )}
                </div>
                {a.swing_due_at && (
                  <div className="text-[9px] text-zinc-600 font-mono mt-1">
                    Swing lúc {new Date(a.swing_due_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
              </div>
            )}
          </>
        ) : preAssigned ? (
          <div className="flex items-center gap-2 text-primary">
            <span className="text-sm">⬆</span>
            <span className="text-sm font-medium truncate">{preAssigned.full_name}</span>
            {preAssignLabel ? (
              <span className={[
                "shrink-0 text-[10px] font-medium",
                preAssignStatus === "in_progress" ? "text-purple-400" : "text-amber-400",
              ].join(" ")}>· {preAssignLabel}</span>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-center py-4 text-zinc-500">
            <svg className="w-8 h-8 mb-1.5 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span className="text-xs text-amber-500/80 mb-2">Đợi dealer</span>
            <Button size="sm" variant="outline" className="text-sm h-11 px-5 text-emerald-500 border-emerald-500/40 hover:bg-emerald-500/10"
              onClick={() => onAssign(t.id)}>
              <Users className="w-4 h-4 mr-1.5" /> Gán dealer
            </Button>
          </div>
        )}

        {/* ── Next dealer inline (inside card body) ── */}
        {/* Schedule slot0 (source of truth) → preAssigned (confirmed) → pred (prediction RPC). */}
        {dealer && (slot0HasDealer || forecastSlots.length > 0 || preAssigned || pred?.nextDealerName) && (
          <>
            <div className="border-t border-zinc-800" />
            {(slot0HasDealer || preAssigned || pred?.nextDealerName) && (
              <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                <span className="text-[10px] text-zinc-500">Tiếp:</span>
                {slot0HasDealer ? (
                  slot0Locked ? (
                    <span className="text-[11px] text-emerald-400 font-medium">
                      <span className="text-emerald-500">✓</span> CHỐT {slot0Name}
                      {slot0ReliefLabel ? (
                        <span className="ml-1 text-emerald-500/80">· {slot0ReliefLabel}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-[11px] text-amber-400">
                      ~ DỰ ĐOÁN {slot0Name}
                      {slot0ReliefLabel ? (
                        <span className="ml-1 text-amber-400/80">· {slot0ReliefLabel}</span>
                      ) : null}
                    </span>
                  )
                ) : preAssigned ? (
                  <span className="text-[11px] text-emerald-400 font-medium">
                    <span className="text-emerald-500">✓</span> {preAssigned.full_name}
                    {preAssignLabel ? (
                      <span className={[
                        "ml-1",
                        preAssignStatus === "in_progress" ? "text-purple-400" : "text-amber-400",
                      ].join(" ")}>· {preAssignLabel}</span>
                    ) : null}
                  </span>
                ) : pred?.nextDealerName ? (
                  pred.confidence === "confirmed" ? (
                    <span className="text-[11px] text-emerald-400 font-medium">
                      <span className="text-emerald-500">✓</span> {pred.nextDealerName}
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-400">~ DỰ ĐOÁN {pred.nextDealerName}</span>
                  )
                ) : null}
                {/* "Đổi" mini-button removed — promoted to the "Đổi dự kiến"
                    action-row button below (same handler, clearer placement). */}
              </div>
            )}
            {forecastSlots.length > 0 && (
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="text-[9px] text-zinc-600 uppercase tracking-wider">~ Dự đoán:</span>
                <span className="text-[10px] text-zinc-500 truncate">
                  {forecastSlots
                    .map((s) => `${s.in_dealer_name ?? "dealer"}${s.planned_relief_at ? ` ${formatTimeHHmm(new Date(s.planned_relief_at).getTime())}` : ""}`)
                    .join(" · ")}
                </span>
              </div>
            )}
          </>
        )}

        {/* ── Action buttons (grouped primary vs correction, ≥44px) ── */}
        <SwingTableActions
          mode={a && a.status === "assigned" ? "assigned" : "empty"}
          isOt={isOt}
          breakDisabled={!!a && processing === a.attendance_id}
          swinging={!!a && swingingAssignmentId === a.id}
          swingDisabled={swingDisabled}
          disabledReason={swingDisabledReason}
          changePredictedDisabled={slot0?.status === "executing"}
          changePredictedTitle={changePredictedTitle}
          wrongTableEnabled={wrongTableEnabled}
          onBreak={() => { if (a) onSendToBreak(a.attendance_id); }}
          onChangePredicted={() => {
            if (!a?.id) { toast.warning("Không tìm thấy ca dealer của bàn này"); return; }
            onChangePredicted(t.id);
          }}
          onConfirmSwing={() => {
            if (!a) return;
            onRequestConfirmSwing({
              assignmentId: a.id,
              tableName: t.table_name ?? "Bàn",
              outName: dealer?.full_name ?? "Dealer hiện tại",
              inName: slot0Locked ? slot0Name : null,
              isOt,
            });
          }}
          onCorrectWrongTable={() => {
            if (!a?.id) { toast.warning("Không tìm thấy ca dealer của bàn này"); return; }
            onCorrectWrongTable(t.id);
          }}
          onAssign={() => onAssign(t.id)}
        />
      </div>
    </div>
  );
}
