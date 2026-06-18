// Replay-mode awareness banner for the public live viewer (P0 — LIVE/REPLAY clarity).
//
// While the spectator watches a past hand in REPLAY mode, the live machinery keeps
// advancing in the background (new hand / new actions) but the felt stays frozen on
// the replay frame. Without a signal, a spectator can't tell the table has moved on,
// and clicking LIVE jumps them to a now-different hand with no warning.
//
// This banner closes that gap:
//   - default (no new live activity yet): a calm notice that updates are paused.
//   - new live activity detected: a prominent prompt to jump back to live.
// Both expose the same single "Xem trực tiếp" action. Presentational only — the
// parent owns all state/detection; this renders and reports the click. role="status"
// so screen readers announce it without stealing focus (WCAG status-message guidance).

import { History, Radio } from "lucide-react";

interface ReplayLiveBannerProps {
  /** The live hand has advanced past where the spectator entered replay. */
  hasNewActivity: boolean;
  /**
   * Number of new actions on the SAME live hand since replay was entered, or null
   * when a count isn't meaningful (e.g. a brand-new hand started). Drives the copy.
   */
  newActionCount: number | null;
  /** Jump back to live (parent sets mode → live and clears the baseline). */
  onGoLive: () => void;
}

export function ReplayLiveBanner({ hasNewActivity, newActionCount, onGoLive }: ReplayLiveBannerProps) {
  if (hasNewActivity) {
    const message =
      newActionCount != null && newActionCount > 0
        ? `Bản ghi mới: ${newActionCount} hành động vừa diễn ra.`
        : "Có diễn biến live mới đang diễn ra.";
    return (
      <div
        role="status"
        className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/15 text-xs text-amber-200"
      >
        <Radio className="w-4 h-4 shrink-0 text-amber-400" />
        <span className="font-semibold">{message}</span>
        <button
          type="button"
          onClick={onGoLive}
          className="ml-auto inline-flex items-center gap-1.5 min-h-[36px] rounded-md border border-emerald-500/50 bg-emerald-500/20 px-3 py-1.5 font-bold text-emerald-200 transition-colors hover:border-emerald-400/80 hover:bg-emerald-500/30"
        >
          <Radio className="w-3.5 h-3.5" /> Xem trực tiếp
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex items-center gap-2 flex-wrap px-3 py-1.5 rounded-lg border border-border bg-card/60 text-[11px] text-muted-foreground"
    >
      <History className="w-3.5 h-3.5 shrink-0 text-amber-400/80" />
      <span>Chế độ replay – tạm dừng cập nhật. Để xem diễn biến mới, nhấn</span>
      <button
        type="button"
        onClick={onGoLive}
        className="inline-flex items-center gap-1.5 min-h-[32px] rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-bold text-emerald-300 transition-colors hover:border-emerald-400/70 hover:bg-emerald-500/20"
      >
        <Radio className="w-3.5 h-3.5" /> Xem trực tiếp
      </button>
    </div>
  );
}
