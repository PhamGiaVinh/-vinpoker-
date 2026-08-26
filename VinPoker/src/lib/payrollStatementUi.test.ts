import { describe, expect, it } from "vitest";
import {
  deriveFtStatementStatus,
  opaquePayrollFilename,
  parseFtStatementRecords,
  parseFtStatementRollout,
  type FtPayrollStatementRecord,
} from "@/lib/payrollStatementUi";

const record: FtPayrollStatementRecord = {
  statement_id: "11111111-1111-4111-8111-111111111111",
  dealer_id: "22222222-2222-4222-8222-222222222222",
  state: "finalized",
  statement_version: 1,
  statement_hash: "a".repeat(64),
  source_fingerprint: "b".repeat(64),
  finalized_at: "2026-08-31T16:59:00.000Z",
  pdf_status: "not_generated",
  pdf_failure_code: null,
  pdf_rendered_at: null,
};

describe("payroll statement UI contract", () => {
  it("maps only explicit server PDF states", () => {
    expect(deriveFtStatementStatus(null)).toBe("DRAFT");
    expect(deriveFtStatementStatus(record)).toBe("FINALIZED");
    expect(deriveFtStatementStatus({ ...record, pdf_status: "generating" })).toBe("PDF_GENERATING");
    expect(deriveFtStatementStatus({ ...record, pdf_status: "ready" })).toBe("PDF_READY");
    expect(deriveFtStatementStatus({ ...record, pdf_status: "failed" })).toBe("PDF_FAILED");
    expect(deriveFtStatementStatus(null, "UNKNOWN")).toBe("UNKNOWN");
  });

  it("rejects malformed rollout and statement responses", () => {
    expect(parseFtStatementRollout({ allowed: false })).toBeNull();
    expect(parseFtStatementRollout({
      allowed: false,
      master_enabled: false,
      all_clubs_enabled: false,
      allowlisted: false,
      reason: "MASTER_OFF",
    })?.allowed).toBe(false);
    expect(parseFtStatementRecords([{ ...record, pdf_status: "invented" }])).toBeNull();
    expect(parseFtStatementRecords([record])).toEqual([record]);
  });

  it("builds an opaque filename without dealer PII", () => {
    const filename = opaquePayrollFilename("Tháng 08/2026", record.statement_id);
    expect(filename).toBe(`phieu-luong-082026-${record.statement_id}.pdf`);
    expect(filename).not.toContain("dealer");
  });
});
