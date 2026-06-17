// src/components/poker/SitDownDialog.tsx
// Friends-practice: pick how many chips to bring to a chosen empty seat. No wallet —
// the player just enters a number they agree on with the table (op_sit_open re-validates
// 1 … 1e9). Chips are decimal STRINGS end-to-end (never JS numbers on the wire).

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

const MAX_CHIPS = 1_000_000_000;

const fmt = (s: string | number): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(s);
};

export function SitDownDialog({
  open, onOpenChange, seatNo, tableName, sb, bb, defaultStack, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  seatNo: number | null;
  tableName: string;
  sb: string;
  bb: string;
  /** suggested starting chips (host's default), as a chip string */
  defaultStack: string;
  onConfirm: (buyin: string) => Promise<void>;
}) {
  const bbN = Math.max(1, Number(bb) || 1);
  const suggested = Math.min(MAX_CHIPS, Math.max(bbN, Number(defaultStack) || bbN * 100));

  const [amount, setAmount] = useState<string>(String(Math.round(suggested)));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setAmount(String(Math.round(suggested)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seatNo]);

  const n = Math.floor(Number(amount));
  const valid = Number.isFinite(n) && n >= 1 && n <= MAX_CHIPS;
  const inBB = useMemo(() => (valid && bbN ? Math.round(n / bbN) : 0), [valid, n, bbN]);

  const presets = [50, 100, 200].map((x) => ({ label: `${x} BB`, value: Math.min(MAX_CHIPS, x * bbN) }));

  const doSit = async () => {
    if (!valid) return;
    setBusy(true);
    try { await onConfirm(String(n)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Ngồi vào ghế {seatNo}</DialogTitle>
          <DialogDescription>{tableName} · blinds {fmt(sb)}/{fmt(bb)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="text-sm font-medium">Số chip mang vào</label>
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            className="text-lg font-bold tabular-nums"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="tabular-nums">{valid ? `≈ ${inBB} BB` : 'Nhập số chip (1 … 1 tỷ)'}</span>
            <div className="flex gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setAmount(String(p.value))}
                  className="rounded-md border border-border px-2 py-0.5 hover:border-primary hover:text-primary"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Chip ảo để đấu tập — không phải tiền thật. Tự thống nhất số chip với bàn (vd qua chat ngoài).
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Hủy</Button>
          <Button onClick={doSit} disabled={busy || !valid}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Ngồi vào · ${valid ? fmt(n) : '—'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
