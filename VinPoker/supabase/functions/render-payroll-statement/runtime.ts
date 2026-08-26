export type PayrollPdfRequest =
  | { mode: "preview_ft"; club_id: string; dealer_id: string; payroll_period_id: string }
  | { mode: "preview" | "final"; statement_id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERROR = /^PAYROLL_(?:PDF|STATEMENT)_[A-Z0-9_]{1,80}$/;

export function parsePayrollPdfRequest(value: unknown): PayrollPdfRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.mode === "preview_ft") {
    if (!hasExactKeys(body, ["mode", "club_id", "dealer_id", "payroll_period_id"])) return null;
    if (!isUuid(body.club_id) || !isUuid(body.dealer_id) || !isUuid(body.payroll_period_id)) return null;
    return {
      mode: "preview_ft",
      club_id: body.club_id,
      dealer_id: body.dealer_id,
      payroll_period_id: body.payroll_period_id,
    };
  }
  if ((body.mode === "preview" || body.mode === "final") && isUuid(body.statement_id)) {
    if (!hasExactKeys(body, ["mode", "statement_id"])) return null;
    return { mode: body.mode, statement_id: body.statement_id };
  }
  return null;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

export function sanitizePayrollPdfError(error: unknown, fallback = "PAYROLL_PDF_RENDER_FAILED"): string {
  const candidates = [
    error instanceof Error ? error.message : null,
    typeof error === "object" && error !== null ? (error as Record<string, unknown>).code : null,
  ];
  const code = candidates.find((candidate): candidate is string => typeof candidate === "string" && SAFE_ERROR.test(candidate));
  return code ?? fallback;
}

export function fixedPayrollPdfPath(clubId: string, statementId: string): string {
  if (!isUuid(clubId) || !isUuid(statementId)) throw new Error("PAYROLL_PDF_INVALID_STATEMENT_IDENTITY");
  return `statements/${clubId}/${statementId}/statement.pdf`;
}

export function payrollPdfDownloadFilename(
  statementId: string,
  sourceSnapshot: Record<string, unknown>,
  draft = false,
): string {
  if (!isUuid(statementId)) throw new Error("PAYROLL_PDF_INVALID_STATEMENT_IDENTITY");
  const period = sourceSnapshot.payroll_period;
  if (!period || typeof period !== "object" || Array.isArray(period)) {
    throw new Error("PAYROLL_PDF_INVALID_PERIOD");
  }
  const month = Number((period as Record<string, unknown>).month);
  const year = Number((period as Record<string, unknown>).year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error("PAYROLL_PDF_INVALID_PERIOD");
  }
  const prefix = draft ? "phieu-luong-nhap" : "phieu-luong";
  return `${prefix}-${String(month).padStart(2, "0")}${year}-${statementId}.pdf`;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
