import { useEffect, useMemo, useState } from "react";
import { TrendingUp, FlaskConical, AlertTriangle, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
import { useNativeSeriesEvents } from "@/lib/series-intelligence/useNativeSeriesEvents";
import {
  forecastTurnout,
  forecastToOverlayFeed,
  describeFeature,
  type ForecastConfidence,
  type ForecastOverlayFeed,
} from "@/lib/series-intelligence/turnoutForecast";
import { ExplainHint } from "./ExplainHint";
import { RegimeNotice } from "./RegimeNotice";

/** What this panel emits upward so the group-history overlay simulator can offer a forecast center. */
export type ForecastFeedWithFee = ForecastOverlayFeed & { fee: number };

const CONF: Record<ForecastConfidence, { label: string; cls: string }> = {
  low: { label: "Thấp — ít dữ liệu", cls: "border-destructive/50 bg-destructive/10 text-destructive" },
  medium: { label: "Trung bình", cls: "border-warning/50 bg-warning/10 text-warning" },
  high: { label: "Cao", cls: "border-primary/50 bg-primary/10 text-primary" },
};
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const median = (v: Array<number | null>): number | null => {
  const s = v.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * TurnoutForecastPanel — "Dự báo lượng khách — giải sắp tới" (quant-spec mockup layout: form + factor
 * contributions on the left, the BIG number + band + tier + CV tiles + CTA on the right). Transparent ridge
 * log-linear; the number never appears without band + tier + error + disclaimer. Labeled Hypothesis — never
 * Model Estimate. The CTA hands the forecast to the overlay simulator below (explicit adapter, no fake n).
 */
export function TurnoutForecastPanel({
  csvEvents,
  onForecastFeed,
  onViewOverlayWithForecast,
}: {
  csvEvents?: SeriesEvent[] | null;
  /** Fires whenever the usable forecast feed changes (null when nothing usable). */
  onForecastFeed?: (feed: ForecastFeedWithFee | null) => void;
  /** CTA "Xem rủi ro overlay với dự đoán này" — the page switches the simulator's center source + scrolls. */
  onViewOverlayWithForecast?: () => void;
}) {
  const native = useNativeSeriesEvents();
  // csvEvents is null in native mode (mirrors OwnerCommandCenter's handling) — never .length on null.
  const events: SeriesEvent[] = csvEvents && csvEvents.length > 0 ? csvEvents : native.events;

  const [date, setDate] = useState("");
  // Real start hour matters: training rows carry true start times (hour-slot feature); a date-only value
  // would parse as UTC midnight (= 07:00 VN → always the morning slot). Default 19:00, editable.
  const [startTime, setStartTime] = useState("19:00");
  const [buyIn, setBuyIn] = useState<number | null>(null);
  const [gtd, setGtd] = useState<number | null>(null);
  const [typeKeyword, setTypeKeyword] = useState("");
  const [override, setOverride] = useState<number | null>(null);

  const ready = date.trim() !== "" && buyIn !== null && buyIn > 0;
  // Local datetime (never date-only) so the hour-slot feature matches the training rows' bucketing.
  const eventDateTime = `${date}T${/^\d{2}:\d{2}$/.test(startTime) ? startTime : "19:00"}:00`;
  const fc = useMemo(
    () => (ready ? forecastTurnout(events, { event_date: eventDateTime, buy_in: buyIn as number, gtd, typeKeyword: typeKeyword.trim() || null }) : null),
    [events, eventDateTime, buyIn, gtd, typeKeyword, ready],
  );
  const medianFee = useMemo(() => median(events.map((e) => e.fee)) ?? 0, [events]);

  // Explicit forecast→overlay adapter feed (σ recovered from the forecast band; NO synthetic n anywhere).
  const feed = useMemo(() => forecastToOverlayFeed(fc, buyIn, override), [fc, buyIn, override]);

  // Bubble the feed up so the simulator below can offer "Dự báo" as a center source.
  useEffect(() => {
    onForecastFeed?.(feed ? { ...feed, fee: medianFee } : null);
  }, [feed, medianFee, onForecastFeed]);

  const contributions = (fc?.coefContributions ?? []).filter((c) => Math.abs(c.impactPct) >= 1).slice(0, 8);
  const showCoef = fc?.available && fc.confidence !== "low" && contributions.length > 0;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-display text-lg flex flex-wrap items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Dự báo lượng khách — giải sắp tới
          <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">
            <FlaskConical className="h-2.5 w-2.5" /> Hypothesis · dự báo thống kê — chưa backtest đủ
          </span>
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Học từ các giải đã chạy của club, chỉ dùng thông tin biết-trước-giải. Khác với "gợi ý từ giải tương tự" ở
          Bước ⑥ — đây là mô hình hồi quy nhiều yếu tố. Cả hai đều KHÔNG phải cam kết.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* LEFT — form + factor contributions */}
        <div className="space-y-3">
          <Card className="p-3 border-primary/30 space-y-2">
            <div className="text-[11px] font-medium">Thông số giải sắp tới</div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Ngày giải</span><Input type="date" className="h-8" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Giờ bắt đầu</span><Input type="time" className="h-8" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label>
              <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Buy-in (prize)</span><Input type="number" className="h-8" placeholder="vd 3000000" value={buyIn ?? ""} onChange={(e) => setBuyIn(numOrNull(e.target.value))} /></label>
              <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">GTD dự kiến</span><Input type="number" className="h-8" placeholder="(tùy chọn)" value={gtd ?? ""} onChange={(e) => setGtd(numOrNull(e.target.value))} /></label>
              <label className="col-span-2 flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Loại giải (vd Main, Turbo — auto từ tên nếu trống)</span><Input className="h-8" value={typeKeyword} onChange={(e) => setTypeKeyword(e.target.value)} /></label>
            </div>
          </Card>

          <Card className="p-3 border-border/60 space-y-1.5">
            <div className="text-[11px] font-medium">
              Yếu tố đóng góp dự đoán <span className="font-normal text-muted-foreground">(hiện khi đủ dữ liệu)</span>
            </div>
            {showCoef ? (
              <>
                <ul className="space-y-1">
                  {contributions.map((c) => (
                    <li key={c.feature} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-muted-foreground">{describeFeature(c.feature)}</span>
                      <span className={cn("tabular-nums font-medium", c.impactPct >= 0 ? "text-primary" : "text-destructive")}>
                        {c.impactPct >= 0 ? "+" : ""}{c.impactPct}%
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-warning/90">Điều chỉnh của model — tương quan, KHÔNG phải nhân quả.</p>
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Cần ≥ 8 giải đã chạy để model tách được từng yếu tố (thứ trong tuần, khung giờ, loại giải…).
              </p>
            )}
          </Card>
        </div>

        {/* RIGHT — the number (always with band + tier + error + disclaimer) */}
        <div>
          {!ready ? (
            <Card className="flex h-full min-h-[220px] items-center justify-center border-dashed border-border p-4 text-[11px] text-muted-foreground">
              Nhập ngày + buy-in giải sắp tới để xem dự báo.
            </Card>
          ) : !fc?.available ? (
            <Card className="flex h-full min-h-[220px] items-center justify-center border-dashed border-warning/40 bg-warning/5 p-4 text-[11px] text-warning">
              <span><AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Cần thêm dữ liệu — {fc?.missingDataNotes[0] ?? "chưa đủ giải trước đó để dự báo."}</span>
            </Card>
          ) : (
            <Card className="gradient-card space-y-3 border-primary/40 p-4">
              <div className="text-center">
                <div className="text-[11px] text-muted-foreground">Dự đoán lượng khách</div>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="font-display text-5xl tabular-nums text-primary">{override ?? fc.base}</span>
                  {override !== null && <span className="text-[10px] text-warning">(đã sửa tay)</span>}
                </div>
                <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  khoảng {fc.low} – {fc.high} khách (p10–p90)
                </div>
                <span className={cn("mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px]", CONF[fc.confidence].cls)}>
                  Độ tin: {CONF[fc.confidence].label} · N={fc.sampleSize} giải
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border/60 bg-card/40 p-2 text-center">
                  <div className="font-display text-lg tabular-nums">{fc.modelMapePct !== null ? `${fc.modelMapePct}%` : "—"}</div>
                  <div className="text-[10px] text-muted-foreground">Sai số kiểm chứng (walk-forward CV)</div>
                  {fc.deltaVsBaselinePct !== null && (
                    <div className={cn("text-[10px]", fc.deltaVsBaselinePct > 0 ? "text-primary" : "text-warning")}>
                      {fc.deltaVsBaselinePct > 0 ? "tốt hơn" : "kém hơn"} baseline {Math.abs(fc.deltaVsBaselinePct)}%
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-border/60 bg-card/40 p-2 text-center">
                  <div className="font-display text-lg tabular-nums">{fc.sampleSize}</div>
                  <div className="text-[10px] text-muted-foreground">Giải trước đó đã học</div>
                </div>
              </div>

              <label className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                Sửa đè con số (chủ club luôn quyết):
                <Input type="number" className="h-6 w-24" value={override ?? ""} placeholder={String(fc.base)} onChange={(e) => setOverride(numOrNull(e.target.value))} />
                {override !== null && (
                  <button type="button" className="text-primary underline" onClick={() => setOverride(null)}>dùng dự đoán</button>
                )}
              </label>

              <Button
                className="w-full gap-1.5"
                disabled={!feed || gtd === null || gtd <= 0}
                onClick={() => onViewOverlayWithForecast?.()}
                title={gtd === null || gtd <= 0 ? "Nhập GTD dự kiến ở form bên trái trước" : undefined}
              >
                <ChevronRight className="h-4 w-4" /> Xem rủi ro overlay với dự đoán này
              </Button>
              {(gtd === null || gtd <= 0) && (
                <p className="text-center text-[10px] text-muted-foreground">Nhập GTD dự kiến để mở máy tính rủi ro overlay bên dưới.</p>
              )}
              {feed && (
                <p className="text-center text-[10px] text-muted-foreground/80">
                  fee mô phỏng = median toàn CLB ({formatVndShort(medianFee)} — giả định)
                </p>
              )}

              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] leading-snug text-destructive/90">
                {fc.disclaimer}
              </div>
              <RegimeNotice />
              <ExplainHint term="sai số kiểm chứng (walk-forward)">
                Máy <b>thử đoán lại từng giải trong quá khứ</b> — mỗi lần CHỈ dùng các giải diễn ra trước nó — rồi chấm
                điểm đoán sai bao nhiêu %. "Baseline" = cách đoán ngây thơ nhất (lấy số giữa của các giải trước).
                Model chỉ đáng dùng khi thắng baseline bền vững.
              </ExplainHint>
              {fc.missingDataNotes.map((n, i) => (
                <p key={i} className="text-[10px] text-muted-foreground">• {n}</p>
              ))}
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
