import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { formatShortDate } from "@/lib/format";
import { FEATURES } from "@/lib/featureFlags";
import { useSeriesCapture } from "@/lib/series-intelligence/useSeriesCapture";
import { useNativeSeriesEvents } from "@/lib/series-intelligence/useNativeSeriesEvents";
import { useCaptureAutosync } from "@/lib/series-intelligence/useCaptureAutosync";
import { CaptureOverview } from "./capture/CaptureOverview";
import { CalibrationCard } from "./capture/CalibrationCard";
import { MarketingImportPanel } from "./MarketingImportPanel";
import { EventLoopPanel } from "./capture/EventLoopPanel";

/**
 * Series Intelligence — CAPTURE console (self-contained). Event-centric: pick a club tournament, then capture
 * & view its full learning loop. Owner-scoped (lists only clubs you own; RLS governs every write). DATA CAPTURE
 * ONLY — no model, no prediction. Mounted both as step ⑥ of the Series Intelligence page and as the body of
 * /club/admin/series-decision-log.
 */
export function SeriesCaptureConsole() {
  const hook = useSeriesCapture();
  const [eventId, setEventId] = useState("");
  // The club's own past events (buy-in + real entry counts) drive the forecast suggestion.
  const native = useNativeSeriesEvents(hook.clubId ? { clubId: hook.clubId } : undefined);
  // Auto-capture status + auto-recorded actuals (gracefully "unavailable" until the migration is applied).
  const autosync = useCaptureAutosync(hook.clubId);

  // Keep a valid event selected as the club / event list changes.
  useEffect(() => {
    setEventId((prev) => (hook.events.some((e) => e.id === prev) ? prev : hook.events[0]?.id ?? ""));
  }, [hook.events]);

  if (!hook.loading && hook.clubs.length === 0) {
    return (
      <Card className="border-primary/30 p-4 text-sm text-muted-foreground">
        Bạn chưa sở hữu CLB nào — console này dành cho chủ CLB.
      </Card>
    );
  }

  const selectedEvent = hook.events.find((e) => e.id === eventId) ?? null;
  const autoActuals = selectedEvent ? autosync.actualsByEvent.get(selectedEvent.id) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          Tầng GHI DỮ LIỆU — ghi quyết định + kết quả sau giải. Không model, không dự đoán.
        </div>
        {autosync.available && (
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/20 px-3 py-1 text-[11px]">
            <Zap className={autosync.enabled ? "h-3.5 w-3.5 text-primary" : "h-3.5 w-3.5 text-muted-foreground"} aria-hidden />
            <span className="text-muted-foreground">
              Tự động ghi: <strong className={autosync.enabled ? "text-primary" : "text-foreground"}>{autosync.enabled ? "BẬT" : "TẮT"}</strong>
              {autosync.lastRun && <span className="ml-1 text-muted-foreground/70">· đồng bộ {formatShortDate(autosync.lastRun.run_at)}</span>}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={autosync.syncNow}
              disabled={autosync.syncing}
              aria-label="Đồng bộ ngay"
            >
              <RefreshCw className={autosync.syncing ? "h-3 w-3 animate-spin" : "h-3 w-3"} /> Sync ngay
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {hook.clubs.length > 1 && (
          <Select value={hook.clubId ?? undefined} onValueChange={hook.setClubId}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue placeholder="Chọn CLB" />
            </SelectTrigger>
            <SelectContent>
              {hook.clubs.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={eventId || undefined} onValueChange={setEventId}>
          <SelectTrigger className="h-9 min-w-[16rem] flex-1">
            <SelectValue placeholder="Chọn giải" />
          </SelectTrigger>
          <SelectContent>
            {hook.events.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
                {e.start_time ? ` · ${formatShortDate(e.start_time)}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <CaptureOverview decisions={hook.decisions} snapshots={hook.snapshots} />
      {FEATURES.seriesCalibration && <CalibrationCard decisions={hook.decisions} snapshots={hook.snapshots} />}
      {FEATURES.seriesMarketingImport && (
        <MarketingImportPanel
          clubId={hook.clubId ?? undefined}
          events={hook.events.map((e) => ({ id: e.id, name: e.name }))}
          onImport={hook.insertCampaign}
        />
      )}

      {hook.loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải…
        </div>
      ) : !selectedEvent ? (
        <Card className="border-border/60 p-4 text-sm text-muted-foreground">
          {hook.events.length === 0 ? "CLB chưa có giải nào để gắn dữ liệu." : "Chọn một giải để xem/ghi vòng lặp."}
        </Card>
      ) : (
        <Card className="gradient-card border-primary/30 p-3">
          <div className="mb-3">
            <h2 className="font-display text-lg text-primary">{selectedEvent.name}</h2>
            {selectedEvent.start_time && (
              <p className="text-[11px] text-muted-foreground">{formatShortDate(selectedEvent.start_time)}</p>
            )}
          </div>
          <EventLoopPanel eventId={selectedEvent.id} hook={hook} history={native.events} autoActuals={autoActuals} />
        </Card>
      )}
    </div>
  );
}
