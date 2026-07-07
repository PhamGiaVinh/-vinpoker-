import { useState } from "react";
import { CalendarOff, Star, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { AvailabilityRequest, SchedulerDealer, ShiftTemplate } from "@/types/shiftPlanner";

/**
 * V2 actionable requests panel (owner 2026-07-02: dealers "xin ca sớm" from the
 * dealer app → floor approves/rejects → "phải liên kết dealer app và đồng nhất").
 *
 * Actions:
 *  • "Duyệt & xếp vào ca" (shift requests) — approves AND immediately inserts the
 *    dealer into their preferred window as a manual draft assignment (one tap
 *    closes the loop). The schedule change reaches the dealer at publish time.
 *  • "Duyệt" / "Từ chối" — records the decision.
 *
 * Persistence honesty: the decision status is written to
 * dealer_availability_requests (status acknowledged/rejected) BEST-EFFORT via a
 * direct RLS-gated update — dealer-control roles pass; cashier-path operators
 * are blocked by the `_control_all` policy until the E2 SECDEF RPC ships
 * (owner-gated, mirrors get_dealer_availability_requests #492). On failure the
 * local decision still applies to THIS planning session and the operator sees an
 * honest warning toast. Dealer-app decision display also lands with E2.
 */
export function RequestsActionPanel({
  availability,
  templates,
  dealers,
  clubId,
  workDate,
  live,
  assignedDealerIds,
  onApproveIntoShift,
  onDecided,
}: {
  availability: AvailabilityRequest[];
  templates: ShiftTemplate[];
  dealers: SchedulerDealer[];
  clubId: string | null;
  workDate: string;
  live: boolean;
  assignedDealerIds: Set<string>;
  onApproveIntoShift: (dealerId: string, templateId: string) => boolean;
  /** Called after a decision is written, so the parent reloads availability —
   *  a rejected request then stops blocking the auto-fill solver in-session. */
  onDecided?: () => void;
}) {
  // dealerId → decision for this session (server write is best-effort, see above).
  const [decided, setDecided] = useState<Record<string, "approved" | "rejected">>({});

  const labelOf = (id: string) => templates.find((t) => t.id === id)?.label ?? id;
  const nameOf = (id: string) => dealers.find((d) => d.id === id)?.fullName ?? id;

  const db = supabase as unknown as {
    from: (table: string) => any;
    rpc: (fn: string, args: object) => Promise<{ data: any; error: { message?: string } | null }>;
  };

  const persistDecision = async (dealerId: string, status: "acknowledged" | "rejected") => {
    if (!live || !clubId) return;
    // Preferred path: SECDEF RPC scoped to cashier ∪ dealer-control clubs (migration
    // 20261211000000, owner-gated apply). Fallback while unapplied: direct RLS-gated
    // UPDATE — works for dealer-control roles, blocked for cashier-path operators.
    try {
      const { data: res, error: rpcErr } = await db.rpc("review_availability_request", {
        p_club_id: clubId,
        p_dealer_id: dealerId,
        p_work_date: workDate,
        p_decision: status,
      });
      if (!rpcErr && res?.ok) return;
      if (!rpcErr && res && !res.ok) throw new Error(res.error ?? "rpc_refused");
      throw rpcErr ?? new Error("rpc_missing");
    } catch {
      try {
        const { data, error } = await db
          .from("dealer_availability_requests")
          .update({ status })
          .eq("club_id", clubId)
          .eq("dealer_id", dealerId)
          .eq("work_date", workDate)
          .select("id");
        if (error) throw error;
        if (!Array.isArray(data) || data.length === 0) throw new Error("no_rows");
      } catch {
        toast.warning(
          "Đã ghi nhận tại đây, nhưng chưa lưu được trạng thái duyệt vào hệ thống (cần áp dụng RPC duyệt yêu cầu — đã kèm trong bản cập nhật, chờ duyệt DB)."
        );
      }
    }
  };

  const approve = (r: AvailabilityRequest) => {
    const target = r.preferredTemplateIds[0] ?? r.availableTemplateIds[0] ?? null;
    if (target && !r.leaveRequested) {
      if (assignedDealerIds.has(r.dealerId)) {
        toast.error(`${nameOf(r.dealerId)} đã có ca hôm nay — xoá ca cũ trước.`);
        return;
      }
      const ok = onApproveIntoShift(r.dealerId, target);
      if (!ok) return;
    }
    setDecided((p) => ({ ...p, [r.dealerId]: "approved" }));
    void persistDecision(r.dealerId, "acknowledged").finally(() => onDecided?.());
    toast.success(
      r.leaveRequested
        ? `Đã duyệt nghỉ cho ${nameOf(r.dealerId)}`
        : `Đã duyệt & xếp ${nameOf(r.dealerId)} vào ca ${target ? labelOf(target) : ""}`
    );
  };

  const reject = (r: AvailabilityRequest) => {
    setDecided((p) => ({ ...p, [r.dealerId]: "rejected" }));
    // Refetch after the write so the now-'rejected' request stops blocking the
    // solver — the dealer becomes schedulable again on the next auto-fill.
    void persistDecision(r.dealerId, "rejected").finally(() => onDecided?.());
    toast.success(`Đã từ chối yêu cầu của ${nameOf(r.dealerId)}`);
  };

  // Only pending ('submitted') requests need a decision. Already acknowledged /
  // rejected ones (from a prior session) drop off; ones decided in THIS session
  // stay visible (masked by `decided`) so the operator sees the outcome line.
  const visible = availability.filter(
    (r) => (r.status ?? "submitted") === "submitted" || decided[r.dealerId]
  );

  if (visible.length === 0) {
    return <div className="px-1 py-3 text-sm text-muted-foreground">Chưa có yêu cầu xin ca / nghỉ phép.</div>;
  }

  return (
    <div className="space-y-2">
      {visible.map((r) => {
        const decision = decided[r.dealerId];
        return (
          <div key={r.dealerId} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold">{nameOf(r.dealerId)}</span>
              {r.leaveRequested ? (
                <Badge
                  variant="outline"
                  className="border-[hsl(var(--ds-active)_/_0.3)] bg-[hsl(var(--ds-active)_/_0.15)] text-[10px] text-[hsl(var(--ds-active))]"
                >
                  <CalendarOff className="mr-1 h-3 w-3" /> Xin nghỉ
                </Badge>
              ) : (
                <Badge variant="outline" className="border-primary/30 bg-primary/15 text-[10px] text-primary">
                  Xin ca
                </Badge>
              )}
            </div>

            {r.preferredTemplateIds.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Star className="h-3.5 w-3.5 text-warning" />
                Ưu tiên: {r.preferredTemplateIds.map(labelOf).join(", ")}
              </div>
            )}
            {r.availableTemplateIds.length > 0 && (
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-success" />
                Có thể làm: {r.availableTemplateIds.map(labelOf).join(", ")}
              </div>
            )}
            {r.note && <p className="mt-1 text-[12px] italic text-muted-foreground/80">{r.note}</p>}

            <div className="mt-2 flex items-center gap-2">
              {decision === "approved" ? (
                <span className="text-[12px] text-success">✓ Đã duyệt — dealer sẽ thấy khi phát hành lịch</span>
              ) : decision === "rejected" ? (
                <span className="text-[12px] text-destructive">✕ Đã từ chối</span>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-success/40 px-2.5 text-[12px] text-success hover:bg-success/10"
                    onClick={() => approve(r)}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    {r.leaveRequested ? "Duyệt nghỉ" : "Duyệt & xếp vào ca"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-destructive/40 px-2.5 text-[12px] text-destructive hover:bg-destructive/10"
                    onClick={() => reject(r)}
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Từ chối
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
