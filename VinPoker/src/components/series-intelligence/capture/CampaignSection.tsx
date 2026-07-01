import { useState } from "react";
import { Plus, Megaphone, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatVND, formatShortDate } from "@/lib/format";
import type { CampaignLog, CampaignLogInsert, CampaignLogUpdate } from "@/lib/series-intelligence/captureTypes";
import { Field, toNum } from "./formBits";

type InsertFn = (p: Omit<CampaignLogInsert, "club_id">) => Promise<boolean>;
type UpdateFn = (id: string, patch: CampaignLogUpdate) => Promise<boolean>;

const EMPTY = { campaign_id: "", channel: "", spend: "", creative_type: "", target_segment: "", baseline: "", reason: "" };

export function CampaignSection({
  eventId,
  campaigns,
  saving,
  insertCampaign,
  updateCampaign,
}: {
  eventId: string;
  campaigns: CampaignLog[];
  saving: boolean;
  insertCampaign: InsertFn;
  updateCampaign: UpdateFn;
}) {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState({ ...EMPTY });
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));

  const openCreate = () => {
    setEditId(null);
    setF({ ...EMPTY });
    setOpen(true);
  };
  const openEdit = (c: CampaignLog) => {
    setEditId(c.id);
    setF({
      campaign_id: c.campaign_id ?? "",
      channel: c.channel ?? "",
      spend: c.spend == null ? "" : String(c.spend),
      creative_type: c.creative_type ?? "",
      target_segment: c.target_segment ?? "",
      baseline: c.baseline_expected_entries == null ? "" : String(c.baseline_expected_entries),
      reason: c.decision_reason ?? "",
    });
    setOpen(true);
  };

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
    const ok = editId
      ? await updateCampaign(editId, payload)
      : await insertCampaign({ event_linked: eventId, ...payload });
    if (ok) setOpen(false);
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Megaphone className="h-4 w-4 text-primary" /> Marketing
        </h3>
        <Button size="sm" variant="outline" className="gap-1" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> Thêm chiến dịch
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Chưa có chiến dịch cho giải này.</p>
      ) : (
        <ul className="space-y-1.5">
          {campaigns.map((c) => (
            <li key={c.id} className="rounded-md border border-border/60 bg-card/40 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {c.channel && <span className="font-medium">{c.channel}</span>}
                {c.campaign_id && <span className="font-mono text-muted-foreground">{c.campaign_id}</span>}
                {c.spend != null && <span className="text-primary font-semibold">{formatVND(c.spend)}</span>}
                {c.target_segment && <span className="text-muted-foreground">· {c.target_segment}</span>}
                <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                  {formatShortDate(c.created_at)}
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(c)} aria-label="Sửa">
                    <Pencil className="h-3 w-3" />
                  </Button>
                </span>
              </div>
              {c.decision_reason && <div className="mt-0.5 text-[11px] text-muted-foreground">{c.decision_reason}</div>}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Sửa chiến dịch" : "Thêm chiến dịch"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kênh"><Input className="h-9" placeholder="facebook, sms, tại sàn…" value={f.channel} onChange={(e) => set("channel", e.target.value)} /></Field>
            <Field label="Mã chiến dịch"><Input className="h-9" value={f.campaign_id} onChange={(e) => set("campaign_id", e.target.value)} /></Field>
            <Field label="Chi phí (₫)"><Input type="number" className="h-9" value={f.spend} onChange={(e) => set("spend", e.target.value)} /></Field>
            <Field label="Loại creative"><Input className="h-9" placeholder="video, ảnh…" value={f.creative_type} onChange={(e) => set("creative_type", e.target.value)} /></Field>
            <Field label="Phân khúc"><Input className="h-9" value={f.target_segment} onChange={(e) => set("target_segment", e.target.value)} /></Field>
            <Field label="Entries kỳ vọng (nền)"><Input type="number" className="h-9" value={f.baseline} onChange={(e) => set("baseline", e.target.value)} /></Field>
          </div>
          <Field label="Lý do"><Input className="h-9" value={f.reason} onChange={(e) => set("reason", e.target.value)} /></Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Huỷ</Button>
            <Button onClick={submit} disabled={saving}>{editId ? "Cập nhật" : "Lưu chiến dịch"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
