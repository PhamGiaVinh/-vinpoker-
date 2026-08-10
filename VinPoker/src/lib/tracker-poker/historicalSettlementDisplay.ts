import {
  parseReplayPublicSettlement,
  type ReplayPublicSettlement,
} from "./replaySettlement";

type JsonRecord = Record<string, unknown>;

export interface HistoricalSettlementDisplayPreview {
  handId: string;
  sourceRevision: number;
  sourceChainHash: string;
  outcomeHash: string;
  idempotencyKey: string;
  settlement: ReplayPublicSettlement;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * The Edge preview is an authenticated owner response. Its hashes are needed
 * for the later CAS write, but are never passed into the public replay parser.
 */
export function parseHistoricalSettlementDisplayPreview(
  value: unknown,
  idempotencyKey: string,
): HistoricalSettlementDisplayPreview | null {
  if (!isRecord(value)
    || value.ok !== true
    || value.status !== "preview"
    || typeof value.hand_id !== "string"
    || !Number.isSafeInteger(value.source_revision)
    || !hash(value.source_chain_hash)
    || !hash(value.outcome_hash)
    || typeof idempotencyKey !== "string"
    || idempotencyKey.trim().length < 12
    || !isRecord(value.public_outcome)) {
    return null;
  }

  const {
    sourceRevision: _sourceRevision,
    sourceChainHash: _sourceChainHash,
    settlementRevision: _settlementRevision,
    outcomeHash: _outcomeHash,
    ruleVersion: _ruleVersion,
    ...publicReplayPayload
  } = value.public_outcome;
  const settlement = parseReplayPublicSettlement(publicReplayPayload);
  if (!settlement) return null;

  return {
    handId: value.hand_id,
    sourceRevision: value.source_revision,
    sourceChainHash: value.source_chain_hash,
    outcomeHash: value.outcome_hash,
    idempotencyKey,
    settlement,
  };
}
