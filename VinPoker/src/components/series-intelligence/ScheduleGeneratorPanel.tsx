import { useMemo, useState, type ReactNode } from "react";
import { CalendarRange, Play, AlertTriangle, Sliders, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import { generateSchedule, type ScheduleInput, type ScheduleEvent, type CustomScheduleEvent } from "@/lib/series-intelligence/scheduleGenerator";
import { DEFAULT_RULES, mergeRules, type EventClass, type RulesOverride } from "@/lib/series-intelligence/tdRules";

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
 * A planning aid for TD review, NOT a committed schedule, NOT financial, NOT DB. Pure client-side. The
 * generated `draft` is LIFTED to the parent (SeriesIntelligence) via `onDraftChange` so the EV (Step ④) and
 * Export (Step ⑤) panels — split out of this file — consume the same schedule. This file only builds the schedule.
 */
export function ScheduleGeneratorPanel({ draft, onDraftChange }: { draft: ScheduleEvent[] | null; onDraftChange: (d: ScheduleEvent[] | null) => void }) {
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

  const generate = (): void => {
    onDraftChange(
      generateSchedule(
        { ...form, mainBuyIn: form.mainBuyIn || 0, venueCapacity: form.venueCapacity || 1, festivalDays: form.festivalDays || 1, eventsPerDay: form.eventsPerDay || 7, buyInTiers, customEvents: customs },
        override,
      ),
    );
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
        </div>
      )}
    </section>
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
