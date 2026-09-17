import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BellRing, Check, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HandHistoryWorkspace } from "./HandHistoryWorkspace";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import {
  listTrackerFloorAlerts,
  type TrackerFloorAlert,
  type TrackerFloorAlertStatus,
} from "@/lib/tracker-floor-alerts/trackerFloorAlertsRead";
import { trackerFloorAlertLink } from "@/lib/tracker-floor-alerts/trackerFloorAlertLink";
import { useTrackerFloorAlertLocations } from "@/lib/tracker-floor-alerts/useTrackerFloorAlertLocations";

type FloorAlertStatus = TrackerFloorAlertStatus;
interface TrackerFloorAlertLaneProps {
  tournamentId: string;
}

function nextTransition(status: FloorAlertStatus): { action: string; label: string } | null {
  if (status === "open") return { action: "acknowledge", label: "Đã nhận" };
  if (status === "acknowledged") return { action: "start", label: "Bắt đầu xử lý" };
  if (status === "in_progress") return { action: "resolve", label: "Đã xử lý" };
  return null;
}

export function TrackerFloorAlertLane({ tournamentId }: TrackerFloorAlertLaneProps) {
  const supabase = useSupabaseClient();
  const [alerts, setAlerts] = useState<TrackerFloorAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [reviewAlert, setReviewAlert] = useState<TrackerFloorAlert | null>(null);
  const locationFor = useTrackerFloorAlertLocations(supabase, alerts);

  const reload = useCallback(async () => {
    setError(null);
    const result = await listTrackerFloorAlerts(supabase, tournamentId);
    if ("error" in result) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setAlerts([...result.alerts]);
    setLoading(false);
  }, [supabase, tournamentId]);

  useEffect(() => {
    void reload();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 10_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    const channel = supabase
      .channel(`tracker-floor-alerts:${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tracker_floor_alerts", filter: `tournament_id=eq.${tournamentId}` },
        () => void reload(),
      )
      .subscribe();
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [reload, supabase, tournamentId]);

  const transition = async (alert: TrackerFloorAlert, action: string) => {
    if (transitioningId) return;
    if (action === "resolve" && alert.correction_required && !window.confirm(
      "Chỉ đánh dấu đã xử lý sau khi action/hand canonical đã được sửa và kiểm tra. Thao tác này mở lại Voice cho bàn. Tiếp tục?",
    )) return;
    setTransitioningId(alert.id);
    const { data, error: rpcError } = await supabase.rpc("transition_tracker_floor_alert" as never, {
      p_alert_id: alert.id,
      p_expected_version: alert.version,
      p_transition: action,
      p_note: null,
      p_idempotency_key: `floor-alert:${crypto.randomUUID()}`,
    } as never);
    const payload = data as unknown as { ok?: boolean; error?: string } | null;
    if (rpcError || !payload?.ok) {
      toast.error(payload?.error ?? rpcError?.message ?? "Không cập nhật được cảnh báo.");
    } else {
      await reload();
    }
    setTransitioningId(null);
  };

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-amber-400/25 bg-[linear-gradient(135deg,rgba(32,20,4,.92),rgba(15,15,18,.96))]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-amber-300/25 bg-amber-300/10 text-amber-300">
            <BellRing className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Voice & Floor Alerts</h3>
            <p className="text-[11px] text-zinc-500">Lane vận hành riêng, không thay đổi Dealer Swing.</p>
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => void reload()} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </header>

      <div className="space-y-3 p-4" aria-live="polite">
        {loading && (
          <div className="flex min-h-20 items-center justify-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải cảnh báo
          </div>
        )}
        {!loading && error && (
          <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 p-3 text-xs text-rose-100">
            {error}
          </div>
        )}
        {!loading && !error && alerts.length === 0 && (
          <div className="flex min-h-20 items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 text-xs text-zinc-500">
            <Check className="h-4 w-4 text-emerald-400" /> Không có cảnh báo Voice đang mở
          </div>
        )}
        {alerts.map((alert) => {
          const primary = nextTransition(alert.status);
          const handLink = trackerFloorAlertLink(alert);
          const location = locationFor(alert);
          return (
            <article
              key={alert.id}
              className={`rounded-xl border p-3 ${alert.priority === "urgent" ? "border-rose-400/35 bg-rose-400/10" : "border-amber-300/25 bg-black/20"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <AlertTriangle className={`h-4 w-4 ${alert.priority === "urgent" ? "text-rose-300" : "text-amber-300"}`} />
                    <span className="text-sm font-semibold text-zinc-100">{alert.title}</span>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                      {alert.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {alert.dealer_name || "Dealer"} · {new Date(alert.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-amber-100">
                    {location?.tableNumber != null ? `Bàn ${location.tableNumber}` : "Đang tải bàn"}
                    {location?.handNumber != null ? ` · Hand #${location.handNumber}` : ""}
                  </p>
                  {alert.alert_kind === "wrong_action" && (
                    <p className="mt-1 text-xs text-zinc-300">Action sai chưa được chỉ rõ; xem toàn bộ nhật ký ván trước khi sửa.</p>
                  )}
                  {alert.message && <p className="mt-2 line-clamp-2 text-xs text-zinc-300">{alert.message}</p>}
                  {alert.correction_required && (
                    <p className="mt-2 text-xs text-amber-200">Voice tạm dừng. Kiểm tra và sửa hand trước khi đánh dấu đã xử lý.</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {alert.hand_id && (
                    <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setReviewAlert(alert)}>
                      Kiểm tra & sửa hand
                    </Button>
                  )}
                  <Button asChild size="sm" variant="outline" className="min-h-11">
                    <Link to={handLink}>
                      Mở đúng bàn <ExternalLink className="ml-2 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                  {primary && (
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-11"
                      disabled={transitioningId === alert.id}
                      onClick={() => void transition(alert, primary.action)}
                    >
                      {transitioningId === alert.id && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      {primary.label}
                    </Button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <Dialog open={!!reviewAlert} onOpenChange={(open) => { if (!open) setReviewAlert(null); }}>
        <DialogContent className="max-h-[92dvh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Kiểm tra & sửa hand</DialogTitle>
            <DialogDescription>
              Chọn action cần sửa, kiểm tra số theo/raise và xem trước stack cuối hand. Máy chủ vẫn là nơi duy nhất xác minh và ghi kết quả.
            </DialogDescription>
          </DialogHeader>
          {reviewAlert?.hand_id && (
            <HandHistoryWorkspace
              key={reviewAlert.hand_id}
              tournamentId={reviewAlert.tournament_id}
              initialTableId={reviewAlert.tournament_table_id ?? reviewAlert.physical_table_id}
              initialHandId={reviewAlert.hand_id}
              workspaceMode
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
