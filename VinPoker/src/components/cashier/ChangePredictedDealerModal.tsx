/**
 * ChangePredictedDealerModal — "Đổi & CHỐT dealer thay thế" (Dealer Swing, Phase 4).
 *
 * Planning-only action: changes WHICH dealer is planned/locked as the next
 * replacement for one table. It never executes the handoff, never releases
 * the current table dealer, and never moves the planned swing time.
 *
 * Honest semantics: confirming LOCKS the choice (predicted → announced/CHỐT)
 * so the rotation planner cannot supersede the floor's decision on the next
 * tick — hence "Đổi & CHỐT", not just "đổi dự kiến".
 *
 * Server authority: candidate grouping below is advisory display only
 * (src/lib/rotationEligibility.ts). The set_rotation_slot_dealer RPC
 * re-validates everything; its outcome is final.
 */
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, RefreshCw, Clock } from "lucide-react";
import type { DealerAttendance } from "@/hooks/useDealerSwing";
import type { RotationScheduleRow } from "@/hooks/useRotationSchedule";
import { classifyCandidate, type CandidateGroup } from "@/lib/rotationEligibility";

function hhmm(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "--:--";
  return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

interface CandidateRow {
  attendance: DealerAttendance;
  group: CandidateGroup;
  eligibleAtMs: number | null;
  selectable: boolean;
  reason: string;
}

export interface ChangePredictedDealerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableName: string;
  /** Live slot-0 schedule row (predicted or announced). */
  slot0: RotationScheduleRow | null | undefined;
  /** Attendance id of the dealer currently dealing this table (excluded from candidates). */
  currentTableAttendanceId: string | null;
  dealers: DealerAttendance[];
  /** attendance_id → table name, for "đang assigned Bàn N" reasons. */
  assignedTableNameByAttendanceId: Record<string, string>;
  restMinutes: number;
  onChanged: () => void;
}

