import { useEffect, useState } from "react";
import { Calculator, FlaskConical, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import { FEATURES } from "@/lib/featureFlags";
import type { ScheduleEvent } from "@/lib/series-intelligence/scheduleGenerator";
import { simulateFestival, type SimResult } from "@/lib/series-intelligence/monteCarloEngine";
import { scheduleToSimEvents } from "@/lib/series-intelligence/scheduleToMonteCarlo";
import { computeKellyHint, type KellyVerdict } from "@/lib/series-intelligence/kellyHint";
import { ExplainHint } from "./ExplainHint";
import { RegimeNotice } from "./RegimeNotice";

const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

/** ρ-extremes for the "read the tail" comparison box (same seed/params — only correlation moves). */
const TAIL_RHO_LO = 0;
const TAIL_RHO_HI = 0.85;

/** Theme tone per Kelly verdict (red = don't/over, amber = aggressive, primary = safe-ish). */
const KELLY_TONE: Record<KellyVerdict, string> = {
  "negative-ev": "border-destructive/40 bg-destructive/5",
  "over-committed": "border-destructive/40 bg-destructive/5",
  aggressive: "border-warning/40 bg-warning/5",
  acceptable: "border-primary/30 bg-primary/5",
  conservative: "border-primary/30 bg-primary/5",
  "insufficient-data": "border-border bg-card/40",
};

interface EvState {
  result: SimResult;
  usedCount: number;
  skippedCount: number;
  /** Same festival at ρ=0 vs ρ=0.85 (same seed) — shows correlation's tail effect with REAL numbers. */
  tail: { lo: SimResult; hi: SimResult } | null;
  /** Bankroll used for THIS sim (so the Kelly hint stays consistent with the shown RoR). */
  bankrollUsed: number | null;
}

/**
 * FestivalEvPanel — "Kịch bản EV — cả festival" (quant-mockup layout: ρ/α sliders → 6 stat cards → a
 * "đọc đuôi, không đọc trung bình" box computed from two REAL sims at ρ=0 vs ρ=0.85). The festival is a
 * correlated portfolio of events; the schedule is GENERATED → Hypothesis; scenario, never a commitment.
 */
export function FestivalEvPanel({ draft }: { draft: ScheduleEvent[] | null }) {
  const [rho, setRho] = useState(0.3);
  const [alpha, setAlpha] = useState(1.0);
  const [cost, setCost] = useState<number | null>(null);
  const [bankroll, setBankroll] = useState<number | null>(null);
  const [ev, setEv] = useState<EvState | null>(null);

  useEffect(() => setEv(null), [draft]); // a new/changed draft invalidates the previous EV scenario

  // Map the generated schedule → engine input (Hypothesis) → simulate EV (logic unchanged), plus two
  // extra fixed-seed sims at ρ extremes for the tail-comparison box.
  const computeEv = (): void => {
    if (!draft) return;
    const { events, skipped } = scheduleToSimEvents(draft);
    if (events.length === 0) {
      setEv(null);
      return;
    }
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const opts = { alpha, cost: cost && cost > 0 ? cost : undefined, bankroll: bankroll ?? undefined, nSims: 20000, seed };
    const result = simulateFestival(events, { ...opts, rho });
    const tail =
      bankroll !== null && bankroll > 0
        ? { lo: simulateFestival(events, { ...opts, rho: TAIL_RHO_LO }), hi: simulateFestival(events, { ...opts, rho: TAIL_RHO_HI }) }
        : null;
    setEv({ result, usedCount: events.length, skippedCount: skipped.length, tail, bankrollUsed: bankroll ?? null });
  };

  const r = ev?.result ?? null;
  const headline = r ? (r.mode === "profit" ? r.eEV ?? 0 : r.eGross) : 0;

  return (
    <Card className="p-4 border-primary/40 gradient-card space-y-3 text-xs">
      <div>
        <div className="flex flex-wrap items-center gap-1.5 font-display text-base">
          <Calculator className="h-4 w-4 text-primary" /> Kịch bản EV — cả festival
          <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">
            <FlaskConical className="h-2.5 w-2.5" /> Giả thuyết
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Coi festival như MỘT danh mục giải có tương quan · lịch là GENERATED (chưa quan sát) → kịch bản thuần giả
          định, không phải cam kết.
        </p>
      </div>

      {!draft ? (
        <p className="text-[11px] text-muted-foreground border border-dashed border-border rounded-md p-3">
          Hãy <strong>Sinh lịch</strong> ở Bước ③ trước, rồi quay lại đây để tính EV cho cả festival.
        </p>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
            <div className="space-y-0.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] text-muted-foreground">ρ — tương quan giữa các giải</span>
                <span className="tabular-nums text-primary font-medium">{rho.toFixed(2)}</span>
              </div>
              <input type="range" min={0} max={1} step={0.05} value={rho} onChange={(e) => setRho(Number(e.target.value))} className="w-full accent-primary" />
              <div className="text-[9.5px] text-muted-foreground/80">0 = độc lập · 1 = đông cùng đông, vắng cùng vắng</div>
            </div>
            <div className="space-y-0.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] text-muted-foreground">α — mức hung hăng đặt GTD</span>
                <span className="tabular-nums text-primary font-medium">×{alpha.toFixed(2)}</span>
              </div>
              <input type="range" min={0} max={2} step={0.1} value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} className="w-full accent-primary" />
              <div className="text-[9.5px] text-muted-foreground/80">cao = GTD sát/vượt kỳ vọng · rủi ro cao hơn</div>
            </div>
            <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Chi phí festival (tổng, tùy chọn)</span><Input type="number" className="h-7" placeholder="(trống → chỉ gross)" value={cost ?? ""} onChange={(e) => setCost(numOrNull(e.target.value))} /></label>
            <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Vốn dự phòng (cho Risk-of-Ruin)</span><Input type="number" className="h-7" placeholder="(trống)" value={bankroll ?? ""} onChange={(e) => setBankroll(numOrNull(e.target.value))} /></label>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={computeEv}>
            <Calculator className="h-4 w-4" /> Tính EV kịch bản
          </Button>
          <ExplainHint term="ρ và α">
            <b>ρ (tương quan)</b>: mức các giải trong festival <b>cùng vắng / cùng đông một mùa</b> — ρ cao thì lời
            kỳ vọng gần như không đổi nhưng rủi ro đuôi (lỗ nặng cả loạt) tăng mạnh. <b>α</b>: hệ số phóng to–thu nhỏ
            toàn bộ GTD để thử độ hung hăng cam kết.
          </ExplainHint>

          {ev && r && (
            <div className="space-y-2 border-t border-border/60 pt-2.5">
              <div className="text-[10px] text-muted-foreground">
                {ev.usedCount} giải vào mô phỏng{ev.skippedCount > 0 ? ` · ${ev.skippedCount} bỏ (không GTD)` : ""}
                {r.mode === "gross" && <span className="text-warning"> · chưa tính được lời/lỗ ròng (thiếu chi phí)</span>}
              </div>

              {/* 6 stat cards (mockup grid) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <StatCard
                  label={r.mode === "profit" ? "Lời kỳ vọng E[EV]" : "Gross trước chi phí (E)"}
                  value={`${headline >= 0 ? "+" : ""}${formatVndShort(headline)}`}
                  strong
                  danger={headline < 0}
                />
                <StatCard label="Lời · P5 / P50 / P95" value={`${formatVndShort(r.p5)} / ${formatVndShort(r.p50)} / ${formatVndShort(r.p95)}`} danger={r.p5 < 0} />
                <StatCard label="Xác suất lỗ P(lỗ)" value={`${(r.pLoss * 100).toFixed(0)}%`} danger={r.pLoss > 0.3} />
                <StatCard label="Risk-of-Ruin (cháy vốn)" value={r.ruin === null ? "— (nhập vốn dự phòng)" : `${(r.ruin * 100).toFixed(0)}%`} danger={(r.ruin ?? 0) > 0.1} />
                <StatCard label="P(overlay) — TB các giải" value={`${(r.pOverlayAny * 100).toFixed(0)}%`} />
                <StatCard label="Số giải trong festival" value={String(ev.usedCount)} />
              </div>

              {/* Đọc đuôi, không đọc trung bình — REAL numbers from two sims at ρ extremes */}
              {ev.tail && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px] leading-relaxed">
                  <b className="text-primary">Đọc đuôi, không đọc trung bình:</b> cùng lịch này, kéo ρ từ{" "}
                  {TAIL_RHO_LO} → {TAIL_RHO_HI}: lời kỳ vọng gần như không đổi (
                  <span className="tabular-nums">{formatVndShort(ev.tail.lo.mode === "profit" ? ev.tail.lo.eEV ?? 0 : ev.tail.lo.eGross)}</span> →{" "}
                  <span className="tabular-nums">{formatVndShort(ev.tail.hi.mode === "profit" ? ev.tail.hi.eEV ?? 0 : ev.tail.hi.eGross)}</span>
                  ), nhưng Risk-of-Ruin{" "}
                  <b className="text-destructive tabular-nums">
                    {ev.tail.lo.ruin !== null ? `${(ev.tail.lo.ruin * 100).toFixed(0)}%` : "—"} → {ev.tail.hi.ruin !== null ? `${(ev.tail.hi.ruin * 100).toFixed(0)}%` : "—"}
                  </b>{" "}
                  và mức xấu P5 từ <span className="tabular-nums">{formatVndShort(ev.tail.lo.p5)}</span> →{" "}
                  <span className="tabular-nums">{formatVndShort(ev.tail.hi.p5)}</span>. Tương quan vô hình trong
                  trung bình, chỉ mạnh ở đuôi.
                </div>
              )}

              {/* Kelly hint — humble reference only, flag-gated, needs owner-entered bankroll (never inferred) */}
              {FEATURES.seriesKellyHint &&
                (() => {
                  const kelly = computeKellyHint({ eEV: r.eEV, p5: r.p5, p95: r.p95, bankroll: ev.bankrollUsed, mode: r.mode });
                  if (!kelly.available) {
                    return ev.bankrollUsed === null ? (
                      <p className="rounded-md border border-dashed border-border p-2 text-[10px] text-muted-foreground">
                        Nhập <strong>Vốn dự phòng</strong> ở trên rồi bấm “Tính EV kịch bản” để xem gợi ý Kelly (mức cam kết GTD có quá tay không).
                      </p>
                    ) : null;
                  }
                  return (
                    <div className={cn("rounded-md border p-2 text-[10px] leading-relaxed", KELLY_TONE[kelly.verdict])}>
                      <div className="flex flex-wrap items-center gap-1.5 font-medium">
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">
                          <FlaskConical className="h-2.5 w-2.5" /> Giả thuyết
                        </span>
                        Gợi ý Kelly phân đoạn (¼–½)
                      </div>
                      <div className="mt-1">{kelly.headline}</div>
                      <div className="mt-1 text-muted-foreground/90">{kelly.caveat}</div>
                    </div>
                  );
                })()}

              <ExplainHint term="P5/P50/P95 · P(lỗ) · Risk-of-Ruin">
                <b>P5 · P50 · P95</b>: kịch bản 5% xấu nhất · điển hình · 5% tốt nhất (90% kịch bản nằm giữa P5–P95).
                <b> P(lỗ)</b>: khả năng cả festival kết thúc âm. <b>Risk-of-Ruin</b>: khả năng thua lũy kế vượt quá
                <b> vốn dự phòng</b> bạn nhập — "cụt vốn giữa chừng", cái thật sự giết doanh nghiệp, khác với lỗ nhẹ.
                <b> P(overlay)</b>: khả năng có ÍT NHẤT một giải phải bù GTD.
              </ExplainHint>

              <p className="text-[10px] text-warning/90 flex items-start gap-1 border border-warning/40 bg-warning/5 rounded-md p-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Lịch generated + giả thuyết → dải rất rộng. Đừng quyết định tài chính chỉ dựa trên số này.
              </p>
              <RegimeNotice />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function StatCard({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <div className={cn("rounded-md border p-2", danger ? "border-destructive/40 bg-destructive/5" : "border-border/60 bg-card/40")}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn("tabular-nums font-semibold", strong ? "font-display text-lg" : "text-[13px]", danger ? "text-destructive" : strong ? "text-primary" : "")}>{value}</div>
    </div>
  );
}
