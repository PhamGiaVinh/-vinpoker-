import { useMemo, useState, type ReactNode } from "react";
import { CalendarRange, Play, AlertTriangle, Sliders } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import { generateSchedule, type ScheduleInput, type ScheduleEvent } from "@/lib/series-intelligence/scheduleGenerator";
import { DEFAULT_RULES, mergeRules, type EventClass, type RulesOverride } from "@/lib/series-intelligence/tdRules";

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

  const effective = useMemo(() => mergeRules(DEFAULT_RULES, override).eventClassDefaults, [override]);
  const buyInTiers = useMemo(() => tiersText.split(/[,\n]/).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0), [tiersText]);

  const setNum = (k: keyof Omit<ScheduleInput, "buyInTiers" | "seasonalityOn">, v: string): void =>
    setForm((f) => ({ ...f, [k]: numOrNull(v) }));
  const setClassField = (cls: EventClass, field: "gtdEntriesFloor" | "feeRatio", v: number): void =>
    setOverride((prev) => ({
      ...prev,
      eventClassDefaults: { ...prev.eventClassDefaults, [cls]: { ...prev.eventClassDefaults?.[cls], [field]: v } },
    }));

  const generate = (): void =>
    setDraft(generateSchedule({ ...form, mainBuyIn: form.mainBuyIn || 0, venueCapacity: form.venueCapacity || 1, festivalDays: form.festivalDays || 1, eventsPerDay: form.eventsPerDay || 7, buyInTiers }, override));

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
