// src/components/poker/ActionBar.tsx
// GE-2D — the player action bar. In the shell EVERY button is disabled because
// RUNTIME_LIVE is false: the client never decides legality and there is no live
// runtime to submit to. When the runtime is wired, each button will POST an
// intent (op = submit_action) to the online-poker-action Edge function, which
// runs the engine and returns the authoritative next state. The client only ever
// sends intent — it never computes the result.

import { Button } from '@/components/ui/button';
import { RUNTIME_LIVE, type PublicHandView } from '@/lib/onlinePoker/types';
import { Ban } from 'lucide-react';

const ACTIONS: { key: string; label: string; variant: 'destructive' | 'secondary' | 'default' }[] = [
  { key: 'fold', label: 'Fold', variant: 'destructive' },
  { key: 'check', label: 'Check', variant: 'secondary' },
  { key: 'call', label: 'Call', variant: 'secondary' },
  { key: 'bet', label: 'Bet', variant: 'default' },
  { key: 'raise', label: 'Raise', variant: 'default' },
  { key: 'allin', label: 'All-in', variant: 'default' },
];

export function ActionBar({ hand }: { hand: PublicHandView }) {
  const myTurn = RUNTIME_LIVE && hand.toActSeat === hand.mySeat;
  // While dark, force every control off regardless of whose turn the mock says.
  const disabled = !RUNTIME_LIVE || !myTurn;

  return (
    <div className="space-y-2">
      {!RUNTIME_LIVE && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <Ban className="h-3.5 w-3.5" />
          <span>Runtime chưa mở — các nút thao tác bị khóa (chế độ xem trước, dữ liệu mẫu).</span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {ACTIONS.map((a) => (
          <Button
            key={a.key}
            variant={a.variant}
            disabled={disabled}
            aria-disabled={disabled}
            className="min-w-20"
            title={!RUNTIME_LIVE ? 'Runtime chưa mở' : undefined}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
