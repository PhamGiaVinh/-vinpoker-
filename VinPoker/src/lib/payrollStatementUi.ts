export type FtPayrollStatementStatus =
  | "DRAFT"
  | "FINALIZING"
  | "FINALIZED"
  | "PDF_GENERATING"
  | "PDF_READY"
  | "PDF_FAILED"
  | "UNKNOWN";

export type FtPayrollStatementRecord = {
  statement_id: string;
  dealer_id: string;
  state: string;
  statement_version: number;
  statement_hash: string;
  source_fingerprint: string;
  finalized_at: string;
  pdf_status: "not_generated" | "generating" | "ready" | "failed";
  pdf_failure_code: string | null;
  pdf_rendered_at: string | null;
};

export type FtStatementRollout = {
  allowed: boolean;
  master_enabled: boolean;
  all_clubs_enabled: boolean;
  allowlisted: boolean;
  reason: "MASTER_OFF" | "CLUB_NOT_ALLOWLISTED" | "ENABLED" | "ROLLOUT_UNAVAILABLE";
};

export type PayrollStatementOnlinePreview = {
  statement_id: string;
  statement_hash: string;
  draft: boolean;
  brand_name: string;
  club_name: string;
  period_label: string;
  dealer: {
    full_name: string;
    department: string;
    job_title: string;
    bank_account_number: string;
    bank_name: string;
    hire_date: string;
    employment_type: string;
  };
  metrics: Array<{ label: string; value: string }>;
  income_lines: Array<{ label: string; method: string; quantity: string; unit_rate: string; amount: string }>;
  rate_segments: Array<{ range: string; unit_rate: string; quantity: string }>;
  deduction_lines: Array<{ label: string; amount: string }>;
  gross_amount: string;
  deduction_amount: string;
  net_amount: string;
  finalized_label: string;
};

export const FT_STATEMENT_STATUS_LABELS: Record<FtPayrollStatementStatus, string> = {
  DRAFT: "Chưa chốt",
  FINALIZING: "Đang chốt",
  FINALIZED: "Đã chốt",
  PDF_GENERATING: "Đang tạo PDF",
  PDF_READY: "PDF sẵn sàng",
  PDF_FAILED: "PDF lỗi",
  UNKNOWN: "Chưa rõ trạng thái",
};

export function deriveFtStatementStatus(
  record: FtPayrollStatementRecord | null | undefined,
  override?: FtPayrollStatementStatus,
): FtPayrollStatementStatus {
  if (override) return override;
  if (!record) return "DRAFT";
  if (record.pdf_status === "ready") return "PDF_READY";
  if (record.pdf_status === "generating") return "PDF_GENERATING";
  if (record.pdf_status === "failed") return "PDF_FAILED";
  return "FINALIZED";
}

export function parseFtStatementRollout(value: unknown): FtStatementRollout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const reason = row.reason;
  if (
    typeof row.allowed !== "boolean" || typeof row.master_enabled !== "boolean" ||
    typeof row.all_clubs_enabled !== "boolean" || typeof row.allowlisted !== "boolean" ||
    !["MASTER_OFF", "CLUB_NOT_ALLOWLISTED", "ENABLED", "ROLLOUT_UNAVAILABLE"].includes(String(reason))
  ) return null;
  return {
    allowed: row.allowed,
    master_enabled: row.master_enabled,
    all_clubs_enabled: row.all_clubs_enabled,
    allowlisted: row.allowlisted,
    reason: reason as FtStatementRollout["reason"],
  };
}

export function parseFtStatementRecords(value: unknown): FtPayrollStatementRecord[] | null {
  if (!Array.isArray(value)) return null;
  const records: FtPayrollStatementRecord[] = [];
  for (const valueRow of value) {
    if (!valueRow || typeof valueRow !== "object" || Array.isArray(valueRow)) return null;
    const row = valueRow as Record<string, unknown>;
    if (
      typeof row.statement_id !== "string" || typeof row.dealer_id !== "string" ||
      typeof row.state !== "string" || typeof row.statement_version !== "number" ||
      typeof row.statement_hash !== "string" || typeof row.source_fingerprint !== "string" ||
      typeof row.finalized_at !== "string" ||
      !["not_generated", "generating", "ready", "failed"].includes(String(row.pdf_status)) ||
      !(row.pdf_failure_code === null || typeof row.pdf_failure_code === "string") ||
      !(row.pdf_rendered_at === null || typeof row.pdf_rendered_at === "string")
    ) return null;
    records.push(row as FtPayrollStatementRecord);
  }
  return records;
}

export function parsePayrollStatementOnlinePreview(value: unknown): PayrollStatementOnlinePreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (!envelope.view || typeof envelope.view !== "object" || Array.isArray(envelope.view)) return null;
  const view = envelope.view as Record<string, unknown>;
  const dealer = view.dealer;
  if (!isRecord(dealer) ||
    !isText(view.statement_id) || !isText(view.statement_hash) || typeof view.draft !== "boolean" ||
    !isText(view.brand_name) || !isText(view.club_name) || !isText(view.period_label) ||
    !isText(view.gross_amount) || !isText(view.deduction_amount) || !isText(view.net_amount) || !isText(view.finalized_label) ||
    !["full_name", "department", "job_title", "bank_account_number", "bank_name", "hire_date", "employment_type"].every((key) => isText(dealer[key]))
  ) return null;

  const metrics = parseRows(view.metrics, ["label", "value"]);
  const incomeLines = parseRows(view.income_lines, ["label", "method", "quantity", "unit_rate", "amount"]);
  const rateSegments = parseRows(view.rate_segments, ["range", "unit_rate", "quantity"]);
  const deductionLines = parseRows(view.deduction_lines, ["label", "amount"]);
  if (!metrics || !incomeLines || !rateSegments || !deductionLines) return null;

  return {
    statement_id: view.statement_id,
    statement_hash: view.statement_hash,
    draft: view.draft,
    brand_name: view.brand_name,
    club_name: view.club_name,
    period_label: view.period_label,
    dealer: {
      full_name: dealer.full_name,
      department: dealer.department,
      job_title: dealer.job_title,
      bank_account_number: dealer.bank_account_number,
      bank_name: dealer.bank_name,
      hire_date: dealer.hire_date,
      employment_type: dealer.employment_type,
    },
    metrics: metrics.map((row) => ({ label: row.label, value: row.value })),
    income_lines: incomeLines.map((row) => ({ label: row.label, method: row.method, quantity: row.quantity, unit_rate: row.unit_rate, amount: row.amount })),
    rate_segments: rateSegments.map((row) => ({ range: row.range, unit_rate: row.unit_rate, quantity: row.quantity })),
    deduction_lines: deductionLines.map((row) => ({ label: row.label, amount: row.amount })),
    gross_amount: view.gross_amount,
    deduction_amount: view.deduction_amount,
    net_amount: view.net_amount,
    finalized_label: view.finalized_label,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 500;
}

function parseRows(value: unknown, keys: string[]): Array<Record<string, string>> | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const rows: Array<Record<string, string>> = [];
  for (const row of value) {
    if (!isRecord(row) || !keys.every((key) => isText(row[key]))) return null;
    rows.push(Object.fromEntries(keys.map((key) => [key, row[key] as string])));
  }
  return rows;
}

export function opaquePayrollFilename(periodLabel: string, statementId: string): string {
  const safePeriod = periodLabel.replace(/[^0-9-]/g, "").slice(0, 16) || "period";
  return `phieu-luong-${safePeriod}-${statementId}.pdf`;
}
