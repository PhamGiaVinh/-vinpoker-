// src/components/poker/SitDownDialog.tsx
// GE-2 closed alpha — pick a buy-in and sit at a chosen empty seat. Pure UI: it
// validates the amount against the table's [minBuyin, maxBuyin] and the caller's
// wallet, then calls onConfirm(buyin) which routes through op_sit_down (server
// re-validates). Chips are decimal STRINGS end-to-end (never JS numbers on the wire).

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Coins, Loader2 } from 'lucide-react';

const fmt = (s: string | number): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(s);
};

export function SitDownDialog({
  open, onOpenChange, seatNo, tableName, bb,
  minBuyin, maxBuyin, startingStack, walletBalance,
  onConfirm, onClaim,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  seatNo: number | null;
  tableName: string;
  bb: string;
  minBuyin: string;
  maxBuyin: string;
  startingStack: string;
  walletBalance: string;
  onConfirm: (buyin: string) => Promise<void>;
  onClaim: () => Promise<void>;
}) {
  const min = Number(minBuyin);
  const max = Number(maxBuyin);
  const wallet = Number(walletBalance);
  const bbN = Math.max(1, Number(bb) || 1);

  // Effective max is bounded by the wallet (can't sit for more than you hold).
  const effMax = Math.max(min, Math.min(max, wallet));
  const canAfford = wallet >= min;

  const [amount, setAmount] = useState<number>(Math.min(Number(startingStack) || min, effMax));
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    // Reset the slider whenever the dialog (re)opens for a new seat.
    if (open) setAmount(Math.min(Math.max(min, Number(startingStack) || min), effMax));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seatNo]);

  const inBB = useMemo(() => (bbN ? Math.round(amount / bbN) : 0), [amount, bbN]);

  const doSit = async () => {
    if (!canAfford || amount < min) return;
    setBusy(true);
    try { await onConfirm(String(Math.round(amount))); }
    finally { setBusy(false); }
  };

  const doClaim = async () => {
    setClaiming(true);
    try { await onClaim(); }
    finally { setClaiming(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Ngồi vào ghế {seatNo}</DialogTitle>
          <DialogDescription>
            {tableName} · blinds {fmt(Number(bb) / 2 || bb)}/{fmt(bb)}
          </DialogDescription>
        </DialogHeader>

        {/* wallet */}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <Coins className="h-4 w-4 text-primary" />
          <span className="text-sm text-muted-foreground">Quỹ chip:</span>
          <span className="ml-auto font-bold tabular-nums text-primary">{fmt(walletBalance)}</span>
        </div>

        {!canAfford ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Bạn cần tối thiểu <span className="font-semibold text-foreground">{fmt(minBuyin)}</span> chip để vào bàn.
              Nhận chip miễn phí (chip ảo) để bắt đầu.
            </p>
            <Button className="w-full" onClick={doClaim} disabled={claiming}>
              {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Nhận 1.000.000 chip miễn phí'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Số chip mang vào</span>
              <span className="text-lg font-bold tabular-nums text-primary">
                {fmt(amount)} <span className="text-xs font-normal text-muted-foreground">({inBB} BB)</span>
              </span>
            </div>
            <Slider
              value={[amount]}
              min={min}
              max={effMax}
              step={bbN}
              onValueChange={(v) => setAmount(v[0] ?? min)}
              aria-label="Buy-in"
            />
            <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
              <button type="button" className="hover:text-primary" onClick={() => setAmount(min)}>Min {fmt(min)}</button>
              <button type="button" className="hover:text-primary" onClick={() => setAmount(Math.min(Number(startingStack), effMax))}>Mặc định</button>
              <button type="button" className="hover:text-primary" onClick={() => setAmount(effMax)}>Max {fmt(effMax)}</button>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Hủy</Button>
          {canAfford && (
            <Button onClick={doSit} disabled={busy || amount < min}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Ngồi vào · ${fmt(amount)}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
