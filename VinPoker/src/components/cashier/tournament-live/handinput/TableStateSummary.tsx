// Compact table-state summary (engine mode) — the at-a-glance "where is the hand"
// strip: street · pot · who acts · their stack · what they must call. Presentation
// only; all values are derived in HandInputPanel and passed in.

import type { ReactNode } from "react";
import { formatStack } from "./format";

interface TableStateSummaryProps {
  streetLabel: string;
  pot: number;
  sidePotCount?: number;
  actorName: string | null;
  actorSeat: number | null;
  actorStack: number | null;
  toCall: number;
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">{label}</span>
      <span className="text-sm font-medium truncate">{children}</span>
    </div>
  );
}

export function TableStateSummary({ streetLabel, pot, sidePotCount = 0, actorName, actorSeat, actorStack, toCall }: TableStateSummaryProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 px-3.5 py-2.5 rounded-lg border border-emerald-700/30 bg-emerald-950/20 shadow-sm">
      <Cell label="Vòng">
        <span className="text-amber-300">{streetLabel}</span>
      </Cell>
      <Cell label="Pot">
        <span className="font-mono text-emerald-400">{formatStack(pot)}</span>
        {sidePotCount > 0 && <span className="ml-1 text-[10px] text-amber-300">+{sidePotCount} side</span>}
      </Cell>
      <Cell label="Đến lượt">
        {actorName ? (
          <span className="text-foreground">Ghế {actorSeat} · {actorName}</span>
        ) : (
          <span className="text-emerald-300">Vòng cược xong</span>
        )}
      </Cell>
      <Cell label="Cần theo / Stack">
        {actorName ? (
          <span>
            <span className="font-mono text-amber-300">{toCall > 0 ? formatStack(toCall) : "0"}</span>
            {actorStack != null && <span className="text-muted-foreground"> / {formatStack(actorStack)}</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Cell>
    </div>
  );
}
