import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  HORIZONS,
  CONFIDENCE_TIERS,
  HORIZON_LABEL,
  CONFIDENCE_LABEL,
  type ForecastSnapshotInsert,
} from "@/lib/series-intelligence/captureTypes";
import { Field, EnumSelect, toNum } from "../formBits";

type InsertFn = (p: Omit<ForecastSnapshotInsert, "club_id">) => Promise<boolean>;
const EMPTY = { horizon: "T-7", daysBefore: "", low: "", base: "", high: "", tier: "", gtd: "", overlay: "", notes: "" };

/** Controlled dialog: capture a pre-event forecast (insert-only). Opened from the wizard hub. */
export function ForecastDialog({
  open,
  onOpenChange,
  eventId,
  saving,
  insertForecast,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  saving: boolean;
  insertForecast: InsertFn;
}) {
  const [f, setF] = useState({ ...EMPTY });
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    if (open) setF({ ...EMPTY });
  }, [open]);

  const submit = async () => {
    const low = toNum(f.low);
    const base = toNum(f.base);
    const high = toNum(f.high);
    if (low != null && base != null && low > base) return toast.error("Ít nhất phải ≤ dự đoán chính");
    if (base != null && high != null && base > high) return toast.error("Dự đoán chính phải ≤ nhiều nhất");
    const overlay = toNum(f.overlay);
    if (overlay != null && (overlay < 0 || overlay > 100)) return toast.error("Rủi ro bù trong khoảng 0–100%");
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
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ghi dự đoán trước giải</DialogTitle>
          <DialogDescription>Bạn nghĩ sẽ có bao nhiêu người tham gia? Ghi lại để sau giải đối chiếu.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ghi ở thời điểm">
            <EnumSelect value={f.horizon} onChange={(v) => set("horizon", v)} options={HORIZONS} labels={HORIZON_LABEL} />
          </Field>
          <Field label="Còn mấy ngày tới giải">
            <Input type="number" className="h-9" value={f.daysBefore} onChange={(e) => set("daysBefore", e.target.value)} />
          </Field>
          <Field label="Ít nhất (người)"><Input type="number" className="h-9" value={f.low} onChange={(e) => set("low", e.target.value)} /></Field>
          <Field label="Dự đoán chính"><Input type="number" className="h-9" value={f.base} onChange={(e) => set("base", e.target.value)} /></Field>
          <Field label="Nhiều nhất"><Input type="number" className="h-9" value={f.high} onChange={(e) => set("high", e.target.value)} /></Field>
          <Field label="Mức tự tin">
            <EnumSelect value={f.tier} onChange={(v) => set("tier", v)} options={CONFIDENCE_TIERS} labels={CONFIDENCE_LABEL} placeholder="—" />
          </Field>
          <Field label="GTD cân nhắc (₫)"><Input type="number" className="h-9" value={f.gtd} onChange={(e) => set("gtd", e.target.value)} /></Field>
          <Field label="Rủi ro bù GTD (%)"><Input type="number" className="h-9" value={f.overlay} onChange={(e) => set("overlay", e.target.value)} /></Field>
        </div>
        <Field label="Ghi chú"><Input className="h-9" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button onClick={submit} disabled={saving}>Lưu dự đoán</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
