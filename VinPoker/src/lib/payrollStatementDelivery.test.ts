import { describe, expect, it } from "vitest";
import { parsePayrollDeliveryOperation, parsePayrollDeliveryRollout } from "@/lib/payrollStatementDelivery";

const operation = {
  operation_id: "11111111-1111-4111-8111-111111111111",
  state: "completed",
  pending_count: 0,
  sending_count: 0,
  sent_count: 2,
  failed_count: 0,
  unknown_count: 0,
  skipped_count: 1,
  telegram_unlinked_count: 1,
  pdf_not_ready_count: 0,
  total_count: 3,
};

describe("payroll statement delivery UI contracts", () => {
  it("parses an enabled rollout only when every gate field is present", () => {
    expect(parsePayrollDeliveryRollout({
      allowed: true,
      master_enabled: true,
      statement_rollout_allowed: true,
      all_clubs_enabled: false,
      allowlisted: true,
      reason: "ENABLED",
    })?.allowed).toBe(true);
    expect(parsePayrollDeliveryRollout({ allowed: true })).toBeNull();
  });

  it("does not treat a partial or malformed operation as successful", () => {
    expect(parsePayrollDeliveryOperation(operation)?.state).toBe("completed");
    expect(parsePayrollDeliveryOperation({ ...operation, sent_count: -1 })).toBeNull();
    expect(parsePayrollDeliveryOperation({ ...operation, state: "success" })).toBeNull();
  });
});
