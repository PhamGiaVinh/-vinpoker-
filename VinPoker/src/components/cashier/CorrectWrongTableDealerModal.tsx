/**
 * CorrectWrongTableDealerModal — "Sửa nhầm bàn" (Dealer Swing, #33C).
 *
 * REALITY correction: the dealer recorded at this table is not the dealer
 * actually dealing. Distinct from ChangePredictedDealerModal ("Đổi dự kiến"),
 * which only edits the PLANNED replacement and never touches active rows.
 *
 * Backend: reconcile_dealer_room_state (SECURITY DEFINER, applied live
 * 2026-06-13; club-scope fix 20260818000002). Flow: dry-run preview first
 * (lockless, zero writes) → render the server's plan/conflicts → atomic apply
 * with the CAS echo (expected_assignment_id/expected_version from the
 * dry-run plan) — a concurrent change returns race_lost and we re-preview.
 * The server re-validates everything; this UI builds payloads and displays.
 */
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Clock } from "lucide-react";
import type { DealerAssignment, DealerAttendance, GameTableRow } from "@/hooks/useDealerSwing";
import { classifyCandidate } from "@/lib/rotationEligibility";

function hhmm(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "--:--";
  return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const QUICK_MINUTES = [5, 10, 15] as const;

const DISPLACED_OPTIONS = [
  { value: "pool_available", label: "Về pool (sẵn sàng nhận bàn)" },
  { value: "on_break", label: "Cho nghỉ giải lao" },
  { value: "unknown_needs_floor_check", label: "Chưa rõ — giữ lại, floor kiểm tra" },
  { value: "no_show", label: "Không có mặt (no-show)" },
] as const;

const ACTION_LABELS: Record<string, string> = {
  move: "Chuyển bàn",
  assign: "Gán mới",
  release: "Giải phóng",
  already_correct: "Đã đúng",
  blocked: "Bị chặn",
};

const CONFLICT_LABELS: Record<string, string> = {
  effective_at_before_assignment: "Thời điểm sửa sớm hơn lúc dealer được gán — kiểm tra lại giờ",
  dealer_active_elsewhere: "Dealer đang được ghi ở bàn khác chưa nằm trong sửa đổi (trạng thái vừa thay đổi?)",
  empty_not_confirmed: "Bàn sẽ trống nhưng chưa được xác nhận trống",
  displaced_unresolved: "Dealer bị thay chưa có hướng xử lý",
};

interface PlanRow {
  table_id: string;
  action: string;
  current_attendance_id?: string | null;
  actual_attendance_id?: string | null;
  expected_assignment_id?: string | null;
  expected_version?: number | null;
}

interface ConflictRow {
  type?: string;
  [k: string]: unknown;
}

/** Loose shape of reconcile_dealer_room_state's jsonb result (server-authoritative). */
interface ReconcileResult {
  outcome?: string;
  detail?: string;
  can_apply?: boolean;
  plan?: PlanRow[];
  conflicts?: ConflictRow[];
  summary?: { released?: number; moved?: number; assigned?: number; displaced?: number; slots_superseded?: number };
}

type CorrectionEntry = Record<string, unknown>;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface CorrectWrongTableDealerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  tableId: string;
  tableName: string;
  /** Active assignment recorded at this table (dealer B), if any. */
  recordedAssignment: DealerAssignment | null;
  dealers: DealerAttendance[];
  tables: GameTableRow[];
  tableAssignmentMap: Record<string, DealerAssignment | null>;
  restMinutes: number;
  onApplied: () => void;
}

