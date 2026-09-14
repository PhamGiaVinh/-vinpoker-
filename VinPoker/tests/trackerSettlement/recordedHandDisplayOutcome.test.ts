import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
  },
}));

import { ensureRecordedHandDisplayOutcome } from "@/lib/tracker-poker/recordedHandDisplayOutcome";

const publicSettlement = {
  schemaVersion: "settlement-outcome-v1",
  status: "verified",
  players: [
    { playerId: "winner", potAward: 200, refund: 0, netDelta: 100 },
    { playerId: "other", potAward: 0, refund: 0, netDelta: -100 },
  ],
  pots: [{
    potId: "main-0",
    kind: "main",
    amount: 200,
    winnerIds: ["winner"],
    allocations: [{ potId: "main-0", winnerId: "winner", amount: 200 }],
  }],
  refunds: [],
  handRanks: [{ playerId: "winner", category: "pair", bestFive: ["AS", "AH", "KC", "QD", "JS"], kickers: ["A", "K", "Q", "J"] }],
};

const preview = {
  ok: true,
  status: "preview",
  hand_id: "hand-1",
  source_revision: 4,
  source_chain_hash: "a".repeat(64),
  outcome_hash: "b".repeat(64),
  public_outcome: {
    ...publicSettlement,
    sourceRevision: 4,
    sourceChainHash: "a".repeat(64),
    settlementRevision: 1,
    outcomeHash: "b".repeat(64),
    ruleVersion: "clockwise-first-eligible-winner-left-of-button/v1",
  },
};

describe("ensureRecordedHandDisplayOutcome", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.invoke.mockReset();
  });

  it("does not create another outcome when the hand is already verified", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: publicSettlement, error: null });

    await expect(ensureRecordedHandDisplayOutcome({ tournamentId: "tour-1", handId: "hand-1" }))
      .resolves.toEqual({ ok: true, status: "already_verified" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("previews, commits and re-reads a display proof after canonical completion", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: publicSettlement, error: null });
    mocks.invoke
      .mockResolvedValueOnce({ data: preview, error: null })
      .mockResolvedValueOnce({ data: { ok: true, status: "verified", hand_id: "hand-1" }, error: null });

    await expect(ensureRecordedHandDisplayOutcome({ tournamentId: "tour-1", handId: "hand-1" }))
      .resolves.toEqual({ ok: true, status: "verified" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "tournament-historical-settlement", {
      body: { mode: "preview", tournament_id: "tour-1", hand_id: "hand-1" },
    });
    expect(mocks.invoke.mock.calls[1][1].body).toMatchObject({
      mode: "commit",
      tournament_id: "tour-1",
      hand_id: "hand-1",
      expected_source_revision: 4,
      expected_source_chain_hash: "a".repeat(64),
      expected_outcome_hash: "b".repeat(64),
    });
  });

  it("accepts a verified readback when the commit response was lost", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: publicSettlement, error: null });
    mocks.invoke
      .mockResolvedValueOnce({ data: preview, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "network" } });

    await expect(ensureRecordedHandDisplayOutcome({ tournamentId: "tour-1", handId: "hand-1" }))
      .resolves.toEqual({ ok: true, status: "already_verified" });
  });

  it("fails closed when the server preview is malformed", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: {}, error: null });
    mocks.invoke.mockResolvedValueOnce({ data: { ...preview, public_outcome: {} }, error: null });

    await expect(ensureRecordedHandDisplayOutcome({ tournamentId: "tour-1", handId: "hand-1" }))
      .resolves.toEqual({ ok: false, code: "invalid_preview" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("never turns a completed hand into a submit failure when verification throws", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("offline"));

    await expect(ensureRecordedHandDisplayOutcome({ tournamentId: "tour-1", handId: "hand-1" }))
      .resolves.toEqual({ ok: false, code: "verification_missing" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
