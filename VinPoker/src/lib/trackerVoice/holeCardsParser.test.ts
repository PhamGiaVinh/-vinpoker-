import { describe, expect, it } from "vitest";

import { routeTrackerVoiceIntent } from "./intentRouter";
import { looksLikePrivateHoleCardsTranscript, parseVoiceHoleCardsCommand } from "./holeCardsParser";
import { resolveVoiceHoleCardsProposal } from "./holeCardsProposal";
import type { VoiceHoleCardsProposalContext } from "./types";

const RUNOUT: VoiceHoleCardsProposalContext = {
  handId: "hand-1",
  workflowState: "runout_reveal",
  expectedStateVersion: "state-v1",
  handStarted: true,
  readOnly: false,
  syncBlocked: false,
  correctionPending: false,
  players: [
    { playerId: "player-8", playerName: "Player 8", seatNumber: 8, entryNumber: 2 },
    { playerId: "player-9", playerName: "Player 9", seatNumber: 9, entryNumber: 1 },
  ],
  localCardsByPlayerId: {},
};

describe("Voice Hole Cards grammar", () => {
  it.each([
    ["Seat 8 Át cơ, Át bích", 8, ["Ah", "As"]],
    ["Seat eight ace hearts ace spades", 8, ["Ah", "As"]],
    ["Ghế 8 Át cơ Át bích", 8, ["Ah", "As"]],
    ["Ghế tám vua rô vua bích", 8, ["Kd", "Ks"]],
    ["Ghế 5 đầm cơ bồi tép", 5, ["Qh", "Jc"]],
    ["Ghế tám mười rô chín rô", 8, ["Td", "9d"]],
    ["Seat three king diamonds king spades", 3, ["Kd", "Ks"]],
    ["Seat nine ten diamonds nine diamonds", 9, ["Td", "9d"]],
  ])("accepts one exact private card sentence: %s", (raw, seatNumber, cards) => {
    expect(parseVoiceHoleCardsCommand(raw)).toMatchObject({ seatNumber, cards });
  });

  it.each([
    "Seat 8 Át cơ",
    "Seat 8 Át cơ Át bích K rô",
    "Seat 8 Át cơ Át cơ",
    "Fit 8 Át cơ Át bích",
    "Feet eight ace hearts ace spades",
    "Seat 8 maybe Át cơ Át bích",
    "Seat 8 Át cơ Át bích all in",
    "Flop Át cơ năm bích hai rô",
    "Turn K cơ",
    "River mười tép",
    "Seat 8 all in",
    "Kết thúc hand",
    "Call điện thoại",
  ])("rejects partial, fuzzy, cross-domain, and decorated input: %s", (raw) => {
    expect(parseVoiceHoleCardsCommand(raw)).toBeNull();
  });

  it("routes only its own exact grammar in runout and defers showdown for muck authority", () => {
    expect(routeTrackerVoiceIntent("Seat 8 ace hearts ace spades", "runout_reveal")).toMatchObject({
      ok: true,
      intentDomain: "hole_cards",
    });
    expect(routeTrackerVoiceIntent("Seat 8 ace hearts ace spades", "showdown_input")).toEqual({
      ok: false,
      code: "showdown_hole_cards_deferred_muck_authority",
    });
    expect(routeTrackerVoiceIntent("fold", "runout_reveal")).toEqual({ ok: false, code: "wrong_workflow" });
    expect(routeTrackerVoiceIntent("flop ace hearts five spades two diamonds", "runout_reveal")).toEqual({ ok: false, code: "wrong_workflow" });
  });

  it("keeps local drafts private and refuses any collision or replacement", () => {
    const command = parseVoiceHoleCardsCommand("Seat 8 ace hearts ace spades");
    expect(command).not.toBeNull();
    expect(resolveVoiceHoleCardsProposal(command!, RUNOUT)).toMatchObject({ ok: true, player: { playerId: "player-8" } });
    expect(resolveVoiceHoleCardsProposal(command!, {
      ...RUNOUT,
      localCardsByPlayerId: { "player-8": ["Kh", "Ks"] },
    })).toMatchObject({ ok: false, code: "hole_cards_local_draft_exists" });
    expect(resolveVoiceHoleCardsProposal(command!, {
      ...RUNOUT,
      localCardsByPlayerId: { "player-9": ["Ah", "Kd"] },
    })).toMatchObject({ ok: false, code: "duplicate_card" });
  });

  it("uses the broader privacy guard only at the diagnostic boundary", () => {
    expect(looksLikePrivateHoleCardsTranscript("Fit 8 Át cơ Át bích")).toBe(true);
    expect(looksLikePrivateHoleCardsTranscript("Seat 8 ace hearts ace spades all in")).toBe(true);
    expect(looksLikePrivateHoleCardsTranscript("seat 8 call")).toBe(false);
  });
});
