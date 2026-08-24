import { describe, expect, it, vi } from "vitest";
import { parseSpokenAmount } from "./amount";
import { parseVoiceCommand } from "./parser";
import { resolveVoiceProposal } from "./proposal";
import { MockRealtimeTranscriptionProvider } from "./providers";
import type { VoiceProposalContext } from "./types";

const READY: VoiceProposalContext = {
  handId: "hand-1",
  street: "flop",
  expectedStateVersion: "state-v1",
  actor: {
    playerId: "player-a",
    playerName: "Player A",
    seatNumber: 3,
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
  ])("parses %s", (input, kind) => {
    expect(parseVoiceCommand(input, { amountUnitConfirmed: true })?.kind).toBe(kind);
  });

  it("rejects partial/noise text", () => {
    expect(parseVoiceCommand("dealer talking about dinner")).toBeNull();
  });

  it.each([
    ["phâu", "fold"],
    ["ô in", "all_in"],
    ["rây 120k", "raise_to"],
  ])("recognizes a reviewed Vietnamese dealer pronunciation %s", (input, kind) => {
    expect(parseVoiceCommand(input, { amountUnitConfirmed: true })?.kind).toBe(kind);
  });

  it.each([
    "Sit down, Ray.",
    "sít",
    "bắt tần",
    "sờ mo bờ lai",
    "bích bờ lai",
    "외 9 외 소 9 오인",
  ])("keeps non-action vocabulary and wrong-language output fail-closed: %s", (input) => {
    expect(parseVoiceCommand(input, { amountUnitConfirmed: true })).toBeNull();
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
