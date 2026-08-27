export interface DealerCheckoutResult {
  attendance_id?: string;
  success?: boolean;
  error?: string;
  dealer_name?: string;
  released_pre_assigned?: boolean;
  pre_assigned_table?: string | null;
  idempotent?: boolean;
  [key: string]: unknown;
}

export interface DealerCheckoutBatchSummary {
  results: DealerCheckoutResult[];
  successCount: number;
  failedCount: number;
  failureMessage: string | null;
}

function safeResults(data: unknown): DealerCheckoutResult[] {
  if (!data || typeof data !== "object") return [];
  const results = (data as { results?: unknown }).results;
  return Array.isArray(results) ? results : [];
}

export function summarizeDealerCheckoutBatch(
  data: unknown,
  requestedCount: number,
): DealerCheckoutBatchSummary {
  const results = safeResults(data);
  const successful = results.filter((result) => result?.success === true);
  const explicitFailures = results.filter((result) => result?.success !== true);
  const missingCount = Math.max(0, requestedCount - results.length);
  const failedCount = explicitFailures.length + missingCount;

  if (failedCount === 0) {
    return {
      results,
      successCount: successful.length,
      failedCount: 0,
      failureMessage: null,
    };
  }

  const reasonCounts = new Map<string, number>();
  for (const result of explicitFailures) {
    const reason = typeof result.error === "string" && result.error.trim()
      ? result.error.trim()
      : "Máy chủ không trả lý do";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  if (missingCount > 0) {
    const reason = `Thiếu ${missingCount} kết quả từ máy chủ`;
    reasonCounts.set(reason, 1);
  }

  const reasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => count > 1 ? `${count}× ${reason}` : reason)
    .join("; ");

  return {
    results,
    successCount: successful.length,
    failedCount,
    failureMessage: `${failedCount} dealer thất bại — ${reasons}`,
  };
}
