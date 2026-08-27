export type PayrollDeliveryRollout = {
  allowed: boolean;
  master_enabled: boolean;
  statement_rollout_allowed: boolean;
  all_clubs_enabled: boolean;
  allowlisted: boolean;
  reason: "STATEMENT_ROLLOUT_DISABLED" | "MASTER_OFF" | "CLUB_NOT_ALLOWLISTED" | "ENABLED" | "ROLLOUT_UNAVAILABLE";
};

export type PayrollDeliveryOperation = {
  operation_id: string;
  state: "ready" | "dispatching" | "completed" | "partial" | "blocked";
  pending_count: number;
  sending_count: number;
  sent_count: number;
  failed_count: number;
  unknown_count: number;
  skipped_count: number;
  telegram_unlinked_count: number;
  pdf_not_ready_count: number;
  total_count: number;
  idempotent?: boolean;
  resumed?: boolean;
};

const REASONS = ["STATEMENT_ROLLOUT_DISABLED", "MASTER_OFF", "CLUB_NOT_ALLOWLISTED", "ENABLED", "ROLLOUT_UNAVAILABLE"] as const;
const STATES = ["ready", "dispatching", "completed", "partial", "blocked"] as const;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function parsePayrollDeliveryRollout(value: unknown): PayrollDeliveryRollout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.allowed !== "boolean" || typeof row.master_enabled !== "boolean" ||
    typeof row.statement_rollout_allowed !== "boolean" || typeof row.all_clubs_enabled !== "boolean" ||
    typeof row.allowlisted !== "boolean" || !REASONS.includes(row.reason as (typeof REASONS)[number])
  ) return null;
  return row as PayrollDeliveryRollout;
}

export function parsePayrollDeliveryOperation(value: unknown): PayrollDeliveryOperation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const counts = [
    row.pending_count, row.sending_count, row.sent_count, row.failed_count,
    row.unknown_count, row.skipped_count, row.telegram_unlinked_count,
    row.pdf_not_ready_count, row.total_count,
  ];
  if (typeof row.operation_id !== "string" || !STATES.includes(row.state as (typeof STATES)[number]) || !counts.every(isCount)) return null;
  if (
    (row.idempotent !== undefined && typeof row.idempotent !== "boolean") ||
    (row.resumed !== undefined && typeof row.resumed !== "boolean")
  ) return null;
  return row as PayrollDeliveryOperation;
}
