import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ExternalLink, Loader2 } from "lucide-react";

function mapError(code?: string): string {
  switch (code) {
    case "unauthorized": return "Bạn cần đăng nhập lại.";
    case "actor_not_allowed": return "Không có quyền mở bàn cho CLB này.";
    case "tournament_not_open": return "Giải đã kết thúc/huỷ.";
    case "table_number_taken": return "Số bàn này đã tồn tại — chọn số khác.";
    case "invalid_max_seats": return "Số ghế không hợp lệ (2–10).";
    case "invalid_table_number": return "Số bàn không hợp lệ.";
    default: return code ? `Mở bàn thất bại (${code})` : "Mở bàn thất bại";
  }
}

/**
 * "Mở bàn" — open a new tournament table (or reopen a closed one if its number is
 * typed) via the live `open_tournament_table` RPC. Gated behind FEATURES.floorTableOps
 * by the caller. Seat move only — no money.
 */
export function OpenTableDialog({
  open, onOpenChange, tournamentId, defaultMaxSeats, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tournamentId: string;
  defaultMaxSeats: number;
  onDone: () => void;
}) {
  const [maxSeats, setMaxSeats] = useState<number>(defaultMaxSeats || 9);
  const [tableNumber, setTableNumber] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC source 20260912000000; not in generated types yet
      const { data, error } = await (supabase.rpc as any)("open_tournament_table", {
        p_tournament_id: tournamentId,
        p_table_number: tableNumber.trim() ? Number(tableNumber) : null,
        p_max_seats: Number(maxSeats) || null,
      });
      const res = (data ?? null) as { ok?: boolean; error?: string; table_number?: number; reopened?: boolean } | null;
      if (error || !res?.ok) { toast.error(mapError(error ? error.message : res?.error)); return; }
      toast.success(res.reopened ? `Đã mở lại Bàn ${res.table_number}` : `Đã mở Bàn ${res.table_number}`);
      onDone();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLink className="w-4 h-4 text-primary" /> Mở bàn
          </DialogTitle>
          <DialogDescription>
            Tạo bàn mới. Nhập đúng số của một bàn đã đóng để <b>mở lại</b> bàn đó.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Số bàn (để trống = tự đánh số tiếp theo)</Label>
            <Input type="number" min={1} value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)} placeholder="Tự động" className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Số ghế</Label>
            <Input type="number" min={2} max={10} value={maxSeats}
              onChange={(e) => setMaxSeats(Number(e.target.value))} className="h-9" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Huỷ</Button>
          <Button onClick={submit} disabled={busy || Number(maxSeats) < 2 || Number(maxSeats) > 10}>
            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-1" />} Mở bàn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
