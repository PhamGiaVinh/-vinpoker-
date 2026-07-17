import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Coins, AlertTriangle, Loader2 } from "lucide-react";
import type { ActionSeat } from "./PlayerActionSheet";

/**
 * Edit a seated player's chip stack via the existing tournament-live-draw
 * `update_seats` action (no new backend). Shows a chip-conservation warning —
 * editing one stack changes total chips in play and is NOT auto-balanced against
 * other seats; the floor must do that deliberately.
 */
export function EditChipsDialog({
  open, onOpenChange, tournamentId, seat, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tournamentId: string;
  seat: ActionSeat | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && seat) setValue(seat.chip_count);
  }, [open, seat]);

  if (!seat) return null;
  const delta = value - seat.chip_count;
  const invalid = !Number.isFinite(value) || value < 0;

  const save = async () => {
    if (invalid) { toast.error("Chip không hợp lệ"); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId,
          action: "update_seats",
          seats: [{
            seat_id: seat.seat_id,
            player_id: seat.player_id,
            entry_number: seat.entry_number,
            table_id: seat.table_id,
            seat_number: seat.seat_number,
            chip_count: value,
            is_active: true,
            player_name: seat.player_name,
          }],
        },
      });
      if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message); return; }
      toast.success(`Đã cập nhật chip ${seat.player_name || "người chơi"}`);
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-amber-400" /> Sửa chip — {seat.player_name || seat.player_id.slice(0, 8)}
          </DialogTitle>
          <DialogDescription>
            {seat.table_name} · Ghế {seat.seat_number}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Số chip mới</Label>
            <Input
              type="number"
              min={0}
              className="h-12 text-lg font-mono"
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
            />
            <div className="text-xs text-muted-foreground">
              Hiện tại: <span className="font-mono">{seat.chip_count.toLocaleString()}</span>
              {delta !== 0 && (
                <span className={delta > 0 ? "text-primary" : "text-destructive"}>
                  {" "}→ {value.toLocaleString()} ({delta > 0 ? "+" : ""}{delta.toLocaleString()})
                </span>
              )}
            </div>
          </div>

          {delta !== 0 && (
            <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Sửa chip một ghế sẽ thay đổi <strong>tổng chip in play</strong> và KHÔNG tự cân
                với các ghế khác. Chỉ dùng để sửa nhầm; cân chip phải làm thủ công.
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Huỷ</Button>
          <Button onClick={save} disabled={saving || invalid || delta === 0}>
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Coins className="w-4 h-4 mr-1.5" />}
            Lưu chip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
