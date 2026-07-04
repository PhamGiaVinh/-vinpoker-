import { useMemo, useState } from "react";
import { SlidersHorizontal, LogOut, UserPlus, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { calculateLiveWorkedMinutes } from "@/lib/dealerWorkedMinutes";
import { computeStaffing, rankReleaseCandidates } from "@/lib/staffingOptimizer";
import type { DealerAttendance, DealerAssignment, SwingConfig } from "@/hooks/useDealerSwing";

/**
 * "Tối ưu nhân sự" — live staffing optimizer for the Dealer Swing panel (owner
 * request 2026-07-04). Read-only advisory: shows how many dealers are needed vs
 * present (target from the real swing rotation cadence), and when overstaffed,
 * ranks who could be released. The actual check-out goes through the EXISTING
 * DC batch-checkout flow (onRequestCheckout → handleBatchCheckoutClick) — no new
 * money-path code, no payroll write. Gated behind FEATURES.dealerStaffingOptimizer.
 */
export function StaffingOptimizerCard({
  activeTables,
  dealers,
  assignments,
  swingConfigs,
  nowMs,
  onRequestCheckout,
  onOpenCheckin,
}: {
  activeTables: number;
  dealers: DealerAttendance[];
  assignments: DealerAssignment[];
  swingConfigs: SwingConfig[];
  nowMs: number;
  onRequestCheckout: (attendanceIds: string[]) => void;
  onOpenCheckin: () => void;
}) {
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  const cfg = useMemo(
    () => swingConfigs.find((c) => c.table_type === "tournament") ?? swingConfigs[0],
    [swingConfigs]
  );

  const present = useMemo(
    () => dealers.filter((d) => d.current_state !== "checked_out").length,
    [dealers]
  );
  const availableCount = useMemo(
    () => dealers.filter((d) => d.current_state === "available").length,
    [dealers]
  );

  const staffing = useMemo(
    () =>
      computeStaffing({
        activeTables,
        present,
        swingDurationMin: cfg?.swing_duration_minutes,
        minRestMin: cfg?.min_inter_swing_rest_minutes,
      }),
    [activeTables, present, cfg]
  );

  const candidates = useMemo(() => {
    if (staffing.surplus <= 0) return [];
    const workedById = calculateLiveWorkedMinutes(dealers, assignments, nowMs);
    return rankReleaseCandidates(
      dealers.map((d) => ({
        attendanceId: d.id,
        name: d.dealers?.full_name ?? d.dealer_id,
        state: d.current_state,
        tier: d.dealers?.tier ?? "B",
        workedMin: workedById[d.id] ?? 0,
        lastReleasedAt: d.last_released_at,
      })),
      staffing.surplus
    );
  }, [staffing.surplus, dealers, assignments, nowMs]);

  const selectedIds = candidates.map((c) => c.attendanceId).filter((id) => !deselected.has(id));

  const pill =
    staffing.status === "short"
      ? { text: `Thiếu ${staffing.deficit}`, cls: "text-destructive bg-destructive/10 border-destructive/30" }
      : staffing.status === "over"
        ? { text: `Thừa ${staffing.surplus}`, cls: "text-warning bg-warning/10 border-warning/30" }
        : { text: "Cân đối ✓", cls: "text-primary bg-primary/10 border-primary/30" };

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-display text-sm font-bold tracking-wide text-foreground">
          <SlidersHorizontal className="h-4 w-4 text-primary" /> Tối ưu nhân sự
        </span>
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", pill.cls)}>{pill.text}</span>
      </div>

      {/* Transparent staffing math */}
      <div className="mb-2 rounded-md border border-border bg-muted/20 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        <b className="text-foreground">{staffing.activeTables}</b> bàn mở · cần{" "}
        <b className="text-foreground">~{staffing.required}</b> dealer{" "}
        <span className="text-muted-foreground/80">(gồm {staffing.buffer} dự phòng xoay ca/nghỉ)</span> · đang có{" "}
        <b className="text-foreground">{staffing.present}</b>
      </div>

      {staffing.status === "over" && (
        <>
          <div className="mb-1.5 text-[11px] text-muted-foreground">
            Thừa {staffing.surplus} — gợi ý cho về (nhiều giờ nhất trước):
          </div>
          <div className="space-y-1">
            {candidates.map((c) => {
              const on = !deselected.has(c.attendanceId);
              return (
                <div key={c.attendanceId} className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setDeselected((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.attendanceId)) next.delete(c.attendanceId);
                        else next.add(c.attendanceId);
                        return next;
                      })
                    }
                    aria-label={on ? "Bỏ chọn" : "Chọn"}
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      on ? "border-primary bg-primary/15 text-primary" : "border-border text-transparent"
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{c.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {c.workedMin}′ · hạng {c.tier}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[11px]",
                      c.state === "on_break" ? "text-[hsl(var(--ds-active))]" : "text-success"
                    )}
                  >
                    {c.stateLabel}
                  </span>
                </div>
              );
            })}
          </div>
          <Button
            variant="outline"
            className="mt-2 h-9 w-full border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={selectedIds.length === 0}
            onClick={() => onRequestCheckout(selectedIds)}
          >
            <LogOut className="mr-1.5 h-4 w-4" /> Cho {selectedIds.length} người về (check-out)
          </Button>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
            Gợi ý để tối ưu chi phí — floor xác nhận ở bước tiếp theo. Không tự đụng lương/chấm công.
          </p>
        </>
      )}

      {staffing.status === "short" && (
        <>
          <div className="mb-2 text-[11.5px] text-muted-foreground">
            Thiếu {staffing.deficit} dealer — <b className="text-foreground">{availableCount}</b> đang rảnh chưa gán.
          </div>
          <Button
            variant="outline"
            className="h-9 w-full border-primary/40 text-primary hover:bg-primary/10"
            onClick={onOpenCheckin}
          >
            <UserPlus className="mr-1.5 h-4 w-4" /> Gọi thêm / Check-in dealer
          </Button>
        </>
      )}

      {staffing.status === "balanced" && (
        <div className="py-1 text-center text-[12.5px] text-primary">✓ Nhân sự cân đối — không cần thêm/bớt</div>
      )}
    </Card>
  );
}
