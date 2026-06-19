// src/components/poker/BustoutDialog.tsx
// Friends-practice bustout: shown when a seated player has 0 chips between hands. They can
// stand up and leave (existing leave_open_table) or rebuy a fresh stack.
//
// REBUY is gated by `rebuyEnabled` (FEATURES.onlinePokerRebuy, default OFF). While OFF the
// button stays disabled ("sẽ bổ sung sau"). When ON it is a FIXED-amount confirm — one tap
// buys exactly the table's starting stack (`rebuyAmount`); there is NO free amount input.
// The server (op_rebuy_open) re-dictates the amount and is busted-only — the client never
// mints chips or picks an arbitrary stack.

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, LogOut, Coins } from 'lucide-react';

const fmtChips = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
};

export function BustoutDialog({
  open, onOpenChange, onLeave, rebuyEnabled = false, rebuyAmount, onRebuy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Stand up and leave the table (the page wires this to the existing leave flow). */
  onLeave: () => Promise<void> | void;
  /** When true, the "Mua thêm chip" button is active (FEATURES.onlinePokerRebuy). */
  rebuyEnabled?: boolean;
  /** Fixed rebuy amount = the table's starting stack (chip string). Server-dictated. */
  rebuyAmount?: string;
  /** Rebuy a fresh stack (no argument — the amount is server-dictated). */
  onRebuy?: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  const doLeave = async () => {
    if (busy) return;
    setBusy(true);
    try { await onLeave(); }
    finally { setBusy(false); }
  };

  const doRebuy = async () => {
    if (busy || !onRebuy) return;
    setBusy(true);
    try { await onRebuy(); }
    finally { setBusy(false); }
  };

  const canRebuy = rebuyEnabled && !!onRebuy && !!rebuyAmount;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Bạn đã hết chip</DialogTitle>
          <DialogDescription>
            Ván vừa rồi bạn đã thua hết chip. Bạn có thể đứng dậy rời bàn, hoặc mua thêm chip để chơi tiếp.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {canRebuy ? (
            // Fixed-amount confirm — buys exactly the table starting stack (server-dictated).
            <Button className="w-full gap-2" onClick={doRebuy} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
              Mua thêm {fmtChips(rebuyAmount!)} chip
            </Button>
          ) : (
            // No server rebuy op live yet — disabled, never mint chips on the client.
            <Button variant="outline" className="w-full" disabled title="Sẽ bổ sung sau">
              Mua thêm chip · sẽ bổ sung sau
            </Button>
          )}
          <Button variant={canRebuy ? 'outline' : 'default'} className="w-full gap-2" onClick={doLeave} disabled={busy}>
            <LogOut className="h-4 w-4" />
            Đứng dậy rời bàn
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            {canRebuy
              ? 'Chip ảo để đấu tập. Mua lại đúng số chip khởi điểm của bàn.'
              : 'Chip ảo để đấu tập. Tính năng mua thêm chip sẽ có ở bản cập nhật sau.'}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Xem tiếp (chưa rời)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
