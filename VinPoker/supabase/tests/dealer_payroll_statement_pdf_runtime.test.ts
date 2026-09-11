import { assertEquals } from "jsr:@std/assert@1";
import {
  fixedPayrollPdfPath,
  parsePayrollPdfRequest,
  payrollPdfDownloadFilename,
  sanitizePayrollPdfError,
} from "../functions/render-payroll-statement/runtime.ts";

const clubId = "22222222-2222-4222-8222-222222222222";
const dealerId = "33333333-3333-4333-8333-333333333333";
const periodId = "44444444-4444-4444-8444-444444444444";
const statementId = "55555555-5555-4555-8555-555555555555";

Deno.test("runtime accepts only intent identifiers for FT draft preview", () => {
  assertEquals(parsePayrollPdfRequest({
    mode: "preview_ft",
    club_id: clubId,
    dealer_id: dealerId,
    payroll_period_id: periodId,
  }), {
    mode: "preview_ft",
    club_id: clubId,
    dealer_id: dealerId,
    payroll_period_id: periodId,
  });
  assertEquals(parsePayrollPdfRequest({
    mode: "preview_ft_view",
    club_id: clubId,
    dealer_id: dealerId,
    payroll_period_id: periodId,
  }), {
    mode: "preview_ft_view",
    club_id: clubId,
    dealer_id: dealerId,
    payroll_period_id: periodId,
  });
  assertEquals(parsePayrollPdfRequest({
    mode: "preview_ft",
    club_id: clubId,
    dealer_id: dealerId,
    payroll_period_id: periodId,
    amount: 9_999_999,
  }), null);
});

Deno.test("runtime accepts only intent identifiers for PT draft preview", () => {
  assertEquals(parsePayrollPdfRequest({
    mode: "preview_pt_view",
    club_id: clubId,
    dealer_id: dealerId,
    payroll_period_id: periodId,
  }), {
    mode: "preview_pt_view",
    club_id: clubId,
    dealer_id: dealerId,
    payroll_period_id: periodId,
  });
  assertEquals(parsePayrollPdfRequest({
    mode: "preview_pt",
    club_id: clubId,
    dealer_id: dealerId,
    payroll_period_id: periodId,
    amount: 800_000,
  }), null);
});

Deno.test("runtime accepts finalized preview and final intents only", () => {
  assertEquals(parsePayrollPdfRequest({ mode: "preview", statement_id: statementId }), {
    mode: "preview",
    statement_id: statementId,
  });
  assertEquals(parsePayrollPdfRequest({ mode: "preview_view", statement_id: statementId }), {
    mode: "preview_view",
    statement_id: statementId,
  });
  assertEquals(parsePayrollPdfRequest({ mode: "final", statement_id: statementId }), {
    mode: "final",
    statement_id: statementId,
  });
  assertEquals(parsePayrollPdfRequest({ mode: "final", statement_id: "not-a-uuid" }), null);
  assertEquals(parsePayrollPdfRequest({ mode: "final", statement_id: statementId, logo_url: "https://invalid" }), null);
});

Deno.test("runtime error sanitization never exposes provider messages", () => {
  assertEquals(
    sanitizePayrollPdfError({ code: "PAYROLL_PDF_OBJECT_CONFLICT", message: `private ${dealerId} https://private.invalid` }),
    "PAYROLL_PDF_OBJECT_CONFLICT",
  );
  assertEquals(
    sanitizePayrollPdfError({ code: "XX000", message: `private ${dealerId} https://private.invalid` }),
    "PAYROLL_PDF_RENDER_FAILED",
  );
});

Deno.test("storage path is fixed and contains identifiers only", () => {
  assertEquals(
    fixedPayrollPdfPath(clubId, statementId),
    `statements/${clubId}/${statementId}/statement.pdf`,
  );
});

Deno.test("download filename contains only period and statement UUID", () => {
  assertEquals(
    payrollPdfDownloadFilename(statementId, {
      payroll_period: { month: 8, year: 2026 },
      dealer_name: "must-not-appear",
      club_name: "must-not-appear",
    }),
    `phieu-luong-082026-${statementId}.pdf`,
  );
});

Deno.test("PT download filename derives the label from immutable covered_to", () => {
  assertEquals(
    payrollPdfDownloadFilename(statementId, {
      covered_to: "2026-08-31T16:59:59.000Z",
      dealer_name: "must-not-appear",
    }),
    `phieu-luong-082026-${statementId}.pdf`,
  );
});
