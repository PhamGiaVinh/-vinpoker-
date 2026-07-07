import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Clock, Loader2, Search } from "lucide-react";
import type { DealerRecord } from "@/hooks/useDealerManagement";

// Bulk-set the auto-fill "Ca ưa thích" on EXISTING dealers (owner 2026-07-07:
// #747 only added the field to Add/Adjust one-by-one — impractical for hundreds
// of imported dealers). Writes dealers.shift_preference (som | muon | linh_hoat)
// through the same RLS as the ✏️ edit dialog; one grouped .in() update. Requires
// migration 20261220000000 applied (owner-gated, done Bước 0).

const PREF_OPTIONS: { value: "som" | "muon" | "linh_hoat"; label: string }[] = [
  { value: "som", label: "Ca sớm (sáng)" },
  { value: "muon", label: "Ca muộn (tối)" },
  { value: "linh_hoat", label: "Linh hoạt" },
];
const PREF_LABEL: Record<string, string> = {
  som: "Sớm",
  muon: "Muộn",
  linh_hoat: "Linh hoạt",
};

export function BulkShiftPreferenceDialog({
  dealers,
  onDone,
}: {
  /** Active (non-deleted) dealers of the current club. */
  dealers: DealerRecord[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pref, setPref] = useState<"som" | "muon" | "linh_hoat" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const visible = useMemo(() => {
    let list = dealers;
    if (onlyMissing) list = list.filter((d) => d.shift_preference == null);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((d) => d.full_name.toLowerCase().includes(q));
    return [...list].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [dealers, onlyMissing, search]);

  const selCount = selected.size;
  const willWrite = pref ? selCount : 0;

  const reset = () => {
    setSearch("");
    setSelected(new Set());
    setPref(null);
    setSaving(false);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of visible) next.add(d.id);
      return next;
    });

  const applyAll = async () => {
    setConfirmOpen(false);
    if (!pref || selCount === 0) {
      toast.error("Chưa chọn dealer hoặc chưa chọn ca ưa thích.");
      return;
    }
    setSaving(true);
    try {
      const ids = [...selected];
      // One grouped update — every selected dealer gets the same preference.
      // Untyped client (as any) because shift_preference isn't in generated types
      // yet — same pattern as AddDealerDialog/DealerAdjustDialog.
      const { error } = await (supabase.from("dealers") as any)
        .update({ shift_preference: pref })
        .in("id", ids);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`Đã đặt ca ưa thích "${PREF_LABEL[pref]}" cho ${ids.length} dealer`);
      onDone();
      setOpen(false);
      reset();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi đặt ca ưa thích");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-8 text-xs border-primary/40 text-primary hover:bg-primary/10"
      >
        <Clock className="h-3.5 w-3.5 mr-1" /> Ca ưa thích hàng loạt
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-lg bg-popover border border-border text-foreground max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Đặt ca ưa thích hàng loạt</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Tick chọn dealer → chọn ca ưa thích → áp một lần. Dùng cho tự động xếp lịch.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {/* Search + filter */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm tên dealer..."
                  className="h-8 pl-8 text-xs bg-card border-border"
                />
              </div>
              <button
                type="button"
                onClick={() => setOnlyMissing((v) => !v)}
                className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  onlyMissing
                    ? "border-warning bg-warning/10 text-warning"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                Chỉ hiện chưa set
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {visible.length} dealer hiển thị · đã chọn <b className="text-foreground">{selCount}</b>
              </span>
              <span className="flex gap-2">
                <button className="text-primary hover:underline" onClick={selectAllVisible}>
                  Chọn tất cả đang hiển thị
                </button>
                <button className="text-muted-foreground hover:underline" onClick={() => setSelected(new Set())}>
                  Bỏ chọn
                </button>
              </span>
            </div>

            {/* Dealer list */}
            <div className="max-h-[38vh] overflow-y-auto overscroll-contain rounded-md border border-border">
              <div className="divide-y divide-border">
                {visible.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    {onlyMissing ? "Tất cả dealer đã đặt ca ưa thích 🎉" : "Không có dealer khớp tìm kiếm."}
                  </div>
                )}
                {visible.map((d) => (
                  <label key={d.id} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-muted/30">
                    <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{d.full_name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {d.shift_preference ? PREF_LABEL[d.shift_preference] ?? d.shift_preference : "chưa set"}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Preference choice */}
            <div>
              <div className="mb-1.5 text-[11px] text-muted-foreground">Ca ưa thích áp cho các dealer đã chọn</div>
              <div className="flex flex-wrap gap-2">
                {PREF_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setPref(o.value)}
                    className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                      pref === o.value
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-border pt-2">
            <Button variant="outline" className="border-border" onClick={() => { setOpen(false); reset(); }}>
              Đóng
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={saving || willWrite === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Áp cho {willWrite} dealer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Final confirm */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận đặt ca ưa thích?</AlertDialogTitle>
            <AlertDialogDescription>
              Đặt ca ưa thích <b>{pref ? PREF_LABEL[pref] : ""}</b> cho <b>{willWrite} dealer</b> đã chọn.
              Giá trị ca ưa thích hiện tại của những dealer này sẽ bị ghi đè.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={applyAll} className="bg-primary text-primary-foreground hover:bg-primary/90">
              Áp dụng
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