export default function ChangePredictedDealerModal({
  open, onOpenChange, tableName, slot0, currentTableAttendanceId,
  dealers, assignedTableNameByAttendanceId, restMinutes, onChanged,
}: ChangePredictedDealerModalProps) {
  const [pendingId, setPendingId] = useState<string | null>(null); // selected, awaiting confirm
  const [busy, setBusy] = useState(false);

  const plannedReliefMs = slot0?.planned_relief_at ? new Date(slot0.planned_relief_at).getTime() : null;
  const oldName = slot0?.in_dealer_name ?? "dealer hiện dự kiến";

  const candidates: CandidateRow[] = useMemo(() => {
    if (!slot0 || plannedReliefMs == null) return [];
    const nowMs = Date.now();
    const rows: CandidateRow[] = [];
    for (const d of dealers) {
      if (d.id === currentTableAttendanceId) continue; // dealer currently ON this table
      if (d.id === slot0.in_attendance_id) continue; // already the planned replacement
      const c = classifyCandidate({
        lastReleasedAt: d.last_released_at,
        currentState: d.current_state,
        attendanceStatus: d.status,
        plannedReliefAtMs: plannedReliefMs,
        restMinutes,
        nowMs,
      });
      let reason = "";
      switch (c.group) {
        case "ready_now":
          reason = "Sẵn sàng ngay";
          break;
        case "eligible_before_swing":
          reason = `Đang nghỉ — đủ điều kiện lúc ${hhmm(c.eligibleAtMs)}, swing lúc ${hhmm(plannedReliefMs)}`;
          break;
        case "resting_not_eligible":
          reason = `Chưa đủ nghỉ: cần tới ${hhmm(c.earliestEntryMs)} (swing lúc ${hhmm(plannedReliefMs)})`;
          break;
        case "busy_assigned":
          reason = assignedTableNameByAttendanceId[d.id]
            ? `Đang assigned ${assignedTableNameByAttendanceId[d.id]}`
            : "Đang assigned bàn khác";
          break;
        case "busy_pre_assigned":
          reason = "Đã CHỐT cho bàn khác";
          break;
        case "on_break":
          reason = "Đang nghỉ giải lao — kết thúc break trước";
          break;
        default:
          reason = "Không khả dụng";
      }
      rows.push({
        attendance: d,
        group: c.group,
        eligibleAtMs: c.eligibleAtMs,
        selectable: c.group === "ready_now" || c.group === "eligible_before_swing",
        reason,
      });
    }
    // Sort: ready now (longest-rested first) → future-eligible (soonest first) → disabled.
    const groupRank: Record<CandidateGroup, number> = {
      ready_now: 0, eligible_before_swing: 1, resting_not_eligible: 2,
      busy_assigned: 3, busy_pre_assigned: 4, on_break: 5, unavailable: 6,
    };
    rows.sort((a, b) => {
      const g = groupRank[a.group] - groupRank[b.group];
      if (g !== 0) return g;
      if (a.group === "ready_now") {
        return (a.eligibleAtMs ?? 0) - (b.eligibleAtMs ?? 0); // older release = longer rested first
      }
      return (a.eligibleAtMs ?? Infinity) - (b.eligibleAtMs ?? Infinity);
    });
    return rows;
  }, [slot0, plannedReliefMs, dealers, currentTableAttendanceId, restMinutes, assignedTableNameByAttendanceId]);

  const pending = candidates.find((c) => c.attendance.id === pendingId) ?? null;

  const close = (o: boolean) => {
    if (!o) setPendingId(null);
    onOpenChange(o);
  };

  const confirm = async () => {
    if (!slot0 || !pending || busy) return;
    setBusy(true);
    try {
      // Untyped RPC: not in generated types yet (same pattern as useRotationSchedule).
      const { data, error } = await (supabase as any).rpc("set_rotation_slot_dealer", {
        p_schedule_id: slot0.id,
        p_schedule_version: slot0.version,
        p_new_attendance_id: pending.attendance.id,
        p_reason: "floor_manual_change",
      });
      if (error) {
        toast.error(`Lỗi đổi dealer thay thế: ${error.message}`);
        return;
      }
      const r = data as any;
      const newName = pending.attendance.dealers?.full_name ?? "dealer mới";
      switch (r?.outcome) {
        case "changed":
          toast.success(`Đã đổi & CHỐT dealer thay thế: ${oldName} → ${newName}`, {
            description:
              r?.was_announced
                ? "Tin Telegram cũ không thu hồi được — đã gửi thông báo cho dealer mới."
                : "Đã gửi thông báo cho dealer mới.",
          });
          onChanged();
          close(false);
          break;
        case "noop_same_dealer":
          toast.info("Dealer này đã là người thay dự kiến.");
          break;
        case "race_lost":
          toast.warning("Kế hoạch vừa được cập nhật — thử lại.");
          break;
        case "not_eligible":
          // Server is authoritative: show ITS eligible_at, not the client estimate.
          toast.warning(
            `Chưa thể chọn: dealer chưa đủ thời gian nghỉ — đủ điều kiện lúc ${
              r?.eligible_at ? hhmm(new Date(r.eligible_at).getTime()) : "--:--"
            }.`
          );
          break;
        case "dealer_already_locked":
          toast.warning("Dealer này vừa được CHỐT cho bàn khác.");
          break;
        case "dealer_unavailable":
          toast.warning("Dealer không còn khả dụng (đã đổi trạng thái).");
          break;
        case "forbidden":
          toast.error("Bạn không có quyền đổi dealer thay thế cho club này.");
          break;
        default:
          toast.error(`Không đổi được: ${r?.detail ?? r?.outcome ?? "lỗi không xác định"}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const groupHeaders: Array<{ key: CandidateGroup[]; label: string }> = [
    { key: ["ready_now"], label: "Sẵn sàng ngay" },
    { key: ["eligible_before_swing"], label: "Đang nghỉ — kịp giờ swing" },
    { key: ["resting_not_eligible", "busy_assigned", "busy_pre_assigned", "on_break", "unavailable"], label: "Không chọn được" },
  ];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Đổi &amp; CHỐT dealer thay thế — {tableName}</DialogTitle>
          <DialogDescription>
            Chỉ thay đổi kế hoạch: dealer đang chia vẫn giữ bàn, giờ swing giữ nguyên
            {plannedReliefMs ? ` (${hhmm(plannedReliefMs)})` : ""}. Handoff thật vẫn chờ "Chốt đổi dealer".
          </DialogDescription>
        </DialogHeader>

        {!slot0 ? (
          <div className="text-sm text-muted-foreground">Bàn này chưa có kế hoạch thay dealer.</div>
        ) : pending ? (
          /* ── Confirm step ─────────────────────────────────────────── */
          <div className="space-y-3">
            <div className="text-sm">
              Đổi và CHỐT dealer thay thế từ <span className="font-semibold">{oldName}</span> sang{" "}
              <span className="font-semibold">{pending.attendance.dealers?.full_name}</span> cho{" "}
              <span className="font-semibold">{tableName}</span>?
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Giờ swing giữ nguyên: {hhmm(plannedReliefMs)}.</div>
              <div>Dealer mới sẽ được giữ slot này và không bị planner thay lại.</div>
              {pending.group === "eligible_before_swing" && (
                <div className="text-amber-400">
                  Dealer đang nghỉ — đủ điều kiện lúc {hhmm(pending.eligibleAtMs)}.
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setPendingId(null)} disabled={busy}>
                Quay lại
              </Button>
              <Button size="sm" onClick={confirm} disabled={busy}>
                {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                Đổi &amp; CHỐT
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* ── Candidate list ───────────────────────────────────────── */
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {candidates.length === 0 && (
              <div className="text-sm text-warning">Không có dealer nào trong ca.</div>
            )}
            {groupHeaders.map(({ key, label }) => {
              const rows = candidates.filter((c) => key.includes(c.group));
              if (rows.length === 0) return null;
              return (
                <div key={label}>
                  <div className="text-xs font-semibold text-muted-foreground mb-1.5">{label}</div>
                  <div className="space-y-1.5">
                    {rows.map((c) => (
                      <button
                        key={c.attendance.id}
                        type="button"
                        disabled={!c.selectable}
                        onClick={() => c.selectable && setPendingId(c.attendance.id)}
                        className={[
                          "w-full flex items-center justify-between gap-2 p-2 border rounded-none text-left",
                          c.selectable
                            ? "border-border bg-muted/20 hover:border-primary/50 cursor-pointer"
                            : "border-border/50 bg-muted/10 opacity-60 cursor-not-allowed",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {c.attendance.dealers?.full_name ?? "?"}
                          </div>
                          <div className={[
                            "text-[11px] truncate",
                            c.group === "eligible_before_swing" ? "text-amber-400" : "text-muted-foreground",
                          ].join(" ")}>
                            {c.group === "eligible_before_swing" && <Clock className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
                            {c.reason}
                          </div>
                        </div>
                        {c.attendance.dealers?.tier ? (
                          <Badge variant="outline" className="text-[10px] shrink-0">{c.attendance.dealers.tier}</Badge>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
