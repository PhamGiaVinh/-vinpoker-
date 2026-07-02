import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shiftWindowLabel } from "../shift-planner/ShiftPlanner.utils";
import type { ShiftTemplate } from "@/types/shiftPlanner";

/**
 * V2 per-day demand editor ("✎ Sửa nhu cầu") — the floor adjusts how many
 * dealers each window needs FOR THIS DAY ONLY (e.g. 3 tournaments tonight →
 * bump 16–00 from 4 to 6). Overrides live in component state, feed the local
 * re-solve, and are persisted into dealer_schedule_runs.params on save — the
 * templates themselves (Quản lý ca) are never modified.
 */
export function DemandDialog({
  open,
  onOpenChange,
  templates,
  overrides,
  tourCount,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templates: ShiftTemplate[];
  overrides: Record<string, number>;
  /** Tournaments on this day (context line), if known. */
  tourCount: number | null;
  onApply: (next: Record<string, number>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const init: Record<string, string> = {};
    for (const t of templates) init[t.id] = String(overrides[t.id] ?? t.needCount);
    setDraft(init);
  }, [open, templates, overrides]);

  const apply = () => {
    const next: Record<string, number> = {};
    for (const t of templates) {
      const n = Math.max(0, Math.min(50, Number.parseInt(draft[t.id] ?? "", 10)));
      if (Number.isFinite(n) && n !== t.needCount) next[t.id] = n;
    }
    onApply(next);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-primary" /> Nhu cầu dealer hôm nay
          </DialogTitle>
          <DialogDescription>
            {tourCount != null ? `${tourCount} tour trong ngày — ` : ""}
            chỉnh số dealer cần cho TỪNG khung ca của riêng ngày này (không đổi khung ca gốc).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">
                  {shiftWindowLabel(t)} · mặc định {t.needCount}
                </div>
              </div>
              <Input
                type="number"
                min={0}
                max={50}
                className="h-8 w-20 text-center"
                value={draft[t.id] ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, [t.id]: e.target.value }))}
              />
            </div>
          ))}
          {templates.length === 0 && (
            <div className="py-3 text-center text-[12px] text-muted-foreground">
              Chưa có khung ca — tạo ở "Quản lý ca".
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button onClick={apply}>Áp dụng cho ngày này</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
