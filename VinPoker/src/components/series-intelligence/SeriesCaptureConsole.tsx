import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { formatShortDate } from "@/lib/format";
import { useSeriesCapture } from "@/lib/series-intelligence/useSeriesCapture";
import { CaptureOverview } from "./capture/CaptureOverview";
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

  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        Tầng GHI DỮ LIỆU — ghi quyết định + kết quả sau giải. Không model, không dự đoán.
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
          <EventLoopPanel eventId={selectedEvent.id} hook={hook} />
        </Card>
      )}
    </div>
  );
}
