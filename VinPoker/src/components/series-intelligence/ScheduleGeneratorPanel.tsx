import { useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarRange, Play, AlertTriangle, Sliders, Calculator, FlaskConical, Plus, Trash2, FileImage, FileSpreadsheet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import { generateSchedule, type ScheduleInput, type ScheduleEvent, type CustomScheduleEvent } from "@/lib/series-intelligence/scheduleGenerator";
import { DEFAULT_RULES, mergeRules, type EventClass, type RulesOverride } from "@/lib/series-intelligence/tdRules";
import { simulateFestival, type SimResult } from "@/lib/series-intelligence/monteCarloEngine";
import { scheduleToSimEvents } from "@/lib/series-intelligence/scheduleToMonteCarlo";
import { SchedulePosterDocument } from "@/components/series-intelligence/SchedulePosterDocument";
import { exportScheduleExcel, slugify, type SchedulePosterHeader } from "@/lib/series-intelligence/scheduleExport";
import { captureNodeToPng } from "@/lib/series-intelligence/exportSchedulePng";

const EVENT_CLASSES = Object.keys(DEFAULT_RULES.eventClassDefaults) as EventClass[];
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const numOrUndef = (s: string): number | undefined => {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Festival schedule generator — DRAFT skeleton from a form + source-labeled, EDITABLE TD-rule defaults.
 * A planning aid for TD review, NOT a committed schedule, NOT financial, NOT DB. Pure client-side; reuses
 * the forwardLayerMonteCarlo flag. Each event carries enough to feed Monte Carlo later (B.2, not here).
 */
export function ScheduleGeneratorPanel() {
  const [form, setForm] = useState<Omit<ScheduleInput, "buyInTiers" | "customEvents">>({
    festivalDays: 10,
    eventsPerDay: 7,
    mainBuyIn: 20_000_000,
    mainGtdEntries: null,
    venueCapacity: 1000,
    seasonalityOn: false,
    dayFirstStart: "10:00",
    slotIntervalMinutes: 90,
  });
  const [tiersText, setTiersText] = useState("2000000, 5000000, 20000000, 100000000");
  const [override, setOverride] = useState<RulesOverride>({});
  const [customs, setCustoms] = useState<CustomScheduleEvent[]>([]);
  const [draft, setDraft] = useState<ScheduleEvent[] | null>(null);
  // B.2 — EV scenario from the generated schedule (Hypothesis: generated events are unobserved).
  const [rho, setRho] = useState(0.3);
  const [alpha, setAlpha] = useState(1.0);
  const [cost, setCost] = useState<number | null>(null);
  const [bankroll, setBankroll] = useState<number | null>(null);
  const [ev, setEv] = useState<{ result: SimResult; usedCount: number; skippedCount: number } | null>(null);
  // PR2b — export (PNG poster + Excel). Owner types all header fields; DRAFT footer unless explicitly published.
  const [poster, setPoster] = useState<SchedulePosterHeader>({});
  const [published, setPublished] = useState(false);
  const [pngBusy, setPngBusy] = useState(false);
  const posterRef = useRef<HTMLDivElement>(null);

  const effective = useMemo(() => mergeRules(DEFAULT_RULES, override).eventClassDefaults, [override]);
  const buyInTiers = useMemo(() => tiersText.split(/[,\n]/).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0), [tiersText]);

  const setNum = (k: "festivalDays" | "eventsPerDay" | "mainBuyIn" | "mainGtdEntries" | "venueCapacity" | "slotIntervalMinutes", v: string): void =>
    setForm((f) => ({ ...f, [k]: numOrNull(v) }));
  const setClassField = (cls: EventClass, field: "gtdEntriesFloor" | "feeRatio" | "startingStack" | "minutesPerLevel" | "lateRegLevel", v: number): void =>
    setOverride((prev) => ({
      ...prev,
      eventClassDefaults: { ...prev.eventClassDefaults, [cls]: { ...prev.eventClassDefaults?.[cls], [field]: v } },
    }));

  // custom tournaments (owner-added on top of the generated skeleton)
  const addCustom = (): void => setCustoms((cs) => [...cs, { day: 1, name: "", buy_in_prize: 1_000_000, fee_rake: 0, gtdEntries: 0 }]);
  const updCustom = (i: number, patch: Partial<CustomScheduleEvent>): void => setCustoms((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const removeCustom = (i: number): void => setCustoms((cs) => cs.filter((_, j) => j !== i));

  // PR2b — export handlers
  const setPosterField = (k: keyof SchedulePosterHeader, v: string): void => setPoster((p) => ({ ...p, [k]: v }));
  const downloadPng = async (): Promise<void> => {
    if (!draft || !posterRef.current) return;
    setPngBusy(true);
    try {
      await captureNodeToPng(posterRef.current, `${slugify(poster.title?.trim() || "lich-festival")}-poster`);
    } finally {
      setPngBusy(false);
    }
  };
  const downloadExcel = (): void => {
    if (!draft) return;
    exportScheduleExcel(draft, poster);
  };

  const generate = (): void => {
    setDraft(
      generateSchedule(
        { ...form, mainBuyIn: form.mainBuyIn || 0, venueCapacity: form.venueCapacity || 1, festivalDays: form.festivalDays || 1, eventsPerDay: form.eventsPerDay || 7, buyInTiers, customEvents: customs },
        override,
      ),
    );
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
        <Field label="Giờ bắt đầu mỗi ngày (HH:MM)"><Input className="h-7" placeholder="10:00" value={form.dayFirstStart ?? ""} onChange={(e) => setForm((f) => ({ ...f, dayFirstStart: e.target.value }))} /></Field>
        <Field label="Cách nhau giữa event (phút)"><Input type="number" className="h-7" placeholder="90" value={form.slotIntervalMinutes ?? ""} onChange={(e) => setNum("slotIntervalMinutes", e.target.value)} /></Field>
        <div className="col-span-2 sm:col-span-3 flex items-center gap-2 pt-1">
          <Switch checked={form.seasonalityOn} onCheckedChange={(v) => setForm((f) => ({ ...f, seasonalityOn: v }))} />
          <Label className="text-[11px] text-muted-foreground">Mùa vụ ×{DEFAULT_RULES.seasonality.multiplier} — <span className="text-warning">Giả thuyết, chưa kiểm chứng</span></Label>
        </div>
      </Card>

      <p className="text-[10px] text-muted-foreground/80">"Trần entries cam kết / event" = trần rủi ro GTD của bạn cho MỘT event (KHÔNG phải số ghế — Main có thể 2350 entry qua re-entry trong sảnh 500 ghế).</p>
      <p className="text-[10px] text-muted-foreground/80">Giờ thi đấu (giờ bắt đầu + cách nhau + reg-end) là ƯỚC LƯỢNG DRAFT, dải đều — đồng hồ reset mỗi ngày. TD tinh chỉnh giờ thật; mỗi tour tự thêm có thể đặt giờ riêng.</p>

      {/* editable TD-rule defaults */}
      <Card className="p-3 border-primary/30 space-y-1.5 text-[11px]">
        <div className="flex items-center gap-1.5 font-medium"><Sliders className="h-3.5 w-3.5 text-primary" /> Quy tắc TD (mặc định — sửa được)</div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="text-[10px] text-muted-foreground">
              <tr><th className="text-left font-normal py-0.5">Class</th><th className="text-right font-normal">GTD-entries floor</th><th className="text-right font-normal">Fee/buy-in</th><th className="text-right font-normal">Stack</th><th className="text-right font-normal">Phút/lv</th><th className="text-right font-normal">Late-reg</th><th className="text-left font-normal pl-2">Nguồn</th></tr>
            </thead>
            <tbody>
              {EVENT_CLASSES.map((cls) => (
                <tr key={cls} className="border-t border-border/40">
                  <td className="py-0.5">{cls}{effective[cls].marquee ? <span className="ml-1 text-[9px] text-primary">marquee</span> : null}</td>
                  <td className="text-right"><Input type="number" className="h-6 w-20 text-right inline-block" value={effective[cls].gtdEntriesFloor} onChange={(e) => setClassField(cls, "gtdEntriesFloor", Number(e.target.value))} /></td>
                  <td className="text-right"><Input type="number" step="0.01" className="h-6 w-16 text-right inline-block" value={effective[cls].feeRatio} onChange={(e) => setClassField(cls, "feeRatio", Number(e.target.value))} /></td>
                  <td className="text-right"><Input type="number" className="h-6 w-20 text-right inline-block" value={effective[cls].startingStack} onChange={(e) => setClassField(cls, "startingStack", Number(e.target.value))} /></td>
                  <td className="text-right"><Input type="number" className="h-6 w-14 text-right inline-block" value={effective[cls].minutesPerLevel} onChange={(e) => setClassField(cls, "minutesPerLevel", Number(e.target.value))} /></td>
                  <td className="text-right"><Input type="number" className="h-6 w-14 text-right inline-block" value={effective[cls].lateRegLevel} onChange={(e) => setClassField(cls, "lateRegLevel", Number(e.target.value))} /></td>
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

      {/* custom tournaments — owner-added on top of the generated skeleton */}
      <Card className="p-3 border-primary/30 space-y-2 text-[11px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-medium"><Plus className="h-3.5 w-3.5 text-primary" /> Tạo thêm tour (tự thêm)</div>
          <Button size="sm" variant="outline" className="h-6 gap-1 text-[10px]" onClick={addCustom}><Plus className="h-3 w-3" /> Thêm tour</Button>
        </div>
        {customs.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">Chưa có tour tự thêm. Bấm "Thêm tour" để chèn giải riêng (giá, GTD, giờ, cấu trúc) vào ngày bất kỳ — sẽ xếp SAU các event sinh tự động trong ngày đó.</p>
        ) : (
          customs.map((c, i) => (
            <div key={i} className="rounded-md border border-border/60 p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <Input className="h-6 flex-1" placeholder="Tên tour" value={c.name} onChange={(e) => updCustom(i, { name: e.target.value })} />
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeCustom(i)} aria-label="Xoá tour"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                <Field label="Ngày"><Input type="number" className="h-6" value={c.day} onChange={(e) => updCustom(i, { day: Number(e.target.value) })} /></Field>
                <Field label="Giờ (HH:MM, auto nếu trống)"><Input className="h-6" placeholder="auto" value={c.startTime ?? ""} onChange={(e) => updCustom(i, { startTime: e.target.value })} /></Field>
                <Field label="Buy-in (prize)"><Input type="number" className="h-6" value={c.buy_in_prize} onChange={(e) => updCustom(i, { buy_in_prize: Number(e.target.value) })} /></Field>
                <Field label="Fee (rake)"><Input type="number" className="h-6" value={c.fee_rake} onChange={(e) => updCustom(i, { fee_rake: Number(e.target.value) })} /></Field>
                <Field label="GTD-entries"><Input type="number" className="h-6" value={c.gtdEntries} onChange={(e) => updCustom(i, { gtdEntries: Number(e.target.value) })} /></Field>
                <Field label="Stack (auto 30K)"><Input type="number" className="h-6" placeholder="30000" value={c.startingStack ?? ""} onChange={(e) => updCustom(i, { startingStack: numOrUndef(e.target.value) })} /></Field>
                <Field label="Phút/level (auto 30)"><Input type="number" className="h-6" placeholder="30" value={c.minutesPerLevel ?? ""} onChange={(e) => updCustom(i, { minutesPerLevel: numOrUndef(e.target.value) })} /></Field>
                <Field label="Late-reg level (auto 10)"><Input type="number" className="h-6" placeholder="10" value={c.lateRegLevel ?? ""} onChange={(e) => updCustom(i, { lateRegLevel: numOrUndef(e.target.value) })} /></Field>
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                Giá hiển thị {formatVndShort((c.buy_in_prize || 0) + (c.fee_rake || 0))} · GTD{" "}
                {(c.gtdEntries || 0) > 0 && (c.buy_in_prize || 0) > 0 ? formatVndShort((c.gtdEntries || 0) * (c.buy_in_prize || 0)) : "—"}
              </div>
            </div>
          ))
        )}
        <p className="text-[10px] text-muted-foreground/80">Tour tự thêm gắn nhãn "custom" · GTD = GTD-entries × buy-in · GTD 0 ⇒ không vào kịch bản EV (giống Satellite).</p>
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
                    <span className="tabular-nums text-primary font-medium w-[40px]">{e.startTime}</span>
                    <span className="font-medium min-w-[130px]">
                      {e.name}
                      {e.isCustom ? <span className="ml-1 rounded border border-primary/50 bg-primary/10 px-1 py-0.5 text-[9px] text-primary">Tự thêm</span> : null}
                    </span>
                    <span className="tabular-nums text-muted-foreground">buy-in {formatVndShort(e.buy_in_prize)}</span>
                    <span className="tabular-nums text-muted-foreground">fee {formatVndShort(e.fee_rake)}</span>
                    <span className="tabular-nums">GTD {e.GTD === 0 ? "—" : formatVndShort(e.GTD)}</span>
                    <span className="tabular-nums text-muted-foreground">{Math.round(e.startingStack / 1000)}K · {e.minutesPerLevel}'/lv</span>
                    <span className="tabular-nums text-muted-foreground">
                      reg→{e.regEndTime}
                      {e.regEndNextDay ? <span className="text-warning"> (hôm sau)</span> : null} <span className="text-muted-foreground/70">(Lv{e.regEndLevel})</span>
                    </span>
                    <span className="flex gap-0.5">
                      {e.sourceLabels.map((l) => (
                        <span key={l} className={cn("rounded border px-1 py-0.5 text-[9px]", l === "Hypothesis" ? "border-warning/40 text-warning" : l === "custom" ? "border-primary/40 text-primary" : "border-border text-muted-foreground")}>{l}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}

          {/* PR2b — export: PNG poster + Excel (owner types all header fields) */}
          <Card className="p-3 border-primary/40 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <FileImage className="h-3.5 w-3.5 text-primary" /> Xuất lịch (poster PNG + Excel)
            </div>
            <p className="text-[10px] text-muted-foreground">Bạn tự nhập tiêu đề/địa điểm/ngày. Poster mặc định dán nhãn <span className="text-warning">DRAFT</span>; bật "đã TD review" để xuất bản chính thức.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Field label="Tên giải"><Input className="h-7" placeholder="VD: VinPoker Summer Series" value={poster.title ?? ""} onChange={(e) => setPosterField("title", e.target.value)} /></Field>
              <Field label="Phụ đề (tùy chọn)"><Input className="h-7" value={poster.subtitle ?? ""} onChange={(e) => setPosterField("subtitle", e.target.value)} /></Field>
              <Field label="Địa điểm (tùy chọn)"><Input className="h-7" value={poster.venue ?? ""} onChange={(e) => setPosterField("venue", e.target.value)} /></Field>
              <Field label="Ngày bắt đầu (tùy chọn)"><Input type="date" className="h-7" value={poster.startDate ?? ""} onChange={(e) => setPosterField("startDate", e.target.value)} /></Field>
              <Field label="Ghi chú chân trang (tùy chọn)"><Input className="h-7" value={poster.footer ?? ""} onChange={(e) => setPosterField("footer", e.target.value)} /></Field>
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <Switch checked={published} onCheckedChange={setPublished} />
              <Label className="text-[11px]">Đã TD review · xuất bản chính thức <span className="text-muted-foreground">(gỡ nhãn DRAFT)</span></Label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-1.5" onClick={downloadPng} disabled={pngBusy}>
                <FileImage className="h-4 w-4" /> {pngBusy ? "Đang tạo PNG…" : "Tải PNG (poster)"}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadExcel}>
                <FileSpreadsheet className="h-4 w-4" /> Tải Excel
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/80">Xem trước poster thật (rộng 960px — cuộn ngang/dọc). PNG chụp đúng khung này.</p>
            <div className="overflow-auto rounded-md border border-border/60" style={{ maxHeight: 480 }}>
              <SchedulePosterDocument ref={posterRef} events={draft ?? []} header={poster} published={published} />
            </div>
          </Card>

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
