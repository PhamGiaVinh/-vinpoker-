// Pure decision for the liveTableFx replay-playback FX. Given a transition from
// one replay frame to the next, decide which sounds + chip FX to fire. Kept pure
// (no React, no audio) so the forward-only rule and the street→deal mapping are
// unit-testable without rendering the heavy TournamentLiveView.
//
// Forward-only: a non-increasing frame index (first entry / backward scrub / a jump
// to an earlier or the same frame) fires nothing, so scrubbing a hand back and forth
// never machine-guns sounds — only PLAYING it forward does.

import type { PokerLiveSound } from "@/lib/pokerLiveSound";

// Mirrors the live action effect: which action types make a sound, and which push
// chips into the pot (chip clink + chip-push). fold/check are sounds but not chips.
const SOUND_ACTIONS = new Set<string>([
  "fold", "check", "call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante",
]);
const CHIP_ACTIONS = new Set<string>([
  "call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante",
]);

export interface ReplayPlaybackFx {
  /** Street deal swoosh, when the visible board grew on this step. */
  deal: PokerLiveSound | null;
  /** The action's own sound (fold becomes the card-muck swoosh). */
  action: PokerLiveSound | null;
  /** Layer a chip clink over the action (bet/call/raise/all-in/posts). */
  chipClink: boolean;
  /** Fire the visual chip-push (chip action with a real seat). */
  chipPush: boolean;
}

const NONE: ReplayPlaybackFx = { deal: null, action: null, chipClink: false, chipPush: false };

export function deriveReplayPlaybackFx(args: {
  prevIndex: number | null;
  prevBoard: number;
  index: number;
  board: number;
  actionType: string | null;
  seatNumber: number;
}): ReplayPlaybackFx {
  // Forward-only, single-step-only: a jump of more than one frame (slider scrub,
  // street tab, jump-to-end) is navigation, not playback — it fires nothing, so
  // jumping to the showdown never machine-guns sounds.
  if (args.prevIndex === null || args.index <= args.prevIndex) return NONE;
  if (args.index - args.prevIndex > 1) return NONE;

  const deal: PokerLiveSound | null =
    args.board > args.prevBoard
      ? args.board >= 5
        ? "deal_river"
        : args.board === 4
          ? "deal_turn"
          : "deal_flop"
      : null;

  const at = args.actionType;
  if (!at || !SOUND_ACTIONS.has(at)) return { deal, action: null, chipClink: false, chipPush: false };
  if (at === "fold") return { deal, action: "fold_muck", chipClink: false, chipPush: false };

  const isChip = CHIP_ACTIONS.has(at);
  return {
    deal,
    action: at as PokerLiveSound,
    chipClink: isChip,
    chipPush: isChip && args.seatNumber > 0,
  };
}

/**
 * Board and action data share one replay frame, but their sounds should not play
 * on top of each other. Keep this timing decision pure so playback can cancel a
 * pending action when the user scrubs or switches hands.
 */
export function replayActionSoundDelayMs(
  deal: PokerLiveSound | null,
  speed = 1,
): number {
  const baseDelay = deal === "deal_flop" ? 520 : deal === "deal_turn" || deal === "deal_river" ? 500 : 0;
  const normalizedSpeed = Number.isFinite(speed) ? Math.min(8, Math.max(0.5, speed)) : 1;
  return Math.round(baseDelay / normalizedSpeed);
}

export type ReplayActionFxScheduler = {
  schedule: (key: string, delayMs: number, callback: () => void) => void;
  cancel: () => void;
};

/**
 * Keeps one pending action effect per replay frame. A new frame, scrub, or hand
 * switch invalidates the previous callback; unrelated rerenders do not.
 */
export function createReplayActionFxScheduler(): ReplayActionFxScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeKey: string | null = null;

  const cancel = () => {
    activeKey = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    cancel,
    schedule(key, delayMs, callback) {
      cancel();
      activeKey = key;
      if (delayMs <= 0) {
        callback();
        activeKey = null;
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        if (activeKey !== key) return;
        activeKey = null;
        callback();
      }, delayMs);
    },
  };
}
