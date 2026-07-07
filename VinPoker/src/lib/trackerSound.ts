// C4 (trackerActionSounds) — operator-side sound helper for the tracker console.
//
// The /live viewer already gates its own playPokerLiveSound calls on a view-local
// mute (localStorage `tracker_sound_muted`, TournamentLiveView). The operator
// console wires its sounds through THIS module so (a) everything is behind the
// trackerActionSounds flag (flag OFF → these are no-ops, operator stays silent as
// today), (b) mute is read live from the SAME localStorage key — the console
// header toggle takes effect immediately without re-rendering the hook, and the
// mute is shared with a viewer tab in the same browser.
import { FEATURES } from "@/lib/featureFlags";
import {
  markPokerSoundGesture,
  playPokerLiveSound,
  type PokerLiveSound,
} from "@/lib/pokerLiveSound";

/** Same key the /live viewer's mute toggle persists to (view-local, per browser). */
export const TRACKER_SOUND_MUTE_KEY = "tracker_sound_muted";

export function isTrackerSoundMuted(): boolean {
  try {
    // Same "1" = muted convention the viewer's toggle writes (TournamentLiveView).
    return typeof localStorage !== "undefined" && localStorage.getItem(TRACKER_SOUND_MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTrackerSoundMuted(v: boolean): void {
  try {
    localStorage.setItem(TRACKER_SOUND_MUTE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** action_type strings that map 1:1 onto a PokerLiveSound kind. */
export const ACTION_SOUND_KINDS: ReadonlySet<string> = new Set([
  "fold", "check", "call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante",
]);

/**
 * Owner P0 dedupe — one play per (handId, street, kind) tuple. Pure so tests can
 * pin it: returns true (and records the tuple) only the first time it is asked.
 * Re-renders, polling echoes, or replayed state re-asking the same tuple get false.
 */
export function shouldPlayOnce(
  seen: Set<string>,
  handId: string | null,
  street: string,
  kind: string,
): boolean {
  const key = `${handId ?? "-"}:${street}:${kind}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

/**
 * Play a tracker sound (operator console). No-op unless FEATURES.trackerActionSounds
 * is on and the shared mute is off. Every operator sound is the direct consequence
 * of an operator press, so marking the audio gesture here is always truthful.
 */
export function playTrackerSound(kind: PokerLiveSound): void {
  if (!FEATURES.trackerActionSounds) return;
  if (isTrackerSoundMuted()) return;
  markPokerSoundGesture();
  playPokerLiveSound(kind);
}

/** playTrackerSound with the (handId, street, kind) dedupe applied. */
export function playTrackerSoundOnce(
  seen: Set<string>,
  handId: string | null,
  street: string,
  kind: PokerLiveSound,
): void {
  if (!FEATURES.trackerActionSounds) return;
  if (!shouldPlayOnce(seen, handId, street, kind)) return;
  playTrackerSound(kind);
}
