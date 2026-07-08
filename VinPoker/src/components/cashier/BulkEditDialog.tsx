import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import type { DealerRecord } from "@/hooks/useDealerManagement";

// Bulk-edit the common fields (Hạng + Loại) of many selected dealers at once
// (owner 2026-07-08). Salary + shift-preference have their own bulk dialogs; this
// covers tier + employment_type. Writes the same columns the ✏️ single-edit writes
// (via the untyped client, same RLS). "Giữ nguyên" = leave that field untouched.

const TIERS = ["A", "B", "C"] as const;
const EMP = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
] as const;

export function BulkEditDialog({
  open,
  onOpenChange,
  dealers,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The currently-selected dealer records. */
  dealers: DealerRecord[];
  onDone: () => void;
}) {
  const [tier, setTier] = useState<string | null>(null);          // null = giữ nguyên
  const [emp, setEmp] = useState<string | null>(null);            // null = giữ nguyên
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setTier(null); setEmp(null); setSaving(false); }
  }, [open]);

  const n = dealers.length;

  const apply = async () => {
    const ids = dealers.map((d) => d.id);
    if (ids.length === 0) return;
    const payload: Record<string, unknown> = {};
    if (tier) payload.tier = tier;
    if (emp) {
      payload.employment_type = emp;
      // PT is hourly-only → clear the monthly salary (mirror AddDealerDialog). The
      // operator sets the PT hourly rate afterwards via "Áp lương hàng loạt".
      if (emp === "part_time") payload.monthly_salary_vnd = 0;
    }
    if (Object.keys(payload).length === 0) {
      toast.error("Chọn ít nhất 1 thay đổi (Hạng hoặc Loại).");
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase.from("dealers") as any).update(payload).in("id", ids);
      if (error) throw error;
      toast.success(`Đã cập nhật ${ids.length} dealer`);
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi sửa hàng loạt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sửa hàng loạt — {n} dealer</DialogTitle>
          <DialogDescription>
            Chỉ đổi mục anh chọn; để "Giữ nguyên" thì không thay đổi mục đó.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">Hạng</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTier(null)}
                className={`rounded-md border px-3 py-1.5 text-xs ${tier === null ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:bg-muted/50"}`}
              >
                Giữ nguyên
              </button>
              {TIERS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  className={`rounded-md border px-3 py-1.5 text-xs ${tier === t ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:bg-muted/50"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">Loại hợp đồng</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEmp(null)}
                className={`rounded-md border px-3 py-1.5 text-xs ${emp === null ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:bg-muted/50"}`}
              >
                Giữ nguyên
              </button>
              {EMP.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setEmp(o.value)}
                  className={`rounded-md border px-3 py-1.5 text-xs ${emp === o.value ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:bg-muted/50"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {emp === "part_time" && (
              <p className="mt-1.5 text-[11px] text-warning">
                ⚠ Đổi sang Part-time sẽ đặt lương tháng = 0. Nhập lại lương giờ qua "Áp lương hàng loạt".
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Huỷ</Button>
          <Button onClick={apply} disabled={saving || (tier === null && emp === null)}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Áp dụng cho {n} dealer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
