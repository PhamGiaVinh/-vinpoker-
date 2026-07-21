import { assertEquals } from "jsr:@std/assert@1";
import {
  legacyFillFailureContract,
  operationFailureContract,
  queryFailureContract,
} from "./failureContract.ts";

Deno.test("legacy mass-assign returns non-2xx for dependency drift", () => {
  const failure = legacyFillFailureContract({
    status: "dependency_unavailable",
    error_code: "active_tables_dependency_unavailable",
    assignments: [],
    assignedAttendanceIds: new Set(),
    diagnostics: [{ stage: "active_tables", code: "active_tables_dependency_unavailable" }],
  });
  assertEquals(failure?.httpStatus, 503);
  assertEquals(failure?.body.success, false);
  assertEquals(failure?.body.status, "dependency_unavailable");
});

Deno.test("legacy mass-assign never reports degraded partial work as success", () => {
  const failure = legacyFillFailureContract({
    status: "degraded",
    error_code: "fill_budget_exceeded",
    assignments: [{
      table_id: "table-1",
      table_name: "Table 1",
      attendance_id: "attendance-1",
      full_name: "Dealer 1",
    }],
    assignedAttendanceIds: new Set(["attendance-1"]),
    diagnostics: [{ stage: "budget", code: "fill_budget_exceeded" }],
  });
  assertEquals(failure?.httpStatus, 409);
  assertEquals(failure?.body.success, false);
  assertEquals(failure?.body.assigned, 1);
});

Deno.test("operation dependency and dark-rollout failures have stable status codes", () => {
  assertEquals(
    operationFailureContract("OPEN_OPERATION_DEPENDENCY_UNAVAILABLE:targets").httpStatus,
    503,
  );
  assertEquals(
    operationFailureContract("MASS_OPEN_ROLLOUT_DISABLED").httpStatus,
    423,
  );
  assertEquals(operationFailureContract("OPEN_OPERATION_QUERY_FAILED:targets"), {
    httpStatus: 503,
    body: {
      success: false,
      status: "query_failed",
      error_code: "OPEN_OPERATION_QUERY_FAILED",
      operation_status: "failed",
    },
  });
});

Deno.test("query failures distinguish schema drift from transient failures", () => {
  assertEquals(queryFailureContract(
    { code: "42P01", message: "missing relation" },
    "swing_config",
  ).body, {
    success: false,
    status: "dependency_unavailable",
    error_code: "swing_config_dependency_unavailable",
  });
  assertEquals(queryFailureContract(
    { code: "XX000", message: "connection reset" },
    "swing_config",
  ).body, {
    success: false,
    status: "query_failed",
    error_code: "swing_config_query_failed",
  });
});
