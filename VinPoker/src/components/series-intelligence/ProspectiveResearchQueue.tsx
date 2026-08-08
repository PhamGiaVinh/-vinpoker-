import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, DatabaseZap, RefreshCw, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FEATURES } from "@/lib/featureFlags";
import { formatShortDate } from "@/lib/format";
import { promoteNativeEventActual } from "@/lib/series-intelligence/decisionPacketRpc";
import {
  buildNativeTruthPromotionQueueV1,
  buildProspectiveEngineSnapshotV1,
  buildProspectiveResearchQueueV1,
  type HorizonTimingStatus,
  type ProspectiveCohortRow,
} from "@/lib/series-intelligence/prospectiveResearchCohortV1";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
import type { UseSeriesCapture } from "@/lib/series-intelligence/useSeriesCapture";

const timingLabel: Record<HorizonTimingStatus, string> = {
  ON_TIME: "Đến hạn",
  LATE_WITHIN_ALLOWED_WINDOW: "Đến muộn trong khung cho phép",
  MISSED: "Đã lỡ mốc",
  NOT_YET_DUE: "Chưa đến mốc",
};

function buildCodeSha(): string | undefined {
  const runtime = import.meta as unknown as { env?: Record<string, string | undefined> };
  return runtime.env?.VITE_GIT_COMMIT_SHA;
}

function rowBadge(row: ProspectiveCohortRow): "default" | "secondary" | "outline" | "destructive" {
  if (row.nextAction === "capture_forecast") return "default";
  if (row.nextAction === "missed") return "destructive";
  if (row.nextAction === "already_captured" || row.forecastState === "captured") return "secondary";
  return "outline";
}

function rowAction(row: ProspectiveCohortRow): string {
  switch (row.nextAction) {
    case "capture_forecast": return "Ghi dự báo";
    case "already_captured": return "Đã ghi";
    case "review_packet": return "Mở Decision Room";
    case "not_yet_due": return "Chưa đến mốc";
    case "missed": return "Đã lỡ mốc";
    case "forecast_unavailable": return "Thiếu dữ liệu";
    default: return "Đang chờ";
  }
}

