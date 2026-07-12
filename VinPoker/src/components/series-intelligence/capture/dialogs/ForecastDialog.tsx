import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FEATURES } from "@/lib/featureFlags";
import {
  HORIZONS,
  CONFIDENCE_TIERS,
  HORIZON_LABEL,
  CONFIDENCE_LABEL,
  type ForecastSnapshotInsert,
} from "@/lib/series-intelligence/captureTypes";
import { forecastSuggest } from "@/lib/series-intelligence/forecastSuggest";
import { buildForecastProvenance } from "@/lib/series-intelligence/forecastProvenance";
import { toForecastProvenanceSnapshotColumns } from "@/lib/series-intelligence/forecastProvenanceRow";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
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
  history = [],
  targetBuyIn = null,
  targetEvent = null,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  saving: boolean;
  insertForecast: InsertFn;
  /** The club's own past events (for the history-based suggestion). */
  history?: SeriesEvent[];
  /** This event's buy-in (drives the comparable band). */
  targetBuyIn?: number | null;
  /** Native event metadata used only when the provenance flag is enabled. */
  targetEvent?: SeriesEvent | null;
}) {
  const [f, setF] = useState({ ...EMPTY });
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    if (open) {
      setF({ ...EMPTY });
      setSuggestNote(null);
    }
  }, [open]);

  // Prefill low/base/high from comparable past turnouts (editable; never auto-saved). Observed Pattern, not a model.
  const applySuggestion = () => {
    const s = forecastSuggest(eventId, targetBuyIn, history);
    setSuggestNote(s.reason);
    if (s.status === "ok") {
      setF((p) => ({ ...p, low: String(s.low ?? ""), base: String(s.base ?? ""), high: String(s.high ?? "") }));
    }
  };

  const submit = async () => {
    const low = toNum(f.low);
    const base = toNum(f.base);
    const high = toNum(f.high);
    if (low != null && base != null && low > base) return toast.error("Ít nhất phải ≤ dự đoán chính");
    if (base != null && high != null && base > high) return toast.error("Dự đoán chính phải ≤ nhiều nhất");
    const overlay = toNum(f.overlay);
    if (overlay != null && (overlay < 0 || overlay > 100)) return toast.error("Rủi ro bù trong khoảng 0–100%");
    let provenanceColumns: Partial<ForecastSnapshotInsert> = {};
    if (FEATURES.seriesForecastProvenance) {
      if (!targetEvent?.event_date || targetEvent.buy_in == null) {
        return toast.error("Chưa đủ dữ liệu giải để ghi dấu vết dự báo.");
      }
      const issuedAt = new Date().toISOString();
      try {
        const provenance = await buildForecastProvenance(
          [],
          {
            event_date: targetEvent.event_date,
            buy_in: targetEvent.buy_in,
            gtd: targetEvent.gtd,
            event_name: targetEvent.event_name,
            capacity: targetEvent.capacity,
          },
          {},
          { forecastIssuedAt: issuedAt, asOfTs: issuedAt, targetEventTs: targetEvent.event_date },
          { kind: "manual" },
        );
        provenanceColumns = toForecastProvenanceSnapshotColumns(provenance);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Không tạo được dấu vết dự báo.";
        return toast.error(`Không lưu dấu vết dự báo: ${message}`);
      }
    }

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
      ...provenanceColumns,
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
        <div className="rounded-md border border-primary/25 bg-primary/5 p-2">
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={applySuggestion}>
            <Lightbulb className="h-3.5 w-3.5 text-primary" /> Gợi ý từ lịch sử
          </Button>
          <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
            {suggestNote ?? "Điền sẵn ít/chính/nhiều từ các giải cùng tầm buy-in đã có kết quả. Bạn cứ chỉnh lại tuỳ ý."}
          </p>
        </div>
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
