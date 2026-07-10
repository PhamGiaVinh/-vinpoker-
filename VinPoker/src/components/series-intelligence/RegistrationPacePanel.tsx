import { useState } from "react";
import { Users, AlertTriangle, FlaskConical, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";
import { registrationPace, type RegPaceStatus } from "@/lib/series-intelligence/registrationPace";
import { useNativeSeriesEvents } from "@/lib/series-intelligence/useNativeSeriesEvents";
import { useEventPace } from "@/lib/series-intelligence/useEventPace";
import { estimatePaceFraction, nowcastBlend } from "@/lib/series-intelligence/nowcast";
import { ExplainHint } from "./ExplainHint";

const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

const STATUS_TONE: Record<RegPaceStatus, string> = {
  behind: "border-warning/50 bg-warning/10 text-warning",
  ahead: "border-primary/50 bg-primary/10 text-primary",
  "on-track": "border-primary/40 bg-primary/5 text-primary",
  unknown: "border-border bg-card/40 text-muted-foreground",
};
const STATUS_LABEL: Record<RegPaceStatus, string> = {
  behind: "Đang chậm",
  ahead: "Đang nhanh",
  "on-track": "Đúng nhịp",
  unknown: "Chưa đủ dữ liệu",
};

/**
 * W6 — registration-pace check. Before a giải: compare sign-ups-so-far to a CRUDE linear pace toward the
 * forecast, so the owner spots "đang chậm → đẩy bài/satellite" early. All inputs owner-entered; the pace
 * reference is an honest crude assumption (real sign-up back-loads) stated plainly. Gated seriesRegistrationPace.
 */
export function RegistrationPacePanel() {
  const [forecast, setForecast] = useState<number | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [daysOpen, setDaysOpen] = useState<number | null>(null);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  const r =
    current !== null
      ? registrationPace({ forecast, current, daysOpen: daysOpen ?? 0, daysLeft: daysLeft ?? 0 })
      : null;

  // TP1 — nowcast: when the club's real data is reachable, blend model (owner's "dự báo cuối") with what
  // sign-ups so far imply, learning the pace curve from past events. Hooks always run; query self-gates.
  const native = useNativeSeriesEvents();
  const pace = useEventPace(native.events[0]?.clubId, native.events);
  const [nowcastEventId, setNowcastEventId] = useState("");
  const nowcastEvent = native.events.find((e) => e.event_id === nowcastEventId) ?? null;
  const nowcast = (() => {
    if (!FEATURES.seriesNowcast || !pace.available || !nowcastEvent?.event_date) return null;
    const start = new Date(nowcastEvent.event_date).getTime();
    if (Number.isNaN(start)) return null;
    const daysToEvent = Math.max(0, Math.ceil((start - Date.now()) / 86_400_000));
    const registrationsSoFar = pace.regCountByEvent.get(nowcastEvent.event_id) ?? 0;
    const paceFraction = estimatePaceFraction(pace.paceHistory, daysToEvent);
    return {
      daysToEvent,
      registrationsSoFar,
      result: nowcastBlend({ registrationsSoFar, daysToEvent, paceFraction, modelForecast: forecast }),
    };
  })();

  return (
    <Card className="p-3 border-primary/30 space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5 font-display text-base">
        <Users className="h-4 w-4 text-primary" /> Nhịp đăng ký vs dự báo
        <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">
          <FlaskConical className="h-2.5 w-2.5" /> Giả thuyết
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Trước giải, xem đăng ký có theo kịp dự báo không → phát hiện sớm để đẩy bài / mở satellite. Chỉ dùng cho
        giải có đăng ký online.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Đăng ký hiện tại</span>
          <Input type="number" className="h-8" value={current ?? ""} onChange={(e) => setCurrent(numOrNull(e.target.value))} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Dự báo cuối</span>
          <Input type="number" className="h-8" placeholder="(vd 170)" value={forecast ?? ""} onChange={(e) => setForecast(numOrNull(e.target.value))} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Đã mở (ngày)</span>
          <Input type="number" className="h-8" value={daysOpen ?? ""} onChange={(e) => setDaysOpen(numOrNull(e.target.value))} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Còn (ngày)</span>
          <Input type="number" className="h-8" value={daysLeft ?? ""} onChange={(e) => setDaysLeft(numOrNull(e.target.value))} />
        </label>
      </div>

      {r && (
        <div className={cn("rounded-md border p-2 space-y-1.5", STATUS_TONE[r.status])}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{STATUS_LABEL[r.status]}</span>
            {r.pctOfForecast !== null && <span className="tabular-nums text-[11px]">{r.pctOfForecast}% dự báo</span>}
          </div>
          {r.linearExpected !== null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted/40">
              {/* current fill vs the crude linear marker */}
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${forecast && forecast > 0 ? Math.min(100, ((current ?? 0) / forecast) * 100) : 0}%` }}
              />
            </div>
          )}
          <div className="text-[11px] leading-relaxed text-foreground/90">{r.headline}</div>
          {r.status === "behind" && (
            <div className="flex items-start gap-1 text-[10px]">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Cân nhắc đẩy 1 bài truyền thông hoặc mở satellite, rồi theo dõi lại sau 24 giờ.
            </div>
          )}
          <div className="text-[10px] text-muted-foreground/90">{r.caveat}</div>
        </div>
      )}

      {/* TP1 — nowcast từ đăng ký thật (chỉ hiện khi đọc được dữ liệu autosync của CLB) */}
      {FEATURES.seriesNowcast && pace.available && native.events.length > 0 && (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium">
            <Zap className="h-3.5 w-3.5 text-primary" /> Nowcast — tự lấy đăng ký thật + học nhịp từ giải cũ
          </div>
          <Select value={nowcastEventId || undefined} onValueChange={setNowcastEventId}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Chọn giải sắp tới (tự điền số đăng ký)" /></SelectTrigger>
            <SelectContent>
              {native.events.map((e) => (
                <SelectItem key={e.event_id} value={e.event_id}>{e.event_name ?? e.event_id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {nowcast && nowcast.result.available && (
            <div className="text-[11px] leading-relaxed">
              Đăng ký thật: <b className="tabular-nums">{nowcast.registrationsSoFar}</b> · còn{" "}
              <b className="tabular-nums">{nowcast.daysToEvent}</b> ngày ·{" "}
              {nowcast.result.paceImplied !== null && (
                <>nhịp đang ngụ ý <b className="tabular-nums">{nowcast.result.paceImplied}</b> · </>
              )}
              <b className="text-primary tabular-nums">
                nowcast {nowcast.result.blended}
              </b>{" "}
              <span className="text-muted-foreground">
                ({nowcast.result.basis === "blend"
                  ? `pha trộn, trọng số pace ${Math.round(nowcast.result.weightPace * 100)}%`
                  : nowcast.result.basis === "model-only"
                    ? "chưa đủ lịch sử nhịp → dùng dự báo model"
                    : "chưa nhập dự báo → chỉ theo nhịp"})
              </span>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/90">
            Nowcast trộn dự báo model với đăng ký thật; càng gần ngày giải + càng nhiều người đã đăng ký thì càng
            tin nhịp thật. τ (tỷ lệ đã đăng ký tới mốc này) học từ các giải ĐÃ XONG của CLB. Nhãn Giả thuyết.
          </p>
        </div>
      )}

      <ExplainHint term="nhịp đăng ký">
        So số đăng ký hiện tại với một <b>mốc thô</b> (giả định đăng ký rải đều theo thời gian) tính từ dự báo cuối.
        Vì poker hay dồn cuối, "chậm ở giữa" thường không đáng lo — chỉ dùng như đèn nhắc để hành động sớm, không
        phải con số chắc chắn.
      </ExplainHint>
    </Card>
  );
}
