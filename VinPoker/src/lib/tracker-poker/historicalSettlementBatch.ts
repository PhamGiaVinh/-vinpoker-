import type { HistoricalSettlementDisplayPreview } from "./historicalSettlementDisplay";

export interface HistoricalSettlementBatchCandidate {
  handId: string;
  handNumber: number;
  tableId: string | null;
  tableName?: string | null;
}

export type HistoricalSettlementPreviewResult =
  | { kind: "ready"; candidate: HistoricalSettlementBatchCandidate; preview: HistoricalSettlementDisplayPreview }
  | { kind: "verified"; candidate: HistoricalSettlementBatchCandidate }
  | { kind: "blocked"; candidate: HistoricalSettlementBatchCandidate; code: string };

export type HistoricalSettlementCommitResult =
  | { kind: "verified"; candidate: HistoricalSettlementBatchCandidate }
  | { kind: "blocked"; candidate: HistoricalSettlementBatchCandidate; code: string };

export interface HistoricalSettlementBatchGateway {
  preview(candidate: HistoricalSettlementBatchCandidate): Promise<HistoricalSettlementPreviewResult>;
  commit(result: Extract<HistoricalSettlementPreviewResult, { kind: "ready" }>): Promise<HistoricalSettlementCommitResult>;
}

function uniqueCandidates(candidates: readonly HistoricalSettlementBatchCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.handId || seen.has(candidate.handId)) return false;
    seen.add(candidate.handId);
    return true;
  });
}

export async function previewHistoricalSettlementBatch(
  candidates: readonly HistoricalSettlementBatchCandidate[],
  gateway: HistoricalSettlementBatchGateway,
  onProgress?: (completed: number, total: number, result: HistoricalSettlementPreviewResult) => void,
): Promise<HistoricalSettlementPreviewResult[]> {
  const queue = uniqueCandidates(candidates);
  const results: HistoricalSettlementPreviewResult[] = [];

  for (const candidate of queue) {
    let result: HistoricalSettlementPreviewResult;
    try {
      result = await gateway.preview(candidate);
    } catch {
      result = { kind: "blocked", candidate, code: "preview_request_failed" };
    }
    results.push(result);
    onProgress?.(results.length, queue.length, result);
  }

  return results;
}

export async function commitHistoricalSettlementBatch(
  previews: readonly HistoricalSettlementPreviewResult[],
  gateway: HistoricalSettlementBatchGateway,
  onProgress?: (completed: number, total: number, result: HistoricalSettlementCommitResult) => void,
): Promise<HistoricalSettlementCommitResult[]> {
  const queue = previews.filter(
    (result): result is Extract<HistoricalSettlementPreviewResult, { kind: "ready" }> => result.kind === "ready",
  );
  const results: HistoricalSettlementCommitResult[] = [];

  for (const preview of queue) {
    let result: HistoricalSettlementCommitResult;
    try {
      result = await gateway.commit(preview);
    } catch {
      result = { kind: "blocked", candidate: preview.candidate, code: "commit_request_failed" };
    }
    results.push(result);
    onProgress?.(results.length, queue.length, result);
  }

  return results;
}
