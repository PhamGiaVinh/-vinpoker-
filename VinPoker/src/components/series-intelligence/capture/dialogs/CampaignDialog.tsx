import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { CampaignLog, CampaignLogInsert, CampaignLogUpdate } from "@/lib/series-intelligence/captureTypes";
import { Field, toNum } from "../formBits";

type InsertFn = (p: Omit<CampaignLogInsert, "club_id">) => Promise<boolean>;
type UpdateFn = (id: string, patch: CampaignLogUpdate) => Promise<boolean>;
const EMPTY = { campaign_id: "", channel: "", spend: "", creative_type: "", target_segment: "", baseline: "", reason: "" };

/** Controlled dialog: record / edit a marketing campaign for the event. */
export function CampaignDialog({
  open,
  onOpenChange,
  eventId,
  saving,
  insertCampaign,
  updateCampaign,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  saving: boolean;
  insertCampaign: InsertFn;
  updateCampaign: UpdateFn;
  editing?: CampaignLog | null;
}) {
  const [f, setF] = useState({ ...EMPTY });
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    if (!open) return;
    setF(
      editing
        ? {
            campaign_id: editing.campaign_id ?? "",
            channel: editing.channel ?? "",
            spend: editing.spend == null ? "" : String(editing.spend),
            creative_type: editing.creative_type ?? "",
            target_segment: editing.target_segment ?? "",
            baseline: editing.baseline_expected_entries == null ? "" : String(editing.baseline_expected_entries),
            reason: editing.decision_reason ?? "",
          }
        : { ...EMPTY },
    );
  }, [open, editing]);

  const submit = async () => {
    const spend = toNum(f.spend);
    if (spend != null && spend < 0) return toast.error("Chi phí không âm");
    const payload = {
      campaign_id: f.campaign_id.trim() || null,
      channel: f.channel.trim() || null,
      spend,
      creative_type: f.creative_type.trim() || null,
      target_segment: f.target_segment.trim() || null,
      baseline_expected_entries: toNum(f.baseline),
      decision_reason: f.reason.trim() || null,
    };
    const ok = editing ? await updateCampaign(editing.id, payload) : await insertCampaign({ event_linked: eventId, ...payload });
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Sửa marketing" : "Ghi marketing"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kênh"><Input className="h-9" placeholder="facebook, sms, tại sàn…" value={f.channel} onChange={(e) => set("channel", e.target.value)} /></Field>
          <Field label="Mã chiến dịch"><Input className="h-9" value={f.campaign_id} onChange={(e) => set("campaign_id", e.target.value)} /></Field>
          <Field label="Chi phí (₫)"><Input type="number" className="h-9" value={f.spend} onChange={(e) => set("spend", e.target.value)} /></Field>
          <Field label="Loại nội dung"><Input className="h-9" placeholder="video, ảnh…" value={f.creative_type} onChange={(e) => set("creative_type", e.target.value)} /></Field>
          <Field label="Nhắm tới ai"><Input className="h-9" value={f.target_segment} onChange={(e) => set("target_segment", e.target.value)} /></Field>
          <Field label="Kỳ vọng khi không QC"><Input type="number" className="h-9" value={f.baseline} onChange={(e) => set("baseline", e.target.value)} /></Field>
        </div>
        <Field label="Vì sao"><Input className="h-9" value={f.reason} onChange={(e) => set("reason", e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button onClick={submit} disabled={saving}>{editing ? "Cập nhật" : "Lưu"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
