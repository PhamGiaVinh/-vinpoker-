import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { UserPlus, Loader2 } from "lucide-react";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";

function mapError(code?: string): string {
  switch (code) {
    case "unauthorized": return "Bạn cần đăng nhập lại.";
    case "actor_not_allowed": return "Không có quyền thêm người cho CLB này.";
    case "tournament_not_open": return "Giải đã kết thúc/huỷ.";
    case "invalid_player_name": return "Tên tối thiểu 2 ký tự.";
    case "invalid_destination_table": return "Bàn không hợp lệ hoặc đã đóng.";
    case "invalid_seat_number": return "Số ghế không hợp lệ.";
    case "seat_occupied": return "Ghế vừa bị lấy — chọn ghế khác.";
    default: return code ? `Thêm người thất bại (${code})` : "Thêm người thất bại";
  }
}

/**
 * "Thêm người" — PURE seat placement (no money). Seats a walk-in into a chosen FREE
 * seat via the live `floor_assign_player_to_seat` RPC, then prints a seat ticket.
 * Only free seats are offered (occupied seats are never shown). Money is handled
 * separately at the cashier offline buy-in — this never touches it.
 */
export function AddPlayerDialog({
  open, onOpenChange, tournamentId, tournamentName, tournamentDate,
  tableTtId, maxSeats, occupiedSeats, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string | null;
  tableTtId: string;
  maxSeats: number;
  occupiedSeats: number[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [seat, setSeat] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const freeSeats = useMemo(() => {
    const taken = new Set(occupiedSeats);
    const out: number[] = [];
    for (let n = 1; n <= maxSeats; n++) if (!taken.has(n)) out.push(n);
    return out;
  }, [occupiedSeats, maxSeats]);

  // Reset + default to the first free seat each time the dialog opens.
  useEffect(() => {
    if (open) { setName(""); setSeat(freeSeats[0] ?? null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const formValid = name.trim().length >= 2 && seat != null;

  const submit = async () => {
    if (!formValid) return;
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC source 20260913000000; not in generated types yet
      const { data, error } = await (supabase.rpc as any)("floor_assign_player_to_seat", {
        p_tournament_id: tournamentId,
        p_player_name: name.trim(),
        p_tournament_table_id: tableTtId,
        p_seat_number: seat,
      });
      const res = (data ?? null) as {
        ok?: boolean; error?: string; table_number?: number | null; seat_number?: number;
        receipt_code?: string; display_name?: string; starting_stack?: number | null;
      } | null;
      if (error || !res?.ok) { toast.error(mapError(error ? error.message : res?.error)); return; }
      toast.success(`Đã xếp ${res.display_name} → Bàn ${res.table_number ?? "?"} · Ghế ${res.seat_number}`);
      setReceipt({
        tournamentName, tournamentDate,
        playerName: res.display_name ?? name.trim(),
        tableNumber: res.table_number ?? null,
        seatNumber: res.seat_number!,
        receiptCode: res.receipt_code!,
        startingStack: res.starting_stack ?? null,
        qrValue: res.receipt_code!,
      });
      setReceiptOpen(true);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-primary" /> Thêm người
            </DialogTitle>
            <DialogDescription>
              Xếp người chơi vào một ghế trống của bàn này. <b>Không thu tiền</b> ở bước này
              (buy-in xử lý tại quầy).
            </DialogDescription>
          </DialogHeader>

          {freeSeats.length === 0 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              Bàn đã đầy — không còn ghế trống.
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Tên người chơi</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nhập tên…" className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Ghế (chỉ hiện ghế trống)</Label>
                <Select value={seat?.toString() ?? ""} onValueChange={(v) => setSeat(Number(v))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Chọn ghế" /></SelectTrigger>
                  <SelectContent>
                    {freeSeats.map((n) => <SelectItem key={n} value={n.toString()}>Ghế {n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Huỷ</Button>
            <Button onClick={submit} disabled={busy || !formValid || freeSeats.length === 0}>
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />} Thêm người
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SeatReceiptDialog
        open={receiptOpen}
        onOpenChange={(v) => { setReceiptOpen(v); if (!v) onOpenChange(false); }}
        receipt={receipt}
      />
    </>
  );
}
