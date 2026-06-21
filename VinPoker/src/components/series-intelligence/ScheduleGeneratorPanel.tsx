import { useMemo, useState, type ReactNode } from "react";
import { CalendarRange, Play, AlertTriangle, Sliders, Calculator, FlaskConical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import { generateSchedule, type ScheduleInput, type ScheduleEvent } from "@/lib/series-intelligence/scheduleGenerator";
import { DEFAULT_RULES, mergeRules, type EventClass, type RulesOverride } from "@/lib/series-intelligence/tdRules";
import { simulateFestival, type SimResult } from "@/lib/series-intelligence/monteCarloEngine";
import { scheduleToSimEvents } from "@/lib/series-intelligence/scheduleToMonteCarlo";

const EVENT_CLASSES = Object.keys(DEFAULT_RULES.eventClassDefaults) as EventClass[];
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

/**
 * Festival schedule generator — DRAFT skeleton from a form + source-labeled, EDITABLE TD-rule defaults.
 * A planning aid for TD review, NOT a committed schedule, NOT financial, NOT DB. Pure client-side; reuses
 * the forwardLayerMonteCarlo flag. Each event carries enough to feed Monte Carlo later (B.2, not here).
 */
export function ScheduleGeneratorPanel() {
  const [form, setForm] = useState<Omit<ScheduleInput, "buyInTiers">>({
    festivalDays: 10,
    eventsPerDay: 7,
    mainBuyIn: 20_000_000,
    mainGtdEntries: null,
    venueCapacity: 1000,
    seasonalityOn: false,
  });
  const [tiersText, setTiersText] = useState("2000000, 5000000, 20000000, 100000000");
  const [override, setOverride] = useState<RulesOverride>({});
  const [draft, setDraft] = useState<ScheduleEvent[] | null>(null);
  // B.2 — EV scenario from the generated schedule (Hypothesis: generated events are unobserved).
  const [rho, setRho] = useState(0.3);
  const [alpha, setAlpha] = useState(1.0);
  const [cost, setCost] = useState<number | null>(null);
  const [bankroll, setBankroll] = useState<number | null>(null);
  const [ev, setEv] = useState<{ result: SimResult; usedCount: number; skippedCount: number } | null>(null);

  const effective = useMemo(() => mergeRules(DEFAULT_RULES, override).eventClassDefaults, [override]);
  const buyInTiers = useMemo(() => tiersText.split(/[,\n]/).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0), [tiersText]);

  const setNum = (k: keyof Omit<ScheduleInput, "buyInTiers" | "seasonalityOn">, v: string): void =>
    setForm((f) => ({ ...f, [k]: numOrNull(v) }));
  const setClassField = (cls: EventClass, field: "gtdEntriesFloor" | "feeRatio", v: number): void =>
    setOverride((prev) => ({
      ...prev,
      eventClassDefaults: { ...prev.eventClassDefaults, [cls]: { ...prev.eventClassDefaults?.[cls], [field]: v } },
    }));

  const generate = (): void => {
    setDraft(generateSchedule({ ...form, mainBuyIn: form.mainBuyIn || 0, venueCapacity: form.venueCapacity || 1, festivalDays: form.festivalDays || 1, eventsPerDay: form.eventsPerDay || 7, buyInTiers }, override));
    setEv(null); // a new draft invalidates the previous EV scenario
  };

  // B.2: map the generated schedule → engine input (Hypothesis) → simulate EV.
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

  const byDay = useMemo(() => {
    if (!draft) return null;
    const m = new Map<number, ScheduleEvent[]>();
    for (const e of draft) {
      const arr = m.get(e.day);
      if (arr) arr.push(e);
      else m.set(e.day, [e]);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [draft]);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-display text-base flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-primary" /> Sinh lịch festival (DRAFT)
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Skeleton lịch sinh từ quy tắc TD (<strong>sửa được, có nhãn nguồn</strong>) + form. <strong>KHÔNG phải lịch chốt</strong>, không phải số tài chính.
        </p>
      </div>

      {/* form */}
      <Card className="p-3 border-primary/30 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <Field label="Số ngày festival"><Input type="number" className="h-7" value={form.festivalDays ?? ""} onChange={(e) => setNum("festivalDays", e.target.value)} /></Field>
        <Field label="Event/ngày (7–9)"><Input type="number" className="h-7" value={form.eventsPerDay ?? ""} onChange={(e) => setNum("eventsPerDay", e.target.value)} /></Field>
        <Field label="Main buy-in (prize)"><Input type="number" className="h-7" value={form.mainBuyIn ?? ""} onChange={(e) => setNum("mainBuyIn", e.target.value)} /></Field>
        <Field label="Main GTD-entries (tùy chọn)"><Input type="number" className="h-7" placeholder="auto từ rule" value={form.mainGtdEntries ?? ""} onChange={(e) => setNum("mainGtdEntries", e.target.value)} /></Field>
        <Field label="Trần entries cam kết / event"><Input type="number" className="h-7" value={form.venueCapacity ?? ""} onChange={(e) => setNum("venueCapacity", e.target.value)} /></Field>
        <Field label="Buy-in tiers (phẩy)"><Input className="h-7" value={tiersText} onChange={(e) => setTiersText(e.target.value)} /></Field>
        <div className="col-span-2 sm:col-span-3 flex items-center gap-2 pt-1">
          <Switch checked={form.seasonalityOn} onCheckedChange={(v) => setForm((f) => ({ ...f, seasonalityOn: v }))} />
          <Label className="text-[11px] text-muted-foreground">Mùa vụ ×{DEFAULT_RULES.seasonality.multiplier} — <span className="text-warning">Giả thuyết, chưa kiểm chứng</span></Label>
        </div>
      </Card>

      <p className="text-[10px] text-muted-foreground/80">"Trần entries cam kết / event" = trần rủi ro GTD của bạn cho MỘT event (KHÔNG phải số ghế — Main có thể 2350 entry qua re-entry trong sảnh 500 ghế).</p>

      {/* editable TD-rule defaults */}
      <Card className="p-3 border-primary/30 space-y-1.5 text-[11px]">
        <div className="flex items-center gap-1.5 font-medium"><Sliders className="h-3.5 w-3.5 text-primary" /> Quy tắc TD (mặc định — sửa được)</div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="text-[10px] text-muted-foreground">
              <tr><th className="text-left font-normal py-0.5">Class</th><th className="text-right font-normal">GTD-entries floor</th><th className="text-right font-normal">Fee/buy-in</th><th className="text-left font-normal pl-2">Nguồn</th></tr>
            </thead>
            <tbody>
              {EVENT_CLASSES.map((cls) => (
                <tr key={cls} className="border-t border-border/40">
                  <td className="py-0.5">{cls}{effective[cls].marquee ? <span className="ml-1 text-[9px] text-primary">marquee</span> : null}</td>
                  <td className="text-right"><Input type="number" className="h-6 w-20 text-right inline-block" value={effective[cls].gtdEntriesFloor} onChange={(e) => setClassField(cls, "gtdEntriesFloor", Number(e.target.value))} /></td>
                  <td className="text-right"><Input type="number" step="0.01" className="h-6 w-16 text-right inline-block" value={effective[cls].feeRatio} onChange={(e) => setClassField(cls, "feeRatio", Number(e.target.value))} /></td>
                  <td className="pl-2">
                    {effective[cls].sourceLabels.map((l) => (
                      <span key={l} className="mr-1 inline-block rounded border border-border px-1 py-0.5 text-[9px] text-muted-foreground">{l}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Button size="sm" className="gap-1.5" onClick={generate}>
        <Play className="h-4 w-4" /> Sinh lịch
      </Button>

      {/* draft output */}
      {byDay && (
        <div className="space-y-2">
          <Card className="p-2.5 border-warning/40 bg-warning/5 flex items-start gap-2 text-[11px]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span><strong>DRAFT — cần TD review trước khi dùng thật.</strong> Lịch skeleton từ quy tắc TD (sửa được) + giả định mùa vụ. KHÔNG phải lịch chốt, KHÔNG phải số tài chính.</span>
          </Card>
          {byDay.map(([day, evs]) => (
            <Card key={day} className="p-3 gradient-card border-primary/30 space-y-1">
              <div className="text-xs font-medium">Ngày {day} <span className="text-muted-foreground">· {evs.length} event</span></div>
              <ul className="space-y-0.5">
                {evs.map((e, i) => (
                  <li key={i} className="text-[11px] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium min-w-[140px]">{e.name}</span>
                    <span className="tabular-nums text-muted-foreground">buy-in {formatVndShort(e.buy_in_prize)}</span>
                    <span className="tabular-nums text-muted-foreground">fee {formatVndShort(e.fee_rake)}</span>
                    <span className="tabular-nums">GTD {e.GTD === 0 ? "—" : formatVndShort(e.GTD)}</span>
                    <span className="flex gap-0.5">
                      {e.sourceLabels.map((l) => (
                        <span key={l} className={cn("rounded border px-1 py-0.5 text-[9px]", l === "Hypothesis" ? "border-warning/40 text-warning" : "border-border text-muted-foreground")}>{l}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}

          {/* B.2 — EV scenario from the generated schedule (Hypothesis: generated, not observed) */}
          <Card className="p-3 border-primary/40 gradient-card space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <Calculator className="h-3.5 w-3.5 text-primary" /> Kịch bản EV (Monte Carlo)
              <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning"><FlaskConical className="h-2.5 w-2.5" /> Giả thuyết</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Lịch là GENERATED (chưa quan sát) → mỗi event là giả thuyết (σ rộng, tier Giả thuyết). Số EV là KỊCH BẢN thuần giả định, KHÔNG phải dự báo.</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <RangeRow label={`ρ — đồng biến động: ${rho.toFixed(2)}`} value={rho} min={0} max={1} step={0.05} onChange={setRho} />
              <RangeRow label={`α — GTD: ×${alpha.toFixed(1)}`} value={alpha} min={0} max={2} step={0.1} onChange={setAlpha} />
              <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Chi phí festival (tổng, tùy chọn)</span><Input type="number" className="h-7" placeholder="(trống → chỉ gross)" value={cost ?? ""} onChange={(e) => setCost(numOrNull(e.target.value))} /></label>
              <label className="flex flex-col gap-0.5"><span className="text-[10px] text-muted-foreground">Bankroll (cho Risk-of-Ruin)</span><Input type="number" className="h-7" placeholder="(trống)" value={bankroll ?? ""} onChange={(e) => setBankroll(numOrNull(e.target.value))} /></label>
            </div>
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
                <p className="text-[10px] text-warning/90 flex items-start gap-1 border border-warning/40 bg-warning/5 rounded-md p-1.5">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Lịch generated + giả thuyết → dải rất rộng. Đừng quyết định tài chính chỉ dựa trên số này.
                </p>
              </div>
            )}
          </Card>
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

function EvCell({ label, v, danger }: { label: string; v: string; danger?: boolean }) {
  return (
    <div className={cn("rounded-md border p-1.5", danger ? "border-warning/40 bg-warning/5" : "border-border/60")}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn("font-medium tabular-nums", danger && v !== "—" ? "text-warning" : "")}>{v}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
