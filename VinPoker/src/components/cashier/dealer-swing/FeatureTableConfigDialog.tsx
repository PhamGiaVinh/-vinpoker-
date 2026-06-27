/**
 * FeatureTableConfigDialog — Patch 1 (UI mock shell). Configures a table's mode
 * (Thường/Tâm điểm), Final flag, allow-override policy, and the allowed dealer
 * pool (with a primary). Writes to the local mock store only (no DB/RPC). In a
 * later patch the Save handler calls set_table_dealer_mode / set_table_dealer_pool.
 */
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  getProfile, saveProfileToDb, useFeatureEnforcementEnabled,
  type DealerTableMode, type FeatureTablePoolMember,
} from "./featureTableMock";

export interface PoolDealer { id: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tableId: string;
  tableName: string;
  clubId: string;
  dealers: PoolDealer[];
}

export function FeatureTableConfigDialog({ open, onOpenChange, tableId, tableName, clubId, dealers }: Props) {
  const [mode, setMode] = useState<DealerTableMode>("normal");
  const [isFinal, setIsFinal] = useState(false);
  const [allowOverride, setAllowOverride] = useState(false);
  const [pool, setPool] = useState<FeatureTablePoolMember[]>([]);
  const [saving, setSaving] = useState(false);
  const { enabled: enforcementOn } = useFeatureEnforcementEnabled();

  // hydrate from the mock store each time the dialog opens
  useEffect(() => {
    if (!open) return;
    const p = getProfile(tableId);
    setMode(p.tableMode);
    setIsFinal(p.isFinal);
    setAllowOverride(p.allowOverride);
    setPool(p.pool);
  }, [open, tableId]);

  const isSpecial = mode === "feature" || isFinal;
  const inPool = (id: string) => pool.some((m) => m.dealerId === id);
  const togglePool = (d: PoolDealer) => {
    setPool((prev) => prev.some((m) => m.dealerId === d.id)
      ? prev.filter((m) => m.dealerId !== d.id)
      : [...prev, { dealerId: d.id, name: d.name, isPrimary: prev.length === 0 }]);
  };
  const setPrimary = (id: string) =>
    setPool((prev) => prev.map((m) => ({ ...m, isPrimary: m.dealerId === id })));

  const emptyPoolWarning = isSpecial && pool.length === 0;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveProfileToDb(tableId, clubId, { tableMode: mode, isFinal, allowOverride, pool });
      toast.success("Đã lưu cấu hình bàn");
      onOpenChange(false);
    } catch (e) {
      toast.error(`Lưu thất bại: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cấu hình bàn — {tableName}</DialogTitle>
          <DialogDescription>
            Chọn loại bàn và nhóm dealer được phép xoay vòng. Lưu sẽ ghi vào hệ thống.
          </DialogDescription>
        </DialogHeader>

        {enforcementOn === false && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-[11px] text-warning">
            ℹ Cấu hình sẽ được lưu nhưng <b>enforcement đang TẮT</b> — nhóm dealer chưa bảo vệ bàn (sẽ bật sau).
          </div>
        )}

        <div className="space-y-4">
          {/* Mode */}
          <div>
            <Label className="text-xs text-muted-foreground">Loại bàn</Label>
            <div className="mt-1 flex gap-2">
              {([["normal", "Thường"], ["feature", "Tâm điểm"]] as [DealerTableMode, string][]).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                    mode === m ? "border-success/60 bg-success/10 text-success" : "border-border text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Final + override toggles */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setIsFinal((v) => !v)}
              className={cn(
                "rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                isFinal ? "border-amber-400/60 bg-amber-400/10 text-amber-400" : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              {isFinal ? "★ Final: BẬT" : "Final: tắt"}
            </button>
            <button
              onClick={() => setAllowOverride((v) => !v)}
              className={cn(
                "rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                allowOverride ? "border-warning/60 bg-warning/10 text-warning" : "border-border text-muted-foreground hover:bg-muted/50",
              )}
              title="Cho phép floor override gán dealer thường khi thiếu (có ghi audit)"
            >
              {allowOverride ? "Override: cho phép" : "Override: chặn"}
            </button>
          </div>

          {/* Scheduled start — disabled placeholder (Patch 7 C1: planned_start_at column not yet created) */}
          <div>
            <Label className="text-xs text-muted-foreground">Giờ bắt đầu dự kiến (bàn final)</Label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="time"
                disabled
                className="flex-1 cursor-not-allowed rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground/60"
                aria-label="Giờ bắt đầu dự kiến (sắp ra mắt)"
              />
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Sắp ra mắt</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground/70">Lên lịch mở bàn final theo giờ — sẽ có ở bản cập nhật sau.</p>
          </div>

          {/* Pool */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Nhóm dealer được phép {isSpecial ? "" : "(chỉ áp dụng cho bàn tâm điểm/final)"}
              </Label>
              <span className="text-[11px] text-muted-foreground">{pool.length} dealer</span>
            </div>
            <div className="mt-1 max-h-48 space-y-1 overflow-auto rounded-md border border-border p-1">
              {dealers.length === 0 && (
                <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">Không có dealer đang trong ca</div>
              )}
              {dealers.map((d) => {
                const member = pool.find((m) => m.dealerId === d.id);
                return (
                  <div
                    key={d.id}
                    className={cn(
                      "flex items-center gap-2 rounded px-2 py-1.5 text-xs",
                      member ? "bg-success/5" : "",
                    )}
                  >
                    <button
                      onClick={() => togglePool(d)}
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]",
                        member ? "border-success bg-success/20 text-success" : "border-border text-transparent",
                      )}
                      aria-label={member ? "Bỏ khỏi nhóm" : "Thêm vào nhóm"}
                    >
                      ✓
                    </button>
                    <span className="flex-1 truncate text-foreground">{d.name}</span>
                    {member && (
                      <button
                        onClick={() => setPrimary(d.id)}
                        className={cn("shrink-0", member.isPrimary ? "text-amber-400" : "text-muted-foreground/40 hover:text-amber-400")}
                        title="Đặt làm dealer chính"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {emptyPoolWarning && (
              <p className="mt-1 text-[11px] text-warning">⚠ Bàn tâm điểm/final cần ít nhất 1 dealer — nếu trống sẽ luôn báo thiếu.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Huỷ</Button>
          <Button className="bg-success text-success-foreground hover:bg-success/90" onClick={save} disabled={emptyPoolWarning || saving}>
            {saving ? "Đang lưu…" : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
