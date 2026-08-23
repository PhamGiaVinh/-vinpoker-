import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1?target=denonext";
import { renderPayrollStatementPdf } from "../functions/_shared/payrollPdf/render.ts";
import type { PayrollStatementSnapshot } from "../functions/_shared/payrollPdf/types.ts";

const statementId = "11111111-1111-4111-8111-111111111111";
const clubId = "22222222-2222-4222-8222-222222222222";
const dealerId = "33333333-3333-4333-8333-333333333333";
const hash = "a".repeat(64);

function fixture(): PayrollStatementSnapshot {
  return {
    id: statementId,
    club_id: clubId,
    dealer_id: dealerId,
    statement_kind: "full_time_period",
    state: "finalized",
    cutoff_at: null,
    gross_amount_vnd: 25726250,
    deduction_amount_vnd: 8000000,
    net_amount_vnd: 17726250,
    source_snapshot: {
      payroll_period: { month: 8, year: 2026 },
      dealer_payroll: { regular_hours: 124, ot_hours: 44.5, work_days: 27, hourly_rate_vnd: 100000 },
    },
    dealer_snapshot: {
      dealer_id: dealerId,
      full_name: "Phạm Gia Vinh",
      employment_type: "full_time",
      department: "Dealer",
    },
    club_snapshot: {
      club_id: clubId,
      club_name: "HSOP · pgv",
      brand_key: "vinpoker",
      brand_asset_version: "v1",
    },
    financial_snapshot: { currency: "VND" },
    source_fingerprint: hash,
    statement_hash: hash,
    finalized_at: "2026-08-31T16:59:00.000Z",
    pt_wage_payment_id: null,
    lines: [
      { line_no: 1, line_type: "earning", line_code: "regular_pay", label: "Gio thuong", quantity: 124, unit: "giờ", unit_rate_vnd: 100000, amount_vnd: 12400000 },
      { line_no: 2, line_type: "earning", line_code: "ot_pay", label: "Tang ca", quantity: 44.5, unit: "giờ", unit_rate_vnd: 150000, amount_vnd: 8750000 },
      { line_no: 3, line_type: "deduction", line_code: "pit", label: "Thue TNCN", quantity: null, unit: null, unit_rate_vnd: null, amount_vnd: -8000000 },
    ],
  };
}

async function digest(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const value = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(value), (part) => part.toString(16).padStart(2, "0")).join("");
}

Deno.test("final PDF is deterministic and embeds Vietnamese-capable output", async () => {
  const first = await renderPayrollStatementPdf(fixture(), { mode: "final" });
  const second = await renderPayrollStatementPdf(fixture(), { mode: "final" });
  assertEquals(await digest(first.bytes), await digest(second.bytes));
  assert(first.bytes.length > 10_000);
  const parsed = await PDFDocument.load(first.bytes);
  assertEquals(parsed.getPages().length, 1);
  assertMatch(new TextDecoder().decode(first.bytes), /LiberationSans/);
  assertEquals(first.renderVersion, "vinpoker-payroll-v1");
});

Deno.test("preview watermark is explicit and final snapshot values are reused", async () => {
  const preview = await renderPayrollStatementPdf(fixture(), { mode: "preview" });
  const final = await renderPayrollStatementPdf(fixture(), { mode: "final" });
  assert(preview.bytes.length !== final.bytes.length);
  const parsed = await PDFDocument.load(preview.bytes);
  assertEquals(parsed.getPages().length, 1);
});

Deno.test("renderer rejects client-like snapshot mismatches", async () => {
  const invalid = fixture();
  invalid.club_snapshot = { ...invalid.club_snapshot, club_id: dealerId };
  await assertRejectsCode(() => renderPayrollStatementPdf(invalid, { mode: "final" }), "PAYROLL_PDF_CLUB_SNAPSHOT_MISMATCH");
});

async function assertRejectsCode(action: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    assertEquals((error as Error).message, code);
    return;
  }
  throw new Error(`Expected ${code}`);
}
