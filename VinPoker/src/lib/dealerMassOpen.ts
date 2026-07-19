export type MassOpenGate = "checking" | "legacy" | "enabled" | "disabled";

export type OpenOperationProgress = {
  operationId: string;
  requested: number;
  assigned: number;
  remaining: number;
  status: string;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? value as UnknownRecord : null;
}

export function errorMessage(error: unknown): string {
  const record = asRecord(error);
  return typeof record?.message === "string" ? record.message : "";
}

export function edgeErrorStatus(error: unknown): number | null {
  const context = asRecord(asRecord(error)?.context);
  return typeof context?.status === "number" ? context.status : null;
}

export function resolveMassOpenGate(data: unknown, error: unknown): MassOpenGate {
  if (error) {
    const record = asRecord(error);
    const message = errorMessage(error);
    const missingRpc = record?.code === "PGRST202"
      || message.includes("get_dealer_mass_open_rollout") && message.includes("schema cache");
    return missingRpc ? "legacy" : "disabled";
  }
  return asRecord(data)?.allowed === true ? "enabled" : "disabled";
}

export function readOpenOperationProgress(
  data: unknown,
  operationId: string,
  fallback: Pick<OpenOperationProgress, "requested" | "assigned" | "remaining" | "status">,
): OpenOperationProgress {
  const record = asRecord(data) ?? {};
  return {
    operationId,
    requested: Number(record.requested ?? fallback.requested),
    assigned: Number(record.assigned ?? fallback.assigned),
    remaining: Number(record.remaining ?? fallback.remaining),
    status: String(record.operation_status ?? record.outcome ?? fallback.status),
  };
}

export function operationOutcome(data: unknown): { outcome: string; reason: string } {
  const record = asRecord(data) ?? {};
  return {
    outcome: String(record.outcome ?? ""),
    reason: String(record.reason ?? ""),
  };
}

export function assignedThisRun(data: unknown): number {
  return Number(asRecord(data)?.assigned_this_run ?? 0);
}

export function isCurrentMassOpenRequest(request: number, current: number): boolean {
  return request === current;
}

export function shouldContinueOpenOperation(
  current: OpenOperationProgress,
  next: OpenOperationProgress,
  newlyAssigned: number,
): boolean {
  return next.status === "waiting_for_dealer"
    && next.remaining > 0
    && newlyAssigned > 0
    && next.remaining < current.remaining;
}
