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

export function opaquePayrollFilename(periodLabel: string, statementId: string): string {
  const safePeriod = periodLabel.replace(/[^0-9-]/g, "").slice(0, 16) || "period";
  return `phieu-luong-${safePeriod}-${statementId}.pdf`;
}
