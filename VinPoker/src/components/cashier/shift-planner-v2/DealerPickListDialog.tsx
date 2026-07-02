import { useMemo, useState } from "react";
import { UserPlus, Star, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  hardRejectReasons,
  scoreDealerForSlot,
  isNightShift,
  shiftDurationHours,
  REJECTION_LABELS,
  isHardRejection,
  fitLabel,
} from "@/lib/shiftPlanner";
import { shiftWindowLabel } from "../shift-planner/ShiftPlanner.utils";
import type {
  AvailabilityRequest,
  DraftAssignment,
  RejectionReason,
  SchedulerConfig,
  SchedulerDealer,
  ShiftTemplate,
} from "@/types/shiftPlanner";

/**
 * V2 "Thêm dealer" — pick-from-LIST (owner spec 2026-07-02: "cho danh sách và ấn
 * chọn thủ công"): every dealer is a tappable row with a live status pill computed
 * from the SAME pure checks the AI uses (hardRejectReasons) + a plain-VN fit label.
 * HARD reasons (đã có ca / inactive) disable the row; SOFT reasons (rest/hours/
 * leave/skill) show amber + require one extra "Vẫn gán (ghi đè)" tap — manual
 * assignment intentionally may override availability, mirroring AddShiftDialog.
 */
export function DealerPickListDialog({
  open,
  onOpenChange,
  templateId,
  onTemplateChange,
  dealers,
  templates,
  availability,
  config,
  workDate,
  assignedDealerIds,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Target shift window (pre-selected when opened from a group header). */
  templateId: string | null;
  onTemplateChange: (id: string) => void;
  dealers: SchedulerDealer[];
  templates: ShiftTemplate[];
  availability: AvailabilityRequest[];
  config: SchedulerConfig;
  workDate: string;
  assignedDealerIds: Set<string>;
  onAdd: (a: DraftAssignment) => void;
}) {
  const [filter, setFilter] = useState<"free" | "all">("free");
  const [confirmOverride, setConfirmOverride] = useState<string | null>(null);

  const template = templates.find((t) => t.id === templateId) ?? null;
  const requestByDealer = useMemo(
    () => new Map(availability.map((r) => [r.dealerId, r])),
    [availability]
  );

  interface Row {
    dealer: SchedulerDealer;
    reasons: RejectionReason[];
    hard: boolean;
    score: number;
  }
  const rows: Row[] = useMemo(() => {
    if (!template) return [];
    return dealers
      .map((d) => {
        const reasons = hardRejectReasons(
          d,
          template,
          workDate,
          requestByDealer.get(d.id),
          config,
          assignedDealerIds
        );
        const hard = reasons.some(isHardRejection);
        const score = reasons.length === 0
          ? scoreDealerForSlot(d, template, config, requestByDealer.get(d.id)).score
          : 0;
        return { dealer: d, reasons, hard, score };
      })
      .sort((a, b) => {
        // Fully-eligible first (by score desc), then soft-blocked, then hard-blocked.
        const rank = (r: Row) => (r.reasons.length === 0 ? 0 : r.hard ? 2 : 1);
        return rank(a) - rank(b) || b.score - a.score || a.dealer.fullName.localeCompare(b.dealer.fullName);
      });
  }, [dealers, template, workDate, requestByDealer, config, assignedDealerIds]);

  const shown = filter === "free" ? rows.filter((r) => r.reasons.length === 0) : rows;
  const freeCount = rows.filter((r) => r.reasons.length === 0).length;

  const add = (row: Row, override: boolean) => {
    if (!template) return;
    if (row.hard) return;
    if (row.reasons.length > 0 && !override) {
      setConfirmOverride(row.dealer.id);
      return;
    }
    const a: DraftAssignment = {
      templateId: template.id,
      templateLabel: template.label,
      dealerId: row.dealer.id,
      dealerName: row.dealer.fullName,
      workDate,
      scheduledStartAt: template.startAt,
      scheduledEndAt: template.endAt,
      durationHours: Math.round(shiftDurationHours(template.startAt, template.endAt) * 10) / 10,
      role: template.needsLead && row.dealer.isLead ? "Lead" : "Dealer",
      status: "draft",
      score: row.score,
      scoreBreakdown: [],
      reasons: override ? ["Gán thủ công (ghi đè cảnh báo)"] : ["Gán thủ công"],
      isNightShift: isNightShift(template.startAt, template.endAt, config.tzOffsetMinutes),
    };
    onAdd(a);
    setConfirmOverride(null);
    toast.success(`Đã thêm ${row.dealer.fullName} vào ca ${template.label}`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setConfirmOverride(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" /> Thêm dealer vào ca
          </DialogTitle>
          <DialogDescription>Bấm vào dealer để thêm. Người bận/nghỉ bị mờ kèm lý do.</DialogDescription>
        </DialogHeader>

        {/* Target shift window */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-muted-foreground">Khung ca</label>
          <Select value={templateId ?? ""} onValueChange={onTemplateChange}>
            <SelectTrigger>
              <SelectValue placeholder="Chọn khung ca…" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label} · {shiftWindowLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Filter chips */}
        <div className="flex gap-1.5">
          {([
            ["free", `Đang rảnh (${freeCount})`],
            ["all", `Tất cả (${rows.length})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                filter === key
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Dealer list */}
        <div className="max-h-72 space-y-1 overflow-auto rounded-md border border-border p-1">
          {!template && (
            <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">Chọn khung ca trước.</div>
          )}
          {template && shown.length === 0 && (
            <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
              {filter === "free" ? "Hết dealer rảnh — xem \"Tất cả\"." : "Không có dealer."}
            </div>
          )}
          {template &&
            shown.map((row) => {
              const eligible = row.reasons.length === 0;
              const fit = fitLabel(row.score);
              const primary = row.reasons[0];
              const confirming = confirmOverride === row.dealer.id;
              return (
                <div key={row.dealer.id}>
                  <button
                    type="button"
                    disabled={row.hard}
                    onClick={() => add(row, false)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                      row.hard
                        ? "cursor-not-allowed opacity-45"
                        : eligible
                          ? "hover:bg-primary/10"
                          : "hover:bg-warning/10"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
                      {row.dealer.fullName}
                      {row.dealer.isLead && <Star className="ml-1 inline h-3 w-3 text-amber-400" />}
                    </span>
                    {eligible ? (
                      <>
                        <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] text-success">
                          Đang rảnh ✓
                        </span>
                        <span
                          className={cn(
                            "rounded-full border border-border px-2 py-0.5 text-[10px]",
                            fit.tone === "good" ? "text-success" : fit.tone === "ok" ? "text-foreground" : "text-warning"
                          )}
                        >
                          {fit.label}
                        </span>
                        <span className="shrink-0 text-[11px] text-primary">＋ Thêm</span>
                      </>
                    ) : (
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2 py-0.5 text-[10px]",
                          row.hard
                            ? "border-border text-muted-foreground"
                            : "border-warning/40 bg-warning/10 text-warning"
                        )}
                      >
                        {primary ? REJECTION_LABELS[primary] : ""}
                      </span>
                    )}
                  </button>
                  {confirming && !row.hard && (
                    <div className="mx-1 mb-1 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5 text-[11px] text-warning">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1">
                        {row.reasons.map((r) => REJECTION_LABELS[r]).join(" · ")}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 border-warning/50 px-2 text-[11px] text-warning hover:bg-warning/10"
                        onClick={() => add(row, true)}
                      >
                        Vẫn gán (ghi đè)
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