export function ProspectiveResearchQueue({ hook, nativeEvents }: { hook: UseSeriesCapture; nativeEvents: readonly SeriesEvent[] }) {
  const [asOfTs, setAsOfTs] = useState(() => new Date().toISOString());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const queue = useMemo(() => buildProspectiveResearchQueueV1({
    asOfTs,
    events: hook.events.map((event) => ({ event: nativeEvents.find((item) => item.event_id === event.id) ?? {
      event_id: event.id,
      event_name: event.name,
      event_date: event.start_time,
      buy_in: null,
      fee: null,
      serviceFeeAmount: null,
      gtd: null,
      prize_pool_actual: null,
      total_entries: null,
      unique_entries: null,
      reentries: null,
      capacity: null,
      source: "native",
      clubId: event.club_id,
      missingFields: ["buy_in", "gtd"],
    }, status: event.status })),
    snapshots: hook.snapshots.map((snapshot) => ({
      id: snapshot.id,
      eventId: snapshot.event_id,
      horizon: snapshot.horizon,
      targetEventTs: snapshot.target_event_ts,
      forecastInstanceId: snapshot.forecast_instance_id,
      inputContentHash: snapshot.input_content_hash,
    })),
  }), [asOfTs, hook.events, hook.snapshots, nativeEvents]);
  const dueRows = queue.rows.filter((row) => row.nextAction === "capture_forecast").slice(0, 10);
  const pastEvents = useMemo(() => buildNativeTruthPromotionQueueV1({
    asOfTs,
    events: hook.events.map((event) => ({ id: event.id, start_time: event.start_time, status: event.status })),
  }).slice(0, 10), [asOfTs, hook.events]);
  const nativeById = useMemo(() => new Map(nativeEvents.map((event) => [event.event_id, event])), [nativeEvents]);

  if (!FEATURES.seriesProspectiveResearchCohortV1) return null;
  if (!hook.clubId) return null;

  const captureOne = async (row: ProspectiveCohortRow) => {
    const event = nativeById.get(row.eventId);
    if (!event) {
      setResults((current) => ({ ...current, [`${row.eventId}:${row.horizon}`]: "Thiếu event native" }));
      return false;
    }
    const result = await buildProspectiveEngineSnapshotV1({
      event,
      history: nativeEvents,
      horizon: row.horizon,
      capturedAt: new Date().toISOString(),
      codeSha: buildCodeSha(),
      options: { calendarFeatures: FEATURES.seriesCalendarFeatures, censoring: FEATURES.seriesCensoring },
    });
    if (!result.ok) {
      setResults((current) => ({ ...current, [`${row.eventId}:${row.horizon}`]: result.reason }));
      return false;
    }
    const ok = await hook.insertForecast(result.insert);
    setResults((current) => ({ ...current, [`${row.eventId}:${row.horizon}`]: ok ? "Đã ghi snapshot" : "Ghi thất bại" }));
    return ok;
  };

  const captureAll = async () => {
    setRunning(true);
    for (const row of dueRows) await captureOne(row);
    setRunning(false);
  };

  const promoteNative = async () => {
    setRunning(true);
    for (const event of pastEvents) {
      const result = await promoteNativeEventActual({ eventId: event.eventId, idempotencyKey: `d3a:native:${event.eventId}` });
      setResults((current) => ({ ...current, [`native:${event.eventId}`]: result.ok ? "Đã yêu cầu đồng bộ" : `Bị chặn: ${result.error}` }));
    }
    setRunning(false);
  };

  return (
    <Card className="border-primary/30" data-testid="prospective-research-queue" data-owner-scope="true">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" /> Hàng đợi thu thập nghiên cứu</CardTitle>
            <CardDescription className="mt-1">Theo dõi các mốc cần ghi trước giải. Mọi ghi dữ liệu đều qua CAPTURE hiện có và cần owner bấm xác nhận.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAsOfTs(new Date().toISOString())} disabled={running}>
            <RefreshCw className="mr-2 h-4 w-4" /> Cập nhật mốc giờ
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2 py-1"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> Owner-scoped</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-1"><Clock3 className="h-3.5 w-3.5" /> Kiểm tra lúc {formatShortDate(asOfTs)}</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-1">Tối đa 10 thao tác/lần</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void captureAll()} disabled={running || dueRows.length === 0}>
            <CheckCircle2 className="mr-2 h-4 w-4" /> Ghi các mốc đến hạn ({dueRows.length})
          </Button>
          <a className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted" href="/club/admin/series-decision-log">
            Mở Decision Room
          </a>
          <Button variant="outline" onClick={() => void promoteNative()} disabled={running || pastEvents.length === 0}>
            <DatabaseZap className="mr-2 h-4 w-4" /> Đưa kết quả hệ thống vào ({pastEvents.length})
          </Button>
        </div>
        <div className="space-y-2" role="list" aria-label="Các mốc nghiên cứu">
          {queue.rows.length === 0 ? (
            <div className="rounded-md border border-border/60 bg-muted/10 p-4 text-sm text-muted-foreground" role="status">Chưa có giải sắp tới để đưa vào hàng đợi.</div>
          ) : queue.rows.map((row) => {
            const key = `${row.eventId}:${row.horizon}`;
            return (
              <div key={key} className="flex flex-col gap-3 rounded-md border border-border/60 bg-card/40 p-3 sm:flex-row sm:items-center sm:justify-between" role="listitem">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.eventName ?? row.eventId}</span>
                    <Badge variant="outline">{row.horizon}</Badge>
                    <Badge variant={rowBadge(row)}>{rowAction(row)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Mốc: {formatShortDate(row.dueAt)} · {timingLabel[row.timingStatus]}</p>
                  {results[key] && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><TriangleAlert className="h-3 w-3" /> {results[key]}</p>}
                </div>
                {row.nextAction === "capture_forecast" && <Button variant="outline" size="sm" onClick={() => void captureOne(row)} disabled={running}>Ghi ngay</Button>}
                {row.nextAction === "review_packet" && <a className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/club/admin/series-decision-log">Xem packet</a>}
              </div>
            );
          })}
        </div>
        {pastEvents.length > 0 && (
          <div className="space-y-2 rounded-md border border-border/60 bg-muted/10 p-3" data-testid="native-truth-queue">
            <p className="text-sm font-medium">Kết quả hệ thống chờ owner xác nhận</p>
            {pastEvents.map((event) => (
              <div key={event.eventId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-mono text-muted-foreground">{event.eventId}</span>
                <span className="text-muted-foreground">{results[`native:${event.eventId}`] ?? "Chưa yêu cầu"}</span>
              </div>
            ))}
          </div>
        )}
        {pastEvents.length > 0 && <p className="text-xs text-muted-foreground">Nút đồng bộ kết quả chỉ gọi RPC D2B đã có; không ghi thẳng bảng actual và không tự khóa packet.</p>}
        <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">D3A chỉ thu thập dữ liệu prospective. Không hồi tố forecast, không tự tạo quyết định, không tự freeze và không tuyên bố cặp forecast–actual khi chưa đủ dữ liệu.</p>
      </CardContent>
    </Card>
  );
}
