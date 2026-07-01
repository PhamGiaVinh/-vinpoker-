import { useState } from "react";
import { Plus, Users2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatShortDate } from "@/lib/format";
import { registrationFunnel } from "@/lib/series-intelligence/captureScoring";
import { hashPlayerRef, shortHash } from "@/lib/series-intelligence/hashPlayerRef";
import {
  PLAYER_REF_TYPES,
  COMMITMENT_STAGES,
  ENTRY_SOURCES,
  STAGE_ORDER,
  COMMITMENT_LABEL,
  ENTRY_SOURCE_LABEL,
  PLAYER_REF_TYPE_LABEL,
  type RegistrationEvent,
  type RegistrationEventInsert,
} from "@/lib/series-intelligence/captureTypes";
import { Field, EnumSelect, toNum } from "./formBits";

type InsertFn = (p: Omit<RegistrationEventInsert, "club_id">) => Promise<boolean>;

const EMPTY = { ref: "", refType: "phone", stage: "paid", source: "direct", bullet: "1", reentry: false };

export function RegistrationSection({
  eventId,
  registrations,
  saving,
  insertRegistration,
}: {
  eventId: string;
  registrations: RegistrationEvent[];
  saving: boolean;
  insertRegistration: InsertFn;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...EMPTY });
  const set = (k: keyof typeof EMPTY, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const funnel = registrationFunnel(registrations);

  const submit = async () => {
    const raw = f.ref.trim();
    if (!raw) return toast.error("Cần định danh (sẽ được hash, không lưu thô)");
    // Privacy: hash client-side; the RAW value never enters the payload.
    const player_ref_hash = await hashPlayerRef(raw);
    const ok = await insertRegistration({
      event_id: eventId,
      player_ref_hash,
      player_ref_type: f.refType,
      commitment_stage: f.stage,
      entry_source: f.source,
      bullet: toNum(f.bullet),
      is_reentry: f.reentry,
    });
    if (ok) {
      setF({ ...EMPTY }); // drop the raw identifier from state after submit
      setOpen(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Users2 className="h-4 w-4 text-primary" /> Đăng ký (funnel)
        </h3>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Ghi đăng ký
        </Button>
      </div>

      {/* funnel summary */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <Badge variant="secondary">{funnel.total} lượt</Badge>
        <Badge variant="secondary">{funnel.unique} người</Badge>
        <Badge variant="secondary">{funnel.reentries} re-entry</Badge>
        <span className="text-muted-foreground">·</span>
        {STAGE_ORDER.filter((s) => funnel.byStage[s]).map((s) => (
          <Badge key={s} variant="outline" className="text-[10px]">
            {COMMITMENT_LABEL[s]}: {funnel.byStage[s]}
          </Badge>
        ))}
      </div>

      {registrations.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Chưa có đăng ký. Ghi thủ công ở đây; capture tự động là track sau.</p>
      ) : (
        <ul className="space-y-1">
          {registrations.slice(0, 12).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border-t border-border/40 px-1 pt-1 text-[11px]">
              <ShieldCheck className="h-3 w-3 text-primary/70" aria-hidden />
              <span className="font-mono text-muted-foreground">{shortHash(r.player_ref_hash)}</span>
              {r.player_ref_type && <span className="text-[10px] text-muted-foreground">{PLAYER_REF_TYPE_LABEL[r.player_ref_type] ?? r.player_ref_type}</span>}
              {r.commitment_stage && <Badge variant="outline" className="text-[9px]">{COMMITMENT_LABEL[r.commitment_stage] ?? r.commitment_stage}</Badge>}
              {r.is_reentry && <span className="text-warning">re-entry (bullet {r.bullet ?? "?"})</span>}
              {r.entry_source && <span className="text-muted-foreground">· {ENTRY_SOURCE_LABEL[r.entry_source] ?? r.entry_source}</span>}
              <span className="ml-auto text-[10px] text-muted-foreground">{formatShortDate(r.registered_at)}</span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ghi đăng ký</DialogTitle>
          </DialogHeader>
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px] text-muted-foreground">
            Định danh được <strong>hash ngay trên máy</strong> trước khi lưu — hệ thống KHÔNG lưu SĐT/tên thô, chỉ lưu hash + loại.
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Định danh (hash)" hint="SĐT / app id / nhãn host — chỉ dùng để hash">
              <Input className="h-9" value={f.ref} onChange={(e) => set("ref", e.target.value)} />
            </Field>
            <Field label="Loại định danh">
              <EnumSelect value={f.refType} onChange={(v) => set("refType", v)} options={PLAYER_REF_TYPES} labels={PLAYER_REF_TYPE_LABEL} />
            </Field>
            <Field label="Giai đoạn">
              <EnumSelect value={f.stage} onChange={(v) => set("stage", v)} options={COMMITMENT_STAGES} labels={COMMITMENT_LABEL} />
            </Field>
            <Field label="Nguồn">
              <EnumSelect value={f.source} onChange={(v) => set("source", v)} options={ENTRY_SOURCES} labels={ENTRY_SOURCE_LABEL} />
            </Field>
            <Field label="Bullet"><Input type="number" className="h-9" value={f.bullet} onChange={(e) => set("bullet", e.target.value)} /></Field>
            <label className="flex items-center gap-2 pt-6 text-xs">
              <Checkbox checked={f.reentry} onCheckedChange={(v) => set("reentry", v === true)} /> Là re-entry
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Huỷ</Button>
            <Button onClick={submit} disabled={saving}>Ghi (đã hash)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
