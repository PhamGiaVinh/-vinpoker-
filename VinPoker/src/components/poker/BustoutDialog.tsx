// src/components/poker/BustoutDialog.tsx
// Friends-practice bustout: shown when a seated player has 0 chips between hands. They can
// stand up and leave (existing leave_open_table — works today) or, later, buy more chips.
// REBUY IS DISABLED on purpose: there is no server rebuy op yet (PR B2), and the client
// must never mint chips. Display-only — leaving is the one authoritative action here.

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, LogOut } from 'lucide-react';

export function BustoutDialog({
  open, onOpenChange, onLeave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Stand up and leave the table (the page wires this to the existing leave flow). */
  onLeave: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  const doLeave = async () => {
    if (busy) return;
    setBusy(true);
    try { await onLeave(); }
    finally { setBusy(false); }
  };

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
          <Button className="w-full gap-2" onClick={doLeave} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Đứng dậy rời bàn
          </Button>
          {/* No server rebuy op yet (PR B2) — disabled, never mint chips on the client. */}
          <Button variant="outline" className="w-full" disabled title="Sẽ bổ sung sau">
            Mua thêm chip · sẽ bổ sung sau
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            Chip ảo để đấu tập. Tính năng mua thêm chip sẽ có ở bản cập nhật sau.
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
