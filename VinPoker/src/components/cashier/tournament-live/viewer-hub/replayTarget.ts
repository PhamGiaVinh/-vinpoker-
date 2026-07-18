export interface ReplayTarget {
  /** Stable hand identity. When supplied it is the only replay authority. */
  handId: string | null;
  /** Optional URL context. The loaded hand must match it when both are supplied. */
  tableId: string | null;
  /** Legacy `?hand=N` input, valid only when it resolves to exactly one hand. */
  handNumber: number | null;
}

export type ReplayTargetState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "resolved"; handId: string; tableId: string | null; handNumber: number }
  | { kind: "not_found" }
  | { kind: "ambiguous" }
  | { kind: "mismatch" }
  | { kind: "query_error" };

export interface ReplayCandidate {
  id: string;
  table_id: string | null;
  hand_number: number;
  status?: string | null;
  is_voided?: boolean | null;
}

function positiveHandNumber(value: string | null): number | null {
  if (!value) return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function parseReplayTarget(params: URLSearchParams): ReplayTarget | null {
  const handId = params.get("handId")?.trim() || null;
  const tableId = params.get("tableId")?.trim() || null;
  const handNumber = positiveHandNumber(params.get("hand"));

  if (handId) return { handId, tableId, handNumber: null };
  if (handNumber != null) return { handId: null, tableId, handNumber };
  return null;
}

export function toCanonicalReplayTarget(target: ReplayTarget): URLSearchParams {
  const params = new URLSearchParams();
  if (target.handId) params.set("handId", target.handId);
  if (target.tableId) params.set("tableId", target.tableId);
  return params;
}

export function replayTargetLabel(target: ReplayTarget): string {
  return target.handNumber != null ? `Hand #${target.handNumber}` : "Hand";
}

/** Pure final gate for UUID and legacy replay resolution. Queries still enforce
 * tournament/RLS scope; this function prevents a caller from guessing a hand. */
export function resolveReplayCandidates(target: ReplayTarget, candidates: ReplayCandidate[]): ReplayTargetState {
  const complete = candidates.filter((candidate) => !candidate.is_voided && candidate.status !== "in_progress");
  if (target.handId) {
    const hand = complete.find((candidate) => candidate.id === target.handId);
    if (!hand) return { kind: "not_found" };
    if (target.tableId && hand.table_id !== target.tableId) return { kind: "mismatch" };
    return { kind: "resolved", handId: hand.id, tableId: hand.table_id, handNumber: hand.hand_number };
  }

  const legacy = complete.filter((candidate) =>
    candidate.hand_number === target.handNumber && (!target.tableId || candidate.table_id === target.tableId),
  );
  if (legacy.length === 0) return { kind: "not_found" };
  if (legacy.length !== 1) return { kind: "ambiguous" };
  const hand = legacy[0];
  return { kind: "resolved", handId: hand.id, tableId: hand.table_id, handNumber: hand.hand_number };
}