export default function CorrectWrongTableDealerModal({
  open, onOpenChange, clubId, tableId, tableName,
  recordedAssignment, dealers, tables, tableAssignmentMap, restMinutes, onApplied,
}: CorrectWrongTableDealerModalProps) {
  const [actualId, setActualId] = useState<string | null>(null);
  const [minutesAgo, setMinutesAgo] = useState<number>(10);
  const [customTime, setCustomTime] = useState<string>(""); // datetime-local; "" = use minutesAgo
  const [note, setNote] = useState<string>("");
  const [swapToOrigin, setSwapToOrigin] = useState<boolean>(true);
  const [displacedRes, setDisplacedRes] = useState<string>("pool_available");
  const [adminOverride, setAdminOverride] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ plan: PlanRow[]; conflicts: ConflictRow[]; can_apply: boolean } | null>(null);

  const nameOf = (attId: string | null | undefined): string =>
    attId ? dealers.find((d) => d.id === attId)?.dealers?.full_name ?? "Dealer" : "—";
  const tableNameOf = (tid: string): string =>
    tid === tableId ? tableName : tables.find((t) => t.id === tid)?.table_name ?? "Bàn";

  const recordedBId = recordedAssignment?.attendance_id ?? null;

  // Candidates: checked-in dealers of this club (the recorded dealer stays
  // selectable — picking them is a valid "already correct" no-op check).
  const candidates = useMemo(
    () => dealers.filter((d) => d.status === "checked_in" && d.dealers?.club_id === clubId),
    [dealers, clubId],
  );

  // Where is the chosen actual dealer (A) recorded right now?
  const aActiveAtTableId = useMemo(() => {
    if (!actualId) return null;
    for (const [tid, asg] of Object.entries(tableAssignmentMap)) {
      if (tid !== tableId && asg && asg.attendance_id === actualId) return tid;
    }
    return null;
  }, [actualId, tableAssignmentMap, tableId]);

  const effectiveAtMs = useMemo(() => {
    if (customTime) {
      const t = new Date(customTime).getTime();
      return Number.isFinite(t) ? t : null;
    }
    return Date.now() - minutesAgo * 60_000;
  }, [customTime, minutesAgo]);

  const effectiveTooFuture = effectiveAtMs != null && effectiveAtMs > Date.now() + 60_000;
  const effectiveTooOld = effectiveAtMs != null && effectiveAtMs < Date.now() - 120 * 60_000;

  // Advisory only — a correction RECORDS reality, the rest warning just informs.
  const restWarning = useMemo(() => {
    if (!actualId || effectiveAtMs == null) return null;
    const a = dealers.find((d) => d.id === actualId);
    if (!a) return null;
    const c = classifyCandidate({
      lastReleasedAt: a.last_released_at,
      currentState: a.current_state,
      attendanceStatus: a.status,
      plannedReliefAtMs: effectiveAtMs,
      restMinutes,
      nowMs: Date.now(),
    });
    return c.group === "resting_not_eligible"
      ? `Lưu ý: ${nameOf(actualId)} đang trong thời gian nghỉ (đủ điều kiện lúc ${hhmm(c.eligibleAtMs)}).`
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualId, effectiveAtMs, dealers, restMinutes]);

  // The displaced-resolution select is needed when B exists and is NOT being
  // re-seated by the payload (swap covers them; A==B means nobody is displaced).
  const needsDisplacedRes =
    !!recordedBId && recordedBId !== actualId && !(aActiveAtTableId && swapToOrigin);

  const fullReason = note.trim()
    ? `Dealer vào nhầm bàn — ${note.trim()}`
    : "Dealer vào nhầm bàn";

  /** Payload matrix — see PR description / plan. CAS echo attached on apply. */
  const buildPayload = (casPlan: PlanRow[] | null) => {
    const corrections: CorrectionEntry[] = [{ table_id: tableId, actual_attendance_id: actualId }];
    const displaced: CorrectionEntry[] = [];
    if (aActiveAtTableId) {
      if (swapToOrigin && recordedBId && recordedBId !== actualId) {
        corrections.push({ table_id: aActiveAtTableId, actual_attendance_id: recordedBId });
      } else {
        corrections.push({ table_id: aActiveAtTableId, actual_attendance_id: null, confirm_empty: true });
      }
    }
    if (needsDisplacedRes) {
      displaced.push({ attendance_id: recordedBId, resolution: displacedRes, reason: fullReason });
    }
    if (casPlan) {
      for (const c of corrections) {
        const p = casPlan.find((r) => r.table_id === c.table_id);
        if (p?.expected_assignment_id) c.expected_assignment_id = p.expected_assignment_id;
        if (p?.expected_version != null) c.expected_version = p.expected_version;
      }
    }
    return { corrections, displaced };
  };

  const callRpc = async (dryRun: boolean, casPlan: PlanRow[] | null) => {
    const { corrections, displaced } = buildPayload(casPlan);
    // Untyped RPC: not in generated types yet (same pattern as set_rotation_slot_dealer).
    const { data, error } = await (supabase as any).rpc("reconcile_dealer_room_state", {
      p_club_id: clubId,
      p_corrections: corrections,
      p_effective_at: new Date(effectiveAtMs!).toISOString(),
      p_reason: fullReason,
      p_displaced: displaced,
      p_dry_run: dryRun,
      p_admin_override: adminOverride,
    });
    if (error) throw new Error(error.message);
    return data as ReconcileResult;
  };

  const runPreview = async () => {
    if (!actualId || effectiveAtMs == null || busy) return;
    setBusy(true);
    setInlineError(null);
    try {
      const r = await callRpc(true, null);
      switch (r?.outcome) {
        case "dry_run":
          setPreview({ plan: r.plan ?? [], conflicts: r.conflicts ?? [], can_apply: !!r.can_apply });
          break;
        case "dealer_not_checked_in":
          setInlineError("Dealer này chưa check-in tại club — không thể ghi nhận.");
          break;
        case "dealer_duplicate_in_payload":
          setInlineError("Cùng một dealer đang được ghi ở hai bàn trong sửa đổi.");
          break;
        case "effective_at_future":
          setInlineError("Thời điểm sửa nằm trong tương lai — kiểm tra lại giờ.");
          break;
        case "effective_at_too_old":
          setInlineError("Quá 120 phút — cần quyền admin (bật ô bên dưới nếu bạn là admin).");
          break;
        case "override_forbidden":
          setInlineError("Chỉ admin mới được sửa quá 120 phút.");
          break;
        case "forbidden":
          setInlineError("Bạn không có quyền sửa thực tế phòng cho club này.");
          break;
        case "noop":
          toast.info("Trạng thái hệ thống đã khớp với thực tế — không cần sửa.");
          break;
        default:
          setInlineError(`Không xem trước được: ${r?.detail ?? r?.outcome ?? "lỗi không xác định"}`);
      }
    } catch (e) {
      setInlineError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    if (!preview?.can_apply || busy) return;
    setBusy(true);
    try {
      const r = await callRpc(false, preview.plan);
      switch (r?.outcome) {
        case "applied": {
          const s = r.summary ?? {};
          toast.success(`Đã sửa nhầm bàn cho ${tableName}.`, {
            description: `Chuyển bàn: ${s.moved ?? 0} · Gán mới: ${s.assigned ?? 0} · Giải phóng: ${s.released ?? 0} · Slot lập lại: ${s.slots_superseded ?? 0}. Đã ghi audit.`,
          });
          onApplied();
          close(false);
          break;
        }
        case "noop":
          toast.info("Trạng thái hệ thống đã khớp với thực tế — không cần sửa.");
          close(false);
          break;
        case "race_lost":
          toast.warning("Trạng thái phòng vừa thay đổi — đang xem trước lại.");
          setPreview(null);
          await runPreview();
          break;
        case "forbidden":
        case "override_forbidden":
          toast.error("Bạn không có quyền thực hiện sửa đổi này.");
          break;
        default:
          toast.error(`Không sửa được: ${r?.detail ?? r?.outcome ?? "lỗi không xác định"}`);
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const close = (o: boolean) => {
    if (!o) {
      setActualId(null); setMinutesAgo(10); setCustomTime(""); setNote("");
      setSwapToOrigin(true); setDisplacedRes("pool_available");
      setAdminOverride(false); setPreview(null); setInlineError(null);
    }
    onOpenChange(o);
  };

  const previewHasRelease = preview?.plan.some((p) => p.action === "release") || (preview && needsDisplacedRes);
  const previewAllMoves = preview && preview.plan.length > 0 &&
    preview.plan.every((p) => p.action === "move" || p.action === "already_correct");

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sửa dealer nhầm bàn — {tableName}</DialogTitle>
          <DialogDescription>
            Sửa LỊCH THỰC TẾ: ghi đúng dealer đang chia bàn này và xử lý dealer bị ghi nhầm.
            Khác với "Đổi dự kiến" (chỉ đổi kế hoạch).
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          /* ── Step 1: input ─────────────────────────────────────────── */
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="text-xs border border-border bg-muted/20 p-2">
              <span className="text-muted-foreground">Hệ thống đang ghi:</span>{" "}
              <span className="font-medium">{recordedBId ? nameOf(recordedBId) : "Bàn trống"}</span>
            </div>

            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Dealer đang chia thực tế</div>
              <div className="space-y-1.5 max-h-[24vh] overflow-y-auto pr-1">
                {candidates.length === 0 && (
                  <div className="text-sm text-warning">Không có dealer nào đang check-in.</div>
                )}
                {candidates.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setActualId(d.id)}
                    className={[
                      "w-full flex items-center justify-between gap-2 p-2 border rounded-none text-left",
                      actualId === d.id
                        ? "border-orange-500/60 bg-orange-500/10"
                        : "border-border bg-muted/20 hover:border-orange-500/40",
                    ].join(" ")}
                  >
                    <span className="text-sm font-medium truncate">
                      {d.dealers?.full_name ?? "?"}
                      {d.id === recordedBId ? <span className="text-muted-foreground"> (đang ghi ở bàn này)</span> : null}
                    </span>
                    {d.dealers?.tier ? (
                      <Badge variant="outline" className="text-[10px] shrink-0">{d.dealers.tier}</Badge>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Đã chia từ lúc</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {QUICK_MINUTES.map((m) => (
                  <Button key={m} size="sm" variant="outline"
                    className={[
                      "text-xs h-7",
                      !customTime && minutesAgo === m ? "border-orange-500/60 text-orange-400" : "",
                    ].join(" ")}
                    onClick={() => { setMinutesAgo(m); setCustomTime(""); }}>
                    {m} phút trước
                  </Button>
                ))}
                <input
                  type="datetime-local"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                  className="text-xs h-7 bg-muted/20 border border-border px-1.5"
                  aria-label="Nhập tay thời điểm bắt đầu chia"
                />
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Ghi nhận từ: <span className="font-medium">{hhmm(effectiveAtMs)}</span>
                {effectiveTooFuture && <span className="text-red-400"> — không được ở tương lai</span>}
                {effectiveTooOld && <span className="text-amber-400"> — quá 120 phút, cần quyền admin</span>}
              </div>
            </div>

            {actualId && aActiveAtTableId && (
              <div className="text-xs border border-amber-500/30 bg-amber-500/10 p-2 space-y-1.5">
                <div>
                  <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5 text-amber-400" />
                  {nameOf(actualId)} đang được ghi ở <span className="font-semibold">{tableNameOf(aActiveAtTableId)}</span>.
                </div>
                {recordedBId && recordedBId !== actualId ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={swapToOrigin} onChange={(e) => setSwapToOrigin(e.target.checked)} />
                    <span>Chuyển {nameOf(recordedBId)} sang {tableNameOf(aActiveAtTableId)} (đổi chéo)</span>
                  </label>
                ) : (
                  <div>{tableNameOf(aActiveAtTableId)} sẽ trống (tự xác nhận khi áp dụng).</div>
                )}
                {recordedBId && recordedBId !== actualId && !swapToOrigin && (
                  <div>{tableNameOf(aActiveAtTableId)} sẽ trống (tự xác nhận khi áp dụng).</div>
                )}
              </div>
            )}

            {needsDisplacedRes && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1.5">
                  Xử lý {nameOf(recordedBId)} (dealer bị ghi nhầm)
                </div>
                <select
                  value={displacedRes}
                  onChange={(e) => setDisplacedRes(e.target.value)}
                  className="w-full text-xs h-8 bg-muted/20 border border-border px-1.5"
                >
                  {DISPLACED_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Ghi chú (tùy chọn)</div>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder='Lý do mặc định: "Dealer vào nhầm bàn"'
                className="w-full text-xs h-8 bg-muted/20 border border-border px-1.5"
              />
            </div>

            {restWarning && (
              <div className="text-[11px] text-amber-400">
                <Clock className="inline w-3 h-3 mr-0.5 -mt-0.5" />{restWarning}
              </div>
            )}
            {effectiveTooOld && (
              <label className="flex items-center gap-2 text-[11px] text-amber-400 cursor-pointer">
                <input type="checkbox" checked={adminOverride} onChange={(e) => setAdminOverride(e.target.checked)} />
                Tôi là admin — cho phép sửa quá 120 phút (server sẽ kiểm tra quyền)
              </label>
            )}
            {inlineError && <div className="text-xs text-red-400">{inlineError}</div>}

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => close(false)} disabled={busy}>Hủy</Button>
              <Button size="sm" onClick={runPreview}
                disabled={busy || !actualId || effectiveAtMs == null || effectiveTooFuture}>
                {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                Xem trước
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* ── Step 2: preview / confirm ─────────────────────────────── */
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="text-xs font-semibold text-muted-foreground">Hệ thống sẽ:</div>
            <div className="space-y-1.5">
              {preview.plan.map((p) => (
                <div key={p.table_id} className="text-xs border border-border bg-muted/20 p-2">
                  <span className="font-semibold">{tableNameOf(p.table_id)}</span>:{" "}
                  {nameOf(p.current_attendance_id) } → <span className="font-medium">{nameOf(p.actual_attendance_id)}</span>
                  <Badge variant="outline" className="ml-1.5 text-[10px]">{ACTION_LABELS[p.action] ?? p.action}</Badge>
                </div>
              ))}
              {needsDisplacedRes && (
                <div className="text-xs border border-border bg-muted/20 p-2">
                  <span className="font-semibold">{nameOf(recordedBId)}</span>:{" "}
                  {DISPLACED_OPTIONS.find((o) => o.value === displacedRes)?.label}
                </div>
              )}
            </div>

            <div className="text-[11px] text-muted-foreground space-y-1">
              {previewAllMoves && <div>Phút làm việc giữ nguyên — chỉ đổi bàn, không đổi thời gian.</div>}
              {previewHasRelease && (
                <div>
                  {nameOf(recordedBId)} dừng tính phút tại {hhmm(effectiveAtMs)};{" "}
                  {nameOf(actualId)} được ghi nhận từ {hhmm(effectiveAtMs)}.
                </div>
              )}
              <div>Slot dự kiến của các bàn liên quan sẽ được lập lại.</div>
            </div>

            {preview.conflicts.length > 0 && (
              <div className="space-y-1">
                {preview.conflicts.map((c, i) => (
                  <div key={i} className="text-xs text-red-400">
                    <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5" />
                    {CONFLICT_LABELS[c?.type] ?? c?.type ?? "Xung đột không xác định"}
                  </div>
                ))}
              </div>
            )}

            <div className="text-[11px] text-amber-400">
              Hành động này sửa lịch thực tế và sẽ được ghi audit.
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setPreview(null)} disabled={busy}>
                Quay lại
              </Button>
              <Button size="sm" onClick={runApply} disabled={busy || !preview.can_apply}
                className="bg-orange-600 hover:bg-orange-700 text-white">
                {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                Xác nhận sửa nhầm bàn
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
