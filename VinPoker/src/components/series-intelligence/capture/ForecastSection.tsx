import { useState } from "react";
import { Plus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatVND, formatShortDate } from "@/lib/format";
import {
  HORIZONS,
  CONFIDENCE_TIERS,
  HORIZON_LABEL,
  CONFIDENCE_LABEL,
  type ForecastSnapshot,
  type ForecastSnapshotInsert,
} from "@/lib/series-intelligence/captureTypes";
import { Field, EnumSelect, toNum } from "./formBits";

type InsertFn = (p: Omit<ForecastSnapshotInsert, "club_id">) => Promise<boolean>;

const EMPTY = { horizon: "T-7", daysBefore: "", low: "", base: "", high: "", tier: "", gtd: "", overlay: "", notes: "" };

export function ForecastSection({
  eventId,
  snapshots,
  saving,
  insertForecast,
}: {
  eventId: string;
  snapshots: ForecastSnapshot[];
  saving: boolean;
  insertForecast: InsertFn;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...EMPTY });
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    const low = toNum(f.low);
    const base = toNum(f.base);
    const high = toNum(f.high);
    if (low != null && base != null && low > base) return toast.error("Cận dưới phải ≤ dự báo giữa");
    if (base != null && high != null && base > high) return toast.error("Dự báo giữa phải ≤ cận trên");
    const overlay = toNum(f.overlay);
    if (overlay != null && (overlay < 0 || overlay > 100)) return toast.error("Overlay % trong khoảng 0–100");
    const ok = await insertForecast({
      event_id: eventId,
      horizon: f.horizon,
      days_before: toNum(f.daysBefore),
      forecast_low: low,
      forecast_base: base,
      forecast_high: high,
      confidence_tier: f.tier || null,
      candidate_gtd: toNum(f.gtd),
      overlay_risk_pct: overlay,
      source_label: "manual",
      notes: f.notes.trim() || null,
    });
    if (ok) {
      setF({ ...EMPTY });
      setOpen(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <TrendingUp className="h-4 w-4 text-primary" /> Dự báo (trước giải)
        </h3>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Thêm dự báo
        </Button>
      </div>

      {snapshots.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Chưa có dự báo cho giải này. Dự báo là bản ghi bất biến (không sửa/xoá).</p>
      ) : (
        <ul className="space-y-1.5">
          {snapshots.map((s) => (
            <li key={s.id} className="rounded-md border border-border/60 bg-card/40 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="outline" className="text-[10px]">{HORIZON_LABEL[s.horizon] ?? s.horizon}</Badge>
                <span className="font-mono">
                  {s.forecast_low ?? "—"}
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-primary font-semibold">{s.forecast_base ?? "—"}</span>
                  <span className="text-muted-foreground"> · </span>
                  {s.forecast_high ?? "—"}
                </span>
                {s.confidence_tier && <span className="text-muted-foreground">tin cậy {CONFIDENCE_LABEL[s.confidence_tier] ?? s.confidence_tier}</span>}
                {s.candidate_gtd != null && <span className="text-muted-foreground">GTD {formatVND(s.candidate_gtd)}</span>}
                {s.overlay_risk_pct != null && <span className="text-muted-foreground">overlay~{s.overlay_risk_pct}%</span>}
                <span className="ml-auto text-[10px] text-muted-foreground">{formatShortDate(s.created_at)}</span>
              </div>
              {s.notes && <div className="mt-0.5 text-[11px] text-muted-foreground">{s.notes}</div>}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm dự báo</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Mốc">
              <EnumSelect value={f.horizon} onChange={(v) => set("horizon", v)} options={HORIZONS} labels={HORIZON_LABEL} />
            </Field>
            <Field label="Số ngày trước">
              <Input type="number" className="h-9" value={f.daysBefore} onChange={(e) => set("daysBefore", e.target.value)} />
            </Field>
            <Field label="Cận dưới"><Input type="number" className="h-9" value={f.low} onChange={(e) => set("low", e.target.value)} /></Field>
            <Field label="Dự báo giữa"><Input type="number" className="h-9" value={f.base} onChange={(e) => set("base", e.target.value)} /></Field>
            <Field label="Cận trên"><Input type="number" className="h-9" value={f.high} onChange={(e) => set("high", e.target.value)} /></Field>
            <Field label="Độ tin cậy">
              <EnumSelect value={f.tier} onChange={(v) => set("tier", v)} options={CONFIDENCE_TIERS} labels={CONFIDENCE_LABEL} placeholder="—" />
            </Field>
            <Field label="GTD cân nhắc (₫)"><Input type="number" className="h-9" value={f.gtd} onChange={(e) => set("gtd", e.target.value)} /></Field>
            <Field label="Overlay rủi ro (%)"><Input type="number" className="h-9" value={f.overlay} onChange={(e) => set("overlay", e.target.value)} /></Field>
          </div>
          <Field label="Ghi chú"><Input className="h-9" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Huỷ</Button>
            <Button onClick={submit} disabled={saving}>Lưu dự báo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
