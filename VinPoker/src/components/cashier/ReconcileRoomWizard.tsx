/**
 * ReconcileRoomWizard — "Sửa domino nhiều bàn" (#33F).
 *
 * Room-level multi-table wrong-table correction. When 2–3+ tables drift before
 * the floor notices, this builds ONE atomic `reconcile_dealer_room_state`
 * payload (the same LIVE RPC the per-table modal calls) and applies it after a
 * server dry-run preview. There is NO per-table partial apply — the whole
 * domino is corrected in a single transaction.
 *
 * The local move-graph classifier (roomReconcileGraph) labels the correction
 * (swap / cycle / chain / one-sided) for the operator; the SERVER dry-run is
 * authoritative for can_apply.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Clock, Plus } from "lucide-react";
import type { DealerAssignment, DealerAttendance, GameTableRow } from "@/hooks/useDealerSwing";
import { classifyCandidate } from "@/lib/rotationEligibility";
import {
  QUICK_MINUTES, DISPLACED_OPTIONS, ACTION_LABELS, CONFLICT_LABELS,
  hhmm, errMsg, computeEffectiveAtMs, isTooFuture, isTooOld, attachCas, callReconcile,
  type PlanRow, type ConflictRow, type CorrectionEntry,
} from "@/lib/roomReconcile";
import {
  classifyRoomReconcile, type ComponentKind, type ReconcileInputRow,
} from "@/lib/roomReconcileGraph";

const EMPTY = "__EMPTY__"; // dropdown sentinel: mark table empty (confirm_empty)

const KIND_LABELS: Record<ComponentKind, string> = {
  already_correct: "Đã đúng",
  one_sided_assign: "Gán mới",
  one_sided_release: "Giải phóng",
  swap: "Đổi chéo 2 bàn",
  cycle: "Xoay vòng nhiều bàn",
  chain: "Chuỗi chuyển",
};

export interface ReconcileRoomWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  dealers: DealerAttendance[];
  tables: GameTableRow[];
  tableAssignmentMap: Record<string, DealerAssignment | null>;
  restMinutes: number;
  onApplied: () => void;
}

export default function ReconcileRoomWizard({
  open, onOpenChange, clubId, dealers, tables, tableAssignmentMap, restMinutes, onApplied,
}: ReconcileRoomWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedTableIds, setSelectedTableIds] = useState<Set<string>>(new Set());
  const [actualByTable, setActualByTable] = useState<Record<string, string | null>>({}); // null = empty; absent = unset
  const [displacedRes, setDisplacedRes] = useState<Record<string, string>>({});
  const [minutesAgo, setMinutesAgo] = useState(10);
  const [customTime, setCustomTime] = useState("");
  const [note, setNote] = useState("");
  const [adminOverride, setAdminOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ plan: PlanRow[]; conflicts: ConflictRow[]; can_apply: boolean } | null>(null);

  const nameOf = (attId: string | null | undefined): string =>
    attId ? dealers.find((d) => d.id === attId)?.dealers?.full_name ?? "Dealer" : "—";
  const tableNameOf = (tid: string): string =>
    tables.find((t) => t.id === tid)?.table_name ?? "Bàn";

  // Active tables of this club (the room).
  const activeTables = useMemo(
    () => tables.filter((t) => t.club_id === clubId && tableAssignmentMap[t.id] !== undefined),
    [tables, clubId, tableAssignmentMap],
  );
  const filteredTableIds = useMemo(() => new Set(activeTables.map((t) => t.id)), [activeTables]);

  const candidates = useMemo(
    () => dealers.filter((d) => d.status === "checked_in" && d.dealers?.club_id === clubId),
    [dealers, clubId],
  );

  // attendanceId → tableId over ALL active tables (for the classifier).
  const attendanceCurrentTable = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [tid, asg] of Object.entries(tableAssignmentMap)) {
      if (asg?.attendance_id) m[asg.attendance_id] = tid;
    }
    return m;
  }, [tableAssignmentMap]);

  const selected = useMemo(() => [...selectedTableIds], [selectedTableIds]);
  const allChosen = selected.every((tid) => Object.prototype.hasOwnProperty.call(actualByTable, tid));

  // Classifier over the tables that have a choice made.
  const graph = useMemo(() => {
    const rows: ReconcileInputRow[] = selected
      .filter((tid) => Object.prototype.hasOwnProperty.call(actualByTable, tid))
      .map((tid) => ({
        tableId: tid,
        recordedAttendanceId: tableAssignmentMap[tid]?.attendance_id ?? null,
        actualAttendanceId: actualByTable[tid] ?? null,
      }));
    return classifyRoomReconcile({ rows, attendanceCurrentTable });
  }, [selected, actualByTable, tableAssignmentMap, attendanceCurrentTable]);

  const effectiveAtMs = useMemo(() => computeEffectiveAtMs(customTime, minutesAgo), [customTime, minutesAgo]);
  const effectiveTooFuture = isTooFuture(effectiveAtMs);
  const effectiveTooOld = isTooOld(effectiveAtMs);

  const fullReason = note.trim() ? `Sửa nhầm nhiều bàn (domino) — ${note.trim()}` : "Sửa nhầm nhiều bàn (domino)";

  // Advisory rest warnings for chosen actual dealers (informational only).
  const restWarnings = useMemo(() => {
    if (effectiveAtMs == null) return [] as string[];
    const out: string[] = [];
    for (const tid of selected) {
      const a = actualByTable[tid];
      if (!a) continue;
      const d = dealers.find((x) => x.id === a);
      if (!d) continue;
      const c = classifyCandidate({
        lastReleasedAt: d.last_released_at,
        currentState: d.current_state,
        attendanceStatus: d.status,
        plannedReliefAtMs: effectiveAtMs,
        restMinutes,
        nowMs: Date.now(),
      });
      if (c.group === "resting_not_eligible") {
        out.push(`${nameOf(a)} đang trong thời gian nghỉ (đủ điều kiện lúc ${hhmm(c.eligibleAtMs)}).`);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, actualByTable, dealers, effectiveAtMs, restMinutes]);

  const toggleTable = (tid: string) => {
    setSelectedTableIds((prev) => {
      const next = new Set(prev);
      if (next.has(tid)) {
        next.delete(tid);
        setActualByTable((m) => { const c = { ...m }; delete c[tid]; return c; });
      } else {
        next.add(tid);
      }
      return next;
    });
  };

  const setActual = (tid: string, value: string) => {
    setActualByTable((m) => {
      const c = { ...m };
      if (value === "") delete c[tid];
      else if (value === EMPTY) c[tid] = null;
      else c[tid] = value;
      return c;
    });
  };

  const buildCorrections = (): CorrectionEntry[] =>
    selected.map((tid) => {
      const actual = actualByTable[tid] ?? null;
      return actual === null
        ? { table_id: tid, actual_attendance_id: null, confirm_empty: true }
        : { table_id: tid, actual_attendance_id: actual };
    });

  const buildDisplaced = (): CorrectionEntry[] =>
    graph.displaced.map((d) => ({
      attendance_id: d.attendanceId,
      resolution: displacedRes[d.attendanceId] ?? "pool_available",
      reason: fullReason,
    }));

  const reset = () => {
    setStep(1); setSelectedTableIds(new Set()); setActualByTable({}); setDisplacedRes({});
    setMinutesAgo(10); setCustomTime(""); setNote(""); setAdminOverride(false);
    setBusy(false); setInlineError(null); setPreview(null);
  };
  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o); };

  const mapOutcomeError = (r: { outcome?: string; detail?: string }): string => {
    switch (r.outcome) {
      case "dealer_not_checked_in": return "Có dealer chưa check-in tại club — không thể ghi nhận.";
      case "dealer_duplicate_in_payload": return "Cùng một dealer đang được ghi ở hai bàn trong sửa đổi.";
      case "effective_at_future": return "Thời điểm sửa nằm trong tương lai — kiểm tra lại giờ.";
      case "effective_at_too_old": return "Quá 120 phút — cần quyền admin (bật ô bên dưới nếu bạn là admin).";
      case "override_forbidden": return "Chỉ admin mới được sửa quá 120 phút.";
      case "forbidden": return "Bạn không có quyền sửa thực tế phòng cho club này.";
      default: return `Lỗi: ${r.detail ?? r.outcome ?? "không xác định"}`;
    }
  };

  const runPreview = async () => {
    if (effectiveAtMs == null || busy) return;
    setBusy(true); setInlineError(null);
    try {
      const r = await callReconcile({
        clubId, corrections: buildCorrections(), displaced: buildDisplaced(),
        effectiveAtMs, reason: fullReason, dryRun: true, adminOverride,
      });
      if (r.outcome === "dry_run") {
        setPreview({ plan: r.plan ?? [], conflicts: r.conflicts ?? [], can_apply: !!r.can_apply });
        setStep(3);
      } else if (r.outcome === "noop") {
        toast.info("Trạng thái hệ thống đã khớp với thực tế — không cần sửa.");
      } else {
        setInlineError(mapOutcomeError(r));
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
      const corrections = attachCas(buildCorrections(), preview.plan);
      const r = await callReconcile({
        clubId, corrections, displaced: buildDisplaced(),
        effectiveAtMs: effectiveAtMs!, reason: fullReason, dryRun: false, adminOverride,
      });
      switch (r.outcome) {
        case "applied": {
          const s = r.summary ?? {};
          toast.success("Đã sửa domino nhiều bàn.", {
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
          toast.error(mapOutcomeError(r));
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const hasBlockingFlags = graph.flags.duplicate_actual.length > 0;
  const previewHasRelease = !!preview && (preview.plan.some((p) => p.action === "release") || graph.displaced.length > 0);
  const previewAllMoves = !!preview && preview.plan.length > 0 &&
    preview.plan.every((p) => p.action === "move" || p.action === "already_correct");

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sửa domino nhiều bàn{step > 1 ? ` (${selected.length} bàn)` : ""}</DialogTitle>
          <DialogDescription>
            Đối soát thực tế nhiều bàn cùng lúc trong một thao tác có audit. Server sẽ kiểm tra và áp dụng nguyên khối.
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          /* ── Step 1: pick affected tables ───────────────────────────── */
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="text-xs font-semibold text-muted-foreground">Chọn các bàn bị nhầm</div>
            {activeTables.length === 0 && (
              <div className="text-sm text-warning">Không có bàn hoạt động trong club này.</div>
            )}
            {activeTables.map((t) => {
              const rec = tableAssignmentMap[t.id]?.attendance_id ?? null;
              const checked = selectedTableIds.has(t.id);
              return (
                <label key={t.id} className={[
                  "flex items-center justify-between gap-2 p-2 border rounded-none cursor-pointer",
                  checked ? "border-warning/60 bg-warning/10" : "border-border bg-muted/20 hover:border-warning/40",
                ].join(" ")}>
                  <span className="flex items-center gap-2 min-w-0">
                    <input type="checkbox" checked={checked} onChange={() => toggleTable(t.id)} />
                    <span className="text-sm font-medium truncate">{t.table_name}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground truncate">{rec ? nameOf(rec) : "Bàn trống"}</span>
                </label>
              );
            })}
            {selected.length === 1 && (
              <div className="text-[11px] text-warning">
                Chỉ 1 bàn — nên dùng "Sửa nhầm bàn" trên thẻ bàn. Vẫn có thể tiếp tục nếu muốn.
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => close(false)}>Hủy</Button>
              <Button size="sm" disabled={selected.length < 1} onClick={() => setStep(2)}>Tiếp</Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          /* ── Step 2: per-table actual dealer + common fields ────────── */
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="text-xs font-semibold text-muted-foreground">Dealer đang chia thực tế từng bàn</div>
            {selected.map((tid) => {
              const rec = tableAssignmentMap[tid]?.attendance_id ?? null;
              const val = Object.prototype.hasOwnProperty.call(actualByTable, tid)
                ? (actualByTable[tid] === null ? EMPTY : actualByTable[tid]!) : "";
              return (
                <div key={tid} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{tableNameOf(tid)}</span>
                    <span className="text-muted-foreground"> · đang ghi: {rec ? nameOf(rec) : "trống"}</span>
                  </span>
                  <select value={val} onChange={(e) => setActual(tid, e.target.value)}
                    className="text-xs h-8 bg-muted/20 border border-border px-1.5 max-w-[55%]">
                    <option value="">— chọn —</option>
                    {candidates.map((d) => (
                      <option key={d.id} value={d.id}>{d.dealers?.full_name ?? "?"}{d.dealers?.tier ? ` (${d.dealers.tier})` : ""}</option>
                    ))}
                    <option value={EMPTY}>Trống (không ai chia)</option>
                  </select>
                </div>
              );
            })}

            {/* duplicate-actual block (server would reject) */}
            {graph.flags.duplicate_actual.length > 0 && (
              <div className="text-xs text-destructive">
                <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5" />
                Dealer {graph.flags.duplicate_actual.map(nameOf).join(", ")} được chọn ở nhiều bàn — mỗi dealer chỉ ở một bàn.
              </div>
            )}

            {/* actual-active-at-unselected-table: one-click add only if same-club & in filtered tables */}
            {graph.flags.actual_active_at_unselected_table.map((f, i) => {
              const inFiltered = filteredTableIds.has(f.currentTableId);
              return (
                <div key={i} className="text-xs text-warning flex items-center justify-between gap-2">
                  <span>
                    <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5" />
                    {nameOf(f.attendanceId)} đang được ghi ở {tableNameOf(f.currentTableId)}
                    {inFiltered ? "" : " (ngoài phạm vi club này — chỉ cảnh báo)"}.
                  </span>
                  {inFiltered && (
                    <Button size="sm" variant="outline" className="h-6 text-[10px] shrink-0"
                      onClick={() => toggleTable(f.currentTableId)}>
                      <Plus className="w-3 h-3 mr-0.5" /> Thêm bàn
                    </Button>
                  )}
                </div>
              );
            })}

            {/* live classifier summary */}
            {graph.components.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {graph.components.map((c, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">
                    {KIND_LABELS[c.kind]}: {c.tableIds.map(tableNameOf).join(" → ")}
                  </Badge>
                ))}
              </div>
            )}

            {/* displaced resolutions */}
            {graph.displaced.map((d) => (
              <div key={d.attendanceId} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">Xử lý <span className="font-semibold">{nameOf(d.attendanceId)}</span> (bị thay):</span>
                <select value={displacedRes[d.attendanceId] ?? "pool_available"}
                  onChange={(e) => setDisplacedRes((m) => ({ ...m, [d.attendanceId]: e.target.value }))}
                  className="text-xs h-8 bg-muted/20 border border-border px-1.5 max-w-[55%]">
                  {DISPLACED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            ))}

            {/* common effective time */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Đã chia từ lúc (chung cho mọi bàn)</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {QUICK_MINUTES.map((m) => (
                  <Button key={m} size="sm" variant="outline"
                    className={["text-xs h-7", !customTime && minutesAgo === m ? "border-warning/60 text-warning" : ""].join(" ")}
                    onClick={() => { setMinutesAgo(m); setCustomTime(""); }}>
                    {m} phút trước
                  </Button>
                ))}
                <input type="datetime-local" value={customTime} onChange={(e) => setCustomTime(e.target.value)}
                  className="text-xs h-7 bg-muted/20 border border-border px-1.5" aria-label="Nhập tay thời điểm" />
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Ghi nhận từ: <span className="font-medium">{hhmm(effectiveAtMs)}</span>
                {effectiveTooFuture && <span className="text-destructive"> — không được ở tương lai</span>}
                {effectiveTooOld && <span className="text-warning"> — quá 120 phút, cần quyền admin</span>}
              </div>
            </div>

            <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder='Ghi chú (mặc định: "Sửa nhầm nhiều bàn (domino)")'
              className="w-full text-xs h-8 bg-muted/20 border border-border px-1.5" />

            {restWarnings.map((w, i) => (
              <div key={i} className="text-[11px] text-warning"><Clock className="inline w-3 h-3 mr-0.5 -mt-0.5" />{w}</div>
            ))}
            {effectiveTooOld && (
              <label className="flex items-center gap-2 text-[11px] text-warning cursor-pointer">
                <input type="checkbox" checked={adminOverride} onChange={(e) => setAdminOverride(e.target.checked)} />
                Tôi là admin — cho phép sửa quá 120 phút (server sẽ kiểm tra quyền)
              </label>
            )}
            {inlineError && <div className="text-xs text-destructive">{inlineError}</div>}

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setStep(1)} disabled={busy}>Quay lại</Button>
              <Button size="sm" onClick={runPreview}
                disabled={busy || !allChosen || effectiveAtMs == null || effectiveTooFuture || hasBlockingFlags}>
                {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                Xem trước
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && preview && (
          /* ── Step 3: server dry-run preview / confirm ───────────────── */
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="text-xs font-semibold text-muted-foreground">Hệ thống sẽ:</div>
            <div className="space-y-1.5">
              {preview.plan.map((p) => (
                <div key={p.table_id} className="text-xs border border-border bg-muted/20 p-2">
                  <span className="font-semibold">{tableNameOf(p.table_id)}</span>:{" "}
                  {nameOf(p.current_attendance_id)} → <span className="font-medium">{nameOf(p.actual_attendance_id)}</span>
                  <Badge variant="outline" className="ml-1.5 text-[10px]">{ACTION_LABELS[p.action] ?? p.action}</Badge>
                </div>
              ))}
              {graph.displaced.map((d) => (
                <div key={d.attendanceId} className="text-xs border border-border bg-muted/20 p-2">
                  <span className="font-semibold">{nameOf(d.attendanceId)}</span>:{" "}
                  {DISPLACED_OPTIONS.find((o) => o.value === (displacedRes[d.attendanceId] ?? "pool_available"))?.label}
                </div>
              ))}
            </div>

            <div className="text-[11px] text-muted-foreground space-y-1">
              {previewAllMoves && <div>Phút làm việc giữ nguyên — chỉ đổi bàn, không đổi thời gian.</div>}
              {previewHasRelease && <div>Dealer bị thay dừng tính phút tại {hhmm(effectiveAtMs)}; dealer mới được ghi nhận từ {hhmm(effectiveAtMs)}.</div>}
              <div>Slot dự kiến của các bàn liên quan sẽ được lập lại.</div>
            </div>

            {preview.conflicts.length > 0 && (
              <div className="space-y-1">
                {preview.conflicts.map((c, i) => (
                  <div key={i} className="text-xs text-destructive">
                    <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5" />
                    {CONFLICT_LABELS[(c?.type as string) ?? ""] ?? c?.type ?? "Xung đột không xác định"}
                  </div>
                ))}
              </div>
            )}

            <div className="text-[11px] text-warning">Hành động này sửa lịch thực tế nhiều bàn và sẽ được ghi audit.</div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => { setPreview(null); setStep(2); }} disabled={busy}>Quay lại</Button>
              <Button size="sm" onClick={runApply} disabled={busy || !preview.can_apply}
                className="bg-warning hover:bg-warning/90 text-warning-foreground">
                {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                Xác nhận sửa domino
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
