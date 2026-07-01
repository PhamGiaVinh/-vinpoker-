import { useState } from "react";
import { Plus, ClipboardList, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { formatVND, formatShortDate } from "@/lib/format";
import {
  DECISION_HORIZONS,
  HORIZON_LABEL,
  type DecisionLog,
  type DecisionLogInsert,
  type DecisionLogUpdate,
  type ForecastSnapshot,
} from "@/lib/series-intelligence/captureTypes";
import { Field, EnumSelect, toNum } from "./formBits";

type InsertFn = (p: Omit<DecisionLogInsert, "club_id">) => Promise<boolean>;
type UpdateFn = (id: string, patch: DecisionLogUpdate) => Promise<boolean>;

const NONE = "__none__";
const EMPTY = {
  horizon: "T-7", snapshotId: "", recommended: "", owner: "", publicAction: "", reason: "",
  actualResult: "", entries: "", unique: "", reentries: "", prizePool: "", overlay: "", postReason: "",
};

export function DecisionSection({
  eventId,
  decisions,
  snapshots,
  saving,
  insertDecision,
  updateDecision,
}: {
  eventId: string;
  decisions: DecisionLog[];
  snapshots: ForecastSnapshot[];
  saving: boolean;
  insertDecision: InsertFn;
  updateDecision: UpdateFn;
}) {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState({ ...EMPTY });
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));
  const showActuals = f.horizon === "post";

  const openCreate = () => {
    setEditId(null);
    setF({ ...EMPTY });
    setOpen(true);
  };
  const openEdit = (d: DecisionLog) => {
    setEditId(d.id);
    setF({
      horizon: d.decision_horizon,
      snapshotId: d.forecast_snapshot_id ?? "",
      recommended: d.recommended_action ?? "",
      owner: d.owner_decision ?? "",
      publicAction: d.public_action ?? "",
      reason: d.decision_reason ?? "",
      actualResult: d.actual_result ?? "",
      entries: d.actual_entries == null ? "" : String(d.actual_entries),
      unique: d.actual_unique_players == null ? "" : String(d.actual_unique_players),
      reentries: d.actual_reentries == null ? "" : String(d.actual_reentries),
      prizePool: d.actual_prize_pool == null ? "" : String(d.actual_prize_pool),
      overlay: d.actual_overlay_amount == null ? "" : String(d.actual_overlay_amount),
      postReason: d.post_event_reason ?? "",
    });
    setOpen(true);
  };

  const submit = async () => {
    const core = {
      decision_horizon: f.horizon,
      forecast_snapshot_id: f.snapshotId || null,
      recommended_action: f.recommended.trim() || null,
      owner_decision: f.owner.trim() || null,
      public_action: f.publicAction.trim() || null,
      decision_reason: f.reason.trim() || null,
    };
    const actuals = showActuals
      ? {
          actual_result: f.actualResult.trim() || null,
          actual_entries: toNum(f.entries),
          actual_unique_players: toNum(f.unique),
          actual_reentries: toNum(f.reentries),
          actual_prize_pool: toNum(f.prizePool),
          actual_overlay_amount: toNum(f.overlay),
          post_event_reason: f.postReason.trim() || null,
        }
      : {};
    const anyContent = core.owner_decision || core.recommended_action || core.public_action || (showActuals && (actuals.actual_entries != null || actuals.actual_result));
    if (!anyContent) return toast.error("Nhập ít nhất một quyết định hoặc kết quả");
    const ok = editId
      ? await updateDecision(editId, { ...core, ...actuals })
      : await insertDecision({ event_id: eventId, ...core, ...actuals });
    if (ok) setOpen(false);
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <ClipboardList className="h-4 w-4 text-primary" /> Quyết định
        </h3>
        <Button size="sm" className="gap-1" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> Thêm quyết định
        </Button>
      </div>

      {decisions.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Chưa có quyết định cho giải này.</p>
      ) : (
        <ul className="space-y-1.5">
          {decisions.map((d) => (
            <li key={d.id} className="rounded-md border border-border/60 bg-card/40 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant={d.decision_horizon === "post" ? "secondary" : "outline"} className="text-[10px]">
                  {HORIZON_LABEL[d.decision_horizon] ?? d.decision_horizon}
                </Badge>
                {d.owner_decision && <span className="font-medium">QĐ: {d.owner_decision}</span>}
                {d.public_action && <span className="text-muted-foreground">· {d.public_action}</span>}
                <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                  {formatShortDate(d.created_at)}
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(d)} aria-label="Sửa">
                    <Pencil className="h-3 w-3" />
                  </Button>
                </span>
              </div>
              {d.recommended_action && <div className="mt-0.5 text-[10px] text-muted-foreground">Đề xuất: {d.recommended_action}</div>}
              {d.decision_reason && <div className="text-[11px] text-muted-foreground">{d.decision_reason}</div>}
              {d.decision_horizon === "post" && d.actual_entries != null && (
                <div className="mt-1 text-[10px] text-primary/90">
                  KQ: {d.actual_entries} entries
                  {d.actual_prize_pool != null && ` · pool ${formatVND(d.actual_prize_pool)}`}
                  {d.actual_overlay_amount != null && ` · overlay ${formatVND(d.actual_overlay_amount)}`}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Sửa quyết định" : "Thêm quyết định"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Mốc quyết định">
              <EnumSelect value={f.horizon} onChange={(v) => set("horizon", v)} options={DECISION_HORIZONS} labels={HORIZON_LABEL} />
            </Field>
            <Field label="Liên kết dự báo">
              <Select value={f.snapshotId || NONE} onValueChange={(v) => set("snapshotId", v === NONE ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Không liên kết —</SelectItem>
                  {snapshots.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {(HORIZON_LABEL[s.horizon] ?? s.horizon)} · dự báo {s.forecast_base ?? "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Đề xuất (recommended)"><Input className="h-9" value={f.recommended} onChange={(e) => set("recommended", e.target.value)} /></Field>
            <Field label="Quyết định của chủ"><Input className="h-9" value={f.owner} onChange={(e) => set("owner", e.target.value)} /></Field>
            <Field label="Hành động công khai"><Input className="h-9" value={f.publicAction} onChange={(e) => set("publicAction", e.target.value)} /></Field>
            <Field label="Lý do"><Input className="h-9" value={f.reason} onChange={(e) => set("reason", e.target.value)} /></Field>
          </div>

          {showActuals && (
            <div className="mt-1 rounded-md border border-primary/25 bg-primary/5 p-2">
              <div className="mb-2 text-[11px] font-medium text-muted-foreground">Kết quả sau giải (chỉ để chấm điểm)</div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Entries"><Input type="number" className="h-9" value={f.entries} onChange={(e) => set("entries", e.target.value)} /></Field>
                <Field label="Người (unique)"><Input type="number" className="h-9" value={f.unique} onChange={(e) => set("unique", e.target.value)} /></Field>
                <Field label="Re-entry"><Input type="number" className="h-9" value={f.reentries} onChange={(e) => set("reentries", e.target.value)} /></Field>
                <Field label="Prize pool (₫)"><Input type="number" className="h-9" value={f.prizePool} onChange={(e) => set("prizePool", e.target.value)} /></Field>
                <Field label="Overlay (₫)"><Input type="number" className="h-9" value={f.overlay} onChange={(e) => set("overlay", e.target.value)} /></Field>
                <Field label="Kết quả (mô tả)"><Input className="h-9" value={f.actualResult} onChange={(e) => set("actualResult", e.target.value)} /></Field>
              </div>
              <Field label="Ghi chú sau giải"><Input className="h-9 mt-2" value={f.postReason} onChange={(e) => set("postReason", e.target.value)} /></Field>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Huỷ</Button>
            <Button onClick={submit} disabled={saving}>{editId ? "Cập nhật" : "Lưu quyết định"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
