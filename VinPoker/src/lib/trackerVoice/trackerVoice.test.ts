import { describe, expect, it, vi } from "vitest";
import { parseSpokenAmount } from "./amount";
import { parseVoiceCommand } from "./parser";
import { resolveVoiceProposal } from "./proposal";
import { resolveVoiceBoardProposal } from "./boardProposal";
import { parseVoiceBoardCommand } from "./boardParser";
import { MockRealtimeTranscriptionProvider } from "./providers";
import type { VoiceProposalContext } from "./types";

const READY: VoiceProposalContext = {
  handId: "hand-1",
  street: "flop",
  workflowState: "flop_action",
  actionOrder: 2,
  expectedStateVersion: "state-v1",
  actor: {
    playerId: "player-a",
    playerName: "Player A",
    seatNumber: 3,
    entryNumber: 1,
    currentStack: 10_000,
    currentBet: 1_000,
  },
  actorView: {
    toCall: 1_000,
    minRaiseTo: 4_000,
    legal: { fold: true, check: false, call: true, bet: false, raise: true, allIn: true },
  },
  handStarted: true,
  actionStepActive: true,
  readOnly: false,
  syncBlocked: false,
  correctionPending: false,
};

describe("parseSpokenAmount", () => {
  it.each([
    ["120k", 120_000],
    ["1.2 million", 1_200_000],
    ["hai tram nghin", 200_000],
    ["one hundred thousand", 100_000],
  ])("parses explicit unit %s", (input, expected) => {
    expect(parseSpokenAmount(input)).toMatchObject({ value: expected, ambiguous: false, explicitUnit: true });
  });

  it("keeps a bare amount ambiguous until the tournament unit is confirmed", () => {
    expect(parseSpokenAmount("raise 120")).toMatchObject({ value: 120, ambiguous: true });
    expect(parseSpokenAmount("raise 120", { spokenAmountUnit: 1_000, amountUnitConfirmed: true })).toMatchObject({
      value: 120_000,
      ambiguous: false,
    });
  });

  it.each([
    ["220.0", 220_000],
  ])("applies a confirmed table unit to Gemini decimal-form output %s", (input, expected) => {
    expect(parseSpokenAmount(input, { spokenAmountUnit: 1_000, amountUnitConfirmed: true })).toMatchObject({
      value: expected,
      ambiguous: false,
      explicitUnit: false,
    });
  });

  it.each([
    ["5.000", 5_000],
    ["11.300", 11_300],
    ["11.322", 11_322],
    ["101699", 101_699],
  ])("keeps explicit formatted chip count %s exact", (input, expected) => {
    expect(parseSpokenAmount(input)).toMatchObject({ value: expected, ambiguous: false, explicitUnit: true });
  });
});

describe("parseVoiceCommand", () => {
  it.each([
    ["fold", "fold"],
    ["bỏ bài", "fold"],
    ["check", "check"],
    ["theo", "call"],
    ["raise 120 nghìn", "raise_to"],
    ["cược đến 2 triệu", "bet_to"],
    ["tất tay", "all_in"],
    ["báo sai action", "report_wrong_action"],
    ["gọi floor", "call_floor"],
    ["seat number three fold", "fold"],
    ["seat five all in", "all_in"],
    ["ghế số ba raise 20.000", "raise_to"],
  ])("parses %s", (input, kind) => {
    expect(parseVoiceCommand(input, { amountUnitConfirmed: true })?.kind).toBe(kind);
  });

  it.each([
    ["seat number six raise 20,000", 20_000, 6],
    ["ghế số 7 raise 50.000", 50_000, 7],
  ])("parses exact seated amount commands in %s", (input, amount, seat) => {
    expect(parseVoiceCommand(input)).toMatchObject({
      kind: "raise_to",
      spokenSeatNumber: seat,
      amount: { value: amount, ambiguous: false },
    });
  });

  it("keeps incomplete or unsafe UAT fragments fail-closed", () => {
    expect(parseVoiceCommand("Sit number five.")).toBeNull();
    expect(parseVoiceCommand("Seat number three four")).toBeNull();
    expect(parseVoiceCommand("seat number one race 4000")).toBeNull();
    expect(parseVoiceCommand("see number three phâu")).toBeNull();
    expect(parseVoiceCommand("fit 9 all in now")).toBeNull();
    expect(parseVoiceCommand("racer một phau", { spokenAmountUnit: 1_000, amountUnitConfirmed: true })).toBeNull();
    expect(parseVoiceCommand("90.000")).toBeNull();
  });

  it.each([
    "fit 9 all in",
    "feet 9 all in",
    "FIT 9, ALL-IN!",
    "Feet 9: all in.",
  ])("rejects repaired all-in commands before proposal creation: %s", (transcript) => {
    expect(parseVoiceCommand(transcript)).toBeNull();
    expect(resolveVoiceProposal(parseVoiceCommand(transcript), READY)).toMatchObject({
      ok: false,
      code: "command_not_supported",
    });
  });

  it("keeps exact all-in valid and rejects multi-action or partial input", () => {
    expect(parseVoiceCommand("seat 9 all in")).toMatchObject({
      kind: "all_in",
      spokenSeatNumber: 9,
      riskTier: "EXACT",
      repairs: [],
    });
    for (const transcript of ["fold call", "", "all", "seat 9 all"]) {
      expect(parseVoiceCommand(transcript)).toBeNull();
    }
  });

  it("does not let a spoken call amount override the engine-derived call amount", () => {
    expect(parseVoiceCommand("seat four call 30k")).toBeNull();
    expect(parseVoiceCommand("seat four call 11.300")).toBeNull();
  });

  it("rejects partial/noise text", () => {
    expect(parseVoiceCommand("dealer talking about dinner")).toBeNull();
  });

  it("allows exactly one seat-prefix repair and requires explicit confirmation", () => {
    expect(parseVoiceCommand("fit 3 call")).toMatchObject({
      kind: "call",
      spokenSeatNumber: 3,
      riskTier: "BOUNDED_REPAIR",
      requiresConfirmation: true,
      repairs: [{ rule: "seat_prefix_fit_to_seat", from: "fit", to: "seat" }],
    });
    expect(resolveVoiceProposal(parseVoiceCommand("feet 3 call"), READY)).toMatchObject({
      ok: true,
      command: { requiresConfirmation: true },
    });
  });
});

