// pokerLiveSound is the tracker viewer's procedural sound engine. liveTableFx adds
// synth-only kinds (deal_flop/turn/river riffle, fold muck, chip clink). These pin
// the safety contract the FX relies on: every kind — old and new — is a TOTAL,
// silent no-op until a user gesture unlocks audio, and stays a no-op when muted.
// (jsdom has no AudioContext, so this also proves the synth path fails closed.)
import { describe, it, expect, afterEach } from "vitest";
import {
  playPokerLiveSound,
  setPokerSoundMuted,
  isPokerSoundMuted,
  type PokerLiveSound,
} from "@/lib/pokerLiveSound";

const ALL: PokerLiveSound[] = [
  "deal", "fold", "check", "call", "bet", "raise", "all_in",
  "post_sb", "post_bb", "post_ante",
  "deal_flop", "deal_turn", "deal_river", "fold_muck", "chip",
];

afterEach(() => setPokerSoundMuted(false));

describe("pokerLiveSound — FX safety contract", () => {
  it("every kind is a no-throw no-op with no user gesture (audio still locked)", () => {
    // No pointerdown/keydown has fired in this jsdom run → userGestureSeen is false.
    for (const k of ALL) expect(() => playPokerLiveSound(k)).not.toThrow();
  });

  it("stays silent (and no-throw) for the enriched kinds when muted", () => {
    setPokerSoundMuted(true);
    expect(isPokerSoundMuted()).toBe(true);
    for (const k of ["deal_flop", "deal_turn", "deal_river", "fold_muck", "chip"] as PokerLiveSound[]) {
      expect(() => playPokerLiveSound(k)).not.toThrow();
    }
  });
});
