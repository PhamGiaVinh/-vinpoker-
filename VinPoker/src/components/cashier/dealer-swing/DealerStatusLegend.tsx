/**
 * DealerStatusLegend — "CHÚ THÍCH TRẠNG THÁI" row under the battle map.
 * PRESENTATION ONLY: renders the 7-status dots + labels from the shared
 * dealerStatusStyle so the legend can never drift from the cards/chips.
 */

import { dealerStatusStyle, DEALER_STATUS_ORDER } from "./dealerStatusStyle";

export default function DealerStatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-zinc-400">
      <span className="uppercase tracking-wider text-zinc-500">Chú thích</span>
      {DEALER_STATUS_ORDER.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={["w-1.5 h-1.5 rounded-full", dealerStatusStyle[k].dot].join(" ")} aria-hidden="true" />
          {dealerStatusStyle[k].label}
        </span>
      ))}
    </div>
  );
}
