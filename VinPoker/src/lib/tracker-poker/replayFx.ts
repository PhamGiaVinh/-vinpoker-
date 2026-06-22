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
  // Forward-only.
  if (args.prevIndex === null || args.index <= args.prevIndex) return NONE;

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
