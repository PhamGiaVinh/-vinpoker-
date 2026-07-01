import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { hashPlayerRef } from "@/lib/series-intelligence/hashPlayerRef";
import {
  PLAYER_REF_TYPES,
  COMMITMENT_STAGES,
  ENTRY_SOURCES,
  COMMITMENT_LABEL,
  ENTRY_SOURCE_LABEL,
  PLAYER_REF_TYPE_LABEL,
  type RegistrationEventInsert,
} from "@/lib/series-intelligence/captureTypes";
import { Field, EnumSelect, toNum } from "../formBits";

type InsertFn = (p: Omit<RegistrationEventInsert, "club_id">) => Promise<boolean>;
const EMPTY = { ref: "", refType: "phone", stage: "paid", source: "direct", bullet: "1", reentry: false };

/** Controlled dialog: record one registration. The identifier is HASHED client-side before insert. */
export function RegistrationDialog({
  open,
  onOpenChange,
  eventId,
  saving,
  insertRegistration,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  saving: boolean;
  insertRegistration: InsertFn;
}) {
  const [f, setF] = useState({ ...EMPTY });
  const set = (k: keyof typeof EMPTY, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    if (open) setF({ ...EMPTY });
  }, [open]);

  const submit = async () => {
    const raw = f.ref.trim();
    if (!raw) return toast.error("Cần định danh (sẽ được hash, không lưu thô)");
    const player_ref_hash = await hashPlayerRef(raw); // hashed client-side; raw never enters the payload
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
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ghi một đăng ký</DialogTitle>
        </DialogHeader>
        <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px] text-muted-foreground">
          Định danh được <strong>hash ngay trên máy</strong> trước khi lưu — hệ thống KHÔNG lưu SĐT/tên thô, chỉ lưu hash + loại.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Định danh (để hash)" hint="SĐT / app id / nhãn host">
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button onClick={submit} disabled={saving}>Ghi (đã hash)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
