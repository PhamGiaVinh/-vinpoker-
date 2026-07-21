import type { FillResult } from "../_shared/fillEmptyTables.ts";
import { classifyPostgrestError } from "../_shared/postgrestError.ts";

export interface MassAssignFailureContract {
  httpStatus: number;
  body: Record<string, unknown>;
}

export function queryFailureContract(
  error: unknown,
  stage: string,
): MassAssignFailureContract {
  const { status } = classifyPostgrestError(error);
  return {
    httpStatus: 503,
    body: {
      success: false,
      status,
      error_code: `${stage}_${status}`,
    },
  };
}

export function legacyFillFailureContract(
  result: FillResult,
): MassAssignFailureContract | null {
  if (result.status === "ok") return null;
  const dependencyFailure = result.status === "dependency_unavailable"
    || result.status === "query_failed";
  return {
    httpStatus: dependencyFailure ? 503 : 409,
    body: {
      success: false,
      status: result.status,
      error_code: result.error_code,
      assigned: result.assignments.length,
      assignments: result.assignments.map((assignment) => ({
        table_id: assignment.table_id,
        table_name: assignment.table_name,
        dealer_name: assignment.full_name,
      })),
      diagnostics: result.diagnostics,
    },
  };
}

export function operationFailureContract(code: string): MassAssignFailureContract {
  const blocked = code === "MASS_OPEN_ROLLOUT_DISABLED";
  const dependencyUnavailable = code.startsWith("OPEN_OPERATION_DEPENDENCY_UNAVAILABLE")
    || code === "MASS_OPEN_ROLLOUT_UNAVAILABLE";
  const queryFailed = code.startsWith("OPEN_OPERATION_QUERY_FAILED");
  return {
    httpStatus: blocked ? 423 : dependencyUnavailable || queryFailed ? 503 : 409,
    body: {
      success: false,
      status: dependencyUnavailable
        ? "dependency_unavailable"
        : queryFailed
          ? "query_failed"
          : "failed",
      error_code: code.split(":", 1)[0],
      operation_status: blocked ? "rollout_disabled" : "failed",
    },
  };
}
