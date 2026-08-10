import { describe, expect, it, vi } from "vitest";
import {
  commitHistoricalSettlementBatch,
  previewHistoricalSettlementBatch,
  type HistoricalSettlementBatchCandidate,
  type HistoricalSettlementBatchGateway,
  type HistoricalSettlementPreviewResult,
} from "@/lib/tracker-poker/historicalSettlementBatch";

const candidates: HistoricalSettlementBatchCandidate[] = [
  { handId: "hand-1", handNumber: 1, tableId: "table-a", tableName: "Bàn A" },
  { handId: "hand-2", handNumber: 2, tableId: "table-a", tableName: "Bàn A" },
];

function ready(candidate: HistoricalSettlementBatchCandidate): HistoricalSettlementPreviewResult {
  return {
    kind: "ready",
    candidate,
    preview: {
      handId: candidate.handId,
      sourceRevision: 1,
      sourceChainHash: "a".repeat(64),
      outcomeHash: "b".repeat(64),
      idempotencyKey: `key-${candidate.handId}`,
      settlement: {
        schemaVersion: "settlement-outcome-v1",
        status: "verified",
        players: [],
        pots: [],
        refunds: [],
        handRanks: [],
      },
    },
  };
}

describe("historical settlement batch orchestration", () => {
  it("deduplicates hand IDs and previews sequentially in display order", async () => {
    const order: string[] = [];
    const gateway = {
      preview: vi.fn(async (candidate: HistoricalSettlementBatchCandidate) => {
        order.push(candidate.handId);
        return ready(candidate);
      }),
      commit: vi.fn(),
    } satisfies HistoricalSettlementBatchGateway;

    const results = await previewHistoricalSettlementBatch([...candidates, candidates[0]], gateway);

    expect(order).toEqual(["hand-1", "hand-2"]);
    expect(results.map((result) => result.candidate.handId)).toEqual(["hand-1", "hand-2"]);
    expect(gateway.preview).toHaveBeenCalledTimes(2);
  });

  it("fails one broken preview closed and continues scanning the remaining hands", async () => {
    const progress: number[] = [];
    const gateway = {
      preview: vi.fn(async (candidate: HistoricalSettlementBatchCandidate) => {
        if (candidate.handId === "hand-1") throw new Error("network");
        return ready(candidate);
      }),
      commit: vi.fn(),
    } satisfies HistoricalSettlementBatchGateway;

    const results = await previewHistoricalSettlementBatch(candidates, gateway, (completed) => progress.push(completed));

    expect(results[0]).toMatchObject({ kind: "blocked", code: "preview_request_failed" });
    expect(results[1]).toMatchObject({ kind: "ready" });
    expect(progress).toEqual([1, 2]);
  });

  it("commits only server-ready previews and never retries verified or blocked hands", async () => {
    const previews: HistoricalSettlementPreviewResult[] = [
      ready(candidates[0]),
      { kind: "verified", candidate: candidates[1] },
      { kind: "blocked", candidate: { handId: "hand-3", handNumber: 3, tableId: null }, code: "invalid_historical_hand" },
    ];
    const gateway = {
      preview: vi.fn(),
      commit: vi.fn(async (result) => ({ kind: "verified" as const, candidate: result.candidate })),
    } satisfies HistoricalSettlementBatchGateway;

    const results = await commitHistoricalSettlementBatch(previews, gateway);

    expect(results).toEqual([{ kind: "verified", candidate: candidates[0] }]);
    expect(gateway.commit).toHaveBeenCalledTimes(1);
  });

  it("converts a thrown commit into a blocked result without inventing a winner", async () => {
    const gateway = {
      preview: vi.fn(),
      commit: vi.fn(async () => { throw new Error("stale"); }),
    } satisfies HistoricalSettlementBatchGateway;

    const results = await commitHistoricalSettlementBatch([ready(candidates[0])], gateway);

    expect(results).toEqual([{ kind: "blocked", candidate: candidates[0], code: "commit_request_failed" }]);
  });
});
