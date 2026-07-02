import { useEffect, useMemo, useState } from "react";
import { TrendingUp, FlaskConical, AlertTriangle, Dice5 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
import { useNativeSeriesEvents } from "@/lib/series-intelligence/useNativeSeriesEvents";
import { forecastTurnout, forecastToOverlayFeed, type ForecastConfidence, type ForecastOverlayFeed } from "@/lib/series-intelligence/turnoutForecast";
import { simulateOverlayFromForecast } from "@/lib/series-intelligence/overlayRiskEngine";
import { ExplainHint } from "./ExplainHint";
import { RegimeNotice } from "./RegimeNotice";

/** What this panel emits upward so the group-history overlay simulator can offer a forecast center. */
export type ForecastFeedWithFee = ForecastOverlayFeed & { fee: number };

const CONF: Record<ForecastConfidence, { label: string; cls: string }> = {
  low: { label: "Thấp — ít dữ liệu", cls: "border-destructive/50 text-destructive" },
  medium: { label: "Trung bình", cls: "border-warning/50 text-warning" },
  high: { label: "Cao", cls: "border-primary/50 text-primary" },
};
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const median = (v: Array<number | null>): number | null => {
  const s = v.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * TurnoutForecastPanel — Phase-5 RESEARCH preview (flag-gated OFF). Transparent ridge log-linear forecast of
 * turnout for an upcoming event + band + tier + walk-forward MAPE vs baseline; the predicted number always
 * sits next to its band, tier, error, and the "chưa backtest" disclaimer. Feeds the EXISTING overlay engine
 * read-only (forecast-centered). Labeled Hypothesis — never Model Estimate. Resolves events like OCC.
 */
export function TurnoutForecastPanel({
  csvEvents,
  onForecastFeed,
}: {
  csvEvents?: SeriesEvent[] | null;
  /** Fires whenever the usable forecast feed changes (null when nothing usable) — lets the page offer
   *  the forecast as a center source to the group-history overlay simulator below. */
  onForecastFeed?: (feed: ForecastFeedWithFee | null) => void;
}) {
  const native = useNativeSeriesEvents();
  // csvEvents is null in native mode (mirrors OwnerCommandCenter's handling) — never .length on null.
  const events: SeriesEvent[] = csvEvents && csvEvents.length > 0 ? csvEvents : native.events;

  const [date, setDate] = useState("");
  // Real start hour matters: training rows carry true start times (hour-slot feature), so serving with a
  // date-only value would silently parse as UTC midnight (= 07:00 VN → always the morning slot) and
  // mis-apply the model's hour-of-day adjustment. Default 19:00 = typical VN tournament start, editable.
  const [startTime, setStartTime] = useState("19:00");
  const [buyIn, setBuyIn] = useState<number | null>(null);
  const [gtd, setGtd] = useState<number | null>(null);
  const [typeKeyword, setTypeKeyword] = useState("");
  const [override, setOverride] = useState<number | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);

  const ready = date.trim() !== "" && buyIn !== null && buyIn > 0;
  // Local datetime (never date-only): "YYYY-MM-DDTHH:mm" parses in LOCAL time, so the hour-slot feature
  // matches how the training rows' real start times were bucketed.
  const eventDateTime = `${date}T${/^\d{2}:\d{2}$/.test(startTime) ? startTime : "19:00"}:00`;
  const fc = useMemo(
    () => (ready ? forecastTurnout(events, { event_date: eventDateTime, buy_in: buyIn as number, gtd, typeKeyword: typeKeyword.trim() || null }) : null),
    [events, eventDateTime, buyIn, gtd, typeKeyword, ready],
  );
  const medianFee = useMemo(() => median(events.map((e) => e.fee)) ?? 0, [events]);

  const ownerBase = override ?? fc?.base ?? null;
  // Explicit forecast→overlay adapter feed (σ recovered from the forecast band; NO synthetic n anywhere).
  const feed = useMemo(() => forecastToOverlayFeed(fc, buyIn, override), [fc, buyIn, override]);
  const overlay = useMemo(() => {
    if (!showOverlay || !feed || gtd === null || gtd <= 0) return null;
    return simulateOverlayFromForecast({ baseEntries: feed.base, logSd: feed.logSd, buyinPrize: feed.buyIn, fee: medianFee, gtd, seed: 42 });
  }, [showOverlay, feed, gtd, medianFee]);

  // Bubble the feed up so the group-history simulator below can offer "Dự báo" as a center source.
  useEffect(() => {
    onForecastFeed?.(feed ? { ...feed, fee: medianFee } : null);
  }, [feed, medianFee, onForecastFeed]);

  const showCoef = fc?.available && fc.confidence !== "low" && fc.coefContributions.length > 0;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-display text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Dự báo số khách (khung nghiên cứu)
          <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">
            <FlaskConical className="h-2.5 w-2.5" /> Hypothesis · dự báo thống kê — chưa backtest đủ
          </span>
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Mô hình hồi quy minh bạch (ridge log-linear) trên giải đã chạy của CLB — gắn dải + độ tin theo lượng data.
          Khác với <strong>"gợi ý từ giải tương tự"</strong> ở Bước ⑥ (chỉ nhìn giải cùng tầm buy-in): đây là mô hình
          hồi quy nhiều yếu tố. Cả hai đều KHÔNG phải cam kết.
        </p>
      </div>

      {/* upcoming-event form */}
      <Card className="p-3 border-primary/30 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Ngày giải sắp tới</span><Input type="date" className="h-7" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Giờ bắt đầu (mặc định 19:00)</span><Input type="time" className="h-7" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label>
        <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Buy-in (prize)</span><Input type="number" className="h-7" value={buyIn ?? ""} onChange={(e) => setBuyIn(numOrNull(e.target.value))} /></label>
        <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">GTD (cho overlay)</span><Input type="number" className="h-7" placeholder="(tùy chọn)" value={gtd ?? ""} onChange={(e) => setGtd(numOrNull(e.target.value))} /></label>
        <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Loại (vd Turbo)</span><Input className="h-7" placeholder="(auto từ tên)" value={typeKeyword} onChange={(e) => setTypeKeyword(e.target.value)} /></label>
      </Card>

      {!ready ? (
        <Card className="p-4 border-dashed border-border text-[11px] text-muted-foreground">Nhập ngày + buy-in giải sắp tới để xem dự báo.</Card>
      ) : !fc?.available ? (
        <Card className="p-4 border-dashed border-warning/40 bg-warning/5 text-[11px] text-warning">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" /> Cần thêm dữ liệu — {fc?.missingDataNotes[0] ?? "chưa đủ giải trước đó để dự báo."}
        </Card>
      ) : (
        <div className="space-y-2">
          {/* the number — ALWAYS next to band + tier + error + disclaimer */}
          <Card className="p-3 gradient-card border-primary/40 space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <div>
                <div className="text-[10px] text-muted-foreground">Dự báo số khách</div>
                <div className="text-2xl font-semibold tabular-nums text-primary">{fc.base}</div>
              </div>
              <div className="text-[11px] tabular-nums text-muted-foreground">dải {fc.low}–{fc.high} (p10–p90)</div>
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", CONF[fc.confidence].cls)}>Độ tin: {CONF[fc.confidence].label}</span>
              <span className="text-[10px] text-muted-foreground">· {fc.sampleSize} giải trước đó</span>
            </div>
            <div className="flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
              {fc.modelMapePct !== null && <span>Sai số kiểm chứng (walk-forward): <span className="tabular-nums">{fc.modelMapePct}%</span></span>}
              {fc.baselineMapePct !== null && <span>· baseline (median): <span className="tabular-nums">{fc.baselineMapePct}%</span></span>}
              {fc.deltaVsBaselinePct !== null && (
                <span className={cn(fc.deltaVsBaselinePct > 0 ? "text-primary" : "text-warning")}>· model {fc.deltaVsBaselinePct > 0 ? "tốt hơn" : "kém hơn"} baseline {Math.abs(fc.deltaVsBaselinePct)}%</span>
              )}
            </div>
            <p className="text-[10px] text-warning/90 border border-warning/40 bg-warning/5 rounded-md p-1.5">{fc.disclaimer}</p>
            <RegimeNotice />
            <ExplainHint term="sai số kiểm chứng (walk-forward)">
              Máy <b>thử đoán lại từng giải trong quá khứ</b> — mỗi lần CHỈ dùng các giải diễn ra trước nó — rồi chấm
              điểm đoán sai bao nhiêu %. "Baseline (median)" = cách đoán ngây thơ nhất (lấy số giữa của các giải trước).
              Model chỉ đáng dùng khi thắng baseline một cách bền vững.
            </ExplainHint>
            {fc.missingDataNotes.map((n, i) => (
              <p key={i} className="text-[10px] text-muted-foreground">• {n}</p>
            ))}
          </Card>

          {/* coefficient contributions — ONLY at N ≥ 8, labeled correlation-not-causal */}
          {showCoef && (
            <Card className="p-3 border-border/60 space-y-1 text-[10px]">
              <div className="text-[11px] font-medium">Yếu tố ảnh hưởng (điều chỉnh của model — <span className="text-warning">tương quan, KHÔNG phải nhân quả</span>)</div>
              <div className="flex flex-wrap gap-1.5">
                {fc.coefContributions
                  .filter((c) => Math.abs(c.impactPct) >= 1)
                  .slice(0, 10)
                  .map((c) => (
                    <span key={c.feature} className="rounded border border-border px-1.5 py-0.5 tabular-nums text-muted-foreground">
                      {c.feature} {c.impactPct >= 0 ? "+" : ""}{c.impactPct}%
                    </span>
                  ))}
              </div>
            </Card>
          )}

          {/* forecast-centered overlay (reuses the existing engine, read-only) */}
          <Card className="p-3 border-primary/40 gradient-card space-y-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 font-medium"><Dice5 className="h-3.5 w-3.5 text-primary" /> Rủi ro overlay từ dự báo</div>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                base dùng cho overlay: <Input type="number" className="h-6 w-20" value={ownerBase ?? ""} onChange={(e) => setOverride(numOrNull(e.target.value))} />
              </label>
              {override !== null && <button type="button" className="text-[10px] text-primary underline" onClick={() => setOverride(null)}>dùng dự đoán</button>}
              <Button size="sm" variant="outline" className="h-6 gap-1 text-[10px]" onClick={() => setShowOverlay(true)}>Xem overlay</Button>
            </div>
            <p className="text-[10px] text-muted-foreground/80">
              Mô phỏng overlay <strong>TỪ DỰ ĐOÁN</strong> (forecast-centered), không phải phân phối quan sát lịch sử;
              fee dùng median toàn CLB ({formatVndShort(medianFee)} — giả định). Máy tính "Rủi ro overlay — kịch bản
              1 giải" bên dưới mặc định vẫn chạy theo lịch sử nhóm — muốn dùng dự báo này làm tâm, chọn nguồn{" "}
              <strong>"Dự báo"</strong> ở đó.
            </p>
            {showOverlay && (gtd === null || gtd <= 0 ? (
              <p className="text-[10px] text-warning">Đặt GTD ở trên để tính overlay.</p>
            ) : overlay ? (
              <div className="grid grid-cols-3 gap-2">
                <Cell label="P(bù overlay)" v={`${(overlay.pOverlay * 100).toFixed(1)}%`} danger={overlay.pOverlay > 0.2} />
                <Cell label="Entries P5·P50·P95" v={`${Math.round(overlay.entP5)}·${Math.round(overlay.entP50)}·${Math.round(overlay.entP95)}`} />
                <Cell label="Cần đủ GTD" v={`${Math.round(overlay.thresholdEntries)} entry`} />
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">Chưa tính được (thiếu base/buy-in).</p>
            ))}
          </Card>
        </div>
      )}
    </section>
  );
}

function Cell({ label, v, danger }: { label: string; v: string; danger?: boolean }) {
  return (
    <div className={cn("rounded-md border p-1.5", danger ? "border-warning/40 bg-warning/5" : "border-border/60")}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn("font-medium tabular-nums text-[11px]", danger ? "text-warning" : "")}>{v}</div>
    </div>
  );
}
