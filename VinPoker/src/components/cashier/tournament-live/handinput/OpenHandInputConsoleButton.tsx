// Entry point to the standalone operator Hand Input console (`/tracker/hand-input`).
//
// Self-gating: renders NOTHING unless FEATURES.trackerHandInputConsole is on, so it
// can sit unconditionally in the operator "Nhập hand" tab and adds zero DOM while the
// flag is dark (no change to the live operator flow on main). When on, it gives floor
// staff a clear, tablet-sized way to open the full-screen console for this tournament.

import { Link } from "react-router-dom";
import { Maximize2 } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";

export function OpenHandInputConsoleButton({ tournamentId }: { tournamentId: string }) {
  if (!FEATURES.trackerHandInputConsole) return null;

  return (
    <Link
      to={`/tracker/hand-input?tournament=${tournamentId}`}
      className="mb-3 flex min-h-[48px] items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition-colors hover:border-emerald-400/70 hover:bg-emerald-500/20"
    >
      <span className="flex items-center gap-2">
        <Maximize2 className="h-4 w-4 shrink-0" />
        Mở bảng nhập hand toàn màn hình
      </span>
      <span className="rounded-md border border-emerald-500/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">
        Mới
      </span>
    </Link>
  );
}
