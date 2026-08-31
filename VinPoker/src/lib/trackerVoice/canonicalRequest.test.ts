import { describe, expect, it } from "vitest";

import {
  buildVoiceActionCanonicalRequest,
  buildVoiceBoardCanonicalRequest,
  buildVoiceFinishCanonicalRequest,
  buildVoiceHoleCardsCanonicalRequest,
  voiceCanonicalRequestsMatch,
} from "./canonicalRequest";

const input = {
  rawTranscript: "seat three call",
  expectedStateVersion: "a".repeat(64),
  expectedWorkflowState: "flop_action" as const,
  expectedStreet: "flop" as const,
  payload: {
    canonicalAction: "call" as const,
    actorPlayerId: "player-a",
    entryNumber: 2,
    seatNumber: 3,
    street: "flop" as const,
    actionAmount: 1_000,
    actionOrder: 8,
  },
};

describe("VoiceCanonicalRequest", () => {
  it("creates deterministic hashes for the action-only wire payload", async () => {
    const [first, second] = await Promise.all([
      buildVoiceActionCanonicalRequest(input),
      buildVoiceActionCanonicalRequest({ ...input, payload: { ...input.payload } }),
    ]);
    expect(first).toEqual(second);
    expect(first.intentDomain).toBe("action");
    expect(first.envelope.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.envelope.rawTranscriptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(voiceCanonicalRequestsMatch(first, second)).toBe(true);
  });

  it("fails closed when the untrusted client domain, state, or payload changes", async () => {
    const request = await buildVoiceActionCanonicalRequest(input);
    expect(voiceCanonicalRequestsMatch({ ...request, intentDomain: "board" }, request)).toBe(false);
    expect(voiceCanonicalRequestsMatch({
      ...request,
      envelope: { ...request.envelope, expectedStateVersion: "b".repeat(64) },
    }, request)).toBe(false);
    expect(voiceCanonicalRequestsMatch({
      ...request,
      payload: { ...request.payload, actionAmount: 2_000 },
    }, request)).toBe(false);
  });
});

it("creates a deterministic Board request and fails closed on a changed street or card", async () => {
  const request = await buildVoiceBoardCanonicalRequest({
    rawTranscript: "Flop Át cơ, năm bích, hai rô",
    expectedStateVersion: "b".repeat(64),
    expectedWorkflowState: "enter_flop",
    expectedStreet: "flop",
    payload: {
      street: "flop",
      newCards: ["Ah", "5s", "2d"],
      cumulativeCards: ["Ah", "5s", "2d"],
      expectedExistingBoardCount: 0,
    },
  });
  expect(request.intentDomain).toBe("board");
  expect(voiceCanonicalRequestsMatch(request, request)).toBe(true);
  expect(voiceCanonicalRequestsMatch({
    ...request,
    payload: { ...request.payload, cumulativeCards: ["Ah", "5s", "2c"] },
  }, request)).toBe(false);
});

it("creates a deterministic private Hole Cards request and fails closed on identity or cards", async () => {
  const request = await buildVoiceHoleCardsCanonicalRequest({
    rawTranscript: "Seat 8 ace hearts ace spades",
    expectedStateVersion: "c".repeat(64),
    payload: {
      seatNumber: 8,
      expectedPlayerId: "player-eight",
      expectedEntryNumber: 3,
      cards: ["Ah", "As"],
    },
  });
  expect(request).toMatchObject({
    intentDomain: "hole_cards",
    envelope: { expectedWorkflowState: "runout_reveal", expectedStreet: "showdown" },
  });
  expect(voiceCanonicalRequestsMatch(request, request)).toBe(true);
  expect(voiceCanonicalRequestsMatch({
    ...request,
    payload: { ...request.payload, expectedPlayerId: "another-player" },
  }, request)).toBe(false);
  expect(voiceCanonicalRequestsMatch({
    ...request,
    payload: { ...request.payload, cards: ["Kh", "Ks"] },
  }, request)).toBe(false);
});

it("creates a deterministic Finish request and fails closed on settlement tampering", async () => {
  const request = await buildVoiceFinishCanonicalRequest({
    rawTranscript: "kết thúc hand",
    expectedStateVersion: "d".repeat(64),
    payload: {
      settlementOrigin: "engine_showdown",
      settlementDigest: "e".repeat(64),
    },
  });
  expect(request).toMatchObject({
    intentDomain: "finish_hand",
    envelope: { expectedWorkflowState: "submit_ready", expectedStreet: "showdown" },
  });
  expect(voiceCanonicalRequestsMatch(request, request)).toBe(true);
  expect(voiceCanonicalRequestsMatch({
    ...request,
    payload: { ...request.payload, settlementDigest: "f".repeat(64) },
  }, request)).toBe(false);
});