describe("resolveVoiceProposal", () => {
  it("maps a verified raise-to command to the current actor", () => {
    const command = parseVoiceCommand("raise 6k");
    expect(resolveVoiceProposal(command, READY)).toMatchObject({
      ok: true,
      canonicalAction: "raise",
      betToTotal: 6_000,
      actor: { playerId: "player-a", seatNumber: 3 },
      expectedStateVersion: "state-v1",
    });
  });

  it("fails closed for ambiguous amount, stale sync, correction, and illegal action", () => {
    expect(resolveVoiceProposal(parseVoiceCommand("raise 120"), READY)).toMatchObject({ ok: false, code: "amount_ambiguous" });
    expect(resolveVoiceProposal(parseVoiceCommand("call"), { ...READY, syncBlocked: true })).toMatchObject({ ok: false, code: "sync_blocked" });
    expect(resolveVoiceProposal(parseVoiceCommand("call"), { ...READY, correctionPending: true })).toMatchObject({ ok: false, code: "correction_pending" });
    expect(resolveVoiceProposal(parseVoiceCommand("check"), READY)).toMatchObject({ ok: false, code: "illegal_action" });
  });

  it("preserves the existing bet amount-unit contract", () => {
    expect(parseVoiceCommand("bet 9", { spokenAmountUnit: 1_000, amountUnitConfirmed: true })).toMatchObject({
      kind: "bet_to",
      amount: { value: 9_000, ambiguous: false },
    });
    expect(parseVoiceCommand("bet 9")).toMatchObject({
      kind: "bet_to",
      amount: { value: 9, ambiguous: true },
    });
    expect(resolveVoiceProposal(parseVoiceCommand("bet 9"), {
      ...READY,
      actorView: {
        ...READY.actorView!,
        legal: { ...READY.actorView!.legal, bet: true },
      },
    })).toMatchObject({ ok: false, code: "amount_ambiguous" });
  });

  it("binds a spoken seat to the current actor instead of silently using another player", () => {
    expect(resolveVoiceProposal(parseVoiceCommand("seat three call"), READY)).toMatchObject({ ok: true, canonicalAction: "call" });
    expect(resolveVoiceProposal(parseVoiceCommand("seat five call"), READY)).toMatchObject({
      ok: false,
      code: "spoken_actor_mismatch",
    });
  });

  it("allows a short all-in raise but rejects an undersized non-all-in raise", () => {
    expect(resolveVoiceProposal(parseVoiceCommand("raise 11k"), READY)).toMatchObject({ ok: true, betToTotal: 11_000 });
    expect(resolveVoiceProposal(parseVoiceCommand("raise 3k"), READY)).toMatchObject({ ok: false, code: "raise_too_small" });
  });

  it("creates control proposals without inventing a poker actor", () => {
    expect(resolveVoiceProposal(parseVoiceCommand("gọi Floor"), { ...READY, actor: null, actorView: null })).toMatchObject({
      ok: true,
      controlAction: "call_floor",
    });
  });
});

describe("resolveVoiceBoardProposal", () => {
  it("keeps the proposed flop separate from persisted Board state", () => {
    const command = parseVoiceBoardCommand("flop ace hearts five spades two diamonds");
    expect(command).not.toBeNull();
    expect(resolveVoiceBoardProposal(command!, {
      ...READY,
      street: "preflop",
      workflowState: "enter_flop",
      actionStepActive: false,
      persistedBoardCards: [],
    })).toMatchObject({
      ok: true,
      expectedExistingBoardCount: 0,
      cumulativeCards: ["Ah", "5s", "2d"],
    });
  });

  it("refuses a stale Board prefix instead of offering an overwrite", () => {
    const command = parseVoiceBoardCommand("turn queen clubs");
    expect(resolveVoiceBoardProposal(command!, {
      ...READY,
      street: "flop",
      workflowState: "enter_turn",
      actionStepActive: false,
      persistedBoardCards: ["Ah", "5s"],
    })).toMatchObject({ ok: false, code: "board_already_persisted" });
  });
});

describe("MockRealtimeTranscriptionProvider", () => {
  it("emits partial and final events without creating confidence", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const onTranscript = vi.fn();
    await provider.connect({ onStatus: vi.fn(), onTranscript });
    provider.emit("raise", { final: false, id: "partial-1" });
    provider.emit("raise 120k", { final: true, id: "final-1" });
    expect(onTranscript).toHaveBeenNthCalledWith(1, expect.objectContaining({ isFinal: false }));
    expect(onTranscript.mock.calls[0][0]).not.toHaveProperty("providerConfidence");
    expect(onTranscript).toHaveBeenNthCalledWith(2, expect.objectContaining({ isFinal: true, transcript: "raise 120k" }));
  });
});
