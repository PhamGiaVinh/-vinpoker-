/**
 * SwingTableCard — one battle-map table card for the Dealer Control operator
 * panel (UI polish).
 *
 * Compact, scannable, button-less card: status pill + dealer + timer + next +
 * bottom progress, colored by the shared 7-status system (dealerStatusStyle).
 * Clicking the card opens a Popover with the full per-table actions, wired to
 * the SAME parent handlers. PRESENTATION ONLY — all timing/status come from
 * deriveTableSwingView; never changes swing/timer/RPC logic.
 */

import { Trash2, UserRound, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { TableCardKebab } from "../TableCardKebab";
import SwingTableActions from "./SwingTableActions";
import SwingClockRing from "./SwingClockRing";
import { deriveTableSwingView, formatTimeHHmm, type TableTimeline } from "./swingTableView";
import { dealerStatusStyle, type DealerTableStatus } from "./dealerStatusStyle";
import { getPreAssignStatusLabel } from "@/lib/dealerSwingState";
import { OPEN_TABLE_GRACE_MINUTES } from "@/lib/breakPoolState";
import type {
  DealerAssignment, DealerAttendance, PreAssignedInfo, NextDealerPrediction, SwingConfig,
} from "@/hooks/useDealerSwing";
import type { RotationTableSlots } from "@/hooks/useRotationSchedule";
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
  /** Pre-derived 7-status (single source — see deriveDealerTableStatus). */
  dealerStatus: DealerTableStatus;
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
  dealerStatus,
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
  const s = dealerStatusStyle[dealerStatus];

  // ── Shared timing view (single source of truth — see swingTableView) ──
  const {
    swingDurationMs, swingDueMs, actualDueMs, isOt, isPastDue, canSwing,
  } = deriveTableSwingView(t, a, tl, tournaments, swingConfigs, nowMs);

  const preAssignStatus = a?.pre_assign_status ?? "none";
  const preAssignLabel = getPreAssignStatusLabel(preAssignStatus);

  // Open-table warmup: show "Vào swing sau M:SS" ONLY if swing_due_at actually
  // encodes the open-table grace. (perform_swing rotations have no grace.)
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
  const isTableOverdue = !!tl?.isOverdue;

  // Honest overdue state — driven by the rotation schedule (shown in the popover).
  let overdueState: { label: string; className: string } | null = null;
  if (isTableOverdue && a) {
    if (slot0 && slot0Locked && slot0HasDealer) {
      overdueState = {
        label: `✓ CHỐT ${slot0Name}${slot0ReliefLabel ? ` vào ${slot0ReliefLabel}` : ""}`,
        className: "text-success",
      };
    } else if (slot0 && slot0.status === "predicted" && !slot0.is_shortage && slot0HasDealer) {
      overdueState = {
        label: `~ DỰ ĐOÁN ${slot0Name}${slot0ReliefLabel ? ` ${slot0ReliefLabel}` : ""}`,
        className: "text-warning",
      };
    } else {
      const shortageTime = slot0?.is_shortage && slot0.planned_relief_at
        ? formatTimeHHmm(new Date(slot0.planned_relief_at).getTime())
        : null;
      overdueState = {
        label: shortageTime ? `⚠ THIẾU DEALER · dự kiến ${shortageTime}` : "⚠ THIẾU DEALER",
        className: "text-destructive",
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
  let timerColor = preAssignStatus === "in_progress" ? "text-[hsl(var(--ds-preassign))]" : preAssignLabel ? "text-warning" : "text-success";
  if (a && !isOt) {
    const remainingMs = swingDueMs - nowMs;
    if (remainingMs > 0) {
      const secs = Math.floor(remainingMs / 1000);
      timerLabel = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
      if (secs <= 60) timerColor = "text-destructive";
      else if (secs <= 180) timerColor = "text-warning";
      else if (secs <= 300) timerColor = "text-warning";
    } else if (isPastDue) {
      const overdueSec = Math.floor(Math.abs(remainingMs) / 1000);
      timerLabel = `+${String(Math.floor(overdueSec / 60)).padStart(2, "0")}:${String(overdueSec % 60).padStart(2, "0")}`;
      timerColor = preAssignLabel ? "text-warning" : "text-destructive";
    }
  }
  if (inWarmup) {
    const warmSec = Math.max(0, Math.floor((warmupUntilMs - nowMs) / 1000));
    timerLabel = `${String(Math.floor(warmSec / 60)).padStart(2, "0")}:${String(warmSec % 60).padStart(2, "0")}`;
    timerColor = "text-[hsl(var(--ds-active))]";
  }
  const remainingDisplay = isOt ? otLabel : timerLabel;

  // Progress along the current swing window (presentation only).
  let progressPct = 0;
  if (a && a.assigned_at) {
    const totalMs = swingDueMs - new Date(a.assigned_at).getTime();
    const elapsedMs = nowMs - new Date(a.assigned_at).getTime();
    progressPct = totalMs > 0 ? Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100)) : 0;
  }

  const dealerLabel = dealer?.full_name ?? (preAssigned ? preAssigned.full_name : null);
  // Predicted relief dealer — name + entry time kept SEPARATE so the time is
  // never truncated away when the name is long (one purple "Dự kiến" label only).
  const nextName = slot0HasDealer
    ? slot0Name
    : preAssigned
      ? preAssigned.full_name
      : pred?.nextDealerName ?? null;
  const nextTime = slot0HasDealer ? slot0ReliefLabel : null;

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
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={`table-card-${t.id}`}
          className={cn(
            "group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border p-3 text-left transition",
            "bg-gradient-card shadow-card hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            s.border,
            !a && "border-dashed",
            isOt && "shadow-neon",
            isAnimating?.(t.id) && "table-card--swinging",
            focused && "ring-2 ring-primary/80 shadow-neon",
          )}
        >
          {/* ① Vòng đồng hồ swing (signature) */}
          <SwingClockRing
            fraction={a ? progressPct / 100 : 0}
            colorClass={isOt ? "text-destructive" : timerColor}
            label={a && a.assigned_at ? remainingDisplay : "—"}
            caption={!a ? "TRỐNG" : isOt ? "OT" : inWarmup ? "WARMUP" : "CÒN"}
            glow={isOt || dealerStatus === "stable"}
            empty={!a}
            size={56}
          />

          {/* ② tên bàn · ③ dealer · ④ badge trạng thái */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold text-foreground">{t.table_name}</span>
              {(dealerStatus === "missing" || dealerStatus === "overdue") && (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
              {dealerLabel ? (
                <span className="truncate text-muted-foreground">
                  {preAssigned && !dealer ? "⬆ " : ""}{dealerLabel}
                </span>
              ) : (
                <span className="truncate text-warning/90">Chưa gán</span>
              )}
            </div>
            <span className={cn("mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", s.bg, s.text)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden="true" />
              {s.label}
            </span>
            {dealer && nextName && (
              <div className="mt-1 flex items-baseline gap-1 text-[11px] leading-tight">
                <span className="shrink-0 text-[hsl(var(--ds-preassign))]" aria-hidden="true">→</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{nextName}</span>
                {nextTime && (
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{nextTime}</span>
                )}
              </div>
            )}
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 border-border bg-card p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{t.table_name}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {dealer ? dealer.full_name : preAssigned ? `⬆ ${preAssigned.full_name}` : "Chưa gán"}
            </div>
          </div>
          <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium", s.border, s.bg, s.text)}>
            {s.label}
          </span>
        </div>

        {overdueState && (
          <div className={cn("mb-2 font-mono text-[11px]", overdueState.className)}>{overdueState.label}</div>
        )}

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

        {/* Secondary: manual swing / force close (kebab) + close table */}
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
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
              <Button size="sm" variant="ghost" className="h-9 text-xs text-destructive" disabled={closingTable} onClick={onCloseTableConfirm}>
                Xác nhận đóng
              </Button>
              <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={onCloseTableCancel}>Huỷ</Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="h-9 text-xs text-muted-foreground hover:text-destructive" onClick={() => onCloseTableClick(t.id)}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Đóng bàn
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
