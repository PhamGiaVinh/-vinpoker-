import { useEffect, useState } from "react";
import { Calculator, FlaskConical, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import type { ScheduleEvent } from "@/lib/series-intelligence/scheduleGenerator";
import { simulateFestival, type SimResult } from "@/lib/series-intelligence/monteCarloEngine";
import { scheduleToSimEvents } from "@/lib/series-intelligence/scheduleToMonteCarlo";
import { ExplainHint } from "./ExplainHint";

const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

/**
 * FestivalEvPanel — Step ④ (after the overlay-risk Monte Carlo). The EV scenario for a GENERATED festival
 * schedule (B.2), lifted out of ScheduleGeneratorPanel so risk is reviewed before EV. Reads the lifted `draft`
 * via props; the simulation (`scheduleToSimEvents` + `simulateFestival`) is IDENTICAL — only the data source
 * moved. A new/changed draft clears the previous EV (replicates the old generate()→setEv(null) invalidation).
 */
export function FestivalEvPanel({ draft }: { draft: ScheduleEvent[] | null }) {
  const [rho, setRho] = useState(0.3);
  const [alpha, setAlpha] = useState(1.0);
  const [cost, setCost] = useState<number | null>(null);
  const [bankroll, setBankroll] = useState<number | null>(null);
  const [ev, setEv] = useState<{ result: SimResult; usedCount: number; skippedCount: number } | null>(null);

  useEffect(() => setEv(null), [draft]); // a new/changed draft invalidates the previous EV scenario

  // B.2: map the generated schedule → engine input (Hypothesis) → simulate EV. (logic unchanged)
  const computeEv = (): void => {
    if (!draft) return;
    const { events, skipped } = scheduleToSimEvents(draft);
    if (events.length === 0) {
      setEv(null);
      return;
    }
    const result = simulateFestival(events, {
      rho,
      alpha,
      cost: cost && cost > 0 ? cost : undefined,
      bankroll: bankroll ?? undefined,
      nSims: 20000,
      seed: Math.floor(Math.random() * 0x7fffffff),
    });
    setEv({ result, usedCount: events.length, skippedCount: skipped.length });
  };

  return (
    <Card className="p-3 border-primary/40 gradient-card space-y-2 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        <Calculator className="h-3.5 w-3.5 text-primary" /> EV cả festival
        <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning"><FlaskConical className="h-2.5 w-2.5" /> Giả thuyết</span>
      </div>
      <p className="text-[10px] text-muted-foreground">Kịch bản EV (Monte Carlo) cho cả lịch. Lịch là GENERATED (chưa quan sát) → mỗi event là giả thuyết (σ rộng, tier Giả thuyết). Số EV là KỊCH BẢN thuần giả định, KHÔNG phải dự báo.</p>
      {!draft ? (
        <p className="text-[11px] text-muted-foreground border border-dashed border-border rounded-md p-3">
          Hãy <strong>Sinh lịch</strong> ở Bước ③ trước, rồi quay lại đây để tính EV cho cả festival.
        </p>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-2">
            <RangeRow label={`ρ — đồng biến động: ${rho.toFixed(2)}`} value={rho} min={0} max={1} step={0.05} onChange={setRho} />
            <RangeRow label={`α — GTD: ×${alpha.toFixed(1)}`} value={alpha} min={0} max={2} step={0.1} onChange={setAlpha} />
            <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Chi phí festival (tổng, tùy chọn)</span><Input type="number" className="h-7" placeholder="(trống → chỉ gross)" value={cost ?? ""} onChange={(e) => setCost(numOrNull(e.target.value))} /></label>
            <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Bankroll (cho Risk-of-Ruin)</span><Input type="number" className="h-7" placeholder="(trống)" value={bankroll ?? ""} onChange={(e) => setBankroll(numOrNull(e.target.value))} /></label>
          </div>
          <ExplainHint term="ρ và α">
            <b>ρ (đồng biến động)</b>: mức các giải trong festival <b>cùng vắng / cùng đông một mùa</b> — ρ cao thì lời
            kỳ vọng gần như không đổi nhưng rủi ro đuôi (lỗ nặng cả loạt) tăng mạnh. <b>α</b>: hệ số phóng to–thu nhỏ
            toàn bộ GTD để thử độ hung hăng cam kết ("nếu tôi hứa GTD gấp rưỡi thì sao?").
          </ExplainHint>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={computeEv}>
            <Calculator className="h-4 w-4" /> Tính EV kịch bản
          </Button>
          {ev && (
            <div className="space-y-1.5 border-t border-border/60 pt-2">
              <div className="text-[10px] text-muted-foreground">{ev.usedCount} event vào mô phỏng{ev.skippedCount > 0 ? ` · ${ev.skippedCount} bỏ (không GTD)` : ""}</div>
              <div>
                <div className="text-[11px] text-muted-foreground">
                  {ev.result.mode === "profit" ? "E[EV] (kịch bản)" : "Gross trước chi phí (E)"}
                  {ev.result.mode === "gross" && <span className="text-warning"> · chưa tính được profit (thiếu cost)</span>}
                </div>
                <div className={cn("text-lg font-semibold tabular-nums", (ev.result.mode === "profit" ? ev.result.eEV ?? 0 : ev.result.eGross) < 0 ? "text-warning" : "text-primary")}>
                  {formatVndShort(ev.result.mode === "profit" ? ev.result.eEV ?? 0 : ev.result.eGross)}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <EvCell label="P5" v={formatVndShort(ev.result.p5)} danger={ev.result.p5 < 0} />
                <EvCell label="P50" v={formatVndShort(ev.result.p50)} />
                <EvCell label="P95" v={formatVndShort(ev.result.p95)} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <EvCell label="P(lỗ)" v={`${(ev.result.pLoss * 100).toFixed(1)}%`} />
                <EvCell label="Risk-of-Ruin (Giả thuyết)" v={ev.result.ruin === null ? "—" : `${(ev.result.ruin * 100).toFixed(1)}%`} danger />
                <EvCell label="P(overlay)" v={`${(ev.result.pOverlayAny * 100).toFixed(1)}%`} />
              </div>
              <ExplainHint term="P5/P50/P95 · P(lỗ) · Risk-of-Ruin">
                <b>P5 · P50 · P95</b>: kịch bản 5% xấu nhất · điển hình · 5% tốt nhất (90% kịch bản nằm giữa P5–P95).
                <b> P(lỗ)</b>: khả năng cả festival kết thúc âm. <b>Risk-of-Ruin</b>: khả năng thua lũy kế vượt quá
                <b> vốn dự phòng</b> bạn nhập — tức là "cụt vốn giữa chừng", cái thật sự giết doanh nghiệp, khác với
                chỉ lỗ nhẹ. <b>P(overlay)</b>: khả năng có ÍT NHẤT một giải phải bù GTD.
              </ExplainHint>
              <p className="text-[10px] text-warning/90 flex items-start gap-1 border border-warning/40 bg-warning/5 rounded-md p-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Lịch generated + giả thuyết → dải rất rộng. Đừng quyết định tài chính chỉ dựa trên số này.
              </p>
            </div>
          )}
        </>
      )}
    </Card>
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

function EvCell({ label, v, danger }: { label: string; v: string; danger?: boolean }) {
  return (
    <div className={cn("rounded-md border p-1.5", danger ? "border-warning/40 bg-warning/5" : "border-border/60")}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn("font-medium tabular-nums", danger && v !== "—" ? "text-warning" : "")}>{v}</div>
    </div>
  );
}
