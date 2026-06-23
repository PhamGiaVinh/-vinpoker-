import { useMemo, useState } from "react";
import { FlaskConical, SlidersHorizontal, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
import { useNativeSeriesEvents } from "@/lib/series-intelligence/useNativeSeriesEvents";
import { simulateScenarioWhatIf, type ComparableFilter } from "@/lib/series-intelligence/scenarioSimulator";
import type { ScenarioConfidence } from "@/lib/series-intelligence/scenarioOutlook";

const DOW_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const CONF_LABEL: Record<ScenarioConfidence, string> = { low: "Thấp / Noisy", medium: "Trung bình", high: "Cao" };
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const fmtRange = (r: { low: number; high: number } | null, money = false): string =>
  r === null ? "—" : money ? `${formatVndShort(r.low)} – ${formatVndShort(r.high)}` : `${r.low}–${r.high}`;

/**
 * ScenarioSimulatorPanel — Phase 4 interactive what-if. The owner filters comparable events + sets transparent
 * assumptions (marketing push, slot factor, candidate GTD); the tool shows Conservative/Base/Upside ENTRY
 * ranges shifted by the owner-set factor + a per-band GTD overlay. Rules-based, deterministic, NOT a forecast.
 * Resolves events like OwnerCommandCenter (active CSV series, else live native). PokerVN / Stitch Dark.
 */
export function ScenarioSimulatorPanel({ csvEvents }: { csvEvents: SeriesEvent[] }) {
  const native = useNativeSeriesEvents();
  const events: SeriesEvent[] = csvEvents.length > 0 ? csvEvents : native.events;

  const [keyword, setKeyword] = useState("");
  const [dow, setDow] = useState<number | null>(null); // null = all days
  const [marketing, setMarketing] = useState(0); // 0..30 %
  const [slot, setSlot] = useState(0); // -20..20 %
  const [gtd, setGtd] = useState<number | null>(null);

  const result = useMemo(() => {
    const filter: ComparableFilter = { dayOfWeek: dow, typeKeyword: keyword.trim() || null };
    return simulateScenarioWhatIf(events, { filter, assumptions: { marketingPushPct: marketing, slotFactorPct: slot, candidateGtd: gtd } });
  }, [events, keyword, dow, marketing, slot, gtd]);

  const factorPct = Math.round((result.assumptionFactor - 1) * 100);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-display text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Thử kịch bản: giải tương tự sẽ đông cỡ nào?
          <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">
            <FlaskConical className="h-2.5 w-2.5" /> Kịch bản
          </span>
        </h3>
        <p className="text-[11px] text-muted-foreground">
          What-if dựa trên giải đã chạy của CLB + giả định bạn đặt (hiện rõ). Dải Thận trọng / Cơ sở / Tích cực —
          <strong> không phải dự đoán, không phải cam kết</strong>. Phase 5 (mô hình học) vẫn khoá.
        </p>
      </div>

      {/* controls */}
      <Card className="p-3 border-primary/30 space-y-2.5 text-[11px]">
        <div className="flex items-center gap-1.5 font-medium"><SlidersHorizontal className="h-3.5 w-3.5 text-primary" /> Chọn giải tương đương + giả định</div>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">Lọc theo tên (vd: Turbo, Main)</span>
            <Input className="h-7" placeholder="(trống = tất cả)" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">GTD cam kết muốn thử (VND)</span>
            <Input type="number" className="h-7" placeholder="(trống = không tính overlay)" value={gtd ?? ""} onChange={(e) => setGtd(numOrNull(e.target.value))} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-muted-foreground mr-1">Thứ:</span>
          <button type="button" onClick={() => setDow(null)} className={cn("rounded border px-2 py-0.5 text-[10px]", dow === null ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")}>Tất cả</button>
          {DOW_LABELS.map((lbl, i) => (
            <button key={i} type="button" onClick={() => setDow(i)} className={cn("rounded border px-2 py-0.5 text-[10px]", dow === i ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")}>{lbl}</button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          <RangeRow label={`Đẩy marketing: +${marketing}%`} value={marketing} min={0} max={30} step={5} onChange={setMarketing} />
          <RangeRow label={`Slot / lịch: ${slot >= 0 ? "+" : ""}${slot}%`} value={slot} min={-20} max={20} step={5} onChange={setSlot} />
        </div>
        <p className="text-[10px] text-muted-foreground/80">Hệ số giả định ròng đang áp dụng: <span className="text-primary font-medium">{factorPct >= 0 ? "+" : ""}{factorPct}%</span> (hiện rõ, không hệ số ẩn).</p>
      </Card>

      {/* output */}
      {!result.available ? (
        <Card className="p-4 border-dashed border-border text-[11px] text-muted-foreground">
          Chưa đủ giải tương đương có số entry để dựng kịch bản. Nới bộ lọc, hoặc nạp thêm dữ liệu ở Bước ①.
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className={cn("rounded-full border px-2 py-0.5", result.confidence === "high" ? "border-primary/50 text-primary" : result.confidence === "medium" ? "border-warning/50 text-warning" : "border-destructive/50 text-destructive")}>
              Độ tin cậy: {CONF_LABEL[result.confidence]}
            </span>
            <span className="text-muted-foreground">Cơ sở: {result.sampleSize} giải tương đương{result.noisy ? " · Noisy (<4)" : ""}</span>
          </div>

          <div className="grid sm:grid-cols-3 gap-2">
            {result.bands.map((b) => (
              <Card key={b.kind} className={cn("p-3 gradient-card space-y-1", b.kind === "upside" ? "border-primary/40" : "border-border/60")}>
                <div className="text-[11px] font-medium flex items-center justify-between">
                  <span>{b.label}</span>
                  {b.kind === "upside" && <span className="text-[9px] text-warning">Hypothesis</span>}
                </div>
                <div className="text-lg font-semibold tabular-nums">{fmtRange(b.entryRange)}</div>
                <div className="text-[10px] text-muted-foreground">lượt entry / event</div>
                <div className="pt-1 border-t border-border/40 text-[10px] space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Prize (ước tính)</span><span className="tabular-nums">{fmtRange(b.prizeBand, true)}</span></div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Overlay GTD</span>
                    <span className={cn("tabular-nums", b.overlay && b.overlay.high > 0 ? "text-warning" : "")}>{fmtRange(b.overlay, true)}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {result.basisEventNames.length > 0 && (
            <p className="text-[10px] text-muted-foreground/80">Dựa trên {result.sampleSize} giải: {result.basisEventNames.slice(0, 6).join(", ")}{result.basisEventNames.length > 6 ? `, …+${result.basisEventNames.length - 6}` : ""}.</p>
          )}
          {result.missingDataNotes.map((n, i) => (
            <p key={i} className="text-[10px] text-warning/90">• {n}</p>
          ))}
          <p className="text-[10px] text-muted-foreground border border-border/60 rounded-md p-2">{result.disclaimer}</p>
        </div>
      )}
    </section>
  );
}

function RangeRow({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </div>
  );
}
