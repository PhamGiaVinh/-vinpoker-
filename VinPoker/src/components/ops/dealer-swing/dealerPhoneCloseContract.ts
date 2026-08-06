export const DEALER_PHONE_CLOSE_RPC = "close_dealer_tables_phone_v1" as const;

export interface DealerPhoneCloseSnapshot {
  state_hash: string;
  tables: Array<{
    table_id: string;
    table_name: string;
    state_hash: string;
  }>;
}

export interface DealerPhoneCloseArgs {
  p_request_id: string;
  p_expected_club_id: string;
  p_shift_id: string | null;
  p_table_ids: string[];
  p_expected_state: DealerPhoneCloseSnapshot | null;
  p_dry_run: boolean;
}

export type DealerPhoneCloseOutcome =
  | "dry_run"
  | "completed"
  | "conflict"
  | "rollout_disabled"
  | "invalid_request"
  | "idempotency_conflict"
  | "batch_too_large";

export interface DealerPhoneCloseResponse {
  outcome: DealerPhoneCloseOutcome;
  operation_id?: string;
  state_hash?: string;
  tables?: DealerPhoneCloseSnapshot["tables"];
  tables_closed?: number;
  dealers_released?: number;
  results?: Array<{ table_id: string; code: string }>;
  reason?: string;
}

const OUTCOMES: ReadonlySet<DealerPhoneCloseOutcome> = new Set([
  "dry_run",
  "completed",
  "conflict",
  "rollout_disabled",
  "invalid_request",
  "idempotency_conflict",
  "batch_too_large",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalCount(value: unknown): value is number | undefined {
  return value === undefined || (Number.isInteger(value) && value >= 0);
}

function isTableSnapshot(value: unknown): value is DealerPhoneCloseSnapshot["tables"][number] {
  return isRecord(value)
    && typeof value.table_id === "string"
    && typeof value.table_name === "string"
    && typeof value.state_hash === "string";
}

function isResult(value: unknown): value is NonNullable<DealerPhoneCloseResponse["results"]>[number] {
  return isRecord(value) && typeof value.table_id === "string" && typeof value.code === "string";
}

export function parseDealerPhoneCloseResponse(value: unknown): DealerPhoneCloseResponse | null {
  if (!isRecord(value) || typeof value.outcome !== "string" || !OUTCOMES.has(value.outcome as DealerPhoneCloseOutcome)) {
    return null;
  }

  if (!isOptionalString(value.operation_id)
    || !isOptionalString(value.state_hash)
    || !isOptionalString(value.reason)
    || !isOptionalCount(value.tables_closed)
    || !isOptionalCount(value.dealers_released)) {
    return null;
  }

  if (value.tables !== undefined && (!Array.isArray(value.tables) || !value.tables.every(isTableSnapshot))) {
    return null;
  }

  if (value.results !== undefined && (!Array.isArray(value.results) || !value.results.every(isResult))) {
    return null;
  }

  return value as DealerPhoneCloseResponse;
}
