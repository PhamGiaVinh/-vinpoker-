import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import {
  DECISION_HORIZONS,
  HORIZON_LABEL,
  type DecisionLog,
  type DecisionLogInsert,
  type DecisionLogUpdate,
  type ForecastSnapshot,
} from "@/lib/series-intelligence/captureTypes";
import { Field, EnumSelect, toNum } from "../formBits";
import { FEATURES } from "@/lib/featureFlags";
import { SHADOW_PREFIX, isShadowDecision } from "@/lib/series-intelligence/captureScoring";

type InsertFn = (p: Omit<DecisionLogInsert, "club_id">) => Promise<boolean>;
type UpdateFn = (id: string, patch: DecisionLogUpdate) => Promise<boolean>;

const NONE = "__none__";
const EMPTY = {
  horizon: "T-7", snapshotId: "", recommended: "", owner: "", publicAction: "", reason: "",
  actualResult: "", entries: "", unique: "", reentries: "", prizePool: "", overlay: "", postReason: "",
};

/** Controlled dialog: record a decision, edit one, or (resultMode) enter post-event actuals. */
export function DecisionDialog({
  open,
  onOpenChange,
  eventId,
  snapshots,
  saving,
  insertDecision,
  updateDecision,
  editing,
  resultMode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  snapshots: ForecastSnapshot[];
  saving: boolean;
  insertDecision: InsertFn;
  updateDecision: UpdateFn;
  editing?: DecisionLog | null;
  resultMode?: boolean;
}) {
  const [f, setF] = useState({ ...EMPTY });
  const [shadow, setShadow] = useState(false); // TP9 — "quyết định KHÔNG tổ chức" (did-not-run) marker
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));
  const showActuals = f.horizon === "post";

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const sh = isShadowDecision(editing);
      setShadow(sh);
      setF({
        horizon: editing.decision_horizon,
        snapshotId: editing.forecast_snapshot_id ?? "",
        recommended: editing.recommended_action ?? "",
        owner: sh ? (editing.owner_decision ?? "").replace(/^\[SHADOW\]\s*/, "") : (editing.owner_decision ?? ""),
        publicAction: editing.public_action ?? "",
        reason: editing.decision_reason ?? "",
        actualResult: editing.actual_result ?? "",
        entries: editing.actual_entries == null ? "" : String(editing.actual_entries),
        unique: editing.actual_unique_players == null ? "" : String(editing.actual_unique_players),
        reentries: editing.actual_reentries == null ? "" : String(editing.actual_reentries),
        prizePool: editing.actual_prize_pool == null ? "" : String(editing.actual_prize_pool),
        overlay: editing.actual_overlay_amount == null ? "" : String(editing.actual_overlay_amount),
        postReason: editing.post_event_reason ?? "",
      });
    } else {
      setShadow(false);
      setF({ ...EMPTY, horizon: resultMode ? "post" : "T-7" });
    }
  }, [open, editing, resultMode]);

  const submit = async () => {
    const ownerTrim = f.owner.trim();
    const core = {
      decision_horizon: f.horizon,
      forecast_snapshot_id: f.snapshotId || null,
      recommended_action: f.recommended.trim() || null,
      // TP9 — a shadow (did-not-run) decision is stamped with the text convention until the is_shadow column
      // is applied (TP-M migration) + types regenerated; then this becomes an is_shadow=true write.
      owner_decision: shadow ? SHADOW_PREFIX + ownerTrim : ownerTrim || null,
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
    const anyContent =
      shadow || core.owner_decision || core.recommended_action || core.public_action || (showActuals && (actuals.actual_entries != null || actuals.actual_result));
    if (!anyContent) return toast.error("Nhập ít nhất một quyết định hoặc số thực tế");
    const ok = editing
      ? await updateDecision(editing.id, { ...core, ...actuals })
      : await insertDecision({ event_id: eventId, ...core, ...actuals });
    if (ok) onOpenChange(false);
  };

  const title = resultMode ? "Nhập kết quả sau giải" : editing ? "Sửa quyết định" : "Ghi quyết định";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {resultMode
              ? "Giải chạy xong rồi — nhập số thực tế để hệ thống đối chiếu với dự đoán."
              : "Ghi lại bạn quyết gì cho giải (ví dụ: giữ GTD, đẩy marketing) và vì sao."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ghi ở thời điểm">
            <EnumSelect value={f.horizon} onChange={(v) => set("horizon", v)} options={DECISION_HORIZONS} labels={HORIZON_LABEL} />
          </Field>
          <Field label="Dựa trên dự đoán nào">
            <Select value={f.snapshotId || NONE} onValueChange={(v) => set("snapshotId", v === NONE ? "" : v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Không —</SelectItem>
                {snapshots.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {(HORIZON_LABEL[s.horizon] ?? s.horizon)} · dự đoán {s.forecast_base ?? "—"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Hệ thống/TD đề xuất"><Input className="h-9" value={f.recommended} onChange={(e) => set("recommended", e.target.value)} /></Field>
          <Field label="Quyết định của bạn"><Input className="h-9" value={f.owner} onChange={(e) => set("owner", e.target.value)} /></Field>
          <Field label="Công bố ra ngoài"><Input className="h-9" value={f.publicAction} onChange={(e) => set("publicAction", e.target.value)} /></Field>
          <Field label="Vì sao"><Input className="h-9" value={f.reason} onChange={(e) => set("reason", e.target.value)} /></Field>
        </div>

        {FEATURES.seriesShadowDecision && (
          <label className="mt-1 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-[12px]">
            <input type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--warning))]" />
            <span>
              Quyết định <b>KHÔNG tổ chức</b> (shadow)
              <span className="block text-[10px] text-muted-foreground">ghi lại nước "không làm" để học sau — sẽ không được chấm điểm (không có kết quả thật)</span>
            </span>
          </label>
        )}

        {showActuals && (
          <div className="mt-1 rounded-md border border-primary/25 bg-primary/5 p-2">
            <div className="mb-2 text-[11px] font-medium text-muted-foreground">Số thực tế sau giải</div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Số người tham gia"><Input type="number" className="h-9" value={f.entries} onChange={(e) => set("entries", e.target.value)} /></Field>
              <Field label="Người khác nhau"><Input type="number" className="h-9" value={f.unique} onChange={(e) => set("unique", e.target.value)} /></Field>
              <Field label="Lượt re-entry"><Input type="number" className="h-9" value={f.reentries} onChange={(e) => set("reentries", e.target.value)} /></Field>
              <Field label="Tổng prize pool (₫)"><Input type="number" className="h-9" value={f.prizePool} onChange={(e) => set("prizePool", e.target.value)} /></Field>
              <Field label="Tiền bù GTD (₫)"><Input type="number" className="h-9" value={f.overlay} onChange={(e) => set("overlay", e.target.value)} /></Field>
              <Field label="Tóm tắt"><Input className="h-9" value={f.actualResult} onChange={(e) => set("actualResult", e.target.value)} /></Field>
            </div>
            <Field label="Ghi chú sau giải"><Input className="mt-2 h-9" value={f.postReason} onChange={(e) => set("postReason", e.target.value)} /></Field>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button onClick={submit} disabled={saving}>{editing ? "Cập nhật" : "Lưu"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
