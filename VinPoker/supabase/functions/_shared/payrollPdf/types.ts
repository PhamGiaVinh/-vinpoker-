export type JsonRecord = Record<string, unknown>;

export type PayrollStatementKind = "full_time_period" | "part_time_settlement";

export interface PayrollStatementLine {
  line_no: number;
  line_type: "earning" | "deduction" | "adjustment" | "rate_segment" | string;
  line_code: string;
  label: string;
  quantity: number | string | null;
  unit: string | null;
  unit_rate_vnd: number | string | null;
  amount_vnd: number | string;
  source_snapshot?: JsonRecord;
}

export interface PayrollStatementSnapshot {
  id: string;
  club_id: string;
  dealer_id: string;
  statement_kind: PayrollStatementKind;
  state: string;
  cutoff_at: string | null;
  gross_amount_vnd: number | string;
  deduction_amount_vnd: number | string;
  net_amount_vnd: number | string;
  source_snapshot: JsonRecord;
  dealer_snapshot: JsonRecord;
  club_snapshot: JsonRecord;
  financial_snapshot: JsonRecord;
  source_fingerprint: string;
  statement_hash: string;
  finalized_at: string | null;
  pt_wage_payment_id: string | null;
  lines: PayrollStatementLine[];
}

export interface PayrollPdfFonts {
  regular: Uint8Array;
  bold: Uint8Array;
}

export type PayrollPdfMode = "draft_preview" | "finalized";

export interface PayrollPdfRenderOptions {
  mode: PayrollPdfMode;
  fonts?: PayrollPdfFonts;
}

export interface RenderedPayrollPdf {
  bytes: Uint8Array;
  statementId: string;
  statementHash: string;
  renderVersion: string;
  mode: PayrollPdfMode;
}

export interface PayrollStatementViewModel {
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
}
